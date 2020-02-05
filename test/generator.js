function *a() {
    var b = yield 1
    console.log(b)
    return b + 2
}
function c() {
    var gen = a()
    gen.next(1)
    var done = gen.next(2)
    return '' + done.value + done.done
}

-----------------------------------
"c"
[]
"4true"