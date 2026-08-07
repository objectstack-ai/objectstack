---
'@objectstack/metadata-protocol': patch
---

`MetadataProtocol.listCommits` 不再把 commit store 读不到答成「这个 package 没有提交历史」

`listCommits` 读 `sys_metadata_commit` 的 `catch` 此前对任何失败都返回 `[]`,零日志、不按错误类型区分 —— 它的 JSDoc 甚至把这写成了设计(“Returns [] if the commit store is unavailable”)。于是 ADR-0067 的提交时间线上,「确实没有历史」与「有历史但库读不到」返回值完全一致,而这条时间线正是 `revertCommit` 的选择面:故障期间 UI 显示「无可回滚项」,`rollbackToPackageCommit` 更会在一次都没回滚的情况下返回 `success: true`。

现在按错误类型区分,与本文件既有的 `sys_metadata` 覆盖层读法(#5532 / #5707 / #5840)同一处方:表未 provision(首启)仍返回 `[]`;其余失败一律包成 503 `SERVICE_UNAVAILABLE` 上抛,驱动原始错误挂在 `cause` 上。调用方由此能把 outage 与 miss 分开。

行为变化:`GET /packages/:id/commits` 在 commit store 故障时返回 503 而不再是 `{ commits: [] }`。
