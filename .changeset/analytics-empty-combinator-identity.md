---
"@objectstack/service-analytics": patch
"@objectstack/spec": patch
---

fix(service-analytics): 空组合子按布尔单位元归约,两个编译器与五后端对齐 (#5322)

同一个仓库对空组合子曾有两个对立答案:五个 `FILTER_LOGIC_CASES` 后端
(`driver-sql` #5134/PR #5243、`driver-memory`、`formula`、`driver-sqlite-wasm`、
`driver-mongodb` #5239)把 `{ $and: [] }` / `{ $or: [] }` 归约成布尔单位元,而
service-analytics 的两个编译器 —— `read-scope-sql.ts` 的 `compileNode` 与
`filter-normalizer.ts` 的 `buildNode` —— 成文地 fail-closed 抛错("An empty
combinator has no defensible reading…")。2026-08-04 维护者拍板(#5322)取单位元,
本次把 analytics 两处对齐:

- `{ $and: [] }` = TRUE(全部行,AND 单位元);`{ $or: [] }` = FALSE(零行,OR
  单位元);`{}` 条件 = TRUE(`$or` 中作为 TRUE 析取项吸收整个析取);
  `{ $not: {} }` = `NOT TRUE` = 零行。嵌套整树结构性归约,常量不会存活在根以下。
- **迁移含义**:过去发出这些形状的调用方收到的是抛错(REST 面上是一次失败的请
  求);现在它们按上表求值。`{ $or: [] }` 在 RLS/图表场景是 fail-closed 的 ——
  析取列表循环出零项时隐藏全部行,而不是放行全表。写作期对字面量空组合子的响亮
  拒收另立 #5330(publish/lint),不在运行期。
- **没有放宽的部分**:非数组的 `$and`/`$or`、非对象的分支、非对象的 `$not` 操作数
  仍然抛错。归约让「无约束」成为有意义的裁决,静默丢弃畸形分支会让垃圾析取项吸收
  `$or` 而放宽查询,所以畸形形状保持响亮(与 `read-scope-sql` / `driver-mongodb`
  #5239 同向)。此前 `buildNode` 对非对象分支与非对象 `$not` 操作数是静默丢弃。
- `NormalizedFilterNode` 新增 `{ kind: 'false' }` 常量节点(TRUE 已有拼法
  `null`),三个策略消费点(raw-SQL WHERE、ObjectQL 引擎 filter、`/analytics/sql`
  回显)各自以真实的零行谓词落地(`1 = 0` / 规范拼法 `{ $or: [] }`),而不是
  「什么都不发」—— 后者会被读成「全部行」,方向正好相反。
- `read-scope-sql` 的 `$not` 对**归约后**的操作数取反,与 #5146 的 NULL-safe 重写
  组合语义是「先归约、后 NULL-safe」,有测试钉住。
- `packages/spec`:`FILTER_LOGIC_CASES` 补四条布尔单位元行,两个 analytics
  conformance suite 与五后端从此被同一张表钉住这四格。
