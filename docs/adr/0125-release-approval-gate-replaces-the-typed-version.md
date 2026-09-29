# ADR-0125: The human act that authorises a release is the environment approval, not a typed version string

**Status**: Accepted (2026-08-20) — accepted by the merge that landed it on `main` ([#10150](https://github.com/objectstack-ai/objectstack/pull/10150), commit `81d1fa11d`), which is itself the acceptance act for a governed surface (Prime Directive #14). Implementation shipped in the same PR: `.github/workflows/release.yml`. · **Amended** (2026-09-29, [#20613](https://github.com/objectstack-ai/objectstack/issues/20613) — accepted by the merge that lands it. **D1's premise did not hold**: "not on npm" stayed true from the version-PR merge until the publish *finished*, so every landing in between queued its own publish of its own head, and 17.5.0 shipped eight PRs past its version commit. The predicate is now "this push carries the version commit", the publish job builds that commit, and a push-lane prompt for a version already on npm is cancelled. The decision itself — merging the Version Packages PR decides, approving `release` authorises — is unchanged; see **"Amendment (2026-09-29, #20613): the push that carries the version commit, and only that commit"** at the end.)
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

> **⚠️ Amended 2026-09-29 ([#20613](https://github.com/objectstack-ai/objectstack/issues/20613)).** "True only just after a version PR merges, and false on all ~18 other daily landings" was wrong: the predicate stays true until the publish finishes, so every landing in that window queued a publish of its own `github.sha`. The predicate and the commit the publish job builds are replaced by D1′ and D1″ in the amendment at the end; the text above is kept as the record of what was decided.

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

> **⚠️ Amended 2026-09-29 ([#20613](https://github.com/objectstack-ai/objectstack/issues/20613)).** The same eviction applies to the publish job's own group, and D5 did not consider it: the job holding the group waits at the environment while holding it, and every later publish job pends behind it, evicting the one before. See the amendment at the end.

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

## Amendment (2026-09-29, #20613): the push that carries the version commit, and only that commit

**Status of this amendment**: proposed in the PR that implements it, [#20613](https://github.com/objectstack-ai/objectstack/issues/20613); accepted by the merge that lands it, which is the acceptance act for a governed surface (Prime Directive #14). **Change**: D1's predicate, and the commit the publish job builds. D2's approval act, D3's condition, D4's repair lane and D6's prohibitions stand as written. This is a correction of the record, not a reversal: the decision — merging the Version Packages PR decides, approving `release` authorises — is unchanged. What was false is the premise that made D1's predicate implement it.

### What was wrong

D1 said "main's `@objectstack/cli` version is not on npm" is "true only just after a version PR merges, and false on all ~18 other daily landings". It is true from the version-PR merge until the publish **finishes**: through the approval wait and the ~30-minute publish after it. Every landing in that window ran `release-integrity`, found the version absent, and queued its own `Publish <version> to npm` job, and every one of those jobs checked out `github.sha` of **its own** push.

Measured on the 17.5.0 release (2026-09-29, times UTC, read from the Actions API):

| Release run | pushed head | its publish job |
|:--|:--|:--|
| 36533007563 | `3a89d459` — a merge-queue batch carrying the version commit `8c87d26a` and four PRs | queued 06:48:38, evicted 06:52:43 |
| 36533376091 | `7001918e` | queued 06:52:42, evicted 06:58:41 |
| 36533921490 | `c96beb27` | queued 06:58:40, evicted 07:12:45 |
| 36535264066 | `ba4648da` | queued 07:12:44, evicted 07:21:13 |
| 36536081716 | `0f6dcac5` | queued 07:21:13, approved and started 07:40:26 — **shipped 17.5.0** |

`git log --first-parent 8c87d26a..0f6dcac5` lists eight PRs, one of them `feat(spec)!`. They ship inside 17.5.0 while their changesets stay unconsumed in `.changeset/`, so the 17.5.0 CHANGELOG omits them and the next version will announce them as new. The Version Packages PR decided one tree and the approval shipped another. D2's "the reviewer confirms a version they are *shown*" could not catch it: the version on the screen was right, the tree behind it was not.

### The concurrency mechanics, measured rather than assumed

D5 reasoned about eviction for the bookkeeping lane. The publish job's own group, `release-publish-<ref>`, behaves like this on the runs above:

- the job that takes the group then waits at the `release` environment **while holding it**;
- every later publish job pends behind it, and each new one evicts the pending one before it — at the second it is created.

Two consequences. While every landing queued a publish, the prompt moved under the maintainer, and whichever job was pending last is the one that shipped. And a prompt left waiting after its version shipped **holds the group and hides the next real prompt**: the 17.4.0 prompt of run 34308599522 waited from 2026-09-09 to 2026-09-29, was the only visible prompt while 17.5.0's jobs pended behind it, and was approved by mistake in place of 17.5.0 (it was cancelled during Build at 07:39:36 and published nothing; 36536081716 then took the group and was approved at 07:40:26). 17.5.0 left another of the same shape: run 36539819278's `Publish 17.5.0` job took the group at 08:11:15 and began waiting, after `@objectstack/cli@17.5.0` had reached npm at 07:58:57.

### What changes

**D1′ — the predicate.** The *version commit* is the newest commit on main's first-parent chain at which `packages/cli/package.json`'s version differs from its first parent's: the landing that brought main to the version it carries. On a push, a publish is pending exactly when **this push carries the version commit** — it is not an ancestor of `github.event.before` — **and** that version is absent from npm. A later landing carries no version commit, so it queues nothing and evicts nothing. A push whose range cannot be read (a branch creation, a force-push) queues nothing and says why; the repair dispatch covers it. The repair dispatch (D4) keeps "absent from npm" alone, because it is one human act and not one per landing.

**D1″ — the commit that is built.** The publish job checks out the version commit, never `github.sha`. Its guard asserts that the checkout is the selected commit, that the commit is on `main` as fetched after the approval, and that its parent carries a different version; the #6170 tripwire (object database against workspace) now runs against the version commit. The tags `changeset publish` creates therefore point at it.

**D2, re-grounded.** The approval screen still names the version. What the approval *does* is now the thing D2 promised: it publishes the tree the Version Packages PR decided — the version commit — and nothing that landed after it, however long the approval takes.

**D5, extended to the publish group.** With one publish job per version the group holds one job and nothing evicts it. A **push-lane** prompt still waiting for a version that is already on npm is **cancelled** by a push-lane job holding `actions: write` — never by `cancel-in-progress`, and never a job that has started: GitHub holds the whole job at the environment, so a waiting job has run no step. Dispatch runs are never cancelled: a dispatch is a human's own act, and the D4 `force` repair waits, by design, for a version whose CLI is already on npm. Rejecting instead was considered and is not available to a workflow: the pending-deployment review answers only a required reviewer of the environment, which the workflow token is not and must not become. As a second line, a prompt approved after its version shipped refuses in its own guard and publishes nothing.

### What does not change

- Merging the Version Packages PR is the decision to release, and approving `release` is the authorisation (D2). Nothing in this amendment approves anything, and D6 stands.
- D3: this record is void if the `release` environment has no required reviewers.
- D4: the repair lane and its `force` input.
- Not decided here: what to do about 17.5.0 as published — annotating its notes, or a follow-up release that consumes the eight changesets. That is the maintainer's call.

### Implementation

`.github/workflows/release.yml` — `release-integrity` names the `version-commit` and computes the amended `publish-pending`; `publish` checks out the version commit and guards it; the new `stale-prompts` job cancels stale push-lane prompts — and `scripts/release-pending-publish.mjs`, which holds all three decisions. Its `--self-test`, run by `lint.yml`, builds throwaway repositories for a version commit followed by two landings, a merge-queue batch, a published version, a dependency-only edit of the CLI manifest, a non-linear landing, a force-push and a shallow clone, and asserts the selected sha. Replayed against main's real 2026-09-29 pushes with npm answering "absent", it selects `8c87d26a` on the batch push `3a89d459` and queues nothing on the five pushes after it.

### Known edges, stated

- The version push's own audit can still be evicted while pending in `release-integrity`'s group — the residual race `release.yml` documents. The next landing no longer re-queues the publish by accident (that accident was the defect); the repair dispatch does, on the same version commit, and every later push's audit says in a notice that main's version is unpublished and was not queued there.
- From the checkout on, the publish job's steps are the workflow file at `github.sha` while the scripts they run are the version commit's. On the version push they are the same commit or one merge-queue batch apart; a repair dispatch can put them further apart.
