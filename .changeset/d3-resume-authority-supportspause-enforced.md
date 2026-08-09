---
'@objectstack/spec': patch
---

docs(spec): D3 迁移账本里 `resumeAuthority` 那条的验收标准不再要求手工排查 `supportsPause` 不一致 —— #6746 之后引擎自己会拒绝 (#6844)

`MIGRATIONS_BY_MAJOR[17].semantic` 中 `action-descriptor-resume-authority-default-flip`
一条的 `acceptanceCriteria`,结尾的 ⚠️ 子句写的是:

> `supportsPause` is a declaration nothing enforces (#5703), so an executor whose
> `execute()` returns `suspend: true` while leaving `supportsPause` false is warned
> about by NEITHER channel — check those by hand against the same rule.

写下时属实,PR #6746(#6667,2026-08-08 合入)之后不再属实:
`AutomationEngine.refuseUndeclaredSuspension` 正是拒绝这一类执行器的,拒绝点在
`executeNode` 里每个 `result.suspend === true` 都要经过的那一个接缝
(`packages/services/service-automation/src/engine.ts`)。于是一个 v17 升级者被告知
去手工审计一类引擎已经自己拒绝的错误,而且被告知这个不一致「没有声音」,实际上它很响。

这不是内部注释:该字符串被 `gen:upgrade-guide` 逐字投影进
`docs/protocol-upgrade-guide.md` 的 "Done when" 行,而那正是升级作者(依 ADR-0033,
往往是 AI)读的那一行,所以本 PR 一并提交了重新生成的产物。

**改后的说法,以及为什么不是「什么都不用查了」**:两条告警通道(启动告警、
`check:resume-authority-declared`)确实仍然都以 `supportsPause: true` 为触发条件,
所以「不被任何告警通道覆盖」这半句保留;变化的是它现在会在运行时被拒绝,且属于
guard-class —— `fault` 边路由不了(`refuseNode` 打的是 `errorClass: 'guard'`,
`executeNode` 在 `errorClass === 'guard'` 时不去找 `fault` 边)。同时刻意没有过度
更正:该守卫明确不判「完全没有注册描述符」的执行器(engine.ts 中
"What it does NOT judge → Silence",由 `supports-pause-runtime-enforcement.test.ts`
的 descriptor-less 用例钉住),这类执行器的暂停照样会被创建,只在 resume 路由上才
被拒绝,所以这一条作为仍需留意的残留被写进了新文案。

受理面(schema 接受什么)逐字节未变 —— 本条只动账本散文与其生成产物。
