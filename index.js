var acorn = require("acorn")
var astring = require("astring")
var fs = require("fs")


function simplify(code, fname, args) {
	var funcs = {}
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
	var vars = {}
	var params = func.params
	for (var i = 0 ; i < params ; i++) {
		vars[params[i].name] = args[i]
	}
	var changed = {}
	funcs = {}
	var body = func.body
	function check(node) {
		return walk(node, (n) => {
			return changed[n.name]
		})
	}

	// function 

	function walk(node) {
		// todo hoisted and functions
		switch (node.type) {
			case "VariableDeclarator":
				vars[node.id.name] = evalNode(node.init) && check(node.init)
				break
			case "FunctionDeclaration":
				funcs[node.id.name] = node
				//console.log(node)
				// todo seperate function into different closures
				var params = node.params
				console.log("asdnfkafsd", node)
				for (var i = 0 ; i < params ; i++) {
					vars[params[i].name] = null
				}
				break
				return
			case "IfStatement":
				// console.log("if test ", evalNode(node.test), node, node.test)
				if (!evalNode(node.test)) {
					return true
				}
				break
			case "AssignmentExpression":
			// console.log(node)
				changed[node.left.name] = true
				break
			case "CallExpression":
				break
			case "ForInStatement":
				// console.log(node)
				return
				break

			case "ExpressionStatement":
				break
			case "BinaryExpression":
				break
			case "BlockStatement":
				console.log(node)
				break
			case "VariableDeclaration":
				break
			case "MemberExpression":
				break
			case "ObjectExpression":
				break
			case "UnaryExpression":
				break


			case "Literal":
				break
			case "Identifier":
				break
			case "ReturnStatement":
				break
			default:
				console.log("unexpected node type", node)
				break
		}
		// console.log("node", node)
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					var res = walk(c)
					if (res) {
						val.splice(i, 1)
						i--
					}
				}
			} else if (val && typeof val.type === "string") {
				var res = walk(val)
				if (res) node[key] = null
			}
		}
	}
	function evalNode(node) {
		if (!node) return undefined
		// console.log("eval", node)
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



