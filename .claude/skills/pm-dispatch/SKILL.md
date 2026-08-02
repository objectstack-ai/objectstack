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
| label `needs-user-decision` | waiting on the maintainer — **never dispatch**, never auto-answer |
| open PR referencing the issue | implemented, in review |
| merged PR with `Fixes #n` | done (GitHub closes the issue) |

**One-time setup** (idempotent, run at the start of the first round):

```bash
for R in objectstack-ai/objectstack objectstack-ai/objectui objectstack-ai/cloud; do
  gh label create pm:queue            -R "$R" -c 0e8a16 -d "Ready for the PM dispatch loop" || true
  gh label create pm:dispatched       -R "$R" -c 1d76db -d "Dispatched to a dev agent by /pm-dispatch" || true
  gh label create needs-user-decision -R "$R" -c d93f0b -d "Blocked on a maintainer decision — do not dispatch" || true
done
# routing labels exist only on the main backlog repo:
gh label create repo:objectui -R objectstack-ai/objectstack -c fbca04 -d "Lands in objectui (frontend)" || true
gh label create repo:cloud    -R objectstack-ai/objectstack -c c5def5 -d "Lands in cloud" || true
```

(Use the GitHub MCP tools instead of `gh` when the CLI is unavailable — the
protocol is identical.)

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

**4. One board, no second tracker.** The pm labels above are the state
machine; an org-level GitHub Project pulling issues/PRs from all three repos
gives the maintainer a single view (filter by `repo:*` and `pm:*`). The PM
maintains no tracking state outside GitHub — that invariant is what keeps
the loop resumable and the board honest.

## The round loop

### 1. Fetch candidates

List open issues matching the filter, excluding anything assigned or labeled
`needs-user-decision`. **Open sub-issues of a matching parent are candidates
too** — they inherit the parent's queue membership and need no label of their
own. Read each candidate's full body — triage, batch selection (steps 2–3)
and the dispatch prompt all need it.

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

### 3. Select the batch

Pick up to `batch` issues that are **mutually independent**: no two issues in
one batch may plausibly touch the same package, registry/barrel file, or spec
schema. Two dev agents editing the same shared file produce a merge race that
costs more than serializing. When in doubt, serialize — put the second issue in
the next round. Prefer small, well-specified issues; an issue with no acceptance
criteria you can state in one sentence is a candidate for escalation (step 8),
not dispatch.

### 4. Claim

All agents share one GitHub identity, so the assignee alone says "some agent
claimed this" but never *which* — the claim comment carries the identity. For
each selected issue, **before dispatching** (repo rule: claim before code),
execute atomically, in order:

1. **Assign** to yourself (`@me`) and add `pm:dispatched`. Skip — and drop
   from the batch — any issue that acquired an assignee since step 1.
2. **Claim comment** (Chinese), fixed shape — the branch name is the key,
   every later artifact (worktree, push, PR) hangs off it:
   > 认领:PM 循环第 N 轮
   > 分支:`claude/issue-<n>-<slug>`
   > Worktree:`<repo>-issue-<n>`
3. **Race check**: assignment is idempotent, so two agents can both
   "succeed". Re-read the comments; if an earlier claim comment with a
   *different* branch name exists, you lost — touch nothing of theirs,
   reply 「已有认领,让行」, and pick another issue. First comment wins.

Dev agents push their branch early — a remote branch is the hardest evidence
of work in flight, closing the gap between "claimed" and "PR exists".

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

### 8. Escalate uncertainties to the maintainer

Whenever a dev returns `needs_decision`, an issue is too vague to dispatch, or
rework has failed twice:

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
  "summary": "what was implemented, 2-4 sentences",
  "tests": "commands run + pass/fail evidence",
  "open_questions": [
    { "question": "…", "options": ["A …", "B …"], "recommendation": "A, because …" }
  ],
  "out_of_scope_findings": ["filed as #457: …"]
}
```

`open_questions` must be non-empty when `status` is `needs_decision`, and each
entry becomes input to a `[决策]` issue. `out_of_scope_findings` should already
be filed as unassigned issues by the dev (Prime Directive #10) — the PM only
verifies they exist.
