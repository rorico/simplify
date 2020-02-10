var npm = {}
Object.defineProperty(npm, 'globalDir',
{
  get: function () {
  	return 1
    return (process.platform !== 'win32')
      ? path.resolve(npm.globalPrefix, 'lib', 'node_modules')
      : path.resolve(npm.globalPrefix, 'node_modules')
  },
  enumerable: true
})
console.log(npm.globalDir)