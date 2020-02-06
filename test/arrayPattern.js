function c() {
    var weird = [[1,2],[3,4]]
    var sum = [0]
    for (var [a, b] of weird) {
        sum[0] += a + b
    }
    // var [a,b] = [1,2]
    return sum[0]
}

-----------------------------------
"c"
[]
10