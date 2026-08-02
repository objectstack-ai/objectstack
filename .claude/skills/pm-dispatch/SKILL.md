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
| `repo:<owner/name>` | which repo's backlog to work | `objectstack-ai/objectstack` |
| `batch:<n>` | max developer agents in flight at once | `3` |
| `rounds:<n>` | stop after N rounds | until queue empty |
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
gh label create pm:queue            -c 0e8a16 -d "Ready for the PM dispatch loop" || true
gh label create pm:dispatched       -c 1d76db -d "Dispatched to a dev agent by /pm-dispatch" || true
gh label create needs-user-decision -c d93f0b -d "Blocked on a maintainer decision — do not dispatch" || true
```

(Use the GitHub MCP tools instead of `gh` when the CLI is unavailable — the
protocol is identical.)

## The round loop

### 1. Fetch candidates

List open issues matching the filter, excluding anything assigned or labeled
`needs-user-decision`. Read each candidate's full body — batch selection
(step 2) and the dispatch prompt both need it.

### 2. Select the batch

Pick up to `batch` issues that are **mutually independent**: no two issues in
one batch may plausibly touch the same package, registry/barrel file, or spec
schema. Two dev agents editing the same shared file produce a merge race that
costs more than serializing. When in doubt, serialize — put the second issue in
the next round. Prefer small, well-specified issues; an issue with no acceptance
criteria you can state in one sentence is a candidate for escalation (step 7),
not dispatch.

### 3. Claim

For each selected issue, **before dispatching** (repo rule: claim before code):
assign it to yourself (`@me`) and add labels + a comment in Chinese, e.g.
「已由 PM 循环派发给开发 agent(第 N 轮)。」Skip — and drop from the batch —
any issue that acquired an assignee since step 1.

### 4. Dispatch

One `Agent` call per issue, `subagent_type: "os-dev"` (fall back to
`general-purpose` with the same prompt if the custom agent isn't loaded), run
in parallel in the background. Prompt template — fill every placeholder, paste
the full issue body, never a summary:

```
You are working repo {repo}, issue #{n}.

ISSUE TITLE: {title}
ISSUE BODY:
{body}

{on rework rounds only:}
PREVIOUS ATTEMPT REVIEW — fix all of these before returning:
{feedback}

Follow your operating procedure (you are the os-dev agent). Non-negotiables:
- Branch: claude/issue-{n}-{slug} off origin/main, in a DEDICATED worktree.
- The issue is already claimed; do not touch its assignee.
- Deliver: implementation + tests + changeset, pushed, as a DRAFT PR whose
  body starts with "Fixes #{n}". Never merge anything.
- If the issue underspecifies a decision that changes the public contract
  (spec schema, API shape, naming), STOP and return status "needs_decision"
  with your open questions — do not guess.
Return ONLY the JSON report defined in your agent definition.
```

### 5. Collect

Wait for the background task notifications — do not poll, do not fabricate a
pending agent's result. A dev that dies or returns malformed output counts as
`status: "blocked"` with its raw output attached.

### 6. Review each report

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
  what shipped; leave the PR for the normal human/merge-queue review flow.
  **The PM never merges** — merge discipline (CI-green, serial/queue) belongs
  to the repo, not this loop.
- **REWORK** — concrete, itemized feedback; re-dispatch the same issue with
  the feedback block filled (same claim, new dev agent). **Max 2 rework
  rounds** per issue; a third failure escalates instead.
- **ESCALATE** — see step 7.

### 7. Escalate uncertainties to the maintainer

Whenever a dev returns `needs_decision`, an issue is too vague to dispatch, or
rework has failed twice:

1. **File a new issue** titled `[决策] <一句话说清要拍板什么>`, labeled
   `needs-user-decision`, body in Chinese: 背景、具体问题、可选方案(各自
   代价)、你的建议、关联的原 issue / PR / 分支。
2. Comment on the original issue linking the decision issue, add
   `needs-user-decision` to it too, and drop it from the active queue.
3. If the session is interactive, additionally raise it via `AskUserQuestion`;
   the filed issue remains the durable record either way. **Never** answer a
   product/architecture question on the maintainer's behalf.

### 8. Round report, then next round

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

- PM writes **no files** and merges **no PRs**. No exceptions.
- Never force-push, never push `main`, never reassign an issue claimed by
  someone else, never dispatch a `needs-user-decision` issue.
- Every dev agent works in its **own worktree per repo** (enforced by
  `guard-main-checkout.sh`; the os-dev definition repeats it).
- Parallelism is capped by `batch`. Dev agents for one batch must be
  file-disjoint by construction (step 2).
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
