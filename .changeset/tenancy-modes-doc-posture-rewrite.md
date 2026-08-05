---
---

docs(deployment): rewrite `tenancy-modes.mdx` around the ADR-0105 D1 posture spectrum — releases nothing.

整页此前仍按 ADR-0105 D1 之前的世界写:两态 tenancy mode、`OS_MULTI_ORG_ENABLED` 作为
开关、`TenancyService.mode`、以及只提 `isolated` 的降级 FATAL 文案;对权威 knob
`OS_TENANCY_POSTURE` 全页 grep 零命中。重写后 `single` / `group` / `isolated` 三态为
主线,遗留布尔降为「posture 未设时才读的回落输入」,并逐条对码核证:posture 解析优先级
与未设/非法值行为、两种有墙 posture 都需要企业版 runtime 且都会降级、`tenancy` 服务的
`posture` / `requestedPosture` 双事实、`/auth/config` 的
`tenancyPosture`/`multiOrgEnabled`/`degradedTenancy`、`organization/create` 闸门读的是
**生效** posture、以及 import 阶段与 mount 阶段两种拒绝启动的区别。

Docs only — no package behaviour changes, so this changeset releases nothing.
