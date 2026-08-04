---
"@objectstack/runtime": patch
---

fix(runtime,tooling): `saveMetaItem` 进入持久性词表,包发布的可见性翻转不再静默丢写 (#4754)

#4632 立的「Degradation log levels」规则由 `pnpm check:durability-log-level` 机械执行,
但它只认 `DURABILITY_CRITICAL_CALLEES` 这张显式词表 —— 词表以外的持久性接缝它发现不了。
#4669 的事故正是这一类:`protocol.saveMetaItem()` 失败被吞掉,整条投影路径停摆却一个红灯
都没有,跨了一个发布周期才被偶然看见。本次把 `saveMetaItem` 加进词表,并把它照出来的
每一处逐个判过。

**真丢失的那一处已修好。** `POST /packages/:id/publish-drafts` 的 ADR-0045 可见性翻转
(`packages/runtime/src/domains/packages.ts`)是一次搭别人便车的元数据**写入**:草稿已经
发布,所以这个路由无论如何都答 200,而写失败只会在响应体里留下一个没人读的 `unhideError`。
症状因此是「我明明发布了,应用却没出现」,而且要很久以后才有人把它和这里联系起来 ——
正是 #4669 的形状。现在它按范本在 `error` 级别报告:点名是哪个包、其 app 仍然以
`hidden: true` 存着因而在启动器里不可见、发布却报告了成功,并给出修复动作(重跑
publish-drafts,幂等;或直接 `PUT /meta/app/<name>` 置 `hidden: false`),同时带上原始
错因。响应契约不变 —— 仍然是 200,仍然带 `unhideError`。

**闸门自身的两个精度缺陷一并修掉**(词表加一个条目就让它们暴露了,8 处命中里 4 处是误报):

- **同文件 concise-arrow 报告器看不见。** 闸门文档明说 `catch` 一侧会追同文件的 helper,
  但遍历只访问子节点,而 `const logError = (...a) => console.error(...a)` 的函数体**就是**
  那个调用表达式本身,于是 `rest-server.ts` 里最响的两处 `/meta` PUT 反被判成「完全静默」。
- **一处接缝被按嵌套层数重复指认。** 一个已被内层 `catch` 消化掉的调用,仍然算在每一层
  外层 `catch` 头上 —— 而那些外层多半是正确的路由级错误处理器。`packages.ts` 里同一个
  `saveMetaItem` 因此被报了三次。现在只有当内层 `catch` 每条路径都向外传播时,外层才被
  判定为真正的守卫。

两个修复都在 `--self-test` 里双向钉住(改前必失败,改后才通过),自测用例由 CI 执行。

判定为「故障已答给调用方」的三处(`meta.ts` 的 4xx/422、`protocol.ts` 两处结构化逐项
失败报告)不是降级,记入 shrink-only 基线并附理由与关闭条件(#5241)。
