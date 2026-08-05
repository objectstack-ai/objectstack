---
"@objectstack/types": minor
"@objectstack/cloud-connection": minor
"@objectstack/lint": minor
"@objectstack/cli": minor
"@objectstack/spec": patch
"@objectstack/driver-sql": patch
---

feat(types,cloud-connection,lint,cli): ADR-0120 17.x 收尾 —— `isolated` 安装期姿态硬门(D5e)、D5c 重拼写 advisory、成文契约扫荡与三姿态 conformance (#5081)

ADR-0120 17.x 波的第三块,也是最后一块。前两块已在 main 上:#5212(driver 侧
D3+D4 —— `COALESCE(organization_id, '__global__')` 物化、drift 两侧同步、重复预检)
与 #5208(spec 词汇 `'organization'` + D5a/D5b lint)。本次补齐三件事:安装期的
姿态决策点、剩余的成文契约、以及把「一个 app 包跑遍三种姿态」从假设变成测试。

**D5e —— 装进 `isolated` 环境时的硬门。** 词汇本身是姿态无关的:作者说的是业务
边界(`'organization'` 一个组织一份 / `'global'` 整个安装一份),没有任何索引形状
读姿态。唯一的残留在一个方向上:`isolated` 下组织就是**不同客户**,此时 app 业务
对象上的 `'global'` 唯一既跨客户过度约束,又变成跨客户的存在性预言机(S10/S14)。
维护者裁定这是**硬门而非 advisory**:把带 `'global'` 唯一(非 `sys` 对象)的 app
装进 `isolated` 环境会**停下来并逐索引列出**,安装者(通常是 AI agent)要么确认它
确实是平台级的,要么改写为 `'organization'`;确认按 ADR-0104 attestation 风格
留痕在安装清单里(`InstalledManifestEntry.globalUniqueAttestation` —— 确认了什么、
谁确认的、何时、在哪个姿态下问的),**之后不复问**。

- 停下的安装**什么都不留**:先于 hot-register 和任何 ledger 写入,所以作者改完
  元数据可以直接重试,不需要先卸载。
- 逐索引确认是有牙齿的:`confirmGlobalUniques` 收 `true` 或明确的 id 数组,只确认
  其中一条仍会在剩下的那条上停住。
- 升级引入的**新**约束会被问,老的答案继续算数。
- 另一个姿态下给出的确认**不算同意** —— `isolated` 那个问题在 `single` 下从未被
  问过,所以按「未确认」处理(唯一不会静默放行跨客户约束的方向)。
- ⛔ **永不做成启动期告警**(#4884 纪律)。boot 时的 rehydrate 不评估此门;门够不到
  的两类存量 —— 门禁上线前的安装、装后姿态变更的环境 —— 由 `os doctor` 与
  `os migrate plan` 的 advisory 形态覆盖。

判定里有三条是承重的,别「简化」掉:声明索引上的裸 `unique: true` **算**(D1 说它
就是 `'global'` 的位置式拼写,排除它等于让整个 17.x 可以靠拼写绕过);字段级
`true` **不算**(它是 `'organization'`,永久合法);`sys_`/`base_` 对象**不算**
(S5 那批引擎幂等键天然就是平台级的,每次安装都问一遍就是 #4884 的误报类)。

CLI: `os package install` 新增 `--confirm-global-uniques`,并把 409 渲染成可读的
逐条清单而不是一句 "Install failed (409)"。

**D5c —— 遗留手写组织复合索引的 advisory。** 新规则
`unique/legacy-organization-composite`:声明的唯一索引自己列出了组织列
(`{ fields: ['name','organization_id'], unique: true }`)—— 这是词汇出现之前手写
per-organization 的写法。它读起来像「每组织唯一」,物化出来却是普通复合索引,而
SQL UNIQUE 是 NULL-distinct 的:组织列为 NULL 的行上它**什么都不约束**(#5030),
在单组织部署上那就是每一行。改写成 `unique: 'organization'`(`fields` 原样保留,
driver 会把已列出的组织列**就地**变成 NULL-safe 形式)正是补上这个洞的动作。
**永远只是 advisory,永远不自动修**:老拼写永久合法、零强制 drift,而 opt-in 是
真实的物理收紧,要走 D4 的 `recreate_index` + 重复预检。

**D6 —— 成文契约扫荡。** `content/docs/data-modeling/indexing.mdx` 的
§Two ways to say "unique" 全节按新词汇重写(含 `os:check` 代码块);
`content/docs/protocol/objectql/schema.mdx` 的 §Uniqueness and tenancy 重写为
§Uniqueness and scope —— 其中那句「单租户部署不受影响,租户列是常量,复合索引
退化为单列索引」是 #5030 **证伪过的原话**,现已替换为 D3 的 NULL-safe 事实;
`content/docs/deployment/cli.mdx` 的 `replace_unique_index` / `recreate_index`
条目补上 NULL-safe 形状与重复预检;`content/docs/references/**` 经
`gen:schema && gen:docs` 再生成,未手改。

按 ADR-0120 Resolved #2 的非规范性引导(官方示例/脚手架/生成器在新代码中输出
显式拼写),`skills/objectstack-data/**` 的索引与校验规则整体扫过:声明索引一律
说清 scope,并新增一节完整讲 `'organization'` 的 NULL-safe 语义与「永远不写姿态」。
顺带修掉那里长期使用的 `tenant_id` —— 平台的列叫 `organization_id`。
`examples/**`、`create-objectstack` 模板与 `os generate` 经核查**根本没有声明任何
唯一约束**,故无可扫;这是核查结论,不是遗漏。

**三姿态 conformance(ADR §Acceptance tests)。** 同一个 fixture app 在
`single | group | isolated` 三姿态下启动,逐 S 行用**真实的违规插入**断言 enforcement
(S1/S2/S3/S4/S5/S6/S7/S8/S9/S11/S12),并逐姿态捕获物化出的索引键,断言三者
**逐字节相同** —— 「没有任何索引形状读姿态」这句话一旦有两者不同就是假的。相同性
断言配了一条正向断言(对着期望的键形状),这样「三次都什么都没建」不会读成「一致」。
外加 ADR 只要的那一条 transition smoke:在 `single` 下建库、`isolated` 下重新打开,
drift op 为零。

对既有部署的影响:除新增的安装期确认外,本次不改变任何已有物化行为。字段级
`unique: true` 一如既往合法。
