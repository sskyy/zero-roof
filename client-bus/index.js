
var clientBusModule = {
  clientListeners : {
    /*
     moduleName : {
      events : {},
      argumentsWrapper : {}
     }
     */
  },
  routes : {
    'POST /client-bus/fire' : function *(){
      var moduleName = this.body.module
      var event  = this.body.event
      var entry  = this.body.entry
      var args = this.body.args


      var result = yield clientBusModule.deps.bus.fire.apply(clientBusModule.deps.bus,[`${moduleName}::${event}`].concat(args))

      //TODO 怎么把事件树传回给前端
      this.body = result

    }
  },
  extend : function( module ){
    if( module.clientListen ){
      root.clientListeners[module.name] = {
        events : [],
        argumentsWrapper : {}
      }

      _.forEach(module.clientListen, function( listeners, event){
        //make it a array
        listeners = [].concat(listeners)
        listeners.forEach(function(listener){
          root.on( event, listener, module.name)
        })

        root.clientListeners[module.name].events. push( event )
      })
      //TODO 增加 arguments wrapper
    }
  },
  bootstrap : function(){
    for( var moduleName in this.clientListeners ){
      for( var eventName in this.clientListeners[moduleName]){
        this.deps.bus.on(`${moduleName}::${eventName}`, this.clientListeners[moduleName][eventName])
      }
    }
  },
  getServerEventNames : function( moduleName ){
    return Object.keys( this.clientListeners[moduleName].events )
  }

}

module.exports = clientBusModule