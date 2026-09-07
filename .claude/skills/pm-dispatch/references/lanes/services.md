# 车道岗位说明:domain:services

见 SKILL.md 〈座位贴协议〉;本文是本车道岗位说明,现值状态恒在座位贴,⛔ 不迁入本文。

## 范围

- `packages/services/*`、`packages/connectors/*`、`packages/triggers/*`、
  `plugin-approvals`、`plugin-webhooks`、`plugin-email`、`plugin-reports`、
  `embedder-openai`、`knowledge-*`。
- 身份侧:`plugin-auth`、`plugin-security`、`plugin-sharing`、`plugin-audit`。
- 红线:零持有 `packages/spec` —— 触 spec 的卡一律转 spec 座位。
- 安全与权限边界的放宽是人工地板,恒升级不代裁。
- 该边界含访问控制、认证流、RLS 与共享语义、审计留痕。

## 常设承诺

- 每条否定性 pin 都要消融验证:被禁行为放回、测试转红、报失败输出、恢复。
- 单独的绿不是证据。
- 安全族卡的披露纪律:复现配方不落任何公开面(卡、PR、评论)。
- 证据以抽象描述或私有通道承载。

## 席内判断

- 认证栈版本族升级把 `pnpm-workspace.yaml` overrides 与 `plugin-auth/**` 当同一个热文件面串行。
- 旧版本族上测得的前提(兼容性、行为断言)在新族落地后逐卡重读再派,⛔ 不沿用旧读数。
- 多服务共享同一条自动化引擎或数据源 seam 时,同文件卡跨轮硬串行。
- 后一单派发前先用前一单的报告重新定价,见 SKILL.md 候选与批次的重定价条款。
