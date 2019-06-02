// /var a

function b(r) {
	var a = 4 + r
	return function() {
		return a
	}
}
function c() {
	var d = b(1)
	b(2)
	return d()
}
