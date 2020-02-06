function c() {
    var weird = [[1,2],[3,4]]
    var sum = [0]
    for (var [a, b] of weird) {
        sum[0] += a + b
    }
    var [ret] = sum
    return ret
}

-----------------------------------
"c"
[]
10