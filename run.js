var simplify = require("./index")
var fs = require("fs")
var code = fs.readFileSync("index.js")
var fname = "simplify"
var args = [fs.readFileSync("test2.js"), "f1", []]
var test = simplify(code, fname, args)
// console.log(test)


// var simplify = require("./index")
// var fs = require("fs")
// var code = fs.readFileSync("index.js")
// var fname = "simplify"
// var test = simplify(fs.readFileSync("test2.js"), "f1", [])
// // var test = simplify(code, fname, args)
// console.log(test)