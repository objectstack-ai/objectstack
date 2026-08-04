---
'@objectstack/spec': patch
---

fix(spec): `areas[].requiredPermissions` 的退役处方改口径 —— 项级闸门在**两棵树**都由服务端剥离(#4749)

`AREA_REQUIRED_PERMISSIONS_RETIRED` 是作者写错 area 级键时唯一能读到的文字(strict
schema 的 unknown-key 报错正文)。它此前写着:

> Items nested under `areas[]` are gated in the shell only — the server does not
> walk `areas` — so anything that must never reach the browser belongs in the
> top-level tree, or in its own app.

这句话在 #4722 之后已经过时。`filterAppForUser` 现在对每一棵 `areas[].navigation`
跑**同一个** `filterNav`,所以导航**项**上的 `requiredPermissions` / `requiresService`
在顶层树和 area 内部被同等强制,被闸住的条目(连同它的 `objectName` / `pageName` /
`componentRef` 目标)根本不会进入 `/meta` 响应体。

方向上这是「过度保守」而非不安全 —— 它劝作者把敏感项挪到顶层树,那仍然可行 —— 但它错了,
而且错在**说给作者听的**那一份上:一个本可以就地把 `requiredPermissions` 写在 area 内部项
上的作者,会被这段话劝去重构导航树。

处方正文改后陈述当前事实,并保住 #4722 **没有**改变的那一半非对称性:`visible`(CEL)与
`requiresObject` 在任何层级**依然只在客户端求值**(服务端跑 CEL 需要读层没有的 `user`
绑定上下文)。所以「必须永不到达浏览器」的东西写 `requiredPermissions`,不要写 `visible`
—— 这一条在 #4722 之后反而更容易被误读,因此写进了正文并单独钉了 pin。

退役裁决本身不动:被强制的是 area **内部的项**,area **级**键(`areas[].visible` /
`areas[].requiredPermissions`,#4651)保持退役,没有复活。

行为零变化 —— 改的是报错正文与它的 pin 断言,以及 `app.zod.ts` 里同一段已随 #4722 过期的
说明性注释。
