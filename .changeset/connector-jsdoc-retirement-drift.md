---
'@objectstack/spec': patch
---

connector.zod.ts 的模块 JSDoc 不再宣传已退役的出站限流与字段映射转换

`packages/spec/src/integration/connector.zod.ts` 的模块级 JSDoc 有四处措辞比它描述的 schema 晚了两次退役,而这段 JSDoc 被 `gen:docs` 逐字生成进 `content/docs/references/integration/connector.mdx`——同一页的属性表已经写着「已移除」,散文却还在承诺「comprehensive rate limiting」。读者相信哪一个,取决于他先读到哪一段。

收敛的四处:

- 「Includes authentication, webhooks, **rate limiting**, field mapping, …」
- 「… and comprehensive **rate limiting**.」
- 「- Bidirectional sync with field mapping **and transformations**」
- 「- Webhook management **and rate limiting** required」

出站限流从来没有引擎:平台唯一的令牌桶(`packages/runtime/src/security/rate-limit.ts`)是**入站**的,`connector.rateLimitConfig` 连同 `ConnectorRateLimitConfig` / `RateLimitStrategy` 整个形状已在 `@objectstack/spec` 17.0.0 移除(#4911, ADR-0049 D2)。字段映射同理:`FieldMapping.transform` 与整个 `FieldMappingTransform` 联合已在 17.0.0 移除(#5552, ADR-0049),没有任何 runtime 执行过其中五个成员。

JSDoc 因此新增一节「What this layer does NOT provide」,把两条否定连同处方写明——出站限流请在 connector provider 或上游网关做;取值转换请用会真正执行它的面(import mapping 的 `mapping.fieldMapping[].transform`,或 L2 的 ETL 转换步骤)。措辞直接复用 #4911 / #5552 墓碑与 `SYNC_ARCHITECTURE.md`(#5554)的现成句,一次退役只保留一种说法。

参考文档 `content/docs/references/integration/connector.mdx` 由 `gen:docs` 随动重生成(未手改)。仅注释与生成文档变化,schema 形状与运行时行为不变。
