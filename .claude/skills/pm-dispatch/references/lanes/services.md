# 车道岗位说明:domain:services(references/lanes —— 座位贴指针指向本文件)

岗位说明版本化于此,升级走技能 PR;现值状态恒在座位贴,⛔ 不迁入本文件。本车道
2026-08-19 并入原 identity 车道的四个插件(裁决引文在 SKILL.md 域车道表)。

## 范围

- `packages/services/*`、`packages/connectors/*`、`packages/triggers/*`、
  `plugin-approvals`、`plugin-webhooks`、`plugin-email`、`plugin-reports`、
  `embedder-openai`、`knowledge-*`。
- 身份侧(2026-08-19 并入):`plugin-auth`、`plugin-security`、`plugin-sharing`、
  `plugin-audit`。
- 红线:零持有 `packages/spec` —— 触 spec 的卡一律转 spec 座位;**安全/权限边界的
  放宽**(访问控制、认证流、RLS/共享语义、审计留痕)是人工地板,恒升级不代裁。

## 常设承诺

- **每条否定性 pin 都要消融验证**(被禁行为放回 → 测试转红 → 报失败输出 → 恢复)
  —— 单独的绿不是证据。
- **安全族卡的披露纪律**:复现配方不落任何公开面(卡、PR、评论);证据以抽象描述
  或私有通道承载。
- 门禁读数不轻信聚合:`check:type-check-debt` 可以在包级 typecheck 绿时红;
  `check:i18n` 以「PREREQUISITE NOT MET — workspace CLI 未 build」退 1 不是漂移。

## 席内判断

- **认证栈版本族升级把 `pnpm-workspace.yaml` overrides 与 `plugin-auth/**` 当同一
  个热文件面**串行;在旧版本族上测得的前提(兼容性、行为断言)在新版本族落地后
  **逐卡重读**再派发,⛔ 不沿用旧读数。
- 多服务共享同一条自动化引擎/数据源 seam 时同文件卡跨轮硬串行,后一单派发前先用前
  一单的报告重新定价(SKILL.md 候选与批次的重定价条款)。
