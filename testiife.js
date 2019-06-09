var fs = require("fs")
var si = require("./index")
var t = si(fs.readFileSync("./iife.js"), "c", [])
console.log(t)
