---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `publishPackageDrafts` 现在对 `api` draft 跑 ADR-0121 端点发布门 (#5206 step 2)

`protocol.publishPackageDrafts` 是 Studio「全部发布」的真实入径(ADR-0033 /
ADR-0067 D2)。在此之前,它唯一的按类型前置检查是对象命名空间前缀
(`validateObjectNamespacePrefix`,仅 `d.type === 'object'`),于是一条 `api`
draft **不经任何一道门**就被提升为 `active` —— 与 #5189 在
`MetadataManager.publishPackage` 上修掉的是同一形状、另一条路。

安全后果早已被 PR #5203 的装载期兜底挡住:端点匹配器在建索引时用同一个
`firstFailure` 重判每一条存量条目,没过门的被排除出索引并 `error` 点名。所以
这次修的是**拒绝得太晚**:ADR-0121 的原文是「publish 拒绝」,作者应当在
publish 当场拿到点名 key 的处方,而不是到装载期日志里才发现自己的端点在答
404。

**判据只有一份。** 本改动调用 `@objectstack/spec/api` 导出的
`validateApiEndpointDeclarations`(#5203 公开)—— 就是 stack schema 跑的那个
函数、`publishPackage` 跑的那个函数、装载期兜底跑的那个 `firstFailure`。拒绝
文案直接用门函数自己的消息(已包含端点名、越界的 key 和改法),本包不复述任何
一条「什么算可服务」的规则。

与 `publishPackage` 不同,这条路**有身份**:包的 `manifest.namespace` 本来就
为对象前缀规则读过了,所以这里跑的是**全量门**,命名空间门(ADR-0121 D1/D2)
包含在内。命名空间门**不**以「包声明了 namespace」为条件 —— 门函数自己的前置
判据(声明了 `apis:` 的 stack 必须显式声明 `manifest.namespace`)本身就是一条
判据,对「压根没有 namespace」的包跳过它,等于给最不可能过编译期的那批包留一
个洞。对象前缀规则对无 namespace 的包网开一面,是因为一个裸对象名只是命名气味;
一个无命名空间的端点是一个**无主 URL**。

**行为变化(用户可见)**:

- 一条 `api` draft 若违反端点门(最典型:ADR-0121 D6 —— `authRequired: false`
  却没有 `rateLimit.enabled: true` 的预算),`publishPackageDrafts` 现在返回
  `success: false` / `publishedCount: 0`,该条目进入 `failed[]`,`code`
  为 `ENDPOINT_GATE`;body 连 `ApiEndpointSchema` 都不满足的,`code` 为
  `ENDPOINT_SCHEMA`(解析是判定的前置,不是第六道门 —— 判不了的形状也服务不
  了)。
- **失败粒度沿用既有语义,未发明新的批次语义**:与命名空间前缀违规完全一致,
  这是一次**提升任何东西之前**的前置拒绝,整批不落地(`published: []`),同批
  的健康 draft 保持 draft 态。这既是 ADR-0067 D2 的「一次 commit 不能落一半」,
  也是 #5189 在另一条路上的同一姿势(`itemsPublished: 0`)。两类违规现在合并
  在**同一份报告**里返回,作者一次往返就能看全。
- 判定范围是**本批被提升的 draft**,与紧邻它的对象前缀规则一致。与同包已
  `active` 的端点撞车不在此拦截 —— 匹配器对全库重复声明有确定性裁决并 `error`
  点名(`buildEndpointIndex`);把范围扩到整包 active 集合意味着「因为你没在发
  布的东西而拒绝这次发布」,那是另一份契约,不是一个 bug 修复。

装载期兜底(#5203)原样保留,未移除也未削弱:publish 是**更早**的那道门,不是
最后那道门的替代品。

`api` 进 `DEFAULT_METADATA_TYPE_REGISTRY` / `BUILTIN_METADATA_TYPE_SCHEMAS`
(即 Studio 直写路径的 422)是 #5206 的第 1 步,拆在子单 #5271(spec 车道);
本改动**不依赖**它落地。
