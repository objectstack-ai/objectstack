# 过滤 / 谓词语义的编译面清单(references —— 按需加载)

出处:主文件「派发」的过滤/谓词语义标准条款 —— 命中该条款的派发令把本清单**逐面抄
进去**,PR 逐面申报。维护纪律与派发前复核串在正文内,一并适用:**这张表由 PR 维护、
派发前先跑复核串重验,⛔ 不凭记忆抄**。

编译面清单(逐面实测 @ `main` `48f98b0`,2026-08-07):

| # | 面 | 落点(file:line) | 备注 |
| --- | --- | --- | --- |
| 1 | `driver-sql` | `packages/drivers/driver-sql/src/sql-driver.ts:7083`(`applyFilterCondition`) | `driver-sqlite-wasm`(`sqlite-wasm-driver.ts:67`)与 **local 模式**的 `driver-turso`(`turso-driver.ts:174`)都 `extends SqlDriver`,**靠继承共用这一面**,不单独算面 |
| 2 | turso RemoteTransport | `packages/drivers/driver-turso/src/remote-transport.ts:1526`(`private buildWhereSQL`) | **独立编译器,不继承面 1** —— 一个驱动的两面,由连接模式选中哪面 |
| 3 | service-analytics read-scope-sql | `packages/services/service-analytics/src/read-scope-sql.ts:259`(`compileScopedFilterToSql`) | RLS 读侧 |
| 4 | service-analytics filter-normalizer | `packages/services/service-analytics/src/strategies/filter-normalizer.ts:1235`(`lowerAnalyticsWhere`) | analytics / cube 侧 |
| 5 | `formula` | `packages/formula/src/matches-filter.ts:73`(`matchesFilterCondition`) | RLS 写侧 `check` 与公式求值;JS 两值语义的基准面 |
| 半面 | objectql `having-filter` | `packages/objectql/src/having-filter.ts:92` / `:98`(`applyHaving` / `matchesHaving`) | 聚合**后**过滤。算半面是因为词表是子集,**但申报义务不打折** —— 它是**唯一没有 conformance 表覆盖的面**(`FILTER_LOGIC_CASES` 不驱动 HAVING 路径),所以漏了它连门禁都不会红 |
| 冻结 | `driver-memory` / `driver-mongodb` | — | 维护者 2026-08-05 投入冻结:**pin-annotate,不翻转**。冻结面仍要申报,结论是「不在范围 + 冻结指令」。现场注释见 `read-scope-sql.ts:176`、`having-filter.ts:41` |

**这张表本身由 PR 维护 —— 与域表同一纪律。** 增删一面(新驱动、新求值器、某面被合并
或退役、冻结状态变化)的那个 PR 顺手改这里,不留给下一次裁决重新数。清单**会**过期是
必然的,清单**没有维护者**才是缺陷。

⚠️ 派发前复核一遍再抄,⛔ 不要凭这张表的记忆填派发令:本仓的包路径搬过家(驱动进
`packages/drivers/`、服务进 `packages/services/`),行号更是每天在动。一条够用的复核
串:`grep -rn 'matchesFilterCondition\|buildWhereSQL\|compileScopedFilterToSql'
packages --include=*.ts | grep -v node_modules`。
