---
"@objectstack/rest": minor
---

fix(rest)!: 服务端权威闸门现在也过滤 `areas[].navigation` —— area 内导航项的权限/能力闸门不再只是渲染层的礼貌 (#4722)

`filterAppForUser` 是 `/meta` 上 app 元数据的**服务端权威可见性闸门**,但它此前只走 app
的顶层 `navigation` 树:读到 `item.navigation` 不存在就原样返回,`item.areas` 从头到尾没被
读过。后果是,写在 **area 内部**导航项上的 `requiredPermissions` / `requiresService`
只有客户端 `NavigationRenderer` 会执行 —— 该条目连同它的 `objectName` / `pageName` /
`componentRef` 指向,照常出现在 `/meta` 响应体里。改一次前端状态、或者直接读 `/meta` 的
JSON,就能看到本该被 gate 掉的条目。对 areas 型 app 而言,导航项级闸门此前**不是**服务端强制。

**现在**:同一个 `filterNav` 被复用到每一棵 `areas[].navigation` 上 —— 不是第二份实现,
所以两棵树对同一个键的语义不可能漂移。列表 `GET /meta/apps` 与单项 `GET /meta/apps/:name`
两条路径都覆盖(两者都经过这个函数;单项读对 app 类型本就绕过缓存)。

**响应形状收紧(可能影响消费方)**:无权限用户拿到的 app 元数据里,被 gate 掉的 area 内
导航项**不再出现**。被闸门滤空的 area 整个剥离 —— 与顶层树对「被滤空的 group」的既有处理
同形(空壳标签没有消费价值);作者本就写成空的 area 原样返回(过滤只报告调用方看不到什么,
不负责整理元数据)。任何依赖「服务端会把 area 内条目全量下发、由客户端自己藏」的消费方需要
改为信任服务端已过滤后的树 —— 这正是本次收紧的目的。

同一提交修正了 `resolveRegisteredServices` 的探测面:它此前每个节点只取第一个命中的子数组
(`navigation` / `children` / `widgets` 三选一),不会下钻 `areas`。若不改,只在 area 内被
引用的服务名不会被探测,而未探测的名字在闸门看来等同于「服务不存在」,会把一个本该存活的
条目误剥离 —— 探测面必须与过滤面完全一致。

**明确不做**:`visible`(CEL)在任何层级仍然只在客户端求值 —— 服务端求值需要绑定 `user`
上下文,不是这个读路径现有的能力,另立单处理。这个不对称写进了代码注释、`packages/spec/liveness/app.json`
的账本 note,以及 `rest.test.ts` 的 characterisation pin。必须永不到达浏览器的东西,写
`requiredPermissions`,不要写 `visible`。#4651 退役的 **area 级**键(`areas[].visible` /
`areas[].requiredPermissions`)未被复活:本次强制的是 area **里面**的项级闸门。
