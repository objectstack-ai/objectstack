---
"@objectstack/plugin-dev": patch
---

fix(plugin-dev): 请求了组织墙而企业包不可用时拒绝 init,不再只 warn 就无墙跑 (#5301)

`DevPlugin` 请求了有墙 tenancy posture(`isolated` / `group`)却加载不到企业
`@objectstack/organizations` 时,只打一条 `logger.warn` 就继续 boot。于是同一台机器上,
**同一个事实**有两个相反的答案:

| 入口 | 请求 `isolated`、企业包缺失 | 结果 |
|---|---|---|
| `objectstack serve` | 拒绝启动(除非显式 `OS_ALLOW_DEGRADED_TENANCY=1`) | 安全 |
| `DevPlugin`(改前) | warn 后继续 | **无墙服务流量**,且没人显式同意过 |

ADR-0093 D5「请求了隔离就不得在没有隔离的情况下服务流量」是**部署**的性质,不是某一个
入口的性质,所以 dev 装配路径欠同一个答案。#5262 让这条更容易被触发而不是更难:在它之前,
只设 `OS_TENANCY_POSTURE` 的 dev 栈根本不进这个分支(那是 #5262 本身的缺陷),修好读数之后
它会进分支、会加载失败,然后正好走这条 fail-open 的路。

**改为 `throw`,不是 `process.exit(1)`。** `serve.ts` 必须 `process.exit`,因为它那道闸
嵌在会吞异常的 AuthPlugin `try` 里;`DevPlugin` 是**库形态**的装配插件,对宿主进程没有处置权,
嵌入方(测试、脚本、父应用)有权 catch 它。而且它的 boot 链不吞异常——`kernel.use()` 只登记、
`initPluginWithTimeout` 不 catch、`bootstrap()` 会 rethrow——所以 `throw` 能真的中止 boot,
与同文件 `assertNotProduction()` 的既有依据一致。

**照 #4818 分两阶段,两种失败两种诊断:**

- **阶段 1(import 失败 = 包缺失)**:`OS_ALLOW_DEGRADED_TENANCY` 生效。未设则拒绝 init,
  报文里点名被请求的 posture 和全部出路;设了则照旧 warn 后降级继续,而且这条 warn 仍然
  如实说明墙是 INACTIVE。判定用的是 `resolveAllowDegradedTenancy()`——和 `serve.ts`
  同一个 resolver,所以两个入口对「显式同意」的定义不可能漂移。
- **阶段 2(construct / init 失败 = 包在、插件自己拒绝)**:hatch **不覆盖**,一律中止。
  该 hatch 的含义始终是「这个能力**缺席**,我接受降级」,而不是「替我越过插件正在执行的闸」;
  让它放行会把插件的许可证/前置条件检查降格成一个环境变量。报文原样转述插件自己的说法,
  框架不解释,并明说这**不是**缺包问题,省掉一轮「去查安装」的排查。

阶段 2 在 `DevPlugin` 里比 `serve.ts` 多一处落点:`serve` 把插件交给 `kernel.use()`,
其 Phase-1 循环会 rethrow init 失败;而 `DevPlugin` 自己 init 子插件,那个循环刻意是
best-effort(记一条 error 继续,dev 栈才能在缺包时照常起)。对这一个子插件,best-effort
默认就是同一个 fail-open,所以它现在单独例外——其余子插件的容错**完全不变**。

**迁移。** 只影响「请求了有墙 posture 且企业包不可用」的 dev 栈——此前它静默降级,现在会
拒绝启动。若确实要在无墙状态下继续跑,显式设 `OS_ALLOW_DEGRADED_TENANCY=1`,与
`objectstack serve` 的做法一致。单组织(`single` posture,即默认)栈完全不受影响,
不进这个分支,也不需要这个 hatch。
