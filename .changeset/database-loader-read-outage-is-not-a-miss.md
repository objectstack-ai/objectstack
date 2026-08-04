---
"@objectstack/metadata": patch
---

fix(metadata): `DatabaseLoader` 的读故障不再被吞成「什么都没声明」(#5108)

`DatabaseLoader` 的五个读方法此前都把**任何**存储异常 `catch {}` 成各自的空值 ——
`load` → `null`、`loadMany` → `[]`、`exists` → `false`、`stat` → `null`、
`list` → `[]`。于是 `sys_metadata` 所在库不可达时,`loadMany('permission')` 与
「这个环境一条 permission 都没声明」返回**完全一样的值**,而且异常是在 loader 内部
就被抹掉的:`MetadataManager` 那几个 `try/catch` 降级分支拿到的是一次「成功的空读」,
根本不会触发,整条链上没有任何一处会说出「读失败了」。

现在按**错误类型**判决(#4632 立的规矩,#4728 / #4825 已经在同一个文件里用过两次的
形状,判据复用现成的 `isMissingTableError`):

- 唯一良性的失败原因是 `sys_metadata` 尚未 provisioned —— 那时确实没有行,
  「什么都没声明」就是事实,首次启动照旧返回空值、不报错、不缓存;
- 其余全部原因(连接断开、超时、权限不足、查询出错)意味着行还在、只是这次没读到,
  一律把驱动原始异常**原样抛出**,由调用方决定降级姿态。判据保守:无法正面识别为
  「表不存在」的错误一律当作真故障。

由此上层三个已有的机制第一次真的生效:

- `MetadataManager.list()` 的降级分支会真的进,并且**升级到 `error`**
  (AGENTS.md「Degradation log levels」:系统看着正常、它声称掌握的清单其实是残缺的),
  日志写明后果与修法,每次故障只说一次、恢复时再说一次;`list()` 仍然尽力返回可读
  loader 的内容 —— 这个 best-effort 姿态是刻意保留的。兄弟方法
  `MetadataManager.loadMany()` 的同一条缝走同一个判决,不让同一次故障在同一个文件里
  报出两个级别;
- `MetadataManager.loadDiagnosed()`(ADR-0110 D3)对 `DatabaseLoader` 终于能报出
  `degraded` / `errors`,而不是把 outage 报成 miss;
- `listForIndex()` / `matchEndpoint`(#5089)契约要求「读不到存储必须抛出,不得伪装成
  miss(miss 会变成 404)」—— 这条此前对 `MemoryLoader` / `RemoteLoader` 有效、对
  `DatabaseLoader` 无效,现在对真实的 datasource loader 也成立了。

**行为变化**:`MetadataManager.exists()` 与 `listNames()` 本来就没有 `try/catch`,
所以存储故障现在会从它们抛出,而不再静默答「不存在」/「空清单」。这正是本次修复要的
姿态 —— 可用性故障不是一次「没有」。
