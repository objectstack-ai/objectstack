# ADR-0125: The human act that authorises a release is the environment approval, not a typed version string

**Status**: Proposed (2026-08-20) — awaiting the maintainer's hand-merge, which is itself the acceptance act for a governed surface (Prime Directive #14). Implementation ships in the same PR: `.github/workflows/release.yml`.
**Deciders**: ObjectStack Protocol Architects (maintainer ruling, 2026-08-20, on the back of the [#10146](https://github.com/objectstack-ai/objectstack/issues/10146) release failure)
**Builds on**: the 2026-08-07 maintainer ruling recorded in **AGENTS.md Prime Directive #15** (「版本发布必须是人工的」) and its implementation in [#6170](https://github.com/objectstack-ai/objectstack/issues/6170) (the two-lane split of `release.yml`)
**Supersedes**: nothing. It **re-implements** Prime Directive #15's requirement; the requirement itself is untouched and is quoted again below so no later reader has to reconstruct it.
**Consumers**: `.github/workflows/release.yml`, `AGENTS.md` (Prime Directive #15), every seat that reads either

---

## TL;DR

The 2026-08-07 ruling stands, verbatim and undiluted:

> **刚才我也没提出要求,是哪个ai自己替我发了 rc.4,版本发布必须是人工的。这个要写入规范。**

What changes is **which human act carries it**.

| | Before | After |
|:--|:--|:--|
| What starts the release | maintainer opens Actions → Run workflow | merging the **Version Packages** PR |
| The human confirmation | maintainer **types the exact version**; a mismatch against `packages/cli/package.json` fails the run | maintainer **approves the `release` environment deployment**; nothing runs until they do |
| What the machine may do unattended | nothing | queue a deployment and wait |
| Where the barrier lives | the `workflow_dispatch` **event**, which no push can synthesise | the environment's **required reviewers**, a repo-Settings fact |

That last row is the whole risk of this record, and it is why the next section exists.

## Context

### The typed version was carrying two jobs, and only one of them well

Typing `17.1.0` into the dispatch form did two things:

1. **Proved a human was there.** This was its point, and it worked.
2. **Cross-checked the intent.** The guard refused to run when the typed string did not equal `packages/cli/package.json` at the selected ref.

Job 2 sounds valuable and is nearly vacuous: the only version the lane can publish is the one the checked-out tree declares, because `changeset publish` publishes what `package.json` says. Typing a *different* version never publishes that version — it aborts the run. So the cross-check catches exactly one class of mistake: a maintainer who believes main carries a version it does not. Real, but narrow — and it is fully covered by *showing* them the version instead of asking them to recite it.

Job 1 is the load-bearing one, and typing is not what made it work. **The `workflow_dispatch` event** is what made it work: no push, no merge-queue landing, no bot token, no schedule can synthesise it.

### Why the maintainer asked for this

Verbatim, 2026-08-20:

> **release workflow 我觉得,合并 changeset 后,发版本前只需要有人工批准就可以,没必要现在这样一定需要我去手工输入版本号。**

The observation behind it: by the time the **Version Packages** PR is merged, the decision to release has *already been taken by a human* — that merge is not bookkeeping, it is the act of saying "ship this set of changesets at this version." Prime Directive #15 already reserved that merge to the maintainer for exactly this reason. Asking the same person to then go find the version number and retype it is a second confirmation of a decision they already made, and it is the step that made a release feel like a chore.

### What the version number is *not*

Worth stating because #10146 turned on it: the version in the failing run's log was **17.5.0**, which is `@object-ui/console@17.5.0` — the vendored objectui build. This repo was publishing **17.1.0**. A maintainer retyping a version read off a release log had a live chance of typing the wrong one and stopping their own release. The approval screen naming the version, computed from the object database at `github.sha`, removes that failure mode rather than relying on care.

## Decision

### D1 — The release is triggered by the push that lands the Version Packages PR, not by a dispatch

`release.yml`'s publish job runs on `push: branches: [main]`, gated on a single predicate computed by the existing `release-integrity` audit: **main's `@objectstack/cli` version is not on npm**. That is true only just after a version PR merges, and false on all ~18 other daily landings, so no ordinary merge queues a deployment.

The predicate is computed the hardened way #6170 established and this record does not relax: the version is read from the **object database at `github.sha`**, never off disk, with the tripwire that fails the run if the checked-out workspace disagrees. That tripwire is the assertion the 2026-08-03 `recover-publish` step lacked when it shipped rc.3 off a re-versioned tree.

### D2 — The human act is approving the `release` environment; the approval screen names the version

`environment: release` gates the publish job. GitHub holds the **entire job** — no checkout, no build, no `changeset publish` — until a required reviewer approves. The job's `name:` is computed from the audited version, so the approval screen reads

> Publish **17.1.0** to npm (awaiting approval)

and the reviewer confirms a version they are *shown*, computed from the commit, rather than one they recall.

### D3 — ⛔ This decision is void if the `release` environment has no required reviewers

An environment with no protection rules **passes automatically and silently**, and a run that passes it looks identical in the log to one a human approved. Under D1+D2 that is not a degraded gate, it is **no gate at all**: the push lane would publish end to end with nobody deciding — which is precisely the rc.3 / rc.4 incident (69 packages, tags, GitHub Releases, runtime image; twice in one week, no human anywhere in the trigger chain).

The maintainer confirmed on 2026-08-20 that `Settings → Environments → release → Required reviewers` is configured. **This record is conditional on that remaining true.** If the reviewers are ever removed, D1 must be reverted to a `workflow_dispatch` trigger in the same change — not left running.

⚠️ This is a repo-Settings fact and **no file in this repository can assert it**. `release.yml` cannot check it; CI cannot check it; this ADR cannot check it. It is verified by a human opening the settings page, and that is the only way it is ever verified. A future reader who needs to know whether the gate is real must go look — not grep.

### D4 — `workflow_dispatch` survives as the repair lane, with no version input

Kept for the case D1's predicate cannot see: a publish that died partway, having shipped `@objectstack/cli` but not every package in the fixed group. There the canary is on npm, D1's predicate is false, and the push lane will not re-run. Dispatch takes no `version` — it audits the same way the push lane does — plus one boolean `force`, dispatch-only by construction, that bypasses the pending-check for exactly that repair. The environment approval applies to the dispatch lane identically, so `force` widens what may be *attempted*, never what may be published unattended.

### D5 — Per-job concurrency, so a waiting approval cannot starve the bookkeeping lane

The workflow-level concurrency group is removed and replaced with per-job groups.

Why it must change: a job waiting on an approval keeps its run **in progress**. Under one workflow-level group, every later push run queues behind it as *pending*, and GitHub keeps at most **one** pending run per group — so a maintainer who takes an hour to approve would have the intervening main pushes evict each other, and the Version Packages PR would stop being regenerated for the duration. The old group was keyed on `github.event_name`, which separated the lanes only while the lanes *were* different events. D1 makes them the same event, so the key stops separating anything.

Per-job groups restore the property the old comment was protecting — "the two lanes can never displace each other" — now that the event name no longer carries it.

### D6 — What an AI seat may still not do is unchanged, and one item is added

Prime Directive #15's prohibitions stand as written. This record adds the new act to the list: ⛔ **approving the `release` environment deployment**. It is now the release act, and it is reserved exactly as `workflow_dispatch` was.

Note the shape of what D1 does to the existing prohibition on merging the Version Packages PR: that merge is no longer *adjacent* to the release, it **is** the release trigger. The prohibition does not change, but its cost of violation rises from "a version number moved on main" to "a deployment is queued in the maintainer's name." It is now the single most load-bearing line in #15.

## Consequences

**Good.** The release becomes: merge the Version Packages PR, then click Approve on a screen that tells you what you are approving. Two acts, both already the maintainer's, neither requiring a value to be recalled or transcribed. The approval is recorded in the run's deployment history with an actor and a timestamp — a stronger audit trail than a typed string, which records only that *something* typed it.

**Bad, and accepted.** The barrier moves from a property of the *event* (unforgeable by construction — a push cannot become a dispatch) to a property of *repo settings* (true today, unverifiable from here, removable by anyone with admin). Prime Directive #15 already made this observation about the previous design's environment gate and concluded "the YAML stops the machine; this directive is the part that stops you." After this record the YAML stops less, so the directive carries more. D3 is the mitigation and it is a procedural one.

**Neutral.** A dispatched release and a merge-triggered one now converge on one predicate and one guard, so there is one code path to reason about rather than two.

## Alternatives considered

**Keep `workflow_dispatch`, drop only the `version` input.** Strictly safer — the unforgeable-event property survives intact — and it removes the typing the maintainer objected to. Rejected because it keeps the second confirmation the maintainer identified as redundant: they have already said "ship it" by merging the version PR, and this would still make them go and click Run workflow to say it again.

**Publish automatically on the version-PR merge, no approval.** Rejected without discussion: it is the rc.3 / rc.4 incident by design rather than by accident, and it contradicts the 2026-08-07 ruling rather than re-implementing it.

**Split the build out of the gated job so the approval comes last.** Would let CI build while the maintainer decides, cutting the wall-clock after approval. Rejected for now: it puts a full release build *before* the human act, which is the shape that trained everyone to treat a running release job as normal. Approval-first means nothing at all moves until a human moves it, and ~10 minutes of build after the click is a price worth paying for that.
