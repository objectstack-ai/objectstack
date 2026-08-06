---
"@objectstack/lint": minor
---

never-fire 族三条 lint 规则 warning → error:声明了触发器却确定不会运行的 flow 现在被拒收

`validateFlowTriggerReadiness` 里的规则此前一律是 warning。族内复审(#5762)后按**一个**标准重新定级 ——
「仅凭这份 stack 是否已经足够断定这个 flow 不会运行」—— 三条规则答「是」,升为 `error`:

- **`flow-time-relative-descriptor-invalid`**(#5496)—— `config.timeRelative` 描述符
  `TimeRelativeTriggerSchema` 判不过。判它的正是 trigger 在 bind 时 `safeParse` 的同一个 schema,
  所以 schema 拒的描述符在运行时同样被拒:sweep 永不安装,flow 声明了 time-relative 触发器却永不运行。
- **`flow-time-relative-descriptor-unroutable`**(#5647)—— `config.timeRelative` 不是对象
  (`timeRelative: 'daily'` 是典型)。判据就是引擎自己的路由谓词 `typeof … === 'object'`,
  所以这个值不会被任何部署路由到 time-relative trigger —— 全族里最硬的判定,也是唯一连
  bind 时那一行 warn 都没有的一条。
- **`flow-trigger-unknown-event`**(#3427/#3457/#3481)—— `record-*` token 落在文法之外
  (`record-after-updated` 拼错、`record-change` 缺相位、数组形式)。引擎用硬编码前缀把任何
  `record-` 开头的 token 路由给 record-change trigger(不查注册表,所以装任何包都无法声明新
  `record-*` token),该 trigger 再用 `triggerTypeToHookEvents` 的封闭文法映射 —— 文法外就是零
  hook event,即绑不上任何东西。

**两条对照规则维持 warning,这正是本次定级不是「整个文件都升 error」的原因:**

- `flow-trigger-unknown-object` —— 本 stack 没定义的对象名**可能由另一个已安装包提供**,
  规则看不见那个包的对象。免责是真的,所以继续 advisory(它自己的 hint 就这么写)。
- `flow-draft-status-ambiguous` —— draft flow **确实会**触发,这是意图歧义而非死 flow。

## 影响面:P1 运行时发布门(`surfaces: CLI_AND_RUNTIME`)

注册表 tier 同步 `advisory` → `gating`。除 `os validate` / `os build` / `os lint` 之外,本规则也跑在
元数据写入路径的 publish 门上,`error` 会让 `state: 'active'` 的写入被拒(422)。**边界值得写清,因为
直觉猜错的方向恰好对租户有利**:该门交给规则的快照里 `flows` 只装**正在写入的那一个** item
(`runtime-gate.ts`:`candidate = { objects, [stackKey]: [item] }`),并且会减掉 baseline 已产出的
finding。所以:

- 发布 flow A **不会**因为已存储的 flow B 是死 flow 而被拒;租户既有的死 flow 继续被读取和服务
  (ADR-0087 读路径不对称);
- 被拒的是**死 flow 自己的发布**(含再次发布),以及 CLI 侧 —— stack 里含死 flow 的包
  `os validate` / `os build` / `os lint` 转红;
- draft 保存从不过门(#4463 D1),只有发布才过。

## 迁移

修死 flow,不要降级规则:

- 描述符判不过 → 按 finding 里 `TimeRelativeTriggerSchema` 的原文改(它会点名该写的键);
  描述符要 `{ object, dateField, 且 withinDays | offsetDays 恰好其一 }`。
- `timeRelative` 写成了 `'daily'` 这类节奏值 → 节奏是**同级兄弟键** `config.schedule`
  (默认每日 08:00 UTC,通常可省),`timeRelative` 只描述扫哪些记录。
- `record-*` token 落在文法外 → 用 `record-{before,after}-{create,insert,update,delete,write}`;
  「创建或更新」用 `record-after-write` 一条 flow 覆盖(#3427);多事件数组仍未支持(#3457),
  按事件各写一条 flow。

仓内三个示例 app(showcase / CRM / todo)`os validate` 升级前后输出逐字一致、均通过,
本次升级不需要修改任何示例。
