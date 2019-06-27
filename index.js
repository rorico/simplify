var acorn = require("acorn")
var astring = require("astring")
var astravel = require("astravel")
var fs = require("fs")
var lognode = require("./lognode")
var path = require("path")
var modules = {}
var called = new Set()
var calledWith = new Map()
var funcDefined = new Set()
var allAsts = []
var recording = false

function simplify(code, opts) {
	var vars = {}
	var changed = {}
	var closuresMod = new Set()
	var usedVars = new Set()
	var replace = []
	var findClosures = new Map()
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

	return {
		ast: ast,
		exposed: exposed,
		findClosures, findClosures,
		call: (fname, args, context) => {
			var func
			if (isFunction(fname)) {
				func = fname
			} else {
				func = getVar(fname)
				if (!func || !isFunction(func)) {
					console.log("no fname " + fname)
					return 0
				}
			}

			// reset(astring)
			for (var a of ast) {
				reset(a)
			}

			called = new Set()
			calledWith = new Map()
			usedVars = new Set()

			var ret
			if (context) {
				ret = func.call(context, ...args)
			} else {
				ret = func(...args)
			}
			// unused(ast)

			// var body = [func.node]
			var body = []
			for (var v of called.values()) {
				unused(v)
				body.unshift(v)
			}
			for (var v of usedVars.values()) {
				body.unshift(v)
			}
			// console.log(calledWith.entries())

			var c = {
				type: "Program",
				body: body,
				fake: true
			}

			// console.log(c)
			return {
				ret: ret,
				c: c,
				code: astring.generate(c),
				ast: ast,
				called, called
			}
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
				// unused(ast)

				// var body = [func.node]
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
				// console.log(calledWith.entries())

				var c = {
					type: "Program",
					body: body,
					fake: true
				}

				// console.log(c)
				return {
					ret: ret,
					c: c,
					code: astring.generate(c),
					ast: ast,
					called, called
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
			addVar("arguments", arguments)
			addVar("this", this)


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
		return func
	}
	function reset(node) {
		if (node.calls) node.calls = 0
		if (node.visits) node.visits = 0
		if (node.used) node.used = 0
		if (node.remove) node.remove = false

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
		var funcTypes = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]
		if (node.type === "FunctionDeclaration") {
			addFunction(node)
			return
		} else if (node.type === "VariableDeclarator") {
			addVar(node.id.name, undefined)
		} else if (funcTypes.includes(node.type)) {
			// don't hoist variables in nested functinos
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
		var closure
		closure = vars
		if (val !== null && typeof val === "object" && findClosures.has(val)) {
			closure = findClosures.get(val)
		}
		vars[name] = {
			uses: 0,
			val: val,
			closure: closure,
			node: node,
			init: node
		}
		findClosures.set(val, closure)
		if (closure !== vars && node) {
			node.side = true
		}
		return val
	}
	function setVar(name, val, node) {
		if (!(name in vars)) {
			global[name] = val
			exposed[name] = val
			findClosures.set(val, global)
		}

		var v = vars[name]
		v.val = val
		findClosures.set(val, v.closure)
		closuresMod.add(v.closure)
		v.node = node
		if (v.closure !== vars && node) {
			node.side = true
		}
		v.uses = 0
		return val
	}
	function setProp(obj, name, val, node, varPath) {
		obj[name] = val
		var closure = findClosures.get(obj)
		findClosures.set(val, closure)
		closuresMod.add(closure)
		if (closure === global) {
			if (varPath[0]) {
				exposed[varPath.join(("."))] = val
			}
		}
		if (closure !== vars && node) {
			node.side = true
		}
		return val
	}

	function getVar(name) {
		if (vars[name] === undefined) {
			if (!(name in global)) {
				console.log(name, "not defined, should have errored")
			}
			var ret = global[name]
			findClosures.set(ret, global)
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
			if (v.node && !vars.hasOwnProperty(name)) {
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

		// TODO This isn't perfect, obj[key] can belong to many objects
		if (findClosures.has(obj[key])) {
			findClosures.set(obj[key], findClosures.get(obj))
		}
		return {
			obj: obj,
			key: key,
			varPath: varPath
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
		node.visits++

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

				var obj
				var key
				var func
				if (node.callee.type === "MemberExpression") {
					// do it this way to maintain thisArg
					// can bind it, but that removes/changes some properties added
					// like name, node
					var o = getObj(node.callee)
					obj = o.obj
					key = o.key
					// don't use this as a function
					func = obj[key]
					if (obj[key] === console.log) {
						// to seperate logs from code
						args.unshift("from program")
						// console is a global side effect
						closuresMod.add(global)
					}
				} else {
					var knownTypes = ["Identifier", "FunctionExpression", "ArrowFunctionExpression", "CallExpression"]
					func = walk(node.callee).ret
					if (!knownTypes.includes(node.callee.type)) {
						// this probably works, but I don't know it / haven't tested
						console.log("unexpected callee type", node.callee.type, node)
						// process.exit(1)
					}
				}

				if (!func || !isFunction(func)) {
					console.log("var is not function", node, Object.keys(vars), vars.__proto__)
					throw "4"
				}

				if (func.node) {
					var n = func.node
					node.func = func
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
				if (node.callee.type === "MemberExpression") {
					if (isNew) {
						ret.ret = new obj[key](...args)
					} else {
						ret.ret = obj[key](...args)
					}
				} else {
					if (isNew) {
						ret.ret = new func(...args)
					} else {
						ret.ret = func(...args)
					}
				}

				// TODO clean up findClosures
				if (ret.ret && !findClosures.has(ret.ret)) {
					findClosures.set(ret.ret, findClosures.get(func))
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
				return ret
			case "ObjectExpression":
				ret.ret = {}
				for (var prop of node.properties) {
					// the other is literal
					var name = prop.key.type === "Identifier" ? prop.key.name : prop.key.value
					ret.ret[name] = walk(prop.value).ret
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
								if (name.startsWith(".") || name.includes('/') || name.includes('\\')) {
									if (require.cache[file]) {
										return require(file)
									}

									var todo = fs.readFileSync(file)
									opts.filename = file
									opts.parent = req
									var code = simplify(todo, opts)

									// this will be set by that context
									return code.exports
								} else {
									return require(file)
								}
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
	function replaceReturn(node, num) {
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					// assuming return statement isn't in a stupid place
					if (c.type === "ReturnStatement") {
						if (c.visits !== num) {
							return false
						}
						// assume all returns happen in the same place
						// remove all nodes after it
						val.splice(i, val.length)
						console.log("Asdf", c.argument)
						return c.argument
					}
					var a = replaceReturn(c, num)
					if (a) {
						return a
					}
				}
			} else if (val && typeof val.type === "string") {
				var a = replaceReturn(val, num)
				if (a) {
					return a
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
			console.log(node, !node.side, node.func && node.visits === node.func.node.calls)
				var func = node.func
				if (!node.side && func && node.visits === func.node.calls) {
					var retVar = replaceReturn(func.node, node.visits)
					if (retVar) {
						Object.assign(node, retVar)
						console.log("replace", replace.push, func.node.body)

						var decs = []
						var params = func.node.params
						for (var i = 0 ; i < params.length ; i++) {
							var d = {
								type: "VariableDeclarator",
								id: params[i],
								init: node.arguments[i],
								fake: true
							}
							decs.push(d)
						}
						var dec = {
							type: "VariableDeclaration",
							kind: "var",
							declarations: decs,
							// generated by me
							fake: true
						}

						replace.push(dec)
						replace.push(...node.func.node.body.body)
						// node.side
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
					ret.remove = node.expression.side
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
