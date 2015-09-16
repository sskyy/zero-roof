'use strict'
var _ = require('lodash')
var BusProxy = require('./BusProxy')
var cloneDeep = require('lodash.clonedeep')
var Galaxies = require('roof-zeroql/lib/Galaxies')
var co = require('co')
var BusError = require('roof-bus/lib/error')

function isGenerator(fn) {
  return fn.constructor.name === 'GeneratorFunction';
}

function extendObject(obj, key, handler) {
  var keys = key.split('.')
  var lastKey = keys.pop()

  var currentKey
  var cursor = obj


  while ((currentKey = keys.shift()) !== undefined) {
    if (cursor[currentKey] === undefined) cursor[currentKey] = {}
    cursor = cursor[currentKey]
  }

  cursor[lastKey] = handler(cursor[lastKey])
}


///////////////////////////////////
//                 exports
///////////////////////////////////

var parseArgs = function (args, types) {
  return args.map(function (arg) {
    var output = arg
    var NodeClass
    //TODO 用 EJSON 判断
    if (arg.def !== undefined && arg.def.type !== undefined && types[arg.def.type] !== undefined) {
      //TODO 增加 collection
      NodeClass = types[arg.def.type]
      output = new NodeClass(arg.data)
      if (arg.$relations) {
        arg.$relations.forEach(function (relation) {

          relation.value.forEach(function (relateNodeArg) {
            var RelateNodeClass = types[relateNodeArg.def.type]
            var relateNode = new RelateNodeClass(relateNodeArg.data)
            output.relate(relateNode, relation.key)
          })

        })
      }
    }

    return output
  })
};




var roofModule = {
  extend: function (module) {
    this.relierAssets[module.name] = module.assets
    this.relierEntries[module.name] = module.entries
  },

  serverEvents: {},
  relierAssets: {},
  relierEntries: {},
  relierSpecs: {},
  bootstrap: {
    fn: function () {

      var root = this


      _.forEach(this.reliers, function (relier, relierName) {

        var moduleProxy = {name: relierName}
        if (root.relierAssets[relierName]) moduleProxy.assets = root.relierAssets[relierName].map(function (asset) {
          return _.defaults(asset, {
            base: relierName
          })
        })

        if (root.relierEntries[relierName]) {
          moduleProxy.entries = root.relierEntries[relierName]
          moduleProxy.entries.base = relierName


          if (moduleProxy.entries.spec !== undefined) {
            _.forEach(moduleProxy.entries.spec, function (spec, entryName) {

              //处理 events
              var busProxy = new BusProxy
              spec.serverEvents.forEach(function (initializer, initializerIndex) {
                var eventAndListeners = initializer(busProxy)

                _.forEach(eventAndListeners, function (listeners, event) {
                  if (!_.isArray(listeners)) {
                    listeners = [listeners]
                  }

                  listeners.forEach(function (rawListener, listenerIndex) {
                    //注意，这里是把initializer存起来
                    //因为每次 request 来时要重新生成 galaxy 再生成事件函数
                    var listener = {
                      initializerIndex: initializerIndex,
                      listenerIndex: listenerIndex
                    }

                    if (_.isFunction(rawListener)) {
                      listener.fn = rawListener
                    } else {
                      _.extend(listener, rawListener)
                    }

                    busProxy.on(event, listener)
                  })
                })
              })


              //扩展 context,告诉前端可用的服务器端事件
              //console.log('bus proxy', busProxy.events)
              root.extendContext(moduleProxy.entries.spec, entryName, busProxy.events, relierName)

              //记录一下 spec
              if (root.relierSpecs[relierName] === undefined) root.relierSpecs[relierName] = {}
              root.relierSpecs[relierName][entryName] = spec

              //修改一下spec的数据结构便于查找
              //TODO 不能用 proxy 里面的函数， 因为 types 是有问题的，必须每次重新生成。
              //因为 nodesCaches 是传入的。
              root.relierSpecs[relierName][entryName].events = _.mapValues(busProxy.events, function (listeners) {
                return _.indexBy(listeners.map(function (listener) {
                  //其他没用的信息不要了
                  return {
                    name: listener.name,
                    initializer: listener.initializer
                  }
                }), 'name')
              })

              //TODO 为什么要修改？
              //var types = root.relierSpecs[relierName][entryName].types
              //
              //root.relierSpecs[relierName][entryName].types = _.zipObject(
              //  types.map(function( type ){ return type.type }),
              //  types
              //)


            })
          }


        }

        //手工 extend 自己一下
        root.deps['theme-react'].extend(moduleProxy)
      })
    },
    //TODO fix before
    before: ['theme-react']
  },
  extendContext: function (spec, entryName, events, moduleName) {
    extendObject(spec, `${entryName}.context`, function (_context) {
      var newContext = {
        serverEvents: events,
        moduleName: moduleName,
        entryName: entryName
      }

      if (typeof _context === 'function') {
        return function () {
          return _.extend(_context(), newContext)
        }
      } else {
        return _.extend(_context || {}, newContext)
      }
    })
  },
  routes: {
    'POST /roof/call': function *() {
      console.log('roof/call', this.session)
      var moduleName = this.request.body.module
      var entryName = this.request.body.entry
      var eventName = this.request.body.event
      var listenerIndex = this.request.body.listenerIndex
      var initializerIndex = this.request.body.initializerIndex
      var args
      var bus = roofModule.deps.bus.clone()
      //把 request 也给 bus
      bus.req = this

      var spec = _.get(roofModule.relierSpecs, [moduleName, entryName])
      var initializer = _.get(spec || {}, ['serverEvents', parseInt(initializerIndex)])

      if (initializer === undefined) return this.body = `wrong initializer index ${initializerIndex}`

      var galaxies = new Galaxies(roofModule.backendHandler, spec.types)
      var eventAndListeners = initializer(galaxies, galaxies.types)

      var listeners = _.isArray(eventAndListeners[eventName]) ? eventAndListeners[eventName] : [eventAndListeners[eventName]]
      var listenerFn = (typeof listeners[listenerIndex] === 'function') ? listeners[listenerIndex] : listeners[listenerIndex].fn


      if (listenerFn === undefined) return this.body = `wrong listener index ${listenerIndex}`

      //TODO 浏览器端的名字如何和当前名字匹配？


      args = roofModule.parseArgs(this.request.body.args, spec.types)
      //构造事件栈，为了得到 stack

      var that = this
      var result, error
      try{
        result = yield bus.fire('roof.call', listenerFn, args)
      }catch(e){
        error = e
      }


      console.log('bridge result', result)

      //Todo 变成 EJON?
      //TODO 这里是固定的名字，是否不好
      var listenerRuntime = bus._runtime.stack[0].listeners['roof.serverListenerProxy']

      //Todo 缺 runtime 的当前 data 信息
      //Todo 缺 runtime 的global data 信息
      console.log('resopond session', that.session)
      that.body = {
        runtime: {
          data: result && result.data.valueOf(),
          stack: listenerRuntime.stack,
          result: listenerRuntime.result
        },
        error: error
      }

    }
  },
  listen: {
    'roof.call': function *serverListenerProxy(fn, args) {
        return isGenerator(fn) ? yield fn.apply(this, args) : fn.apply(this, args)
    }
  },
  parseArgs: parseArgs,
  backendHandler: function (type, args) {
    //TODO roof-zeroql 不支持 generator
    var taurus = roofModule.deps.taurus.getCollection('centurion')
    return co(function *() {
      if (type === 'query') {
        let result = {}
        for (let queryName in args) {
          result[queryName] = yield taurus.pull(args[queryName])
        }
        return result

      } else if (type === 'push') {
        return yield taurus.push(args.ast, args.rawNodesToSave, args.trackerRelationMap)

      } else if (type === 'destroy') {
        return yield taurus.destroy(args.type, args.id)
      }
    })
  }
}

module.exports = roofModule
