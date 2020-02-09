async function a() {
    return '1'
}
async function b() {
    return await a()
}
function c() {
    return b()
}

-----------------------------------
"c"
[]
"1"