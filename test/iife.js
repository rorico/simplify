var a = 1;

(() => {
	a = 2
})()

function c() {
	return a
}

-----------------------------------
"c"
[]
2