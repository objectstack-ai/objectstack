---
"@objectstack/objectql": patch
---

修复自增号播种扫描的 5000 行窗口:`seedAutonumber()` 现在读取计数器 scope 内**每一行**的最大值

引擎兜底路径(驱动未声明 `supports.autonumber`,即 memory / mongodb)的自增号播种,此前是一次 `limit: 5000`、**无排序、无过滤**的 `find`,把「任意 5000 行窗口内的最大值」当成了全表 MAX。两种情况下会播种出低于真实 MAX 的号:

- 对象行数超过 5000;
- 某个 scope(日期 / `{field}` 分组)的行被其他 scope 的行挤出窗口 —— 前缀过滤此前只在 JS 侧做,而窗口早已选定。

计数器随后从一个已被占用的号段起号。对声明了 `unique` 的记录号字段,这就是直接发出重复的业务标识符 —— 一个写错了的值,重试和重启都修不回来。

改为完整扫描:以 `keysetWalk` 按 `id` 游标分页(而非 `offset`,理由见 #4363),把前缀下推为 `$startsWith`,数值最大值在引擎侧逐值解析得出。这与 SQL 驱动自身的播种形状(`scanMaxNumericTail`,`like 'prefix%'` 无 limit)一致。

数值最大值刻意**不**委托给 `orderBy desc + limit 1` 或聚合 `max`:两者都按文本排序,而字典序等于数值序仅当 scope 内所有值补零到同一定宽 —— 格式语言并不保证这一点(无 `{0..0}` 槽位的格式渲染裸计数器,`'9' > '10'`;任何定宽在计数器越过后都会溢出)。

扫描无法走完时(行缺 `id` 游标、或驱动未执行游标谓词)拒绝播种并大声失败,而不是用「已读部分的最大值」这个下界起号 —— 与 #6114 对读故障的处置同族:不分配号,不写入。

声明了 `supports.autonumber` 的驱动(`driver-sql` / `driver-turso` / `driver-sqlite-wasm`)走各自的 `_objectstack_sequences`,不受影响,改动前后均不产生播种扫描。
