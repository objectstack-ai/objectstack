# ADR-0125: The human act that authorises a release is the environment approval, not a typed version string

**Status**: Accepted (2026-08-20) — accepted by the merge that landed it on `main` ([#10150](https://github.com/objectstack-ai/objectstack/pull/10150), commit `81d1fa11d`), which is itself the acceptance act for a governed surface (Prime Directive #14). Implementation shipped in the same PR: `.github/workflows/release.yml`. · **Amended** (2026-09-29, [#20613](https://github.com/objectstack-ai/objectstack/issues/20613) — accepted by the merge that lands it. **D1's premise did not hold**: "not on npm" stayed true from the version-PR merge until the publish *finished*, so every landing in between queued its own publish of its own head, and 17.5.0 shipped eight PRs past its version commit. The predicate is now "this push carries the version commit", the publish job builds that commit, and a push-lane prompt for a version already on npm is cancelled. The decision itself — merging the Version Packages PR decides, approving `release` authorises — is unchanged; see **"Amendment (2026-09-29, #20613): the push that carries the version commit, and only that commit"** at the end.) · **Amended** (2026-11-05, [#29466](https://github.com/objectstack-ai/objectstack/issues/29466) letter B, ruling record [`6663894403`](https://github.com/objectstack-ai/objectstack/issues/29466#issuecomment-6663894403); drafted on [#30590](https://github.com/objectstack-ai/objectstack/issues/30590), accepted by the merge that lands it — **a second publish path is admitted beside D1**: a dispatch-only, maintainer-approved `next` snapshot cut from `main`, proposed daily, held at `environment: release` exactly as the stable publish is, publishing under the `next` dist-tag alone, debuting no package, pushing no tag, cutting no Release, never touching the Version Packages PR and ⛔ never moving `latest`. The stable release is unchanged, and D1 now reads "the version commit is the only **stable** publish". See **"Amendment (2026-11-05, #29466): a maintainer-approved `next` snapshot lane beside D1"** at the end.) · **Amended** (2026-11-06, [#30832](https://github.com/objectstack-ai/objectstack/issues/30832), the [#29466](https://github.com/objectstack-ai/objectstack/issues/29466) follow-up, ruling record [`6677910954`](https://github.com/objectstack-ai/objectstack/issues/29466#issuecomment-6677910954); drafted on [#30832](https://github.com/objectstack-ai/objectstack/issues/30832), accepted by the merge that lands it — **the daily proposal is a `schedule` trigger**: once a day a scheduled run starts the snapshot lane's preflight, exactly the dispatch preflight, and on a pass the snapshot job waits at `environment: release` for the maintainer's approval as before; a run nobody approves is the system working and the next day's run supersedes it; the stable prompt sweep is untouched. The one sentence of the 2026-11-05 amendment that forbade a `schedule` start is replaced, everything else in it stands, and option B — a daily publish with no approval — was not chosen. See **"Amendment (2026-11-06, #30832): the daily proposal is a scheduled start of the snapshot preflight"** at the end.)
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

> **⚠️ Amended 2026-11-05 ([#29466](https://github.com/objectstack-ai/objectstack/issues/29466), ruling record `6663894403`).** The version commit is now the only **stable** publish — the only path that writes `latest`. A second, dispatch-only publish path is admitted beside this decision: a `next` snapshot cut from `main`, held at the same `release` environment, publishing under the `next` dist-tag alone and debuting no package. It never consults or alters this decision's predicate, and a snapshot dispatch runs none of this lane's publishing jobs. The text above is unchanged; see **"Amendment (2026-11-05, #29466): a maintainer-approved `next` snapshot lane beside D1"** at the end.

> **⚠️ Amended 2026-11-06 ([#30832](https://github.com/objectstack-ai/objectstack/issues/30832), ruling record `6677910954`).** "Dispatch-only" in the callout above is no longer the whole of it: the snapshot lane's preflight is also started once a day by a `schedule` trigger, and the snapshot behind it still waits for the `release` approval. This decision is unchanged — the version commit is still the only stable publish, and no scheduled run reaches this lane's publish job. See **"Amendment (2026-11-06, #30832): the daily proposal is a scheduled start of the snapshot preflight"** at the end.

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

> **⚠️ Amended 2026-11-05 ([#29466](https://github.com/objectstack-ai/objectstack/issues/29466), ruling record `6663894403`).** `workflow_dispatch` now carries two human acts: the repair lane this decision describes, unchanged — `force` keeps its one meaning and never reaches a snapshot — and the `next` snapshot lane, which runs on no other dispatch and runs none of this lane's publishing jobs. The text above is unchanged; see the amendment at the end.

> **⚠️ Amended 2026-11-06 ([#30832](https://github.com/objectstack-ai/objectstack/issues/30832), ruling record `6677910954`).** The snapshot lane now has a second start beside the dispatch — a daily `schedule`, which starts its preflight alone and reaches none of this decision's lanes: a scheduled run never starts the repair lane, and `force` still never reaches a snapshot. The text above is unchanged; see the 2026-11-06 amendment at the end.

### D5 — Per-job concurrency, so a waiting approval cannot starve the bookkeeping lane

The workflow-level concurrency group is removed and replaced with per-job groups.

Why it must change: a job waiting on an approval keeps its run **in progress**. Under one workflow-level group, every later push run queues behind it as *pending*, and GitHub keeps at most **one** pending run per group — so a maintainer who takes an hour to approve would have the intervening main pushes evict each other, and the Version Packages PR would stop being regenerated for the duration. The old group was keyed on `github.event_name`, which separated the lanes only while the lanes *were* different events. D1 makes them the same event, so the key stops separating anything.

Per-job groups restore the property the old comment was protecting — "the two lanes can never displace each other" — now that the event name no longer carries it.

> **⚠️ Amended 2026-09-29 ([#20613](https://github.com/objectstack-ai/objectstack/issues/20613)).** The same eviction applies to the publish job's own group, and D5 did not consider it: the job holding the group waits at the environment while holding it, and every later publish job pends behind it, evicting the one before. See the amendment at the end.

> **⚠️ Amended 2026-11-06 ([#30832](https://github.com/objectstack-ai/objectstack/issues/30832), ruling record `6677910954`).** The same holding now meets a daily newcomer in the snapshot lane's own group: a scheduled proposal nobody approved holds that group when the next day's arrives. The ruling's answer is that the next day's run supersedes it, which the lane reads narrowly — only an older **scheduled** proposal still waiting at the environment is cancelled, never a job that has started, never a dispatch, never a stable prompt. The stable publish group, `stale-prompts` and the text above are unchanged; see the 2026-11-06 amendment at the end.

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

## Amendment (2026-11-05, #29466): a maintainer-approved `next` snapshot lane beside D1

**Status of this amendment**: ruled on [#29466](https://github.com/objectstack-ai/objectstack/issues/29466), letter B — maintainer 「29029  29425 29918 30461 29466 同意」 (2026-11-05T16:47:09Z), recorded as ruling record [`6663894403`](https://github.com/objectstack-ai/objectstack/issues/29466#issuecomment-6663894403); drafted on [#30590](https://github.com/objectstack-ai/objectstack/issues/30590), the first of the two Tier H PRs the ruling names; accepted by the merge that lands it, which is the acceptance act for a governed surface (Prime Directive #14). **Change**: a second publish path is admitted beside D1 — a `next` snapshot cut from `main`. **Not changed**: D1 as amended on 2026-09-29, D2's approval act, D3's condition, D4's repair lane, D5's groups and D6's prohibitions all stand as written, and so does the 2026-09-29 amendment. This is an addition to the record, not a reversal and not a correction: nothing the stable release does, and nothing it may not do, moves. The ruling's lines are binding and are not re-argued here; the workflow that implements the lane is the second PR, [#30591](https://github.com/objectstack-ai/objectstack/issues/30591), and this record states what that lane must satisfy without writing its text.

### Why

The stable release is QA-gated and, under D1, carries whatever the Version Packages PR had accumulated when the maintainer merged it. Measured on the ruling card: about 1,700 PRs merge a week; 18.3.0 published 2026-11-03T15:16Z, seven days after 18.2.0 (2026-10-27T06:20Z); 214 changesets were pending on `main` at `b17dbcf2` when the ruling was written. An app repository whose fix has landed on `main` waits for the next sweep to install it. The ruling weighed three options and took B. **A** — a fixed stable cadence, with the QA checklist run continuously on `main` — was not taken: it trades the delta's size for a cadence and still chooses between speed and the full sweep. **C** — keep today's process — was not taken: the delta keeps growing with the merge rate. B keeps the stable channel exactly as it is and adds an installable pre-release channel beside it.

The maintainer's three questions were answered before the letter, and the answers are part of what binds: every publish stays the maintainer's own act (Prime Directive #15), each snapshot included; the stable channel is unchanged and the `next` channel is added on top; and today's `release.yml` does not support it — its only publish paths are the version-commit push and the repair dispatch, and D1 publishes the version commit only. That last answer is why this amendment exists: until the record admits a second publish path, the lane cannot be built.

Precedent for the channel, none for the mechanism: the `next` dist-tag carried 18.0.0-next.0 through next.5 under Changesets pre mode, exited by #24528; this repository has never published a snapshot. The registry, read again at 2026-11-05T22:53Z while this amendment was drafted: `next` resolves to 18.2.0 — a stable version, which the stable lane's post-publish dist-tag step leaves alone by its own rule — while `latest` is 18.3.0.

### What the ruling binds

Each line below is one bound line of ruling record `6663894403`, restated as the sentence this record now carries.

1. **The stable release is unchanged.** The QA sweep, the Version Packages PR, the maintainer's approval at `environment: release` and the publish to the `latest` dist-tag are exactly what D1 (as amended), D2 and D3 describe. Nothing in this amendment touches that path.
2. **A second publish path is added: a `next` snapshot of `main`, maintainer-approved, proposed daily, dispatch-only.** The lane runs on `workflow_dispatch` alone — a human act, since Prime Directive #15 reserves dispatching `release.yml` from every seat, the fleet-write relay's refresh stroke excepted — and publishes only after the maintainer approves its `release` deployment. "Proposed daily" is a cadence of proposals to the maintainer, not a trigger: no `schedule` and no `push` can start it.

   > **⚠️ Amended 2026-11-06 ([#30832](https://github.com/objectstack-ai/objectstack/issues/30832), ruling record `6677910954`).** The last sentence is replaced: the daily proposal **is** a `schedule` trigger of the lane's preflight, and "dispatch-only" now reads "by dispatch or by the daily schedule, exclusive on both". `push` still cannot start it, and the approval is still the only publish act. The text above is kept as the record of what was decided on 2026-11-05; see **"Amendment (2026-11-06, #30832): the daily proposal is a scheduled start of the snapshot preflight"** at the end.

3. **It requires the full battery green at that commit.** The commit a snapshot is cut from is one the full battery has itself passed on — the head commit of the newest green full-battery run on `main`, not a later landing the battery has not seen. A snapshot of any other commit is refused before any deployment is queued, so no approval prompt ever appears for a tree the battery has not passed.
4. **It versions in the workspace only and publishes under `next`.** The lane runs `changeset version --snapshot next` against its checkout and never commits what that writes, then `changeset publish --tag next --no-git-tag`. The snapshot version exists on npm and nowhere in git.
5. **It is held at `environment: release`, like the stable publish.** GitHub holds the whole snapshot job until a required reviewer approves, so every snapshot stays the maintainer's own act (AGENTS.md Prime Directive #15). D2 and D3 apply to it unchanged.
6. **It pushes no tag, creates no GitHub Release, never touches the Version Packages PR, and ⛔ never moves `latest`.** The stable lane's post-publish acts — the atomic tag push, the GitHub Releases, the ADR-0087 D4 asset, the dist-tag move up to `latest` — belong to a stable publish and do not run for a snapshot. And a package's **first** publish takes `latest` whatever dist-tag the client sends — the registry's rule, and the one changesets' own pre mode is built on — so a snapshot never debuts a package: a member of the fixed group with no version on npm is refused before any deployment is queued, and the stable lane debuts it (the requirement below).
7. **App repositories pin `next` when they need a fix now.** `latest` users see no change; a consumer that wants a fix the day it lands opts into the snapshot channel by pinning it. Between a stable release and the snapshot that follows it, `next` resolves to the stable version: at each stable publish the stable lane's dist-tag step moves `next` up to the new stable, because a snapshot version is a pre-release below every stable — intended since #25581, and consistent with "never moves `latest`".
8. **A trial of two weeks, then the director reports usage on #29466.** Where the trial starts is this record's reading, not the ruling's: at the first snapshot the lane publishes, as the seat's note on #29466 (comment 6664069140) sets the card's restart condition. The report is the director's, on the ruling card.

### How D1 to D6 read with it

- **D1 (as amended 2026-09-29) — the version commit is the only *stable* publish.** D1′ and D1″ are untouched: the push that carries the version commit is the one push that queues a stable publish, the publish job builds that commit, and a later landing queues nothing. What changes is one word in how D1 is read. Before this amendment the version commit was the only publish; now it is the only **stable** publish — the only path that writes `latest`. The snapshot lane publishes no stable version, never consults D1′'s `publish-pending`, never alters it, and cannot queue D1's publish job — the exclusivity requirement below is what makes that last clause hold. It is a second publish path under its own dist-tag, not a second trigger of the first.
- **D2 and D3 — the environment gate.** D2's approval act gates the snapshot job identically: `environment: release` holds the entire job — no checkout, no build, no `changeset version`, no `changeset publish` — until a required reviewer approves, and the approval screen names what is being approved — a `next` snapshot, and the `main` commit it is cut from — so the maintainer confirms a thing they are shown rather than one they recall. D3's condition covers the lane: if the `release` environment ever has no required reviewers, the snapshot lane is as void as the push lane — the dispatch is one human act, and without the approval nobody has authorised the publish (D2). What then becomes of a dispatch-only lane is this record's reading, not the ruling's: it is removed in the same change that reverts D1 to a dispatch trigger, because the `workflow_dispatch` event alone is no longer the barrier it was before the fleet-write relay's refresh stroke could dispatch `release.yml` (Prime Directive #15), so the event cannot stand in for the approval.
- **D4 — dispatch survives as the repair lane.** D4 stands, `force` included. The snapshot is a second use of the `workflow_dispatch` event, not a change to the repair: a dispatch that does not ask for a snapshot runs exactly as today, and a dispatch that asks for one runs none of the stable lane's jobs (the exclusivity requirement below); `force` keeps its one meaning — finish a partially published *stable* version — and never reaches the snapshot lane; the snapshot lane never reads `force`. Both are human acts on one event, and both wait at the same environment.
- **D5 — per-job concurrency.** D5's property — the lanes never displace each other — now has a third lane to hold for. A snapshot job waiting at the environment holds its group while it waits, and the eviction the 2026-09-29 amendment measured applies to it: a waiting snapshot neither displaces a stable publish nor is displaced by one. The group spelling is the lane's; the property is this record's.
- **D6 — what an AI seat may still not do.** D6 stands and gains nothing, because both acts the lane adds are already on its list and on Prime Directive #15's: dispatching `release.yml` in any lane but the relay's refresh stroke, and approving a `release` environment deployment. A snapshot's approval is that act under another dist-tag.

### What the lane must satisfy — requirements on #30591, not workflow text

The ruling fixes what the lane does; the workflow that does it is [#30591](https://github.com/objectstack-ai/objectstack/issues/30591)'s, and this record does not write it. What #30591 owes this record:

- **The guard, and the debut rule.** Any publish from the snapshot lane that would carry a dist-tag other than `next` fails the job before anything reaches the registry. And the lane never debuts a package: a member of the fixed group with no version on npm is refused before any deployment is queued, because a package's first publish takes `latest` whatever tag the client sends, and the guard cannot see it — that publish *does* carry `next`. The stable lane debuts packages. With both, bound line 6's ⛔ is executable: `latest` is written by the stable lane and by nothing else. The case is live, not hypothetical: `@objectstack/service-push` is in the fixed group at 18.2.0 in the tree and has never been published, so the first snapshot cut from today's `main` would be its first publish.
- **Dispatch-only, and exclusive.** The snapshot's publish job is reachable from `workflow_dispatch` alone — never from `push`, which is D1's event, and never from `schedule`, which `release.yml` already refuses as a publishing trigger because a scheduled run is queued rather than guaranteed and is disabled by inactivity. A dispatch that does not ask for a snapshot behaves exactly as today. A dispatch that asks for one runs none of the stable lane's publishing jobs — `release-integrity`, the stable `full-battery` gate and `publish` read the snapshot input exactly as they read `refresh_version_pr` today, strictly subtractive — and the snapshot job runs on no other dispatch. The hazard this closes: today every non-refresh dispatch runs the stable audit and, while `main`'s version is absent from npm, queues a stable publish prompt; a snapshot dispatched between a Version Packages merge and its approval would queue a second such prompt in the publish group, which `stale-prompts` never cancels (a dispatch is a human's act), so after the push-lane prompt ships it would hold the group and hide the next real prompt — the 17.4.0 shape the 2026-09-29 amendment measured, this time beyond the sweep's reach.

  > **⚠️ Amended 2026-11-06 ([#30832](https://github.com/objectstack-ai/objectstack/issues/30832), ruling record `6677910954`).** "Dispatch-only" is replaced by "two starts, exclusive on both": the preflight is also started by a daily `schedule`, on its own cron, and on that cron no stable job runs. The reason `schedule` was refused as a *publishing* trigger — queued, not guaranteed, disabled by inactivity — still holds and is not contradicted: the schedule starts a preflight, and the publish behind it waits for the approval. The exclusivity requirement, and the hazard it closes, are unchanged. See the 2026-11-06 amendment at the end.

- **The commit.** The lane snapshots the head commit of the newest green full-battery run on `main`. The reader is `scripts/ci/scheduled-full-run.mjs --release-gate`, which `release.yml`'s `full-battery` job already runs and which reports how many first-parent commits lie between the commit asked about and the run that answers; the lane requires that distance to be zero, so "green at that commit" holds literally, and refuses before any deployment is queued when it is not.
- **Not during a major's RC cycle.** While `.changeset/pre.json` says `mode: pre`, the lane refuses before any deployment is queued: under ADR-0087 a major is published to `next` for at least one RC cycle before it goes `latest`, so the cycle owns the channel, and changesets itself refuses both `changeset version --snapshot` and `changeset publish --tag` in pre mode — an approval granted then would fail after the click and publish nothing. `next` thereby gains a second publisher and a second version shape, so the release-channels table in `docs/releases-maintenance.md` is a consumer #30591 updates.
- **Workspace only.** The lane runs the bare `changeset version --snapshot next`, never `pnpm run version`, whose chain aborts at `sync-protocol-version.mjs` on a major below 1. What it writes — the bumped manifests, and also the changeset files it consumes and the `CHANGELOG.md` entries it renders in the checkout — is never committed, pushed, tagged or carried into the Version Packages PR; `changeset publish --tag next --no-git-tag` creates no tag; no Release is created; no dist-tag but `next` is written.
- **The approval screen.** The job's name says it is a `next` snapshot and names the `main` commit it is cut from — D2's rule, the reviewer confirms what they are shown. It must not match the stable prompt's shape, which `scripts/release-pending-publish.mjs` reads as the word `Publish`, one token, then `to npm (awaiting approval)`: a snapshot prompt that matched would be read as a stable prompt.
- **The dry run.** Before the first real snapshot, a dry run shows that `changeset version --snapshot next` versions the whole fixed group (`.changeset/config.json`: 109 names at this writing — the ruling's 69 is the rc.3 / rc.4 count) and that the manifests as published carry concrete versions where the workspace has `workspace:*` ranges. Changesets does not rewrite `workspace:*`, `^` or `~` ranges; `pnpm publish` substitutes them at pack time, so the dry run reads packed manifests, not the workspace's `package.json` files. Its output is recorded on #30591.

### What stays forbidden

Prime Directive #15 and D6, in this lane's words:

- ⛔ No AI seat dispatches the snapshot lane or approves its `release` deployment. A daily proposal is a reminder to a human, and a deployment waiting for a day is the system working, not a state to clear.
- ⛔ No seat runs `changeset version --snapshot` against a tree it then commits or pushes, and none runs `changeset publish` under any dist-tag, `next` included — "release-adjacent work stays open" does not reach the publish act under another tag.
- ⛔ A snapshot never writes `latest`, never pushes a tag, never cuts a Release, never touches the Version Packages PR and never lands a version bump on `main`.
- ⛔ The snapshot lane is never reachable from `push` or `schedule`, and no input of the repair lane — `force`, `refresh_version_pr` — widens it; a snapshot dispatch runs none of the stable lane's publishing jobs.

  > **⚠️ Amended 2026-11-06 ([#30832](https://github.com/objectstack-ai/objectstack/issues/30832), ruling record `6677910954`).** "or `schedule`" is replaced: the lane is reachable from `schedule` on its own daily cron alone, which starts the preflight and no stable job. `push` and the repair lane's inputs stand as written. See the 2026-11-06 amendment at the end.

- ⛔ A snapshot never debuts a package, and none is cut while `.changeset/pre.json` says `mode: pre`.
- ⛔ A snapshot that appeared with no human dispatch and no human approval behind it is an incident for the maintainer, never repaired with a counter-publish (Prime Directive #15).

### What does not change

- Merging the Version Packages PR is the decision to release, and approving `release` is the authorisation (D2). Nothing in this amendment approves anything, and D6 stands.
- D3: this record is void if the `release` environment has no required reviewers — the snapshot lane included.
- D4: the repair lane and its `force` input.
- The 2026-09-29 amendment: D1′, D1″, the `stale-prompts` job and `scripts/release-pending-publish.mjs` are untouched.
- Not decided here: whether a snapshot builds the runtime image (the ruling names npm alone); the form the daily proposal takes; and what becomes of the `next` channel when the trial ends — the director's report on #29466 is the input to that call, and the call is the maintainer's.

  > **⚠️ Amended 2026-11-06 ([#30832](https://github.com/objectstack-ai/objectstack/issues/30832), ruling record `6677910954`).** The form the daily proposal takes is now decided: a `schedule` trigger that starts the preflight once a day and stops at the approval. The other two items stay open.

## Amendment (2026-11-06, #30832): the daily proposal is a scheduled start of the snapshot preflight

**Status of this amendment**: ruled as the follow-up to [#29466](https://github.com/objectstack-ai/objectstack/issues/29466) — the maintainer chose option A on a decision card in the project thread at 2026-11-06T05:41Z; the card asked 「next 快照要不要改成每天定时发？」 and offered (A) 每天定时预检，停在批准, (B) 每天全自动发布, (C) 先手动试用两周再定 — recorded as ruling record [`6677910954`](https://github.com/objectstack-ai/objectstack/issues/29466#issuecomment-6677910954) (2026-11-06T05:42Z); drafted on [#30832](https://github.com/objectstack-ai/objectstack/issues/30832), the Tier H PR that carries this amendment and the `release.yml` trigger together, as the 2026-09-29 amendment shipped with its implementation; accepted by the merge that lands it, which is the acceptance act for a governed surface (Prime Directive #14). **Change**: one sentence of the 2026-11-05 amendment and the two requirement lines that restate it — the daily proposal is a `schedule` trigger of the snapshot lane's preflight, not only a cadence of human dispatches. **Not changed**: D1 as amended on 2026-09-29, D2's approval act, D3's condition, D4's repair lane, D5's groups and D6's prohibitions all stand as written, and so do the 2026-09-29 amendment and everything else in the 2026-11-05 amendment. Option B — a daily publish with no approval — was not chosen. This is a change of one mechanism in the record, not a reversal: the publish act is still the maintainer's approval, and nothing publishes without it. The ruling's lines are binding and are not re-argued here.

### Why

The 2026-11-05 amendment admitted the snapshot lane and read "proposed daily" as a cadence of proposals a human makes by dispatch. The maintainer's reason for the follow-up: `main` lands about a hundred PRs a day, so every day has something an app repository could install, and a lane that waits for a human to dispatch it leaves the human two acts where only one is a decision — the proposal is mechanical, the approval is not. With a scheduled start the one human act left is the one that matters, the approval at `environment: release`.

### What it replaces

Three sentences of the 2026-11-05 amendment, each kept above as the record of what was decided then and each now carrying a dated pointer:

- Bound line 2's last sentence — *"Proposed daily" is a cadence of proposals to the maintainer, not a trigger: no `schedule` and no `push` can start it* — is replaced by: the daily proposal is a `schedule` trigger of the preflight; `push` still cannot start the lane.
- The requirement *Dispatch-only, and exclusive. The snapshot's publish job is reachable from `workflow_dispatch` alone — never from `push`, which is D1's event, and never from `schedule`, which `release.yml` already refuses as a publishing trigger because a scheduled run is queued rather than guaranteed and is disabled by inactivity* — is replaced by: the lane is reachable from the daily schedule and from a dispatch carrying the snapshot input, exclusive on both. The reason `schedule` was refused as a *publishing* trigger still holds and is not contradicted, because the schedule starts a preflight and the publish behind it waits for the approval: a proposal that arrives late or not at all costs a day's reminder, never a publish.
- The ⛔ *The snapshot lane is never reachable from `push` or `schedule`* — is replaced by: never reachable from `push`; reachable from `schedule` on its own cron alone, which starts no stable job.

Bound line 2's reading of Prime Directive #15 is untouched: the daily start is the lane's own clock, not a seat's dispatch, and no seat dispatches the lane or approves its deployment.

### What the ruling binds

Each line below is one bound line of ruling record `6677910954`, restated as the sentence this record now carries.

1. **A `schedule` trigger starts the snapshot lane's preflight once a day, and it is exactly the dispatch preflight.** The same job, the same steps, the same refusals: the commit at distance zero, the RC-cycle read at that commit and at `main`'s tip, the debut rule, the dry run. A scheduled run checks out `main` as the dispatch does, because `schedule` runs on the default branch alone. Nothing is special-cased on the event but what the run's summary says about who started it.
2. **On a pass the snapshot job waits at `environment: release` and publishes only on the maintainer's approval.** D2 and D3 apply unchanged; the approval stays a human act. ⛔ Prime Directive #15 is unchanged: no seat dispatches the lane or approves its deployment, and the daily clock is not a seat.
3. **A run nobody approves is the system working, not a state to clear; the next day's run supersedes it; the stable prompt sweep stays untouched.** A waiting proposal is not swept and is not an error. "Supersedes" is read in the lane as: once the next day's preflight has passed, the older *scheduled* proposal still waiting at the environment is cancelled, so one snapshot prompt is ever waiting and it is the newest. A proposal somebody has approved has started and is never touched; a dispatched proposal is a human's own act and is never touched; `stale-prompts` and `scripts/release-pending-publish.mjs` are untouched, and no stable prompt is ever cancelled by the snapshot lane.
4. **Everything else in the 2026-11-05 amendment stands.** `next` only, never `latest`; no debut; workspace only; no tag, no Release, no Version Packages PR touch; the full battery green at the commit; every refusal before any deployment is queued; the approval screen's shape. Option B was not chosen: there is no publish without the approval.

### How the 2026-11-05 text reads with it

- **Bound line 2 of 2026-11-05** reads "maintainer-approved, proposed daily by `schedule` or by dispatch, exclusive on both". Its reading of Prime Directive #15 — dispatching `release.yml` is reserved from every seat — is unchanged, and the schedule gives it nothing to reserve: a cron is not a seat.
- **D1 to D6 as the 2026-11-05 amendment reads them** are unchanged. D1: a scheduled run never reaches D1's publish job — the stable jobs read the snapshot's schedule as they read the snapshot input, strictly subtractive. D4: a scheduled run never starts the repair lane, and `force` never reaches a snapshot. D5: the snapshot lane's own group now meets a daily newcomer, and bound line 3 above says what happens. D6: gains nothing, for the reason the 2026-11-05 amendment gave.
- **"A daily proposal is a reminder to a human, and a deployment waiting for a day is the system working, not a state to clear"** stands word for word, and is now bound line 3's first clause.

### What the lane must satisfy — requirements on #30832, not workflow text

- **Two starts, exclusive on both.** The preflight starts on the daily schedule and on a dispatch carrying the snapshot input, and on neither does any stable job run: `release-integrity`, the stable `full-battery` gate, `publish`, `docker`, `stale-prompts` and `version-pr` are all skipped on the snapshot's schedule, by strictly subtractive edits. `release.yml` already carried a schedule for the bookkeeping refresh, so the file fires two crons on one `schedule:` and tells them apart by the cron the event carries; each scheduled job names its own, and the two clocks never start each other's jobs. A pin refuses a cron no job names, a job naming a cron the schedule does not fire, and the snapshot jobs disagreeing with each other.
- **The hour.** Chosen after the nightly full battery normally finishes, measured on recent runs and argued in the workflow, so the morning's proposal reads a battery that is green on `main`'s tip.
- **A refusal on the schedule is visible.** It is a red run with its reason in the step summary, and it is expected daily while any fixed-group member has no version on npm (`@objectstack/service-push`, at this writing) — the debut rule, bound line 6 of 2026-11-05, refusing as designed. The workflow says so where the refusal lands, so nobody "fixes" it by loosening the preflight.
- **Supersede, narrowly.** Bound line 3's mechanism cancels only an older scheduled snapshot proposal still waiting at the environment — never anything that has started, never a dispatch, never a stable prompt — and `cancel-in-progress` stays `false` on the snapshot group: a snapshot approved minutes before the next day's tick must not be cancelled mid-publish.
- **The channels table** in `docs/releases-maintenance.md` says the snapshot is proposed daily by schedule and published on approval.

### What stays forbidden

- ⛔ No AI seat dispatches the snapshot lane or approves its `release` deployment (Prime Directive #15, D6). The daily clock proposes; it approves nothing.
- ⛔ The snapshot lane is never reachable from `push`, and the schedule that starts it starts no stable job.
- ⛔ Nothing in the snapshot lane cancels a stable publish prompt; `stale-prompts` is the only sweep of those, unchanged.
- ⛔ A snapshot that appeared with no human approval behind it is an incident for the maintainer, never repaired with a counter-publish (Prime Directive #15).

### What does not change

- Merging the Version Packages PR is the decision to release, and approving `release` is the authorisation (D2). Nothing in this amendment approves anything.
- D3: this record is void if the `release` environment has no required reviewers — the scheduled snapshot included. A scheduled start with no approval behind it would be option B, which was not chosen, so the lane is removed in the same change that reverts D1 to a dispatch trigger, as the 2026-11-05 amendment already reads it.
- D4, D5's groups and D6; the 2026-09-29 amendment; and every bound line of the 2026-11-05 amendment but the sentence replaced above.
- Not decided here: whether a snapshot builds the runtime image, and what becomes of the `next` channel when the trial ends — both still the maintainer's call, as the 2026-11-05 amendment left them.

### Landing details being confirmed — this draft's reading, not the ruling's

The ruling fixes the four lines above. Five details of how the lane lands are the maintainer's to confirm, and are being confirmed in a separate thread as this is drafted. This section states the draft's reading of each, so the text that lands says what was confirmed and says it in one place; none of the five changes a bound line. (1) The hour: this draft argues 01:17Z, 09:17 Beijing, in `release.yml`. (2) Yesterday's unapproved scheduled proposal: this draft replaces it with today's (bound line 3 as read above) rather than leaving it waiting. (3) A scheduled refusal: this draft keeps it a red run with the reason in the summary rather than a quiet skip. (4) A real failure, as opposed to a refusal: this draft opens no card. (5) Documents: this draft changes this record and the one channels-table row of `docs/releases-maintenance.md` that named the lane dispatch-only, and nothing else.
