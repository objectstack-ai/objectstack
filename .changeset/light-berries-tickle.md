---
'@objectstack/runtime': patch
---

sandbox: `ScriptContext.user` 由 `unknown` 收窄为命名联合 `ScriptUser`(#5521)

沙箱接缝 `ScriptContext`(`packages/runtime/src/sandbox/script-runner.ts`)把交给 hook /
action body 的调用者声明为 `user?: unknown`,类型系统对这个字段一无所知 —— 第四个
dispatch 面明天再手搓一个 user 字面量,编译器不会说一句话。而"三个 dispatcher 手搓出三种
形状"正是 #5372 的成因:它能存在几个版本,部分原因就是没有任何声明可以违背。

现在它是 `user?: ScriptUser`,`ScriptUser = ActorUser | HookContext['user']` —— 两个**实测
的真实生产者形状**的联合,与 33 行外的姊妹字段 `ScriptSession`(#5613 / #5991)同构:

- action body 收 `ActorUser`(`security/actor-user.ts`,#5372 起的唯一生产者,#6011 后
  `positions` 为唯一拼法);
- hook body 收 `HookContext['user']`(ObjectQL `buildUser()` 的 `session.userId` 快捷方式:
  `id` / `name` / `email` / `organizationId`,全部可选)。

刻意**不**收成单一类型:hook 快捷方式不带 `positions` / `permissions` / `systemPermissions`,
收成 `ActorUser` 会在 hook 面断言一套它从未生产过的授权词汇;也**不**收成 spec 的
`EvalUser`(issue 选项 1)—— 实测 `buildUser()` 根本不产 `positions`,而 `EvalUser` 要求它,
那是套着 spec 外衣的同一种过度声明。

行为零变化:两个写入方从 `any` 引擎上下文赋值,唯一的 VM 侧读取方收 `unknown`。TS 消费者
可见,故走 patch。`ActorUser` 同时作为**类型**从包入口导出,使联合的两支都可被消费者命名。
