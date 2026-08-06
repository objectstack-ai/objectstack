---
"@objectstack/cli": minor
---

feat(cli): `libsql://` URLs boot a Turso driver — via an optional package, never a silent SQLite fallback (#5602)

`os start --database libsql://my-db.turso.io --database-auth-token $TURSO_TOKEN`
是 `os start --help` 自己列出的 example,但在此之前它必然 `exit 1`:CLI 的
URL → driver 推断认得 `libsql://`,却当场抛 `UnsupportedDriverError` —— 而 runtime 的
环境 provisioning 把 turso 排在偏好第一位。两处口径相反的原因(driver 不在开源分发里)
已随 #4645 把 `@objectstack/driver-turso` 迁回本仓而消失。

现在这条 example 成真:

- **识别即构造。** `libsql://` / `*.turso.io` 解析为 `turso` datasource 定义,
  `--database-auth-token`(`OS_DATABASE_AUTH_TOKEN`,回落到 vendor 自己的
  `TURSO_AUTH_TOKEN`)进入 driver 配置 —— 该 flag 此前只被转发进子进程环境、无人读取。
- **可选依赖 + 动态 import。** `@objectstack/driver-turso` 声明为 CLI 的
  **optional peer**(它会拖入 `@libsql/client`),默认安装体积不变;只有真正选了 libSQL
  的启动才会动态 import 它,并通过 `DefaultDatasourcePlugin` 既有的 host-factory 接缝注入。
  连接路径、`bootCritical` 失败裁决、`OS_ALLOW_DRIVER_CONNECT_FAILURE` 逃生舱与
  Setup → Datasources 的状态留存因此与其他 driver 完全一致(#3826)。
- **包缺席时响亮失败。** 抛 `MissingDriverPackageError`,消息给出精确安装命令
  (`npm install @objectstack/driver-turso`)、说明它是 optional peer,并说明为什么
  ⛔ 不回退 SQLite:静默降级会让服务器对着一个空的本地库启动,而你的 libSQL 数据原封不动,
  每一次写入都落在错误的数据库里(#3276 的教训)。
- **仍然拒收的形状。** `--database-driver turso` 但没有任何 URL —— libSQL 没有可猜的默认值,
  这条继续抛 `UnsupportedDriverError`,而不是悄悄用 SQLite 默认值顶上。

`os start` 的 example 加了「需安装 driver 包」注记,Drivers / Self-hosting /
Environment variables / CLI 四处文档同步为「可选包支持」口径。
