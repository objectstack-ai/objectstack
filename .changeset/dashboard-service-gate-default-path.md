---
"@objectstack/rest": patch
---

fix(rest): dashboard 组件门禁在默认配置下真正执行 (#5881)

ADR-0057 D10 的 `requiresService` 组件门禁 —— 剔除指向未注册可选服务的 dashboard
磁贴 —— 在默认部署里一次都没跑过。`GET /meta/:type/:name` 的单条读取有一条缓存分支,
它排除了 `app`(per-user RBAC 过滤)与 `doc` / `book`(per-caller audience),唯独没有
排除 `dashboard`;而 `enableCache` 默认为 `true`。门禁写在非缓存分支里,于是只有显式
关掉缓存的部署才会执行到它。

后果正是该 ADR 点名要防的那一幕:在没有某个可选服务的部署里(比如单租户运行时里的
Organizations KPI,其 `org-scoping` 服务不存在),console 会渲染一块绑定到缺失服务的
死磁贴 —— 尽管服务端的门禁代码在、测试也在。

**修复**:`dashboard` 与 `app` 同款,从缓存分支排除,两种拼写(`/meta/dashboard/x`
与规范复数 `/meta/dashboards/x`)都覆盖。其它元数据类型的 ETag 快路径不受影响。

**为什么不是"把门禁提到分支之外、两条路径共用"** —— 那读起来更整齐,但 ETag 无法承载
门禁结论:validator 是**未过滤文档**的哈希,而 `notModified` 在 protocol 内部就已判定,
REST 层没有机会重判。共用之后送出的就是"过滤过的正文 + 指向未过滤正文的 validator"。
一次 boot 之内这没有危害(已注册服务集在 bootstrap 之后不可变),但 `Cache-Control:
private, no-cache` 意味着客户端**存下正文**、之后只做重验证,而存下的正文比进程活得久:
一次关掉该可选服务的重新部署并不改变文档,ETag 不变 ⇒ 每次重验证都回 304 ⇒ 那块死磁贴
恰好在移除其服务的那次部署之后被永久缓存下来。放弃快路径的代价则接近于零:
`getMetaItemCached` 本就委托给 `getMetaItem`,服务端两条路做的是同样的工作,失去的只是
304 省下的正文字节。

对调用方的可见变化:dashboard 的单条读取不再返回 ETag / 304,每次都是完整的 200。
