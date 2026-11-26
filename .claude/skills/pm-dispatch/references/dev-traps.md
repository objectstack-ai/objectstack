# os-dev 逐面陷阱(碰到该面才读)

## Toolchain traps

- `--workspace-concurrency=2` 只对过滤后的 run-command(`run` / `build`)成立,放在 `--filter` 之前。
- 放在 filter 之后会被转发给底层脚本,且该 flag 不叫 `--concurrency`。
- pnpm 10 在 `install` 上直接拒绝它(`ERROR Unknown option: 'workspace-concurrency'`)。
- pnpm `overrides` 只住在 `pnpm-workspace.yaml`;加进 `package.json` 的那份什么都不改。
- OSV override 的上界 ⛔ 永不写成恰好排除修复版:上界放在 major 边界,只挪替换目标。
- 新 fake engine 的 `delete()` 开头用 `@objectstack/objectql` 的 `assertEngineDeleteDispatch(options)`。
- ⛔ 永不手抄一份 id/multi 检查,那正是 `check:engine-double-contract` 点名的洞。
- 从门禁绿跑清单里挑一个已 pin 的 fake 照抄。
- 缺一种该文件没有的 double 时,覆写文件里已有的 double 优于 pin 新的:不动台账。
- `ui/` 的包把 typecheck 拼作 `type-check`(连字符);核对输出里确实回显了脚本名。
- 浏览器验证:Chromium 已预装,`PLAYWRIGHT_BROWSERS_PATH` 指向 `/opt/pw-browsers`。
- launch 传 `executablePath: '/opt/pw-browsers/chromium'`;⛔ 永不跑 `playwright install`。

## 浅检出上的祖先读数

- `merge-base --is-ancestor` 的非祖先在浅检出上是假绿:缺的对象只扣下祖先路径,不会造一条。
- 失效单向:exit 0(是祖先)自证,任何检出里都作数;只有 exit 1 要控制腿。
- 还没发布、不在 main 上、`Blocked-by` 已落地这些前提核验,要的恰是 exit 1。
- 阴性读数按两条腿写:同一检出、同一目标 ref 上再跑一个已知在其历史里的 commit。
- 它必须答 exit 0;否则阴性作废,`git fetch --deepen` / `--unshallow` 到控制腿转 0 再重读。
- ⛔ 控制腿别挑浅窗内的近亲:控制 commit 至少与被测那个同深;两条腿的退出码都进报告。
- `--is-shallow-repository` 是便宜的触发器不是判据,判据是控制腿。

## `packages/cli` 与启动路径的测试层

- 跑法 `pnpm --filter @objectstack/cli exec vitest run --project unit`;CI 的 `pnpm test` 跑两层。
- 只有 diff 碰到 integration 层文件、spawn 入口(`bin/`、`test/helpers/serve-process.ts`)时才本地跑它。
- driver/kernel 启动路径同此;那时跑 `--project integration` 并在报告里说明,否则写已声明给 CI。
- 层是测出来的,不是列出来的:spawn CLI 或启动 driver 的测试按 `packages/cli/vitest-tiers.ts` 落。
- 分区 pin `test/vitest-tiers-partition.test.ts` 在某个测试文件两层皆无或皆有时变红。
