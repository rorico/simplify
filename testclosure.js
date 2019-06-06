var a
var x = 1


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

function y() {
	x = 5
	--x
	return x
}
function c() {
	var d = b(1)
	b(2)
	var e = b(2)
	var f = console.log("test")
	var g = y()
	if (b < 5) return 4
	return d()
}
