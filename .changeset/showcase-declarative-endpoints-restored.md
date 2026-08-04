---
"@objectstack/example-showcase": patch
---

test(e2e,showcase): showcase 的 `apis:` 回迁,并由真实 boot 探针证明它真的在服务(#5040 E8)

#4936 把 showcase 的两条声明式端点注释掉,不是因为它们写错了,而是因为当时整条端点链零执行:没有任何路由为声明的 `path` 挂载,没有匹配器,每一个键 —— 包括 `authRequired` —— 解析通过而不生效。那时候留着它们就是在演示一个运行时不兑现的能力(Prime Directive #10)。

#5040 的 E1–E7 把执行器建起来、把整面硬拒收窄成逐端点 publish 门之后,那条理由不复存在。本单按**原意**恢复这两条 —— 同名、同 target、同 `authRequired`、同 `cacheTtl` —— 只做 ADR-0121 D1 要求的一处修改:路径迁进本应用的命名空间保留区。

```
- path: '/api/v1/showcase/tasks'
+ path: '/api/v1/apps/showcase/tasks'

- path: '/api/v1/showcase/inquiries/purge'
+ path: '/api/v1/apps/showcase/inquiries/purge'
```

这处修改不是装饰:`manifest.namespace: 'showcase'` 从此是发布的前置条件(声明了 `apis:` 却没有显式 namespace 会被 publish 拒绝),而 `apps/{namespace}/` 这一段让路由归属变成结构性的 —— 没有任何内建域住在 `apps/` 下,两个包也不可能因为 namespace 不同而撞车。

**匿名面没有增加**:两条历史声明本来就都是 `authRequired: true`,回迁后仍然是。一个例子不该长出它从来没有过的公开面。

coverage 清单里 `apis` 从 `waived` 翻回 `demonstrated`,理由重写为「由真实 boot 测量」而不是「声明即证明」—— 后者正是 #4936 抓到的那类假覆盖。支撑它的是两份新的真实 boot e2e:showcase 那份走真实 artifact 摄入路径,证明匹配命中执行(find 的 data 与内建 `/data` 路由逐字节相同)、匿名 401、`cacheTtl` 只随成功答案上线、挂载点下未声明路径与挂载点外的裸 404 完全一致、`/meta/api` 与 `/openapi.json` 描述的正是挂载的东西;fixture 那份补上 ADR-0121 D6 的匿名分支 —— 省略 `authRequired` 拒绝匿名、显式 `false` 服务匿名、已装配预算耗尽后 429 且 `Retry-After` 真的在线上。
