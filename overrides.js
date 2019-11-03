var map = module.exports = new Map()
map.set(Array.prototype.push, function(argsInfo, helpers, strObj, retStr) {
    return function(...args) {
        for (var a of argsInfo) {
            helpers.addUnder(a.ret, this)
        }
        strObj[this.length-1] = undefined
        strObj.push(...argsInfo.map(a => a.str))
        return Array.prototype.push.apply(this, args)
    }
})
map.set(Array.prototype.pop, function(argsInfo, helpers, strObj, retStr) {
    return function(...args) {
        retStr.str = strObj[this.length-1]
        delete strObj[this.length-1]
        var ret = Array.prototype.pop.apply(this, args)
        helpers.removeUnder(ret, this)
        return ret
    }
})
map.set(Array.prototype.shift, function(argsInfo, helpers, strObj, retStr) {
    return function(...args) {
        retStr.str = strObj.shift()
        var ret = Array.prototype.shift.apply(this, args)
        helpers.removeUnder(ret, this)
        return ret
    }
})
map.set(Array.prototype.unshift, function(argsInfo, helpers, strObj, retStr) {
    return function(...args) {
        for (var a of argsInfo) {
            helpers.addUnder(a.ret, this)
        }
        strObj.unshift(...argsInfo.map(a => a.str))
        return Array.prototype.unshift.apply(this, args)
    }
})
map.set(Array.prototype.splice, function(argsInfo, helpers, strObj, retStr) {
    return function(...args) {
        var newEles = argsInfo.slice(2)
        for (var a of newEles) {
            helpers.addUnder(a.ret, this)
        }
        retStr.str = strObj.splice(args[0], args[1], ...newEles.map(a => a.str))
        var ret = Array.prototype.splice.apply(this, args)
        for (var a of ret) {
            helpers.removeUnder(a.ret, this)
        }
        return ret
    }
})
map.set(Array.prototype.concat, function(argsInfo, helpers, strObj, retStr) {
    return function(...args) {
        for (var a of argsInfo) {
            helpers.addUnder(a.ret, this)
            helpers.addUnderString(this, a.ret, a.str)
        }
        return Array.prototype.concat.apply(this, args)
    }
})
map.set(Array.prototype.reverse, function(argsInfo, helpers, strObj, retStr) {
    return function(...args) {
        for (var a of argsInfo) {
            helpers.addUnder(a.ret, this)
            helpers.addUnderString(this, a.ret, a.str)
        }
        return Array.prototype.reverse.apply(this, args)
    }
})
map.set(Array.prototype.sort, function(argsInfo, helpers, strObj, retStr) {
    return function(...args) {
        for (var a of argsInfo) {
            helpers.addUnder(a.ret, this)
            helpers.addUnderString(this, a.ret, a.str)
        }
        return Array.prototype.sort.apply(this, args)
    }
})

map.set(Array.prototype.slice, function(argsInfo, helpers, strObj, retStr) {
    return function(...args) {
        var ret = Array.prototype.slice.apply(this, args)
        var start = args[0] || 0
        for (var i = start; i < ret.length + start ; i++) {
            helpers.addUnder(ret[i], ret)
            helpers.addUnderString(ret, i, strObj[i])
        }

        return ret
    }
})





Object.assign
Object.defineProperties
Object.defineProperty

// also change, but don't really care
Object.setPrototypeOf
Object.freeze




