---
'@objectstack/objectql': patch
---

Lifecycle Archiver 的冷侧 `keep` prune 现在也尊重 #4747 的 teardown abort 位。

PR #5956 给 `archiveObject()` 的批循环补上了 abort 检查,但循环**之后**那条腿 —— `archive.keep` 保留期在归档库上的谓词 DELETE —— 没跟上:批循环刚因为读到 `aborted === true` 而 break,紧接着仍会向正在关闭的 cold datasource 发一次 `deleteMany`。teardown 落在最后一批的热删里时同样如此,那时循环是按短页正常退出的,连再读一次 abort 位的机会都没有。

冷侧 prune 是纯保留期回收,不像循环内的 `upsert` → `bulkDelete` 那样受「归档成功才热删」的配对约束,推迟到下一轮 sweep 不留任何不一致 —— 下一轮按同一个 `keep` 推出同一个 cutoff,清同一批行。
