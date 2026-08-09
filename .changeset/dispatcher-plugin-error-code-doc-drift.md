---
"@objectstack/runtime": patch
---

docs(runtime): `errorResponseBase` 文件头不再把 `details.code` 说成线上位置 (#6270)

**纯注释改动，零行为变更。** 没有一行运行时代码被触碰，线上响应体与本次改动前逐字节相同。修的是
`packages/runtime/src/dispatcher-plugin.ts` 文件头里一句会误导下一个改这个函数的人的话。

原文说：`details.code`（#3842, below）carries `READ_SCOPE_COMPILE_FAILED` **to the
client** untouched，so **what a machine reads** is unchanged。这两个断言讲的都是**线上位置**，
而 #5811 之后线上位置不是 `details.code`：`errorResponseBase` 只是把 code **暂存**进一个本地
`details` 对象，`buildApiError` 随即跑 `splitSemanticCode`，把它**提升**进 `ApiErrorSchema`
声明的 `error.code` 字段，并把已经空掉的 `details` 返回为 `undefined` —— 于是 `details` 键整个
从 body 中消失，`error.details.code` 根本不存在可读。实测 500 body 就是：

`{"success":false,"error":{"code":"READ_SCOPE_COMPILE_FAILED","message":"Internal server error","httpStatus":500}}`

这是同一句话漂移的**第四处**。#6123（PR #6264）修了前三处，并明文把 `dispatcher-plugin.ts` 划为
⛔ 只读参考面，所以第四处按 PD #10 单独立单。措辞刻意与 #6264 在另外三处落的保持一致 —— 这里的价值是
四处同一句话，而不是第四种独立说法。

危害方向比前三处更陡：前三处的受害者是读 CHANGELOG / 读 `service-analytics` 的人，这一处的受害者
**就站在做暂存的那个函数里**，读到「details.code carries it to the client」会直接把**本地变量名**
当成**线上契约**。注释里因此明写了一句 `Do not mistake the local variable name for the wire contract`。

顺带把同一 doc block 里 `:452`-`:457` 那段 JSON 示例的时态钉明确：它展示的是 #5811 **修复之前**的
泄漏形态（message 原文直接落在 body 里），与新补的当前 body 并排读极易混淆。现在 fence 顶部有一行
`⚠️ PAST TENSE` 标注并指向 doc block 末尾的当前形态。示例本身**没有删** —— 它记录的是「我们曾经
泄漏过什么」，是这条 `[#5811]` 条目在做的正经工作。

新措辞的真实性由**既有**测试锚定，本次没有新写断言：
`packages/runtime/src/analytics-query-read-scope-withhold.test.ts:218` 用真 `AnalyticsService`
＋真挂载路由断言 `expect(res.body.error.code).toBe('READ_SCOPE_COMPILE_FAILED')`。
