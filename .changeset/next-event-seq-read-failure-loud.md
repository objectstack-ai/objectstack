---
"@objectstack/metadata": patch
---

fix(metadata): 历史序号 `event_seq` 不再从一次失败的读里凭空发号 —— 只有「表还没建」可以从 1 开始 (#4825)

`DatabaseLoader.nextEventSeq()` 过去把读 `sys_metadata_history` 的**全部**失败折成同一个答案:

```ts
} catch {
  // Table not provisioned yet or driver error — start at 1.
  return 1;
}
```

注释同时点名了两种原因,然后用同一个 `return 1` 对待。这是 #4728 刚修掉的同一种形状,但危害是
**更贵的那一半**:#4728 是「字节没落盘」,本条是「**落盘的字节是错的**」。历史表里已经有 N 行时,
一次瞬时读失败(连接抖动、超时、权限)会让下一条历史拿到 `event_seq = 1`,与既有行**直接撞号**,
而 insert **成功**、日志**一行没有**。`event_seq` 正是历史列表排序与 rollback 定位的依据,撞号之后
版本顺序就永久不可信 —— 重试不修、重启也不修。

现在按**错误类型**判别,复用 #4728 落地的那套判别机制(`packages/metadata/src/utils/schema-sync-errors.ts`
里新增的 `isMissingTableError()` 与既有 `isSchemaAlreadyExistsError()` 共用同一个 code / errno /
message + `cause` 链匹配器,而不是在同一个包里另起一套错误判别):

- **良性的「表还没建」**(SQLite `no such table: …`、Postgres SQLSTATE `42P01` /
  `relation "…" does not exist`、MySQL `ER_NO_SUCH_TABLE` / errno `1146`,并跟随 `cause` 链)——
  没有行,就没有可撞的号,`1` 确实是下一个号,静默返回。
- **其余一切读失败** —— `nextEventSeq()` 原样抛出。调用方 `createHistoryRecord()` 以
  `console.error` 上报**后果**(该条历史记录未写入;元数据写入本身已成功,所以服务器仍报告健康,
  而变更历史正在悄悄出现空洞,版本时间线与 rollback 目标将不完整)、**为什么是空洞而不是错号**
  (从 1 发号会与既有行撞号,把「不完整」变成「顺序错误」,后者无人能发现)与**修复动作**,
  然后**跳过这条历史记录**。
- 判别的方向刻意保守:凡是没有被正面识别为「表不存在」的,一律当作真实失败。`does not exist`
  本身不够 —— `role "…" does not exist`、`database "…" does not exist`、`column "…" does not exist`
  都是真实失败,对着一张可能满是行的表返回 1 正是要避免的事,所以消息匹配要求 table/relation 与
  该短语同现。

两条边界保持不变:元数据写入本身**不**因此失败(记录已经落盘,把它报成失败是比原缺陷更糟的谎),
以及本路径已知的并发撞号限制(非事务,canonical producer 仍是 `SysMetadataRepository`)——那是被
记录过的限制,与「读失败静默重置到 1」是两回事。报告只说**一次**,恢复时补一条 `info`。

无 API / schema 变更;新增内部工具 `isMissingTableError()`(未从包入口导出)。
