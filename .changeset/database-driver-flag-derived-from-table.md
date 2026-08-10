---
"@objectstack/spec": patch
"@objectstack/cli": patch
---

refactor(spec,cli): `--database-driver` 的可选值从共享驱动表推导，删掉 CLI 里的第二份词表 (#6969)

**无行为变更**：`os start --database-driver` / `os dev --database-driver` 接受的取值集合
与改动前**逐字相同**（`memory`、`sqlite`、`sqlite-wasm`、`postgres`、`mysql`、`mongodb`、
`turso` 七个，一个不多一个不少）。唯一可见的差别是 `--help` 里这七个值的**枚举顺序**，
说明见下。

#6345 把平台的驱动词表收敛成 `@objectstack/spec` 的一张表之后，CLI 里仍留着它的副本：
两条命令各自用手写字面量数组声明 oclif 的 `options:`（一份强制白名单），并且各自在
`description:` 的散文里把同样的 id **再抄一遍**。四份副本，一张表，正是 #6535
（`IMPORT_JOB_MAX_ROWS` 两处定义）的形状挪了个包。

现在 `@objectstack/spec` 导出 `DATABASE_DRIVER_SELECTION_IDS`——**选择面**（
`DriverVocabularyEntry.aliases`）收敛到规范拼写后的投影——两条命令连同 help 散文里的
枚举都从它派生，CLI 内不再有任何手写驱动 id 列表。

取的是选择面而**不是**配置契约面（`DRIVER_ID_ALIASES` / `resolveDriverId`）：后者按设计
包含 `contractOnlyAliases`（`sqlite3`、`better-sqlite3`、`mariadb`、`inmemory`）——它们能
解析出一份存量 datasource 的 config 契约，但两个启动宿主从来都不接受它们作为启动选择。
把它们摆上 flag 会是一次**放宽**，只是穿了重构的外衣。新增用例驱动 oclif 真实 parser，
证明这四个拼写仍在 parse 阶段被拒。

这不是在修一个用户会撞到的缺陷：`database-driver-allowlist.pin.test.ts`（#6860）已经在钉
「白名单 ↔ `resolveStorageDefinition` 能解析出的驱动种类」这条一致性，而且 #6345 落地当天
就抓到过一次真回归。本次改动是结构性的——第二份定义没有了，钉子守的那条一致性也就无法
再由「改了一个文件忘了另一个」打破。该钉子**未被改动**，改后依旧全绿。

**`--help` 顺序**：枚举顺序从 CLI 手写的 `sqlite | sqlite-wasm | turso | postgres | mysql |
mongodb | memory` 变为共享表的行序 `memory | sqlite | sqlite-wasm | postgres | mysql |
mongodb | turso`。同一份 CLI 在你拼错驱动名时打印的 “Supported drivers: …” 早就用的是行序，
所以改后 `--help` 与它自己的拒绝信息终于按同一个顺序列举驱动。要保住旧顺序，就必须在
`packages/cli` 里留下一份手写的顺序列表——恰恰是本卡要删掉的东西。
