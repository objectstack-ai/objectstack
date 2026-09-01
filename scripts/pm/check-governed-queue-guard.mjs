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
 * ## What satisfies it — an AUTHORIZED approval pinned to the exact head
 *
 * The predicate has two dated layers; the LATER one is the one enforced.
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
 * authorized set, verbatim: 「os-zhuang hotlong 批准算数」. The queue leg now
 * passes a governed PR iff an APPROVED review by an account in
 * `GOVERNED_APPROVERS` (the single source — protocol text references the
 * constant, never copies the names) has `commit_id` equal to the PR's CURRENT
 * head sha. A stale approval (any push after it) never counts; DISMISSED and
 * superseded approvals never count. review → Approve → done: the queue merges,
 * restoring the merge-time re-validation the bypass direct merge loses — and
 * the direct merge stays the fallback path.
 *
 * #11704's retraction still bounds the design: attribution from the GitHub
 * actor field is not a reading, so this guard stays keyed on the DIFF'S PATHS
 * and on the review record — the one artifact that IS a deliberate, timestamped
 * act bound to exact bytes — never on who pushed or merged.
 *
 * The #8161 identity concern did not vanish; it moved into a NORMATIVE
 * prohibition landed with this predicate: ⛔ an agent seat never submits an
 * approving review on a governed-surface PR, under ANY account. `os-zhuang` is
 * also operated by agent seats, so with it in the authorized set the technical
 * control is normative for any agent holding those credentials — same class as
 * the seat-side no-merge rule. The Director's governed-merge audit reads the
 * APPROVER as well as the merger; an agent-submitted governed approval is an
 * incident. What the sha pin adds mechanically: the approval is bound to the
 * exact bytes the maintainer read, so a later push silently reopens this
 * refusal instead of riding the old approval through.
 *
 * ⚠️ An outstanding CHANGES_REQUESTED from ANOTHER reviewer does NOT flip the
 * verdict here, and that is deliberate restraint rather than an oversight: the
 * ruled predicate is the authorized pinned approval (a reviewer's own later
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
 * `.claude/workflows/docs-accuracy-audit.js` holds a required gate's own
 * `--write` artifact, so EVERY page-adding docs PR touches the governed
 * surface (measured 5-for-5 on #9866). A guard that refuses those refuses
 * routine traffic, which is the same poison one level down. The #10277 Option-C
 * exception (maintainer 「10277 同意 C」) is therefore applied here through the
 * register's own `applyGeneratedExceptions`, with provenance recomputed
 * BYTE-EXACT against this build's own base sha — never a stored baseline, and
 * fail-closed on every error path, exactly as the four ruled constraints
 * require.
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
 *                 governed PR carries an authorized APPROVED review pinned to
 *                 its current head, or this is the `pull_request` early-warning
 *                 run.
 *   3  REFUSED  — governed, and at least one governed PR carries no authorized
 *                 APPROVED review pinned to its current head (none at all,
 *                 unauthorized account, stale sha, dismissed or superseded).
 *                 Deliberately 3, the same code the sibling's `--test`
 *                 answers "GOVERNED" with, so the two tools agree on the number
 *                 that means "this diff is governed and unsatisfied".
 *   4  REFUSED  — governed, and the PR head or review list could not be READ.
 *                 Distinct from 3 on purpose: "nobody approved" and "we could
 *                 not find out" are different facts and must be separable in a
 *                 log.
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
 * The `merge_group` predicate (2026-08-27 ruling — see the header): does an
 * account in `GOVERNED_APPROVERS` hold a latest-decisive APPROVED review whose
 * `commit_id` equals the PR's CURRENT head sha?
 *
 * Same latest-decisive-per-reviewer reduction as `approvalVerdict` — a
 * DISMISSED or superseded approval is not an approval — with two more ways to
 * not count, each reported separately so a queue log can be acted on:
 * `staleApprovers` (authorized, APPROVED, wrong sha — a push happened after
 * the approval) and `unauthorizedApprovers` (APPROVED, not in the set). An
 * empty or unparsable head sha pins NOTHING: fail closed, never "any sha".
 *
 * Pure; the array is expected in GitHub's chronological order, so last wins.
 */
export function pinnedApprovalVerdict(reviews, headSha) {
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
  const staleApprovers = [];
  const unauthorizedApprovers = [];
  for (const [login, review] of latest) {
    if (review.state !== 'APPROVED') continue;
    if (!GOVERNED_APPROVERS.includes(login)) {
      unauthorizedApprovers.push(login);
    } else if (head !== null && review.commitId === head) {
      approvers.push(login);
    } else {
      staleApprovers.push({ login, commitId: review.commitId });
    }
  }
  return {
    state: approvers.length > 0 ? 'approved' : 'unapproved',
    approvers,
    staleApprovers,
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
export function guardVerdict({ event, governed = [], unattributed = [], approvals = new Map(), apiCalls = 0 }) {
  const entries = governed.map((entry) => ({
    ...entry,
    approval: approvals.get(entry.pr) ?? unreadableApproval('no review reading was recorded for this pull request'),
  }));
  const base = { event, entries, unattributed, apiCalls, contextName: CHECK_CONTEXT_NAME };

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

  // A pinned verdict (the queue leg) carries `headSha`; the `pull_request`
  // leg's `approvalVerdict` shape does not, and its lines stay byte-identical.
  const pinned = (approval) => approval.headSha !== undefined;
  for (const entry of verdict.entries) {
    lines.push('', `  #${entry.pr} — governed:`);
    lines.push(...surfaceLines(entry));
    if (entry.approval.state === 'approved') {
      lines.push(
        pinned(entry.approval)
          ? `        ✅ authorized APPROVED review pinned to head ${entry.approval.headSha.slice(0, 12)}, by: ${entry.approval.approvers.join(', ')}`
          : `        ✅ APPROVED review present, by: ${entry.approval.approvers.join(', ')}`,
      );
    } else if (entry.approval.state === 'unreadable') {
      lines.push(`        ⛔ the review list could NOT be read — ${entry.approval.reason}`);
    } else if (pinned(entry.approval)) {
      lines.push(
        `        ⛔ NO authorized APPROVED review pinned to head ${String(entry.approval.headSha).slice(0, 12)} ` +
          `(${entry.approval.reviewsRead} review(s) read; authorized: ${GOVERNED_APPROVERS.join(', ')})`,
      );
      for (const stale of entry.approval.staleApprovers ?? []) {
        lines.push(
          `        ⚠️  ${stale.login} approved at ${(stale.commitId || '(no commit_id)').slice(0, 12)} but the head is ` +
            `${String(entry.approval.headSha).slice(0, 12)} — STALE, never counts: a push after the approval reopens this gate`,
        );
      }
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
        ...(pinned(entry.approval)
          ? [
              '            (informational — the ruled predicate is an authorized APPROVED review pinned to the',
              "             PR's current head; this guard does not widen past its own ruling)",
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
      `      authorized approver (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')}) whose commit_id equals that`,
      "      PR's CURRENT head sha — the 2026-08-27 ruled predicate (「os-zhuang hotlong 批准算数」; a stale,",
      '      dismissed, superseded or unauthorized approval never counts). ⛔ An agent seat never submits an',
      '      approving review on a governed-surface PR, under any account. The post-merge audit',
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
      '      At least one governed pull request above carries NO authorized APPROVED review pinned to its',
      '      current head, and the merge queue would have been the entire review — the shape of #9550,',
      '      #10580 and #9319.',
    );
  }
  lines.push(
    '',
    '      What satisfies this check:',
    '        1. ⭐ PREFERRED — take the pull request out of the queue: convert it back to DRAFT (disarming',
    '           auto-merge alone does NOT dequeue it), and leave the merge to the maintainer. A human merge',
    '           IS the review record for a governed surface; that is the regime, not a workaround of it.',
    `        2. Or: obtain an APPROVED review by an authorized approver (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')})`,
    "           pinned to each governed PR's CURRENT head sha, then re-queue (2026-08-27: 「os-zhuang hotlong",
    '           批准算数」; any push after the approval goes stale and reopens this refusal). ⛔ An agent seat',
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
 */
export async function runGuard({ event, rows, fetchReviews, fetchPullHead }) {
  const { governed, unattributed } = decomposeGovernedWork(rows);
  if (governed.length === 0 && unattributed.length === 0) {
    return guardVerdict({ event, governed, unattributed, apiCalls: 0 });
  }
  const approvals = new Map();
  let apiCalls = 0;
  for (const entry of governed) {
    try {
      if (event === EVENT_MERGE_GROUP) {
        // The queue leg judges the 2026-08-27 pinned predicate, so it needs
        // the PR's CURRENT head sha — the merge_group payload does not carry
        // per-PR heads. Two reads, head first: an unreadable head refuses
        // without ever constructing the review request.
        apiCalls += 1;
        const headSha = await fetchPullHead(entry.pr);
        apiCalls += 1;
        approvals.set(entry.pr, pinnedApprovalVerdict(await fetchReviews(entry.pr), headSha));
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
  return guardVerdict({ event, governed, unattributed, approvals, apiCalls });
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

export async function selfTest() {
  let checked = 0;
  const failures = [];
  const assert = (name, cond, detail) => {
    checked += 1;
    if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  };
  const row = (pr, files, sha = 'a'.repeat(40), subject = `x (#${pr})`) => ({ sha, subject, pr, paths: files });
  const approved = (...logins) => logins.map((login) => ({ state: 'APPROVED', user: { login } }));
  // The pinned-predicate fixtures: a head sha, an older sha, and a review
  // carrying the `commit_id` GitHub stamps at submission time.
  const HEAD = 'f'.repeat(40);
  const OLD = '0'.repeat(40);
  const approvedAt = (login, sha) => ({ state: 'APPROVED', user: { login }, commit_id: sha });
  const pinnedPass = (login = GOVERNED_APPROVERS[0]) => pinnedApprovalVerdict([approvedAt(login, HEAD)], HEAD);
  const run = (event, rows, approvals = new Map()) => {
    const { governed, unattributed } = decomposeGovernedWork(rows);
    return guardVerdict({ event, governed, unattributed, approvals, apiCalls: governed.length });
  };

  // ── the register is READ, never restated (#9840) ──────────────────────────
  //
  // The one assertion that would catch this file growing its own copy of the
  // surface list: every surface the register declares must be answerable
  // through it here, including one added tomorrow.
  for (const surface of GOVERNED_SURFACES) {
    const sample = surface.prefix ? `${surface.prefix}sample.md` : surface.exact;
    const { governed } = decomposeGovernedWork([row(1, [sample])]);
    assert(`the-register-drives-the-verdict-for-${surface.id}`, governed.length === 1 && governed[0].paths.includes(sample), sample);
  }
  assert('this-file-restates-no-surface-list', GOVERNED_SURFACES.length >= 5 && governedPathsIn(['docs/adrs/z.md', 'examples/AGENTS.md']).length === 0);

  // ── the exit contract as a table ──────────────────────────────────────────
  assert('exit-clear-is-0', EXIT_CLEAR === 0);
  assert('exit-cannot-run-is-1', EXIT_CANNOT_RUN === 1);
  assert(
    'the-three-refusals-are-distinct-non-zero-codes',
    new Set([EXIT_REFUSED_UNAPPROVED, EXIT_REFUSED_UNREADABLE, EXIT_REFUSED_UNATTRIBUTED]).size === 3 &&
      ![EXIT_REFUSED_UNAPPROVED, EXIT_REFUSED_UNREADABLE, EXIT_REFUSED_UNATTRIBUTED].includes(0),
  );
  assert('the-unapproved-refusal-shares-the-siblings-GOVERNED-code-3', EXIT_REFUSED_UNAPPROVED === 3);

  // ── the merge-queue head ref ──────────────────────────────────────────────
  assert('queue-ref-yields-its-pr', pullNumberFromQueueRef('refs/heads/gh-readonly-queue/main/pr-11387-484ae0019cd') === 11387);
  assert('queue-ref-without-the-refs-prefix-too', pullNumberFromQueueRef('gh-readonly-queue/main/pr-42-abcdef1') === 42);
  assert('a-base-branch-with-a-slash-is-still-read', pullNumberFromQueueRef('refs/heads/gh-readonly-queue/release/v5/pr-7-abcdef1') === 7);
  assert('an-ordinary-branch-that-merely-looks-like-one-is-NOT-a-queue-ref', pullNumberFromQueueRef('refs/heads/pr-12-abcdef1') === null);
  assert('a-plain-branch-is-null', pullNumberFromQueueRef('refs/heads/claude/issue-1-x') === null);
  assert('nonsense-is-null-never-a-number', pullNumberFromQueueRef(undefined) === null && pullNumberFromQueueRef('') === null);

  // ── event payloads, including the malformed ones ──────────────────────────
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
  assert('an-approval-is-an-approval', approvalVerdict(approved('hotlong')).state === 'approved');
  assert('no-reviews-at-all-is-unapproved', approvalVerdict([]).state === 'unapproved');
  assert('a-COMMENTED-review-is-not-an-approval', approvalVerdict([{ state: 'COMMENTED', user: { login: 'a' } }]).state === 'unapproved');
  // ⭐ The fail-open direction a naive `.some(r => r.state === 'APPROVED')`
  // gets wrong, and the only direction this file may not be wrong in.
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

  // ── the 2026-08-27 pinned predicate (the queue leg's) ─────────────────────
  //
  // 「os-zhuang hotlong 批准算数」 — the constant IS the single source, so the
  // membership pin iterates it and the membership assertion pins it to the
  // ruling: a silent edit to the set fails here, and nothing else in the repo
  // restates the names as data.
  assert('the-authorized-set-is-exactly-the-ruled-two-accounts', GOVERNED_APPROVERS.join() === 'os-zhuang,hotlong');
  for (const login of GOVERNED_APPROVERS) {
    assert(`an-authorized-approval-pinned-to-the-current-head-passes: ${login}`, pinnedApprovalVerdict([approvedAt(login, HEAD)], HEAD).state === 'approved');
  }
  const stale = pinnedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], OLD)], HEAD);
  assert('a-STALE-authorized-approval-never-counts', stale.state === 'unapproved' && stale.staleApprovers[0]?.login === GOVERNED_APPROVERS[0]);
  assert('an-approval-with-no-commit_id-is-stale-never-pinned', pinnedApprovalVerdict(approved(GOVERNED_APPROVERS[0]), HEAD).state === 'unapproved');
  const outsider = pinnedApprovalVerdict([approvedAt('not-authorized', HEAD)], HEAD);
  assert('an-unauthorized-approval-never-counts-even-pinned-to-head', outsider.state === 'unapproved' && outsider.unauthorizedApprovers.join() === 'not-authorized');
  assert(
    'an-authorized-approval-later-superseded-by-CHANGES_REQUESTED-never-counts',
    pinnedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], HEAD), { state: 'CHANGES_REQUESTED', user: { login: GOVERNED_APPROVERS[0] }, commit_id: HEAD }], HEAD)
      .state === 'unapproved',
  );
  assert(
    'a-DISMISSED-authorized-approval-never-counts',
    pinnedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[1], HEAD), { state: 'DISMISSED', user: { login: GOVERNED_APPROVERS[1] }, commit_id: HEAD }], HEAD)
      .state === 'unapproved',
  );
  assert('no-reviews-at-all-is-unapproved-under-the-pinned-predicate-too', pinnedApprovalVerdict([], HEAD).state === 'unapproved');
  assert(
    'an-unauthorized-approval-does-not-mask-an-authorized-pinned-one',
    pinnedApprovalVerdict([approvedAt('not-authorized', HEAD), approvedAt(GOVERNED_APPROVERS[1], HEAD)], HEAD).approvers.join() === GOVERNED_APPROVERS[1],
  );
  assert('the-sha-comparison-is-case-insensitive', pinnedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], HEAD.toUpperCase())], HEAD).state === 'approved');
  assert(
    'an-unparsable-head-sha-pins-NOTHING-fail-closed',
    pinnedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], '')], '').state === 'unapproved' &&
      pinnedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], HEAD)], undefined).state === 'unapproved',
  );

  // ── decomposition, and the multi-PR group trap ────────────────────────────
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
  const clearV = run('merge_group', clearRows);
  assert('a-clear-merge-group-is-CLEAR-and-exits-0', clearV.conclusion === 'clear' && clearV.exitCode === EXIT_CLEAR);
  assert('and-it-made-zero-review-lookups', clearV.apiCalls === 0);
  const refusedV = run('merge_group', [row(9527, ['AGENTS.md'])], new Map([[9527, pinnedApprovalVerdict([], HEAD)]]));
  assert('an-unapproved-governed-merge-group-is-REFUSED-with-code-3', refusedV.conclusion === 'refused' && refusedV.exitCode === EXIT_REFUSED_UNAPPROVED);
  const clearedV = run('merge_group', [row(9527, ['AGENTS.md'])], new Map([[9527, pinnedPass()]]));
  assert('an-authorized-pinned-approval-CLEARS-the-merge-group-and-exits-0', clearedV.conclusion === 'cleared' && clearedV.exitCode === EXIT_CLEAR);
  const staleV = run('merge_group', [row(9527, ['AGENTS.md'])], new Map([[9527, pinnedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], OLD)], HEAD)]]));
  assert('a-stale-sha-approval-REFUSES-the-merge-group-with-code-3', staleV.conclusion === 'refused' && staleV.exitCode === EXIT_REFUSED_UNAPPROVED);
  const outsiderV = run('merge_group', [row(9527, ['AGENTS.md'])], new Map([[9527, pinnedApprovalVerdict([approvedAt('not-authorized', HEAD)], HEAD)]]));
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
    new Map([[11, pinnedPass()], [12, pinnedApprovalVerdict([], HEAD)]]),
  );
  assert('one-approved-pr-does-NOT-carry-an-unapproved-sibling-through-the-same-group', partial.exitCode === EXIT_REFUSED_UNAPPROVED);

  // ── the pull_request leg is an EARLY WARNING and never reddens ────────────
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
  for (const replay of REPLAYS) {
    const rows = [row(replay.pr, replay.files, 'e'.repeat(40), replay.subject)];
    const queued = run('merge_group', rows, new Map([[replay.pr, pinnedApprovalVerdict([], HEAD)]]));
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
    'the-pinned-predicate-is-wired-end-to-end-an-authorized-pinned-approval-CLEARS',
    traced.conclusion === 'cleared' && traced.exitCode === EXIT_CLEAR && traced.apiCalls === 2,
    JSON.stringify({ conclusion: traced.conclusion, apiCalls: traced.apiCalls }),
  );
  const tracedStale = await runGuard({
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchPullHead: () => HEAD,
    fetchReviews: () => [approvedAt(GOVERNED_APPROVERS[0], OLD)],
  });
  assert('the-pinned-predicate-is-wired-end-to-end-a-stale-approval-REFUSES', tracedStale.exitCode === EXIT_REFUSED_UNAPPROVED);
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
  // An unreadable PR HEAD is its own refusal, and the review request is never
  // even constructed after it — fail closed, in order.
  let reviewsAfterHeadFailure = 0;
  const headFailed = await runGuard({
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchPullHead: () => {
      throw new Error('HTTP 500');
    },
    fetchReviews: () => {
      reviewsAfterHeadFailure += 1;
      return [];
    },
  });
  assert(
    'an-unreadable-pr-head-REFUSES-with-exit-4-and-never-reads-reviews',
    headFailed.exitCode === EXIT_REFUSED_UNREADABLE && reviewsAfterHeadFailure === 0 && /500/.test(renderGuardVerdict(headFailed)),
    `reviewsAfterHeadFailure=${reviewsAfterHeadFailure}`,
  );

  // ── the words a reader acts on (requirement (e)) ──────────────────────────
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
  const staleText = renderGuardVerdict(staleV);
  assert(
    'a-stale-refusal-names-both-shas-so-a-reader-can-see-the-push-that-unpinned-it',
    staleText.includes(OLD.slice(0, 12)) && staleText.includes(HEAD.slice(0, 12)) && /STALE, never counts/.test(staleText),
    staleText,
  );
  assert(
    'an-unauthorized-refusal-says-the-approval-never-counts',
    /APPROVED by account\(s\) outside GOVERNED_APPROVERS: not-authorized — never counts/.test(renderGuardVerdict(outsiderV)),
    renderGuardVerdict(outsiderV),
  );
  const clearedText = renderGuardVerdict(clearedV);
  assert(
    'the-cleared-summary-states-the-pinned-predicate-and-derives-its-accounts-from-the-constant',
    /commit_id equals/.test(clearedText) && GOVERNED_APPROVERS.every((login) => clearedText.includes(login)) && /APPROVER as well as the merger/.test(clearedText),
    clearedText,
  );
  assert(
    'a-pinned-pass-renders-the-head-it-is-pinned-to',
    renderGuardVerdict(clearedV).includes(`pinned to head ${HEAD.slice(0, 12)}`),
    renderGuardVerdict(clearedV),
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

  // ── the PR-head reader: throws, never defaults (exit 4 at the caller) ────
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

  for (const f of failures) console.error(`  ✗ ${f}`);
  if (failures.length > 0) {
    console.error(`✗ check-governed-queue-guard self-test: ${failures.length} of ${checked} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-governed-queue-guard self-test: ${checked} cases pass ` +
      '(register-driven verdicts, the queue/PR event split, latest-decisive approval reduction, the 2026-08-27 ' +
      'authorized-approval-pinned-to-head predicate on the queue leg — pass, stale, unauthorized, dismissed/superseded, ' +
      'none — with the PR leg byte-identical and head-read-free, multi-PR group decomposition, three replayed ' +
      'incidents, the zero-API ordering guarantee measured with throwing spies, the head-then-reviews read order with ' +
      'both unreadable refusals, the generated-artifact lift path — certified, refused, mixed with hand-authored skill ' +
      'content, and the degraded no-toolchain environment — the #14063 end-to-end decision on a #13794-shaped pure ' +
      'regeneration (clears with zero approvals and zero API calls; still refuses on an uncertified recompute, on ' +
      'drift, on a hand-authored sibling, and on a recompute that throws), and the workflow wiring pin including the ' +
      'dependency install the recompute needs, its register-agnostic filter-free form, and its continue-on-error ' +
      'degradation).',
  );
  return 0;
}

if (isEntrypoint(import.meta.url) && process.argv.includes('--self-test')) {
  process.exit(await selfTest());
}
