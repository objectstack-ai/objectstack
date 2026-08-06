---
"@objectstack/service-analytics": patch
---

fix(service-analytics): dataset 响应的 `fields` 在「度量全部自带 filter」的路径上也描述维度列 (#5537)

一个 dataset 查询,只要它的**基础度量全部带有自身的 `filter`**(或它选中的 derived
度量的依赖全部如此),响应里的 `fields` 就只剩度量列,被选中的维度**完全没有描述符**。
维度值一直都在 `rows` 里(它就是合并键),但读取列元数据的消费者拿不到维度列的
`label` 与 `type`,只能退回去 humanize 原始行键。

HotCRM「Sales Performance」上肉眼可见:同一个声明了 `label: 'Owner'` 的 `owner` 维度,
"Open Pipeline by Owner"(度量无 filter)表头是 `Owner`,而 "Win / Loss by Rep"
(`won_count`/`lost_count` 各带 filter、`win_rate` 是 ratio)表头是小写 `owner`。
换成字符串维度 `lead_source` 看起来正常纯属巧合 —— humanize 后恰好等于真 label;
两种维度的描述符其实都丢了。

根因在网格装配处,不在渲染端:`DatasetExecutor.runMeasurePass` 只有在存在**无 filter**
度量时才发那条主查询;当每个基础度量都自带 filter 时,它从 `{ rows: [], fields: [] }`
起步,而随后每个补充子查询只追加一个**度量**描述符。现在这种情况下,维度描述符取自
**第一个补充子查询自己的结果** —— 它 group by 的维度与整个网格完全一致 —— 因此两条路径
的 `fields` 形状(维度在前、顺序、`type`)按构造收敛,而不是靠 executor 再抄一份
「哪些维度被投影」的规则(该规则的单一事实源在各 strategy 的 `buildFieldMeta`,#4033)。

`compareTo`、`totals` 与 derived 度量都经由同一条 pass,所以一并修好。

已知的相邻缺口**不在**本次修复范围,单独立了 #5688:一个只带 `dateRange` 的
`timeDimensions` 条目会被补上 dataset 的默认粒度,于是「窗口」变成第二层 GROUP BY,
网格被按月拆分、并多出一个没人选过的时间列(该列在 `fields` 里也拿不到 `label`)。
它在两条路径上表现一致(本次修复前后皆然),且修它会改变响应形状,故不搭车。
