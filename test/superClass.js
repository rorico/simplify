class Rectangle {
    constructor(height, width) {
        this.name = 'Rectangle';
        this.height = height;
        this.width = width;
    }
    sayName() {
        return this.name
    }
}

class Square extends Rectangle {
    constructor(length) {
        super(length, length);
        this.name = 'Square';
    }
    longName() {
        return 'long' + super.sayName()
    }
}

class Square2 extends Square {}

function c() {
    var sq = new Square2(2)
    return sq.longName() + sq.height + sq.sayName()
}

-----------------------------------
"c"
[]
"longSquare2Square"