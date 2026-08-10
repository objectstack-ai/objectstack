---
"@objectstack/lint": minor
---

feat(lint): `validate-ai-agent-authoring` 新增 `app.defaultAgent` 取值检查(warning 档,#6041)

`app.defaultAgent` 的 Zod 类型是 `SnakeCaseIdentifierSchema`,任何 snake_case
字符串都能 parse、build、通过 `os:check` —— 但运行期只解析平台 agent 名单
(`ask`/`build` 及其历史别名 `data_chat`/`metadata_assistant`,ADR-0063 §2),
表外的名字会静默回落到平台默认值。#5985 实测:把坏例子
`defaultAgent: 'sales_copilot'` 放回语料后,`check:skill-examples` 仍 208
全绿、EXIT=0 —— 现有门禁对这类缺陷结构性失明,这正是坏语料当初得以发布的机制
(语料本身已由 PR #6030 修复)。

本 PR 是 `validate-ai-agent-authoring` 已有规则(此前只扫描 `stack.agents`
数组)的取值半边:遍历 `stack.apps[].defaultAgent`,取值不在
`PLATFORM_AGENT_NAMES`(复用同文件既有名单,未新建重复列表)内即产出一条
`warning` 级 finding(规则 id `default-agent-outside-roster`),消息中点名
实际取值与允许集合。维护者裁定(2026-08-07,2026-08-09 重申)为 **A 档**:
warning 而非 error —— 危害等级是静默回落而非崩溃,且不惩罚存量元数据;
schema 本身不收窄为 enum(ADR-0063 已经撤回过一次 breaking 的收紧)。

落地前已按裁定要求测量现存 in-repo `app.defaultAgent` 取值:仅
`packages/platform-objects/src/apps/studio.app.ts` 一处真实赋值
(`defaultAgent: 'metadata_assistant'`,合法平台别名),对该值实际跑规则
0 条 finding —— "不惩罚存量" 的前提已验证而非假设。
