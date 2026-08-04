---
"@objectstack/metadata": patch
---

fix(metadata): 集群对端的元数据写入现在会失效本节点的 `listCache` / registry (#5109)

多节点部署下,节点 A 改一条 `view` / `permission` / `flow`,节点 B 收到
`metadata.changed` 广播后**只叫醒了 watcher,却没有失效自己的缓存**。
`attachClusterPubSub()` 的订阅回调此前只做一件事 —— `notifyWatchersLocal()`,
既不碰 `this.registry` 也不碰 `this.listCache`。后果是 B 上任何走 `list(type)`
的读在 `LIST_CACHE_TTL_MS`(30 秒)窗口内继续返回改动前的清单;更糟的是,被叫醒的
watcher(ObjectQL SchemaRegistry 桥、Studio HMR SSE)如果回头调 `list()` 重新拉取,
拉到的还是旧的 —— 一份「失效通知」附带着失效数据。单机部署完全无感,只有多节点才暴露。

这与该通道自己声明的用途相反(`ClusterMetadataChangedPayload`:"consumed by peers
to **invalidate their local caches**",另见 `content/docs/kernel/cluster.mdx` §6.2
与 `metadata-lifecycle.mdx`);现在实现与声明一致。

修法沿用同文件里 `applyRepoEvent()` 自 ADR-0008 PR-6 起就用对的那条路径,并把两条
「外部写入」缝(仓库 watch 循环、集群对端回放)收敛到同一个私有方法
`invalidateForForeignWrite(type, name)`:

- **删除而不预填。** 即便事件带着 body,也只删除 registry 条目而不写入 ——
  那份 body 是别人那次写入的快照,可能已被后续写入取代,预填会与真实 head 竞态,
  并要求我们去规范化一份自己没有加载过的定义。删除后 `get()` 自然穿透到 loader /
  repository,也就是真相所在。
- **同步失效,先失效再通知。** 失效发生在收到消息的当拍(不在 `setImmediate` 内),
  通知仍然延迟派发。`setImmediate` 的存在理由是不让**消费方的 watcher 回调**背压
  pubsub 派发循环;而失效只是两次 `Map.delete`,不执行任何消费方代码,没有需要延迟的
  东西——把它一起延迟只会留下「已收到广播、尚未失效」的读窗口,请求处理器里任何一个
  `await` 都足以撞进去。先失效后通知也与本文件其他写入路径
  (`register` / `unregister` / `applyRepoEvent`)一致,于是回头 `list()` 的 watcher
  拿到的是写后清单。
- **无名事件只失效清单缓存。** `MetadataWatchEvent.name` 在 spec 里是可选的,无名事件
  无法定位 registry 条目;此时不会把整个 type 的 registry 一并清掉 —— 那会驱逐
  `registerInMemory()` 注册的、任何 loader 都无法恢复的代码态构件(如 `origin:'code'`
  的 datasource)。

回环抑制(`originNode`)仍然先于失效判断,本节点自己的广播不会让自己白白重建缓存。
