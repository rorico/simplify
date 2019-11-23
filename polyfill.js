var map = module.exports = new Map()
map.set(Array.prototype.filter, function(func, thisArg) {
  'use strict';
  if ( ! ((typeof func === 'Function' || typeof func === 'function') && this) )
      throw new TypeError();
 
  var len = this.length >>> 0,
      res = new Array(len), // preallocate array
      t = this, c = 0, i = -1;

  var kValue;
  if (thisArg === undefined){
    while (++i !== len){
      // checks to see if the key was set
      if (i in this){
        kValue = t[i]; // in case t is changed in callback
        if (func(t[i], i, t)){
          res[c++] = kValue;
        }
      }
    }
  }
  else{
    while (++i !== len){
      // checks to see if the key was set
      if (i in this){
        kValue = t[i];
        if (func.call(thisArg, t[i], i, t)){
          res[c++] = kValue;
        }
      }
    }
  }
 
  res.length = c; // shrink down array to proper size
  return res;
});

map.set(Array.prototype.map, function(callback/*, thisArg*/) {

  var T, A, k;

  if (this == null) {
    throw new TypeError('this is null or not defined');
  }

  // 1. Let O be the result of calling ToObject passing the |this| 
  //    value as the argument.
  var O = Object(this);

  // 2. Let lenValue be the result of calling the Get internal 
  //    method of O with the argument "length".
  // 3. Let len be ToUint32(lenValue).
  var len = O.length >>> 0;

  // 4. If IsCallable(callback) is false, throw a TypeError exception.
  // See: http://es5.github.com/#x9.11
  if (typeof callback !== 'function') {
    throw new TypeError(callback + ' is not a function');
  }

  // 5. If thisArg was supplied, let T be thisArg; else let T be undefined.
  if (arguments.length > 1) {
    T = arguments[1];
  }

  // 6. Let A be a new array created as if by the expression new Array(len) 
  //    where Array is the standard built-in constructor with that name and 
  //    len is the value of len.
  A = new Array(len);

  // 7. Let k be 0
  k = 0;

  // 8. Repeat, while k < len
  while (k < len) {

    var kValue, mappedValue;

    // a. Let Pk be ToString(k).
    //   This is implicit for LHS operands of the in operator
    // b. Let kPresent be the result of calling the HasProperty internal 
    //    method of O with argument Pk.
    //   This step can be combined with c
    // c. If kPresent is true, then
    if (k in O) {

      // i. Let kValue be the result of calling the Get internal 
      //    method of O with argument Pk.
      kValue = O[k];

      // ii. Let mappedValue be the result of calling the Call internal 
      //     method of callback with T as the this value and argument 
      //     list containing kValue, k, and O.
      mappedValue = callback.call(T, kValue, k, O);

      // iii. Call the DefineOwnProperty internal method of A with arguments
      // Pk, Property Descriptor
      // { Value: mappedValue,
      //   Writable: true,
      //   Enumerable: true,
      //   Configurable: true },
      // and false.

      // In browsers that support Object.defineProperty, use the following:
      // Object.defineProperty(A, k, {
      //   value: mappedValue,
      //   writable: true,
      //   enumerable: true,
      //   configurable: true
      // });

      // For best browser support, use the following:
      A[k] = mappedValue;
    }
    // d. Increase k by 1.
    k++;
  }

  // 9. return A
  return A;
});
map.set(Array.prototype.forEach, function(callback/*, thisArg*/) {

  var T, k;
  if (this === null) {
    throw new TypeError('this is null or not defined');
  }
  var O = Object(this);
  var len = O.length >>> 0;
  if (typeof callback !== 'function') {
    throw new TypeError(callback + ' is not a function');
  }
  if (arguments.length > 1) {
    T = arguments[1];
  }
  k = 0;
  while (k < len) {
    var kValue;
    if (k in O) {
      kValue = O[k];
      callback.call(T, kValue, k, O);
    }
    k++;
  }
})
map.set(Array.prototype.slice, function(begin, end) {
  // IE < 9 gets unhappy with an undefined end argument
  end = (typeof end !== 'undefined') ? end : this.length;

  // For array like object we handle it ourselves.
  var i, cloned = [],
    size, len = this.length;

  // Handle negative value for "begin"
  var start = begin || 0;
  start = (start >= 0) ? start : Math.max(0, len + start);

  // Handle negative value for "end"
  var upTo = (typeof end == 'number') ? Math.min(end, len) : len;
  if (end < 0) {
    upTo = len + end;
  }

  // Actual expected size of the slice
  size = upTo - start;

  if (size > 0) {
    cloned = new Array(size);
    if (this.charAt) {
      for (i = 0; i < size; i++) {
        cloned[i] = this.charAt(start + i);
      }
    } else {
      for (i = 0; i < size; i++) {
        cloned[i] = this[start + i];
      }
    }
  }

  return cloned;
})
// personal polyfill
map.set(Array.prototype.join, function(sep) {
  if (!this.length) {
    return ''
  }
  sep = sep || ''
  var ret = '' + (0 in this ? this[0] : '')
  for (var i = 1 ; i < this.length ; i++) {
    ret += sep + (i in this ? this[i] : '')
  }
  return ret
})
