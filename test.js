var arg = require("arg")
var fs = require("fs")

var simplify = require("./index")

var args = arg({
    '--file': String,
    '--func': String,
    '--args': String,
    '--ret': String,
 
    // Aliases
    '-f': '--file',
    '-a': '--args',
    '-r': '--ret'
});
if (!args["--file"]) {
	console.log("no file specified")
	process.exit(1)
}
var file = "test/" + args["--file"]
var func = args["--func"]
var fArgs = args["--args"]
var ret = args["--ret"]

var content = fs.readFileSync(file).toString()
var [code, par] = content.split("-----------------------------------")
var parts = par.split("\r\n")
var [no, tryF, tryA, tryR] = par.split("\r\n")
console.log(tryF, tryA, tryR, par, par.split("\r\n"))
if (!func) func = JSON.parse(tryF)
if (!fArgs) fArgs = JSON.parse(tryA)
if (!ret) ret = JSON.parse(tryR)


var out = simplify(code, {})
var func = out.call(func, fArgs)
function check(val) {
	if (!sameOut(val, ret)) {
		console.log("incorrect output", val, "!==", ret)
	} else {
		console.log("correct output", val)
	}
}
if (func instanceof Promise) {
	func.then(f => {
		f.ret.then(check)
	})
} else {
	check(func.ret)
}

function sameOut(v1, v2) {
	if (Array.isArray(v1)) {
		if (v1.length !== v2.length) return false
		for (var i = 0 ; i < v1.length ; i++) {
			if (!sameOut(v1[i], v2[i])) {
				return false
			}
		}
		return true
	} else {
		return v1 === v2
	}
}
