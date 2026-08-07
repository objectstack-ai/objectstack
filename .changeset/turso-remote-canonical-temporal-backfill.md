---
"@objectstack/driver-turso": minor
---

feat(driver-turso): remote 模式补上 canonical 时间列 backfill 通道(分批、可恢复、完成标记) (#5770)

`SqlDriver.backfillCanonicalDatetimes` / `backfillCanonicalTimes` 是 Knex 路径,
remote 模式的 DDL 与 CRUD 全部走 `@libsql/client`,永远到不了它们。于是
`canonicalDatetimeFields` / `canonicalTimeFields` 在 remote 恒空,
`needsLegacyDatetimeRepair` 恒为 true。在 `origin/main`(`d82b85fee`)上实测:

```
canonicalDatetimeFields['probe']            -> undefined
needsLegacyDatetimeRepair('probe','at')     -> true
temporalFilterColumnSql('probe','at','"at"')
  -> (case when typeof("at") in ('integer','real')
        then strftime('%Y-%m-%dT%H:%M:%fZ', "at"/1000.0, 'unixepoch')
        else coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', "at"), "at") end)
```

每一次对 `Field.datetime` / `Field.time` 的 filter 都编译成这个表达式 —— 正确,但
**不可索引**。local 跑完 backfill 能退回 `col >= ?`,remote 此前没有这个出口,
代价是永久的(cloud#1005 后果 A)。

**后果 B 实测比原单描述更尖锐。** `RemoteTransport.mapFieldTypeToSQL` 把时间列声明为
TEXT,#942 之前的 remote 写路径原样透传数字,于是 epoch 毫秒落盘成
`'1753660800000.0'`。共享修复表达式按 `typeof(col) in ('integer','real')` 分派,
TEXT 亲和列永不命中该支;`strftime` 也解析不了这串数字,`coalesce` 把原值还回来 ——
该行是修复表达式的**不动点**,永远转不过来,并且按 TEXT 比较。原单记为「任何 filter
都匹配不到」;实测是**更坏**的形态 —— `'1753660800000.0'` 字典序排在所有 `'2…'`
之前,所以该行既被自己所属的窗口漏掉,又被并不包含它的窗口命中:

```
where at between '2025-07-01T…' and '2025-08-01T…'  -> ['ok']            (legacy 行丢失)
where at <= '2030-01-01T…'                          -> ['legacy','ok']   (不该命中却命中)
```

## 本次落地(维护者 2026-08-03 裁定的方案 1)

新增 `remote-canonical-backfill.ts` 与
`TursoDriver.backfillRemoteCanonicalTemporal()`,在 remote 的 `initObjects` /
`syncSchema` 之后自动运行 —— 与 local 在 `initObjects` 里调用 backfill 的位置对应:

- **分批**:每条 `UPDATE` 至多改 `batchSize` 行,借
  `rowid IN (SELECT … LIMIT ?)` 子查询限量(`UPDATE … LIMIT` 需要 libSQL 不保证的
  编译选项)。
- **可恢复**:不需要任何断点状态。WHERE 守卫本身就是断点 —— 它选中的正是尚未
  canonical 的行,中断在任何位置都不回滚已转换的行,下次从余量继续;已收敛的列
  重跑只花一条语句、零写入。
- **完成标记**:只有在收尾探针测到「两个阶段都无事可做」时才标 canonical,写进
  `canonicalDatetimeFields` / `canonicalTimeFields` —— 与 local 完全相同的消费点
  (`needsLegacyDatetimeRepair`),因此两种 transport 靠同一条规则拿回可索引形态。
  被批次预算截断或报错的列**不标记**,保留读侧修复。
- **后果 B 的可解部分**:对元数据声明为 `Field.datetime` / `Field.time` 的列,把
  纯数字文本按 `cast(col as real)` 喂回**驱动自己的**表达式(typeof 变成 'real',
  于是走它原本的 integer/real 分支)。因此本仓不新增第二套 epoch 转换规则。
- **不可解残留如实记录**:只解释 1e12 ≤ v < 4102444800000(2001-09-09 ~ 2100-01-01)
  的值。下界是为了让 epoch **秒**永不入界 —— 2100 年前的秒值最大约 4.1e9,若按毫秒
  解释会把 `'1753660800'`(2025-07-28)静默改写成 1970-01-21,实测确认。界外的行
  原样留在盘上并计入 `unresolvedEpochTextRows`,不猜。

方案 2(DDL 亲和性对齐)按裁定等 staging 存量探针另议,不在本次范围;方案 3(在
`@objectstack/driver-sql` 公共表达式里加启发式)维护者已否决 —— 上面的恢复限于
一次性迁移、且只作用于元数据声明为时间类型的列,与那条被否决的读路径启发式不是
一回事。

## 正确性姿态不变(ADR-0053 D-B3 / cloud#1003)

backfill 是**性能出口,不是正确性前提**。读写路径不依赖它跑过:任何失败(远端不可
达、标识符非法、预算耗尽)都只导致该列不被标记、读侧继续带修复、答案照旧正确,
且不会让 boot 失败。新增 20 条用例覆盖两个后果、分批/断点续跑/失败中断、完成标记
的三个门、不可解残留、以及「标记与不标记答案一致」的 D-B3 断言。

`turso-remote-temporal-conformance.test.ts` 的两条 legacy sweep 现在显式清除
canonical 标记(与 driver-sql 的 `LegacyStorageDriver.forgetCanonical` 同一做法),
并断言修复确实仍在生效 —— 此前 remote 「未 backfill」是因为压根没有 backfill 而
**碰巧**成立,现在它是 fixture 必须自己声明的状态。
