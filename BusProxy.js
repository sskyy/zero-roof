function BusProxy(){
  this.events = {}
  this.fnIndex = 0
}

BusProxy.prototype.on = function(name, listener){
  if( this.events[name] === undefined ) this.events[name] = []

  if( typeof listener === 'function' ){
    listener = {
      fn : listener,
    }
  }

  if( listener.name === undefined ){
    listener.name =  listener.fn.name ? listener.fn.name : `anonymous_${this.fnIndex++}`
  }

  this.events[name].push(listener)
}

module.exports = BusProxy