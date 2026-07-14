---
'@objectstack/spec': minor
'@objectstack/cli': minor
---

ADR-0087 P2:可重放迁移链 + 机器可读变更清单(D3 / D4)。

**D3 —— 迁移链(`@objectstack/spec` 新增 `migrations/`)。** 一条永久、有序、按协议大版本组织的迁移链。每个大版本的步骤由两个来源合成:**已毕业的转换**(P1 的 D2 转换条目从加载路径退役后,以其 id 引用复用,作为该大版本的“机械变换”,转换与 fixture 不重复)和**语义变更**(无损映射无法表达的破坏,以结构化 TODO —— surface / 原因 / 验收标准 —— 呈现,而非静默或有损自动改写)。

- `applyMetaMigrations(stack, fromMajor, toMajor?)` 折叠 `fromMajor+1 … 当前` 的步骤,一次性把任意历史大版本的元数据迁到当前;跨大版本是设计主场景。每一跳(hop)都做检查点,便于逐跳验证与二分定位。**时效性从不承重** —— 迟到的使用方到达时重放链即可。
- `composeMigrationChain`、`MigrationFloorError`,以及显式的发布策略旋钮 `MIGRATION_SUPPORT_FLOOR`(链能回溯到多久)。
- 种子:protocol 11 步骤 —— 机械项为三条已毕业的 P1 转换;语义项为两个真实存量窗口:`titleFormat` 复合模板 → `nameField`(需公式字段,非无损)、SQL 式 RLS 谓词 → 规范 CEL。
- CI 把整条链当作链来测:每条转换的 old-shape fixture 从支持下限重放到目标大版本,组合性破坏即发布阻断。

**D4 —— `spec-changes.json` 变更清单。** Zod 定义的机器可读记录 `{ from, to, added, converted, migrated, removed }`,由 `composeSpecChanges(from, to, surfaceDiff?)` 跨大版本折叠转换表(D2)与迁移集(D3),并与发布期 api-surface 差异连接。按大版本的清单可组合成单一 `from→to` 视图;后续生成式升级指南与 P3 的 MCP `spec_changes` 工具都是它的投影。

**CLI —— `objectstack migrate meta --from N`。** 重放迁移链:展示生成的、经 `ObjectStackDefinitionSchema` 校验的机械变更 diff(逐条 `path: 旧 → 新`)与需人工判断的语义 TODO;`--to`、`--step`(逐跳检查点)、`--out <file.json>`(把规范化后的栈写为可 diff 的 JSON 快照)、`--json`。命令不静默改写 TS 配置源(AST 改写不安全且有损)—— 输出供使用方 agent 审阅采纳,这正是握手错误(P0)所指向的命令。

`normalizeStackInput` 新增可选 `convert: false`(仅做 map→array,不跑 D2 转换),供 `migrate meta` 对原始编写源重放链、把每处改写归因到对应链步。新增导出纯增量,无破坏性移除。
