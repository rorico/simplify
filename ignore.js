var set = module.exports = new Set()
var entire = [
    Number,
    Math,
    isFinite,
    isNaN,
    String.prototype,
    Object,
    Array.isArray,
    Array.prototype,
    RegExp.prototype,
    Boolean,
    Boolean.prototype,
    JSON,
    require('path'),
    require('url'),
    // require('url').URL.prototype,
    require('buffer'),
    require('buffer').Buffer,
    require('buffer').Buffer.prototype,
]
var single = [
    Object.hasOwnProperty,
    Object.isPrototypeOf,
    Object.propertyIsEnumerable,
]
var force = [
    Object.values,
    Object.defineProperties,
    Object.assign,
    Object.defineProperty,
    Object.defineProperties,
    Object.freeze,
]

for (var e of entire) {
    set.add(e)
    for (var p of Object.getOwnPropertyNames(e)) {
        if (typeof e)
        set.add(e[p])
    }
}
for (var s of single) {
    set.add(s)
}
for (var f of force) {
    set.delete(f)
}