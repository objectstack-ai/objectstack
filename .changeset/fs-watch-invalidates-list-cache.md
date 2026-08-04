---
"@objectstack/metadata": patch
---

fix(metadata): 文件系统改动同样失效本节点的 `listCache`/`registry`,不再只叫醒 watcher (#5218)

`NodeMetadataManager.handleFileEvent()` 在 chokidar 报告 `add` / `change` /
`unlink` 之后只做两件事:重新 `load()` 一次文件内容,然后 `notifyWatchers()`。
它既不碰 `listCache` 也不碰 `registry` —— 而 `load()` 是纯读路径(它委托给
`loadDiagnosed`,后者只遍历 loader),两个缓存都不写。

后果是**同一个 manager 的两个读接口互相矛盾**。手改 `rootDir` 下的
`view/<name>.json` 之后:

- `get(type, name)` 是新的 —— 它穿透到 `FilesystemLoader`;
- `list(type)` 在 `LIST_CACHE_TTL_MS`(30 秒)窗口内继续返回改动前的清单 ——
  REST `/api/v1/metadata/:type`、Studio 左栏、`listViews()` 等一切走 `list()`
  的读都受影响。

更糟的是被这次事件叫醒的消费者(Studio HMR/SSE 流、ObjectQL SchemaRegistry
桥)正是通过回头拉 `list()` 来响应的,于是这次唤醒**递回了它自己刚刚宣告已失效
的那份数据**。

这与 #5109(集群对端写入不失效本节点缓存)是同一形状、不同触发源,因此复用该
修复落地的 `invalidateForForeignWrite(type, name)`(可见性由 `private` 放宽为
`protected`):文件改动正是「不是经由本 manager 写接口发生的写入」,没有任何东西
替它刷新过缓存,delete-而非-预填 的语义也正好对上 —— 穿透回 loader 读到的就是
文件的真相。

两点与基类其余写路径一致的约束:

- **先失效,再通知**(`register` / `unregister` / `applyRepoEvent` / 集群订阅者
  都是这个次序),使 watcher 不可能同时观察到事件与事件前的缓存;
- **registry 条目一并删除**,不只是列表缓存。FS 加载的条目本来就不进 registry,
  通常无可删;但当同名条目此前被 `register()` / `registerInMemory()` 写过时,
  它在 `get()` 和 `list()` 中都会**遮蔽** loader,只删列表缓存会让那份陈旧副本
  一直应答下去。

命中面主要是开发期:`MetadataPlugin` 默认 `watch: true`,在
`bootstrap: 'artifact-only'` 下被强制关闭,`standalone-stack` 显式传
`watch: false`。因此 artifact 模式的 `os dev` 与 standalone 不受影响,非 artifact
的默认 `MetadataPlugin` 装配受影响。

`type === 'api'` 的行为不变:端点索引此前已由 #5089 装的 `subscribe('api', …)`
那条缝覆盖,本次改动把 `invalidateListCache` 那条缝也接上,两条缝对称。
`EndpointMatcher.invalidate()` 是两次赋 `undefined`,重复失效幂等。
