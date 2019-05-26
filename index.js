var acorn = require("acorn")
var astring = require("astring")
var fs = require("fs")


function simplify(code, fname, args) {
	var funcs = {}
	var vars = {}
	var ast = acorn.parse(code)
	var body = ast.body
	for (var name in body) {
		var child = body[name]
		if (child.type === "FunctionDeclaration") {
			funcs[child.id.name] = child
			//console.log(child)
		}
	//console.log(child, body[child])
	}
	var func = funcs[fname]
	if (!funcs[fname]) {
		console.log("no fname " + fname)
		return 0
	}
	console.log(func)
	var params = func.params
	for (var i = 0 ; i < params.length ; i++) {
		vars[params[i].name] = args[i]
	}
	var changed = {}
	// funcs = {}
	walk(body)
	var body = func.body
	function check(node) {
		return walk(node, (n) => {
			return changed[n.name]
		})
	}

	function handleLoops(node) {

	}

	function walk(node) {
		var ret = {
			ret: undefined,
			delete: false,
			return: false
		}
		var after

		if (node.delete === undefined) node.delete = 0
		if (node.calls === undefined) node.calls = 0
		node.calls++
		// todo hoisted and functions
		switch (node.type) {
			case "VariableDeclarator":
				//vars[node.id.name] = evalNode(node.init) && check(node.init)
				after = (res) => {
					console.log(node)
					vars[node.id.name] = node.init ? res.init.ret : undefined
					if (node.id.name === "funcs") 
					console.log("ska;ldfkm", vars.funcs, node.id.name, node, res)
				}
				break
			case "FunctionDeclaration":
				funcs[node.id.name] = node
				funcs[node.id.name] = {
					node: node,
					vars: Object.assign(vars,{})
				}
				node.vars = vars
				vars[node.id.name] = node
				//console.log(node)
				// todo seperate function into different closures
				return ret
			case "IfStatement":
				console.log("IfStatement", node)
				// console.log("if test ", evalNode(node.test), node, node.test)
				var test = walk(node.test)
				console.log("if return", test)
				if (test.ret) {
					walk(node.consequent)
				} else {
					node.delete++
				}
				return ret
				// if (!evalNode(node.test)) {
				// 	node.delete++
				// 	// ret.delete = true
				// 	return ret
				// }
				break
			case "AssignmentExpression":
			// console.log(node)
				changed[node.left.name] = true
				console.log("change", node)
				// todo handle += and -=
				var right = walk(node.right).ret
				if (node.left.type === "Identifier") {
					vars[node.left.name] = right
				} else if (node.left.type === "MemberExpression") {
					var object = walk(node.left.object)
					var property = walk(node.left.property)
					console.log(res, node)
					if (node.left.computed) {
						ret.ret = object.ret[property.ret] = right
					} else {
						ret.ret = object.ret[node.left.property.name] = right
					}
				} else {
					console.log("unknown AssignmentExpression type", node)
				}
				return ret
				// after = (res) => {
				// 	if (node.left.type === "Identifier") {
				// 		vars[node.left.name] = res.right.ret
				// 	} else if (node.left.type === "MemberExpression") {
				// 		res.left.ret = res.right.ret
				// 	} else {
				// 		console.log("unknown AssignmentExpression type", node)
				// 	}
				// }
				break


			case "UpdateExpression":
				// need to update in object
				var obj
				var key
				if (node.argument.type === "Identifier") {
					obj = vars
					key = node.argument.name
				} else if (node.argument.type === "MemberExpression") {
					var object = walk(node.argument.object)
					var property = walk(node.argument.property)
					obj = object.ret
					if (node.argument.computed) {
						key = property.ret
					} else {
						key = node.argument.property.name
					}
				} else {
					console.log("unknown AssignmentExpression type", node)
					break
				}
				// todo handle prefix
				if (node.operator === "++") {
					ret.ret = obj[key]++
				} else if (node.operator === "--") {
					ret.ret = obj[key]--
				} else {
					console.log("unknown update operator", node)
				}

				console.log("UpdateExpression", node)
				break
			case "CallExpression":
				after = (res) => {
					var args = res.arguments.map(a => a.ret)
					console.log("CallExpression", node)
					if (node.callee.type !== "Identifier") {
						ret.ret = res.callee.ret(...args)
					} else {
						var name = node.callee.name
						if (funcs[name]) {
							var f = vars[name]
							var params = f.params
							var oldVars = vars
							vars = Object.assign(f.vars, {})
							if (name === "simplify") {
								return ret
							}
							for (var i = 0 ; i < params.length ; i++) {
								vars[params[i].name] = {}
							}
							ret.ret = walk(f.body)
							vars = oldVars
						} else if (name === "require") {
							ret.ret = require(...args)
						} else {
							// todo handle require special
							console.log("undefined function", node)
						}
					}
				}
				break
			case "ForInStatement":
				// console.log("ForInStatement", node)
				// assume only 1 var for for in
				var varname = node.left.declarations[0].id.name
				var right = walk(node.right).ret
				for (var i in right) {
					vars[varname] = i
					console.log("itersss ", varname, i, right[i], node.body)
					walk(node.body)
				}
				return ret
				break

			case "ForStatement":
				console.log("ForStatement", node)
				for (walk(node.init) ; walk(node.test).ret ; walk(node.update)) {
					console.log("asdnfjkasdf", vars.i)
					walk(node.body)
				}
				return ret
				break

			case "ExpressionStatement":
				console.log("ExpressionStatement", node.expression)
				break
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
					console.log(res,node,vars.i)
					if (node.computed) {
						ret.ret = res.object.ret[res.property.ret]
					} else {
						ret.ret = res.object.ret[node.property.name]
					}

					console.log("mems", node, ret)
				}
				break
			case "ObjectExpression":
				// console.log(node)
				// throw Error("asdf")
				// doesn't account for a number of things
				console.log("obj", node)
				ret.ret = {}
				for (var prop of node.properties) {
					ret.ret[prop.key.name] = walk(prop.value).ret
				}
				//ret.ret = JSON.parse(astring.generate(node))
				return ret
				break
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
					return ret
				}
				break


			case "Literal":
				ret.ret = node.value
				//console.log("lit ", node)
				return ret
				break
			case "Identifier":
				ret.ret = vars[node.name] === undefined ? global[node.name] : vars[node.name]
				return ret
				break
			case "ReturnStatement":
				after = (res) => {
					ret.return = true
					ret.ret = res.ret
				}
				break

			case "VariableDeclaration":
				break
			case "ArrayExpression":
				console.log("ArrayExpression", node)
				after = (res) => {
					ret.ret = res.elements.map(e => e.ret)
				}
				break

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
					if (r && r.return) {
						return r 
					}
					res[key][i] = r
				}
			} else if (val && typeof val.type === "string") {
				var r = res[key] = walk(val)
				if (r && r.return) return r
			}
		}
		if (after) after(res)
		return ret
	}
	function unused(node) {
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					if (c.delete && c.delete === c.calls) {
						val.splice(i, 1)
						i--
					} else {
						unused(c)
					}
				}
			} else if (val && typeof val.type === "string") {
				if (val.delete && val.delete === val.calls) {
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
	walk(body)
	unused(body)
	// console.log(vars)
	console.log()
	if (true) console.log("test")
	if (false) console.log("test2")
	//console.log(JSON.stringify(func, null, 4))
	return astring.generate(func)
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

var code = fs.readFileSync("index.js")
var fname = "simplify"
var args = [code, fname, []]
var test = simplify(code, fname, args)
console.log(test)



