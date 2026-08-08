---
'@objectstack/objectql': patch
---

HAVING 求值对齐 #5298 的 NULL-safe 裁决:聚合行上没有值的列现在满足 `$nin` 与 `$notContains`,与 driver-sql / formula / service-analytics 一致(此前 HAVING 是唯一仍判否的求值面)。
