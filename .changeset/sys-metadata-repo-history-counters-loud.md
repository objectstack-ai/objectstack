---
"@objectstack/metadata-protocol": patch
"@objectstack/metadata": patch
---

fix(metadata-protocol): `SysMetadataRepository` 的 `event_seq` / `version` 不再从一次失败的读里凭空发号 —— 只有「表还没建」可以从 1 开始 (#4867)

`SysMetadataRepository.nextEventSeq()` 与 `nextItemVersion()` 各有一个同形的 `catch`,把读
`sys_metadata_history` 的**全部**失败折成同一个答案:

```ts
} catch {
  // Table not provisioned yet (fresh DB) — start at 1.
  return 1;
}
```

这是 #4825 刚在 `DatabaseLoader`(TSDoc 自称 legacy、非事务的那条路径)上修掉的形状,原样长在
**canonical 路径**上 —— #4825 正文把 `SysMetadataRepository` 称作「历史写入应当收敛过去的地方」。
而且这里有两个数字:

- **`event_seq`** —— 历史排序与 rollback 定位的依据。表里已有 N 行时,一次瞬时读失败(连接抖动、
  超时、权限)让下一条拿到 `1`,与既有行撞号;
- **`version`** —— `nextItemVersion()` 的 TSDoc 明说它刻意从 history 取 MAX「so delete + recreate
  continues incrementing instead of restarting at 1」。一次读失败正好把它**恢复成它明确要避免的那个
  行为**:lineage 从 1 重启并与既有 lineage 撞号,而 `MetadataManager.rollback(type, name, version)`
  与 `POST /api/v1/meta/:type/:name/rollback` 正是按这个数字定位快照 —— 撞号之后回滚可能落到另一条
  记录的同号版本上。

关键危害与 #4825 相同,是「**落盘的字节是错的**」而不是「字节没落盘」:insert 成功、日志一行没有、
系统对外完全正常,重试不修、重启也不修。

**「在事务里」并不能挡住它。** 事务解决的是*并发*撞号;它对「从一次失败的读推导出来的数字」没有任何
意见,一个成功提交的事务照样把错号提交得同样持久。事务真正给出的是干净的补救:抛出去,整笔写入回滚,
而不是提交一个编造的号。

现在按**错误类型**判别,复用 #4825 落地的那套判别器(不另起一套):

- **良性的「表还没建」** —— 没有行,就没有可撞的号,`1` 确实是下一个号,静默返回,fresh DB 照常启动;
- **其余一切读失败** —— 按 AGENTS.md「Degradation log levels」以 `error` 上报**后果**(写入已被中止、
  事务回滚、什么都没提交;若按旧行为发 `1` 会与既有行撞号,使版本顺序不可信、回滚目标可能指向另一条
  记录的同号版本,且无人能发现、重启也修不回来)与**修复动作**(修数据源/驱动错误后重试写入),然后
  **原样抛出**,让事务回滚。一次故障只说一次,恢复时补一条 `info`。

### `@objectstack/metadata` 新增子路径导出 `@objectstack/metadata/errors`

判别器 `isMissingTableError()`(#4728/#4825 家族)此前是 `@objectstack/metadata` 的内部工具,而本次
消费者在另一个包。三个选项中选了「从现有归属地**显式导出**」:在 `metadata-protocol` 里复制一份会重建
#4825 刚消灭的双源问题(同一个问题两套「哪些驱动错误算良性」的词汇表,谁先学会一个驱动怪癖谁就先漂移);
下沉到公共依赖本轮不可行(`packages/spec` 冻结、`packages/types` 有并行改动),且本次导出并不妨碍维护者
之后再下沉。

新增的是一个**叶子子路径**而不是包入口导出:`@objectstack/metadata` 的根入口会拖进 manager、全部
loader 与其 YAML/文件系统依赖,只为一个 40 行谓词付这个重量,正是把下一个作者推回「复制一份」的原因。
`@objectstack/metadata/errors` 只 re-export 一个叶子模块,跨包依赖边因此仍是叶子边,也是将来下沉时
一个可 grep、可删除的单点。仅导出 `isMissingTableError`;同族的 `isSchemaAlreadyExistsError` 在包外
没有消费者,保持内部(导出一个无人 import 的符号是白许的承诺)。

无 API 破坏、无 schema 变更、无 `packages/spec` 改动。
