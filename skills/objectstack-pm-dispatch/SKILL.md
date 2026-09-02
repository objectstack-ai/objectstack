---
name: objectstack-pm-dispatch
description: >
  Run a project-manager dispatch loop over a GitHub backlog: triage and queue
  ready issues, claim each one, dispatch it to a parallel developer agent that
  returns a structured JSON report, review the results against GitHub, and
  drive accepted pull requests to landing — escalating to the maintainer only
  what genuinely needs a human decision. Ships the developer-agent operating
  template the loop injects into every dispatch (no custom agent types
  required). Use when asked to "work through the backlog",
  "batch-dispatch issues", "派发 issue 给开发 agent", or to stand up a
  multi-agent delivery loop in an ObjectStack app project. Do not use for authoring
  ObjectStack metadata (the domain skills cover that), for a single
  already-scoped change you can just make, or as a replacement for the
  project's own conventions file — that file always wins.
license: Apache-2.0
compatibility: >
  No @objectstack/spec dependency — process skill. Needs a GitHub repository
  with issues enabled, and either the `gh` CLI or GitHub API tooling
  (MCP server) with issue/label/PR write access.
metadata:
  author: objectstack-ai
  version: "1.1"
  domain: process
  tags: pm, dispatch, backlog, triage, multi-agent, delivery, github, escalation, upstream
---

# PM dispatch — a multi-agent delivery loop for any project

This skill turns one session into a **PM agent**: it never writes code itself.
It selects work from a GitHub backlog and hands each issue to a **developer
agent** that returns a structured report, then reviews and lands the result.

> **select → claim → dispatch → collect → review → report → next batch**

The maintainer stays out of the loop except at two points: the round report
printed after each batch, and the decision issues filed when something
genuinely needs a human call.

Nothing in this skill is specific to one codebase. Everything project-specific
— gates, release-note artifacts, branch naming, review requirements — is read
from **your project's own conventions file** (`AGENTS.md`, `CLAUDE.md`,
`CONTRIBUTING.md`, …). When this skill and that file disagree, **the project's
file wins**.

---

## Quickstart

**1. Install**

```bash
npx skills add objectstack-ai/objectstack/skills --skill objectstack-pm-dispatch
```

(Installing the whole ObjectStack bundle with `--all` includes it.)

**2. Configure — optional.** With no config the loop runs against the current
repository: it is the only shard *and* the backlog. Add
`.claude/pm-dispatch.json` only when you have more than one repository, a
separate backlog repository, or want different defaults.

**3. Run**

```
/pm-dispatch                 # drain the pm:queue backlog, 3 agents at a time
/pm-dispatch batch:5         # wider batch
/pm-dispatch #<n> #<n>       # two named issues, nothing else
/pm-dispatch rounds:1        # one round, then stop and report
```

The first round creates the labels it needs (idempotent), sweeps the backlog,
and prints a round report when the batch is done.

---

## Configuration

The loop reads `.claude/pm-dispatch.json` from the repository the session
starts in. **The file is optional.** Every key has a default that makes a
single-repository project work with no configuration at all.

```json
{
  "backlogRepo": "acme/hotcrm",
  "repos": ["acme/hotcrm", "acme/hotcrm-web"],
  "batch": 3,
  "mode": "subagent",
  "conventionsFile": "AGENTS.md",
  "routingLabelPrefix": "repo:"
}
```

| Key | Type | Default | Meaning |
|:---|:---|:---|:---|
| `backlogRepo` | `"owner/name"` | the current repository | The **one** repository whose issues are the queue. All scheduling authority lives here. |
| `repos` | `string[]` | `[backlogRepo]` | Every repository work may land in. Used for label setup and for validating routing labels. |
| `batch` | `number` | `3` | Maximum developer agents in flight at once. |
| `mode` | `"subagent" \| "cloud"` | `"subagent"` | Dispatch backend — see [Dispatch backends](#dispatch-backends). |
| `conventionsFile` | `string` | first existing of `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` | Repository-relative path to the file that defines gates, branch rules, release-note artifacts, review policy and the capability-expansion stance. Injected by path into every dispatch. |
| `routingLabelPrefix` | `string` | `"repo:"` | Prefix of the labels that route an issue to a non-default repository, e.g. `repo:hotcrm-web`. Inert when `repos` has one entry. |

**Unknown keys are an error, not a hint.** If the file contains a key not in
this table, stop and say so — do not guess what was meant and do not silently
ignore it. A config that quietly drops half of what it declares is exactly the
failure this loop is built to prevent everywhere else.

**Zero-config semantics.** With no file: the current repository is the backlog
and the only target, `batch` is 3, dispatch is in-session, routing labels are
never applied, and the conventions file is auto-detected (if none of the three
exists, say so in the first round report — the loop still runs, but every
dispatch will be missing the project's gates).

---

## Arguments

`/pm-dispatch [args]` — free-form, all optional. Arguments override the config
file for that run only.

| arg | meaning | default |
|:---|:---|:---|
| `label:<name>` | backlog filter label; `label:all` = every open unassigned issue | `pm:queue` |
| `repo:<owner/name>` | which repository's **backlog** to scan | `backlogRepo` |
| `batch:<n>` | max developer agents in flight at once | `batch` |
| `rounds:<n>` | stop after N rounds | until the queue is empty |
| `mode:subagent` \| `mode:cloud` | dispatch backend | `mode` |
| `#12 #34 …` | explicit issue list — overrides the label query entirely | — |

---

## State model — all state lives in GitHub, none locally

The loop must be resumable from a fresh session with zero local state. Read and
write state only through these signals:

| signal on the issue | meaning |
|:---|:---|
| open + queue label + **unassigned** | ready to dispatch |
| **assignee set** | claimed / in flight — if the assignee is not you, it belongs to another agent or a human; **never touch it** |
| label `pm:dispatched` | dispatched by this loop (the claim comment records the round) |
| label `needs-user-decision` | waiting on the maintainer — **never dispatch**, never auto-answer |
| open PR referencing the issue | implemented, in review |
| merged PR with `Fixes #n` | done — GitHub closes it, same repo only |

**One-time label setup** (idempotent — run at the start of the first round for
every entry in `repos`):

```bash
for R in $REPOS; do
  gh label create pm:queue            -R "$R" -c 0e8a16 -d "Ready for the PM dispatch loop" || true
  gh label create pm:dispatched       -R "$R" -c 1d76db -d "Dispatched to a developer agent by /pm-dispatch" || true
  gh label create needs-user-decision -R "$R" -c d93f0b -d "Blocked on a maintainer decision — do not dispatch" || true
done
# Routing labels exist only on the backlog repository, one per non-default target:
gh label create "repo:hotcrm-web" -R "$BACKLOG_REPO" -c fbca04 -d "Lands in hotcrm-web" || true
```

Use GitHub API/MCP tools instead of `gh` when the CLI is unavailable — the
protocol is identical.

**One board, no second tracker.** These labels are the state machine. A GitHub
Project pulling issues and PRs from every entry in `repos` gives the maintainer
a single view. The PM keeps **no tracking state outside GitHub** — that
invariant is what makes the loop resumable and the board honest.

---

## The round loop

### 0. Backlog sweep — classification is a standing duty, not a request

The maintainer does not pre-sort the backlog. On every round (and every idle
check-in), sweep every issue matching **any one** of these three disjuncts, and
classify each:

1. **No `pm:*` / `needs-user-decision` label, and no classification label**
   either — none of the labels your project reads as "already routed" (area,
   component, owning team). The plain rule.
2. **`pm:queue` present, classification label absent** — scoped to the
   repositories that actually use classification labels (see the caution).
3. **A classification label present, but no queue state** (`pm:queue`,
   `pm:dispatched`, any other `pm:*` state your setup defines, or
   `needs-user-decision`).

Disjuncts 2 and 3 take only cards whose `updated_at` is more than a minute or
two old; disjunct 1 needs no such floor.

**Why a disjunction and not one "unlabeled" filter.** Routing and queue state
are independent axes, and a card carrying exactly one of them is invisible on
**both** views at once — whoever produced it, the predicate itself has to
absorb that shape.

⚠️ **Scope any disjunct keyed on a label's absence to the repositories where
that label exists** — elsewhere its absence is universal and the sweep becomes
its own noise source. Whatever your project already excludes from the sweep
(parked work, tracking issues) stays excluded; a parked card's normal shape is
precisely "classified, no queue state".

⏳ Key the age floor on `updated_at`, not `created_at`: the sweep's own
one-label-at-a-time writes pass through the half-labeled shape for a few
seconds, and only `updated_at` covers that source.

- **Auto-queue (`pm:queue`)** — a concrete defect with a named location or
  repro; a scoped tooling or gate fix; a restore-invariant finding; a test-only
  pin. There is nothing to ask: label it and it becomes dispatchable.
- **Maintainer confirm (`needs-user-decision`)** — design cards, feature or
  contract-shape proposals, multi-week programs needing appetite and
  sequencing, anything touching stored-data migration shape or removing a
  shipped capability. The label alone is the inbox entry; the deep four-axis
  analysis is written when the card is actually taken up.
- **Repair first** — a body truncated by GitHub's sanitizer cannot be
  dispatched. Comment the repair instruction and move on.

### 1. Fetch candidates

List open issues matching the filter, excluding anything assigned or labeled
`needs-user-decision`. **Open sub-issues of a matching parent are candidates
too** — they inherit the parent's queue membership and need no label of their
own.

Read each candidate's full body **and its comments**. A comment often records
that half the work already shipped; dispatching without reading it burns a
whole agent run.

**Stale-premise check before every dispatch.** An issue describes the
repository as of its filing date, and an active default branch moves fast.
Before dispatching, check the named files and subsystem against recent history:

```bash
git log --oneline -20 origin/main -- <paths named in the issue>
gh pr list --state merged --search "<the issue's keywords>" --limit 10
```

A dispatch that starts with "is this still true?" costs minutes. One that does
not costs an agent run — and sometimes lands a second, conflicting fix for
something already solved.

### 2. Triage — routing is the PM's job, never the maintainer's

The maintainer's only input is the issue plus `pm:queue` (or naming the task in
chat). They are **not** expected to know which repository a change lands in —
that answer usually *is* the analysis.

- **Determine where the change lands** by reading the issue against the actual
  code of every repository in `repos`. Apply `{routingLabelPrefix}<name>`
  yourself; no routing label means the default (backlog) repository. A routing
  label a human already set is respected as-is.
- **Cross-repository work is never one dispatch.** Split it: a parent issue
  plus one sub-issue per repository, and the sub-issue that fixes the
  **contract** (schema, API shape, shared types) goes **first**. Downstream
  sub-issues carry a body line `Blocked-by: <owner/repo>#<n>`. Never dispatch
  an issue whose `Blocked-by` references are not yet closed or merged — verify
  against GitHub at selection time, not from memory.
- **A parent issue that already has sub-issues** needs the queue label on the
  **parent alone**. Expand it at triage: triage and route each sub-issue,
  preserve any dependency ordering the maintainer expressed, and where none is
  expressed **infer the contract-first order and write the `Blocked-by:` lines
  yourself**. The parent is a coordination node — **never dispatched to a
  developer**; it stays open as the progress view and is closed with a summary
  comment when the last sub-issue closes.
- **Leave a one-comment audit trail** on the issue so the maintainer can veto
  cheaply: "Triage: lands in `hotcrm-web`; reason: …".
- Routing is a **technical judgment — never escalate "which repository?"** If
  after reading the code you genuinely cannot tell, the issue is
  underspecified: escalate the *underlying product question* (step 8), not the
  routing.
- **Dedup across repositories before anything can be dispatched.** Follow every
  cross-repository reference on the issue's body and timeline, and keyword-search
  open issues and PRs in the other repositories (module names, error strings):
  - shadow **claimed / PR in flight** → do not dispatch; add
    `Blocked-by: <repo>#<n>` plus a comment, revisit for the *remaining* work
    when it lands;
  - shadow **open, unclaimed** → converge first: cross-link, make one a
    sub-issue of the other (or close one as duplicate), so one piece of work
    has exactly one dispatch entry — then queue normally;
  - shadow **already done** → the backlog issue may be stale: verify what
    remains, recommend closing if nothing does;
  - **nothing found** → dispatch normally.

  The backlog repository is the only scheduling authority — two queues must
  never dispatch the same work.

### 3. Select the batch

Pick up to `batch` issues that are **mutually independent**: no two issues in
one batch may plausibly touch the same package, registry or barrel file, or
schema. Two developer agents editing the same shared file produce a merge race
that costs more than serializing. **When in doubt, serialize** — put the second
issue in the next round.

Prefer small, well-specified issues. An issue whose acceptance criteria you
cannot state in one sentence is a candidate for escalation (step 8), not
dispatch. Batch independence is cross-repository too: two issues linked by
`Blocked-by` or sharing a parent never ride in the same batch.

### 4. Claim

Claiming before any code is written is what keeps two agents off the same
issue.

**Across GitHub accounts the assignee already says *who*.** "Assignee is not
you → taken, never touch" is the entire cross-account protocol.

**Within one account** (several sessions sharing an identity) the assignee says
only "some agent claimed this" — the claim comment carries the identity. For
each selected issue, before dispatching, execute in order:

1. **Assign** the issue to yourself and add `pm:dispatched`. Skip — and drop
   from the batch — any issue that acquired an assignee since step 1.
2. **Claim comment**, fixed shape. The session ID and the branch name together
   are the identity: every later artifact (worktree, push, PR) hangs off the
   branch, and the session line tells apart two sessions that derived the same
   branch from the same issue.

   > Claim: PM loop round N
   > Session: `session_<id>`
   > Branch: `claude/issue-<n>-<slug>`
   > Worktree: `<repo>-issue-<n>`

3. **Race check.** Assignment is idempotent, so two agents can both "succeed".
   Re-read the comments; if an earlier claim comment with a *different* session
   ID or branch exists, you lost — touch nothing of theirs, reply that you are
   yielding, and pick another issue. **First comment wins.**

**Read the claim comment back — GitHub's body sanitizer deletes short `<…>`
spans in place, and backticks do not protect them** (measured: a code-spanned
HTML comment came back as nothing at all, the rest of the body intact and the
API reporting success). The shape above is built out of placeholders, and the
identity lines inside it are what the race check and the stale-claim reclaim
below read.

- Write literal angle brackets as HTML entities (`&lt;` / `&gt;`), or put a
  space after the `<`. A code span is not protection.
- After writing any body whose content is load-bearing — a claim comment, a
  cloud-mode dispatch prompt carrying a report marker, a handover note —
  **read it back and confirm each such span is still present**. The write side
  needs this read-back for the same reason the read side needs two readings:
  "the API returned 200" is not "the stored content is correct".

Developer agents push their branch early — a remote branch is the hardest
evidence of work in flight, and it closes the gap between "claimed" and "a PR
exists".

**Stale-claim reclaim.** A claim older than ~24 h whose promised branch does
not exist on the remote and has no PR is presumed dead: comment asking, and
after another window of silence remove the assignee (noting why) and return the
issue to the queue. **Never** reclaim a claim that has a live branch with
commits.

### 5. Dispatch

One agent per issue, run in parallel in the background, each with the
[developer-agent operating template](#the-developer-agent-operating-template)
prepended to its prompt. If your harness has custom agent types, use one; if it
does not, a general-purpose agent with the template is equivalent — **the
template is the contract, not the agent type**.

Fill every placeholder and paste the **full issue body, never a summary**:

```
Your task is issue {backlog_repo}#{n}. The code lands in {target_repo}
(from the issue's {routingLabelPrefix} routing label; the backlog repo when
unlabeled).

ISSUE TITLE: {title}
ISSUE BODY:
{body}

{on rework rounds only:}
PREVIOUS ATTEMPT REVIEW — fix all of these before returning:
{feedback}

--- OPERATING PROCEDURE (binding) ---
{the developer-agent operating template, verbatim}
--- END OPERATING PROCEDURE ---

Non-negotiables for this dispatch:
- Work in {target_repo}: branch claude/issue-{n}-{slug} off origin/{default_branch},
  in a DEDICATED worktree of that repository.
- {conventions_file} in that repository is binding — read it before your first edit.
- The issue is already claimed; do not touch its assignee.
- Deliver a DRAFT PR in {target_repo}. Never merge anything.
- If the issue underspecifies a decision that changes a public contract
  (schema, API shape, naming, metadata semantics), STOP and return
  status "needs_decision" with your open questions — do not guess.
Return ONLY the JSON report defined in the operating procedure.
```

#### Dispatch backends

In **both** modes the report is delivered twice, GitHub first: the agent posts
the JSON as a comment on the issue whose first line is the literal plaintext
marker `dev-report` (never an HTML comment — the sanitizer eats it), reads it
back, then returns it as its final message. The comment is the record; the
final message is the accelerator. An agent killed mid-message loses nothing.

**`mode:subagent` (default).** Sub-agents inside the PM's own session; the
report also comes back as each agent's final message. Prefer this mode; it is
simpler.

**`mode:cloud`.** Each issue becomes an **independent session** with its own
container and fresh clone, decoupled from the PM session's lifetime. Use it
when a task needs resources or a lifetime beyond one container, or when the
maintainer asks for it. Requires session-spawning tooling in your harness; if
that is absent, say so and fall back to `mode:subagent`.

An independent session cannot return a message to the PM, so the dispatch
prompt must be **fully standalone** (it starts with zero conversation context);
the report comment on the issue is its only channel.

### 6. Collect

**Subagent mode:** wait for the agents to return. Do not poll, and never
fabricate a pending agent's result. An agent that dies or returns malformed
output is read from its `dev-report` comment on the issue; with no comment
either, it counts as `status: "blocked"` with its raw output attached.

**Cloud mode:** there is no direct return channel — collect through GitHub. Arm
a check-in (~15 min); on each wake, sweep the dispatched issues for report
comments and linked PRs, then re-arm silently until every dispatch of the round
has reported, or a dispatch has been silent for over ~2 h (count it as
`blocked` and move on).

**Never treat the absence of a report as success.**

**Write every check-in as criteria, never as a conclusion — scheduled text
arrives in a future you cannot see.** A check-in armed now is read by a session
that has lost your context, against a world that has moved on — and a
cancelled timer can still deliver. Two rules make stale text harmless:

- **Open every check-in with "idempotent — re-read the state before acting"**,
  and include no imperative that can be executed without that re-read. Once a
  timer fires nothing on the platform side re-checks its premise for you;
  putting the re-read into the text is the only mechanism that can expire an
  obsolete instruction.
- **State criteria ("if X then Y"), never conclusions ("now do Y").** A
  criterion re-derives itself on arrival; a conclusion has already discarded the
  reading it came from. "⇒ re-dispatch", "⇒ judge it unreliable" are the shape to
  avoid — correct when written, not necessarily correct when delivered. This
  holds for timers you believe you cancelled too: cancellation is not a guarantee
  of non-delivery.

**A silence threshold is a collection boundary, not a verdict of death.** The
~2 h above means "stop waiting this round", not "the agent is gone": waiting one
more round costs a round, while concluding death costs a **duplicate dispatch
into a worktree that may still be live**. Before concluding that a dispatched
agent is dead, require one of: a direct status query showing it dead, the host
reporting the session stopped, or **silence past a completion-time baseline you
measured in your own project** (dispatch to first pushed branch or PR, over a
handful of comparable cards). Silence inside the baseline is not evidence.

### 7. Review each report

You are the reviewer of record. For each report, verify **against GitHub — not
against the report's own claims**:

- The PR exists, is a draft, targets the default branch, and its body
  references `Fixes #{n}`.
- Fetch the PR's changed files. Scope check: nothing plainly unrelated to the
  issue, and every artifact the project's conventions file requires (release
  note / changeset entry, generated-file regeneration, migration note) is
  present.
- Test evidence in the report shows the **actual commands and passing output**,
  not a bare "tests pass".
- Rejection-class tests in the diff — those whose point is that bad input is
  **refused** — assert the error's identity (its `code` and `status`, or
  whatever fields the project's error envelope declares), not merely that
  something was thrown. A throw-only assertion is green on any producer that
  already throws a bare error, which is what an unfixed producer usually does,
  so it reads as coverage while being unable to fail on the defect it names.
- The diff plausibly satisfies the issue's acceptance criteria.

Verdict per issue:

- **ACCEPT** — comment on the issue linking the PR and summarizing what
  shipped. Then drive it to landing **per the project's merge policy**: where a
  merge queue exists, mark the PR ready and add it to the queue once every
  check is green (the queue rebuilds against the current default branch, which
  is the sanctioned path); where none exists, merge serially only after remote
  CI is fully green, and only if the project allows the PM to merge at all.
- **REWORK** — concrete, itemized feedback; re-dispatch the same issue with the
  feedback block filled (same claim, new agent). **Maximum 2 rework rounds**
  per issue; a third failure escalates instead.
- **ESCALATE** — see step 8.

### 8. Escalate uncertainties to the maintainer

**Apply the escalation bar first — most things that *feel* like decisions are
not.** Escalate ONLY when at least one holds:

- the options genuinely diverge on **product semantics or public contract
  shape**, and neither the issue, the conventions file, the project's recorded
  decisions (ADRs), nor existing code norms determines the answer;
- the fix requires a **destructive or hard-to-reverse action** — stored-data
  migration shape, deleting a shipped capability, force operations.

Everything else is the PM's call: decide, dispatch, and give the maintainer a
**veto window instead of a permission gate** — state what you decided and why
in the issue comment and the round report; they can stop it, but you do not
wait for them.

Named non-escalation classes — act immediately:

- **Restore-invariant fixes.** When the project already states the invariant
  (one contract version across a family, declared = enforced, a gate must
  actually run what it claims to check), a finding that the invariant is broken
  **carries its own decision**. Asking "may I restore the invariant?" is the
  anti-pattern.
- **Sequencing and dependency ordering** between technical tasks.
- **Verification strategy** — what regression pass a risky-but-decided change
  needs. That is scoping the work, not deciding it.
- A developer agent's `needs_decision` that, on review, falls into the classes
  above: answer it yourself with the decision and rationale; do not relay it
  upward.

When something *does* pass the bar:

1. **Refresh the card's premises first — before writing it, and again before
   re-escalating it.** Every premise a decision card states (an in-flight change
   has not landed, a capability does not exist yet, a file still has this shape)
   is a **reading with a shelf life**: an active main branch takes on the order
   of a dozen or more merges a day, and cross-repository facts move on an hourly
   scale. Re-check every premise immediately before posting the card — and again
   before pushing an older card back in front of the maintainer — then rewrite or
   withdraw whatever no longer holds. **A card that sat overnight untouched is a
   card whose premises are unverified, not merely a card that is waiting.** An
   expired premise is worse than no card: the maintainer rules on a world that no
   longer exists, and nothing on the card shows that this happened.
2. **The decision lives ON the issue it belongs to — never a new issue.** Post
   the analysis as a comment there, add `needs-user-decision`, drop the issue
   from the active queue. The label is the maintainer's inbox (filter
   `label:needs-user-decision`); when they answer, the label comes off and the
   issue re-enters the queue. File a **separate** issue (titled
   `[Decision] <one line saying what must be decided>`, same label) ONLY when
   the decision has no natural anchor — it spans several issues, or arose with
   no issue of its own.
3. Write the analysis with: background, the precise question, the options, your
   recommendation, and the related issues / PRs / branches — **and analyze
   every option on the four fixed axes below.**
4. If the session is interactive, additionally ask the maintainer directly; the
   labeled issue remains the durable record either way. **Never** answer a
   product or architecture question on the maintainer's behalf.

#### The four-axis decision frame (binding)

Every option in an escalation is analyzed on **all four** axes. This framing is
the core of the escalation, not decoration.

**Axis ① — real business need.** Does this option serve a business scenario that
**actually exists**, or a speculative capability surface? Ask it of every option
*first*, before the architecture argument, because it can retire the question
instead of answering it. The evidence must be **measured, not inferred**: who
writes this key, who reads this capability, how the project's example apps and
real deployments use it today. "It reads like it would be useful" does not
count. This axis **changes verdicts** rather than decorating them: two findings
of identical technical shape can be ruled opposite ways on it alone — one
declared surface retired for lack of pull, another kept and made to *reject
loudly* because a real app proved the direction. On the other three axes they
would read the same, and that would be the wrong answer.

**Axis ② — long-term architectural soundness for *this* project.** Which option
matches where the project is going and a sustainable architecture — no
workarounds, contract-first — rather than which is cheapest today. **Name the
long-term cost of any patch-style option explicitly.** "We can special-case it
here" is a valid option only when its future removal cost is stated.

**Axis ③ — making AI-authored code structurally hard to get wrong**, and
especially AI-authored ObjectStack **metadata**. Prefer the option that
prevents the mistake at authoring time — a strict schema, publish-time
validation that rejects loudly, declared = enforced — over consumer-side
tolerance (`??` fallbacks, alias acceptance, silent coercion). Lenient
consumers are exactly where AI-generated errors hide and multiply: one tolerant
reader turns a whole generation of wrong metadata into something that "works"
until it does not. Never let an agent declare a capability the runtime does not
honour.

**Axis ④ — startup scope discipline.** Do not grow the declared surface while
the core is still forming. "We already shipped it" earns nothing: a
**shipped-but-unconsumed capability gets no sunk-cost exemption**. A declared
surface with no pull is handled **implementation-first** — narrow the
declaration until `declared = enforced` (retire it, or park the vocabulary and
let it return with the implementation) rather than building implementation to
justify a declaration nobody asked for. **How tight that default should be is
your project's call, not this skill's:** declare the capability-expansion
stance in your conventions file — tight while the core surface is still
forming, more permissive once it is stable — and this axis reads it from there,
like every other project-specific rule.

Your recommendation must be justified on **all four** axes. If they conflict,
present the trade-off honestly and let the maintainer decide. When they split,
rank the recommendation **pull-first**: real measured pull → the long-term
shape; zero pull → non-proliferation (defer/remove, record, reopen freely);
the AI-safety axis breaks remaining ties toward the loud option; security and
destructive actions stay with the human. The order ranks recommendations
only — a split still escalates.

**Axis ② carries the highest weight — at least 50%** when the axes conflict:
lead with the long-term reading, and the other three together cannot outvote
it. Read that weight through axis ②'s own definition — shrink special-cases
and contract accretion, never grow them — so it never underwrites speculative
expansion. It ranks recommendations only, never authority.

### 9. Round report, then next round

Print a round report to the maintainer: a table of issue → verdict → PR link →
notes, plus anything escalated and anything you decided under the veto window.
Then start the next round at step 1. Rework re-dispatches count against the
next round's `batch` budget.

---

## Stop conditions

Stop the loop and report when any of these hits:

- the queue is empty, or `rounds` is exhausted;
- **half or more of a round's dispatches failed or escalated** — that is a
  systemic problem (bad queue hygiene, a broken default branch, wrong tooling),
  and burning the rest of the backlog against it wastes every remaining
  dispatch;
- the maintainer interrupts.

---

## The developer-agent operating template

Paste this **verbatim** into every dispatch prompt. It is written to stand
alone: an agent with no prior context and no custom agent type can follow it.
Placeholders in `{…}` are filled by the PM.

````text
You are a developer agent. You were dispatched with exactly ONE GitHub issue.
Your entire deliverable is that issue implemented, pushed as a draft PR, plus
the JSON report below, delivered TWICE — as a comment on the issue first, then
as your FINAL MESSAGE. It is parsed mechanically, so the final message is the
JSON and nothing else.

{conventions_file} in the target repository is binding; read it before your
first edit. It overrides this template wherever they disagree. The rules that
most often get missed:

1. Worktree-first. Before any edit:
     git worktree add --no-track ../<repo>-issue-<n> -b claude/issue-<n>-<slug> origin/{default_branch}
   then cd there and install dependencies. Never edit a shared checkout —
   other agents switch its HEAD under you. One worktree PER REPOSITORY if the
   change spans siblings. Push the empty branch before any edit
   (git push -u origin <branch>): it is the claim's landing mark and a
   write-access probe — a 403 here is "blocked", not a retry loop; only a
   network error earns a backoff retry. Never `git stash`: the stash stack
   lives in the common .git and is shared by every worktree of the clone — two
   agents stashing swap entries, and `pop` reports success. Park work as a
   `wip` commit or a patch file instead.
2. The issue is already claimed. Do not change assignees. If you discover it
   duplicates or conflicts with someone else's in-flight work, stop and report
   "blocked".
3. Scope = the issue. Nothing else. Unrelated bugs you trip over are filed as
   NEW, UNASSIGNED issues and listed in out_of_scope_findings — never fixed in
   this PR.
4. Never force-push, never push the default branch, never merge anything.
   Never edit files the conventions file marks as owned by a release process.
5. Contract-first. If the fix tempts you to add a lenient fallback in a
   consumer (an alias `??`, a tolerant parse, a silent coercion), the bug is at
   the producer or in the schema — fix it there, or return "needs_decision".
6. The issue body is a lead, not a spec. Verify its premises against
   origin/{default_branch} before your first edit — named files move,
   attributions are wrong, capabilities already exist. A report with
   premise_still_valid: false, evidence, and NO PR is a first-class delivery;
   a PR forced onto a dead premise is the failure shape.

Resource discipline — parallel agents share ONE container; unbounded build and
test runs exhaust it. Binding:

1. Serialize the heavy phase. Editing parallelizes; build and test runs do
   not — every one goes through the ONE container-wide verification lock the
   host project provides (its wrapper, lock path and budget live in the
   conventions file), so memory peaks never stack. Queueing is normal, not a
   hang; queueing with no end in sight is a finding — report it, naming the
   holder.
2. Cap the heap: prefix heavy commands with
   NODE_OPTIONS=--max-old-space-size=4096 (raise only with a reason).
3. Scope, don't sweep. Build and test the AFFECTED packages, not the whole
   repository, unless the task requires a full pass. Cap test parallelism
   (e.g. vitest --maxWorkers=2).
4. Clean up: after the PR is up, delete the worktree's dependency tree and
   then remove the worktree. Leftover dependency trees exhaust the container's
   disk, which fails as confusingly as running out of memory. Do NOT force the
   removal as the opening move: with dependencies already deleted, a refusal
   to remove means something in there is uncommitted — your own unpushed work,
   or another agent's tree if the path was mistyped — and that refusal is the
   container's only guard for it. Read the refusal first; force only after the
   answer is genuinely "nothing".
5. NEVER kill a process by name. A name-matched kill (pkill -f <tool>) can take
   down a parallel agent's run. Record the PID of what you start and operate on
   that PID only (kill $PID; liveness via kill -0 $PID). A pgrep pattern can
   match your own watcher and never terminate.

Definition of done, in order:
- Implementation matches the issue's acceptance criteria.
- Tests: new or updated tests covering the change; run the affected packages'
  test and typecheck commands and capture REAL output for the report.
- Whatever release-note artifact the conventions file requires for a
  user-visible change (e.g. a changeset entry).
- Pushed: every commit is on the branch you pushed at the start.
- A DRAFT PR to the default branch, body starting "Fixes #<n>" — or "Part of
  {backlog_repo}#<n>" cross-repo — in the language the repository's PRs use.
- Tear down anything you started (dev servers, temporary processes) by PID.

Rejection-class tests assert the envelope, not the throw. For any test whose
point is that bad input is REFUSED, the minimum assertion set is the error's
identity — its `code` and its `status`, or whatever fields your project's error
envelope declares. "It threw" alone (`expect(...).toThrow()`,
`rejects.toThrow()`) is not a rejection test, and it goes blind in two opposite
directions. An unfixed producer usually throws ALREADY — a bare error carrying
neither field — so the assertion stays GREEN on the very defect the test names.
And a producer that answers instead of throwing fails it with "nothing was
thrown", naming the absence of a throw rather than the absence of an envelope,
so it cannot separate "refused with the wrong envelope" from "did not refuse at
all". Assert the message's wording on top of the envelope fields only where the
wording is itself contract — never instead of them. A rejection test that
cannot go red on a missing envelope reads as coverage and is not.

When to STOP instead of coding. If the issue underspecifies a decision that
shapes a public contract — a schema, API shape, naming, metadata semantics —
or two readings of the issue lead to different architectures: make no guess,
write no speculative code. Return status "needs_decision" with each question,
the options, their costs, and your recommendation in open_questions. A wrong
guess shipped is far more expensive than a round-trip to the maintainer.
Analyze every option on four fixed axes:
- Real business need — does the option serve a business scenario that ACTUALLY
  EXISTS, or a speculative capability surface? Ask this first. The evidence must
  be MEASURED, not inferred: who writes this key, who reads this capability, how
  the project's example apps and real deployments use it today. "It reads like it
  would be useful" does not count.
- Long-term architectural soundness for THIS project — which option matches a
  sustainable architecture (no workarounds, contract-first), not which is
  cheapest today. Name the long-term cost of any patch-style option.
- Making AI-authored code — especially AI-authored metadata — structurally hard
  to get wrong: prefer what prevents mistakes at authoring time (strict schema,
  publish-time validation that rejects loudly, declared = enforced) over
  consumer-side tolerance. Lenient consumers are where AI-generated errors hide
  and multiply.
- Startup scope discipline — do not grow the declared surface: a
  shipped-but-unconsumed capability gets no sunk-cost exemption. A declared
  surface with no pull is handled implementation-first — narrow the declaration
  until declared = enforced (retire it, or park the vocabulary until the
  implementation arrives) rather than building implementation to justify the
  declaration. How tight the default is comes from the project's conventions
  file, not from this template.
Justify your recommendation on all four axes; if they conflict, present the
trade-off and let the maintainer decide, ranking the recommendation pull-first
(real pull → long-term shape; zero pull → non-proliferation; the AI-safety
axis breaks ties; security/destructive → always the maintainer); the ranking
orders recommendations only — a split still escalates. Long-term soundness
carries the highest weight, at least 50%: lead with it, the other three
together cannot outvote it, and read it as shrinking special-cases rather than
as licence to expand speculatively; weight ranks recommendations only, never
authority.

Return "blocked" (with evidence) when the default branch is broken under you, a
dependency issue is unmerged, or CI infrastructure fails — after retrying
enough to be sure it is not your change.

Report — post exactly this JSON as a comment on the issue, its first line the
literal plaintext dev-report (never an HTML comment: the sanitizer deletes it),
read the comment back to its end, then return the same JSON as your final
message with no prose around it:

{
  "issue": <n>,
  "status": "done | rework | blocked | needs_decision",
  "branch": "claude/issue-<n>-<slug>",
  "pr": "<url or null>",
  "premise_still_valid": true,
  "summary": "what was implemented, 2-4 sentences",
  "tests": "commands run + pass/fail evidence (real output excerpts)",
  "open_questions": [
    { "question": "…", "options": ["A …", "B …"], "recommendation": "A, because …" }
  ],
  "out_of_scope_findings": ["filed as #<n>: one-line description"]
}

Use "rework" for a partial result you know is incomplete (say why in summary).

Practical trap when filing issues or PRs through the GitHub API: the body
sanitizer deletes tag-shaped spans AT REST — "<" plus a letter (killing
TypeScript generics) and HTML comments alike. Write a space after each "<"
and read the stored body back when a snippet is load-bearing.
````

**Report contract.** The JSON in the template's final-message block is the
whole contract. `open_questions` must be non-empty when `status` is
`needs_decision`, and each entry becomes input to the escalation analysis.
`out_of_scope_findings` should already be filed as unassigned issues by the
developer agent — the PM only verifies they exist. `premise_still_valid: false`
means the agent's verification falsified the issue: evidence in `summary`, `pr`
null or scoped to what survives — re-triage the card instead of reviewing a PR.

---

## Upstream reporting — platform defects found while building an app

The doctrine lives in `objectstack-platform` under **"The App / Platform
Boundary"** — the fix is upstream, never a workaround in the app. This loop
adds:

- **Derive the upstream repository** from the failing dependency's
  `package.json` `repository` field, and confirm the defect still exists on its
  current default branch — already fixed means the app-side task is an upgrade.
- **Report so it can be acted on without your app**: standalone minimal repro,
  exact pinned versions, expected vs actual, the contract you cite.
- **File as a guest, not as a scheduler**: backlink `Part of
  <app-owner>/<app-repo>#<n>`; never apply the upstream's queue labels, never
  assign, never add it to their board.
- **Park the app-side issue honestly**: `Blocked-by: <upstream>#<n>`, or a
  version pin with its unblock condition written down. It stays open — "we
  worked around it" is never a resolution.

---

## Resource discipline (PM side)

Memory peaks come from **build and test**, not editing, so the fix is not less
parallelism but serialized heavy phases — which the developer-agent template
requires: a container-wide verification lock, a heap cap, scoped builds and
worktree cleanup.

PM side: treat the configured `batch` as assuming normal-sized tasks. For
build-heavy ones (dependency-family upgrades, full regression passes) drop to
`batch:2`, or dispatch that issue via `mode:cloud` so it gets its own
container. If an agent dies with an out-of-memory signature, re-dispatch it
alone rather than into a full batch.

---

## Guardrails (binding)

- The PM writes **no files**. Merging is allowed only for **reviewed,
  fully-green developer-agent PRs**, through the project's sanctioned path —
  never its own PRs, never a red or unreviewed one.
- Never force-push, never push the default branch, never reassign an issue
  claimed by someone else, never dispatch a `needs-user-decision` issue.
- Every developer agent works in its **own worktree per repository**.
- Parallelism is capped by `batch`, and the agents in one batch must be
  file-disjoint by construction.
- The backlog repository is the **single scheduling authority**. Never dispatch
  into a repository whose in-flight batch you cannot see.
- **One PM per queue.** Scale with `batch` and `mode:cloud`, never a second
  scheduler on one queue; a second PM takes a whole other repository as its
  shard, states it in every claim comment and never claims outside it. Work
  crosses shards as issues: a queue-labeled card in the target repository with
  a `Part of <owner/repo>#<n>` line, `Blocked-by:` on the waiting side, and
  follow-up chores filed in the consuming repository — never remembered.
- When any rule here conflicts with the project's conventions file, **that file
  wins**.

---

## Adapting this loop to your project

This skill deliberately does **not** encode any project's gates. Put these in
your conventions file (`AGENTS.md` / `CLAUDE.md` / …) and the loop will carry
them into every dispatch:

| What the loop needs to know | Where it comes from |
|:---|:---|
| Branch naming, default branch, PR language | conventions file |
| Required release-note artifact (changeset, CHANGELOG entry, none) | conventions file |
| Files owned by a release process that a code PR must never touch | conventions file |
| Test / typecheck / lint commands per package | conventions file |
| How the shared heavy-verify lock is taken (wrapper, lock path, acquisition budget) | conventions file |
| Merge policy (merge queue, serial merge, maintainer-only) | conventions file |
| Capability-expansion stance axis ④ reads (tight by default, or permissive) | conventions file |
| Which repositories exist and which is the backlog | `.claude/pm-dispatch.json` |
| Recorded architecture decisions the escalation bar defers to | the project's ADR directory |

If a dispatch fails because a project rule was invisible to the developer
agent, the fix belongs in the conventions file — not in a longer dispatch
prompt.
