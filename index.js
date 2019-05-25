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
	for (var i = 0 ; i < params ; i++) {
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
			delete: false
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
					vars[node.id.name] = res.init.ret
					if (node.id.name === "funcs") 
					console.log("ska;ldfkm", vars.funcs, node.id.name, node, res)
				}
				break
			case "FunctionDeclaration":
				funcs[node.id.name] = node
				//console.log(node)
				// todo seperate function into different closures
				var params = node.params
				//console.log("asdnfkafsd", node)
				for (var i = 0 ; i < params.length ; i++) {
					vars[params[i].name] = {}
				}
				//break
				return ret
			case "IfStatement":
				// console.log("if test ", evalNode(node.test), node, node.test)
				if (!evalNode(node.test)) {
					node.delete++
					// ret.delete = true
					return ret
				}
				break
			case "AssignmentExpression":
			// console.log(node)
				changed[node.left.name] = true
				console.log("change", node)
				after = (res) => {
					vars[node.left.name] = res.ret
				}
				break
			case "CallExpression":
				after = (res) => {
					var args = res.arguments.map(a => a.ret)

					if (node.callee.type !== "Identifier") {
						ret.ret = res.callee.ret(...args)
					} else {
						var name = node.callee.name
						if (funcs[name]) {
							// todo
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
				console.log("ForInStatement", node)
				// assume only 1 var for for in
				var varname = node.left.declarations[0].id.name
				var right = walk(node.right).ret
				for (var i in right) {
					vars[varname] = i
					console.log("itersss ", varname, i, node.left.declarations, right)
					walk(node.body)
				}
				return ret
				break

			case "ExpressionStatement":
				console.log("ExpressionStatement", node.expression)
				break
			case "BinaryExpression":
				break
			case "BlockStatement":
				//console.log(node)
				break
			case "VariableDeclaration":
				break
			case "MemberExpression":
				after = (res) => {
					console.log(res,node, vars.funcs)
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
				ret.ret = JSON.parse(astring.generate(node))
				console.log("obj ", ret.ret)
				return ret
				break
			case "UnaryExpression":
				//console.log("unary ", node)
				after = (res) => {
					console.log(res, res.test, "lebensn")
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
				ret.ret = vars[node.name] || global[node.name]
				return ret
				break
			case "ReturnStatement":
				break

			case "VariableDeclaration":
				break
			case "ArrayExpression":
				break
			case "ForStatement":
				break
			case "UpdateExpression":
				console.log("UpdateExpression", node)
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
					if (r && r.delete) {
						val.splice(i, 1)
						i--
					}
					res[key][i] = r
				}
			} else if (val && typeof val.type === "string") {
				var r = res[key] = walk(val)
				if (r && r.delete) node[key] = undefined
			}
		}
		if (after) after(res)
		return ret
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



