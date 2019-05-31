var acorn = require("acorn")
var astring = require("astring")
var fs = require("fs")


function simplify(code, fname, args) {
	var funcs = {}
	var vars = {}
	var changed = {}
	console.error(code, "aSAD")
	var ast = acorn.parse(code)
	fs.writeFileSync("ast.json", JSON.stringify(ast, null, 4))
	// var body = ast.body
	initHoisted(ast)
	walk(ast)

	console.log(vars)
	var func = vars[fname]
	if (!func || !isFunction(func)) {
		console.log("no fname " + fname)
		return 0
	}
	console.log("start of func")
	// return 1
	var ret = call(fname, args)
	// console.log(vars)
	// return
	// unused(func)
	// console.log(astring.generate(func))
	console.log("return value", ret)
	// funcs = {}
	// walk(body)
	// var body = func.body
	function check(node) {
		return walk(node, (n) => {
			return changed[n.name]
		})
	}

	function call(name, args) {
		var f = vars[name]
		return f(...args)
		var params = f.params
		var oldVars = vars
		vars = Object.assign({}, f.vars)
		if (name === "simplify") {
			// return ret
		}
		for (var i = 0 ; i < params.length ; i++) {
			vars[params[i].name] = args[i]
		}
		f.calls++
		initHoisted(f.body)
		var ret = walk(f.body)
		vars = oldVars
		return ret
	}

	function isFunction(node) {
		return node instanceof Function
		return (node.type === "FunctionDeclaration") || (node.type === "ArrowFunctionExpression")
	}

	function addFunction(node) {
		node.vars = vars
		node.calls = node.calls || 0
		console.log("adding", node.id && node.id.name, vars, vars.__proto__)
		var func = function() {
			var f = node
			var params = f.params
			var oldVars = vars
			// TODO handle updating global variables
			vars = {}
			vars.__proto__ = f.vars
			// console.log("asdf", vars, vars.__proto__, vars.__proto__.__proto__, node)
			// vars = Object.assign({}, f.vars)
			if (node.id && node.id.name === "walkC") {
				console.log("test", arguments, node.id, oldVars.simplify.node, oldVars.walkC.node, oldVars.simplify.names, oldVars.walkC.names)
				throw "2"
				// return
			}
			for (var i = 0 ; i < params.length ; i++) {
				// console.error("params", params[i].name, i, arguments[i])
				vars[params[i].name] = arguments[i]
			}
			vars.arguments = arguments

			console.log("starting vars", vars)
			f.calls++
			initHoisted(f.body)
			var ret = walk(f.body)
			vars = oldVars
			return ret.ret

		}
		if (node.id) {
			vars[node.id.name] = func
			func.names = node.id.name
			func.node = node
		}
		return func
		return node
	}

	function initHoisted(node) {
		if (node.type === "FunctionDeclaration") {
			addFunction(node)
			return
		} else if (node.type === "VariableDeclarator") {
			vars[node.id.name] = undefined
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

	function getObj(node) {
		var obj
		var key
		if (node.type === "Identifier") {
			obj = vars
			key = node.name
			// update in higher closure if thats where it comes from
			while (obj.__proto__ && !obj.hasOwnProperty(key)) {
				obj = obj.__proto__
			}
		} else if (node.type === "MemberExpression") {
			var object = walk(node.object)
			var property = walk(node.property)
			obj = object.ret
			if (node.computed) {
				key = property.ret
			} else {
				key = node.property.name
			}
		} else {
			console.log("unknown AssignmentExpression type", node)
		}
		return {
			obj: obj,
			key: key
		}
	}

	function breakOut(node) {
		return node && (node.return || node.break)
	}

	function walk(node) {
		if (node.name === "callback") throw "1"
		// console.error(node)
		var ret = {
			ret: undefined,
			delete: false,
			return: false,
			break: false,
			spread: false
		}
		var after

		if (node.delete === undefined) node.delete = 0
		if (node.visits === undefined) node.visits = 0
		node.visits++
		// todo hoisted and functions
		switch (node.type) {
			case "VariableDeclarator":
				//vars[node.id.name] = evalNode(node.init) && check(node.init)
				after = (res) => {
					vars[node.id.name] = node.init ? res.init.ret : undefined
					if (node.id.name === "f") console.log("fdsa", vars)
				}
				break

			// these are different, but mostly the same for now
			case "FunctionExpression":
			case "ArrowFunctionExpression":
			case "FunctionDeclaration":
				// funcs[node.id.name] = node
				// funcs[node.id.name] = {
				// 	node: node,
				// 	vars: Object.assign(vars,{})
				// }
				ret.ret = addFunction(node)
				//console.log(node)
				// todo seperate function into different closures
				return ret

			case "CallExpression":
				after = (res) => {
					var args = res.arguments.reduce((a, arg) => {
						if (arg.spread) {
							return a.concat(arg.ret)
						} else {
							a.push(arg.ret)
							return a
						}
					}, [])
					// console.error("Call", node,vars.res, vars.args, res.arguments, args)//args, res, node)
					// console.log(args)
					// console.log("CallExpression", node)
					if (node.callee.type === "Identifier") {
						var name = node.callee.name
						if (vars[name]) {
							if (!isFunction(vars[name])) {
								console.log("var is not function", node)
								throw "4"
							}
							// console.log("Self CallExpression", node, vars[name], args)
							ret.ret = vars[name](...args)
							//call(name, res.arguments.map(a => a.ret))
						} else if (name === "require") {
							// if (vars.vars) console.log("we in deep", vars.node, vars.args, vars.vars, vars.res)
							// else {
							// 	console.error("require", node, node.arguments, vars.res, vars.args, res.arguments, args)	 	
							// }
							ret.ret = require(...args)
						} else {
							// todo handle require special
							console.log("undefined function", node)
						}
					} else if (node.callee.type === "MemberExpression") {
						// do it this way to maintain thisArg
						var o = getObj(node.callee)
						var obj = o.obj
						var key = o.key
						if (node.callee.object.name === "vars" && node.callee.property.name === "name") {
				console.log("test2", arguments, node.id, obj, key, res, vars.simplify.names, vars.walkC.names)
							// throw "5"
						}
						if (obj[key] !== console.log) {
							// console.log("ahhh", node, res, ...args)
							// console.log(res,node)
				// console.log("test2", arguments, node.id, vars.simplify.node, vars.walkC.node, vars.simplify.names, vars.walkC.names)
							ret.ret = obj[key](...args)
						} else {
							ret.ret = obj[key]("from program", ...args)
						// throw "e"
						}
					} else {
						console.log("unexpected callee type")
					}
				}
				break

			case "ConditionalExpression":
			case "IfStatement":
				// console.log("if test ", evalNode(node.test), node, node.test)
				// console.log("IfStatement", node)
				var test = walk(node.test)
				if (test.ret) {
					var r = walk(node.consequent)
					if (breakOut(r)) return r
					ret.ret = r.ret
				} else if (node.alternate) {
					var r = walk(node.alternate)
					if (breakOut(r)) return r
					ret.ret = r.ret
				} else {
					node.delete++
				}
				return ret

			case "SwitchStatement":
				// console.log("SwitchStatement", node)
				var d = walk(node.discriminant).ret
				var b = false
				for (var c of node.cases) {
					// todo default
					if (walk(c.test).ret === d) {
						for (var s of c.consequent) {
							var r = walk(s)
							if (r.return) return r
							if (r.break) {
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
				ret.break = true
				break

			case "AssignmentExpression":
			// console.log(node)
				changed[node.left.name] = true
				//console.log("change", node)
				// todo handle += and -=
				var right = walk(node.right).ret
				var o = getObj(node.left)
				if (o.key === "f") console.log("fdsa", vars)
				ret.ret = o.obj[o.key] = right
				return ret
				break


			case "UpdateExpression":
				// need to update in object
				// console.log("UpdateExpression", node)
				var o = getObj(node.argument)
				var obj = o.obj
				var key = o.key
				// todo handle prefix
				if (node.prefix) console.log("not handled prefix")
				if (node.operator === "++") {
					ret.ret = obj[key]++
				} else if (node.operator === "--") {
					ret.ret = obj[key]--
				} else {
					console.log("unknown update operator", node)
				}
				return ret
				break
			case "ForInStatement":
				// console.log("ForInStatement", node)
				// assume only 1 var for for in
				var varname = node.left.declarations[0].id.name
				var right = walk(node.right).ret
				for (var i in right) {
					vars[varname] = i
					//console.log("itersss ", varname, i, right[i], node.body)
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
				}
				return ret
				break

			case "ForStatement":
				//console.log("ForStatement", node)
				for (walk(node.init) ; walk(node.test).ret ; walk(node.update)) {
					//console.log("asdnfjkasdf", vars.i)
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
				}
				return ret
				break

			case "ExpressionStatement":
				// console.log("ExpressionStatement", node.expression)
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
				// console.log("BinaryExpression", node)
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
						case "instanceof":
							ret.ret = left instanceof right
							break
						default:
							console.log("unexpected binary", node.operator)
					}
				}
				break
			case "BlockStatement":
				//console.log(node)
				break
			case "MemberExpression":
				after = (res) => {
					//console.log(res,node,vars.i, res.object.ret)
					var obj = res.object.ret
					var key = res.property.ret
					if (node.computed) {
						ret.ret = res.object.ret[res.property.ret]
						key = res.property.ret
					} else {
						ret.ret = res.object.ret[node.property.name]
						key = node.property.name
					}
					var o = getObj(node)
					ret.ret = o.obj[o.key]
					// if (obj[key] instanceof Function) {
					// 	ret.ret = obj[key].bind(obj)
					// }

					//console.log("mems", node, ret)
				}
				break
			case "ObjectExpression":
				ret.ret = {}
				for (var prop of node.properties) {
					ret.ret[prop.key.name] = walk(prop.value).ret
				}
				return ret
			case "UnaryExpression":
				//console.log("unary ", node)
				after = (res) => {
					res = res.argument
					if (node.operator === "!") {
						ret.ret = !res.ret
					} else if (node.operator === "+") {
						ret.ret = +res.ret
					} else if (node.operator === "-") {
						ret.ret = -res.ret
					} else if (node.operator === "typeof") {
						ret.ret = typeof res.ret
					} else {
						console.log("unknown unary", node.operator)
					}
				}
				break

			case "SpreadElement":
				after = (res) => {
					// console.log("SpreadElement", node, res,vars)
					ret.spread = true
					ret.ret = res.argument.ret
				}
				break

			case "Literal":
				ret.ret = node.value
				//console.log("lit ", node)
				return ret

			case "Identifier":
				ret.ret = vars[node.name] === undefined ? global[node.name] : vars[node.name]
				return ret

			case "ReturnStatement":
				after = (res) => {
					// console.log("ReturnStatement", node, res)
					ret.return = true
					ret.ret = (res.argument || {}).ret
				}
				break

			case "VariableDeclaration":
				break
			case "Program":
				// these are set in node for every module
				// exports, require, module, __filename, __dirname
				var exports = vars.exports = {}
				vars.module = {exports: exports}
				// might have to do some path stuff
				vars.require = require
				vars.__filename = __filename
				vars.__dirname = __dirname
				break
			case "ArrayExpression":
				//console.log("ArrayExpression", node)
				after = (res) => {
					ret.ret = res.elements.map(e => e.ret)
					// console.log("ArrayExpression", res, ret)
				}
				break

			case "ThrowStatement":
				console.log(walk(node.argument).ret)
				throw Error("thrown error from program " + walk(node.argument).ret)

			default:
				console.log("unexpected node type", node)
				break
		}
		// console.log("node", node)
		var res = {}
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				res[key] = [];
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					var r = walk(c)
					// i think r isn't used and deleted at same time
					if (breakOut(r)) {
						// console.log(r)
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
	function checkUnuse(node) {
		if (node.type === "IfStatement") {
			return (node.delete && node.delete === node.visits) || !node.visits // || (node.calls === 0)
		}
		// console.log(node)
		// return (node.delete && node.delete === node.visits)// || (node.calls === 0)
	}

	function unused(node) {
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					if (checkUnuse(c)) {
						val.splice(i, 1)
						i--
					} else {
						unused(c)
					}
				}
			} else if (val && typeof val.type === "string") {
				if (checkUnuse(val)) {
					node[key] = undefined
				} else {
					unused(val)
				}
			}
		}
	}
	function evalNode(node) {
		if (!node) return undefined
		// console.log("eval", node)
		console.log(vars)
		return evalContext("(" + astring.generate(node) + ")", vars)
	}
	function evalContext(str, context) {
		// console.log("djsksndn " + str)
		return function() { return eval(str) }.call(context)
	}
	// walk(body)
	// call()
	// unused(body)
	// console.log(vars)
	console.log()
	if (true) console.log("test")
	if (false) console.log("test2")
	//console.log(JSON.stringify(func, null, 4))
	// console.log(func)
	return astring.generate(func.node)
}

function walkC(node, callback) {
	if (callback(node)) return true
	for (var key in node) {
		var val = node[key]
		if (Array.isArray(val)) {
			for (var i = 0 ; i < val.length ; i++) {
				var c = val[i]
				var res = walkC(c, callback)
				// if (res) {
				// 	val.splice(i, 1)
				// 	i--
				// }
			}
		} else if (val && typeof val.type === "string") {
			var res = walkC(val, callback)
			// if (res) node[key] = null
		}
	}
}

// var code = fs.readFileSync("index.js")
// var fname = "simplify"
// var args = [code, fname, []]
// var test = simplify(code, fname, args)
module.exports = simplify
// var code = fs.readFileSync("index.js")
// var fname = "simplify"
// var args = [fs.readFileSync("test2.js"), "f1", []]
// var test = simplify(code, fname, args)
// console.log(test)
