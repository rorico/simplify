var acorn = require("acorn")
var astring = require("astring")
var astravel = require("astravel")
var fs = require("fs")
var path = require("path")
import * as ts from "typescript"
import tsSyntax from "./tsSyntax"
import lognode from "./lognode"
var modules = {}
var called = new Set()
var calledWith = new Map()
var funcDefined = new Set()
var allAsts = []
var recording = false
ts.createtextwriter
type track = ts.Node & {
    delete?: number,
    visits?: number,
    calls?: number,
    argsUsed?: any,
    thisUsed?: any,
    true?: number,
    node?: ts.Node,
	func?: Function,
	side?: boolean,
	used?: number,
	varUsed?: boolean,
	varChanged?: boolean,
	remove?: boolean,
	callType?: string,
	nodeType?: string,
	getString?: string,
    // todo node as only one of the functions
}
type vars = {
	uses: number,
	val: any,
	closure: any,
	node?: ts.Node,
	init: ts.Node
}

function simplify(code, opts) {
	var vars: Record<string, vars> = {}
	var changed: any = {}
	var closuresMod = new Set()
	var usedVars = new Set()
	var replace = []
	var findClosures = new Map()
	var replaceCache = new Map()
	var loaded = false

	if (!opts) opts = {}
	var module: any = {}
	var req: any = {}
	var exposed: any = {}
	var acornOpts: any = {}
	if (opts.comments) {
		var comments = []
		acornOpts.onComment = comments
		acornOpts.locations = true
	}

	let sourceFile = ts.createSourceFile(
		'test',
		code,
		ts.ScriptTarget.ES2018,
		false
	)
	// var ast = acorn.parse(code, acornOpts)
	// allAsts.push(ast)

	// if (opts.comments) {
	// 	astravel.attachComments(ast, comments)
	// }

	initHoisted(sourceFile)
	walk(sourceFile)
	console.log("parsed through file", opts.filename)

	if (opts.node && opts.filename) {
		req.loaded = loaded = true
		// require.cache[file].loaded = loaded = true
	}
	if (opts.node) {
		exposed["module.exports"] = module.exports
	}
	for (var prop in vars) {
		// todo better way to handle predefined variables
		if (prop !== "this") {
			exposed[prop] = vars[prop]
		}
	}
	
	var ret = {
		ast: sourceFile,
		exposed: exposed,
		findClosures: findClosures,
		replaceCall: replaceCall,
		tsSyntax,
		call: (fname, args) => {
			var func
			if (fname.includes(".")) {
				// do this way to preserve this
				var parts = fname.split(".")
				var obj = global
				for (var i = 0 ; i < parts.length - 1 ; i++) {
					obj = obj[parts[i]]
				}
				func = (...args) => {
					return obj[parts[parts.length - 1]](...args)
				}
			} else {
				func = getVar(fname)
			}
			return ret.record(() => {
				return func(...args)
			})
		},
		record: (func) => {
			recording = true
			for (var a of allAsts) {
				reset(a)
			}
			called = new Set()
			calledWith = new Map()
			usedVars = new Set()
			funcDefined = new Set()

			var after = () => {
				recording = false
				var body = []
				console.log(called)
				for (var v of called.values()) {
					console.log(v)
					if (!funcDefined.has(v)) {
						// todo add this back
						// unused(v)
						body.unshift(v)
					}
				}
				for (var v of usedVars.values()) {
					body.unshift(v)
				}

				// var c = {
				// 	type: "Program",
				// 	body: body.reverse(),
				// 	fake: true
				// }
				console.log(body)
				let c = ts.createBlock(body.reverse(), true)

				return {
					ret: ret,
					c,
					// code: astring.generate(c),
					// ast: ast,
					called
				}
			}
			var ret = func()
			if (ret instanceof Promise) {
				return ret.then(after)
			} else {
				return after()
			}
		}
	}
	return ret

	function call(name, args) {
		var f = getVar(name)
		return f(...args)
	}

	function isFunction(node) {
		return node instanceof Function
	}

	function addFunction(node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction) {
        let track = node as track
		track.calls = track.calls || 0
		// need a seperate closure for each call
		var closure = vars
		// don't want to make new required modules disappear
		if (loaded) funcDefined.add(node)
		var func = function() {
			if (recording) {
				track.calls++
				called.add(node)
				if (calledWith.has(node)) {
					calledWith.get(node).push(arguments)
				} else {
					calledWith.set(node, [arguments])
				}
			}

            var params = node.parameters
            
			var oldVars = vars
			// TODO handle updating global variables
            vars = {}
            // @ts-ignore
			vars.__proto__ = closure
			for (var i = 0 ; i < params.length ; i++) {
                var p = params[i]
                // let typed
                if (p.questionToken || p.type || p.initializer) {
                    console.log("some part of param is not handled yet", p)
                }
				if (ts.isIdentifier(p.name)) {
                    let val
                    if (p.dotDotDotToken) {
                        val = Array.prototype.slice.call(arguments, i)
                    } else {
                        val = arguments[i]
                    }
					addVar(p.name.escapedText as string, arguments[i], p)
				} else if (ts.isObjectBindingPattern(p.name)) {
                    if (p.dotDotDotToken) console.log('weird ... on objectbinding on argument', node)
					// TODO this well
					for (let prop of p.name.elements) {
                        // TODO recursive
						if (!ts.isIdentifier(prop.name)) {
                            console.log("ObjectPattern key not Identifier", prop)
                            continue
                        }
                        let name = prop.name.escapedText as string
						addVar(name, arguments[i][name], prop)
					}
				} else {
					console.log("unknown param type", p)
				}
			}

			// some ghetto way to keep track if these variables are used
			if (!track.argsUsed) {
				track.argsUsed = {}
			}
			if (!track.thisUsed) {
				track.thisUsed = {}
			}
			addVar("arguments", arguments, track.argsUsed)
			// may cause incorrect closure values
			addVar("this", this, track.thisUsed)

			initHoisted(node.body)
			try {
				var ret = walk(node.body)
				// console.log(ret, node)
				return ret.ret
			} catch (e) {
				console.log('caught here', e)
				throw e
			} finally {
				// do in finally in case try catches are part of code flow
				// this can happen if a higher function modifies this one
				// remove just in case
				closuresMod.delete(vars)
				vars = oldVars
			}
		}
		// for access to node from function
		track.node = node
		if (node.name) {
			addVar(node.name.escapedText as string, func, node)
		}
		return func
	}
	function reset(node: track) {
		if (node.calls) node.calls = 0
		if (node.visits) node.visits = 0
		if (node.used) node.used = 0
		if (node.remove) node.remove = false
		node.forEachChild(reset)
	}

	function initHoisted(node: ts.Node) {
		var funcTypes = [ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction]
		if (ts.isFunctionDeclaration(node)) {
			addFunction(node)
			return
		} else if (ts.isVariableDeclaration(node)) {
			if (ts.isIdentifier(node.name)) {
				addVar(node.name.escapedText as string, undefined)
			}
		} else if (funcTypes.includes(node.kind)) {
			// don't hoist variables in nested functinos
			return
		}
		node.forEachChild(initHoisted)
	}
	function addVar(name: string, val?: any, node?: ts.Node) {
		// if (vars.hasOwnProperty(name)) {
		// 	// already set in this closure
		// 	var v = vars[name]
		// 	if (v.node) {
		// 		v.used = v.uses > 0
		// 	}
		// }
		var closure
		closure = vars
		if (val !== null && typeof val === "object" && findClosures.has(val)) {
			closure = findClosures.get(val)
		}
		vars[name] = {
			uses: 0,
			val: val,
			closure: closure,
			node: node,
			init: node
		}
		findClosures.set(val, closure)
		if (closure !== vars && node) {
			(node as track).side = true
		}
		return val
	}
	function setVar(name: string, val: any, node: ts.Node) {
		if (!(name in vars)) {
			global[name] = val
			exposed[name] = val
			findClosures.set(val, global)
		}

		var v = vars[name]
		v.val = val
		findClosures.set(val, v.closure)
		closuresMod.add(v.closure)
		if (v.node) {
			(v.node as track).varChanged = true
		}
		v.node = node
		if (v.closure !== vars && node) {
			(node as track).side = true
		}
		v.uses = 0
		return val
	}
	function setProp(obj: Record<string, any>, name: string, val: any, node: ts.Node, varPath: string[]) {
		obj[name] = val
		var closure = findClosures.get(obj)
		findClosures.set(val, closure)
		closuresMod.add(closure)
		if (closure === global) {
			if (varPath[0]) {
				exposed[varPath.join(("."))] = val
			}
		}
		if (closure !== vars && node) {
			(node as track).side = true
		}
		return val
	}

	function getVar(name: string) {
		if (vars[name] === undefined) {
			if (!(name in global)) {
				console.log(name, "not defined, should have errored")
			}
			var ret = global[name]
			findClosures.set(ret, global)
			return ret
		} else {
			var v = vars[name]
			v.uses++
			if (v.uses === 1 && v.node) {
				let track = v.node as track
				track.used = track.used ? track.used + 1 : 1
			}
			if (v.uses === 1 && v.init) {
				// todo if uncount is ever used
				let track = v.init as track
				track.varUsed = true
			}
			if (v.node && !vars.hasOwnProperty(name)) {
				usedVars.add(v.node)
			}
			return v.val
		}
	}
	function uncount(name) {
		var v = vars[name]
		v.uses--
		if (v.uses === 0 && v.node) {
			(v.node as track).used--
		}
	}
	function getObj(node: ts.PropertyAccessExpression | ts.ElementAccessExpression) {
		var res = walk(node.expression)
		var obj = res.ret
		var key = ts.isPropertyAccessExpression(node) ? node.name.escapedText as string : walk(node.argumentExpression).ret

		var varPath = res.varPath
		// use concat to not alter original variable
		varPath = varPath.concat([key])

		// TODO This isn't perfect, obj[key] can belong to many objects
		if (findClosures.has(obj[key])) {
			findClosures.set(obj[key], findClosures.get(obj))
		}
		return {
			obj: obj,
			key: key,
			varPath: varPath
		}
	}

	interface IWalkRet {
		ret: any,
		delete: boolean,
		return: boolean,
		break: boolean,
		continue: boolean,
		spread: boolean,
		varPath: string[]
	}

	function breakOut(node: IWalkRet) {
		return node && (node.return || node.break || node.continue)
	}

	
	
	function walk(node: ts.Node): IWalkRet {
		// console.log(node)
		var ret: IWalkRet = {
			ret: undefined,
			delete: false,
			return: false,
			break: false,
			continue: false,
			spread: false,
			varPath: []
		}
		if (!node) {
			console.log("unexpected null node")
			throw new Error("e")
			return ret
		}
		if (lognode[node.kind])
			console.log(tsSyntax[node.kind], node)

		let track = node as track
		if (!track.getString) {
			Object.defineProperty(track, 'getString', {
				get: function() {
					return code.substring(this.pos, this.end)
				}
			})
		}
		track.nodeType = tsSyntax[node.kind]
		if (track.delete === undefined) track.delete = 0
		if (track.visits === undefined) track.visits = 0
		if (recording) {
			track.visits++
		}
		let lazy = false
        // would like to do a giant switch statement, but typescript autochecking isn't good enough
		if (ts.isVariableStatement(node)) {
			lazy = true
		} else if (ts.isVariableDeclarationList(node)) {
			lazy = true
		} else if (ts.isVariableDeclaration(node)) {
			if (ts.isIdentifier(node.name)) {
				addVar(node.name.escapedText as string, node.initializer && walk(node.initializer).ret, node)
			} else {
				console.log("variable declaration is not identifier", node.name.kind)
			}
		// these are different, but mostly the same for now
		} else if (ts.isFunctionDeclaration(node)) {
			// these should be hoisted already
			// lazy = true
		} else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
			ret.ret = addFunction(node)
		} else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
			var args = node.arguments.reduce((a, arg) => {
				let ret = walk(arg)
				if (ret.spread) {
					return a.concat(ret.ret)
				} else {
					a.push(ret.ret)
					return a
				}
			}, [])

			var callType = "normal"
			var obj
			var key
			var func
			if (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) {
				// do it this way to maintain thisArg
				// can bind it, but that removes/changes some properties added
				// like name, node
				var o = getObj(node.expression)
				obj = o.obj
				key = o.key
				// don't use this as a function
				func = obj[key]
				if (obj[key] === console.log) {
					// to seperate logs from code
					args.unshift("from program")
					// console is a global side effect
					closuresMod.add(global)
				}

				var specialCalls = ['call', 'apply']
				if (typeof obj === "function" && specialCalls.includes(key)) {
					func = obj
					callType = key
				}
				// todo something about bind
			} else {
				func = walk(node.expression).ret
				// var knownTypes = ["Identifier", "FunctionExpression", "ArrowFunctionExpression", "CallExpression"]
				// if (!knownTypes.includes(node.expression.type)) {
				// 	// this probably works, but I don't know it / haven't tested
				// 	console.log("unexpected callee type", node.expression.type, node)
				// 	// process.exit(1)
				// }
			}

			if (!func || !isFunction(func)) {
				console.log("var is not function", func, node)
				throw "4"
			}

			if (func.node) {
				var n = func.node
				track.func = func
				track.callType = callType
			// 	called.add(n)
			// 	if (calledWith.has(n)) {
			// 		calledWith.get(n).push(args)
			// 	} else {
			// 		calledWith.set(n, [args])
			// 	}
			// } else {
			// 	// means not defined in js
			// 	// TODO might want to do some Proxy stuff to see if there are any side effects on arguments
			}

			var currClos = closuresMod
			closuresMod = new Set()


			var isNew = ts.isNewExpression(node)
			if (obj) {
				if (isNew) {
					ret.ret = new obj[key](...args)
				} else {
					ret.ret = obj[key](...args)
				}
			} else {
				if (isNew) {
					ret.ret = new func(...args)
				} else {
					ret.ret = func(...args)
				}
			}

			// TODO clean up findClosures
			if (ret.ret && !findClosures.has(ret.ret)) {
				findClosures.set(ret.ret, findClosures.get(func))
			}

			if (closuresMod.size) {
				track.side = true
				for (var c of closuresMod.values()) {
					var contained = false
					let co: any = c
					while (co) {
						if (co === vars) {
							contained = true
							break
						}
						// @ts-ignore
						co = co.__proto__
					}
					if (!contained) {
						currClos.add(c)
					}
				}
			}
			closuresMod = currClos
		} else if (ts.isConditionalExpression(node) || ts.isIfStatement(node)) {
			let cond, then, els
			if (ts.isConditionalExpression(node)) {
				cond = node.condition
				then = node.whenTrue
				els = node.whenFalse
			} else {
				cond = node.expression
				then = node.thenStatement
				els = node.elseStatement
			}
			var test = walk(cond)
			if (test.ret) {
				track.true = track.true ? track.true + 1 : 1
				var r = walk(then)
				if (breakOut(r)) return r
				ret.ret = r.ret
			} else if (els) {
				var r = walk(els)
				if (breakOut(r)) return r
				ret.ret = r.ret
			}
		} else if (ts.isSwitchStatement(node)) {
			var d = walk(node.expression).ret
			var b = false
			var cont = false
			for (var clause of node.caseBlock.clauses) {
				if (cont || !ts.isCaseClause(clause) || walk(clause.expression).ret === d) {
					cont = true
					for (var s of clause.statements) {
						var r = walk(s)
						if (r.return || r.continue) return r
						if (r.break) {
							cont = false
							b = true
							break
						}
					}
					if (b) {
						break
					}
				}
			}
		} else if (ts.isBreakStatement(node)) {
			// todo: handle labels
			if (node.label) console.log("labels not handled")
			ret.break = true
		} else if (ts.isContinueStatement(node)) {
			// todo: handle labels
			if (node.label) console.log("labels not handled")
			ret.continue = true
		} else if (ts.isBinaryExpression(node)) {
			let assigns = [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken]
			if (assigns.includes(node.operatorToken.kind)) {
				var right = walk(node.right).ret
				if (ts.isIdentifier(node.left)) {
					let name = node.left.escapedText as string
					let val
					if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
						val = right
					} else if (node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) {
						val = getVar(name) + right
					} else if (node.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken) {
						val = getVar(name) - right
					} else {
						console.log("unexpected assignment operator")
					}

					ret.ret = setVar(name, val, node)
					
				} else if (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) {
					var o = getObj(node.left)
					var val
					if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
						val = right
					} else if (node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) {
						val = o.obj[o.key] + right
					} else if (node.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken) {
						val = o.obj[o.key] - right
					} else {
						console.log("unexpected assignment operator")
					}
					ret.ret = setProp(o.obj, o.key, val, node, o.varPath)
				} else {
					console.log('unknown assignment left type', node.left)
				}
			} else {
				let left = walk(node.left).ret
				// do it this way as sometimes won't have to walk right
				switch (node.operatorToken.kind) {
					case ts.SyntaxKind.EqualsEqualsEqualsToken:
						ret.ret = left === walk(node.right).ret
						break
					case ts.SyntaxKind.ExclamationEqualsEqualsToken:
						ret.ret = left !== walk(node.right).ret
						break
					case ts.SyntaxKind.EqualsEqualsToken:
						ret.ret = left == walk(node.right).ret
						break
					case ts.SyntaxKind.ExclamationEqualsToken:
						ret.ret = left != walk(node.right).ret
						break
					case ts.SyntaxKind.BarBarToken:
						ret.ret = left || walk(node.right).ret
						break
					case ts.SyntaxKind.AmpersandAmpersandToken:
						ret.ret = left && walk(node.right).ret
						break
					case ts.SyntaxKind.BarToken:
						ret.ret = left | walk(node.right).ret
						break
					case ts.SyntaxKind.AmpersandToken:
						ret.ret = left & walk(node.right).ret
						break
					case ts.SyntaxKind.GreaterThanToken:
						ret.ret = left > walk(node.right).ret
						break
					case ts.SyntaxKind.GreaterThanEqualsToken:
						ret.ret = left >= walk(node.right).ret
						break
					case ts.SyntaxKind.LessThanToken:
						ret.ret = left < walk(node.right).ret
						break
					case ts.SyntaxKind.LessThanEqualsToken:
						ret.ret = left <= walk(node.right).ret
						break
					case ts.SyntaxKind.PlusToken:
						ret.ret = left + walk(node.right).ret
						break
					case ts.SyntaxKind.MinusToken:
						ret.ret = left - walk(node.right).ret
						break
					case ts.SyntaxKind.AsteriskToken:
						ret.ret = left * walk(node.right).ret
						break
					case ts.SyntaxKind.SlashToken:
						ret.ret = left / walk(node.right).ret
						break
					case ts.SyntaxKind.PercentToken:
						ret.ret = left % walk(node.right).ret
						break
					case ts.SyntaxKind.InKeyword:
						ret.ret = left in walk(node.right).ret
						break
					case ts.SyntaxKind.InstanceOfKeyword:
						let right = walk(node.right).ret
						ret.ret = left instanceof right
						break
					default:
						console.log("unexpected binary", node.operatorToken)
				}
			}
		// } else if (ts.isPostfixUnaryExpression(node)) {
		// } else if (ts.isPrefixUnaryExpression(node)) {
			
		} else if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
			var arg = node.operand
			let change = [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken]
			if (change.includes(node.operator)) {
				let prefix = ts.isPrefixUnaryExpression(node)
				if (ts.isIdentifier(arg)) {
					var name = arg.escapedText as string
					var val = getVar(name)
					ret.ret = val
					if (node.operator === ts.SyntaxKind.PlusPlusToken) {
						val++
					} else if (node.operator === ts.SyntaxKind.MinusMinusToken) {
						val--
					} else {
						console.log("unknown update operator", node)
					}
					var res = setVar(name, val, node)
					if (prefix) {
						ret.ret = res
					}
					return ret
				} else if (ts.isPropertyAccessExpression(arg) || ts.isElementAccessExpression(arg)) {
					var o = getObj(arg)
					var obj = o.obj
					var key = o.key
					if (node.operator === ts.SyntaxKind.PlusPlusToken) {
						ret.ret = (prefix ? ++obj[key] : obj[key]++)
					} else if (node.operator === ts.SyntaxKind.MinusMinusToken) {
						ret.ret = (prefix ? --obj[key] : obj[key]--)
					} else {
						console.log("unknown update operator", node)
					}
				} else {
					console.log("unknown arg type")
				}
			} else if (node.operator === ts.SyntaxKind.PlusToken) {
				ret.ret = +walk(arg).ret
			} else if (node.operator === ts.SyntaxKind.MinusToken) {
				ret.ret = -walk(arg).ret
			} else if (node.operator === ts.SyntaxKind.TildeToken) {
				ret.ret = ~walk(arg).ret
			} else if (node.operator === ts.SyntaxKind.ExclamationToken) {
				ret.ret = !walk(arg).ret
			} else {
				console.log("unknown unary expression", node)
			}
		} else if (ts.isForInStatement(node)) {
			// assume only 1 var for for in
			let varname
			if (ts.isIdentifier(node.initializer)) {
				varname = node.initializer.escapedText as string
			} else if (ts.isVariableDeclarationList(node.initializer) && ts.isIdentifier(node.initializer.declarations[0].name)) {
				varname = node.initializer.declarations[0].name.escapedText as string
			} else {
				console.log("unknown for initializer", node.initializer, node)
				return ret
			}
			var right = walk(node.expression).ret
			for (var i in right) {
				addVar(varname, i)
				var r = walk(node.statement)
				if (r.return) return r
				if (r.break) break
				if (r.continue) continue
			}
		} else if (ts.isForOfStatement(node)) {
			// assume only 1 var for for in
			if (!ts.isVariableDeclarationList(node.initializer) || !ts.isIdentifier(node.initializer.declarations[0].name)) {
				console.log("unknown for initializer")
				return ret
			}
			var varname = node.initializer.declarations[0].name.escapedText as string
			var right = walk(node.expression).ret
			for (let ri of right) {
				addVar(varname, ri)
				var r = walk(node.statement)
				if (r.return) return r
				if (r.break) break
				if (r.continue) continue
			}
		} else if (ts.isForStatement(node)) {
			for (node.initializer ? walk(node.initializer) : "" ; node.condition ? walk(node.condition).ret : true ; node.incrementor ? walk(node.incrementor) : "") {
				var r = walk(node.statement)
				if (r.return) return r
				if (r.break) break
				if (r.continue) continue
			}
		} else if (ts.isWhileStatement(node)) {
			while (walk(node.expression).ret) {
				track.true = track.true ? track.true + 1 : 1
				var r = walk(node.statement)
				if (r.return) return r
				if (r.break) break
				if (r.continue) continue
			}
		} else if (ts.isExpressionStatement(node)) {
			// noop
			lazy = true
		// } else if (ts.isLogicalExpression(node)) {
		// 	switch (node.operator) {
		// 		case "||":
		// 			ret.ret = walk(node.left).ret || walk(node.right).ret
		// 			break
		// 		case "&&":
		// 			ret.ret = walk(node.left).ret && walk(node.right).ret
		// 			break
		// 	}
		// 	return ret

		// TODO: seperate these
		} else if (ts.isBlock(node)) {
			lazy = true
		} else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
			var o = getObj(node)
			ret.ret = o.obj[o.key]
			ret.varPath = o.varPath
			return ret
		} else if (ts.isObjectLiteralExpression(node)) {
			ret.ret = {}
			for (var prop of node.properties) {
				// the other is literal
				if (!ts.isPropertyAssignment(prop)) {
					console.log('unhandled objectliteral prop', prop)
					return ret
				}
				let name
				if (ts.isIdentifier(prop.name)) {
					// todo 
					name = prop.name.escapedText as string
				} else if (ts.isComputedPropertyName(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)) {
					name = walk(prop.name).ret
				} else {
					console.log('unhandled property name type', prop)
					name = walk(prop.name).ret
				}
				if (!prop.initializer) console.log("unhandled property with not initializer", prop)
				ret.ret[name] = walk(prop.initializer).ret
			}
			return ret
		} else if (ts.isDeleteExpression(node)) {
			// i'm pretty sure this doesn't have a return type
			// also i'm too lazy to do this now
			console.log('lazy to do delete properly')
			lazy = true
		} else if (ts.isTypeOfExpression(node)) {
			// typeof is special in that it can handle variables never defined
			if (ts.isIdentifier(node.expression)) {
				let name = node.expression.escapedText as string
				if (!(name in vars || name in global)) {
					ret.ret = undefined
					return ret
				}
			}
			ret.ret = typeof walk(node.expression).ret
		} else if (ts.isSpreadElement(node)) {
			ret.spread = true
			ret.ret = walk(node.expression).ret
		} else if (ts.isStringLiteral(node)) {
			ret.ret = node.text
		} else if (ts.isNumericLiteral(node)) {
			ret.ret = +node.text
		} else if (ts.isRegularExpressionLiteral(node)) {
			// todo maybe test this
			ret.ret = new RegExp(node.text)
		} else if (node.kind === ts.SyntaxKind.TrueKeyword) {
			ret.ret = true
		} else if (node.kind === ts.SyntaxKind.FalseKeyword) {
			ret.ret = false
		} else if (node.kind === ts.SyntaxKind.NullKeyword) {
			ret.ret = null
		} else if (node.kind === ts.SyntaxKind.UndefinedKeyword) {
			ret.ret = undefined
		} else if (ts.isIdentifier(node)) {
			let name = node.escapedText as string
			ret.ret = getVar(name)
			ret.varPath = [name]
		} else if (ts.isReturnStatement(node)) {
			ret.return = true
			if (node.expression) {
				ret.ret = walk(node.expression).ret
			}
		} else if (ts.isVariableDeclaration(node)) {
			lazy = true
		} else if (ts.isSourceFile(node)) {
			lazy = true
			// should be global at this level
			addVar("this", this)
			if (opts.node) {
				// these are set in node for every module
				// exports, require, module, __filename, __dirname
				
				var file = opts.filename
				var foldername = path.dirname(file)
				var exports = module.exports = addVar("exports", {})
				if (file) {
					file = path.resolve(file)
					// hacky
					req = require.cache[file] = {
						id: file,
						filename: file,
						exports: exports,
						parent: opts.parent,
						loaded: false,
						children: [],
						paths: [file]
					}
					module = {
						set exports(x) {
							req.exports = x
						},
						get exports() {
							return req.exports
						}
					}
					// gonna assume this is defined with filename for now
					var moduleFolder = path.join(opts.package, "node_modules")

					// these should error if file is not given
					addVar("__filename", file)
					addVar("__dirname", foldername)
					var fakeRequire = function(...args) {
						if (args.length !== 1) {
							console.log("incorrect number of args for require", args)
						}
						var name = args[0]
						// console.log(name)
						var file = require.resolve(name, {paths: [moduleFolder, getVar("__dirname"), './']})

						// do this to not record any functions used on startup
						var oldRecording = recording
						recording = false
						try {
							if (name.startsWith(".") || name.includes('/') || name.includes('\\')) {
								if (require.cache[file]) {
									return require(file)
								}

								var todo = fs.readFileSync(file)
								opts.filename = file
								opts.parent = req
								var code = simplify(todo, opts)

								// this will be set by that context
								return require(file)
							} else {
								return require(file)
							}
						} catch (e) {
							console.log("cannot require", ...args, e)
							process.exit(1)
						} finally {
							recording = oldRecording
						}
					}
					// @ts-ignore
					fakeRequire.resolve = function(request, options) {
						if (!options) {
							options = {paths: [foldername]}
						} else {
							options.path.unshift(foldername)
						}
						return require.resolve(request, options)
					}
					addVar("require", fakeRequire)
				} else {
					module = {exports: exports}
				}
				addVar("module", module)
				// might have to do some path stuff
				// just to not break things
				// @ts-ignore
				document = {}
				// @ts-ignore
				window = {}
			}
		} else if (ts.isArrayLiteralExpression(node)) {
			ret.ret = node.elements.map(e => walk(e).ret)
		} else if (node.kind === ts.SyntaxKind.ThisKeyword) {
			// ts doesn't have a isThisExpression, weird
			ret.ret = getVar("this")
			ret.varPath = ["this"]
		} else if (ts.isThrowStatement(node)) {
			// TODO make this message global
			// throw Error("thrown error from program " + walk(node.argument).ret)
			throw walk(node.expression).ret
		} else if (ts.isTryStatement(node)) {
			try {
				var r = walk(node.tryBlock)
				if (breakOut(r)) return r
			} catch (e) {
				console.log("error caught", e)
				if (node.catchClause) {
					if (!ts.isIdentifier(node.catchClause.variableDeclaration.name)) {
						console.log("unhandled catch type")
						return ret
					}
					addVar(node.catchClause.variableDeclaration.name.escapedText as string, e)
					var r = walk(node.catchClause.block)
					if (breakOut(r)) return r
				}
			} finally {
				if (node.finallyBlock) {
					var r = walk(node.finallyBlock)
					if (breakOut(r)) return r
				}
			}

		// } else if (ts.isTaggedTemplateExpression(node)) {
		// 	if (node.quasi.type !== "TemplateLiteral") console.log("unexpected quasi type")
		// 	if (node.tag.type !== "Identifier") console.log("tag not Identifier not handled")
		// 	var quasis = node.quasi.quasis.map(q => q.value.cooked)
		// 	var expressions = node.quasi.expressions.map(e => walk(e).ret)
		// 	ret.ret = walk(node.tag).ret(quasis, ...expressions)
		// 	return ret
		// } else if (ts.isTemplateLiteral(node)) {
		// 	var quasis = node.quasis.map(q => q.value.cooked)
		// 	var expressions = node.expressions.map(e => walk(e).ret)
		// 	ret.ret = quasis[0]
		// 	// maybe check that expressions.length = quasis.length - 1
		// 	for (var i = 0 ; i < expressions.length ; i++) {
		// 		ret.ret += expressions[i] + quasis[i+1]
		// 	}
		// 	return ret


		// these are comments
		// } else if (ts.isLine(node)) {
		// 	break
		} else if (ts.isEmptyStatement(node)) {
			lazy = true
		} else if (node.kind === ts.SyntaxKind.EndOfFileToken) {
			lazy = true
		} else if (ts.isParenthesizedExpression(node)) {
			ret.ret = walk(node.expression).ret
		} else {
			console.log("unknown node type", node.kind, tsSyntax[node.kind], node)
			lazy = true
		}
		if (lazy) {
			
			// console.log('also this happened')
			node.forEachChild(node => {
				let res = walk(node)
				if (breakOut(res)) {
					ret.ret = res.ret
				}
			}, nodes => nodes.find(n => {
				let res = walk(n)
				if (breakOut(res)) {
					ret = res
					return true
				}
			}))
		}
		// console.log(ret, node)
		return ret
	}
	function addSide(node) {
		var ret = []
		if (node.side) {
			ret.push(node)
			return ret
		}
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					ret.push(...addSide(c))
				}
			} else if (val && typeof val.type === "string") {
				ret.push(...addSide(val))
			}
		}
		return ret
	}
	function replaceCall(node) {
		var func = node.func
		if (!func) return
		var funcNode = func.node
		var rep = replaceReturn(funcNode)
		console.log(rep)
		if (rep.usable) {
			var retVar = rep.ret
			var body = node.func.node.body.body
			var old = JSON.parse(JSON.stringify(node))
			// if (retVar) {
			// 	Object.assign(node, retVar, {fake: true})
			// } else {
			// 	Object.assign(node, {
			// 		type: "Literal",
			// 		value: undefined,
			// 		raw: "undefined",
			// 		fake: true
			// 	})
			// }

			var decs = []
			var args = []
			if (node.callType === "normal") {
				args = node.arguments
			} else if (node.callType === "call") {
				// todo this
				args = node.arguments.slice(1)
			} else {
				console.log("unsupported", node.callType, node)
				return
			}
			var params = func.node.params
			for (var i = 0 ; i < params.length ; i++) {
				// TODO handle different types
				var d = {
					type: "VariableDeclarator",
					id: params[i],
					init: args[i],
					used: params[i].used,
					fake: true
				}
				decs.push(d)
			}
			if (rep.argsUsed) {
				decs.push({
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: "arguments",
						fake: true
					},
					init: {
						type: "ArrayExpression",
						elements: args,
						fake: true
					},
					used: rep.argsUsed,
					fake: true
				})
			}
			if (decs.length) {
				var dec = {
					type: "VariableDeclaration",
					kind: "var",
					declarations: decs,
					// generated by me
					fake: true
				}
				body.unshift(dec)							
			}
			var r = {
				type: "BlockStatement",
				body: body,
				old: old,
				fake: true
			}
			if (node.visits === func.node.calls) {
				// redundant for now, but might change check above
				called.delete(func.node)
				unused(r)
			}
			return {retVar: retVar, body: r}
		}
	}
	function replaceReturn(node) {
		if (replaceCache.has(node)) {
			return replaceCache.get(node)
		}
		var ret = {
			ret: undefined,
			argsUsed: node.argsUsed.used,
			thisUsed: node.thisUsed.used,
			singleRet: true,
			recursive: false,
			usable: true
		}
		walkReplace(node, node)
		ret.usable = ret.singleRet && !ret.recursive
		replaceCache.set(node, ret)
		return ret
		function walkReplace(node, orig) {
			if (typeof node === "function") {
				// console.log("arrived at function in recursion")
				return
			}
			// console.log(orig, node)
			if (node.type === "CallExpression") {
				if (node.func === orig) {
					// there is recursion on self
					// doesn't actually handle all cases
					console.log("some recursion", orig.id || orig.id.name)
					ret.recursive = true
					return true
				}
				// don't go into func call
				// return
			}
			for (var key in node) {
				var val = node[key]
				if (Array.isArray(val)) {
					for (var i = 0 ; i < val.length ; i++) {
						var c = val[i]
						// assuming return statement isn't in a stupid place
						if (c.type === "ReturnStatement") {
							if (!c.visits) {
								// return not used
								return
							}
							if (c.visits !== orig.calls) {
								// this function isn't easily replacable
								console.log("not the same", orig.calls, c.visits)
								ret.singleRet = false
								return true
							}
							// assume all returns happen in the same place
							// remove all nodes after it
							val.splice(i, val.length)
							ret.ret = c.argument
							return true
						}
						var a = walkReplace(c, orig)
						if (a) {
							val.splice(i + 1, val.length)
							return a
						}
					}
				} else if (val && typeof val.type === "string") {
					// TODO check return statement here
					var a = walkReplace(val, orig)
					if (a) {
						return a
					}
				}
			}
		}
	}
	function checkUnuse(node) {
		var ret = {
			stop: false,
			remove: false
		}
		switch (node.type) {
			case "VariableDeclarator":
				ret.remove = !node.used && !node.side
				if (ret.remove && node.varUsed) {
					ret.remove = false
					node.init = null
				}
				break
			case "FunctionExpression":
			case "ArrowFunctionExpression":
			case "FunctionDeclaration":
				ret.remove = !node.calls
				break
			case "CallExpression":
				var func = node.func
				// if (node.callType === "call")
				if (func)
				console.log(node.callType)
				if (func && node.visits === func.node.calls) {
					node.replaceable = true
					if (opts.replace) {
						var res = replaceCall(node)
						if (res) {
							replace.push(res)
						}
						ret.stop = true
					}
				}
				break

			case "ConditionalExpression":
			case "IfStatement":
				// TODO always false with alternate
				ret.remove = !node.true && !(node.alternate && !node.alternate.remove)
				if (node.true === node.visits) {
					if (node.alternate) {
						node.alternate.remove = true
					}
				} else if (!node.true) {
					node.consequent.remove = true
				}
				break
			case "SwitchStatement":
				break
			case "BreakStatement":
				break
			case "AssignmentExpression":
				// TODO better handle around this
				var left = node.left
				if (ts.isIdentifier(left)) {
					ret.remove = !node.used && !node.side
				}
				break
			case "UpdateExpression":
				// TODO better handle around this
				var arg = node.argument
				if (ts.isIdentifier(arg)) {
					ret.remove = !node.used && !node.side
				}
				break
			case "ForInStatement":
				break
			case "ForStatement":
				break
			case "WhileStatement":
				ret.remove = !node.true
				break
			case "ExpressionStatement":
				// removing things can result in invalid trees
				if (!node.expression || node.expression.remove) {
					ret.remove = true
					break
				}
				if (node.expression.type === "CallExpression") {
					ret.remove = !node.expression.side
				}
				if (node.expression.type === "Literal") {
					ret.remove = true
				}
				break
			case "LogicalExpression":
				break
			case "BinaryExpression":
				break
			case "BlockStatement":
				break
			case "MemberExpression":
				break
			case "ObjectExpression":
				break
			case "UnaryExpression":
				break
			case "SpreadElement":
				break
			case "Literal":
				break
			case "Identifier":
				break
			case "ReturnStatement":
				ret.remove = !node.visits
				break
			case "VariableDeclaration":
				ret.remove = !node.declarations.reduce((a,b) => a+!(b.remove || 0), 0)
				break
			case "Program":
				break
			case "ArrayExpression":
				break
			case "ThrowStatement":
				ret.stop = true
				break
		}
		return ret
	}

	function checkOrRecurse(node) {
		var che = checkUnuse(node)
		if (che.remove) {
			if (addSide(node).length) {
				return false
			}
			return true
		}
		if (che.stop) {
			return false
		}
		unused(node)
		return checkUnuse(node).remove
	}

	function unused(node) {
		for (var key in node) {
			var val = node[key]
			if (Array.isArray(val)) {
				for (var i = 0 ; i < val.length ; i++) {
					var c = val[i]
					if (checkOrRecurse(c)) {
						c.remove = true
						// val.splice(i, 1)
						// i--
					}
					var injectable = node.type === "Program" || node.type === "BlockStatement"
					if (injectable && replace.length) {
						val.splice(i, 0, ...replace)
						console.log(replace)
						i += replace.length
						replace = []
					}
				}
			} else if (val && typeof val.type === "string") {
				if (checkOrRecurse(val)) {
					// node[key] = undefined
					val.remove = true
				}
			}
		}
	}
}

module.exports = simplify
