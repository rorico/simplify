async function a() {
    return new Promise(r => {
        setTimeout(() => {
            r(1)
        }, 1000);
    })
}

async function* f() {
    return yield await a()
}

async function* b() {
    return yield* f()
}
async function c() {
    var d = b()
    var e = await d.next()
    var g = await d.next(2)
    return '' + g.value + g.done + e.value
}

-----------------------------------
"c"
[]
"2true1"