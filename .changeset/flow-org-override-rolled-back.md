---
'@objectstack/spec': patch
---

flow 不再允许按组织覆盖:`allowOrgOverride` 回滚为 `false`

`DEFAULT_METADATA_TYPE_REGISTRY` 里 `flow` 那一行的 `allowOrgOverride: true` 来自
commit ba252da0b,没有 ADR 支撑,并且与 ADR-0005 的白名单表(automation ❌ ——
「Carry execution side-effects (events, jobs, audit). Per-org variants are a
deployment, not an overlay.」)直接冲突;同一行的 `supportsOverlay: false` 也早已
说明加载器根本不会合并 per-org 的 flow overlay。两者相加的结果是:写入被批准、
落库成功,而下一次冷启动读路径把该行滤掉,绑定消失。

现在这类写入在发生的那一刻就被响亮拒绝:对**已由代码包交付的** flow 做 org 覆盖
返回 `403 not_overridable`(与 `object` 同一条路径,且不依赖部署拓扑 ——
`environmentId` 未设置的单内核同样拒绝)。

未收紧、也不打算收紧的一侧:`allowRuntimeCreate` 仍为 `true`,租户依旧可以通过
运行时 API 新建一条**全新的** flow —— 它没有影子化任何代码包交付的自动化,正是
ADR-0005 所说的「a deployment」。

影响面:此前唯一能走通这条写路径的是「写入成功但重启即失绑」的幻觉状态,收掉的
是幻觉而不是能力。
