---
"@objectstack/service-analytics": patch
"@objectstack/spec": patch
---

fix(service-analytics): 空 `$and` / `$or` 按布尔单位元归约,两个编译器与五后端对齐 (#5322)

同一个仓库对空组合子曾有两个对立答案:五个 `FILTER_LOGIC_CASES` 后端
(`driver-sql` #5134/PR #5243、`driver-memory`、`formula`、`driver-sqlite-wasm`、
`driver-mongodb` #5239)把 `{ $and: [] }` / `{ $or: [] }` 归约成布尔单位元,而
service-analytics 的两个编译器 —— `read-scope-sql.ts` 的 `compileNode` 与
`filter-normalizer.ts` 的 `buildNode` —— 成文地 fail-closed 抛错("An empty
combinator has no defensible reading…"),并有 pin 测试钉住。2026-08-04 维护者拍板
(#5322)取单位元,本次把两处对齐:

- `{ $and: [] }` = TRUE(全部行,AND 单位元);`{ $or: [] }` = FALSE(零行,OR
  单位元)。嵌套可归约:空组合子作 `$or` 分支时按 TRUE 吸收/FALSE 退出析取,作
  `$not` 操作数时取反(`{$not: {$and: []}}` = 零行、`{$not: {$or: []}}` = 全部
  行)。`{}` = TRUE 与 `{ $not: {} }` = 零行两格已由 #5297(read-scope)/#5325
  (normalizer)先行落地,本次连同这四格由同一张一致性表钉住。
- **迁移含义**:过去发出空组合子的调用方收到的是抛错(REST 面上是一次失败的请
  求);现在按上表求值。`{ $or: [] }` 在 RLS/图表场景是 fail-closed 的 —— 析取列
  表循环出零项时隐藏全部行,而不是放行全表。写作期对字面量空组合子的响亮拒收另立
  #5330(publish/lint),不在运行期。
- **没有放宽的部分**:非数组的 `$and`/`$or`、非对象的分支、非对象的 `$not` 操作数
  仍然抛错(#5325 的形状拒收原样保留)。归约让「无约束」成为有意义的裁决,静默把
  畸形分支读成 TRUE 会让垃圾析取项吸收 `$or` 而放宽查询,所以畸形形状保持响亮。
- 归约与 #5146/#5325 的 NULL-safe `$not` 重写的组合语义是「先归约、后 NULL-safe」
  —— 常量归约出的单位元不受重写影响,幸存的叶子照常加守卫,有测试钉住。
- `packages/spec`:`FILTER_LOGIC_CASES` 补四条布尔单位元行(空 `$and`、空 `$or`、
  `{}` 析取项吸收、`{$not: {}}`),两个 analytics conformance suite 与五后端从此
  被同一张表钉住这四格。
