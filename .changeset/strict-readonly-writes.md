---
"@objectstack/spec": minor
"@objectstack/objectql": minor
---

feat(spec,objectql): `strictReadonlyWrites` —— 让调用点选择「被剥离即响亮失败」(#5126)

写路径上的 readonly 剥离一直是**静默**的:调用方送来的只读字段被丢掉,写入照常提交并返回成功,该列保持原值。#4903(PR #5123)把这件事修得**可发现**(一条说清后果与出路的 WARN + `onFieldsDropped` 机器可读信号),但没能补上「出路」本身 —— 一个宁可让写入失败也不接受丢列的调用方(cron / 服务端插件)无处表达这个意图,因为选项键必须先落在 `packages/spec`。

本次按维护者裁定的 **B 方案**补上这一半:

- **`@objectstack/spec`**:`WriteObservabilityOptions`(`contracts/data-engine.ts`,`onFieldsDropped` 所在的**进程内** TS 契约)新增 `strictReadonlyWrites?: boolean`,默认关闭;`ERROR_CODE_LEDGER` 在 `@objectstack/objectql` 名下登记 `ERR_READONLY_FIELD_REJECTED`。
- **`@objectstack/objectql`**:`update` 在剥离接缝处兑现该语义 —— 置位且确有字段将被剥离时,在**任何驱动调用之前**抛出 `ReadonlyFieldRejectedError`(新导出,`code = 'ERR_READONLY_FIELD_REJECTED'`),因此**什么都不写**:不只是被拒字段,连本可存活的字段也不落库。单条与 bulk 两条路径同此。

三点值得单独说明:

- **默认行为零变化。** 不传(或传 `false`)时,剥离、`onFieldsDropped` 事件、提交结果与此前完全一致。这是一个 per-call 的选择加入项。
- **覆盖两种剥离原因。** 静态 `readonly`(#2948,仅对非 system 调用方生效)与 `readonlyWhen` 判定为真(#3042,对**所有**调用方生效,含 `isSystem`)。只覆盖前者会让本特性对它最想服务的调用方 —— 已声明 `isSystem: true` 的可信 cron —— 近乎失效:它恰恰豁免了静态剥离,却仍会静默丢掉被 `readonlyWhen` 锁住的列。两种原因累积进**同一个**异常,`fields` 是全量并集,`drops` 保留按原因的明细。
- **strict 是进程内语义,不跨 RPC / VDE 边界。** 它挂在 TS 契约而非可序列化的 `EngineUpdateOptionsSchema` 上,因此 REST / wire body **设不了**它:远程调用方既拿不到 `onFieldsDropped` 也拿不到 strict,其写入仍是「剥离后提交」。这是刻意的 —— 把写入拒绝开关放进客户端可填的袋子等于在安全相邻路径上开新攻击面(即被否掉的 A 方案)。契约测试钉住了这条边界。
