---
"@objectstack/runtime": minor
"@objectstack/rest": minor
---

feat(runtime,rest): `/packages` 域补齐授权门 —— 写/破坏性路由要求 `manage_metadata`,读路由要求 D4 读集,全域匿名门 (#7033) (#7023)

`/packages` 是最后一个零授权判据的路由域:普查实测一个连 `userId` 都没有(身份解析为
`principalKind: 'guest'`)的调用方,对**破坏性**的 `POST /:id/discard-drafts`、整包
`GET /:id/export`(27 种 metadata)、`GET /packages`(id 枚举面)与 `POST /:id/publish-drafts`
一律得 **200** 并真的调进目标函数;而隔壁五个同族域(`/meta`、`/actions`、`/automation`、
`/ai`、`/security`)都带 `shouldDenyAnonymous` 匿名门。本次按维护者 2026-08-09 裁定补齐:

- **全域匿名门**:`shouldDenyAnonymous` 作为 `handlePackagesRequest` 的**第一条语句**,
  在 ObjectQL registry 探测之前,使匿名调用方拿不到 401-vs-503 的部署指纹。
- **写 / 破坏性路由**(install / enable / disable / publish / publish-drafts /
  discard-drafts / commit-revert / rollback / revert / adopt-orphans / duplicate /
  manifest-PATCH / DELETE)要求 `manage_metadata` —— 与 #6603 / #7019 给 `/meta` 写面
  落的同一道门、同一判据(「能写 schema 的人就该是能管理 package 的人」)。
- **读路由**(list / detail / commits / export)要求 ADR-0106 D4 读集
  `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES`(`studio.access` / `setup.access`)—— **引用
  该常量,不复制**,使 package 读取的能力集不会与 metadata 掩码豁免集漂移。
- 门覆盖**两个 transport**:runtime dispatcher 域(`domains/packages.ts`)**与**
  `@objectstack/rest` 直挂注册器(`package-routes.ts` 的 `refusePackageRequest`,
  经 `RestServer.resolvePackageRouteExecutionContext` 解析与其余表面同一身份)。缺
  resolver 时 REST 侧**失败即关**(401),不留裸露回退。所有门都在协议/服务解析**之前**
  判,拒绝时不写不删(防「先删后拒」)。`isSystem`(不可从线上伪造)旁路,CORS `OPTIONS` 放行。

**盲区(明说,勿当已核):** `cloud` 仓在本会话与前序普查会话中**均未挂载**(`add_repo`
两次被拒),调用方普查**不覆盖该仓**。若 `cloud` 内存在直打 `/api/v1/packages/*` 或
dispatcher `/packages` 且今天不持 `manage_metadata` / D4 读集的生产调用方,本门可能将其
403 —— 落地后需在 `cloud` 补一次调用方普查复核。`#7020` 记录的「门能力集 ≠ D4 掩码豁免集」
对齐方向仍归维护者,本次不动。
