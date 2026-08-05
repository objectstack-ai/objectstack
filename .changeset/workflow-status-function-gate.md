---
---

chore(ci): job 级 `if:` 读 `needs.*.outputs.*` 必须显式点名状态函数,并修掉 publish-smoke 的存量违规 (#5343)

GitHub 会给任何**不含状态函数**的 `if:` 隐式包一层 `success()`。于是一个本意是「读上游输出值做数据驱动决策」的 job 级条件,悄悄同时携带了一个作者从未写下的状态决策,而「上游挂了」和「上游说不用跑」这两件完全不同的事,到达时是同一个 skipped —— 在任何 checks 列表里都渲染成绿。

这个坑本仓已经手工踩过两次,相隔数月:#4900 的发布完整性守卫恰好在它前面那个 job 失败时停止守卫;#4928 在 `ci.yml` 里找到七处 `needs.filter.outputs.*` 闸门,一旦上游出事就自己把自己关掉。规则可静态判定,所以本次把它变成门禁而不是第三次靠人读出来。

**新门禁 `scripts/check-workflow-status-functions.mjs`(`pnpm check:workflow-status-functions`,接进 `lint.yml` 的 ESLint job)。** 范围严格限定在 **job 级** `if:` 且读 `needs.*.outputs.*`;step 级条件与 `needs.*.result` 刻意在外(前者的隐式 `success()` 说的是「本 job 前面的步骤挂了就别继续」,通常正是作者要的;后者本来就是状态读,作者已经在推理状态,不是被塞了一层没写的包装)。这条边界是「无需猜意图、也无需豁免名单」的前提,脚本因此**没有**任何 skip-list。

判据用**真 YAML 解析**而非 grep `if:` 行,这一步是承重的:grep 分不清「文件坏了」和「没有违规」—— 两者都是零匹配 —— 而且看不见折叠标量。本仓已有两个 workflow 写 `if: >-` 跨行(`merge-queue-triage.yml`、`pr-automation.yml`),#5343 那张靠手工 grep 得出的审计表在那里是盲的。输入缺失一律判红(目录不存在、零个 workflow 文件、YAML 解析失败、没有 `jobs:` 映射、`if:` 不是标量),绝不 `exit 0` 静默放过 —— 即 #4690 反模式的正面。`--self-test` 34 条断言跑真实 `scan()` 路径,`--list` 直接输出审计表(现有 9 处 job 级 `needs.*.outputs.*` 读)。

**`publish-smoke.yml` 的唯一存量违规按「显式红,不跑、不猜」修掉。** `pack-smoke` 的行为不变(仍是 resolve 成功且 `run == 'true'` 才跑),但 `success() &&` 现在写了出来;真正新增的是 `resolve-guard` job:`always() && needs.resolve.result == 'failure'` 时判红,并尽力把一条 failure commit status 写回 release PR head。

这里**没有**照搬 #4928 的 `!cancelled() && ... != 'false'` 形状,原因是那条「存疑就全跑」在本 workflow 不成立:`ci.yml` 的 filter job 输出带 `|| 'true'` 兜底,而 `resolve` 没有,且 `ref` 也是它算出来的 —— 存疑就跑会 checkout 一个空 ref,花 45 分钟 smoke 掉不知道什么东西,再把结论当作「release candidate 通过」报出去。发布完整性上的**假绿**比没有答案更糟。

顺带实测(#5343 留的核实项):`publish-smoke / packed-tarballs` 在 `main` 的分支保护里**不是**必需检查(必需的是 `TypeScript Type Check`、`Build Core`、`Test Core`、`Dogfood Regression Gate` 四项)。所以 resolve 挂掉时那条 status 根本不写的后果不是「PR 被卡住」,而是**它在 release PR 上完全不可见** —— 这正是新增 guard job 回写 status 所填的洞。

纯工具链改动,不发版。
