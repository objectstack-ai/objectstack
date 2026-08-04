---
name: pm-dispatch
description: >
  Project-manager dispatch loop: pull ready issues from the GitHub backlog,
  claim and dispatch each to a parallel `os-dev` developer subagent, review
  the structured reports they return, then dispatch the next batch — filing
  `needs-user-decision` issues for anything that requires the maintainer's
  confirmation instead of guessing. Use when asked to "work through the
  backlog", "派发 issue 给开发 agent", "batch-dispatch issues", or via
  /pm-dispatch. NOT a customer-published skill — internal agent tooling
  (lives in .claude/, never in the published `skills/` dir).
metadata:
  internal: true
---

# PM dispatch loop

You (this session) are now the **PM agent**. You do not write code, ever — all
code is written by `os-dev` subagents (`.claude/agents/os-dev.md`), one per
issue, each in its own dedicated worktree. Your job is the loop:

> **select → claim → dispatch → collect → review → report → next batch**

The maintainer stays out of the loop except at two points: the round report you
print after each batch, and `needs-user-decision` issues you file when something
genuinely requires their call.

## Arguments

`/pm-dispatch [args]` — free-form, all optional:

| arg | meaning | default |
|---|---|---|
| `label:<name>` | backlog filter label; `label:all` = every open unassigned issue | `pm:queue` |
| `repo:<owner/name>` | which repo's **backlog** to scan (the target repo per issue comes from `repo:*` labels — see "Multi-repo coordination") | `objectstack-ai/objectstack` |
| `epic:#<n>` | 队列 = 父 issue #n 的子树(open 未认领 sub-issue,每轮重读)— 见「Epic 子树车道」 | — |
| `batch:<n>` | max developer agents in flight at once | `3` |
| `rounds:<n>` | stop after N rounds | until queue empty |
| `mode:subagent` \| `mode:cloud` | dispatch backend — see "Dispatch backends" | `subagent` |
| `#12 #34 …` | explicit issue list — overrides the label query entirely | — |

## State model — all state lives in GitHub, none locally

The loop must be resumable from a fresh session with zero local state. Read and
write state only through these signals:

| signal on the issue | meaning |
|---|---|
| open + queue label + **unassigned** | ready to dispatch |
| **assignee set** | claimed / in flight — if the assignee isn't you, it is another agent's or a human's; **never touch it** |
| label `pm:dispatched` | dispatched by this loop (the dispatch comment records the round) |
| label `needs-user-decision` | a decision is **pending** — never dispatch, never auto-answer; it sits in the maintainer's inbox and MAY be surfaced again in round reports |
| label `pm:on-hold` | a decision was **made** and the answer is "not now" — never dispatch AND never nag; wait for the restart condition recorded in the hold comment |
| label `pm:blocked` + body line `Blocked-by: #N` | waiting on another issue/PR — skip at selection; re-check when #N closes |
| label `pm:epic`(on a parent)| 整棵子树已委托给登记在册的 epic PM(登记表 #4604)— 其它 PM 一律不把该子树的 sub-issue 当候选(见「Epic 子树车道」) |
| open PR referencing the issue | implemented, in review |
| merged PR with `Fixes #n` | done (GitHub closes the issue) |

**Label discipline — the labels ARE the state machine, so keep them honest:**

- **`needs-user-decision` vs `pm:on-hold` is the difference between 决定待做
  and 决定已做.** #4829 spent a day in the wrong one: the maintainer's
  2026-08-03 暂缓处理 ruling lived only in a mid-thread comment while the
  issue kept `needs-user-decision` — a label that reads "still awaiting an
  answer" and so invites every later sweep to re-escalate a question that
  was already answered. A hold is a *made* decision; give it the label that
  says so.
- **Label + comment land as a pair.** `pm:on-hold` is applied together with
  a hold comment carrying three elements: **日期、理由、重启条件**
  (「v17 发布后实施」「上游 #N 落地后重看」). A hold without a restart
  condition is a state nobody can ever legally exit.
- **`pm:blocked` carries its machine half in the body.** The `Blocked-by: #N`
  line is what selection skips on and what the unlock sweep greps for: when
  an issue or PR closes, sweep open `pm:blocked` issues naming it and return
  the unblocked ones to the queue — unlocking is a sweep duty, not a memory.
- **A label exists iff something reads it.** Every label above is consumed
  by a named query or gate (selection filters, the unlock sweep, the
  maintainer's inbox filter, the findings-triage round). Do not invent
  labels nothing queries — an unread label is a comment in costume, and it
  rots silently.
- **状态变更不过夜.** Never end a session — including a rate-limit
  suspension — in a half-state: label applied but its paired comment
  missing, assignee set but no claim comment, verdict announced in chat but
  absent from the issue. Finish the pair or revert the half before you stop;
  the next reader (possibly your own post-compact self) has only GitHub to
  read.

**One-time setup** (idempotent, run at the start of the first round):

```bash
for R in objectstack-ai/objectstack objectstack-ai/objectui objectstack-ai/cloud; do
  gh label create pm:queue            -R "$R" -c 0e8a16 -d "Ready for the PM dispatch loop" || true
  gh label create pm:dispatched       -R "$R" -c 1d76db -d "Dispatched to a dev agent by /pm-dispatch" || true
  gh label create needs-user-decision -R "$R" -c d93f0b -d "Blocked on a maintainer decision — do not dispatch" || true
  gh label create pm:on-hold          -R "$R" -c e4e669 -d "Decision made, deliberately deferred — do not dispatch, do not nag; restart condition in the hold comment" || true
  gh label create pm:blocked          -R "$R" -c b60205 -d "Blocked by another issue/PR — body carries Blocked-by: #N" || true
  gh label create finding             -R "$R" -c c2e0c6 -d "Recorded observation — held, not dispatchable until the findings triage round grades it" || true
  gh label create pm:epic             -R "$R" -c 5319e7 -d "Parent delegated to a dedicated epic PM (registry #4604) — other PMs never dispatch into its subtree" || true
done
# routing labels exist only on the main backlog repo:
gh label create repo:objectui -R objectstack-ai/objectstack -c fbca04 -d "Lands in objectui (frontend)" || true
gh label create repo:cloud    -R objectstack-ai/objectstack -c c5def5 -d "Lands in cloud" || true
```

(Use the GitHub MCP tools instead of `gh` when the CLI is unavailable — the
protocol is identical.)

## Operational notes(实测坑位)

队列与平台层的九条实测结论。共同点:**判据取命令的输出,不取 API 字段的字面值,
也不取本地工作树的现状,更不取「看起来相邻」的两行日志** —— 每一条都是在这一步上
咬过人之后写下来的。

**1. 判断 PR 是否在合并队列,看 `gh-readonly-queue/*` 分支,不看 `auto_merge`
字段。** 本仓 PR 入队后,REST 返回的 `auto_merge` 回落为 off(队列条目取代了挂起的
auto-merge),该字段对「在不在队列里」零信息量,据它反推会得出「没入队,再入一次」
的错误结论。唯一判据:

```bash
git ls-remote --heads origin 'refs/heads/gh-readonly-queue/*'
```

分支名里带着这一批被打包的 PR 号;没有匹配分支才是真的没入队。另有三点在同一处
咬过人:

- **「判据不在 `origin/main` 上」是个二义读数。** 它同时兼容「在队列里等」和「压根
  没入队」,而两者的处置完全相反(前者等,后者要动手)。#4852 的 auto-merge 从 10:15
  就挂着,每轮只查 main、判为「排队中」,实际它因 CI 红从未入队 —— 空转 **100 分钟**。
  落地检查永远是**两个读数**:队列分支 **和** `origin/main`,缺一不可。
- 队列分支名里的 base sha 是**串成链**的(`pr-4878-<链上一条的结果 sha>`),顺着链读
  得出自己排第几。
- **PR 被转回 draft 会同时掉 auto-merge 与队列成员资格**,且不会自动恢复;转正之后
  必须重新挂。

**2. 队列踢出:先认签名,再决定重投。** 被踢出不等于 PR 有问题。今天 #4796 那条已知
flaky 连踢五个互不相关的 PR,核对失败签名一致后原样重投,五个全部一次通过 —— 认签名
的成本远低于逐个改 PR。但反过来是同等硬度的规则:止血 PR(#4856)合入后,**同一签名再次
出现就不再是那条 flaky**,已修签名的再现是新问题,必须重新诊断,禁止条件反射式重投。
给 flaky issue 追记命中次数,只在新信息改变修法作用域时才值得(第 3/4 次命中把靶面从
一条用例扩到整个模板,值得记;纯计数不值得占用 issue 时间线)。

**3. GitHub MCP 的 GraphQL 配额(5000/时)极易打满,读操作与评论一律走 REST。**
今天三次归零(峰值 10402/5000),每次卡死的都是 `enable_pr_auto_merge`、draft 状态
切换、`list_issues` 这几个 GraphQL-only 操作 —— 配额一空,整个循环停在复核与入队上。
规程三条:

- 读与评论优先 `curl` / `gh api` 走 REST(core 配额 15000/时,与 GraphQL **独立计**),
  只有确实没有 REST 对应物的写操作才花 GraphQL 配额;
- 配额打满时把 GraphQL 写操作**排队而不是重试**,后台轮询 `rate_limit` 的
  `resources.graphql.remaining`,恢复即执行:

  ```bash
  gh api rate_limit --jq '.resources.graphql'   # 或 curl https://api.github.com/rate_limit
  ```

- 复核意见不等配额 —— 先用 REST 评论把结论发出去,入队、切 ready 这类 GraphQL 动作
  事后补;维护者拿到的信息不该被配额延迟。

**4. 核验 main 的事实用 `origin/main`,不用共享检出的工作树。** 共享检出的 HEAD 由
别的 agent 摆布,可能落后 origin/main 数十提交(今天 PM 与一名 dev 都在落后 63 提交的
树上 grep 出假阴性,据此差点判了错误的结论)。一律先 `git fetch origin main`,再:

```bash
git grep <pattern> origin/main -- <paths>    # 而不是在工作树里 grep
git show origin/main:<path>                  # 看某个文件在 main 上的现状
```

这条也写进派发词(step 5):dev 在自己的 worktree 里同样会踩,而 worktree 是从
`origin/main` 切的、后续不会自己更新。

**5. `rerun_failed_jobs` 复用原 run 的提交与合并 ref,不会拿新的 main 重算。**
第 2 条讲的是「同一签名再现要重新诊断」;这条讲另一半 —— 当红的原因是**基上缺一个
已经合并的修复**时,重跑这个动作本身就是无效的。#4852 的 CI 红在止血 PR #4856
落地**之前**,重跑一次仍是同一个 5000ms;直到 `git merge origin/main` 推了新提交,
才拿到新的合并 ref。判别方法:比对那个修复的合并时间与本 run 的创建时间 —— 前者
晚于后者,就只能推提交,重跑多少次都没用。

> 与 `.github/workflows/rerun-safety-nightly.yml` **无关**:那个查的是「同一 checkout
> 里跑两遍是否自洽」的测试污染,不是重跑语义。

**6. 读数纪律 —— 三条各自产出过一个「我信了并据此行动」的错读数。** 第 4 条管的是
「在哪棵树上读」,这一条管的是「命令本身是否在回答你以为的那个问题」。

- **`cd X && cmd` 会短路。** Bash 工具每次调用 cwd 重置;`cd /home/user/objectui &&
  git grep ...` 在路径不存在时 `cd` 失败、整条命令继续,于是**在当前仓里执行**,产出
  假的「objectui 零消费方」。⛔ 跨仓一律 `git -C <path> grep`,不要用 `cd`。
- **`git grep -c <pat> | wc -l` 数的是文件数,不是命中数。** 曾据此得出「分支比 main
  命中更多」的荒谬结论。要命中数就不要再套 `wc -l`。
- **裸名 grep 会被幸存家族当子串命中。** 核验 `system/EmailTemplate` 是否已退役时,
  裸名命中的是仍然活着的 `EmailTemplateDefinition` 一族。退役核验一律**带引号精确
  名**;更硬的判据是查**声明式**(`^(export )?(const|type|interface) <Name>\b`)而不是
  查提及 —— 注释、pin 测试的断言词、迁移散文里出现该名是**正常且应当的**。

统一原则:**零命中必须用一个「确定存在的邻近词」反查**,证伪「扫描器坏了 / 路径错了」
这个解释。没有这个反查,零命中不成立。

**7. CI 红了先拿完整日志归档,再下结论 —— 三条读日志的纪律。** 这是 2026-08-03 当天
最贵的错误:公开断定四次 CI 红是**内核 OOM-killer 杀掉 DTS 构建**,据此开了 PR #4853,
然后被 #4853 自己的 CI 推翻(它挂着新参数跑,红得一模一样)。真因是 #4796 那一族的
5000ms 超时,由 #4856 修掉。完整更正见 #4845。三个叠加的错误各成一条:

- **「completeness check 绿」≠「测试通过」。** `check-test-completeness.mjs` 只断言
  没有 worker 静默死掉;workflow 自己的注释写着 *"A red suite plus a GREEN
  completeness check means real test failures"*。
- **turbo 并发输出的「相邻」≠「因果」。** `test` 的 `dependsOn` 只有 `["^build"]`
  (只含上游),`packages/spec` 没有 `pretest`,所以 `--concurrency=4` 下 `spec#build`
  与 `spec#test` 同时在跑,GitHub 又给整组打同一个时间戳。`X start` 紧接着
  `ELIFECYCLE` 完全可能来自两个无关进程。**先查 `turbo.json` 的依赖边**,再谈因果。
- **不要只看日志 tail。** 那次的 ~10 KB 尾巴被 `gen:schema` 的 1675 行清单吃光,真正
  的失败行根本不在里面。取完整日志归档再判。

诊断结论一旦公开发出又被推翻,**更正要发在同样公开的位置**,并把据它开的 PR 撤回
draft、解绑 `Fixes`,免得一个错结论继续被当作已立案的事实引用。

**8. 共享基础设施类修复,入队前按「症状」复查 main,不按 issue 号。**
`.github/workflows/duplicate-fix-guard.yml` 已经在两个 PR 声明**同一个 `Fixes #N`**
时把后开的那个判红(#4588 的产物)。**要记清它的覆盖边界**:同仓、同一个 issue 号。

今天这一例正好落在边界外 —— PR #4864(本线)与 PR #4856(另一车道)修的是**同一个
基础设施问题**,却挂在不同 issue 号下,门禁看不到任何重复。更糟的是 #4856 先合了
`testTimeout: 60_000`,**#4864 若合进去会把它降回 30s**,即一次静默回退。

规则:CI 配置、超时、构建脚本、门禁这类**共享基础设施**的修复,入队前跑
`git log --oneline origin/main -- <该文件>`,确认在飞期间没有别人已经修掉;真撞上了,
先比**数值与作用域**再决定关哪个 —— 后合的那个可能是回退,不是改进。

**9. 立单前先查重:关键词、CVE/公告号、包名、报错串,各搜一遍再开 issue。**
#5039 是反例:为一批 OSV 公告立单前没有做任何搜索,而 #5032 六分钟前已为同
一批公告立单、且分析更全(逐包 `pnpm why` 归因 + main 上的逐条复现证据),
两分钟后 #5039 只能关成 duplicate。代价不止两分钟:两条单各自吸走了一次认
领,直接诱发了 #5032 上相隔 20 秒的认领撞车(见 step 4)。同日另一例:
#4946 与 #4945 各自为同一条 brace-expansion 公告立单,后立者关 duplicate。
边界要记清:duplicate-fix-guard 只拦两个 **PR** 声明同一个 `Fixes #N`(第
8 条讲过它的覆盖面)—— 两条 **issue** 描述同一个问题,没有任何门禁能看见,
查重只能发生在立单前、你自己手里。

## Multi-repo coordination (backend / frontend / cloud)

The product spans three repos with a fixed dependency direction:
`objectstack` (backend; `packages/spec` is the single contract) →
`objectui` (frontend; its build flows back via `pnpm objectui:refresh`) and
`cloud`. The loop coordinates them with four rules:

**1. One main backlog.** Feature-level issues live in `objectstack`,
whatever repo the code lands in. A `repo:objectui` / `repo:cloud` label
routes the dev agent's working repo; no routing label = backend. **The PM
applies these labels itself at triage (round loop step 2)** — the maintainer
just files the task and is never expected to pre-route it. The dev
still branches/pushes/PRs **in the target repo** (its own worktree there —
one worktree per repo, as always). Repo-local trivia may still be filed in
the sibling repos directly; to drain such a local queue, run
`/pm-dispatch repo:objectstack-ai/objectui` (the pm labels exist there too).

**2. Contract-first splitting.** A cross-repo feature is never one dispatch.
Split it: a parent issue plus one sub-issue per repo (native GitHub
sub-issues), and the **spec/backend sub-issue goes first** — it fixes the
contract. Downstream sub-issues carry a body line
`Blocked-by: <owner/repo>#<n>`. The PM never dispatches an issue whose
`Blocked-by` references are not yet closed (issue) or merged (PR) — verify
against GitHub at selection time, not from memory. Batch independence is
cross-repo: two issues linked by `Blocked-by` or sharing a parent never
ride in the same batch.

**3. Linkage chores are issues, not memory.** When an accepted PR's
artifacts flow into another repo, the PM immediately files the follow-up in
the consuming repo's backlog instead of relying on anyone remembering. The
known case: accepting a `repo:objectui` PR ⇒ file a `pm:queue` issue in
`objectstack` — "run `pnpm objectui:refresh` and land the console bump",
referencing the merged PR, blocked-by it until it actually merges.

**4. Multiple PM sessions shard by repo; one shared queue only under
domain lanes.** The claim protocol makes concurrent PMs *safe*, not
*useful* on its own: batch independence (file-disjointness) is only checked
within one PM's view, so two PMs on the same queue can claim different
issues that collide on shared files, and the merge queue is one lane
regardless. Making that check **global** is exactly what the next section
does. Scaling order:

1. One PM, bigger batch (`batch:5` is the maintainer's chosen operating
   point, riding on the resource discipline above), heavy tasks via
   `mode:cloud` — adds compute without adding schedulers.
2. When one PM genuinely can't keep up: a second session takes a **whole
   repo** as its shard (`/pm-dispatch repo:objectstack-ai/objectui`) —
   file universes are disjoint by construction. A sharded PM states its
   shard in every claim comment and **never claims outside it**.
3. Multiple PMs on the SAME queue: **prohibited unless the Domain-lanes
   protocol (next section) is active** — every PM in its own session and
   its own container, domain sets registered in the registry issue, label
   discipline observed, and the global in-flight check run at every batch
   selection. Without that protocol the ban stands as written: all cost,
   no throughput, and the collision stays invisible to both PMs until the
   merge.

**Shard ownership is registered, never assumed.** A registry issue in the
main backlog (`[PM] 分片分工登记表`) records which session owns which
shard; a PM taking over a shard comments there as its FIRST action, and
comments again when handing off. An unowned shard may be **caretaken** by
the main-backlog PM (triage + dispatch), but the moment a shard is
registered to another session, the caretaker stops dispatching into it —
in-flight claimed tasks finish under whoever claimed them (the claim
protocol makes the handoff collision-free), and everything else belongs to
the new owner. State the mode in claim comments (「cloud 分片,主 PM 代管」
vs a registered shard PM's own tag) so the registry and the claims never
disagree silently.

**Cross-shard transfer protocol — work crosses shard lines, PMs never
do.** When a sharded PM's task (or a sub-task of its parent issue) needs a
change in another shard's repo:

- **Transfer via the target queue**: file the piece as an issue in the
  target repo with `pm:queue` and a source line (`Part of
  <owner/repo>#<n>`). The target shard's PM picks it up through its own
  backlog sweep — the queue label IS the inter-PM channel; PMs never need
  to talk directly, and never dispatch into a repo whose in-flight batch
  they cannot see (that is the same collision the same-queue ban exists
  for).
- **Dependencies via `Blocked-by:`** on the waiting side; the waiting PM's
  batch selection skips it until the upstream merges.
- **Follow-up chores belong to the consuming shard**: when the upstream
  change lands (say spec gained a key), the dependent-repo adaptation issue
  is filed by the PM of the repo that consumes it — it knows its surfaces.
- **Shared contract surfaces have one owner**: anything touching
  `packages/spec` transfers to the main-backlog (objectstack) PM
  regardless of who needs it — only that PM sees the repo's in-flight
  batch and generated-baseline collisions.
- Cross-repo parent/sub-issue chains as a whole stay coordinated by the
  main-backlog PM; sharded PMs coordinate only chains fully inside their
  shard.

**5. One board, no second tracker.** The pm labels above are the state
machine; an org-level GitHub Project pulling issues/PRs from all three repos
gives the maintainer a single view (filter by `repo:*` and `pm:*`). The PM
maintains no tracking state outside GitHub — that invariant is what keeps
the loop resumable and the board honest.

## Domain lanes(同仓多 PM 并发)

Rule 4's ladder ran out at one PM per repo because file-disjointness is only
ever checked inside one PM's own view. Domain lanes are the **third rung**:
one PM's triage verdict is cached as a `domain:*` label every other PM can
read, so batch selection filters at the label layer instead of at the merge.
Premise: each PM is its **own session in its own container** — adding a PM
adds compute, not contention — and collisions are prevented by the
domain→package mapping, not by hoping two PMs pick different work.

**Anchoring rule.** The whole scheme rests on this one sentence:

> Every package belongs to exactly **one** domain; an issue's `domain:*`
> label is the domain of **the package the fix lands in**, decided at triage
> by reading the code — **never guessed from the issue's title vocabulary**.

The counter-example that makes it a rule: #4775 is a hook `condition`, which
reads as automation, but the fix lands in
`packages/objectql/src/hook-wrappers.ts` ⇒ `domain:engine`. Labeling by topic
would have routed it to a different PM than the one already inside that
package — the exact collision lanes exist to prevent. If you cannot say which
file the fix touches, you have not triaged it yet, and it is not labelable.

| 标签 | 包家族 |
|:--|:--|
| `domain:engine` | `packages/objectql`、`packages/metadata*`、`packages/platform-objects`、`packages/core`、`packages/plugins/driver-*` |
| `domain:services` | `packages/services/*`、`packages/plugins/plugin-approvals`、`plugin-webhooks`、`packages/connectors/*` |
| `domain:identity` | `packages/plugins/plugin-auth`、`plugin-security`、`plugin-sharing`、`plugin-audit` |
| `domain:devx` | `packages/lint`、`skills/**`、`content/docs/**`、`scripts/`(门禁类) |
| `domain:spec` | `packages/spec` 及其生成物(现 spec 车道不变) |
| `domain:cli` | `packages/cli`、`runtime`、`verify`、`qa`、`types` |

`examples/**` belongs to the subsystem it exercises; anything that fits
nowhere is judged at triage by its principal landing site. A package missing
from the table is classified the first time it is triaged and the table
updated **by PR** — the taxonomy evolves deliberately, never per-claim.

**Label discipline.** `domain:*` is applied during the backlog sweep (round
loop step 0) by whichever PM triages the issue. **Labeling ≠ claiming**: any
PM may label any issue, including ones it will never claim — the label is
shared routing, not a reservation. An **unlabeled issue may not be claimed by
anyone**: triage and label it first, or selection has silently gone back to
happening inside one PM's private view.

**Claim scope.** Each PM session registers its **domain set** in the registry
issue (`[PM] 分片分工登记表`, #4604 — the same registry that records repo
shards) and claims only issues whose label falls inside that set. A set, not
a single domain: lanes are a routing table, not a job title.

**Cross-domain issues.** Prefer the contract-first split of rule 2 — one
sub-issue per domain, each carrying its own `domain:*` label, ordered with
`Blocked-by:`. When a split costs more than it buys, a single PM claims the
whole issue and **declares the full file surface** in its claim comment, so
every other PM's in-flight check can see all of it.

**Borrowing.** An idle PM may claim outside its registered set when all three
hold: (a) that domain's PM has not claimed the issue, (b) the claim comment
declares the file surface, (c) the global in-flight check below passes.
Borrowing is a one-issue exception, not a lane transfer — the registry entry
does not change, so nobody has to guess who owns the domain afterwards.

**Global in-flight check — run it at batch selection (step 3).** List every
`pm:dispatched` issue across the repo, read the file-surface declaration on
each one's latest claim comment, and require your candidates to be disjoint
from all of them. This is step 3's independence test raised from your batch
to the whole repo; skip it and two individually-independent batches are
jointly dependent, which is precisely the failure the same-queue ban was
protecting against.

**The merge queue is still one shared serial resource.** Lanes buy parallel
authorship, not parallel landing: the flaky-test tax (#4796) scales linearly
with the number of PMs, and a red queue blocks every lane at once. Queue
health is therefore a shared duty — a PM that notices a flake fixes or files
it rather than re-queuing past it, whichever lane it came from.

## Epic 子树车道(大任务委托专职 PM)

Domain lanes 按「修复落点的包」**横向**切分;epic 车道是**纵向**的第二种切法:
一个大开发(父 issue + 一批 sub-issue)整体委托给一个专职 PM 会话,从立项跟到
收尾。两者组合使用,不互斥:epic 内的 sub-issue 照常在分诊时打 `domain:*`
标签(标签是共享路由信息,全局在飞检查要读它),但**认领权属于 epic PM**,
不属于域 PM。

**启动**:`/pm-dispatch epic:#<n>`。队列定义 = 父 issue #n 的 open、未认领
sub-issue(递归)。**每轮重新读子树,不缓存清单** —— 这一条就是衍生任务的
吸收机制:开发中新挂到父单下的 sub-issue,下一轮自动进入队列,零新标签、
零额外登记。

**委托信号(标签 + 登记成对落地,同 label discipline)**:

- 父 issue 打 `pm:epic`,同时在登记表(#4604)登记:会话 ID、父 issue 号、
  **声明的文件领地**(packages/目录清单,同一份也写进父 issue 正文)。缺一半
  就是 label discipline 禁止的过夜半状态。
- 其它 PM(主 backlog / 域 PM)的候选获取(step 1)**跳过 `pm:epic` 父单的
  整棵子树** —— 这是该标签的第一消费点;第二消费点是登记表,第三是收尾流程。
- epic 与非 epic 工作的**文件相交**由既有机制兜住:epic PM 的每条认领评论
  照常声明「文件面」,所有 PM 的全局在飞检查照常读它。epic 不豁免任何一条
  认领纪律(assign + claim comment + race check 全套照做)。
- 触 `packages/spec` 的 sub-issue 照常受「shared contract surfaces have one
  owner」约束 —— epic 委托不改变 spec 的单一所有者。

**衍生问题三分法。** epic 开发中冒出的每个新问题,用一个判据分流:
**「不修它,epic 的验收标准过不过得去?」**

| 类型 | 判据 | 去向 | 谁派发 |
|:--|:--|:--|:--|
| in-scope 衍生 | 不修则 epic 验收不过 | 挂为父单 sub-issue(原生) | epic PM,下轮自动入队 |
| 顺带发现 | 与 epic 验收无关,只是路过看见 | 独立立单进主 backlog(查重先行,`finding` 分诊纪律照旧) | 主/域 PM;epic 不吸收 |
| 触 spec / 公共契约 | 无论是否阻塞 epic | 按跨分片转移协议转主 PM 队列,epic 侧 sub-issue 写 `Blocked-by:` | 主 PM |

第一行防「衍生项没人管、epic 烂尾」;第二行防「epic 无限膨胀吞掉整个仓」;
第三行维持契约面的单一调度权。发现分诊轮的**归挂限定在 epic 内同样成立**:
仅有依赖关系、不属完成范围的,独立立单 + `Blocked-by:`,不得借 sub-issue
自动入队的通道把未分诊的东西塞进池子。每次分流留一行审计评论(「分流:
in-scope,验收依据 …」),维护者可否决。

**进度视图。** epic PM 每轮在父 issue 维护一份 checklist 汇总评论
(sub-issue → 状态 → PR),待决项单独列出。维护者只看父单一个入口;决策
本身仍锚在具体 sub-issue 上(step 8 不变),父单只汇总、不承载分析。

**收尾与僵尸回收。** 最后一个 sub-issue 关闭 → epic PM 在父单留总结评论、
关闭父单、摘 `pm:epic`、登记表注销 —— 四步是一组,缺一步就是过夜半状态。
僵尸判据:登记在册但整棵子树 ~48h 无任何认领/分支/PR 动静 → 主 PM 在登记表
评论询问,再静默一窗后摘 `pm:epic` 收回子树;子树内仍在飞的认领按认领协议
由原认领者跟完(stale-claim reclaim 的既有规则逐单适用)。

**残余风险(如实声明)。** epic 领地与其它车道的文件相交靠「声明 + 全局
在飞检查」防,不是机械保证;撞上了由合并队列兜底(代价是返工,不是脏数据)。
这与 domain lanes 的风险形状相同,epic 车道没有更差 —— 但也没有更好,所以
领地声明写得越窄越诚实,越宽越要在登记表里说明为什么。

## The round loop

### 0. Backlog sweep — classification is a standing duty, not a request

The maintainer does not pre-sort the backlog. On every round (and every
idle check-in), sweep issues that carry no `pm:*` / `needs-user-decision`
label and classify each:

- **Auto-queue (`pm:queue`)**: a concrete defect with a named location or
  repro; a scoped tooling/gate fix; a restore-invariant finding; a
  test-only pin. Nothing to ask — label it and it becomes dispatchable.
- **Maintainer confirm (`needs-user-decision`)**: design cards, feature/
  contract-shape proposals, multi-week programs needing appetite and
  sequencing, anything touching stored-data migration shape or removing a
  shipped capability. The label alone is the inbox entry; the deep two-axis
  analysis is written when the card is actually taken up.
- **Hold (`finding`)**: observation-class findings — dormant code,
  unexercised drift, cosmetic polish; real, but nothing a user hits today.
  The label keeps the record **inside the state machine** (a comment thread
  or a side-ledger issue is exactly the silent state ADR-0049 bans, and a
  second tracker rule 5 prohibits) without occupying the dispatch queue or
  the maintainer's inbox. It is a held state, not a verdict — the findings
  triage round below is where it gets one.
- **Repair first**: a body truncated by GitHub's sanitizer (bare `<x>`
  swallows the rest at rest) cannot be dispatched — comment the repair
  instruction and move on.

#### 发现分诊轮 —— 队列的出水口(objectstack#4949)

Prime Directive #10 是一个强力生产者,而循环原本只有「修掉」和「关重复」两条
出路 —— 没有任何机制裁定「不值得修」,总量于是只涨不落(cloud 分片一日实测:
关 14 开 19,其中真缺陷当天闭环,涨出来的主要是观察类)。分诊轮补上出水口:

- **触发**:每 ~5 轮一次;`finding` 存量超过 ~15 时插队执行。
- **动作**:对每条 `finding`(以及久悬未分类的观察类 issue)先做过时前提
  检查 —— main 一天 ~18 合并,发现的准确性半衰期以天计,囤积不是免费存档,
  是负利息存款 —— 然后三选一:
  1. **晋级**:摘 `finding` 换 `pm:queue`,进正常派发;
  2. **关闭(not planned)**:附一句理由,列入当轮轮次报告 —— 维护者可
     否决重开,但 PM 不等批准(否决窗口,同 step 8 的模式);
  3. **持有**:留标签,记一行「为什么还留着」。
- **判级发生在这里,不发生在立单时。** 立单的 dev 只有局部视野,判级最不准
  (cloud#1004 的「转义细节」实为 P0 过滤器旁路;cloud#897 自己写的影响面
  评估就是错的)。所以 os-dev 的纪律是「照实立单、不自行压级」,分级的责任
  归本轮。
- **归挂限定**:发现开成已排队 issue 的 sub-issue **仅当**它真属父单完成
  范围 —— 已排队父单的 sub-issue 会自动成为派发候选(step 1),把仅有依赖
  关系的发现挂进去等于让未分诊的东西静默入池;那种情况独立立单 +
  `Blocked-by:`(cloud#1045/#1046 之于 cloud#1050 即此形)。

### 1. Fetch candidates

List open issues matching the filter, excluding anything assigned or labeled
`needs-user-decision`. **Open sub-issues of a matching parent are candidates
too** — they inherit the parent's queue membership and need no label of their
own. **Exception: a parent carrying `pm:epic`** — its whole subtree belongs
to the registered epic PM, and no other PM treats those sub-issues as
candidates(见「Epic 子树车道」;没有这条排除,本句的自动继承会让两个 PM
抢同一批子任务). Read each candidate's full body **and its comments — all of them,
before the issue can even be a candidate.** A comment may record that half
the work already shipped (#4075's step 1 had been merged for three days;
the claim went out without reading the comment that said so). Comments are
also where **rulings** land, not just progress notes: #4829's body reads as
a straightforward "delete the access gate" fix, while its thread held the
maintainer's 2026-08-03 暂缓处理 verdict AND the recorded finding that the
gate is ADR-0045 §3 (Accepted) mechanism with four pin tests. A PM that
read only the body recommended deleting an accepted ADR's mechanism and
dispatched it — only the dev's stop-and-refuse prevented the patch (the
maintainer later re-decided on the corrected analysis; that is the process
working *despite* the skipped read, not because of it). 裁决落在评论区,
跳过评论就是跳过裁决。Triage, batch selection (steps 2–3) and the dispatch
prompt all need the full picture.

**Stale-premise check before every dispatch.** Issues describe the repo as
of their filing date; main moves ~18 merges a day. Before dispatching,
check the named files/subsystem against recent main history (`git log
--oneline -20 -- <paths>`, or search merged PRs referencing the issue's
keywords). Three same-day cases: #4525 (spec key landed 3 days before
filing), #4379 (fix merged via #4459 with the exact proposed sketch),
#4075 (step 1 shipped via objectui#3032). A dispatch that starts with "is
this still true?" costs minutes; one that doesn't costs an agent-run.

### 2. Triage — routing is the PM's job, never the maintainer's

The maintainer's only input is the issue itself plus `pm:queue` (or naming
the task in chat). They are **not** expected to know which repo a change
lands in — that answer usually *is* the analysis. For each candidate whose
routing isn't already decided:

- **Determine where the change lands** by reading the issue against the
  actual code of the three repos. Apply `repo:objectui` / `repo:cloud`
  yourself; leave unlabeled for backend. A routing label a human already
  set is respected as-is.
- **Cross-repo?** Do the split yourself per "Multi-repo coordination" rule
  2: file the parent + per-repo sub-issues, contract-first order,
  `Blocked-by:` lines, routing labels on each sub-issue.
- **Parent issue that already has sub-issues** (the maintainer built the
  structure themself): the queue label on the **parent alone** is enough —
  sub-issues of a queued parent are candidates automatically, with no label
  of their own. The PM expands the parent at triage: triage/route each
  sub-issue individually, keep any dependency ordering the maintainer
  expressed (`Blocked-by:` lines or native blocked-by relations), and where
  none is expressed **infer the contract-first order and write the
  `Blocked-by:` lines yourself** (audit-trail comment as usual). The parent
  itself is a coordination node — **never dispatched to a dev**; it stays
  open as the progress view and the PM closes it with a summary comment when
  the last sub-issue closes.
- **Leave a one-comment audit trail** on the issue (Chinese), so the
  maintainer can veto cheaply: 「分诊:落地 objectui;理由:…」.
- Routing is a **technical judgment — never escalate "which repo?" to the
  maintainer.** If after reading the code you genuinely cannot tell where a
  change lands, the issue is underspecified: escalate the *underlying
  product question* (step 8), not the routing.
- **Cross-repo dedup — check the sibling repos for this issue's shadow**
  before it can be dispatched: follow every cross-repo reference on the
  issue's body/timeline, AND keyword-search open issues/PRs in the other two
  repos (module names, error strings). What you find decides the action:
  - shadow **claimed / PR in flight** → do not dispatch; write
    `Blocked-by: <repo>#<n>` + a comment, revisit for *remaining* work when
    it lands;
  - shadow **open, unclaimed** → converge first: cross-link, make it a
    sub-issue of the backlog issue (or close one as duplicate) so one thing
    has exactly one dispatch entry — then queue normally;
  - shadow **already done** → the backlog issue may be stale: verify what
    remains, recommend closing if nothing does;
  - **nothing found** → dispatch normally.
  The main backlog is the only scheduling authority — two queues must never
  dispatch the same work. Re-verify assignees (issue *and* linked shadows)
  at claim time, not just at triage: the gap between them is where races
  live. Known blind spot: work in a local worktree with no claim, no
  branch, no PR is invisible — that is what the claim-first rule (step 4)
  exists to shrink.

**Recognize the "no producer" shape —「生产者在哪?」is a standing triage
question.** One issue class is invisible to every automated check: a field is
declared, consumers read it, types and gates are fully green — and **no code
path ever writes it**. Five hits in one day: #4704 (`Seed.env`, six call sites
drop it), #4837 (the liveness ledger's own criterion), #4839 (`session.roles`
written nowhere in the repo), #4862 (flow triggers bulk-set `previous` without
binding it), #4867. Type systems and lint validate the **consumer** side only,
so a missing 生产者 survives indefinitely under a green tree. On any issue
shaped `declared ≠ enforced`, ask where the producer is before routing it —
the answer is usually the root cause, and it changes the issue's scope (and
often its `domain:*` label) *before* dispatch rather than in the dev's report.

### 3. Select the batch

Pick up to `batch` issues that are **mutually independent**: no two issues in
one batch may plausibly touch the same package, registry/barrel file, or spec
schema. Two dev agents editing the same shared file produce a merge race that
costs more than serializing. When in doubt, serialize — put the second issue in
the next round. Prefer small, well-specified issues; an issue with no acceptance
criteria you can state in one sentence is a candidate for escalation (step 8),
not dispatch.

**Same-file issues serialize strictly across rounds — and deferring is not
shelving.** Two issues on one file ride in different rounds, no exception
(#4820/#4821). The part that is easy to miss: while #4820 was in flight its dev
established that the fix #4821's body proposes (a `JSON.stringify` key) would
change type-coercion semantics and introduce a fresh silent defect. That
warning **and** the `Blocked-by:` line were written onto #4821 in the same round
#4820's review closed — not the next one. A deferred issue sits in the queue
looking dispatchable to every sweep, including another PM's; whatever you
learned about it is worthless until it is on the issue. Rule: when step 3 pushes
an issue to a later round, record the known trap on it before the round ends.

### 4. Claim

All agents share one GitHub identity, so the assignee alone says "some agent
claimed this" but never *which* — the claim comment carries the identity. For
each selected issue, **before dispatching** (repo rule: claim before code),
execute as **one atomic pair**, in order:

1. **Assign** to yourself (`@me`) and add `pm:dispatched`. Skip — and drop
   from the batch — any issue that acquired an assignee since step 1.
2. **Claim comment** (Chinese), fixed shape — the branch name is the key,
   every later artifact (worktree, push, PR) hangs off it. The session ID is
   NOT optional: under the shared identity it is the only line that lets a
   later reader — including your own future self after a context reset —
   answer "is this claim mine?". A claim without it caused the #4555/#4559
   duplicate (#4588): the second session saw its own shared name as assignee
   and could not tell the claim was someone else's.
   > 认领:PM 循环第 N 轮
   > 会话:`session_<id>`
   > 分支:`claude/issue-<n>-<slug>`
   > Worktree:`<repo>-issue-<n>`
   > 域:`domain:<x>`
   > 文件面:`<预计触碰的目录列表>`(越界即停,报告说明)

   「文件面」is **required** for cross-domain and borrowed claims and
   **recommended** for ordinary same-domain ones — it is the only input
   another PM's global in-flight check has to read. The branch name must
   carry the issue number: #5032's losing claim promised
   `claude/issue-osv-fast-uri-hono-undici`, which
   `git ls-remote --heads origin | grep issue-5032` cannot find — the #4588
   discoverability hole, reopened.

   **Assign + comment are one indivisible act — rate limits do not split
   them.** "Assign now, comment when quota recovers" leaves exactly the
   state the shared identity cannot interpret: an assignee with no owner.
   If the comment cannot be posted, undo the assign (or never start); if
   GraphQL quota is gone, queue the whole pair for later (Operational
   notes 3) — never half of it.
3. **Race check — after your claim comment is up, re-read the whole
   thread.** Assignment is idempotent, so two agents can both "succeed";
   the claim comments' **timestamps are the only tiebreaker**, whatever the
   assignee field seems to say. An earlier claim comment with a *different*
   session ID or branch means you lost: touch nothing of theirs, reply
   「已有认领,让行」, and pick another issue. First comment wins. #5032 is
   the 20-second version: claims at 00:39:44 and 00:40:04, the later one
   composed **without re-reading the thread** — and both aimed at
   `pnpm-lock.yaml`, where two parallel re-resolutions produce mutually
   unmergeable diffs. The dispatched dev caught the collision on its own
   pre-code re-read and stood down with zero files touched; that pre-code
   re-read is the dev's duty too (os-dev rule 2), which is what makes the
   claim protocol self-healing when a PM slips.

   **Yielding is a handoff, not an exit.** The loser posts, together with
   its 让行 comment, everything it already diagnosed — repro commands,
   dependency paths, traps confirmed. In #5032 that handoff (the offline
   scanner repro, `pnpm why` chains for all three packages, and live proof
   that the existing undici override's exclusive upper bound had
   self-invalidated) was consumed directly by the winning dev, whose PR
   #5052 was up within half an hour of the yield. A yield that discards
   its diagnosis re-bills the whole investigation to the winner.

Dev agents push their branch early — a remote branch is the hardest evidence
of work in flight, closing the gap between "claimed" and "PR exists".

**Multiple GitHub accounts (colleagues' Claude Code sessions) simplify
this, not complicate it.** Across accounts the assignee alone already says
*who*: `assignee isn't you → taken, never touch` is the entire cross-account
protocol, and it's already the rule. The claim-comment ritual (branch name,
round, race check) matters *within* one account's sessions. When several
accounts work the backlog, partition it the same way as multi-PM sharding —
by repo or by an agreed label per account — and record the assignment table
once in a pinned issue or the round report so nobody triages another
account's shard.

**Stale-claim reclaim**: a claim older than ~24 h whose promised branch does
not exist on the remote and has no PR is presumed dead — comment asking, and
after another window of silence, remove the assignee (note why) and return
the issue to the queue. Never reclaim a claim that has a live branch with
commits.

### 5. Dispatch

One `Agent` call per issue, `subagent_type: "os-dev"` (fall back to
`general-purpose` with the same prompt if the custom agent isn't loaded), run
in parallel in the background. **Model split (maintainer policy): pass
`model: "opus"` on every dev dispatch.** The PM session itself stays on the
stronger orchestration model — triage, review, and decision framing are where
its judgment pays; implementation goes to Opus. Prompt template — fill every placeholder, paste
the full issue body, never a summary:

```
Your task is issue {backlog_repo}#{n}. The code lands in {target_repo}
(from the issue's repo:* routing label; same repo when unlabeled).

ISSUE TITLE: {title}
ISSUE BODY:
{body}

{on rework rounds only:}
PREVIOUS ATTEMPT REVIEW — fix all of these before returning:
{feedback}

Follow your operating procedure (you are the os-dev agent). Non-negotiables:
- The ISSUE BODY above is a LEAD, not a spec: verify its premise against
  origin/main BEFORE implementing. If the premise no longer holds (already
  fixed, wrong attribution, capability already exists), return
  premise_still_valid: false with evidence and NO PR — that is a successful
  outcome, not a failure.
- Work in {target_repo}: branch claude/issue-{n}-{slug} off origin/main,
  in a DEDICATED worktree of that repo.
- The issue is already claimed; do not touch its assignee.
- Deliver: implementation + tests + changeset, pushed, as a DRAFT PR in
  {target_repo} whose body starts with "Fixes {backlog_repo}#{n}".
  Never merge anything.
- If the issue underspecifies a decision that changes the public contract
  (spec schema, API shape, naming), STOP and return status "needs_decision"
  with your open questions — do not guess.
Return ONLY the JSON report defined in your agent definition.
```

**Same-day churn on the issue's files goes INTO the prompt.** Step 1's
stale-premise check protects against issues that aged; the same-day variant is
main moving between filing and dispatch on the very file the issue quotes —
#4808 was dispatched right after #4806 rewrote the same guard, #4820 right
after #4822 touched the same file. Both prompts carried an explicit line
(「基于合并后的代码工作,issue 引用的片段可能已变,先核对当前 main」), and both
devs avoided rework that the issue's own snippets would have caused. Add that
line whenever `git log origin/main --oneline -20 -- <paths>` shows a merge on
the issue's files today, and tell the dev to verify against `origin/main`
rather than any working tree (Operational notes 4) — the dev's worktree is cut
from `origin/main` once and never refreshes itself.

**Issue 正文是线索,不是规格 —— and the dispatch wording is what makes an
honest "the premise is dead" cheap to return.** Step 1's stale-premise check
is the PM's sample; the dev's verification is the real thing, so the prompt
must state the premise-first requirement explicitly (the template line
above), and the PM must treat `premise_still_valid: false` with no PR as a
legitimate — often valuable — deliverable. Evidence from one working day:
#4832 (dispatched; the dev found the premise had already expired), #4250
(the issue's minimum ask had long shipped via the stall-guard series — the
premise check instead surfaced that the guard's SIGKILL escalation path had
never once executed, a real defect the issue never named), #5047 (the
claimed 「enable/disable 重启即失」 was disproven with file:line evidence —
persistence existed by design — and verification narrowed the work to the
real empty-env seed bug PR #5117 fixed), #4930 (two of the three "silently
green" claims were wrong: the scripts went red with misleading messages, and
the fix was re-scoped to the dev's measurements). A dev that falsifies the
issue — or the PM's own framing — is a good run (step 7 says so); a prompt
that presumes the issue is true converts that good run into apparent
disobedience.

#### Handing off an interrupted dev(worktree 接手协议)

`/compact`, and any host-level interruption of the PM session, kills running
subagents together with their pending tool calls — #4700 and #4775 both died on
the same second. **The agent is not resumable; its worktree, branch and commits
are intact.** Never re-run the original dispatch prompt over that state: a fresh
agent that follows it will try to create the worktree that already exists, or
redo work already committed. Dispatch a **new** agent with these four additions
instead:

- 「worktree `<repo>-issue-<n>` 已存在,⛔ 不要新建,`cd` 进去接着做」— the
  worktree-first rule is already satisfied; creating a second one splits the work;
- read every existing commit **and** uncommitted change there **first**, then
  decide per hunk to keep or amend it — neither restart from scratch nor trust
  it blindly (the dead agent never reported, so nothing about it is verified);
- re-run the verification the dead agent never reached, in full, and report its
  real output — an interrupted run leaves no test evidence at all;
- the assignee, claim comment and branch stay untouched: this is a continuation
  of the existing claim, not a new one, and the claim comment records the
  handoff rather than being replaced.

Both #4700 and #4775 passed review on the first try after being handed off this
way.

#### Resource limits — parallel agents share ONE container

Memory peaks come from **build + test**, not editing, so the fix is not less
parallelism but serialized heavy phases: the os-dev definition requires every
build/test run to hold the container-wide verification lock
(`flock /tmp/os-heavy-verify.lock`), a `NODE_OPTIONS=--max-old-space-size`
heap cap, scoped `--filter` builds/tests, capped vitest/turbo workers, and
worktree cleanup after the PR is up. PM-side: treat `batch:3` as assuming
normal-sized tasks — for build-heavy ones (dependency-family upgrades, full
regression passes) drop to `batch:2`, or dispatch that issue via
`mode:cloud` so it gets its own container. If an agent dies with a
heap/OOM signature, redispatch it alone rather than into a full batch.

#### Dispatch backends

**`mode:subagent` (default).** The `Agent` tool, as described above. The devs
run inside the PM's own session container — which in Claude Code on the web is
already a cloud container, so the whole loop runs server-side and survives the
browser tab closing. Reports come back directly as the subagent's final
message. Prefer this mode: it is simpler, and the report channel is lossless.

**`mode:cloud`.** Each issue becomes an **independent cloud session** in the
same environment — its own container and fresh clone, decoupled from the PM
session's lifetime. Use it when devs need resources/lifetime beyond one
container, or the maintainer asks for it. Requires the `Claude_Code_Remote`
MCP tools (available in remote/web sessions; if absent, say so and fall back
to `mode:subagent`). Per issue:

1. `create_trigger` with `create_new_session_on_fire: true` and no schedule
   (poke-only), name `pm-dispatch-issue-<n>`, prompt = the dispatch template
   below **made fully standalone**: the fired session starts with zero
   conversation context (it does get the repo clone, so it can be told to
   follow `.claude/agents/os-dev.md`), and — since an independent session
   cannot return a message to the PM — it must be told to **post the JSON
   report as a comment on the issue** (prefixed `<!-- os-dev-report -->`)
   instead of returning it, in addition to opening the draft PR.
2. `fire_trigger` to launch it, then `delete_trigger` once the report has
   been collected (step 6) so poke-only triggers don't accumulate.

### 6. Collect

**Subagent mode:** wait for the background task notifications — do not poll,
do not fabricate a pending agent's result. A dev that dies or returns
malformed output counts as `status: "blocked"` with its raw output attached.

**Cloud mode:** there is no direct return channel — collect through GitHub.
Arm a `send_later` check-in (~15 min); on each wake, sweep the dispatched
issues for `<!-- os-dev-report -->` comments and linked PRs, then re-arm
silently until every dispatch of the round has reported or a dispatch has
been silent for over ~2 h (count it as `blocked` and move on). Never treat
the absence of a report as success.

### 7. Review each report

You are the reviewer of record. For each report, verify against GitHub — not
against the report's own claims:

- The PR exists, is a draft, targets `main`, and its body references
  `Fixes #{n}`.
- Fetch the PR's changed files. Scope check: no `content/docs/releases/`
  edits, a `.changeset/*.md` is present for anything user-visible, no files
  plainly unrelated to the issue.
- Test evidence in the report shows the actual commands and passing output,
  not a bare "tests pass".
- The diff plausibly satisfies the issue's acceptance criteria.
- **Did the dev verify the issue's premise?** The report's
  `premise_still_valid` field makes the answer explicit — a `false` there
  reopens triage rather than failing review. A report that falsifies the
  issue — or your own dispatch prompt — is a sign of a *good* run; a report
  that accepts every stated cause at face value is the one to read twice. Four
  same-day cases: #4808 (the issue was half right — the real truncation was in
  pruning, not the TTL), #4813 (the technical rationale the PM supplied was
  disproved by measurement and the dev's was harder; the issue body's wrong
  attribution became #4873), #4825 (the issue's option 2 was killed by
  call-site evidence), #4790 (previous day, a fixed-window conversion
  rejected). When a dev corrects the PM, **acknowledge it in the open** — the
  correction belongs in the PR/issue comments so the next reader inherits the
  corrected premise, and a wrong premise still sitting in an issue body gets
  its own follow-up issue rather than being silently dropped.
- **`+0/-0` in a PR diff is not proof of an empty file.** git renders a file
  as binary — zero added, zero removed — as soon as it contains a NUL byte.
  #4870's 347-line test file showed `+0/-0` and was briefly misread as an
  unfinished placeholder; it was one bare `0x00` in the body, which
  `pnpm check:nul-bytes` rejects by design. On any `+0/-0` entry suspect NUL
  first and an empty file second, and settle it on the blob rather than the
  diff (`git show <sha>:<path> | wc -l`). The fix always belongs in the
  source: write the escape sequence `\u0000`, which is byte-identical at
  runtime and is the convention `scripts/check-nul-bytes.mjs` enforces. A
  raw NUL is never the right authoring choice: it also makes the whole file
  invisible to grep, which is how the defect hides in the first place.

Verdict per issue:

- **ACCEPT** — comment on the issue (Chinese) linking the PR and summarizing
  what shipped. Then drive it to landing (maintainer policy: review passed +
  CI green ⇒ merge): once every check on the PR is green, mark it ready for
  review and **add it to the merge queue** — the queue rebuilds the PR
  against current `main` and lands it only if that result is green, which is
  the repo's sanctioned path. Never `--auto`-merge outside the queue; where
  no queue exists, merge serially per AGENTS.md §7 only after remote CI is
  fully green. This applies to **dev-agent PRs dispatched by this loop
  only** — the PM's own tooling PRs stay with the maintainer.
- **REWORK** — concrete, itemized feedback; re-dispatch the same issue with
  the feedback block filled (same claim, new dev agent). **Max 2 rework
  rounds** per issue; a third failure escalates instead.
- **ESCALATE** — see step 8.

#### 入队与落地 —— ACCEPT 之后才是最容易丢单的一段

**A. 碰生成物的 PR,入队前必须先同步 + 整体重生成。** 第 3 步只保证**同一批内**
file-disjoint;它管不到**先后两单都碰 `packages/spec` 生成物**的情形 —— 而协议变更
几乎必然如此。`.gitattributes` 把这八条路径路由到 `merge=os-regen`(⛔ 别只记住前
五条 —— 后三条是文档产物,同样会被静默吞):

```
packages/spec/spec-changes.json
packages/spec/authorable-surface.json
packages/spec/json-schema.manifest.json
packages/spec/api-surface.json
packages/spec/api-surface-signatures.json
docs/protocol-upgrade-guide.md
docs/audits/2026-07-unknown-key-strictness-ledger.counts.md
content/docs/references/**
```

最后那条是 #5107 加的:strictness 台账的**数字**转成了生成物(`gen:strictness-ledger`),
散文仍手写在同名的 `.md` 里。派 #4001 后续批次时要分清 —— **台账正文照常文本合并
(它一直合得很干净),只有 `.counts.md` 走驱动**。

权威清单是 `.gitattributes` 本身(`grep os-regen .gitattributes`),不是这份拷贝 ——
它增删过,以文件为准。

该驱动会让 merge **exit 0、零冲突标记**,却**静默丢掉一侧的改动** —— 只有重新生成
才暴露。2026-08-03 一天内在 #4809 / #4846 / #4841 三个 PR 上各复现一次。要求 dev
按顺序做,四步缺一不可:

1. `git merge origin/main`(⛔ 禁 rebase / force-push,AGENTS.md §3)
2. `git checkout origin/main -- <上述生成物>`
3. **整体重新生成**(⛔ 绝不做文本合并)
4. 断言**所有兄弟单的条目都还在** —— #4878 落地时是四条 step17 条目并存

一个比「条目还在」更硬的旁证:去查**上一单的实现体**是否完好(#4878 合并后核
`conversions/registry.ts` 里 #4391 的 D2 conversion 仍有 16 处命中)。条目是索引,
实现体才是被吞的重灾区。驱动本身另有缺陷(把绝对路径写死进最后跑过 `pnpm install`
的那个 worktree),见 #4868。

**B. 跟到 MERGED 为止,不是跟到「已入队」为止。** 「auto-merge 已挂上」不是终点,
维护者对此有过明确纠正。每轮同时读**队列分支**与 `origin/main`(Operational notes
1);红了先分签名,再在「原样重投 / 推新提交 / 重新诊断」三者里选(notes 2 与 5)。
落地之后**再核一次落地判据本身** —— 队列的合并同样走 os-regen 驱动,A 里那个静默
吞并在队列合并这一步一样能发生。

### 8. Escalate uncertainties to the maintainer

**First, apply the escalation bar — most things that FEEL like decisions are
not.** The maintainer's words: 「明显的问题直接修,不是事事都需要我确认」.
Escalate ONLY when at least one of these holds:

- the options genuinely diverge on **product semantics or public contract
  shape** and neither the issue, AGENTS.md, ADRs, nor existing code norms
  determines the answer;
- the fix requires a **destructive or hard-to-reverse action** (stored-data
  migration shape, deleting a shipped capability, force operations).

Everything else is the PM's call — decide, dispatch, and give the maintainer
a **veto window instead of a permission gate**: state what you decided and
why in the issue comment and the round report; they can stop it, but you do
not wait for them. Named non-escalation classes (act immediately):

- **Restore-invariant fixes.** When the repo already states the invariant —
  one contract version across the family, declared = enforced, a gate must
  actually compile/run what it claims to check — a finding that the
  invariant is broken carries its own decision. A dual-version dependency
  graph, an inert tripwire, an unwired gate: queue it, dispatch it, report
  it. Asking "may I restore the invariant?" is the anti-pattern.
- **Sequencing and dependency ordering** between technical tasks.
- **Verification strategy** (what regression pass a risky-but-decided change
  needs) — that is scoping the work, not deciding it.
- A dev's `needs_decision` that, on PM review, falls into the classes above:
  answer the dev yourself with the decision and rationale; do not relay it
  upward.

Whenever a dev returns `needs_decision` that passes the bar above, an issue
is too vague to dispatch, or rework has failed twice:

1. **Default: the decision lives ON the issue it belongs to — never a new
   issue.** Post the analysis as a comment on that issue, add the
   `needs-user-decision` label, drop it from the active queue. The label is
   the maintainer's inbox (filter `label:needs-user-decision` shows
   everything awaiting them); when they answer, the label comes off and the
   issue re-enters the queue. No bookkeeping issues accumulate. File a
   separate issue (titled `[决策] <一句话说清要拍板什么>`, same label) ONLY
   when the decision has no natural anchor — it spans several issues (file
   one, link it from each rather than duplicating the analysis) or arose
   with no issue of its own.
2. The analysis, wherever it lands (Chinese): 背景、具体问题、可选方案、
   你的建议、关联的 issue / PR / 分支。**每个方案必须沿两条固定评估轴
   分析,这是决策分析的核心原则,不是可选项:**
   - **项目长远合理性** — 哪个方案符合北极星方向与可持续架构(Prime
     Directive #5 no workarounds、#8 North Star、#12 contract-first),
     而不是眼下最省事;临时补丁式的选项要明说其长期代价。
   - **防 AI 写代码犯错,尤其是防 AI 写元数据 app 犯错** — 哪个方案让
     AI agent 在结构上*更难写错*:契约收紧(严格 Zod schema、publish 时
     校验拒绝、错误响亮)优于消费端宽容(`??` 回退、静默容错)——宽容
     恰恰是 AI 批量犯错被掩盖的温床;声明即强制(declared = enforced),
     绝不让 AI 能声明一个运行时不兑现的能力。
   推荐意见必须基于这两条轴给出理由;两轴冲突时如实呈现权衡,交维护者
   拍板。
3. If the session is interactive, additionally raise it via `AskUserQuestion`;
   the labeled issue remains the durable record either way. **Never** answer
   a product/architecture question on the maintainer's behalf.

### 9. Round report, then next round

Print a round report to the maintainer **in Chinese**: a table of
issue → verdict → PR link → notes, plus anything escalated. Then start the
next round at step 1 (rework re-dispatches count against the next round's
`batch` budget).

Track three **bounded** health metrics in the report — total open-issue count
is deliberately NOT one of them (discovery outruns closure in any debt-dense
area; that is the loop working, not failing):

- **dispatchable inventory** — open `pm:queue` unassigned, and its trend;
- **decision inbox** — `needs-user-decision` count awaiting the maintainer;
- **finding median age** — aging findings mean the 发现分诊轮 is overdue.

## Stop conditions

Stop the loop and report when any of these hits:

- the queue is empty, or `rounds` is exhausted;
- **≥ half of a round's dispatches failed or escalated** — that is a systemic
  problem (bad queue hygiene, broken main, wrong tooling), and burning the
  rest of the backlog against it wastes every remaining dispatch;
- the maintainer interrupts.

## Guardrails (binding)

- PM writes **no files**. Merging is allowed for **reviewed, fully-green
  dev-agent PRs via the merge queue only** (see the ACCEPT verdict) — never
  its own PRs, never a red or unreviewed one, never bypassing the queue
  where one exists.
- Never force-push, never push `main`, never reassign an issue claimed by
  someone else, never dispatch a `needs-user-decision` issue.
- Every dev agent works in its **own worktree per repo** (enforced by
  `guard-main-checkout.sh`; the os-dev definition repeats it).
- Parallelism is capped by `batch`. Dev agents for one batch must be
  file-disjoint by construction (step 3).
- When any rule here conflicts with AGENTS.md, **AGENTS.md wins**.

## Report contract (what os-dev returns)

```json
{
  "issue": 123,
  "status": "done | rework | blocked | needs_decision",
  "branch": "claude/issue-123-short-slug",
  "pr": "https://github.com/objectstack-ai/objectstack/pull/456 | null",
  "premise_still_valid": true,
  "summary": "what was implemented, 2-4 sentences",
  "tests": "commands run + pass/fail evidence",
  "open_questions": [
    { "question": "…", "options": ["A …", "B …"], "recommendation": "A, because …" }
  ],
  "out_of_scope_findings": ["filed as #457: …"]
}
```

`premise_still_valid: false` with `pr: null` is a legitimate terminal report
(step 5): review it as a re-triage input — verify the dev's evidence, then
close, re-scope, or re-file the issue — never as a failed dispatch.
`open_questions` must be non-empty when `status` is `needs_decision`, and each
entry becomes input to a `[决策]` issue. `out_of_scope_findings` should already
be filed as unassigned issues by the dev per the filing discipline in the
os-dev definition (search-first, sub-issue attachment, `finding` labeling —
objectstack#4949). The PM verifies they exist **and cross-checks the round's
parallel reports against each other**: two devs auditing adjacent code file
twins within the hour (cloud#1054 duplicated cloud#1031 same-day), and only
the PM sees both reports.
