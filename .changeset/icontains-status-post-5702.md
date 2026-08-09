---
"@objectstack/spec": patch
---

filter: `$icontains` 的实施状态改按实测重写(#6947)

`filter.zod.ts` 上 `StringOperatorSchema` 的状态段仍然写着「没有任何后端应答 `$icontains`,五个 driver 一律拒收,直到 #5702 落地」。#5702 已于 2026-08-08 关闭,该段自述的过期条件已经触发,文字与已发布的实现正好相反。

按 driver 逐个实测(同一条 `{ name: { $icontains: 'acme' } }` 打到同时含 `acme corp` 与 `ACME CORP` 的样本上,而不是 grep case 分支 —— grep 看不见继承编译器的那一面,会少数一个):**五个 driver 里三个应答**(`driver-sql`;`driver-sqlite-wasm` 通过继承 `SqlDriver`,在另一套 sql.js 引擎上;`driver-turso` 的 local 与 remote 两条传输都应答),**两个响亮拒收**(`driver-memory`、`driver-mongodb`,均为 `INVALID_FILTER` / 400)。据此改写状态段,并同步 `$icontains` 的 `.describe()`(它会渲染进 `content/docs/references/data/filter.mdx`,原文同样停留在「lowerings land with #5702」)。

⛔ 行为零变化:`FILTER_OPERATORS` 未动,`$icontains` 仍然刻意不在词表里 —— 该数组是运行时 allowlist,收进去会让内存 `match()` 对**不匹配**答 `true`。词表的真实闸口从此写明是 #6520(JS 求值面),不再是已经落地的 #5702。
