var a
var f
var removeNodes = false
// removeNodes = true
getItem().then((file) => {
	// var test = require('simplify')
	// // $('#left').html(file)
	// a = test(file, {node: false})

	// console.log(a)
	// // $('#left').html(Object.keys(a.funcs).join("\n"))
	// var func = a.call("$", ["#right"])
	// console.log(func.ret)
	// f = func
	// func = a.call(func.ret.css, ["left", "50"], func.ret)
	// console.log(func)
	// var ast = func.c
	// return
	// var parse = test.parse
	var astring = require("astring")
	// var walk = test.walk


	var base = astring.baseGenerator
	var variable = base.VariableDeclaration
	var gen = Object.assign({}, base)

	var nodes = []
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
			gen[type] = function(node, state) {
				// state.write('<div class="inline ' + type + '" style="color:#' + color + '" id="' + node.nodeId + '">')
				// console.log(node, state)
				state.write('<div class="inline ' + (node.remove ? "remove" : "") + '">')
				old(node, state)
				state.write('</div>')
			}

		}

	}

	function remove(node) {
		if (node.type === "IfStatement") {
			if (node.consequent.remove) {
				if (node.alternate.remove) {
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
	if (removeNodes) {
		remove(ast)
	}
	removeNested(ast)
	console.log(ast)
	var code = genAstring(ast)
	document.getElementById("left").innerHTML = code
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

	function genAstring(ast) {
		return astring.generate(ast, {generator: gen, comments: true})
	}
})

function getItem() {
	var key = 'jquery'
	// var url = 'https://raw.githubusercontent.com/substack/node-falafel/master/index.js'
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