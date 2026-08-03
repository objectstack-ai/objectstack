---
"@objectstack/metadata": patch
---

fix(metadata): `sys_metadata` 的 DDL 失败不再被静默吞掉 —— 只有「表已存在」这一种原因可以静音 (#4728)

`DatabaseLoader.ensureSchema()` 过去用一个空 `catch` 吞掉 **全部** DDL 失败,并且照样把
`schemaReady` 置为 `true`:

```ts
} catch {
  // If syncSchema fails (e.g. table already exists), mark ready and continue
  this.schemaReady = true;
}
```

注释里的免责理由只覆盖了失败原因中最良性的一种,却用它为**所有**原因开脱。真实的失败
(权限不足、数据源根本没连上、列类型冲突)之后,表或新列压根不存在,而进程的状态与成功
路径**逐字节相同**,启动日志里一行痕迹都没有 —— 这正是 #4420 的形态:声称已持久化、实
际没落盘、系统看起来完全健康。#4632 把它定成规则(AGENTS.md → "Degradation log levels"),
机械检查 `pnpm check:durability-log-level` 已经能发现这一处。

现在按**错误类型**判别,而不是按注释里的乐观假设:

- **良性的「已存在」**(SQLite 的 `table … already exists` / `duplicate column name`、
  Postgres 的 SQLSTATE `42P07`/`42701`/`42710`、MySQL 的 `ER_TABLE_EXISTS_ERROR` 等及其
  `errno`,并跟随 `cause` 链)—— 表确实已就绪,当作 no-op 静默通过,并照常执行后续的
  `project_id → environment_id` 迁移与 ADR-0005 索引。
- **其余一切失败** —— 以 `console.error` 上报,文案同时说清**后果**(`sys_metadata` 的表/
  列未创建,后续每一次元数据写入都会报错、或在宽松驱动上悄悄丢列,而服务器仍报告健康)
  与**修复动作**(修掉下面那条驱动/数据源错误后重启)。只说**一次**,不是每次写入都刷屏。
- `schemaReady` **不再**在真实失败后置 `true`。启动依旧不被阻断(该方法不抛),但 loader
  不再声称一个它并不具备的就绪状态,下一次元数据操作会重试 —— 数据源只是还在连接这类瞬
  时故障因此可以自愈,恢复时补一条 `info`。

`ensureHistorySchema()` 按同一规则对齐:良性「已存在」不再每次写入都打一条 `error`(过度
使用 `error` 是镜像失败),真实失败则同样只响亮一次并保持重试。

无 API / schema 变更;新增内部工具 `isSchemaAlreadyExistsError()`(未从包入口导出)。
`scripts/durability-degradation.baseline.json` 中指向本单的条目随之删除(该文件 shrink-only)。
