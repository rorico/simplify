var getBaseRet = require('./baseRet')
module.exports = function(helpers) {
    var map = new Map()
    function getRet(func) {
        var ret = getBaseRet()
        func.ret = ret
        return ret
    }
    map.set(Array.prototype.push, function func(...args) {
        var ret = getRet(func)
        var argStrs = func.argStrs
        var strObj = helpers.getUnderStringObj(this)
        for (var a of args) {
            helpers.addUnder(a, this)
        }
        if (strObj.length !== this.length) {
            strObj[this.length-1] = undefined
        }
        Array.prototype.push.apply(strObj, argStrs)
        ret.ret = Array.prototype.push.apply(this, args)
        return ret.ret
    })
    map.set(Array.prototype.pop, function func(...args) {
        var ret = getRet(func)
        var strObj = helpers.getUnderStringObj(this)
        if (strObj.length !== this.length) {
            strObj[this.length-1] = undefined
        }
        // shouldn't have any args
        ret.str = Array.prototype.pop.apply(strObj)
        ret.ret = Array.prototype.pop.apply(this, args)
        helpers.removeUnder(ret.ret, this)
        return ret.ret
    })
    map.set(Array.prototype.shift, function func(...args) {
        var ret = getRet(func)
        var argStrs = func.argStrs
        var strObj = helpers.getUnderStringObj(this)
        ret.str = Array.prototype.shift.apply(strObj, argStrs)
        ret.ret = Array.prototype.shift.apply(this, args)
        helpers.removeUnder(ret.ret, this)
        return ret.ret
    })
    map.set(Array.prototype.unshift, function func(...args) {
        var ret = getRet(func)
        var argStrs = func.argStrs
        var strObj = helpers.getUnderStringObj(this)
        for (var a of args) {
            helpers.addUnder(a, this)
        }
        Array.prototype.unshift.apply(strObj, argStrs)
        ret.ret = Array.prototype.unshift.apply(this, args)
        return ret.ret
    })
    // map.set(Array.prototype.splice, function(argsInfo, helpers, strObj, retStr) {
    //     return function(...args) {
    //         var newEles = argsInfo.slice(2)
    //         for (var a of newEles) {
    //             helpers.addUnder(a.ret, this)
    //         }
    //         retStr.str = strObj.splice(args[0], args[1], ...newEles.map(a => a.str))
    //         var ret = Array.prototype.splice.apply(this, args)
    //         for (var a of ret) {
    //             helpers.removeUnder(a.ret, this)
    //         }
    //         return ret
    //     }
    // })
    // map.set(Array.prototype.concat, function(argsInfo, helpers, strObj, retStr) {
    //     return function(...args) {
    //         for (var a of argsInfo) {
    //             helpers.addUnder(a.ret, this)
    //             helpers.addUnderString(this, a.ret, a.str)
    //         }
    //         return Array.prototype.concat.apply(this, args)
    //     }
    // })
    // map.set(Array.prototype.reverse, function(argsInfo, helpers, strObj, retStr) {
    //     return function(...args) {
    //         for (var a of argsInfo) {
    //             helpers.addUnder(a.ret, this)
    //             helpers.addUnderString(this, a.ret, a.str)
    //         }
    //         return Array.prototype.reverse.apply(this, args)
    //     }
    // })
    // map.set(Array.prototype.sort, function(argsInfo, helpers, strObj, retStr) {
    //     return function(...args) {
    //         for (var a of argsInfo) {
    //             helpers.addUnder(a.ret, this)
    //             helpers.addUnderString(this, a.ret, a.str)
    //         }
    //         return Array.prototype.sort.apply(this, args)
    //     }
    // })
    
    // map.set(Array.prototype.slice, function(argsInfo, helpers, strObj, retStr) {
    //     return function(...args) {
    //         var ret = Array.prototype.slice.apply(this, args)
    //         var start = args[0] || 0
    //         for (var i = start; i < ret.length + start ; i++) {
    //             helpers.addUnder(ret[i], ret)
    //             helpers.addUnderString(ret, i, strObj[i])
    //         }
    
    //         return ret
    //     }
    // })
    
    
    
    
    
    // Object.assign
    // Object.defineProperties
    // Object.defineProperty
    
    // // also change, but don't really care
    // Object.setPrototypeOf
    // Object.freeze
    
    
    
    
    return map    
}
