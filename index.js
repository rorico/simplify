var acorn = require("acorn")
var astring = require("astring")
var fs = require("fs")
var lognode = require("./lognode")

function simplify(code, fname, args) {
	var funcs = {}
	var vars = {}
	var changed = {}
	var closuresMod = new Set()
	var replace = []
	var ast = acorn.parse(code)
	

	initHoisted(ast)
	walk(ast)
	console.log("parsed through file")

	var func = getVar(fname)
	if (!func || !isFunction(func)) {
		console.log("no fname " + fname)
		return 0
	}
	console.log("start of func")
	var ret = call(fname, args)
	// return
	fs.writeFileSync("ast.json", JSON.stringify(ast, null, 4))
	unused(ast)
	// console.log(astring.generate(func))
	console.log("return value", ret)

	function check(node) {
		return walk(node, (n) => {
			return changed[n.name]
		})
	}

	function call(name, args) {
		var f = getVar(name)
		return f(...args)
	}

	function isFunction(node) {
		return node instanceof Function
		return (node.type === "FunctionDeclaration") || (node.type === "ArrowFunctionExpression")
	}

	function addFunction(node) {
		node.calls = node.calls || 0
		// need a seperate closure for each call
		var closure = vars
		var func = function() {
			var params = node.params
			var oldVars = vars
			// TODO handle updating global variables
			vars = {}
			vars.__proto__ = closure
			for (var i = 0 ; i < params.length ; i++) {
				addVar(params[i].name, arguments[i], node.params[i])
			}
			addVar("arguments", arguments)

			node.calls++
			initHoisted(node.body)
			var ret = walk(node.body)
			// this can happen if a higher function modifies this one
			// remove just in case
			closuresMod.delete(vars)
			vars = oldVars
			return ret.ret

		}
		// for access to node from function
		func.node = node
		if (node.id) {
			addVar(node.id.name, func, node)
		}
		return func
	}

	function initHoisted(node) {
		if (node.type === "FunctionDeclaration") {
			addFunction(node)
			return
		} else if (node.type === "VariableDeclarator") {
			addVar(node.id.name, undefined)
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
		vars[name] = {
			uses: 0,
			val: val,
			node: node,
			init: node
		}
		return val
	}
	function getVar(name) {
		if (vars[name] === undefined) {
			// do something about this
			return global[name]
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
		var obj
		var key
		if (node.type === "Identifier") {
			obj = vars
			key = node.name
			// update in higher closure if thats where it comes from
			while (obj.__proto__ && !obj.hasOwnProperty(key)) {
				obj = obj.__proto__
			}
			obj = obj[key]
			key = "val"
		} else if (node.type === "MemberExpression") {
			if (!node.object || !node.property)
				console.log("missing member object or project")
			obj = walk(node.object).ret
			key = node.computed ? walk(node.property).ret : node.property.name
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
		var ret = {
			ret: undefined,
			delete: false,
			return: false,
			break: false,
			spread: false,
			var: null
		}
		var after
		if (!node) {
			console.log("unexpected null node")
			return ret
		}
		if (lognode[node.type])
			console.log(node.type, node)

		if (node.delete === undefined) node.delete = 0
		if (node.visits === undefined) node.visits = 0
		node.visits++
		// todo hoisted and functions
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

					var currClos = closuresMod
					closuresMod = new Set()

					if (node.callee.type === "Identifier") {
						var name = node.callee.name
						var func = getVar(name)
						if (func) {
							if (!isFunction(func)) {
								console.log("var is not function", node)
								throw "4"
							}
							node.func = func
							ret.ret = func(...args)
						} else {
							console.log("undefined function", node)
						}
					} else if (node.callee.type === "MemberExpression") {
						// do it this way to maintain thisArg
						var o = getObj(node.callee)
						var obj = o.obj
						var key = o.key
						if (obj[key] === console.log) {
							// to seperate logs from code
							ret.ret = obj[key]("from program", ...args)
							// console is a global side effect
							closuresMod.add(global)
						} else {
							ret.ret = obj[key](...args)
						}
					} else if (node.callee.type === "FunctionExpression") {
						res.callee.ret(...args)
					} else {
						console.log("unexpected callee type")
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
							if (contained) {
							} else {
								currClos.add(c)
							}
						}
					}
					closuresMod = currClos
				}
				break

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
							if (r.return) return r
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
				ret.break = true
				break

			case "AssignmentExpression":
				changed[node.left.name] = true
				// todo handle += and -=
				var right = walk(node.right).ret
				if (node.left.type === "Identifier") {
					obj = vars
					key = node.left.name
					// update in higher closure if thats where it comes from
					while (obj.__proto__ && !obj.hasOwnProperty(key)) {
						obj = obj.__proto__
					}

					closuresMod.add(obj)
					// ret.ret = addVar(node.left.name, right, node.left)
					var v = vars[node.left.name]
					ret.ret = v.val = right
					v.node = node
					v.uses = 0
					return ret
				}
				var o = getObj(node.left)
				ret.ret = o.obj[o.key] = right
				return ret
				break


			case "UpdateExpression":
				// need to update in object
				var o = getObj(node.argument)
				var obj = o.obj
				var key = o.key
				var arg = node.argument
				if (arg.type === "Identifier") {
					obj = vars
					key = arg.name
					// update in higher closure if thats where it comes from
					while (obj.__proto__ && !obj.hasOwnProperty(key)) {
						obj = obj.__proto__
					}

					closuresMod.add(obj)
					// use this to show the variable was used
					getVar(arg.name)
					var v = vars[arg.name]
					if (node.operator === "++") {
						ret.ret = (node.prefix ? ++v.val : v.val++)
					} else if (node.operator === "--") {
						ret.ret = (node.prefix ? --v.val : v.val--)
					} else {
						console.log("unknown update operator", node)
					}
					v.node = node
					v.uses = 0
					return ret
				}
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
				var varname = node.left.declarations[0].id.name
				var right = walk(node.right).ret
				for (var i in right) {
					addVar(varname, i)
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
				}
				return ret
				break
			case "ForOfStatement":
				// assume only 1 var for for of
				var varname = node.left.declarations[0].id.name
				var right = walk(node.right).ret
				for (var i of right) {
					addVar(varname, i)
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
				}
				return ret

			case "ForStatement":
				for (walk(node.init) ; walk(node.test).ret ; walk(node.update)) {
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
				}
				return ret
				break
			case "WhileStatement":
				while (walk(node.test).ret) {
					var r = walk(node.body)
					if (r.return) return r
					if (r.break) break
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
				break
			case "MemberExpression":
				var o = getObj(node)
				ret.ret = o.obj[o.key]
				ret.var = o.var
				return ret
			case "ObjectExpression":
				ret.ret = {}
				for (var prop of node.properties) {
					ret.ret[prop.key.name] = walk(prop.value).ret
				}
				return ret
			case "UnaryExpression":
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
					ret.spread = true
					ret.ret = res.argument.ret
				}
				break

			case "Literal":
				ret.ret = node.value
				return ret

			case "Identifier":
				ret.ret = getVar(node.name)
				ret.var = node.name
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
				// these are set in node for every module
				// exports, require, module, __filename, __dirname
				var exports = addVar("exports", {})
				addVar("module", {exports: exports})
				// might have to do some path stuff
				addVar("require", require)
				addVar("__filename", __filename)
				addVar("__dirname", __dirname)
				break
			case "ArrayExpression":
				after = (res) => {
					ret.ret = res.elements.map(e => e.ret)
				}
				break

			case "ThrowStatement":
				console.log(walk(node.argument).ret)
				throw Error("thrown error from program " + walk(node.argument).ret)

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
		var ret
		if (node.type === "ReturnStatement") {
			// console.log("asdf", node.visits, num, node)
			if (node.visits !== num) {
				return false
			}
			var varname = "ret"
			var decs = [{
				type: "VariableDeclarator",
				id: {
					type: "Identifier",
					name: varname,
					fake: true
				},
				init: node.argument,
				fake: true
			}]
			var dec = {
				type: "VariableDeclaration",
				kind: "var",
				declarations: decs,
				// generated by me
				fake: true
			}
			Object.assign(node, dec)
			node.argument = undefined
			console.log("asdf", node.visits, num, node)
			return varname
			return node
			ret.push(node)
			return ret
		}
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
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
		return ret
	}
	function checkUnuse(node) {
		var ret = {
			stop: false,
			remove: false
		}
		switch (node.type) {
			case "VariableDeclarator":
				ret.remove = !node.used
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
						Object.assign(node, {
							type: "Identifier",
							name: retVar,
							fake: true
						})
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
				break
			case "IfStatement":
				// TODO always false with alternate
				ret.remove = !node.true && !node.alternate
				break
			case "SwitchStatement":
				break
			case "BreakStatement":
				break
			case "AssignmentExpression":
				ret.remove = !node.used && !node.side
				break
			case "UpdateExpression":
				ret.remove = !node.used && !node.side
				break
			case "ForInStatement":
				break
			case "ForStatement":
				break
			case "ExpressionStatement":
				// removing things can result in invalid trees
				if (!node.expression) {
					ret.remove = true
				}
				if (node.expression.type === "CallExpression") {
					ret.remove = !node.expression.side
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
				ret.stop = true
				break
			case "VariableDeclaration":
				ret.remove = !node.declarations.length
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
						val.splice(i, 1)
						i--
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
					node[key] = undefined
				}
			}
		}
	}
	if (true) console.log("test")
	if (false) console.log("test2")
	return astring.generate(ast)
}

module.exports = simplify
