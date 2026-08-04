---
---

ci(dx): `packages/qa/dogfood` 的 strict tsconfig 现在真的被执行 —— 加上 `typecheck` script 并从 `scripts/check-type-check-coverage.mjs` 的 DEBT 账本毕业(#4855)。Dev scripts / CI only;releases nothing。

dogfood 有一份认真的 tsconfig(`strict`、`NodeNext`、`include: ["src/**/*", "test/**/*"]`),但 package.json 的 scripts 里只有 `test`。根 `pnpm typecheck` 是 `turbo run typecheck`,只跑声明了该 script 的包 —— 三个 qa 包里,这是唯一没声明的一个,所以这份配置**从未被执行过**。#4311 的覆盖率闸门确实看见了这个洞,但把它记成 DEBT(`errors: 12`)冻结了下来,而 DEBT 是「暂缓」不是「豁免」:门后的错误只会继续涨。在最新 main 上实测是 **14** 条,比账本冻结时多了 2 条 —— 正是这种漂移说明冻结不能长期替代执行。

14 条全部修掉,分四类:

- **NodeNext 缺扩展名(2 条,TS2307)** —— `field-zoo-roundtrip.dogfood.test.ts` 与 `field-zoo-value-shape.test.ts` 写 `from './field-zoo.matrix'`。包内另外 33 处相对 import 全都带 `.js`,这两处是仅有的例外。vitest 能解析,tsc 不能。附带消掉 1 条级联的 TS7006(未解析的 import 让符号退化成 `any`,回调参数随即报 implicit-any)。
- **flow fixture 的 `type` 没有收窄(8 条,TS2322)** —— 四个 fixture 的 flow 是裸对象字面量,`type: 'autolaunched'` 推成 `string`,喂给 `defineStack` 时对不上字面量联合。修法不是 `as const`,而是按 `examples/app-todo/src/flows/task.flow.ts` 的既有写法标注 `: Flow`(`import type { Flow } from '@objectstack/spec/automation'`)—— 这样整份 fixture 都被 spec 的真实契约检查,而不只是让报错闭嘴。
- **条件展开出的 headers(2 条,TS2322)** —— `attachments-permission-matrix.dogfood.test.ts` 的 `token ? { Authorization } : {}` 在匿名分支上推出 `Authorization?: undefined`,展开进 `headers` 后 `HeadersInit`(`Record< string, string >`)拒收。给该常量标注 `Record< string, string >`。
- **连接器 handler 少传一个参数(1 条,TS2554)** —— `showcase-mcp-self-connection.dogfood.test.ts` 调 `handler!({})`,而 `McpConnectorBundle.handlers` 声明的是 `(input, ctx)`,引擎侧 `connector-nodes.ts` 也始终按两参数派发。这条一直「能跑」,只是因为 MCP 这个 handler 恰好忽略 `ctx` —— 契约上它是错的。改为按声明传两参数,与 connector-mcp 自己的测试一致;**没有放松任何契约**(把 `ctx` 改成可选才是错误方向)。

修完接进执行:package.json 加 `"typecheck": "tsc --noEmit"`,并按闸门的 RECONCILED 不变式在同一个 PR 里删掉 DEBT 条目(graduated)。覆盖率从 60/77 走到 61/77,DEBT 从 17 个包降到 16 个。反向验证:在 fixture 里塞一个非法的 flow `type`,`turbo run typecheck` 判红并精确指出该行;移回后判绿(命中修复前那一次绿跑的同一个 turbo hash)。`pnpm --filter @objectstack/dogfood test` 481 passed / 3 skipped,行为未变。
