function c() {
	var argss =  [ { ret: 'acorn',
	delete: false,
	return: false,
	break: false,
	spread: false } ]
	var args = argss.reduce((a, arg) => {
		if (arg.spread) {
			return a.concat(arg.ret)
		} else {
			a.push(arg.ret)
			return a
		}
	}, [])
	return args	
}
require('./b')
module.exports = c