var a
var f
var n
var isNode = false
var logNum = false
var removeNodes = false
// isNode = true
// logNum = true
// removeNodes = true
getItem().then((file) => {
	if (!isNode) {
		var test = require('simplify')
		a = test(file, {node: false, comments: !1, replace: !1})

		console.log(a)
		// $('#left').html(Object.keys(a.exposed).join("\n"))
		var func = a.call("$", ["#right"])
		f = func

		func = a.record(() => {
			return func.ret.text("<>")
		})

		console.log(func)
		ast = func.c

	}

	var astring = require("astring")

	var base = astring.baseGenerator
	var variable = base.VariableDeclaration
	var gen = Object.assign({}, base)

	var nodes = n = []
	var moveables = []
	var clickables = []

	function old_overwrite(type, pre, suf, check) {
		var old = gen[type].bind(gen)
		gen[type] = (node, state) => {

			console.log(this,node, state)
			if (!check || check(node)) {
				state.write(pre)
				var ret = old(node, state)
				state.write(suf)
			} else {
				var ret = old(node, state)
			}
			return ret
		}
	}

	function overwrite(type, cls, style, check) {
		var old = gen[type].bind(gen)
		gen[type] = (node, state) => {
			if (node.nodeId === undefined) {
				node.nodeId = nodes.length
				nodes.push(node)
			}
			// console.log(this,node, state)
			if (!check || check(node)) {
				state.write(pre)
				var ret = old(node, state)
				state.write(suf)
			} else {
				var ret = old(node, state)
			}
			return ret
		}
	}

	for (var type in base) {
		if (typeof gen[type] !== 'function') continue
		over(type)
		function over(type) {
			var color = hashCode(type, 6)
			var old = gen[type].bind(gen)
			gen[type] = function(node, state, ...args) {
				if (node.nodeId === undefined) {
					node.nodeId = nodes.length
					nodes.push(node)
				}
				node.indentLevel = state.indentLevel
				var classes = ""
				if (node.remove) classes += " remove"
				if (node.fake && type !== "Program") classes += " fake"
				if (node.replaceable || node.replacement) classes += " replaceable"
				if (type === "formatComments") classes += " comment"

				if (node.overLvl) classes += " overLvl" + node.overLvl

				// don't escape
				state.write('<div class="inline' + classes + '" id="' + node.nodeId + '">', null, true)
				old(node, state, ...args)
				if (logNum) {
					if (type === "CallExpression" || type === "ReturnStatement") {
						state.write("/*" + (node.visits || 0) + "*/")
					}
					if (type === "FunctionExpression" || type === "ArrowFunctionExpression" || type === "FunctionDeclaration") {
						state.write("/*" + (node.calls || 0) + "*/")
					}
					if (type === "VariableDeclarator") {
						state.write("/*" + (node.used || 0) + "*/")
					}
					if (node.old) {
						state.write("//" + genAstring(node.old).replace(/\n/g,""), null, true)
					}
				}
				state.write('</div>', null, true)
			}

		}

	}

	function remove(node) {
		if (node.type === "IfStatement") {
			if (node.consequent.remove) {
				if (!node.alternate || node.alternate.remove) {
					// just here due to side effects
					Object.assign(node, node.test)
				} else {
					// node.test = node.test
					var test = {
						type: "UnaryExpression",
						operator: "!",
						prefix: true,
						argument: node.test,
						fake: true
					}
					node.test = test
					node.consequent = node.alternate
					node.alternate = null
					console.log(node)
				}
			}
		} else if (node.type === "ReturnStatement") {
			var arg = node.argument
			if (arg && arg.type === "Literal" && arg.value === undefined) {
				node.argument = null
			}
		}
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					if (c.remove) {
						val.splice(i, 1)
						i--
					} else {
						remove(c)
					}
				}
			} else if (val && typeof val.type === "string") {
				if (val.remove) {
					node[key] = undefined
				} else {
					remove(val)
				}
			}
		}
	}

	var parents = []
	function defineParent(node) {
		for (var key in node) {
			if (key === 'replacement') continue
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					parents[c.nodeId] = [node.nodeId, key, i]
					defineParent(c)
				}
			} else if (val && typeof val.type === "string") {
				parents[val.nodeId] = [node.nodeId, key]
				defineParent(val)
			}
		}
	}

	// for css, don't want nested removed
	function removeNested(node, removed) {
		if (removed) {
			node.remove = false
		}
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					removeNested(c, removed || node.remove)
				}
			} else if (val && typeof val.type === "string") {
				removeNested(val, removed || node.remove)
			}
		}
	}
	console.log(ast)
	redo()
	function redo() {
		if (removeNodes) {
			remove(ast)
		}
		var code = genAstring(ast)
		document.getElementById("left").innerHTML = code
		defineParent(ast)
	}

	var left = document.getElementById("left")
	left.onclick = (e) => {
		if (target === left) return
		var target = e.target
		console.log(e)
		while (target && !target.classList.contains("replaceable")) {
			console.log(target)
			target = target.parentElement
		}
		if (!target) return
		var node = nodes[target.id]
		var parentObj = parents[target.id]
		// console.log(parentObj, target ,target.id, parents)
		var parent = nodes[parentObj[0]]

		// var parent = $this.parent()
		// var parentNode = nodes[parent[0].id]

		// while (parentNode.type !== "BlockStatement") {
		// 	if (parentNode.type === "IfStatement") {
						
		// 	}
		// 	break
		// }
		// for (var i = 0 ; i < parentNode.length ; i++) {
		// 	if (parentNode) {

		// 	}
		// }

		// console.log(node, $this, $this.attr("id"), this.id)


		var replacement
		if (node.replacement) {
			replacement = node.replacement
		} else {
			var ret = a.replaceCall(node)
			replacement = ret.body
			replacement.body.push(ret.retVar)
			console.log(replacement, ret)
		}
		console.log(replacement)
		replacement.replacement = node
		if (parentObj.length === 3) {
			parent[parentObj[1]][parentObj[2]] = replacement
		} else if (parentObj.length === 2) {
			parent[parentObj[1]] = replacement
		} else {
			console.log('what')
		}
		redo()
	}
	document.onkeypress = (e) => {
		if (e.key === "g") logNum = !logNum
		// if (e.key === "r") removeNodes = !removeNodes
		redo()
	}
	// $(".replaceable").click(function(e) {
	// 	console.log(this, e)
	// 	var $this = $(this)
	// 	var node = nodes[this.id]
	// 	var parent = $this.parent()
	// 	var parentNode = nodes[parent[0].id]

	// 	while (parentNode.type !== "BlockStatement") {
	// 		if (parentNode.type === "IfStatement") {
						
	// 		}
	// 		break
	// 	}
	// 	for (var i = 0 ; i < parentNode.length ; i++) {
	// 		if (parentNode) {

	// 		}
	// 	}

	// 	console.log(node, $this, $this.attr("id"), this.id)
	// 	a.replaceCall(node)
	// 	// $this.html(genAstring(node, node.indentLevel))
	// var code = genAstring(ast)
	// document.getElementById("left").innerHTML = code
	// })
	// $('#left').html(code)
	return


	ast = parse(localStorage, 'falafel')
	var varsCnt = {}
	var vars = {}
	var types = {}
	var assigns = {}
	walk(ast, (node) => {
		if (node.nodeId === undefined) {
			node.nodeId = nodes.length
			nodes.push(node)
		}
		count(types, node.type)
		// console.log(node)
		// TODO: variable scoping
		if (node.type === 'VariableDeclarator') {
			var name = node.id.name
			count(varsCnt, name)
			vars[name] = node
		}
		// if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') {
		// 	node.params.forEach((n) => {
		// 		var name = n.name
		// 		count(varsCnt, name)
		// 		vars[name] = node
		// 	})
		// }
		if (node.type === 'AssignmentExpression') {
			// console.log(node)
			var name = node.left.name || node.left.object.name
			count(assigns, name)
		}
	})

	var closures = {}
	// for 

	// "FunctionExpression"
	// see whether its a true function

	var calledOnStart = {}

	var globals = {}
	function onStart(node) {
		var variables = {}
		var cb = (node) => {
			if (node.type === 'VariableDeclarator') {
				variables[node.id.name] = true
			}
			if (node.type === 'AssignmentExpression') {
				var name;
				if (node.left.type === 'Identifier') {
					name = node.left.name
				} else if (node.left.type === 'MemberExpression') {
					name = getObjName(node.left)
				} else {
					console.log('what', node)
					return
				}
				if (!variables[name]) variables[name] = false
			}
		}
		function rec(node) {
			if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') {
				return
			}
			cb(node)
			for (var key in node) {
				var val = node[key]
				if (Array.isArray(val)) {
					val.forEach((v) => {
						rec(v)
					})
				} else if (val && typeof val.type === 'string') {
					rec(val)
				}
			}
		}

		function getObjName(memberExp) {
			while (memberExp.type === 'MemberExpression') {
				memberExp = memberExp.object
			}
			return memberExp.name
		}
		rec(node)
		return variables
	}
	console.log(onStart(ast))


	// function walk(node, callback) {
	// 	callback(node)
	// 	for (var key in node) {
	// 		var val = node[key]
	// 		if (Array.isArray(val)) {
	// 			val.forEach((v) => {
	// 				walk(v, callback)
	// 			})
	// 		} else if (val && typeof val.type === 'string') {
	// 			walk(val, callback)
	// 		}
	// 	}
	// 	return node
	// }


	// for (var type in types) {
	// 	var color = hashCode(type, 6)
	// 	overwrite(type, '<div class="hover inline" style="color:#' + color + '">', '</div>')
	// }
	// overwrite('')
	// overwrite('Identifier', '<span class="hover removeable">', '</span>', (node) => {
	// 	if (assigns[node.name] || varsCnt[node.name] > 1) {
	// 		return false	
	// 	}
	// 	return true
	// })
	console.log(varsCnt, assigns, types)

	function count(dict, key) {
		if (dict[key]) {
			dict[key]++
		} else{
			dict[key] = 1
		}
	}

	console.log(ast)
	jsonView(ast)
	$('#left').html(genAstring(ast))
	$('.Identifier').addClass('hover').click(function() {
		var node = nodes[this.id]
		var name = node.name
		if (varsCnt[node.name] === 1 && !assigns[node.name]) {
			var dec = vars[node.name]
			$(this).replaceWith(genAstring(dec.init))
			console.log(dec)
		}
		// console.log(node, vars[node.name], vars)
	})
	$('.removeable').click(function() {

	})
	walk(ast, (node) => {
		if (node.nodeId) {
			node.htmlNode = $('#' + node.nodeId)[0]
		}
	})
	// $('pre').html(
	// 	file.split('\n').slice(0,100)
	// 	// .map(a => '<p>' + a + '</p>')
	// 	.join('\n')
	// )

	function genAstring(ast, indentLevel) {
		return astring.generate(ast, {generator: gen, comments: true, startingIndentLevel: indentLevel || 0})
	}
})

function getItem() {
	var key = 'npm'
	var url = 'https://raw.githubusercontent.com/npm/cli/latest/lib/npm.js'
	// var url = 'https://raw.githubusercontent.com/substack/node-falafel/master/index.js'
	var key = 'jquery'
	var url = 'https://code.jquery.com/jquery-3.4.1.js'
	if (!localStorage.getItem(key)) {
		return $.ajax(url).then((j) => {
			localStorage.setItem(key, j)
			return j
		})
	}
	return Promise.resolve(localStorage.getItem(key))
}

function loadDoc(c) {
	var xhttp = new XMLHttpRequest()
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			c(this.responseText)
		}
	}
	xhttp.open('GET', 'https://code.jquery.com/jquery-3.3.1.js', true)
	xhttp.send()
}


function jsonView(json) {
	$('#right').html(JSON.stringify(json, null, 4))
}

function hashCode(str, length) {
	var hash = 0, i, chr;
	if (str.length === 0) return hash;
	for (i = 0; i < str.length; i++) {
		chr = str.charCodeAt(i);
		hash= ((hash << 5) - hash) + chr;
		hash |= 0;
	}
	if (hash < 0) hash = -hash

	ret = hash.toString(16)
	if (ret.length < length) {
		ret = ret.padStart(length, '0')
	}
	if (ret.length > length) {
		ret = ret.substr(0, length)
	}
	return ret;
};