var simplify = require("./index")
var fs = require("fs")

// var filename = "test/gFunc.js"
// var filename = "test/getter.js"
// var filename = "cli-latest.zip"
// var filename = "test/test.zip"
var filename = "node_modules/npm/lib/npm.js"

var code = fs.readFileSync(filename)
var test = simplify(code, {node: true, package: 'node_modules/npm', filename: filename, comments: true})
var exp = test.exposed['module.exports']

new Promise((resolve, reject) => {
	exp.load(resolve)
}).then(() => {
	console.log("loaded")
	return test.record(() => {
		return new Promise((resolve, reject) => {
			// exp.commands.install(['npm'], resolve)
			// exp.commands.ls([], resolve)
			// exp.commands.version([], resolve)
			exp.commands.ping([], resolve)
		})
	})
}).then(func => {
	fs.writeFileSync("front/ast.json", "//\nvar ast = " + JSON.stringify(func.c, null, 4))
	console.log("done")
})
