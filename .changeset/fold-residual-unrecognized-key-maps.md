---
"@objectstack/spec": patch
---

refactor(spec): 折叠 #6619 漏掉的两个手写 `unrecognized_keys` 错误映射，并把闭合钉从实例拓宽为类（#6805）

#6416 命名的盲区由 #6619/PR #6804 折掉三个手写 `$ZodErrorMap` 后宣告闭合，但那份清单**少了两个**——同一形态（`unrecognized_keys` 处方表经 `{ error: … }` 挂在 `.strict()` 对象上），同样不在任何注册表视野内：

| 手写映射 | 位置（在 `origin/main` @ `2672f855f` 实测） | 折叠后 |
|---|---|---|
| `strictToolError` | `ai/tool.zod.ts:83`（消费于 `:180`） | `strictObject` + `guidance: TOOL_RETIRED_KEY_GUIDANCE` |
| `strictCapabilitiesError` | `data/object.zod.ts:169`（消费于 `:274`） | `strictObject` + `guidance: CAPABILITIES_RETIRED_KEY_GUIDANCE` |

- **两张表首次进入 `alias-integrity.test.ts` 的审计视野**（注册表可见面 291 → 293，带 guidance 的面 129 → 131，新增恰为 `` `enable` `` 与 `the tool definition`，无一移除）。`TOOL_RETIRED_KEY_GUIDANCE` 是一张手工维护的**按键退役处方表**——正是这道门为之存在的最易腐烂的内容。
- **#6619 记录的「折不了的理由」被证伪，而不是被绕过**：模板无条件追加 `history`，而这两张表不发解释句。那是**文案的缺口，不是模板的极限**——`history` 槽位编码的是位置（两条修复通道之后），两个面都有真实历史，只是从没写下来。写下来即可折。
- **闭合钉从实例拓宽为类**：`alias-integrity.test.ts` 新增一条按 AST 判定的钉子——包内任何模块把自己写的、分支在 `unrecognized_keys` 上的错误映射交给 `z.<factory>(…, { error })`，即红。判据是「已挂载」∧「决断 `unrecognized_keys`」两个合取项，**无豁免名单**：`data/field.zod.ts` 的 `uniqueScopeError`（`invalid_union`，值级）与 `shared/error-map.zod.ts` 的 `objectStackErrorMap`（按次解析的全局兜底，从不挂到 shape 上）都由仪器本身判为不在类，各自作为实测对照钉住。
- **接受面逐字节不变**：46 例探针矩阵在折叠前后逐例比对，parse 输出与 issue `code`+`path` 完全一致。消息装配按 #6804 的既有三类变化移动——处方文本逐字节保留，无处方的键改由模板的编辑距离通道作答（`labl`→`label`、`searchible`→`searchable` 等 8 处，此前只被告知「不是本 schema 的字段」），解释句在最后。
- `scripts/strictness-ledger.test.ts` 的 `z.object(…).strict()` 夹具按其自身注释搬到 `PerOperationRequiredPermissionsSchema`（同文件），并新增「被腾空的两处现读为 helper」的对照。
