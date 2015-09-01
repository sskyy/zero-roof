var _ = require('lodash')
var BusProxy = require('./BusProxy')


//TODO remove polyfill
require('core-js/modules/es6.array.from.js')
require('core-js/modules/$.array-includes.js')



function extendObject( obj, key, handler ){
  var keys = key.split('.')
  var lastKey = keys.pop()

  var currentKey
  var cursor = obj


  while( (currentKey = keys.shift())!== undefined){
    if( cursor[currentKey] === undefined) cursor[currentKey] = {}
    cursor = cursor[currentKey]
  }

  cursor[lastKey] = handler( cursor[lastKey] )
}


///////////////////////////////////
//                 exports
///////////////////////////////////

var roofModule = {
  extend: function ( module ) {
      this.relierAssets[module.name] = module.assets
      this.relierEntries[module.name] = module.entries
  },

  serverEvents : {},
  relierAssets : {},
  relierEntries : {},
  relierSpecs: {},
  bootstrap : {
    fn : function(){

      var root = this


      _.forEach( this.reliers, function( relier, relierName){

        var moduleProxy = {name: relierName}
        if(root.relierAssets[relierName]) moduleProxy.assets = root.relierAssets[relierName].map(function(asset){
          return _.defaults( asset, {
            base : relierName
          })
        })

        if (root.relierEntries[relierName]){
          moduleProxy.entries = root.relierEntries[relierName]
          moduleProxy.entries.base = relierName


          if( moduleProxy.entries.spec  !== undefined ){
            _.forEach( moduleProxy.entries.spec, function( spec, entryName ){

              var busProxy = new BusProxy
              spec.serverEvents.forEach(function( initializer){
                initializer(busProxy)
              })


              //扩展 context
              root.extendContext( moduleProxy.entries.spec, entryName,  busProxy.events, relierName)

              //记录一下 spec
              if( root.relierSpecs[relierName] === undefined) root.relierSpecs[relierName] = {}
              root.relierSpecs[relierName][entryName] = spec

              //修改一下spec的数据结构便于查找
              root.relierSpecs[relierName][entryName].events =  _.mapValues(busProxy.events, function( listeners ){
                return _.indexBy( listeners, 'name')
              })

              var types = root.relierSpecs[relierName][entryName].types

              root.relierSpecs[relierName][entryName].types = _.zipObject(
                types.map(function( type ){ return type.type }),
                types
              )

              //root.relierSpecs[relierName][entryName].types = _.zipObject(
              //  types.map(function( type ){ return type.def.type }),
              //  types.map(function( type ){ return root.rewritePrototype( type )})
              //)

            })
          }


        }

        //手工 extend 自己一下
        root.deps['theme-react'].extend(moduleProxy)
      })
    },
    //TODO fix before
    before : ['theme-react']
  },
  extendContext : function( spec, entryName, events,  moduleName){
    extendObject( spec, `${entryName}.context`, function( _context){
      var newContext =  {
        serverEvents : events,
        moduleName : moduleName,
        entryName : entryName
      }

      if( typeof _context === 'function'){
        return function(){
          return _.extend( _context(),newContext )
        }
      }else{
        return _.extend( _context || {}, newContext)
      }
    })
  },
  routes : {
    'POST /roof/call' : function *(){
      var moduleName = this.request.body.module
      var entryName = this.request.body.entry
      var eventName = this.request.body.event
      var listenerName = this.request.body.listener
      var args

      var spec = _.get(roofModule.relierSpecs,[moduleName,entryName] )
      var listener = _.get( spec||{}, ['events', eventName, listenerName])

      if( listener ){

        args = roofModule.parseArgs( this.request.body.args, spec.types )
        //构造事件栈，为了得到 stack
        yield roofModule.deps.bus.fire('roof.call', listener.fn, args )

        //TODO 整合事件栈
        this.body = `${listenerName} fired}`
      }else{
        console.log(roofModule.relierSpecs,  [moduleName,entryName,eventName,listenerName])
        this.body = `listener ${listenerName} not found`
      }
    }
  },
  listen : {
    'roof.call' : function *( fn, args ){
      return yield fn.apply(null, args)
    }
  },
  parseArgs : function( args, types ){
    return args.map(function( arg ){
      var output = arg
      var NodeClass
      //TODO 用 EJSON 判断
      if( arg.def !== undefined && arg.def.type !== undefined && types[arg.def.type] !== undefined){
        //TODO 增加 collection
        NodeClass = types[arg.def.type]
        output =  new NodeClass(arg.data)
        if( arg.$relations ){
          arg.$relations.forEach(function(relation){

            relation.value.forEach(function( relateNodeArg){
              var RelateNodeClass = types[relateNodeArg.def.type]
              var relateNode = new RelateNodeClass( relateNodeArg.data )
              output.relate( relateNode, relation.key )
            })

          })
        }
      }

      return output
    })
  },
  //rewritePrototype : function( type ){
  //  rewriteSync( type, this.deps.neo4j.backend )
  //}
}

module.exports = roofModule
