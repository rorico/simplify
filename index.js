var acorn = require("acorn")
var astring = require("astring")
var astravel = require("astravel")
var fs = require("fs")
var lognode = require("./lognode")
var ignoreGlobal = require("./ignoreGlobal")
var path = require("path")
var simplifyError = require("./simplifyError")
var modules = {}
var called = new Set()
var calledWith = new Map()
var funcDefined = new Set()
var allAsts = []
var recording = false
var nodes = []

function simplify(code, opts) {
	var vars = {}
	var changed = {}
	var closuresMod = new Set()
	var usedVars = new Set()
	var replace = []
	var findClosures = new Map()
	var replaceCache = new Map()
	var asString = new Map()
	var under = new Map()
	var loaded = false

	if (!opts) opts = {}
	var module = {}
	var req = {}
	var exposed = {}
	var acornOpts = {}
	if (opts.comments) {
		var comments = []
		acornOpts.onComment = comments
		acornOpts.locations = true
	}

	var ast = acorn.parse(code, acornOpts)
	allAsts.push(ast)

	if (opts.comments) {
		astravel.attachComments(ast, comments)
	}

	initHoisted(ast)
	walk(ast)
	console.log("parsed through file", opts.filename)

	if (opts.node && opts.filename) {
		req.loaded = loaded = true
		// require.cache[file].loaded = loaded = true
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

	function toString(obj) {
		// todo some limit on size
		// todo prototypes
		// do this to handle circular objects
		var handled = new Set()
		return rec(obj)
		function rec(obj) {
			if (handled.has(obj)) {
				return '[circular structure]'
			}
			handled.add(obj)
			var ret
			if (asString.has(obj)) {
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
				ret = '[' + obj.map(rec).join(', ') +']'
			} else if (obj && typeof obj === 'object') {
				ret = '{' + Object.keys(obj).map(k => {
					return k + ': ' + (Object.getOwnPropertyDescriptor(obj, k).get ? 'getter' : rec(obj[k]))
				}).join(', ') + '}'
			} else if (typeof obj === 'symbol') {
				ret = obj.toString()
			} else if (typeof obj === 'string') {
				ret = '"' + obj + '"'
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
		if (notPrimitive(obj)) {
			asString.set(obj, str)
		}
	}
	function hasString(obj) {
		return asString.has(obj)
	}
	function notPrimitive(obj) {
		return obj && (typeof obj === "object" || typeof obj === "function")
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
					if (window.testing) console.log(c)
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

	function addFunction(node) {
		node.calls = node.calls || 0
		// need a seperate closure for each call
		var closure = vars
		// don't want to make new required modules disappear
		if (loaded) funcDefined.add(node)
		var func = function() {
			if (node.generator || node.async) {
				console.log('unssuported call', node)
				process.exit()
			}

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
			var oldVars = vars
			// TODO handle updating global variables
			vars = {}
			vars.__proto__ = closure
			for (var i = 0 ; i < params.length ; i++) {
				var p = params[i]
				if (p.type === "Identifier") {
					addVar(p.name, arguments[i], p)
				} else if (p.type === "ObjectPattern") {
					// TODO this well
					for (var prop of p.properties) {
						if (prop.key.type !== "Identifier") console.log("ObjectPattern key not Identifier", prop)
						if (prop.value.type !== "Identifier") console.log("ObjectPattern value not Identifier", prop)
						addVar(prop.key.name, arguments[i][prop.value.type], prop)
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
			addVar("arguments", arguments, node.argsUsed)
			// may cause incorrect closure values
			addVar("this", this, node.thisUsed)

			initHoisted(node.body)
			try {
				var ret = walk(node.body)
				return ret.ret
			} catch (e) {
				throw e
			} finally {
				// do in finally in case try catches are part of code flow
				// this can happen if a higher function modifies this one
				// remove just in case
				closuresMod.delete(vars)
				vars = oldVars
			}
		}
		// for access to node from function
		func.node = node
		if (node.id) {
			addVar(node.id.name, func, node)
		}
		if (node.type === 'ArrowFunctionExpression') {
			func.arrowThis = getVar('this')
		}
		if (node.generator || node.async) {
			console.log('unsupported function properties', node, filename)
		}
		return func
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
					var res = initHoisted(c)
				}
			} else if (val && typeof val.type === "string") {
				var res = initHoisted(val)
			}
		}
	}
	function addVar(name, val, node) {
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
			init: node
		}
		// addClosure(val, closure)
		// todo fix
		// if (closure !== vars && node) {
		// 	node.side = true
		// }
		return val
	}
	function setVar(name, val, node) {
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
		v.node = node
		// todo fix
		// if (v.closure !== vars && node) {
		// 	node.side = true
		// }
		v.uses = 0
		return val
	}
	function setProp(obj, name, val, node, varPath) {
		if (obj[name]) {
			removeUnder(obj[name], obj)
		}
		obj[name] = val
		addUnder(val, obj)
		var mod = closuresAffected(obj)
		mod.forEach(c => closuresMod.add(c))

		if (mod.has(global)) {
			if (varPath[0]) {
				exposed[varPath.join(("."))] = val
			}
		}
		// todo fix
		// if (closure !== vars && node) {
		// 	node.side = true
		// }
		return val
	}

	function getVar(name) {
		if (vars[name] === undefined) {
			if (!(name in global)) {
				console.log(name, "not defined, should have errored")
			}
			var ret = global[name]
			// console.log('global var', name)
			if (name === 'document' || ret === document) {
				console.log('jnkfdjgkldsj'. name)
			}
			setString(ret, name)
			addClosure(ret, global, name)
			return ret
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
			return v.val
		}
	}
	function uncount(name) {
		var v = vars[name]
		v.uses--
		if (v.uses === 0 && v.node) {
			v.node.used--
		}
	}
	function getObj(node) {
		if (node.type !== "MemberExpression") console.log("getObj not MemberExpression")
		if (!node.object || !node.property)
			console.log("missing member object or property")

		var res = walk(node.object)
		var obj = res.ret
		var key = node.computed ? walk(node.property).ret : node.property.name

		var varPath = res.varPath
		// use concat to not alter original variable
		varPath = varPath.concat([key])

		addUnder(obj[key], obj)
		var str = hasString(obj[key]) ? toString(obj[key]) : ''
		if (hasString(obj) && !str) {
			str = toString(obj)
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
			varPath: varPath,
			str: str
		}
	}

	function breakOut(node) {
		return node && (node.return || node.break || node.continue)
	}

	function walk(node) {
		var ret = {
			ret: undefined,
			delete: false,
			return: false,
			break: false,
			continue: false,
			spread: false,
			varPath: []
		}
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
				after = (res) => {
					addVar(node.id.name, node.init ? res.init.ret : undefined, node)
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
				var args = node.arguments.reduce((a, arg) => {
					arg = walk(arg)
					if (arg.spread) {
						return a.concat(arg.ret)
					} else {
						a.push(arg.ret)
						return a
					}
				}, [])

				var thisArg = window
				var callType = "normal"
				var func
				var str
				if (node.callee.type === "MemberExpression") {
					// do it this way to maintain thisArg
					// can bind it, but that removes/changes some properties added
					// like name, node
					var o = getObj(node.callee)
					
					thisArg = obj = o.obj
					func = o.obj[o.key]

					// var specialCalls = ['call', 'apply']
					// if (typeof obj === "function" && specialCalls.includes(key)) {
					// 	func = obj
					// 	callType = key
					// }
					// todo something about bind
				} else {
					var knownTypes = ["Identifier", "FunctionExpression", "ArrowFunctionExpression", "CallExpression"]
					func = walk(node.callee).ret
					if (!knownTypes.includes(node.callee.type)) {
						// this probably works, but I don't know it / haven't tested
						console.log("unexpected callee type", node.callee.type, node)
						// process.exit(1)
					}
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

				if (func.arrowThis) {
					thisArg = func.arrowThis
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

				var currClos = closuresMod
				closuresMod = new Set()


				var isNew = node.type === "NewExpression"
				if (isNew) {
					ret.ret = new func(...args)
				} else {
					ret.ret = func.apply(thisArg, args)
				}
				// also filter things like ' '.substring and [].join
				if (!func.node && !(thisArg && !closuresAffected(thisArg).has(global)) && !isNew && func !== Object.defineProperty) {
					if (!str) {
						str = toString(func)
					}
					var argsStr = args.map(a => toString(a)).join(',')
					str += '(' + argsStr + ')'
					setString(ret.ret, str)
					if (recording) {
						if (!ignoreGlobal[str.split('.')[0]] && closuresAffected(func).has(global)) {
							if (!isNew) {
								console.log(str)
								console.log(node, closuresAffected(func))
							}
							// console.log("global", node, str, args)
						}

					}
				}
				// todo, not like this
				if (ret.ret) {
					if (!hasClosure(ret.ret)) {
						addClosure(ret.ret, global, 'dfnkldsfjgnsdklfjgn')
					}
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

			case "ConditionalExpression":
			case "IfStatement":
				var test = walk(node.test)
				if (test.ret) {
					node.true = node.true ? node.true + 1 : 1
					if (!node.consequent) {
						console.log("missing if consequent")
					}
					var r = walk(node.consequent)
					if (breakOut(r)) return r
					ret.ret = r.ret
				} else if (node.alternate) {
					var r = walk(node.alternate)
					if (breakOut(r)) return r
					ret.ret = r.ret
				}
				return ret

			case "SwitchStatement":
				var d = walk(node.discriminant).ret
				var b = false
				var cont = false
				for (var c of node.cases) {
					// default has no test
					if (cont || !c.test || walk(c.test).ret === d) {
						cont = true
						for (var s of c.consequent) {
							var r = walk(s)
							if (r.return || r.continue) return r
							if (r.break) {
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

			case "BreakStatement":
				// todo: handle labels
				if (node.label) console.log("labels not handled")
				ret.break = true
				break

			case "ContinueStatement":
				// todo: handle labels
				if (node.label) console.log("labels not handled")
				ret.continue = true
				break

			case "AssignmentExpression":
				var name = node.left.name
				changed[name] = true
				var right = walk(node.right).ret
				if (node.left.type === "Identifier") {
					var val
					if (node.operator === "=") {
						val = right
					} else if (node.operator === "+=") {
						val = getVar(name) + right
					} else if (node.operator === "-=") {
						val = getVar(name) - right
					} else {
						console.log("unexpected assignment operator")
					}

					ret.ret = setVar(name, val, node)
					return ret
				}
				// TODO refactor this
				var o = getObj(node.left)
				var val
				if (node.operator === "=") {
					val = right
				} else if (node.operator === "+=") {
					val = o.obj[o.key] + right
				} else if (node.operator === "-=") {
					val = o.obj[o.key] - right
				} else {
					console.log("unexpected assignment operator")
				}
				ret.ret = setProp(o.obj, o.key, val, node, o.varPath)
				if (o.str) {
					if (recording) {
						console.log("assigned", o.str + ' ' + node.operator + ' ' + toString(right))
					}
					setString(ret.ret, o.str)
				}
				return ret
				break


			case "UpdateExpression":
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
				var o = getObj(node.argument)
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
				break
			case "ForInStatement":
				// assume only 1 var for for in
				var varname = node.left.type === "Identifier" ? node.left.name : node.left.declarations[0].id.name
				var right = walk(node.right).ret
				for (var i in right) {
					addVar(varname, i)
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
					if (r.continue) continue
				}
				return ret
				break
			case "ForOfStatement":
				// assume only 1 var for for of
				var varname = node.left.type === "Identifier" ? node.left.name : node.left.declarations[0].id.name
				var right = walk(node.right).ret
				for (var i of right) {
					addVar(varname, i)
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
					if (r.continue) continue
				}
				return ret

			case "ForStatement":
				for (node.init ? walk(node.init) : "" ; node.test ? walk(node.test).ret : true ; node.update ? walk(node.update) : "") {
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
					if (r.continue) continue
				}
				return ret
				break
			case "WhileStatement":
				while (walk(node.test).ret) {
					node.true = node.true ? node.true + 1 : 1
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
					if (r.continue) continue
				}
				return ret
				break


			case "ExpressionStatement":
				break

			case "LogicalExpression":
				switch (node.operator) {
					case "||":
						ret.ret = walk(node.left).ret || walk(node.right).ret
						break
					case "&&":
						ret.ret = walk(node.left).ret && walk(node.right).ret
						break
				}
				return ret

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
						case "in":
							ret.ret = left in right
							break
						case "instanceof":
							ret.ret = left instanceof right
							break
						default:
							console.log("unexpected binary", node.operator)
					}
				}
				break
			case "BlockStatement":
				break
			case "MemberExpression":
				var o = getObj(node)
				ret.ret = o.obj[o.key]
				ret.var = o.varPath
				if (o.str) {
					setString(ret.ret, o.str)
				}
				return ret
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
					} else {
						console.log("unknown unary", node.operator)
					}
				}
				break

			case "SpreadElement":
				after = (res) => {
					ret.spread = true
					ret.ret = res.argument.ret
				}
				break

			case "Literal":
				ret.ret = node.value
				return ret

			case "Identifier":
				ret.ret = getVar(node.name)
				ret.varPath = [node.name]
				return ret

			case "ReturnStatement":
				after = (res) => {
					ret.return = true
					ret.ret = (res.argument || {}).ret
					// just so i know if something is returned from a defined function, its has some sort of closure
					// todo don't do this
					// way too hacky and doesn't work
					if (!hasClosure(ret.ret)) {
						addClosure(ret.ret, vars, 'jakdslaksdflasdfj')
					}
				}
				break

			case "VariableDeclaration":
				break
			case "Program":
				// should be global at this level
				addVar("this", this)
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
						req = require.cache[file] = {
							id: file,
							filename: file,
							exports: exports,
							parent: opts.parent,
							loaded: false,
							children: [],
							paths: [file]
						}
						module = {
							set exports(x) {
								req.exports = x
							},
							get exports() {
								return req.exports
							}
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
							var file = require.resolve(name, {paths: [moduleFolder, getVar("__dirname"), './']})

							// do this to not record any functions used on startup
							var oldRecording = recording
							recording = false
							try {
								if ((name.startsWith(".") || name.includes('/') || name.includes('\\')) && !require.cache[file]) {
									var todo = fs.readFileSync(file)
									opts.filename = file
									opts.parent = req
									simplify(todo, opts)
								}
								var ret = require(file)
								return ret
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
					// just to not break things
					document = {}
					window = {}
				}
				break
			case "ObjectExpression":
				ret.ret = {}
				for (var prop of node.properties) {
					// the other is literal
					var name = prop.key.type === "Identifier" ? prop.key.name : prop.key.value
					ret.ret[name] = walk(prop.value).ret
				}
				return ret
			case "ArrayExpression":
				after = (res) => {
					ret.ret = res.elements.map(e => e.ret)
				}
				break

			case "ThisExpression":
				ret.ret = getVar("this")
				varPath = ["this"]
				return ret

			case "ThrowStatement":
				// TODO make this message global
				// throw Error("thrown error from program " + walk(node.argument).ret)
				throw walk(node.argument).ret

			case "TryStatement":
				try {
					var r = walk(node.block)
					if (breakOut(r)) return r
				} catch (e) {
					if (node.handler) {
						addVar(node.handler.param.name, e)
						var r = walk(node.handler.body)
						if (breakOut(r)) return r
					}
				} finally {
					if (node.finalizer) {
						var r = walk(node.finalizer)
						if (breakOut(r)) return r
					}
				}
				return ret

			case "TaggedTemplateExpression":
				if (node.quasi.type !== "TemplateLiteral") console.log("unexpected quasi type")
				if (node.tag.type !== "Identifier") console.log("tag not Identifier not handled")
				var quasis = node.quasi.quasis.map(q => q.value.cooked)
				var expressions = node.quasi.expressions.map(e => walk(e).ret)
				ret.ret = walk(node.tag).ret(quasis, ...expressions)
				return ret
			case "TemplateLiteral":
				var quasis = node.quasis.map(q => q.value.cooked)
				var expressions = node.expressions.map(e => walk(e).ret)
				ret.ret = quasis[0]
				// maybe check that expressions.length = quasis.length - 1
				for (var i = 0 ; i < expressions.length ; i++) {
					ret.ret += expressions[i] + quasis[i+1]
				}
				return ret

			case "SequenceExpression":
				for (var ex of node.expressions) {
					ret = walk(ex)
				}
				return ret

			// these are comments
			case "Line":
				break
			case "Block":
				break

			case "EmptyStatement":
				break

			default:
				console.log("unexpected node type", node)
				break
		}
		var res = {}
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				res[key] = [];
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					var r = walk(c)
					if (breakOut(r)) {
						return r 
					}
					res[key][i] = r
				}
			} else if (val && typeof val.type === "string") {
				var r = res[key] = walk(val)
				if (breakOut(r)) return r
			}
		}
		if (after) after(res)
		return ret
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
