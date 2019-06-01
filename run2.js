var fs = require("fs")
var si = require("./index")
var t = si(fs.readFileSync("./testclosure.js"), "c", [])
console.log(t)
