---
"@objectstack/objectql": patch
---

fix(objectql): 新建父行时把 count/sum 型 `Field.summary` 汇总字段初始化为 0

`recomputeSummaries()` 只会重算「本次子记录写入所指向的父行」,所以一个**从未有过子记录**的父行永远不会被访问到,汇总列停在 insert 时的 `null`;而把最后一条子记录**删掉**的父行反而会被访问到(经由 `previous`)并落到 `0`。同一个「零个子记录」的逻辑状态因此读出两个不同的值。

后果不是显示难看,而是**筛选静默漏行**:`["task_count","=",0]` / `["task_count","<",1]`(库内比对)会把「从来没建过任务的项目」整行丢掉,没有任何报错;排序、GROUP BY、以及以该字段为输入的公式字段(null 传播)同样受影响。

本次在**生产端**修:父行 insert 时,按父对象取一份 summary descriptor,把该行自己拥有的 `count` / `sum` 汇总字段落成空集合的值 `0` —— 与 `recomputeSummaries` 的空集兜底共用同一份函数清单(现已提取为单一来源),所以「从未有过子记录」与「删光子记录」必然读到同一个值。`min` / `max` / `avg` 在空集上没有定义,仍然保持 `null`,口径不变。

边界:

- 作者显式提供的值不会被覆盖(与 `applyFieldDefaults` 同口径:insert 时 `undefined` 与显式 `null` 都算「未提供」);`beforeInsert` 钩子仍有最终决定权。
- 关系无法解析的汇总字段不落初值 ——「落了初值」与「会被重算维护」是同一个集合,不会出现一个没人维护的 `0`。
- **存量数据不受本 PR 影响**:这是 create-time 初始化,已经存成 `null` 的老父行仍然是 `null`,直到某次子记录写入把它重算。存量回填是独立取舍,另行处理。
