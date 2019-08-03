var simplify = require("./index")
var fs = require("fs")
var code = fs.readFileSync("test/jquery.js")
var code = fs.readFileSync("test/gFunc.js")
var code = fs.readFileSync("test/getter.js")
var code = fs.readFileSync("cli-latest.zip")
// var code = fs.readFileSync("test/test.zip")
var code = fs.readFileSync("node_modules/npm/lib/npm.js")
// var fname = "simplify"
// var args = [fs.readFileSync("test2.js"), "f1", []]
// var test = simplify(code, {node: true, folder: true, startFile: 'cli-latest/lib/npm.js'})
// process.chdir("node_modules/npm/lib/")
var test = simplify(code, {node: true, package: 'node_modules/npm', filename: 'node_modules/npm/lib/npm.js'})
// var test = simplify(code, {node: true, folder: true, startFile: 'b.js'})
// var code = fs.readFileSync("node_modules/npm/lib/utils/unsupported.js")
// var test = simplify(code, {node: true})
// console.log("done")
// process.argv[0] = "npm"
// console.log(Object.keys(test.exports.commands))
// var func = test.call(test.exports.load, [() => {
// 	// var func = test.call(test.exports.commands.install, [['npm'], () => {
// 	// 	fs.writeFileSync("front/ast.json", "var ast = " + JSON.stringify(func.c, null, 4))
// 	// 	console.log("done")	
// 	// }], test.exports.commands)
// 	var func = test.call((...args) => test.exports.commands.install(...args), [['npm'], () => {
// 		fs.writeFileSync("front/ast.json", "//\nvar ast = " + JSON.stringify(func.c, null, 4))
// 		console.log("done")	
// 	}])
// }], test.exports)
// fs.writeFileSync("front/ast.json", JSON.stringify(func.c, null, 4))
// console.log(func.code)
// console.log(test)
// test.record(() => {
// 	return new Promise((resolve, reject) => {
// 		test.exports.load(resolve)
// 	})
// })
new Promise((resolve, reject) => {
	test.exports.load(resolve)
}).then(() => {
	console.log("loaded")
	return test.record(() => {
		return new Promise((resolve, reject) => {
			// test.exports.commands.install(['npm'], resolve)
			test.exports.commands.version([], resolve)
		})
	})
}).then(func => {
	fs.writeFileSync("front/ast.json", "//\nvar ast = " + JSON.stringify(func.c, null, 4))
	console.log("done")
})
