// /var a

function a() {
	var d = b(1)
	b(2)
	if (false) return 4
	return d()
}
function b(r) {
	var a = 4 + r
	return function() {
		return a
	}
}
function c() {
	var d = b(1)
	b(2)
	if (b < 5) return 4
	return d()
}
