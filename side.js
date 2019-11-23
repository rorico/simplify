var affectsThis = new Set()
var affectsFirst = new Set()

// things that affect thisArg
affectsThis.add(Array.prototype.push)
affectsThis.add(Array.prototype.unshift)
affectsThis.add(Array.prototype.shift)
affectsThis.add(Array.prototype.pop)
affectsThis.add(Array.prototype.sort)
affectsThis.add(Array.prototype.splice)
affectsThis.add(Array.prototype.reverse)

// things that affect first arg, these all also return the first arg
affectsFirst.add(Object.assign)
affectsFirst.add(Object.defineProperty)
affectsFirst.add(Object.defineProperties)
affectsFirst.add(Object.freeze)
module.exports = {
    affectsFirst,
    affectsThis,
}