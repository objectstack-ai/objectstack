#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-governed-queue-guard — the PREVENTION half of the governed-surface
 * regime (#11704). The sibling `check-governed-merges.mjs` is the DETECTION
 * half: it enumerates governed merges AFTER they land, report-only by design.
 * This one runs on the merge-queue build and REFUSES.
 *
 *   node scripts/pm/check-governed-queue-guard.mjs             # in CI, from the event payload
 *   node scripts/pm/check-governed-queue-guard.mjs --self-test # offline, no network, no git
 *
 * ## Why a refusal exists at all, when the per-PR gate was retired
 *
 * The 2026-08-18 ruling retired `ADR maintainer approval` because it was RED
 * ON EVERY GOVERNED PR by design — 红灯常态化本身有毒, a permanently red check
 * trains everyone to ignore red — and because it sat outside the required set,
 * so it never blocked anything anyway. Detection moved to the post-merge audit.
 *
 * Three years of that regime is not what happened next; three INCIDENTS are.
 * #9550, #10580 and the #9319 landing each ended with a governed diff enqueued
 * or merged with zero reviews, and each was caught by ACCIDENT — a merge
 * conflict, a `GH006 branch locked` rejection on a concurrent push, a webhook
 * that happened to wake a live seat. The card that recorded the second one
 * (#10580) put the remaining question in one sentence, verbatim:
 *
 *   > **Guard gap.** Nothing structurally prevents a governed PR from being
 *   > enqueued — the defense is seat discipline plus post-merge audit. […]
 *   > Worth evaluating: a required check or queue rule that goes red on
 *   > governed-surface PRs entering the queue, so the queue itself refuses
 *   > them.
 *
 * ⭐ THE DESIGN THAT KEEPS THIS FROM BECOMING THE RETIRED GATE AGAIN is the
 * split by EVENT, and it is the single most load-bearing decision in this file:
 *
 *   `merge_group`   → a governed diff without an AUTHORIZED approval pinned to
 *                     the PR's current head is a REFUSAL. The queue build is
 *                     the last thing between a speculative merge and `main`,
 *                     and it is the path a SEAT uses. This is the prevention.
 *   `pull_request`  → the same finding is an EARLY WARNING that exits 0.
 *
 * The PR run must not redden, and not for politeness. A governed PR sitting as
 * a draft while it waits for an authorized approval is the CORRECT resting
 * state of the regime — 「四件套留 draft 等人批,⛔ 不翻正式不入队;获授权批准后
 * 认领席落地。」 — so a check that is red on it is red on the healthy case,
 * forever, which is precisely the poison the 2026-08-18 ruling named. The queue
 * build, by contrast, is a state an UNAPPROVED governed PR should never be in
 * at all; red there is red on the anomaly.
 *
 * ⭐ AND WHAT HAPPENS AFTER THE APPROVAL IS THIS CHECK'S OWN PASS PATH, which
 * is why the queue leg is not only a refusal. Ruling C (#17971, maintainer
 * 2026-09-13, verbatim 「C. approve 后不管后续改动都由席位落地:」) puts the
 * landing in the CLAIMING SEAT's hands once an authorized APPROVED review is on
 * record — 「席位落地 = 过落地前检、清标、ready、auto-merge,踢出/变基同法。」 — so
 * the seat's ready → enqueue is the CORRECT next act there rather than a
 * violation, and an ejection or a rebase costs no second click.
 *
 * ⚠️ The consequence is worth stating out loud rather than discovering: this
 * guard CANNOT stop a maintainer merging a governed PR directly, and does not
 * try. A direct merge produces no `merge_group` event. Under this regime that
 * is not a hole — it is the OTHER landing, the one an UNAPPROVED governed PR
 * still has: 「受管面由维护者人合或授权批准后席位落地」 (measured: #11387 was
 * read as an incident for 13 minutes on exactly this confusion, until the
 * maintainer answered 「是我合并的」). What this guard closes is the seat path
 * taken with NEITHER of those: flip ready → enqueue → the queue is the entire
 * review.
 *
 * ## What satisfies it — an AUTHORIZED approval, on ANY commit
 *
 * The predicate has four dated layers; the LATEST one is the one enforced,
 * and each earlier layer still contributes the half that was not superseded.
 *
 * #8161 ruled the original predicate — 「门禁改成只要求「APPROVED review 存在」」/
 * 「不要指定具体的人」 — because the identity proxy was then unsatisfiable:
 * human and agent GitHub accounts are not stably partitioned (「人工专属账号 和
 * agent 账户一直在切换,暂时没固定」), cloud sessions author under the
 * maintainer's own account, and GitHub forbids self-approval — so an
 * identity-keyed gate went permanently red exactly when the human WAS driving.
 *
 * 2026-08-27 NARROWED it. The maintainer asked, verbatim: 「需要我人工审查的，如果
 * 我真的审查了，并且点了批准，也不能合并吗？还是要等我 bypass吗」 — and ruled the
 * authorized set, verbatim: 「os-zhuang hotlong 批准算数」. ⭐ THAT HALF STANDS
 * as a mechanism — its MEMBERSHIP is 2026-11-17's (below), not this one's —
 * and it is this predicate's whole identity control: only an account in
 * `GOVERNED_APPROVERS` (the single source — protocol text references the
 * constant, never copies the names) can satisfy this leg. What that ruling ALSO
 * carried — that the approval's `commit_id` must equal the PR's CURRENT head
 * sha — is the half 2026-09-04 superseded.
 *
 * 2026-09-04 UNPINNED it. Said in the live PM chat while a governed PR that an
 * authorized approver had approved three times kept falling out of the merge
 * queue, verbatim and untranslated:
 *
 *   > 你的门禁有问题，只需要有人工批准记录就行，不需要卡最新的提交。
 *
 * So the queue leg passes a governed PR iff an account in `GOVERNED_APPROVERS`
 * holds a latest-decisive review that is APPROVED — on ANY commit, with
 * `commit_id` unread by the decision. This ruling supersedes the sha-pin half
 * of the 2026-08-27 predicate and NOTHING else: the approver set of that ruling
 * (「os-zhuang hotlong 批准算数」) stands — its membership since narrowed by
 * 2026-11-17 — DISMISSED and superseded approvals still never count, an unauthorized APPROVED still never counts, and an empty
 * or unreadable review list still fails closed. review → Approve → done: the
 * queue merges, and the direct merge stays the fallback path.
 *
 * ⚖️ THE ACCEPTED COST, stated out loud rather than left to be discovered: a
 * push after an approval is no longer re-reviewed by this gate — the approval
 * rides through whatever is pushed next, and this file no longer knows the
 * difference. The maintainer accepts it. It is the same shape of cost the
 * 2026-08-12 ruling on the retired per-PR gate accepted when it dropped the
 * identity proxy (「不要指定具体的人」, accepted cost: no signal can prove a
 * review is human); the institutional-memory section of
 * `check-governed-merges.mjs` carries that history.
 *
 * The head sha is still READ and still PRINTED — a queue log names the commit
 * each approval was given on, so the cost above is visible at the moment it is
 * being paid — but it DECIDES nothing. Two consequences follow and neither is
 * optional: an unreadable head is no longer a refusal (a read that decides
 * nothing may not block a landing), and ⛔ nothing may re-derive a refusal from
 * that printed reading without a new ruling.
 *
 * 2026-11-17 NARROWED THE SET. The maintainer, in the triage session (card
 * #34626), verbatim and untranslated:
 *
 *   > hotlong 从批准账户中去掉，只保留 os-zhuang
 *
 * So `GOVERNED_APPROVERS` is `os-zhuang` alone. This supersedes the MEMBERSHIP
 * of the 2026-08-27 set (「os-zhuang hotlong 批准算数」, kept above as history)
 * and nothing else: the mechanism, the any-commit reading of 2026-09-04 and the
 * 2026-10-26 enqueue leg all stand, now read against the one account. An
 * APPROVED review by `hotlong` alone no longer satisfies either leg. The reason
 * is the account rule that an approver account never runs a seat: `hotlong`
 * runs seats, so it leaves the set.
 *
 * #11704's retraction still bounds the design: attribution from the GitHub
 * actor field is not a reading, so this guard stays keyed on the DIFF'S PATHS
 * and on the review record — the one artifact that IS a deliberate, timestamped
 * human act on the pull request — never on who pushed or merged.
 *
 * The #8161 identity concern did not vanish; it moved into a NORMATIVE
 * prohibition landed with this predicate: ⛔ an agent seat never submits an
 * approving review on a governed-surface PR, under ANY account. `os-zhuang` is
 * also operated by agent seats, so with it in the authorized set the technical
 * control is normative for any agent holding those credentials — same class as
 * the seat-side no-merge rule. The Director's governed-merge audit reads the
 * APPROVER as well as the merger; an agent-submitted governed approval is an
 * incident. ⚠️ With the sha pin retired that prohibition carries more weight,
 * not less: it is now the ONLY thing standing between an agent seat holding an
 * authorized account and a governed landing it cleared for itself.
 *
 * ⚠️ An outstanding CHANGES_REQUESTED from ANOTHER reviewer does NOT flip the
 * verdict here, and that is deliberate restraint rather than an oversight: the
 * ruled predicate is one authorized APPROVED review (a reviewer's own later
 * CHANGES_REQUESTED or DISMISSED does supersede their approval), and widening
 * a governance gate past its own ruling is how gates acquire policy nobody
 * agreed to. It is printed loudly as an informational line so a reader is
 * never surprised by it. Widening it is a one-line maintainer decision.
 *
 * ## The ENQUEUE leg — the maintainer's own enqueue IS the review (2026-10-26)
 *
 * The maintainer, on the phone, where the button is "Merge when ready" (an
 * enqueue) and the queue guard then still wanted a separate Approve — verbatim
 * and untranslated (#26066):
 *
 *   > 也就是说推送到我的手机上，以前都是需要我点一下核准，然后再点合并，以后我可以直接点合并是吗
 *   > 大部分我还是希望入队，但是我想省掉 Approve
 *
 * and the logins behind that click: 「os-zhuang 或 hotlong」 — both then in
 * `GOVERNED_APPROVERS`, which stays the single source and does not grow; since
 * 2026-11-17 (「hotlong 从批准账户中去掉，只保留 os-zhuang」) only `os-zhuang`'s
 * click counts, `hotlong`'s half of that quotation being history. So the
 * `merge_group` leg passes a governed pull request iff EITHER an authorized
 * account holds a latest-decisive APPROVED review (the 2026-09-04 predicate
 * above, unchanged and read FIRST) OR the account that put this entry in the
 * queue is an authorized one. Everything else stands: an enqueue by any other
 * account still needs the approval, Tier S still lands on its record, a fork is
 * still lifted by nothing, and the bypass-rules direct merge is still the other
 * landing.
 *
 * ⭐ WHY THIS IS NOT THE ACTOR-FIELD ATTRIBUTION #11704 RETRACTED. That
 * retraction refused to read "who pushed or merged" as a review. The ruling
 * that founded this regime (2026-08-18, carried in `check-governed-merges.mjs`)
 * already named the enqueue as the record — 「人工合并即人工审核:governed PR 的审核
 * 记录 = 你按下合并/入队那个动作本身」 — and the identity concern behind the
 * retraction is answered for this leg exactly as it is for the approval leg,
 * normatively: ⛔ no agent seat enqueues or arms auto-merge on an unapproved
 * governed PR, under ANY account (AGENTS.md Prime Directive #14). An entry an
 * authorized account made can therefore only be the human's click, as an
 * authorized approval can only be the human's review. With this leg that
 * prohibition carries the same weight the approval-side one does: it is the
 * ONLY thing between an agent seat holding an authorized account and a governed
 * landing it cleared for itself, and the post-merge audit reads the enqueuer
 * the way it reads the approver.
 *
 * ⭐ THE READING, MEASURED on this repository on 2026-10-26 (REST): the actor
 * of the NEWEST `added_to_merge_queue` timeline event. "Merge when ready" with
 * checks pending ARMS auto-merge and the platform enqueues later; the add
 * event's actor is then the account that armed it (#26154, #26011). A direct
 * enqueue leaves an add event and never sets `auto_merge` (#26166). The pull
 * object's `auto_merge.enabled_by` therefore answers the first path only, is
 * null on the second and after a merge, and is not read. The timeline route
 * answers `X-Accepted-GitHub-Permissions: issues=read; pull_requests=read`, so
 * the workflow's existing `pull-requests: read` covers it.
 *
 * ⛔ UNDETERMINED IS NEVER A PASS, and never a refusal of its own: no add event,
 * an add with no actor, an unreadable or truncated timeline (the newest event is
 * on the LAST page), and a newest queue event that is a REMOVAL — the entry this
 * build judges not yet on the timeline, so the add before it is an entry that
 * already left — all leave the approval leg to decide alone, on its own exit
 * code. ⚖️ The accepted cost, stated where it is paid: as with an approval on
 * any commit, a push made after the click and before the entry lands is not
 * re-reviewed here; and the click counts for THAT entry only — a seat's
 * re-enqueue after an ejection is a new entry by a seat account, which needs
 * the approval or another such click.
 *
 * ⚖️ THE COST: one timeline read per governed pull request the approval did
 * not satisfy — never for one it did (MONOTONE, read SECOND, and a Tier S
 * record is consulted only after it). The SIZE leg follows the same predicate
 * through the sibling's lift (`sizeLiftFrom`, which reads the enqueue reading
 * handed to it beside the approval verdict); an oversized pull request the
 * governed leg already read costs no second timeline read.
 *
 * ## Ordering: the path test runs FIRST, and a clear diff costs zero API calls
 *
 * ⛔ Fail-open on an API error is WRONG in this file — this guard exists
 * because everything else in the chain failed open — so an unreadable review
 * list is a REFUSAL with its own distinct message and its own exit code, never
 * a pass. But a diff that touches nothing governed must never be blocked by an
 * API hiccup either, and the two requirements are reconciled by ORDER, not by
 * tolerance: `runGuard` decomposes the diff and returns before constructing a
 * single request when nothing governed is in it. The self-test pins that with
 * a `fetchReviews` that THROWS if it is called at all — a spy, not a mock,
 * because "we did not need the API" is the claim under test.
 *
 * ## Multi-PR merge groups, and the under-enumeration trap
 *
 * A merge group can carry SEVERAL pull requests. `merge_group.head_ref` names
 * only the LAST one (`…/gh-readonly-queue/main/pr-<N>-<sha>`), so keying the
 * whole group's diff to that one PR would check the wrong PR's reviews — and
 * would do it in the direction that reads as compliance: PR B is approved,
 * PR A's governed diff rides in behind it. Under-enumeration is the one
 * direction a governed-surface reading must never be wrong in (#9902).
 *
 * So the group is decomposed PER COMMIT: each first-parent commit between
 * `base_sha` and `head_sha` is one PR landing, its PR number read from its
 * subject by the sibling's `pullNumberFromSubject` (both GitHub spellings),
 * and every governed PR is checked on its OWN reviews. A commit that touches a
 * governed path and names no PR is UNATTRIBUTED — its own refusal, with its
 * own exit code, because a governed change nobody can attribute to a reviewable
 * pull request is the most anomalous thing this file can encounter.
 * `head_ref`'s PR number is used as a fallback only when the group holds
 * exactly one commit, where it is unambiguous.
 *
 * The `pull_request` leg is NOT decomposed: its payload names the one pull
 * request being judged, so every governed path is attributed to that number
 * (a subject naming an issue would read the issue's reviews), and the paths
 * are the net diff against the merge-base (a merge of `origin/main` on the
 * branch would otherwise forecast every path `main` already landed). See
 * `enumerateRows`; the `merge_group` reading above is unchanged by it.
 *
 * ## The generated-artifact exception is honoured, and that is not optional
 *
 * A generator-owned file sitting inside a governed surface makes routine
 * traffic cross the fence, and a guard that refuses routine traffic is the same
 * poison one level down. So the register's provenance exception is applied here
 * through its own `applyGeneratedExceptions`, with provenance recomputed on this
 * build's own tree — never a stored baseline, and fail-closed on every error
 * path, exactly as the ruled constraints require.
 *
 * ⚖️ The original case for this — `.claude/workflows/docs-accuracy-audit.js`
 * holding a required gate's own `--write` artifact, so EVERY page-adding docs PR
 * touched the governed surface (measured 5-for-5 on #9866) — is GONE, and by a
 * different remedy: on 2026-09-01 the maintainer ruled that list off the governed
 * surface entirely (#13591, verbatim 「同意」). Its register row retired with it.
 * The mechanism stays because the #11705 rows still need it, and because the
 * shape recurs; ⛔ its absence from a diff is not a reason to relax anything.
 *
 * NOTHING about the exception is decided here: membership is the register's
 * `generatedExceptionFor` and the recompute is its `recomputeProvenanceFor`,
 * both imported rather than reimplemented, so this guard and the seat-side
 * `--test` predicate cannot answer differently about the same diff. That
 * sharing is a #11705 ruled constraint ("⛔ do not author a second mechanism")
 * and it is also what makes a new register row reach this file for free.
 *
 * ⭐ THE JOB INSTALLS DEPENDENCIES, and that is what makes the #11705 rows
 * (generator-owned files inside `skills/**`) answerable here at all. They
 * recompute by running the generator's own `--check` through `pnpm … exec tsx`,
 * so with no toolchain they used to fail closed on EVERY run: a spec PR
 * carrying its regenerated `references/_index.md` stayed governed at
 * merge-group time and needed a pinned approval, while the seat-side `--test`
 * lifted the very same diff in a dev container. Two tools, same register, two
 * answers — the one shape #11705's "⛔ do not author a second mechanism" exists
 * to prevent, arrived at through the ENVIRONMENT rather than through a second
 * copy of the code. The header used to file the install as a trade nobody had
 * ruled on. The maintainer ruled it (2026-09-01, verbatim):
 *
 *   > 纯生成的指针行(spec 源变更后再生成的 references/_index.md) 不需要我审核吧
 *
 * What the install does NOT do is soften anything. The exemption is still the
 * register's own byte-exact recompute against this build's own tree, every
 * error path still fail-closed, and hand-authored governed content — including
 * a hand edit sitting in the same commit as a certified regeneration — still
 * needs the pinned approval. The only thing that changed is that the recompute
 * can now actually run.
 *
 * ⚠️ The degradation is deliberate and is the reason every toolchain step in
 * the workflow is `continue-on-error`: a broken install (registry outage, cache
 * miss, a PR that moves `pnpm-lock.yaml` out of sync) leaves this job in
 * EXACTLY the state it was in before the install existed — the generator cannot
 * spawn, the recompute answers "the generator toolchain is not available in
 * this environment", and the path stays GOVERNED. A diff that touches nothing
 * governed is still never blocked by any of it: the path test runs first and
 * returns before provenance is consulted at all.
 *
 * ## The TIER leg: the references TIER of the governed surface (#17950/#18020)
 *
 * Everything above judges a governed diff as ONE population. On 2026-09-13 the
 * maintainer tiered it, and the boundary put to them is the operative text, so
 * it is reproduced rather than paraphrased (untranslated — rewriting a quoted
 * ruling rewrites the ruling):
 *
 *   > **事实层(席内契约复审档复核后入队)**:只有
 *   > `.claude/skills/pm-dispatch/references/**`——平台读数表、runbook、契约复核细则、
 *   > 车道文件、状态机细则。
 *
 * — answered 「我点头」. The other half of that boundary, the 规则层, is every
 * remaining governed path and is quoted in full on #17950; ⛔ it is NOT excerpted
 * here, because a partial rules-layer list read as the whole one is precisely
 * the under-claim `check-governed-prose` exists to stop. The charter text landed
 * as PR #18018; this leg is what made it ENFORCED rather than declared, which is
 * the whole of #18020 — narrowly, for the one prefix quoted above.
 *
 * ⭐ SUPERSEDED 2026-09-18 (#19133, ruled 「同意改规则。」 on the skills seat's
 * proposal; the amendment moved `.claude/settings.json` and `.claude/hooks/**`
 * over too: 「我觉得这些我也没必要确认」): the quote above is reproduced as the
 * ruling that STARTED this leg, not as the population it enforces today. #19133
 * widened that population from the one prefix quoted above to the WHOLE of
 * `.claude/**` — Tier S, in the register's own words — leaving Tier H as exactly
 * the register's other rows. The register's `tier` field is the enumeration now;
 * this leg asks `governedTierFor` for Tier S, never a prefix repeated here — see
 * the "landing TIER" section below for the enforced definition, and read it live
 * with `node scripts/pm/check-governed-merges.mjs --test <paths>` rather than
 * trusting a prefix copied into prose, which is exactly what went stale once.
 *
 * So a governed diff whose governed paths are ALL Tier S — today, the whole of
 * `.claude/**` — may land on a REVIEW OF RECORD in place of the authorized
 * approval: the `## Contract review` comment — on the
 * PULL REQUEST'S THREAD **or on its CARD'S** — that names the pull request's
 * CURRENT head, carries a `Reviewed-by:` line and one `VERDICT:` line reading
 * PASS, is posted by the relay or an authorized approver (#33541), and declares a `Served-tier:`
 * reading that STANDS -- its token being the NAME `CONTRACT_REVIEW_TIER`,
 * ⛔ never a model identifier, which `AGENTS.md` lets land in no comment and a
 * record IS one (#18060). Every governed path outside Tier S is Tier H, the
 * rules layer, and keeps the predicate above byte-for-byte.
 *
 * ⚖️ The `workflows` row is the one row whose tier is read off the DIFF
 * (ruling record 6722205630 on #31538, letter C): `attachWorkflowReadings`
 * hands each queued commit's workflow reading — against its first parent on
 * `merge_group`, the merge base on `pull_request` — to the register's
 * `applyWorkflowSplit`, and a commit it could not read stays Tier H.
 *
 * ⚖️ The two skills catalog rows are read off the PULL REQUEST (maintainer
 * ruling 2026-11-14 on #33501, the register's "The low-risk skills arm"):
 * `decomposeGovernedWork` keeps every path of every attributed commit
 * (`allPaths`, ungoverned commits of the same PR included) and reads the arm
 * NOT MEASURED, so the `pull_request` leg says Tier H; the `merge_group` leg's
 * `readLowRiskTier` re-reads the tier with the body, label names and fork
 * predicate of the pull object it already fetched for the head, the timeline the
 * enqueue leg already read, and each changeset at the commit that touched it
 * (`git show`), and each governed commit's status and mode per path
 * (`catalogFilesOf`, `diff-tree --raw --no-renames`, and for a modified file
 * under the `adr` row that commit's full-context diff, which the register's
 * `addOnlyNoteReasons` reads add-only — the ADR leg, #33539) — through the
 * register's `governedTierFor`. An unread pull,
 * timeline or changeset stays Tier H. That first read leaves the arm's RECORD
 * STAGE pending (`lowRiskRecordStagePending`): an entry whose pull-read
 * conditions all hold is still Tier H until the record leg below, on the
 * threads it reads anyway, hands the arm the review's `Security-touching:` line
 * (`lowRiskRecordStage`: the record on this head, read with the fleet's record
 * reader) and the labels and timeline of EVERY card it names (`readCardLabels`), and
 * `readLowRiskTier` reads the tier again. A record that is absent, unreadable or
 * says anything but `Security-touching: no`, a `security` label on any such card now
 * or removed, or a card nobody could name, stays Tier H — and so does an entry
 * an approval or an authorized enqueue already cleared, whose stage is never
 * read. An entry the arm puts at Tier S clears on
 * a same-head record that READS PASS (`lowRiskRecordVerdict`), and a record
 * carried from an older head stands for it only when the hops moved no
 * changeset and no catalog path (`lowRiskCarryRefusal`, one rule for the stage
 * and the PASS).
 *
 * ⚖️ EVERY Tier S entry reads the record's VERDICT and its AUTHOR (card #33541;
 * AGENTS.md Prime Directive 14 lands Tier S on "a PASS verdict"): the record
 * clears only when it carries exactly ONE `VERDICT:` line and that line reads
 * PASS (`recordPassVerdict`, the fleet reader's counting form
 * `contractReviewVerdictLines`); FAIL, none or two refuse, naming the comment.
 * Since card #33604 that PASS must also be clean, read by the same record
 * reader (`contractReviewRecordReading`): a FAIL spelled anywhere else on the
 * comment, a must-fix or should-fix it names (owed a delta review, so the
 * later same-head record that closes them clears), or a grade it cannot
 * attribute refuses — the guard decides, not the seat's pre-landing check.
 * And only a comment posted by the relay's identity or an account in
 * `GOVERNED_APPROVERS` is read at all (`recordAuthorTrusted`): any other
 * author's comment is dropped before the locator sees the thread — ignored,
 * never refused loudly — because on a public repository anyone can post a
 * body shaped like a record.
 *
 * ⭐ THE TWO CARRIERS ARE ONE DELIVERY, and the location is the governed text's
 * to decide rather than this file's — quoted, untranslated, because it IS the
 * criterion: 「L2 记录 = 一条评论落 PR 或卡」
 * (`references/contract-review.md`), 「记录 = 同形评论落 PR 或卡」 (`SKILL.md`
 * 〈入队与落地〉). Until #18701 this leg read the PR thread ALONE while the
 * sibling's `--pair`, its `--template` and the rule itself all said either, and
 * the cost was measured on PR #18689: the seat's record sat on card #18426, the
 * queue leg answered 「0 comment(s) read on the PR thread」, the pull request was
 * dequeued `CI_FAILURE`, and only a SECOND COPY of the same comment on the PR
 * thread cured it. The thread set now travels inside the imported reader (see
 * `recordVerdict`), so the set this leg searches and the set `--template`
 * offers cannot be edited apart — a cross-tool pin in `record-recognisers.mjs`'s
 * self-test drives this guard to prove it.
 *
 * ⚖️ THE CARD IS DERIVED, never configured: from the pull request's own body
 * by the closing-keyword / `Part of` / branch-name relation the whole regime
 * pairs a PR with its card by (`deliveredCardNumber`, which asks
 * `deliveryEvidence`). A pull request whose card cannot be derived — none
 * named, or two named at equal strength — searches NO card thread and says so
 * in the refusal. That is the refusing direction, which is the only direction a
 * governed reading may be wrong in, and it leaves the PR-thread reading exactly
 * as it was.
 *
 * ⭐ THE PROPERTY THAT MAKES THIS SAFE TO SHIP, and it is measured rather than
 * asserted (see the battery): this leg is MONOTONE. It is consulted only for an
 * entry the approval predicate did NOT satisfy, so it can turn a refusal into a
 * pass and can never turn a pass into a refusal. A references-only PR that an
 * authorized approver approved still clears on the approval alone, at exactly
 * today's cost, and reads exactly today's words.
 *
 * ⭐ RECOGNITION IS IMPORTED, NEVER RE-IMPLEMENTED — and since #18701 the
 * WHOLE reading is, not only the facts it is made of. `locateReviewOfRecord`
 * (`record-recognisers.mjs`, the function that file composes the record
 * reading with) is what this leg calls: heading marker, head-sha span test, newest-of
 * resolution, `Reviewed-by:` key line, `Served-tier:` reader — and THE SET OF
 * THREADS to run them over. That last one is the fact a spelled-out filter here
 * could not copy, and it is what dequeued #18689.
 *
 * ⛔ So this file spells no filter of its own any more. What is left here is
 * the TIER gate on top of the located record, which is this leg's own fact and
 * nobody else's. The H51/H47 recognisers still own every line of the
 * recognition; they are simply reached through the file that already composes
 * them, which imports them at module scope — so a rename there stops that
 * module loading and this leg fails CLOSED with the loader's own reason.
 *
 * ⚠️ THE IMPORT IS LAZY, AND THAT IS LOAD-BEARING — see `REVIEW_OF_RECORD_LOCATION`
 * for the cycle it walks around, and `loadRecordRecognisers` for the rule that
 * keeps the walk legal. A failed load is a REFUSAL, never a pass.
 *
 * ⚖️ THE COST: up to TWO extra thread reads (the PR's and its card's), bought
 * ONLY for a references-tier pull request with no authorized approval — the
 * population that is refused outright today, so nothing that passes now pays
 * anything. The card's NUMBER costs nothing at all: it is read off the pull
 * object the head read already fetches. The head sha, which decides
 * nothing on the rules layer since 2026-09-04, IS decisive here: a record names
 * a head, so a head this guard could not read can find no record. That is not a
 * revival of the retired sha pin — it is the RECORD's own identity test, and it
 * applies to nothing but this tier.
 *
 * ### The `.claude/**` declaration split on this leg (maintainer ruling 2026-11-19, card #35321)
 *
 * Since 「1+2+4」 (point 1: fleet rule text lands by the maintainer) the `.claude/**`
 * row is Tier S only on a DECLARED pull request with a VERIFYING record — the
 * register's header section "The `.claude/**` row splits by declaration" has the
 * ruling and the rule. What this leg does with it:
 *
 *   - the tier read hands the PR body in (`readLowRiskTier`, the read the head
 *     already costs) and says its own record leg judges the record
 *     (`RULE_CHANGE_RECORD_LEG_DEFERRED`): `Rule-change: none`, or `ruled` with
 *     its `Ruling-ref:`, is Tier S; a missing line, `yes`, a settings file or a
 *     hook is Tier H and waits for the authorized approval like any Tier H row;
 *   - the record leg then requires, on top of stands + PASS, a
 *     `Rule-change-verified:` line equal to the declared value
 *     (`ruleChangeRecordVerdict`), and a record carried across a head move must
 *     not have crossed a `.claude/**` hunk (`ruleChangeCarryRefusal`);
 *   - the four guard instruments and this guard's own workflow file are plain
 *     Tier H rows of the register, so nothing here names them;
 *   - the `pull_request` early-warning leg reads no body, so it names such a
 *     diff "Tier H UNTIL the PR body is read" (`declarationUnread`) and never
 *     reddens; `CODEOWNERS` must carry a line for each always-Tier-H path.
 *
 * ## The FOURTH leg: the SIZE line (#19036, maintainer ruling 2026-09-18)
 *
 * Everything above is keyed on PATHS or on a LABEL. On 2026-09-18 the
 * maintainer ruled a limb keyed on the NUMBER, verbatim and untranslated:
 *
 *   > 修改代码量超过某个行数（比如5000）就应该人工审核
 *
 * and on 2026-10-09 lowered the line, verbatim and untranslated:
 *
 *   > 这种大额改动就应该人工审核,我还是建议5000行的人工审核门槛降到 3000,立卡。
 *
 * PR #19033 landed it seat-side: `testVerdict(paths, { size })` in the sibling
 * carries a `size` limb, `HUMAN_MERGE_LINE_THRESHOLD` (3,000) is declared
 * there ONCE, the comparison is `additions + deletions` STRICTLY greater, and
 * generated files are INCLUDED — the case that prompted the ruling, PR #18971
 * (+238,310 / −119, 237,706 of them regenerated), touched no governed path and
 * landed through THIS leg's queue build on an AI review alone. The seat-side
 * `--test` / `--pr` / `--branch` refused from that day; the queue did not,
 * because `runGuard` handed the predicate no size (#19036, class (b): a
 * declared contract the queue could not hold). This leg is the queue half.
 *
 * ⭐ IMPORTED, NEVER RESTATED — the ruled constraint, and the reason the
 * ablation in the PR that landed this inverts the comparison in the SIBLING
 * and watches THIS file's pins redden: the threshold, the comparison and the
 * generated-files inclusion are `sizeVerdict`'s, reached through
 * `testVerdict([], { size })` and judged by `landsByHumanMerge`. With an empty
 * path list that call IS the size limb alone: the PATH limb is the governed
 * leg's question, already answered on the LIFTED rows with the register's
 * exception applied, and a raw path list handed here would judge it a second
 * time without the lift — the two-mechanisms shape #11705 forbids. This file
 * declares no threshold and spells no comparison; the self-test pins both
 * absences against this file's own source.
 *
 * ⚖️ THE COST, and why EVERY queued pull request pays it: the size is a
 * property of the pull request, not of a governed path, so it cannot ride the
 * governed leg's head read — that read exists only for rows the register
 * classes as governed, and the case this leg exists for (#18971's shape: over
 * the line, NOTHING governed) never reaches it. So this leg reads
 * `GET /pulls/{n}` once per queued pull request, through the SAME
 * `makePullReader` the governed leg uses (the pull object already carries
 * `additions` / `deletions`; the reader's shape grew a `size`, no second
 * endpoint) and under the same `pull-requests: read` scope, nothing wider.
 * Merge groups are small, so the bill is one read per PR per build, and the
 * block prints its own count. The zero-cost-clear rendering above is scoped
 * to say so (#15406's lesson, a third time).
 *
 * ⛔ FAIL-CLOSED ON AN UNREADABLE SIZE, and this is the one place the
 * 2026-09-04 rule 「a read that decides nothing may not block a landing」 cuts
 * the OTHER way: this read DECIDES. A pull read that fails, or a pull object
 * with no `additions` / `deletions` pair, is a refusal on its own code (exit
 * 9), never a size of zero and never a pass — the sibling's `--pr` refuses on
 * exactly that absence (exit 1 there) for exactly that reason.
 *
 * ⭐ AN AUTHORIZED APPROVAL LIFTS THIS LIMB (maintainer ruling 2026-09-27,
 * #20153), exactly as it lifts a Tier H path. Until that day the landed
 * predicate said a human MERGE and nothing else — 「人工审核」 landed as the same
 * terminal a governed diff has (ACCEPT on the card, `pm:awaiting-merge` on
 * the PR, a final 维护者速读, review requested from `GOVERNED_APPROVERS`) and
 * the maintainer's own click (人工直合); the 2026-08-27 ruling had said
 * "approval lifts" of PATHS, nothing had said it of the NUMBER, and this file
 * refused to widen a gate past its own ruling. PR #20125 (about 11.5k changed
 * lines, APPROVED by `os-zhuang`) was then dequeued twice on exactly this
 * limb, and the maintainer ruled, verbatim and untranslated:
 *
 *   > 所以阈值写死成 5000 行 , 维护者已经批准了就是可以合并。
 *
 * So this leg now reads THE SAME authorized-approval verdict the governed leg
 * reads — `authorizedApprovalVerdict`, one derivation, on ANY commit, with
 * DISMISSED, superseded and unauthorized approvals never counting and an
 * unreadable review list failing closed — and hands it to the sibling through
 * the same front door as the size: `testVerdict([], { size, approval })`. The
 * LIFT itself is the sibling's (`sizeLiftFrom`, read by `landsByHumanMerge`
 * through `sizeLimbFires`), so the queue and the seat-side `--pr` answer on one
 * predicate; this file spells no lift condition of its own. The threshold, the
 * strict comparison and the generated-files inclusion are UNCHANGED, and so is
 * the FORK limb: no approval lifts a fork. After the approval the OWNING seat
 * lands the pull request through the queue (席位落地); the maintainer's direct
 * merge stays the other landing. ⭐ #19344 — THAT CLICK IS ONE BUTTON OPTION
 * and this text names it: `main` mandates the queue and requires this check,
 * so the only Merge that is not an enqueue is the Merge button's BYPASS-RULES
 * option, offered only while the ruleset configures a bypass actor. While none
 * was, the remedy named a terminal nobody could reach and PR #19024 was
 * enqueued and refused three times. That it IS offered is a ruleset fact the
 * pin reads. No review of record (Tier S) lifts this limb: the ruling names an
 * authorized APPROVED review, and a seat's own record is not one.
 *
 * ⚖️ THE COST: one review read (`GET /pulls/{n}/reviews`) per queued pull
 * request that is OVER the line — the population this leg refused outright
 * before, so nothing that cleared pays anything new — and none at all when the
 * governed leg already read that pull request's reviews on this build: the
 * verdict object is reused, never re-derived. An unreadable review list on an
 * oversized pull request refuses on exit 8 (over the line, no lift proven),
 * never on 9, which stays "the SIZE could not be read": the words carry which.
 *
 * ⚠️ `pull_request` leg: SILENT, byte-identical, like the governed leg. The
 * seat-side pre-check already refuses an oversized PR before it is armed, and
 * the ruling this leg implements is about the LANDING. (The `pull_request`
 * payload carries `additions` / `deletions` for free; a forecast there is a
 * one-line maintainer decision, not taken here.)
 *
 * ## The FIFTH leg: a declared NARROWING (maintainer ruling 2026-11-19, card #35321)
 *
 * The maintainer, 03:17Z in the review-split discussion thread, verbatim:
 * 「spec：收紧作者能写的东西（会让现有应用报错），也需要fable 吧？」, confirmed by
 * 「1+2+4」 at 04:24Z. A change that narrows what an author may write breaks
 * applications that exist, so it lands like Tier H whatever paths it touches.
 *
 * A path cannot say "narrowing"; the DECLARATION does. On `merge_group`, for
 * every queued pull request, this leg reads the PR body and every
 * `.changeset/*.md` the queued commit carries, line by line with the fleet's
 * two readers (`readClause2Line`, `readMetadataProtocolLine`): a line reading
 * `Metadata-protocol: narrowed`, or a `Clause-②:` line with the `(narrowing)`
 * arm on either value, is a declared narrowing. `added`, `semantic`, `none`
 * and a bare `Clause-②:` declare none and cost one pull read, already memoized
 * (`oncePerPull`) when another leg read it.
 *
 * A declared narrowing is REFUSED until BOTH halves are on record:
 *
 *   - the human half — an authorized APPROVED review (the predicate of the
 *     governed leg, reused when that leg already read it), or the maintainer's
 *     own enqueue from an authorized account, which the 2026-10-26 ruling made
 *     the same act for every landing this file judges;
 *   - the record half — a `## Contract review` record on the current head that
 *     stands at its tier and reads PASS, located on the narrowing face
 *     (`reviewFace` with the declaration texts handed in). The face is HELD
 *     there once the leg found a declaration, on either line: `reviewFace`
 *     reads the `Clause-②:` arm alone, so the narrowed kind of the
 *     `Metadata-protocol:` line is handed to it in the one spelling it reads
 *     (`NARROWING_FACE_LINE`). A schema or governed path still decides first.
 *
 * ⛔ Fail closed: an unreadable pull, changeset, review list or thread is a
 * refusal on its own code, and a near-arm spelling (`(narrowed)`) counts as
 * declared — all but the pull-request template's own unfilled menu line, which
 * chose nothing (`UNFILLED_PROTOCOL_MENU`). ⛔ Not read: a narrowing nobody declared — that stays the contract
 * review's finding. `pull_request` leg: silent, like the SIZE leg.
 *
 * ## Exit codes — the refusal is impossible to read as clean
 *
 *   0  CLEAR    — nothing governed in the diff (no API call was made), or every
 *                 governed PR carries an authorized APPROVED review (on ANY
 *                 commit — 2026-09-04) or was enqueued by an authorized
 *                 account (2026-10-26), or this is the `pull_request`
 *                 early-warning run.
 *   3  REFUSED  — governed, and at least one governed PR carries no authorized
 *                 APPROVED review (none at all, unauthorized account, dismissed
 *                 or superseded) and was not enqueued by an authorized account
 *                 (another account, or an UNDETERMINED enqueuer) — and, on the
 *                 references tier, no review of record on its current head
 *                 either.
 *                 Deliberately 3, the same code the sibling's `--test`
 *                 answers "GOVERNED" with, so the two tools agree on the number
 *                 that means "this diff is governed and unsatisfied".
 *                 ⭐ NOT split per tier, deliberately: the FACT is the same one
 *                 ("this governed diff is unsatisfied") and the two remedies
 *                 differ, so the rendering carries the difference and the exit
 *                 register stays the one a reader already knows.
 *   4  REFUSED  — governed, and the REVIEW LIST could not be read — or, on the
 *                 references tier, one of the record's threads (the PR's or its
 *                 card's), its head, or the imported recognisers could not be.
 *                 Distinct from 3 on purpose: "nobody approved" and "we could
 *                 not find out" are different facts and must be separable in a
 *                 log. ⚠️ An unreadable PR HEAD is NOT this refusal any more —
 *                 since 2026-09-04 the head decides nothing, so it is recorded
 *                 as a missing reading and the review list alone judges.
 *   5  REFUSED  — governed paths on a commit attributable to no pull request.
 *   8  REFUSED  — a queued pull request is over the human-merge line:
 *                 `additions + deletions` strictly greater than the sibling's
 *                 `HUMAN_MERGE_LINE_THRESHOLD`, generated files included
 *                 (#19036, the 2026-09-18 ruling) — and NO authorized APPROVED
 *                 review lifts it (none, unauthorized, dismissed/superseded, or
 *                 the review list could not be read; 2026-09-27, #20153), nor
 *                 an enqueue by an authorized account (2026-10-26). The
 *                 SIZE leg, not the governed one; its remedies are an authorized
 *                 approval and then the owning seat's landing, or a human merge.
 *   9  REFUSED  — the SIZE leg could not READ a queued pull request's size (the
 *                 pull read failed, or the object carries no pair), or the merge
 *                 group names no pull request to read it from. Split from 8 the
 *                 way 4 is split from 3.
 *  10  REFUSED  — a queued pull request DECLARES a narrowing (its body or a
 *                 changeset) and lacks the authorized approval or enqueue, the
 *                 PASS contract review on its head, or both. The NARROWED leg.
 *  11  REFUSED  — the NARROWED leg could not READ a queued pull request, a
 *                 changeset it carries, its review list or its record threads,
 *                 or the merge group names no pull request. Split from 10 the
 *                 same way.
 *   1  CANNOT RUN — unusable event payload, unsupported event, unreadable git.
 *                 Still non-zero, still red: this file has no green that means
 *                 "did not look".
 *
 *   ⭐ THREE predicates, ONE exit, and the precedence is pinned: every leg's block is
 *   always printed, and the code is the GOVERNED leg's when it refuses, else
 *   the SIZE leg's, else the NARROWED leg's (`groupExitCode`). The governed refusal sits on top because
 *   its remedy is the stricter one; the size refusal's remedy (an authorized
 *   approval, or a human merge) is the same terminal as Tier H — a group that
 *   is both governed-unsatisfied and oversized prints both limbs and exits 3.
 *
 * ## What this file does NOT do
 *
 * It does not make itself a required context. Branch protection is the
 * maintainer's, and the #6865 two-step exists so that flip is visible and
 * deliberate: a `REQUIRED_CONTEXTS` row in `scripts/check-required-contexts.mjs`
 * plus the entry in Settings → Rulesets, in one sitting. Adding the registry
 * row alone would put the context in `direction A — registered here, NOT in the
 * live required set`, which that gate reports as a problem. The context name to
 * pin is `CHECK_CONTEXT_NAME` below, and the self-test asserts the workflow's
 * `name:` literal still equals it, so the pin cannot be taken against a name
 * that has since drifted.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENERATED_SURFACE_EXCEPTIONS,
  GOVERNED_REPOS,
  GOVERNED_SURFACES,
  GOVERNED_TIER_H,
  GOVERNED_TIER_S,
  HUMAN_MERGE_LINE_THRESHOLD,
  LOW_RISK_ARM_RULING,
  LOW_RISK_CHANGESET_PATH,
  LOW_RISK_RECORD_STAGE,
  RULE_CHANGE_RECORD_LEG_DEFERRED,
  RULE_CHANGE_TIER_H_PATHS,
  SELF_REPO_ID,
  WORKFLOWS_PREFIX,
  addOnlyDiffArgv,
  applyGeneratedExceptions,
  applyLowRiskArm,
  applyRuleChangeSplit,
  applyWorkflowSplit,
  assertGovernedRepo,
  forkVerdict,
  generatedExceptionFor,
  governedPathsIn,
  governedSurfacesFor,
  governedTierFor,
  groupHitsByException,
  landsByHumanMerge,
  lowRiskArmVerdict,
  mergeWorkflowReadings,
  pullNumberFromSubject,
  pullSizeFrom,
  recomputeProvenanceFor,
  readRuleChangeVerified,
  readWorkflowDiff,
  renderLiftApprovals,
  renderLowRiskLines,
  renderRuleChangeLines,
  renderWorkflowSplitLines,
  ruleChangeRecordReasons,
  repoIdForSlug,
  testVerdict,
} from './check-governed-merges.mjs';
import { CLAUSE2_ARMS, CLAUSE2_VALUES, METADATA_PROTOCOL_KINDS, readClause2Line, readMetadataProtocolLine } from './clause2-line.mjs';
import { gitFreeEnv } from '../git-env.mjs';
import { isEntrypoint } from '../invoked-as.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'the register is READ, never restated (#9840)': 6,
  'the exit contract as a table': 4,
  'the merge-queue head ref': 6,
  'event payloads, including the malformed ones': 5,
  'the approval predicate': 3,
  '⭐ The fail-open direction a naive `.some(r => r.state === \'APPROVED\')`': 5,
  'the 2026-09-04 unpinned predicate (the queue leg\'s)': 12,
  'decomposition, and the multi-PR group trap': 13,
  'the verdict table, both events': 10,
  'the pull_request leg is an EARLY WARNING and never reddens': 6,
  'the replay fixtures: the three incidents this guard descends from': 11,
  '⭐ the ordering guarantee, measured with a spy that THROWS': 7,
  'the words a reader acts on (requirement (e))': 26,
  '⭐ #14063 END TO END: what the dependency install actually buys': 9,
  'the PR-head reader: throws, and the caller no longer refuses on it': 3,
  'the WIRING pin: the workflow still spells this context name': 8,
  '⭐ #14063: the environment the exemption needs, pinned to the YAML': 7,
  '⭐ #15406: a CLEAR reached through a lift is not a clear that saw nothing': 10,
  '⭐ #18020 → #19133 Tier S: a review of record, not an approval': 43,
  '⭐ #18701: the record lives on the PR or its card, and BOTH are read': 14,
  '⛔ #19036: the SIZE line at the queue — imported, per queued PR, fail-closed': 54,
  '⭐ #19344: the remedy names a path the ruleset actually offers': 5,
  '⛔ the queued pull-back: the landing seat sends the relay dequeue, never a DRAFT conversion': 4,
  '⭐ the 2026-09-20 ruling: a certified PURE REGENERATION carries the record to the queued head': 13,
  'the per-row repository scope (ruling B2, 2026-10-13)': 14,
  '⭐ B′ with C: the record stands at the tier its FACE maps to, read off the committed paths': 8,
  'the CODEOWNERS mirror: every Tier H register row routes to every GOVERNED_APPROVERS account, nothing else is routed, and the file says so': 12,
  // Raised 28 → 30 with the timeline reader's `Link` header: a short page that names a next page is followed, and
  // a next page named on every answer throws at the page limit.
  '⭐ the 2026-10-26 ENQUEUE leg: an authorized enqueuer is the human review': 30,
  '⭐ the cheap early-warning leg: commits and trees, toolchain on demand': 20,
  '⭐ the workflows split at the queue (ruling record 6722205630)': 30,
  // Raised 54 → 72 with the arm's record stage: the record's `Security-touching:` line (control, absent line, `yes`,
  // the unreadable shapes, newest-governs, the author binding, unsigned and unread, the card thread) and the linked
  // card's `security` label (now, removed, unread, no card), the stage's cost, the unloaded recognisers, and the
  // three builders — eighteen pins; 72 → 74 with the thread walk and the whole-stage reader `--pr` and the relay share.
  // Raised 74 → 84 with every card the pull NAMES: `security` on the second card behind a `Part of`, a branch name
  // and a `Refs`, their clean control, the first card beside a clean second, the second card unread, the limit, the
  // reader's own walk, `namedCardsOf`, and the cleared entry that spends no stage read — ten pins.
  '⚖️ the low-risk skills arm at the queue: body, labels and every path, read off the pull this leg holds (#33501)': 84,
  // Raised 12 → 13 with the arm's record stage on the ADR leg: a record without the line, a `security`-labelled card;
  // 13 → 14 with a second card the note names.
  '⚖️ the ADR leg at the queue: an add-only note clears on its PASS record, any other ADR change is H (#33539)': 14,
  // The declaration split at the queue (maintainer ruling 2026-11-19 on #35321): the four instruments and the guard's
  // own workflow are H; `.claude/**` is S only on the declared body line AND the record's verified line.
  '⚖️ #35321 at the queue: guard instruments are Tier H, `.claude/**` splits by declaration': 26,
  // The narrowed leg (same ruling): a declared narrowing needs BOTH halves; `added`, `semantic`, `none` are untouched.
  '⚖️ #35321: a declared narrowing lands like Tier H — an authorized approval AND a PASS record': 24,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. Lowered 24 → 23 when the
// contract-review carrier battery left with the label it read (ruling record
// 5770886272 on #19061, letter B): the ordinary direction, one battery, one row.
// Raised 23 → 24 with the queued pull-back battery: one battery, one row.
// Raised 25 → 26 with the B′-with-C face battery (ruling record 6159870311): one battery, one row.
// Raised 26 → 27 with the CODEOWNERS mirror battery: one battery, one row.
// Raised 27 → 28 with the ENQUEUE leg battery (maintainer ruling 2026-10-26): one battery, one row.
// Raised 28 → 29 with the cheap early-warning leg battery: one battery, one row.
// Raised 29 → 30 with the workflows split battery (ruling record 6722205630): one battery, one row.
// Raised 30 → 31 with the low-risk skills arm battery (#33501): one battery, one row.
// Raised 31 → 32 with its ADR leg battery (#33539): one battery, one row.
// Raised 32 → 34 with the two #35321 batteries (the declaration split at the queue, the narrowed leg): two rows.
const SELF_TEST_BATTERY_FLOOR = 34;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');

/** The exit contract, named so the header's table is machine-checkable. */
export const EXIT_CLEAR = 0;
export const EXIT_CANNOT_RUN = 1;
export const EXIT_REFUSED_UNAPPROVED = 3;
export const EXIT_REFUSED_UNREADABLE = 4;
export const EXIT_REFUSED_UNATTRIBUTED = 5;
/**
 * The SIZE leg's two refusals (#19036, the 2026-09-18 ruling). The same split,
 * for the same reason: "this pull request is over the line" and "we could not
 * read its size" are different facts, and the second one DECIDES here — unlike
 * the PR head, whose read failing is a note — so it refuses on a code of its
 * own. ⛔ Neither may ever be folded into the other, nor into 3/4.
 */
export const EXIT_REFUSED_OVERSIZED = 8;
export const EXIT_REFUSED_SIZE_UNREADABLE = 9;
/**
 * The NARROWED leg's two refusals (card #35321, the 2026-11-19 ruling), split the same way: a queued pull
 * request that declares a narrowing without both halves on record (10), and one whose declaration, review
 * list or record could not be read (11). ⛔ Neither folds into the other, nor into any code above.
 */
export const EXIT_REFUSED_NARROWED = 10;
export const EXIT_REFUSED_NARROWED_UNREADABLE = 11;

/**
 * The check-run name branch protection would pin, and the wiring it belongs
 * to. Declared HERE rather than only in the YAML so the self-test can assert
 * the workflow still spells it — the #6865 defect is a job rename detaching a
 * required context silently, and a name that lives in exactly one place is a
 * name nothing can pin.
 */
export const CHECK_CONTEXT_NAME = 'Governed Surface Queue Guard';
export const CHECK_WORKFLOW = 'governed-surface-guard.yml';
export const CHECK_JOB_ID = 'governed-surface-guard';

/** The events this guard understands, and what each one means to it. */
export const EVENT_MERGE_GROUP = 'merge_group';
export const EVENT_PULL_REQUEST = 'pull_request';

/**
 * The ONLY accounts whose APPROVED review satisfies the `merge_group` leg:
 * 2026-11-17, verbatim: 「hotlong 从批准账户中去掉，只保留 os-zhuang」 (triage
 * session, card #34626). It supersedes the membership of 2026-08-27
 * (「os-zhuang hotlong 批准算数」), kept here as history. ⭐ Single source, the
 * `CONTRACT_REVIEW_TIER` pattern: protocol text references this constant and
 * never copies the names; changing the set is a one-line maintainer decision
 * here, nowhere else. The self-test pins the membership to the ruling, and the
 * refusal/cleared renderings derive their named accounts from this array.
 */
export const GOVERNED_APPROVERS = Object.freeze(['os-zhuang']);

// ── the CODEOWNERS mirror — the platform half of "both approvers are asked" ─

/**
 * `.github/CODEOWNERS` is the platform's own review router: GitHub requests a
 * code owner's review when a pull is opened READY or marked ready for review.
 * It is a static file — it can import neither `GOVERNED_SURFACES` nor
 * `GOVERNED_APPROVERS` — so the two stay in step the only way a static file
 * can: this predicate reads it and the self-test reds when it drifts. ⛔ It is
 * a pin inside this existing self-test, not a gate, a check-run or a patrol
 * row: the fleet's own request on the draft open is the relay's
 * governed-review follow-up (`fleet-write/ops.mjs`), and the gap both close is
 * what the H43 patrol row keeps reading.
 *
 * `codeownersRows` parses the file's effective lines — a `#` comment to end of
 * line stripped, blank lines dropped — into `{ pattern, owners, line }`.
 * `codeownersPatternFor` spells the one CODEOWNERS pattern a register row maps
 * to: its prefix or exact path, root-anchored. Both pure.
 */
export function codeownersRows(text) {
  const rows = [];
  String(text ?? '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.replace(/#.*$/, '').trim();
      if (line === '') return;
      const [pattern, ...owners] = line.split(/\s+/);
      rows.push({ pattern, owners, line: i + 1 });
    });
  return rows;
}

export function codeownersPatternFor(surface) {
  return `/${surface.prefix ?? surface.exact}`;
}

/**
 * The verdict: `{ ok, problems, tierHPatterns, armPatterns }`. `ok` holds
 * only when
 *   - every Tier H row of the register that governs `repo` and carries no
 *     per-pull arm there has a CODEOWNERS line at exactly its pattern, naming
 *     exactly `@` + every account in `approvers` (order-free; nobody else,
 *     nobody fewer) — those patterns are `tierHPatterns`;
 *   - no line routes a Tier H row that carries the low-risk arm in `repo`
 *     (`armPatterns`, read off the row's own `lowRisk.repos`, never a list
 *     kept here): who is asked to review such a pull is the relay's per-pull
 *     plan, which reads the arm, and a static line would summon both
 *     approvers on every catalog pull, the low-risk ones included (ruling
 *     record 6891850019). The arm is per repository, so a sibling copy the
 *     arm does not reach still owes the line;
 *   - every other line — the enforcement chain's rows — names exactly that
 *     same owner set, so an enforcer cannot be routed to a subset;
 *   - no line routes a Tier S row's pattern: Tier S lands on a seat's review of
 *     record, and a code-owner request there would summon the maintainer for a
 *     landing that is not his;
 *   - the file's prose names `GOVERNED_APPROVERS`, so a reader finds the
 *     constant the owner list mirrors.
 * Every problem is a sentence naming the row or line; the list is whole, never
 * the first hit. Pure.
 */
export function codeownersMirrorVerdict({ text, approvers = GOVERNED_APPROVERS, repo = SELF_REPO_ID, register = GOVERNED_SURFACES } = {}) {
  const rows = codeownersRows(text);
  const wanted = [...approvers].map((a) => `@${a}`.toLowerCase()).sort();
  const sameOwners = (owners) => JSON.stringify([...owners].map((o) => o.toLowerCase()).sort()) === JSON.stringify(wanted);
  const problems = [];
  // The rows that govern THIS repository, read from the register (ruling B2: the question has a repository in it).
  // `register` is the register's own seam (`governedSurfacesFor`): the self-test hands in rows not on it yet.
  const governing = governedSurfacesFor(repo, register);
  const armedIn = (s) => Boolean(s.lowRisk) && Array.isArray(s.lowRisk.repos) && s.lowRisk.repos.includes(repo);
  const tierH = governing.filter((s) => s.tier === GOVERNED_TIER_H && !armedIn(s));
  const armed = governing.filter((s) => s.tier === GOVERNED_TIER_H && armedIn(s));
  const tierHPatterns = tierH.map(codeownersPatternFor);
  const armPatterns = armed.map(codeownersPatternFor);
  // The declaration split's always-Tier-H sub-paths (2026-11-19): the split row itself is routed nowhere (it can
  // land on a seat's record), so each path under it that NEVER can owes a line of its own — the register's list.
  const splitHere = governing.some((s) => Boolean(s.ruleChange) && Array.isArray(s.ruleChange.repos) && s.ruleChange.repos.includes(repo));
  const splitPatterns = splitHere ? RULE_CHANGE_TIER_H_PATHS.map((row) => `/${row.pattern}`) : [];
  for (const pattern of splitPatterns) {
    const row = rows.find((r) => r.pattern === pattern);
    if (!row) problems.push(`the always-Tier-H path \`${pattern.slice(1)}\` under a declaration-split row has no CODEOWNERS line at \`${pattern}\` — a pull touching it summons nobody when opened ready`);
    else if (!sameOwners(row.owners)) problems.push(`CODEOWNERS line ${row.line} \`${pattern}\` names ${row.owners.join(' ') || 'nobody'}, not every GOVERNED_APPROVERS account (${wanted.join(' ')}) — a Tier H pull then waits on an approver who is never asked`);
  }
  for (const surface of tierH) {
    const pattern = codeownersPatternFor(surface);
    const row = rows.find((r) => r.pattern === pattern);
    if (!row) {
      problems.push(`Tier H row \`${surface.id}\` (${surface.glob}) has no CODEOWNERS line at \`${pattern}\` — a pull touching it summons nobody when opened ready`);
      continue;
    }
    if (!sameOwners(row.owners)) problems.push(`CODEOWNERS line ${row.line} \`${pattern}\` names ${row.owners.join(' ') || 'nobody'}, not every GOVERNED_APPROVERS account (${wanted.join(' ')}) — a Tier H pull then waits on an approver who is never asked`);
  }
  for (const row of rows) {
    if (tierHPatterns.includes(row.pattern) || splitPatterns.includes(row.pattern)) continue;
    const arm = armed.find((s) => codeownersPatternFor(s) === row.pattern);
    if (arm) {
      problems.push(`CODEOWNERS line ${row.line} routes \`${row.pattern}\`, a Tier H row (\`${arm.id}\`) carrying the low-risk arm in this repository — the relay's per-pull plan decides who is asked there, and a static line summons both approvers on every pull, the low-risk ones too`);
      continue;
    }
    const tierS = governing.find((s) => s.tier === GOVERNED_TIER_S && codeownersPatternFor(s) === row.pattern);
    if (tierS) problems.push(`CODEOWNERS line ${row.line} routes \`${row.pattern}\`, a Tier S row (\`${tierS.id}\`) that lands on a seat's review of record — a code-owner request there asks the maintainer for a landing that is not his`);
    else if (!sameOwners(row.owners)) problems.push(`CODEOWNERS line ${row.line} \`${row.pattern}\` (an enforcement-chain row) names ${row.owners.join(' ') || 'nobody'}, not every GOVERNED_APPROVERS account (${wanted.join(' ')})`);
  }
  if (!/GOVERNED_APPROVERS/.test(String(text ?? ''))) problems.push('the file never names `GOVERNED_APPROVERS` — its header must say which constant the owner list mirrors');
  return { ok: problems.length === 0, problems, tierHPatterns, armPatterns, splitPatterns, rows };
}

// ── the landing TIER: Tier S lands on a review of record, Tier H on an approval ─

/**
 * The two landing tiers, READ from the register (#19133, ruled 2026-09-18
 * 「同意改规则。」 on the skills seat's proposal; the amendment moved
 * `.claude/settings.json` and `.claude/hooks/**` over too: 「我觉得这些我也没
 * 必要确认」). Every `GOVERNED_SURFACES` row carries `tier`, and
 * `governedTierFor` — imported from the register's own file at module scope,
 * like every other predicate this guard reads — derives a pull request's tier
 * from the rows its GOVERNED paths hit. ⛔ Nothing here spells a prefix, a glob
 * or a row: the #18020 references tier was a prefix constant declared here
 * (`REFERENCES_TIER_PREFIX`, the fact layer alone); it is gone, and a seat
 * reading the register gets the same answer to "what lands this on a record"
 * as this guard does. The register's `.claude/**` row still AUDITS every path
 * under it exactly as before — the tier is a LANDING rule inside the row, never
 * a membership one, which is why ⛔ nothing here touches `GOVERNED_SURFACES`.
 *
 * `H` (人合) is the DEFAULT in every ambiguous case, because the two are not
 * symmetric: reading a Tier H path as S lands a maintainer-owned file on a
 * seat's own review, while reading a Tier S path as H costs one authorized
 * approval — the maintainer is asked to look at a pull request they need not
 * have, and the claiming seat lands it from there. An empty list answers H for
 * the same reason (the register's `landingTierOf` does; see its docblock).
 *
 * ⭐ ALL, not ANY, and not a proportion: 「混合 diff 一条命中即整 PR 分叉」 is the
 * regime's own rule one level up, and this is the same rule one level down. One
 * Tier H path in the diff and the whole pull request is Tier H. The paths
 * handed to `governedTierFor` are the GOVERNED paths of one entry —
 * `decomposeGovernedWork` has already dropped everything the register does not
 * match, so an ordinary source file riding along cannot demote it.
 */
export const TIER_H = GOVERNED_TIER_H;
export const TIER_S = GOVERNED_TIER_S;

/**
 * The Tier S surfaces in the register's own glob spelling — for the WORDS a
 * verdict prints, never for a second match (the match is `governedTierFor`).
 */
export function tierSGlobs() {
  return GOVERNED_SURFACES.filter((s) => s.tier === GOVERNED_TIER_S).map((s) => s.glob).join(', ');
}

/**
 * WHERE a review of record may live, in the words a refusal prints — a MIRROR
 * of `REVIEW_OF_RECORD_LOCATION` in `record-recognisers.mjs`, which is the
 * one place the set itself is declared (#18701).
 *
 * ⚠️ THIS IS A MIRROR, NOT THE SOURCE, and the reason is a MODULE-EVAL CYCLE.
 * Importing `record-recognisers.mjs` — or `check-half-states.mjs`, which
 * it imports — from here at MODULE SCOPE deadlocks both modules: that file's
 * H43 resolves its governed register at module scope with a top-level
 * `await loadGovernedRegister()`, which awaits `import('./check-governed-queue-guard.mjs')`
 * — this file — for `GOVERNED_APPROVERS`. Adding the reverse edge deadlocks
 * BOTH modules; measured on 2026-09-10, node exits 13 with "Detected unsettled
 * top-level await" and `check-half-states.mjs` stops loading standalone as well.
 * Re-measured on 2026-09-13 through `check-clause2-carriers.mjs`, and on
 * 2026-09-23 through `record-recognisers.mjs`, which took its recognisers over —
 * both import that file, and the INDIRECT edge deadlocks identically, exit 13.
 * The references tier reaches the recognisers with a LAZY import taken after
 * this module has finished evaluating — legal only because this file's own
 * dispatch carries no top-level `await`, which `loadRecordRecognisers` states
 * as a rule and the battery pins. That door is open to a FUNCTION BODY and shut
 * to a module-scope binding, and `renderGuardVerdict` is pure and synchronous,
 * so no lazy import can supply the words there. The READING half takes no mirror —
 * `runGuard` fetches one thread per entry in the loaded `threads` list, so the
 * set this file ACTS on is never a copy. Only the WORDS are copied, and the
 * battery pins them to the constant loaded through the real lazy import, so
 * drift in either direction reddens.
 */
export const REVIEW_OF_RECORD_LOCATION = 'the PR or its card';

/**
 * `governedTierFor` — the register's own function, re-exported so this file's
 * readers (`record-recognisers.mjs`'s cross-tool pin) and its battery keep
 * one name. ⛔ Not a wrapper and not a copy: the register answers, this file
 * relays. The tier docblock above carries the ALL-not-ANY rule and the H default.
 */
export { governedTierFor };

/** Where each imported recogniser lives. Named, so a failure can say which file. */
export const RECOGNISER_SOURCES = Object.freeze({
  tier: './record-recognisers.mjs',
  // The relay's one identity (`FLEET_BOT_LOGIN`), which the record leg trusts as a record's author
  // (#33541). Loaded LAZILY for the same reason as the recognisers: that file imports this one at
  // module scope, and `check-half-states.mjs`, whose top-level await imports this one, besides.
  author: './check-handover.mjs',
});

/**
 * Is this comment row's author one the record leg trusts (card #33541, item D of the low-risk
 * delegation review)? Its `user.login` is in `trusted`: the relay's identity plus
 * `GOVERNED_APPROVERS`, assembled by `loadRecordRecognisers` from the two places the repository
 * declares them. ⛔ No login is typed here, and none may be: the relay keeps no sender list of its
 * own (`fleet-write.yml` gates a stroke on the sender's write permission on the target), so those
 * two declarations are the whole set the repository names. An unreadable author is untrusted.
 *
 * Until #33541 the record leg read the comment BODY only, so on a public repository any commenter
 * could post a body it accepted. An untrusted row is IGNORED — dropped from the thread before the
 * locator reads it, so it can neither be the record nor shadow one nor name a `Regen-provenance:`
 * hop — and never refused loudly: the leg then reads whatever trusted rows remain. Pure.
 */
export function recordAuthorTrusted(row, trusted) {
  const login = row?.user?.login;
  return typeof login === 'string' && login !== '' && Array.isArray(trusted) && trusted.includes(login);
}

/**
 * The authors the record leg trusts (card #33541): the relay's identity `bot` plus `GOVERNED_APPROVERS`,
 * frozen, or `null` when `bot` is no login. ONE assembly of that set: `loadRecordRecognisers` builds the
 * leg's with it, and the owed-review list and the H43 patrol read through it with `recordAuthorTrusted`
 * (card #33705), ⛔ never a second login list. Pure.
 */
export function recordTrustedAuthors(bot) {
  return typeof bot === 'string' && bot !== '' ? Object.freeze([bot, ...GOVERNED_APPROVERS]) : null;
}

/** The informational line naming the comments the author binding dropped from a record's threads, or none. Pure. */
export function ignoredAuthorLines(record) {
  const logins = Array.isArray(record?.ignoredAuthors) ? record.ignoredAuthors : [];
  if (logins.length === 0) return [];
  const distinct = [...new Set(logins)];
  return [
    `           ℹ️  ${logins.length} comment(s) by author(s) outside the relay and GOVERNED_APPROVERS were not read: ` +
      `${distinct.slice(0, 3).join(', ')}${distinct.length > 3 ? ` (+${distinct.length - 3} more)` : ''} (#33541).`,
  ];
}

/**
 * The recognisers the references tier reads a record with — IMPORTED, and
 * imported LAZILY.
 *
 * ⭐ THE RULE THAT KEEPS THE LAZINESS LEGAL, and it is the one thing to read
 * before touching this function: `check-half-states.mjs` resolves its governed
 * register at MODULE SCOPE with a top-level await that imports THIS file. A
 * module-scope import from here — direct, or indirect through
 * `record-recognisers.mjs`, which imports that file — deadlocks both
 * modules (node exits 13, "Detected unsettled top-level await"; measured both
 * ways, see `REVIEW_OF_RECORD_LOCATION`). The cycle closes only while THIS module
 * is still evaluating, so the import is taken from a function body, after
 * evaluation has finished — which is true only because this file's dispatch
 * carries NO top-level `await`. ⛔ Restore one and this leg deadlocks the merge
 * queue build; the battery reads this file's own source to keep that honest.
 *
 * ⛔ Fail-CLOSED, like every other reading in this file: an absent or renamed
 * export is `available: false` with a reason, and the caller turns that into a
 * REFUSAL. A recogniser set that quietly half-loaded would decide a governance
 * question with a parser nobody checked.
 *
 * Injectable for the same reason H43's own loader is: the battery drives every
 * failure branch without touching the filesystem.
 */
export async function loadRecordRecognisers(load = (specifier) => import(specifier)) {
  try {
    const tier = await load(RECOGNISER_SOURCES.tier);
    const author = await load(RECOGNISER_SOURCES.author);
    const bot = author?.FLEET_BOT_LOGIN;
    const found = {
      locate: tier?.locateReviewOfRecord,
      deliveredCard: tier?.deliveredCardNumber,
      // Every card the pull names (the arm's card conjunct reads the `security` label on each, not on the one above).
      namedCards: tier?.namedCardNumbers,
      servedTierStands: tier?.servedTierStands,
      isModelIdentifierToken: tier?.isModelIdentifierToken,
      reviewFace: tier?.reviewFace,
      threads: tier?.REVIEW_OF_RECORD_THREADS,
      location: tier?.REVIEW_OF_RECORD_LOCATION,
      // The record's whole reading (#33541, #33604): its `VERDICT:` lines, its FAIL spellings and its
      // must-fix / should-fix grades — a Tier S entry lands on one PASS line, no FAIL, no open grade.
      reading: tier?.contractReviewRecordReading,
      // Who may post a record (#33541): the relay's identity and the authorized approvers, nobody else.
      trustedAuthors: recordTrustedAuthors(bot),
    };
    const missing = [
      ...['locate', 'deliveredCard', 'namedCards', 'servedTierStands', 'isModelIdentifierToken', 'reviewFace', 'reading'].filter((key) => typeof found[key] !== 'function'),
      ...(found.trustedAuthors === null ? [`trustedAuthors (FLEET_BOT_LOGIN from ${RECOGNISER_SOURCES.author})`] : []),
      ...(Array.isArray(found.threads) && found.threads.length > 0 ? [] : ['threads']),
      ...(typeof found.location === 'string' && found.location.length > 0 ? [] : ['location']),
    ];
    if (missing.length > 0) {
      return {
        available: false,
        reason:
          `the contract-review recognisers loaded but did not export what this leg reads (${missing.join(', ')}) — ` +
          `they live in ${RECOGNISER_SOURCES.tier}, and a rename is the likely cause. ⛔ The repair is to follow ` +
          'the rename, never to write a second parser here',
      };
    }
    return { available: true, ...found };
  } catch (error) {
    return {
      available: false,
      reason: `the contract-review recognisers would not load: ${String(error?.message ?? error).split('\n')[0]}`,
    };
  }
}

/**
 * What the pair's THREADS say about the review of record on this head.
 *
 * Pure — the rows and the head arrive as data, so every branch is offline-
 * testable and the battery drives all five.
 *
 * @returns {{ state: 'unreadable', reason: string, cardNote: string|null }
 *          | { state: 'absent', read: object, cardNote: string|null }
 *          | { state: 'unsigned'|'below-tier'|'stands', where: string, id: number|null, at: string|null, sha: string, served: object, cardNote: string|null }}
 *
 * Five-valued, and the split is the file's usual one: `unreadable` is "we could
 * not find out" (exit 4's fact), the other refusals are "it is not there or does
 * not stand" (exit 3's). ⛔ Never fold them: a thread nobody could read and a
 * thread with no record in it earn different remedies.
 *
 * ⭐ THE FILTER IS NOT SPELLED HERE ANY MORE, and that is the whole of #18701.
 * It used to be — two lines, for `latestContractReviewOnHead`'s own documented
 * reason (that finder returns an id and not the ROW, and the row is what the
 * tier line is read from) — and the copy was correct about every fact it read.
 * What it could not copy was the SET OF THREADS to read them over: the rule puts
 * the record 「一条评论落 PR 或卡」 and this leg searched the pull request's
 * thread alone, so a record posted where the governed text, this file's sibling
 * and its own `--template` all say it may live was read as no record at all.
 * Measured: PR #18689, dequeued `CI_FAILURE` with 「0 comment(s) read on the PR
 * thread」 against a record sitting on card #18426, cured only by a second copy.
 *
 * So the whole reading is now `locateReviewOfRecord`, imported from the file
 * that composes it. Two tools, one derivation of "the record on
 * this head", and the thread set travels inside it rather than beside it. What
 * is left here is the TIER gate on top of it, which is this leg's own fact:
 * whether the record's `Served-tier:` stands, and whether its token is a model
 * identifier that ⛔ must never be quoted back (#18060).
 *
 * ⭐ WHICH tier it must stand at is the FACE's (ruling record 6159870311 on
 * #23352, letter B′ with C): `reviewFace`, imported with the rest, reads the
 * pair's `paths` — the pull request's paths out of the merge group's committed
 * trees, the list this leg already classified as governed — and the record
 * stands only at the exact NAME that face maps to. On this leg every entry is
 * governed, so the face is governed rules text and the name is
 * `CONTRACT_REVIEW_TIER`; the mapping is read rather than assumed, so the leg
 * and the rule cannot drift. ⛔ A pair that carries no path list cannot say
 * which face it is on: UNREADABLE, never the cheaper tier.
 */
export function recordVerdict({ pair, recognisers, cardNote = null }) {
  if (recognisers?.available !== true) {
    return { state: 'unreadable', reason: recognisers?.reason ?? 'the contract-review recognisers were not loaded', cardNote };
  }
  if (!Array.isArray(pair?.paths) || pair.paths.length === 0) {
    return {
      state: 'unreadable',
      cardNote,
      reason:
        `PR #${pair?.pr}'s file list was not handed to the record reading, so the face that made its review owed — ` +
        'and with it the one tier the record must stand at — is unknown',
    };
  }
  // `declaredOn` (the narrowed leg hands it in): the texts a `Clause-②:` line is read from, which decide the face
  // where the paths decide none. Absent on every governed entry, whose paths already decided — the call is unchanged.
  // ⭐ `narrowingDeclared` (the narrowed leg sets it, having FOUND a declaration with its own readers): the face is
  // held to the narrowing one wherever the paths decide none. `reviewFace` reads the `Clause-②:` arm alone, so a
  // narrowing declared on the `Metadata-protocol:` line — beside a bare, an absent or a malformed clause line — would
  // otherwise land on the declaration face's cheaper tier, or on no face at all. It is handed the one spelling it
  // reads as that arm; a narrowing arm on any text decides before a malformed line is looked at.
  const declaredOn = Array.isArray(pair.declaredOn) ? (pair.narrowingDeclared === true ? [NARROWING_FACE_LINE, ...pair.declaredOn] : pair.declaredOn) : null;
  const face = declaredOn === null ? recognisers.reviewFace(pair.paths, pair.repo) : recognisers.reviewFace(pair.paths, pair.repo, { declaredOn });
  const located = recognisers.locate(pair);
  if (located.state === 'unreadable') {
    return {
      state: 'unreadable',
      cardNote,
      reason:
        `${located.gaps.join(', ')} could not be read — a review of record NAMES a head and lives on one of ` +
        `${recognisers.location}, so a head or a thread this guard could not read can find no record`,
    };
  }
  if (located.state === 'absent') {
    return {
      state: 'absent',
      read: located.read,
      // Rendered HERE, where the thread set is in hand: the renderer is pure and
      // synchronous and holds no recogniser, so a count it formatted itself
      // would be a second place naming the threads.
      readSummary: recognisers.threads.map((thread) => `${located.read[thread.number] ?? 0} on ${thread.words}`).join(' and '),
      cardNote,
    };
  }

  const found = {
    where: located.where,
    id: located.id ?? null,
    at: located.at ?? null,
    sha: located.sha,
    served: located.served,
    // The face this pull request's paths put the review on, and the ONE tier NAME it stands at.
    face: face.face,
    tierName: face.tierName,
    cardNote,
    // ⭐ Decided HERE and carried, so the renderer never re-decides it and can
    // never print a token it should not (#18060): the accepted token is the
    // constant's NAME, and a token of model-identifier shape is refused AND
    // ⛔ never quoted back — a refusal that quotes it lands the identifier in
    // one more artifact, which is the thing `AGENTS.md` forbids of a comment.
    servedIsIdentifier: located.served?.state === 'read' && recognisers.isModelIdentifierToken(located.served.value),
    // ⭐ A record reached through the 纯重生成 carry names an OLDER head, so the
    // clear says which head was reviewed and over how many certified hops: ⛔ a
    // verdict may not deny its own evidence (#15406).
    carriedFrom: located.carriedFrom ?? null,
    carriedHops: located.carriedHops ?? 0,
  };
  if (located.state === 'unsigned') return { state: 'unsigned', ...found };
  if (!recognisers.servedTierStands(located.served, face.tierName)) return { state: 'below-tier', ...found };
  return { state: 'stands', ...found };
}

/**
 * The pull-request number a merge-queue head ref names, or null.
 *
 * GitHub writes `refs/heads/gh-readonly-queue/<base>/pr-<N>-<base_sha>`. The
 * `gh-readonly-queue/` segment is required rather than decorative: a plain
 * branch called `pr-12-abcdef1` is not a merge-queue ref, and reading one as a
 * PR number would attribute a diff to a pull request that has nothing to do
 * with it. ⚠️ In a MULTI-PR group this names only the LAST pull request — see
 * the header; it is a fallback for single-commit groups, never the key the
 * whole group is judged on.
 *
 * The base-branch segment is `.+` rather than `[^/]+` because a base branch
 * may itself contain slashes (`release/v5`), and the first draft's `[^/]+` read
 * such a ref as "not a queue ref at all" — which on the `merge_group` leg is
 * the fail-OPEN direction: no named pull, so a single-commit group whose
 * subject named no PR would have gone UNATTRIBUTED instead of being checked.
 * The trailing `pr-<n>-<sha>` anchor is what makes the greedy match safe.
 */
export function pullNumberFromQueueRef(ref) {
  const m = /(?:^|\/)gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]{7,40}$/.exec(String(ref ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * The shas and pull identity a workflow event carries. Pure, so every branch —
 * including the malformed payloads — is offline-testable.
 *
 * `ok: false` is never a quiet default: an event this guard cannot read is
 * `EXIT_CANNOT_RUN`, because "I could not tell what was being merged" must not
 * render as "nothing governed was being merged".
 */
export function resolveEventContext({ eventName, payload }) {
  if (eventName === EVENT_MERGE_GROUP) {
    const group = payload?.merge_group;
    if (!group?.base_sha || !group?.head_sha) {
      return { ok: false, reason: 'the merge_group payload carries no base_sha/head_sha — nothing to diff' };
    }
    return {
      ok: true,
      event: EVENT_MERGE_GROUP,
      baseSha: group.base_sha,
      headSha: group.head_sha,
      namedPull: pullNumberFromQueueRef(group.head_ref),
      label: `merge group on ${group.base_ref ?? 'main'}`,
    };
  }
  if (eventName === EVENT_PULL_REQUEST) {
    const pull = payload?.pull_request;
    if (!pull?.number || !pull?.base?.sha || !pull?.head?.sha) {
      return { ok: false, reason: 'the pull_request payload carries no number/base.sha/head.sha — nothing to diff' };
    }
    return {
      ok: true,
      event: EVENT_PULL_REQUEST,
      baseSha: pull.base.sha,
      headSha: pull.head.sha,
      namedPull: Number(pull.number),
      draft: pull.draft === true,
      label: `pull request #${pull.number}`,
    };
  }
  return {
    ok: false,
    reason:
      `unsupported event '${eventName ?? '(none)'}' — this guard reads ${EVENT_MERGE_GROUP} (the refusal) and ` +
      `${EVENT_PULL_REQUEST} (the early warning) only`,
  };
}

/**
 * The repository this guard judges — the one its workflow runs in, read off
 * `GITHUB_REPOSITORY` and resolved to a `GOVERNED_REPOS` id; this file's own
 * repository when the variable is unset (a local run). The register is scoped
 * per row, so every question below carries it: a sibling copy of this guard
 * running in `objectui` judges objectui's rows, and a run in a repository the
 * register does not know REFUSES (exit 1) rather than judging it against some
 * other repository's rows — a wrong scope reads exactly like a clear diff.
 * Pure. Returns `{ repo, slug, source }` or `{ error }`.
 */
export function guardRepository(env = {}) {
  const raw = String(env?.GITHUB_REPOSITORY ?? '').trim();
  const self = GOVERNED_REPOS.find((r) => r.id === SELF_REPO_ID);
  const slug = raw === '' ? self.slug : raw;
  const repo = repoIdForSlug(slug);
  if (repo !== null) return { repo, slug, source: raw === '' ? 'this file\'s own repository' : 'GITHUB_REPOSITORY' };
  return {
    error:
      `GITHUB_REPOSITORY names ${slug}, which is not a governed repository (${GOVERNED_REPOS.map((r) => r.id).join(', ')}). ` +
      'The register is scoped per row, so this guard judges a diff against the rows that govern ONE repository and ' +
      'has none for this one — it refuses rather than judging the diff against another repository\'s rows.',
  };
}

/**
 * Split the work in a diff into the pull requests that touched a governed
 * surface, plus the governed work no pull request can be found for.
 *
 * Pure. `rows` are `{ sha, subject, pr, paths }` — one per first-parent commit
 * in a merge group, or one synthetic row for a `pull_request` run. A row whose
 * paths hit nothing governed is dropped entirely and costs nothing downstream;
 * that is what makes "a clear diff makes no API call" a property of the data
 * flow rather than a promise in a comment.
 */
export function decomposeGovernedWork(rows, repo) {
  assertGovernedRepo(repo, 'decomposeGovernedWork');
  const byPull = new Map();
  const unattributed = [];
  // ⭐ EVERY path of every attributed row, governed or not, per PR — the low-risk
  // skills arm's allowlist reads the whole diff (#33501). Collected BEFORE the
  // governed filter below drops a row, so an ungoverned commit of the same PR
  // (a `packages/**` edit in a commit of its own) still counts against the arm.
  const allByPull = new Map();
  // ⭐ And every changeset each commit of the PR touches, with the commit it is read at: the arm reads
  // each one's committed text, so a changeset in an ungoverned commit counts too.
  const changesetsByPull = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.pr !== 'number' || !Number.isInteger(row.pr) || row.pr <= 0) continue;
    const all = allByPull.get(row.pr) ?? new Set();
    const refs = changesetsByPull.get(row.pr) ?? [];
    for (const p of Array.isArray(row.paths) ? row.paths : []) {
      if (typeof p !== 'string' || p === '') continue;
      all.add(p);
      if (LOW_RISK_CHANGESET_PATH.test(p)) refs.push({ sha: row.sha ?? null, path: p });
    }
    allByPull.set(row.pr, all);
    changesetsByPull.set(row.pr, refs);
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const surfaces = governedPathsIn(row?.paths ?? [], repo);
    if (surfaces.length === 0) continue;
    const paths = surfaces.flatMap((s) => s.files);
    if (typeof row.pr !== 'number' || !Number.isInteger(row.pr) || row.pr <= 0) {
      unattributed.push({ sha: row.sha ?? null, subject: row.subject ?? '', paths });
      continue;
    }
    const seen = byPull.get(row.pr) ?? { pr: row.pr, paths: new Set(), shas: [], workflowReadings: [] };
    for (const p of paths) seen.paths.add(p);
    if (row.sha) seen.shas.push(row.sha);
    // The `workflows` split (ruling record 6722205630): every commit of this PR that touches a workflow
    // path hands its reading in; one it did not read is UNMEASURED, so the entry stays Tier H.
    if (paths.some((p) => p.startsWith(WORKFLOWS_PREFIX))) {
      seen.workflowReadings.push(row.workflowDiff ?? { measured: false, reason: `the workflow diff of ${String(row.sha ?? 'a commit').slice(0, 12)} was not read`, files: [] });
    }
    byPull.set(row.pr, seen);
  }
  const governed = [...byPull.values()]
    .map((entry) => {
      const paths = [...entry.paths];
      const workflowDiff = mergeWorkflowReadings(entry.workflowReadings);
      // The landing TIER travels with the entry (#18020), derived from the
      // SAME governed path list the verdict is judged on — never from the raw
      // diff, which carries files the register does not govern at all — and,
      // for the `workflows` row, from the reading of its diff (the split).
      // The low-risk skills arm (#33501) needs the PR body and labels, which no
      // row carries: here it is NOT MEASURED, so a catalog path is Tier H; the
      // queue leg re-reads the tier with `readLowRiskTier` once the pull is read.
      // The `.claude/**` declaration split (2026-11-19) reads the same body and, second, the
      // record: NOT MEASURED here, so an instruction-tree path is Tier H until that read.
      return {
        pr: entry.pr,
        shas: entry.shas,
        paths,
        allPaths: [...(allByPull.get(entry.pr) ?? entry.paths)],
        changesetRefs: changesetsByPull.get(entry.pr) ?? [],
        workflowDiff,
        surfaces: applyRuleChangeSplit(applyLowRiskArm(applyWorkflowSplit(governedPathsIn(paths, repo), repo, workflowDiff), repo, null), repo, null),
        tier: governedTierFor(paths, repo, GOVERNED_SURFACES, workflowDiff, null),
      };
    })
    .sort((a, b) => a.pr - b.pr);
  return { governed, unattributed };
}

/**
 * Does an APPROVED review exist on this pull request?
 *
 * The reduction is LATEST-DECISIVE-PER-REVIEWER, matching how GitHub itself
 * computes a review decision: `COMMENTED` and `PENDING` carry no decision, and
 * a `DISMISSED` approval is not an approval any more. A reviewer who approved
 * and later requested changes must not still read as an approver — the naive
 * `reviews.some(r => r.state === 'APPROVED')` gets that wrong in the
 * fail-open direction, which is the one direction this file may not be wrong in.
 *
 * Pure; the array is expected in GitHub's chronological order, so last wins.
 */
export function approvalVerdict(reviews) {
  const decisive = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);
  const latest = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const state = String(review?.state ?? '').toUpperCase();
    if (!decisive.has(state)) continue;
    const login = review?.user?.login ?? `(unknown:${review?.id ?? latest.size})`;
    latest.set(login, state);
  }
  const approvers = [...latest].filter(([, state]) => state === 'APPROVED').map(([login]) => login);
  const changesRequestedBy = [...latest].filter(([, state]) => state === 'CHANGES_REQUESTED').map(([login]) => login);
  return {
    state: approvers.length > 0 ? 'approved' : 'unapproved',
    approvers,
    changesRequestedBy,
    reviewsRead: Array.isArray(reviews) ? reviews.length : 0,
  };
}

/**
 * The `merge_group` predicate (2026-09-04 ruling — see the header): does an
 * account in `GOVERNED_APPROVERS` hold a latest-decisive APPROVED review?
 * `commit_id` is not part of that question — 「只需要有人工批准记录就行，不需要
 * 卡最新的提交。」
 *
 * Same latest-decisive-per-reviewer reduction as `approvalVerdict` — a
 * DISMISSED or superseded approval is not an approval — with one way left to
 * not count: `unauthorizedApprovers` (APPROVED, not in the set).
 *
 * `approvalsOnEarlierCommits` is A PRINTED READING and nothing more: authorized
 * approvals given on a commit that is no longer the head. They are in
 * `approvers` too — they COUNT — and the bucket exists so a queue log can name
 * the commit an approval was given on, which is where the accepted cost of this
 * ruling becomes visible at the moment it is paid. ⛔ Never branch a verdict on
 * it. When the head could not be read the bucket is empty: "we did not look" is
 * not "the same commit", and neither one is a refusal any more.
 *
 * ⚠️ It was `staleApprovers` under the sha pin, and is deliberately NOT called
 * that any more. A bucket still named for a refusal is one a later reader
 * re-derives a refusal from — the same reason this function is no longer called
 * `pinnedApprovalVerdict`. Renaming a predicate is cheap; leaving a retired
 * rule's vocabulary lying around next to a live one is not.
 *
 * ⭐ BOTH RENAMES LANDED WITH THEIR IMPORTER, in one commit. At the time a
 * seat-side PreToolUse enqueue hook imported this function and read that bucket
 * off its result — the "⛔ no second mechanism" design paying off, since its
 * verdict flipped with this ruling for free and it needed no predicate of its
 * own. That client-side hook has since been REMOVED by ruling (it only ever
 * saved a queue cycle; this file's `merge_group` refusal is the line), so the
 * queue leg in this file is now this function's only consumer. The two names
 * are still this module's exported contract: ⛔ never rename either without
 * grepping for importers in the same diff — an importer that catches the
 * resulting failure and ALLOWS is a silent hole, which is exactly what the old
 * hook would have become.
 *
 * Pure; the array is expected in GitHub's chronological order, so last wins.
 */
export function authorizedApprovalVerdict(reviews, headSha) {
  const decisive = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);
  const latest = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const state = String(review?.state ?? '').toUpperCase();
    if (!decisive.has(state)) continue;
    const login = review?.user?.login ?? `(unknown:${review?.id ?? latest.size})`;
    latest.set(login, { state, commitId: String(review?.commit_id ?? '').toLowerCase() });
  }
  const head = /^[0-9a-f]{7,40}$/.test(String(headSha ?? '').toLowerCase()) ? String(headSha).toLowerCase() : null;
  const approvers = [];
  const approvals = [];
  const approvalsOnEarlierCommits = [];
  const unauthorizedApprovers = [];
  for (const [login, review] of latest) {
    if (review.state !== 'APPROVED') continue;
    if (!GOVERNED_APPROVERS.includes(login)) {
      unauthorizedApprovers.push(login);
      continue;
    }
    // The whole 2026-09-04 ruling in one statement: authorized + APPROVED is
    // the verdict, and `commit_id` is not consulted to reach it.
    approvers.push(login);
    // ⭐ `approvals` is the SAME set with the commit each was given on — the
    // field the sibling's `sizeLiftFrom` reads (2026-09-27), and the one the
    // generic `approvalVerdict` deliberately does not carry: only a verdict
    // that asked WHO approved can lift the SIZE limb, and this is that verdict.
    approvals.push({ login, commitId: review.commitId });
    // ...and then, separately, the reading the log prints. It changes nothing.
    if (head !== null && review.commitId !== head) approvalsOnEarlierCommits.push({ login, commitId: review.commitId });
  }
  return {
    state: approvers.length > 0 ? 'approved' : 'unapproved',
    approvers,
    approvals,
    approvalsOnEarlierCommits,
    unauthorizedApprovers,
    changesRequestedBy: [...latest].filter(([, r]) => r.state === 'CHANGES_REQUESTED').map(([login]) => login),
    reviewsRead: Array.isArray(reviews) ? reviews.length : 0,
    headSha: head ?? String(headSha ?? ''),
  };
}

/** The refusal an unreadable PR head or review list produces. Never a pass — see the header. */
export function unreadableApproval(reason) {
  return { state: 'unreadable', approvers: [], changesRequestedBy: [], reviewsRead: 0, reason: String(reason ?? 'unknown error') };
}

// ── the ENQUEUE leg (maintainer ruling 2026-10-26 — see the header) ────────

/** The timeline events a queue entry starts and ends with. Measured on this repository, 2026-10-26. */
export const ENQUEUE_EVENT = 'added_to_merge_queue';
export const DEQUEUE_EVENT = 'removed_from_merge_queue';

/**
 * WHO put this pull request into the queue, read off its timeline. Pure; the
 * array is expected in GitHub's chronological order, so last wins.
 *
 * The answer is the actor of the NEWEST `added_to_merge_queue` event, and only
 * while no `removed_from_merge_queue` follows it. A newest queue event that is
 * a REMOVAL means the timeline has not recorded the entry this build judges
 * yet, and the add before it belongs to an entry that already left: reading
 * its actor would carry an earlier enqueue (the maintainer's, say) onto a
 * re-entry somebody else made. So that shape, no add at all, and an add whose
 * actor names no login are all UNDETERMINED — never a reading.
 */
export function enqueuerFromTimeline(events) {
  if (!Array.isArray(events)) return undeterminedEnqueue('the timeline was not a list of events');
  let newest = null;
  for (const event of events) {
    const kind = String(event?.event ?? '');
    if (kind === ENQUEUE_EVENT || kind === DEQUEUE_EVENT) newest = event;
  }
  if (newest === null) return undeterminedEnqueue(`the timeline carries no \`${ENQUEUE_EVENT}\` event`);
  if (newest.event === DEQUEUE_EVENT) {
    return undeterminedEnqueue(`the newest queue event on the timeline is \`${DEQUEUE_EVENT}\`, so the entry this build judges is not recorded there yet`);
  }
  const login = typeof newest.actor?.login === 'string' && newest.actor.login !== '' ? newest.actor.login : null;
  if (login === null) return undeterminedEnqueue(`the newest \`${ENQUEUE_EVENT}\` event names no actor`);
  return { state: 'read', login, at: typeof newest.created_at === 'string' ? newest.created_at : null };
}

/**
 * The enqueue leg's verdict: was this queue entry made by an account in
 * `GOVERNED_APPROVERS`? Pure. `authorized` satisfies a governed entry exactly
 * as an authorized APPROVED review does; `unauthorized` and `undetermined`
 * satisfy nothing and leave the approval leg to decide alone — an enqueuer
 * that could not be read is never a pass, and never a refusal of its own.
 */
export function authorizedEnqueueVerdict(reading) {
  if (reading?.state !== 'read') return undeterminedEnqueue(reading?.reason ?? 'no enqueuer reading was recorded');
  return {
    state: GOVERNED_APPROVERS.includes(reading.login) ? 'authorized' : 'unauthorized',
    login: reading.login,
    at: reading.at ?? null,
  };
}

/** The enqueue reading a throw, an unusable timeline or a missing reader produces. Never a pass. */
export function undeterminedEnqueue(reason) {
  return { state: 'undetermined', login: null, at: null, reason: String(reason ?? 'unknown error') };
}

/**
 * Is this governed pull request SATISFIED?
 *
 * ⭐ The approval limb is first and is unchanged, which is what makes the two
 * limbs after it MONOTONE: an entry the 2026-09-04 predicate already cleared is
 * cleared here by the same reading, at the same cost, in the same words. The
 * enqueue limb (2026-10-26) and the tier limb can only ADD a pass — the enqueue
 * limb only on an entry whose `enqueue` key exists (merge_group), the tier limb
 * only on one whose `record` key exists (merge_group, Tier S). ⛔ Never reorder
 * them: a record consulted ahead of an approval or of the maintainer's own
 * enqueue would let a seat's own review displace a maintainer's act.
 */
export function entrySatisfied(entry) {
  if (entry?.approval?.state === 'approved') return true;
  if (entry?.enqueue?.state === 'authorized') return true;
  return entry?.tier === TIER_S && entry?.record?.state === 'stands';
}

/** Which leg satisfied a satisfied entry, for the log and the size lift: `review`, `enqueue`, `record`, or null. Pure. */
export function satisfiedBy(entry) {
  if (entry?.approval?.state === 'approved') return 'review';
  if (entry?.enqueue?.state === 'authorized') return 'enqueue';
  if (entry?.tier === TIER_S && entry?.record?.state === 'stands') return 'record';
  return null;
}

/**
 * Was this entry's dissatisfaction a "could not find out" rather than a "no"?
 * Exit 4's fact, and it reaches the tier leg for the reason it reaches the
 * approval leg: a thread, a head or a recogniser set this guard could not read
 * is not a record that is absent.
 */
export function entryUnreadable(entry) {
  if (entry?.approval?.state === 'unreadable') return true;
  if (entry?.tier === TIER_S && entry?.record?.state === 'unreadable') return true;
  // The declaration split (2026-11-19): a body this leg could not read decides nothing, which is not a `no`.
  return declarationUnread(entry);
}

/**
 * Is this entry Tier H ONLY because the `.claude/**` declaration split had no body to read — no reading at all on
 * the early-warning leg, or a pull request the queue leg could not read — every other row hit being Tier S? Such
 * an entry's tier is not yet known: the words say so, and on the queue leg it refuses as UNREADABLE. An entry a
 * hook, a settings file or any Tier H row decides is not one: its tier was read. Pure.
 */
export function declarationUnread(entry) {
  const surfaces = Array.isArray(entry?.surfaces) ? entry.surfaces : [];
  const unread = (s) => s?.ruleChangeVerdict?.measured === false;
  return entry?.tier !== TIER_S && surfaces.some(unread) && surfaces.every((s) => unread(s) || s?.tier === TIER_S);
}

/**
 * The verdict, as data. Pure — every branch of the decision is here, and the
 * renderer and the exit code both read it rather than re-deriving it.
 */
export function guardVerdict({ event, repo, governed = [], unattributed = [], approvals = new Map(), enqueues = new Map(), records = new Map(), apiCalls = 0, headNotes = [], lifted = [] }) {
  assertGovernedRepo(repo, 'guardVerdict');
  const entries = governed.map((entry) => ({
    ...entry,
    approval: approvals.get(entry.pr) ?? unreadableApproval('no review reading was recorded for this pull request'),
    // ⭐ The enqueue key EXISTS only on the queue leg (2026-10-26), and there
    // only where the leg was consulted — an entry the authorized approval
    // already cleared carries none, because none was read. The `pull_request`
    // run has no queue entry at all, so its rendering stays free of the line by
    // construction, the way the record key's does.
    ...(event === EVENT_MERGE_GROUP && (enqueues.has(entry.pr) || approvals.get(entry.pr)?.state !== 'approved')
      ? { enqueue: enqueues.get(entry.pr) ?? undeterminedEnqueue('no enqueuer reading was recorded for this pull request') }
      : {}),
    // ⭐ The record key EXISTS only where the tier leg ran — merge_group, on a
    // Tier S entry. That is not a nicety: the `pull_request` leg's record
    // block is absent BY CONSTRUCTION, since the renderer can only print what
    // the key's presence lets it see (the tier LINE itself prints on both legs).
    ...(event === EVENT_MERGE_GROUP && entry.tier === TIER_S
      ? { record: records.get(entry.pr) ?? { state: 'unreadable', reason: 'no record reading was recorded for this pull request' } }
      : {}),
  }));
  const base = { event, repo, entries, unattributed, apiCalls, headNotes, lifted, contextName: CHECK_CONTEXT_NAME };

  if (entries.length === 0 && unattributed.length === 0) {
    return { ...base, conclusion: 'clear', exitCode: EXIT_CLEAR, refusalKind: null };
  }
  // The early-warning run never reddens: a governed PR parked in draft while it
  // waits for an authorized approval is the regime's healthy resting state, and
  // a check that is red on the healthy case is the retired gate rebuilt (see
  // header). What follows that approval is ruling C: the claiming seat lands it.
  if (event !== EVENT_MERGE_GROUP) {
    return { ...base, conclusion: 'warned', exitCode: EXIT_CLEAR, refusalKind: null };
  }
  if (unattributed.length > 0) {
    return { ...base, conclusion: 'refused', exitCode: EXIT_REFUSED_UNATTRIBUTED, refusalKind: 'unattributed' };
  }
  if (entries.some((e) => !entrySatisfied(e) && entryUnreadable(e))) {
    return { ...base, conclusion: 'refused', exitCode: EXIT_REFUSED_UNREADABLE, refusalKind: 'unreadable' };
  }
  if (entries.some((e) => !entrySatisfied(e))) {
    return { ...base, conclusion: 'refused', exitCode: EXIT_REFUSED_UNAPPROVED, refusalKind: 'unapproved' };
  }
  return { ...base, conclusion: 'cleared', exitCode: EXIT_CLEAR, refusalKind: null };
}

/**
 * The words a reader gets. Requirement (e) of the card lives here: every
 * rendering names the exact paths that matched and states what would satisfy
 * the guard — a refusal a reader cannot act on is a refusal they route around.
 */
export function renderGuardVerdict(verdict) {
  const lines = [];
  const surfaceLines = (entry) =>
    entry.surfaces.flatMap((s) => [
      `        ${s.glob} ×${s.files.length} — ${s.what}`,
      ...s.files.slice(0, 12).map((f) => `          - ${f}`),
      ...(s.files.length > 12 ? [`          … and ${s.files.length - 12} more`] : []),
    ]);
  // ⚖️ The landing tier and what it waits for (#19133), printed on BOTH legs so
  // the early warning names the tier as the card requires. The queue leg's
  // record block follows it where the record key exists.
  const tierLines = (entry) =>
    declarationUnread(entry)
      ? [
          '        ⚖️ landing tier: H(人合) UNTIL the PR body is read — nothing here read it. Every governed path above lies under',
          `           ${tierSGlobs()}, which splits by declaration (2026-11-19): it lands Tier S(席内达档 L2 审核落地) when the body`,
          '           carries one bare `Rule-change: none` (or `Rule-change: ruled` beside a `Ruling-ref:` line quoting the ruling)',
          `           and a \`## Contract review\` comment on ${REVIEW_OF_RECORD_LOCATION} naming the CURRENT head — \`Served-tier:`,
          '           CONTRACT_REVIEW_TIER`, `**VERDICT: PASS**` — reads the same value on its `Rule-change-verified:` line.',
          '           A missing line or `Rule-change: yes` is Tier H: the maintainer\'s hand or an authorized APPROVED review',
          `           (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')}). The queue leg reads the body and the record;`,
          '           `node scripts/pm/check-governed-merges.mjs --pr <n>` reads them now.',
        ]
      : entry.tier === TIER_S
      ? [
          `        ⚖️ landing tier: S(席内达档 L2 审核落地) — every governed path above lies under a Tier S surface (${tierSGlobs()}),`,
          '           so a review of record on the CURRENT head lands it in place of an authorized approval: a `## Contract',
          `           review\` comment on ${REVIEW_OF_RECORD_LOCATION} naming this head, \`Served-tier: CONTRACT_REVIEW_TIER\`,`,
          '           `**VERDICT: PASS**` and every check green; then the OWNING seat',
          '           lands it (#19133, maintainer 2026-09-18 「同意改规则。」). One Tier H path here and this line would read H.',
        ]
      : [
          '        ⚖️ landing tier: H(人合) — waits for the maintainer\'s hand or an authorized APPROVED review',
          `           (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')}); then the OWNING seat lands it. No review of record`,
          '           substitutes here: one Tier H path in the diff and the whole pull request is Tier H.',
        ];

  // ⚠️ The `pull_request` leg's wording is BYTE-IDENTICAL to the pre-pinning
  // guard (the 2026-08-27 card's own constraint) — only the queue leg, where
  // the head read exists, labels its API traffic differently.
  const apiLabel = verdict.event === EVENT_MERGE_GROUP ? 'API read(s) (PR head + reviews)' : 'review lookup(s)';
  lines.push(
    `${CHECK_CONTEXT_NAME} — ${verdict.event} — ${verdict.entries.length} governed pull request(s), ` +
      `${verdict.unattributed.length} unattributed governed commit(s), ${verdict.apiCalls} ${apiLabel}.`,
  );

  if (verdict.conclusion === 'clear') {
    // ⭐ TWO DIFFERENT CLEARS, and #15406 is what conflating them costs. The
    // wording below used to be unconditional, so a run in which the register
    // LIFTED a governed path printed "the diff touches no governed surface"
    // immediately under its own LIFTED line — and "the path test runs first and
    // returns", when the path test had matched and the register's recompute had
    // run. A landing read back from that log looks like a guard that never saw
    // the file, which is exactly the reading the post-merge audit was filed on.
    // A verdict may not deny its own evidence: the zero-cost clear keeps its
    // wording BYTE-FOR-BYTE (both legs, so the pull_request leg's byte-identity
    // constraint is untouched), and a clear reached THROUGH a lift says so.
    const lifted = verdict.lifted ?? [];
    if (lifted.length === 0) {
      lines.push(
        '  ✅  CLEAR — the diff touches no governed surface, so this guard has nothing to judge.',
        `      Derived from GOVERNED_SURFACES in scripts/pm/check-governed-merges.mjs (${governedSurfacesFor(verdict.repo).length} surfaces govern ${verdict.repo}),`,
        '      never from a restated list. ⛔ ZERO review lookups were made: the path test runs first and returns,',
        '      so a GitHub API outage can never block a diff that touches nothing governed.',
      );
      // ⭐ #15406's lesson applied rather than re-learned: a verdict may not
      // deny its own evidence. The three lines above are byte-identical and
      // stay that way — the `pull_request` leg's byte-identity constraint
      // (2026-08-27) reaches them, and that leg does not run the size read at
      // all. But on `merge_group` this file DOES make an unconditional API
      // call, so the last of those lines would otherwise be a claim this run has
      // already falsified. It is scoped here instead of rewritten.
      if (verdict.event === EVENT_MERGE_GROUP) {
        lines.push(
          '      ⚠️ Scoped to the GOVERNED-SURFACE leg. On merge_group this file ALSO reads every queued pull request',
          '      for its SIZE — one pull read each, plus a review read for one over the line, fail-closed — and',
          '      that leg reports separately below.',
          '      An outage there DOES refuse this merge group.',
        );
      }
      return lines.join('\n');
    }
    lines.push(
      '  ✅  CLEAR — this diff DID touch a governed surface, and every hit was LIFTED by the generated-artifact',
      '      register; nothing hand-authored is left for this guard to judge. ⚠️ This is NOT the "no governed',
      '      path in the diff" clear: the path test MATCHED, the register recomputed provenance on this tree,',
      '      and the lift line(s) printed above are that recompute\'s record. Lifted here:',
      ...lifted.slice(0, 12).map((p) => `        - ${p}`),
      ...(lifted.length > 12 ? [`        … and ${lifted.length - 12} more`] : []),
      `      Derived from GOVERNED_SURFACES in scripts/pm/check-governed-merges.mjs (${governedSurfacesFor(verdict.repo).length} surfaces govern ${verdict.repo}),`,
      '      never from a restated list. ⛔ ZERO review lookups were made: the approval predicate is reached only',
      '      by a governed path the register did not lift, and there was none.',
    );
    return lines.join('\n');
  }

  // Readings that were not available. They are notes, never verdict inputs —
  // since 2026-09-04 an unreadable PR head decides nothing, so it is printed
  // here rather than refusing. Empty on a `clear` verdict and on every
  // `pull_request` run, so both of those renderings stay byte-identical.
  for (const note of verdict.headNotes ?? []) lines.push(note);

  // The queue leg's verdict carries `headSha`; the `pull_request` leg's
  // `approvalVerdict` shape does not, and its lines stay byte-identical. ⚠️ The
  // field is the LEG DISCRIMINATOR, not a pin — nothing below decides on it.
  const queueLeg = (approval) => approval.headSha !== undefined;
  for (const entry of verdict.entries) {
    lines.push('', `  #${entry.pr} — governed:`);
    lines.push(...surfaceLines(entry));
    lines.push(...renderWorkflowSplitLines(entry.surfaces).split('\n').filter((l) => l !== '').map((l) => `  ${l}`));
    lines.push(...renderLowRiskLines(entry.surfaces).split('\n').filter((l) => l !== '').map((l) => `  ${l}`));
    lines.push(...renderRuleChangeLines(entry.surfaces).split('\n').filter((l) => l !== '').map((l) => `  ${l}`));
    // The pre-#19133 `pull_request` byte-identity constraint (2026-08-27) is
    // superseded by that ruling's own requirement: the early warning names the
    // tier and what it waits for.
    lines.push(...tierLines(entry));
    if (entry.approval.state === 'approved') {
      lines.push(
        queueLeg(entry.approval)
          ? `        ✅ authorized APPROVED review, by: ${entry.approval.approvers.join(', ')}`
          : `        ✅ APPROVED review present, by: ${entry.approval.approvers.join(', ')}`,
      );
      // The accepted cost of the 2026-09-04 ruling, named where it is paid: the
      // commit this approval was given on, and the head that is no longer it.
      for (const older of queueLeg(entry.approval) ? (entry.approval.approvalsOnEarlierCommits ?? []) : []) {
        lines.push(
          `        ⚠️  ${older.login} approved at ${(older.commitId || '(no commit_id)').slice(0, 12)}, not at the head ` +
            `${String(entry.approval.headSha).slice(0, 12)} — it COUNTS ANYWAY`,
          '            (2026-09-04: 「只需要有人工批准记录就行，不需要卡最新的提交。」). ⛔ This gate did NOT',
          '            re-review the push that moved the head; the post-merge audit is what reads that landing.',
        );
      }
    } else if (entry.enqueue?.state === 'authorized') {
      // ⭐ The ENQUEUE leg (2026-10-26): the log names the leg and the account,
      // so the post-merge audit's "does the maintainer recognise every entry"
      // reads the same fact this guard passed on.
      lines.push(
        `        ✅ enqueued by an authorized account: ${entry.enqueue.login} (\`${ENQUEUE_EVENT}\` at ${entry.enqueue.at ?? 'an undated event'}) —`,
        '           the ENQUEUE leg (maintainer ruling 2026-10-26, 「大部分我还是希望入队，但是我想省掉 Approve」): the',
        '           maintainer\'s own "Merge when ready" IS the human review, so no APPROVED review was owed.',
      );
    } else if (entry.record?.state === 'stands') {
      lines.push(
        `        ✅ review of record on this head: comment ${entry.record.id ?? '(no readable id)'} ` +
          `(${entry.record.at ?? 'undated'}) on the ${entry.record.where} thread is a \`## Contract review\` ` +
          `comment naming \`${entry.record.sha}\`,`,
        `           carrying a \`Reviewed-by:\` line and a \`Served-tier:\` naming \`${entry.record.tierName}\`, the tier its ${entry.record.face} face maps to, which STANDS` +
          (entry.record.served?.stamps
            ? ` on a stamp control of ${entry.record.served.stamps.atTier}/${entry.record.served.stamps.total}.`
            : ' (no stamp control declared, which the rule permits).'),
        ...(entry.record.carriedFrom
          ? [
              `           ⭐ that record names head \`${String(entry.record.carriedFrom).slice(0, 12)}\`, carried forward over ` +
                `${entry.record.carriedHops} certified PURE-REGENERATION or PROSE-ONLY hop(s) —`,
              '           re-run on the COMMITTED trees by this build (`git diff --name-only`: no path left outside the prose',
              '           faces, the `merge=os-regen` artefacts and main\'s carry-over),',
              '           ⛔ never on the `Regen-provenance:` line being present (maintainer 2026-09-20; prose arm: 6159870311).',
            ]
          : []),
        landsOnLowRiskArm(entry)
          ? '           ⚖️ the low-risk skills arm lands on a record that READS PASS, and this one does (#33501).'
          : '           ⚖️ a Tier S entry lands on a record whose one `VERDICT:` line READS PASS, and this one does (#33541).',
        `           Posted by \`${entry.record.author ?? 'a trusted author'}\`: comments by any author outside the relay and GOVERNED_APPROVERS are not read.`,
      );
    } else if (entry.approval.state === 'unreadable') {
      lines.push(`        ⛔ the review list could NOT be read — ${entry.approval.reason}`);
    } else if (queueLeg(entry.approval)) {
      lines.push(
        `        ⛔ NO authorized APPROVED review on this pull request ` +
          `(${entry.approval.reviewsRead} review(s) read; authorized: ${GOVERNED_APPROVERS.join(', ')})`,
        '           An approval on an EARLIER commit would have counted (2026-09-04) — there is none at all.',
      );
      if ((entry.approval.unauthorizedApprovers ?? []).length > 0) {
        lines.push(
          `        ℹ️  APPROVED by account(s) outside GOVERNED_APPROVERS: ${entry.approval.unauthorizedApprovers.join(', ')} — never counts`,
        );
      }
    } else {
      lines.push(`        ⛔ NO approving review (${entry.approval.reviewsRead} review(s) read, none decisive-APPROVED)`);
    }
    if (entry.enqueue !== undefined && !entrySatisfied(entry)) {
      lines.push(
        entry.enqueue.state === 'unauthorized'
          ? `        ⛔ enqueued by ${entry.enqueue.login}, outside GOVERNED_APPROVERS — only an enqueue from an authorized account is the maintainer's hand (2026-10-26)`
          : `        ⛔ enqueuer UNDETERMINED — ${entry.enqueue.reason}; never a pass, so the approval leg above decided alone`,
      );
    }
    if (entry.record !== undefined && entry.record.state !== 'stands' && !entrySatisfied(entry)) {
      const served = entry.record.served ?? null;
      lines.push(
        ...(entry.record.state === 'absent'
          ? [
              `        ⛔ NO review of record on this head either — comment(s) read: ${entry.record.readSummary}`,
              `           (${entry.record.cardNote}); none of them is a \`## Contract review\` comment naming this head`,
              '           and carrying a `Reviewed-by:` line.',
              ...ignoredAuthorLines(entry.record),
            ]
          : entry.record.state === 'unreadable'
            ? [`        ⛔ the review of record could NOT be read — ${entry.record.reason}`]
            : entry.record.state === 'not-pass'
              ? [
                  `        ⛔ the \`## Contract review\` comment on this head (comment ${entry.record.id ?? '(no readable id)'}, ` +
                    `${entry.record.at ?? 'undated'}) does not read PASS: ${entry.record.verdictReason}.`,
                  landsOnLowRiskArm(entry)
                    ? '           The low-risk skills arm lands on a PASS record only (#33501); a FAIL owes a patch and a new review.'
                    : '           A Tier S entry lands on a PASS record only (AGENTS.md Prime Directive 14, #33541); a FAIL owes a patch and a new review.',
                ]
            : entry.record.state === 'unsigned'
              ? [
                  `        ⛔ a \`## Contract review\` comment names this head (comment ${entry.record.id ?? '(no readable id)'}, ` +
                    `${entry.record.at ?? 'undated'}) but carries NO \`Reviewed-by:\` line,`,
                  '           so it names no reviewer and is not a review of record.',
                ]
              : [
                  `        ⛔ the \`## Contract review\` comment on this head (comment ${entry.record.id ?? '(no readable id)'}, ` +
                    `${entry.record.at ?? 'undated'}) does not stand:`,
                  served?.state === 'read' && entry.record.servedIsIdentifier
                    ? `           its \`Served-tier:\` token is a MODEL IDENTIFIER rather than the NAME \`${entry.record.tierName}\` — ` +
                      '⛔ not quoted back\n           here, because `AGENTS.md` lets no model identifier land in a comment and a record IS one.'
                    : served?.state === 'read'
                      ? `           it declares the tier \`${served.value}\`` +
                        (served.stamps
                          ? ` on a stamp control of ${served.stamps.atTier}/${served.stamps.total}`
                          : ' with no stamp control') +
                        `, which is not the NAME \`${entry.record.tierName}\` — the tier its ${entry.record.face} face maps to — on a control that holds.`
                      : served?.state === 'unreadable'
                        ? `           its \`Served-tier:\` line carries no readable tier token (${served.line}).`
                        : '           it carries NO `Served-tier:` line at all, so it declares nothing about what served it.',
                  '           ⛔ The comparison is EXACT and the constant is read from `dispatch-gates.mjs`, never restated',
                  '              here; widening it is the maintainer\'s decision, not this file\'s.',
                ]),
      );
    }
    if (entry.approval.changesRequestedBy.length > 0) {
      lines.push(
        `        ⚠️  outstanding CHANGES_REQUESTED from: ${entry.approval.changesRequestedBy.join(', ')}`,
        ...(queueLeg(entry.approval)
          ? [
              '            (informational — the ruled predicate is one authorized APPROVED review on the pull',
              '             request; this guard does not widen past its own ruling)',
            ]
          : [
              '            (informational — the ruled predicate is "an APPROVED review exists", #8161; this guard',
              '             does not widen past its own ruling)',
            ]),
      );
    }
  }
  for (const row of verdict.unattributed) {
    lines.push(
      '',
      `  ⛔ UNATTRIBUTED — commit ${String(row.sha ?? '(unknown)').slice(0, 12)} touches a governed surface and names no pull request:`,
      `        subject: ${row.subject || '(empty)'}`,
      ...row.paths.slice(0, 12).map((p) => `          - ${p}`),
    );
  }

  lines.push('');
  if (verdict.conclusion === 'warned') {
    // Per tier (#19133): the early warning names which tier each pull request
    // is and what it waits for. A Tier H block and a Tier S block, each printed
    // only when an entry of that tier is present.
    const tierH = verdict.entries.filter((e) => e.tier !== TIER_S);
    const tierS = verdict.entries.filter((e) => e.tier === TIER_S);
    lines.push(
      '  ⚠️  EARLY WARNING, not a failure — this run is on the pull request, and this check is deliberately',
      '      GREEN here. A governed PR parked in draft while it waits for what its tier lands on IS the',
      '      regime\'s healthy resting state (「四件套留 draft 等人批,⛔ 不翻正式不入队」), and a check that',
      '      reddens on the healthy case is the permanently-red gate the 2026-08-18 ruling retired',
      '      (红灯常态化本身有毒). The tier line on each entry above names its tier and what it waits for.',
    );
    if (tierH.length > 0) {
      lines.push(
        '',
        `      ⚖️ Tier H (人合) — ${tierH.map((e) => `#${e.pr}`).join(', ')}:`,
        '      ⛔ What a seat must NOT do with this PR while no authorized APPROVED review is on record:',
        '         flip it ready, enqueue it, or arm auto-merge (AGENTS.md Prime Directive #14 — its four',
        '         prohibitions lift for that approval and for nothing else). One governed path governs the',
        '         whole PR — 「混合 diff 一条命中即整 PR 分叉」; proportion is not a question.',
        '',
        `      ✅ What a seat DOES do once an account in GOVERNED_APPROVERS (${GOVERNED_APPROVERS.join(', ')}) has APPROVED it,`,
        '         on ANY commit: the CLAIMING SEAT lands it — ruling C (#17971, maintainer 2026-09-13, verbatim',
        '         「C. approve 后不管后续改动都由席位落地:」), 「席位落地 = 过落地前检、清标、ready、',
        '         auto-merge,踢出/变基同法。」 Unapproved, its landings are the maintainer\'s own: "Merge when',
        '         ready" from an account in GOVERNED_APPROVERS — that enqueue IS the review (2026-10-26) — or the',
        '         direct merge (人工直合), the Merge button\'s bypass-rules option — offered only while ruleset',
        '         `main` configures a bypass actor (#19344).',
      );
    }
    if (tierS.length > 0) {
      lines.push(
        '',
        `      ⚖️ Tier S (席内达档 L2 审核落地) — ${tierS.map((e) => `#${e.pr}`).join(', ')}: every governed path lies under a Tier S`,
        `         surface (${tierSGlobs()}). ⛔ What a seat must NOT do while no review of record for the CURRENT head is on`,
        '         the thread: flip it ready, enqueue it, or arm auto-merge — and ⛔ no seat submits an approving review',
        '         in its place. ✅ What lifts those: a `## Contract review` comment on',
        `         ${REVIEW_OF_RECORD_LOCATION} naming this head with \`Served-tier: CONTRACT_REVIEW_TIER\` and \`**VERDICT: PASS**\`,`,
        '         and every check green; then the OWNING seat lands it through',
        '         the queue — no maintainer click is waited for (#19133, maintainer 2026-09-18 「同意改规则。」). A record',
        '         on an OLDER head does not carry forward: a record names the head it judged.',
      );
    }
    lines.push(
      '',
      '      If it IS enqueued anyway, the merge-queue run of this same check will REFUSE it unless every',
      '      governed pull request above carries what its tier waits for by then — the approval, the maintainer\'s',
      '      own enqueue from an account in GOVERNED_APPROVERS, or the record.',
    );
    return lines.join('\n');
  }
  if (verdict.conclusion === 'cleared') {
    // ⭐ #15406's lesson again: a verdict may not deny its own evidence, and it
    // may not claim evidence it never read. The sentence below asserts an
    // APPROVED review on EVERY governed pull request, so it is kept for exactly
    // the runs where that is true — byte-for-byte — and a clear reached through
    // the references tier says what actually satisfied it.
    const viaRecord = verdict.entries.filter((e) => satisfiedBy(e) === 'record');
    // ⭐ The ENQUEUE clear (2026-10-26) is a third kind, and says so for the
    // same reason: an entry the maintainer's own enqueue satisfied carries no
    // APPROVED review, so the approval sentence below would be a false claim.
    const viaEnqueue = verdict.entries.filter((e) => satisfiedBy(e) === 'enqueue');
    const enqueueClear = [
      `      The ENQUEUE leg satisfied ${viaEnqueue.length} of them: ${viaEnqueue.map((e) => `#${e.pr} (enqueued by ${e.enqueue.login})`).join(', ')} —`,
      '      each was put in this queue by an account in GOVERNED_APPROVERS, and the maintainer\'s own "Merge when',
      '      ready" IS the human review (maintainer ruling 2026-10-26, 「大部分我还是希望入队，但是我想省掉 Approve」).',
      '      ⛔ No agent seat enqueues or arms auto-merge on an unapproved governed PR, under any account; the',
      '      post-merge audit (`node scripts/pm/check-governed-merges.mjs`) lists these landings and the maintainer',
      '      recognises each enqueuer, exactly as for an approver.',
    ];
    if (viaEnqueue.length > 0 && viaRecord.length === 0) {
      lines.push('  ✅  CLEARED — and NOT every pull request below cleared on an approval.', ...enqueueClear);
      return lines.join('\n');
    }
    if (viaRecord.length > 0) {
      lines.push(
        '  ✅  CLEARED — and NOT every pull request below cleared on an approval. ⚖️ Tier S (#17950\'s references',
        `      path, generalised by #19133, maintainer 2026-09-18 「同意改规则。」) satisfied ${viaRecord.length} of them: ${viaRecord.map((e) => `#${e.pr}`).join(', ')} —`,
        `      every governed path in each lies under a Tier S surface (${tierSGlobs()}), and each carries the owning seat's`,
        '      review of record on its CURRENT head (`## Contract review`, `Reviewed-by:`, a standing `Served-tier:`).',
        '      ⛔ This is NOT the approval clear: no account in GOVERNED_APPROVERS acted on those pull requests, and',
        '      the record above is the entire review. ⚠️ Existence and provenance only — whether it reads PASS is',
        '      precondition ① of the landing check and stays human. Every Tier H path still needs the authorized',
        '      approval; the post-merge audit (`node scripts/pm/check-governed-merges.mjs`) lists these landings',
        '      exactly as it always has, and a Tier S merge without a PASS record is that audit\'s finding.',
        ...enqueueClear.slice(0, viaEnqueue.length > 0 ? enqueueClear.length : 0),
      );
      return lines.join('\n');
    }
    lines.push(
      '  ✅  CLEARED — every governed pull request in this merge group carries an APPROVED review by an',
      `      authorized approver (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')}), on ANY commit — the`,
      '      2026-09-04 ruled predicate (「只需要有人工批准记录就行，不需要卡最新的提交。」), which supersedes',
      "      the sha pin of 2026-08-27; the approver set is 2026-11-17's (「hotlong 从批准账户中去掉，只保留 os-zhuang」).",
      '      A dismissed, superseded or unauthorized approval still never counts. ⚖️ Accepted cost, stated where',
      '      it is paid: a push made after an approval was NOT re-reviewed here. ⛔ An agent seat never submits',
      '      an approving review on a governed-surface PR, under any account. The post-merge audit',
      '      (`node scripts/pm/check-governed-merges.mjs`) remains the detection half, and it reads the',
      '      APPROVER as well as the merger.',
    );
    return lines.join('\n');
  }

  lines.push('  ⛔  REFUSED — this merge group must not land.');
  if (verdict.refusalKind === 'unattributed') {
    lines.push(
      '      A governed-surface change is in this merge group that cannot be attributed to any pull request,',
      '      so there is no review record it could possibly satisfy. Fail closed: a governed change nobody',
      '      can point at a reviewable PR for is the most anomalous input this guard can receive.',
    );
  } else if (verdict.refusalKind === 'unreadable') {
    lines.push(
      '      The review list could not be READ for at least one governed pull request above. ⛔ This is a',
      '      refusal and not a pass, deliberately: this guard exists because every other layer in this chain',
      '      failed open. "Nobody approved" and "we could not find out" are different facts (exit 3 vs 4) and',
      '      neither of them is "approved". Re-run the job once the API is reachable.',
    );
  } else {
    lines.push(
      '      At least one governed pull request above carries NO authorized APPROVED review at all and was not',
      '      enqueued from an account in GOVERNED_APPROVERS, so the merge queue would have been the entire',
      '      review — the shape of #9550, #10580 and #9319.',
    );
  }
  lines.push(
    '',
    '      What satisfies this check:',
    '        1. ⭐ FIRST, whatever comes after it — the pull request is IN the queue, and disabling auto-merge',
    '           and converting it to DRAFT do not take it out of the queue',
    '           (`.claude/skills/pm-dispatch/references/readings-queue.md`, queue membership).',
    '           So its landing seat sends the relay\'s `pr_dequeue` AT ONCE (measured live, comment 6902190812);',
    '           any other seat, or a stroke that does not land, asks the maintainer AT ONCE to remove it by hand.',
    '           Disable auto-merge AND convert it back to DRAFT, which disarms it so it does not re-enter once',
    '           removed; then confirm from the remote that it is in neither the queue nor `origin/main`',
    '           (AGENTS.md Prime Directive #14). Out of',
    '           the queue and in draft is where a governed PR waits — 「四件套留 draft 等人批,⛔ 不翻正式不入队」',
    '           — the SAFE state, not a stalled one.',
    `        2. Then: obtain an APPROVED review by an authorized approver (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')})`,
    '           on each governed PR, and the CLAIMING SEAT lands it from there — ruling C (#17971, maintainer',
    '           2026-09-13, verbatim 「C. approve 后不管后续改动都由席位落地:」), 「席位落地 = 过落地前',
    '           检、清标、ready、auto-merge,踢出/变基同法。」 The approval does NOT have to sit on the current',
    '           head sha, and a later push does not expire it (2026-09-04: 「只需要有人工批准记录就行，不需',
    '           要卡最新的提交。」); the authorized set is the 2026-11-17 one (「hotlong 从批准账户中去掉，只保',
    '           留 os-zhuang」). ⛔ An agent seat never submits that approval, under any account — the post-merge audit',
    '           reads the approver too. Or the maintainer\'s own "Merge when ready" from an account in',
    '           GOVERNED_APPROVERS: that enqueue IS the review (2026-10-26, 「大部分我还是希望入队，但是我想省掉',
    '           Approve」), and the entry it makes clears here with no APPROVED review — ⛔ no seat enqueues or',
    '           arms auto-merge under such an account in its place, and a seat\'s re-enqueue after an ejection is',
    '           a new entry that needs the approval or another such click. ⛔ Otherwise, unapproved, the',
    '           maintainer\'s own direct merge (人工直合) is the remaining landing, and it IS the',
    '           Merge button\'s bypass-rules option — offered only while ruleset `main` configures a bypass actor',
    '           (#19344); the audit log records it.',
  );
  if (verdict.entries.some((e) => e.record !== undefined)) {
    lines.push(
      `        3. Or — ONLY for a pull request whose governed paths all lie under a Tier S surface (${tierSGlobs()}),`,
      '           which the tier line on each entry above says outright — the owning seat posts its review of record',
      `           on the CURRENT head and re-queues: a \`## Contract review\` comment on ${REVIEW_OF_RECORD_LOCATION} naming`,
      '           this head, carrying a `Reviewed-by:` line, one `**VERDICT: PASS**` line and a `Served-tier:` line whose token is the NAME',
      '           `CONTRACT_REVIEW_TIER` — ⛔ never its value and never any model identifier, because `AGENTS.md`',
      '           lets none land in a comment — on a stamp control that holds. The tier READING behind it is the',
      '           seat\'s own transcript grep, which leaves no repository artifact at all. It is posted through the relay',
      '           (or by an account in GOVERNED_APPROVERS): a comment by any other author is not read (#33541).',
      '           ⛔ A record on an OLDER head does not carry forward — unlike an approval,',
      '           which since 2026-09-04 does — because a record names the head it judged. ⛔ And it widens to nothing:',
      '           one Tier H path in the diff and option 1 or 2 is the only way through.',
    );
  }
  lines.push(
    '      Neither of those is "edit this check".',
    '',
    `      Verify any file list before acting: node scripts/pm/check-governed-merges.mjs --test <paths…>`,
  );
  return lines.join('\n');
}

/**
 * Re-read one governed entry's tier with the low-risk skills arm's reading
 * (#33501): `paths` = every path of the PR's commits (`allPaths`); the body,
 * labels and fork predicate off the pull object the queue leg read; the timeline
 * the enqueue leg read (`timeline`: `{ measured, reason, events }`); each
 * changeset at the commit that touched it, read with `runGit`; and the status
 * and both modes of every path of every governed commit (`catalogFilesOf`).
 * `lowRiskArmVerdict` then holds all of its conditions: catalog rows only, an
 * allowlisted path list, the bare declarations in the body and in clean
 * changesets, no `security` label now or removed, no catalog path named for
 * security, auth or permission, every catalog file a modified regular file with
 * its mode unchanged, and no fork. An entry with no catalog row is left
 * untouched; `pull` null (its read failed) is an UNMEASURED reading, so the
 * entry stays Tier H with the reason printed, and so is a missing timeline,
 * fork reading, status reading or git reader.
 * The arm's RECORD STAGE — `record` (`lowRiskRecordStage`) and `cardLabels`
 * (`readCardLabels`) — is handed in on a SECOND call, by a caller that read it
 * because the first call left the stage pending (`lowRiskRecordStagePending`):
 * left out, an entry whose pull-read conditions all hold stays Tier H.
 * ⛔ The tier comes from the register's own `governedTierFor` and
 * `applyLowRiskArm` — no second predicate here. Mutates `entry` (its `surfaces`
 * and `tier`); returns it.
 */
export function readLowRiskTier(entry, repo, pull, { timeline = null, runGit = null, record = null, cardLabels = null, recordLeg = null } = {}) {
  if (!entry || !(entry.surfaces ?? []).some((s) => s?.lowRiskVerdict || s?.ruleChangeVerdict)) return entry;
  const refs = Array.isArray(entry.changesetRefs) ? entry.changesetRefs : [];
  const changesets = typeof runGit !== 'function'
    ? { measured: false, reason: 'no git reader was handed to the queue leg', files: [] }
    : {
        measured: true,
        reason: null,
        files: refs.map(({ sha, path }) => {
          if (!sha) return { path, text: null };
          try {
            return { path, text: String(runGit(['show', `${sha}:${path}`])) };
          } catch {
            return { path, text: null };
          }
        }),
      };
  const reading = pull
    ? {
        measured: true,
        reason: null,
        catalogFiles: catalogFilesOf(entry, runGit),
        paths: entry.allPaths ?? entry.paths,
        body: String(pull.body ?? ''),
        labels: Array.isArray(pull.labels) ? pull.labels : null,
        fork: pull.fork ?? null,
        timeline: timeline ?? { measured: false, reason: 'the timeline was not read', events: null },
        changesets,
        ...(record == null ? {} : { record }),
        ...(cardLabels == null ? {} : { cardLabels }),
        // The `.claude/**` declaration split (2026-11-19): the queue leg says its own record leg judges the record
        // (`RULE_CHANGE_RECORD_LEG_DEFERRED`), so the split reads the body here and `ruleChangeRecordVerdict` the line.
        ...(recordLeg == null ? {} : { recordLeg }),
      }
    : { measured: false, reason: 'its pull request could not be read, so its body and labels are unknown' };
  entry.surfaces = applyRuleChangeSplit(applyLowRiskArm(applyWorkflowSplit(governedPathsIn(entry.paths, repo), repo, entry.workflowDiff ?? null), repo, reading), repo, reading);
  entry.tier = governedTierFor(entry.paths, repo, GOVERNED_SURFACES, entry.workflowDiff ?? null, reading);
  return entry;
}

/**
 * A reader that answers each key from its first SUCCESSFUL read. A rejection is not cached: the next caller
 * reads again, so one leg's transient failure is never another leg's verdict.
 */
export function oncePerPull(read) {
  const seen = new Map();
  return async (key) => {
    if (seen.has(key)) return seen.get(key);
    const value = await read(key);
    seen.set(key, value);
    return value;
  };
}

/** `git diff-tree --raw` status letters, spelled as the arm reads them. */
const RAW_STATUS = Object.freeze({ M: 'modified', A: 'added', D: 'deleted', T: 'type-changed', R: 'renamed', C: 'copied' });

/**
 * The status and both modes of every path each governed commit of the entry
 * touched, read with `git diff-tree -r --raw -z --no-renames` against the
 * commit's first parent (the same comparison `enumerateRows` lists the paths
 * from): `{ path, status, oldMode, mode }`, the raw line's two modes, so a mode
 * change reads H in the arm. One row per commit per path, so an add in one
 * commit and an edit in the next reads `added`. A modified file under an
 * add-only row (`lowRisk.addOnly`, the ADR leg) also carries `patch`: that
 * commit's diff against its first parent at full context (`addOnlyDiffArgv`),
 * or null when the read threw — which the arm reads as H.
 * No git reader, a commit with no sha, or a read that throws is NOT MEASURED.
 */
export function catalogFilesOf(entry, runGit) {
  if (typeof runGit !== 'function') return { measured: false, reason: 'no git reader was handed to the queue leg', files: [] };
  const shas = Array.isArray(entry?.shas) ? entry.shas : [];
  if (shas.length === 0) return { measured: false, reason: 'the entry names no commit to read the status from', files: [] };
  const files = [];
  for (const sha of shas) {
    let out;
    try {
      out = String(runGit(['diff-tree', '-r', '--no-commit-id', '--no-renames', '--raw', '-z', '-m', '--first-parent', sha]));
    } catch (error) {
      return { measured: false, reason: `the status of ${String(sha).slice(0, 12)} could not be read (${String(error?.message ?? error).split('\n')[0]})`, files: [] };
    }
    const tokens = out.split('\0');
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const meta = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])/.exec(tokens[i].trim());
      if (!meta || tokens[i + 1] === '') continue;
      const row = { path: tokens[i + 1], status: RAW_STATUS[meta[3]] ?? meta[3], oldMode: meta[1], mode: meta[2] };
      // The ADR leg (#33539): a modified file under an add-only row carries this commit's diff against its first
      // parent, at full context; a read that throws is carried as no diff, which the arm reads as H.
      if (row.status === 'modified' && GOVERNED_SURFACES.some((s) => s.lowRisk?.addOnly === true && row.path.startsWith(s.prefix))) {
        try {
          row.patch = String(runGit(addOnlyDiffArgv(['diff-tree', '-p', '--no-commit-id', '-m', '--first-parent'], [sha], row.path)));
        } catch {
          row.patch = null;
        }
      }
      files.push(row);
    }
  }
  return { measured: true, reason: null, files };
}

/** Did the low-risk skills arm put this entry at Tier S? */
export function landsOnLowRiskArm(entry) {
  return entry?.tier === TIER_S && (entry.surfaces ?? []).some((s) => s?.lowRiskVerdict?.tier === TIER_S);
}

/**
 * Do this entry's pull-read arm conditions all hold, with the arm's record stage still unread
 * (`lowRiskArmVerdict`'s `recordStage: 'pending'`)? Such an entry is Tier H as it stands; the caller
 * reads the record stage and calls `readLowRiskTier` again with it.
 */
export function lowRiskRecordStagePending(entry) {
  return (entry?.surfaces ?? []).some((s) => s?.lowRiskVerdict?.recordStage === LOW_RISK_RECORD_STAGE.pending);
}

/**
 * Why a record CARRIED from an older head (the regeneration and prose-only hops) does not stand for
 * the low-risk arm, as a predicate phrase (`was carried from …`), or null when it does. The hops
 * (`git diff -z --name-only --no-renames <reviewed head> <this head>` through `pair.runGit`; a rename
 * lists BOTH paths, so a skill moved out of the catalog counts) may touch no `.changeset/` path and no
 * path under a low-risk row: a changeset, the body's partner, and catalog text such as a skill's
 * `CHANGELOG.md` are prose faces the carry admits, yet they are exactly what the arm's tier — and the
 * reviewer's `Security-touching:` statement — was read from. A diff that cannot be read refuses too.
 * ONE rule for the record leg's PASS and the arm's record stage. Pure but for `runGit`.
 */
export function lowRiskCarryRefusal(carriedFrom, pair) {
  const from = `\`${String(carriedFrom).slice(0, 12)}\``;
  if (typeof pair?.runGit !== 'function' || !pair?.headSha) return `was carried from ${from} and this leg could not diff the hops`;
  let moved;
  try {
    moved = String(pair.runGit(['diff', '-z', '--name-only', '--no-renames', carriedFrom, pair.headSha])).split('\0').filter(Boolean);
  } catch (error) {
    return `was carried from ${from} and the hops could not be diffed (${String(error?.message ?? error).split('\n')[0]})`;
  }
  const catalog = GOVERNED_SURFACES.filter((s) => s.lowRisk && s.prefix).map((s) => s.prefix);
  const touched = moved.filter((p) => p.startsWith('.changeset/') || catalog.some((prefix) => p.startsWith(prefix)));
  if (touched.length > 0) return `was carried from ${from} over hops that moved ${touched.slice(0, 3).join(', ')}${touched.length > 3 ? ` (+${touched.length - 3} more)` : ''}, which the arm reads, after the review`;
  return null;
}

/**
 * Why a record CARRIED from an older head does not stand for the `.claude/**` declaration split, as a predicate
 * phrase, or null when it does: the hops may touch no path under a split row. The carry admits prose faces by
 * NAME at any depth (a `CHANGELOG.md`), so one under the instruction tree could otherwise move after the reviewer
 * wrote `Rule-change-verified:`. A diff that cannot be read refuses too. Pure but for `runGit`.
 */
export function ruleChangeCarryRefusal(carriedFrom, pair) {
  const from = `\`${String(carriedFrom).slice(0, 12)}\``;
  if (typeof pair?.runGit !== 'function' || !pair?.headSha) return `was carried from ${from} and this leg could not diff the hops`;
  let moved;
  try {
    moved = String(pair.runGit(['diff', '-z', '--name-only', '--no-renames', carriedFrom, pair.headSha])).split('\0').filter(Boolean);
  } catch (error) {
    return `was carried from ${from} and the hops could not be diffed (${String(error?.message ?? error).split('\n')[0]})`;
  }
  const rows = GOVERNED_SURFACES.filter((s) => s.ruleChange && s.prefix).map((s) => s.prefix);
  const touched = moved.filter((p) => rows.some((prefix) => p.startsWith(prefix)));
  if (touched.length > 0) return `was carried from ${from} over hops that moved ${touched.slice(0, 3).join(', ')}${touched.length > 3 ? ` (+${touched.length - 3} more)` : ''}, which its \`Rule-change-verified:\` line was read from, after the review`;
  return null;
}

/**
 * The arm's reading of the review of record on this head — the `record` half of its record stage
 * (`lowRiskRecordStageReasons`, the register). Built from the SAME threads and the SAME locator the
 * record leg reads (`recognisers.locate`, rows already cut to trusted authors), and the line is read
 * off the comment that locator chose with the fleet's one record reader (`recognisers.reading`, its
 * `securityTouching`), ⛔ never a second parser:
 *
 *   not measured   the recognisers or the reader did not load, a thread or the head could not be
 *                  read, or the chosen comment is not among the rows;
 *   absent         no record names this head;
 *   found/unsigned the record, where it sits, its id, its line's reading, and — when it was carried
 *                  from an older head — whether the carry stands for the arm (`lowRiskCarryRefusal`).
 *
 * ⛔ It decides nothing: the register's arm reads the object and gives the reasons. Pure but for
 * `pair.runGit`.
 */
export function lowRiskRecordStage({ pair, recognisers }) {
  const unmeasured = (reason) => ({ measured: false, reason });
  if (recognisers?.available !== true) return unmeasured(recognisers?.reason ?? 'the contract-review recognisers were not loaded');
  if (typeof recognisers.reading !== 'function') return unmeasured('the contract-review record reader was not loaded');
  const located = recognisers.locate(pair);
  if (located.state === 'unreadable') return unmeasured(`${located.gaps.join(', ')} could not be read`);
  if (located.state === 'absent') return { measured: true, reason: null, located: 'absent', where: null, id: null, carried: null, securityTouching: null };
  const rows = (recognisers.threads ?? []).flatMap((thread) => (Array.isArray(pair?.[thread.rows]) ? pair[thread.rows] : []));
  const comment = located.id === null || located.id === undefined ? null : rows.find((r) => r?.id === located.id) ?? null;
  if (comment === null) return unmeasured('the record comment was not among the rows read, so its line is unknown');
  const why = located.carriedFrom ? lowRiskCarryRefusal(located.carriedFrom, pair) : null;
  return {
    measured: true,
    reason: null,
    located: located.state,
    where: located.where ?? null,
    id: located.id,
    carried: located.carriedFrom ? { from: located.carriedFrom, ok: why === null, reason: why } : null,
    securityTouching: recognisers.reading(comment.body)?.securityTouching ?? null,
    // The `.claude/**` declaration split (2026-11-19) reads its own line off the SAME comment, with the
    // register's reader, and holds a carried record to its own rule: the hops moved nothing under the row.
    ruleChangeVerified: readRuleChangeVerified(comment.body),
    ruleChangeCarried: located.carriedFrom ? ((refusal) => ({ from: located.carriedFrom, ok: refusal === null, reason: refusal }))(ruleChangeCarryRefusal(located.carriedFrom, pair)) : null,
  };
}

/**
 * How many cards BESIDE the one that carries its record a pull request may name and still be read on the arm.
 * Each costs two reads in the merge group, so a body naming more is not read at all: Tier H.
 */
export const LOW_RISK_NAMED_CARD_LIMIT = 8;

/** One card's label names and timeline, for `readCardLabels`. Returns `{ reading, apiCalls }`. Never throws. */
async function readOneCardLabels(number, fetchLabels, fetchTimeline) {
  const why = (error) => String(error?.message ?? error).split('\n')[0];
  let apiCalls = 1;
  let labels;
  try {
    labels = await fetchLabels(number);
  } catch (error) {
    return { reading: { measured: false, reason: `card #${number}'s labels could not be read (${why(error)})`, card: number }, apiCalls };
  }
  if (!Array.isArray(labels)) return { reading: { measured: false, reason: `card #${number}'s labels answered no list`, card: number }, apiCalls };
  let timeline = { measured: false, reason: 'no timeline reader was supplied to this leg', events: null };
  if (typeof fetchTimeline === 'function') {
    apiCalls += 1;
    try {
      const events = await fetchTimeline(number);
      timeline = Array.isArray(events) ? { measured: true, reason: null, events } : { measured: false, reason: 'the timeline answered no list', events: null };
    } catch (error) {
      timeline = { measured: false, reason: why(error), events: null };
    }
  }
  return { reading: { measured: true, reason: null, card: number, labels: labels.map((l) => String(l ?? '')), timeline }, apiCalls };
}

/**
 * The arm's reading of the CARDS the pull request names — the `cardLabels` half of its record stage:
 * each card's label names (`fetchLabels`) and its timeline (`fetchTimeline`, where a removed `security`
 * label sits). `card` is `deliveredCardNumber`'s answer, the ONE card whose thread may carry the record;
 * `named` is `namedCardNumbers`' answer, EVERY card the pull names (a `Part of` beside a `Fixes`, a
 * `Refs`, the card its branch is named for) — a `security` label on any of them keeps the arm at Tier H,
 * so each is read, the first card at the top of the reading and the rest under `others`.
 * No derivable card, no label reader or a label read that threw is NOT MEASURED; a timeline that could
 * not be read is carried unmeasured inside a measured reading; `named` not handed in, or more than
 * `LOW_RISK_NAMED_CARD_LIMIT` other cards (flagged `overLimit`: a fact of the pull, not a failed read),
 * leaves `others` unmeasured with nothing read; one other card that could not be read is carried
 * unmeasured in its place — each a reason in the arm, so Tier H.
 * Returns `{ reading, apiCalls }`. Never throws.
 */
export async function readCardLabels({ card, named = null, fetchLabels = null, fetchTimeline = null }) {
  if (!card || card.card === null || card.card === undefined) {
    return { reading: { measured: false, reason: `no card could be derived for it — ${card?.reason ?? 'no card reading'}` }, apiCalls: 0 };
  }
  if (typeof fetchLabels !== 'function') return { reading: { measured: false, reason: 'no label reader was supplied to this leg' }, apiCalls: 0 };
  const first = await readOneCardLabels(card.card, fetchLabels, fetchTimeline);
  if (first.reading.measured !== true) return { reading: { measured: false, reason: first.reading.reason }, apiCalls: first.apiCalls };
  let apiCalls = first.apiCalls;
  const withOthers = (others) => ({ reading: { ...first.reading, others }, apiCalls });
  if (!Array.isArray(named)) return withOthers({ measured: false, reason: 'the cards the pull request names were not listed for this leg', cards: null });
  const rest = [...new Set(named.map(Number))].filter((n) => Number.isInteger(n) && n > 0 && n !== Number(card.card)).sort((a, b) => a - b);
  if (rest.length > LOW_RISK_NAMED_CARD_LIMIT) {
    return withOthers({ measured: false, reason: `it names ${rest.length} more cards (${rest.slice(0, 3).map((n) => `#${n}`).join(', ')}, …), over the ${LOW_RISK_NAMED_CARD_LIMIT} this leg reads`, cards: null, overLimit: true });
  }
  const cards = [];
  for (const number of rest) {
    const one = await readOneCardLabels(number, fetchLabels, fetchTimeline);
    apiCalls += one.apiCalls;
    cards.push(one.reading);
  }
  return withOthers({ measured: true, reason: null, cards });
}

/**
 * The contract-review threads of one pair, read into it: one thread per entry of the shared set
 * (`recognisers.threads` — the locations `--template` states), each cut to the authors this leg trusts
 * (`recordAuthorTrusted`) BEFORE any reader sees it. A carrier the pair does not have (no card) holds
 * no record: an empty list, never a gap. The first thread that cannot be read stops the walk and is
 * named in `unreadable`. ONE walk for the queue's record leg, the arm's record stage, `--pr` and the
 * relay. Mutates `pair`; returns `{ ignoredAuthors, unreadable, apiCalls }`. Never throws.
 */
export async function readRecordThreads({ pair, recognisers, fetchComments }) {
  const ignoredAuthors = [];
  let apiCalls = 0;
  for (const thread of recognisers.threads) {
    const number = pair[thread.number];
    if (number === null || number === undefined) {
      // Not a gap: the pair has no such carrier at all, so that carrier
      // holds no record. The caller's card note is what tells a reader which it was.
      pair[thread.rows] = [];
      continue;
    }
    try {
      apiCalls += 1;
      const read = await fetchComments(number);
      // ⭐ The AUTHOR binding (#33541): a row its author does not earn is dropped HERE, before any
      // reader sees the thread — ignored, never refused loudly; the count rides to the words.
      if (Array.isArray(read)) {
        const kept = read.filter((row) => recordAuthorTrusted(row, recognisers.trustedAuthors));
        for (const row of read) if (!kept.includes(row)) ignoredAuthors.push(String(row?.user?.login ?? '(unreadable author)'));
        pair[thread.rows] = kept;
      } else {
        pair[thread.rows] = read;
      }
    } catch (error) {
      return { ignoredAuthors, unreadable: `${thread.where} #${number}'s comment thread could not be read (${String(error?.message ?? error).split('\n')[0]})`, apiCalls };
    }
  }
  return { ignoredAuthors, unreadable: null, apiCalls };
}

/**
 * Every card the pull names, as the arm's card conjunct reads them (`recognisers.namedCards`), or null when
 * the recogniser set does not carry that reader or there is no pull row: `readCardLabels` reads null as
 * NOT MEASURED, ⛔ never as "names no other card". Pure.
 */
export function namedCardsOf(recognisers, pull) {
  if (typeof recognisers?.namedCards !== 'function' || !pull) return null;
  const named = recognisers.namedCards(pull);
  return Array.isArray(named) ? named : null;
}

/**
 * The arm's whole RECORD STAGE for one pull request, for a caller that holds no thread yet (`--pr`
 * and the relay; the queue leg reads the same pieces inline, beside its record leg): the card
 * `recognisers.deliveredCard` derives from the pull object, the threads (`readRecordThreads`), then
 * `lowRiskRecordStage` and `readCardLabels` over every card `recognisers.namedCards` lists. `pull` is
 * the object both read (`number`, `body`, `head.ref`); `runGit` and `baseRef` are what a carried
 * record is re-tested with, and one absent refuses the carry. ⛔ Anything that did not load or did
 * not read is NOT MEASURED — recognisers that did not load, no comment reader, a thread that threw —
 * which the arm reads as Tier H.
 * Returns `{ record, cardLabels, card, apiCalls }`. Never throws.
 */
export async function readLowRiskRecordStage({ pr, pull, headSha, paths, repo, runGit = null, baseRef = null, recognisers, fetchComments = null, fetchLabels = null, fetchTimeline = null, withCardLabels = true }) {
  if (recognisers?.available !== true) {
    return {
      record: { measured: false, reason: recognisers?.reason ?? 'the contract-review recognisers were not loaded' },
      cardLabels: { measured: false, reason: 'not read: the contract-review recognisers, which name the card, did not load' },
      card: null,
      apiCalls: 0,
    };
  }
  const card = pull
    ? recognisers.deliveredCard(pull)
    : { card: null, reason: 'its pull request row could not be read, so no card thread could be located for it' };
  const pair = { pr, card: card.card, headSha: headSha ?? null, runGit, baseRef, paths, repo };
  const threads = typeof fetchComments === 'function'
    ? await readRecordThreads({ pair, recognisers, fetchComments })
    : { unreadable: 'no comment reader was supplied to this leg, so no thread was read', apiCalls: 0 };
  const record = threads.unreadable !== null ? { measured: false, reason: threads.unreadable } : lowRiskRecordStage({ pair, recognisers });
  // The card labels are the ARM's conjunct: a caller reading the stage for the `.claude/**` split alone leaves them unread.
  if (withCardLabels !== true) return { record, cardLabels: null, card, apiCalls: threads.apiCalls };
  const labelled = await readCardLabels({ card, named: namedCardsOf(recognisers, pull), fetchLabels, fetchTimeline });
  return { record, cardLabels: labelled.reading, card, apiCalls: threads.apiCalls + labelled.apiCalls };
}

/**
 * The record leg's VERDICT, on every Tier S entry (card #33541; AGENTS.md
 * Prime Directive 14 lands Tier S on "a PASS verdict"): a record that STANDS
 * must also READ PASS. Read off the SAME comment the locator chose, with the
 * fleet's one record reader (`contractReviewRecordReading`,
 * `check-half-states.mjs`, re-exported by the recognisers — the regexes of
 * `contractReviewVerdictOf`, ⛔ never a second parser): the record carries
 * exactly ONE `VERDICT:` line and it reads PASS. FAIL, no `VERDICT:` line (a
 * heading-inline or bare word alone included), two such lines (a quoted
 * earlier verdict, a FAIL appended under a PASS), the comment not among the
 * rows, or no reader loaded — each is `not-pass`, a refusal naming the
 * comment id. Several same-head records: the locator's newest one is the one
 * read, so a later FAIL withdraws an earlier PASS and a later PASS supersedes
 * an earlier FAIL.
 *
 * ⚖️ And a PASS that is not clean does not clear either (card #33604; the
 * guard decides, not the seat's pre-landing check): a record that ALSO reads
 * FAIL anywhere else — its heading, a lower-case or bulleted `verdict:` key, a
 * bare FAIL line (N2 of record 6890532571) — contradicts itself; a record that
 * names an open must-fix or should-fix owes a delta review of its fix
 * (`contract-review.md`), so the LATER same-head record that closes them is
 * the one that clears; and a grade the reader cannot attribute is unreadable,
 * which fails closed. Pure.
 */
export function recordPassVerdict(record, pair, recognisers) {
  if (record?.state !== 'stands') return record;
  const refuse = (verdict, why) => ({ ...record, state: 'not-pass', verdict, verdictReason: why });
  if (typeof recognisers?.reading !== 'function') return refuse(null, 'the contract-review verdict reader was not loaded');
  const rows = (recognisers.threads ?? []).flatMap((thread) => (Array.isArray(pair?.[thread.rows]) ? pair[thread.rows] : []));
  const comment = record.id === null || record.id === undefined ? null : rows.find((r) => r?.id === record.id) ?? null;
  if (comment === null) return refuse(null, 'the record comment was not among the rows read, so its verdict is unknown');
  // The author the binding admitted, carried for the words (the rows reached here are trusted ones only).
  const author = typeof comment.user?.login === 'string' ? comment.user.login : null;
  const reading = recognisers.reading(comment.body);
  const words = reading?.verdicts ?? [];
  if (words.length === 0) return { ...refuse(null, 'it states no verdict (no `VERDICT:` line anywhere in it)'), author };
  if (words.length > 1) return { ...refuse(null, `it states ${words.length} \`VERDICT:\` lines (${words.join(', ')}), and a record states exactly one`), author };
  if (words[0] !== 'PASS') return { ...refuse(words[0], `it reads ${words[0]}`), author };
  // A quoted record line is comment text: flattened (no backtick, pipe or angle bracket survives) and cut.
  const quote = (line) => `\`${String(line).replace(/[`|<>\r\n]+/g, ' ').slice(0, 80)}\``;
  const fails = Array.isArray(reading?.failSpellings) ? reading.failSpellings : null;
  const open = Array.isArray(reading?.findings?.open) ? reading.findings.open : null;
  const unreadable = Array.isArray(reading?.findings?.unreadable) ? reading.findings.unreadable : null;
  if (fails === null || open === null || unreadable === null) return { ...refuse(null, 'its FAIL spellings and finding grades could not be read, so it clears nothing'), author };
  if (fails.length > 0) return { ...refuse(null, `its one \`VERDICT:\` line reads PASS, yet it also reads FAIL (${fails.slice(0, 2).map(quote).join(', ')}), and a record that contradicts itself clears nothing (#33604)`), author };
  if (open.length > 0) {
    const named = open.slice(0, 4).map((f) => (f.id ? `${f.id} (${f.grade})` : f.grade)).join(', ');
    return { ...refuse(null, `it reads PASS but names ${open.length} open must-fix/should-fix finding(s) (${named}${open.length > 4 ? ', …' : ''}): each earns a delta review of its fix, and the later same-head record that closes them is the one that clears (#33604)`), author };
  }
  // ⛔ The remedy names the shapes the reader takes, and never asks for a sentence the record may already carry.
  if (unreadable.length > 0) return { ...refuse(null, `it reads PASS but a must-fix/should-fix mention on it cannot be attributed (${unreadable.slice(0, 2).map(quote).join(', ')}): the reader takes a finding named at a line's lead (\`S1 (should-fix) — …\`, closed as \`S1 (should-fix): closed\`), a citation \`(record ID: …)\` and a denial (\`No must-fix, no should-fix.\`); any other mention of the grade word refuses (#33604)`), author };
  return { ...record, verdict: 'PASS', author };
}

/**
 * The record leg's verdict for an entry the low-risk arm put at Tier S: the
 * carry rule below, then `recordPassVerdict` like every other Tier S entry.
 *
 * ⛔ A record CARRIED from an older head (the regeneration and prose-only hops)
 * stands for this arm only when nothing it reads moved after the PASS
 * (`lowRiskCarryRefusal`, the one carry rule this leg shares with the arm's
 * record stage): the hops may touch no `.changeset/` path and no path under a
 * catalog row, and a diff that cannot be read refuses too. Pure but for `runGit`.
 */
export function lowRiskRecordVerdict(record, pair, recognisers) {
  if (record?.state !== 'stands') return record;
  if (record.carriedFrom) {
    const why = lowRiskCarryRefusal(record.carriedFrom, pair);
    if (why !== null) return { ...record, state: 'not-pass', verdict: null, verdictReason: `it ${why}` };
  }
  return recordPassVerdict(record, pair, recognisers);
}

/**
 * The value a Tier S entry's `.claude/**` paths were DECLARED with (`none` or `ruled`), or null for an entry with
 * no split row at Tier S: the value its record's `Rule-change-verified:` line must read. Pure.
 */
export function ruleChangeDeclaredOn(entry) {
  if (entry?.tier !== TIER_S) return null;
  return (entry.surfaces ?? []).find((s) => s?.ruleChangeVerdict?.tier === TIER_S)?.ruleChangeVerdict?.declared ?? null;
}

/**
 * The record leg's verdict for an entry the declaration split put at Tier S (2026-11-19, card #35321): the carry
 * rule (`ruleChangeCarryRefusal`), `recordPassVerdict` like every other Tier S entry, and then the LINE — the
 * comment the locator chose must carry one bare `Rule-change-verified:` line reading the value the PR body
 * declared. Read with the register's reader and judged with the register's own reasons (`readRuleChangeVerified`,
 * `ruleChangeRecordReasons`; ⛔ no second rule here): missing, unreadable, `yes` or the other value is `not-pass`,
 * a refusal naming the comment. A record that does not stand keeps the state it had. Pure but for `runGit`.
 */
export function ruleChangeRecordVerdict(record, pair, recognisers, declared) {
  if (record?.state !== 'stands') return record;
  if (record.carriedFrom) {
    const why = ruleChangeCarryRefusal(record.carriedFrom, pair);
    if (why !== null) return { ...record, state: 'not-pass', verdict: null, verdictReason: `it ${why}` };
  }
  const passed = recordPassVerdict(record, pair, recognisers);
  if (passed.state !== 'stands') return passed;
  const rows = (recognisers?.threads ?? []).flatMap((thread) => (Array.isArray(pair?.[thread.rows]) ? pair[thread.rows] : []));
  const comment = rows.find((r) => r?.id === record.id) ?? null;
  const reasons = ruleChangeRecordReasons({ measured: true, reason: null, located: 'found', where: record.where ?? null, id: record.id ?? null, ruleChangeCarried: null, ruleChangeVerified: comment === null ? null : readRuleChangeVerified(comment.body) }, declared);
  if (reasons.length > 0) return { ...passed, state: 'not-pass', verdict: null, verdictReason: `the \`.claude/**\` declaration split is not verified — ${reasons.join('; ')}` };
  return passed;
}

/**
 * The orchestrator, with its one IO dependency injected.
 *
 * ⭐ The early return below is requirement (d)'s ordering guarantee expressed
 * as control flow: nothing governed ⇒ verdict, before `fetchReviews` exists as
 * a possibility. The self-test passes a `fetchReviews` that THROWS, so the
 * claim "a clear diff costs zero API calls" is measured rather than asserted.
 *
 * ⚠️ Since 2026-09-04 the two reads are NOT equally load-bearing: the review
 * list is the predicate's input and an unreadable one still refuses (exit 4),
 * while the PR head is a printed reading whose failure is a note. Fail-closed
 * still governs everything the verdict is derived FROM; it never governed
 * things the verdict merely mentions.
 */
export async function runGuard({ event, repo, rows, fetchReviews, fetchPull, fetchComments, fetchTimeline = null, fetchLabels = null, loadRecognisers = loadRecordRecognisers, lifted = [], runGit = null, baseRef = null }) {
  const { governed, unattributed } = decomposeGovernedWork(rows, assertGovernedRepo(repo, 'runGuard'));
  if (governed.length === 0 && unattributed.length === 0) {
    return guardVerdict({ event, repo, governed, unattributed, apiCalls: 0, lifted });
  }
  const approvals = new Map();
  const enqueues = new Map();
  const records = new Map();
  const heads = new Map();
  const pulls = new Map();
  const timelines = new Map();
  const headNotes = [];
  let apiCalls = 0;
  for (const entry of governed) {
    try {
      if (event === EVENT_MERGE_GROUP) {
        // The queue leg judges the 2026-09-04 predicate, which does not read
        // `commit_id`. The head is still fetched — the merge_group payload
        // carries no per-PR heads, and the log names the commit each approval
        // was given on — but it DECIDES nothing, so its own failure must not
        // refuse: a read that decides nothing may not block a landing. Only
        // the review read, which IS the predicate's input, still refuses.
        let headSha = null;
        try {
          apiCalls += 1;
          // ⭐ ONE request, two readings: the head the log names, and the BODY
          // the references tier locates this pull request's card from (#18701).
          // The pull object carries both, so the card thread costs no call the
          // head read was not already making.
          const pull = await fetchPull(entry.pr);
          headSha = pull?.sha ?? null;
          pulls.set(entry.pr, { number: entry.pr, body: pull?.body ?? '', labels: Array.isArray(pull?.labels) ? pull.labels : null, fork: pull?.fork ?? null, head: { ref: pull?.headRef ?? '' } });
        } catch (error) {
          headNotes.push(
            `  ℹ️  #${entry.pr}: the PR head could not be read (${String(error?.message ?? error).split('\n')[0]}) — ` +
              'informational only since 2026-09-04, so the review list was judged without it',
          );
        }
        apiCalls += 1;
        approvals.set(entry.pr, authorizedApprovalVerdict(await fetchReviews(entry.pr), headSha));
        heads.set(entry.pr, headSha);
      } else {
        // The early-warning leg keeps the pre-pinning reading (and byte-
        // identical output): it never reddens, so it never needs the head.
        apiCalls += 1;
        approvals.set(entry.pr, approvalVerdict(await fetchReviews(entry.pr)));
      }
    } catch (error) {
      approvals.set(entry.pr, unreadableApproval(String(error?.message ?? error).split('\n')[0]));
    }
    // ── the ENQUEUE leg (2026-10-26): who put this entry in the queue ──────
    //
    // ⭐ SECOND, and only for what the approval did not satisfy — an unreadable
    // review list included, since an authorized enqueue satisfies the entry on
    // its own. So it is MONOTONE (it never reads, let alone decides, for an
    // entry an authorized approval already cleared) and FREE on every such
    // entry. A missing reader or a throw is UNDETERMINED: never a pass, and
    // never a refusal of its own — the approval leg's verdict stands as it was.
    if (event === EVENT_MERGE_GROUP && approvals.get(entry.pr)?.state !== 'approved') {
      if (typeof fetchTimeline !== 'function') {
        enqueues.set(entry.pr, undeterminedEnqueue('no timeline reader was supplied to the queue leg'));
        timelines.set(entry.pr, { measured: false, reason: 'no timeline reader was supplied to the queue leg', events: null });
      } else {
        try {
          apiCalls += 1;
          const events = await fetchTimeline(entry.pr);
          // ⭐ Kept for the low-risk skills arm (S1): a removed `security` label is on this same timeline.
          timelines.set(entry.pr, Array.isArray(events) ? { measured: true, reason: null, events } : { measured: false, reason: 'the timeline answered no list', events: null });
          enqueues.set(entry.pr, authorizedEnqueueVerdict(enqueuerFromTimeline(events)));
        } catch (error) {
          const why = `the timeline could not be read (${String(error?.message ?? error).split('\n')[0]})`;
          timelines.set(entry.pr, { measured: false, reason: why, events: null });
          enqueues.set(entry.pr, undeterminedEnqueue(why));
        }
      }
    }
  }
  // ── Tier S: the record leg (#18020, generalised to the tier by #19133) ──
  //
  // ⭐ LAST, and only for what is still unsatisfied. Two properties come out of
  // that placement and neither is decoration: the leg is MONOTONE (it is never
  // consulted for an entry an authorized approval already cleared, so it cannot
  // take a pass away), and it is FREE on every merge group that does not need
  // it — no thread is read, and the recognisers are not even loaded.
  if (event === EVENT_MERGE_GROUP) {
    // ⭐ The low-risk skills arm (#33501) FIRST: a catalog entry's tier is read
    // off the pull object this leg already holds — body, labels, fork — the
    // timeline the enqueue leg read, the changesets at their commits and the whole
    // path list of its commits. An unread pull is NOT MEASURED: Tier H.
    // ⭐ The `.claude/**` declaration split (2026-11-19) is read off the same body, here: missing, unreadable or
    // `yes` is Tier H; `none` or `ruled` is Tier S on the DEFERRED record stage, which this leg's own record
    // leg settles below (`ruleChangeRecordVerdict`).
    for (const entry of governed) readLowRiskTier(entry, repo, pulls.get(entry.pr) ?? null, { timeline: timelines.get(entry.pr) ?? null, runGit, recordLeg: RULE_CHANGE_RECORD_LEG_DEFERRED });
    let recognisers = null;
    for (const entry of governed) {
      // ⭐ The arm's RECORD STAGE: an entry whose pull-read arm conditions all hold is Tier H until the
      // review's `Security-touching:` line and the card's labels are read. They are read HERE, off the
      // threads this leg reads anyway, and only for an entry nothing else cleared — so the stage is as
      // MONOTONE and as FREE as the record leg it shares its threads with.
      const pending = lowRiskRecordStagePending(entry);
      if (entry.tier !== TIER_S && !pending) continue;
      if (approvals.get(entry.pr)?.state === 'approved') continue;
      if (enqueues.get(entry.pr)?.state === 'authorized') continue;
      if (recognisers === null) {
        try {
          recognisers = await loadRecognisers();
        } catch (error) {
          recognisers = { available: false, reason: `the recogniser load threw: ${String(error?.message ?? error).split('\n')[0]}` };
        }
      }
      // The arm's second read of this entry's tier, with the record stage as far as it was read.
      const readRecordStage = (record, cardLabels) =>
        readLowRiskTier(entry, repo, pulls.get(entry.pr) ?? null, { timeline: timelines.get(entry.pr) ?? null, runGit, record, cardLabels, recordLeg: RULE_CHANGE_RECORD_LEG_DEFERRED });
      if (recognisers.available !== true) {
        // ⛔ No recognisers, no record reading: the pending entry stays Tier H on that reason, and the
        // record leg is never consulted for it.
        if (pending) {
          const unread = await readLowRiskRecordStage({ pr: entry.pr, pull: null, recognisers });
          readRecordStage(unread.record, unread.cardLabels);
          continue;
        }
        records.set(entry.pr, recordVerdict({ pair: null, recognisers }));
        continue;
      }
      // ⭐ WHICH CARD, derived from the pull request this guard already read and
      // by the ONE relation that answers it (#18701). A pull request whose card
      // cannot be derived searches no card thread and says so — the REFUSING
      // direction, and the only one a governance reading may be wrong in.
      const pull = pulls.get(entry.pr) ?? null;
      const card = pull
        ? recognisers.deliveredCard(pull)
        : { card: null, reason: 'its pull request row could not be read, so no card thread could be located for it' };
      const cardNote =
        card.card === null
          ? `⚠️ no card thread was searched — ${card.reason}`
          : `card #${card.card}, ${card.evidence}`;
      // ⭐ `runGit` and `baseRef` let the imported reader re-run the 纯重生成
      // test on two COMMITTED trees when this head moved past its record —
      // the base being what separates the merge commit's carry-over from a hand
      // edit. ⛔ Either one absent is a REFUSAL, never a pass: the reader
      // answers `unreadable` and this leg refuses on it.
      // ⭐ `paths` and `repo` are what the record's tier is read from: the face the governed paths of
      // this entry put the review on (B′ with C) — the same committed-tree list this leg classified.
      const pair = { pr: entry.pr, card: card.card, headSha: heads.get(entry.pr) ?? null, runGit, baseRef, paths: entry.paths, repo };
      // ⭐ ONE THREAD PER ENTRY IN THE SHARED SET, never a list spelled here: the
      // locations this leg READS are the locations `--template` STATES, because
      // both are this list (`readRecordThreads`). The cross-tool pin drives exactly this walk.
      const threads = await readRecordThreads({ pair, recognisers, fetchComments });
      apiCalls += threads.apiCalls;
      const { ignoredAuthors, unreadable } = threads;
      if (pending) {
        // ⛔ A thread that could not be read is a record that was not read: NOT MEASURED, so Tier H.
        const stage = unreadable !== null ? { measured: false, reason: unreadable } : lowRiskRecordStage({ pair, recognisers });
        // Every card the pull names, not only the one whose thread may carry the record.
        const labelled = await readCardLabels({ card, named: namedCardsOf(recognisers, pull), fetchLabels, fetchTimeline });
        apiCalls += labelled.apiCalls;
        readRecordStage(stage, labelled.reading);
        // Tier H on the record stage: the entry needs the maintainer, and the record leg is never consulted.
        if (entry.tier !== TIER_S) continue;
      }
      if (unreadable !== null) {
        records.set(entry.pr, { state: 'unreadable', reason: unreadable, cardNote });
        continue;
      }
      const record = recordVerdict({ pair, recognisers, cardNote });
      // ⭐ Every Tier S entry lands on a record that READS PASS, never on one that merely exists (#33541);
      // the low-risk arm adds its carry rule first (#33501).
      // The declaration split holds its record to the line the body's declaration owes (2026-11-19).
      const declaredRule = ruleChangeDeclaredOn(entry);
      const verdicted = landsOnLowRiskArm(entry)
        ? lowRiskRecordVerdict(record, pair, recognisers)
        : declaredRule !== null ? ruleChangeRecordVerdict(record, pair, recognisers, declaredRule) : recordPassVerdict(record, pair, recognisers);
      records.set(entry.pr, ignoredAuthors.length > 0 ? { ...verdicted, ignoredAuthors } : verdicted);
    }
  }
  return guardVerdict({ event, repo, governed, unattributed, approvals, enqueues, records, apiCalls, headNotes, lifted });
}

// ── every queued pull request: the enumeration the SIZE leg reads ──────────

/**
 * Every pull request this merge group is landing — deduplicated, in group order.
 *
 * ⭐ It reads the SAME per-commit decomposition the governed leg reads, and that
 * is load-bearing rather than convenient. `merge_group.head_ref` names only the
 * LAST pull request in the group, so keying this leg to it would let an oversized
 * PR A ride into `main` behind PR B — under-enumeration, the one direction a
 * queue reading must never be wrong in (#9902), and the same trap the governed
 * leg's header documents. The queue ref is consulted ONLY when the decomposition
 * attributes no pull request at all, where it cannot mis-attribute because there
 * is nothing else to attribute to.
 */
export function queuedPullsInGroup(rows, namedPull = null) {
  const pulls = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const pr = row?.pr;
    if (typeof pr !== 'number' || !Number.isInteger(pr) || pr <= 0) continue;
    if (seen.has(pr)) continue;
    seen.add(pr);
    pulls.push(pr);
  }
  if (pulls.length === 0 && Number.isInteger(namedPull) && namedPull > 0) pulls.push(namedPull);
  return pulls;
}

// ── the SIZE line: the SECOND leg, and the number IS the gate (#19036) ──────

/**
 * The leg's own name in a log — a second predicate inside the same check run,
 * named apart from the governed one so a reader can see which leg answered.
 */
export const SIZE_LEG_NAME = 'Human-Merge Size Line (2026-09-18 ruling)';

/**
 * ONE queued pull request's size, judged. Pure.
 *
 * ⭐ THE LANDED PREDICATE, reached through its own front door and nothing
 * else: `testVerdict([], { size })` is the sibling's verdict on the SIZE limb
 * alone (an empty path list has no PATH limb to fire — that limb is the
 * governed leg's question, answered on the lifted rows above), and
 * `landsByHumanMerge` is the sibling's own reading of it. The threshold, the
 * comparison and what counts live there; this function holds no number.
 *
 * An unmeasured size — no pair on the pull object, or half of one — is
 * `unreadable`, never `within`: `sizeVerdict` answers `measured: false,
 * exceeds: false` for it, which `landsByHumanMerge` would read as clear, and
 * that is precisely the fail-open reading this leg exists to refuse.
 */
export function sizeReading(pr, size, repo, approval = null) {
  const verdict = testVerdict([], { repo, size, approval });
  if (verdict.size?.measured !== true) {
    return {
      pr,
      state: 'unreadable',
      verdict,
      approval,
      reason:
        'the pull object carries no `additions` / `deletions` pair, so the size cannot be read — ' +
        'an unread size is never a size of zero',
    };
  }
  // Four states, and the LIFT is the sibling's reading (2026-09-27): over the
  // line with `lifted` set is `lifted`, never `within` — the number is printed
  // as over, and what lifted it is printed beside it.
  const state = landsByHumanMerge(verdict) ? 'oversized' : verdict.size.exceeds ? 'lifted' : 'within';
  return { pr, state, verdict, approval };
}

/**
 * The size verdict, as data. Pure, the same shape as `guardVerdict` — the
 * renderer and the exit code both read it rather than re-deriving it.
 *
 * ⚠️ `merge_group` ONLY: the `pull_request` leg returns `not-applicable` and
 * renders the empty string, so that leg's output stays byte-identical (the
 * 2026-08-27 constraint, kept here). A group that names no pull request has
 * no size to read and refuses; a reading that never arrived is `unreadable`,
 * never `within`. A `lifted` reading (over the line, authorized approval on
 * record — 2026-09-27) is a CLEAR, and the entry keeps saying it was lifted.
 */
export function sizeGuardVerdict({ event, repo, pulls = [], readings = new Map(), apiCalls = 0 }) {
  assertGovernedRepo(repo, 'sizeGuardVerdict');
  const base = { event, repo, entries: [], apiCalls, legName: SIZE_LEG_NAME };
  if (event !== EVENT_MERGE_GROUP) {
    return { ...base, conclusion: 'not-applicable', exitCode: EXIT_CLEAR, refusalKind: null };
  }
  if (pulls.length === 0) {
    return { ...base, conclusion: 'refused', exitCode: EXIT_REFUSED_SIZE_UNREADABLE, refusalKind: 'no-pull' };
  }
  const entries = pulls.map(
    (pr) =>
      readings.get(pr) ?? {
        pr,
        state: 'unreadable',
        verdict: testVerdict([], { repo, size: null }),
        reason: 'no size reading was recorded for this pull request',
      },
  );
  const out = { ...base, entries };
  if (entries.some((e) => e.state === 'unreadable')) {
    return { ...out, conclusion: 'refused', exitCode: EXIT_REFUSED_SIZE_UNREADABLE, refusalKind: 'unreadable' };
  }
  if (entries.some((e) => e.state === 'oversized')) {
    return { ...out, conclusion: 'refused', exitCode: EXIT_REFUSED_OVERSIZED, refusalKind: 'oversized' };
  }
  return { ...out, conclusion: 'clear', exitCode: EXIT_CLEAR, refusalKind: null };
}

/**
 * The size orchestrator, with its one IO dependency injected — the SAME
 * `fetchPull` the governed leg reads heads with, so the pull object is read by
 * one reader with one contract.
 *
 * Every queued pull request is read, and the enumeration is
 * `queuedPullsInGroup`: per commit, deduplicated, the queue ref consulted
 * only when nothing is attributed — so a bare sibling cannot carry an
 * oversized PR through, the #9902 direction. One pull read per queued PR; the
 * count is printed and pinned. A throw is caught into an `unreadable` reading,
 * never a pass and never an escaping rejection.
 */
export async function runSizeGuard({ event, repo, rows, namedPull = null, fetchPull, fetchReviews = null, fetchTimeline = null, approvals = new Map() }) {
  assertGovernedRepo(repo, 'runSizeGuard');
  if (event !== EVENT_MERGE_GROUP) return sizeGuardVerdict({ event, repo });
  const pulls = queuedPullsInGroup(rows, namedPull);
  const readings = new Map();
  let apiCalls = 0;
  for (const pr of pulls) {
    try {
      apiCalls += 1;
      const pull = await fetchPull(pr);
      let reading = sizeReading(pr, pull?.size ?? null, repo);
      if (reading.state === 'oversized') {
        // ⭐ THE LIFT (2026-09-27, #20153): over the line, so the approval is
        // consulted — the SAME verdict the governed leg computed on this build
        // when it read this pull request, else the same derivation on a review
        // read of this leg's own. Never re-derived from a verdict already held,
        // never read for a pull request under the line, and a read that fails
        // is `unreadable`: fail closed, on the size code (8), the words saying so.
        let approval = approvals.get(pr) ?? null;
        if (approval === null) {
          if (typeof fetchReviews !== 'function') {
            approval = unreadableApproval('no review reader was supplied to the size leg');
          } else {
            try {
              apiCalls += 1;
              approval = authorizedApprovalVerdict(await fetchReviews(pr), pull?.sha ?? null);
            } catch (error) {
              approval = unreadableApproval(String(error?.message ?? error).split('\n')[0]);
            }
          }
        }
        // ⭐ THE ENQUEUE LIFT (2026-10-26): no authorized approval, so who put
        // this entry in the queue is asked — the reading the governed leg
        // attached when it read this pull request, else one timeline read of
        // this leg's own. Undetermined lifts nothing; the sibling decides.
        if (approval.state !== 'approved' && approval.enqueue === undefined) {
          let enqueue;
          if (typeof fetchTimeline !== 'function') {
            enqueue = undeterminedEnqueue('no timeline reader was supplied to the size leg');
          } else {
            try {
              apiCalls += 1;
              enqueue = authorizedEnqueueVerdict(enqueuerFromTimeline(await fetchTimeline(pr)));
            } catch (error) {
              enqueue = undeterminedEnqueue(`the timeline could not be read (${String(error?.message ?? error).split('\n')[0]})`);
            }
          }
          approval = { ...approval, enqueue };
        }
        reading = sizeReading(pr, pull?.size ?? null, repo, approval);
      }
      readings.set(pr, reading);
    } catch (error) {
      readings.set(pr, {
        pr,
        state: 'unreadable',
        verdict: testVerdict([], { repo, size: null }),
        reason: String(error?.message ?? error).split('\n')[0],
      });
    }
  }
  return sizeGuardVerdict({ event, repo, pulls, readings, apiCalls });
}

// ── #19344: the remedy's terminal is a RULESET fact, so it is READ ─────────
//
// GitHub offers it only to an account ruleset `main` lists as a bypass actor,
// and `bypass_actors` is withheld below `administration`, so a read answers
// three ways and only ONE is a refusal. ⛔ Never assert a path from a field that
// was not read (a permission difference must not red CI), ⛔ never pass mute.
export const BYPASS_OPTION_PHRASE = "Merge button's bypass-rules option";

/** `offered` | `not-offered` | `unreadable`, with the words a log should carry. */
export function bypassActorReading(ruleset) {
  const read = ruleset && typeof ruleset === 'object' ? ruleset : {};
  if (!Object.prototype.hasOwnProperty.call(read, 'bypass_actors')) {
    return { reading: 'unreadable', detail: `bypass_actors: unreadable with this token (the key is absent); current_user_can_bypass: ${JSON.stringify(read.current_user_can_bypass ?? null)}` };
  }
  const actors = read.bypass_actors;
  if (Array.isArray(actors) && actors.length > 0) return { reading: 'offered', detail: `bypass_actors: ${actors.length} configured` };
  return { reading: 'not-offered', detail: `bypass_actors: ${JSON.stringify(actors)} — nobody is offered the bypass-rules option` };
}

/** Two ways to red: the remedy stops naming a path (#19344's defect), or the ruleset is READ to offer none. */
export function remedyPathVerdict({ remedy, ruleset }) {
  const names = remedy.includes(BYPASS_OPTION_PHRASE);
  const { reading, detail } = bypassActorReading(ruleset);
  return { ok: names && reading !== 'not-offered', names, reading, detail };
}

/**
 * The words a reader acts on for this leg. Returns '' on the `pull_request`
 * leg. Every entry prints WHAT WAS READ — the two numbers, their sum and the
 * threshold — on the clear path as much as on the refusal, so a queue log
 * always shows the number a landing was judged on. A lifted entry prints WHAT
 * LIFTED it — approver, commit, and the ruling's card (2026-09-27). The refusal
 * names the limb (SIZE), quotes the rulings untranslated, and names the
 * landings: an authorized APPROVED review and then the owning seat's landing,
 * the maintainer's own enqueue from an authorized account (2026-10-26), or a
 * human merge. ⛔ It does not advise making the diff smaller — a guard
 * that suggests how to get under its own line is a guard that gets routed
 * around.
 */
export function renderSizeVerdict(verdict) {
  if (verdict.conclusion === 'not-applicable') return '';
  const lines = [];
  lines.push(
    `${SIZE_LEG_NAME} — ${verdict.event} — ${verdict.entries.length} queued pull request(s), ` +
      `${verdict.apiCalls} pull read(s).`,
  );
  const numbers = (e) => `${e.verdict.size.changedLines} changed line(s) (+${e.verdict.size.additions} / -${e.verdict.size.deletions})`;
  // Why an oversized entry was NOT lifted, off the approval verdict this leg
  // read (or reused): the four non-lift cases of the 2026-09-27 ruling, named.
  // ...and the enqueue reading beside it (2026-10-26), named the same way.
  const enqueueClause = (enqueue) =>
    enqueue?.state === 'unauthorized'
      ? `; enqueued by ${enqueue.login}, outside GOVERNED_APPROVERS — that enqueue is not the maintainer's hand`
      : enqueue?.state === 'undetermined'
        ? `; enqueuer UNDETERMINED (${enqueue.reason}) — never a lift`
        : '';
  const noLift = (approval) => {
    if (!approval) return 'no review reading was recorded for this pull request';
    if (approval.state === 'unreadable') return `the review list could NOT be read (${approval.reason ?? 'unknown error'}) — fail closed, no lift${enqueueClause(approval.enqueue)}`;
    const unauthorized = (approval.unauthorizedApprovers ?? []).length > 0 ? `; APPROVED only by account(s) outside GOVERNED_APPROVERS: ${approval.unauthorizedApprovers.join(', ')} — never counts` : '';
    return `no authorized APPROVED review on record (${approval.reviewsRead ?? 0} review(s) read; authorized: ${GOVERNED_APPROVERS.join(', ')}; dismissed and superseded approvals never count)${unauthorized}${enqueueClause(approval.enqueue)}`;
  };
  for (const entry of verdict.entries) {
    if (entry.state === 'oversized') {
      lines.push(
        '',
        `  #${entry.pr} — ⛔ ${numbers(entry)} EXCEEDS the human-merge line ${entry.verdict.size.threshold}`,
        '        (additions + deletions, generated files INCLUDED) — and nothing lifts it: ' + noLift(entry.approval) + '.',
        '        This pull request lands by an authorized APPROVED review and then the OWNING seat, by the maintainer\'s',
        '        own enqueue from an account in GOVERNED_APPROVERS, or by a HUMAN MERGE.',
        `        read from: ${entry.verdict.size.source ?? '(source not recorded)'}`,
      );
    } else if (entry.state === 'lifted' && entry.verdict.size.lifted?.enqueuedBy) {
      lines.push(
        '',
        `  #${entry.pr} — ✅ ${numbers(entry)} EXCEEDS the human-merge line ${entry.verdict.size.threshold}, LIFTED by the maintainer's own`,
        `        enqueue from an authorized account: ${renderLiftApprovals(entry.verdict.size.lifted)} — ${entry.verdict.size.lifted.ruling},`,
        '        verbatim 「大部分我还是希望入队，但是我想省掉 Approve」 — the enqueue IS the human review; no APPROVED review was owed.',
        `        read from: ${entry.verdict.size.source ?? '(source not recorded)'}`,
      );
    } else if (entry.state === 'lifted') {
      lines.push(
        '',
        `  #${entry.pr} — ✅ ${numbers(entry)} EXCEEDS the human-merge line ${entry.verdict.size.threshold}, LIFTED by an authorized`,
        `        APPROVED review: ${renderLiftApprovals(entry.verdict.size.lifted)} — ${entry.verdict.size.lifted.ruling},`,
        '        verbatim 「所以阈值写死成 5000 行 , 维护者已经批准了就是可以合并。」 — the OWNING seat lands it through the queue.',
        `        read from: ${entry.verdict.size.source ?? '(source not recorded)'}`,
      );
    } else if (entry.state === 'unreadable') {
      lines.push('', `  #${entry.pr} — ⛔ the size could NOT be read — ${entry.reason}`);
    } else {
      lines.push('', `  #${entry.pr} — ✅ ${numbers(entry)}, at or under the human-merge line ${entry.verdict.size.threshold}.`);
    }
  }

  if (verdict.conclusion === 'clear') {
    lines.push(
      '',
      `  ✅  CLEAR — no queued pull request is over the human-merge line (${HUMAN_MERGE_LINE_THRESHOLD} changed lines,`,
      '      additions + deletions, generated files INCLUDED) without an authorized APPROVED review, or an enqueue from an',
      '      authorized account, lifting it. The number',
      '      is read off the pull object, per queued pull request; the threshold, the comparison and the lift are',
      '      scripts/pm/check-governed-merges.mjs\'s, imported.',
    );
    return lines.join('\n');
  }

  lines.push('', '  ⛔  REFUSED — this merge group must not land.');
  if (verdict.refusalKind === 'no-pull') {
    lines.push(
      '      This merge group names NO pull request — neither its commit subjects nor its queue head ref',
      '      resolve to one — so there is no size to read at all. Fail closed: a queue entry nobody can point',
      '      at a pull request for cannot be shown to be under the line.',
    );
  } else if (verdict.refusalKind === 'unreadable') {
    lines.push(
      '      The size could not be READ for at least one queued pull request above. ⛔ This is a refusal and',
      '      not a pass, deliberately: unlike the PR head, which has decided nothing since 2026-09-04, the size',
      '      DECIDES here, so a read that fails must refuse. "Nobody is over the line" and "we could not find',
      '      out" are different facts (exit 8 vs 9), and neither of them is "under". Re-run once the API is',
      '      reachable; if the object keeps omitting the pair, `node scripts/pm/check-governed-merges.mjs',
      '      --branch <ref>` counts the same range locally.',
    );
  } else {
    lines.push(
      '      At least one queued pull request above is over the human-merge line — the SIZE limb, whatever',
      '      paths it touches (additions + deletions, generated files INCLUDED: no regen family, docs build or',
      '      revert is carved out, because the case that prompted the ruling, PR #18971, was exactly that) —',
      '      and neither an authorized APPROVED review nor an enqueue from an authorized account lifts it. The',
      '      maintainer\'s rulings (verbatim, untranslated):',
      '',
      '        2026-09-18 「修改代码量超过某个行数（比如5000）就应该人工审核」',
      '        2026-09-27 「所以阈值写死成 5000 行 , 维护者已经批准了就是可以合并。」 (objectstack#20153)',
      '        2026-10-09 「这种大额改动就应该人工审核,我还是建议5000行的人工审核门槛降到 3000,立卡。」',
      '        2026-10-26 「大部分我还是希望入队，但是我想省掉 Approve」',
      '',
      '      landed as `HUMAN_MERGE_LINE_THRESHOLD` and the lift in scripts/pm/check-governed-merges.mjs, which',
      '      this leg IMPORTS — the number, the comparison, what counts and what lifts are that file\'s, never',
      '      restated here.',
    );
  }
  lines.push(
    '',
    '      What satisfies this check:',
    '        1. ⭐ The pull request is IN the queue, and disabling auto-merge and converting it to DRAFT do not',
    '           take it out of the queue',
    '           (`.claude/skills/pm-dispatch/references/readings-queue.md`, queue membership).',
    '           So its landing seat sends the relay\'s `pr_dequeue` AT ONCE (measured live, comment 6902190812);',
    '           any other seat, or a stroke that does not land, asks the maintainer AT ONCE to remove it by hand.',
    '           Disable auto-merge AND convert it back to DRAFT, which disarms it so it does not re-enter once',
    '           removed; then confirm from the remote that it is in neither the queue nor `origin/main` — the',
    '           pull-back of AGENTS.md Prime',
    '           Directive #14. Out of the queue and in draft is the SAFE state.',
    '        2. Then ONE of the landings — the same terminal a Tier H governed diff has: ACCEPT on the card,',
    '           `pm:awaiting-merge` on the PR, a final 维护者速读, review requested from GOVERNED_APPROVERS',
    `           (${GOVERNED_APPROVERS.join(', ')}); and then EITHER`,
    '           (a) an APPROVED review by one of those accounts, on ANY commit (2026-09-27, objectstack#20153) —',
    '               the OWNING seat then lands it through the queue (席位落地): ready, auto-merge, this check',
    '               passes on the lift; a dismissed, superseded or unauthorized approval never counts, no review',
    '               of record (Tier S) substitutes, and an unreadable review list fails closed on this same code;',
    '           (b) OR the maintainer\'s own click (人工直合) — the Merge button\'s bypass-rules option, offered',
    '               only while ruleset `main` configures a bypass actor — ⛔ NOT a second Merge button: `main`',
    '               mandates the queue and requires this check, so with none configured every re-enqueue comes',
    '               back here (#19344). The audit log records the bypass and `check-governed-merges` lists such',
    '               a landing on size, as it lists a lifted one;',
    '           (c) OR the maintainer\'s own "Merge when ready" from an account in GOVERNED_APPROVERS (2026-10-26):',
    '               that enqueue IS the human review, and this check passes on it with no APPROVED review. ⛔ No seat',
    '               enqueues or arms auto-merge under such an account in its place; a seat\'s own re-enqueue after an',
    '               ejection is a new entry and needs (a) or another such click.',
    '',
    '      When the governed-surface leg above ALSO refused, both limbs fired on this group: the exit code is',
    '      the governed leg\'s (precedence governed > size, pinned) and this limb stands regardless.',
    '      ⛔ "Edit this check" and moving the threshold here are not ways through — the threshold lives in ONE',
    '         place, and this file only reads it.',
    '',
    '      Verify any pull request\'s number before acting: node scripts/pm/check-governed-merges.mjs --pr <n>',
  );
  return lines.join('\n');
}

// ── the NARROWED leg: a declared narrowing lands like Tier H (2026-11-19) ────

/** The leg's own name in a log — the third predicate inside the same check run. */
export const NARROWED_LEG_NAME = 'Narrowed Spec Change (2026-11-19 ruling)';

/**
 * Where the leg is ruled, as a log line carries it. The maintainer's own words are quoted in the header section
 * ("The FIFTH leg"); ⛔ not here — this string is printed on every refusal, and the quotation names a tier by
 * its value, which a runtime message never carries.
 */
export const NARROWED_RULING = 'maintainer ruling 2026-11-19 on #35321: a spec change that narrows what an author may write lands by the maintainer';

/**
 * Every line of `text` that DECLARES a narrowing, read with the fleet's two line readers one line at a time
 * (`readMetadataProtocolLine`, `readClause2Line` — ⛔ never a second parser): a `Metadata-protocol: narrowed`
 * line, or a `Clause-②:` line carrying the `(narrowing)` arm on either value. Line by line rather than
 * first-match, so a `none` written above a `narrowed` does not hide it; a line that only QUOTES the spelling
 * is the readers' own `describing` near miss and declares nothing. ⛔ One direction fails closed: a line that
 * IS the key, reads `malformed` and spells `narrow` anywhere (`no (narrowed)`, `narrowing`) counts as declared —
 * the readers collapse a near-arm into `malformed` exactly so it cannot read as no narrowing. `added`,
 * `semantic`, `none`, a bare `yes`/`no` and `yes (widening)` declare none.
 * ⛔ ONE malformed line that spells `narrow` declares nothing: the pull-request template's own UNFILLED line, the
 * whole menu with no value chosen (`UNFILLED_PROTOCOL_MENU`, built from the readers' closed set). A body that
 * left the template as it came chose nothing, and reading it as a narrowing would refuse every such pull —
 * the maintainer's own included. Exactly that menu: a partial one (`narrowed | none`) still counts. Pure.
 */
export const UNFILLED_PROTOCOL_MENU = METADATA_PROTOCOL_KINDS.join(' | ');

/**
 * The ONE spelling `reviewFace` reads as the narrowing arm, built from the readers' closed sets. `recordVerdict`
 * hands it in for a pull request this leg found a declared narrowing on, so the record half is held to the
 * narrowing face's tier whichever line carried the declaration. ⛔ Never written to a body or a record.
 */
export const NARROWING_FACE_LINE = `Clause-②: ${CLAUSE2_VALUES[1]} (${CLAUSE2_ARMS[1]})`;
export function narrowingDeclarationsIn(text) {
  const unfilled = (value) => String(value ?? '').replace(/[ \t]+/g, ' ').trim() === UNFILLED_PROTOCOL_MENU;
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const kind = readMetadataProtocolLine(line);
    if (kind?.kind === 'declared' && kind.value === 'narrowed') out.push({ key: 'Metadata-protocol', line: kind.line });
    else if (kind?.kind === 'malformed' && /narrow/i.test(line) && !unfilled(kind.value)) out.push({ key: 'Metadata-protocol', line: kind.line });
    const clause = readClause2Line(line);
    if (clause?.kind === 'declared' && clause.arm === 'narrowing') out.push({ key: 'Clause-②', line: clause.line });
    else if (clause?.kind === 'malformed' && /narrow/i.test(line)) out.push({ key: 'Clause-②', line: clause.line });
  }
  return out;
}

/** Every changeset each queued pull request's commits touch, with the commit it is read at: `Map(pr → [{ sha, path }])`. Pure. */
export function changesetRefsByPull(rows) {
  const byPull = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.pr !== 'number' || !Number.isInteger(row.pr) || row.pr <= 0) continue;
    const refs = byPull.get(row.pr) ?? [];
    for (const p of Array.isArray(row.paths) ? row.paths : []) {
      if (typeof p === 'string' && LOW_RISK_CHANGESET_PATH.test(p)) refs.push({ sha: row.sha ?? null, path: p });
    }
    byPull.set(row.pr, refs);
  }
  return byPull;
}

/**
 * The committed text of each changeset ref, read with `runGit` at the commit that touched it:
 * `{ measured, reason, files: [{ path, text }] }`. A changeset the commit DELETED has no text to declare
 * anything and is left out — told apart from a failed read by `git ls-tree`, which answers nothing for a path
 * the commit does not hold. No git reader, a ref with no commit, or a read that fails for a path the commit
 * DOES hold is NOT MEASURED. Never throws.
 */
export function readChangesetTexts(refs, runGit) {
  const unmeasured = (reason) => ({ measured: false, reason, files: [] });
  const list = Array.isArray(refs) ? refs : [];
  if (list.length === 0) return { measured: true, reason: null, files: [] };
  if (typeof runGit !== 'function') return unmeasured('no git reader was handed to this leg, so its changesets were not read');
  const files = [];
  for (const { sha, path } of list) {
    if (!sha) return unmeasured(`\`${path}\` names no commit to read it at`);
    try {
      files.push({ path, text: String(runGit(['show', `${sha}:${path}`])) });
    } catch (error) {
      let held;
      try {
        held = String(runGit(['ls-tree', sha, '--', path])).trim() !== '';
      } catch {
        held = true;
      }
      if (held) return unmeasured(`\`${path}\` could not be read at ${String(sha).slice(0, 12)} (${String(error?.message ?? error).split('\n')[0]})`);
    }
  }
  return { measured: true, reason: null, files };
}

/**
 * ONE queued pull request, judged. Pure.
 *
 *   not-declared  neither its body nor a changeset its commits touch declares a narrowing — nothing is owed here;
 *   cleared       it declares one, AND a human half holds (an authorized APPROVED review, or the maintainer's own
 *                 enqueue from an authorized account — the 2026-10-26 ruling, as on a Tier H entry), AND the record
 *                 half holds (a `## Contract review` record for the current head that stands at its face's tier and
 *                 reads PASS — `recordVerdict` then `recordPassVerdict`, the Tier S leg's own two readers);
 *   refused       it declares one and a half is missing, each named in `reasons`;
 *   unreadable    its body or a changeset could not be read, or a half that would decide could not be.
 *
 * ⛔ BOTH halves, never either: the approval is who lands it, the record is the review the narrowing face owes.
 */
export function narrowedReading({ pr, body = null, changesets = null, approval = null, enqueue = null, record = null }) {
  if (typeof body !== 'string') return { pr, state: 'unreadable', declarations: [], reasons: ['its pull request body could not be read, so what it declares is unknown'] };
  if (!changesets || changesets.measured !== true) return { pr, state: 'unreadable', declarations: [], reasons: [`its changesets were not read (${changesets?.reason ?? 'no reading'}), so what they declare is unknown`] };
  const declarations = [
    ...narrowingDeclarationsIn(body).map((d) => ({ ...d, where: 'the PR body' })),
    ...changesets.files.flatMap((f) => narrowingDeclarationsIn(f.text).map((d) => ({ ...d, where: `\`${f.path}\`` }))),
  ];
  if (declarations.length === 0) return { pr, state: 'not-declared', declarations, reasons: [] };
  const reasons = [];
  let unreadable = false;
  const human = approval?.state === 'approved' ? 'review' : enqueue?.state === 'authorized' ? 'enqueue' : null;
  if (human === null) {
    if (approval?.state === 'unreadable') {
      unreadable = true;
      reasons.push(`the review list could not be read (${approval.reason ?? 'unknown error'})`);
    } else {
      const outside = (approval?.unauthorizedApprovers ?? []).length > 0 ? `; APPROVED only by ${approval.unauthorizedApprovers.join(', ')}, outside GOVERNED_APPROVERS` : '';
      reasons.push(`no authorized APPROVED review is on record (authorized: ${GOVERNED_APPROVERS.join(', ')})${outside}, and no authorized account enqueued it`);
    }
  }
  if (record?.state !== 'stands' || record?.verdict !== 'PASS') {
    if (!record || record.state === 'unreadable') {
      unreadable = true;
      reasons.push(`its contract-review record could not be read (${record?.reason ?? 'no record reading was recorded'})`);
    } else if (record.state === 'absent') reasons.push(`no \`## Contract review\` record names its current head (${record.readSummary ?? 'no thread summary'})`);
    else if (record.state === 'not-pass') reasons.push(`its contract-review record does not read a clean PASS: ${record.verdictReason ?? 'no reason recorded'}`);
    else reasons.push(`its contract-review record does not stand (${record.state})`);
  }
  return { pr, state: reasons.length === 0 ? 'cleared' : unreadable ? 'unreadable' : 'refused', declarations, reasons, by: human, record: record ?? null };
}

/**
 * The narrowed verdict, as data. Pure, the same shape as `sizeGuardVerdict`. ⚠️ `merge_group` ONLY: the
 * `pull_request` leg returns `not-applicable` and renders the empty string, so that leg's output stays
 * byte-identical and makes no read for it. A group that names no pull request has no body to read and refuses;
 * a reading that never arrived is `unreadable`, never `not-declared`.
 */
export function narrowedGuardVerdict({ event, repo, pulls = [], readings = new Map(), apiCalls = 0 }) {
  assertGovernedRepo(repo, 'narrowedGuardVerdict');
  const base = { event, repo, entries: [], apiCalls, legName: NARROWED_LEG_NAME };
  if (event !== EVENT_MERGE_GROUP) return { ...base, conclusion: 'not-applicable', exitCode: EXIT_CLEAR, refusalKind: null };
  if (pulls.length === 0) return { ...base, conclusion: 'refused', exitCode: EXIT_REFUSED_NARROWED_UNREADABLE, refusalKind: 'no-pull' };
  const entries = pulls.map((pr) => readings.get(pr) ?? { pr, state: 'unreadable', declarations: [], reasons: ['no reading was recorded for this pull request'] });
  const out = { ...base, entries };
  if (entries.some((e) => e.state === 'unreadable')) return { ...out, conclusion: 'refused', exitCode: EXIT_REFUSED_NARROWED_UNREADABLE, refusalKind: 'unreadable' };
  if (entries.some((e) => e.state === 'refused')) return { ...out, conclusion: 'refused', exitCode: EXIT_REFUSED_NARROWED, refusalKind: 'narrowed' };
  return { ...out, conclusion: 'clear', exitCode: EXIT_CLEAR, refusalKind: null };
}

/**
 * The narrowed orchestrator, IO injected — the SAME readers the other two legs use. Every queued pull request
 * is read (`queuedPullsInGroup`, so a bare sibling cannot carry a declared narrowing through): one pull read
 * for its body, and its changesets off the committed trees. ⭐ Everything past that is read ONLY for a pull
 * request that declares a narrowing: the review list (reused from the governed leg's `approvals` where that leg
 * read it), the timeline when no approval holds, and the record threads. A throw is caught into an
 * `unreadable` reading, never a pass and never an escaping rejection.
 */
export async function runNarrowedGuard({ event, repo, rows, namedPull = null, fetchPull, fetchReviews = null, fetchTimeline = null, fetchComments = null, loadRecognisers = loadRecordRecognisers, approvals = new Map(), runGit = null, baseRef = null }) {
  assertGovernedRepo(repo, 'runNarrowedGuard');
  if (event !== EVENT_MERGE_GROUP) return narrowedGuardVerdict({ event, repo });
  const pulls = queuedPullsInGroup(rows, namedPull);
  const refsByPull = changesetRefsByPull(rows);
  const pathsByPull = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.pr !== 'number') continue;
    pathsByPull.set(row.pr, [...new Set([...(pathsByPull.get(row.pr) ?? []), ...(Array.isArray(row.paths) ? row.paths.filter((p) => typeof p === 'string' && p !== '') : [])])]);
  }
  const why = (error) => String(error?.message ?? error).split('\n')[0];
  const readings = new Map();
  let recognisers = null;
  let apiCalls = 0;
  for (const pr of pulls) {
    let pull;
    try {
      apiCalls += 1;
      pull = await fetchPull(pr);
    } catch (error) {
      readings.set(pr, { pr, state: 'unreadable', declarations: [], reasons: [`its pull request could not be read (${why(error)}), so what its body declares is unknown`] });
      continue;
    }
    const body = typeof pull?.body === 'string' ? pull.body : null;
    const changesets = readChangesetTexts(refsByPull.get(pr) ?? [], runGit);
    const first = narrowedReading({ pr, body, changesets });
    if (first.state === 'not-declared' || first.declarations.length === 0) {
      readings.set(pr, first);
      continue;
    }
    // ── it declares a narrowing: the human half, then the record half ──
    let approval = approvals.get(pr) ?? null;
    if (approval === null) {
      if (typeof fetchReviews !== 'function') approval = unreadableApproval('no review reader was supplied to the narrowed leg');
      else {
        try {
          apiCalls += 1;
          approval = authorizedApprovalVerdict(await fetchReviews(pr), pull?.sha ?? null);
        } catch (error) {
          approval = unreadableApproval(why(error));
        }
      }
    }
    let enqueue = approval.enqueue ?? null;
    if (approval.state !== 'approved' && enqueue === null) {
      if (typeof fetchTimeline !== 'function') enqueue = undeterminedEnqueue('no timeline reader was supplied to the narrowed leg');
      else {
        try {
          apiCalls += 1;
          enqueue = authorizedEnqueueVerdict(enqueuerFromTimeline(await fetchTimeline(pr)));
        } catch (error) {
          enqueue = undeterminedEnqueue(`the timeline could not be read (${why(error)})`);
        }
      }
    }
    if (recognisers === null) {
      try {
        recognisers = await loadRecognisers();
      } catch (error) {
        recognisers = { available: false, reason: `the recogniser load threw: ${why(error)}` };
      }
    }
    let record;
    if (recognisers.available !== true) record = recordVerdict({ pair: null, recognisers });
    else {
      const row = { number: pr, body: body ?? '', head: { ref: pull?.headRef ?? '' } };
      const card = recognisers.deliveredCard(row);
      const cardNote = card.card === null ? `⚠️ no card thread was searched — ${card.reason}` : `card #${card.card}, ${card.evidence}`;
      // ⭐ `declaredOn` and `narrowingDeclared` are what put a narrowing with no schema and no governed path on the
      // narrowing FACE, so the record must stand at that face's tier (`reviewFace`), never at the declaration face's
      // cheaper one — on either declaration line: this point is reached only with a declaration found above.
      const pair = { pr, card: card.card, headSha: pull?.sha ?? null, runGit, baseRef, paths: pathsByPull.get(pr) ?? [], repo, declaredOn: [body ?? '', ...changesets.files.map((f) => f.text)], narrowingDeclared: true };
      const threads = typeof fetchComments === 'function'
        ? await readRecordThreads({ pair, recognisers, fetchComments })
        : { ignoredAuthors: [], unreadable: 'no comment reader was supplied to the narrowed leg, so no thread was read', apiCalls: 0 };
      apiCalls += threads.apiCalls;
      record = threads.unreadable !== null
        ? { state: 'unreadable', reason: threads.unreadable, cardNote }
        : recordPassVerdict(recordVerdict({ pair, recognisers, cardNote }), pair, recognisers);
    }
    readings.set(pr, narrowedReading({ pr, body, changesets, approval, enqueue, record }));
  }
  return narrowedGuardVerdict({ event, repo, pulls, readings, apiCalls });
}

/**
 * The words a reader acts on for this leg. Returns '' on the `pull_request` leg. A pull request that declares
 * nothing costs one line for the whole group; one that declares a narrowing prints the declaring line(s), where
 * each sits, and what cleared it or what is still owed. The refusal quotes the ruling untranslated and names
 * the two halves. ⛔ It does not advise rewording the declaration — a guard that suggests how to stop being
 * asked is a guard that gets routed around.
 */
export function renderNarrowedVerdict(verdict) {
  if (verdict.conclusion === 'not-applicable') return '';
  const lines = [`${NARROWED_LEG_NAME} — ${verdict.event} — ${verdict.entries.length} queued pull request(s), ${verdict.apiCalls} API read(s).`];
  const declared = (e) => e.declarations.slice(0, 4).map((d) => `        - ${d.where}: ${d.line}`);
  for (const entry of verdict.entries) {
    if (entry.state === 'not-declared') continue;
    if (entry.state === 'cleared') {
      lines.push('', `  #${entry.pr} — ✅ declares a narrowing, and both halves are on record: ${entry.by === 'review' ? 'an authorized APPROVED review' : "the maintainer's own enqueue from an authorized account"}, and a PASS contract review for its head (${entry.record?.where ?? 'a'} comment ${entry.record?.id ?? '(no id)'}).`, ...declared(entry));
    } else {
      lines.push('', `  #${entry.pr} — ⛔ ${entry.declarations.length > 0 ? 'declares a narrowing and is NOT cleared' : 'could NOT be read'}:`, ...declared(entry), ...entry.reasons.map((r) => `        ⛔ ${r}`));
    }
  }
  if (verdict.conclusion === 'clear') {
    const cleared = verdict.entries.filter((e) => e.state === 'cleared').length;
    lines.push(
      '',
      cleared === 0
        ? '  ✅  CLEAR — no queued pull request declares a narrowing (`Metadata-protocol: narrowed`, or a `Clause-②:` line with'
        : `  ✅  CLEAR — ${cleared} queued pull request(s) declare a narrowing and each carries both halves; no other declares one (\`Metadata-protocol: narrowed\`, or a \`Clause-②:\` line with`,
      '      the `(narrowing)` arm), read off each PR body and each changeset its commits touch. `added`, `semantic` and `none` are not this leg\'s.',
    );
    return lines.join('\n');
  }
  lines.push('', '  ⛔  REFUSED — this merge group must not land.');
  if (verdict.refusalKind === 'no-pull') {
    lines.push('      This merge group names NO pull request, so there is no body to read a declaration from. Fail closed.');
  } else if (verdict.refusalKind === 'unreadable') {
    lines.push(
      '      A reading this leg decides on could not be taken for at least one queued pull request above. ⛔ A refusal and',
      '      not a pass: "nobody declares a narrowing" and "we could not find out" are different facts (exit 10 vs 11).',
    );
  } else {
    lines.push(
      '      At least one queued pull request above declares that it NARROWS what an author may write — a key removed or',
      '      tombstoned, a value refused, a requirement tightened: metadata that validated yesterday is rejected after it —',
      `      and lands like Tier H (${NARROWED_RULING}).`,
    );
  }
  lines.push(
    '',
    '      What satisfies this check — BOTH, on the pull request:',
    `        1. the human half: an APPROVED review by an account in GOVERNED_APPROVERS (${GOVERNED_APPROVERS.join(', ')}), on any commit, or the`,
    '           maintainer\'s own "Merge when ready" from such an account (2026-10-26); a dismissed, superseded or',
    '           unauthorized approval never counts, and ⛔ no seat enqueues under such an account in its place;',
    `        2. the record half: a \`## Contract review\` comment on ${REVIEW_OF_RECORD_LOCATION} naming the CURRENT head, standing at the`,
    '           tier its face maps to (`Served-tier:`), one `**VERDICT: PASS**`, no FAIL and no open must-fix or should-fix.',
    '      Until both hold the pull request waits OUT of the queue, in draft (the pull-back of AGENTS.md Prime Directive #14).',
    '      ⛔ "Edit this check" and rewording the declaration are not ways through: the declaration is what the release',
    '         level and the release notes are read from.',
  );
  return lines.join('\n');
}

/**
 * THREE legs, ONE exit code. Pure, and pinned: the governed leg's refusal
 * wins, then the size leg's, then the narrowed leg's (2026-11-19; a caller
 * that ran no narrowed leg hands none in and the two-leg answer stands). The governed refusal sits on top because its
 * remedy is the stricter one (no landing at all without an authorized
 * approval, a record, or the maintainer's own direct merge); the size
 * refusal's remedy is the same terminal as Tier H (an authorized approval, or
 * the maintainer's merge) — a group that is both governed-unsatisfied and
 * oversized prints both limbs and exits on the governed one. ⛔ No leg's code is swallowed silently: every block is always
 * printed, whichever code the run exits on.
 */
export function groupExitCode({ governed, size, narrowed = null }) {
  if (governed?.exitCode !== EXIT_CLEAR) return governed.exitCode;
  if (size.exitCode !== EXIT_CLEAR || narrowed === null) return size.exitCode;
  return narrowed.exitCode;
}


// ── git (diff decomposition; zero API) ──────────────────────────────────────

function git(root, args, input) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Is `rev` an object this checkout actually has? A missing sha is a hard failure, never an empty diff. */
function hasRev(root, rev) {
  try {
    git(root, ['cat-file', '-e', `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The rows a diff is judged on, read two ways — one per event, because the two
 * events ask different questions of the same range.
 *
 * `merge_group` (the default): the first-parent commits between `baseSha` and
 * `headSha`, each with the paths it changed and the pull request its subject
 * names. One row per PR landing in a merge group; see the header on why the
 * group is decomposed rather than keyed to `head_ref`.
 *
 * `pull_request`: ONE row — the net diff `baseSha..headSha` (the caller hands
 * in the merge-base), attributed to the payload's own pull request number,
 * which the event names outright. A subject is no evidence here: a commit
 * subject naming an ISSUE (`fix: … (#<issue>)`) would read that issue's
 * reviews, and a branch that merged `origin/main` would carry, on its merge
 * commit's first-parent diff, every path `main` already landed. The net diff
 * against the merge-base holds only what the pull request itself changes.
 * `commits` keeps the range's first-parent commit count for the header line.
 *
 * ⛔ Both path reads are `-z`, split on NUL. Without it git C-quotes a path
 * holding a non-ASCII byte, a quote or a control character
 * (`"skills/x/\346\226\207.md"`), and the quoted spelling matches no
 * governed prefix: the queue would not see that governed file at all. `-z`
 * prints every path raw, the same spelling `catalogFilesOf` and the
 * carried-head read already take.
 *
 * `runGit(args)` is the seam the self-test drives; production passes none and
 * reads the checkout at `root`.
 */
export function enumerateRows(root, baseSha, headSha, fallbackPull = null, { event = EVENT_MERGE_GROUP, runGit = null } = {}) {
  const readGit = runGit ?? ((args) => git(root, args));
  const log = readGit(['log', '--first-parent', '--format=%H%x09%s', `${baseSha}..${headSha}`]);
  const commits = log
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const [sha, ...rest] = l.split('\t');
      return { sha, subject: rest.join('\t') };
    });
  if (event === EVENT_PULL_REQUEST) {
    if (commits.length === 0) return [];
    return [
      {
        sha: headSha,
        subject: commits[0].subject,
        pr: fallbackPull,
        commits: commits.length,
        paths: readGit(['diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-only', '-z', baseSha, headSha])
          .split('\0')
          .filter((p) => p !== ''),
      },
    ];
  }
  return commits.map((commit) => ({
    ...commit,
    // The fallback is only unambiguous when the range holds exactly one
    // commit; in a multi-PR group `head_ref` names the LAST PR, and applying
    // it to an earlier commit attributes a governed diff to the wrong PR.
    pr: pullNumberFromSubject(commit.subject) ?? (commits.length === 1 ? fallbackPull : null),
    paths: readGit(['diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-only', '-z', '-m', '--first-parent', commit.sha])
      .split('\0')
      .filter((p) => p !== ''),
  }));
}

/**
 * Every row that touches a `workflows` path gets the reading the split needs
 * (`readWorkflowDiff`, imported — ⛔ never a second classifier here). The
 * `pull_request` row is read over its own range, merge-base to head; a
 * `merge_group` row over its commit and that commit's first parent. "Already
 * in use" is the merge-base's tree on both legs — the queue's own base — so an
 * earlier pull request in the same group cannot vouch for a later one's new
 * action. A reading that fails is UNMEASURED, and that entry stays Tier H.
 * `runGit(args)` returns stdout and throws, as `enumerateRows`'s seam does.
 */
export function attachWorkflowReadings(rows, { event = EVENT_MERGE_GROUP, mergeBase, runGit }) {
  const cache = new Map();
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!(row?.paths ?? []).some((p) => p.startsWith(WORKFLOWS_PREFIX))) return row;
    let base = mergeBase;
    if (event !== EVENT_PULL_REQUEST) {
      try {
        base = runGit(['rev-parse', '--verify', `${row.sha}^1`]).trim();
      } catch (error) {
        return { ...row, workflowDiff: { measured: false, reason: `the first parent of ${String(row.sha).slice(0, 12)} could not be read (${String(error?.message ?? error).split('\n')[0]})`, files: [] } };
      }
    }
    return { ...row, workflowDiff: readWorkflowDiff({ paths: row.paths, base, head: row.sha, inventoryBase: mergeBase, git: runGit, cache }) };
  });
}

/**
 * How many commits the read range held — the header line's count. A
 * `pull_request` net row carries its range's count; a `merge_group` reading
 * is one row per commit, so the row count IS the commit count there.
 */
export function commitsInRange(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.reduce((n, row) => n + (Number.isInteger(row?.commits) ? row.commits : 1), 0);
}

/**
 * Does any row touch a register path the lift would RECOMPUTE? Pure, and THE
 * one predicate for it: `liftGeneratedExceptions` consults the recompute iff
 * this answers true, and the `pull_request` leg acquires the generator
 * toolchain iff `--toolchain-needed` answers it true — so the workflow can
 * never skip an install the lift was going to need. Membership is the
 * register's own `generatedExceptionFor`; ⛔ never a path list restated here or
 * in the YAML.
 */
export function toolchainNeededFor(rows) {
  return (Array.isArray(rows) ? rows : []).some((row) => (row?.paths ?? []).some((p) => generatedExceptionFor(p) !== null));
}

/**
 * Drop a registered generated-artifact path from a row's path list when — and
 * only when — this build's own recomputation certifies it as a pure
 * regeneration. Everything else about the row is untouched, so a row that never
 * contains a registered path never consults provenance at all (ruled
 * constraint 3: every other governed-surface judgment is unchanged).
 *
 * ⭐ ONE mechanism, not a second copy (#11705 ruled: "⛔ do not author a second
 * mechanism"). Membership is the register's own `generatedExceptionFor`, and
 * the recompute is the register's own `recomputeProvenanceFor` — so a row added
 * there reaches this guard with nothing to change here. Before #11705 this file
 * derived its own set from `.path`, which reads `undefined` for a row that
 * matches by candidate instead: a silent miss, in the direction of leaving
 * paths governed, that a second register row would have made real.
 *
 * Two things this build supplies that a seat run does not: `baseRef`, because a
 * queue build has no reason to hold `origin/main`; and a `cache`, because the
 * generator runs read the TREE, which is the same for every row in the range.
 * `recompute` is injectable for the self-test only — the default IS the shared
 * driver, so nothing in production reaches this file with a different one.
 * ⚠️ The #11705 rows recompute by running the generator's own `--check`, which
 * needs the workspace's dependencies; the job installs them (see the header),
 * and when that install did not happen the recompute says so and the path stays
 * GOVERNED — the note it pushes states the reason in full rather than implying
 * it.
 */
export async function liftGeneratedExceptions(root, baseSha, rows, notes, recompute = recomputeProvenanceFor, repo = undefined) {
  assertGovernedRepo(repo, 'liftGeneratedExceptions');
  const registered = (row) => row.paths.filter((p) => generatedExceptionFor(p) !== null);
  if (!toolchainNeededFor(rows)) return rows;
  const cache = new Map();
  const out = [];
  for (const row of rows) {
    const hits = registered(row);
    if (hits.length === 0) {
      out.push(row);
      continue;
    }
    const provenance = await recompute(root, groupHitsByException(hits), {
      allPaths: row.paths,
      baseRef: baseSha,
      cache,
    });
    const lifted = applyGeneratedExceptions(testVerdict(row.paths, { repo }), provenance);
    for (const e of lifted.exceptions ?? []) {
      notes.push(
        e.pureRegeneration
          ? `  ℹ️  generated-surface exception (${e.ruling ?? '#9866'}) LIFTED ${e.path} on ${row.sha.slice(0, 12)}: ${e.reason}`
          : `  ⛔  generated-surface exception (${e.ruling ?? '#9866'}) did NOT lift ${e.path} on ${row.sha.slice(0, 12)}: ${e.reason}`,
      );
    }
    const stillGoverned = new Set(lifted.hitPaths);
    out.push({ ...row, paths: row.paths.filter((p) => generatedExceptionFor(p) === null || stillGoverned.has(p)) });
  }
  return out;
}

/**
 * Which registered paths `liftGeneratedExceptions` actually LIFTED, derived
 * from the row lists on either side of it. Pure, so the rendering that depends
 * on it is pinned offline.
 *
 * Read from the rows rather than from the notes: the notes are prose for a
 * human, and a verdict that parsed them back would be deriving a decision from
 * a rendering. Membership is still the register's own `generatedExceptionFor` —
 * a path that vanished for any other reason is not reported as a lift.
 *
 * ⚠️ Deliberately conservative across rows: a path kept by ANY row is not
 * listed, because the #11084 fence is per-row and one row's co-edit can keep a
 * path governed that another row's recompute certified. Under-reporting a lift
 * only ever costs a line of log; over-reporting one would put "we lifted it"
 * next to a verdict that did not.
 */
export function liftedPathsBetween(before, after) {
  const kept = new Set((Array.isArray(after) ? after : []).flatMap((r) => r?.paths ?? []));
  const out = [];
  for (const row of Array.isArray(before) ? before : []) {
    for (const p of row?.paths ?? []) {
      if (kept.has(p) || generatedExceptionFor(p) === null || out.includes(p)) continue;
      out.push(p);
    }
  }
  return out;
}

/**
 * The workflow's toolchain wiring, as data — the #14063 half of the wiring pin.
 *
 * Pure and text-based, deliberately: this file has no YAML parser (it is
 * dependency-free by contract, and so is the job that runs it), and the
 * questions asked here are about the workflow's TEXT anyway. Every field is a
 * fact the self-test turns into a named assertion, so a reader of a failure
 * sees which one of them stopped holding.
 *
 * ⚠️ `toolchainSteps` is defined POSITIONALLY — the steps between the self-test
 * and the live judgment — so a reordering that empties it would make "every
 * toolchain step degrades instead of reddening" pass vacuously. The self-test
 * therefore asserts the block is non-empty and contains the install, which is
 * the only reading under which the emptiness could be honest.
 */
export function installStepAudit(source) {
  const text = String(source ?? '');
  const at = text.indexOf('\n    steps:\n');
  const body = at === -1 ? '' : text.slice(at);
  const blocks = body
    .split(/\n {6}- (?=\S)/)
    .slice(1)
    .map((b) => `- ${b}`);
  const nameOf = (b) => (/^- name: (.*)$/m.exec(b)?.[1] ?? /^- uses: (.*)$/m.exec(b)?.[1] ?? '(unnamed)').trim();
  const selfTestIndex = blocks.findIndex((b) => /check-governed-queue-guard\.mjs --self-test/.test(b));
  const judgmentIndex = blocks.findIndex((b) => /run: node scripts\/pm\/check-governed-queue-guard\.mjs\s*$/m.test(b));
  const installIndex = blocks.findIndex((b) => /(?:^|[\s;&|])pnpm install\b/.test(b));
  const installCommand = installIndex === -1 ? '' : (/pnpm install[^\n]*/.exec(blocks[installIndex])?.[0] ?? '').trim();
  const toolchain =
    selfTestIndex === -1 || judgmentIndex === -1 ? [] : blocks.filter((_b, i) => i > selfTestIndex && i < judgmentIndex);
  return {
    steps: blocks.map(nameOf),
    // Each step's own YAML with comment lines dropped: a comment above a step
    // belongs to the block BEFORE it, so a pin on `if:` or `with:` text must
    // never read prose.
    stepBodies: blocks.map((b) => ({ name: nameOf(b), body: b.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n') })),
    selfTestIndex,
    judgmentIndex,
    installIndex,
    installCommand,
    // A `--filter` on the install is what would turn this workflow into a
    // second, drifting copy of the register's `verify.pkg` set; an empty list
    // is the register-agnostic install every row gets for free.
    installFilters: [...installCommand.matchAll(/--filter[= ]\s*([^\s]+)/g)].map((m) => m[1].replace(/^['"]|['"]$/g, '')),
    acquiresPnpm: /uses:\s*\.\/\.github\/actions\/setup-pnpm/.test(body),
    toolchainSteps: toolchain.map(nameOf),
    toolchainWithoutContinueOnError: toolchain.filter((b) => !/^\s*continue-on-error:\s*true\s*$/m.test(b)).map(nameOf),
  };
}

// ── the GitHub reads (PR head, reviews, threads, timeline — the only API surface) ─

function apiHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Every review on a pull request, paginated. Throws on any non-2xx — the
 * caller turns a throw into a REFUSAL, never into a pass, so there is no
 * tolerant branch to get wrong here.
 */
export function makeReviewReader({ apiUrl, slug, token, fetchImpl = fetch, perPage = 100, maxPages = 10 }) {
  return async function fetchReviews(pull) {
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const url = `${apiUrl}/repos/${slug}/pulls/${pull}/reviews?per_page=${perPage}&page=${page}`;
      const res = await fetchImpl(url, { headers: apiHeaders(token) });
      if (!res.ok) throw new Error(`GET /repos/${slug}/pulls/${pull}/reviews answered HTTP ${res.status}`);
      const batch = await res.json();
      if (!Array.isArray(batch)) throw new Error(`the reviews endpoint answered a non-array body for #${pull}`);
      all.push(...batch);
      if (batch.length < perPage) return all;
    }
    throw new Error(`#${pull} has more than ${perPage * maxPages} reviews — refusing to judge a truncated list`);
  };
}

/**
 * The pull request OBJECT, reduced to the four fields this file reads.
 *
 * `sha` is the CURRENT head — what the 2026-08-27 predicate pinned a review's
 * `commit_id` against, and what a review of record names. `body` and `headRef`
 * are what the references tier locates the pull request's CARD from (#18701):
 * the same closing-keyword / `Part of` / branch-name relation the rest of the
 * regime pairs a PR with its card by, asked through `deliveredCardNumber`.
 * `size` is the `additions` / `deletions` pair the SIZE leg judges (#19036),
 * read through the sibling's own `pullSizeFrom` so what counts as a pair is
 * decided in ONE place — or `null` when the object carries no such pair, which
 * the size leg turns into a refusal of its own (exit 9) and the governed leg,
 * which never reads it, ignores.
 *
 * ⭐ ONE REQUEST for all four, deliberately: the card thread the tier leg
 * gained, and now the size, cost no call the head read was not already making,
 * because GitHub answers the whole pull object here. Same channel as the review
 * read: the standard GITHUB_TOKEN REST API under the workflow's existing
 * `pull-requests: read` scope, nothing wider.
 *
 * Throws on any non-2xx and on a body with no parseable `head.sha` — a head
 * this guard cannot read pins NOTHING and can find no record, and the caller
 * turns the throw into a REFUSAL (exit 4), never a pass. ⚠️ A MISSING size
 * pair is NOT a throw here: the governed leg's head reading must not fail on
 * a field it does not read, so the pair is `null` and the leg that DOES read
 * it refuses on that null.
 */
export function makePullReader({ apiUrl, slug, token, fetchImpl = fetch }) {
  return async function fetchPull(pull) {
    const res = await fetchImpl(`${apiUrl}/repos/${slug}/pulls/${pull}`, { headers: apiHeaders(token) });
    if (!res.ok) throw new Error(`GET /repos/${slug}/pulls/${pull} answered HTTP ${res.status}`);
    const row = await res.json();
    const sha = String(row?.head?.sha ?? '');
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      throw new Error(`GET /repos/${slug}/pulls/${pull} answered no parseable head.sha — cannot pin approvals`);
    }
    const pair = pullSizeFrom(row);
    return {
      sha,
      body: String(row?.body ?? ''),
      // The label NAMES (#33501): the low-risk skills arm reads `security` off them. Not a list ⇒ null ⇒ Tier H.
      labels: Array.isArray(row?.labels) ? row.labels.map((l) => String(l?.name ?? '')) : null,
      // The FORK predicate off the same object (#33501, S3): a fork head keeps a skills PR Tier H.
      fork: forkVerdict(row),
      headRef: String(row?.head?.ref ?? ''),
      size: pair === null ? null : { ...pair, source: `GET /repos/${slug}/pulls/${pull}` },
    };
  };
}

/**
 * The pull request THREAD, paginated — the comments a review of record lives in
 * (#18020).
 *
 * ⭐ THE SCOPE QUESTION, measured rather than assumed, because the sibling
 * reader above records the opposite answer for a different route and a reader
 * would otherwise carry it here: `GET /repos/{o}/{r}/issues/{n}/comments`
 * answers `X-Accepted-GitHub-Permissions: issues=read; pull_requests=read`, and
 * GitHub documents the SEMICOLON as separating ALTERNATIVE permission sets
 * (「multiple comma-separated lists will be separated by a semicolon」 — a comma
 * joins permissions that are all required). So the workflow's existing
 * `pull-requests: read` is sufficient on its own and this leg widens NO scope.
 * Measured 2026-09-13 against the live API on this repository.
 *
 * Same channel and same discipline as the three readers above: throws on any
 * non-2xx and on a non-array body, and the caller turns the throw into a
 * REFUSAL, never a pass. ⛔ A reader that returned `[]` on an error would render
 * an unreadable thread as a thread with no record in it — the fail-open shape
 * this whole file exists to end.
 */
export function makeCommentReader({ apiUrl, slug, token, fetchImpl = fetch, perPage = 100, maxPages = 10 }) {
  return async function fetchComments(pull) {
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const url = `${apiUrl}/repos/${slug}/issues/${pull}/comments?per_page=${perPage}&page=${page}`;
      const res = await fetchImpl(url, { headers: apiHeaders(token) });
      if (!res.ok) throw new Error(`GET /repos/${slug}/issues/${pull}/comments answered HTTP ${res.status}`);
      const batch = await res.json();
      if (!Array.isArray(batch)) throw new Error(`the comments endpoint answered a non-array body for #${pull}`);
      all.push(...batch);
      if (batch.length < perPage) return all;
    }
    throw new Error(`#${pull} has more than ${perPage * maxPages} comments — refusing to judge a truncated thread`);
  };
}

/**
 * The pull request's TIMELINE, paginated — where the enqueue leg reads who put
 * the entry in the queue (2026-10-26).
 *
 * Scope, measured the way the comment reader's was: `GET
 * /repos/{o}/{r}/issues/{n}/timeline` answers `X-Accepted-GitHub-Permissions:
 * issues=read; pull_requests=read` — alternative sets — so the workflow's
 * existing `pull-requests: read` covers it and this leg widens NO scope.
 * Measured 2026-10-26 against the live API on this repository.
 *
 * ⚠️ Truncation is fatal here in a way it is not for a review list: the
 * timeline is oldest-first, so the event this leg reads is on the LAST page. A
 * list cut at `maxPages` would answer an older enqueue as the newest, so it
 * throws instead — the caller turns that into UNDETERMINED, never a pass.
 *
 * ⚠️ A SHORT page ends the walk only when the answer names no next page. The arm reads a REMOVED
 * label off a card's timeline with this reader, and a walk that stopped at a short page that was not
 * the last would read "never removed". Whether this route ever answers such a page is NOT MEASURED;
 * the `Link` header's `rel="next"` settles it either way, and an answer with no such header reads as
 * it always did.
 */
export function makeTimelineReader({ apiUrl, slug, token, fetchImpl = fetch, perPage = 100, maxPages = 10 }) {
  return async function fetchTimeline(pull) {
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const url = `${apiUrl}/repos/${slug}/issues/${pull}/timeline?per_page=${perPage}&page=${page}`;
      const res = await fetchImpl(url, { headers: apiHeaders(token) });
      if (!res.ok) throw new Error(`GET /repos/${slug}/issues/${pull}/timeline answered HTTP ${res.status}`);
      const batch = await res.json();
      if (!Array.isArray(batch)) throw new Error(`the timeline endpoint answered a non-array body for #${pull}`);
      all.push(...batch);
      const namesNextPage = /<[^>]*>[ \t]*;[ \t]*rel="?next"?/i.test(String(res.headers?.get?.('link') ?? ''));
      if (batch.length < perPage && !namesNextPage) return all;
    }
    throw new Error(`#${pull} has more than ${perPage * maxPages} timeline events — the newest is on a page this read never reached`);
  };
}

/**
 * The label NAMES on an issue — a CARD a low-risk arm pull request names, whose `security` label
 * keeps that pull request at Tier H (`readCardLabels`).
 *
 * Scope, measured the way the two readers above were: `GET /repos/{o}/{r}/issues/{n}/labels` answers
 * `X-Accepted-GitHub-Permissions: issues=read; pull_requests=read` — alternative sets — so the workflow's
 * existing `pull-requests: read` covers it and this leg widens NO scope. ⛔ Not `GET /issues/{n}`, whose
 * labels field is the same list: that route answers `issues=read` ALONE, which the workflow does not hold.
 * Measured 2026-11-15 against the live API on this repository, on an issue and on a pull request number.
 *
 * Throws on any non-2xx, a non-array body and a truncated list; the caller turns a throw into NOT MEASURED,
 * which the arm reads as Tier H — never into an empty list, which would read as a card with no label.
 */
export function makeLabelReader({ apiUrl, slug, token, fetchImpl = fetch, perPage = 100, maxPages = 10 }) {
  return async function fetchLabels(issue) {
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const url = `${apiUrl}/repos/${slug}/issues/${issue}/labels?per_page=${perPage}&page=${page}`;
      const res = await fetchImpl(url, { headers: apiHeaders(token) });
      if (!res.ok) throw new Error(`GET /repos/${slug}/issues/${issue}/labels answered HTTP ${res.status}`);
      const batch = await res.json();
      if (!Array.isArray(batch)) throw new Error(`the labels endpoint answered a non-array body for #${issue}`);
      all.push(...batch.map((l) => String(l?.name ?? '')));
      if (batch.length < perPage) return all;
    }
    throw new Error(`#${issue} has more than ${perPage * maxPages} labels — refusing to judge a truncated list`);
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * The event, the repository and the diff's first-parent rows, read ONE way for
 * both questions the CLI answers — the live judgment and `--toolchain-needed` —
 * so the two can never disagree about which paths a diff touches. Synchronous:
 * every read here is the event file or the local git object store, and none of
 * them needs a file's CONTENT (commits and trees only), which is what lets the
 * `pull_request` leg run on a blobless, sparse checkout. Returns
 * `{ ok: true, context, where, mergeBase, rows }`, or `{ ok: false, message }`
 * carrying the full ⛔ text the caller prints.
 */
function readEventDiff(env) {
  const eventName = env.GITHUB_EVENT_NAME;
  let payload;
  try {
    payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? '', 'utf8'));
  } catch (error) {
    return {
      ok: false,
      message:
        `⛔ ${CHECK_CONTEXT_NAME}: could not read GITHUB_EVENT_PATH (${String(error?.message ?? error).split('\n')[0]}).\n` +
        '   This guard reads the workflow event payload and nothing else; without it there is no diff to judge,\n' +
        '   and "could not look" must never exit 0 here.',
    };
  }

  const context = resolveEventContext({ eventName, payload });
  if (!context.ok) return { ok: false, message: `⛔ ${CHECK_CONTEXT_NAME}: ${context.reason}.` };

  for (const rev of [context.baseSha, context.headSha]) {
    if (!hasRev(repoRoot, rev)) {
      return {
        ok: false,
        message:
          `⛔ ${CHECK_CONTEXT_NAME}: ${rev} is not in this checkout, so the diff cannot be read.\n` +
          '   The job must check out with `fetch-depth: 0`; a truncated history answers a governed-surface\n' +
          '   question with silence, and silence reads as compliance (#9902).',
      };
    }
  }

  // The repository this guard judges (ruling B2): resolved BEFORE the diff is
  // read, because the lift step below already asks the register a scoped
  // question. A repository the register does not know is a refusal here.
  const where = guardRepository(env);
  if (where.error) return { ok: false, message: `⛔ ${CHECK_CONTEXT_NAME}: ${where.error}` };

  try {
    const mergeBase = git(repoRoot, ['merge-base', context.baseSha, context.headSha]).trim();
    const rows = enumerateRows(repoRoot, mergeBase, context.headSha, context.namedPull, { event: context.event });
    return { ok: true, context, where, mergeBase, rows };
  } catch (error) {
    return { ok: false, message: `⛔ ${CHECK_CONTEXT_NAME}: could not read the diff (${String(error?.message ?? error).split('\n')[0]}).` };
  }
}

/**
 * `--toolchain-needed`: the `pull_request` leg's install gate, as a pure
 * decision over what `readEventDiff` read. It decides an INSTALL, never a
 * verdict, so the CLI always exits 0 on it. `false` only when the diff was READ
 * on the `pull_request` leg and touches no register path the lift recomputes
 * (`toolchainNeededFor`); every other answer is `true` — the queue leg always
 * installs (the workflow does not even ask there), and a diff that could not be
 * read keeps the install. The two errors are not symmetric: a wrong `true`
 * costs the install time this gate exists to save, a wrong `false` would print
 * a forecast of a refusal the queue will not make.
 */
export const TOOLCHAIN_NEEDED_FLAG = '--toolchain-needed';

export function toolchainNeededAnswer({ eventName, read }) {
  if (eventName !== EVENT_PULL_REQUEST) {
    return { needed: true, why: `the ${eventName ?? '(none)'} leg always installs; only the ${EVENT_PULL_REQUEST} leg asks` };
  }
  if (!read?.ok) {
    return { needed: true, why: `the diff could not be read, so the install is kept — ${String(read?.message ?? '(no reading)').split('\n')[0]}` };
  }
  if (toolchainNeededFor(read.rows)) {
    const hits = [...new Set(read.rows.flatMap((r) => r.paths).filter((p) => generatedExceptionFor(p) !== null))];
    return { needed: true, why: `the diff touches ${hits.length} register path(s) the lift recomputes: ${hits.join(', ')}` };
  }
  return { needed: false, why: `${commitsInRange(read.rows)} commit(s) in range touch no register path the lift recomputes` };
}

async function main() {
  const env = process.env;
  if (process.argv.includes(TOOLCHAIN_NEEDED_FLAG)) {
    const { needed, why } = toolchainNeededAnswer({ eventName: env.GITHUB_EVENT_NAME, read: readEventDiff(env) });
    // stdout carries ONLY the output line the workflow appends to $GITHUB_OUTPUT.
    console.error(`${CHECK_CONTEXT_NAME} — generator toolchain ${needed ? 'NEEDED' : 'not needed'}: ${why}`);
    console.log(`needed=${needed}`);
    return EXIT_CLEAR;
  }

  const read = readEventDiff(env);
  if (!read.ok) {
    console.error(read.message);
    return EXIT_CANNOT_RUN;
  }
  const { context, where, mergeBase } = read;
  const repo = where.repo;

  const notes = [];
  let rows = read.rows;
  let lifted = [];
  try {
    const beforeLift = rows;
    rows = await liftGeneratedExceptions(repoRoot, mergeBase, rows, notes, recomputeProvenanceFor, repo);
    lifted = liftedPathsBetween(beforeLift, rows);
    rows = attachWorkflowReadings(rows, { event: context.event, mergeBase, runGit: (args) => git(repoRoot, args) });
  } catch (error) {
    console.error(`⛔ ${CHECK_CONTEXT_NAME}: could not read the diff (${String(error?.message ?? error).split('\n')[0]}).`);
    return EXIT_CANNOT_RUN;
  }

  const reader = {
    apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
    slug: where.slug,
    token: env.GITHUB_TOKEN || env.GH_TOKEN || null,
  };
  const fetchReviews = makeReviewReader(reader);
  // ONE network read per pull request for the three legs that each read it; a failed read is not kept, so a
  // leg that asks again reads again.
  const fetchPull = oncePerPull(makePullReader(reader));
  const fetchComments = makeCommentReader(reader);
  const fetchTimeline = makeTimelineReader(reader);
  const fetchLabels = makeLabelReader(reader);

  const runGit = (args, input) => git(repoRoot, args, input);
  const verdict = await runGuard({ event: context.event, repo, rows, fetchReviews, fetchPull, fetchComments, fetchTimeline, fetchLabels, lifted, runGit, baseRef: context.baseSha ?? null });
  // The SIZE leg (#19036): every queued pull request, through the same pull
  // reader the governed leg reads heads with. `merge_group` only, '' on the
  // other leg, so the `pull_request` output is byte-identical to what it was.
  // The lift (2026-09-27): the approval verdicts the governed leg already
  // derived on this build are REUSED for the pull requests it read; any other
  // oversized pull request gets one review read through the same reader.
  const size = await runSizeGuard({
    event: context.event,
    repo,
    rows,
    namedPull: context.namedPull,
    fetchPull,
    fetchReviews,
    fetchTimeline,
    // The enqueue reading rides WITH the approval verdict it was read beside,
    // so the size lift reads both off one object and never re-reads either.
    approvals: new Map(verdict.entries.map((e) => [e.pr, e.enqueue === undefined ? e.approval : { ...e.approval, enqueue: e.enqueue }])),
  });
  const sizeBlock = renderSizeVerdict(size);
  // The NARROWED leg (2026-11-19): every queued pull request's body and changesets, and for one that declares a
  // narrowing the same approval, enqueue and record readers. `merge_group` only, '' on the other leg.
  const narrowed = await runNarrowedGuard({
    event: context.event,
    repo,
    rows,
    namedPull: context.namedPull,
    fetchPull,
    fetchReviews,
    fetchTimeline,
    fetchComments,
    approvals: new Map(verdict.entries.map((e) => [e.pr, e.enqueue === undefined ? e.approval : { ...e.approval, enqueue: e.enqueue }])),
    runGit,
    baseRef: context.baseSha ?? null,
  });
  const narrowedBlock = renderNarrowedVerdict(narrowed);
  const report = [
    `${context.label} — ${commitsInRange(read.rows)} commit(s) in range`,
    ...notes,
    renderGuardVerdict(verdict),
    ...(sizeBlock === '' ? [] : ['', sizeBlock]),
    ...(narrowedBlock === '' ? [] : ['', narrowedBlock]),
  ].join('\n');
  console.log(report);

  // The step summary is where a reader actually looks at a red queue build.
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `## ${CHECK_CONTEXT_NAME}\n\n\`\`\`text\n${report}\n\`\`\`\n`);
    } catch {
      /* a summary that cannot be written changes no verdict */
    }
  }
  // BOTH legs are always evaluated and BOTH blocks are always printed, so no
  // reading is lost whichever refuses. The precedence is `groupExitCode`'s and
  // is pinned there: governed, then size — the governed refusal's remedy is the
  // stricter one (no landing at all without an authorized approval, a record,
  // or the maintainer's own direct merge, Prime Directive #14), the size
  // refusal's is the same human terminal. ⛔ No leg's code is swallowed
  // silently — every block states its refusal in full either way.
  return groupExitCode({ governed: verdict, size, narrowed });
}

// ⛔ NOT `process.exitCode = await main()`, and this is not a style choice.
// A top-level await here leaves THIS module evaluating for as long as the run
// takes, and `check-half-states.mjs` resolves its own governed register at
// module scope by importing this file — so the lazy recogniser import the
// references tier takes (see `loadRecordRecognisers`) would close that cycle
// and deadlock the merge-queue build (node exits 13, "Detected unsettled
// top-level await"; measured both ways on 2026-09-13). Settling the dispatch in
// a continuation lets this module finish evaluating first, which is the whole
// precondition. ⛔ Do not "tidy" either dispatch back into a top-level await;
// the battery reads this file's own source and reds if one returns.
if (isEntrypoint(import.meta.url) && !process.argv.includes('--self-test')) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(
        `⛔ ${CHECK_CONTEXT_NAME}: the run threw (${String(error?.message ?? error).split('\n')[0]}).\n` +
          '   "Could not look" must never exit 0 here.',
      );
      process.exitCode = EXIT_CANNOT_RUN;
    },
  );
}

// ── self-test (offline: pure functions + replay fixtures; no network, no git) ─

/**
 * Replay fixtures — the three measured incidents this guard is built from,
 * with their real file lists. Predicted direction, and the whole point of
 * pinning them: every one of them is REFUSED on `merge_group` with no
 * approving review, and every one of them is a green EARLY WARNING on
 * `pull_request`. A fixture that passed the queue leg would mean this guard
 * would not have stopped the thing it was built to stop.
 */
const REPLAYS = [
  {
    name: '#9550 — AGENTS.md flipped ready and enqueued 19 min after the register grew (stopped only by a merge conflict)',
    pr: 9527,
    subject: 'docs: seat protocol (#9527)',
    files: ['AGENTS.md'],
  },
  {
    name: '#9319 (from PR #9238) — a .claude/skills PR whose own body said "awaiting a human merge", queue-landed with ZERO reviews',
    pr: 9238,
    subject: 'docs(pm-skill): seat protocol updates (#9238)',
    files: ['.claude/skills/pm-dispatch/SKILL.md', '.claude/skills/pm-dispatch/references/platform-readings.md'],
  },
  {
    name: '#10580 — a .claude/** PR flipped ready + queued, caught only by a concurrent push hitting GH006',
    pr: 10483,
    subject: 'chore(agents): tighten the dispatch prompt (#10483)',
    files: ['.claude/agents/os-dev.md', 'packages/spec/src/index.ts'],
  },
];

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export async function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  let checked = 0;
  const failures = [];
  const assert = (name, cond, detail) => {
    registerCase();
    checked += 1;
    if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  };
  const row = (pr, files, sha = 'a'.repeat(40), subject = `x (#${pr})`) => ({ sha, subject, pr, paths: files });
  // The repository every register question below is asked for, unless a case
  // is ABOUT the scope and names another one: this guard's own (ruling B2).
  const REPO = SELF_REPO_ID;
  const approved = (...logins) => logins.map((login) => ({ state: 'APPROVED', user: { login } }));
  // The queue-predicate fixtures: a head sha, an older sha, and a review
  // carrying the `commit_id` GitHub stamps at submission time. `commit_id` no
  // longer decides anything (2026-09-04); it stays in the fixtures precisely so
  // that BOTH directions keep being measured rather than assumed away.
  const HEAD = 'f'.repeat(40);
  const OLD = '0'.repeat(40);
  const approvedAt = (login, sha) => ({ state: 'APPROVED', user: { login }, commit_id: sha });
  // The shape `fetchPull` answers with: the head the log names, the two fields
  // the references tier locates a card from (#18701), and the size pair the
  // SIZE leg judges (#19036) — `null` unless a fixture hands one in, exactly
  // as the reader answers a pull object without the pair. Spelled once, so a
  // fixture can never disagree with `makePullReader` about what a pull row is.
  const SAME_REPO = Object.freeze({ measured: true, isFork: false, headRepo: 'o/r', baseRepo: 'o/r' });
  const pull = (sha = HEAD, { body = '', headRef = '', size = null, labels = [], fork = SAME_REPO } = {}) => ({ sha, body, headRef, size, labels, fork });
  const authorizedPass = (login = GOVERNED_APPROVERS[0]) => authorizedApprovalVerdict([approvedAt(login, HEAD)], HEAD);
  // The same authorized approval, on a commit that is no longer the head. Under
  // the retired sha pin this exact fixture was the REFUSAL case.
  const authorizedPassOnOlder = (login = GOVERNED_APPROVERS[0]) => authorizedApprovalVerdict([approvedAt(login, OLD)], HEAD);
  // The `.claude/**` declaration split (2026-11-19) as the queue leg leaves it once the body declares `none` and the
  // record on the head verifies it. The pure-verdict cases below are about the legs AFTER the tier, so `run` hands
  // every split entry that reading on the queue leg — the early-warning leg reads no body, exactly as the live one.
  const VERIFIED_STAGE = Object.freeze({ measured: true, reason: null, located: 'found', where: 'PR', id: 1, carried: null, securityTouching: null, ruleChangeVerified: Object.freeze({ state: 'read', value: 'none' }), ruleChangeCarried: null });
  const VERIFIED = Object.freeze({ measured: true, reason: null, body: 'Rule-change: none', record: VERIFIED_STAGE });
  const declared = (entry) => readLowRiskTier(entry, REPO, pull(HEAD, { body: 'Rule-change: none' }), { record: VERIFIED_STAGE });
  const run = (event, rows, approvals = new Map(), records = new Map()) => {
    const { governed, unattributed } = decomposeGovernedWork(rows, REPO);
    if (event === EVENT_MERGE_GROUP) for (const entry of governed) if (!entry.surfaces.some((s) => s.lowRiskVerdict)) declared(entry);
    return guardVerdict({ repo: REPO, event, governed, unattributed, approvals, records, apiCalls: governed.length });
  };
  // The record reading a Tier S entry gets when the thread was READ and held
  // nothing — the incident shape (#19133): "no record" is a refusal of its own
  // kind, distinct from "the thread could not be read".
  const absentRecord = (pr) => new Map([[pr, { state: 'absent', read: { pr: 0, card: 0 }, readSummary: '0 on the PR and 0 on its card', cardNote: 'replay fixture, no card thread searched' }]]);

  // ── the register is READ, never restated (#9840) ──────────────────────────
  //
  // The one assertion that would catch this file growing its own copy of the
  // surface list: every surface the register declares must be answerable
  // through it here, including one added tomorrow.
  battery('the register is READ, never restated (#9840)');
  for (const surface of GOVERNED_SURFACES) {
    const sample = surface.prefix ? `${surface.prefix}sample.md` : surface.exact;
    const { governed } = decomposeGovernedWork([row(1, [sample])], REPO);
    assert(`the-register-drives-the-verdict-for-${surface.id}`, governed.length === 1 && governed[0].paths.includes(sample), sample);
  }
  assert('this-file-restates-no-surface-list', GOVERNED_SURFACES.length >= 5 && governedPathsIn(['docs/adrs/z.md', 'examples/AGENTS.md'], REPO).length === 0);

  // ── the per-row repository scope (ruling B2, 2026-10-13) ──────────────────
  //
  // The guard asks the register for ONE repository — its own — and the first
  // scoped row makes that visible: a workflow path is governed Tier H in this
  // queue and in objectui's and cloud's, not in objectos's or hotcrm's; and
  // every front door of this file REFUSES a call that names no repository,
  // because a wrong scope reads exactly like a clear diff.
  battery('the per-row repository scope (ruling B2, 2026-10-13)');
  const WF = '.github/workflows/lint.yml';
  const wfWork = decomposeGovernedWork([row(23043, [WF])], REPO);
  assert('a-workflow-path-in-this-queue-with-NO-reading-decomposes-to-ONE-governed-entry-Tier-H', wfWork.governed.length === 1 && wfWork.governed[0].tier === TIER_H && wfWork.governed[0].surfaces.map((s) => s.id).join() === 'workflows' && wfWork.governed[0].paths.join() === WF, JSON.stringify(wfWork));
  assert('the-same-path-is-governed-in-objectui-and-cloud', ['objectui', 'cloud'].every((r) => decomposeGovernedWork([row(1, [WF])], r).governed.length === 1 && governedTierFor([WF], r) === TIER_H));
  assert('and-NOT-in-objectos-or-mobile-the-scope-is-the-rows-not-the-guards', ['objectos', 'mobile'].every((r) => decomposeGovernedWork([row(1, [WF])], r).governed.length === 0 && governedPathsIn([WF], r).length === 0));
  assert('hotcrm-is-governed-by-the-row-since-2026-11-19-the-audit-mirror-Tier-H', decomposeGovernedWork([row(1, [WF])], 'hotcrm').governed.length === 1 && governedTierFor([WF], 'hotcrm') === TIER_H);
  assert('a-github-tree-sibling-outside-workflows-is-clear', decomposeGovernedWork([row(2, ['.github/ISSUE_TEMPLATE/bug.md', '.github/CODEOWNERS', '.github/workflowsx/y.yml'])], REPO).governed.length === 0);
  const wfRefused = run('merge_group', [row(23043, [WF])], new Map([[23043, authorizedApprovalVerdict([], HEAD)]]));
  assert('an-unapproved-workflow-PR-is-REFUSED-at-the-queue-on-the-Tier-H-terminal', wfRefused.exitCode === EXIT_REFUSED_UNAPPROVED && renderGuardVerdict(wfRefused).includes(WF) && /landing tier: H/.test(renderGuardVerdict(wfRefused)), renderGuardVerdict(wfRefused));
  assert('and-an-authorized-approval-on-the-head-clears-it', run('merge_group', [row(23043, [WF])], new Map([[23043, authorizedPass()]])).exitCode === EXIT_CLEAR);
  const wfClearText = renderGuardVerdict(run('merge_group', [row(3, ['.github/ISSUE_TEMPLATE/bug.md'])]));
  assert('the-clear-words-count-the-rows-that-govern-THIS-repository-and-name-it', /17 surfaces govern objectstack/.test(wfClearText), wfClearText);
  const threw = (fn) => { try { fn(); return null; } catch (error) { return error; } };
  assert('⛔ decomposeGovernedWork-without-a-repository-is-an-ERROR-never-a-clear', threw(() => decomposeGovernedWork([row(1, [WF])])) instanceof TypeError && /decomposeGovernedWork wants the repository/.test(threw(() => decomposeGovernedWork([row(1, [WF])])).message));
  const liftRejects = await liftGeneratedExceptions('/w', 'base', [], []).then(() => null, (error) => error);
  assert('⛔ and-so-are-the-verdict-builders-the-size-leg-and-the-lift', [() => guardVerdict({ event: 'merge_group' }), () => sizeGuardVerdict({ event: EVENT_MERGE_GROUP, pulls: [1] }), () => sizeReading(1, { additions: 1, deletions: 1 })].every((fn) => threw(fn) instanceof TypeError) && liftRejects instanceof TypeError, String(liftRejects?.message));
  const guardRejects = await runGuard({ event: 'merge_group', rows: [row(1, [WF])], fetchReviews: async () => [], fetchPull: async () => pull() }).then(() => null, (error) => error);
  const sizeRejects = await runSizeGuard({ event: EVENT_MERGE_GROUP, rows: [row(1, [WF])], fetchPull: async () => pull() }).then(() => null, (error) => error);
  assert('⛔ runGuard-and-runSizeGuard-REJECT-without-a-repository', guardRejects instanceof TypeError && sizeRejects instanceof TypeError, `${guardRejects?.message}\n${sizeRejects?.message}`);
  assert('an-unknown-repository-is-refused-too-with-the-roster-in-the-words', threw(() => decomposeGovernedWork([row(1, [WF])], 'objectstack-ai/objectstack')) instanceof TypeError && /not a GOVERNED_REPOS id/.test(threw(() => decomposeGovernedWork([row(1, [WF])], 'objectstack-ai/objectstack')).message));
  // Where main() gets the repository: GITHUB_REPOSITORY, resolved; unset means this file's own.
  assert('guardRepository: an unset GITHUB_REPOSITORY is this file\'s own repository', JSON.stringify(guardRepository({})) === JSON.stringify({ repo: 'objectstack', slug: 'objectstack-ai/objectstack', source: "this file's own repository" }) && guardRepository({ GITHUB_REPOSITORY: '  ' }).repo === 'objectstack');
  assert('guardRepository: a sibling copy of this guard judges the sibling', guardRepository({ GITHUB_REPOSITORY: 'objectstack-ai/objectui' }).repo === 'objectui' && guardRepository({ GITHUB_REPOSITORY: 'ObjectStack-AI/Cloud' }).repo === 'cloud' && guardRepository({ GITHUB_REPOSITORY: 'objectstack-ai/cloud' }).source === 'GITHUB_REPOSITORY');
  const foreignGuard = guardRepository({ GITHUB_REPOSITORY: 'someone/fork' });
  assert('⛔ guardRepository: a repository the register does not know is a REFUSAL naming the roster', typeof foreignGuard.error === 'string' && /someone\/fork, which is not a governed repository/.test(foreignGuard.error) && /objectstack, objectui, cloud, objectos, hotcrm/.test(foreignGuard.error) && foreignGuard.repo === undefined, foreignGuard.error);
  assert('the-verdict-objects-carry-the-repository-they-were-judged-for', wfRefused.repo === REPO && run('pull_request', [row(1, [WF])]).repo === REPO && sizeGuardVerdict({ event: EVENT_MERGE_GROUP, repo: 'cloud', pulls: [1], readings: new Map([[1, sizeReading(1, { additions: 1, deletions: 0 }, 'cloud')]]) }).repo === 'cloud');

  // ── the exit contract as a table ──────────────────────────────────────────
  battery('the exit contract as a table');
  assert('exit-clear-is-0', EXIT_CLEAR === 0);
  assert('exit-cannot-run-is-1', EXIT_CANNOT_RUN === 1);
  assert(
    'the-three-refusals-are-distinct-non-zero-codes',
    new Set([EXIT_REFUSED_UNAPPROVED, EXIT_REFUSED_UNREADABLE, EXIT_REFUSED_UNATTRIBUTED]).size === 3 &&
      ![EXIT_REFUSED_UNAPPROVED, EXIT_REFUSED_UNREADABLE, EXIT_REFUSED_UNATTRIBUTED].includes(0),
  );
  assert('the-unapproved-refusal-shares-the-siblings-GOVERNED-code-3', EXIT_REFUSED_UNAPPROVED === 3);

  // ── the merge-queue head ref ──────────────────────────────────────────────
  battery('the merge-queue head ref');
  assert('queue-ref-yields-its-pr', pullNumberFromQueueRef('refs/heads/gh-readonly-queue/main/pr-11387-484ae0019cd') === 11387);
  assert('queue-ref-without-the-refs-prefix-too', pullNumberFromQueueRef('gh-readonly-queue/main/pr-42-abcdef1') === 42);
  assert('a-base-branch-with-a-slash-is-still-read', pullNumberFromQueueRef('refs/heads/gh-readonly-queue/release/v5/pr-7-abcdef1') === 7);
  assert('an-ordinary-branch-that-merely-looks-like-one-is-NOT-a-queue-ref', pullNumberFromQueueRef('refs/heads/pr-12-abcdef1') === null);
  assert('a-plain-branch-is-null', pullNumberFromQueueRef('refs/heads/claude/issue-1-x') === null);
  assert('nonsense-is-null-never-a-number', pullNumberFromQueueRef(undefined) === null && pullNumberFromQueueRef('') === null);

  // ── event payloads, including the malformed ones ──────────────────────────
  battery('event payloads, including the malformed ones');
  const mg = resolveEventContext({
    eventName: 'merge_group',
    payload: { merge_group: { base_sha: 'b'.repeat(40), head_sha: 'h'.repeat(40), head_ref: 'refs/heads/gh-readonly-queue/main/pr-99-abcdef1', base_ref: 'refs/heads/main' } },
  });
  assert('a-merge_group-payload-resolves-to-its-shas-and-named-pr', mg.ok && mg.event === 'merge_group' && mg.namedPull === 99, JSON.stringify(mg));
  const pr = resolveEventContext({
    eventName: 'pull_request',
    payload: { pull_request: { number: 123, draft: true, base: { sha: 'b'.repeat(40) }, head: { sha: 'h'.repeat(40) } } },
  });
  assert('a-pull_request-payload-resolves-to-its-number-and-draft-state', pr.ok && pr.namedPull === 123 && pr.draft === true, JSON.stringify(pr));
  assert('a-merge_group-with-no-shas-CANNOT-RUN-never-reads-as-an-empty-diff', resolveEventContext({ eventName: 'merge_group', payload: { merge_group: {} } }).ok === false);
  assert('a-pull_request-with-no-head-sha-CANNOT-RUN', resolveEventContext({ eventName: 'pull_request', payload: { pull_request: { number: 1, base: { sha: 'x' } } } }).ok === false);
  const unsupported = resolveEventContext({ eventName: 'push', payload: {} });
  assert('an-unsupported-event-CANNOT-RUN-and-names-both-events-it-does-read', !unsupported.ok && /merge_group/.test(unsupported.reason) && /pull_request/.test(unsupported.reason), unsupported.reason);

  // ── the approval predicate ────────────────────────────────────────────────
  battery('the approval predicate');
  assert('an-approval-is-an-approval', approvalVerdict(approved('os-zhuang')).state === 'approved');
  assert('no-reviews-at-all-is-unapproved', approvalVerdict([]).state === 'unapproved');
  assert('a-COMMENTED-review-is-not-an-approval', approvalVerdict([{ state: 'COMMENTED', user: { login: 'a' } }]).state === 'unapproved');
  // ⭐ The fail-open direction a naive `.some(r => r.state === 'APPROVED')`
  // gets wrong, and the only direction this file may not be wrong in.
  battery('⭐ The fail-open direction a naive `.some(r => r.state === \'APPROVED\')`');
  assert(
    'an-approval-later-superseded-by-CHANGES_REQUESTED-is-NOT-an-approval',
    approvalVerdict([
      { state: 'APPROVED', user: { login: 'a' } },
      { state: 'CHANGES_REQUESTED', user: { login: 'a' } },
    ]).state === 'unapproved',
  );
  assert(
    'a-CHANGES_REQUESTED-later-superseded-by-an-approval-IS-an-approval',
    approvalVerdict([
      { state: 'CHANGES_REQUESTED', user: { login: 'a' } },
      { state: 'APPROVED', user: { login: 'a' } },
    ]).state === 'approved',
  );
  assert('a-DISMISSED-approval-is-not-an-approval', approvalVerdict([{ state: 'DISMISSED', user: { login: 'a' } }]).state === 'unapproved');
  assert(
    'one-reviewers-changes-request-does-not-erase-anothers-approval-but-IS-reported',
    (() => {
      const v = approvalVerdict([...approved('a'), { state: 'CHANGES_REQUESTED', user: { login: 'b' } }]);
      return v.state === 'approved' && v.changesRequestedBy.join() === 'b';
    })(),
  );
  assert('the-state-comparison-is-case-insensitive-the-API-has-shipped-both', approvalVerdict([{ state: 'approved', user: { login: 'a' } }]).state === 'approved');

  // ── the 2026-09-04 unpinned predicate (the queue leg's) ───────────────────
  //
  // 「只需要有人工批准记录就行，不需要卡最新的提交。」 — an authorized
  // latest-decisive APPROVED review satisfies this leg on ANY commit. The
  // approver set is 2026-11-17's (「hotlong 从批准账户中去掉，只保留 os-zhuang」),
  // which superseded the membership of 2026-08-27 (「os-zhuang hotlong 批准算数」),
  // and the constant IS the single source, so the membership pin iterates it and
  // the membership assertion pins it to the ruling: a silent edit to the set
  // fails here, and nothing else in the repo restates the names as data. The
  // one login spelled below is the account that ruling REMOVED, pinned as the
  // negative case: an approval or an enqueue by it alone no longer counts.
  const RETIRED_APPROVER = 'hotlong';
  battery('the 2026-09-04 unpinned predicate (the queue leg\'s)');
  assert('the-authorized-set-is-exactly-the-ruled-one-account-2026-11-17', GOVERNED_APPROVERS.join() === 'os-zhuang');
  assert('⛔ the-account-removed-2026-11-17-is-not-in-the-authorized-set', !GOVERNED_APPROVERS.includes(RETIRED_APPROVER));
  {
    const retired = authorizedApprovalVerdict([approvedAt(RETIRED_APPROVER, HEAD)], HEAD);
    assert(
      '⛔ a-head-approved-ONLY-by-the-removed-account-reads-UNAPPROVED-2026-11-17',
      retired.state === 'unapproved' && retired.approvers.length === 0 && retired.unauthorizedApprovers.join() === RETIRED_APPROVER,
      JSON.stringify(retired),
    );
  }
  for (const login of GOVERNED_APPROVERS) {
    assert(`an-authorized-approval-on-the-current-head-passes: ${login}`, authorizedApprovalVerdict([approvedAt(login, HEAD)], HEAD).state === 'approved');
  }
  // ⭐ THE RULING ITSELF: the identical approval, on a commit that is no longer
  // the head. This is the case that REFUSED before 2026-09-04.
  for (const login of GOVERNED_APPROVERS) {
    const older = authorizedApprovalVerdict([approvedAt(login, OLD)], HEAD);
    assert(
      `⭐ an-authorized-approval-on-an-OLDER-commit-still-passes-2026-09-04: ${login}`,
      older.state === 'approved' && older.approvers.join() === login,
      JSON.stringify(older),
    );
  }
  assert('an-approval-carrying-no-commit_id-at-all-passes-too', authorizedApprovalVerdict(approved(GOVERNED_APPROVERS[0]), HEAD).state === 'approved');
  const outsider = authorizedApprovalVerdict([approvedAt('not-authorized', HEAD)], HEAD);
  assert('an-unauthorized-approval-never-counts', outsider.state === 'unapproved' && outsider.unauthorizedApprovers.join() === 'not-authorized');
  assert(
    'an-authorized-approval-later-superseded-by-CHANGES_REQUESTED-never-counts',
    authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], HEAD), { state: 'CHANGES_REQUESTED', user: { login: GOVERNED_APPROVERS[0] }, commit_id: HEAD }], HEAD)
      .state === 'unapproved',
  );
  assert(
    'a-DISMISSED-authorized-approval-never-counts',
    authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], HEAD), { state: 'DISMISSED', user: { login: GOVERNED_APPROVERS[0] }, commit_id: HEAD }], HEAD)
      .state === 'unapproved',
  );
  assert('no-reviews-at-all-is-unapproved-under-this-predicate-too', authorizedApprovalVerdict([], HEAD).state === 'unapproved');
  assert(
    'an-unauthorized-approval-does-not-mask-an-authorized-one-on-an-older-commit',
    authorizedApprovalVerdict([approvedAt('not-authorized', HEAD), approvedAt(GOVERNED_APPROVERS[0], OLD)], HEAD).approvers.join() === GOVERNED_APPROVERS[0],
  );
  assert(
    'a-COMMENTED-review-by-an-authorized-account-is-not-an-approval',
    authorizedApprovalVerdict([{ state: 'COMMENTED', user: { login: GOVERNED_APPROVERS[0] }, commit_id: HEAD }], HEAD).state === 'unapproved',
  );
  assert(
    'the-state-comparison-is-case-insensitive-the-API-has-shipped-both',
    authorizedApprovalVerdict([{ state: 'approved', user: { login: GOVERNED_APPROVERS[0] }, commit_id: OLD }], HEAD).state === 'approved',
  );
  // The head is a printed READING now, never a gate: an approval on an earlier
  // commit is reported AND counted at the same time, and a head that could not
  // be read reports nothing instead of failing closed.
  const olderReading = authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], OLD)], HEAD);
  assert(
    'an-older-commit-is-REPORTED-as-a-reading-and-COUNTED-at-the-same-time',
    olderReading.approvalsOnEarlierCommits[0]?.login === GOVERNED_APPROVERS[0] &&
      olderReading.approvalsOnEarlierCommits[0]?.commitId === OLD &&
      olderReading.approvers.join() === GOVERNED_APPROVERS[0],
    JSON.stringify(olderReading),
  );
  assert(
    'an-unreadable-head-no-longer-fails-closed-it-simply-reports-no-reading',
    authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], HEAD)], undefined).state === 'approved' &&
      authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], HEAD)], undefined).approvalsOnEarlierCommits.length === 0 &&
      authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], '')], '').state === 'approved',
  );

  // ── decomposition, and the multi-PR group trap ────────────────────────────
  battery('decomposition, and the multi-PR group trap');
  const clearRows = [row(1, ['packages/spec/src/index.ts', 'content/docs/x.mdx'])];
  assert('a-clear-diff-decomposes-to-nothing', decomposeGovernedWork(clearRows, REPO).governed.length === 0 && decomposeGovernedWork(clearRows, REPO).unattributed.length === 0);
  const mixed = decomposeGovernedWork([row(5, ['AGENTS.md', 'packages/spec/src/index.ts'])], REPO);
  assert('a-mixed-diff-governs-the-whole-pr-and-lists-only-the-governed-paths', mixed.governed[0].paths.join() === 'AGENTS.md', JSON.stringify(mixed.governed[0].paths));
  const batched = decomposeGovernedWork([row(11, ['docs/adr/0120-x.md'], 'a'.repeat(40)), row(12, ['packages/core/src/x.ts'], 'b'.repeat(40))], REPO);
  assert('a-batched-group-attributes-the-governed-diff-to-ITS-OWN-pr-not-the-last-one', batched.governed.length === 1 && batched.governed[0].pr === 11, JSON.stringify(batched.governed.map((g) => g.pr)));
  const twoGoverned = decomposeGovernedWork([row(11, ['AGENTS.md']), row(12, ['skills/x/SKILL.md'], 'b'.repeat(40))], REPO);
  assert('two-governed-prs-in-one-group-are-both-carried', twoGoverned.governed.map((g) => g.pr).join() === '11,12');
  const unattributed = decomposeGovernedWork([{ sha: 'c'.repeat(40), subject: 'chore: direct work', pr: null, paths: ['CLAUDE.md'] }], REPO);
  assert('a-governed-commit-naming-no-pr-is-UNATTRIBUTED-never-dropped', unattributed.unattributed.length === 1 && unattributed.governed.length === 0);
  assert('an-UNGOVERNED-commit-naming-no-pr-is-simply-not-our-business', decomposeGovernedWork([{ sha: 'd'.repeat(40), subject: 'x', pr: null, paths: ['README.md'] }], REPO).unattributed.length === 0);
  // The enumeration itself, through its git seam. Two branch shapes: one
  // commit whose subject names an ISSUE (the PR #25965 shape), and a branch
  // that merged `origin/main` between its own two commits (the PR #26311
  // shape). The fake answers only the three reads `enumerateRows` makes, and
  // records them, so the pull_request leg is measured to read the NET diff.
  const EB = 'b'.repeat(40);
  const enumGit = (log, perCommit, net) => {
    const reads = [];
    const fake = (args) => {
      reads.push(args.join(' '));
      if (args[0] === 'log') return log.map(([sha, subject]) => `${sha}\t${subject}`).join('\n') + '\n';
      if (args[0] === 'diff-tree' && args.includes('--first-parent')) return (perCommit[args[args.length - 1]] ?? []).map((p) => `${p}\0`).join('');
      if (args[0] === 'diff-tree') return net.map((p) => `${p}\0`).join('');
      throw new Error(`unexpected git read: ${args.join(' ')}`);
    };
    return { fake, reads };
  };
  const ISSUE_HEAD = '1'.repeat(40);
  const issueBranch = () => enumGit([[ISSUE_HEAD, 'fix(pm): the main-line script reads the lock slot (#25770)']], { [ISSUE_HEAD]: ['AGENTS.md'] }, ['AGENTS.md']);
  const MERGED_HEAD = '2'.repeat(40);
  const MERGE_SHA = '3'.repeat(40);
  const FIRST = '4'.repeat(40);
  const mergedBranch = () =>
    enumGit(
      [[MERGED_HEAD, 'ci(governed-surface-guard): the workflow commit'], [MERGE_SHA, "Merge branch 'main' into claude/issue-26201-x"], [FIRST, 'ci(governed-surface-guard): pin the self-test step']],
      { [MERGED_HEAD]: ['.github/workflows/governed-surface-guard.yml'], [MERGE_SHA]: ['.github/workflows/lint.yml', 'AGENTS.md', 'packages/core/src/x.ts'], [FIRST]: ['.github/workflows/governed-surface-guard.yml'] },
      ['.github/workflows/governed-surface-guard.yml'],
    );
  {
    const g = issueBranch();
    const prRows = enumerateRows('/w', EB, ISSUE_HEAD, 25965, { event: EVENT_PULL_REQUEST, runGit: g.fake });
    const prWork = decomposeGovernedWork(prRows, REPO);
    assert(
      '⭐ pull_request-leg: a-subject-naming-an-ISSUE-is-attributed-to-the-PAYLOAD-pr-never-the-issue',
      prRows.length === 1 && prRows[0].pr === 25965 && prWork.governed.map((e) => e.pr).join() === '25965' && prWork.unattributed.length === 0,
      JSON.stringify(prRows),
    );
    const qg = issueBranch();
    const queueRows = enumerateRows('/w', EB, ISSUE_HEAD, 26000, { event: EVENT_MERGE_GROUP, runGit: qg.fake });
    assert(
      '⛔ CONTROL merge_group-leg: the-same-subject-still-attributes-by-its-trailing-number-unchanged',
      queueRows.length === 1 && queueRows[0].pr === 25770 && queueRows[0].sha === ISSUE_HEAD,
      JSON.stringify(queueRows),
    );
  }
  {
    const g = mergedBranch();
    const prRows = enumerateRows('/w', EB, MERGED_HEAD, 26311, { event: EVENT_PULL_REQUEST, runGit: g.fake });
    const prWork = decomposeGovernedWork(prRows, REPO);
    assert(
      '⭐ pull_request-leg: a-branch-that-merged-origin-main-carries-ONLY-its-net-rows-against-the-merge-base',
      prRows.length === 1 && prRows[0].paths.join() === '.github/workflows/governed-surface-guard.yml' &&
        prWork.governed.length === 1 && prWork.governed[0].pr === 26311 && prWork.governed[0].paths.join() === '.github/workflows/governed-surface-guard.yml' &&
        prWork.unattributed.length === 0,
      JSON.stringify(prRows),
    );
    assert(
      'and-it-reads-the-net-diff-base-to-head-never-a-per-commit-first-parent-diff',
      g.reads.some((r) => r === `diff-tree -r --no-commit-id --no-renames --name-only -z ${EB} ${MERGED_HEAD}`) && !g.reads.some((r) => r.includes('--first-parent') && r.startsWith('diff-tree')),
      g.reads.join(' | '),
    );
    assert('and-the-header-still-counts-the-ranges-three-commits', commitsInRange(prRows) === 3, String(commitsInRange(prRows)));
    const qg = mergedBranch();
    const queueRows = enumerateRows('/w', EB, MERGED_HEAD, 26311, { event: EVENT_MERGE_GROUP, runGit: qg.fake });
    assert(
      '⛔ CONTROL merge_group-leg: the-same-range-is-still-one-row-per-first-parent-commit-unattributed-without-a-subject-number',
      queueRows.length === 3 && queueRows.every((r) => r.pr === null) && queueRows[1].paths.includes('AGENTS.md') && commitsInRange(queueRows) === 3,
      JSON.stringify(queueRows.map((r) => [r.sha.slice(0, 1), r.pr, r.paths.length])),
    );
    assert('and-an-empty-pull_request-range-is-no-rows', enumerateRows('/w', EB, EB, 1, { event: EVENT_PULL_REQUEST, runGit: enumGit([], {}, []).fake }).length === 0);
    // ⛔ A governed path git would C-quote, read through REAL git (gitFreeEnv): a non-ASCII name and a name holding a
    // newline. Without `-z` the first prints as `"skills/a/\346\226\207\346\241\243.md"` and the second as
    // `"skills/a/two\nlines.md"`, quoted spellings that match no governed prefix, so the queue never saw the file.
    // `core.quotePath=true` is pinned on the command line: gitFreeEnv strips GIT_* but not a user or system gitconfig,
    // and a box set to `core.quotePath=false` spells the non-ASCII name raw, which reds the CONTROL witness below.
    const quotedDir = mkdtempSync(join(tmpdir(), 'guard-quoted-paths-'));
    try {
      const g = (args) =>
        execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'core.quotePath=true', ...args], {
          cwd: quotedDir,
          encoding: 'utf8',
          env: gitFreeEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      const CJK = 'skills/a/\u6587\u6863.md';
      const NL = 'skills/a/two\nlines.md';
      g(['init', '-q']);
      writeFileSync(join(quotedDir, 'README.md'), 'seed\n');
      g(['add', '-A']);
      g(['commit', '-q', '-m', 'seed']);
      const qBase = g(['rev-parse', 'HEAD']).trim();
      mkdirSync(join(quotedDir, 'skills/a'), { recursive: true });
      writeFileSync(join(quotedDir, CJK), 'wording\n');
      writeFileSync(join(quotedDir, NL), 'wording\n');
      g(['add', '-A']);
      g(['commit', '-q', '-m', 'docs(skills): two names git quotes (#7)']);
      const qHead = g(['rev-parse', 'HEAD']).trim();
      const want = [CJK, NL].sort().join('|');
      // The witness that the fixture exercises the quoting at all: the same read without `-z` spells neither name raw.
      const quoted = g(['diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-only', qBase, qHead]).split('\n').filter(Boolean);
      assert('⛔ CONTROL the-fixture-names-are-ones-git-C-quotes-without--z', quoted.length === 2 && quoted.every((p) => p.startsWith('"')) && governedPathsIn(quoted, REPO).length === 0, JSON.stringify(quoted));
      const qQueue = enumerateRows(quotedDir, qBase, qHead, null, { event: EVENT_MERGE_GROUP, runGit: g });
      const qEntry = decomposeGovernedWork(qQueue, REPO).governed[0];
      assert('⛔ #33620-merge_group-reads-a-non-ASCII-and-a-newline-path-raw-and-each-is-GOVERNED', qQueue.length === 1 && [...qQueue[0].paths].sort().join('|') === want && qEntry?.pr === 7 && [...qEntry.paths].sort().join('|') === want, JSON.stringify(qQueue));
      const qPull = enumerateRows(quotedDir, qBase, qHead, 7, { event: EVENT_PULL_REQUEST, runGit: g });
      assert('⛔ #33620-pull_request-reads-the-same-two-paths-raw-and-each-is-GOVERNED', qPull.length === 1 && [...qPull[0].paths].sort().join('|') === want && [...decomposeGovernedWork(qPull, REPO).governed[0].paths].sort().join('|') === want, JSON.stringify(qPull));
      const qStatus = catalogFilesOf(qEntry, g);
      assert('#33620-the-arm-status-read-spells-each-path-as-the-path-walk-does-so-every-path-has-its-row', qStatus.measured === true && qStatus.files.map((f) => f.path).sort().join('|') === want, JSON.stringify(qStatus));
    } finally {
      rmSync(quotedDir, { recursive: true, force: true });
    }
  }

  // ── the verdict table, both events ────────────────────────────────────────
  battery('the verdict table, both events');
  const clearV = run('merge_group', clearRows);
  assert('a-clear-merge-group-is-CLEAR-and-exits-0', clearV.conclusion === 'clear' && clearV.exitCode === EXIT_CLEAR);
  assert('and-it-made-zero-review-lookups', clearV.apiCalls === 0);
  const refusedV = run('merge_group', [row(9527, ['AGENTS.md'])], new Map([[9527, authorizedApprovalVerdict([], HEAD)]]));
  assert('an-unapproved-governed-merge-group-is-REFUSED-with-code-3', refusedV.conclusion === 'refused' && refusedV.exitCode === EXIT_REFUSED_UNAPPROVED);
  const clearedV = run('merge_group', [row(9527, ['AGENTS.md'])], new Map([[9527, authorizedPass()]]));
  assert('an-authorized-approval-CLEARS-the-merge-group-and-exits-0', clearedV.conclusion === 'cleared' && clearedV.exitCode === EXIT_CLEAR);
  const olderShaV = run('merge_group', [row(9527, ['AGENTS.md'])], new Map([[9527, authorizedPassOnOlder()]]));
  assert(
    '⭐ an-authorized-approval-on-an-OLDER-sha-CLEARS-the-merge-group-2026-09-04',
    olderShaV.conclusion === 'cleared' && olderShaV.exitCode === EXIT_CLEAR,
    JSON.stringify(olderShaV.conclusion),
  );
  const outsiderV = run('merge_group', [row(9527, ['AGENTS.md'])], new Map([[9527, authorizedApprovalVerdict([approvedAt('not-authorized', HEAD)], HEAD)]]));
  assert('an-unauthorized-account-approval-REFUSES-the-merge-group-with-code-3', outsiderV.conclusion === 'refused' && outsiderV.exitCode === EXIT_REFUSED_UNAPPROVED);
  const unreadableV = run('merge_group', [row(9527, ['AGENTS.md'])], new Map([[9527, unreadableApproval('HTTP 502')]]));
  assert('an-unreadable-review-list-is-a-REFUSAL-not-a-pass', unreadableV.conclusion === 'refused' && unreadableV.exitCode === EXIT_REFUSED_UNREADABLE);
  const missingV = run('merge_group', [row(9527, ['AGENTS.md'])]);
  assert('a-governed-pr-with-NO-recorded-reading-refuses-too-there-is-no-default-pass', missingV.exitCode === EXIT_REFUSED_UNREADABLE);
  const unattrV = run('merge_group', [{ sha: 'c'.repeat(40), subject: 'chore: x', pr: null, paths: ['CLAUDE.md'] }]);
  assert('an-unattributed-governed-commit-is-REFUSED-with-its-own-code', unattrV.conclusion === 'refused' && unattrV.exitCode === EXIT_REFUSED_UNATTRIBUTED);
  const partial = run(
    'merge_group',
    [row(11, ['AGENTS.md']), row(12, ['skills/x/SKILL.md'], 'b'.repeat(40))],
    new Map([[11, authorizedPass()], [12, authorizedApprovalVerdict([], HEAD)]]),
  );
  assert('one-approved-pr-does-NOT-carry-an-unapproved-sibling-through-the-same-group', partial.exitCode === EXIT_REFUSED_UNAPPROVED);

  // ── the pull_request leg is an EARLY WARNING and never reddens ────────────
  battery('the pull_request leg is an EARLY WARNING and never reddens');
  const warnedV = run('pull_request', [row(9527, ['AGENTS.md'])], new Map([[9527, approvalVerdict([])]]));
  assert('a-governed-unapproved-PULL-REQUEST-is-WARNED-not-refused', warnedV.conclusion === 'warned' && warnedV.exitCode === EXIT_CLEAR);
  assert(
    'the-pr-leg-never-reddens-under-ANY-approval-state-that-is-the-retired-gates-poison',
    ['unapproved', 'unreadable', 'approved'].every(
      (state) => run('pull_request', [row(1, ['AGENTS.md'])], new Map([[1, { state, approvers: [], changesRequestedBy: [], reviewsRead: 0 }]])).exitCode === EXIT_CLEAR,
    ),
  );
  assert('and-an-unattributed-governed-commit-does-not-redden-a-pr-run-either', run('pull_request', [{ sha: 'c'.repeat(40), subject: 'x', pr: null, paths: ['CLAUDE.md'] }]).exitCode === EXIT_CLEAR);
  // #19133: the early warning names the TIER and what it waits for, on the
  // pull_request leg — where no record is read, so the tier line alone carries it.
  const warnedS = run('pull_request', [row(9528, ['.claude/agents/os-dev.md'])], new Map([[9528, approvalVerdict([])]]));
  const warnedSText = renderGuardVerdict(warnedS);
  assert(
    'the-early-warning-reads-no-body-so-it-names-Tier-H-UNTIL-it-is-read-the-declaration-and-the-record-Tier-S-waits-for',
    warnedS.conclusion === 'warned' && warnedS.entries[0].tier === TIER_H && declarationUnread(warnedS.entries[0]) && /landing tier: H\(人合\) UNTIL the PR body is read/.test(warnedSText) && /## Contract review/.test(warnedSText) && /CONTRACT_REVIEW_TIER/.test(warnedSText) &&
      /`Rule-change: none`/.test(warnedSText) && /`Rule-change-verified:`/.test(warnedSText) && /declaration split .*NOT MEASURED/.test(warnedSText) && !/No review of record\n? *substitutes here/.test(warnedSText),
    warnedSText,
  );
  const warnedHText = renderGuardVerdict(warnedV);
  assert('and-names-Tier-H-and-the-approval-it-waits-for-with-no-Tier-S-block', /landing tier: H/.test(warnedHText) && /authorized APPROVED review/.test(warnedHText) && !/Tier S \(/.test(warnedHText), warnedHText);
  // The PR #25965 shape end to end on this leg: the warning names the PAYLOAD's
  // pull request, whose reviews it reads, and never the issue the subject names.
  {
    const ISSUE_ONLY = '5'.repeat(40);
    const fake = (args) => {
      if (args[0] === 'log') return `${ISSUE_ONLY}\tfix(pm): the main-line script reads the lock slot (#25770)\n`;
      if (args[0] === 'diff-tree') return 'AGENTS.md\0';
      throw new Error(args.join(' '));
    };
    const issueRows = enumerateRows('/w', 'b'.repeat(40), ISSUE_ONLY, 25965, { event: EVENT_PULL_REQUEST, runGit: fake });
    const issueText = renderGuardVerdict(run('pull_request', issueRows, new Map([[25965, approvalVerdict([])]])));
    assert('⭐ the-early-warning-names-the-payloads-pull-request-and-never-the-issue-its-subject-names', /#25965 — governed/.test(issueText) && !/#25770/.test(issueText), issueText);
  }

  // ── the replay fixtures: the three incidents this guard descends from ─────
  battery('the replay fixtures: the three incidents this guard descends from');
  for (const replay of REPLAYS) {
    const rows = [row(replay.pr, replay.files, 'e'.repeat(40), replay.subject)];
    // #19133: two of the three incidents are `.claude/**` and therefore Tier S
    // today, so the queue judges them on the record leg too. Each incident's
    // thread carried no record — the reading is ABSENT, and the refusal is the
    // same "unapproved" the incident deserved. A Tier S entry with NO reading
    // at all refuses as UNREADABLE instead: "could not find out" never clears.
    const tier = governedTierFor(replay.files, REPO, GOVERNED_SURFACES, null, VERIFIED);
    const queued = run('merge_group', rows, new Map([[replay.pr, authorizedApprovalVerdict([], HEAD)]]), tier === TIER_S ? absentRecord(replay.pr) : new Map());
    assert(`replay-REFUSES-at-the-queue: ${replay.name}`, queued.exitCode === EXIT_REFUSED_UNAPPROVED, JSON.stringify([queued.conclusion, tier]));
    if (tier === TIER_S) {
      const unread = run('merge_group', rows, new Map([[replay.pr, authorizedApprovalVerdict([], HEAD)]]));
      assert(`replay-is-Tier-S-and-with-NO-record-reading-refuses-UNREADABLE-never-clears: ${replay.name}`, unread.exitCode === EXIT_REFUSED_UNREADABLE, JSON.stringify(unread.conclusion));
    }
    const early = run('pull_request', rows, new Map([[replay.pr, approvalVerdict([])]]));
    assert(`replay-only-WARNS-on-the-pr: ${replay.name}`, early.conclusion === 'warned' && early.exitCode === EXIT_CLEAR);
    const text = renderGuardVerdict(queued);
    assert(`replay-names-its-governed-paths: ${replay.name}`, replay.files.filter((f) => governedPathsIn([f], REPO).length > 0).every((f) => text.includes(f)), text);
  }

  // ── ⭐ the ordering guarantee, measured with a spy that THROWS ────────────
  //
  // "The path test runs first and a clear diff makes no API call" is a claim
  // about control flow, so it is tested by making the API impossible to touch.
  // A mock returning [] would have passed against a version that called it.
  battery('⭐ the ordering guarantee, measured with a spy that THROWS');
  let apiTouched = 0;
  const explode = () => {
    apiTouched += 1;
    throw new Error('the API must not be reached for a diff that touches nothing governed');
  };
  // The spy THROWS, so a regression here would reject rather than return.
  // Catching it keeps the failure a named assertion instead of an unhandled
  // rejection that aborts the remaining cases — the collector reasoning from
  // lint.yml's shallow-history step, one level down.
  let orderedClear = null;
  let orderedThrow = null;
  try {
    orderedClear = await runGuard({ repo: REPO, event: 'merge_group', rows: clearRows, fetchReviews: explode, fetchPull: explode });
  } catch (error) {
    orderedThrow = String(error?.message ?? error);
  }
  assert(
    'a-clear-diff-NEVER-constructs-a-head-or-review-request',
    apiTouched === 0 && orderedThrow === null && orderedClear?.exitCode === EXIT_CLEAR && orderedClear?.conclusion === 'clear',
    `apiTouched=${apiTouched} threw=${orderedThrow ?? 'no'}`,
  );
  // ...and the other half: a governed diff DOES reach both reads — head
  // first — so the case above is proving an ordering, not a dead code path.
  const trace = [];
  const traced = await runGuard({
    repo: REPO,
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchPull: () => {
      trace.push('head');
      return pull();
    },
    fetchReviews: () => {
      trace.push('reviews');
      return [approvedAt(GOVERNED_APPROVERS[0], HEAD)];
    },
  });
  assert('a-governed-queue-diff-reads-head-THEN-reviews', trace.join() === 'head,reviews', trace.join());
  assert(
    'the-queue-predicate-is-wired-end-to-end-an-authorized-approval-CLEARS',
    traced.conclusion === 'cleared' && traced.exitCode === EXIT_CLEAR && traced.apiCalls === 2,
    JSON.stringify({ conclusion: traced.conclusion, apiCalls: traced.apiCalls }),
  );
  const tracedOlder = await runGuard({
    repo: REPO,
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchPull: () => pull(),
    fetchReviews: () => [approvedAt(GOVERNED_APPROVERS[0], OLD)],
  });
  assert(
    '⭐ end-to-end-an-authorized-approval-on-an-older-commit-CLEARS-and-the-log-says-it-counted-anyway',
    tracedOlder.conclusion === 'cleared' && tracedOlder.exitCode === EXIT_CLEAR && /COUNTS ANYWAY/.test(renderGuardVerdict(tracedOlder)),
    renderGuardVerdict(tracedOlder),
  );
  // The PR leg's behavior is byte-identical to the pre-pinning guard, and that
  // includes its API surface: NO head read, the any-approver reading, and the
  // same rendered line.
  let prHeadReads = 0;
  const prLeg = await runGuard({
    repo: REPO,
    event: 'pull_request',
    rows: [row(1, ['AGENTS.md'])],
    fetchPull: () => {
      prHeadReads += 1;
      return pull();
    },
    fetchReviews: () => approved('anyone'),
  });
  assert(
    'the-pr-leg-makes-NO-head-read-and-keeps-the-any-approver-reading-unchanged',
    prHeadReads === 0 && prLeg.conclusion === 'warned' && prLeg.apiCalls === 1 &&
      renderGuardVerdict(prLeg).includes('✅ APPROVED review present, by: anyone') &&
      renderGuardVerdict(prLeg).includes('1 review lookup(s).'),
    renderGuardVerdict(prLeg),
  );
  // A throwing reader on a GOVERNED diff becomes a refusal, never a pass —
  // and `runGuard` must CONTAIN the throw rather than propagate it, so this
  // is caught too: an escaping error would otherwise abort every case after
  // it, and an aborted self-test hides the failures it already collected.
  let thrown = null;
  let thrownEscaped = null;
  try {
    thrown = await runGuard({
      repo: REPO,
      event: 'merge_group',
      rows: [row(1, ['AGENTS.md'])],
      fetchPull: () => pull(),
      fetchReviews: () => {
        throw new Error('HTTP 403');
      },
    });
  } catch (error) {
    thrownEscaped = String(error?.message ?? error);
  }
  assert(
    'a-throwing-review-read-on-a-governed-diff-REFUSES-and-the-throw-never-escapes',
    thrownEscaped === null && thrown?.exitCode === EXIT_REFUSED_UNREADABLE && /403/.test(renderGuardVerdict(thrown)),
    thrownEscaped ? `escaped: ${thrownEscaped}` : renderGuardVerdict(thrown),
  );
  // ⭐ An unreadable PR HEAD is NO LONGER a refusal (2026-09-04): it decides
  // nothing, so the review list is still read and still judges, and the missing
  // reading is printed as a note. This is the direction the ruling reversed, so
  // both halves are measured — the reviews ARE read, and the verdict is theirs.
  let reviewsAfterHeadFailure = 0;
  const headFailed = await runGuard({
    repo: REPO,
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchPull: () => {
      throw new Error('HTTP 500');
    },
    fetchReviews: () => {
      reviewsAfterHeadFailure += 1;
      return [approvedAt(GOVERNED_APPROVERS[0], HEAD)];
    },
  });
  assert(
    '⭐ an-unreadable-pr-head-no-longer-refuses-the-reviews-are-still-read-and-still-judge',
    headFailed.conclusion === 'cleared' && headFailed.exitCode === EXIT_CLEAR && reviewsAfterHeadFailure === 1 &&
      /the PR head could not be read/.test(renderGuardVerdict(headFailed)) && /500/.test(renderGuardVerdict(headFailed)),
    `reviewsAfterHeadFailure=${reviewsAfterHeadFailure} :: ${renderGuardVerdict(headFailed)}`,
  );

  // ── the words a reader acts on (requirement (e)) ──────────────────────────
  battery('the words a reader acts on (requirement (e))');
  const refusalText = renderGuardVerdict(refusedV);
  assert('a-refusal-names-the-exact-paths-that-matched', refusalText.includes('AGENTS.md'), refusalText);
  assert('a-refusal-names-the-pull-request', refusalText.includes('#9527'), refusalText);
  assert('a-refusal-states-what-would-satisfy-it', /What satisfies this check/.test(refusalText) && /DRAFT/.test(refusalText) && /APPROVED review/.test(refusalText), refusalText);
  // ⭐ The remedy is an ORDER, not a menu, and the order is the landed rule's:
  // the queued pull request comes out of the queue first (AGENTS.md Prime
  // Directive #14 — its landing seat sends the relay's `pr_dequeue`, any other
  // seat asks the maintainer),
  // then the authorized approval, then the claiming seat lands it (ruling C,
  // #17971). The pin reads all three positions rather than the first two,
  // because a remedy that stopped at the approval would leave a seat waiting
  // for a merge nobody is going to perform; and each position must EXIST, since
  // a phrase that is gone answers -1, which sorts before everything.
  const remedyOrder = ['its landing seat sends the relay\'s `pr_dequeue` AT ONCE', 'obtain an APPROVED review', 'CLAIMING SEAT lands it from there'].map((p) => refusalText.indexOf(p));
  assert(
    'a-refusal-orders-the-remedy-the-PULL-BACK-then-the-authorized-APPROVAL-then-the-CLAIMING-SEAT-lands-it',
    remedyOrder.every((i) => i !== -1) && remedyOrder[0] < remedyOrder[1] && remedyOrder[1] < remedyOrder[2],
    `${JSON.stringify(remedyOrder)} :: ${refusalText}`,
  );
  // ⛔ The pre-ruling-C remedy, pinned in the REFUSING direction. This file used
  // to tell a seat to leave the merge to the maintainer and to call that merge
  // the review record; ruling C moved the landing to the claiming seat, so the
  // old wording now under-permits the text a seat is told to act on. Both
  // spellings are asserted ABSENT — a negative is the only pin that catches a
  // paragraph drifting back.
  assert(
    '⛔ a-refusal-never-tells-a-seat-to-leave-the-merge-to-the-maintainer-nor-calls-that-merge-the-record',
    !/leave the merge to the maintainer/.test(refusalText) && !/human merge IS the review record/.test(refusalText),
    refusalText,
  );
  assert(
    'a-refusal-quotes-ruling-C-verbatim-and-keeps-the-unapproved-direct-merge-as-the-other-landing',
    refusalText.includes('C. approve 后不管后续改动都由席位落地:') && refusalText.includes('人工直合'),
    refusalText,
  );
  assert('a-refusal-forecloses-the-edit-the-check-remedy', /Neither of those is "edit this check"/.test(refusalText), refusalText);
  assert('a-refusal-carries-the-runnable-derivation-command', refusalText.includes('check-governed-merges.mjs --test'), refusalText);
  const clearText = renderGuardVerdict(clearV);
  assert('a-clear-run-says-it-cost-zero-lookups', /ZERO review lookups/.test(clearText), clearText);
  assert('a-clear-run-points-at-the-register-rather-than-listing-surfaces', clearText.includes('GOVERNED_SURFACES') && !clearText.includes('docs/adr/**'), clearText);
  const warnText = renderGuardVerdict(warnedV);
  assert('the-warning-says-out-loud-that-it-is-deliberately-green', /EARLY WARNING/.test(warnText) && /GREEN here/.test(warnText), warnText);
  assert('the-warning-tells-a-seat-what-not-to-do', /flip it ready, enqueue it, or arm auto-merge/.test(warnText), warnText);
  // ⭐ ... and says out loud that the prohibition is CONDITIONAL. Prime Directive
  // #14's four lift for an authorized approval, and ruling C puts what follows
  // in the claiming seat's hands; an unconditional ⛔ here would tell a seat to
  // sit on a PR the rule says it should land.
  assert(
    'and-the-prohibition-is-CONDITIONAL-on-there-being-no-authorized-approval-yet',
    /while no authorized APPROVED review is on record/.test(warnText) && /prohibitions lift for that approval/.test(warnText),
    warnText,
  );
  assert(
    'and-the-warning-says-what-a-seat-DOES-do-after-that-approval-the-claiming-seat-lands-it',
    /CLAIMING SEAT lands it/.test(warnText) && warnText.includes('C. approve 后不管后续改动都由席位落地:'),
    warnText,
  );
  assert(
    '⛔ and-it-no-longer-calls-a-maintainer-hand-merge-the-regimes-healthy-END-state',
    !/人工合并即人工审核/.test(warnText) && /四件套留 draft 等人批/.test(warnText),
    warnText,
  );
  assert('the-warning-forecasts-the-queue-refusal', /will REFUSE it/.test(warnText), warnText);
  assert('an-outstanding-changes-request-is-reported-even-though-it-does-not-flip-the-verdict', /CHANGES_REQUESTED from: b/.test(renderGuardVerdict(run('merge_group', [row(1, ['AGENTS.md'])], new Map([[1, approvalVerdict([...approved('a'), { state: 'CHANGES_REQUESTED', user: { login: 'b' } }])]])))));
  // Every refusal kind renders a distinct, actionable sentence — a shared
  // "refused" line would collapse three different facts into one log entry.
  const kinds = [refusedV, unreadableV, unattrV].map((v) => renderGuardVerdict(v));
  assert('the-three-refusal-kinds-render-three-different-explanations', new Set(kinds).size === 3);
  assert('the-unreadable-refusal-says-it-is-deliberately-not-a-pass', /refusal and not a pass/.test(kinds[1]), kinds[1]);
  // The pinned-predicate renderings a reader acts on, every named account
  // derived from the constant — nothing here restates the set.
  assert(
    'the-refusal-remedy-names-every-authorized-approver-from-the-constant',
    GOVERNED_APPROVERS.every((login) => refusalText.includes(login)) && refusalText.includes('GOVERNED_APPROVERS'),
    refusalText,
  );
  assert('the-refusal-remedy-states-the-agent-no-approve-prohibition', /An agent seat/.test(refusalText) && /never submits that approval, under any account/.test(refusalText), refusalText);
  const olderShaText = renderGuardVerdict(olderShaV);
  assert(
    '⭐ an-approval-on-an-older-commit-CLEARS-and-the-log-names-both-commits-and-the-accepted-cost',
    olderShaText.includes(OLD.slice(0, 12)) && olderShaText.includes(HEAD.slice(0, 12)) && /COUNTS ANYWAY/.test(olderShaText) &&
      /re-review the push that moved the head/.test(olderShaText),
    olderShaText,
  );
  assert(
    'a-refusal-says-an-approval-on-an-EARLIER-commit-would-have-counted-and-never-says-STALE',
    /An approval on an EARLIER commit would have counted/.test(refusalText) && !/STALE/.test(refusalText),
    refusalText,
  );
  assert(
    'an-unauthorized-refusal-says-the-approval-never-counts',
    /APPROVED by account\(s\) outside GOVERNED_APPROVERS: not-authorized — never counts/.test(renderGuardVerdict(outsiderV)),
    renderGuardVerdict(outsiderV),
  );
  const clearedText = renderGuardVerdict(clearedV);
  assert(
    'the-cleared-summary-states-the-2026-09-04-predicate-and-derives-its-accounts-from-the-constant',
    /on ANY commit/.test(clearedText) && /2026-09-04/.test(clearedText) && /Accepted cost/.test(clearedText) &&
      GOVERNED_APPROVERS.every((login) => clearedText.includes(login)) && /APPROVER as well as the merger/.test(clearedText),
    clearedText,
  );
  assert(
    'an-authorized-pass-names-its-approver-and-pins-it-to-nothing',
    clearedText.includes(`✅ authorized APPROVED review, by: ${GOVERNED_APPROVERS[0]}`) && !clearedText.includes('pinned to head'),
    clearedText,
  );

  // ── the generated-artifact exception reaches THIS guard (#9866 / #11705) ──
  //
  // The lift path had no case here at all, which is how the register's second
  // shape nearly slipped past: this file used to derive its own membership set
  // from `.path`, and a candidate row has none. These drive the real
  // `liftGeneratedExceptions` with the recompute injected, so the row filtering
  // and the note wording are pinned without a generator process.
  const genIndex = 'skills/objectstack-ui/references/_index.md';
  const handAuthored = 'skills/objectstack-ui/SKILL.md';
  const verified = (reason = 'byte-equal (fixture)') => async (_root, hits) =>
    new Map([...hits.values()].flat().map((p) => [p, { pureRegeneration: true, reason }]));
  const refused = (reason = 'differs (fixture)') => async (_root, hits) =>
    new Map([...hits.values()].flat().map((p) => [p, { pureRegeneration: false, reason }]));
  const liftNotes = [];
  const liftedRows = await liftGeneratedExceptions(
    '/w',
    'base',
    [{ ...row(1, ['packages/spec/src/ui/responsive.zod.ts', genIndex]) }],
    liftNotes,
    verified(),
    REPO,
  );
  assert('a-certified-regeneration-inside-skills-leaves-the-row-with-nothing-governed',
    governedPathsIn(liftedRows[0].paths, REPO).length === 0, JSON.stringify(liftedRows[0].paths));
  assert('and-the-note-cites-the-ruling-that-lifted-it', liftNotes.some((n) => n.includes('#11705') && n.includes('LIFTED')), JSON.stringify(liftNotes));
  const mixedNotes = [];
  const mixedRows = await liftGeneratedExceptions('/w', 'base', [{ ...row(2, [genIndex, handAuthored]) }], mixedNotes, verified(), REPO);
  assert('but-hand-authored-skill-content-in-the-same-commit-still-governs-the-row',
    governedPathsIn(mixedRows[0].paths, REPO).map((s) => s.files).flat().join() === handAuthored, JSON.stringify(mixedRows[0].paths));
  const refusedNotes = [];
  const refusedRows = await liftGeneratedExceptions('/w', 'base', [{ ...row(3, [genIndex]) }], refusedNotes, refused(), REPO);
  assert('a-refused-provenance-keeps-the-generated-path-governed-here-too',
    refusedRows[0].paths.join() === genIndex && refusedNotes.some((n) => n.includes('did NOT lift')), JSON.stringify(refusedNotes));
  // The DEGRADED environment — the job installs dependencies now (#14063), but
  // every step of that install is `continue-on-error`, so "no toolchain" is a
  // state a real run can still be in (registry outage, cold cache, a PR whose
  // lockfile is out of sync). Fail-closed is the ruled answer there, and it must
  // be the one a reader sees stated.
  const noToolNotes = [];
  const noToolRows = await liftGeneratedExceptions('/w', 'base', [{ ...row(4, [genIndex]) }], noToolNotes,
    refused('could not run `pnpm --filter @objectstack/spec gen:skill-refs` on this tree (spawn pnpm ENOENT) — the generator toolchain is not available in this environment'), REPO);
  assert('with-no-generator-toolchain-this-guard-keeps-the-path-governed-and-says-why',
    noToolRows[0].paths.join() === genIndex && noToolNotes.some((n) => /toolchain is not available/.test(n)), JSON.stringify(noToolNotes));
  // A commit that touches no registered path never consults provenance — the
  // recompute is handed a spy that throws if it is called at all.
  const untouched = await liftGeneratedExceptions('/w', 'base', [{ ...row(5, ['AGENTS.md']) }], [], async () => {
    throw new Error('the recompute must not run for a diff with no registered path');
  }, REPO);
  assert('an-ordinary-governed-diff-never-pays-for-a-recompute', untouched[0].paths.join() === 'AGENTS.md');

  // ── ⭐ #14063 END TO END: what the dependency install actually buys ────────
  //
  // The cases above pin the lift in isolation; these run the WHOLE decision —
  // lift, then `runGuard`, then the exit code — over the diff shape that made
  // the maintainer approve a pure regeneration by hand (2026-09-01: 「纯生成的
  // 指针行(spec 源变更后再生成的 references/_index.md) 不需要我审核吧」): a spec
  // source edit plus its four regenerated pointer files, in one commit.
  //
  // The recompute is injected rather than run, because this self-test is
  // offline by contract and a real generator run needs the very toolchain the
  // workflow installs. So what is pinned here is the DECISION each recompute
  // answer produces — certified, un-run, drifted — and the workflow pins below
  // assert the environment that makes the certified answer reachable at all.
  // Neither half is worth much alone; together they are the claim.
  battery('⭐ #14063 END TO END: what the dependency install actually buys');
  const regenPaths = ['objectstack-ai', 'objectstack-api', 'objectstack-data', 'objectstack-query'].map(
    (skill) => `skills/${skill}/references/_index.md`,
  );
  const regenRow = (extra = []) => ({
    sha: 'd'.repeat(40),
    subject: 'docs(spec): regenerate the skill reference indexes (#13794)',
    pr: 13794,
    paths: ['packages/spec/src/query/operators.zod.ts', ...regenPaths, ...extra],
  });
  const endToEnd = async (recompute, rows, { head = () => pull(), reviews = () => [] } = {}) => {
    const notes = [];
    const lifted = await liftGeneratedExceptions('/w', 'base', rows, notes, recompute, REPO);
    return { verdict: await runGuard({ repo: REPO, event: 'merge_group', rows: lifted, fetchPull: head, fetchReviews: reviews }), notes };
  };
  // ⭐ Zero approvals AND zero API calls: once the row is lifted the diff
  // touches nothing governed, so the guard returns before a request exists —
  // measured with spies that throw, the same way the ordering guarantee is.
  const apiSpy = () => {
    throw new Error('the API must not be reached — the regeneration was lifted, so nothing governed remains');
  };
  const certified = await endToEnd(verified('byte-equal to the generator recomputed on this tree (fixture)'), [regenRow()], {
    head: apiSpy,
    reviews: apiSpy,
  });
  assert(
    'with-the-toolchain-installed-a-PURE-REGENERATION-merge-group-CLEARS-with-zero-approvals-and-zero-api-calls',
    certified.verdict.conclusion === 'clear' && certified.verdict.exitCode === EXIT_CLEAR && certified.verdict.apiCalls === 0,
    JSON.stringify({ conclusion: certified.verdict.conclusion, exitCode: certified.verdict.exitCode, apiCalls: certified.verdict.apiCalls }),
  );
  assert(
    'and-it-says-which-ruling-lifted-each-of-the-four-pointer-files',
    regenPaths.every((p) => certified.notes.some((n) => n.includes(p) && n.includes('LIFTED') && n.includes('#11705'))),
    JSON.stringify(certified.notes),
  );
  // The other direction, and the one requirement (2) of the card names: EVERY
  // way the recompute can fail to certify still refuses the identical diff. A
  // missing toolchain is a real environment (the install is continue-on-error);
  // drift is a hand edit to a generated file, which is the case the exception
  // exists to keep governed.
  for (const [label, why] of [
    [
      'no-toolchain',
      'could not run `pnpm --filter @objectstack/spec gen:skill-refs` on this tree (spawn pnpm ENOENT) — the generator toolchain is not available in this environment',
    ],
    ['drift', '`check:skill-refs` does not certify this tree (the generator\'s own --check exited 1) — fail closed: the path stays governed'],
  ]) {
    const failed = await endToEnd(refused(why), [regenRow()]);
    assert(
      `a-recompute-that-does-not-certify-still-REFUSES-the-same-merge-group-fail-closed: ${label}`,
      failed.verdict.conclusion === 'refused' && failed.verdict.exitCode === EXIT_REFUSED_UNAPPROVED,
      JSON.stringify({ label, conclusion: failed.verdict.conclusion, exitCode: failed.verdict.exitCode }),
    );
    assert(`and-the-log-states-the-reason-it-did-not-lift: ${label}`, failed.notes.some((n) => n.includes('did NOT lift') && n.includes(why.slice(0, 24))), JSON.stringify(failed.notes));
  }
  // Hand-authored governed content in the same commit as a certified
  // regeneration: still refused, and the refusal names the hand-authored file
  // WITHOUT naming the lifted ones — a reader must be able to see which path
  // they are being asked about.
  const mixedE2E = await endToEnd(verified(), [regenRow(['skills/objectstack-ai/SKILL.md'])]);
  const mixedText = renderGuardVerdict(mixedE2E.verdict);
  assert(
    'a-hand-authored-skills-file-beside-a-certified-regeneration-is-still-REFUSED',
    mixedE2E.verdict.exitCode === EXIT_REFUSED_UNAPPROVED && mixedText.includes('skills/objectstack-ai/SKILL.md'),
    mixedText,
  );
  assert('and-the-refusal-does-not-name-the-paths-it-lifted', regenPaths.every((p) => !mixedText.includes(p)), mixedText);
  // A recompute that THROWS (rather than answering) must never read as a lift.
  // `liftGeneratedExceptions` deliberately does not catch: `main` wraps the
  // whole decomposition and turns a throw into EXIT_CANNOT_RUN — red, and the
  // one thing this file has no green for is "did not look".
  let liftThrew = null;
  try {
    await liftGeneratedExceptions('/w', 'base', [regenRow()], [], async () => {
      throw new Error('spawn pnpm EACCES');
    }, REPO);
  } catch (error) {
    liftThrew = String(error?.message ?? error);
  }
  assert('a-recompute-that-THROWS-never-lifts-it-propagates-into-CANNOT-RUN', liftThrew !== null && /EACCES/.test(liftThrew), String(liftThrew));

  // ── ⭐ #15406: a CLEAR reached through a lift is not a clear that saw nothing ─
  //
  // Replays the real diff shape of objectstack#15284 — the landing that was
  // filed as "the mixed-diff diversion did not fire". It had NOT failed: the
  // diff's single governed path was the register's own `spec-react-blocks`
  // row, the recompute certified it byte-exact, and the queue leg cleared with
  // zero approvals exactly as the 2026-09-01 ruling provides for. What failed
  // was the LOG. Its verdict line read, directly under its own LIFTED line:
  //
  //     ✅  CLEAR — the diff touches no governed surface, so this guard has
  //         nothing to judge.
  //     … ⛔ ZERO review lookups were made: the path test runs first and returns
  //
  // Both sentences are false for that run: the path test MATCHED, and the
  // register's recompute ran. Read back from the merge queue log, that landing
  // is indistinguishable from a guard that never saw the file — which is the
  // reading the post-merge audit row was filed on. ⛔ The predicate is NOT what
  // these cases pin: the verdict, the exit code and the API cost are asserted
  // to be the SAME as before, and only the words change.
  battery('⭐ #15406: a CLEAR reached through a lift is not a clear that saw nothing');
  // #15284's real file list, in its merged order.
  const pr15284Paths = [
    '.changeset/list-view-grouping-server-side-contract.md',
    'content/docs/references/api/protocol.mdx',
    'content/docs/references/data/object.mdx',
    'content/docs/references/ui/view.mdx',
    'packages/spec/api-surface/ui.json',
    'packages/spec/export-origins/ui.json',
    'packages/spec/src/ui/index.ts',
    'packages/spec/src/ui/view-grouping-query.test.ts',
    'packages/spec/src/ui/view-grouping-query.ts',
    'packages/spec/src/ui/view.zod.ts',
    'skills/objectstack-ui/references/react-blocks.md',
  ];
  const pr15284ReactBlocks = 'skills/objectstack-ui/references/react-blocks.md';
  const pr15284Row = (paths = pr15284Paths) => ({
    sha: 'f502898a49530a1c85e58f3c4d2b340c0e1cb909',
    subject: 'feat(spec): list-view grouping is server-side (#15284)',
    pr: 15284,
    paths,
  });
  // main()'s own wiring, reproduced: lift, derive what was lifted, then judge.
  // ⛔ Not the `endToEnd` helper above — the defect lived in the step BETWEEN
  // those two, so a helper that skips it cannot see it.
  const asMainDoes = async (recompute, rows, io = {}) => {
    const notes = [];
    const after = await liftGeneratedExceptions('/w', 'base', rows, notes, recompute, REPO);
    const lifted = liftedPathsBetween(rows, after);
    const verdict = await runGuard({
      repo: REPO,
      event: 'merge_group',
      rows: after,
      fetchPull: io.head ?? (() => pull()),
      fetchReviews: io.reviews ?? (() => []),
      lifted,
    });
    return { verdict, notes, lifted, text: renderGuardVerdict(verdict) };
  };
  const noApi = () => {
    throw new Error('the API must not be reached — the only governed path was lifted');
  };
  // The classification leg first: the file IS on the register, and the diff DID
  // hit a governed surface before anything was lifted. Both are facts the old
  // verdict line denied.
  assert(
    'the-one-skills-path-in-15284-is-a-register-CANDIDATE-not-hand-authored-content',
    generatedExceptionFor(pr15284ReactBlocks)?.id === 'spec-react-blocks',
    JSON.stringify(generatedExceptionFor(pr15284ReactBlocks)),
  );
  assert(
    '⭐ the-mixed-diff-rule-DID-match-15284-before-the-lift-one-hit-out-of-eleven-paths',
    governedPathsIn(pr15284Paths, REPO).flatMap((s) => s.files).join() === pr15284ReactBlocks,
    JSON.stringify(governedPathsIn(pr15284Paths, REPO)),
  );
  const certified15284 = await asMainDoes(
    verified('byte-equal to the react-blocks generator recomputed on this tree (fixture)'),
    [pr15284Row()],
    { head: noApi, reviews: noApi },
  );
  // The verdict itself is UNCHANGED — the 2026-09-01 ruling working, with an
  // approver set that does not contain the merging account and no review of any
  // kind on the pull request.
  assert(
    'a-certified-regeneration-still-CLEARS-with-zero-reviews-and-zero-api-calls',
    certified15284.verdict.conclusion === 'clear' && certified15284.verdict.exitCode === EXIT_CLEAR && certified15284.verdict.apiCalls === 0,
    JSON.stringify({ c: certified15284.verdict.conclusion, e: certified15284.verdict.exitCode, api: certified15284.verdict.apiCalls }),
  );
  assert(
    'liftedPathsBetween-names-exactly-the-path-the-register-lifted',
    certified15284.lifted.join() === pr15284ReactBlocks,
    JSON.stringify(certified15284.lifted),
  );
  assert(
    '⭐ the-CLEAR-line-does-NOT-claim-the-diff-touched-no-governed-surface',
    !certified15284.text.includes('the diff touches no governed surface'),
    certified15284.text,
  );
  assert(
    '⭐ the-CLEAR-line-does-NOT-claim-the-path-test-returned-before-matching',
    !certified15284.text.includes('the path test runs first and returns'),
    certified15284.text,
  );
  assert(
    'the-CLEAR-line-names-the-lifted-path-and-says-the-recompute-ran',
    certified15284.text.includes(pr15284ReactBlocks) &&
      /LIFTED/.test(certified15284.text) &&
      /recomputed provenance on this tree/.test(certified15284.text),
    certified15284.text,
  );
  assert(
    'and-it-still-reports-the-zero-lookup-cost-a-reader-checks-for',
    /ZERO review lookups/.test(certified15284.text),
    certified15284.text,
  );
  // The other direction, on the SAME path: a hand edit to that file is not
  // lifted, so the identical file list refuses. The shape is not an exemption
  // for `references/react-blocks.md`; it is an exemption for a recompute.
  const handEdited15284 = await asMainDoes(refused('the generator does not certify this tree (fixture)'), [pr15284Row()]);
  assert(
    'a-hand-edit-to-the-SAME-path-still-REFUSES-the-same-file-list',
    handEdited15284.verdict.exitCode === EXIT_REFUSED_UNAPPROVED && handEdited15284.lifted.length === 0,
    JSON.stringify({ e: handEdited15284.verdict.exitCode, lifted: handEdited15284.lifted }),
  );
  // And the zero-cost clear is untouched, to the byte, on BOTH legs — the
  // 2026-08-27 byte-identity constraint on the pull_request leg included.
  for (const event of [EVENT_MERGE_GROUP, EVENT_PULL_REQUEST]) {
    const nothing = renderGuardVerdict(guardVerdict({ repo: REPO, event, governed: [], unattributed: [], apiCalls: 0 }));
    assert(
      `a-clear-with-nothing-lifted-keeps-its-pre-15406-wording-byte-for-byte: ${event}`,
      nothing.includes('  ✅  CLEAR — the diff touches no governed surface, so this guard has nothing to judge.') &&
        nothing.includes('      never from a restated list. ⛔ ZERO review lookups were made: the path test runs first and returns,') &&
        nothing.includes('      so a GitHub API outage can never block a diff that touches nothing governed.'),
      nothing,
    );
  }

  // ── the PR-head reader: throws, and the caller no longer refuses on it ───
  //
  // The READER's own contract is unchanged — a non-2xx or an unparseable body
  // throws, never a silent default. What 2026-09-04 moved is one level up: the
  // caller now catches that throw and prints it, because the head decides
  // nothing. A reader that quietly returned '' would still be wrong: it would
  // put a phantom "same commit" reading into a log.
  battery('the PR-head reader: throws, and the caller no longer refuses on it');
  const fakeRes = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });
  const readerArgs = { apiUrl: 'https://api.example', slug: 'o/r', token: null };
  assert(
    'the-pull-head-reader-answers-the-current-head-sha',
    (await makePullReader({ ...readerArgs, fetchImpl: fakeRes({ head: { sha: HEAD } }) })(7)).sha === HEAD,
  );
  assert(
    '⭐ and-the-SAME-request-answers-the-body-and-branch-the-card-is-located-from-so-the-card-thread-costs-no-extra-call',
    await (async () => {
      let calls = 0;
      const row7 = await makePullReader({
        ...readerArgs,
        fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ head: { sha: HEAD, ref: 'claude/issue-321-x' }, body: 'Fixes #321' }) }; },
      })(7);
      return calls === 1 && row7.body === 'Fixes #321' && row7.headRef === 'claude/issue-321-x';
    })(),
  );
  const readerThrow = async (fetchImpl) => {
    try {
      await makePullReader({ ...readerArgs, fetchImpl })(7);
      return null;
    } catch (error) {
      return String(error?.message ?? error);
    }
  };
  assert('a-non-2xx-pull-read-throws-with-its-status', /HTTP 502/.test(await readerThrow(fakeRes({}, false, 502))));
  assert('a-body-with-no-parseable-head-sha-throws-never-pins-nothing-silently', /head\.sha/.test(await readerThrow(fakeRes({ head: {} }))));


  // ── ⛔ #19036: the SIZE line at the queue — imported, per queued PR, fail-closed ─
  //
  // The maintainer's 2026-09-18 ruling landed seat-side in PR #19033 while the
  // queue kept handing the predicate no size, so PR #18971's shape — over the
  // line, NOTHING governed — still merged through this leg. The cases below are
  // the card's acceptance in its order: the oversized ungoverned group is
  // REFUSED with the limb named; at-threshold is clear; a governed AND
  // oversized group prints both limbs and exits on the governed code; the
  // pull_request leg is byte-identical; an unreadable size fails CLOSED; and
  // the number, the comparison and what counts are IMPORTED — pinned against
  // this file's own source, and proved by the landing PR's ablation, which
  // inverts the comparison in the SIBLING and watches these pins redden.
  battery('⛔ #19036: the SIZE line at the queue — imported, per queued PR, fail-closed');
  const LINE = HUMAN_MERGE_LINE_THRESHOLD;
  const sizePair = (additions, deletions, source = 'GET /repos/o/r/pulls/1') => ({ additions, deletions, source });
  // The enumeration this leg reads: per commit, deduplicated, the queue ref
  // consulted only when nothing is attributed (#9902's direction).
  const queuedRow = (pr, sha = 'a'.repeat(40)) => ({ sha, subject: `x (#${pr})`, pr, paths: ['README.md'] });
  assert(
    'the-group-enumeration-is-per-commit-deduplicated-and-in-group-order',
    JSON.stringify(queuedPullsInGroup([queuedRow(7), queuedRow(3), queuedRow(7)])) === JSON.stringify([7, 3]),
    JSON.stringify(queuedPullsInGroup([queuedRow(7), queuedRow(3), queuedRow(7)])),
  );
  assert(
    '⛔ the-queue-head-ref-is-NOT-the-key-when-the-decomposition-attributed-pull-requests',
    JSON.stringify(queuedPullsInGroup([queuedRow(11), queuedRow(22)], 22)) === JSON.stringify([11, 22]),
    'the head ref names only the last PR; keying the leg to it lets an earlier oversized PR ride in behind it',
  );
  assert(
    'the-queue-head-ref-IS-consulted-when-nothing-else-attributes-a-pull-request',
    JSON.stringify(queuedPullsInGroup([{ sha: 'b'.repeat(40), subject: 'no pr here', pr: null, paths: [] }], 99)) === JSON.stringify([99]),
  );
  assert('no-rows-and-no-head-ref-enumerate-nothing', queuedPullsInGroup([], null).length === 0 && queuedPullsInGroup(undefined, 0).length === 0);
  // ⭐ #15406's constraint, re-measured for this leg: the merge_group zero-cost
  // clear is SCOPED (this leg reads every queued pull request there), while the
  // pull_request one keeps its 2026-08-27 bytes exactly.
  const clearMg = renderGuardVerdict(guardVerdict({ repo: REPO, event: EVENT_MERGE_GROUP, governed: [], unattributed: [], apiCalls: 0 }));
  const clearPr = renderGuardVerdict(guardVerdict({ repo: REPO, event: EVENT_PULL_REQUEST, governed: [], unattributed: [], apiCalls: 0 }));
  assert(
    '⭐ the-merge_group-zero-cost-clear-SCOPES-its-outage-promise-because-the-size-leg-reads-every-queued-PR',
    clearMg.includes('Scoped to the GOVERNED-SURFACE leg') && clearMg.includes('An outage there DOES refuse this merge group.'),
    clearMg,
  );
  assert(
    'the-pull_request-zero-cost-clear-keeps-its-2026-08-27-bytes-carrying-NO-size-note',
    !clearPr.includes('Scoped to the GOVERNED-SURFACE leg') && clearPr.includes('so a GitHub API outage can never block a diff that touches nothing governed.'),
    clearPr,
  );
  assert(
    'the-two-size-codes-are-distinct-non-zero-and-collide-with-no-other-code',
    new Set([
      EXIT_CLEAR, EXIT_CANNOT_RUN, EXIT_REFUSED_UNAPPROVED, EXIT_REFUSED_UNREADABLE, EXIT_REFUSED_UNATTRIBUTED,
      EXIT_REFUSED_OVERSIZED, EXIT_REFUSED_SIZE_UNREADABLE,
    ]).size === 7 && EXIT_REFUSED_OVERSIZED !== 0 && EXIT_REFUSED_SIZE_UNREADABLE !== 0,
    JSON.stringify([EXIT_REFUSED_OVERSIZED, EXIT_REFUSED_SIZE_UNREADABLE]),
  );
  // The reader: the pair rides the SAME pull read the head does.
  const sizedRow = await makePullReader({ ...readerArgs, fetchImpl: fakeRes({ head: { sha: HEAD }, additions: 238310, deletions: 119 }) })(18971);
  assert(
    'the-pull-reader-answers-the-size-pair-off-the-same-object-naming-the-endpoint-as-its-source',
    sizedRow.sha === HEAD && sizedRow.size.additions === 238310 && sizedRow.size.deletions === 119 && sizedRow.size.source === 'GET /repos/o/r/pulls/18971',
    JSON.stringify(sizedRow),
  );
  const unsizedRow = await makePullReader({ ...readerArgs, fetchImpl: fakeRes({ head: { sha: HEAD }, additions: 3 }) })(7);
  assert(
    '⛔ a-pull-object-without-the-pair-answers-size-null-and-STILL-answers-the-head-the-governed-leg-is-undisturbed',
    unsizedRow.sha === HEAD && unsizedRow.size === null,
    JSON.stringify(unsizedRow),
  );
  // The reading: the sibling's predicate, size limb alone.
  const overRead = sizeReading(1, sizePair(LINE, 1), REPO);
  const atRead = sizeReading(1, sizePair(LINE, 0), REPO);
  const underRead = sizeReading(1, sizePair(LINE - 1, 0), REPO);
  assert('⭐ threshold-plus-one-changed-line-is-OVERSIZED', overRead.state === 'oversized' && overRead.verdict.size.changedLines === LINE + 1, JSON.stringify(overRead.verdict.size));
  assert('⭐ exactly-the-threshold-is-WITHIN-the-comparison-is-strictly-greater', atRead.state === 'within' && atRead.verdict.size.changedLines === LINE, JSON.stringify(atRead.verdict.size));
  assert('one-under-is-WITHIN', underRead.state === 'within');
  assert(
    '⛔ no-pair-is-UNREADABLE-never-within',
    sizeReading(1, null, REPO).state === 'unreadable' && sizeReading(1, { additions: 3 }, REPO).state === 'unreadable' && /never a size of zero/.test(sizeReading(1, null, REPO).reason),
  );
  assert(
    '⭐ the-reading-IS-the-landed-predicate-landsByHumanMerge-agrees-on-every-branch-and-the-path-limb-stays-out-of-it',
    landsByHumanMerge(overRead.verdict) === true && landsByHumanMerge(atRead.verdict) === false && landsByHumanMerge(underRead.verdict) === false && overRead.verdict.governed === false,
  );
  // The verdict table.
  const sizeRun = (pulls, states) => {
    const readings = new Map();
    for (const [pr, state] of Object.entries(states)) {
      const n = Number(pr);
      readings.set(
        n,
        state === 'unreadable'
          ? { pr: n, state, verdict: testVerdict([], { repo: REPO, size: null }), reason: 'HTTP 403 (fixture)' }
          : sizeReading(n, state === 'oversized' ? sizePair(LINE, 1) : sizePair(LINE, 0), REPO),
      );
    }
    return sizeGuardVerdict({ repo: REPO, event: EVENT_MERGE_GROUP, pulls, readings, apiCalls: pulls.length });
  };
  const overOne = sizeRun([5], { 5: 'oversized' });
  assert('an-OVERSIZED-queued-PR-REFUSES-with-code-8', overOne.exitCode === EXIT_REFUSED_OVERSIZED && overOne.conclusion === 'refused' && overOne.refusalKind === 'oversized');
  const atOne = sizeRun([5], { 5: 'within' });
  assert('an-at-threshold-queued-PR-is-CLEAR-and-exits-0', atOne.exitCode === EXIT_CLEAR && atOne.conclusion === 'clear');
  const unreadOne = sizeRun([5], { 5: 'unreadable' });
  assert('⛔ an-UNREADABLE-size-REFUSES-with-its-OWN-code-9-never-passes', unreadOne.exitCode === EXIT_REFUSED_SIZE_UNREADABLE && unreadOne.refusalKind === 'unreadable');
  assert(
    'a-pull-with-NO-recorded-reading-REFUSES-rather-than-defaulting-to-within',
    sizeGuardVerdict({ repo: REPO, event: EVENT_MERGE_GROUP, pulls: [5], readings: new Map(), apiCalls: 1 }).exitCode === EXIT_REFUSED_SIZE_UNREADABLE,
  );
  const sizeNoPull = sizeGuardVerdict({ repo: REPO, event: EVENT_MERGE_GROUP, pulls: [], readings: new Map(), apiCalls: 0 });
  assert('a-merge-group-naming-NO-pull-request-REFUSES-on-9-with-kind-no-pull', sizeNoPull.exitCode === EXIT_REFUSED_SIZE_UNREADABLE && sizeNoPull.refusalKind === 'no-pull');
  assert('⭐ a-within-sibling-does-NOT-carry-an-oversized-PR-through-the-group', sizeRun([11, 22], { 11: 'oversized', 22: 'within' }).exitCode === EXIT_REFUSED_OVERSIZED);
  // The pull_request leg: not applicable, silent, read-free.
  const sizePrLeg = sizeGuardVerdict({ repo: REPO, event: EVENT_PULL_REQUEST, pulls: [5], readings: new Map() });
  assert(
    'the-pull_request-leg-is-NOT-APPLICABLE-exits-clear-and-renders-NOTHING-so-that-legs-output-stays-byte-identical',
    sizePrLeg.conclusion === 'not-applicable' && sizePrLeg.exitCode === EXIT_CLEAR && renderSizeVerdict(sizePrLeg) === '',
  );
  let sizeReadsOnPr = 0;
  const sizePrRun = await runSizeGuard({
    repo: REPO,
    event: EVENT_PULL_REQUEST,
    rows: [queuedRow(5)],
    fetchPull: () => {
      sizeReadsOnPr += 1;
      throw new Error('the size leg must not read on the pull_request leg');
    },
  });
  assert('and-makes-ZERO-pull-reads-there-measured-with-a-spy-that-THROWS', sizeReadsOnPr === 0 && sizePrRun.apiCalls === 0 && sizePrRun.conclusion === 'not-applicable');
  // End to end through the orchestrator: one pull read per queued PR, the enumeration `queuedPullsInGroup`'s.
  const sizeReads = [];
  const e2eSize = await runSizeGuard({
    repo: REPO,
    event: EVENT_MERGE_GROUP,
    rows: [queuedRow(11), queuedRow(22), queuedRow(11)],
    fetchPull: async (pr) => {
      sizeReads.push(pr);
      return pull(HEAD, { size: pr === 11 ? sizePair(LINE, 1) : sizePair(1, 0) });
    },
  });
  assert(
    '⭐ end-to-end-ONE-pull-read-per-queued-PR-deduplicated-in-group-order-and-the-oversized-one-refuses',
    sizeReads.join() === '11,22' && e2eSize.apiCalls === 2 &&
      e2eSize.apiCalls === queuedPullsInGroup([queuedRow(11), queuedRow(22), queuedRow(11)]).length && e2eSize.exitCode === EXIT_REFUSED_OVERSIZED,
    JSON.stringify({ reads: sizeReads, apiCalls: e2eSize.apiCalls, exit: e2eSize.exitCode }),
  );
  let sizeUrl = '';
  const e2eReader = await runSizeGuard({
    repo: REPO,
    event: EVENT_MERGE_GROUP,
    rows: [queuedRow(42)],
    fetchPull: makePullReader({
      ...readerArgs,
      fetchImpl: async (url) => {
        sizeUrl = url;
        return { ok: true, status: 200, json: async () => ({ head: { sha: HEAD }, additions: 10, deletions: 2 }) };
      },
    }),
  });
  assert(
    'and-through-the-real-reader-it-hits-the-pull-object-route-the-scope-already-granted',
    /\/repos\/o\/r\/pulls\/42$/.test(sizeUrl) && e2eReader.exitCode === EXIT_CLEAR && renderSizeVerdict(e2eReader).includes('12 changed line(s) (+10 / -2)'),
    sizeUrl,
  );
  const e2eSizeThrows = await runSizeGuard({
    repo: REPO,
    event: EVENT_MERGE_GROUP,
    rows: [queuedRow(11)],
    fetchPull: async () => {
      throw new Error('GET /repos/o/r/pulls/11 answered HTTP 403');
    },
  });
  assert(
    '⛔ a-throwing-pull-read-is-exit-9-never-escapes-and-names-its-cause',
    e2eSizeThrows.exitCode === EXIT_REFUSED_SIZE_UNREADABLE && /403/.test(renderSizeVerdict(e2eSizeThrows)) && /REFUSED/.test(renderSizeVerdict(e2eSizeThrows)),
    renderSizeVerdict(e2eSizeThrows),
  );
  const e2eNoPair = await runSizeGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: [queuedRow(11)], fetchPull: async () => pull() });
  assert(
    '⛔ a-pull-object-with-no-pair-is-exit-9-too',
    e2eNoPair.exitCode === EXIT_REFUSED_SIZE_UNREADABLE && /no `additions` \/ `deletions` pair/.test(renderSizeVerdict(e2eNoPair)),
    renderSizeVerdict(e2eNoPair),
  );
  // ⭐ THE CARD'S CASE — PR #18971's shape: over the line, NOTHING governed. The
  // governed leg is CLEAR at zero reads (its spies throw), the size leg
  // REFUSES, and the group exits on the size code.
  const pr18971 = [{ sha: 'e'.repeat(40), subject: 'chore(spec): regenerate artefacts (#18971)', pr: 18971, paths: ['packages/spec/api-surface/x.json', 'content/docs/references/y.mdx'] }];
  const explodeForSize = () => {
    throw new Error('the governed leg must not read for an ungoverned diff');
  };
  const g18971 = await runGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: pr18971, fetchReviews: explodeForSize, fetchPull: explodeForSize, fetchComments: explodeForSize });
  const s18971 = await runSizeGuard({
    repo: REPO,
    event: EVENT_MERGE_GROUP,
    rows: pr18971,
    fetchPull: async () => pull(HEAD, { size: sizePair(238310, 119, 'GET /repos/objectstack-ai/objectstack/pulls/18971') }),
    // #18971 landed on an AI review alone: no authorized approval on record.
    fetchReviews: async () => [],
  });
  const exit18971 = groupExitCode({ governed: g18971, size: s18971 });
  assert(
    '⭐ #18971-replay-an-OVERSIZED-PR-with-NO-governed-path-is-REFUSED-at-the-queue-on-the-size-code',
    g18971.conclusion === 'clear' && g18971.apiCalls === 0 && s18971.exitCode === EXIT_REFUSED_OVERSIZED && exit18971 === EXIT_REFUSED_OVERSIZED,
    JSON.stringify({ governed: g18971.conclusion, size: s18971.exitCode, exit: exit18971 }),
  );
  const text18971 = renderSizeVerdict(s18971);
  assert(
    'and-the-rendering-names-the-PR-the-two-numbers-their-sum-the-threshold-and-the-limb',
    text18971.includes('#18971') && text18971.includes('238429 changed line(s) (+238310 / -119)') && text18971.includes(`EXCEEDS the human-merge line ${LINE}`) &&
      text18971.includes('SIZE limb') && text18971.includes('generated files INCLUDED'),
    text18971,
  );
  assert(
    'and-names-the-TWO-landings-an-authorized-APPROVAL-or-a-HUMAN-MERGE-quoting-all-three-rulings-untranslated-and-never-advises-shrinking-the-diff',
    text18971.includes('HUMAN MERGE') && text18971.includes('修改代码量超过某个行数（比如5000）就应该人工审核') &&
      text18971.includes('所以阈值写死成 5000 行 , 维护者已经批准了就是可以合并。') &&
      text18971.includes('这种大额改动就应该人工审核,我还是建议5000行的人工审核门槛降到 3000,立卡。') && text18971.includes('DRAFT') && !/shrink|split the|smaller/i.test(text18971),
    text18971,
  );
  assert(
    'and-says-an-authorized-approval-on-ANY-commit-lifts-this-limb-that-no-record-substitutes-and-points-at-the-sibling-for-the-number',
    /APPROVED review by one of those accounts, on ANY commit/.test(text18971) && /objectstack#20153/.test(text18971) &&
      /no review\s+of record \(Tier S\) substitutes/.test(text18971) && !/does NOT lift this limb/.test(text18971) && /check-governed-merges\.mjs --pr/.test(text18971),
    text18971,
  );
  assert(
    'and-an-oversized-entry-with-NO-authorized-approval-says-so-and-names-every-landing-on-its-own-line',
    /and nothing lifts it: no authorized APPROVED review on record \(0 review\(s\) read/.test(text18971) &&
      /lands by an authorized APPROVED review and then the OWNING seat, by the maintainer's\s+own enqueue from an account in GOVERNED_APPROVERS, or by a HUMAN MERGE/.test(text18971),
    text18971,
  );
  assert('and-the-read-source-is-printed-so-a-log-shows-where-the-number-came-from', text18971.includes('read from: GET /repos/objectstack-ai/objectstack/pulls/18971'));
  // A governed path AND oversized: both limbs print, one exit — the governed
  // code, already the top of the table.
  const bothRows = [row(9527, ['AGENTS.md', 'packages/x.ts'])];
  const gBoth = await runGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: bothRows, fetchReviews: async () => [], fetchPull: async () => pull(HEAD, { size: sizePair(LINE, 1) }), fetchComments: async () => [] });
  const sBoth = await runSizeGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: bothRows, fetchPull: async () => pull(HEAD, { size: sizePair(LINE, 1) }) });
  assert(
    '⭐ governed-AND-oversized-prints-BOTH-limbs-and-exits-on-the-GOVERNED-code',
    gBoth.exitCode === EXIT_REFUSED_UNAPPROVED && sBoth.exitCode === EXIT_REFUSED_OVERSIZED &&
      groupExitCode({ governed: gBoth, size: sBoth }) === EXIT_REFUSED_UNAPPROVED &&
      /REFUSED/.test(renderGuardVerdict(gBoth)) && /REFUSED/.test(renderSizeVerdict(sBoth)),
    JSON.stringify([gBoth.exitCode, sBoth.exitCode]),
  );
  const gApprovedBig = await runGuard({
    repo: REPO,
    event: EVENT_MERGE_GROUP,
    rows: bothRows,
    fetchReviews: async () => [approvedAt(GOVERNED_APPROVERS[0], HEAD)],
    fetchPull: async () => pull(HEAD, { size: sizePair(LINE, 1) }),
    fetchComments: async () => [],
  });
  // ⭐ 2026-09-27 (#20153): the SAME approval verdict the governed leg derived
  // is handed to the size leg, which reads it — no second review read (the spy
  // throws) — and the group exits 0 on both limbs.
  let sizeReviewReadsReused = 0;
  const sApprovedBig = await runSizeGuard({
    repo: REPO,
    event: EVENT_MERGE_GROUP,
    rows: bothRows,
    fetchPull: async () => pull(HEAD, { size: sizePair(LINE, 1) }),
    fetchReviews: async () => {
      sizeReviewReadsReused += 1;
      throw new Error('the size leg must REUSE the governed leg\'s verdict, never re-read');
    },
    approvals: new Map(gApprovedBig.entries.map((e) => [e.pr, e.approval])),
  });
  assert(
    '⭐ an-authorized-APPROVAL-clears-the-path-limb-AND-lifts-the-size-limb-off-the-SAME-verdict-object-zero-extra-reads-the-group-exits-0',
    gApprovedBig.conclusion === 'cleared' && sApprovedBig.exitCode === EXIT_CLEAR && sApprovedBig.conclusion === 'clear' &&
      sApprovedBig.entries[0].state === 'lifted' && sApprovedBig.entries[0].approval === gApprovedBig.entries[0].approval && sizeReviewReadsReused === 0 &&
      sApprovedBig.apiCalls === 1 && groupExitCode({ governed: gApprovedBig, size: sApprovedBig }) === EXIT_CLEAR,
    JSON.stringify({ size: sApprovedBig.exitCode, state: sApprovedBig.entries[0].state, reads: sizeReviewReadsReused }),
  );
  // The register's lift lifts a PATH, never the number: rows whose every path
  // the register lifted still pay the size — and with no approval, still refuse.
  const liftedAll = await runSizeGuard({
    repo: REPO,
    event: EVENT_MERGE_GROUP,
    rows: [{ sha: 'f'.repeat(40), subject: 'x (#77)', pr: 77, paths: [] }],
    fetchPull: async () => pull(HEAD, { size: sizePair(237706, 0) }),
    fetchReviews: async () => [],
  });
  assert('⭐ a-certified-pure-regeneration-lifts-the-PATH-and-lifts-NOTHING-from-the-size-at-the-queue-either', liftedAll.exitCode === EXIT_REFUSED_OVERSIZED);
  // ── the SIZE limb's LIFT (maintainer ruling 2026-09-27, #20153) — the card's acceptance, in its order ──
  const bigUngoverned = (pr = 20125) => [{ sha: 'c'.repeat(40), subject: `feat!: retire the saved-report stack (#${pr})`, pr, paths: ['packages/x.ts', 'packages/y.ts'] }];
  const PR20125_SHA = 'e4ead748' + '1'.repeat(32);
  const liftRun = (reviews, { size = sizePair(10764, 999, 'GET /repos/objectstack-ai/objectstack/pulls/20125'), sha = PR20125_SHA } = {}) =>
    runSizeGuard({
      repo: REPO,
      event: EVENT_MERGE_GROUP,
      rows: bigUngoverned(),
      fetchPull: async () => pull(sha, { size }),
      fetchReviews: typeof reviews === 'function' ? reviews : async () => reviews,
    });
  const liftOnHead = await liftRun([approvedAt('os-zhuang', PR20125_SHA)]);
  const liftOnOlder = await liftRun([approvedAt('os-zhuang', OLD)]);
  assert(
    '⭐ #20125-replay-an-authorized-APPROVED-review-on-ANY-commit-LIFTS-the-size-limb-exit-0-two-reads',
    liftOnHead.exitCode === EXIT_CLEAR && liftOnHead.entries[0].state === 'lifted' && liftOnHead.entries[0].verdict.size.exceeds === true &&
      liftOnOlder.exitCode === EXIT_CLEAR && liftOnOlder.entries[0].state === 'lifted' && liftOnHead.apiCalls === 2,
    JSON.stringify({ head: liftOnHead.exitCode, older: liftOnOlder.exitCode, calls: liftOnHead.apiCalls }),
  );
  const liftWords = renderSizeVerdict(liftOnHead);
  assert(
    'and-the-SIZE-block-prints-the-lift-the-approver-the-commit-and-this-card-with-the-ruling-verbatim',
    liftWords.includes('#20125') && liftWords.includes('11763 changed line(s) (+10764 / -999)') && liftWords.includes('LIFTED by an authorized') &&
      liftWords.includes('os-zhuang (on e4ead7481111)') && liftWords.includes('objectstack#20153') && liftWords.includes('2026-09-27') &&
      liftWords.includes('所以阈值写死成 5000 行 , 维护者已经批准了就是可以合并。') && liftWords.includes('OWNING seat lands it through the queue') &&
      /CLEAR/.test(liftWords) && !/REFUSED/.test(liftWords) && liftWords.includes('read from: GET /repos/objectstack-ai/objectstack/pulls/20125'),
    liftWords,
  );
  assert(
    'and-an-approval-on-an-older-commit-prints-THAT-commit-not-the-head',
    renderSizeVerdict(liftOnOlder).includes(`os-zhuang (on ${OLD.slice(0, 12)})`),
    renderSizeVerdict(liftOnOlder),
  );
  const noApproval = await liftRun([]);
  const unauthorized = await liftRun([approvedAt('not-authorized', PR20125_SHA)]);
  const dismissed = await liftRun([approvedAt('os-zhuang', PR20125_SHA), { state: 'DISMISSED', user: { login: 'os-zhuang' }, commit_id: PR20125_SHA }]);
  const superseded = await liftRun([approvedAt('os-zhuang', OLD), { state: 'CHANGES_REQUESTED', user: { login: 'os-zhuang' }, commit_id: PR20125_SHA }]);
  assert(
    '⛔ no-approval-an-UNAUTHORIZED-one-a-DISMISSED-one-and-a-SUPERSEDED-one-each-still-REFUSE-on-exit-8-as-today',
    [noApproval, unauthorized, dismissed, superseded].every((v) => v.exitCode === EXIT_REFUSED_OVERSIZED && v.refusalKind === 'oversized' && v.entries[0].state === 'oversized'),
    JSON.stringify([noApproval, unauthorized, dismissed, superseded].map((v) => v.exitCode)),
  );
  assert(
    'and-each-refusal-names-WHY-nothing-lifted-it',
    /no authorized APPROVED review on record \(0 review\(s\) read/.test(renderSizeVerdict(noApproval)) &&
      /outside GOVERNED_APPROVERS: not-authorized — never counts/.test(renderSizeVerdict(unauthorized)) &&
      /no authorized APPROVED review on record \(2 review\(s\) read/.test(renderSizeVerdict(dismissed)) &&
      /dismissed and superseded approvals never count/.test(renderSizeVerdict(superseded)),
    renderSizeVerdict(unauthorized),
  );
  const reviewsThrow = await liftRun(async () => {
    throw new Error('GET /repos/o/r/pulls/20125/reviews answered HTTP 403');
  });
  assert(
    '⛔ an-UNREADABLE-review-list-on-an-oversized-PR-fails-CLOSED-on-exit-8-never-9-and-never-passes-the-words-saying-so',
    reviewsThrow.exitCode === EXIT_REFUSED_OVERSIZED && reviewsThrow.entries[0].approval.state === 'unreadable' &&
      /review list could NOT be read \(GET \/repos\/o\/r\/pulls\/20125\/reviews answered HTTP 403\) — fail closed, no lift/.test(renderSizeVerdict(reviewsThrow)),
    renderSizeVerdict(reviewsThrow),
  );
  const noReader = await runSizeGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: bigUngoverned(), fetchPull: async () => pull(PR20125_SHA, { size: sizePair(LINE, 1) }) });
  assert(
    '⛔ a-size-leg-run-with-NO-review-reader-at-all-fails-CLOSED-on-8-too',
    noReader.exitCode === EXIT_REFUSED_OVERSIZED && /no review reader was supplied/.test(renderSizeVerdict(noReader)),
  );
  let sizeReviewReads = 0;
  const reviewSpy = async () => {
    sizeReviewReads += 1;
    throw new Error('the size leg must not read reviews for this pull request');
  };
  const underNoRead = await liftRun(reviewSpy, { size: sizePair(LINE, 0) });
  const unreadableSizeNoRead = await liftRun(reviewSpy, { size: null });
  assert(
    '⭐ reviews-are-read-ONLY-over-the-line-a-within-PR-makes-none-and-an-UNREADABLE-size-is-still-exit-9-with-none',
    sizeReviewReads === 0 && underNoRead.exitCode === EXIT_CLEAR && underNoRead.apiCalls === 1 &&
      unreadableSizeNoRead.exitCode === EXIT_REFUSED_SIZE_UNREADABLE && unreadableSizeNoRead.refusalKind === 'unreadable',
    JSON.stringify({ reads: sizeReviewReads, under: underNoRead.exitCode, unreadable: unreadableSizeNoRead.exitCode }),
  );
  // End to end, the card's acceptance: an oversized UNGOVERNED group with the
  // approval on record — the governed leg clear at zero reads, the size leg
  // lifted, the group exits 0; the same group with no approval exits 8.
  const g20125 = await runGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: bigUngoverned(), fetchReviews: explodeForSize, fetchPull: explodeForSize, fetchComments: explodeForSize });
  assert(
    '⭐ #20125-end-to-end-governed-CLEAR-at-zero-reads-size-LIFTED-group-exits-0-and-with-no-approval-8',
    g20125.conclusion === 'clear' && g20125.apiCalls === 0 && groupExitCode({ governed: g20125, size: liftOnHead }) === EXIT_CLEAR &&
      groupExitCode({ governed: g20125, size: noApproval }) === EXIT_REFUSED_OVERSIZED,
  );
  assert(
    '⭐ sizeReading-has-FOUR-states-and-lifted-is-over-the-line-never-within',
    sizeReading(1, sizePair(LINE, 1), REPO, authorizedApprovalVerdict([approvedAt('os-zhuang', HEAD)], HEAD)).state === 'lifted' &&
      sizeReading(1, sizePair(LINE, 0), REPO, authorizedApprovalVerdict([approvedAt('os-zhuang', HEAD)], HEAD)).state === 'within' &&
      sizeReading(1, sizePair(LINE, 1), REPO, authorizedApprovalVerdict([], HEAD)).state === 'oversized' &&
      sizeReading(1, null, REPO, authorizedApprovalVerdict([approvedAt('os-zhuang', HEAD)], HEAD)).state === 'unreadable',
  );
  assert(
    '⭐ the-authorized-verdict-carries-approvals-login-and-commit-the-generic-one-does-NOT-so-only-the-verdict-that-asked-WHO-can-lift',
    JSON.stringify(authorizedApprovalVerdict([approvedAt('os-zhuang', OLD), approvedAt('not-authorized', HEAD)], HEAD).approvals) === JSON.stringify([{ login: 'os-zhuang', commitId: OLD }]) &&
      !('approvals' in approvalVerdict([approvedAt('os-zhuang', HEAD)])) &&
      sizeReading(1, sizePair(LINE, 1), REPO, approvalVerdict([approvedAt('os-zhuang', HEAD)])).state === 'oversized',
  );
  // The exit precedence, the whole table: a group naming NO pull request
  // answers on 9 — both blocks still print their own refusal, and the code is
  // pinned here.
  const exitOf = (n) => ({ exitCode: n });
  assert(
    '⭐ groupExitCode-precedence-governed-THEN-size-pinned-on-every-combination',
    groupExitCode({ governed: exitOf(0), size: exitOf(0) }) === EXIT_CLEAR &&
      groupExitCode({ governed: exitOf(0), size: exitOf(EXIT_REFUSED_OVERSIZED) }) === EXIT_REFUSED_OVERSIZED &&
      groupExitCode({ governed: exitOf(EXIT_REFUSED_UNAPPROVED), size: exitOf(EXIT_REFUSED_OVERSIZED) }) === EXIT_REFUSED_UNAPPROVED &&
      groupExitCode({ governed: exitOf(EXIT_REFUSED_UNREADABLE), size: exitOf(0) }) === EXIT_REFUSED_UNREADABLE &&
      groupExitCode({ governed: exitOf(0), size: exitOf(EXIT_REFUSED_SIZE_UNREADABLE) }) === EXIT_REFUSED_SIZE_UNREADABLE,
  );
  // The words on the clear path: the numbers are printed, so a log shows what a
  // landing was judged on.
  const clearWords = renderSizeVerdict(atOne);
  assert(
    'the-CLEAR-prints-the-number-read-and-the-threshold-and-names-the-sibling-as-the-source-of-both',
    clearWords.includes(`${LINE} changed line(s) (+${LINE} / -0)`) && clearWords.includes('at or under') && clearWords.includes('check-governed-merges.mjs'),
    clearWords,
  );
  assert(
    'the-unreadable-refusal-says-the-size-DECIDES-unlike-the-head-and-separates-exit-8-from-9',
    /DECIDES here/.test(renderSizeVerdict(unreadOne)) && /exit 8 vs 9/.test(renderSizeVerdict(unreadOne)),
  );
  // ⛔ IMPORTED, NEVER RESTATED — pinned against this file's own source.
  let sizeOwnSource = '';
  try {
    sizeOwnSource = readFileSync(join(repoRoot, 'scripts', 'pm', 'check-governed-queue-guard.mjs'), 'utf8');
  } catch {
    /* asserted below */
  }
  assert('⛔ this-file-declares-NO-threshold-of-its-own', sizeOwnSource !== '' && !/HUMAN_MERGE_LINE_THRESHOLD\s*=/.test(sizeOwnSource));
  assert(
    '⛔ and-spells-NO-size-comparison-the-limb-is-reached-through-testVerdict-and-landsByHumanMerge',
    !/(changedLines|additions\s*\+\s*deletions)\s*>=?\s*/.test(sizeOwnSource) && /testVerdict\(\[\], \{ repo, size, approval \}\)/.test(sizeOwnSource) && /landsByHumanMerge\(verdict\)/.test(sizeOwnSource),
  );
  assert(
    '⛔ and-spells-NO-lift-condition-of-its-own-the-lift-is-the-siblings-sizeLiftFrom-read-through-landsByHumanMerge',
    !/\.lifted\s*(===|!==|==|!=|&&|\|\|)/.test(sizeOwnSource) && !/sizeLiftFrom\(/.test(sizeOwnSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')) &&
      // Spelled apart so this pin's own line cannot satisfy it.
      !new RegExp(['function size', 'LiftFrom|function size', 'LimbFires'].join('')).test(sizeOwnSource),
  );
  // The scoped merge_group clear now names the size read; the pull_request one
  // is pinned byte-identical above.
  assert('the-merge_group-zero-cost-clear-names-the-SIZE-read-it-no-longer-avoids', clearMg.includes('for its SIZE') && clearMg.includes('An outage there DOES refuse this merge group.'), clearMg);
  // The workflow: the pull object is already under `pull-requests: read`, so
  // this leg widened NO scope — and the file is human-merge, untouched.
  try {
    const wfForSize = readFileSync(join(repoRoot, '.github', 'workflows', CHECK_WORKFLOW), 'utf8');
    assert(
      'the-size-leg-needs-NO-new-workflow-scope-the-pull-object-is-under-pull-requests-read-already',
      /permissions:\n  contents: read\n  pull-requests: read\n/.test(wfForSize) && !/^\s+issues:\s*(read|write)/m.test(wfForSize),
    );
  } catch (error) {
    assert('the-workflow-is-readable-for-the-size-scope-pin', false, String(error?.message ?? error).split('\n')[0]);
  }

  // ── ⭐ #19344: the remedy names a path the RULESET actually offers ────────
  //
  // RECORDED, not live: this self-test is the required guard job's FIRST step,
  // declared offline, and a live read answers `unreadable` from every token CI
  // can hold — a network dependency asserting nothing. ⛔ And a pinned phrase
  // split across two wrapped array entries can never match: keep it on ONE.
  battery('⭐ #19344: the remedy names a path the ruleset actually offers');
  // GET /repos/objectstack-ai/objectstack/rulesets/12119582, read 2026-09-20 by
  // an ordinary seat token: HTTP 200, and NO `bypass_actors` key at all.
  const RULESET_19344 = Object.freeze({ id: 12119582, name: 'main', enforcement: 'active', current_user_can_bypass: 'never' });
  const judgeRemedy = (remedy, over = {}) => remedyPathVerdict({ remedy, ruleset: { ...RULESET_19344, ...over } });
  const sizeRemedy = renderSizeVerdict(overOne);
  const recorded = judgeRemedy(sizeRemedy);
  console.log(`  ℹ #19344 ruleset reading — ${recorded.detail}`);
  assert('⭐ all-four-remedies-NAME-the-bypass-rules-option-and-keep-人工直合-as-the-name-of-the-act', recorded.names && judgeRemedy(refusalText).names && judgeRemedy(warnText).names && sizeRemedy.includes('人工直合') && /BYPASS-RULES option/.test(sizeOwnSource), sizeRemedy);
  assert('⛔ a-field-this-token-cannot-see-is-UNREADABLE-and-PASSES-asserting-no-path-it-did-not-read', recorded.reading === 'unreadable' && recorded.ok === true && /unreadable with this token/.test(recorded.detail), recorded.detail);
  assert('⛔ bypass_actors-PRESENT-and-EMPTY-REDS-the-remedy-names-a-path-the-ruleset-does-not-offer', judgeRemedy(sizeRemedy, { bypass_actors: [] }).ok === false && judgeRemedy(sizeRemedy, { bypass_actors: null }).reading === 'not-offered');
  assert('⭐ one-configured-bypass-actor-makes-the-named-path-REACHABLE-and-the-pin-clears', judgeRemedy(sizeRemedy, { bypass_actors: [{ actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }] }).ok === true);
  assert('⛔ and-a-remedy-drifting-back-to-a-bare-maintainer-click-REDS-even-where-the-path-IS-offered', judgeRemedy("the maintainer's own click lands it (人工直合).", { bypass_actors: [{ actor_id: 5 }] }).ok === false);

  // ── the queued pull-back: the landing seat sends the relay dequeue, never a DRAFT conversion ─────
  //
  // Both refusals print on the merge_group leg, so the pull request they name
  // IS in the queue. A DRAFT conversion and an auto-merge disable do not take
  // a queued pull request out of it
  // (`.claude/skills/pm-dispatch/references/readings-queue.md`, queue
  // membership), so the remedy is AGENTS.md Prime Directive #14's pull-back:
  // the landing seat's relay `pr_dequeue` at once (measured live, comment
  // 6902190812) or, from any other seat or on a stroke that does not land, the
  // maintainer's manual removal at once; the disarm so it does not re-enter;
  // and a confirmation from the remote. A remedy that tells a seat
  // the draft conversion dequeues sends it away believing the PR is parked
  // while the queue can still merge it.
  //
  // The texts are read FLATTENED: a phrase wrapped across two array entries
  // is still one phrase to the reader, so it is one phrase to the pin.
  battery('⛔ the queued pull-back: the landing seat sends the relay dequeue, never a DRAFT conversion');
  const flatText = (t) => t.replace(/\s+/g, ' ');
  const QUEUED_PULL_BACK = Object.freeze([
    /disabling auto-merge and converting it to DRAFT do not take it out of the queue/,
    /its landing seat sends the relay's `pr_dequeue` AT ONCE \(measured live, comment 6902190812\)/,
    /any other seat, or a stroke that does not land, asks the maintainer AT ONCE to remove it by hand/,
    /Disable auto-merge AND convert it back to DRAFT, which disarms it/,
    /confirm from the remote that it is in neither the queue nor `origin\/main`/,
    /AGENTS\.md Prime Directive #14/,
    /readings-queue\.md`, queue membership/,
  ]);
  // Every spelling a remedy or a rule has used to say that a DRAFT conversion
  // takes a queued pull request out of the queue, plus the general shape: a
  // draft followed, inside one clause, by an affirmative dequeue verb.
  const DRAFT_DEQUEUE_CLAIMS = Object.freeze([
    /out of the queue: convert it back to DRAFT/i,
    /auto-merge alone does NOT dequeue/i,
    /draft is what removes/i,
    /\bdraft\b[^.;]{0,80}\b(?:dequeues|removes (?:it from the (?:merge )?queue|queue membership)|takes it out of the queue)\b/i,
  ]);
  const missingPullBack = (t) => QUEUED_PULL_BACK.filter((re) => !re.test(flatText(t))).map(String);
  const draftDequeueClaims = (t) => DRAFT_DEQUEUE_CLAIMS.filter((re) => re.test(flatText(t))).map(String);
  const governedRefusals = [refusedV, unreadableV, unattrV].map((v) => renderGuardVerdict(v));
  const sizeRefusals = [overOne, unreadOne, sizeNoPull].map((v) => renderSizeVerdict(v));
  assert(
    '⭐ every-governed-refusal-kind-sends-the-queued-PR-to-the-LANDING-SEATS-relay-dequeue-or-the-MAINTAINERS-manual-removal-disarms-it-and-confirms-from-the-remote',
    governedRefusals.every((t) => /REFUSED/.test(t) && missingPullBack(t).length === 0),
    JSON.stringify(governedRefusals.map(missingPullBack)),
  );
  assert(
    '⭐ every-size-refusal-kind-carries-the-SAME-pull-back',
    sizeRefusals.every((t) => /REFUSED/.test(t) && missingPullBack(t).length === 0),
    JSON.stringify(sizeRefusals.map(missingPullBack)),
  );
  // The control that keeps the negative pin below able to fail: each spelling
  // the detector lists fires on a fixture, and each fixture is caught. A
  // detector that matches nothing would hold the pin green forever.
  const DRAFT_DEQUEUE_FIXTURES = Object.freeze([
    'take the pull request out of the queue: convert it back to\n           DRAFT (disarming auto-merge alone does NOT dequeue it) and park it there.',
    'Convert it back to draft AND disable auto-merge — draft is what removes queue membership, disabling alone drops only the arming.',
    'converting the PR back to draft is what removes it from the merge queue.',
    'convert it back to DRAFT, which dequeues it.',
  ]);
  assert(
    '⛔ the-detector-FIRES-on-every-fixture-and-every-listed-spelling-fires-on-some-fixture',
    DRAFT_DEQUEUE_FIXTURES.every((t) => draftDequeueClaims(t).length > 0) &&
      DRAFT_DEQUEUE_CLAIMS.every((re) => DRAFT_DEQUEUE_FIXTURES.some((t) => re.test(flatText(t)))),
    JSON.stringify(DRAFT_DEQUEUE_FIXTURES.map(draftDequeueClaims)),
  );
  assert(
    '⛔ NO-rendering-claims-a-DRAFT-conversion-dequeues-a-queued-PR',
    [...governedRefusals, ...sizeRefusals, warnText].every((t) => draftDequeueClaims(t).length === 0),
    JSON.stringify([...governedRefusals, ...sizeRefusals, warnText].map(draftDequeueClaims)),
  );

  // ── the WIRING pin: the workflow still spells this context name ──────────
  //
  // Without this, renaming the job detaches the required context silently —
  // #6865's whole defect — and the name declared here becomes a name nothing
  // publishes. Read from disk on purpose: a constant asserting against itself
  // proves nothing.
  battery('the WIRING pin: the workflow still spells this context name');
  try {
    const wf = readFileSync(join(repoRoot, '.github', 'workflows', CHECK_WORKFLOW), 'utf8');
    assert('the-workflow-exists-and-declares-the-job-id-this-file-names', wf.includes(`\n  ${CHECK_JOB_ID}:\n`), CHECK_JOB_ID);
    assert('the-workflow-publishes-EXACTLY-the-context-name-branch-protection-would-pin', wf.includes(`name: ${CHECK_CONTEXT_NAME}\n`), CHECK_CONTEXT_NAME);
    assert('the-workflow-triggers-on-merge_group-the-leg-that-actually-refuses', /^\s{2}merge_group:\s*$/m.test(wf), 'merge_group trigger absent');
    assert('the-workflow-triggers-on-pull_request-the-early-warning-leg', /^\s{2}pull_request:\s*$/m.test(wf), 'pull_request trigger absent');
    assert('the-workflow-invokes-THIS-script', wf.includes('scripts/pm/check-governed-queue-guard.mjs'), 'invocation absent');
    assert('the-workflow-checks-out-full-history-a-truncated-diff-answers-with-silence', /fetch-depth:\s*0/.test(wf), 'fetch-depth: 0 absent');
    assert('the-workflow-declares-pull-requests-read-the-only-scope-the-review-read-needs', /pull-requests:\s*read/.test(wf), 'pull-requests: read absent');
    assert('the-workflow-carries-no-paths-filter-a-skipped-guard-counts-as-SUCCESS', !/^\s*paths(-ignore)?:/m.test(wf), 'a paths filter would make this guard skippable');

    // ── ⭐ #14063: the environment the exemption needs, pinned to the YAML ───
    //
    // The end-to-end cases above prove what a CERTIFIED recompute decides; this
    // block is the other half — that a certified recompute is reachable in the
    // job at all. Without the install, `runSinkGenerator` cannot spawn the
    // generator and every #11705 row fails closed, which is precisely the state
    // the 2026-09-01 ruling ended. A green self-test over a workflow that had
    // silently lost its install would be the loudest possible false negative.
  battery('⭐ #14063: the environment the exemption needs, pinned to the YAML');
    const audit = installStepAudit(wf);
    assert('the-job-installs-the-workspace-dependencies-the-recompute-runs-on', audit.installIndex !== -1 && /--frozen-lockfile/.test(audit.installCommand), audit.installCommand || '(no pnpm install step)');
    assert('the-job-acquires-pnpm-through-the-shared-composite-not-a-second-spelling', audit.acquiresPnpm, JSON.stringify(audit.steps));
    assert(
      'the-toolchain-is-in-place-BEFORE-the-live-judgment-and-after-the-self-test',
      audit.selfTestIndex !== -1 && audit.judgmentIndex !== -1 && audit.selfTestIndex < audit.installIndex && audit.installIndex < audit.judgmentIndex,
      JSON.stringify({ selfTest: audit.selfTestIndex, install: audit.installIndex, judgment: audit.judgmentIndex }),
    );
    // The install must not restate the register. A `--filter` list here would
    // be a second copy of `verify.pkg`, and it would go stale in the direction
    // that reads as compliance: a new row's generator simply fails to spawn,
    // the path stays governed, and nothing says the install was the reason.
    for (const entry of GENERATED_SURFACE_EXCEPTIONS.filter((e) => e.verify?.pkg)) {
      assert(
        `the-install-covers-the-register-row-without-restating-it: ${entry.id}`,
        audit.installFilters.length === 0 || audit.installFilters.includes(entry.verify.pkg),
        `install filters ${JSON.stringify(audit.installFilters)} do not cover ${entry.verify.pkg}`,
      );
    }
    // Every toolchain step degrades instead of reddening — otherwise a registry
    // or cache outage would newly block merge groups that touch nothing
    // governed, which is the promise the ordering guarantee above exists to
    // keep. The non-emptiness assertion is what stops this passing vacuously if
    // the steps are ever reordered out of the measured window.
    assert('the-toolchain-block-is-non-empty-so-the-degradation-pin-below-is-not-vacuous', audit.toolchainSteps.length >= 2 && audit.toolchainSteps.length === new Set(audit.toolchainSteps).size, JSON.stringify(audit.toolchainSteps));
    assert(
      'every-toolchain-step-DEGRADES-instead-of-reddening-a-clear-diff-is-never-blocked-by-an-outage',
      audit.toolchainWithoutContinueOnError.length === 0,
      `missing continue-on-error: ${audit.toolchainWithoutContinueOnError.join(', ')}`,
    );
  } catch (error) {
    assert('the-workflow-file-is-readable', false, String(error?.message ?? error).split('\n')[0]);
  }

  // ── ⭐ the cheap early-warning leg: commits and trees, toolchain on demand ─
  //
  // The `pull_request` leg re-fires on `ready_for_review`, which is the moment
  // an approver taps merge, and a required context `in_progress` refuses that
  // merge for the run's whole wall. So that leg checks out without blobs and
  // installs only when the lift would recompute. Two halves are pinned: the
  // ONE predicate the install gate and the lift share, and the YAML that wires
  // it — a gate spelled `== 'true'` would skip the install whenever the
  // question failed, and a queue-leg checkout that lost its tree would starve
  // the refusing leg's recompute.
  battery('⭐ the cheap early-warning leg: commits and trees, toolchain on demand');
  {
    const SAMPLES = ['skills/objectstack-ui/references/_index.md', 'skills/objectstack-ui/references/react-blocks.md'];
    assert(
      'the-samples-cover-every-register-row-so-a-new-row-without-one-reds-here',
      GENERATED_SURFACE_EXCEPTIONS.every((e) => SAMPLES.some((p) => generatedExceptionFor(p) === e)),
      JSON.stringify(GENERATED_SURFACE_EXCEPTIONS.map((e) => e.id)),
    );
    for (const p of SAMPLES) {
      assert(`a-register-path-needs-the-toolchain: ${p}`, toolchainNeededFor([row(1, ['AGENTS.md', p])]) === true);
    }
    assert('no-rows-need-no-toolchain', toolchainNeededFor([]) === false && toolchainNeededFor(undefined) === false);
    assert(
      'a-governed-diff-with-no-register-path-needs-no-toolchain',
      toolchainNeededFor([row(1, ['.github/workflows/governed-surface-guard.yml', 'AGENTS.md', 'skills/objectstack-ui/SKILL.md'])]) === false,
    );
    assert('a-register-path-in-a-LATER-row-still-needs-it', toolchainNeededFor([row(1, ['AGENTS.md']), row(2, [SAMPLES[0]])]) === true);
    // The lift consults the recompute on exactly the diffs the gate installs
    // for — measured with a spy, not read off the source.
    let recomputeCalls = 0;
    const countingRecompute = async (_root, hits) => {
      recomputeCalls += 1;
      return new Map([...hits.values()].flat().map((p) => [p, { pureRegeneration: false, reason: 'spy' }]));
    };
    await liftGeneratedExceptions('/w', 'base', [row(1, ['AGENTS.md'])], [], countingRecompute, REPO);
    assert('⭐ the-lift-skips-the-recompute-exactly-where-the-gate-skips-the-install', recomputeCalls === 0, `${recomputeCalls} call(s)`);
    await liftGeneratedExceptions('/w', 'base', [row(1, ['AGENTS.md', SAMPLES[0]])], [], countingRecompute, REPO);
    assert('⭐ and-runs-it-exactly-where-the-gate-installs', recomputeCalls === 1, `${recomputeCalls} call(s)`);

    const clearRead = { ok: true, rows: [row(1, ['AGENTS.md'])] };
    assert('the-queue-leg-always-installs', toolchainNeededAnswer({ eventName: EVENT_MERGE_GROUP, read: clearRead }).needed === true);
    assert('an-unknown-event-installs', toolchainNeededAnswer({ eventName: undefined, read: clearRead }).needed === true);
    const unread = toolchainNeededAnswer({ eventName: EVENT_PULL_REQUEST, read: { ok: false, message: '⛔ x: could not read the diff (boom).\n   more' } });
    assert('an-unreadable-diff-KEEPS-the-install-and-says-why', unread.needed === true && /could not be read/.test(unread.why) && !unread.why.includes('\n'), unread.why);
    assert('a-read-diff-with-no-register-path-skips-it', toolchainNeededAnswer({ eventName: EVENT_PULL_REQUEST, read: clearRead }).needed === false);
    const hit = toolchainNeededAnswer({ eventName: EVENT_PULL_REQUEST, read: { ok: true, rows: [row(1, ['AGENTS.md', SAMPLES[1]])] } });
    assert('a-read-diff-with-a-register-path-installs-and-names-it', hit.needed === true && hit.why.includes(SAMPLES[1]), hit.why);

    let wf = '';
    try {
      wf = readFileSync(join(repoRoot, '.github', 'workflows', CHECK_WORKFLOW), 'utf8');
    } catch (error) {
      assert('the-workflow-file-is-readable-for-the-cheap-leg-pins', false, String(error?.message ?? error).split('\n')[0]);
    }
    const { stepBodies } = installStepAudit(wf);
    const checkouts = stepBodies.filter((s) => /^\s*uses:\s*actions\/checkout@/m.test(s.body));
    assert('exactly-two-checkout-steps-one-per-leg', checkouts.length === 2, JSON.stringify(checkouts.map((s) => s.name)));
    const queueCheckout = checkouts.find((s) => /^\s*if:\s*github\.event_name != 'pull_request'\s*$/m.test(s.body));
    const prCheckout = checkouts.find((s) => /^\s*if:\s*github\.event_name == 'pull_request'\s*$/m.test(s.body));
    assert(
      'the-queue-leg-checkout-is-the-full-tree-at-full-history-unchanged',
      queueCheckout !== undefined && /^\s*fetch-depth:\s*0\s*$/m.test(queueCheckout.body) && !/^\s*(filter|sparse-checkout):/m.test(queueCheckout.body),
      queueCheckout?.body ?? '(no queue-leg checkout)',
    );
    assert(
      'the-pull_request-leg-checkout-is-full-history-blobless-and-sparse-on-scripts-and-.github',
      prCheckout !== undefined &&
        /^\s*fetch-depth:\s*0\s*$/m.test(prCheckout.body) &&
        /^\s*filter:\s*blob:none\s*$/m.test(prCheckout.body) &&
        /sparse-checkout:\s*\|\n\s+scripts\n\s+\.github\s*$/m.test(prCheckout.body),
      prCheckout?.body ?? '(no pull_request-leg checkout)',
    );
    const question = stepBodies.find((s) => /--toolchain-needed\b/.test(s.body));
    assert(
      'the-toolchain-question-runs-on-the-pull_request-leg-only-and-feeds-GITHUB_OUTPUT',
      question !== undefined &&
        /^\s*id:\s*toolchain\s*$/m.test(question.body) &&
        /^\s*if:\s*github\.event_name == 'pull_request'\s*$/m.test(question.body) &&
        /run: node scripts\/pm\/check-governed-queue-guard\.mjs --toolchain-needed >> "\$GITHUB_OUTPUT"\s*$/m.test(question.body),
      question?.body ?? '(no toolchain question step)',
    );
    const gate = "steps.toolchain.outputs.needed != 'false'";
    const installChain = stepBodies.filter((s) => /setup-pnpm|pnpm store path|actions\/cache(?:\/restore)?@|pnpm install\b/.test(s.body));
    assert(
      '⭐ every-install-step-is-gated-on-NOT-FALSE-so-a-skipped-or-failed-question-installs',
      installChain.length === 4 && installChain.every((s) => s.body.includes(`if: ${gate}`)) && !/outputs\.needed == 'true'/.test(wf),
      JSON.stringify(installChain.map((s) => s.name)),
    );
    const restore = stepBodies.find((s) => /^\s*run:\s*git sparse-checkout disable\s*$/m.test(s.body));
    assert(
      'the-full-tree-is-restored-before-the-install-on-the-pull_request-leg-whenever-it-installs',
      restore !== undefined &&
        restore.body.includes(`if: github.event_name == 'pull_request' && ${gate}`) &&
        stepBodies.indexOf(restore) < stepBodies.indexOf(installChain[0] ?? restore),
      restore?.body ?? '(no restore step)',
    );
    const judgment = stepBodies.find((s) => /run: node scripts\/pm\/check-governed-queue-guard\.mjs\s*$/m.test(s.body));
    assert('the-live-judgment-runs-on-both-legs-unconditionally', judgment !== undefined && !/^\s*if:/m.test(judgment.body), judgment?.body ?? '(no judgment step)');
  }


  // ── ⭐ #18020: the references tier ───────────────────────────────────────
  //
  // Both directions on every limb, each with its LIT CONTROL: the fixture that
  // passes and the same fixture one fact away from passing. The recognisers are
  // the REAL ones, loaded through the real lazy import, because a battery run
  // against hand-made stubs would keep passing the day an upstream rename broke
  // the live leg — which is the entire failure mode importing them avoids.
  battery('⭐ #18020 → #19133 Tier S: a review of record, not an approval');
  // The fact layer that WAS the whole tier under #18020, and the siblings the
  // 2026-09-18 ruling moved in beside it — skills, agents, hooks, settings.
  const REF_A = '.claude/skills/pm-dispatch/references/platform-readings.md';
  const REF_B = '.claude/skills/pm-dispatch/references/lanes/skills.md';
  const SKILL_PATH = '.claude/skills/pm-dispatch/SKILL.md';
  const AGENT_PATH = '.claude/agents/os-dev.md';
  const HOOK_PATH = '.claude/hooks/guard-main-checkout.sh';
  const SETTINGS_PATH = '.claude/settings.json';
  // ⛔ The law. One of these in the diff and the whole entry is Tier H.
  const RULES_PATH = 'AGENTS.md';
  const TIER_H_PATHS = ['AGENTS.md', 'CLAUDE.md', 'docs/adr/0001-x.md', 'docs/NORTH-STAR.md', 'skills/objectstack-ui/SKILL.md'];

  assert('a-Tier-S-only-path-set-is-Tier-S-on-a-declared-and-verified-reading-and-Tier-H-on-its-path-list-alone', governedTierFor([REF_A, REF_B, SKILL_PATH, AGENT_PATH], REPO, GOVERNED_SURFACES, null, VERIFIED) === TIER_S && governedTierFor([REF_A, REF_B, SKILL_PATH, AGENT_PATH], REPO) === TIER_H);
  assert('⛔ a-hook-or-the-settings-file-in-the-set-is-Tier-H-by-path-on-that-same-reading', [HOOK_PATH, SETTINGS_PATH].every((p) => governedTierFor([REF_A, p], REPO, GOVERNED_SURFACES, null, VERIFIED) === TIER_H && governedTierFor([p], REPO, GOVERNED_SURFACES, null, VERIFIED) === TIER_H));
  assert('⛔ the-old-references-boundary-is-GONE-SKILL-md-and-a-references-draft-sibling-are-Tier-S-alike', governedTierFor([SKILL_PATH], REPO, GOVERNED_SURFACES, null, VERIFIED) === TIER_S && governedTierFor(['.claude/skills/pm-dispatch/references-draft/x.md'], REPO, GOVERNED_SURFACES, null, VERIFIED) === TIER_S);
  assert('ONE-Tier-H-path-makes-the-WHOLE-entry-Tier-H', governedTierFor([REF_A, REF_B, RULES_PATH], REPO) === TIER_H);
  assert('each-Tier-H-surface-alone-is-Tier-H', TIER_H_PATHS.every((p) => governedTierFor([p], REPO) === TIER_H), TIER_H_PATHS.join());
  assert('an-EMPTY-path-set-defaults-to-Tier-H-never-to-S', governedTierFor([], REPO) === TIER_H && governedTierFor(undefined, REPO) === TIER_H);
  assert('the-tier-constants-are-the-registers-own-two-distinct-values', TIER_H === GOVERNED_TIER_H && TIER_S === GOVERNED_TIER_S && TIER_H !== TIER_S);
  assert(
    'the-tier-travels-on-the-decomposed-entry-so-the-verdict-never-re-derives-it',
    declared(decomposeGovernedWork([row(5, [REF_A])], REPO).governed[0]).tier === TIER_S &&
      declared(decomposeGovernedWork([row(5, [AGENT_PATH])], REPO).governed[0]).tier === TIER_S &&
      // ⛔ ...and before the body and the record are read the decomposed entry is Tier H (2026-11-19), like one beside the law.
      decomposeGovernedWork([row(5, [REF_A])], REPO).governed[0].tier === TIER_H &&
      declared(decomposeGovernedWork([row(5, [REF_A, RULES_PATH])], REPO).governed[0]).tier === TIER_H,
  );

  // The real recognisers, and the tier VALUE read from the constant's one home
  // rather than spelled here — the same discipline C7 states, one file over.
  const live = await loadRecordRecognisers();
  assert('the-recognisers-LOAD-through-the-lazy-import-this-leg-depends-on', live.available === true, live.reason);
  const { CONTRACT_REVIEW_TIER: TIER } = await import('./dispatch-gates.mjs');
  const { CONTRACT_REVIEW_TIER_NAME: TIER_TOKEN } = await import(RECOGNISER_SOURCES.tier);
  assert('this-file-spells-NO-tier-value-it-reads-the-constant', typeof TIER === 'string' && TIER.length > 0);
  assert(
    'and-the-accepted-TOKEN-is-the-constants-NAME-imported-from-the-row-that-owns-it',
    TIER_TOKEN === 'CONTRACT_REVIEW_TIER' && TIER_TOKEN !== TIER,
    `${TIER_TOKEN}`,
  );

  const REF_HEAD = 'abc1234def5678'.padEnd(40, '0');
  const REF_OLD = '9999888777'.padEnd(40, '0');
  // The head sits on the `Head-sha:` line — the ONE line the recognisers read it from (#27979); the
  // `Head:` first-body-line spelling this fixture once wrote is a retired dialect, pinned refused below.
  // ⭐ Every fixture comment is posted by the relay unless a case says otherwise (#33541): the login is
  // the one the live loader assembled from `check-handover.mjs`, ⛔ never typed here.
  const RELAY = live.trustedAuthors?.[0];
  assert('the-live-loader-trusts-the-relay-identity-first-then-GOVERNED_APPROVERS-and-nothing-else', typeof RELAY === 'string' && RELAY.endsWith('[bot]') && JSON.stringify(live.trustedAuthors) === JSON.stringify([RELAY, ...GOVERNED_APPROVERS]), JSON.stringify(live.trustedAuthors));
  const recordComment = ({ sha = REF_HEAD.slice(0, 12), signed = true, tierLine = `Served-tier: 75/75 \`${TIER_TOKEN}\``, id = 900, at = '2026-09-13T13:00:00Z', verdictWord = '**VERDICT: PASS**', prose = [], by = RELAY, ruleVerified = 'none' } = {}) => ({
    id,
    created_at: at,
    ...(by === null ? {} : { user: { login: by } }),
    body: [
      '## Contract review',
      '',
      `Head-sha: \`${sha}\``,
      ...(signed ? ['Reviewed-by: `session_01SEAT`'] : []),
      ...(tierLine ? [tierLine] : []),
      // The `.claude/**` declaration split's line (2026-11-19): every fixture record verifies `none` unless a case moves it.
      ...(ruleVerified === null ? [] : [`Rule-change-verified: ${ruleVerified}`]),
      ...prose,
      '',
      verdictWord,
    ].join('\n'),
  });

  // The CARD this fixture pull request delivers, and the body that declares it.
  // ⭐ The record fixtures below sit on ONE thread at a time, which is the whole
  // of #18701: a record on either carrier is a record.
  const REF_CARD = 69;
  let tierApiCalls = 0;
  let tierThreadsRead = [];
  let tierLabelsRead = [];
  const tierRun = async ({
    files = [REF_A],
    reviews = [],
    comments = [],
    cardComments = [],
    prBody = `Fixes #${REF_CARD}`,
    branch = `claude/issue-${REF_CARD}-x`,
    head = REF_HEAD,
    headThrows = false,
    commentsThrow = false,
    recognisers = live,
    loaderThrows = false,
    event = EVENT_MERGE_GROUP,
    pr = 70,
    runGit = null,
    baseRef = null,
    workflowDiff = null,
    labels = [],
    extraRows = [],
    timeline = null,
    fork = SAME_REPO,
    // The CARD's label names and timeline, read by the low-risk arm's record stage alone (`readCardLabels`):
    // a list, `'throw'`, or `null` for no reader at all.
    cardLabels = [],
    cardTimeline = [],
    // Per-card answers for a pull that names more than one card: `{ [number]: list | 'throw' }`, over the two above.
    cardLabelsBy = {},
    cardTimelineBy = {},
    // The body's `Rule-change:` declaration (2026-11-19), appended to whatever body a case writes; `null` leaves it out.
    ruleChange = 'none',
  } = {}) => {
    const declaredBody = ruleChange === null ? prBody : `${prBody}\n\nRule-change: ${ruleChange}`;
    tierApiCalls = 0;
    tierThreadsRead = [];
    tierLabelsRead = [];
    return runGuard({
      repo: REPO,
      event,
      rows: [{ ...row(pr, files, 'c'.repeat(40), `x (#${pr})`), ...(workflowDiff ? { workflowDiff } : {}) }, ...extraRows],
      fetchReviews: async () => { tierApiCalls += 1; return reviews; },
      fetchPull: async () => { tierApiCalls += 1; if (headThrows) throw new Error('head unreadable'); return pull(head, { body: declaredBody, headRef: branch, labels, fork }); },
      ...(timeline === null ? {} : { fetchTimeline: async (n) => { if (n !== pr) tierApiCalls += 1; const read = n === pr ? timeline : (cardTimelineBy[n] ?? cardTimeline); if (read === 'throw') throw new Error('HTTP 403'); return read; } }),
      ...(cardLabels === null ? {} : { fetchLabels: async (n) => { tierApiCalls += 1; tierLabelsRead.push(n); const read = cardLabelsBy[n] ?? cardLabels; if (read === 'throw') throw new Error('HTTP 403'); return read; } }),
      fetchComments: async (n) => {
        tierApiCalls += 1;
        tierThreadsRead.push(n);
        if (commentsThrow) throw new Error('thread unreadable');
        return n === pr ? comments : cardComments;
      },
      loadRecognisers: async () => { if (loaderThrows) throw new Error('loader exploded'); return recognisers; },
      runGit,
      baseRef,
    });
  };

  // ⭐ THE PASS, and the whole card in one case.
  const tierPass = await tierRun({ comments: [recordComment()] });
  assert(
    'references-only-plus-a-valid-record-on-the-CURRENT-head-PASSES-with-zero-approvals',
    tierPass.exitCode === EXIT_CLEAR && tierPass.conclusion === 'cleared' && tierPass.entries[0].record.state === 'stands',
    JSON.stringify(tierPass.entries[0].record),
  );
  // ⭐ Maintainer 2026-10-24 (「守卫在合并队列里只认「另一账户复审」，这个没必要，去掉这条规则」):
  // the record stands on TIER ALONE. A project-thread pull request (its body
  // carries the `claude-projects-attribution` login) whose record was written
  // from the SAME account — even one still carrying a `Reviewed-by-account:`
  // line naming that login — clears, and no account is compared or printed.
  // This case is what keeps the retired account leg retired.
  const sameAccountRecord = recordComment();
  sameAccountRecord.body = sameAccountRecord.body.replace('Reviewed-by: `session_01SEAT`', 'Reviewed-by: `session_01SEAT`\nReviewed-by-account: `lane-account-a`');
  const sameAccount = await tierRun({
    prBody: `<!-- claude-projects-attribution: {"github_login":"lane-account-a"} -->\n_Requested by **Elon**_\n\nFixes #${REF_CARD}`,
    comments: [sameAccountRecord],
  });
  assert(
    'a-project-thread-PR-whose-record-was-written-from-the-SAME-account-PASSES-the-record-stands-on-tier-alone',
    sameAccount.exitCode === EXIT_CLEAR && sameAccount.conclusion === 'cleared' && sameAccount.entries[0].record.state === 'stands' &&
      !/Reviewed-by-account|accounts compared|SAME account/.test(renderGuardVerdict(sameAccount)),
    JSON.stringify(sameAccount.entries[0].record),
  );
  // ⭐ #19133, end to end: the generalised tier. An agents + settings diff lands
  // on the same record — and its lit control, the same diff with NO record, is
  // refused (the card's own acceptance line).
  const agentPass = await tierRun({ files: [AGENT_PATH, SKILL_PATH], comments: [recordComment()] });
  assert(
    'a-claude-agents-plus-skill-PR-with-a-valid-record-PASSES-with-zero-approvals-Tier-S-generalised',
    agentPass.exitCode === EXIT_CLEAR && agentPass.conclusion === 'cleared' && agentPass.entries[0].tier === TIER_S && agentPass.entries[0].record.state === 'stands',
    JSON.stringify(agentPass.entries[0].record),
  );
  const agentNoRecord = await tierRun({ files: [AGENT_PATH, SKILL_PATH], comments: [] });
  assert(
    '⛔ CONTROL: the-same-Tier-S-PR-with-NO-record-is-REFUSED',
    agentNoRecord.exitCode === EXIT_REFUSED_UNAPPROVED && agentNoRecord.entries[0].tier === TIER_S && agentNoRecord.entries[0].record.state === 'absent',
    JSON.stringify(agentNoRecord.entries[0].record),
  );
  // The lit controls: the same fixture, one fact away, in five directions.
  const tierOldHead = await tierRun({ comments: [recordComment({ sha: REF_OLD.slice(0, 12) })] });
  assert(
    '⛔ a-record-naming-an-OLDER-head-is-REFUSED-a-record-names-the-head-it-judged',
    tierOldHead.exitCode === EXIT_REFUSED_UNAPPROVED && tierOldHead.entries[0].record.state === 'absent',
    JSON.stringify(tierOldHead.entries[0].record),
  );
  // ⛔ #27979, the measured instance (PR #27964, record 6516042954): a DELTA record on the OLDER head whose
  // prose names the current head three times. The whole-body span scan read it as a review of the current
  // head and this leg CLEARED a Tier S diff at that head on it; the `Head-sha:` line alone decides now.
  const tierDelta = await tierRun({
    comments: [recordComment({
      sha: REF_OLD.slice(0, 12),
      prose: ['', `This is a DELTA record. The PR has since moved to \`${REF_HEAD.slice(0, 8)}\` (seat comment 6515952505); this record judges \`${REF_OLD.slice(0, 8)}\` alone. The runs were cancelled by the push of \`${REF_HEAD.slice(0, 8)}\`; landing waits on \`${REF_HEAD}\` and that head's record.`],
    })],
  });
  assert(
    '⛔ #27979-a-delta-record-on-the-OLDER-head-whose-PROSE-names-the-current-head-is-REFUSED-the-Head-sha-line-alone-decides',
    tierDelta.exitCode === EXIT_REFUSED_UNAPPROVED && tierDelta.entries[0].record.state === 'absent',
    JSON.stringify(tierDelta.entries[0].record),
  );
  const legacyFirstLine = recordComment();
  legacyFirstLine.body = legacyFirstLine.body.replace('Head-sha: `', 'Head: `');
  const tierLegacyFirstLine = await tierRun({ comments: [legacyFirstLine] });
  assert(
    '⛔ #27979-the-retired-first-body-line-Head-dialect-names-no-head-and-is-REFUSED',
    tierLegacyFirstLine.exitCode === EXIT_REFUSED_UNAPPROVED && tierLegacyFirstLine.entries[0].record.state === 'absent',
    JSON.stringify(tierLegacyFirstLine.entries[0].record),
  );
  const tierNoServed = await tierRun({ comments: [recordComment({ tierLine: null })] });
  assert(
    '⛔ a-record-with-NO-Served-tier-line-is-REFUSED-it-declares-nothing-about-what-served-it',
    tierNoServed.exitCode === EXIT_REFUSED_UNAPPROVED && tierNoServed.entries[0].record.state === 'below-tier' && tierNoServed.entries[0].record.served.state === 'missing',
  );
  const tierBelow = await tierRun({ comments: [recordComment({ tierLine: 'Served-tier: 75/75 `a-lesser-tier`' })] });
  assert(
    '⛔ a-record-served-BELOW-the-declared-tier-is-REFUSED-the-comparison-is-exact',
    tierBelow.exitCode === EXIT_REFUSED_UNAPPROVED && tierBelow.entries[0].record.state === 'below-tier',
  );
  // ⭐ #18060 — the token this leg first required was the constant's VALUE, a
  // literal model identifier, and a review of record IS a GitHub comment, which
  // `AGENTS.md` lets no model identifier land in. So the VALUE is now itself a
  // refusal, and the refusal ⛔ never quotes the token back.
  const tierIdentifier = await tierRun({ comments: [recordComment({ tierLine: `Served-tier: 75/75 \`${TIER}\`` })] });
  assert(
    '⛔ a-record-whose-Served-tier-token-is-a-MODEL-IDENTIFIER-is-REFUSED-AGENTS-md-lets-none-land-in-a-comment',
    tierIdentifier.exitCode === EXIT_REFUSED_UNAPPROVED &&
      tierIdentifier.entries[0].record.state === 'below-tier' &&
      tierIdentifier.entries[0].record.servedIsIdentifier === true,
    JSON.stringify(tierIdentifier.entries[0].record),
  );
  const identifierText = renderGuardVerdict(tierIdentifier);
  assert(
    '⛔ and-the-refusal-NEVER-quotes-the-identifier-back-a-refusal-is-not-a-second-violation',
    !identifierText.includes(TIER) && /MODEL IDENTIFIER/.test(identifierText) && /AGENTS\.md/.test(identifierText),
    identifierText,
  );
  assert(
    'while-the-PASSING-record-carries-the-NAME-and-no-identifier-so-the-leg-is-narrowed-never-widened',
    tierPass.entries[0].record.servedIsIdentifier === false &&
      recordComment().body.includes(TIER_TOKEN) &&
      !recordComment().body.includes(TIER),
  );
  const tierPartial = await tierRun({ comments: [recordComment({ tierLine: `Served-tier: 3/75 \`${TIER_TOKEN}\`` })] });
  assert(
    '⛔ a-record-whose-stamp-control-is-NOT-total-is-REFUSED-the-回退证据-voids-it-entire',
    tierPartial.exitCode === EXIT_REFUSED_UNAPPROVED && tierPartial.entries[0].record.state === 'below-tier',
  );
  const tierUnsigned = await tierRun({ comments: [recordComment({ signed: false })] });
  assert(
    '⛔ a-record-with-no-Reviewed-by-line-names-no-reviewer-and-is-REFUSED',
    tierUnsigned.exitCode === EXIT_REFUSED_UNAPPROVED && tierUnsigned.entries[0].record.state === 'unsigned',
  );
  const tierAbsent = await tierRun({ comments: [{ id: 1, created_at: '2026-09-13T12:00:00Z', body: 'looks good to me', user: { login: RELAY } }] });
  assert(
    '⛔ a-thread-with-NO-record-in-it-is-REFUSED-and-says-how-many-comments-it-read-ON-EACH-CARRIER',
    tierAbsent.exitCode === EXIT_REFUSED_UNAPPROVED && tierAbsent.entries[0].record.state === 'absent' &&
      tierAbsent.entries[0].record.read.pr === 1 && tierAbsent.entries[0].record.read.card === 0 &&
      tierAbsent.entries[0].record.readSummary === '1 on the PR and 0 on its card',
    JSON.stringify(tierAbsent.entries[0].record),
  );

  // ── ⭐ B′ with C: the record stands at the tier its FACE maps to ─────────
  //
  // Ruling record 6159870311 on #23352. The face is read off the entry's own
  // committed-tree paths by the IMPORTED `reviewFace`, and the record stands at
  // that face's NAME exactly. Every entry this leg reads is governed, so the
  // live leg is pinned at the contract-review tier; `recordVerdict` is pure, so
  // the declaration face — which no governed entry can be on — is driven on it
  // directly, with the real recognisers.
  battery('⭐ B′ with C: the record stands at the tier its FACE maps to, read off the committed paths');
  const { TIER_DEFAULT_NAME: DEFAULT_TOKEN, TIER_DEFAULT: DEFAULT_VALUE } = await import('./dispatch-gates.mjs');
  const tierDefaultOnS = await tierRun({ comments: [recordComment({ tierLine: `Served-tier: 75/75 \`${DEFAULT_TOKEN}\`` })] });
  assert(
    '⛔ a-TIER_DEFAULT-record-on-a-Tier-S-PR-is-REFUSED-governed-rules-text-maps-to-the-contract-review-tier',
    tierDefaultOnS.exitCode === EXIT_REFUSED_UNAPPROVED && tierDefaultOnS.entries[0].record.state === 'below-tier' &&
      tierDefaultOnS.entries[0].record.face === 'rules' && tierDefaultOnS.entries[0].record.tierName === TIER_TOKEN,
    JSON.stringify(tierDefaultOnS.entries[0].record),
  );
  assert(
    '…and-the-refusal-names-the-face-and-the-NAME-it-maps-to-and-quotes-the-declared-NAME-never-a-value',
    /rules face maps to/.test(renderGuardVerdict(tierDefaultOnS)) && renderGuardVerdict(tierDefaultOnS).includes(`\`${TIER_TOKEN}\``) &&
      renderGuardVerdict(tierDefaultOnS).includes(`\`${DEFAULT_TOKEN}\``) && !renderGuardVerdict(tierDefaultOnS).includes(TIER),
    renderGuardVerdict(tierDefaultOnS),
  );
  assert(
    'the-PASS-carries-its-face-and-tier-so-the-clear-says-which-tier-stood',
    tierPass.entries[0].record.face === 'rules' && tierPass.entries[0].record.tierName === TIER_TOKEN &&
      new RegExp(`naming \`${TIER_TOKEN}\`, the tier its rules face maps to`).test(renderGuardVerdict(tierPass)),
    renderGuardVerdict(tierPass),
  );
  const facePair = (paths, line) => ({
    pr: 70, card: REF_CARD, headSha: REF_HEAD, repo: REPO, paths,
    prComments: [recordComment({ tierLine: line })], cardComments: [],
  });
  const DECL = ['packages/rest/src/routes.ts'];
  const SCHEMA = ['packages/spec/src/data/field.zod.ts'];
  const atDefault = `Served-tier: 75/75 \`${DEFAULT_TOKEN}\``;
  const atContract = `Served-tier: 75/75 \`${TIER_TOKEN}\``;
  assert(
    '⭐ the-SAME-reading-STANDS-a-TIER_DEFAULT-record-on-a-declaration-only-pair',
    recordVerdict({ pair: facePair(DECL, atDefault), recognisers: live }).state === 'stands' &&
      recordVerdict({ pair: facePair(DECL, atDefault), recognisers: live }).face === 'declaration',
  );
  assert(
    '⛔ and-REFUSES-it-on-a-schema-pair-exact-never-a-floor',
    recordVerdict({ pair: facePair(SCHEMA, atDefault), recognisers: live }).state === 'below-tier' &&
      recordVerdict({ pair: facePair(SCHEMA, atContract), recognisers: live }).state === 'stands',
  );
  assert(
    '⛔ exact-in-BOTH-directions-a-contract-review-record-does-not-stand-on-a-declaration-only-pair',
    recordVerdict({ pair: facePair(DECL, atContract), recognisers: live }).state === 'below-tier',
  );
  assert(
    '⛔ the-default-tiers-VALUE-is-an-identifier-refused-and-never-quoted-back',
    (() => {
      const r = recordVerdict({ pair: facePair(DECL, `Served-tier: 75/75 \`${DEFAULT_VALUE}\``), recognisers: live });
      return r.state === 'below-tier' && r.servedIsIdentifier === true;
    })(),
  );
  assert(
    '⛔ a-pair-that-carries-NO-path-list-cannot-name-its-face-UNREADABLE-never-the-cheaper-tier',
    recordVerdict({ pair: { ...facePair(DECL, atDefault), paths: undefined }, recognisers: live }).state === 'unreadable' &&
      recordVerdict({ pair: { ...facePair(DECL, atDefault), paths: [] }, recognisers: live }).state === 'unreadable',
  );

  // ── ⭐ #18701: the record lives on the PR **or its card**, and both are read ──
  //
  battery('⭐ #18701: the record lives on the PR or its card, and BOTH are read');
  //
  // The dequeue this leg cost, reproduced offline: a references-tier pair whose
  // record sits ONLY on the card thread. Refused before this case existed
  // (「0 comment(s) read on the PR thread」, PR #18689, `CI_FAILURE`), and the
  // rule it was refused against says 「一条评论落 PR 或卡」.
  const tierOnCard = await tierRun({ comments: [{ id: 1, created_at: '2026-09-13T12:00:00Z', body: 'os-dev-report', user: { login: RELAY } }], cardComments: [recordComment({ id: 901 })] });
  assert(
    '⭐ a-record-on-the-CARD-thread-alone-PASSES-the-two-carriers-are-one-delivery',
    tierOnCard.exitCode === EXIT_CLEAR && tierOnCard.entries[0].record.state === 'stands' && tierOnCard.entries[0].record.where === 'card',
    JSON.stringify(tierOnCard.entries[0].record),
  );
  assert(
    '…and-BOTH-threads-were-actually-fetched-the-PR-number-and-the-card-it-delivers',
    tierThreadsRead.join() === '70,69',
    tierThreadsRead.join(),
  );
  assert(
    '…and-the-passing-rendering-NAMES-the-thread-it-found-the-record-on',
    /on the card thread is a `## Contract review`/.test(renderGuardVerdict(tierOnCard)),
    renderGuardVerdict(tierOnCard),
  );
  // The lit control for the case above: the PR-thread reading is untouched.
  const tierOnPrThread = await tierRun({ comments: [recordComment()], cardComments: [] });
  assert(
    'a-record-on-the-PR-thread-alone-still-PASSES-exactly-as-before',
    tierOnPrThread.exitCode === EXIT_CLEAR && tierOnPrThread.entries[0].record.where === 'PR',
  );
  // ⭐ NEWEST-GOVERNS SPANS THE TWO THREADS, because the located record is ONE
  // comment chosen once by the imported reader — never a per-thread winner.
  const tierNewestAcross = await tierRun({
    comments: [recordComment({ id: 910, at: '2026-09-13T10:00:00Z', tierLine: 'Served-tier: 75/75 `a-lesser-tier`' })],
    cardComments: [recordComment({ id: 911, at: '2026-09-13T11:00:00Z' })],
  });
  assert(
    '⭐ the-NEWEST-record-governs-ACROSS-the-two-threads-not-one-winner-per-thread',
    tierNewestAcross.entries[0].record.state === 'stands' && tierNewestAcross.entries[0].record.id === 911,
    JSON.stringify(tierNewestAcross.entries[0].record),
  );
  const tierNewestOnPr = await tierRun({
    comments: [recordComment({ id: 912, at: '2026-09-13T14:00:00Z' })],
    cardComments: [recordComment({ id: 913, at: '2026-09-13T11:00:00Z', tierLine: 'Served-tier: 75/75 `a-lesser-tier`' })],
  });
  assert(
    '…in-both-directions-a-newer-PR-thread-record-displaces-an-older-card-one',
    tierNewestOnPr.entries[0].record.state === 'stands' && tierNewestOnPr.entries[0].record.id === 912,
  );
  // ⛔ The card is DERIVED, and an underivable one searches NO card thread — the
  // refusing direction, stated in the refusal rather than guessed at.
  const tierNoCard = await tierRun({ prBody: 'no card named here', branch: 'feat/whatever', cardComments: [recordComment()] });
  assert(
    '⛔ a-pull-request-naming-NO-card-searches-no-card-thread-and-is-REFUSED',
    tierNoCard.exitCode === EXIT_REFUSED_UNAPPROVED && tierNoCard.entries[0].record.state === 'absent' && tierThreadsRead.join() === '70',
    JSON.stringify({ record: tierNoCard.entries[0].record, read: tierThreadsRead }),
  );
  assert(
    '…and-the-refusal-SAYS-no-card-thread-was-searched-and-why-so-a-seat-is-not-left-guessing',
    /no card thread was searched/.test(renderGuardVerdict(tierNoCard)) && /names no card/.test(renderGuardVerdict(tierNoCard)),
    renderGuardVerdict(tierNoCard),
  );
  const tierTwoCards = await tierRun({ prBody: 'Fixes #101\nFixes #102', cardComments: [recordComment()] });
  assert(
    '⛔ and-a-pull-request-delivering-TWO-cards-at-equal-strength-picks-NEITHER',
    tierTwoCards.exitCode === EXIT_REFUSED_UNAPPROVED && tierThreadsRead.join() === '70' &&
      /same strength/.test(renderGuardVerdict(tierTwoCards)),
    renderGuardVerdict(tierTwoCards),
  );
  // The branch-name fallback is the relation's own, reached only when the body
  // declares nothing — so a record on the branch's card is still found.
  const tierByBranch = await tierRun({ prBody: 'no declaration at all', cardComments: [recordComment({ id: 920 })] });
  assert(
    'the-card-comes-from-the-BRANCH-NAME-when-the-body-declares-nothing-the-relations-own-fallback',
    tierByBranch.exitCode === EXIT_CLEAR && tierByBranch.entries[0].record.id === 920 && tierThreadsRead.join() === '70,69',
    tierThreadsRead.join(),
  );
  // ⛔ An unreadable CARD thread is exit 4 on the same rule the PR thread is:
  // an unread carrier is not a carrier with no record on it.
  const tierCardThrew = await tierRun({ commentsThrow: true });
  assert(
    '⛔ an-unreadable-thread-on-EITHER-carrier-is-exit-4-never-an-absent-record',
    tierCardThrew.exitCode === EXIT_REFUSED_UNREADABLE && tierCardThrew.entries[0].record.state === 'unreadable',
  );
  // ⭐ THE MIRROR PIN. `renderGuardVerdict` is pure and synchronous, so the
  // WORDS a refusal prints are a module-scope mirror here; the SET this leg
  // reads is not (it is the loaded list). Drift between the two reddens.
  const { REVIEW_OF_RECORD_LOCATION: OWNED_LOCATION, REVIEW_OF_RECORD_THREADS: OWNED_THREADS } = await import(RECOGNISER_SOURCES.tier);
  assert(
    '⭐ the-location-WORDS-this-file-prints-are-pinned-to-the-constant-that-OWNS-them',
    REVIEW_OF_RECORD_LOCATION === OWNED_LOCATION && OWNED_LOCATION === OWNED_THREADS.map((t) => t.words).join(' or '),
    `${REVIEW_OF_RECORD_LOCATION} vs ${OWNED_LOCATION}`,
  );
  assert(
    '…and-the-remedy-a-refusal-offers-names-exactly-that-location-never-one-thread-of-it',
    renderGuardVerdict(tierAbsent).includes(`comment on ${OWNED_LOCATION} naming`),
    renderGuardVerdict(tierAbsent),
  );
  assert(
    '…while-the-leg-itself-reads-the-LOADED-set-so-a-stale-mirror-can-never-shrink-what-is-searched',
    live.threads === OWNED_THREADS && live.threads.length === 2,
  );

  // ⭐ The BOUNDARY: one rules-layer path and the tier is not reachable at all.
  battery('⭐ #18020 → #19133 Tier S: a review of record, not an approval');
  const tierMixed = await tierRun({ files: [REF_A, RULES_PATH], comments: [recordComment()] });
  assert(
    '⛔ a-MIXED-diff-with-one-Tier-H-path-is-REFUSED-even-with-a-perfect-record',
    tierMixed.exitCode === EXIT_REFUSED_UNAPPROVED && tierMixed.entries[0].tier === TIER_H && tierMixed.entries[0].record === undefined,
  );
  assert('and-the-mixed-entry-never-even-BOUGHT-the-thread-read', tierApiCalls === 2, `api calls: ${tierApiCalls}`);

  // The rules layer, unchanged in both directions — the lit controls for the
  // claim "everything else keeps today's predicate byte-for-byte".
  const rulesApproved = await tierRun({ files: [RULES_PATH], reviews: [approvedAt(GOVERNED_APPROVERS[0], REF_HEAD)] });
  assert('rules-layer-plus-an-authorized-approval-still-PASSES-unchanged', rulesApproved.exitCode === EXIT_CLEAR && rulesApproved.conclusion === 'cleared');
  const rulesDismissed = await tierRun({ files: [RULES_PATH], reviews: [{ state: 'DISMISSED', user: { login: GOVERNED_APPROVERS[0] }, commit_id: REF_HEAD }] });
  assert('a-DISMISSED-approval-is-still-REFUSED-unchanged', rulesDismissed.exitCode === EXIT_REFUSED_UNAPPROVED);
  const refDismissed = await tierRun({ reviews: [{ state: 'DISMISSED', user: { login: GOVERNED_APPROVERS[0] }, commit_id: REF_HEAD }], comments: [] });
  assert('a-DISMISSED-approval-on-a-references-PR-with-no-record-is-REFUSED-too', refDismissed.exitCode === EXIT_REFUSED_UNAPPROVED);

  // ⭐ MONOTONE: the leg can only LIFT a refusal, never create one. A
  // references PR an authorized approver approved clears on the approval, and
  // the thread is never read — measured with a spy that THROWS if it is.
  const monotone = await runGuard({
    repo: REPO,
    event: EVENT_MERGE_GROUP,
    rows: [row(71, [REF_A])],
    fetchReviews: async () => [approvedAt(GOVERNED_APPROVERS[0], REF_HEAD)],
    fetchPull: async () => pull(REF_HEAD, { body: 'Rule-change: none' }),
    fetchComments: async () => { throw new Error('the thread must not be read when an approval already satisfies the entry'); },
    loadRecognisers: async () => { throw new Error('the recognisers must not be loaded when an approval already satisfies the entry'); },
  });
  assert(
    '⭐ MONOTONE-an-APPROVED-references-PR-clears-on-the-approval-and-the-thread-is-never-read',
    monotone.exitCode === EXIT_CLEAR && monotone.entries[0].record.state === 'unreadable',
    JSON.stringify(monotone.entries[0].record),
  );
  assert(
    'and-its-CLEARED-rendering-keeps-the-approval-sentence-byte-for-byte',
    renderGuardVerdict(monotone).includes('✅  CLEARED — every governed pull request in this merge group carries an APPROVED review by an'),
  );
  assert(
    '⛔ and-a-PASSING-references-entry-prints-no-record-refusal-a-verdict-may-not-deny-its-own-evidence',
    !/could NOT be read/.test(renderGuardVerdict(monotone)) && /✅ authorized APPROVED review/.test(renderGuardVerdict(monotone)),
    renderGuardVerdict(monotone),
  );
  assert(
    '⭐ while-a-clear-reached-THROUGH-the-tier-does-NOT-claim-an-approval-it-never-read',
    !renderGuardVerdict(tierPass).includes('every governed pull request in this merge group carries an APPROVED review') &&
      /NOT every pull request below cleared on an approval/.test(renderGuardVerdict(tierPass)),
  );

  // "We could not find out" stays exit 4 on every limb of the new leg.
  const tierNoThread = await tierRun({ commentsThrow: true });
  assert('⛔ an-UNREADABLE-thread-is-exit-4-never-a-record-that-is-absent', tierNoThread.exitCode === EXIT_REFUSED_UNREADABLE && tierNoThread.entries[0].record.state === 'unreadable');
  const tierNoHead = await tierRun({ headThrows: true, comments: [recordComment()] });
  assert('⛔ an-UNREADABLE-head-is-exit-4-on-THIS-row-its-body-is-what-the-declaration-is-read-from', tierNoHead.exitCode === EXIT_REFUSED_UNREADABLE && tierNoHead.entries[0].tier === TIER_H && tierNoHead.entries[0].record === undefined && declarationUnread(tierNoHead.entries[0]) && /declaration split .*NOT MEASURED — its pull request could not be read/.test(renderGuardVerdict(tierNoHead)), renderGuardVerdict(tierNoHead));
  const tierNoRecognisers = await tierRun({ recognisers: { available: false, reason: 'a rename' }, comments: [recordComment()] });
  assert('⛔ recognisers-that-did-not-load-are-exit-4-fail-CLOSED', tierNoRecognisers.exitCode === EXIT_REFUSED_UNREADABLE);
  const tierLoaderThrew = await tierRun({ loaderThrows: true, comments: [recordComment()] });
  assert('⛔ and-a-loader-that-THROWS-is-caught-and-is-still-exit-4-never-a-pass', tierLoaderThrew.exitCode === EXIT_REFUSED_UNREADABLE);
  const renamed = await loadRecordRecognisers(async (specifier) => (specifier === RECOGNISER_SOURCES.tier ? {} : await import(specifier)));
  assert(
    'a-RENAMED-export-names-itself-rather-than-half-loading-a-parser-nobody-checked',
    renamed.available === false &&
      /locate/.test(renamed.reason) &&
      /deliveredCard/.test(renamed.reason) &&
      /servedTierStands/.test(renamed.reason) &&
      /isModelIdentifierToken/.test(renamed.reason) &&
      /reviewFace/.test(renamed.reason) &&
      /threads/.test(renamed.reason),
    renamed.reason,
  );
  const wontLoad = await loadRecordRecognisers(async () => { throw new Error('ERR_MODULE_NOT_FOUND'); });
  assert('a-module-that-will-not-load-at-all-is-available-false-with-its-reason', wontLoad.available === false && /would not load/.test(wontLoad.reason));

  // The `pull_request` leg is untouched: no thread read, no record key, and the
  // early warning still never reddens.
  const tierOnPr = await runGuard({
    repo: REPO,
    event: EVENT_PULL_REQUEST,
    rows: [row(72, [REF_A])],
    fetchReviews: async () => [],
    fetchPull: async () => { throw new Error('the PR leg reads no head'); },
    fetchComments: async () => { throw new Error('the PR leg reads no thread'); },
    loadRecognisers: async () => { throw new Error('the PR leg loads no recognisers'); },
  });
  assert(
    'the-pull_request-leg-reads-NO-thread-carries-NO-record-key-and-still-never-reddens',
    tierOnPr.exitCode === EXIT_CLEAR && tierOnPr.conclusion === 'warned' && tierOnPr.entries[0].record === undefined && tierOnPr.apiCalls === 1,
  );
  // ⭐ The ordering guarantee, extended: a clear diff does not even LOAD them.
  const clearWithSpies = await runGuard({
    repo: REPO,
    event: EVENT_MERGE_GROUP,
    rows: [row(73, ['packages/spec/src/index.ts'])],
    fetchReviews: async () => { throw new Error('no review lookup may be made on a clear diff'); },
    fetchPull: async () => { throw new Error('no head read may be made on a clear diff'); },
    fetchComments: async () => { throw new Error('no thread read may be made on a clear diff'); },
    loadRecognisers: async () => { throw new Error('the recognisers may not even be LOADED on a clear diff'); },
  });
  assert('⭐ a-clear-diff-still-costs-zero-reads-AND-zero-recogniser-loads', clearWithSpies.exitCode === EXIT_CLEAR && clearWithSpies.apiCalls === 0);

  // The words a reader acts on — requirement (e) reaches the new leg too.
  const tierRefusalText = renderGuardVerdict(tierAbsent);
  assert('the-refusal-names-the-tier-on-the-entry-so-a-reader-knows-why-a-record-would-help', /landing tier: S/.test(tierRefusalText), tierRefusalText);
  assert('and-offers-the-record-as-a-THIRD-remedy-naming-the-three-facts-it-must-carry', /3\. Or — ONLY for a pull request whose governed paths all lie under/.test(tierRefusalText) && /Reviewed-by:/.test(tierRefusalText) && /Served-tier:/.test(tierRefusalText));
  assert('⛔ and-a-RULES-layer-refusal-is-offered-no-such-remedy-the-control-for-the-line-above', !/3\. Or — ONLY for a pull request/.test(renderGuardVerdict(rulesDismissed)));
  assert('the-below-tier-refusal-names-the-reading-it-actually-got', /does not stand/.test(renderGuardVerdict(tierBelow)) && /a-lesser-tier/.test(renderGuardVerdict(tierBelow)));
  assert('⛔ and-it-never-prints-the-tier-VALUE-it-names-the-constant', /`CONTRACT_REVIEW_TIER`/.test(renderGuardVerdict(tierBelow)) && !renderGuardVerdict(tierBelow).includes(TIER));
  assert('#33541-the-passing-rendering-says-the-record-READS-PASS-and-who-posted-it', /one `VERDICT:` line READS PASS, and this one does \(#33541\)/.test(renderGuardVerdict(tierPass)) && renderGuardVerdict(tierPass).includes(`Posted by \`${RELAY}\``) && !/EXISTENCE and PROVENANCE, never the verdict/.test(renderGuardVerdict(tierPass)), renderGuardVerdict(tierPass));
  // ⛔ #33541 FLIPPED this row: AGENTS.md Prime Directive 14 lands Tier S on "a PASS verdict", so a
  // same-head FAIL record no longer clears `.claude/**` — it is refused, naming the comment.
  const tierFailWord = await tierRun({ comments: [recordComment({ verdictWord: '**VERDICT: FAIL**' })] });
  assert('⛔ #33541-a-same-head-FAIL-record-is-REFUSED-on-every-Tier-S-leg-naming-the-comment-id', tierFailWord.exitCode === EXIT_REFUSED_UNAPPROVED && tierFailWord.entries[0].record.state === 'not-pass' && tierFailWord.entries[0].record.verdict === 'FAIL' && /comment 900, .*does not read PASS: it reads FAIL/.test(renderGuardVerdict(tierFailWord)) && /Prime Directive 14, #33541/.test(renderGuardVerdict(tierFailWord)), renderGuardVerdict(tierFailWord));
  // ⭐ #33541, the verdict: exactly ONE `VERDICT:` line under the heading, reading PASS; the newest same-head record decides.
  const wordOnly = await tierRun({ comments: [recordComment({ verdictWord: 'PASS' })] });
  assert('⛔ #33541-a-record-with-NO-VERDICT-line-is-REFUSED-a-bare-PASS-word-alone-is-not-the-line', wordOnly.exitCode === EXIT_REFUSED_UNAPPROVED && wordOnly.entries[0].record.state === 'not-pass' && wordOnly.entries[0].record.verdict === null && /states no verdict \(no `VERDICT:` line/.test(renderGuardVerdict(wordOnly)), renderGuardVerdict(wordOnly));
  const twoLines = await tierRun({ comments: [recordComment({ verdictWord: '**VERDICT: PASS**\n\n> **VERDICT: FAIL**' })] });
  assert('⛔ #33541-a-record-with-TWO-VERDICT-lines-is-REFUSED-whatever-their-order-or-quoting', twoLines.exitCode === EXIT_REFUSED_UNAPPROVED && twoLines.entries[0].record.state === 'not-pass' && /comment 900, .*states 2 `VERDICT:` lines \(PASS, FAIL\)/.test(renderGuardVerdict(twoLines)), renderGuardVerdict(twoLines));
  const twoPass = await tierRun({ comments: [recordComment({ verdictWord: '**VERDICT: PASS**\n**VERDICT: PASS**' })] });
  assert('⛔ #33541-…even-two-PASS-lines-a-record-states-exactly-one', twoPass.exitCode === EXIT_REFUSED_UNAPPROVED && twoPass.entries[0].record.state === 'not-pass');
  const inlineBeside = await tierRun({ comments: [{ ...recordComment(), body: recordComment().body.replace('## Contract review', '## Contract review (delta) — **PASS**') }] });
  assert('#33541-a-heading-inline-PASS-beside-ONE-VERDICT-line-is-not-a-second-line-it-CLEARS', inlineBeside.exitCode === EXIT_CLEAR && inlineBeside.entries[0].record.verdict === 'PASS', JSON.stringify(inlineBeside.entries[0].record));
  const failAfterPass = await tierRun({ comments: [recordComment({ id: 921, at: '2026-09-13T12:00:00Z' }), recordComment({ id: 922, at: '2026-09-13T14:00:00Z', verdictWord: '**VERDICT: FAIL**' })] });
  assert('⛔ #33541-a-FAIL-AFTER-a-PASS-on-the-same-head-is-REFUSED-the-latest-record-decides', failAfterPass.exitCode === EXIT_REFUSED_UNAPPROVED && failAfterPass.entries[0].record.id === 922 && failAfterPass.entries[0].record.state === 'not-pass', JSON.stringify(failAfterPass.entries[0].record));
  const passAfterFail = await tierRun({ comments: [recordComment({ id: 923, at: '2026-09-13T12:00:00Z', verdictWord: '**VERDICT: FAIL**' })], cardComments: [recordComment({ id: 924, at: '2026-09-13T14:00:00Z' })] });
  assert('#33541-a-PASS-AFTER-a-FAIL-on-the-same-head-CLEARS-across-the-two-threads-the-latest-record-decides', passAfterFail.exitCode === EXIT_CLEAR && passAfterFail.entries[0].record.id === 924 && passAfterFail.entries[0].record.verdict === 'PASS', JSON.stringify(passAfterFail.entries[0].record));
  {
    // ⭐ #33604: a PASS that is not clean clears nothing — the guard decides, not the seat's pre-landing check.
    // Grades in the shapes measured on the records of PRs #33686, #33687, #33688 and #33711 (2026-11-15).
    const graded = (prose, extra = {}) => tierRun({ comments: [recordComment({ prose, ...extra })] });
    const openShould = await graded(['', '### ④ Design judgment', '', 'No must-fix. Two should-fix, both owing a delta review.', '', '**S1 (should-fix) — a landing the maintainer cleared is reported as a BREACH.**', '- **S2 (should-fix) — two knocks have no row.**', '- **N1 (nit) — wording.**']);
    assert('⛔ #33604-a-same-head-PASS-record-naming-an-OPEN-should-fix-is-REFUSED-naming-the-findings', openShould.exitCode === EXIT_REFUSED_UNAPPROVED && openShould.entries[0].record.state === 'not-pass' && openShould.entries[0].record.verdict === null && /comment 900, .*reads PASS but names 2 open must-fix\/should-fix finding\(s\) \(S1 \(should-fix\), S2 \(should-fix\)\)/.test(renderGuardVerdict(openShould)), renderGuardVerdict(openShould));
    const openMust = await graded(['- must-fix: the arm reads no label.']);
    assert('⛔ #33604-…and-a-PASS-naming-a-must-fix-unnumbered-under-a-bullet-is-refused-too', openMust.exitCode === EXIT_REFUSED_UNAPPROVED && /names 1 open must-fix\/should-fix finding\(s\) \(must-fix\)/.test(renderGuardVerdict(openMust)), renderGuardVerdict(openMust));
    const deltaCloses = await tierRun({ comments: [recordComment({ id: 941, at: '2026-09-13T12:00:00Z', prose: ['**S1 (should-fix) — the knock has no key.**'] }), recordComment({ id: 942, at: '2026-09-13T14:00:00Z', prose: ['Delta review.', '- **S1: closed.** Every knock names a key.', 'No must-fix. S1 of record 941 is closed on this head.'] })] });
    assert('#33604-the-LATER-same-head-delta-record-that-CLOSES-them-CLEARS', deltaCloses.exitCode === EXIT_CLEAR && deltaCloses.entries[0].record.id === 942 && deltaCloses.entries[0].record.verdict === 'PASS', JSON.stringify(deltaCloses.entries[0].record));
    const deltaRaises = await tierRun({ comments: [recordComment({ id: 943, at: '2026-09-13T12:00:00Z' }), recordComment({ id: 944, at: '2026-09-13T14:00:00Z', prose: ['- **S1: closed.**', '- **S3 (should-fix, the seat\'s, no head change) — the PR body describes round 1.**'] })] });
    assert('⛔ #33604-a-delta-record-that-raises-a-NEW-should-fix-is-refused-though-an-older-clean-PASS-stands', deltaRaises.exitCode === EXIT_REFUSED_UNAPPROVED && deltaRaises.entries[0].record.id === 944 && /S3 \(should-fix\)/.test(renderGuardVerdict(deltaRaises)), renderGuardVerdict(deltaRaises));
    const clean = await graded(['Findings: no must-fix, no should-fix.', '- N1 (nit, prose face): the body overstates.', '- nit: the compare is sent first.', 'Nits only; the head is not moved.']);
    assert('#33604-CONTROL-a-PASS-whose-grades-read-no-must-fix-no-should-fix-and-nits-CLEARS', clean.exitCode === EXIT_CLEAR && clean.entries[0].record.verdict === 'PASS', renderGuardVerdict(clean));
    const unattributed = await graded(['Two should-fix remain, see the thread.']);
    assert('⛔ #33604-a-grade-the-reader-cannot-attribute-FAILS-CLOSED-and-the-remedy-names-the-shapes-not-a-sentence-to-add', unattributed.exitCode === EXIT_REFUSED_UNAPPROVED && /cannot be attributed \(`Two should-fix remain, see the thread\.`\)/.test(renderGuardVerdict(unattributed)) && /a citation `\(record ID: …\)`/.test(renderGuardVerdict(unattributed)) && !/or state `no should-fix`/.test(renderGuardVerdict(unattributed)), renderGuardVerdict(unattributed));
    // ⭐ S1 of review 6891926185: a delta record that cites or closes graded findings CLEARS — measured on #33711's final record 6891542450.
    const cleanDelta = await graded(['DELTA review from `42323f341b198c6c0625ac74f6ffd3eea8265c6b` (record 6891274033: PASS, should-fix S3, nits N7 and N8) to this head.', '', '- **S3: closed.** The record leg applies the author binding.', '', 'No must-fix. No should-fix. Three new nits.', '', '- **N9** wording.']);
    assert('#33604-S1-the-MEASURED-clean-delta-record-citing-the-prior-record-with-its-grade-CLEARS', cleanDelta.exitCode === EXIT_CLEAR && cleanDelta.entries[0].record.verdict === 'PASS', renderGuardVerdict(cleanDelta));
    const closedNamed = await Promise.all(['- **S1 (should-fix): closed.**', 'S1 (should-fix) — closed on this head', 'No new should-fix.', 'No open should-fix.'].map((line) => graded([line])));
    assert('#33604-S1-a-named-finding-whose-line-says-closed-and-no-new-or-open-should-fix-CLEAR', closedNamed.every((r) => r.exitCode === EXIT_CLEAR), closedNamed.map((r) => r.entries[0].record.verdictReason).join(' | '));
    const citedThenOpen = await graded(['DELTA review from `9d13278d` (record 6890932729: PASS, should-fix S1 and S2, nits N1 to N6) to this head.', '**S3 (should-fix) — new at this head.**']);
    assert('⛔ #33604-S1-CONTROL-a-citation-excuses-only-itself-a-new-named-should-fix-beside-it-still-refuses', citedThenOpen.exitCode === EXIT_REFUSED_UNAPPROVED && /S3 \(should-fix\)/.test(renderGuardVerdict(citedThenOpen)), renderGuardVerdict(citedThenOpen));
    // ⛔ S1 of review 6892305129: the state word must END the finding — a title that opens with `closed` or `none` names an OPEN finding.
    const titledOpen = await Promise.all(['S1 (should-fix): closed in part, still open for X', '- **S1 (should-fix) — closed in part; the table cell still clears.**', '**S2 (should-fix) — Closed PRs are still read as merged by the audit.**', '- **S2 (should-fix) — none of the three ablations ran on the committed head.**', 'S1 (should-fix) — closed on the prior head, reopened by this delta', '- should-fix: none of S1, S2 is fixed'].map((line) => graded([line])));
    assert('⛔ #33604-r3-a-finding-whose-TITLE-opens-with-closed-or-none-stays-OPEN-and-REFUSES', titledOpen.every((r) => r.exitCode === EXIT_REFUSED_UNAPPROVED && /names 1 open must-fix\/should-fix finding/.test(renderGuardVerdict(r))), titledOpen.map((r) => r.entries[0].record.verdictReason ?? 'CLEARED').join(' | '));
    const stateEnds = await Promise.all(['S1 (should-fix): closed here.', 'S1 (should-fix): closed;'].map((line) => graded([line])));
    assert('#33604-r3-CONTROL-closed-that-ends-the-finding-CLEARS', stateEnds.every((r) => r.exitCode === EXIT_CLEAR), stateEnds.map((r) => r.entries[0].record.verdictReason).join(' | '));
    // ⛔ #33770 N1: a closed bold title with a sentence after it stays OPEN — the reader cannot weigh a body against its title.
    const titleThenBody = await Promise.all(['- **S1 (should-fix): closed.** Every knock names a key.', '- **S1 (should-fix): closed.** Reopened by this delta.'].map((line) => graded([line])));
    assert('⛔ #33770-N1-a-closed-bold-title-with-a-body-after-it-stays-OPEN-and-REFUSES', titleThenBody.every((r) => r.exitCode === EXIT_REFUSED_UNAPPROVED && /names 1 open must-fix\/should-fix finding/.test(renderGuardVerdict(r))), titleThenBody.map((r) => r.entries[0].record.verdictReason ?? 'CLEARED').join(' | '));
    const r3Fails = await Promise.all(['Verdict: FAILED', 'Verdict is FAIL', 'Verdict (delta): FAIL', '| FAIL | Verdict |', 'FAIL!', '## Contract review — PASS withdrawn, FAIL'].map((line) => graded([line])));
    assert('⛔ #33604-r3-N2-FAILED-is-a-parenthetical-a-reversed-table-row-FAIL-bang-and-a-late-FAIL-in-a-heading-tail-REFUSE', r3Fails.every((r) => r.exitCode === EXIT_REFUSED_UNAPPROVED && /yet it also reads FAIL/.test(renderGuardVerdict(r))), r3Fails.map((r) => r.entries[0].record.verdictReason ?? 'CLEARED').join(' | '));
    // ⛔ S2 of review 6891926185: every verdict-bearing FAIL form refuses, and an ambiguous negation fails closed.
    const s2Fails = await Promise.all(['### VERDICT: FAIL', '## Verdict: FAIL', '| Verdict | FAIL |', 'Overall verdict: FAIL', 'Verdict — FAIL', 'FAIL.', '**FAIL.**', '## Contract review — FAIL'].map((line) => graded([line])));
    assert('⛔ #33604-S2-heading-led-key-table-cell-words-before-the-key-a-dash-a-bare-FAIL-full-stop-and-a-second-heading-each-REFUSE', s2Fails.every((r) => r.exitCode === EXIT_REFUSED_UNAPPROVED && /yet it also reads FAIL/.test(renderGuardVerdict(r))), s2Fails.map((r) => r.entries[0].record.verdictReason).join(' | '));
    const halfDenied = await graded(['No must-fix, should-fix S1 and S2 below.', '- **S1** the knock has no key.']);
    assert('⛔ #33604-S2-a-comma-does-not-carry-the-denial-No-must-fix-comma-should-fix-S1-is-UNREADABLE-not-clean', halfDenied.exitCode === EXIT_REFUSED_UNAPPROVED && /cannot be attributed/.test(renderGuardVerdict(halfDenied)), renderGuardVerdict(halfDenied));
    const cleanDenials = await Promise.all(['No must-fix. No should-fix.', 'No must-fix and no should-fix.', 'Neither must-fix nor should-fix.', '0 must-fix, 0 should-fix', '- should-fix: none', '| Verdict | PASS |'].map((line) => graded([line])));
    assert('#33604-S2-CONTROL-denials-with-their-own-no-neither-nor-zero-and-a-grade-valued-none-CLEAR', cleanDenials.every((r) => r.exitCode === EXIT_CLEAR), cleanDenials.map((r) => r.entries[0].record.verdictReason).join(' | '));
    const unread = await tierRun({ comments: [recordComment()], recognisers: { ...live, reading: () => ({ verdicts: ['PASS'] }) } });
    assert('⛔ #33604-a-reading-with-no-grades-in-it-FAILS-CLOSED', unread.exitCode === EXIT_REFUSED_UNAPPROVED && /could not be read, so it clears nothing/.test(renderGuardVerdict(unread)), renderGuardVerdict(unread));
    // ⛔ N2 of record 6890532571: a self-contradicting record never clears beside its one PASS line.
    const headingFail = await tierRun({ comments: [{ ...recordComment(), body: recordComment().body.replace('## Contract review', '## Contract review (delta) — **FAIL**') }] });
    assert('⛔ #33604-N2-a-heading-reading-FAIL-above-the-template-PASS-line-is-REFUSED', headingFail.exitCode === EXIT_REFUSED_UNAPPROVED && /yet it also reads FAIL \(`## Contract review \(delta\) — \*\*FAIL\*\*`\)/.test(renderGuardVerdict(headingFail)), renderGuardVerdict(headingFail));
    const n2Spellings = await Promise.all(['verdict: fail', '- **VERDICT: FAIL**', '**Verdict:** FAIL', '> * Verdict: Fail', 'FAIL', '**FAIL** — the arm reads no label'].map((line) => graded([line])));
    assert('⛔ #33604-N2-a-FAIL-spelled-outside-the-explicit-regex-lower-case-key-list-bullet-emphasis-bare-is-REFUSED', n2Spellings.every((r) => r.exitCode === EXIT_REFUSED_UNAPPROVED && /yet it also reads FAIL/.test(renderGuardVerdict(r))), n2Spellings.map((r) => r.entries[0].record.verdictReason).join(' | '));
    const n2Prose = await graded(['- Newest FAIL over an older PASS: refused.', 'FAIL, none or two refuse, naming the comment.', 'The fail-closed verdict: holds.']);
    assert('#33604-N2-CONTROL-prose-that-merely-MENTIONS-FAIL-is-not-a-verdict-line-the-record-CLEARS', n2Prose.exitCode === EXIT_CLEAR, renderGuardVerdict(n2Prose));
    // ⛔ N3 of record 6890532571: `VERDICT:` lines above the heading count.
    const above = await tierRun({ comments: [{ ...recordComment(), body: `**VERDICT: FAIL**\n\n${recordComment().body}` }] });
    assert('⛔ #33604-N3-a-VERDICT-line-ABOVE-the-heading-counts-two-lines-REFUSED', above.exitCode === EXIT_REFUSED_UNAPPROVED && /states 2 `VERDICT:` lines \(FAIL, PASS\)/.test(renderGuardVerdict(above)), renderGuardVerdict(above));
  }
  // ⭐ #33541, the author: the relay and GOVERNED_APPROVERS post records; any other author is IGNORED, never refused loudly.
  const PM_DIRECT = 'os-project-manager';
  assert('#33541-the-account-a-seat-would-post-from-directly-is-outside-the-trusted-set-the-relay-carries-its-records', !live.trustedAuthors.includes(PM_DIRECT));
  const direct = await tierRun({ comments: [recordComment({ by: PM_DIRECT })] });
  assert('⛔ #33541-a-record-posted-DIRECTLY-by-a-seat-account-is-IGNORED-the-entry-reads-NO-record-and-is-refused', direct.exitCode === EXIT_REFUSED_UNAPPROVED && direct.entries[0].record.state === 'absent' && direct.entries[0].record.ignoredAuthors?.join() === PM_DIRECT, JSON.stringify(direct.entries[0].record));
  assert('…and-the-words-name-the-ignored-author-as-information-never-as-a-refusal-of-their-record', /1 comment\(s\) by author\(s\) outside the relay and GOVERNED_APPROVERS were not read: os-project-manager/.test(renderGuardVerdict(direct)) && !/does not read PASS/.test(renderGuardVerdict(direct)), renderGuardVerdict(direct));
  const stranger = await tierRun({ comments: [recordComment({ by: 'drive-by-commenter' })] });
  assert('⛔ #33541-a-stranger-on-a-public-repository-posting-a-perfect-PASS-record-clears-NOTHING', stranger.exitCode === EXIT_REFUSED_UNAPPROVED && stranger.entries[0].record.state === 'absent');
  const authorless = await tierRun({ comments: [recordComment({ by: null })] });
  assert('⛔ #33541-a-record-whose-author-is-UNREADABLE-is-ignored-fail-closed', authorless.exitCode === EXIT_REFUSED_UNAPPROVED && authorless.entries[0].record.state === 'absent' && authorless.entries[0].record.ignoredAuthors?.join() === '(unreadable author)');
  const shadowFail = await tierRun({ comments: [recordComment({ id: 931, at: '2026-09-13T12:00:00Z' }), recordComment({ id: 932, at: '2026-09-13T14:00:00Z', verdictWord: '**VERDICT: FAIL**', by: 'drive-by-commenter' })] });
  assert('#33541-an-untrusted-NEWER-FAIL-cannot-shadow-the-trusted-PASS-it-is-not-read-at-all', shadowFail.exitCode === EXIT_CLEAR && shadowFail.entries[0].record.id === 931, JSON.stringify(shadowFail.entries[0].record));
  const shadowPass = await tierRun({ comments: [recordComment({ id: 933, at: '2026-09-13T12:00:00Z', verdictWord: '**VERDICT: FAIL**' }), recordComment({ id: 934, at: '2026-09-13T14:00:00Z', by: 'drive-by-commenter' })] });
  assert('⛔ #33541-…and-an-untrusted-NEWER-PASS-cannot-lift-the-trusted-FAIL', shadowPass.exitCode === EXIT_REFUSED_UNAPPROVED && shadowPass.entries[0].record.id === 933 && shadowPass.entries[0].record.state === 'not-pass');
  const byApprover = await tierRun({ cardComments: [recordComment({ by: GOVERNED_APPROVERS[0] })] });
  assert('#33541-a-record-posted-by-an-account-in-GOVERNED_APPROVERS-is-read', byApprover.exitCode === EXIT_CLEAR && byApprover.entries[0].record.author === GOVERNED_APPROVERS[0], JSON.stringify(byApprover.entries[0].record));
  assert('#33541-recordAuthorTrusted-is-exact-on-the-login-and-fails-closed-on-no-list', recordAuthorTrusted({ user: { login: RELAY } }, live.trustedAuthors) && !recordAuthorTrusted({ user: { login: RELAY.toUpperCase() } }, live.trustedAuthors) && !recordAuthorTrusted({ user: { login: RELAY } }, null) && !recordAuthorTrusted({ user: { login: '' } }, ['']) && !recordAuthorTrusted({}, live.trustedAuthors));
  const noBot = await loadRecordRecognisers(async (specifier) => (specifier === RECOGNISER_SOURCES.author ? {} : await import(specifier)));
  assert('⛔ #33541-a-loader-that-cannot-read-the-relay-identity-is-unavailable-exit-4-never-a-trust-everyone', noBot.available === false && /trustedAuthors \(FLEET_BOT_LOGIN from \.\/check-handover\.mjs\)/.test(noBot.reason), noBot.reason);
  const unloadedTrust = await tierRun({ comments: [recordComment()], recognisers: { ...live, trustedAuthors: undefined } });
  assert('⛔ #33541-a-recogniser-set-with-no-trusted-list-reads-every-author-as-untrusted', unloadedTrust.exitCode === EXIT_REFUSED_UNAPPROVED && unloadedTrust.entries[0].record.state === 'absent');

  // The reader: the route, and the refusal it throws.
  let seenCommentUrl = '';
  const commentReader = makeCommentReader({
    apiUrl: 'https://api.test',
    slug: 'o/r',
    token: 't',
    fetchImpl: async (url) => { seenCommentUrl = url; return { ok: true, status: 200, json: async () => [{ id: 1, body: 'x' }] }; },
  });
  const readRows = await commentReader(42);
  assert('the-thread-reader-hits-the-issue-comments-route-under-pull-requests-read', /\/repos\/o\/r\/issues\/42\/comments\?per_page=100&page=1$/.test(seenCommentUrl) && readRows.length === 1, seenCommentUrl);
  let commentReaderThrew = false;
  try {
    await makeCommentReader({ apiUrl: 'https://api.test', slug: 'o/r', token: 't', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) })(42);
  } catch { commentReaderThrew = true; }
  assert('⛔ and-a-non-2xx-THROWS-rather-than-returning-an-empty-thread', commentReaderThrew);

  // ⭐ THE PRECONDITION PIN. The lazy import above is legal only while this
  // file's own dispatch carries no top-level await; restore one and the
  // merge-queue build deadlocks (exit 13) instead of judging anything.
  let ownSource = '';
  try {
    ownSource = readFileSync(join(repoRoot, 'scripts', 'pm', 'check-governed-queue-guard.mjs'), 'utf8');
  } catch (error) {
    assert('this-files-own-source-is-readable-so-the-precondition-can-be-pinned', false, String(error?.message ?? error).split('\n')[0]);
  }
  const dispatchBlocks = ownSource
    .split(/(?=if \(isEntrypoint\(import\.meta\.url\))/)
    .slice(1)
    .map((chunk) => chunk.split(/\n\}\s*$/m)[0]);
  assert('both-entrypoint-dispatches-are-found-so-the-pin-below-is-not-vacuous', dispatchBlocks.length === 2, `found ${dispatchBlocks.length}`);
  assert(
    '⭐ NEITHER-dispatch-carries-a-top-level-await-which-is-what-keeps-the-lazy-import-legal',
    dispatchBlocks.length === 2 && dispatchBlocks.every((block) => !/\bawait\b/.test(block) && /\.then\(/.test(block)),
    'a top-level await here deadlocks the recogniser import — see loadRecordRecognisers',
  );
  assert(
    'and-the-recogniser-source-is-the-ONE-file-that-COMPOSES-these-parsers-beside-the-ONE-file-that-declares-the-relay-identity',
    RECOGNISER_SOURCES.tier === './record-recognisers.mjs' && RECOGNISER_SOURCES.author === './check-handover.mjs' && Object.keys(RECOGNISER_SOURCES).length === 2,
    Object.keys(RECOGNISER_SOURCES).join(', '),
  );
  assert(
    '⛔ this-file-spells-NO-tier-prefix-Tier-S-is-the-register-rows-that-carry-S-and-today-that-is-the-whole-claude-tree',
    GOVERNED_SURFACES.filter((s) => s.tier === TIER_S).map((s) => s.glob).join() === '.claude/**' && tierSGlobs() === '.claude/**',
    tierSGlobs(),
  );
  assert(
    '⛔ and-this-leg-added-NO-surface-to-the-register-the-tier-is-a-landing-rule-not-a-membership-one',
    governedPathsIn([REF_A], REPO).length === 1 && governedPathsIn([RULES_PATH], REPO).length === 1,
  );


  // ⭐ Nothing is re-implemented here: the carry lives in the IMPORTED reader
  // and this leg supplies only the git it reads two COMMITTED trees with. ⛔ Its
  // absence REFUSES — a `Regen-provenance:` line certifies nothing by existing.
  battery('⭐ the 2026-09-20 ruling: a certified PURE REGENERATION carries the record to the queued head');
  const REGEN_PROV = { id: 901, created_at: '2026-09-13T13:30:00Z', user: { login: RELAY }, body: `Regen-provenance: 900 · \`${REF_OLD}\` → \`${REF_HEAD}\` · \`git diff --name-only\` → (empty)` };
  const onOldHead = [recordComment({ sha: REF_OLD.slice(0, 12) }), REGEN_PROV];
  const QBASE = 'b'.repeat(40); // the merge group's base sha, which is what main brought
  const qgit = (spec) => (args) => {
    if (args[0] === 'merge-base') return `mb-${args[2]}\n`;
    if (args[0] === 'check-attr') return spec.attrs;
    if (args[0] === 'rev-parse') return `${REF_OLD}\n`;
    const [a, b] = args.slice(-2); // diff -z --name-only --no-renames A B: the two revs are the TAIL
    return a === REF_OLD && b === REF_HEAD ? spec.moved : (spec.own?.[b] ?? '');
  };
  const qRegen = { moved: 'packages/spec/api-surface/ui.txt\0', attrs: 'packages/spec/api-surface/ui.txt\0merge\0os-regen\0' };
  const qCarry = { moved: 'packages/spec/api-surface/ui.txt\0AGENTS.md\0', attrs: 'packages/spec/api-surface/ui.txt\0merge\0os-regen\0AGENTS.md\0merge\0unspecified\0', own: {} };
  const qHand = { moved: 'AGENTS.md\0', attrs: 'AGENTS.md\0merge\0unspecified\0', own: { [REF_HEAD]: 'AGENTS.md\0' } };
  // (ii) an edit SLIPPED IN beside the regeneration: a generated path moved, and
  // so did one of this pull request's own, which its delta at the NEW head names.
  const qSlipped = { moved: 'packages/spec/api-surface/ui.txt\0scripts/pm/x.mjs\0', attrs: 'packages/spec/api-surface/ui.txt\0merge\0os-regen\0scripts/pm/x.mjs\0merge\0unspecified\0', own: { [REF_HEAD]: 'scripts/pm/x.mjs\0' } };
  const gitPure = qgit(qRegen);
  const gitHand = qgit(qSlipped);
  const carried = await tierRun({ comments: onOldHead, runGit: gitPure, baseRef: QBASE });
  const strangerHop = await tierRun({ comments: [onOldHead[0], { ...REGEN_PROV, user: { login: 'drive-by-commenter' } }], runGit: gitPure, baseRef: QBASE });
  assert('⛔ #33541-a-Regen-provenance-hop-posted-by-an-untrusted-author-carries-NOTHING-the-binding-covers-the-carry-chain', strangerHop.exitCode === EXIT_REFUSED_UNAPPROVED && strangerHop.entries[0].record.state === 'absent', JSON.stringify(strangerHop.entries[0].record));
  assert('⭐ a-record-on-an-OLDER-head-CARRIES-when-the-move-is-a-certified-pure-regeneration', carried.exitCode === EXIT_CLEAR && carried.entries[0].record.state === 'stands' && carried.entries[0].record.carriedHops === 1, JSON.stringify(carried.entries[0].record));
  assert('and-the-CLEAR-names-the-head-actually-reviewed-and-says-it-re-ran-on-the-committed-trees', /carried forward over 1 certified PURE-REGENERATION or PROSE-ONLY hop/.test(renderGuardVerdict(carried)) && /COMMITTED trees/.test(renderGuardVerdict(carried)) && /never on the `Regen-provenance:` line being present/.test(renderGuardVerdict(carried)), renderGuardVerdict(carried));
  const handMoved = await tierRun({ comments: onOldHead, runGit: gitHand, baseRef: QBASE });
  assert('⛔ (ii) an-EDIT-SLIPPED-IN-beside-the-regeneration-refuses-exactly-as-an-uncarried-old-head-does', handMoved.exitCode === EXIT_REFUSED_UNAPPROVED && handMoved.entries[0].record.state === 'absent');
  // ⭐ WHICH path is named by the reader that owns the reason; at the queue the
  // refusal surfaces as an absent record, so the name is asserted at its source.
  const { unexplainedPathsBetween } = await import(RECOGNISER_SOURCES.tier);
  assert('…and-the-reader-NAMES-the-slipped-in-path-rather-than-the-generated-one-beside-it', unexplainedPathsBetween(gitHand, { from: REF_OLD, to: REF_HEAD, base: QBASE }).join() === 'scripts/pm/x.mjs', unexplainedPathsBetween(gitHand, { from: REF_OLD, to: REF_HEAD, base: QBASE }).join());
  const blindTree = await tierRun({ comments: onOldHead, runGit: () => { throw new Error('fatal: bad object'); }, baseRef: QBASE });
  assert('⛔ a-tree-this-build-cannot-reach-is-UNREADABLE-exit-4-never-clean', blindTree.exitCode === EXIT_REFUSED_UNREADABLE && blindTree.entries[0].record.state === 'unreadable');
  assert('⛔ and-a-run-with-NO-git-reader-refuses-too-the-line-alone-certifies-nothing', (await tierRun({ comments: onOldHead, baseRef: QBASE })).exitCode === EXIT_REFUSED_UNREADABLE);
  // ⭐ the carry-over arm at the queue: the merge group's OWN base is what
  // separates what main brought from what this pull request changed.
  const carryOver = await tierRun({ comments: onOldHead, runGit: qgit(qCarry), baseRef: QBASE });
  assert('⭐ a-merge-forward-carrying-another-PRs-hand-written-path-beside-the-regeneration-CLEARS', carryOver.exitCode === EXIT_CLEAR && carryOver.entries[0].record.state === 'stands', JSON.stringify(carryOver.entries[0].record));
  const resolved = await tierRun({ comments: onOldHead, runGit: qgit(qHand), baseRef: QBASE });
  assert('⛔ the-SAME-path-hand-resolved-so-the-new-head-no-longer-holds-what-main-brought-REFUSES', resolved.exitCode === EXIT_REFUSED_UNAPPROVED && resolved.entries[0].record.state === 'absent');
  assert('⛔ and-a-group-whose-BASE-this-build-could-not-read-is-UNREADABLE-never-clean', (await tierRun({ comments: onOldHead, runGit: qgit(qCarry) })).exitCode === EXIT_REFUSED_UNREADABLE);
  assert('⛔ CONTROL-the-ordinary-old-head-refusal-is-unmoved-where-no-line-claims-the-exception', (await tierRun({ comments: [recordComment({ sha: REF_OLD.slice(0, 12) })], runGit: gitPure, baseRef: QBASE })).exitCode === EXIT_REFUSED_UNAPPROVED);
  assert('⛔ CONTROL-a-record-on-the-CURRENT-head-still-clears-without-reading-any-tree', (await tierRun({ comments: [recordComment()], runGit: () => { throw new Error('no tree may be read when the record is already on this head'); } })).exitCode === EXIT_CLEAR);
  // ⭐ the PROSE arm at the queue (B′ with C, ruling record 6159870311): a head that moved only on prose
  // faces outside the review surface — the pull request's OWN changeset and docs — carries the record.
  const qProse = { moved: '.changeset/brave-owls.md\0content/docs/guides/x.mdx\0', attrs: '', own: { [REF_HEAD]: '.changeset/brave-owls.md\0content/docs/guides/x.mdx\0' } };
  const qProseCode = { moved: '.changeset/brave-owls.md\0scripts/pm/x.mjs\0', attrs: 'scripts/pm/x.mjs\0merge\0unspecified\0', own: { [REF_HEAD]: '.changeset/brave-owls.md\0scripts/pm/x.mjs\0' } };
  const proseCarried = await tierRun({ comments: onOldHead, runGit: qgit(qProse), baseRef: QBASE });
  assert('⭐ a-record-on-an-OLDER-head-CARRIES-when-the-head-moved-ONLY-on-prose-faces-outside-the-review-surface', proseCarried.exitCode === EXIT_CLEAR && proseCarried.entries[0].record.state === 'stands' && proseCarried.entries[0].record.carriedHops === 1, JSON.stringify(proseCarried.entries[0].record));
  const proseCode = await tierRun({ comments: onOldHead, runGit: qgit(qProseCode), baseRef: QBASE });
  assert('⛔ a-CODE-path-moved-beside-the-prose-REFUSES-exactly-as-an-uncarried-old-head-does', proseCode.exitCode === EXIT_REFUSED_UNAPPROVED && proseCode.entries[0].record.state === 'absent', JSON.stringify(proseCode.entries[0].record));
  // ── the 2026-10-26 ENQUEUE leg: the maintainer's own enqueue IS the review ─
  //
  // 「大部分我还是希望入队，但是我想省掉 Approve」 — an entry an account in
  // GOVERNED_APPROVERS put in the queue satisfies the governed leg (and lifts
  // the size limb) the way an authorized APPROVED review does. The card's four
  // fixtures first, then the shapes that would make the leg fail OPEN: a stale
  // add carried onto a re-entry, a truncated timeline, an approval leg that
  // stopped being read first.
  battery('⭐ the 2026-10-26 ENQUEUE leg: an authorized enqueuer is the human review');
  const SEAT = 'objectstack-fleet[bot]';
  const added = (login, at = '2026-10-26T15:00:00Z') => ({ event: ENQUEUE_EVENT, actor: { login }, created_at: at });
  const removed = (at = '2026-10-26T15:30:00Z') => ({ event: DEQUEUE_EVENT, actor: { login: 'github-merge-queue[bot]' }, created_at: at });
  // The measured #26154 shape: armed by the seat, the platform enqueued later,
  // and the add event's actor is the account that ARMED it.
  const MEASURED_26154 = [
    { event: 'ready_for_review', actor: { login: SEAT } },
    { event: 'auto_merge_enabled', actor: { login: SEAT } },
    added(SEAT, '2026-10-26T14:46:53Z'),
  ];
  assert('the-measured-armed-then-enqueued-shape-reads-the-arming-account', enqueuerFromTimeline(MEASURED_26154).login === SEAT && authorizedEnqueueVerdict(enqueuerFromTimeline(MEASURED_26154)).state === 'unauthorized');
  for (const login of GOVERNED_APPROVERS) {
    assert(`an-enqueue-by-an-authorized-account-is-AUTHORIZED: ${login}`, authorizedEnqueueVerdict(enqueuerFromTimeline([added(login)])).state === 'authorized');
  }
  assert('the-NEWEST-add-is-the-one-read', enqueuerFromTimeline([added(SEAT), removed(), added(GOVERNED_APPROVERS[0], '2026-10-26T16:00:00Z')]).login === GOVERNED_APPROVERS[0]);
  assert('⛔ an-enqueue-by-the-account-removed-2026-11-17-is-UNAUTHORIZED', authorizedEnqueueVerdict(enqueuerFromTimeline([added(RETIRED_APPROVER)])).state === 'unauthorized');
  const staleAdd = authorizedEnqueueVerdict(enqueuerFromTimeline([added(GOVERNED_APPROVERS[0]), removed()]));
  assert('⛔ a-newest-queue-event-that-is-a-REMOVAL-is-UNDETERMINED-an-earlier-authorized-add-is-never-carried-onto-a-re-entry', staleAdd.state === 'undetermined' && /not recorded there yet/.test(staleAdd.reason), JSON.stringify(staleAdd));
  assert('⛔ no-add-event-a-non-list-and-an-actorless-add-are-all-UNDETERMINED',
    ['undetermined'].includes(authorizedEnqueueVerdict(enqueuerFromTimeline([])).state) &&
      authorizedEnqueueVerdict(enqueuerFromTimeline({ message: 'Not Found' })).state === 'undetermined' &&
      authorizedEnqueueVerdict(enqueuerFromTimeline([{ event: ENQUEUE_EVENT, actor: null }])).state === 'undetermined' &&
      authorizedEnqueueVerdict(enqueuerFromTimeline([{ event: ENQUEUE_EVENT, actor: { login: '' } }])).state === 'undetermined');
  assert('the-authorized-set-is-the-ONE-constant-an-account-outside-it-never-counts', authorizedEnqueueVerdict({ state: 'read', login: 'not-authorized' }).state === 'unauthorized' && authorizedEnqueueVerdict(null).state === 'undetermined');

  const AGENTS_ROW = [row(26066, ['AGENTS.md'])];
  const timelineOf = (events) => async () => events;
  const noTimeline = async () => { throw new Error('the timeline must not be read when an authorized approval already satisfies the entry'); };
  const enqueueRun = (fetchReviews, fetchTimeline, rows = AGENTS_ROW, event = EVENT_MERGE_GROUP, extra = {}) =>
    runGuard({ repo: REPO, event, rows, fetchReviews, fetchPull: async () => pull(), fetchTimeline, ...extra });
  // Card fixture 1: enqueued by an authorized account, no review at all.
  const byMaintainer = await enqueueRun(async () => [], timelineOf([added(GOVERNED_APPROVERS[0])]));
  const byMaintainerText = renderGuardVerdict(byMaintainer);
  assert('⭐ FIXTURE-1 enqueued-by-an-authorized-account-with-NO-review-PASSES', byMaintainer.exitCode === EXIT_CLEAR && byMaintainer.conclusion === 'cleared' && satisfiedBy(byMaintainer.entries[0]) === 'enqueue', byMaintainerText);
  assert('and-its-log-names-the-LEG-and-the-ACCOUNT-and-claims-no-approval',
    byMaintainerText.includes(`enqueued by an authorized account: ${GOVERNED_APPROVERS[0]}`) && byMaintainerText.includes('The ENQUEUE leg satisfied 1 of them') &&
      !byMaintainerText.includes('carries an APPROVED review by an') && byMaintainerText.includes('大部分我还是希望入队，但是我想省掉 Approve'), byMaintainerText);
  // Card fixture 2: enqueued by a seat account, no review — today's refusal.
  const bySeat = await enqueueRun(async () => [], timelineOf([added(SEAT)]));
  const bySeatText = renderGuardVerdict(bySeat);
  assert('⛔ FIXTURE-2 enqueued-by-a-seat-account-with-NO-review-is-REFUSED-on-3-with-todays-words',
    bySeat.exitCode === EXIT_REFUSED_UNAPPROVED && bySeatText.includes('NO authorized APPROVED review on this pull request') &&
      bySeatText.includes(`enqueued by ${SEAT}, outside GOVERNED_APPROVERS`), bySeatText);
  // Card fixture 3: a seat enqueue with an authorized APPROVED review — today's leg, and the timeline is never read.
  const seatApproved = await enqueueRun(async () => [approvedAt(GOVERNED_APPROVERS[0], OLD)], noTimeline);
  assert('FIXTURE-3 a-seat-enqueue-with-an-authorized-approval-PASSES-on-the-REVIEW-leg-and-never-reads-the-timeline',
    seatApproved.exitCode === EXIT_CLEAR && satisfiedBy(seatApproved.entries[0]) === 'review' && seatApproved.entries[0].enqueue === undefined && seatApproved.apiCalls === 2 &&
      renderGuardVerdict(seatApproved).includes(`authorized APPROVED review, by: ${GOVERNED_APPROVERS[0]}`), renderGuardVerdict(seatApproved));
  // Card fixture 4: the enqueuer cannot be read and there is no review.
  const unreadEnqueuer = await enqueueRun(async () => [], async () => { throw new Error('HTTP 502'); });
  const unreadEnqueuerText = renderGuardVerdict(unreadEnqueuer);
  assert('⛔ FIXTURE-4 an-UNREADABLE-enqueuer-with-NO-review-is-REFUSED-on-the-approval-legs-code-and-names-UNDETERMINED',
    unreadEnqueuer.exitCode === EXIT_REFUSED_UNAPPROVED && unreadEnqueuer.entries[0].enqueue.state === 'undetermined' &&
      /enqueuer UNDETERMINED — the timeline could not be read \(HTTP 502\)/.test(unreadEnqueuerText), unreadEnqueuerText);
  assert('⛔ a-STALE-authorized-add-before-a-removal-is-REFUSED', (await enqueueRun(async () => [], timelineOf([added(GOVERNED_APPROVERS[0]), removed()]))).exitCode === EXIT_REFUSED_UNAPPROVED);
  assert('⛔ no-timeline-reader-at-all-is-UNDETERMINED-never-a-pass', (await enqueueRun(async () => [], undefined)).exitCode === EXIT_REFUSED_UNAPPROVED);
  const reviewsDown = async () => { throw new Error('HTTP 503'); };
  assert('an-authorized-enqueue-satisfies-ALONE-even-when-the-review-list-cannot-be-read', (await enqueueRun(reviewsDown, timelineOf([added(GOVERNED_APPROVERS[0])]))).exitCode === EXIT_CLEAR);
  assert('⛔ and-a-seat-enqueue-beside-an-unreadable-review-list-still-refuses-on-4', (await enqueueRun(reviewsDown, timelineOf([added(SEAT)]))).exitCode === EXIT_REFUSED_UNREADABLE);
  assert('the-timeline-read-is-COUNTED', bySeat.apiCalls === 3 && byMaintainerText.includes('3 API read(s)'), String(bySeat.apiCalls));
  const enqueuePrLeg = await enqueueRun(async () => [], noTimeline, AGENTS_ROW, EVENT_PULL_REQUEST);
  assert('the-pull_request-leg-reads-NO-timeline-and-carries-NO-enqueue-key', enqueuePrLeg.exitCode === EXIT_CLEAR && enqueuePrLeg.entries[0].enqueue === undefined && !/enqueuer|ENQUEUE leg/.test(renderGuardVerdict(enqueuePrLeg)));
  assert('a-CLEAR-diff-reads-no-timeline-either', (await enqueueRun(noTimeline, noTimeline, [row(1, ['packages/core/src/x.ts'])])).apiCalls === 0);
  const tierSEnqueued = await enqueueRun(async () => [], timelineOf([added(GOVERNED_APPROVERS[0])]), [row(7, ['.claude/agents/os-dev.md'])], EVENT_MERGE_GROUP, {
    fetchComments: async () => { throw new Error('no record thread is read once the maintainer\'s enqueue satisfied the entry'); },
    loadRecognisers: async () => { throw new Error('the recognisers must not be loaded once the maintainer\'s enqueue satisfied the entry'); },
  });
  assert('a-Tier-S-entry-the-maintainer-enqueued-clears-on-the-ENQUEUE-leg-without-reading-a-record',
    tierSEnqueued.exitCode === EXIT_CLEAR && satisfiedBy(tierSEnqueued.entries[0]) === 'enqueue' && !renderGuardVerdict(tierSEnqueued).includes('could NOT be read'), renderGuardVerdict(tierSEnqueued));
  assert('⛔ the-approval-limb-is-still-read-FIRST', satisfiedBy({ approval: { state: 'approved' }, enqueue: { state: 'authorized' } }) === 'review' && satisfiedBy({ approval: { state: 'unapproved' }, enqueue: { state: 'unauthorized' }, tier: TIER_S, record: { state: 'stands' } }) === 'record');

  // The SIZE limb follows the same predicate — through the sibling's lift, never one spelled here.
  const BIG = { additions: 6000, deletions: 1 };
  const bigEnqueued = await runSizeGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: [row(18971, ['packages/x.ts'])], fetchPull: async () => pull(HEAD, { size: BIG }), fetchReviews: async () => [], fetchTimeline: timelineOf([added(GOVERNED_APPROVERS[0])]) });
  const bigEnqueuedText = renderSizeVerdict(bigEnqueued);
  assert('⭐ an-oversized-PR-the-maintainer-ENQUEUED-is-LIFTED-and-the-log-names-the-enqueuer',
    bigEnqueued.exitCode === EXIT_CLEAR && bigEnqueued.entries[0].state === 'lifted' && bigEnqueued.apiCalls === 3 &&
      bigEnqueuedText.includes(`LIFTED by the maintainer's own`) && bigEnqueuedText.includes(`${GOVERNED_APPROVERS[0]} (enqueued it at 2026-10-26T15:00:00Z)`), bigEnqueuedText);
  const bigSeat = await runSizeGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: [row(18971, ['packages/x.ts'])], fetchPull: async () => pull(HEAD, { size: BIG }), fetchReviews: async () => [], fetchTimeline: timelineOf([added(SEAT)]) });
  assert('⛔ an-oversized-PR-a-SEAT-enqueued-is-still-REFUSED-on-8-and-says-why', bigSeat.exitCode === EXIT_REFUSED_OVERSIZED && renderSizeVerdict(bigSeat).includes(`enqueued by ${SEAT}, outside GOVERNED_APPROVERS`), renderSizeVerdict(bigSeat));
  // main()'s own wiring, reproduced: the governed leg's enqueue reading rides into the size leg and is NOT read twice.
  let timelineReads = 0;
  const countedTimeline = async () => { timelineReads += 1; return [added(GOVERNED_APPROVERS[0])]; };
  const bigGovernedRows = [row(26066, ['AGENTS.md'])];
  const bigGoverned = await runGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: bigGovernedRows, fetchReviews: async () => [], fetchPull: async () => pull(HEAD, { size: BIG }), fetchTimeline: countedTimeline });
  const bigGovernedSize = await runSizeGuard({
    repo: REPO, event: EVENT_MERGE_GROUP, rows: bigGovernedRows, fetchPull: async () => pull(HEAD, { size: BIG }), fetchReviews: async () => [], fetchTimeline: countedTimeline,
    approvals: new Map(bigGoverned.entries.map((e) => [e.pr, e.enqueue === undefined ? e.approval : { ...e.approval, enqueue: e.enqueue }])),
  });
  assert('⭐ a-governed-AND-oversized-PR-the-maintainer-enqueued-clears-BOTH-limbs-on-ONE-timeline-read',
    groupExitCode({ governed: bigGoverned, size: bigGovernedSize }) === EXIT_CLEAR && timelineReads === 1 && bigGovernedSize.entries[0].state === 'lifted', String(timelineReads));
  assert('and-main-spells-that-wiring-in-its-own-source', /e\.enqueue === undefined \? e\.approval : \{ \.\.\.e\.approval, enqueue: e\.enqueue \}/.test(readFileSync(fileURLToPath(import.meta.url), 'utf8')) && /fetchTimeline = makeTimelineReader\(reader\)/.test(readFileSync(fileURLToPath(import.meta.url), 'utf8')));

  // The reader: the newest event is on the LAST page, so a truncated walk throws.
  const urls = [];
  const fakeFetch = (pages) => async (url) => { urls.push(url); const page = Number(new URL(url).searchParams.get('page')); return { ok: true, status: 200, json: async () => pages[page - 1] ?? [] }; };
  const twoPages = await makeTimelineReader({ apiUrl: 'https://api.example', slug: 'o/r', token: null, fetchImpl: fakeFetch([[added(SEAT), removed()], [added(GOVERNED_APPROVERS[0])]]), perPage: 2 })(9);
  assert('the-timeline-reader-walks-to-the-short-page-on-the-issues-timeline-route', twoPages.length === 3 && urls[0] === 'https://api.example/repos/o/r/issues/9/timeline?per_page=2&page=1' && enqueuerFromTimeline(twoPages).login === GOVERNED_APPROVERS[0], JSON.stringify(urls));
  // ⛔ A short page that is not the last: the answer's `Link` header names the next page, and the walk follows it.
  const linked = (pages, next) => async (url) => { const page = Number(new URL(url).searchParams.get('page')); return { ok: true, status: 200, headers: { get: (name) => (name.toLowerCase() === 'link' && next(page) ? `<${url.replace(/page=\d+$/, `page=${page + 1}`)}>; rel="next", <${url}>; rel="last"` : null) }, json: async () => pages[page - 1] ?? [] }; };
  const shortThenMore = await makeTimelineReader({ apiUrl: 'https://api.example', slug: 'o/r', token: null, fetchImpl: linked([[added(SEAT)], [added(GOVERNED_APPROVERS[0])]], (page) => page === 1), perPage: 2 })(9);
  const shortAndLast = await makeTimelineReader({ apiUrl: 'https://api.example', slug: 'o/r', token: null, fetchImpl: linked([[added(SEAT)], [added(GOVERNED_APPROVERS[0])]], () => false), perPage: 2 })(9);
  assert('⛔ a-SHORT-page-whose-answer-names-a-next-page-is-NOT-the-last-the-walk-follows-the-Link-header', shortThenMore.length === 2 && enqueuerFromTimeline(shortThenMore).login === GOVERNED_APPROVERS[0] && shortAndLast.length === 1 && enqueuerFromTimeline(shortAndLast).login === SEAT, `${shortThenMore.length} then ${shortAndLast.length}`);
  const neverEnds = await makeTimelineReader({ apiUrl: 'https://api.example', slug: 'o/r', token: null, fetchImpl: linked([[added(SEAT)]], () => true), perPage: 2, maxPages: 3 })(9).then(() => null, (error) => error);
  assert('⛔ a-next-page-named-on-every-answer-THROWS-at-the-page-limit-never-an-early-answer', neverEnds instanceof Error && /never reached/.test(neverEnds.message), String(neverEnds?.message));
  const truncated = await makeTimelineReader({ apiUrl: 'https://api.example', slug: 'o/r', token: null, fetchImpl: fakeFetch([[removed()], [added(GOVERNED_APPROVERS[0])]]), perPage: 1, maxPages: 1 })(9).then(() => null, (error) => error);
  assert('⛔ a-TRUNCATED-timeline-THROWS-rather-than-answering-an-older-add-as-the-newest', truncated instanceof Error && /never reached/.test(truncated.message), String(truncated?.message));
  const denied = await makeTimelineReader({ apiUrl: 'https://api.example', slug: 'o/r', token: null, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) })(9).then(() => null, (error) => error);
  assert('⛔ a-non-2xx-THROWS-and-the-caller-reads-it-as-UNDETERMINED', denied instanceof Error && /HTTP 403/.test(denied.message));

  // ── the CODEOWNERS mirror ─────────────────────────────────────────────────
  //
  // The platform half of "both approvers are asked": `.github/CODEOWNERS` is a
  // static file, so this is the ONE place that proves it mirrors the register's
  // Tier H rows and `GOVERNED_APPROVERS`. The file on disk is read here; the
  // negative controls drive the predicate with fixtures.
  battery('the CODEOWNERS mirror: every Tier H register row routes to every GOVERNED_APPROVERS account, nothing else is routed, and the file says so');
  {
    const onDisk = readFileSync(join(repoRoot, '.github', 'CODEOWNERS'), 'utf8');
    const live = codeownersMirrorVerdict({ text: onDisk });
    assert('⭐ the-file-on-disk-mirrors-the-register-and-the-approver-list', live.ok, live.problems.join(' | '));
    assert('every-Tier-H-row-that-governs-this-repository-is-a-pattern-the-file-carries-or-an-arm-row-it-leaves-out', live.tierHPatterns.length + live.armPatterns.length === governedSurfacesFor(REPO).filter((s) => s.tier === GOVERNED_TIER_H).length && live.tierHPatterns.every((p) => live.rows.some((r) => r.pattern === p)) && live.armPatterns.every((p) => !live.rows.some((r) => r.pattern === p)), JSON.stringify([live.tierHPatterns, live.armPatterns]));
    assert('the-patterns-are-the-register-rows-root-anchored-prefix-or-exact', live.tierHPatterns.join() === '/AGENTS.md,/CLAUDE.md,/docs/NORTH-STAR.md,/.github/workflows/,/scripts/pm/check-governed-merges.mjs,/scripts/pm/check-governed-queue-guard.mjs,/scripts/pm/record-recognisers.mjs,/scripts/pm/dispatch-gates.mjs,/ui/docs/adr/,/ui/.claude/,/ui/AGENTS.md,/ui/CLAUDE.md,/ui/.github/workflows/', live.tierHPatterns.join());
    // Ruling record 6891850019: the rows carrying the low-risk arm leave the file — read off the register's `lowRisk`, never a list here.
    assert('⭐ the-arm-patterns-are-the-register-rows-carrying-the-low-risk-arm-here', live.armPatterns.join() === '/docs/adr/,/skills/,/ui/skills/' && live.armPatterns.join() === governedSurfacesFor(REPO).filter((s) => s.tier === GOVERNED_TIER_H && s.lowRisk?.repos?.includes(REPO)).map((s) => `/${s.prefix ?? s.exact}`).join(), live.armPatterns.join());
    assert('every-line-on-disk-names-every-approver-spelled-as-a-login', live.rows.every((r) => GOVERNED_APPROVERS.every((a) => r.owners.includes(`@${a}`))) && live.rows.length >= live.tierHPatterns.length, JSON.stringify(live.rows));
    assert('the-parser-strips-comments-and-blank-lines-and-splits-owners', JSON.stringify(codeownersRows('# c\n\n/docs/adr/ @a @b # trailing\n  /x.md   @c\n')) === JSON.stringify([{ pattern: '/docs/adr/', owners: ['@a', '@b'], line: 3 }, { pattern: '/x.md', owners: ['@c'], line: 4 }]));
    const owners = GOVERNED_APPROVERS.map((a) => `@${a}`).join(' ');
    const full = (extra = '') => `# mirrors GOVERNED_APPROVERS\n${[...live.tierHPatterns, ...live.splitPatterns].map((p) => `${p} ${owners}`).join('\n')}\n${extra}`;
    assert('a-fixture-carrying-exactly-the-Tier-H-rows-with-every-owner-passes', codeownersMirrorVerdict({ text: full() }).ok);
    // The root ADR row carries the low-risk arm since #33539 and has no line; the ui/ ADR row is the Tier H ADR row here.
    const one = codeownersMirrorVerdict({ text: full().replace(`/ui/docs/adr/ ${owners}`, `/ui/docs/adr/ @${RETIRED_APPROVER}`) });
    assert('⛔ one-approver-on-the-adr-row-is-a-problem-naming-the-row-and-the-missing-account', !one.ok && one.problems.length === 1 && one.problems[0].includes('`/ui/docs/adr/`') && one.problems[0].includes(`@${GOVERNED_APPROVERS[0]}`), one.problems.join(' | '));
    const missing = codeownersMirrorVerdict({ text: full().split('\n').filter((l) => !l.startsWith('/AGENTS.md')).join('\n') });
    assert('⛔ a-Tier-H-row-with-no-arm-and-no-line-is-a-problem-naming-the-row', !missing.ok && missing.problems.length === 1 && missing.problems[0].includes('`agents-md`'), missing.problems.join(' | '));
    assert('⭐ a-per-pull-arm-row-with-no-line-passes', !/^\/(ui\/)?skills\//m.test(full()) && codeownersMirrorVerdict({ text: full() }).ok);
    const armLine = codeownersMirrorVerdict({ text: full(`/skills/ ${owners}\n`) });
    assert('⛔ a-line-routing-an-arm-row-is-a-problem-naming-the-row-even-with-every-owner', !armLine.ok && armLine.problems.length === 1 && armLine.problems[0].includes('`skills-catalog`') && armLine.problems[0].includes('low-risk arm'), armLine.problems.join(' | '));
    const sibling = codeownersMirrorVerdict({ text: full(), repo: 'objectui' });
    assert('⛔ the-arm-is-per-repository-a-sibling-copy-it-does-not-reach-still-owes-the-skills-line', sibling.tierHPatterns.includes('/skills/') && sibling.armPatterns.length === 0 && !sibling.ok && sibling.problems.some((p) => p.includes('`skills-catalog`')), sibling.problems.join(' | '));
    const tierS = codeownersMirrorVerdict({ text: full(`/.claude/ ${owners}\n`) });
    assert('⛔ routing-the-Tier-S-row-is-a-problem-a-seat-record-landing-summons-nobody', !tierS.ok && tierS.problems.length === 1 && tierS.problems[0].includes('`claude-tree`'), tierS.problems.join(' | '));
    const enforcer = codeownersMirrorVerdict({ text: full(`/.github/CODEOWNERS @${RETIRED_APPROVER}\n`) });
    assert('⛔ an-enforcement-chain-row-routed-to-another-owner-set-is-a-problem', !enforcer.ok && enforcer.problems.length === 1 && enforcer.problems[0].includes('enforcement-chain'), enforcer.problems.join(' | '));
    const silent = codeownersMirrorVerdict({ text: full().replace('# mirrors GOVERNED_APPROVERS\n', '') });
    assert('⛔ a-file-that-never-names-the-constant-is-a-problem', !silent.ok && silent.problems.length === 1 && silent.problems[0].includes('GOVERNED_APPROVERS'), silent.problems.join(' | '));
    const other = codeownersMirrorVerdict({ text: onDisk, approvers: ['someone-else'] });
    assert('⭐ the-approver-list-is-READ-not-restated-another-list-reds-the-file-on-disk', !other.ok && other.problems.length >= live.tierHPatterns.length, String(other.problems.length));
    // The nested `ui/` workspace rows (#25712) are live register rows: each lands Tier H, so each has its
    // root-anchored `/ui/…` line on disk, and a file without those lines is short exactly one per row.
    const uiRows = governedSurfacesFor(REPO).filter((s) => s.id.startsWith('ui-'));
    const withoutUi = GOVERNED_SURFACES.filter((s) => !s.id.startsWith('ui-'));
    const uiRouted = uiRows.filter((s) => !s.lowRisk?.repos?.includes(REPO));
    assert('the-ui-patterns-are-root-anchored-under-ui-the-ui-claude-tree-included', uiRows.length === 6 && uiRouted.length === 5 && live.tierHPatterns.filter((p) => p.startsWith('/ui/')).join() === '/ui/docs/adr/,/ui/.claude/,/ui/AGENTS.md,/ui/CLAUDE.md,/ui/.github/workflows/', live.tierHPatterns.join());
    const noUiLines = codeownersMirrorVerdict({ text: onDisk.split('\n').filter((l) => !l.startsWith('/ui/')).join('\n') });
    assert('⛔ without-its-ui-lines-the-file-on-disk-is-short-one-line-per-ui-row-without-an-arm', !noUiLines.ok && noUiLines.problems.length === uiRouted.length && uiRouted.every((r) => noUiLines.problems.some((p) => p.includes(`\`${r.id}\``) && p.includes(`\`/${r.prefix ?? r.exact}\``))) && !noUiLines.problems.some((p) => p.includes('`ui-skills-catalog`')), noUiLines.problems.join(' | '));
    const priorRegister = codeownersMirrorVerdict({ text: onDisk.split('\n').filter((l) => !l.startsWith('/ui/')).join('\n'), register: withoutUi });
    assert('the-register-seam-still-reads-a-register-handed-in-the-one-without-the-ui-rows-passes-the-file-without-their-lines', priorRegister.ok && priorRegister.tierHPatterns.every((p) => !p.startsWith('/ui/')), priorRegister.problems.join(' | '));
    assert('the-ui-rows-govern-objectstack-alone-so-a-sibling-copy-needs-no-ui-line', codeownersMirrorVerdict({ text: full(), repo: 'objectui' }).tierHPatterns.every((p) => !p.startsWith('/ui/')));
  }

  // ── ⭐ the workflows split at the queue (ruling record 6722205630) ────────
  //
  // The register's `workflows` row reads its tier off the diff in this
  // repository (ruling C on #31538): Tier H by path for a release, publish or
  // deploy file, Tier H by a C2 trigger, else Tier S. This guard is the only
  // place the queue reads it, so both directions are pinned here: a measured
  // Tier S reading moves the entry onto the record leg, and every reading the
  // guard could not make — no reading, a first parent it could not resolve, a
  // second commit of the same pull request it did not read — stays Tier H.
  battery('⭐ the workflows split at the queue (ruling record 6722205630)');
  {
    const WF_PATH = '.github/workflows/ci.yml';
    const reading = (tier, path = WF_PATH) => ({ measured: true, reason: null, base: 'b'.repeat(40), head: 'c'.repeat(40), files: [{ path, tier, reasons: tier === TIER_S ? [] : ['an added `permissions:` key'] }] });
    const S_READ = reading(TIER_S);
    const H_READ = reading(TIER_H);
    const withRead = (pr, files, workflowDiff, sha) => ({ ...row(pr, files, sha), workflowDiff });

    const sWork = decomposeGovernedWork([withRead(31538, [WF_PATH], S_READ)], REPO);
    assert('⭐ a-measured-Tier-S-reading-makes-the-workflows-entry-Tier-S', sWork.governed.length === 1 && sWork.governed[0].tier === TIER_S && sWork.governed[0].surfaces[0].splitVerdict?.tier === TIER_S, JSON.stringify(sWork.governed));
    assert('a-Tier-H-reading-keeps-it-Tier-H', decomposeGovernedWork([withRead(31538, [WF_PATH], H_READ)], REPO).governed[0].tier === TIER_H);
    assert('⛔ a-row-with-no-reading-is-Tier-H-and-says-it-was-not-read', (() => { const e = decomposeGovernedWork([row(31538, [WF_PATH])], REPO).governed[0]; return e.tier === TIER_H && e.surfaces[0].splitVerdict?.measured === false && /was not read/.test(e.surfaces[0].splitVerdict.reason); })());
    assert('⛔ an-unmeasured-reading-is-Tier-H', decomposeGovernedWork([withRead(31538, [WF_PATH], { measured: false, reason: 'git failed', files: [] })], REPO).governed[0].tier === TIER_H);
    assert('⛔ two-commits-of-one-PR-one-read-S-one-unread-is-Tier-H', decomposeGovernedWork([withRead(9, [WF_PATH], S_READ, '1'.repeat(40)), row(9, [WF_PATH], '2'.repeat(40))], REPO).governed[0].tier === TIER_H);
    assert('two-commits-of-one-PR-both-read-S-is-Tier-S', decomposeGovernedWork([withRead(9, [WF_PATH], S_READ, '1'.repeat(40)), withRead(9, [WF_PATH], S_READ, '2'.repeat(40))], REPO).governed[0].tier === TIER_S);
    assert('⛔ a-path-the-reading-did-not-classify-is-Tier-H', decomposeGovernedWork([withRead(9, [WF_PATH, '.github/workflows/lint.yml'], S_READ)], REPO).governed[0].tier === TIER_H);
    assert('⛔ a-Tier-S-workflow-reading-beside-a-Tier-H-path-is-Tier-H-ALL-not-ANY', decomposeGovernedWork([withRead(9, [WF_PATH, 'AGENTS.md'], S_READ)], REPO).governed[0].tier === TIER_H);
    assert('a-Tier-S-workflow-reading-beside-a-declared-and-verified-claude-path-is-Tier-S-and-Tier-H-before-its-body-is-read', declared(decomposeGovernedWork([withRead(9, [WF_PATH, '.claude/agents/os-dev.md'], S_READ)], REPO).governed[0]).tier === TIER_S && decomposeGovernedWork([withRead(9, [WF_PATH, '.claude/agents/os-dev.md'], S_READ)], REPO).governed[0].tier === TIER_H);
    assert('⛔ objectui-and-cloud-stay-Tier-H-on-the-same-reading-the-split-names-objectstack-alone', ['objectui', 'cloud'].every((r) => decomposeGovernedWork([withRead(9, [WF_PATH], S_READ)], r).governed[0].tier === TIER_H && governedTierFor([WF_PATH], r, GOVERNED_SURFACES, S_READ) === TIER_H));
    assert('⛔ the-ui-workflows-row-is-not-split', decomposeGovernedWork([withRead(9, ['ui/.github/workflows/ci.yml'], reading(TIER_S, 'ui/.github/workflows/ci.yml'))], REPO).governed[0].tier === TIER_H);
    assert('a-reading-on-a-row-with-no-workflow-path-changes-nothing', JSON.stringify(decomposeGovernedWork([withRead(9, ['AGENTS.md'], S_READ)], REPO)) === JSON.stringify(decomposeGovernedWork([row(9, ['AGENTS.md'])], REPO)));

    // The queue's verdict on it: Tier S takes the record leg, and its words say why.
    const sRefused = run('merge_group', [withRead(31538, [WF_PATH], S_READ)], new Map(), absentRecord(31538));
    const sText = renderGuardVerdict(sRefused);
    assert('⛔ a-Tier-S-workflow-entry-with-no-record-is-REFUSED-at-the-queue', sRefused.exitCode !== EXIT_CLEAR && sRefused.conclusion === 'refused', JSON.stringify(sRefused.conclusion));
    assert('and-its-words-name-the-tier-and-the-split', /landing tier: S/.test(sText) && /Tier S by content/.test(sText) && sText.includes('ruling record 6722205630'), sText);
    const hText = renderGuardVerdict(run('merge_group', [withRead(31538, [WF_PATH], H_READ)], new Map([[31538, authorizedApprovalVerdict([], HEAD)]])));
    assert('a-Tier-H-reading-names-its-trigger-under-the-entry', /landing tier: H/.test(hText) && /Tier H by content/.test(hText) && hText.includes('an added `permissions:` key'), hText);
    const nText = renderGuardVerdict(run('merge_group', [row(31538, [WF_PATH])], new Map([[31538, authorizedApprovalVerdict([], HEAD)]])));
    assert('an-unread-row-says-NOT-MEASURED-and-fail-closed', /content NOT MEASURED/.test(nText) && /fail closed/.test(nText), nText);
    const plainText = renderGuardVerdict(run('merge_group', [row(5, ['AGENTS.md'])], new Map([[5, authorizedApprovalVerdict([], HEAD)]])));
    assert('a-verdict-with-no-workflow-path-carries-no-split-line', !plainText.includes('split ('), plainText);

    // The record leg end to end, through the real recognisers.
    const sPass = await tierRun({ files: [WF_PATH], workflowDiff: S_READ, comments: [recordComment()] });
    assert('⭐ a-Tier-S-workflow-PR-with-a-valid-record-on-the-current-head-CLEARS-with-zero-approvals', sPass.exitCode === EXIT_CLEAR && sPass.entries[0].tier === TIER_S && sPass.entries[0].record?.state === 'stands', JSON.stringify(sPass.entries[0]));
    const sNoRecord = await tierRun({ files: [WF_PATH], workflowDiff: S_READ });
    assert('⛔ and-without-the-record-it-is-refused', sNoRecord.exitCode !== EXIT_CLEAR, String(sNoRecord.exitCode));
    const hWithRecord = await tierRun({ files: [WF_PATH], workflowDiff: H_READ, comments: [recordComment()] });
    assert('⛔ a-Tier-H-workflow-PR-with-only-a-record-is-refused-the-record-is-not-the-human-review', hWithRecord.exitCode === EXIT_REFUSED_UNAPPROVED, String(hWithRecord.exitCode));
    const unreadWithRecord = await tierRun({ files: [WF_PATH], comments: [recordComment()] });
    assert('⛔ an-unread-workflow-PR-with-only-a-record-is-refused', unreadWithRecord.exitCode === EXIT_REFUSED_UNAPPROVED, String(unreadWithRecord.exitCode));

    // The reader the live run calls, against a fake git: which commits it reads.
    const WF_BASE = ['name: CI', 'on:', '  pull_request:', 'jobs:', '  build:', '    name: Build Core', '    runs-on: ubuntu-latest', '    timeout-minutes: 20', '    steps:', '      - uses: actions/checkout@v4', '      - run: pnpm build', ''].join('\n');
    const WF_TIMEOUT = WF_BASE.replace('timeout-minutes: 20', 'timeout-minutes: 30');
    const WF_PERMS = WF_BASE.replace('jobs:\n', 'permissions:\n  contents: write\njobs:\n');
    const M = 'd'.repeat(40);
    const P = 'e'.repeat(40);
    const S_SHA = '5'.repeat(40);
    const H_SHA = '6'.repeat(40);
    const trees = new Map([[M, { [WF_PATH]: WF_BASE }], [P, { [WF_PATH]: WF_BASE }], [S_SHA, { [WF_PATH]: WF_TIMEOUT }], [H_SHA, { [WF_PATH]: WF_PERMS }]]);
    const fakeGit = (calls, { parentThrows = false } = {}) => (argv) => {
      calls.push(argv.join(' '));
      if (argv[0] === 'rev-parse') {
        if (parentThrows) throw new Error('fatal: bad revision');
        return `${P}\n`;
      }
      if (argv[0] === 'ls-tree') {
        const tree = trees.get(argv[4]);
        if (!tree) throw new Error(`fatal: not a tree object: ${argv[4]}`);
        const dirs = argv.slice(6).map((d) => (d.endsWith('/') ? d : `${d}/`));
        return Object.keys(tree).filter((p) => dirs.some((d) => p.startsWith(d))).join('\0');
      }
      if (argv[0] === 'show') {
        const at = argv[1].indexOf(':');
        const text = trees.get(argv[1].slice(0, at))?.[argv[1].slice(at + 1)];
        if (text === undefined) throw new Error(`fatal: path does not exist: ${argv[1]}`);
        return text;
      }
      throw new Error(`unexpected git ${argv.join(' ')}`);
    };
    const prCalls = [];
    const [prRow] = attachWorkflowReadings([row(7, [WF_PATH], S_SHA)], { event: EVENT_PULL_REQUEST, mergeBase: M, runGit: fakeGit(prCalls) });
    assert('the-pull_request-leg-reads-the-net-row-against-the-merge-base', prRow.workflowDiff?.measured === true && prRow.workflowDiff.base === M && prRow.workflowDiff.head === S_SHA && !prCalls.some((c) => c.startsWith('rev-parse')), JSON.stringify(prRow.workflowDiff));
    assert('⭐ a-timeout-edit-read-end-to-end-is-Tier-S', decomposeGovernedWork([prRow], REPO).governed[0].tier === TIER_S, JSON.stringify(prRow.workflowDiff?.files));
    const mgCalls = [];
    const mgRows = attachWorkflowReadings([row(7, [WF_PATH], S_SHA), row(8, [WF_PATH], H_SHA), row(9, ['AGENTS.md'], '7'.repeat(40))], { event: EVENT_MERGE_GROUP, mergeBase: M, runGit: fakeGit(mgCalls) });
    assert('the-merge_group-leg-reads-each-commit-against-its-FIRST-PARENT', mgRows[0].workflowDiff?.base === P && mgCalls.includes(`rev-parse --verify ${S_SHA}^1`) && mgCalls.includes(`rev-parse --verify ${H_SHA}^1`), mgCalls.join(' | '));
    assert('⛔ an-added-permissions-key-read-end-to-end-is-Tier-H', decomposeGovernedWork([mgRows[1]], REPO).governed[0].tier === TIER_H && mgRows[1].workflowDiff.files[0].reasons.length > 0);
    assert('the-inventory-of-the-merge-base-is-read-ONCE-per-run', mgCalls.filter((c) => c === `ls-tree -r -z --name-only ${M} -- .github/workflows .github/actions`).length === 1, mgCalls.join(' | '));
    assert('a-row-with-no-workflow-path-is-passed-through-untouched', mgRows[2].workflowDiff === undefined && !mgCalls.some((c) => c.includes('7'.repeat(40))));
    const [unparented] = attachWorkflowReadings([row(7, [WF_PATH], S_SHA)], { event: EVENT_MERGE_GROUP, mergeBase: M, runGit: fakeGit([], { parentThrows: true }) });
    assert('⛔ a-first-parent-git-cannot-resolve-is-UNMEASURED-and-Tier-H', unparented.workflowDiff?.measured === false && /first parent/.test(unparented.workflowDiff.reason) && decomposeGovernedWork([unparented], REPO).governed[0].tier === TIER_H, JSON.stringify(unparented.workflowDiff));
    const [lostBase] = attachWorkflowReadings([row(7, [WF_PATH], S_SHA)], { event: EVENT_PULL_REQUEST, mergeBase: 'a'.repeat(40), runGit: fakeGit([]) });
    assert('⛔ a-base-git-cannot-read-is-UNMEASURED-and-Tier-H', lostBase.workflowDiff?.measured === false && decomposeGovernedWork([lostBase], REPO).governed[0].tier === TIER_H, JSON.stringify(lostBase.workflowDiff));
    assert('no-rows-attach-nothing', attachWorkflowReadings(undefined, { event: EVENT_MERGE_GROUP, mergeBase: M, runGit: fakeGit([]) }).length === 0);
  }

  battery('⚖️ the low-risk skills arm at the queue: body, labels and every path, read off the pull this leg holds (#33501)');
  {
    const SK = 'skills/objectstack-data/SKILL.md';
    const CS = '.changeset/33501-skills-wording.md';
    const LOW = `Fixes #${REF_CARD}\n\nClause-②: no\nMetadata-protocol: none\n`;
    const CS_TEXT = "---\n'@objectstack/skills': patch\n---\n\nskills: wording\n\nClause-②: no\nMetadata-protocol: none\n";
    // The committed changeset text, by `git show <sha>:<path>`; any other read throws, as git does.
    // `diff-tree --raw -z` rows: every path the fixtures touch, a MODIFIED regular file unless a case says otherwise.
    const rawOf = (rows) => rows.map(([st, mode, p, oldMode = '100644']) => `:${oldMode} ${mode} ${'1'.repeat(40)} ${'2'.repeat(40)} ${st}\0${p}\0`).join('');
    const MODIFIED = rawOf([SK, 'skills/objectstack-data/evals/evals.json', 'skills/objectstack-data/rules/security.md', 'skills/a/rules/guide.md', 'skills/a/rules/permission-guide.md', 'skills/a/rules/security.md', 'skills/objectstack-data/hook.mjs'].map((p) => ['M', '100644', p]).concat([['A', '100644', CS]]));
    const csGit = (text = CS_TEXT, raw = MODIFIED) => (args) => {
      if (args[0] === 'show' && /^[0-9a-f]{40}:\.changeset\//.test(args[1]) && text !== null) return text;
      if (args[0] === 'diff-tree' && args.includes('--raw')) {
        if (raw === null) throw new Error('fatal: bad object');
        return raw;
      }
      throw new Error(`fatal: path not in tree (${args.join(' ')})`);
    };
    // ⭐ The arm's record carries the machine line the arm stands on: `Security-touching: no`.
    const ST_NO = 'Security-touching: no';
    const armRecord = (over = {}) => recordComment({ ...over, prose: [ST_NO, ...(over.prose ?? [])] });
    const armOnOldHead = [armRecord({ sha: REF_OLD.slice(0, 12) }), REGEN_PROV];
    const arm = { files: [SK, CS], prBody: LOW, comments: [armRecord()], timeline: [], runGit: csGit() };
    // The decomposition: a catalog entry is NOT MEASURED there (no row carries a body), and it keeps EVERY path of the PR.
    const split = decomposeGovernedWork([row(33501, [SK, CS, 'packages/spec/src/a.zod.ts'])], REPO).governed[0];
    assert('the-decomposition-reads-a-catalog-entry-Tier-H-NOT-MEASURED-and-keeps-every-path', split.tier === TIER_H && split.surfaces[0].lowRiskVerdict?.measured === false && split.allPaths.join() === `${SK},${CS},packages/spec/src/a.zod.ts` && split.paths.join() === SK, JSON.stringify(split));
    assert('M1-the-decomposition-keeps-each-changeset-with-the-commit-it-is-read-at-ungoverned-commits-included', (() => { const e = decomposeGovernedWork([row(9, [SK], '1'.repeat(40)), row(9, [CS, 'docs/x.md'], '2'.repeat(40))], REPO).governed[0]; return e.changesetRefs.length === 1 && e.changesetRefs[0].sha === '2'.repeat(40) && e.changesetRefs[0].path === CS; })());
    const twoCommits = decomposeGovernedWork([row(9, [SK], '1'.repeat(40)), row(9, ['packages/core/src/x.ts'], '2'.repeat(40))], REPO).governed[0];
    assert('⛔ an-ungoverned-commit-of-the-same-PR-still-counts-its-published-path-is-in-allPaths', twoCommits.allPaths.includes('packages/core/src/x.ts') && readLowRiskTier(twoCommits, REPO, { body: LOW, labels: [], fork: SAME_REPO }, { timeline: { measured: true, reason: null, events: [] }, runGit: csGit() }).tier === TIER_H, JSON.stringify(twoCommits.allPaths));
    const untouched = decomposeGovernedWork([row(9, ['AGENTS.md'])], REPO).governed[0];
    assert('readLowRiskTier-leaves-an-entry-with-no-catalog-row-as-it-was', readLowRiskTier(untouched, REPO, null) === untouched && untouched.tier === TIER_H && !untouched.surfaces.some((s) => s.lowRiskVerdict));

    // ⭐ End to end on the queue leg: pure skills wording + clean changeset, one bare `Clause-②: no`, a same-head PASS record ⇒ the seat's enqueue clears.
    const pass = await tierRun(arm);
    assert('⭐ a-pure-skills-PR-on-Clause-2-no-with-a-same-head-PASS-record-CLEARS-with-zero-approvals', pass.exitCode === EXIT_CLEAR && pass.conclusion === 'cleared' && pass.entries[0].tier === TIER_S && pass.entries[0].record.state === 'stands' && pass.entries[0].record.verdict === 'PASS', JSON.stringify(pass.entries[0]));
    assert('and-the-words-name-the-arm-its-ruling-and-the-PASS-it-read', /low-risk skills arm .*Tier S/.test(renderGuardVerdict(pass)) && renderGuardVerdict(pass).includes(LOW_RISK_ARM_RULING) && /READS PASS, and this one does/.test(renderGuardVerdict(pass)), renderGuardVerdict(pass));
    // ⛔ No record on this head is no `Security-touching: no` line: the arm's record stage reads Tier H, so the entry
    // needs the maintainer and the record leg is never consulted (until this stage, such a PR read Tier S, refused
    // on its absent record).
    const noRecord = await tierRun({ ...arm, comments: [] });
    assert('⛔ CONTROL: the-same-skills-PR-with-NO-record-is-REFUSED-Tier-H-on-the-record-stage', noRecord.exitCode === EXIT_REFUSED_UNAPPROVED && noRecord.entries[0].tier === TIER_H && noRecord.entries[0].record === undefined && /no contract-review record names this head, so no `Security-touching: no` line is established/.test(renderGuardVerdict(noRecord)), renderGuardVerdict(noRecord));
    const old = await tierRun({ ...arm, comments: [armRecord({ sha: REF_OLD.slice(0, 12) })] });
    assert('⛔ a-record-on-an-OLDER-head-is-REFUSED-Tier-H-its-line-does-not-carry-forward', old.exitCode === EXIT_REFUSED_UNAPPROVED && old.entries[0].tier === TIER_H && old.entries[0].record === undefined && /no contract-review record names this head/.test(renderGuardVerdict(old)));

    // ── the arm's RECORD STAGE: the record's `Security-touching:` line, and the `security` label on a card it names ──
    const stage = (v) => v.entries[0].surfaces.find((x) => x.lowRiskVerdict)?.lowRiskVerdict;
    const stageH = (v, why) => v.exitCode === EXIT_REFUSED_UNAPPROVED && v.entries[0].tier === TIER_H && v.entries[0].record === undefined && stage(v).recordStage === 'read' && stage(v).reasons.length === 1 && why.test(stage(v).reasons[0]);
    assert('⭐ RECORD-LINE-CONTROL: the-passing-arm-PR-was-read-through-the-record-stage-its-record-says-Security-touching-no', stage(pass).recordStage === 'read' && stage(pass).tier === TIER_S && stage(pass).reasons.length === 0 && pass.entries[0].record.id === 900);
    const noLine = await tierRun({ ...arm, comments: [recordComment()] });
    assert('⛔ RECORD-LINE: an-arm-PR-whose-PASS-record-LACKS-the-line-reads-Tier-H-at-the-queue-refused-and-the-record-leg-is-never-consulted', stageH(noLine, /^its contract-review record \(PR comment 900\) carries no `Security-touching:` line$/) && /low-risk skills arm .*Tier H/.test(renderGuardVerdict(noLine)) && renderGuardVerdict(noLine).includes('carries no `Security-touching:` line'), renderGuardVerdict(noLine));
    const lineCase = async (prose, why) => stageH(await tierRun({ ...arm, comments: [recordComment({ prose })] }), why);
    assert('⛔ RECORD-LINE: a-record-that-says-yes-reads-Tier-H', await lineCase(['Security-touching: yes'], /reads `Security-touching: yes`$/));
    assert('⛔ RECORD-LINE: a-quoted-no-two-lines-a-fenced-line-trailing-words-or-another-value-are-UNREADABLE-so-Tier-H', await lineCase(['> Security-touching: no'], /is unreadable: its one `Security-touching:` line is a quote/) && await lineCase(['Security-touching: no', '> Security-touching: yes'], /is unreadable: it carries 2 `Security-touching:` lines/) && await lineCase(['```', 'Security-touching: no', '```'], /is unreadable: its one `Security-touching:` line sits inside a code fence/) && await lineCase(['Security-touching: no — wording only'], /is unreadable: its `Security-touching:` line reads/) && await lineCase(['Security-touching: none'], /not exactly `Security-touching: no` or `Security-touching: yes`/));
    assert('⛔ RECORD-LINE: the-line-is-read-off-the-NEWEST-same-head-record-an-older-no-does-not-cover-a-newer-record-without-it', stageH(await tierRun({ ...arm, comments: [armRecord({ id: 901, at: '2026-09-13T12:00:00Z' }), recordComment({ id: 902, at: '2026-09-13T14:00:00Z' })] }), /\(PR comment 902\) carries no `Security-touching:` line/) && (await tierRun({ ...arm, comments: [recordComment({ id: 901, at: '2026-09-13T12:00:00Z' }), armRecord({ id: 902, at: '2026-09-13T14:00:00Z' })] })).exitCode === EXIT_CLEAR);
    assert('⛔ RECORD-LINE: a-record-by-an-author-outside-the-relay-and-GOVERNED_APPROVERS-is-not-read-so-its-no-establishes-nothing', stageH(await tierRun({ ...arm, comments: [armRecord({ by: 'drive-by' })] }), /^no contract-review record names this head/));
    assert('⛔ RECORD-LINE: an-unsigned-record-and-an-unreadable-thread-are-Tier-H-too', stageH(await tierRun({ ...arm, comments: [armRecord({ signed: false })] }), /names no reviewer, so its `Security-touching:` line does not count/) && stageH(await tierRun({ ...arm, commentsThrow: true }), /^its contract-review record was not read \(PR #70's comment thread could not be read \(thread unreadable\)\)/));
    assert('RECORD-LINE: the-line-on-the-CARD-thread-record-counts-like-the-one-on-the-PR', (await tierRun({ ...arm, comments: [], cardComments: [armRecord()] })).exitCode === EXIT_CLEAR && stageH(await tierRun({ ...arm, comments: [], cardComments: [recordComment()] }), /\(card comment 900\) carries no `Security-touching:` line/));
    const cardLabelled = await tierRun({ ...arm, cardLabels: ['tooling', 'Security'] });
    assert('⛔ CARD-LABEL: the-security-label-on-the-LINKED-CARD-keeps-the-PR-Tier-H-though-the-PR-carries-none', stageH(cardLabelled, new RegExp(`^its card #${REF_CARD} carries the \`security\` label$`)) && tierLabelsRead.join() === String(REF_CARD), renderGuardVerdict(cardLabelled));
    assert('⭐ CARD-LABEL-CONTROL: other-labels-on-the-card-do-not', (await tierRun({ ...arm, cardLabels: ['tooling', 'priority:p2'] })).exitCode === EXIT_CLEAR);
    assert('⛔ CARD-LABEL: a-security-label-REMOVED-on-the-card-timeline-keeps-it-Tier-H', stageH(await tierRun({ ...arm, cardTimeline: [{ event: 'labeled', label: { name: 'security' } }, { event: 'unlabeled', label: { name: 'security' } }] }), new RegExp(`^the timeline of its card #${REF_CARD} shows the \`security\` label removed$`)));
    assert('⛔ CARD-LABEL: labels-that-threw-no-label-reader-or-a-card-timeline-that-threw-are-NOT-MEASURED-so-Tier-H', stageH(await tierRun({ ...arm, cardLabels: 'throw' }), /^the labels of its card were not read \(card #69's labels could not be read \(HTTP 403\)\)/) && stageH(await tierRun({ ...arm, cardLabels: null }), /^the labels of its card were not read \(no label reader was supplied to this leg\)/) && stageH(await tierRun({ ...arm, cardTimeline: 'throw' }), /^the timeline of its card #69 was not read \(HTTP 403\), so a removed `security` label cannot be ruled out$/));
    assert('⛔ CARD-LABEL: a-PR-that-names-NO-card-cannot-rule-the-label-out-Tier-H-with-no-label-read', stageH(await tierRun({ ...arm, prBody: 'Clause-②: no\nMetadata-protocol: none\n', branch: 'wording' }), /^the labels of its card were not read \(no card could be derived for it — /) && tierLabelsRead.length === 0);
    // ── EVERY card the pull request NAMES is read (`namedCardNumbers`), not only the one whose thread may carry its
    // record: a `Part of` beside a `Fixes`, a `Refs`, the card the branch is named for — two cards at different
    // strengths, where the delivery relation answers with the stronger one alone.
    const ALSO = 71;
    const alsoLabelled = { cardLabelsBy: { [ALSO]: ['tooling', 'Security'] } };
    const partOfTwo = { ...arm, prBody: `${LOW}\nPart of #${ALSO}\n` };
    const branchTwo = { ...arm, branch: `claude/issue-${ALSO}-x` };
    const refsTwo = { ...arm, prBody: `${LOW}\nRefs #${ALSO}\n` };
    const alsoCarries = new RegExp(`^card #${ALSO}, which it also names, carries the \`security\` label$`);
    const bothRead = () => tierLabelsRead.join() === `${REF_CARD},${ALSO}`;
    assert('⛔ NAMED-CARDS: Fixes-A-plus-Part-of-B-with-security-on-B-reads-Tier-H-naming-card-B', stageH(await tierRun({ ...partOfTwo, ...alsoLabelled }), alsoCarries) && bothRead(), tierLabelsRead.join());
    assert('⛔ NAMED-CARDS: Fixes-A-on-a-branch-named-for-B-with-security-on-B-reads-Tier-H-naming-card-B', stageH(await tierRun({ ...branchTwo, ...alsoLabelled }), alsoCarries) && bothRead(), tierLabelsRead.join());
    assert('⛔ NAMED-CARDS: Fixes-A-plus-Refs-B-with-security-on-B-reads-Tier-H-naming-card-B', stageH(await tierRun({ ...refsTwo, ...alsoLabelled }), alsoCarries) && bothRead(), tierLabelsRead.join());
    assert('⭐ NAMED-CARDS-CONTROL: the-same-three-pulls-with-BOTH-cards-clean-CLEAR-and-the-second-card-costs-two-more-reads', await (async () => {
      const cleared = [];
      for (const shape of [partOfTwo, branchTwo, refsTwo]) {
        const v = await tierRun(shape);
        // pull + reviews + PR thread + card thread + two cards' labels and timelines.
        cleared.push(v.exitCode === EXIT_CLEAR && stage(v).tier === TIER_S && stage(v).reasons.length === 0 && bothRead() && tierApiCalls === 8 && tierThreadsRead.join() === `70,${REF_CARD}`);
      }
      return cleared.join() === 'true,true,true';
    })());
    assert('⛔ NAMED-CARDS: the-label-on-the-card-that-carries-the-record-still-reads-Tier-H-beside-a-clean-second-card', stageH(await tierRun({ ...partOfTwo, cardLabelsBy: { [REF_CARD]: ['security'] } }), new RegExp(`^its card #${REF_CARD} carries the \`security\` label$`)) && bothRead());
    assert('⛔ NAMED-CARDS: a-second-card-whose-labels-or-timeline-could-not-be-read-or-whose-timeline-shows-the-label-removed-is-Tier-H',
      stageH(await tierRun({ ...partOfTwo, cardLabelsBy: { [ALSO]: 'throw' } }), /^the labels of card #71, which it also names, were not read \(card #71's labels could not be read \(HTTP 403\)\), so a `security` label on it cannot be ruled out$/) &&
      stageH(await tierRun({ ...branchTwo, cardTimelineBy: { [ALSO]: 'throw' } }), /^the timeline of card #71, which it also names, was not read \(HTTP 403\), so a removed `security` label cannot be ruled out$/) &&
      stageH(await tierRun({ ...refsTwo, cardTimelineBy: { [ALSO]: [{ event: 'labeled', label: { name: 'security' } }, { event: 'unlabeled', label: { name: 'Security' } }] } }), /^the timeline of card #71, which it also names, shows the `security` label removed$/));
    assert('⛔ NAMED-CARDS: a-pull-that-names-more-cards-than-the-leg-reads-is-Tier-H-with-only-its-first-card-read-and-one-fewer-clears', await (async () => {
      const lines = Array.from({ length: LOW_RISK_NAMED_CARD_LIMIT + 1 }, (_, i) => `Part of #${ALSO + i}`);
      const over = await tierRun({ ...arm, prBody: `${LOW}\n${lines.join('\n')}\n` });
      const overRead = tierLabelsRead.join();
      const atLimit = await tierRun({ ...arm, prBody: `${LOW}\n${lines.slice(1).join('\n')}\n` });
      return stageH(over, /^the other cards it names were not read \(it names 9 more cards \(#71, #72, #73, …\), over the 8 this leg reads\), so a `security` label on one of them cannot be ruled out$/) && overRead === String(REF_CARD) &&
        atLimit.exitCode === EXIT_CLEAR && tierLabelsRead.length === LOW_RISK_NAMED_CARD_LIMIT + 1 && tierLabelsRead[0] === REF_CARD;
    })());
    // ⛔ An entry something else already cleared never reaches the stage: no thread and no label is read for it, and it
    // stays Tier H — cleared by the human leg, never by the arm. An authorized ENQUEUE leaves it `pending` on the one
    // reason that says nothing of the stage was read; an APPROVAL clears before the timeline is read at all, so the
    // arm stops one conjunct earlier (`not-reached`) on the unread timeline.
    assert('⛔ an-arm-entry-an-authorized-enqueue-or-an-approval-CLEARED-spends-no-stage-read-and-stays-Tier-H-on-the-reason-that-says-what-was-not-read', await (async () => {
      const cleared = async (over) => {
        const v = await tierRun({ ...partOfTwo, ...alsoLabelled, ...over });
        const read = stage(v);
        return v.exitCode === EXIT_CLEAR && v.entries[0].tier === TIER_H && v.entries[0].record === undefined && read.reasons.length === 1 &&
          tierLabelsRead.length === 0 && tierThreadsRead.length === 0 && renderGuardVerdict(v).includes(`- ${read.reasons[0]}`) ? `${read.recordStage}: ${read.reasons[0]}` : `✗ ${JSON.stringify(read)}`;
      };
      const enqueued = await cleared({ timeline: [added(GOVERNED_APPROVERS[0])] });
      const approved = await cleared({ reviews: [approvedAt(GOVERNED_APPROVERS[0], REF_HEAD)] });
      return enqueued === 'pending: its contract-review record and the labels of its card were not read, so neither a `Security-touching: no` line nor a card free of the `security` label is established' &&
        approved === 'not-reached: its timeline was not read (the timeline was not read), so a removed `security` label cannot be ruled out';
    })());
    assert('the-record-stage-costs-one-label-read-and-one-card-timeline-read-and-only-where-the-pull-read-conditions-all-hold', await (async () => {
      await tierRun(arm);
      const clean = [tierApiCalls, tierLabelsRead.join(), tierThreadsRead.join()];
      await tierRun({ ...arm, labels: ['security'] });
      const pullH = [tierLabelsRead.length, tierThreadsRead.length];
      await tierRun({ ...arm, reviews: [approvedAt(GOVERNED_APPROVERS[0], REF_HEAD)] });
      const approved = [tierLabelsRead.length, tierThreadsRead.length];
      // pull + reviews + PR thread + card thread + card labels + card timeline (the PR's own timeline is the enqueue leg's read).
      return JSON.stringify(clean) === JSON.stringify([6, String(REF_CARD), `70,${REF_CARD}`]) && pullH.join() === '0,0' && approved.join() === '0,0';
    })());
    assert('⛔ a-recogniser-set-that-did-not-load-leaves-the-arm-entry-Tier-H-on-that-reason-with-no-thread-and-no-label-read', await (async () => { const v = await tierRun({ ...arm, recognisers: { available: false, reason: 'the recognisers would not load: boom' } }); return v.exitCode === EXIT_REFUSED_UNAPPROVED && v.entries[0].tier === TIER_H && v.entries[0].record === undefined && stage(v).recordStage === 'read' && /was not read \(the recognisers would not load: boom\)/.test(stage(v).reasons[0]) && tierThreadsRead.length === 0 && tierLabelsRead.length === 0; })());
    assert('lowRiskRecordStage-builds-the-reading-and-decides-nothing-absent-found-with-its-line-and-not-measured', (() => {
      const pairOf = (rows) => ({ pr: 70, card: REF_CARD, headSha: REF_HEAD, paths: [SK], repo: REPO, prComments: rows, cardComments: [] });
      const found = lowRiskRecordStage({ pair: pairOf([armRecord()]), recognisers: live });
      const absent = lowRiskRecordStage({ pair: pairOf([]), recognisers: live });
      return JSON.stringify(found) === JSON.stringify({ measured: true, reason: null, located: 'found', where: 'PR', id: 900, carried: null, securityTouching: { state: 'read', value: 'no' }, ruleChangeVerified: { state: 'read', value: 'none' }, ruleChangeCarried: null }) &&
        absent.measured === true && absent.located === 'absent' && absent.securityTouching === null &&
        lowRiskRecordStage({ pair: pairOf([armRecord()]), recognisers: { available: false, reason: 'x' } }).measured === false &&
        lowRiskRecordStage({ pair: pairOf([armRecord()]), recognisers: { ...live, reading: undefined } }).measured === false &&
        lowRiskRecordStage({ pair: { ...pairOf([armRecord()]), prComments: undefined }, recognisers: live }).measured === false &&
        lowRiskRecordStage({ pair: pairOf([recordComment()]), recognisers: live }).securityTouching.state === 'missing';
    })());
    assert('readCardLabels-never-throws-and-counts-its-reads-a-card-nobody-could-name-reads-nothing', await (async () => {
      const none = await readCardLabels({ card: { card: null, reason: 'its body names no card' }, fetchLabels: async () => { throw new Error('must not be read'); } });
      const both = await readCardLabels({ card: { card: 69 }, named: [69], fetchLabels: async () => ['a'], fetchTimeline: async () => [] });
      const noTimeline = await readCardLabels({ card: { card: 69 }, named: [69], fetchLabels: async () => ['a'] });
      const notList = await readCardLabels({ card: { card: 69 }, named: [69], fetchLabels: async () => ({}) });
      // ⛔ The cards the pull names were not handed in: the first card is read, `others` says it was not — never "none".
      const unlisted = await readCardLabels({ card: { card: 69 }, fetchLabels: async () => ['a'], fetchTimeline: async () => [] });
      return none.apiCalls === 0 && none.reading.measured === false && /its body names no card/.test(none.reading.reason) &&
        both.apiCalls === 2 && JSON.stringify(both.reading) === JSON.stringify({ measured: true, reason: null, card: 69, labels: ['a'], timeline: { measured: true, reason: null, events: [] }, others: { measured: true, reason: null, cards: [] } }) &&
        noTimeline.apiCalls === 1 && noTimeline.reading.measured === true && noTimeline.reading.timeline.measured === false &&
        notList.reading.measured === false && notList.reading.others === undefined &&
        unlisted.apiCalls === 2 && unlisted.reading.measured === true && JSON.stringify(unlisted.reading.others) === JSON.stringify({ measured: false, reason: 'the cards the pull request names were not listed for this leg', cards: null }) && !('overLimit' in unlisted.reading.others);
    })());
    assert('⛔ readCardLabels-reads-EVERY-named-card-once-in-ascending-order-after-the-first-and-carries-an-unread-one-in-its-place', await (async () => {
      const read = [];
      const labelsOf = { 69: ['a'], 70: ['security'], 72: 'throw' };
      const fetchLabels = async (n) => { read.push(`labels ${n}`); if (labelsOf[n] === 'throw') throw new Error('HTTP 502'); return labelsOf[n] ?? []; };
      const fetchTimeline = async (n) => { read.push(`timeline ${n}`); if (n === 71) throw new Error('HTTP 403'); return []; };
      const all = await readCardLabels({ card: { card: 70 }, named: [72, 69, 70, 71, 69, '71', 0, -3, 1.5, 'x'], fetchLabels, fetchTimeline });
      const others = all.reading.others;
      const over = await readCardLabels({ card: { card: 1 }, named: Array.from({ length: LOW_RISK_NAMED_CARD_LIMIT + 2 }, (_, i) => i + 1), fetchLabels: async () => [], fetchTimeline: async () => [] });
      const atLimit = await readCardLabels({ card: { card: 1 }, named: Array.from({ length: LOW_RISK_NAMED_CARD_LIMIT + 1 }, (_, i) => i + 1), fetchLabels: async () => [], fetchTimeline: async () => [] });
      return read.join() === 'labels 70,timeline 70,labels 69,timeline 69,labels 71,timeline 71,labels 72' && all.apiCalls === 7 &&
        all.reading.card === 70 && all.reading.labels.join() === 'security' && others.measured === true && others.cards.map((c) => c.card).join() === '69,71,72' &&
        others.cards[0].measured === true && others.cards[0].labels.join() === 'a' && others.cards[0].timeline.measured === true &&
        others.cards[1].measured === true && others.cards[1].timeline.measured === false && others.cards[1].timeline.reason === 'HTTP 403' &&
        others.cards[2].measured === false && others.cards[2].reason === "card #72's labels could not be read (HTTP 502)" &&
        over.apiCalls === 2 && over.reading.others.measured === false && over.reading.others.cards === null && over.reading.others.overLimit === true && /^it names 9 more cards \(#2, #3, #4, …\), over the 8 this leg reads$/.test(over.reading.others.reason) &&
        atLimit.apiCalls === 2 * (LOW_RISK_NAMED_CARD_LIMIT + 1) && atLimit.reading.others.measured === true && atLimit.reading.others.cards.length === LOW_RISK_NAMED_CARD_LIMIT;
    })());
    assert('namedCardsOf-lists-the-cards-through-the-recogniser-set-and-answers-null-never-an-empty-list-where-it-cannot', (() => {
      const pull = { number: 70, body: 'Fixes #69\n\nPart of #71', head: { ref: 'claude/issue-73-x' } };
      return namedCardsOf(live, pull).join() === '69,71,73' && namedCardsOf(live, { number: 70, body: 'wording', head: { ref: 'wording' } }).join() === '' &&
        namedCardsOf(live, null) === null && namedCardsOf({ ...live, namedCards: undefined }, pull) === null && namedCardsOf({ available: false, reason: 'x' }, pull) === null &&
        namedCardsOf({ ...live, namedCards: () => 'none' }, pull) === null;
    })());
    assert('makeLabelReader-reads-the-label-NAMES-off-the-issue-labels-route-and-throws-on-a-refusal', await (async () => {
      const urls = [];
      const respond = (b, ok = true, status = 200) => async (url) => { urls.push(url); return { ok, status, json: async () => b }; };
      const args = { apiUrl: 'https://api', slug: 'o/r', token: 't' };
      const names = await makeLabelReader({ ...args, fetchImpl: respond([{ name: 'security' }, { name: 'tooling' }]) })(69);
      let refused = null;
      try { await makeLabelReader({ ...args, fetchImpl: respond({ message: 'no' }, false, 403) })(69); } catch (error) { refused = String(error.message); }
      let notList = null;
      try { await makeLabelReader({ ...args, fetchImpl: respond({ labels: [] }) })(69); } catch (error) { notList = String(error.message); }
      return names.join() === 'security,tooling' && urls[0] === 'https://api/repos/o/r/issues/69/labels?per_page=100&page=1' && /HTTP 403/.test(refused) && /non-array body/.test(notList);
    })());
    assert('readRecordThreads-walks-the-shared-thread-set-once-cuts-each-thread-to-trusted-authors-and-names-the-first-that-threw', await (async () => {
      const read = [];
      const rows = { 70: [armRecord(), armRecord({ id: 901, by: 'some-commenter' })], [REF_CARD]: [armRecord({ id: 902 })] };
      const fetchComments = async (n) => { read.push(n); return rows[n] ?? []; };
      const both = { pr: 70, card: REF_CARD };
      const walked = await readRecordThreads({ pair: both, recognisers: live, fetchComments });
      const cardless = { pr: 70, card: null };
      const one = await readRecordThreads({ pair: cardless, recognisers: live, fetchComments });
      const thrown = await readRecordThreads({ pair: { pr: 70, card: REF_CARD }, recognisers: live, fetchComments: async (n) => { if (n === REF_CARD) throw new Error('HTTP 502'); return []; } });
      return walked.apiCalls === 2 && walked.unreadable === null && walked.ignoredAuthors.join() === 'some-commenter' && both.prComments.map((r) => r.id).join() === '900' && both.cardComments.map((r) => r.id).join() === '902' && read.slice(0, 2).join() === `70,${REF_CARD}` &&
        one.apiCalls === 1 && one.unreadable === null && Array.isArray(cardless.cardComments) && cardless.cardComments.length === 0 &&
        thrown.apiCalls === 2 && thrown.unreadable === `card #${REF_CARD}'s comment thread could not be read (HTTP 502)`;
    })());
    // The whole stage for a caller that holds no thread yet — `--pr` and the relay read the arm through this.
    assert('readLowRiskRecordStage-derives-the-card-reads-both-threads-the-labels-and-the-card-timeline-and-anything-unread-is-NOT-MEASURED', await (async () => {
      const seen = [];
      const pull = { number: 70, body: `Fixes #${REF_CARD}\n\nClause-②: no\nMetadata-protocol: none\n`, head: { ref: 'claude/project-thread-x' } };
      const stageOf = (over = {}) => readLowRiskRecordStage({
        pr: 70, pull, headSha: REF_HEAD, paths: [SK], repo: REPO, recognisers: live,
        fetchComments: async (n) => { seen.push(`comments ${n}`); return n === 70 ? [armRecord()] : []; },
        fetchLabels: async (n) => { seen.push(`labels ${n}`); return ['tooling']; },
        fetchTimeline: async (n) => { seen.push(`timeline ${n}`); return []; },
        ...over,
      });
      const clean = await stageOf();
      const order = seen.join();
      const noLine = await stageOf({ fetchComments: async (n) => (n === 70 ? [recordComment()] : []) });
      const untrusted = await stageOf({ fetchComments: async (n) => (n === 70 ? [armRecord({ by: 'some-commenter' })] : []) });
      const unloaded = await stageOf({ recognisers: { available: false, reason: 'the recognisers would not load: boom' } });
      const noReader = await stageOf({ fetchComments: null, fetchLabels: null });
      const thrown = await stageOf({ fetchComments: async () => { throw new Error('HTTP 502'); } });
      const cardless = await stageOf({ pull: { ...pull, body: 'Clause-②: no\nMetadata-protocol: none\n' } });
      const unreadPull = await stageOf({ pull: null });
      return order === `comments 70,comments ${REF_CARD},labels ${REF_CARD},timeline ${REF_CARD}` && clean.apiCalls === 4 && clean.card.card === REF_CARD &&
        JSON.stringify(clean.record) === JSON.stringify({ measured: true, reason: null, located: 'found', where: 'PR', id: 900, carried: null, securityTouching: { state: 'read', value: 'no' }, ruleChangeVerified: { state: 'read', value: 'none' }, ruleChangeCarried: null }) &&
        JSON.stringify(clean.cardLabels) === JSON.stringify({ measured: true, reason: null, card: REF_CARD, labels: ['tooling'], timeline: { measured: true, reason: null, events: [] }, others: { measured: true, reason: null, cards: [] } }) &&
        noLine.record.securityTouching.state === 'missing' && untrusted.record.located === 'absent' &&
        unloaded.apiCalls === 0 && unloaded.record.measured === false && /would not load: boom/.test(unloaded.record.reason) && unloaded.cardLabels.measured === false &&
        noReader.record.measured === false && /no comment reader was supplied/.test(noReader.record.reason) && noReader.cardLabels.measured === false && /no label reader was supplied/.test(noReader.cardLabels.reason) &&
        thrown.record.measured === false && /PR #70's comment thread could not be read \(HTTP 502\)/.test(thrown.record.reason) && thrown.cardLabels.measured === true &&
        cardless.cardLabels.measured === false && /no card could be derived for it/.test(cardless.cardLabels.reason) && cardless.record.located === 'found' && cardless.apiCalls === 1 &&
        unreadPull.cardLabels.measured === false && /its pull request row could not be read/.test(unreadPull.cardLabels.reason);
    })());

    // ⛔ The verdict: the arm lands on a record that READS PASS, never on one that merely exists.
    const failRecord = await tierRun({ ...arm, comments: [armRecord({ verdictWord: '**VERDICT: FAIL**' })] });
    assert('⛔ a-same-head-FAIL-record-is-REFUSED-on-the-arm', failRecord.exitCode === EXIT_REFUSED_UNAPPROVED && failRecord.entries[0].tier === TIER_S && failRecord.entries[0].record.state === 'not-pass' && failRecord.entries[0].record.verdict === 'FAIL' && /does not read PASS: it reads FAIL/.test(renderGuardVerdict(failRecord)), renderGuardVerdict(failRecord));
    const wordless = await tierRun({ ...arm, comments: [armRecord({ verdictWord: 'pending' })] });
    assert('⛔ a-same-head-record-with-NO-verdict-word-is-REFUSED-on-the-arm', wordless.exitCode === EXIT_REFUSED_UNAPPROVED && wordless.entries[0].record.state === 'not-pass' && /states no verdict/.test(renderGuardVerdict(wordless)));
    const explicitPass = await tierRun({ ...arm, comments: [armRecord({ verdictWord: '**VERDICT: PASS**' })] });
    assert('the-template-VERDICT-PASS-line-clears-the-arm', explicitPass.exitCode === EXIT_CLEAR && explicitPass.entries[0].record.verdict === 'PASS');
    const newestFail = await tierRun({ ...arm, comments: [armRecord({ id: 901, at: '2026-09-13T12:00:00Z' }), armRecord({ id: 902, at: '2026-09-13T14:00:00Z', verdictWord: '**VERDICT: FAIL**' })] });
    assert('⛔ the-NEWEST-same-head-record-is-the-one-whose-verdict-is-read-an-older-PASS-does-not-clear-a-newer-FAIL', newestFail.exitCode === EXIT_REFUSED_UNAPPROVED && newestFail.entries[0].record.id === 902 && newestFail.entries[0].record.state === 'not-pass');
    const noReader = await tierRun({ ...arm, recognisers: { ...live, reading: undefined } });
    // The reader that reads the verdict is the reader that reads the arm's line: without it the arm's record stage is
    // NOT MEASURED (Tier H, the record leg never consulted), and every other Tier S leg still refuses on the verdict.
    const noReaderOther = await tierRun({ comments: [recordComment()], recognisers: { ...live, reading: undefined } });
    assert('⛔ a-recogniser-set-without-the-record-reader-REFUSES-fail-closed-the-arm-at-Tier-H-every-other-Tier-S-leg-on-its-verdict', noReader.exitCode === EXIT_REFUSED_UNAPPROVED && noReader.entries[0].tier === TIER_H && noReader.entries[0].record === undefined && /its contract-review record was not read \(the contract-review record reader was not loaded\)/.test(renderGuardVerdict(noReader)) && noReaderOther.exitCode === EXIT_REFUSED_UNAPPROVED && noReaderOther.entries[0].tier === TIER_S && noReaderOther.entries[0].record.state === 'not-pass' && /verdict reader was not loaded/.test(renderGuardVerdict(noReaderOther)), renderGuardVerdict(noReader));
    assert('the-live-loader-reaches-the-fleet-record-reader-and-its-counting-form', typeof live.reading === 'function' && live.reading('## Contract review\n\n**VERDICT: FAIL**').verdicts.join() === 'FAIL' && live.verdict === undefined && live.verdictLines === undefined);
    assert('lowRiskRecordVerdict-passes-a-non-standing-record-through-and-reads-the-chosen-comment', (() => {
      const absent = { state: 'absent' };
      const pair = { prComments: [{ id: 5, body: '## Contract review\n\n**VERDICT: PASS**' }], cardComments: [] };
      return lowRiskRecordVerdict(absent, pair, live) === absent && lowRiskRecordVerdict({ state: 'stands', id: 5 }, pair, live).verdict === 'PASS' && lowRiskRecordVerdict({ state: 'stands', id: 6 }, pair, live).state === 'not-pass' && lowRiskRecordVerdict({ state: 'stands', id: null }, pair, live).state === 'not-pass';
    })());
    // ⛔ A record CARRIED over prose-only hops stands for the arm only when the hops moved no changeset and no catalog path.
    const armDiffArgs = [];
    const armCarry = (moved) => {
      const tree = qgit({ moved, attrs: '', own: { [REF_HEAD]: moved } });
      return (args) => {
        if (args[0] === 'show') return CS_TEXT;
        if (args[0] === 'diff-tree' && args.includes('--raw')) return MODIFIED;
        if (args.includes('--no-renames')) armDiffArgs.push(args.join(' '));
        return tree(args.filter((a) => a !== '--no-renames'));
      };
    };
    const carriedDocs = await tierRun({ ...arm, comments: armOnOldHead, runGit: armCarry('content/docs/guides/x.mdx\0'), baseRef: QBASE });
    assert('SF1-CONTROL-a-PASS-record-carried-over-a-docs-only-hop-still-clears-the-arm', carriedDocs.exitCode === EXIT_CLEAR && carriedDocs.entries[0].record.carriedHops === 1 && carriedDocs.entries[0].record.verdict === 'PASS', JSON.stringify(carriedDocs.entries[0].record));
    const carriedCs = await tierRun({ ...arm, comments: armOnOldHead, runGit: armCarry(`${CS}\0`), baseRef: QBASE });
    // The carry rule is ONE rule (`lowRiskCarryRefusal`): the arm's record stage applies it first, so a record carried
    // over such a hop no longer establishes its `Security-touching: no` — Tier H, the record leg never consulted.
    assert('⛔ SF1-a-record-carried-over-a-hop-that-rewrote-the-CHANGESET-is-refused-on-the-arm', carriedCs.exitCode === EXIT_REFUSED_UNAPPROVED && carriedCs.entries[0].tier === TIER_H && carriedCs.entries[0].record === undefined && /its contract-review record \(PR comment 900\) was carried from `[0-9a-f]{12}` over hops that moved \.changeset\/33501-skills-wording\.md/.test(renderGuardVerdict(carriedCs)), renderGuardVerdict(carriedCs));
    const carriedLog = await tierRun({ ...arm, comments: armOnOldHead, runGit: armCarry('skills/objectstack-data/CHANGELOG.md\0'), baseRef: QBASE });
    assert('⛔ SF1-a-record-carried-over-a-hop-that-moved-CATALOG-text-a-skill-CHANGELOG-is-refused-on-the-arm', carriedLog.exitCode === EXIT_REFUSED_UNAPPROVED && carriedLog.entries[0].tier === TIER_H && carriedLog.entries[0].record === undefined && /over hops that moved skills\/objectstack-data\/CHANGELOG\.md/.test(renderGuardVerdict(carriedLog)), renderGuardVerdict(carriedLog));
    assert('⛔ SF1-a-carried-record-whose-hops-cannot-be-diffed-or-with-no-git-reader-is-refused', (() => {
      const carriedRec = { state: 'stands', id: 5, carriedFrom: REF_OLD, carriedHops: 1 };
      const rows = { prComments: [{ id: 5, body: '## Contract review\n\n**VERDICT: PASS**' }], cardComments: [], headSha: REF_HEAD };
      return lowRiskRecordVerdict(carriedRec, { ...rows, runGit: () => { throw new Error('fatal: bad object'); } }, live).state === 'not-pass' &&
        lowRiskRecordVerdict(carriedRec, rows, live).state === 'not-pass' &&
        lowRiskRecordVerdict(carriedRec, { ...rows, runGit: () => 'docs/x.md\0' }, live).verdict === 'PASS';
    })());
    assert('⛔ SF2-the-carry-check-diffs-with-no-renames-so-a-rename-lists-both-paths', armDiffArgs.length > 0 && armDiffArgs.every((a) => a === `diff -z --name-only --no-renames ${REF_OLD} ${REF_HEAD}`), JSON.stringify(armDiffArgs));
    assert('⛔ SF2-on-REAL-git-a-skill-renamed-out-of-the-catalog-into-docs-refuses-the-carried-record', (() => {
      const dir = mkdtempSync(join(tmpdir(), 'lowrisk-rename-'));
      try {
        // `gitFreeEnv` (GIT_ENV_ISOLATION_RULE): an inherited GIT_DIR or GIT_INDEX_FILE never reaches the real checkout.
        const g = (args) =>
          execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], {
            cwd: dir,
            encoding: 'utf8',
            env: gitFreeEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        g(['init', '-q']);
        mkdirSync(join(dir, 'skills/a/rules'), { recursive: true });
        writeFileSync(join(dir, 'skills/a/rules/security.md'), 'Never echo a token back.\n'.repeat(20));
        writeFileSync(join(dir, 'skills/a/rules/guide.md'), 'Grant the narrowest set.\n'.repeat(20));
        g(['add', '-A']);
        g(['commit', '-q', '-m', 'a']);
        const from = g(['rev-parse', 'HEAD']).trim();
        mkdirSync(join(dir, 'content/docs'), { recursive: true });
        g(['mv', 'skills/a/rules/security.md', 'content/docs/security.md']);
        g(['commit', '-q', '-m', 'b']);
        const to = g(['rev-parse', 'HEAD']).trim();
        const renamesOn = g(['-c', 'diff.renames=true', 'diff', '-z', '--name-only', from, to]).split('\0').filter(Boolean);
        const rec = { state: 'stands', id: 5, carriedFrom: from, carriedHops: 1 };
        const rows = { prComments: [{ id: 5, body: '## Contract review\n\n**VERDICT: PASS**' }], cardComments: [], headSha: to, runGit: g };
        const v = lowRiskRecordVerdict(rec, rows, live);
        // ⭐ And a rename INTO a security name inside the catalog: `--no-renames` lists BOTH sides, so the
        // carry check names both and the arm's own name test reads the new name (ruling 「标签和路径都读」).
        g(['mv', 'skills/a/rules/guide.md', 'skills/a/rules/permission-guide.md']);
        g(['commit', '-q', '-m', 'c']);
        const to2 = g(['rev-parse', 'HEAD']).trim();
        const into = lowRiskRecordVerdict({ ...rec, carriedFrom: to }, { ...rows, headSha: to2 }, live);
        const bothSides = g(['diff', '-z', '--name-only', '--no-renames', to, to2]).split('\0').filter(Boolean).sort();
        const intoTier = lowRiskArmVerdict(governedPathsIn(bothSides, REPO), REPO, { measured: true, reason: null, paths: [...bothSides, CS], body: LOW, labels: [], timeline: { measured: true, reason: null, events: [] }, fork: SAME_REPO, changesets: { measured: true, reason: null, files: [{ path: CS, text: CS_TEXT }] } });
        // The plain diff names the destination alone (the blind spot); the check names the catalog path.
        return renamesOn.join() === 'content/docs/security.md' && v.state === 'not-pass' && /skills\/a\/rules\/security\.md/.test(v.verdictReason) &&
          bothSides.join() === 'skills/a/rules/guide.md,skills/a/rules/permission-guide.md' && into.state === 'not-pass' &&
          /guide\.md/.test(into.verdictReason) && /permission-guide\.md/.test(into.verdictReason) &&
          intoTier.tier === TIER_H && intoTier.reasons.some((r) => /names security, auth or permission: skills\/a\/rules\/permission-guide\.md/.test(r));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })());
    const nonArmFail = await tierRun({ comments: [recordComment({ verdictWord: '**VERDICT: FAIL**' })] });
    assert('⛔ #33541-the-other-Tier-S-legs-read-the-verdict-too-a-FAIL-record-is-refused-for-them-with-their-own-words', nonArmFail.exitCode === EXIT_REFUSED_UNAPPROVED && nonArmFail.entries[0].record.state === 'not-pass' && nonArmFail.entries[0].record.verdict === 'FAIL' && !/low-risk skills arm lands on a PASS record only/.test(renderGuardVerdict(nonArmFail)), renderGuardVerdict(nonArmFail));

    // ⛔ Each H case, each WITH a valid PASS record: the record leg is never consulted, the entry needs the maintainer.
    const hCase = async (over) => { const v = await tierRun({ ...arm, ...over }); return [v.exitCode, v.entries[0].tier, v.entries[0].record === undefined]; };
    const H = JSON.stringify([EXIT_REFUSED_UNAPPROVED, TIER_H, true]);
    assert('⛔ skills-plus-packages-spec-stays-H', JSON.stringify(await hCase({ files: [SK, CS, 'packages/spec/src/data/field.zod.ts'] })) === H);
    assert('⛔ skills-with-Clause-2-yes-stays-H', JSON.stringify(await hCase({ prBody: `Fixes #${REF_CARD}\n\nClause-②: yes\nMetadata-protocol: none\n` })) === H);
    assert('⛔ skills-with-Clause-2-no-narrowing-stays-H', JSON.stringify(await hCase({ prBody: `Fixes #${REF_CARD}\n\nClause-②: no (narrowing)\nMetadata-protocol: none\n` })) === H);
    assert('⛔ skills-with-NO-Clause-2-line-stays-H', JSON.stringify(await hCase({ prBody: `Fixes #${REF_CARD}\n\nMetadata-protocol: none\n` })) === H);
    assert('⛔ skills-with-the-security-label-stays-H', JSON.stringify(await hCase({ labels: ['security'] })) === H);
    assert('⛔ skills-beside-AGENTS-md-stays-H', JSON.stringify(await hCase({ files: [SK, CS, 'AGENTS.md'] })) === H);
    assert('⛔ a-pull-the-leg-could-not-read-is-NOT-MEASURED-and-H', await (async () => { const v = await tierRun({ ...arm, headThrows: true }); return v.exitCode === EXIT_REFUSED_UNAPPROVED && v.entries[0].tier === TIER_H && v.entries[0].surfaces[0].lowRiskVerdict?.measured === false; })());
    assert('⛔ a-published-path-in-ANOTHER-commit-of-the-same-PR-in-the-group-stays-H', JSON.stringify(await hCase({ extraRows: [row(70, ['ui/packages/react/src/x.tsx'], 'd'.repeat(40), 'y (#70)')] })) === H);

    // ⛔ M1 at the queue: the changesets read at their commits, and the body's `Metadata-protocol: none`.
    assert('⛔ M1-no-changeset-stays-H', JSON.stringify(await hCase({ files: [SK] })) === H);
    assert('⛔ M1-a-changeset-releasing-another-package-stays-H', JSON.stringify(await hCase({ runGit: csGit("---\n'@objectstack/skills': patch\n'@objectstack/spec': minor\n---\n\nClause-②: no\nMetadata-protocol: none\n") })) === H);
    assert('⛔ M1-a-changeset-without-its-declarations-stays-H', JSON.stringify(await hCase({ runGit: csGit("---\n'@objectstack/skills': patch\n---\n\nwording\n") })) === H);
    assert('⛔ M1-a-changeset-git-cannot-show-at-its-commit-stays-H', JSON.stringify(await hCase({ runGit: csGit(null) })) === H);
    assert('⛔ M1-no-git-reader-on-the-leg-stays-H', JSON.stringify(await hCase({ runGit: null })) === H);
    assert('⛔ M1-a-changeset-in-ANOTHER-commit-of-the-PR-is-read-too', JSON.stringify(await hCase({ files: [SK, CS], extraRows: [row(70, ['.changeset/second.md'], 'e'.repeat(40), 'y (#70)')], runGit: (args) => (args[1].endsWith('second.md') ? "---\n'@objectstack/core': patch\n---\n\nClause-②: no\nMetadata-protocol: none\n" : CS_TEXT) })) === H);
    assert('⛔ M1-a-body-without-Metadata-protocol-none-stays-H', JSON.stringify(await hCase({ prBody: `Fixes #${REF_CARD}\n\nClause-②: no\n` })) === H);

    // ⛔ S1: a removed `security` label on the timeline the enqueue leg read; an unread timeline.
    assert('⛔ S1-a-security-label-removed-on-the-timeline-stays-H', JSON.stringify(await hCase({ timeline: [{ event: 'labeled', label: { name: 'security' } }, { event: 'unlabeled', label: { name: 'security' } }] })) === H);
    assert('⛔ S1-a-timeline-that-threw-or-was-never-read-stays-H', JSON.stringify(await hCase({ timeline: 'throw' })) === H && JSON.stringify(await hCase({ timeline: null })) === H);
    // ⛔ S2: exactly one bare `Clause-②: no`.
    assert('⛔ S2-trailing-text-two-lines-or-a-quoted-no-before-a-real-yes-stays-H', JSON.stringify(await hCase({ prBody: `Clause-②: no — wording\nMetadata-protocol: none\n` })) === H && JSON.stringify(await hCase({ prBody: `Clause-②: no\nClause-②: no\nMetadata-protocol: none\n` })) === H && JSON.stringify(await hCase({ prBody: `> Clause-②: no\n\nClause-②: yes\nMetadata-protocol: none\n` })) === H && JSON.stringify(await hCase({ prBody: '```\nClause-②: no\n```\nClause-②: yes\nMetadata-protocol: none\n' })) === H);
    // ⛔ S3: a fork head.
    assert('⛔ S3-a-fork-head-or-an-unread-fork-predicate-stays-H', JSON.stringify(await hCase({ fork: { measured: true, isFork: true, headRepo: 'x/fork', baseRepo: 'o/r' } })) === H && JSON.stringify(await hCase({ fork: null })) === H);
    assert('S3-makePullReader-carries-the-fork-predicate-off-the-same-GET', await (async () => {
      const respond = (b) => async () => ({ ok: true, status: 200, json: async () => b });
      const args = { apiUrl: 'https://api', slug: 'o/r', token: 't' };
      const same = await makePullReader({ ...args, fetchImpl: respond({ head: { sha: HEAD, repo: { full_name: 'o/r' } }, base: { repo: { full_name: 'o/r' } } }) })(7);
      const forked = await makePullReader({ ...args, fetchImpl: respond({ head: { sha: HEAD, repo: null }, base: { repo: { full_name: 'o/r' } } }) })(7);
      return same.fork.measured === true && same.fork.isFork === false && forked.fork.isFork === true;
    })());
    // ⛔ The security NAME test at the queue (ruling 「标签和路径都读」): the label OR the path; a rename read as both paths.
    assert('⛔ SEC-a-security-named-skill-file-stays-H-with-a-PASS-record-and-no-label', JSON.stringify(await hCase({ files: ['skills/objectstack-data/rules/security.md', CS] })) === H);
    assert('⛔ SEC-a-rename-into-or-out-of-a-security-name-in-one-commit-stays-H', JSON.stringify(await hCase({ files: ['skills/a/rules/guide.md', 'skills/a/rules/permission-guide.md', CS] })) === H && JSON.stringify(await hCase({ files: ['skills/a/rules/security.md', 'skills/a/rules/guide.md', CS] })) === H);
    // ⛔ Only a MODIFIED regular catalog file is wording (read off `diff-tree --raw` on each governed commit).
    assert('⛔ STATUS-a-skill-ADDED-in-the-group-stays-H', JSON.stringify(await hCase({ runGit: csGit(CS_TEXT, rawOf([['A', '100644', SK], ['A', '100644', CS]])) })) === H);
    assert('⛔ STATUS-a-skill-DELETED-in-the-group-stays-H', JSON.stringify(await hCase({ runGit: csGit(CS_TEXT, rawOf([['D', '000000', SK], ['A', '100644', CS]])) })) === H);
    assert('⛔ STATUS-a-rename-read-as-delete-plus-add-under-no-renames-stays-H', JSON.stringify(await hCase({ files: ['skills/a/rules/guide.md', 'skills/a/rules/howto.md', CS], runGit: csGit(CS_TEXT, rawOf([['D', '000000', 'skills/a/rules/guide.md'], ['A', '100644', 'skills/a/rules/howto.md'], ['A', '100644', CS]])) })) === H);
    assert('⛔ STATUS-a-SYMLINK-under-the-catalog-stays-H', JSON.stringify(await hCase({ runGit: csGit(CS_TEXT, rawOf([['M', '120000', SK], ['A', '100644', CS]])) })) === H);
    // N10 (record 6888217778): the raw line's OLD mode is read too — a symlink turned regular file, however its
    // status letter reads, and a regular file made executable both change the mode, and any mode change is H.
    assert('⛔ MODE-a-symlink-turned-regular-file-stays-H-on-its-old-mode-as-M-or-as-T', JSON.stringify(await hCase({ runGit: csGit(CS_TEXT, rawOf([['M', '100644', SK, '120000'], ['A', '100644', CS]])) })) === H && JSON.stringify(await hCase({ runGit: csGit(CS_TEXT, rawOf([['T', '100644', SK, '120000'], ['A', '100644', CS]])) })) === H);
    assert('⛔ MODE-a-regular-file-made-executable-stays-H-and-catalogFilesOf-carries-both-modes', JSON.stringify(await hCase({ runGit: csGit(CS_TEXT, rawOf([['M', '100755', SK], ['A', '100644', CS]])) })) === H && JSON.stringify(catalogFilesOf({ shas: ['a'.repeat(40)] }, csGit(CS_TEXT, rawOf([['M', '100755', SK]]))).files) === JSON.stringify([{ path: SK, status: 'modified', oldMode: '100644', mode: '100755' }]));
    assert('⛔ STATUS-a-status-read-that-throws-or-misses-the-path-stays-H', JSON.stringify(await hCase({ runGit: csGit(CS_TEXT, null) })) === H && JSON.stringify(await hCase({ runGit: csGit(CS_TEXT, rawOf([['A', '100644', CS]])) })) === H);
    assert('catalogFilesOf-reads-status-and-mode-per-commit-and-fails-closed', (() => {
      const e = { shas: ['a'.repeat(40), 'b'.repeat(40)] };
      const per = { ['a'.repeat(40)]: rawOf([['A', '100644', SK]]), ['b'.repeat(40)]: rawOf([['M', '100644', SK]]) };
      const r = catalogFilesOf(e, (args) => per[args[args.length - 1]]);
      return r.measured === true && r.files.map((f) => `${f.status}:${f.mode}`).join() === 'added:100644,modified:100644' &&
        catalogFilesOf(e, null).measured === false && catalogFilesOf({ shas: [] }, () => '').measured === false &&
        catalogFilesOf(e, () => { throw new Error('x'); }).measured === false;
    })());
    // ⛔ S4: under the catalog only Markdown and `evals/*.json`.
    assert('⛔ S4-a-script-under-skills-stays-H-an-evals-json-does-not', JSON.stringify(await hCase({ files: [SK, CS, 'skills/objectstack-data/hook.mjs'] })) === H && (await tierRun({ ...arm, files: [SK, CS, 'skills/objectstack-data/evals/evals.json'] })).exitCode === EXIT_CLEAR);

    // The pull_request leg reads no body: the early warning says Tier H, NOT MEASURED, and that the queue leg reads it.
    const early = await tierRun({ ...arm, event: EVENT_PULL_REQUEST });
    assert('the-pull_request-leg-names-the-arm-NOT-MEASURED-and-never-reddens', early.entries[0].tier === TIER_H && /low-risk skills arm .*NOT MEASURED/.test(renderGuardVerdict(early)) && /queue guard reads it on the queue leg/.test(renderGuardVerdict(early)), renderGuardVerdict(early));
  }

  battery('⚖️ the ADR leg at the queue: an add-only note clears on its PASS record, any other ADR change is H (#33539)');
  {
    const ADR = 'docs/adr/0097-upstream-availability.md';
    const LOW = `Fixes #${REF_CARD}\n\nClause-②: no\nMetadata-protocol: none\n`;
    const RECORD = ['# ADR-0097: Upstream availability', '', '**Status**: Accepted (2026-07-15)', '', '## Context', '', 'Why.', '', '## Decision', '', 'Refuse it.', '', '## Consequences', '', 'Some.'];
    const patchOf = (ops) => {
      const oldN = ops.filter(([m]) => m !== '+').length;
      const newN = ops.filter(([m]) => m !== '-').length;
      return `diff --git a/${ADR} b/${ADR}\n--- a/${ADR}\n+++ b/${ADR}\n@@ -1,${oldN} +1,${newN} @@\n${ops.map(([m, t]) => `${m}${t}`).join('\n')}\n`;
    };
    const keep = (lines) => lines.map((t) => [' ', t]);
    const NOTE = patchOf([...keep(RECORD), ['+', ''], ['+', '## Amendment notes'], ['+', ''], ['+', '> **Note (2026-11-15).** The refusal names its code.']]);
    const REMOVED = patchOf([...keep(RECORD.slice(0, 10)), ['-', 'Refuse it.'], ['+', 'Refuse it loudly.'], ...keep(RECORD.slice(11))]);
    const STATUS = patchOf([...keep(RECORD.slice(0, 3)), ['+', '**Status**: Superseded by ADR-0154'], ...keep(RECORD.slice(3))]);
    const UNDER = patchOf([...keep(RECORD.slice(0, 11)), ['+', '> **Note.** It also logs.'], ...keep(RECORD.slice(11))]);
    const rawOf = (rows) => rows.map(([st, mode, p, oldMode = '100644']) => `:${oldMode} ${mode} ${'1'.repeat(40)} ${'2'.repeat(40)} ${st}\0${p}\0`).join('');
    // `diff-tree --raw` names the status; `diff-tree -p` the commit's diff of the one ADR path; anything else throws, as git does.
    const adrGit = (patch = NOTE, raw = rawOf([['M', '100644', ADR]])) => (args) => {
      if (args[0] === 'diff-tree' && args.includes('--raw')) return raw;
      if (args[0] === 'diff-tree' && args.includes('-p') && args[args.length - 1] === `:(literal)${ADR}` && args[args.length - 2] === '--') {
        if (patch === null) throw new Error('fatal: bad object');
        return patch;
      }
      throw new Error(`fatal: unexpected read (${args.join(' ')})`);
    };
    // The ADR leg is the same arm: its record carries the arm's machine line, `Security-touching: no`.
    const arm = { files: [ADR], prBody: LOW, comments: [recordComment({ prose: ['Security-touching: no'] })], timeline: [], runGit: adrGit() };
    const hCase = async (over) => { const v = await tierRun({ ...arm, ...over }); return [v.exitCode, v.entries[0].tier, v.entries[0].record === undefined]; };
    const H = JSON.stringify([EXIT_REFUSED_UNAPPROVED, TIER_H, true]);

    // ⭐ ROW 1: an add-only note, no changeset owed, a same-head PASS record ⇒ the seat's enqueue clears with zero approvals.
    const pass = await tierRun(arm);
    assert('⭐ ROW-1-an-add-only-ADR-note-with-a-same-head-PASS-record-CLEARS-at-the-queue-with-zero-approvals', pass.exitCode === EXIT_CLEAR && pass.entries[0].tier === TIER_S && pass.entries[0].record.verdict === 'PASS', renderGuardVerdict(pass));
    const noRecord = await tierRun({ ...arm, comments: [] });
    // No record is no `Security-touching: no` line: Tier H on the arm's record stage (it read Tier S, refused on its absent record, before that stage).
    assert('⛔ CONTROL: the-same-ADR-note-with-NO-record-is-REFUSED-Tier-H-on-the-record-stage', noRecord.exitCode === EXIT_REFUSED_UNAPPROVED && noRecord.entries[0].tier === TIER_H && noRecord.entries[0].record === undefined && /no contract-review record names this head/.test(renderGuardVerdict(noRecord)));
    assert('⛔ RECORD-LINE: an-ADR-note-whose-PASS-record-lacks-the-Security-touching-line-reads-Tier-H-and-a-security-labelled-card-does-too', JSON.stringify(await hCase({ comments: [recordComment()] })) === H && JSON.stringify(await hCase({ cardLabels: ['security'] })) === H);
    assert('⛔ NAMED-CARDS: an-ADR-note-that-also-names-a-security-labelled-card-reads-Tier-H-and-clears-when-that-card-is-clean', JSON.stringify(await hCase({ prBody: `${LOW}\nPart of #71\n`, cardLabelsBy: { 71: ['security'] } })) === H && tierLabelsRead.join() === `${REF_CARD},71` && (await tierRun({ ...arm, prBody: `${LOW}\nPart of #71\n` })).exitCode === EXIT_CLEAR);
    // ⛔ ROWS 2–6, each WITH a valid PASS record: the record leg is never consulted.
    assert('⛔ ROW-2-a-removed-line-stays-H', JSON.stringify(await hCase({ runGit: adrGit(REMOVED) })) === H);
    assert('⛔ ROW-3-a-changed-or-added-Status-line-stays-H', JSON.stringify(await hCase({ runGit: adrGit(STATUS) })) === H);
    assert('⛔ ROW-4-a-line-under-the-Decision-heading-stays-H', JSON.stringify(await hCase({ runGit: adrGit(UNDER) })) === H);
    assert('⛔ ROW-5-a-new-ADR-file-stays-H', JSON.stringify(await hCase({ files: ['docs/adr/0200-new.md'], runGit: adrGit(NOTE, rawOf([['A', '100644', 'docs/adr/0200-new.md', '000000']])) })) === H);
    assert('⛔ ROW-6-a-rename-read-as-delete-plus-add-stays-H', JSON.stringify(await hCase({ files: [ADR, 'docs/adr/0097-upstream.md'], runGit: adrGit(NOTE, rawOf([['D', '000000', ADR], ['A', '100644', 'docs/adr/0097-upstream.md', '000000']])) })) === H);
    // ⛔ Fail closed, and the arm's other conditions held for the ADR leg.
    assert('⛔ a-diff-the-leg-could-not-read-stays-H-and-catalogFilesOf-carries-it-as-null', JSON.stringify(await hCase({ runGit: adrGit(null) })) === H && catalogFilesOf({ shas: ['a'.repeat(40)] }, adrGit(null)).files[0].patch === null && catalogFilesOf({ shas: ['a'.repeat(40)] }, adrGit()).files[0].patch === NOTE);
    assert('⛔ an-ADR-note-on-Clause-2-yes-with-a-security-label-or-beside-NORTH-STAR-stays-H', JSON.stringify(await hCase({ prBody: `Fixes #${REF_CARD}\n\nClause-②: yes\nMetadata-protocol: none\n` })) === H && JSON.stringify(await hCase({ labels: ['security'] })) === H && JSON.stringify(await hCase({ files: [ADR, 'docs/NORTH-STAR.md'] })) === H);
    assert('⛔ an-ADR-note-in-one-commit-and-an-edit-in-another-commit-of-the-same-PR-stays-H', JSON.stringify(await hCase({ extraRows: [row(70, [ADR], 'd'.repeat(40), 'y (#70)')], runGit: (args) => (args.includes('-p') ? (args.includes('d'.repeat(40)) ? REMOVED : NOTE) : rawOf([['M', '100644', ADR]])) })) === H);
    // The pull_request leg reads no body: the early warning stays Tier H, NOT MEASURED.
    const early = await tierRun({ ...arm, event: EVENT_PULL_REQUEST });
    assert('the-pull_request-leg-reads-an-ADR-note-NOT-MEASURED-and-never-reddens', early.entries[0].tier === TIER_H && /low-risk skills arm .*NOT MEASURED/.test(renderGuardVerdict(early)), renderGuardVerdict(early));
    // The diff argv the leg asks git for is the register's, one commit against its first parent.
    assert('catalogFilesOf-asks-for-the-commit-diff-against-its-first-parent-at-full-context', (() => {
      const asked = [];
      catalogFilesOf({ shas: ['a'.repeat(40)] }, (args) => { asked.push(args); return args.includes('--raw') ? rawOf([['M', '100644', ADR]]) : NOTE; });
      const p = asked.find((a) => a.includes('-p'));
      return Boolean(p) && p.join(' ') === addOnlyDiffArgv(['diff-tree', '-p', '--no-commit-id', '-m', '--first-parent'], ['a'.repeat(40)], ADR).join(' ');
    })());
  }

  // ── the guard instruments and the `.claude/**` declaration split at the queue (2026-11-19, card #35321) ──
  //
  // The card's "done when", branch by branch, through the REAL orchestrator and the real recognisers: each
  // refusal beside the one-fact-away fixture that clears, so no branch is green because everything refuses.
  battery('⚖️ #35321 at the queue: guard instruments are Tier H, `.claude/**` splits by declaration');
  {
    const split = (v) => v.entries[0].surfaces.find((s) => s.ruleChangeVerdict)?.ruleChangeVerdict;
    const words = (v) => renderGuardVerdict(v);
    const GUARD_FILES = ['scripts/pm/check-governed-merges.mjs', 'scripts/pm/check-governed-queue-guard.mjs', 'scripts/pm/record-recognisers.mjs', 'scripts/pm/dispatch-gates.mjs'];

    // Item 1: a guard file is Tier H — a valid record lands nothing, an authorized approval does.
    for (const file of GUARD_FILES) {
      const refused = await tierRun({ files: [file], comments: [recordComment()] });
      const approved = await tierRun({ files: [file], reviews: [approvedAt(GOVERNED_APPROVERS[0], REF_HEAD)] });
      assert(`⛔ guard-file-is-Tier-H-a-PASS-record-does-not-land-it-and-an-authorized-approval-does: ${file}`,
        refused.exitCode === EXIT_REFUSED_UNAPPROVED && refused.entries[0].tier === TIER_H && refused.entries[0].record === undefined && /landing tier: H/.test(words(refused)) && words(refused).includes(file) &&
          approved.exitCode === EXIT_CLEAR && approved.conclusion === 'cleared',
        words(refused));
    }
    assert('control-a-sibling-script-is-not-governed-and-costs-no-read',
      await (async () => { const v = await tierRun({ files: ['scripts/pm/check-governed-prose.mjs', 'scripts/pm/check-half-states.mjs'] }); return v.conclusion === 'clear' && v.apiCalls === 0 && tierApiCalls === 0; })());
    assert('⛔ a-guard-file-beside-a-declared-and-verified-claude-path-keeps-the-whole-entry-Tier-H',
      await (async () => { const v = await tierRun({ files: [SKILL_PATH, GUARD_FILES[0]], comments: [recordComment()] }); return v.exitCode === EXIT_REFUSED_UNAPPROVED && v.entries[0].tier === TIER_H && v.entries[0].record === undefined; })());

    // Item 2: `.claude/` wording with both lines.
    const both = await tierRun({ files: [SKILL_PATH], comments: [recordComment()] });
    assert('⭐ claude-wording-with-both-lines-is-Tier-S-and-clears-on-its-record',
      both.exitCode === EXIT_CLEAR && both.conclusion === 'cleared' && both.entries[0].tier === TIER_S && both.entries[0].record.state === 'stands' && both.entries[0].record.verdict === 'PASS' &&
        split(both).declared === 'none' && split(both).recordStage === 'deferred' && ruleChangeDeclaredOn(both.entries[0]) === 'none' && /declaration split .*Tier S — the PR body declares `Rule-change: none`/.test(words(both)),
      words(both));
    const ruledBody = { prBody: `Fixes #${REF_CARD}\n\nRuling-ref: 「同意」 — the maintainer, the review thread, 2026-11-19 04:30Z`, ruleChange: 'ruled' };
    const ruled = await tierRun({ files: [SKILL_PATH], ...ruledBody, comments: [recordComment({ ruleVerified: 'ruled' })] });
    assert('⭐ a-ruled-copy-with-its-Ruling-ref-clears-on-a-record-that-verifies-ruled', ruled.exitCode === EXIT_CLEAR && ruled.entries[0].tier === TIER_S && ruleChangeDeclaredOn(ruled.entries[0]) === 'ruled', words(ruled));
    assert('⛔ ruled-without-a-Ruling-ref-is-Tier-H-and-a-record-that-verifies-none-does-not-verify-ruled',
      await (async () => {
        const bare = await tierRun({ files: [SKILL_PATH], ruleChange: 'ruled', comments: [recordComment({ ruleVerified: 'ruled' })] });
        const other = await tierRun({ files: [SKILL_PATH], ...ruledBody, comments: [recordComment({ ruleVerified: 'none' })] });
        return bare.exitCode === EXIT_REFUSED_UNAPPROVED && bare.entries[0].tier === TIER_H && /carries no `Ruling-ref:` line/.test(words(bare)) &&
          other.exitCode === EXIT_REFUSED_UNAPPROVED && other.entries[0].tier === TIER_S && other.entries[0].record.state === 'not-pass' && /reads `Rule-change-verified: none`, and the PR body declares `Rule-change: ruled`/.test(other.entries[0].record.verdictReason);
      })());

    // Item 2: the missing line and `yes` — Tier H, the record never consulted, an approval still lands it.
    const missing = await tierRun({ files: [SKILL_PATH], ruleChange: null, comments: [recordComment()] });
    assert('⛔ missing-line-is-Tier-H-refused-with-a-valid-record-on-the-head',
      missing.exitCode === EXIT_REFUSED_UNAPPROVED && missing.entries[0].tier === TIER_H && missing.entries[0].record === undefined && tierThreadsRead.length === 0 &&
        /declaration split .*Tier H —/.test(words(missing)) && /carries no `Rule-change:` line/.test(words(missing)) && /landing tier: H\(人合\) — waits/.test(words(missing)),
      words(missing));
    const yes = await tierRun({ files: [SKILL_PATH], ruleChange: 'yes', comments: [recordComment({ ruleVerified: 'yes' })] });
    assert('⛔ Rule-change-yes-is-Tier-H-refused-whatever-the-record-says',
      yes.exitCode === EXIT_REFUSED_UNAPPROVED && yes.entries[0].tier === TIER_H && yes.entries[0].record === undefined && /declares `Rule-change: yes`/.test(words(yes)), words(yes));
    assert('control-an-authorized-approval-lands-each-of-the-two-and-reads-no-thread',
      await (async () => {
        const out = [];
        for (const ruleChange of [null, 'yes']) { const v = await tierRun({ files: [SKILL_PATH], ruleChange, reviews: [approvedAt(GOVERNED_APPROVERS[0], REF_HEAD)] }); out.push(v.exitCode === EXIT_CLEAR && tierThreadsRead.length === 0); }
        return out.every(Boolean);
      })());
    assert('⛔ a-declaration-that-is-quoted-fenced-doubled-or-followed-by-words-is-Tier-H',
      await (async () => {
        const out = [];
        for (const line of ['> Rule-change: none', '```\nRule-change: none\n```', 'Rule-change: none\nRule-change: none', 'Rule-change: none — wording only', '`Rule-change`: none']) {
          const v = await tierRun({ files: [SKILL_PATH], ruleChange: null, prBody: `Fixes #${REF_CARD}\n\n${line}`, comments: [recordComment()] });
          out.push(v.exitCode === EXIT_REFUSED_UNAPPROVED && v.entries[0].tier === TIER_H);
        }
        return out.every(Boolean);
      })());

    // Item 2: a record that does not verify — Tier S on the declaration, refused on the record leg, by name.
    const unverified = { 'no line on the record': null, 'the record reads yes': 'yes', 'the record verifies the other value': 'ruled' };
    for (const [name, ruleVerified] of Object.entries(unverified)) {
      const v = await tierRun({ files: [SKILL_PATH], comments: [recordComment({ ruleVerified })] });
      assert(`⛔ unverified-is-REFUSED-on-the-record-leg: ${name}`,
        v.exitCode === EXIT_REFUSED_UNAPPROVED && v.entries[0].tier === TIER_S && v.entries[0].record.state === 'not-pass' && /declaration split is not verified/.test(v.entries[0].record.verdictReason) && v.entries[0].record.verdictReason.includes('comment 900'),
        JSON.stringify(v.entries[0].record));
    }
    assert('⛔ an-unreadable-line-on-the-record-is-REFUSED-too-two-lines-a-quoted-one-trailing-words',
      await (async () => {
        const out = [];
        for (const prose of [['Rule-change-verified: none'], ['> Rule-change-verified: yes']]) { const v = await tierRun({ files: [SKILL_PATH], comments: [recordComment({ prose })] }); out.push(v.exitCode === EXIT_REFUSED_UNAPPROVED && v.entries[0].record.state === 'not-pass' && /unreadable/.test(v.entries[0].record.verdictReason)); }
        const trailing = await tierRun({ files: [SKILL_PATH], comments: [recordComment({ ruleVerified: 'none — wording only' })] });
        return out.every(Boolean) && trailing.entries[0].record.state === 'not-pass';
      })());
    assert('⛔ a-verified-line-on-a-record-that-does-not-read-PASS-or-names-an-older-head-lands-nothing',
      await (async () => {
        const fail = await tierRun({ files: [SKILL_PATH], comments: [recordComment({ verdictWord: '**VERDICT: FAIL**' })] });
        const old = await tierRun({ files: [SKILL_PATH], comments: [recordComment({ sha: REF_OLD.slice(0, 12) })] });
        return fail.exitCode === EXIT_REFUSED_UNAPPROVED && fail.entries[0].record.state === 'not-pass' && old.exitCode === EXIT_REFUSED_UNAPPROVED && old.entries[0].record.state === 'absent';
      })());
    assert('ruleChangeRecordVerdict-leaves-a-record-that-does-not-stand-as-it-was-and-refuses-a-carry-it-cannot-diff',
      ruleChangeRecordVerdict({ state: 'absent' }, {}, live, 'none').state === 'absent' && ruleChangeRecordVerdict({ state: 'below-tier' }, {}, live, 'none').state === 'below-tier' &&
        ((v) => v.state === 'not-pass' && /could not diff the hops/.test(v.verdictReason))(ruleChangeRecordVerdict({ state: 'stands', id: 900, carriedFrom: 'a'.repeat(40) }, { headSha: REF_HEAD }, live, 'none')) &&
        /moved \.claude\/x\.md/.test(ruleChangeCarryRefusal('a'.repeat(40), { headSha: REF_HEAD, runGit: () => '.claude/x.md\0.changeset/a.md\0' })) &&
        ruleChangeCarryRefusal('a'.repeat(40), { headSha: REF_HEAD, runGit: () => '.changeset/a.md\0CHANGELOG.md\0' }) === null &&
        ruleChangeDeclaredOn({ tier: TIER_H, surfaces: [] }) === null && ruleChangeDeclaredOn(null) === null);

    // Item 2: settings and hooks — Tier H by path on the reading that lands anything else under the row.
    for (const file of [SETTINGS_PATH, '.claude/settings.local.json', HOOK_PATH]) {
      const v = await tierRun({ files: [file], comments: [recordComment()] });
      const mixed = await tierRun({ files: [file, SKILL_PATH], comments: [recordComment()] });
      assert(`⛔ settings-and-hooks-are-Tier-H-with-both-lines-on-record: ${file}`,
        v.exitCode === EXIT_REFUSED_UNAPPROVED && v.entries[0].tier === TIER_H && v.entries[0].record === undefined && split(v).byPath === true && /declaration split .*Tier H by path/.test(words(v)) && tierThreadsRead.length === 0 &&
          mixed.exitCode === EXIT_REFUSED_UNAPPROVED && mixed.entries[0].tier === TIER_H,
        words(v));
    }
    assert('control-the-near-misses-beside-them-clear-on-the-same-body-and-record',
      await (async () => { const v = await tierRun({ files: ['.claude/settings.md', '.claude/skills/hooks/x.sh'], comments: [recordComment()] }); return v.exitCode === EXIT_CLEAR && v.entries[0].tier === TIER_S; })());
    assert('the-CODEOWNERS-mirror-demands-a-line-for-each-always-Tier-H-path-and-names-the-one-missing',
      (() => {
        const onDisk = readFileSync(join(repoRoot, '.github', 'CODEOWNERS'), 'utf8');
        const live2 = codeownersMirrorVerdict({ text: onDisk });
        const short = codeownersMirrorVerdict({ text: onDisk.split('\n').filter((l) => !l.startsWith('/.claude/hooks/')).join('\n') });
        const wrong = codeownersMirrorVerdict({ text: onDisk.replace('/.claude/settings*.json @os-zhuang', '/.claude/settings*.json @someone-else') });
        return live2.ok && live2.splitPatterns.join() === '/.claude/settings*.json,/.claude/hooks/' && !short.ok && short.problems.length === 1 && short.problems[0].includes('`/.claude/hooks/`') &&
          !wrong.ok && wrong.problems.length === 1 && wrong.problems[0].includes('`/.claude/settings*.json`') && codeownersMirrorVerdict({ text: onDisk, repo: 'objectui' }).splitPatterns.length === 0;
      })());

    // The leg that reads no body, and the one whose read failed.
    const early = await tierRun({ files: [SKILL_PATH], event: EVENT_PULL_REQUEST, comments: [recordComment()] });
    assert('the-early-warning-leg-reads-no-body-names-Tier-H-UNTIL-it-is-read-and-never-reddens',
      early.exitCode === EXIT_CLEAR && early.conclusion === 'warned' && early.entries[0].tier === TIER_H && declarationUnread(early.entries[0]) && /UNTIL the PR body is read/.test(words(early)) && tierThreadsRead.length === 0, words(early));
    assert('declarationUnread-is-only-the-unread-body-never-a-read-Tier-H',
      !declarationUnread(missing.entries[0]) && !declarationUnread(yes.entries[0]) && !declarationUnread(both.entries[0]) && !declarationUnread(null) &&
        !declarationUnread(decomposeGovernedWork([row(5, [SKILL_PATH, 'AGENTS.md'])], REPO).governed[0]) && !declarationUnread(decomposeGovernedWork([row(5, [HOOK_PATH])], REPO).governed[0]) && declarationUnread(decomposeGovernedWork([row(5, [SKILL_PATH])], REPO).governed[0]));
  }

  // ── the NARROWED leg (2026-11-19, card #35321, item 3) ──────────────────────
  battery('⚖️ #35321: a declared narrowing lands like Tier H — an authorized approval AND a PASS record');
  {
    const SPEC = 'packages/spec/src/data/field.zod.ts';
    const CS = '.changeset/35321-narrow.md';
    const NARROW = `Fixes #${REF_CARD}\n\nClause-②: no\nMetadata-protocol: narrowed\n`;
    const ADDED = `Fixes #${REF_CARD}\n\nClause-②: yes\nMetadata-protocol: added\n`;
    const changeset = (body) => `---\n'@objectstack/spec': minor\n---\n\n${body}\n`;
    let reads = [];
    const narrowRun = async ({ body = NARROW, files = [SPEC], changesetText = null, reviews = [], timeline = [], comments = [], event = EVENT_MERGE_GROUP, pullThrows = false, reviewsThrow = false, commentsThrow = false, approvals = new Map(), runGit = undefined, recognisers = live, extraRows = [] } = {}) => {
      reads = [];
      const paths = changesetText === null ? files : [...files, CS];
      return runNarrowedGuard({
        repo: REPO,
        event,
        rows: [row(70, paths, 'c'.repeat(40)), ...extraRows],
        fetchPull: async (n) => { reads.push(`pull ${n}`); if (pullThrows) throw new Error('HTTP 502'); return pull(REF_HEAD, { body: n === 70 ? body : 'Fixes #1', headRef: `claude/issue-${REF_CARD}-x` }); },
        fetchReviews: async (n) => { reads.push(`reviews ${n}`); if (reviewsThrow) throw new Error('HTTP 403'); return reviews; },
        fetchTimeline: async (n) => { reads.push(`timeline ${n}`); return timeline; },
        fetchComments: async (n) => { reads.push(`comments ${n}`); if (commentsThrow) throw new Error('HTTP 502'); return n === 70 ? comments : []; },
        loadRecognisers: async () => recognisers,
        approvals,
        runGit: runGit === undefined ? (args) => { reads.push(`git ${args[0]}`); if (args[0] === 'show' && changesetText !== null) return changesetText; throw new Error('not in this tree'); } : runGit,
      });
    };
    const approval = [approvedAt(GOVERNED_APPROVERS[0], REF_HEAD)];
    const enqueued = [{ event: 'added_to_merge_queue', actor: { login: GOVERNED_APPROVERS[0] }, created_at: '2026-11-19T05:00:00Z' }];

    // The card's two branches first.
    const bare = await narrowRun();
    assert('⛔ narrowed-declaration-without-approval-is-REFUSED-on-its-own-code',
      bare.exitCode === EXIT_REFUSED_NARROWED && bare.conclusion === 'refused' && bare.refusalKind === 'narrowed' && bare.entries[0].state === 'refused' && bare.entries[0].reasons.length === 2 &&
        renderNarrowedVerdict(bare).includes(NARROWED_RULING) && /declares a narrowing and is NOT cleared/.test(renderNarrowedVerdict(bare)) && renderNarrowedVerdict(bare).includes('Metadata-protocol: narrowed'),
      renderNarrowedVerdict(bare));
    const added = await narrowRun({ body: ADDED });
    assert('⭐ added-is-unchanged-CLEAR-on-one-pull-read-with-no-review-timeline-or-thread-read',
      added.exitCode === EXIT_CLEAR && added.conclusion === 'clear' && added.entries[0].state === 'not-declared' && reads.join() === 'pull 70' && added.apiCalls === 1 && /no queued pull request declares a narrowing/.test(renderNarrowedVerdict(added)),
      reads.join());
    assert('semantic-none-a-bare-Clause-2-and-a-widening-arm-are-unchanged-too',
      await (async () => {
        const out = [];
        for (const body of ['Metadata-protocol: semantic', 'Metadata-protocol: none\nClause-②: no', 'Clause-②: yes', 'Clause-②: yes (widening)\nMetadata-protocol: added', '']) { const v = await narrowRun({ body }); out.push(v.exitCode === EXIT_CLEAR && v.entries[0].state === 'not-declared' && reads.join() === 'pull 70'); }
        return out.every(Boolean);
      })());

    // Both halves, never either.
    const cleared = await narrowRun({ reviews: approval, comments: [recordComment()] });
    assert('⭐ an-authorized-approval-AND-a-PASS-record-on-the-head-CLEAR-it',
      cleared.exitCode === EXIT_CLEAR && cleared.entries[0].state === 'cleared' && cleared.entries[0].by === 'review' && /both halves are on record: an authorized APPROVED review/.test(renderNarrowedVerdict(cleared)) && reads.join() === `pull 70,reviews 70,comments 70,comments ${REF_CARD}`,
      renderNarrowedVerdict(cleared) + reads.join());
    const approvalOnly = await narrowRun({ reviews: approval });
    const recordOnly = await narrowRun({ comments: [recordComment()] });
    assert('⛔ an-approval-with-no-record-and-a-record-with-no-approval-are-each-REFUSED-naming-the-missing-half',
      approvalOnly.exitCode === EXIT_REFUSED_NARROWED && approvalOnly.entries[0].reasons.length === 1 && /no `## Contract review` record names its current head/.test(approvalOnly.entries[0].reasons[0]) &&
        recordOnly.exitCode === EXIT_REFUSED_NARROWED && recordOnly.entries[0].reasons.length === 1 && /no authorized APPROVED review is on record/.test(recordOnly.entries[0].reasons[0]),
      JSON.stringify([approvalOnly.entries[0].reasons, recordOnly.entries[0].reasons]));
    assert('the-maintainers-own-enqueue-from-an-authorized-account-is-the-human-half-and-still-owes-the-record',
      await (async () => {
        const withRecord = await narrowRun({ timeline: enqueued, comments: [recordComment()] });
        const without = await narrowRun({ timeline: enqueued });
        const seat = await narrowRun({ timeline: [{ ...enqueued[0], actor: { login: 'os-sales' } }], comments: [recordComment()] });
        return withRecord.exitCode === EXIT_CLEAR && withRecord.entries[0].by === 'enqueue' && without.exitCode === EXIT_REFUSED_NARROWED && seat.exitCode === EXIT_REFUSED_NARROWED;
      })());
    assert('⛔ an-unauthorized-a-dismissed-and-a-superseded-approval-are-not-the-human-half',
      await (async () => {
        const out = [];
        for (const reviews of [[approvedAt('os-sales', REF_HEAD)], [approvedAt(GOVERNED_APPROVERS[0], REF_HEAD), { state: 'DISMISSED', user: { login: GOVERNED_APPROVERS[0] } }], [approvedAt(GOVERNED_APPROVERS[0], REF_HEAD), { state: 'CHANGES_REQUESTED', user: { login: GOVERNED_APPROVERS[0] } }]]) {
          out.push((await narrowRun({ reviews, comments: [recordComment()] })).exitCode === EXIT_REFUSED_NARROWED);
        }
        return out.every(Boolean);
      })());
    assert('⛔ a-record-that-reads-FAIL-names-an-older-head-or-is-unsigned-is-not-the-record-half',
      await (async () => {
        const out = [];
        for (const record of [recordComment({ verdictWord: '**VERDICT: FAIL**' }), recordComment({ sha: REF_OLD.slice(0, 12) }), recordComment({ signed: false }), recordComment({ by: 'some-commenter' })]) {
          out.push((await narrowRun({ reviews: approval, comments: [record] })).exitCode === EXIT_REFUSED_NARROWED);
        }
        return out.every(Boolean);
      })());

    // Where a declaration is read from, and with which readers.
    assert('⛔ a-changeset-that-declares-narrowed-under-a-body-that-says-none-is-a-declared-narrowing',
      await (async () => {
        const v = await narrowRun({ body: `Fixes #${REF_CARD}\n\nMetadata-protocol: none\n`, changesetText: changeset('Metadata-protocol: narrowed') });
        const clean = await narrowRun({ body: ADDED, changesetText: changeset('Metadata-protocol: added') });
        return v.exitCode === EXIT_REFUSED_NARROWED && v.entries[0].declarations[0].where === `\`${CS}\`` && clean.exitCode === EXIT_CLEAR && clean.entries[0].state === 'not-declared';
      })());
    assert('⛔ the-narrowing-arm-on-either-Clause-2-value-is-a-declared-narrowing-in-the-body-or-a-changeset',
      await (async () => {
        const out = [];
        for (const line of ['Clause-②: no (narrowing)', 'Clause-②: yes (narrowing)']) {
          out.push((await narrowRun({ body: `Fixes #${REF_CARD}\n\n${line}\nMetadata-protocol: none` })).exitCode === EXIT_REFUSED_NARROWED);
          out.push((await narrowRun({ body: 'Fixes #1', changesetText: changeset(line) })).exitCode === EXIT_REFUSED_NARROWED);
        }
        return out.every(Boolean);
      })());
    assert('narrowingDeclarationsIn-reads-line-by-line-with-the-fleets-readers-and-fails-closed-on-a-near-arm',
      narrowingDeclarationsIn('Metadata-protocol: none\nMetadata-protocol: narrowed').length === 1 && narrowingDeclarationsIn('- **Metadata-protocol**: narrowed (the `x` key)').length === 1 &&
        narrowingDeclarationsIn('Clause-②: no (narrowed)').length === 1 && narrowingDeclarationsIn('Clause-②: no (narrowing)\nMetadata-protocol: narrowed').map((d) => d.key).join() === 'Clause-②,Metadata-protocol' &&
        ['Metadata-protocol: added', 'Metadata-protocol: semantic', 'Metadata-protocol: none', 'Clause-②: yes (widening)', 'Clause-②: no', 'a narrowed spec change, in prose', 'see `Metadata-protocol: narrowed` in the template', '- `Metadata-protocol: narrowed` ⇒ `minor`', '', null].every((t) => narrowingDeclarationsIn(t).length === 0),
      JSON.stringify(narrowingDeclarationsIn('- `Metadata-protocol: narrowed` ⇒ `minor`')));
    assert('⛔ the-pull-request-template-left-UNFILLED-declares-no-narrowing-and-a-partial-menu-still-does',
      await (async () => {
        const template = readFileSync(join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');
        const v = await narrowRun({ body: template });
        return template.includes(`\nMetadata-protocol: ${UNFILLED_PROTOCOL_MENU}\n`) && UNFILLED_PROTOCOL_MENU === 'added | narrowed | semantic | none' && narrowingDeclarationsIn(template).length === 0 &&
          v.exitCode === EXIT_CLEAR && v.entries[0].state === 'not-declared' && reads.join() === 'pull 70' &&
          narrowingDeclarationsIn('Metadata-protocol:  added |  narrowed | semantic | none').length === 0 &&
          ['Metadata-protocol: narrowed | none', 'Metadata-protocol: added | narrowed', 'Metadata-protocol: added | narrowed | semantic | none (narrowed)', 'Metadata-protocol: narrowed.'].every((line) => narrowingDeclarationsIn(line).length === 1);
      })());
    assert('a-narrowing-with-no-schema-path-stands-on-the-narrowing-face-its-record-at-the-default-tier-does-not',
      await (async () => {
        const runtime = { files: ['packages/runtime/src/x.ts'], body: `Fixes #${REF_CARD}\n\nClause-②: no (narrowing)\nMetadata-protocol: none\n`, changesetText: changeset('Clause-②: no (narrowing)'), reviews: approval };
        const atTier = await narrowRun({ ...runtime, comments: [recordComment()] });
        const below = await narrowRun({ ...runtime, comments: [recordComment({ tierLine: 'Served-tier: 75/75 `TIER_DEFAULT`' })] });
        return atTier.exitCode === EXIT_CLEAR && atTier.entries[0].record.face === 'narrowing' && below.exitCode === EXIT_REFUSED_NARROWED && /does not stand \(below-tier\)/.test(below.entries[0].reasons[0]);
      })());
    // The declaration this leg found holds the face, whatever the `Clause-②:` line reads: the narrowed KIND alone, the
    // kind beside a bare, an absent or a malformed clause line, the kind on a changeset only, and a near-arm clause
    // spelling (which no longer reads as a record that does not stand for want of a face).
    const kindOnly = await (async () => {
      const DEFAULT_TIER = recordComment({ tierLine: 'Served-tier: 75/75 `TIER_DEFAULT`' });
      const RUNTIME = ['packages/runtime/src/x.ts'];
      const shapes = {
        'kind beside a bare clause line': { body: NARROW },
        'kind with no clause line': { body: `Fixes #${REF_CARD}\n\nMetadata-protocol: narrowed\n` },
        'kind on a changeset only': { body: `Fixes #${REF_CARD}\n\nClause-②: no\nMetadata-protocol: none\n`, changesetText: changeset('Metadata-protocol: narrowed') },
        'near-arm clause spelling': { body: `Fixes #${REF_CARD}\n\nClause-②: no (narrowed)\nMetadata-protocol: none\n` },
        'kind beside a malformed clause line': { body: `Fixes #${REF_CARD}\n\nClause-②: maybe\nMetadata-protocol: narrowed\n` },
      };
      const out = {};
      for (const [name, shape] of Object.entries(shapes)) {
        const atTier = await narrowRun({ ...shape, files: RUNTIME, reviews: approval, comments: [recordComment()] });
        const below = await narrowRun({ ...shape, files: RUNTIME, reviews: approval, comments: [DEFAULT_TIER] });
        out[name] = { atTier: [atTier.exitCode, atTier.entries[0].state, atTier.entries[0].record?.face ?? null], below: [below.exitCode, below.entries[0].state, below.entries[0].record?.face ?? null, below.entries[0].reasons.join(' | ')] };
      }
      // Negative control: with NO declaration found the leg holds nothing and reads no record — the same path and the
      // same default-tier record under `added` stay clear on one pull read.
      const control = await narrowRun({ body: ADDED, files: RUNTIME, reviews: approval, comments: [DEFAULT_TIER] });
      out.control = [control.exitCode, control.entries[0].state, reads.join()];
      return out;
    })();
    assert('⛔ the-narrowed-kind-on-a-runtime-only-path-holds-the-narrowing-faces-tier-a-default-tier-record-is-REFUSED-an-at-tier-one-CLEARS',
      ['kind beside a bare clause line', 'kind with no clause line', 'kind on a changeset only', 'near-arm clause spelling', 'kind beside a malformed clause line'].every((name) =>
        kindOnly[name].atTier.join() === `${EXIT_CLEAR},cleared,narrowing` && kindOnly[name].below[0] === EXIT_REFUSED_NARROWED && kindOnly[name].below[1] === 'refused' && kindOnly[name].below[2] === 'narrowing' && /does not stand \(below-tier\)/.test(kindOnly[name].below[3])) &&
        kindOnly.control.join() === `${EXIT_CLEAR},not-declared,pull 70` &&
        NARROWING_FACE_LINE === 'Clause-②: no (narrowing)' && readClause2Line(NARROWING_FACE_LINE)?.kind === 'declared' && readClause2Line(NARROWING_FACE_LINE)?.arm === 'narrowing',
      JSON.stringify(kindOnly));

    // "Could not find out" is its own code, and never a pass.
    assert('⛔ an-unreadable-pull-changeset-review-list-or-thread-REFUSES-on-code-11',
      await (async () => {
        const pullGone = await narrowRun({ pullThrows: true });
        const csGone = await narrowRun({ body: ADDED, changesetText: 'x', runGit: (args) => { if (args[0] === 'ls-tree') return `100644 blob abc\t${CS}`; throw new Error('bad object'); } });
        const noGit = await narrowRun({ body: ADDED, changesetText: 'x', runGit: null });
        const reviewsGone = await narrowRun({ reviewsThrow: true, comments: [recordComment()] });
        const threadGone = await narrowRun({ reviews: approval, commentsThrow: true });
        const unloaded = await narrowRun({ reviews: approval, recognisers: { available: false, reason: 'a rename' } });
        return [pullGone, csGone, noGit, reviewsGone, threadGone, unloaded].every((v) => v.exitCode === EXIT_REFUSED_NARROWED_UNREADABLE && v.refusalKind === 'unreadable' && /could not find out/.test(renderNarrowedVerdict(v)));
      })());
    assert('a-changeset-the-commit-DELETED-declares-nothing-and-is-told-apart-from-a-failed-read',
      await (async () => { const v = await narrowRun({ body: ADDED, changesetText: 'x', runGit: (args) => { if (args[0] === 'ls-tree') return ''; throw new Error('path does not exist'); } }); return v.exitCode === EXIT_CLEAR && v.entries[0].state === 'not-declared'; })() &&
        readChangesetTexts([], null).measured === true && readChangesetTexts([{ sha: null, path: CS }], () => '').measured === false && changesetRefsByPull([row(7, [CS, SPEC], 'd'.repeat(40)), row(8, [SPEC])]).get(7)[0].sha === 'd'.repeat(40) && changesetRefsByPull([row(8, [SPEC])]).get(8).length === 0);
    assert('⛔ a-clean-sibling-does-not-carry-a-declared-narrowing-through-the-group-and-a-group-naming-no-pull-refuses',
      await (async () => {
        const group = await narrowRun({ extraRows: [row(71, ['packages/runtime/src/y.ts'], 'd'.repeat(40))] });
        const none = await runNarrowedGuard({ repo: REPO, event: EVENT_MERGE_GROUP, rows: [], fetchPull: async () => pull() });
        return group.entries.map((e) => e.state).join() === 'refused,not-declared' && group.exitCode === EXIT_REFUSED_NARROWED && none.exitCode === EXIT_REFUSED_NARROWED_UNREADABLE && none.refusalKind === 'no-pull';
      })());
    assert('the-leg-reuses-the-approval-the-governed-leg-read-and-reads-no-review-list-of-its-own',
      await (async () => { const v = await narrowRun({ approvals: new Map([[70, authorizedPass()]]), comments: [recordComment()] }); return v.exitCode === EXIT_CLEAR && !reads.some((r) => r.startsWith('reviews') || r.startsWith('timeline')); })());

    // The pull_request leg, the exit contract and the wiring.
    const prLeg = await narrowRun({ event: EVENT_PULL_REQUEST });
    assert('the-pull_request-leg-is-not-applicable-renders-nothing-and-reads-nothing',
      prLeg.conclusion === 'not-applicable' && prLeg.exitCode === EXIT_CLEAR && renderNarrowedVerdict(prLeg) === '' && reads.length === 0);
    const exitOf = (code) => ({ exitCode: code });
    assert('the-two-narrowed-codes-are-distinct-and-collide-with-no-other-code',
      new Set([EXIT_CLEAR, EXIT_CANNOT_RUN, EXIT_REFUSED_UNAPPROVED, EXIT_REFUSED_UNREADABLE, EXIT_REFUSED_UNATTRIBUTED, EXIT_REFUSED_OVERSIZED, EXIT_REFUSED_SIZE_UNREADABLE, EXIT_REFUSED_NARROWED, EXIT_REFUSED_NARROWED_UNREADABLE]).size === 9 && EXIT_REFUSED_NARROWED === 10 && EXIT_REFUSED_NARROWED_UNREADABLE === 11);
    assert('⭐ precedence-governed-then-size-then-narrowed-and-two-legs-alone-answer-as-before',
      groupExitCode({ governed: exitOf(0), size: exitOf(0), narrowed: exitOf(EXIT_REFUSED_NARROWED) }) === EXIT_REFUSED_NARROWED &&
        groupExitCode({ governed: exitOf(0), size: exitOf(EXIT_REFUSED_OVERSIZED), narrowed: exitOf(EXIT_REFUSED_NARROWED) }) === EXIT_REFUSED_OVERSIZED &&
        groupExitCode({ governed: exitOf(EXIT_REFUSED_UNAPPROVED), size: exitOf(0), narrowed: exitOf(EXIT_REFUSED_NARROWED) }) === EXIT_REFUSED_UNAPPROVED &&
        groupExitCode({ governed: exitOf(0), size: exitOf(0), narrowed: exitOf(0) }) === EXIT_CLEAR && groupExitCode({ governed: exitOf(0), size: exitOf(0) }) === EXIT_CLEAR);
    const ownSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert('main-runs-the-narrowed-leg-prints-its-block-and-hands-it-to-the-exit-code',
      /const narrowed = await runNarrowedGuard\(\{/.test(ownSource) && /return groupExitCode\(\{ governed: verdict, size, narrowed \}\);/.test(ownSource) && /narrowedBlock === '' \? \[\] : \['', narrowedBlock\]/.test(ownSource) && /const fetchPull = oncePerPull\(makePullReader\(reader\)\);/.test(ownSource));
    assert('oncePerPull-keeps-a-successful-read-and-never-a-failed-one',
      await (async () => {
        let calls = 0;
        const read = oncePerPull(async (n) => { calls += 1; if (calls === 1) throw new Error('HTTP 502'); return { n, calls }; });
        const first = await read(7).then(() => null, (e) => e.message);
        const second = await read(7);
        const third = await read(7);
        return first === 'HTTP 502' && second.calls === 2 && third === second && calls === 2 && (await read(8)).calls === 3;
      })());
    assert('the-refusal-names-both-halves-and-never-advises-rewording-the-declaration',
      ((t) => /the human half/.test(t) && /the record half/.test(t) && /rewording the declaration are not ways through/.test(t) && t.includes(GOVERNED_APPROVERS[0]) && t.includes(NARROWED_LEG_NAME))(renderNarrowedVerdict(bare)));
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => { failures.push(message); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }

  for (const f of failures) console.error(`  ✗ ${f}`);
  if (failures.length > 0) {
    console.error(`✗ check-governed-queue-guard self-test: ${failures.length} of ${checked} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-governed-queue-guard self-test: ${checked} cases pass ` +
      '(register-driven verdicts, the queue/PR event split, latest-decisive approval reduction, the 2026-09-04 ' +
      'authorized-approval-on-ANY-commit predicate on the queue leg — pass on the head, pass on an older commit, ' +
      'unauthorized, dismissed/superseded, none — with the PR leg byte-identical and head-read-free, multi-PR group ' +
      'decomposition, three replayed incidents, the zero-API ordering guarantee measured with throwing spies, the ' +
      'head-then-reviews read order with an unreadable review list still refusing and an unreadable head no longer ' +
      'doing so, the generated-artifact lift path — certified, refused, mixed with hand-authored skill ' +
      'content, and the degraded no-toolchain environment — the #14063 end-to-end decision on a #13794-shaped pure ' +
      'regeneration (clears with zero approvals and zero API calls; still refuses on an uncertified recompute, on ' +
      'drift, on a hand-authored sibling, and on a recompute that throws), and the workflow wiring pin including the ' +
      'dependency install the recompute needs, its register-agnostic filter-free form, and its continue-on-error ' +
      'degradation), and the #15406 replay of PR #15284 — a clear reached THROUGH a lift no longer reports itself as a ' +
      'clear that matched nothing, while the zero-cost clear keeps its wording byte-for-byte on the pull_request ' +
      'leg and is SCOPED on the merge_group one, because the size leg reads every queued pull request there — ' +
      'and the #18020 references TIER, re-keyed to Tier S by #19133: a ' +
      'governed diff whose governed paths are ALL Tier S — the register\'s `.claude/**` row, asked through ' +
      '`governedTierFor`, never a prefix repeated here — lands on the owning seat\'s review of record instead of an ' +
      'authorized approval, with the record recognisers IMPORTED through a lazy load whose precondition (no ' +
      'top-level await in this file\'s dispatch) is pinned against this file\'s own source, refused on an older ' +
      'head, on a missing or below-tier or partially-stamped `Served-tier:`, on an unsigned record, on no record ' +
      'at all, and on one rules-layer path in the same diff — and MONOTONE by construction: measured with ' +
      'throwing spies, an approved references PR never reads a thread and never loads a recogniser — and the ' +
      '#19036 SIZE line (the 2026-09-18 ruling, landed seat-side by #19033 and carried to the queue here): every ' +
      'queued pull request\'s `additions` / `deletions` read off the same pull object the head read uses, one read ' +
      'per PR, judged by the sibling\'s IMPORTED predicate (`testVerdict([], { repo: REPO, size })` + `landsByHumanMerge`; this ' +
      'file declares no threshold and spells no comparison, pinned against its own source) — the #18971 replay ' +
      '(over the line, nothing governed) REFUSED on exit 8 with the two numbers, the threshold and the human-merge ' +
      'remedy printed; exactly the threshold clear; a governed AND oversized group printing both limbs and exiting ' +
      'on the governed code; an authorized approval lifting nothing from the size; a certified regeneration lifting ' +
      'nothing from it either; an unreadable size or a pull object without the pair FAIL-CLOSED on exit 9; the ' +
      'pull_request leg silent and read-free; and the two-leg exit precedence (governed, size) pinned on ' +
      'every combination — and the #19344 remedy pin: every limb names the Merge button\'s bypass-rules option, ' +
      'judged against the recorded ruleset reading, red on a present-and-empty `bypass_actors` and on a remedy ' +
      'drifting back to a bare click, and passing with the reading PRINTED when the field is unreadable — and the ' +
      'queued pull-back: every refusal kind on both legs sends the queued pull request to its landing seat\'s relay ' +
      '`pr_dequeue` or, from any other seat, the maintainer\'s manual removal, disarms it and confirms from the remote, and no rendering claims a DRAFT conversion dequeues it, ' +
      'with a detector control that fires on every listed spelling — and the 2026-10-26 ENQUEUE leg: an entry an ' +
      'account in GOVERNED_APPROVERS put in the queue clears with no APPROVED review and lifts the size limb through ' +
      'the sibling, a seat enqueue still refuses, an UNDETERMINED enqueuer (no add, a removal newest, an unreadable or ' +
      'truncated timeline) is never a pass, and the approval is still read first.',
  );

  selfTestReachedVerdict = true;
  return 0;
}

// Same shape, same reason as the dispatch above: the self-test drives the real
// recognisers through the real lazy import, so it needs this module evaluated
// too. The `selfTestReachedVerdict` handshake (#13798) is unchanged — a
// `return` above the verdict line still cannot report itself as a pass.
if (isEntrypoint(import.meta.url) && process.argv.includes('--self-test')) {
  selfTest().then(
    (selfTestCode) => {
      if (!selfTestReachedVerdict) {
        console.error(
          '\n✗ check-governed-queue-guard self-test: selfTest() returned without reaching its verdict,\n'
            + 'so no success line was printed. Exiting 0 here would report a self-test\n'
            + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
      }
      process.exit(selfTestCode);
    },
    (error) => {
      console.error(`\n✗ check-governed-queue-guard self-test threw: ${String(error?.stack ?? error)}\n`);
      process.exit(1);
    },
  );
}
