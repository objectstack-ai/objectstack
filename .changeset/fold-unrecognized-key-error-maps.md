---
"@objectstack/spec": patch
---

refactor(spec): 三个手写 unrecognized_keys 错误映射折叠进共享 `strictObject` guidance 模板（#6619，#6416 方向 2）

`strictVisibilityError`（`shared/visibility.ts`）、`strictWidgetAnalyticsError`
（`ui/dashboard.zod.ts`）、`strictTenancyError`（`data/object.zod.ts`）此前是
手写 `$ZodErrorMap`——#5955 的模板重排、#5593 的 `strictObject` 迁移都够不到
它们，`alias-integrity.test.ts` 的两个注册表也都看不见它们（#6416 命名的盲区）。

- **共享模板新增按集合取键的 guidance 形态**（`KeySetGuidance` / `guidanceSets`）：
  一条处方由一个具名键族共享（枚举列表或模式），每条消息每个集合最多发声一次。
  优先级规则固定并有测试钉住：精确 `guidance` 条目永远胜过集合；集合之间按声明
  顺序；集合命中即抑制改名建议。
- **三个映射全部折入模板**，`alias-integrity.test.ts` 新增集合成员死条目检查、
  模式 examples 检查与折叠闭合钉（还原任何一个手写映射会红在门上而不是重新
  变成盲区）。
- **接受面逐字节不变**：所有 schema 接受/拒绝的输入集合与折叠前完全一致。
  #6453 留下的 13 个消息顺序钉全部随代码迁移、零删除。消息字节有三处刻意变化
  （处方从内联空格改为模板的 `\n  • ` 项目符号；无处方的键获得模板的编辑距离
  改名建议，如 `tenantfield` → `tenantField`；widget 多键族时各族处方全部给出
  而非只给第一个命中分支）。
- 公开导出面：`./shared` 移除 `strictVisibilityError`，新增
  `VISIBILITY_STRICT_OPTIONS`、`KeySetGuidance`、`keySetMatches`；新增
  `strictObjectError`（`strictObject` 的注册+错误映射一半，供不关门的
  module-private base 使用）。
