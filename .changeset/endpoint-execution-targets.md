---
'@objectstack/runtime': minor
---

**声明式端点的执行目标委派:`endpoint-executor` 纯模块(#5040 E5)**

命中的 `apis:` 端点按 `type` 委派到**既有**执行管线,零新执行语义 —— 这是 #5040 §4 的裁决:声明式端点是既有管线的「稳定 URL 别名 + 策略层」,不是第二套执行方言;同一操作经声明端点与经内建路由必须得到一致的答案。

- `type: object_operation` → `action-execution.callData`,参数形状逐条对齐 `/data`(`find`→`('query', {object, query})`、`get`→`('get', {object, id, select?, expand?})`、`create`→`('create', {object, data})`、`update`→`('update', {object, id, data})`、`delete`→`('delete', {object, id})`)。记录 id 取 `query.id`(词表未定义路径模板,执行器不发明一套);`object` **只**来自声明,请求改不动它。身份信封(`executionContext`)在五个操作上一律透传 —— #4936 摘除的死代码正是丢了这个参数,真跑起来会以 system 身份绕过 RLS。
- `type: flow` → `IAutomationService.execute(target, buildAutomationContext(body, ctx))`,复用 `/automation` 触发路由**同一个**上下文构造函数(该函数因此从 `domains/automation.ts` 导出):`{recordId, objectName, params}` 翻译与完整身份信封转发一并继承,`runAs:'user'` 的流程不会 fail-closed 被拒(#3760)或以他人身份运行(#1888)。automation 槽为空或自称非 handler 时答 501,携带 discovery 同款处方句(ADR-0076 D12)。
- `type: script` / `proxy`,以及缺 `objectParams` 的 `object_operation`:结构化 **501 NOT_IMPLEMENTED**(带处方),不猜语义。这个「不支持子集」在模块里只列一处,供 E7 的 publish 门直接照读。
- 失败一律走既有错误包络:状态优先级与 `details` 组装照抄 `HttpDispatcher.errorFromThrown`(`.status` → `.statusCode` → 校验失败 400 → 兜底 500),5xx 消息过 `looksLikeInternalErrorLeak` 消毒(#3867/#3918)。新模块已加入 `error-envelope.conformance.test.ts` 的源码扫描名单。

**本次落地不接线**:调度步(`api-endpoint-step.ts`)命中后仍答 501,把它换成「策略 → 执行」链是随后的小型接线单(等 E4 #5091 一并落地);叠加 publish 对非空 `apis:` 的硬拒(E7 前不撤),该模块结构性不可达,现网行为零变更。
