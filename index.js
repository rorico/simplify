var acorn = require("acorn")
var astring = require("astring")
var astravel = require("astravel")
var fs = require("fs")
var lognode = require("./lognode")
var ignoreGlobal = require("./ignoreGlobal")
var ignore = require("./ignore")
var path = require("path")
var simplifyError = require("./simplifyError")
var getOverrides = require('./overrides')
var side = require('./side')
var fakeRequireFilter = require('./fakeRequireFilter')
var getBaseRet = require('./baseRet')

var functionName = Symbol('name')
var modules = {}
var called = new Set()
var calledWith = new Map()
var funcDefined = new Set()
var allAsts = []
var recording = false
var nodes = []
var findClosures = new Map()
var asString = new Map()
var under = new Map()
var underString = new Map()
var callstack = []

var poly = fs.readFileSync('./polyfill.js')
var polyfills = simplify(poly, {node: true, filename: './polyfill.js', package: __dirname, comments: true}).exposed['module.exports']
var requireRead = Symbol('requireRead')

class SimplifyPromise extends Promise {}

function simplify(code, opts) {
	var vars = {}
	var changed = {}
	var closuresMod = new Set()
	var usedVars = new Set()
	var replace = []
	var replaceCache = new Map()
	var loaded = false

	var filename = opts.filename

	if (!opts) opts = {}
	var module = {}
	var exposed = {}
	var overrides = getOverrides({
		getUnderStringObj,
		addUnder,
		removeUnder,
	})

	var acornOpts = { locations: true }
	if (opts.comments) {
		var comments = []
		acornOpts.onComment = comments
	}

	var ast = parse(code)
	allAsts.push(ast)

	if (opts.comments) {
		astravel.attachComments(ast, comments)
	}

	initHoisted(ast)
	walk(ast, { vars })
	console.log("parsed through file", filename)

	if (opts.node && opts.filename) {
		module.loaded = loaded = true
	}
	if (opts.node) {
		exposed["module.exports"] = module.exports
	}
	for (var prop in vars) {
		// todo better way to handle predefined variables
		if (prop !== "this") {
			exposed[prop] = vars[prop]
		}
	}

	var ret = {
		ast: ast,
		exposed: exposed,
		findClosures: findClosures,
		replaceCall: replaceCall,
		call: (fname, args) => {
			var func
			if (fname.includes(".")) {
				// do this way to preserve this
				var parts = fname.split(".")
				var obj = global
				for (var i = 0 ; i < parts.length - 1 ; i++) {
					obj = obj[parts[i]]
				}
				func = (...args) => {
					return obj[parts[parts.length - 1]](...args)
				}
			} else {
				func = getVar(fname)
			}
			return ret.record(() => {
				return func(...args)
			})
		},
		record: (func) => {
			recording = true
			for (var a of allAsts) {
				reset(a)
			}
			called = new Set()
			calledWith = new Map()
			usedVars = new Set()
			funcDefined = new Set()

			var after = () => {
				recording = false
				var body = []
				for (var v of called.values()) {
					if (!funcDefined.has(v)) {
						unused(v)
						body.unshift(v)
					}
				}
				for (var v of usedVars.values()) {
					body.unshift(v)
				}

				var c = {
					type: "Program",
					body: body.reverse(),
					fake: true
				}

				return {
					ret: ret,
					c: c,
					code: astring.generate(c),
					ast: ast,
					called: called
				}
			}
			var ret = func()
			if (ret instanceof Promise) {
				return ret.then(after)
			} else {
				return after()
			}
		}
	}
	return ret

	function parse(code) {
		return acorn.parse(code, acornOpts)
	}

	function getFileLink(node) {
		return filename + ':' + node.loc.start.line + ':' + (node.loc.start.column+1)
	}
	function getCallStack(node) {
		return callstack.map(c => c[0]).concat(node ? getFileLink(node) : []).reverse()
	}

	function toString(obj) {
		// todo some limit on size -> str size vs #num of keys
		// todo prototypes
		// todo configurable
		// do this to handle circular objects
		var maxLength = 100
		var handled = new Set()
		return rec(obj)
		function childRec(obj) {
			var str = rec(obj)
			return str.length > maxLength ? '(...)' : str
		}
		function rec(obj) {
			if (handled.has(obj)) {
				return '[circular structure]'
			}
			handled.add(obj)
			var ret
			if (asString.has(obj)) {
				// todo handle primitive with strs
				ret = asString.get(obj)
			} else if (typeof obj === "function") {
				if (!obj.node) {
					// console.log('what now', obj)
					ret = 'function'
				} else {
					ret = 'function'
					if (obj.node.id) {
						ret += ' ' + obj.node.id.name
					}
					ret += '(' + obj.node.params.map(p => p.name).join(', ') + ') {}'
				}
			} else if (Array.isArray(obj)) {
				ret = '[' + obj.map(childRec).join(', ') +']'
			} else if (obj && typeof obj === 'object') {
				ret = '{' + Object.keys(obj).map(k => {
					return k + ': ' + (Object.getOwnPropertyDescriptor(obj, k).get ? 'getter' : childRec(obj[k]))
				}).join(', ') + '}'
			} else if (typeof obj === 'symbol') {
				ret = obj.toString()
			} else if (typeof obj === 'string') {
				// to handle escape characters
				// todo not like this
				ret = JSON.stringify(obj)
				// ret = '"' + obj + '"'
			} else {
				ret = '' + obj
			}
			handled.delete(obj)
			return ret
		}
	}
	function check(value) {
		// don't do special for primatives
		if (asString.has(value)) {
			return asString.get(value)
		} else if (typeof value === "function") {
			if (!value.node) {
				console.log('what now', value)
				return 'function'
			} else {
				return code.substring(value.node.start, value.node.body.start) + '{}'
			}
		} else if (value === undefined) {
			return 'undefined'
		}
	}
	function setString(obj, str) {
		if (notPrimitive(obj) && !hasString(obj) && str) {
			asString.set(obj, str)
		}
	}
	function hasString(obj) {
		return asString.has(obj)
	}
	function notPrimitive(obj) {
		return obj && (typeof obj === "object" || typeof obj === "function")
	}
	function composeIfExists(...list) {
		var use = false
		var ret = list.map(e => {
			if (typeof e === 'string') {
				return e
			} else if (e.str) {
				use = true
				return '**' + e.str + '**'
			} else {
				return toString(e.val || e.ret)
			}
		}).join('')
		return use ? ret : undefined
	}

	function addClosure(obj, closure, name) {
		if (notPrimitive(obj)) {
			if (!findClosures.has(obj)) {
				findClosures.set(obj, new Map())
			}
			var closures = findClosures.get(obj)
			if (!closures.has(closure)) {
				closures.set(closure, {})
			}
			var vars = closures.get(closure)
			if (!vars[name]) {
				vars[name] = true
			}
		}
	}
	
	function removeClosure(obj, closure, name) {
		if (notPrimitive(obj)) {
			if (!findClosures.has(obj)) {
				// console.log('uh what')
				return
			}
			var closures = findClosures.get(obj)
			if (!closures.has(closure)) {
				console.log('uh what')
				return
			}
			var vars = closures.get(obj)
			if (!vars[name]) {
				console.log('uh what')
				return
			}
			delete vars[name]
			if (!Object.keys(vars).length) {
				closures.delete(obj)
				if (!closures.size) {
					findClosures.delete(obj)
				}
			}
		}
	}
	function closuresAffected(obj) {
		// do this to handle circular objects
		var handled = new Set()
		return check(obj)
		function check(obj) {
			var ret = new Set()
			if (handled.has(obj)) {
				return ret
			}
			handled.add(obj)
			if (hasClosure(obj)) {
				getClosure(obj).forEach((_, c) => {
					ret.add(c)
					if (global.testing) console.log(c)
				})
			}
			if (under.has(obj)) {
				under.get(obj).forEach(o => {
					check(o).forEach(c => {
						ret.add(c)
					})
				})
			}
			return ret
		}
	}
	
	function getClosure(obj) {
		if (hasClosure(obj)) {
			return findClosures.get(obj)
		} else {
			return new Set([vars])
		}
	}

	function hasClosure(obj) {
		return findClosures.has(obj)
	}
	
	function addUnderString(obj, key, str) {
		if (str) {
			if (!underString.has(obj)) {
				underString.set(obj, Array.isArray(obj) ? [] : {})
			}
			var strings = underString.get(obj)
			strings[key] = str
		}
	}
	function setUnderString(obj, strObj) {
		underString.set(obj, strObj)
	}
	function getUnderStringObj(obj) {
		if (!underString.has(obj)) {
			underString.set(obj, Array.isArray(obj) ? [] : {})
		}
		return underString.get(obj)
	}
	function removeUnderString(obj, key) {
		if (underString.has(obj)) {
			var strings = underString.get(obj)
			delete strings[key]
			if (!Object.keys(strings).length) {
				underString.delete(obj)
			}
		}
	}
	function getUnderString(obj, key) {
		if (hasString(obj[key])) {
			return toString(obj[key])
		}
		if (!notPrimitive(obj[key])) {
			if (underString.has(obj)) {
				return underString.get(obj)[key]
			}
		}
	}

	function addUnder(obj, parent) {
		if (notPrimitive(obj)) {
			if (!under.has(obj)) {
				under.set(obj, new Set())
			}
			var closures = under.get(obj)
			closures.add(parent)
		}
	}
	function removeUnder(obj, parent) {
		if (under.has(obj)) {
			var closures = under.get(obj)
			closures.delete(parent)
			if (!closures.size) {
				under.delete(obj)
			}
		}
	}
	function call(name, args) {
		var f = getVar(name)
		return f(...args)
	}

	function isFunction(node) {
		return node instanceof Function
	}

	function addFunction(node, superClass, isConstructor) {
		node.calls = node.calls || 0
		// need a seperate closure for each call
		var closure = vars
		// don't want to make new required modules disappear
		if (loaded) funcDefined.add(node)
		function setup() {
			if (recording) {
				node.calls++
				called.add(node)
				if (calledWith.has(node)) {
					calledWith.get(node).push(arguments)
				} else {
					calledWith.set(node, [arguments])
				}
			}

			var params = node.params
			// this will get passed in
			var argStrs = func.argStrs || []
			var calleds = !!func.argStrs
			// clear it to ensure that when getting it is only exactly after its called
			func.argStrs = undefined
			var oldVars = vars
			// TODO handle updating global variables
			vars = {}
			vars.__proto__ = closure
			for (var i = 0 ; i < params.length ; i++) {
				var p = params[i]
				var arg = arguments[i]
				if (p.type === "Identifier") {
					var str = argStrs[i]
					if (!str && !calleds && !func.argsNotGlobal) {

						// todo, better way to get info about arguments from global call
						// todo on callbacks with multiple calls seperate them
						if (!func.callStr) {
							console.log('callback called without attaching to a global function', arguments[i], getCallStack(node))
							// process.exit()
							// console.log('callback called without attaching to a global function', node.loc.start, filename)
							// process.exit()
							str = node.id ? node.id.name : 'some_function_with_external_call'
						} else {
							str = func.callStr
						}
						str += '.' + p.name
						argStrs[i] = str
						addClosure(arguments[i], global, 'preihtios')
						setString(arguments[i], str)
					}
					addVar(p.name, arguments[i], p, str)
				} else if (p.type === "ObjectPattern") {
					// TODO this well
					for (var prop of p.properties) {
						if (prop.key.type !== "Identifier") console.log("ObjectPattern key not Identifier", prop)
						if (prop.value.type !== "Identifier") console.log("ObjectPattern value not Identifier", prop)
						addVar(prop.key.name, arguments[i][prop.value.type], prop)
						// todo add owners
					}
				} else if (p.type === "RestElement") {
					if (p.argument.type !== "Identifier") console.log("RestElement argument not Identifier", prop)
					var val = Array.prototype.slice.call(arguments, i)
					addVar(p.argument.name, val, p)
					break
				} else {
					console.log("unknown param type", p)
				}
			}

			// some ghetto way to keep track if these variables are used
			if (!node.argsUsed) {
				node.argsUsed = {}
			}
			if (!node.thisUsed) {
				node.thisUsed = {}
			}
			// don't want to set arguments to a str
			addVar("arguments", arguments, node.argsUsed)
			// might want to set this as an array
			for (var i in arguments) {
				addUnderString(arguments, i, argStrs[i])
			}
			var that = func.arrowThis || this
			// may cause incorrect closure values
			addVar("this", that, node.thisUsed, func.thisStr)
			if (!hasClosure(that)) {
				// todo, better way to get info about arguments from global call
				addClosure(that, global, 'treiuu')
				setString(that, 'this')
			}

			initHoisted(node.body)
			return oldVars
		}
		function finish(oldVars) {
			closuresMod.delete(vars)
			vars = oldVars
		}
		var func
		if (!node.generator && !node.async) {
			func = function() {
				var oldVars = setup.apply(this, arguments)
				try {
					var ret = walk(node.body, { vars, superClass })
					if (superClass && isConstructor && !ret.return) {
						var that = getV('this')
						ret = getBaseRet()
						ret.ret = that.val
						ret.str = that.str
					}
					// only used to pass to callExpression which should be immediately after
					func.ret = ret
					return ret.ret
				} catch (e) {
					throw e
				} finally {
					// do in finally in case try catches are part of code flow
					// this can happen if a higher function modifies this one
					// remove just in case
					finish(oldVars)
				}
			}
		} else if (node.generator && !node.async) {
			func = function*() {
				var oldVars = setup.apply(this, arguments)
				try {
					var ret = yield* walkGen(node.body, { vars, superClass })
					// only used to pass to callExpression which should be immediately after
					func.ret = ret
					return ret.ret
				} catch (e) {
					throw e
				} finally {
					// do in finally in case try catches are part of code flow	
					// this can happen if a higher function modifies this one
					// remove just in case
					finish(oldVars)
				}
			}
		} else if (!node.generator && node.async) {
			func = async function() {
				var oldVars = setup.apply(this, arguments)
				try {
					var gen = walkGen(node.body, { vars, superClass })
					var promise = gen.next()
					while (!promise.done) {
						var promise = gen.next(await promise.value)
					}
					var ret = promise.value
					// only used to pass to callExpression which should be immediately after
					func.ret = ret
					return ret.ret
				} catch (e) {
					throw e
				} finally {
					// do in finally in case try catches are part of code flow	
					// this can happen if a higher function modifies this one
					// remove just in case
					finish(oldVars)
				}
			}
		} else if (node.generator && node.async) {
			func = async function*() {
				var oldVars = setup.apply(this, arguments)
				try {
					var gen = walkGen(node.body, { vars, superClass })
					var promise = gen.next()
					while (!promise.done) {
						var next
						if (promise.value instanceof SimplifyPromise) {
							next = await promise.value
						} else {
							next = yield promise.value
						}
						var promise = gen.next(next)
					}
					var ret = promise.value
					// only used to pass to callExpression which should be immediately after
					func.ret = ret
					return ret.ret
				} catch (e) {
					throw e
				} finally {
					// do in finally in case try catches are part of code flow	
					// this can happen if a higher function modifies this one
					// remove just in case
					finish(oldVars)
				}
			}
		}
		// for access to node from function
		func.node = node
		if (node.id) {
			var name = node.id.name
			addVar(name, func, node, name)
			func[functionName] = name
		}
		if (node.type === 'ArrowFunctionExpression') {
			// todo add str
			var arrowThis = getV('this')
			func.arrowThis = arrowThis.val
			func.thisStr = arrowThis.str
		}
		return func
	}
	function callFunction(func, node, args, argStrs, thisArg, thisStr, isNew) {
		var ret = getBaseRet()
		
		func.argStrs = argStrs
		if (!func.arrowThis) {
			// don't override thisStr, since it will be using a different thisArg anyways
			func.thisStr = thisStr
		}

		var currClos = closuresMod
		closuresMod = new Set()

		var oldCall = callstack
		callstack = callstack.concat([[getFileLink(node), filename, node.loc]])

		if (isNew) {
			ret.ret = new func(...args)
		} else {
			ret.ret = func.apply(thisArg, args)
		}

		callstack = oldCall

		
		// if (callStr) {
			
		// 	setString(ret.ret, callStr)
		// }
		// todo, not like this
		if (func.ret) {
			// don't copy entire object cause other places assume reference is kept
			// also because using new doesn't actually set it
			ret.str = func.ret.str
			// ret.return = false
		}

		if (closuresMod.size) {
			node.side = true
			for (var c of closuresMod.values()) {
				var contained = false
				var o = c
				while (o) {
					if (o === vars) {
						contained = true
						break
					}
					o = o.__proto__
				}
				if (!contained) {
					currClos.add(c)
				}
			}
		}
		closuresMod = currClos
		return ret
	}

	function reset(node) {
		if (node.calls) node.calls = 0
		if (node.visits) node.visits = 0
		if (node.used) node.used = 0
		if (node.remove) node.remove = false
		if (node.true) node.true = 0
		// TODO move this all to a metadata obj or something so its easier to reset

		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					if (!c) continue
					var res = reset(c)
				}
			} else if (val && typeof val.type === "string") {
				var res = reset(val)
			}
		}
	}

	function initHoisted(node) {
		if (!node.nodeId) {
			node.nodeId = nodes.length
			nodes.push(node)
		}
		var funcTypes = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]
		if (node.type === "FunctionDeclaration") {
			addFunction(node)
			return
		} else if (node.type === "VariableDeclarator") {
			addVar(node.id.name, undefined)
		} else if (funcTypes.includes(node.type)) {
			// don't hoist variables in nested functions
			return
		}
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					if (!c) continue
					var res = initHoisted(c)
				}
			} else if (val && typeof val.type === "string") {
				var res = initHoisted(val)
			}
		}
	}

	function *assign(node, val, init, str) {
		if (node.type === "Identifier") {
			if (init) {
				addVar(node.name, val, node, str)
			} else {
				setVar(node.name, val, node, str)
			}
		} else if (node.type === "ObjectPattern") {
			// TODO this well
			for (var prop of node.properties) {
				if (prop.type === "RestElement") console.log("unsupported rest element ", prop)
				var key = yield* getKey(prop)
				var p = getPropWithKey(val, key, str)
				yield* assign(prop.value, p.val, init, p.str)
			}
		} else if (node.type === "ArrayPattern") {
			// TODO this well
			for (var i in node.elements) {
				var prop = node.elements[i]
				if (prop.type === "RestElement") console.log("unsupported rest element ", prop)
				var p = getPropWithKey(val, i, str)
				yield* assign(prop, p.val, init, p.str)
			}
		} else {
			console.log("unknown assign type", node, getCallStack(node))
		}
	}
	function addVar(name, val, node, str) {
		// if (vars.hasOwnProperty(name)) {
		// 	// already set in this closure
		// 	var v = vars[name]
		// 	if (v.node) {
		// 		v.used = v.uses > 0
		// 	}
		// }
		addClosure(val, vars, name)
		vars[name] = {
			uses: 0,
			val: val,
			// closure: closure,
			vars: vars,
			node: node,
			init: node,
			str: str,
		}
		// addClosure(val, closure)
		// todo fix
		// if (closure !== vars && node) {
		// 	node.side = true
		// }
		return val
	}
	function setVar(name, val, node, str) {
		if (!(name in vars)) {
			global[name] = val
			exposed[name] = val
			// todo similar logic as below to remove closure
			valC.add(global)
			addClosure(val, global, name)
			closuresMod.add(global)
			return
		}

		var v = vars[name]
		removeClosure(v, vars, name)
		addClosure(val, vars, name)

		v.val = val
		if (v.node) {
			v.node.varChanged = true
		}
		v.str = str
		v.node = node
		// todo fix
		// if (v.closure !== vars && node) {
		// 	node.side = true
		// }
		v.uses = 0
		return val
	}
	function setProp(obj, name, val, node, varPath, str, objStr) {
		if (obj[name]) {
			removeUnder(obj[name], obj)
		}
		var set = Object.getOwnPropertyDescriptor(obj, name) && Object.getOwnPropertyDescriptor(obj, name).set
		if (set) {
			callFunction(set, node, [val], [str], obj, objStr)
		} else {
			obj[name] = val
			addUnder(val, obj)
			if (str) {
				addUnderString(obj, name, str)
				setString(obj[name], str)
			}
			var mod = closuresAffected(obj)
			mod.forEach(c => closuresMod.add(c))
	
			if (mod.has(global)) {
				if (varPath[0]) {
					exposed[varPath.join(("."))] = val
				}
			}
		}
		// todo fix
		// if (closure !== vars && node) {
		// 	node.side = true
		// }
		return val
	}

	function getVar(name) {
		return getV(name).val
	}

	function getV(name) {
		if (vars[name] === undefined) {
			if (!(name in global)) {
				console.log(name, "not defined, should have errored")
			}
			var ret = global[name]
			setString(ret, name)
			addClosure(ret, global, name)
			return {
				// incorrect
				uses: 1,
				val: ret,
				vars: global,
				str: name
			}
		} else {
			var v = vars[name]
			v.uses++
			if (v.uses === 1 && v.node) {
				v.node.used = v.node.used ? v.node.used + 1 : 1
			}
			if (v.uses === 1 && v.init) {
				// todo if uncount is ever used
				v.init.varUsed = true
			}
			// use Object.hasOwnProperty as hasOwnProperty can actually be a variable name
			if (v.node && !Object.hasOwnProperty.call(vars, name)) {
				usedVars.add(v.node)
			}
			return v
		}
	}

	function uncount(name) {
		var v = vars[name]
		v.uses--
		if (v.uses === 0 && v.node) {
			v.node.used--
		}
	}

	function *getKey(node) {
		if (node.computed || node.key.type === 'Literal') {
			return (yield node.key).ret
		} else {
			return node.key.name
		}
	}
	function *getObj(node) {
		return getObjRet(yield* getObjKey(node))
	}
	function *getObjKey(node) {
		if (node.type !== "MemberExpression") console.log("getObj not MemberExpression")
		if (!node.object || !node.property)
			console.log("missing member object or property")

		var res = yield node.object
		var obj = res.ret
		if (!obj) {
			// console.log('obj is falsy', getCallStack(node))
		}
		var objStr = res.str
		var key = node.computed ? (yield node.property).ret : node.property.name
		return getWithKey(obj, key, objStr)
	}
	function getPropWithKey(obj, key, objStr) {
		return getObjRet(getWithKey(obj, key, objStr))
	}
	function getWithKey(obj, key, objStr) {
		if (key === 'name' && obj[functionName]) {
			key = functionName
		}
		var str = objStr || (hasString(obj) ? toString(obj) : '')
		if (str) {
			if (typeof key === 'symbol') {
				str += '[' + key.toString() + ']'
			} else if (Array.isArray(obj) && typeof key === 'number') {
				str += '[' + key + ']'
			} else {
				// maybe in future do a check for valid character names
				// https://stackoverflow.com/a/9337047
				if (typeof key !== 'string' || key.includes('.')) {
					str += '["' + key + '"]'
				} else {
					str += '.' + key
				}
			}
		}
		return {
			obj: obj,
			key: key,
			// varPath: varPath,
			varPath: [],
			str: str,
			objStr: objStr
		}
	}
	function getObjRet(ret) {
		var { obj, key } = ret
		var val = obj[key]
		addUnder(val, obj)
		var str = getUnderString(obj, key) || ret.str

		return {
			...ret,
			str: str,
			val: val
		}
	}

	function breakOut(node) {
		return node && (node.return || node.break || node.continue)
	}

	function breaks(r, label) {
		var ret = {
			return: false,
			break: false,
			continue: false
		}
		
		if (r.return) {
			ret.return = true
		} else if (r.break) {
			if (typeof r.break === 'string') {
				if (r.break !== label) {
					ret.return = true
				}
			}
			ret.break = true
		} else if (r.continue) {
			if (typeof r.continue === 'string') {
				if (r.continue !== label) {
					ret.return = true
				}
			}
			ret.continue = true
		}
		return ret
	}
	
	function walk(node, context) {
		var gen = walkGen(node, context)
		var ret = gen.next()
		if (!ret.done) {
			console.log('what, gen has not ended')
		}
		return ret.value
	}

	function *walkGen(node, context) {
		var ret = getBaseRet()
		vars = context.vars
		var steps
		var after
		if (!node) {
			console.log("unexpected null node")
			throw new Error("e")
			return ret
		}
		if (lognode[node.type])
			console.log(node.type, node)

		if (node.delete === undefined) node.delete = 0
		if (node.visits === undefined) node.visits = 0
		if (recording) {
			node.visits++
		}

		switch (node.type) {
			case "VariableDeclarator":
				steps = function*() {
					var init = node.init ? yield node.init : {}
					yield* assign(node.id, init.ret, true, init.str)
				}
				break
			// these are different, but mostly the same for now
			case "FunctionDeclaration":
				// these should be hoisted already
				return ret
			case "FunctionExpression":
			case "ArrowFunctionExpression":
				ret.ret = addFunction(node)
				return ret

			case "NewExpression":
			case "CallExpression":
				steps = function*() {
					var argsInfo = []
					for (var arg of node.arguments)  {
						var argRet = yield arg
						if (argRet.spread) {
							for (var r in argRet.ret) {
								var p = getPropWithKey(argRet.ret, r, argRet.str)
								argsInfo.push({
									ret: p.val,
									str: p.str
								})
							}
						} else {
							argsInfo.push(argRet)
						}
					}
					
					var args = argsInfo.map(a => a.ret)
					var argStrs = argsInfo.map(a => a.str)

					var thisArg = global
					//shouldn't need this as this is never primitive
					var thisStr // don't have str for window since its not primitive
					var callType = "normal"
					var func
					var str
					if (node.callee.type === "MemberExpression") {
						// do it this way to maintain thisArg
						// can bind it, but that removes/changes some properties added
						// like name, node
						var o = yield* getObj(node.callee)
						
						if (node.callee.object.type === "Super") {
							// super is a special snowflake
							var that = getV('this')
							thisArg = that.val
							thisStr = that.str
						} else {
							thisArg = o.obj
							thisStr = o.objStr
						}
						func = o.val
						str = o.str
					} else if (node.callee.type === "Super") {
						// super is very special
						// this is also kinda hacky
						// relies on returning this at the end of constructor
						var newThis = new context.superClass(...args)
						newThis.__proto__ = getVar('this').__proto__
						var ret = getBaseRet()
						ret.ret = setVar('this', newThis)
						return ret
					} else {
						var f = yield node.callee
						func = f.ret
						str = f.str
					}

					if (typeof func !== 'function') {
						console.log("var is not function", func, node)
						throw new simplifyError("not a function")
					} else if (func === console.log) {
						// to seperate logs from code
						args.unshift("from program")
						// console is a global side effect
						closuresMod.add(global)
					} else if (func === process.exit) {
						console.log("exiting program")
					}

					//pass some data into the function, expect it to be consumed immediately and removed
					if (func === Function.prototype.call) {
						func = thisArg
						thisArg = args[0]
						thisStr = argStrs[0]
						args = args.slice(1)
						if (!Array.isArray(args)) {
							console.log('anskdfljasndfljn', args)
						}
						argStrs = argStrs.slice(1)
					} else if (func === Function.prototype.apply) {
						func = thisArg
						thisArg = args[0]
						thisStr = argStrs[0]
						args = args[1] || []
						argStrs = getUnderStringObj(args[1] || [])
						if (!Array.isArray(args)) {
							// array-like, ex arguments
							args = Array.from(args)
							setUnderString(args, argStrs)
						}
					} else if (func === Function.prototype.bind) {
						func = function(...args) {
							var f = this
							var argStrs = func.argStrs
							var thisArg = args[0]
							var thisStr = argStrs[0]
							argStrs = argStrs.slice(1)
							var moreArgs = args.slice(1)
							var ret = function(...args) {
								f.thisStr = thisStr
								f.argStrs = argStrs.concat(ret.argStrs)
								return f.apply(thisArg, moreArgs.concat(args))
							}
							return ret
						}
						// technically can pass a primative for this, but no one does that
						// it is also casted into an object
						// to get this to work, likely need to write custom wrapper
						// need to handle extra args too
					}

					// polyfills can be undefined while initializing polyfills
					if (polyfills && polyfills.has(func)) {
						func = polyfills.get(func)
					}

					// this can't live in polyfill as addFunction is local
					if (func === Function) {
						// todo: make global scoped
						func = function(...args) {
							var funcStr = '!function(' + args.slice(0, args.length - 2).join(', ') + ') {' + args[args.length - 1] + '}'
							return addFunction(parse(funcStr).body[0].expression.argument)
						}
					}

					if (func.node) {
						var n = func.node
						node.funcId = n.nodeId
						node.callType = callType
					// 	called.add(n)
					// 	if (calledWith.has(n)) {
					// 		calledWith.get(n).push(args)
					// 	} else {
					// 		calledWith.set(n, [args])
					// 	}
					// } else {
					// 	// means not defined in js
					// 	// TODO might want to do some Proxy stuff to see if there are any side effects on arguments
					}
	
					var isNew = node.type === "NewExpression"
	
					var callStr
					// also filter things like ' '.substring and [].join
					if (!func.node && !isNew) {
						var strParts = [{
							str: str,
							val: func
						}, '(']
						if (argsInfo.length) {
							argsInfo.reduce((a, c) => (a.push(c, ','), a), strParts)
							// remove trailing comma
							strParts.pop()
						}
						strParts.push(')')
						callStr = composeIfExists(...strParts)
						if (recording && callStr) {
							var hasSide = !ignore.has(func)
							if (side.affectsFirst.has(func)) {
								hasSide = !!argStrs[0]
							}
							if (side.affectsThis.has(func)) {
								hasSide = !!thisStr
							}
							if (hasSide) {
								console.log(callStr, getFileLink(node))
								// console.log("global", node, str, args)
							}
	
						}
						// give some context for callbacks
						if (callStr) {
							args.forEach(a => typeof a === 'function' && (a.callStr = callStr))
						} else {
							args.forEach(a => typeof a === 'function' && (a.argsNotGlobal = true))
						}
					} else {
						args.forEach(a => typeof a === 'function' && (a.argsNotGlobal = true))
					}
					
					if (side.affectsFirst.has(func)) {
						callStr = argStrs[0]
					}

					if (overrides.has(func)) {
						func = overrides.get(func)
					}
	
					return callFunction(func, node, args, argStrs, thisArg, thisStr, isNew)
				}
				break

			case "ConditionalExpression":
			case "IfStatement":
				steps = function*() {
					var test = yield node.test
					if (test.ret) {
						node.true = node.true ? node.true + 1 : 1
						if (!node.consequent) {
							console.log("missing if consequent")
						}
						return (yield node.consequent)
					} else if (node.alternate) {
						return (yield node.alternate)
					}
					return ret
				}
				break

			case "SwitchStatement":
				steps = function*() {
					var d = (yield node.discriminant).ret
					var b = false
					var cont = false
					for (var c of node.cases) {
						// default has no test
						if (cont || !c.test || (yield c.test).ret === d) {
							cont = true
							for (var s of c.consequent) {
								var r = yield s
								var b = breaks(r, node.label)
								if (b.return || b.continue) return r
								if (b.break) {
									cont = false
									b = true
									break
								}
							}
							if (b) {
								break
							}
						}
					}
					return ret
				}
				break

			case "LabeledStatement":
				steps = function*() {
					if (node.label.type !== 'Identifier') {
						console.log('unexpected label type', node.label.type, node)
					}
					node.body.label = node.label.name
					yield node.body
					return ret
				}
				break
	
			case "BreakStatement":
				ret.break = node.label ? node.label.name : true
				return ret

			case "ContinueStatement":
				ret.continue = node.label ? node.label.name : true
				return ret

			case "AssignmentExpression":
				steps = function*() {
					var name = node.left.name
					changed[name] = true
					var right = yield node.right
					var rightVal = right.ret
					var rightStr = right.str
					if (node.left.type === "Identifier") {
						var val
						var str
						if (node.operator === "=") {
							val = rightVal
							str = rightStr
						} else if (node.operator === "+=") {
							var left = getV(name)
							val = left.val + rightVal
							str = composeIfExists(left, ' + ', + right)
						} else if (node.operator === "-=") {
							var left = getV(name)
							val = left.val - rightVal
							str = composeIfExists(left, ' - ', + right)
						} else {
							console.log("unexpected assignment operator")
						}

						ret.ret = setVar(name, val, node, str)
						ret.str = str
						return ret
					}
					// TODO refactor this
					var o = yield* getObjKey(node.left)
					var val
					var str
					if (node.operator === "=") {
						val = rightVal
						str = rightStr
					} else if (node.operator === "+=") {
						var left = getObjRet(o)
						val = left.val + rightVal
						str = composeIfExists(left, ' + ', + right)
					} else if (node.operator === "-=") {
						var left = getObjRet(o)
						val = left.val - rightVal
						str = composeIfExists(left, ' + ', + right)
					} else {
						console.log("unexpected assignment operator")
					}
					ret.ret = setProp(o.obj, o.key, val, node, o.varPath, str, o.objStr)
					ret.str = str
					if (o.str) {
						if (recording) {
							console.log("assigned", o.str + ' ' + node.operator + ' ' + toString(right))
						}
						setString(ret.ret, o.str)
					}
					return ret
				}
				break


			case "UpdateExpression":
				steps = function*() {
					var arg = node.argument
					var name = arg.name
					if (arg.type === "Identifier") {
						var val = getVar(name)
						ret.ret = val
						if (node.operator === "++") {
							val++
						} else if (node.operator === "--") {
							val--
						} else {
							console.log("unknown update operator", node)
						}
						var res = setVar(name, val, node)
						if (node.prefix) {
							ret.ret = res
						}
						return ret
					}
					// need to update in object
					var o = yield* getObj(node.argument)
					var obj = o.obj
					var key = o.key
					if (node.operator === "++") {
						ret.ret = (node.prefix ? ++obj[key] : obj[key]++)
					} else if (node.operator === "--") {
						ret.ret = (node.prefix ? --obj[key] : obj[key]--)
					} else {
						console.log("unknown update operator", node)
					}
					// todo update global
					return ret
				}
				break
			case "ForInStatement":
				steps = function*() {
					// assume only 1 var for for in
					// var varname = node.left.type === "Identifier" ? node.left.name : node.left.declarations[0].id.name
					if (node.left.type === 'VariableDeclaration') {
						var left = node.left.declarations[0].id
						var init = true
					} else {
						var left = node.left
						var init = false
					}
					var right = (yield node.right).ret
					for (var i in right) {
						yield* assign(left, i, init)
						// addVar(varname, i)
						var r = yield node.body
						var b = breaks(r)
						if (b.return) return r
						if (b.break) break
						if (b.continue) continue
					}
					return ret
				}
				break
			case "ForOfStatement":
				steps = function*() {
					// assume only 1 var for for of
					// var varname = node.left.type === "Identifier" ? node.left.name : node.left.declarations[0].id.name
					if (node.left.type === 'VariableDeclaration') {
						var left = node.left.declarations[0].id
						var init = true
					} else {
						var left = node.left
						var init = false
					}
					var right = (yield node.right).ret
					for (var i of right) {
						yield* assign(left, i, init)
						// addVar(varname, i)
						var r = yield node.body
						var b = breaks(r)
						if (b.return) return r
						if (b.break) break
						if (b.continue) continue
					}
					return ret
				}
				break

			case "ForStatement":
				steps = function*() {
					for (node.init ? (yield node.init) : "" ; node.test ? (yield node.test).ret : true ; node.update ? (yield node.update) : "") {
						var r = yield node.body
						var b = breaks(r)
						if (b.return) return r
						if (b.break) break
						if (b.continue) continue
					}
					return ret
				}
				break
			case "DoWhileStatement":
				steps = function*() {
					do {
						node.true = node.true ? node.true + 1 : 1
						var r = yield node.body
						var b = breaks(r)
						if (b.return) return r
						if (b.break) break
						if (b.continue) continue
					} while ((yield node.test).ret)
					return ret
				}
				break
			case "WhileStatement":
				steps = function*() {
					while ((yield node.test).ret) {
						node.true = node.true ? node.true + 1 : 1
						var r = yield node.body
						var b = breaks(r)
						if (b.return) return r
						if (b.break) break
						if (b.continue) continue
					}
					return ret
				}
				break

			case "ExpressionStatement":
				break

			case "LogicalExpression":
				steps = function*() {
					var left = yield node.left
					switch (node.operator) {
						case "||":
							return left.ret ? left : (yield node.right)
						case "&&":
							return left.ret ? (yield node.right) : left
						default:
							console.log('unexpected LogicalExpression')
					}
					return ret
				}
				break

			// TODO: seperate these
			case "BinaryExpression":
				after = (res) => {
					var right = res.right.ret
					var left = res.left.ret
					switch (node.operator) {
						case "===":
							ret.ret = left === right
							break
						case "!==":
							ret.ret = left !== right
							break
						case "==":
							ret.ret = left == right
							break
						case "!=":
							ret.ret = left != right
							break
						case "||":
							ret.ret = left || right
							break
						case "&&":
							ret.ret = left && right
							break
						case "|":
							ret.ret = left | right
							break
						case "&":
							ret.ret = left & right
							break
						case ">":
							ret.ret = left > right
							break
						case ">=":
							ret.ret = left >= right
							break
						case "<":
							ret.ret = left < right
							break
						case "<=":
							ret.ret = left <= right
							break
						case "+":
							ret.ret = left + right
							break
						case "-":
							ret.ret = left - right
							break
						case "*":
							ret.ret = left * right
							break
						case "/":
							ret.ret = left / right
							break
						case "%":
							ret.ret = left % right
							break
						case ">>>":
							ret.ret = left >>> right
							break
						case "in":
							ret.ret = left in right
							break
						case "instanceof":
							ret.ret = left instanceof right
							break
						default:
							console.log("unexpected binary", node.operator, filename)
					}
					ret.str = composeIfExists(res.left, ' ' + node.operator + ' ', res.right)
				}
				break
			case "BlockStatement":
				break
			case "MemberExpression":
				steps = function*() {
					var o = yield* getObj(node)
					ret.ret = o.obj[o.key]
					ret.var = o.varPath
					ret.str = o.str
					if (o.str) {
						setString(ret.ret, o.str)
					}
					return ret
				}
				break
			case "UnaryExpression":
				// typeof is special in that it can handle variables never defined
				if (node.operator === "typeof" && node.argument && node.argument.type === "Identifier" && !(node.argument.name in vars || node.argument.name in global)) {
					ret.ret = "undefined"
					return ret
				}
				after = (res) => {
					if (!node.prefix) console.log("unary not prefixed")
					arg = res.argument.ret
					if (node.operator === "!") {
						ret.ret = !arg
					} else if (node.operator === "+") {
						ret.ret = +arg
					} else if (node.operator === "-") {
						ret.ret = -arg
					} else if (node.operator === "~") {
						ret.ret = ~arg
					} else if (node.operator === "typeof") {
						ret.ret = typeof arg
					} else if (node.operator === "delete") {
						ret.ret = delete arg
					} else if (node.operator === "void") {
						ret.ret = void arg
					} else {
						console.log("unknown unary", node.operator)
					}
					if (res.argument.str) {
						ret.str = node.operator + (node.operator.length > 1 ? ' ' : '')  + res.argument.str
					}
				}
				break

			case "SpreadElement":
				after = (res) => {
					ret.spread = true
					ret.ret = res.argument.ret
					ret.str = res.argument.str
				}
				break

			case "Literal":
				ret.ret = node.value
				return ret

			case "Identifier":
				var v = getV(node.name)
				ret.ret = v.val
				ret.varPath = [node.name]
				ret.str = v.str
				return ret

			case "ReturnStatement":
				after = (res) => {
					ret.return = true
					ret.ret = (res.argument || {}).ret
					ret.str = (res.argument || {}).str
					// just so i know if something is returned from a defined function, its has some sort of closure
					// todo don't do this
					// way too hacky and doesn't work
					if (!hasClosure(ret.ret)) {
						addClosure(ret.ret, vars, 'jakdslaksdflasdfj')
					}
				}
				break

			case "YieldExpression":
				// todo str
				if (node.delegate) {
					var gen = (yield* walkGen(node.argument, context)).ret

					// not just doing yield* since that makes asyncGenerators and generators incompatible
					var s
					var next
					while (true) {
						next = gen.next(s)
						if (next instanceof Promise) {
							next = yield SimplifyPromise.resolve(next)
						}
						if (next.done) break
						s = yield next.value
					}
					ret.ret = next.value
					return ret
				} else {
					ret.ret = yield (yield* walkGen(node.argument, context)).ret
				}
				// force a switch in context, since it will be different from where it came
				// todo make things more functional and less global - specifically make getV and assign based on context
				vars = context.vars
				return ret
				
				
			case "AwaitExpression":
				// todo str
				// this gets resolved by the async runner
				ret.ret = yield SimplifyPromise.resolve((yield* walkGen(node.argument, context)).ret)
				// see comment from yieldStatement
				vars = context.vars
				return ret
				break
			case "VariableDeclaration":
				break
			case "Program":
				// should be global at this level
				addVar("this", this, undefined, 'window')
				if (opts.node) {
					// these are set in node for every module
					// exports, require, module, __filename, __dirname
					
					var file = opts.filename
					var package = opts.package
					var foldername = path.dirname(file)
					var exports = module.exports = addVar("exports", {})
					if (file) {
						file = path.resolve(file)
						// hacky
						module = require.cache[file] = {
							id: file,
							filename: file,
							exports: exports,
							parent: opts.parent,
							loaded: false,
							children: [],
							paths: [file],
							[requireRead]: true,
						}
						// gonna assume this is defined with filename for now
						var moduleFolder = path.join(opts.package, "node_modules")

						// these should error if file is not given
						addVar("__filename", file)
						addVar("__dirname", foldername)
						var fakeRequire = function(...args) {
							if (args.length !== 1) {
								console.log("incorrect number of args for require", args)
							}
							var name = args[0]
							// console.log(name)
							var paths = [moduleFolder, "./"]

							// for some reason with this added, 'umask' gets local file, not node_modules version
							if (name.startsWith(".") || name.startsWith('node_modules')) {
								paths.unshift(getVar("__dirname"))
							}
							var file = require.resolve(name, {paths: paths})

							// do this to not record any functions used on startup
							var oldRecording = recording
							recording = false
							try {
								// name === file is for default node modules like http
								if (name !== file && !require.cache[file] && path.extname(file) === '.js') {
									if (fakeRequireFilter(name, file)) {
										var todo = fs.readFileSync(file)
										opts.filename = file
										opts.parent = module
										simplify(todo, opts)
									} else {
										console.error(name, file, 'require file as node runner')
									}
								}
								var ret = getBaseRet()
								ret.ret = require(file)
								if (!require.cache[file] || !require.cache[file][requireRead]) {
									addClosure(ret.ret, global, 'treiotuneroitnia')
									setString(ret.ret, 'require("' + name + '")')
									ret.str = 'require("' + name + '")'
								}
								fakeRequire.ret = ret
								return ret.ret
							} catch (e) {
								console.log("cannot require", ...args, e)
								process.exit(1)
							} finally {
								recording = oldRecording
							}
						}
						fakeRequire.resolve = function(request, options) {
							if (!options) {
								options = {paths: [foldername]}
							} else {
								options.path.unshift(foldername)
							}
							return require.resolve(request, options)
						}
						addVar("require", fakeRequire)
					} else {
						module = {exports: exports}
					}
					addVar("module", module)
					// might have to do some path stuff
				}
				break
			case "ObjectExpression":
				steps = function*() {
					ret.ret = {}
					var strings = {}
					for (var prop of node.properties) {
						var key = yield* getKey(prop)
						var val = yield prop.value
						ret.ret[key] = val.ret
						strings[key] = val.str
					}
					setUnderString(ret.ret, strings)
					return ret
				}
				break
			case "ArrayExpression":
				after = (res) => {
					ret.ret = res.elements.map(e => e && e.ret)
					setUnderString(ret.ret, res.elements.map(e => e && e.str))
				}
				break

			case "ThisExpression":
				var v = getV('this')
				ret.ret = v.val
				ret.str = v.str
				varPath = ["this"]
				return ret

			case "Super":
				ret.ret = context.superClass.prototype
				return ret

			case "ThrowStatement":
				steps = function*() {
					throw (yield node.argument).ret
				}
				break
			case "TryStatement":
				steps = function*() {
					try {
						var r = yield* walkGen(node.block, context)
						if (breakOut(r)) return r
					} catch (e) {
						if (node.handler) {
							addVar(node.handler.param.name, e)
							var r = yield node.handler.body
							if (breakOut(r)) return r
						}
					} finally {
						if (node.finalizer) {
							var r = yield node.finalizer
							if (breakOut(r)) return r
						}
					}
					return ret
				}
				break

			case "TaggedTemplateExpression":
				steps = function*() {
					if (node.quasi.type !== "TemplateLiteral") console.log("unexpected quasi type")
					if (node.tag.type !== "Identifier") console.log("tag not Identifier not handled")
					var quasis = node.quasi.quasis.map(q => q.value.cooked)
					var expressions = []
					for (var ex of node.quasi.expressions) {
						expressions.push((yield ex).ret)
					}
					ret.ret = (yield node.tag).ret(quasis, ...expressions)
					return ret
				}
				break
			case "TemplateLiteral":
				steps = function*() {
					var quasis = node.quasis.map(q => q.value.cooked)
					var expressions = []
					for (var e of node.expressions) {
						expressions.push((yield e).ret)
					}
					ret.ret = quasis[0]
					// maybe check that expressions.length = quasis.length - 1
					for (var i = 0 ; i < expressions.length ; i++) {
						ret.ret += expressions[i] + quasis[i+1]
					}
					return ret
				}
				break
			case "ClassDeclaration":
			case "ClassExpression":
				steps = function*() {
					var superClass = node.superClass && (yield node.superClass).ret
					var constructorF
					// todo: not like this, makes it hard to track
					if (superClass) {
						constructorF = parse('class placeholder extends Object { constructor(...args) { super(...args) } }').body[0].body.body[0].value
					} else {
						constructorF = parse('function placeholder() {}').body[0]
					}
					var proto = {}
					var props = {}
					for (var method of node.body.body) {
						if (method.kind === 'constructor') {
							constructor = constructorF = method.value
						} else if (method.kind === 'method') {
							var key = yield* getKey(method)
							proto[key] = addFunction(method.value, superClass)
						} else if (['get', 'set'].includes(method.kind)) {
							var key = yield* getKey(method)
							if (!props[key]) props[key] = {}
							props[key][method.kind] = addFunction(method.value, superClass)
						} else {
							// getters and setters
							console.log('unsupported method type', method.kind, method)
						}
						if (method.static) {
							console.log('unsupported method properties', method)
						}
					}
					var constructor = addFunction(constructorF, superClass, true)
					if (superClass) {
						constructor.prototype = Object.create(superClass.prototype)
					}
					Object.assign(constructor.prototype, proto)
					Object.defineProperties(constructor.prototype, props)
					if (node.id) {
						addVar(node.id.name, constructor, node, node.id.name)
					}
					ret.ret = constructor
					return ret
				}
				break
			
			case "SequenceExpression":
				steps = function*() {
					for (var ex of node.expressions) {
						ret = yield ex
					}
					return ret
				}
				break

			// these are comments
			case "Line":
				break
			case "Block":
				break

			case "EmptyStatement":
				break

			default:
				console.log("unexpected node type", node, filename)
				process.exit()
				break
		}
		if (!steps) {
			steps = function *() {
				var res = {}
				for (var key in node) {
					var val = node[key]
					if (Array.isArray(val)) {
						res[key] = [];
						for (var i = 0 ; i < val.length ; i++) {
							var c = val[i]
							if (!c) continue
							var r = yield c
							if (breakOut(r)) {
								return r
							}
							res[key][i] = r
						}
					} else if (val && typeof val.type === "string") {
						var r = res[key] = yield val
						if (breakOut(r)) return r
					}
				}
				if (after) after(res)
				return ret
			}
		}
		var gen = steps()
		var child = gen.next()
		while (!child.done) {
			child = gen.next(yield* walkGen(child.value, context))
		}
		return child.value
	}
	function addSide(node) {
		var ret = []
		if (node.side) {
			ret.push(node)
			return ret
		}
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					if (!c) continue
					ret.push(...addSide(c))
				}
			} else if (val && typeof val.type === "string") {
				ret.push(...addSide(val))
			}
		}
		return ret
	}
	function replaceCall(node) {
		var funcNode = nodes[node.funcId]
		var rep = replaceReturn(funcNode)
		console.log(rep)
		if (rep.usable) {
			var retVar = rep.ret
			var body = funcNode.body.body
			var old = JSON.parse(JSON.stringify(node))
			// if (retVar) {
			// 	Object.assign(node, retVar, {fake: true})
			// } else {
			// 	Object.assign(node, {
			// 		type: "Literal",
			// 		value: undefined,
			// 		raw: "undefined",
			// 		fake: true
			// 	})
			// }

			var decs = []
			var args = []
			if (node.callType === "normal") {
				args = node.arguments
			} else if (node.callType === "call") {
				// todo this
				args = node.arguments.slice(1)
			} else {
				console.log("unsupported", node.callType, node)
				return
			}
			var params = funcNode.params
			for (var i = 0 ; i < params.length ; i++) {
				// TODO handle different types
				var d = {
					type: "VariableDeclarator",
					id: params[i],
					init: args[i],
					used: params[i].used,
					fake: true
				}
				decs.push(d)
			}
			if (rep.argsUsed) {
				decs.push({
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: "arguments",
						fake: true
					},
					init: {
						type: "ArrayExpression",
						elements: args,
						fake: true
					},
					used: rep.argsUsed,
					fake: true
				})
			}
			if (decs.length) {
				var dec = {
					type: "VariableDeclaration",
					kind: "var",
					declarations: decs,
					// generated by me
					fake: true
				}
				body.unshift(dec)							
			}
			var r = {
				type: "BlockStatement",
				body: body,
				old: old,
				fake: true
			}
			if (node.visits === funcNode.calls) {
				// redundant for now, but might change check above
				called.delete(funcNode)
				unused(r)
			}
			return {retVar: retVar, body: r}
		}
	}
	function replaceReturn(node) {
		if (replaceCache.has(node)) {
			return replaceCache.get(node)
		}
		var ret = {
			ret: undefined,
			argsUsed: node.argsUsed.used,
			thisUsed: node.thisUsed.used,
			singleRet: true,
			recursive: false,
			usable: true
		}
		walkReplace(node, node)
		ret.usable = ret.singleRet && !ret.recursive
		replaceCache.set(node, ret)
		return ret
		function walkReplace(node, orig) {
			if (typeof node === "function") {
				// console.log("arrived at function in recursion")
				return
			}
			// console.log(orig, node)
			if (node.type === "CallExpression") {
				if (node.func === orig) {
					// there is recursion on self
					// doesn't actually handle all cases
					console.log("some recursion", orig.id || orig.id.name)
					ret.recursive = true
					return true
				}
				// don't go into func call
				// return
			}
			for (var key in node) {
				var val = node[key]
				if (Array.isArray(val)) {
					for (var i = 0 ; i < val.length ; i++) {
						var c = val[i]
						if (!c) continue
						// assuming return statement isn't in a stupid place
						if (c.type === "ReturnStatement") {
							if (!c.visits) {
								// return not used
								return
							}
							if (c.visits !== orig.calls) {
								// this function isn't easily replacable
								console.log("not the same", orig.calls, c.visits)
								ret.singleRet = false
								return true
							}
							// assume all returns happen in the same place
							// remove all nodes after it
							val.splice(i, val.length)
							ret.ret = c.argument
							return true
						}
						var a = walkReplace(c, orig)
						if (a) {
							val.splice(i + 1, val.length)
							return a
						}
					}
				} else if (val && typeof val.type === "string") {
					// TODO check return statement here
					var a = walkReplace(val, orig)
					if (a) {
						return a
					}
				}
			}
		}
	}
	function checkUnuse(node) {
		var ret = {
			stop: false,
			remove: false
		}
		switch (node.type) {
			case "VariableDeclarator":
				ret.remove = !node.used && !node.side
				if (ret.remove && node.varUsed) {
					ret.remove = false
					node.init = null
				}
				break
			case "FunctionExpression":
			case "ArrowFunctionExpression":
			case "FunctionDeclaration":
				ret.remove = !node.calls
				break
			case "CallExpression":
				var funcNode = nodes[node.funcId]
				if (funcNode && node.visits === funcNode.calls) {
					node.replaceable = true
					if (opts.replace) {
						var res = replaceCall(node)
						if (res) {
							replace.push(res)
						}
						ret.stop = true
					}
				}
				break

			case "ConditionalExpression":
			case "IfStatement":
				// TODO always false with alternate
				ret.remove = !node.true && !(node.alternate && !node.alternate.remove)
				if (node.true === node.visits) {
					if (node.alternate) {
						node.alternate.remove = true
					}
				} else if (!node.true) {
					node.consequent.remove = true
				}
				break
			case "SwitchStatement":
				break
			case "BreakStatement":
				break
			case "AssignmentExpression":
				// TODO better handle around this
				var left = node.left
				if (left.type === "Identifier") {
					ret.remove = !node.used && !node.side
				}
				break
			case "UpdateExpression":
				// TODO better handle around this
				var arg = node.argument
				if (arg.type === "Identifier") {
					ret.remove = !node.used && !node.side
				}
				break
			case "ForInStatement":
				break
			case "ForStatement":
				break
			case "WhileStatement":
				ret.remove = !node.true
				break
			case "ExpressionStatement":
				// removing things can result in invalid trees
				if (!node.expression || node.expression.remove) {
					ret.remove = true
					break
				}
				if (node.expression.type === "CallExpression") {
					ret.remove = !node.expression.side
				}
				if (node.expression.type === "Literal") {
					ret.remove = true
				}
				break
			case "LogicalExpression":
				break
			case "BinaryExpression":
				break
			case "BlockStatement":
				break
			case "MemberExpression":
				break
			case "ObjectExpression":
				break
			case "UnaryExpression":
				break
			case "SpreadElement":
				break
			case "Literal":
				break
			case "Identifier":
				break
			case "ReturnStatement":
				ret.remove = !node.visits
				break
			case "VariableDeclaration":
				ret.remove = !node.declarations.reduce((a,b) => a+!(b.remove || 0), 0)
				break
			case "Program":
				break
			case "ArrayExpression":
				break
			case "ThrowStatement":
				ret.stop = true
				break
		}
		return ret
	}

	function checkOrRecurse(node) {
		var che = checkUnuse(node)
		if (che.remove) {
			if (addSide(node).length) {
				return false
			}
			return true
		}
		if (che.stop) {
			return false
		}
		unused(node)
		return checkUnuse(node).remove
	}

	function unused(node) {
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					if (!c) continue
					if (checkOrRecurse(c)) {
						c.remove = true
						// val.splice(i, 1)
						// i--
					}
					var injectable = node.type === "Program" || node.type === "BlockStatement"
					if (injectable && replace.length) {
						val.splice(i, 0, ...replace)
						console.log(replace)
						i += replace.length
						replace = []
					}
				}
			} else if (val && typeof val.type === "string") {
				if (checkOrRecurse(val)) {
					// node[key] = undefined
					val.remove = true
				}
			}
		}
	}
}

module.exports = simplify
