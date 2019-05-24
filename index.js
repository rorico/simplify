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
	var vars = {}
	funcs = {}
	var body = func.body
	function walk(node) {
		// todo hoisted and functions
		if (node.type === "VariableDeclarator") {
			console.log(node)
			vars[node.id.name] = evalNode(node.init)
			console.log("var ", node.id.name)
		}

		if (node.type === "FunctionDeclaration") {
			funcs[node.id.name] = node
			return
			//console.log(node)
		}
		if (node.type === "ifStatement") {
			console.log("if	", node)
		}
		//console.log("node", node)
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var c of val) {
					walk(c)
				}
			} else if (val && typeof val.type === "string") {
				walk(val)
			}
		}

	}
	function evalNode(node) {
		if (!node) return undefined
		console.log("eval", node)
		return evalContext("(" + astring.generate(node) + ")", vars)
	}
	function evalContext(str, context) {
		console.log("djsksndn " + str)
		return function() { return eval(str) }.call(context)
	}
	walk(body)
	console.log(vars)
	console.log()
	for (var name in body) {
		var child = body[name]
		if (child.type === "VariableDeclaration") {
			vars[child.id.name] = child
			console.log("var ", child.id.name)
		}

		if (child.type === "FunctionDeclaration") {
			funcs[child.id.name] = child
			//console.log(child)
		}
		if (child.type === "ifCondition") {
			console.log("if	", child)
		}

	//console.log(child, body[child])
	}
	//console.log(JSON.stringify(func, null, 4))
	return astring.generate(func)
}
var code = fs.readFileSync("index.js")
var fname = "simplify"
var args = [code, fname, []]
var test = simplify(code, fname, args)
console.log(test)



