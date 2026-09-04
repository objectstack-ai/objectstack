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
 * a draft awaiting the maintainer's own merge is the CORRECT terminal state of
 * the regime — that is what "人工合并即人工审核" means — so a check that is red
 * on it is red on the healthy case, forever, which is precisely the poison the
 * 2026-08-18 ruling named. The queue build, by contrast, is a state a governed
 * PR should never be in at all; red there is red on the anomaly.
 *
 * ⚠️ The consequence is worth stating out loud rather than discovering: this
 * guard CANNOT stop a maintainer merging a governed PR by hand, and does not
 * try. A direct merge produces no `merge_group` event. Under this regime that
 * is not a hole — the human merge IS the review record (measured: #11387 was
 * read as an incident for 13 minutes on exactly this confusion, until the
 * maintainer answered 「是我合并的」). What this guard closes is the seat path:
 * flip ready → enqueue → the queue is the entire review.
 *
 * ## What satisfies it — an AUTHORIZED approval, on ANY commit
 *
 * The predicate has three dated layers; the LATEST one is the one enforced,
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
 * authorized set, verbatim: 「os-zhuang hotlong 批准算数」. ⭐ THAT HALF STANDS,
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
 * (「os-zhuang hotlong 批准算数」) stands, DISMISSED and superseded approvals
 * still never count, an unauthorized APPROVED still never counts, and an empty
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
 * ## Exit codes — the refusal is impossible to read as clean
 *
 *   0  CLEAR    — nothing governed in the diff (no API call was made), or every
 *                 governed PR carries an authorized APPROVED review (on ANY
 *                 commit — 2026-09-04), or this is the `pull_request`
 *                 early-warning run.
 *   3  REFUSED  — governed, and at least one governed PR carries no authorized
 *                 APPROVED review (none at all, unauthorized account, dismissed
 *                 or superseded).
 *                 Deliberately 3, the same code the sibling's `--test`
 *                 answers "GOVERNED" with, so the two tools agree on the number
 *                 that means "this diff is governed and unsatisfied".
 *   4  REFUSED  — governed, and the REVIEW LIST could not be read.
 *                 Distinct from 3 on purpose: "nobody approved" and "we could
 *                 not find out" are different facts and must be separable in a
 *                 log. ⚠️ An unreadable PR HEAD is NOT this refusal any more —
 *                 since 2026-09-04 the head decides nothing, so it is recorded
 *                 as a missing reading and the review list alone judges.
 *   5  REFUSED  — governed paths on a commit attributable to no pull request.
 *   1  CANNOT RUN — unusable event payload, unsupported event, unreadable git.
 *                 Still non-zero, still red: this file has no green that means
 *                 "did not look".
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
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENERATED_SURFACE_EXCEPTIONS,
  GOVERNED_SURFACES,
  applyGeneratedExceptions,
  generatedExceptionFor,
  governedPathsIn,
  groupHitsByException,
  pullNumberFromSubject,
  recomputeProvenanceFor,
  testVerdict,
} from './check-governed-merges.mjs';
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
  'decomposition, and the multi-PR group trap': 6,
  'the verdict table, both events': 10,
  'the pull_request leg is an EARLY WARNING and never reddens': 3,
  'the replay fixtures: the three incidents this guard descends from': 9,
  '⭐ the ordering guarantee, measured with a spy that THROWS': 7,
  'the words a reader acts on (requirement (e))': 26,
  '⭐ #14063 END TO END: what the dependency install actually buys': 9,
  'the PR-head reader: throws, and the caller no longer refuses on it': 3,
  'the WIRING pin: the workflow still spells this context name': 8,
  '⭐ #14063: the environment the exemption needs, pinned to the YAML': 7,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 17;

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
 * The ONLY accounts whose APPROVED review satisfies the `merge_group` leg
 * (2026-08-27, verbatim: 「os-zhuang hotlong 批准算数」). ⭐ Single source, the
 * `CONTRACT_REVIEW_TIER` pattern: protocol text references this constant and
 * never copies the names; changing the set is a one-line maintainer decision
 * here, nowhere else. The self-test pins the membership to the ruling, and the
 * refusal/cleared renderings derive their named accounts from this array.
 */
export const GOVERNED_APPROVERS = Object.freeze(['os-zhuang', 'hotlong']);

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
 * Split the work in a diff into the pull requests that touched a governed
 * surface, plus the governed work no pull request can be found for.
 *
 * Pure. `rows` are `{ sha, subject, pr, paths }` — one per first-parent commit
 * in a merge group, or one synthetic row for a `pull_request` run. A row whose
 * paths hit nothing governed is dropped entirely and costs nothing downstream;
 * that is what makes "a clear diff makes no API call" a property of the data
 * flow rather than a promise in a comment.
 */
export function decomposeGovernedWork(rows) {
  const byPull = new Map();
  const unattributed = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const surfaces = governedPathsIn(row?.paths ?? []);
    if (surfaces.length === 0) continue;
    const paths = surfaces.flatMap((s) => s.files);
    if (typeof row.pr !== 'number' || !Number.isInteger(row.pr) || row.pr <= 0) {
      unattributed.push({ sha: row.sha ?? null, subject: row.subject ?? '', paths });
      continue;
    }
    const seen = byPull.get(row.pr) ?? { pr: row.pr, paths: new Set(), shas: [] };
    for (const p of paths) seen.paths.add(p);
    if (row.sha) seen.shas.push(row.sha);
    byPull.set(row.pr, seen);
  }
  const governed = [...byPull.values()]
    .map((entry) => ({ pr: entry.pr, shas: entry.shas, paths: [...entry.paths], surfaces: governedPathsIn([...entry.paths]) }))
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
 * ⭐ BOTH RENAMES LANDED WITH THEIR IMPORTER, in one commit.
 * `.claude/hooks/guard-governed-enqueue.sh` imports this function and reads that
 * bucket off its result — the "⛔ no second mechanism" design paying off, since
 * the seat-side hook's verdict flipped with this ruling for free and it needs no
 * predicate of its own. ⛔ Never rename either name without that hook in the
 * same diff: it catches the resulting failure and ALLOWS, with one warning line
 * on stderr, so every governed enqueue would sail through it silently.
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
    // ...and then, separately, the reading the log prints. It changes nothing.
    if (head !== null && review.commitId !== head) approvalsOnEarlierCommits.push({ login, commitId: review.commitId });
  }
  return {
    state: approvers.length > 0 ? 'approved' : 'unapproved',
    approvers,
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

/**
 * The verdict, as data. Pure — every branch of the decision is here, and the
 * renderer and the exit code both read it rather than re-deriving it.
 */
export function guardVerdict({ event, governed = [], unattributed = [], approvals = new Map(), apiCalls = 0, headNotes = [] }) {
  const entries = governed.map((entry) => ({
    ...entry,
    approval: approvals.get(entry.pr) ?? unreadableApproval('no review reading was recorded for this pull request'),
  }));
  const base = { event, entries, unattributed, apiCalls, headNotes, contextName: CHECK_CONTEXT_NAME };

  if (entries.length === 0 && unattributed.length === 0) {
    return { ...base, conclusion: 'clear', exitCode: EXIT_CLEAR, refusalKind: null };
  }
  // The early-warning run never reddens: a governed PR awaiting the
  // maintainer's own merge is the regime's healthy terminal state, and a check
  // that is red on the healthy case is the retired gate rebuilt (see header).
  if (event !== EVENT_MERGE_GROUP) {
    return { ...base, conclusion: 'warned', exitCode: EXIT_CLEAR, refusalKind: null };
  }
  if (unattributed.length > 0) {
    return { ...base, conclusion: 'refused', exitCode: EXIT_REFUSED_UNATTRIBUTED, refusalKind: 'unattributed' };
  }
  if (entries.some((e) => e.approval.state === 'unreadable')) {
    return { ...base, conclusion: 'refused', exitCode: EXIT_REFUSED_UNREADABLE, refusalKind: 'unreadable' };
  }
  if (entries.some((e) => e.approval.state !== 'approved')) {
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

  // ⚠️ The `pull_request` leg's wording is BYTE-IDENTICAL to the pre-pinning
  // guard (the 2026-08-27 card's own constraint) — only the queue leg, where
  // the head read exists, labels its API traffic differently.
  const apiLabel = verdict.event === EVENT_MERGE_GROUP ? 'API read(s) (PR head + reviews)' : 'review lookup(s)';
  lines.push(
    `${CHECK_CONTEXT_NAME} — ${verdict.event} — ${verdict.entries.length} governed pull request(s), ` +
      `${verdict.unattributed.length} unattributed governed commit(s), ${verdict.apiCalls} ${apiLabel}.`,
  );

  if (verdict.conclusion === 'clear') {
    lines.push(
      '  ✅  CLEAR — the diff touches no governed surface, so this guard has nothing to judge.',
      `      Derived from GOVERNED_SURFACES in scripts/pm/check-governed-merges.mjs (${GOVERNED_SURFACES.length} surfaces),`,
      '      never from a restated list. ⛔ ZERO review lookups were made: the path test runs first and returns,',
      '      so a GitHub API outage can never block a diff that touches nothing governed.',
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
    lines.push(
      '  ⚠️  EARLY WARNING, not a failure — this run is on the pull request, and this check is deliberately',
      '      GREEN here. A governed PR held as a draft for the maintainer to merge by hand IS the regime\'s',
      '      healthy end state (「人工合并即人工审核」), and a check that reddens on the healthy case is the',
      '      permanently-red gate the 2026-08-18 ruling retired (红灯常态化本身有毒).',
      '',
      '      ⛔ What a seat must NOT do with this PR: flip it ready, enqueue it, or arm auto-merge',
      '         (AGENTS.md Prime Directive #14). One governed path governs the whole PR —',
      '         「混合 diff 一条命中即整 PR 分叉」; proportion is not a question.',
      '',
      '      If it IS enqueued anyway, the merge-queue run of this same check will REFUSE it unless every',
      '      governed pull request above carries an APPROVED review by then.',
    );
    return lines.join('\n');
  }
  if (verdict.conclusion === 'cleared') {
    lines.push(
      '  ✅  CLEARED — every governed pull request in this merge group carries an APPROVED review by an',
      `      authorized approver (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')}), on ANY commit — the`,
      '      2026-09-04 ruled predicate (「只需要有人工批准记录就行，不需要卡最新的提交。」), which supersedes',
      "      the sha pin of 2026-08-27 while that ruling's approver set (「os-zhuang hotlong 批准算数」) stands.",
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
      '      At least one governed pull request above carries NO authorized APPROVED review at all, and the',
      '      merge queue would have been the entire review — the shape of #9550, #10580 and #9319.',
    );
  }
  lines.push(
    '',
    '      What satisfies this check:',
    '        1. ⭐ PREFERRED — take the pull request out of the queue: convert it back to DRAFT (disarming',
    '           auto-merge alone does NOT dequeue it), and leave the merge to the maintainer. A human merge',
    '           IS the review record for a governed surface; that is the regime, not a workaround of it.',
    `        2. Or: obtain an APPROVED review by an authorized approver (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')})`,
    '           on each governed PR, then re-queue. It does NOT have to sit on the current head sha, and a later',
    '           push does not expire it (2026-09-04: 「只需要有人工批准记录就行，不需要卡最新的提交。」); the',
    '           authorized set is still the 2026-08-27 one (「os-zhuang hotlong 批准算数」). ⛔ An agent seat',
    '           never submits that approval, under any account — the post-merge audit reads the approver too.',
    '      Neither of those is "edit this check".',
    '',
    `      Verify any file list before acting: node scripts/pm/check-governed-merges.mjs --test <paths…>`,
  );
  return lines.join('\n');
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
export async function runGuard({ event, rows, fetchReviews, fetchPullHead }) {
  const { governed, unattributed } = decomposeGovernedWork(rows);
  if (governed.length === 0 && unattributed.length === 0) {
    return guardVerdict({ event, governed, unattributed, apiCalls: 0 });
  }
  const approvals = new Map();
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
          headSha = await fetchPullHead(entry.pr);
        } catch (error) {
          headNotes.push(
            `  ℹ️  #${entry.pr}: the PR head could not be read (${String(error?.message ?? error).split('\n')[0]}) — ` +
              'informational only since 2026-09-04, so the review list was judged without it',
          );
        }
        apiCalls += 1;
        approvals.set(entry.pr, authorizedApprovalVerdict(await fetchReviews(entry.pr), headSha));
      } else {
        // The early-warning leg keeps the pre-pinning reading (and byte-
        // identical output): it never reddens, so it never needs the head.
        apiCalls += 1;
        approvals.set(entry.pr, approvalVerdict(await fetchReviews(entry.pr)));
      }
    } catch (error) {
      approvals.set(entry.pr, unreadableApproval(String(error?.message ?? error).split('\n')[0]));
    }
  }
  return guardVerdict({ event, governed, unattributed, approvals, apiCalls, headNotes });
}

// ── git (diff decomposition; zero API) ──────────────────────────────────────

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
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
 * The first-parent commits between `baseSha` and `headSha`, each with the
 * paths it changed and the pull request its subject names. One row per PR
 * landing in a merge group; see the header on why the group is decomposed
 * rather than keyed to `head_ref`.
 */
export function enumerateRows(root, baseSha, headSha, fallbackPull = null) {
  const log = git(root, ['log', '--first-parent', '--format=%H%x09%s', `${baseSha}..${headSha}`]);
  const commits = log
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const [sha, ...rest] = l.split('\t');
      return { sha, subject: rest.join('\t') };
    });
  return commits.map((commit) => ({
    ...commit,
    // The fallback is only unambiguous when the range holds exactly one
    // commit; in a multi-PR group `head_ref` names the LAST PR, and applying
    // it to an earlier commit attributes a governed diff to the wrong PR.
    pr: pullNumberFromSubject(commit.subject) ?? (commits.length === 1 ? fallbackPull : null),
    paths: git(root, ['diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-only', '-m', '--first-parent', commit.sha])
      .split('\n')
      .filter((p) => p !== ''),
  }));
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
export async function liftGeneratedExceptions(root, baseSha, rows, notes, recompute = recomputeProvenanceFor) {
  const registered = (row) => row.paths.filter((p) => generatedExceptionFor(p) !== null);
  if (!rows.some((row) => registered(row).length > 0)) return rows;
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
    const lifted = applyGeneratedExceptions(testVerdict(row.paths), provenance);
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

// ── the GitHub reads (PR head + reviews — the only API surface) ─────────────

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
 * The pull request's CURRENT head sha — what the 2026-08-27 predicate pins a
 * review's `commit_id` against. Same channel as the review read: the standard
 * GITHUB_TOKEN REST API under the workflow's existing `pull-requests: read`
 * scope, nothing wider. Throws on any non-2xx and on a body with no parseable
 * `head.sha` — a head this guard cannot read pins NOTHING, and the caller
 * turns the throw into a REFUSAL (exit 4), never a pass.
 */
export function makePullHeadReader({ apiUrl, slug, token, fetchImpl = fetch }) {
  return async function fetchPullHead(pull) {
    const res = await fetchImpl(`${apiUrl}/repos/${slug}/pulls/${pull}`, { headers: apiHeaders(token) });
    if (!res.ok) throw new Error(`GET /repos/${slug}/pulls/${pull} answered HTTP ${res.status}`);
    const body = await res.json();
    const sha = String(body?.head?.sha ?? '');
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      throw new Error(`GET /repos/${slug}/pulls/${pull} answered no parseable head.sha — cannot pin approvals`);
    }
    return sha;
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const env = process.env;
  const eventName = env.GITHUB_EVENT_NAME;
  let payload;
  try {
    payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? '', 'utf8'));
  } catch (error) {
    console.error(
      `⛔ ${CHECK_CONTEXT_NAME}: could not read GITHUB_EVENT_PATH (${String(error?.message ?? error).split('\n')[0]}).\n` +
        '   This guard reads the workflow event payload and nothing else; without it there is no diff to judge,\n' +
        '   and "could not look" must never exit 0 here.',
    );
    return EXIT_CANNOT_RUN;
  }

  const context = resolveEventContext({ eventName, payload });
  if (!context.ok) {
    console.error(`⛔ ${CHECK_CONTEXT_NAME}: ${context.reason}.`);
    return EXIT_CANNOT_RUN;
  }

  for (const rev of [context.baseSha, context.headSha]) {
    if (!hasRev(repoRoot, rev)) {
      console.error(
        `⛔ ${CHECK_CONTEXT_NAME}: ${rev} is not in this checkout, so the diff cannot be read.\n` +
          '   The job must check out with `fetch-depth: 0`; a truncated history answers a governed-surface\n' +
          '   question with silence, and silence reads as compliance (#9902).',
      );
      return EXIT_CANNOT_RUN;
    }
  }

  const notes = [];
  let rows;
  try {
    const mergeBase = git(repoRoot, ['merge-base', context.baseSha, context.headSha]).trim();
    rows = enumerateRows(repoRoot, mergeBase, context.headSha, context.namedPull);
    rows = await liftGeneratedExceptions(repoRoot, mergeBase, rows, notes);
  } catch (error) {
    console.error(`⛔ ${CHECK_CONTEXT_NAME}: could not read the diff (${String(error?.message ?? error).split('\n')[0]}).`);
    return EXIT_CANNOT_RUN;
  }

  const slug = env.GITHUB_REPOSITORY ?? 'objectstack-ai/objectstack';
  const reader = {
    apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
    slug,
    token: env.GITHUB_TOKEN || env.GH_TOKEN || null,
  };
  const fetchReviews = makeReviewReader(reader);
  const fetchPullHead = makePullHeadReader(reader);

  const verdict = await runGuard({ event: context.event, rows, fetchReviews, fetchPullHead });
  const report = [`${context.label} — ${rows.length} commit(s) in range`, ...notes, renderGuardVerdict(verdict)].join('\n');
  console.log(report);

  // The step summary is where a reader actually looks at a red queue build.
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `## ${CHECK_CONTEXT_NAME}\n\n\`\`\`text\n${report}\n\`\`\`\n`);
    } catch {
      /* a summary that cannot be written changes no verdict */
    }
  }
  return verdict.exitCode;
}

if (isEntrypoint(import.meta.url) && !process.argv.includes('--self-test')) {
  process.exitCode = await main();
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
  const approved = (...logins) => logins.map((login) => ({ state: 'APPROVED', user: { login } }));
  // The queue-predicate fixtures: a head sha, an older sha, and a review
  // carrying the `commit_id` GitHub stamps at submission time. `commit_id` no
  // longer decides anything (2026-09-04); it stays in the fixtures precisely so
  // that BOTH directions keep being measured rather than assumed away.
  const HEAD = 'f'.repeat(40);
  const OLD = '0'.repeat(40);
  const approvedAt = (login, sha) => ({ state: 'APPROVED', user: { login }, commit_id: sha });
  const authorizedPass = (login = GOVERNED_APPROVERS[0]) => authorizedApprovalVerdict([approvedAt(login, HEAD)], HEAD);
  // The same authorized approval, on a commit that is no longer the head. Under
  // the retired sha pin this exact fixture was the REFUSAL case.
  const authorizedPassOnOlder = (login = GOVERNED_APPROVERS[0]) => authorizedApprovalVerdict([approvedAt(login, OLD)], HEAD);
  const run = (event, rows, approvals = new Map()) => {
    const { governed, unattributed } = decomposeGovernedWork(rows);
    return guardVerdict({ event, governed, unattributed, approvals, apiCalls: governed.length });
  };

  // ── the register is READ, never restated (#9840) ──────────────────────────
  //
  // The one assertion that would catch this file growing its own copy of the
  // surface list: every surface the register declares must be answerable
  // through it here, including one added tomorrow.
  battery('the register is READ, never restated (#9840)');
  for (const surface of GOVERNED_SURFACES) {
    const sample = surface.prefix ? `${surface.prefix}sample.md` : surface.exact;
    const { governed } = decomposeGovernedWork([row(1, [sample])]);
    assert(`the-register-drives-the-verdict-for-${surface.id}`, governed.length === 1 && governed[0].paths.includes(sample), sample);
  }
  assert('this-file-restates-no-surface-list', GOVERNED_SURFACES.length >= 5 && governedPathsIn(['docs/adrs/z.md', 'examples/AGENTS.md']).length === 0);

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
  assert('an-approval-is-an-approval', approvalVerdict(approved('hotlong')).state === 'approved');
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
  // approver set is still 2026-08-27's (「os-zhuang hotlong 批准算数」) and the
  // constant IS the single source, so the membership pin iterates it and the
  // membership assertion pins it to the ruling: a silent edit to the set fails
  // here, and nothing else in the repo restates the names as data.
  battery('the 2026-09-04 unpinned predicate (the queue leg\'s)');
  assert('the-authorized-set-is-exactly-the-ruled-two-accounts', GOVERNED_APPROVERS.join() === 'os-zhuang,hotlong');
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
    authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[1], HEAD), { state: 'DISMISSED', user: { login: GOVERNED_APPROVERS[1] }, commit_id: HEAD }], HEAD)
      .state === 'unapproved',
  );
  assert('no-reviews-at-all-is-unapproved-under-this-predicate-too', authorizedApprovalVerdict([], HEAD).state === 'unapproved');
  assert(
    'an-unauthorized-approval-does-not-mask-an-authorized-one-on-an-older-commit',
    authorizedApprovalVerdict([approvedAt('not-authorized', HEAD), approvedAt(GOVERNED_APPROVERS[1], OLD)], HEAD).approvers.join() === GOVERNED_APPROVERS[1],
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
  assert('a-clear-diff-decomposes-to-nothing', decomposeGovernedWork(clearRows).governed.length === 0 && decomposeGovernedWork(clearRows).unattributed.length === 0);
  const mixed = decomposeGovernedWork([row(5, ['AGENTS.md', 'packages/spec/src/index.ts'])]);
  assert('a-mixed-diff-governs-the-whole-pr-and-lists-only-the-governed-paths', mixed.governed[0].paths.join() === 'AGENTS.md', JSON.stringify(mixed.governed[0].paths));
  const batched = decomposeGovernedWork([row(11, ['docs/adr/0120-x.md'], 'a'.repeat(40)), row(12, ['packages/core/src/x.ts'], 'b'.repeat(40))]);
  assert('a-batched-group-attributes-the-governed-diff-to-ITS-OWN-pr-not-the-last-one', batched.governed.length === 1 && batched.governed[0].pr === 11, JSON.stringify(batched.governed.map((g) => g.pr)));
  const twoGoverned = decomposeGovernedWork([row(11, ['AGENTS.md']), row(12, ['skills/x/SKILL.md'], 'b'.repeat(40))]);
  assert('two-governed-prs-in-one-group-are-both-carried', twoGoverned.governed.map((g) => g.pr).join() === '11,12');
  const unattributed = decomposeGovernedWork([{ sha: 'c'.repeat(40), subject: 'chore: direct work', pr: null, paths: ['CLAUDE.md'] }]);
  assert('a-governed-commit-naming-no-pr-is-UNATTRIBUTED-never-dropped', unattributed.unattributed.length === 1 && unattributed.governed.length === 0);
  assert('an-UNGOVERNED-commit-naming-no-pr-is-simply-not-our-business', decomposeGovernedWork([{ sha: 'd'.repeat(40), subject: 'x', pr: null, paths: ['README.md'] }]).unattributed.length === 0);

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

  // ── the replay fixtures: the three incidents this guard descends from ─────
  battery('the replay fixtures: the three incidents this guard descends from');
  for (const replay of REPLAYS) {
    const rows = [row(replay.pr, replay.files, 'e'.repeat(40), replay.subject)];
    const queued = run('merge_group', rows, new Map([[replay.pr, authorizedApprovalVerdict([], HEAD)]]));
    assert(`replay-REFUSES-at-the-queue: ${replay.name}`, queued.exitCode === EXIT_REFUSED_UNAPPROVED, JSON.stringify(queued.conclusion));
    const early = run('pull_request', rows, new Map([[replay.pr, approvalVerdict([])]]));
    assert(`replay-only-WARNS-on-the-pr: ${replay.name}`, early.conclusion === 'warned' && early.exitCode === EXIT_CLEAR);
    const text = renderGuardVerdict(queued);
    assert(`replay-names-its-governed-paths: ${replay.name}`, replay.files.filter((f) => governedPathsIn([f]).length > 0).every((f) => text.includes(f)), text);
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
    orderedClear = await runGuard({ event: 'merge_group', rows: clearRows, fetchReviews: explode, fetchPullHead: explode });
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
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchPullHead: () => {
      trace.push('head');
      return HEAD;
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
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchPullHead: () => HEAD,
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
    event: 'pull_request',
    rows: [row(1, ['AGENTS.md'])],
    fetchPullHead: () => {
      prHeadReads += 1;
      return HEAD;
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
      event: 'merge_group',
      rows: [row(1, ['AGENTS.md'])],
      fetchPullHead: () => HEAD,
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
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchPullHead: () => {
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
  assert('a-refusal-names-the-preferred-remedy-first-and-it-is-DEQUEUE-not-approve', refusalText.indexOf('DRAFT') < refusalText.indexOf('obtain an APPROVED review'), refusalText);
  assert('a-refusal-forecloses-the-edit-the-check-remedy', /Neither of those is "edit this check"/.test(refusalText), refusalText);
  assert('a-refusal-carries-the-runnable-derivation-command', refusalText.includes('check-governed-merges.mjs --test'), refusalText);
  const clearText = renderGuardVerdict(clearV);
  assert('a-clear-run-says-it-cost-zero-lookups', /ZERO review lookups/.test(clearText), clearText);
  assert('a-clear-run-points-at-the-register-rather-than-listing-surfaces', clearText.includes('GOVERNED_SURFACES') && !clearText.includes('docs/adr/**'), clearText);
  const warnText = renderGuardVerdict(warnedV);
  assert('the-warning-says-out-loud-that-it-is-deliberately-green', /EARLY WARNING/.test(warnText) && /GREEN here/.test(warnText), warnText);
  assert('the-warning-tells-a-seat-what-not-to-do', /flip it ready, enqueue it, or arm auto-merge/.test(warnText), warnText);
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
  );
  assert('a-certified-regeneration-inside-skills-leaves-the-row-with-nothing-governed',
    governedPathsIn(liftedRows[0].paths).length === 0, JSON.stringify(liftedRows[0].paths));
  assert('and-the-note-cites-the-ruling-that-lifted-it', liftNotes.some((n) => n.includes('#11705') && n.includes('LIFTED')), JSON.stringify(liftNotes));
  const mixedNotes = [];
  const mixedRows = await liftGeneratedExceptions('/w', 'base', [{ ...row(2, [genIndex, handAuthored]) }], mixedNotes, verified());
  assert('but-hand-authored-skill-content-in-the-same-commit-still-governs-the-row',
    governedPathsIn(mixedRows[0].paths).map((s) => s.files).flat().join() === handAuthored, JSON.stringify(mixedRows[0].paths));
  const refusedNotes = [];
  const refusedRows = await liftGeneratedExceptions('/w', 'base', [{ ...row(3, [genIndex]) }], refusedNotes, refused());
  assert('a-refused-provenance-keeps-the-generated-path-governed-here-too',
    refusedRows[0].paths.join() === genIndex && refusedNotes.some((n) => n.includes('did NOT lift')), JSON.stringify(refusedNotes));
  // The DEGRADED environment — the job installs dependencies now (#14063), but
  // every step of that install is `continue-on-error`, so "no toolchain" is a
  // state a real run can still be in (registry outage, cold cache, a PR whose
  // lockfile is out of sync). Fail-closed is the ruled answer there, and it must
  // be the one a reader sees stated.
  const noToolNotes = [];
  const noToolRows = await liftGeneratedExceptions('/w', 'base', [{ ...row(4, [genIndex]) }], noToolNotes,
    refused('could not run `pnpm --filter @objectstack/spec gen:skill-refs` on this tree (spawn pnpm ENOENT) — the generator toolchain is not available in this environment'));
  assert('with-no-generator-toolchain-this-guard-keeps-the-path-governed-and-says-why',
    noToolRows[0].paths.join() === genIndex && noToolNotes.some((n) => /toolchain is not available/.test(n)), JSON.stringify(noToolNotes));
  // A commit that touches no registered path never consults provenance — the
  // recompute is handed a spy that throws if it is called at all.
  const untouched = await liftGeneratedExceptions('/w', 'base', [{ ...row(5, ['AGENTS.md']) }], [], async () => {
    throw new Error('the recompute must not run for a diff with no registered path');
  });
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
  const endToEnd = async (recompute, rows, { head = () => HEAD, reviews = () => [] } = {}) => {
    const notes = [];
    const lifted = await liftGeneratedExceptions('/w', 'base', rows, notes, recompute);
    return { verdict: await runGuard({ event: 'merge_group', rows: lifted, fetchPullHead: head, fetchReviews: reviews }), notes };
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
    });
  } catch (error) {
    liftThrew = String(error?.message ?? error);
  }
  assert('a-recompute-that-THROWS-never-lifts-it-propagates-into-CANNOT-RUN', liftThrew !== null && /EACCES/.test(liftThrew), String(liftThrew));

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
    (await makePullHeadReader({ ...readerArgs, fetchImpl: fakeRes({ head: { sha: HEAD } }) })(7)) === HEAD,
  );
  const readerThrow = async (fetchImpl) => {
    try {
      await makePullHeadReader({ ...readerArgs, fetchImpl })(7);
      return null;
    } catch (error) {
      return String(error?.message ?? error);
    }
  };
  assert('a-non-2xx-pull-read-throws-with-its-status', /HTTP 502/.test(await readerThrow(fakeRes({}, false, 502))));
  assert('a-body-with-no-parseable-head-sha-throws-never-pins-nothing-silently', /head\.sha/.test(await readerThrow(fakeRes({ head: {} }))));

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
      'degradation).',
  );

  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url) && process.argv.includes('--self-test')) {
  const selfTestCode = await selfTest();
  if (!selfTestReachedVerdict) {
    console.error(
      '\n✗ check-governed-queue-guard self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
  process.exit(selfTestCode);
}
