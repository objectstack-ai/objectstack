---
'@objectstack/plugin-hono-server': patch
---

修复:逃出路由 handler 的抛出不再被静默丢弃 —— 适配器接缝现在有诊断出口

`HonoHttpServer.runHandler()` 的兜底 `.catch` 此前把 rejection 显式丢弃(参数名就是 `_err`),`wrap()` 随后回一个 `{ error: 'No response from handler' }` 的 500。净效果是:**任何**逃出 handler 的抛出,在以本适配器为 transport 的 host 上都表现为一个不带原因的裸 500,而且**任何地方都没有日志** —— 连 stack 都没有。

现在该接缝会按 `Logger` 契约打一条 `error` 记录,带上原始 `message` / `stack` 与定位所需的请求上下文(`method` + `path`)。

- **`Error` 走契约的 `error` 形参槽**,不塞进结构化 meta。`Error` 的 `message` / `stack` 是 non-enumerable,直接进 meta 会序列化成 `{}` —— 那比没有日志更糟,因为它会报告成功。跨 realm 的 `Error`(`instanceof` 不成立)会按 `name`/`message`/`stack` 重建;`throw 'boom'` 这类非 `Error` 抛出会被描述进 message 而不是丢掉。
- **请求体不入日志** —— 只有 `method` 和 `path`。
- **默认就有日志出口。** 未接线时适配器用 `createLogger()`,而不是静默:直接内嵌 `HonoHttpServer` 的 host(serverless 入口)正是本问题的生产现场,静默默认会对它们原样复现该 bug。`HonoServerPlugin.init()` 会用 `ctx.logger` 替换掉默认值;要静默须显式传 `NoopLogger`。

新增 `HonoHttpServer.setLogger(logger)`(纯新增,不改 `IHttpServer` 契约)。

⚠️ **响应形状一字未改**:兜底 body 仍是 `{ error: 'No response from handler' }` + 500,已加测试钉住。把它收成声明信封会改变线上响应形状,属另一项尚未裁决的契约决策,不随本次改动附带。
