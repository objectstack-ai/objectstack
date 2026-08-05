---
"@objectstack/driver-turso": minor
"@objectstack/driver-memory": patch
"@objectstack/driver-mongodb": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-sqlite-wasm": patch
---

feat(drivers): `@objectstack/driver-turso` 迁回本仓并公开发布，五个 driver 统一收进 `packages/drivers/` (#4645)

`TursoDriver` 一直以 `extends SqlDriver` 的方式**跨仓库继承**本仓的类，自己却住在闭源的
`objectstack-ai/cloud`（`publishConfig: restricted`）。而本仓的 runtime 早就把 turso 当一等
公民——`http-dispatcher.ts` 里环境 provisioning 的偏好顺序第一位就是它，`POST /cloud/environments`
的 `driver` 参数示例是 `memory | turso`，`objectql/src/engine.ts` 还带着一段 turso 专属的瞬时
`fetch failed` 重试。开源侧的代码路径引用着一个自己仓里既测不到也 grep 不到的 driver，闭源侧则
在每次 pin bump 时追赶父类的重构。维护者裁定把核心迁回本仓、公开 Apache-2.0 发布。

**新包 `@objectstack/driver-turso`（`packages/drivers/driver-turso`，Apache-2.0，`access: public`）**
带着它在 cloud 的全部实现与测试落地：`TursoDriver`（local / replica / remote 三种传输模式）、
`RemoteTransport`（纯 `@libsql/client` 走 HTTP/WebSocket，无原生依赖，可跑 serverless/edge）、
驱动的 spec/Studio 元数据，以及 15 个测试文件 538 条断言——全部 hermetic，默认 CI 下不碰网络、
不要凭据（remote 面走包内的 sqlite stub）。

**留在 cloud（不随迁）**：按租户路由的 `multi-tenant.ts`（云产品差异化能力）及其 schema、
`vector-poc.test.ts`。因此本包的 barrel **不再导出** `createMultiTenantRouter` /
`MultiTenantConfig` / `MultiTenantRouter`，也不导出多租户 schema——它们从来不是这个 driver 的
一部分，只是曾经同包而已。

**目录重组**：五个 `IDataDriver` 实现（`driver-memory` / `driver-mongodb` / `driver-sql` /
`driver-sqlite-wasm` + 迁入的 `driver-turso`）现在都住在 `packages/drivers/`，
`knowledge-*` 与 `embedder-*` 留在 `packages/plugins/`。四个存量包**内容零改动**，只有
`repository.directory` 随目录更新——包名、入口、导出面、行为全部不变，消费者无需改动任何 import。

这也把 turso 交给了本仓的仓库级守卫：`check:driver-conformance` 从磁盘发现 driver 包，
迁入即入矩阵（5 drivers × 5 case-sets）。它的 temporal 两格是真绿（local 与 remote 双面套件），
filter 组合语义与两个分页 case-set 记为 measured DEBT——remote 传输自带一套 `buildWhereSQL` 与
`LIMIT`/`OFFSET` 拼装，是独立实现，"继承所以没问题"正是这些共享套件存在来证伪的假设。
补齐工作跟踪在 #5590。
