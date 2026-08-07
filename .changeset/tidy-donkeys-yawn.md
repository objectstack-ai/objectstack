---
'@objectstack/runtime': major
---

**BREAKING**: `ctx.user.roles` 已移除 —— action body / AI 路由处理器上的调用者位置(positions)只保留一个拼法 `ctx.user.positions`(#6011)

`ActorUser`(action body 的 `ctx.user`、AI 路由处理器的 `req.user`)过去同时发出两个键,值完全相同(`roles` 是 `positions` 的逐字副本)。`roles` 是 ADR-0090 D3 明令保留并禁用的词,且没有关闭日期 —— 维护者 2026-08-06 裁定**立即退役**,不设弃用窗口、不双发。

### 迁移:FROM → TO

```js
// FROM — v17 起该键不再存在,读到的是 undefined
const positions = ctx.user.roles;
if (ctx.user.roles.includes('sales_rep')) { … }

// TO — 权威拼法,值逐字不变
const positions = ctx.user.positions;
if (ctx.user.positions.includes('sales_rep')) { … }
```

一行修复:把 body / 路由处理器里的 `ctx.user.roles` 改写成 `ctx.user.positions`(`req.user.roles` → `req.user.positions`)。**值不变** —— 两个键此前由同一次赋值产生,所以这是一次纯粹的改键,不是改语义。`positions` 数组恒存在,空时是 `[]` 而非 `undefined`,无需 `?? []`。

### ⚠️ 改键不等于修好了权限判断

`positions` 与此前的 `roles` 一样,**都不是授权输入**。权限由 security service 判定(capability 授予、placement、ADR-0095 推导出的 posture),不由名字字符串比较判定。因此:

```js
// 这不是迁移,这是把缺陷换了个拼法
if (ctx.user.roles.includes('admin')) { … }      // 旧的错
if (ctx.user.positions.includes('admin')) { … }  // 一样错,只是改了键名
```

把 `roles.includes('admin')` 改写成 `positions.includes('admin')` 迁移的是**缺陷本身**,不是那次读取。这类判断应改为向 security service 询问能力,而不是比对位置名。(与 #5991 的 `ctx.session` 更名同一告诫。)

### 不受影响的面

- **`ctx.session.roles` 不在本次范围内**,仍按 #5613 的弃用窗口双发 `positions` + `roles`,由 ADR-0087 语义迁移 `action-session-roles-to-positions` 约定其关闭时点。两个面同名不同物,请勿混为一谈。
- better-auth 会话上的 `user.roles`、`/api/v1/auth/me/permissions` 返回体的 `roles`、CEL/formula 的 `current_user.*`,都是各自独立的生产者,均未改动。
