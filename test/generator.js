function *a() {
    var b = yield 1
    return b + 2
}
function *b() {
    return yield* a()
}
function c() {
    var gen = b()
    gen.next(1)
    var done = gen.next(2)
    return '' + done.value + done.done
}

-----------------------------------
"c"
[]
"4true"