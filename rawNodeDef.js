//这里的 push 是给自然使用 class 创建的 node 用的，没有 relation信息
//使用 createEntry 后生成 node，使用的就不是这个push了

//独立的 node(有id) 和新建的 node(无id) api 是完全不同的。

var util = require('./util')
var request = require('./request')
var Constellation = require('./Constellation')
var NodeProxyContainer = require('./NodeProxy/NodeProxyContainer')
var assign = require('object-assign')
var zeroQL = require('zeroql')
var uuid = require('uuid')


module.exports = function (nodesCache, types,  def, backend) {

  return assign(def, {
    astRefPath: [],
    ensureProxyContainer: function (relationAst) {
      var constellation
      var thisSign = this.signature()

      if (this.proxyContainer === undefined) {
        constellation = new Constellation(nodesCache, types, backend)
        //初始化
        constellation.init(relationAst, thisSign, this.toObject())
        this.proxyContainer = new NodeProxyContainer(constellation)
        this.proxyEntry = this.proxyContainer.createEntry().get().get(0)
      }
    },


    //////////////////
    //    getRelative
    //////////////////
    getRelative: function (relationKey) {
      //从本地关系中读数据
      //本地必须先调用过 relate

      if (this.proxyContainer === undefined) return undefined


      var queryRelationKey, astRelationKeys, childAstRefPath, ast

      ast = this.proxyContainer.constellation.getAst(this.def.astRefPath)
      queryRelationKey = typeof relationKey === 'object' ? relationKey : {name: relationKey}
      astRelationKeys = this.proxyContainer.constellation.getAstRelationKey(queryRelationKey, ast)

      if (astRelationKeys.length > 1) {
        throw new Error('multiple relation found')
      }

      var result
      if (astRelationKeys.length === 1) {
        childAstRefPath = this.def.astRefPath.concat(astRelationKeys[0])
        console.log('relation key found', astRelationKeys, childAstRefPath, this.signature())
        result = this.proxyContainer.getProxy(childAstRefPath, this.signature())
      } else {
        console.log('relationKey not found', astRelationKeys)
      }

      //已经从 constellation 中读到数据
      if (result !== undefined) return result
    },


    //////////////////
    //          push
    //////////////////
    push: [function () {
      var that = this
      //destroy
      if( this.is('destroyed') ){
        return request(`${backend}?type=destroy`, {type:this.def.type, id:this.signature().id})
      }


      //create or update
      var constellation = that.proxyContainer.constellation

      var ast = this.proxyContainer === undefined ? {
        type: this.def.type,
        tracker: 'v0',
      } : util.cloneDeep(constellation.ast)

      var trackerRelationMap = util.cloneDeep(constellation.trackerRelationMap.data)

      var nodesToSave = {}

      util.walkAst(ast, function (astNode) {

        util.forEach(constellation.trackerRelationMap.getSignByTracker(astNode.tracker), function (sign, id) {
          if (constellation.nodesCache.isCache(sign.type, sign.id)) {

            var def = constellation.types.getNodeDef( sign.type)
            if( nodesToSave[sign.type] === undefined){
              nodesToSave[sign.type] = {}
            }

            var rawNode = constellation.nodesCache.getById(sign.type, sign.id)
            delete rawNode[def.primary]
            nodesToSave[sign.type][sign.id] = rawNode
          }
        })

      })


      return request(`${backend}?type=push`, {ast: ast, trackerRelationMap: trackerRelationMap, rawNodesToSave: nodesToSave}).then(function(){
        //TODO 更新本地数据
        //但是不用更新全局
      })

    }, 'unpushed', 'pushing', 'pushed'],


    //////////////////
    //          pull
    //////////////////
    pull: [function (query) {

      if (this.get(this.def.primary) === undefined) return Promise.reject('this node has no primary key')

      var that = this
      var ast = zeroQL.parse(`${this.def.type}(${this.def.primary}:'${this.get(this.def.primary)}')${query}`).ast

      this.ensureProxyContainer(ast)

      return this.proxyContainer.constellation.sendQuery(ast, []).then(function () {

        //只有第一次需要，以后会自动更新
        if (that.proxyEntry === undefined) {
          //第一个就是自己,将自己的数据保存在自己下面
          that.proxyEntry = that.proxyContainer.createEntry().get().get(0)
        }

      })

    }, 'unpulled', 'pulling', 'pulled'],


    /////////////////
    //       relate
    /////////////////
    relate: function (target, relationName, reverse, props) {

      //只需要对方的签名就够了
      var targetSign = target.signature()
      var thisSign = this.signature()

      var astRelationKey = reverse ? `${targetSign.type} ${relationName}` : `${relationName} ${targetSign.type}`
      var relationAst = zeroQL.parse(`${this.def.type}{ ${astRelationKey} {} }`).ast

      this.ensureProxyContainer(relationAst)
      //必须先addRelation 才能 relate
      //debugger
      return this.proxyContainer.constellation.addRelation([], relationAst)
        && this.proxyContainer.constellation.relate(relationAst, [], thisSign, targetSign, relationName)


    },
    unRelate: function () {

    }

  })

  return def
}
