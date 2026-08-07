---
"@objectstack/runtime": minor
"@objectstack/cli": minor
---

fix(runtime,cli): 未设置 `NODE_ENV` 时 `/discovery` 不再自称 `development`,统一按 `production` 解读 (#5673)

同一个「宿主没有设置 `NODE_ENV`」的事实,仓里原本有两套相反的默认:`os start` 未设时强制
`NODE_ENV='production'`(`start.ts:248`),`os serve` 与 `os doctor` 按
`NODE_ENV || 'production'` 解析 `.env*` 级联,而 `/discovery` 的 `environment` 字段
直接把缺省读成 `development`。

**为什么这个方向的错报是危险的那个。** `environment` 是**机器可读面**上的字段,客户端
拿它回答「我在不在生产环境」,并可能据此不显示生产警示、放宽破坏性操作的二次确认。一个
忘记设 `NODE_ENV` 的真实生产部署,过去会拿到 `development` —— 两种错法里代价更高的那种。
按 maintainer 2026-08-06 裁定,缺省统一收敛到保守值 `production`。

**迁移说明(行为变更,请对照自己的部署方式读)**

- **生产部署忘设 `NODE_ENV`**:`/discovery` 的 `environment` 由 `development` 变为
  `production`。这正是本次修复的目标 —— 报的是实情,不需要任何动作。
- **本地开发**:不受影响。`os dev` 会 spawn `serve --dev`,而 `serve` 在 `--dev` 且
  `NODE_ENV` 未设时就地设 `NODE_ENV='development'`(`serve.ts:490-491`),所以
  `pnpm dev` / `pnpm dev:showcase` / `dev:crm` / `dev:todo` 链路上 `NODE_ENV` 早已是
  显式的 `development`,`/discovery` 仍报 `development`。没有任何脚本因此改动。
- **需要 `development` 却不走 `os dev` 的场景**(裸 `os serve`、以库形式内嵌运行时、
  自建容器入口):现在必须显式 `NODE_ENV=development`。这是本次唯一需要动手的一类。
- **已设置的合法拼法一律不变**:`production`/`prod` → `production`,
  `staging`/`sandbox` → `sandbox`,`development`/`dev`/`test` → `development`。
- **无法识别的拼法处置不回退**:`qa`、`preview`、`uat` 这类**设了但认不出**的值仍然
  降级为 `development`,#4828 的「绝不凭猜测宣称 production」保持原样。缺省不是猜测,
  是宿主选择不说 —— 两条是不同的规则,本次只动前者。

**`os doctor` 新增一行提示。** `NODE_ENV` 未设时报
`NODE_ENV  Not set — this environment is being treated as production`(warning,不影响
退出码),`--verbose` 展开显式设置的两条命令。已设置的环境完全没有这一行,报告与从前
逐字一致。统一默认让缺省变得**安全**,但也让「疏忽」和「有意的生产部署」变得无法区分;
这一行是唯一能把两者分开的地方。

**已知残留(已另开 #5936 跟进,本次不动)。** `/discovery` 有两个生产者。本次改的是
`@objectstack/runtime` 的 `HttpDispatcher.getDiscoveryInfo()`;经 `@objectstack/rest`
暴露的 `MetadataProtocol.getDiscovery()`(`packages/metadata-protocol`)把真实缺省原样
递给共享映射函数,该函数对缺省仍返回 `development`。裁定把落点限定在 runtime 侧、把
`packages/metadata-protocol` 标为跨域文件面,所以此处如实记录而非顺手绕过。
