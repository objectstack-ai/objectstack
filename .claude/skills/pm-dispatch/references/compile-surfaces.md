# 过滤与谓词语义的编译面清单

见 SKILL.md 〈派发〉的过滤与谓词语义条款;命中它的派发令逐面抄进本清单,PR 逐面申报。
维护纪律与复核串一并适用:这张表由 PR 维护、派发前先跑复核串重验,⛔ 不凭记忆抄。

编译面清单(行号每天在动,派发前按下方复核串重验):

| # | 面 | 落点(file:line) | 备注 |
| --- | --- | --- | --- |
| 1 | `driver-sql` | `packages/drivers/driver-sql/src/sql-driver.ts:7083`(`applyFilterCondition`) | `driver-sqlite-wasm`(`sqlite-wasm-driver.ts:67`)与 **local 模式**的 `driver-turso`(`turso-driver.ts:174`)都 `extends SqlDriver`,**靠继承共用这一面**,不单独算面 |
| 2 | turso RemoteTransport | `packages/drivers/driver-turso/src/remote-transport.ts:1526`(`private buildWhereSQL`) | **独立编译器,不继承面 1** —— 一个驱动的两面,由连接模式选中哪面 |
| 3 | service-analytics read-scope-sql | `packages/services/service-analytics/src/read-scope-sql.ts:259`(`compileScopedFilterToSql`) | RLS 读侧 |
| 4 | service-analytics filter-normalizer | `packages/services/service-analytics/src/strategies/filter-normalizer.ts:1235`(`lowerAnalyticsWhere`) | analytics / cube 侧 |
| 5 | `formula` | `packages/formula/src/matches-filter.ts:73`(`matchesFilterCondition`) | RLS 写侧 `check` 与公式求值;JS 两值语义的基准面 |
| 半面 | objectql `having-filter` | `packages/objectql/src/having-filter.ts:92` / `:98`(`applyHaving` / `matchesHaving`) | 聚合**后**过滤。算半面是因为词表是子集,**但申报义务不打折** —— 它是**唯一没有 conformance 表覆盖的面**(`FILTER_LOGIC_CASES` 不驱动 HAVING 路径),所以漏了它连门禁都不会红 |
| 已解冻 | `driver-memory` / `driver-mongodb` | `packages/drivers/driver-memory/src/memory-matcher.ts:134`(`checkCondition`)、`packages/drivers/driver-mongodb/src/mongodb-filter.ts:700`(`translateFieldOperators`) | 冻结指令与不在范围的旧判定均已作废,按普通面申报 |

增删一面的那个 PR 顺手改这里,不留给下一次裁决重新数。
触发增删的四种事件:新驱动、新求值器、某面被合并或退役、冻结状态变化。
清单会过期是必然的,清单没有维护者才是缺陷。
派发前复核一遍再抄,⛔ 不凭本表的记忆填派发令:包路径搬过家,行号更是每天在动。
一条够用的复核串:
`grep -rn 'matchesFilterCondition\|buildWhereSQL\|compileScopedFilterToSql'
packages --include=*.ts | grep -v node_modules`。
