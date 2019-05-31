
var argss =  [ { ret: 'acorn',
delete: false,
return: false,
break: false,
spread: false } ]
var args = argss.reduce((a, arg) => {
	console.error(a,arg)
	if (arg.spread) {
		return a.concat(arg.ret)
	} else {
		a.push(arg.ret)
		return a
	}
}, [])
console.log(args)