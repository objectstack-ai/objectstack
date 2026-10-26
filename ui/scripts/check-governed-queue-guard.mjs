#!/usr/bin/env node

/**
 * check-governed-queue-guard — a governed-surface change may not reach `main`
 * through the merge queue without a human approval record on the pull request
 * it is landing from.
 *
 *   node scripts/check-governed-queue-guard.mjs               # in CI, from the event payload
 *   node scripts/check-governed-queue-guard.mjs --test <paths…>  # offline: "would these govern a PR?"
 *   node scripts/check-governed-queue-guard.mjs --self-test   # offline, no network, no git
 *
 * ## The measured incident this exists for (objectui#6596, ruling 2026-08-27)
 *
 * PR #6183 touched `AGENTS.md` and was correctly parked as a draft for the
 * maintainer to merge by hand. A GitHub MCP `update_pull_request` call passing
 * only `reviewers` silently also set `draft: false`; the pull request entered
 * the merge queue and landed as `5b3290fd5` with no human approval. Converting
 * it back to a draft afterwards did NOT dequeue it. The tool fact is
 * objectstack-ai/objectstack#12200; the incident record and the decision are
 * objectui#6325.
 *
 * Every layer that could have stopped it was a layer of seat discipline, and
 * the failure had no seat in it at all — a hidden side effect on a tool call
 * plus a queue that does not release what it has taken. The maintainer's ruling
 * (「同意，并继续」, accepting Option A + C on #6325) is that the rule stops
 * resting on discipline: this file is the refusal.
 *
 * ## ⭐ The split by EVENT — the single most load-bearing decision here
 *
 *   `merge_group`   → a governed diff whose pull request carries no AUTHORIZED
 *                     APPROVED review is a REFUSAL. The queue build is the last
 *                     thing between a speculative merge and `main`, and it is
 *                     the path the incident took.
 *   `pull_request`  → the identical finding is an EARLY WARNING that exits 0.
 *
 * The pull-request leg must not redden, and not out of politeness. A governed
 * PR sitting as a draft while it waits for an authorized APPROVED review is the
 * CORRECT resting state of this regime, so a check that is red on it is red on
 * the healthy case, forever — and a permanently red check trains everyone to
 * ignore red. The sibling repository retired a gate for exactly that
 * (objectstack's 2026-08-18 ruling, 红灯常态化本身有毒). The queue build is the
 * opposite: a state an UNAPPROVED governed PR should never be in at all, so red
 * there is red on the anomaly.
 *
 * ⭐ What follows the approval is this check's own PASS path, which is why the
 * queue leg is not only a refusal. Ruling C (maintainer 2026-09-13,
 * objectstack-ai/objectstack#17971, carried into this repository's AGENTS.md
 * governed-surface section) is quoted verbatim and untranslated:
 *
 *     「C. approve 后不管后续改动都由席位落地:」
 *
 * Once an authorized APPROVED review is on record, that approval IS the review
 * record for a governed surface: the claiming seat readies it and arms
 * auto-merge, and the queue lands it. The seat's ready → enqueue is the correct
 * next act there, not a violation.
 *
 * ⚠️ Stated out loud rather than discovered: this guard CANNOT stop a
 * maintainer merging a governed PR directly, and does not try. A direct merge
 * produces no `merge_group` event; it is the maintainer's own act, not a seat's.
 * What this guard closes is the seat path taken WITHOUT an authorized approval:
 * flip ready → enqueue → the queue is the entire review, which is the shape of
 * #6183 exactly.
 *
 * ## What satisfies the queue leg
 *
 * A latest-decisive APPROVED review by an account in `GOVERNED_APPROVERS`, on
 * WHICHEVER commit it was left. DISMISSED and superseded approvals (a later
 * CHANGES_REQUESTED by the same reviewer) never count; an APPROVED review by an
 * account outside that set never counts; an empty or unreadable review list
 * fails closed. The predicate is the EXISTENCE OF A HUMAN APPROVAL RECORD, and
 * says nothing about which bytes it was given for.
 *
 * ⭐ That is a REVERSAL of this file's first predicate, which required the
 * review's `commit_id` to equal the pull request's current head. The maintainer
 * ruled it out in the live PM chat on 2026-09-04 — quoted verbatim and
 * untranslated, because rewriting a ruling is rewriting the ruling:
 *
 *     「你的门禁有问题，只需要有人工批准记录就行，不需要卡最新的提交。」
 *
 * It was ruled while objectui PR #7473 was being approved over and over by an
 * authorized approver as its head moved: every push after an approval turned it
 * stale and reopened the refusal, so the gate spent scarce human attention
 * re-approving bytes nobody disputed. ⛔ The sha pin is RETIRED, not softened —
 * no predicate here reads `commit_id`, there is no stale bucket, and the
 * pull-request head read that existed only to feed the pin is gone with it. An
 * inert "stale" reading kept for old times' sake would be a field that can never
 * be non-empty again, and a reader would take its presence as evidence that this
 * gate still measures staleness.
 *
 * ⚠️ The self-test below still WRITES a `commit_id` into its fixtures, and that
 * is deliberate rather than leftover: "the commit does not matter" is only
 * measurable on cases where the commits actually differ, so grepping this file
 * for `commit_id` finds the evidence, never a surviving comparison.
 *
 * ⚠️ The accepted cost, stated out loud rather than left to be discovered: a
 * push after an approval is no longer re-reviewed by this gate, so an approved
 * governed pull request can land carrying bytes its approver never read — the
 * maintainer accepts that, and ruling C (quoted above) says the same thing from
 * the landing side: after the approval, the seat lands it whatever changes
 * follow.
 *
 * The remedy the refusal prints FIRST is NOT approval: take the pull request
 * out of the queue by converting it back to DRAFT (disarming auto-merge alone
 * does not dequeue it) and park it there. Only after that comes the authorized
 * APPROVED review — on any commit, not dismissed — and then the claiming seat
 * readies it and arms auto-merge, and the queue lands it.
 *
 * ⛔ An agent seat never submits an approving review on a governed-surface pull
 * request, under any account. Every seat in this repository writes under a
 * shared GitHub identity, so `GOVERNED_APPROVERS` is a technical control that
 * is only as good as that normative rule — the same class as the seat-side
 * no-merge rule, and the reason the DRAFT remedy is listed first. ⚠️ With the
 * pin retired that rule carries MORE weight, not less: one approval now clears
 * every later push on the same pull request.
 *
 * ## Ordering: the path test runs FIRST, and a clear diff costs zero API calls
 *
 * ⛔ Fail-open on an API error is wrong in this file — it exists because
 * everything else in the chain failed open — so an unreadable review list is a
 * REFUSAL with its own exit code, never a pass. But a diff touching nothing
 * governed must never be blocked by an API hiccup either. The two are
 * reconciled by ORDER, not by tolerance: `runGuard` decomposes the diff and
 * returns before constructing a single request when nothing governed is in it.
 * The self-test pins that with a `fetchReviews` that THROWS if it is called at
 * all — a spy, not a mock, because "we did not need the API" is the claim.
 *
 * ## Multi-PR merge groups, and the under-enumeration trap
 *
 * A merge group can carry SEVERAL pull requests. `merge_group.head_ref` names
 * only the LAST one, so keying the whole group's diff to it would check the
 * wrong PR's reviews — and in the direction that reads as compliance: PR B is
 * approved, PR A's governed diff rides in behind it. So the group is decomposed
 * PER COMMIT: each first-parent commit is one PR landing, its number read from
 * its subject, and every governed PR is judged on its OWN reviews. A commit
 * that touches a governed path and names no pull request is UNATTRIBUTED — its
 * own refusal, with its own exit code.
 *
 * ## Why this is objectui-native rather than a copy
 *
 * The sibling repository runs this mechanism already, and this file follows its
 * shape closely. It is NOT a copy of the sibling's files, and that is a
 * measurement rather than a preference:
 *
 *   - Upstream splits the mechanism over two files, and the register half
 *     (`scripts/pm/check-governed-merges.mjs`, 2,614 lines) is mostly a
 *     multi-repo post-merge audit plus a provenance-recompute engine for
 *     GENERATED artifacts sitting inside governed paths. This repository has
 *     none of those artifacts: `.claude/workflows/` does not exist here, and
 *     `skills/` carries no generator output (no `references/_index.md`, no
 *     react-blocks contract) — measured on the tree this landed against. Every
 *     row of that register is inapplicable, so a port would carry ~1,500 lines
 *     of machinery that can never fire.
 *
 * So the divergence is declared in prose, where a reader can act on it: when
 * the sibling's predicate changes, this file is a hand re-read.
 *
 * ## The SECOND leg: the contract-review carrier (objectui#9018)
 *
 * Everything above is about GOVERNED SURFACES. This file also carries a second,
 * independent queue predicate, and it is keyed on a LABEL rather than on paths.
 * It is a re-implementation of the leg objectstack landed in its own guard
 * (objectstack#17040 → PR objectstack#17484, merged 2026-09-10 as `33e07f7c`),
 * against THIS file's shapes — the same relationship the rest of this file has
 * to its sibling, and for the same measured reason (see the section above).
 *
 * ⚠️ THE GOVERNING RULE DOES NOT LIVE IN THIS REPOSITORY, and saying so is not
 * pedantry — it is the difference between a citation a reader can follow and a
 * path they will grep for and not find. objectui has no `.claude/skills/pm-dispatch/`
 * tree at all (measured on the tree this landed against: `.claude/skills/` holds
 * `objectui-contributor` and `verify`, and nothing else). The rule is the PM
 * dispatch protocol's, and it lives in the sibling repository:
 * `objectstack-ai/objectstack` `.claude/skills/pm-dispatch/SKILL.md` 〈入队与落地〉.
 * The quote IS the operative criterion rather than a summary of one, so it is
 * reproduced verbatim and untranslated rather than paraphrased:
 *
 *   > 双肢命中任一 ⇒ 无席内条款②复核 PASS 在案 ⛔ 禁止入队
 *
 * with that skill's `references/contract-review.md` 〈载体纪律〉 supplying the
 * reading of the label itself: 「开着的载体恒 = 真实待审」. So
 * `needs:contract-review` on a pull request IS the gate, and until this leg
 * nothing mechanical read it at objectui's queue: the label's only occurrence
 * anywhere under `scripts/` was `CONTRACT_REVIEW_LABEL` in
 * `scripts/pm/check-half-states.mjs` — the PM half-state census, a report-only
 * instrument that never reaches a queue build.
 *
 * ⭐ THE HONEST BOUNDARY, and it is not a detail: this leg reads the LABEL, not
 * the verdict. Of the eleven enqueues objectstack measured for 2026-09-09, SIX
 * had the carrier stripped shortly before the enqueue with no PASS on record
 * for that head, and this leg passes every one of them — 「被剥」 and 「从未挂过」
 * are the same bytes to a label reader. Four of those six are objectui's own
 * (#8795, #8796, #8799, #8164), and objectui#8164 landed a real published-face
 * defect. ⛔ Reading that as "this leg would have caught #8164" is exactly
 * backwards, and upgrading this predicate until it does would make it a VERDICT
 * check — a strictly larger rule than the one ruled. ⚠️ objectui has no verdict
 * checker to defer that question to: the sibling defers it to its
 * `scripts/pm/check-clause2-carriers.mjs`, and this repository has no such file
 * (measured). Nor does anything here compare the gate's two CARRIERS any more:
 * the sweeper copy whose H31 did that was retired by objectui#10208.
 * The CLEAR rendering says all of this out loud, so nobody reads a green carrier
 * leg as "the review happened".
 *
 * ⚖️ THE ACCEPTED COST: there is no cheap local pre-filter for this leg, because
 * a carrier is remote state a seat hangs rather than a property of the diff. So
 * unlike the governed leg, every merge group now costs one label read per queued
 * pull request, and a GitHub outage refuses a merge group whose diff touches
 * nothing governed. The zero-cost-clear rendering below is SCOPED to say so
 * rather than left making a promise this leg has taken away. Fail-open was the
 * alternative, and it is ruled out here by construction.
 *
 * ## Exit codes — the refusal is impossible to read as clean
 *
 *   0  CLEAR    — nothing governed in the diff (no API call was made), or every
 *                 governed PR carries an authorized APPROVED review, or this is
 *                 the `pull_request` early warning.
 *   3  REFUSED  — governed, and at least one governed PR carries no authorized
 *                 APPROVED review (none at all, unauthorized account, dismissed
 *                 or superseded).
 *   4  REFUSED  — governed, and the review list could not be READ. Distinct
 *                 from 3 on purpose: "nobody approved" and "we could not find
 *                 out" are different facts and must be separable.
 *   5  REFUSED  — governed paths on a commit attributable to no pull request.
 *   6  REFUSED  — a queued pull request carries `needs:contract-review`
 *                 (objectui#9018). The CARRIER leg, not the governed one, and
 *                 it fires on a diff that touches nothing governed at all.
 *   7  REFUSED  — the carrier leg could not READ a queued pull request's labels,
 *                 or the merge group names no pull request to read them from.
 *                 Split from 6 for the same reason 4 is split from 3.
 *   1  CANNOT RUN — unusable event payload, unsupported event, unreadable git.
 *                 Still non-zero, still red: this file has no green that means
 *                 "did not look".
 *   2  BAD USAGE — `--test` with no paths. Not a verdict about a tree.
 *
 * ## What this file does NOT do
 *
 * It does not make itself a required context. That is a branch-protection
 * setting only the maintainer can flip. What this repository CAN write down is
 * `REQUIRED_CONTEXTS` in `scripts/dependabot-merge-gate.mjs` — its own answer
 * to "which checks are blocking" — and `CHECK_CONTEXT_NAME` below is registered
 * there. Until the live required set carries the same name, this guard REPORTS
 * on a queue build without stopping it; the self-test pins the registration and
 * the workflow's `name:` so the two can never drift apart silently.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

/** The exit contract, named so the header's table is machine-checkable. */
export const EXIT_CLEAR = 0;
export const EXIT_CANNOT_RUN = 1;
export const EXIT_BAD_USAGE = 2;
export const EXIT_REFUSED_UNAPPROVED = 3;
export const EXIT_REFUSED_UNREADABLE = 4;
export const EXIT_REFUSED_UNATTRIBUTED = 5;
/**
 * The contract-review carrier leg's two refusals (objectui#9018). Split for the
 * same reason 3 and 4 are split on the governed leg: "the carrier is open" and
 * "we could not find out" are different facts, and a queue log must be able to
 * tell them apart. ⛔ Neither may ever be folded into the other to tidy the
 * table — 7 is not a worse 6, it is a different reading.
 */
export const EXIT_REFUSED_CARRIER = 6;
export const EXIT_REFUSED_CARRIER_UNREADABLE = 7;

/**
 * The check-run name branch protection would pin, and the wiring it belongs to.
 * Declared HERE as well as in the YAML, deliberately and pinned in both
 * directions: the self-test reads the workflow and fails if the two disagree.
 * Renaming a job silently detaches a required context, and a name that lives in
 * exactly one place is a name nothing can pin.
 */
export const CHECK_CONTEXT_NAME = 'Governed Surface Queue Guard';
export const CHECK_WORKFLOW = 'governed-surface-guard.yml';
export const CHECK_JOB_ID = 'governed-surface-guard';

/** The events this guard understands, and what each one means to it. */
export const EVENT_MERGE_GROUP = 'merge_group';
export const EVENT_PULL_REQUEST = 'pull_request';

/**
 * The governed surface: the 2026-08-18 definition the card restated —
 * `AGENTS.md`, `CLAUDE.md`, `.claude/**`, `skills/**`, `docs/adr/**` — plus
 * `.github/workflows/**`, which the maintainer ruled in on objectui#12255
 * (verbatim, untranslated: 「两仓加治理行」).
 *
 * ⛔ This list is the WHOLE scope and widening it is a maintainer decision, not
 * an implementation detail. The workflows row is that rule working, not an
 * exception to it: until the ruling this comment named `.github/workflows/**` as
 * a widening deliberately NOT taken, and the row arrived by the maintainer's
 * word rather than by an implementation's reading. What it costs, named so a
 * future reader does not read it as an accident:
 *
 *   - this guard now governs its OWN workflow file, so a change to how the
 *     refusal is wired waits for the same authorized approval the refusal
 *     enforces. The script itself stays ordinary source (`scripts/**` is not a
 *     row).
 *   - a Dependabot `github-actions` bump edits `.github/workflows/**`, so it is
 *     governed like any other workflow change: `dependabot-auto-merge.yml` still
 *     approves and enqueues it, and the `merge_group` leg refuses it until an
 *     approval by an account in `GOVERNED_APPROVERS` is on record.
 *
 * Two omissions are deliberate and worth naming so a future reader does not read
 * them as oversights:
 *
 *   - the rest of `.github/` stays out (`dependabot.yml`, `labeler.yml`,
 *     `prompts/**`, an `ISSUE_TEMPLATE/**` tree): the ruling named the
 *     workflows, not the directory that holds them.
 *   - `examples/**` and any vendored template copy of `AGENTS.md` stay out: the
 *     two root rows are EXACT matches, so `examples/AGENTS.md` is ordinary
 *     source.
 *
 * `prefix` rows match by path prefix; `exact` rows match the whole path. `glob`
 * is the spelling a human reads in a verdict, never a matcher.
 */
export const GOVERNED_SURFACES = Object.freeze([
  Object.freeze({ id: 'adr', prefix: 'docs/adr/', glob: 'docs/adr/**', what: 'architecture decision records' }),
  Object.freeze({ id: 'claude-tree', prefix: '.claude/', glob: '.claude/**', what: 'the agent instruction tree (skills, hooks, settings)' }),
  Object.freeze({ id: 'skills-catalog', prefix: 'skills/', glob: 'skills/**', what: 'the published skills catalog' }),
  Object.freeze({ id: 'agents-md', exact: 'AGENTS.md', glob: 'AGENTS.md', what: 'the repo-root agent instruction file' }),
  Object.freeze({ id: 'claude-md', exact: 'CLAUDE.md', glob: 'CLAUDE.md', what: 'the repo-root Claude instruction file' }),
  Object.freeze({ id: 'workflows', prefix: '.github/workflows/', glob: '.github/workflows/**', what: 'CI, deploy and release workflows: what runs on every push, what deploys, what gates the queue' }),
]);

/**
 * The ONLY accounts whose APPROVED review satisfies the `merge_group` leg.
 *
 * ⭐ Single source: every rendering derives the names it prints from this array,
 * and nothing else in the repository restates them as data. Changing the set is
 * a one-line maintainer decision here and nowhere else.
 *
 * ⚠️ Provenance, stated because it is INHERITED rather than ruled for this
 * repository: these are the two accounts the sibling repository's maintainer
 * ruled authoritative for its own governed surface on 2026-08-27 (verbatim:
 * 「os-zhuang hotlong 批准算数」). objectui's own card rules the MECHANISM, not
 * the roster. The roster is carried across because it is the same maintainer
 * and the same governed surface, and it is flagged here — and in this change's
 * pull request — as the one line the maintainer should confirm or edit. The
 * remedy this guard prints FIRST, back-to-draft, needs no approver at all; the
 * LANDING that follows it does — under ruling C an APPROVED review by one of
 * these accounts is what hands a governed pull request to the claiming seat to
 * land. So a wrong roster fails in the safe direction: governed pull requests
 * stay parked as drafts, and none lands unreviewed.
 */
export const GOVERNED_APPROVERS = Object.freeze(['os-zhuang', 'hotlong']);

/**
 * The clause-② enqueue gate's label (objectui#9018).
 *
 * ⚠️ THIS IS A MIRROR, NOT THE SOURCE. The spelling was owned by H31 of the PM
 * half-state sweeper — 「一个常量,两个载体」. This repository no longer holds a
 * copy of that sweeper (objectui#10208: the seats run objectstack's original),
 * so the mirror can no longer be pinned by reading a local source, and a drift
 * is found by hand — the cost the maintainer accepted for the retired port
 * (objectui#10205).
 *
 * The self-test still pins the property the mirror rests on, in the
 * falsifiable direction: it asserts this file imports nothing out of
 * `scripts/pm/`. `.github/workflows/governed-surface-guard.yml` runs this file
 * with NO install and NO build, and its own comment states that property —
 * 「the script imports node builtins and one local module
 * (`scripts/invoked-as.mjs`) only」.
 */
export const CONTRACT_REVIEW_LABEL = 'needs:contract-review';

/**
 * The governed slice of a path list, grouped by surface. Surfaces with no hit
 * are absent — `length === 0` IS the clean answer.
 */
export function governedPathsIn(paths) {
  const list = Array.isArray(paths) ? paths : [];
  return GOVERNED_SURFACES.map((surface) => ({
    ...surface,
    files: list.filter((p) => typeof p === 'string' && (surface.prefix ? p.startsWith(surface.prefix) : p === surface.exact)),
  })).filter((surface) => surface.files.length > 0);
}

/**
 * The seat-side answer: "would a pull request touching these paths be
 * governed?" Pure, so `--test` costs a process start and nothing else, and the
 * refusal text can hand a reader a command that answers the same question the
 * queue build answered.
 */
export function testVerdict(paths) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p !== '');
  const matched = governedPathsIn(list);
  const hit = new Set(matched.flatMap((s) => s.files));
  return {
    governed: matched.length > 0,
    checked: list.length,
    surfacesChecked: GOVERNED_SURFACES.length,
    matched,
    hitPaths: [...hit],
    clearPaths: list.filter((p) => !hit.has(p)),
  };
}

/**
 * The pull-request number a mainline commit subject names, in either spelling
 * GitHub writes: a merge commit's `Merge pull request #N from …`, or a squash
 * commit's TRAILING `(#N)`. This repository squashes, so the trailing form is
 * the one that fires; a subject citing an issue mid-title keeps only the
 * trailing parenthetical, which is the pull request.
 */
export function pullNumberFromSubject(subject) {
  if (typeof subject !== 'string') return null;
  let m = /^Merge pull request #(\d+)\b/.exec(subject);
  if (m) return Number(m[1]);
  m = /\(#(\d+)\)\s*$/.exec(subject.trim());
  return m ? Number(m[1]) : null;
}

/**
 * The pull-request number a merge-queue head ref names, or null.
 *
 * GitHub writes `refs/heads/gh-readonly-queue/<base>/pr-<N>-<base_sha>`. The
 * `gh-readonly-queue/` segment is required rather than decorative: a plain
 * branch called `pr-12-abcdef1` is not a queue ref, and reading one as a pull
 * request number would attribute a diff to a pull request unrelated to it.
 *
 * The base-branch segment is `.+` rather than `[^/]+` because a base branch may
 * itself contain slashes; the trailing `pr-<n>-<sha>` anchor is what makes the
 * greedy match safe. ⚠️ In a MULTI-PR group this names only the LAST pull
 * request, so it is a fallback for single-commit groups and never the key the
 * whole group is judged on.
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
 * in a merge group, or one synthetic row for a `pull_request` run. A row hitting
 * nothing governed is dropped entirely and costs nothing downstream; that is
 * what makes "a clear diff makes no API call" a property of the data flow
 * rather than a promise in a comment.
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
 * Does an APPROVED review exist on this pull request? The early-warning leg's
 * reading — any approver counts, no sha pin — because that leg never reddens
 * and so never needs the stricter, more expensive question.
 *
 * The reduction is LATEST-DECISIVE-PER-REVIEWER, matching how GitHub itself
 * computes a review decision: `COMMENTED` and `PENDING` carry no decision, and a
 * `DISMISSED` approval is not an approval any more. A reviewer who approved and
 * later requested changes must not still read as an approver — the naive
 * `reviews.some(r => r.state === 'APPROVED')` gets that wrong in the fail-open
 * direction, which is the one direction this file may not be wrong in.
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
  return {
    state: [...latest.values()].includes('APPROVED') ? 'approved' : 'unapproved',
    approvers: [...latest].filter(([, s]) => s === 'APPROVED').map(([login]) => login),
    changesRequestedBy: [...latest].filter(([, s]) => s === 'CHANGES_REQUESTED').map(([login]) => login),
    reviewsRead: Array.isArray(reviews) ? reviews.length : 0,
  };
}

/**
 * The `merge_group` predicate: does an account in `GOVERNED_APPROVERS` hold a
 * latest-decisive APPROVED review on this pull request?
 *
 * Same latest-decisive-per-reviewer reduction as `approvalVerdict`, plus the
 * authorization filter — which, now that the sha pin is retired, is the ONLY
 * thing separating the two legs' readings. `unauthorizedApprovers` (APPROVED,
 * not in the set) is reported separately so a queue log can be acted on rather
 * than merely obeyed.
 *
 * ⛔ There is deliberately no `commit_id` reading here and no `headSha`
 * parameter. Maintainer ruling 2026-09-04, quoted in full in the header's "What
 * satisfies the queue leg": a human approval record suffices and is never
 * pinned to the latest commit. The former `staleApprovers` bucket is RETIRED
 * rather than kept as an inert reading, because under this predicate every
 * authorized latest-decisive approval lands in `approvers` — the bucket could
 * never be non-empty again, and an always-empty field reads as evidence that
 * staleness is still being measured.
 *
 * ⚠️ An outstanding CHANGES_REQUESTED from ANOTHER reviewer does not flip the
 * verdict, and that is restraint rather than an oversight — the predicate is the
 * authorized approval record, and widening a governance gate past its own rule
 * is how gates acquire policy nobody agreed to. It is printed loudly instead.
 * (One from the SAME reviewer is a different thing entirely: it supersedes their
 * own approval in the reduction above, so it does flip the verdict.)
 *
 * Pure; the array is expected in GitHub's chronological order, so last wins.
 */
export function authorizedApprovalVerdict(reviews) {
  const decisive = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);
  const latest = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const state = String(review?.state ?? '').toUpperCase();
    if (!decisive.has(state)) continue;
    const login = review?.user?.login ?? `(unknown:${review?.id ?? latest.size})`;
    latest.set(login, state);
  }
  const approvers = [];
  const unauthorizedApprovers = [];
  for (const [login, state] of latest) {
    if (state !== 'APPROVED') continue;
    if (GOVERNED_APPROVERS.includes(login)) approvers.push(login);
    else unauthorizedApprovers.push(login);
  }
  return {
    state: approvers.length > 0 ? 'approved' : 'unapproved',
    approvers,
    unauthorizedApprovers,
    changesRequestedBy: [...latest].filter(([, s]) => s === 'CHANGES_REQUESTED').map(([login]) => login),
    reviewsRead: Array.isArray(reviews) ? reviews.length : 0,
  };
}

/** The refusal an unreadable review list produces. Never a pass — see the header. */
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
  // The early-warning run never reddens: a governed PR parked as a draft while
  // it waits for an authorized APPROVED review is this regime's healthy resting
  // state, and a check that is red on the healthy case is a permanently red
  // check (see the header).
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
 * The words a reader gets. Every rendering names the exact paths that matched
 * and states what would satisfy the guard — a refusal a reader cannot act on is
 * a refusal they route around.
 */
export function renderGuardVerdict(verdict) {
  const lines = [];
  const surfaceLines = (entry) =>
    entry.surfaces.flatMap((s) => [
      `        ${s.glob} x${s.files.length} — ${s.what}`,
      ...s.files.slice(0, 12).map((f) => `          - ${f}`),
      ...(s.files.length > 12 ? [`          … and ${s.files.length - 12} more`] : []),
    ]);

  // Both legs read exactly one list now. The pull-request head read existed
  // only to feed the retired sha pin, so a label still naming it would be a log
  // line describing traffic that no longer happens — the shape a later reader
  // takes as evidence the pin is still live.
  const apiLabel = 'review lookup(s)';
  lines.push(
    `${CHECK_CONTEXT_NAME} — ${verdict.event} — ${verdict.entries.length} governed pull request(s), ` +
      `${verdict.unattributed.length} unattributed governed commit(s), ${verdict.apiCalls} ${apiLabel}.`,
  );

  if (verdict.conclusion === 'clear') {
    lines.push(
      '  ✅  CLEAR — the diff touches no governed surface, so this guard has nothing to judge.',
      `      Derived from GOVERNED_SURFACES in scripts/check-governed-queue-guard.mjs (${GOVERNED_SURFACES.length} surfaces),`,
      '      never from a restated list. ⛔ ZERO review lookups were made: the path test runs first and returns,',
      '      so a GitHub API outage can never block a diff that touches nothing governed.',
    );
    // ⭐ objectui#9018: a verdict may not deny its own evidence. The three lines
    // above are the governed leg's and stay byte-identical — the `pull_request`
    // leg does not run the carrier read at all, so its output is unchanged to
    // the byte. But on `merge_group` this file now DOES make an unconditional
    // API call, so the last of those lines would otherwise be a claim this very
    // run has already falsified. It is SCOPED here rather than rewritten.
    if (verdict.event === EVENT_MERGE_GROUP) {
      lines.push(
        '      ⚠️ Scoped to the GOVERNED-SURFACE leg. On merge_group this file ALSO reads the contract-review',
        '      carrier on every queued pull request — one label read each, fail-closed — and that leg reports',
        '      separately below. An outage there DOES refuse this merge group.',
      );
    }
    return lines.join('\n');
  }

  // The queue leg's verdict (`authorizedApprovalVerdict`) carries the
  // authorization split; the early-warning leg's `approvalVerdict` does not.
  // ⚠️ This replaces a `headSha !== undefined` test — a discriminator that went
  // away with the field the retired sha pin used to supply.
  const authorizedLeg = (approval) => Array.isArray(approval.unauthorizedApprovers);
  for (const entry of verdict.entries) {
    lines.push('', `  #${entry.pr} — governed:`);
    lines.push(...surfaceLines(entry));
    if (entry.approval.state === 'approved') {
      lines.push(
        authorizedLeg(entry.approval)
          ? `        ✅ authorized APPROVED review present, by: ${entry.approval.approvers.join(', ')} — a human approval record, on whichever commit it was left`
          : `        ✅ APPROVED review present, by: ${entry.approval.approvers.join(', ')}`,
      );
    } else if (entry.approval.state === 'unreadable') {
      lines.push(`        ⛔ the review list could NOT be read — ${entry.approval.reason}`);
    } else if (authorizedLeg(entry.approval)) {
      lines.push(
        `        ⛔ NO authorized APPROVED review on this pull request ` +
          `(${entry.approval.reviewsRead} review(s) read; authorized: ${GOVERNED_APPROVERS.join(', ')})`,
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
        '            (informational — the predicate is an authorized APPROVED review record on this',
        '             pull request; this guard does not widen past its own rule)',
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
      '      GREEN here. A governed PR held as a draft while it waits for an authorized APPROVED review IS',
      '      this regime\'s healthy resting state, and a check that reddens on the healthy case is a',
      '      permanently red check.',
      '',
      '      ⛔ What a seat must NOT do with this pull request while no authorized APPROVED review is on',
      '         record: flip it ready, enqueue it, or arm auto-merge. One governed path governs the WHOLE',
      '         pull request — proportion is not a question.',
      '      ⚠️  A GitHub MCP `update_pull_request` call can set `draft: false` as a SIDE EFFECT of passing',
      '         only `reviewers` (objectstack-ai/objectstack#12200). That is how objectui#6183 left draft,',
      '         and converting back to a draft did NOT dequeue it. Do not send that call on this PR.',
      '',
      `      ✅ Once an account in GOVERNED_APPROVERS (${GOVERNED_APPROVERS.join(', ')}) has APPROVED it — on any`,
      '         commit, not dismissed — that approval IS the review record for a governed surface, and',
      '         the claiming seat readies it and arms auto-merge, and the queue lands it (ruling C,',
      '         maintainer 2026-09-13). ⛔ An agent seat never submits that approval, under any account.',
      '',
      '      If it IS enqueued anyway, the merge-queue run of this same check REFUSES it unless every',
      '      governed pull request above carries an authorized APPROVED review by then.',
    );
    return lines.join('\n');
  }
  if (verdict.conclusion === 'cleared') {
    lines.push(
      '  ✅  CLEARED — every governed pull request in this merge group carries an APPROVED review by an',
      `      authorized approver (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')}), regardless of which commit`,
      '      that review was left on — maintainer ruling 2026-09-04: a human approval record suffices and is',
      '      never pinned to the latest commit. A dismissed, superseded or unauthorized approval still never',
      '      counts. ⚠️ Accepted cost, stated rather than hidden: a push after the approval is NOT re-reviewed',
      '      here. ⛔ An agent seat never submits an approving review on a governed-surface pull request,',
      '      under any account — every seat here writes under a shared identity, so that rule is what this',
      '      technical control rests on.',
    );
    return lines.join('\n');
  }

  lines.push('  ⛔  REFUSED — this merge group must not land.');
  if (verdict.refusalKind === 'unattributed') {
    lines.push(
      '      A governed-surface change is in this merge group that cannot be attributed to any pull request,',
      '      so there is no review record it could possibly satisfy. Fail closed: a governed change nobody',
      '      can point at a reviewable pull request for is the most anomalous input this guard can receive.',
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
      '      merge queue would have been the entire review — the shape of objectui#6183, which left draft',
      '      through a hidden tool side effect and landed as 5b3290fd5 unreviewed.',
    );
  }
  lines.push(
    '',
    '      What satisfies this check:',
    '        1. ⭐ FIRST, whatever comes after it — take the pull request out of the queue: convert it back',
    '           to DRAFT (disarming auto-merge alone does NOT dequeue it) and park it there. A draft waiting',
    '           for an authorized approval is this regime\'s resting state, not a stalled one.',
    `        2. Then: obtain an APPROVED review by an authorized approver (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')})`,
    '           on each governed pull request — that approval IS the review record for a governed surface —',
    '           and after it the claiming seat readies it and arms auto-merge, and the queue lands it',
    '           (ruling C, maintainer 2026-09-13). ⭐ It does NOT have to be re-given after a later push:',
    '           maintainer ruling 2026-09-04 — a human approval record suffices and is never pinned to the',
    '           latest commit. ⛔ An agent seat never submits that approval, under any account.',
    '      Neither of those is "edit this check".',
    '',
    '      Verify any file list before acting: node scripts/check-governed-queue-guard.mjs --test <paths…>',
  );
  return lines.join('\n');
}

/**
 * The orchestrator, with its one IO dependency injected.
 *
 * ⭐ The early return below is the ordering guarantee expressed as control flow:
 * nothing governed ⇒ verdict, before `fetchReviews` exists as a possibility. The
 * self-test passes a `fetchReviews` that THROWS, so "a clear diff costs zero API
 * calls" is measured rather than asserted.
 *
 * ⛔ There is no `fetchPullHead` parameter any more. The queue leg needed the
 * pull request's current head sha only to pin an approval against it, and the
 * 2026-09-04 ruling retired that pin; a read whose result feeds no verdict is a
 * cost and a failure mode bought for nothing.
 */
export async function runGuard({ event, rows, fetchReviews }) {
  const { governed, unattributed } = decomposeGovernedWork(rows);
  if (governed.length === 0 && unattributed.length === 0) {
    return guardVerdict({ event, governed, unattributed, apiCalls: 0 });
  }
  const approvals = new Map();
  let apiCalls = 0;
  for (const entry of governed) {
    try {
      // Both legs read the SAME one list; they differ only in the predicate
      // applied to it — the queue leg requires an authorized approver, the
      // early warning takes any. One read per governed pull request, so an
      // unreadable list is the single API failure mode either leg can have.
      apiCalls += 1;
      const reviews = await fetchReviews(entry.pr);
      approvals.set(entry.pr, event === EVENT_MERGE_GROUP ? authorizedApprovalVerdict(reviews) : approvalVerdict(reviews));
    } catch (error) {
      approvals.set(entry.pr, unreadableApproval(String(error?.message ?? error).split('\n')[0]));
    }
  }
  return guardVerdict({ event, governed, unattributed, approvals, apiCalls });
}

// -- the contract-review carrier: the SECOND leg, and the label IS the gate ---

/**
 * The leg's own name in a log. Deliberately NOT `CHECK_CONTEXT_NAME`: this is a
 * second predicate inside the same check run, not a second check run, and a
 * reader must be able to see which leg answered which way.
 */
export const CARRIER_LEG_NAME = 'Contract-Review Carrier (enqueue gate)';

/**
 * Every pull request this merge group is landing — deduplicated, in group order.
 *
 * ⭐ It reads the SAME per-commit decomposition the governed leg reads, and that
 * is load-bearing rather than convenient. `merge_group.head_ref` names only the
 * LAST pull request in the group, so keying this leg to it would let PR A's open
 * carrier ride into `main` behind PR B — under-enumeration, the one direction a
 * queue reading must never be wrong in, and the same trap this file's header
 * documents for the governed leg. ⛔ A fresh implementation that keys on the
 * head ref looks right and silently misses pull requests: every test anyone
 * would think to write passes, because a single-PR group is the shape everyone
 * tests. The queue ref is consulted ONLY when the decomposition attributes no
 * pull request at all, where it cannot mis-attribute because there is nothing
 * else to attribute to.
 */
export function carrierPullsInGroup(rows, namedPull = null) {
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

/**
 * The carrier verdict, as data. Pure, exactly like `guardVerdict` — the renderer
 * and the exit code both read it rather than re-deriving it.
 *
 * ⚠️ `merge_group` ONLY. The `pull_request` leg returns `not-applicable` and
 * renders the empty string, so that leg's output stays byte-identical to what it
 * was before this predicate existed. An early warning on the PR leg would be
 * useful and is deliberately NOT taken here: the ruling this leg implements is
 * about ENQUEUE, and widening a governance gate past its own ruling is how gates
 * acquire policy nobody agreed to — the same restraint this file applies to
 * `GOVERNED_SURFACES`, whose rows arrive by a maintainer's ruling and never by an
 * implementation (`.github/workflows/**` was named as a widening NOT taken until
 * the maintainer ruled it in on objectui#12255). Widening it is a one-line
 * maintainer decision.
 */
export function carrierVerdict({ event, pulls = [], readings = new Map(), apiCalls = 0 }) {
  const base = { event, entries: [], apiCalls, legName: CARRIER_LEG_NAME, label: CONTRACT_REVIEW_LABEL };
  if (event !== EVENT_MERGE_GROUP) {
    return { ...base, conclusion: 'not-applicable', exitCode: EXIT_CLEAR, refusalKind: null };
  }
  if (pulls.length === 0) {
    return { ...base, conclusion: 'refused', exitCode: EXIT_REFUSED_CARRIER_UNREADABLE, refusalKind: 'no-pull' };
  }
  const entries = pulls.map(
    (pr) =>
      readings.get(pr) ?? {
        pr,
        state: 'unreadable',
        labels: [],
        reason: 'no label reading was recorded for this pull request',
      },
  );
  const out = { ...base, entries };
  // ⛔ Order matters and is not cosmetic: an unreadable row is checked FIRST, so
  // a group holding one open carrier and one unreadable list reports the reading
  // it could not make rather than the one it could. Folding them would hide an
  // outage behind a refusal that looks explained.
  if (entries.some((e) => e.state === 'unreadable')) {
    return { ...out, conclusion: 'refused', exitCode: EXIT_REFUSED_CARRIER_UNREADABLE, refusalKind: 'unreadable' };
  }
  if (entries.some((e) => e.state === 'gated')) {
    return { ...out, conclusion: 'refused', exitCode: EXIT_REFUSED_CARRIER, refusalKind: 'gated' };
  }
  return { ...out, conclusion: 'clear', exitCode: EXIT_CLEAR, refusalKind: null };
}

/**
 * The carrier orchestrator, with its one IO dependency injected.
 *
 * ⚠️ Unlike the governed leg there is no cheap local pre-filter to run first,
 * and there cannot be one: the carrier is REMOTE state hung by a seat, not a
 * property of the diff. So every merge group pays one label read per queued pull
 * request. ⚖️ THE ACCEPTED COST, stated here rather than left to be discovered:
 * a GitHub outage now refuses a merge group whose diff touches nothing governed,
 * which the governed leg alone never did. The alternative is a carrier read that
 * passes when it cannot see the label — and 「门禁被剥不是红灯是放行」 is precisely
 * the fail-open shape this whole regime exists to end. The cost is bounded: one
 * GET per queued pull request, against the same endpoint and the same scope the
 * governed leg already uses.
 */
export async function runCarrierGuard({ event, rows, namedPull = null, fetchLabels }) {
  if (event !== EVENT_MERGE_GROUP) return carrierVerdict({ event });
  const pulls = carrierPullsInGroup(rows, namedPull);
  const readings = new Map();
  let apiCalls = 0;
  for (const pr of pulls) {
    try {
      apiCalls += 1;
      const names = (await fetchLabels(pr)).map((n) => String(n));
      readings.set(pr, { pr, state: names.includes(CONTRACT_REVIEW_LABEL) ? 'gated' : 'bare', labels: names });
    } catch (error) {
      readings.set(pr, { pr, state: 'unreadable', labels: [], reason: String(error?.message ?? error).split('\n')[0] });
    }
  }
  return carrierVerdict({ event, pulls, readings, apiCalls });
}

/**
 * The words a reader acts on for this leg. Returns '' on the `pull_request` leg,
 * so nothing is appended to that leg's byte-identical output.
 *
 * The refusal QUOTES the governing rule rather than paraphrasing it — the quote
 * IS the operative criterion, so it is reproduced from the sibling skill's own
 * bytes and left untranslated — and it names WHO can act, because a refusal a
 * reader cannot act on is a refusal they route around.
 */
export function renderCarrierVerdict(verdict) {
  if (verdict.conclusion === 'not-applicable') return '';
  const lines = [];
  lines.push(
    `${CARRIER_LEG_NAME} — ${verdict.event} — ${verdict.entries.length} queued pull request(s), ` +
      `${verdict.apiCalls} label read(s).`,
  );

  // ⚠️ The boundary, printed on the CLEAR path too and not only on the refusal:
  // this leg reads the LABEL, never the verdict. A carrier stripped seconds
  // before any PASS existed is, to this predicate, identical to a carrier that
  // was never hung — 「被剥」 and 「从未挂过」 are indistinguishable in the evidence.
  // ⚠️ And unlike the sibling, this repository has NO instrument that answers the
  // verdict question either, so the boundary names that too rather than pointing
  // a reader at a file that does not exist here.
  const boundary = [
    '      ⚠️ This leg reads the LABEL, not the verdict. A carrier stripped before any PASS was on record',
    '      is indistinguishable here from one that was never hung, and this repository has NO check that',
    '      answers whether a clause-② verdict EXISTS. ⛔ Do not read a green here as "the review happened".',
  ];

  if (verdict.conclusion === 'clear') {
    lines.push(`  ✅  CLEAR — no queued pull request carries \`${CONTRACT_REVIEW_LABEL}\`.`, ...boundary);
    return lines.join('\n');
  }

  for (const entry of verdict.entries) {
    if (entry.state === 'gated') {
      lines.push(
        '',
        `  #${entry.pr} — ⛔ CARRIES \`${CONTRACT_REVIEW_LABEL}\` — this pull request may not be in the queue.`,
        `        labels read: ${entry.labels.join(', ') || '(none)'}`,
      );
    } else if (entry.state === 'unreadable') {
      lines.push('', `  #${entry.pr} — ⛔ the label set could NOT be read — ${entry.reason}`);
    } else {
      lines.push('', `  #${entry.pr} — ✅ does not carry the gate label.`);
    }
  }

  lines.push('', '  ⛔  REFUSED — this merge group must not land.');
  if (verdict.refusalKind === 'no-pull') {
    lines.push(
      '      This merge group names NO pull request — neither its commit subjects nor its queue head ref',
      '      resolve to one — so there is no carrier to read at all. Fail closed: a queue entry nobody can',
      '      point at a pull request for cannot be shown to have cleared the gate.',
    );
  } else if (verdict.refusalKind === 'unreadable') {
    lines.push(
      '      The label set could not be READ for at least one queued pull request above. ⛔ This is a refusal',
      '      and not a pass, deliberately: 「门禁被剥不是红灯是放行」 — a gate label that cannot be seen and',
      '      one that is absent are the same bytes to a reader that shrugs. Re-run once the API is reachable.',
    );
  } else {
    lines.push(
      '      At least one pull request above entered the merge queue while the contract-review carrier was',
      "      still open on it. The governing rule is the PM dispatch protocol's and lives in the SIBLING",
      '      repository — objectstack-ai/objectstack .claude/skills/pm-dispatch/SKILL.md 〈入队与落地〉,',
      '      quoted verbatim because the quote is the criterion:',
      '',
      '        「双肢命中任一 ⇒ 无席内条款②复核 PASS 在案 ⛔ 禁止入队」',
      '',
      "      and that skill's references/contract-review.md 〈载体纪律〉: 「开着的载体恒 = 真实待审」.",
    );
  }
  lines.push(
    '',
    '      What satisfies this check:',
    '        1. ⭐ Take the pull request out of the queue: convert it back to DRAFT (disarming auto-merge',
    '           alone does NOT dequeue it — objectui#6183 measured exactly that), and leave it parked.',
    '           「挂标后复核完成前短暂停靠」 — parked outside the queue is the SAFE state, not a stalled one.',
    '        2. Then the dispatching seat completes the in-seat clause-② review and posts the verdict as a',
    '           comment on the pull request or the card. On PASS that same seat strips the carrier from BOTH',
    '           carriers, cites the record, and re-enqueues: 「PASS ⇒ 同席剥标并引记录、ready、auto-merge」.',
    '           On FAIL it is a patch round.',
    '',
    '      ⛔ Stripping the label to get past this check, with no verdict on record, is the defect this leg',
    '         was built from — not a way through it. ⛔ Neither is "edit this check".',
    ...boundary,
  );
  return lines.join('\n');
}

// -- git (diff decomposition; zero API) -------------------------------------

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
 * The first-parent commits between `baseSha` and `headSha`, each with the paths
 * it changed and the pull request its subject names. One row per pull-request
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
    // The fallback is only unambiguous when the range holds exactly one commit;
    // in a multi-PR group `head_ref` names the LAST pull request, and applying
    // it to an earlier commit attributes a governed diff to the wrong one.
    pr: pullNumberFromSubject(commit.subject) ?? (commits.length === 1 ? fallbackPull : null),
    paths: git(root, ['diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-only', '-m', '--first-parent', commit.sha])
      .split('\n')
      .filter((p) => p !== ''),
  }));
}

// -- the GitHub read (the review list — the only API surface) ---------------

function apiHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Every review on a pull request, paginated. Throws on any non-2xx — the caller
 * turns a throw into a REFUSAL, never into a pass, so there is no tolerant
 * branch to get wrong here.
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
 * The label names on a pull request.
 *
 * ⭐ READ FROM THE PULL OBJECT, deliberately, and this choice is what makes the
 * carrier leg cost ZERO new workflow permission. The labels endpoint proper
 * (`GET /repos/{o}/{r}/issues/{n}/labels`) is an ISSUES-API route and needs
 * `issues: read`, which `governed-surface-guard.yml` does not grant and would
 * have to be widened to grant; the pull object carries the same `labels[]` and
 * is already covered by the `pull-requests: read` the review read needs.
 * Measured against this repository on 2026-09-11: `GET /repos/objectstack-ai/objectui/pulls/8779`
 * answered `labels` = `["documentation","tests","needs:contract-review","package: create-plugin"]`
 * — objectui#8779 is one of the 2026-09-09 enqueues replayed in the self-test,
 * and it STILL carries the gate label today, having merged with it open. ⛔ Do
 * not "simplify" this to the issues route without adding the scope in the same
 * edit — the failure is a 403 on every queue build, which this leg then
 * correctly turns into a REFUSAL rather than a pass.
 *
 * Same channel and same shape as the review reader above: throws on any non-2xx
 * and on a body whose `labels` is not an array, and the caller turns the throw
 * into a REFUSAL (exit 7), never a pass. A reader that quietly returned `[]`
 * would be the fail-open bug this whole leg exists to close: an unreadable
 * carrier would render as a carrier that is not there.
 */
export function makeLabelReader({ apiUrl, slug, token, fetchImpl = fetch }) {
  return async function fetchLabels(pull) {
    const res = await fetchImpl(`${apiUrl}/repos/${slug}/pulls/${pull}`, { headers: apiHeaders(token) });
    if (!res.ok) throw new Error(`GET /repos/${slug}/pulls/${pull} answered HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body?.labels)) {
      throw new Error(`GET /repos/${slug}/pulls/${pull} answered no labels array — the carrier cannot be read`);
    }
    return body.labels.map((entry) => String(entry?.name ?? ''));
  };
}

// ⛔ There is no pull-request HEAD reader here any more, and its absence is a
// decision rather than an omission: it existed only to supply the sha an
// approval was pinned against, and the 2026-09-04 ruling retired that pin. The
// review list is now the whole API surface of this guard.

// -- the seat-side `--test` predicate ---------------------------------------

/** The words `--test` prints. Pure, so the self-test reads them without a process. */
export function renderTestVerdict(verdict) {
  const lines = [];
  if (!verdict.governed) {
    lines.push(
      `✅ NOT GOVERNED — ${verdict.checked} path(s) checked against ${verdict.surfacesChecked} governed surface(s); none matched.`,
      '   An ordinary pull request: the normal review and merge-queue route applies.',
    );
    return lines.join('\n');
  }
  lines.push(`⛔ GOVERNED — ${verdict.hitPaths.length} of ${verdict.checked} path(s) are on a governed surface:`);
  for (const surface of verdict.matched) {
    lines.push(`   ${surface.glob} x${surface.files.length} — ${surface.what}`);
    for (const file of surface.files.slice(0, 12)) lines.push(`     - ${file}`);
    if (surface.files.length > 12) lines.push(`     … and ${surface.files.length - 12} more`);
  }
  lines.push(
    '',
    '   One governed path governs the WHOLE pull request — proportion is not a question.',
    '   ⛔ Park it as a DRAFT, and do not flip it ready, enqueue it, or arm auto-merge until an',
    '      APPROVED review by an authorized approver is on it.',
    '      ⛔ An agent seat never submits that approval, under any account.',
    '   ✅ That approval IS the review record for a governed surface. Once it is on record,',
    '      the claiming seat readies it and arms auto-merge, and the queue lands it (ruling C,',
    '      maintainer 2026-09-13).',
    `   The merge-queue run of "${CHECK_CONTEXT_NAME}" refuses this diff unless an APPROVED review by an`,
    `   authorized approver (GOVERNED_APPROVERS: ${GOVERNED_APPROVERS.join(', ')}) is on the pull request — on`,
    '   whichever commit it was left, and not dismissed (maintainer ruling 2026-09-04).',
  );
  return lines.join('\n');
}

// -- CLI --------------------------------------------------------------------

function runTestMode(argv) {
  const paths = argv.slice(argv.indexOf('--test') + 1).filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    console.error(
      'check-governed-queue-guard --test needs at least one path.\n' +
        '  node scripts/check-governed-queue-guard.mjs --test AGENTS.md packages/core/src/index.ts\n' +
        'Refusing to answer "not governed" about an empty list: a question nobody asked must not read as a clearance.',
    );
    return EXIT_BAD_USAGE;
  }
  const verdict = testVerdict(paths);
  console.log(renderTestVerdict(verdict));
  return verdict.governed ? EXIT_REFUSED_UNAPPROVED : EXIT_CLEAR;
}

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
          '   question with silence, and silence reads as compliance.',
      );
      return EXIT_CANNOT_RUN;
    }
  }

  let rows;
  try {
    const mergeBase = git(repoRoot, ['merge-base', context.baseSha, context.headSha]).trim();
    rows = enumerateRows(repoRoot, mergeBase, context.headSha, context.namedPull);
  } catch (error) {
    console.error(`⛔ ${CHECK_CONTEXT_NAME}: could not read the diff (${String(error?.message ?? error).split('\n')[0]}).`);
    return EXIT_CANNOT_RUN;
  }

  const slug = env.GITHUB_REPOSITORY ?? 'objectstack-ai/objectui';
  const reader = {
    apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
    slug,
    token: env.GITHUB_TOKEN || env.GH_TOKEN || null,
  };

  const verdict = await runGuard({
    event: context.event,
    rows,
    fetchReviews: makeReviewReader(reader),
  });
  // The SECOND leg (objectui#9018). It runs on `merge_group` only and renders ''
  // on the other, so the `pull_request` output is byte-identical to what it was.
  const carrier = await runCarrierGuard({
    event: context.event,
    rows,
    namedPull: context.namedPull,
    fetchLabels: makeLabelReader(reader),
  });
  const carrierBlock = renderCarrierVerdict(carrier);
  const report = [
    `${context.label} — ${rows.length} commit(s) in range`,
    renderGuardVerdict(verdict),
    ...(carrierBlock === '' ? [] : ['', carrierBlock]),
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
  // reading is lost whichever refuses. The governed refusal wins the exit code
  // when both fire, because its remedy is the stricter of the two (back to
  // draft until an authorized APPROVED review is on record) and it subsumes
  // the carrier's "take it out of the queue". ⛔ The carrier code is not
  // swallowed silently — its block states the refusal in full either way.
  return verdict.exitCode !== EXIT_CLEAR ? verdict.exitCode : carrier.exitCode;
}

if (isEntrypoint(import.meta.url) && !process.argv.includes('--self-test')) {
  process.exitCode = process.argv.includes('--test') ? runTestMode(process.argv) : await main();
}

// -- self-test (offline: pure functions + replay fixtures; no network, no git) --

/**
 * The measured incident this guard descends from, with its real surface.
 * Predicted direction, and the whole point of pinning it: it is REFUSED on
 * `merge_group` with no approving review, and it is a GREEN early warning on
 * `pull_request`. A fixture that passed the queue leg would mean this guard
 * would not have stopped the thing it was built to stop.
 */
const REPLAYS = [
  {
    name: 'objectui#6183 — a governed AGENTS.md PR left draft through an update_pull_request side effect, queued, and merged as 5b3290fd5 with zero reviews',
    pr: 6183,
    subject: 'docs(agents): seat protocol updates (#6183)',
    files: ['AGENTS.md'],
  },
  {
    name: 'the same shape on the instruction tree — a .claude/** change mixed with ordinary source',
    pr: 6184,
    subject: 'chore(hooks): tighten a PreToolUse guard (#6184)',
    files: ['.claude/hooks/guard-shared-stash.sh', 'packages/core/src/index.ts'],
  },
  {
    name: 'the published skills catalog, the surface the domain label routes on',
    pr: 6185,
    subject: 'docs(skill): rewrite the composition rules (#6185)',
    files: ['skills/objectui/rules/composition.md', 'skills/objectui/SKILL.md'],
  },
  {
    name: 'an architecture decision record',
    pr: 6186,
    subject: 'docs(adr): record the governed-surface decision (#6186)',
    files: ['docs/adr/0099-example.md'],
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
  const HEAD = 'f'.repeat(40);
  const OLD = '0'.repeat(40);
  const approvedAt = (login, sha) => ({ state: 'APPROVED', user: { login }, commit_id: sha });
  // HEAD and OLD are both KEPT although no sha is compared any more: "the
  // commit does not matter" is only measured by cases where the commit differs.
  const authorizedPass = (login = GOVERNED_APPROVERS[0]) => authorizedApprovalVerdict([approvedAt(login, HEAD)]);
  const run = (event, rows, approvals = new Map()) => {
    const { governed, unattributed } = decomposeGovernedWork(rows);
    return guardVerdict({ event, governed, unattributed, approvals, apiCalls: governed.length });
  };

  // -- the governed surface IS the ruled definition, in both directions ------
  //
  // The card restated the 2026-08-18 definition as five surfaces, and the
  // maintainer's ruling on objectui#12255 added the sixth, `.github/workflows/**`.
  // Pinning the membership BOTH ways is what stops a seventh being added here
  // instead of by a maintainer, and one being dropped by an edit nobody reads.
  assert('the-register-declares-exactly-the-six-ruled-surfaces', GOVERNED_SURFACES.length === 6, String(GOVERNED_SURFACES.length));
  assert(
    'and-they-are-the-ruled-globs-verbatim',
    GOVERNED_SURFACES.map((s) => s.glob).join() === 'docs/adr/**,.claude/**,skills/**,AGENTS.md,CLAUDE.md,.github/workflows/**',
    GOVERNED_SURFACES.map((s) => s.glob).join(),
  );
  for (const surface of GOVERNED_SURFACES) {
    const sample = surface.prefix ? `${surface.prefix}sample.md` : surface.exact;
    const { governed } = decomposeGovernedWork([row(1, [sample])]);
    assert(`the-register-drives-the-verdict-for-${surface.id}`, governed.length === 1 && governed[0].paths.includes(sample), sample);
  }
  // The two exact rows are EXACT: a vendored or example copy is ordinary source.
  assert('an-example-copy-of-AGENTS.md-is-not-the-governed-one', governedPathsIn(['examples/AGENTS.md']).length === 0);
  assert('a-near-miss-adr-directory-is-not-governed', governedPathsIn(['docs/adrs/z.md', 'docs/adr-notes.md']).length === 0);
  // ⭐ This case used to pin the OPPOSITE — "this guard's own workflow is NOT
  // governed" — as the widening deliberately not taken. The maintainer took it
  // (objectui#12255), so it is reversed rather than deleted: the guard governs
  // its own workflow file, and the script that file runs stays ordinary source.
  const ownWiring = governedPathsIn([`.github/workflows/${CHECK_WORKFLOW}`, 'scripts/check-governed-queue-guard.mjs']);
  assert(
    'this-guards-own-workflow-IS-governed-and-its-script-is-not',
    ownWiring.length === 1 && ownWiring[0].id === 'workflows' && ownWiring[0].files.join() === `.github/workflows/${CHECK_WORKFLOW}`,
    JSON.stringify(ownWiring.map((s) => [s.id, s.files])),
  );
  // ⛔ The widening this guard still does NOT take: the ruling named the
  // workflows, not the `.github/` directory that holds them.
  assert(
    'the-rest-of-.github-is-NOT-governed',
    governedPathsIn(['.github/dependabot.yml', '.github/ISSUE_TEMPLATE/config.yml', '.github/labeler.yml', '.github/prompts/component.prompt.md']).length === 0,
  );
  assert('a-near-miss-workflows-path-is-not-governed', governedPathsIn(['.github/workflow/ci.yml', '.github/workflows.md']).length === 0);
  assert('ordinary-source-is-not-governed', governedPathsIn(['packages/core/src/index.ts', 'content/docs/guide/x.md', 'package.json']).length === 0);

  // -- the exit contract as a table ------------------------------------------
  assert('exit-clear-is-0', EXIT_CLEAR === 0);
  assert('exit-cannot-run-is-1', EXIT_CANNOT_RUN === 1);
  assert('exit-bad-usage-is-2', EXIT_BAD_USAGE === 2);
  assert(
    'the-three-refusals-are-distinct-non-zero-codes',
    new Set([EXIT_REFUSED_UNAPPROVED, EXIT_REFUSED_UNREADABLE, EXIT_REFUSED_UNATTRIBUTED]).size === 3 &&
      ![EXIT_REFUSED_UNAPPROVED, EXIT_REFUSED_UNREADABLE, EXIT_REFUSED_UNATTRIBUTED].includes(0),
  );

  // -- the merge-queue head ref ----------------------------------------------
  assert('queue-ref-yields-its-pr', pullNumberFromQueueRef('refs/heads/gh-readonly-queue/main/pr-6183-484ae0019cd') === 6183);
  assert('queue-ref-without-the-refs-prefix-too', pullNumberFromQueueRef('gh-readonly-queue/main/pr-42-abcdef1') === 42);
  assert('a-base-branch-with-a-slash-is-still-read', pullNumberFromQueueRef('refs/heads/gh-readonly-queue/release/v5/pr-7-abcdef1') === 7);
  assert('an-ordinary-branch-that-merely-looks-like-one-is-NOT-a-queue-ref', pullNumberFromQueueRef('refs/heads/pr-12-abcdef1') === null);
  assert('a-plain-branch-is-null', pullNumberFromQueueRef('refs/heads/claude/issue-1-x') === null);
  assert('nonsense-is-null-never-a-number', pullNumberFromQueueRef(undefined) === null && pullNumberFromQueueRef('') === null);

  // -- the subject parser (this repo squashes, so the trailing form fires) ----
  assert('a-squash-subject-yields-its-pr', pullNumberFromSubject('fix(grid): read the policy first (#6722)') === 6722);
  assert('a-merge-commit-subject-does-too', pullNumberFromSubject('Merge pull request #6722 from claude/x') === 6722);
  assert(
    'a-subject-citing-an-issue-mid-title-keeps-only-the-trailing-parenthetical',
    pullNumberFromSubject('fix(plugin-detail): re-key three fetch effects (#6697) (#6725)') === 6725,
  );
  assert('a-subject-naming-no-pr-is-null', pullNumberFromSubject('chore: direct work') === null && pullNumberFromSubject(undefined) === null);

  // -- event payloads, including the malformed ones ---------------------------
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

  // -- the any-approver predicate (the early-warning leg's) -------------------
  assert('an-approval-is-an-approval', approvalVerdict(approved('hotlong')).state === 'approved');
  assert('no-reviews-at-all-is-unapproved', approvalVerdict([]).state === 'unapproved');
  assert('a-COMMENTED-review-is-not-an-approval', approvalVerdict([{ state: 'COMMENTED', user: { login: 'a' } }]).state === 'unapproved');
  // ⭐ The fail-open direction a naive `.some(r => r.state === 'APPROVED')` gets
  // wrong, and the only direction this file may not be wrong in.
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

  // -- the authorized predicate (the queue leg's) ----------------------------
  //
  // ⭐ Maintainer ruling 2026-09-04, pinned in BOTH directions: an authorized
  // approval counts on whichever commit it was left, and every way an approval
  // never counted still never counts. The first three cases are the ones that
  // used to assert the opposite; they are flips, not additions.
  assert('the-authorized-set-is-the-two-carried-accounts', GOVERNED_APPROVERS.join() === 'os-zhuang,hotlong');
  for (const login of GOVERNED_APPROVERS) {
    assert(`an-authorized-approval-counts: ${login}`, authorizedApprovalVerdict([approvedAt(login, HEAD)]).state === 'approved');
  }
  const older = authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], OLD)]);
  assert(
    'an-authorized-approval-left-on-an-OLDER-commit-COUNTS-the-2026-09-04-ruling',
    older.state === 'approved' && older.approvers.join() === GOVERNED_APPROVERS[0],
    JSON.stringify(older),
  );
  assert(
    'an-authorized-approval-with-NO-commit_id-counts-a-human-record-is-not-a-sha',
    authorizedApprovalVerdict(approved(GOVERNED_APPROVERS[0])).state === 'approved',
  );
  const outsider = authorizedApprovalVerdict([approvedAt('not-authorized', HEAD)]);
  assert('an-unauthorized-approval-never-counts', outsider.state === 'unapproved' && outsider.unauthorizedApprovers.join() === 'not-authorized');
  assert(
    'an-authorized-approval-later-superseded-by-CHANGES_REQUESTED-never-counts',
    authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], HEAD), { state: 'CHANGES_REQUESTED', user: { login: GOVERNED_APPROVERS[0] }, commit_id: HEAD }]).state === 'unapproved',
  );
  assert(
    'a-DISMISSED-authorized-approval-never-counts',
    authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[1], HEAD), { state: 'DISMISSED', user: { login: GOVERNED_APPROVERS[1] }, commit_id: HEAD }]).state === 'unapproved',
  );
  assert('no-reviews-at-all-is-unapproved-under-the-authorized-predicate-too', authorizedApprovalVerdict([]).state === 'unapproved');
  assert(
    'an-unauthorized-approval-does-not-mask-an-authorized-one',
    authorizedApprovalVerdict([approvedAt('not-authorized', HEAD), approvedAt(GOVERNED_APPROVERS[1], HEAD)]).approvers.join() === GOVERNED_APPROVERS[1],
  );
  assert(
    'an-authorized-approval-on-an-UNPARSABLE-commit_id-counts-too-nothing-reads-a-sha-any-more',
    authorizedApprovalVerdict([{ state: 'APPROVED', user: { login: GOVERNED_APPROVERS[0] }, commit_id: 'not-a-sha' }]).state === 'approved',
  );
  assert(
    'only-DECISIVE-states-carry-a-decision-COMMENTED-and-PENDING-are-not-approvals',
    authorizedApprovalVerdict([
      { state: 'COMMENTED', user: { login: GOVERNED_APPROVERS[0] } },
      { state: 'PENDING', user: { login: GOVERNED_APPROVERS[1] } },
    ]).state === 'unapproved',
  );

  // -- decomposition, and the multi-PR group trap ----------------------------
  const clearRows = [row(1, ['packages/core/src/index.ts', 'content/docs/guide/x.md'])];
  assert('a-clear-diff-decomposes-to-nothing', decomposeGovernedWork(clearRows).governed.length === 0 && decomposeGovernedWork(clearRows).unattributed.length === 0);
  const mixed = decomposeGovernedWork([row(5, ['AGENTS.md', 'packages/core/src/index.ts'])]);
  assert('a-mixed-diff-governs-the-whole-pr-and-lists-only-the-governed-paths', mixed.governed[0].paths.join() === 'AGENTS.md', JSON.stringify(mixed.governed[0].paths));
  const batched = decomposeGovernedWork([row(11, ['docs/adr/0099-x.md'], 'a'.repeat(40)), row(12, ['packages/core/src/x.ts'], 'b'.repeat(40))]);
  assert('a-batched-group-attributes-the-governed-diff-to-ITS-OWN-pr-not-the-last-one', batched.governed.length === 1 && batched.governed[0].pr === 11, JSON.stringify(batched.governed.map((g) => g.pr)));
  const twoGoverned = decomposeGovernedWork([row(11, ['AGENTS.md']), row(12, ['skills/objectui/SKILL.md'], 'b'.repeat(40))]);
  assert('two-governed-prs-in-one-group-are-both-carried', twoGoverned.governed.map((g) => g.pr).join() === '11,12');
  const unattributed = decomposeGovernedWork([{ sha: 'c'.repeat(40), subject: 'chore: direct work', pr: null, paths: ['CLAUDE.md'] }]);
  assert('a-governed-commit-naming-no-pr-is-UNATTRIBUTED-never-dropped', unattributed.unattributed.length === 1 && unattributed.governed.length === 0);
  assert('an-UNGOVERNED-commit-naming-no-pr-is-simply-not-our-business', decomposeGovernedWork([{ sha: 'd'.repeat(40), subject: 'x', pr: null, paths: ['README.md'] }]).unattributed.length === 0);

  // -- the verdict table, both events ----------------------------------------
  const clearV = run('merge_group', clearRows);
  assert('a-clear-merge-group-is-CLEAR-and-exits-0', clearV.conclusion === 'clear' && clearV.exitCode === EXIT_CLEAR);
  assert('and-it-made-zero-review-lookups', clearV.apiCalls === 0);
  const refusedV = run('merge_group', [row(6183, ['AGENTS.md'])], new Map([[6183, authorizedApprovalVerdict([])]]));
  assert('an-unapproved-governed-merge-group-is-REFUSED-with-code-3', refusedV.conclusion === 'refused' && refusedV.exitCode === EXIT_REFUSED_UNAPPROVED);
  const clearedV = run('merge_group', [row(6183, ['AGENTS.md'])], new Map([[6183, authorizedPass()]]));
  assert('an-authorized-approval-CLEARS-the-merge-group-and-exits-0', clearedV.conclusion === 'cleared' && clearedV.exitCode === EXIT_CLEAR);
  const olderV = run('merge_group', [row(6183, ['AGENTS.md'])], new Map([[6183, authorizedApprovalVerdict([approvedAt(GOVERNED_APPROVERS[0], OLD)])]]));
  assert('an-approval-left-on-an-OLDER-commit-CLEARS-the-merge-group-too', olderV.conclusion === 'cleared' && olderV.exitCode === EXIT_CLEAR);
  const outsiderV = run('merge_group', [row(6183, ['AGENTS.md'])], new Map([[6183, authorizedApprovalVerdict([approvedAt('not-authorized', HEAD)])]]));
  assert('an-unauthorized-account-approval-REFUSES-the-merge-group-with-code-3', outsiderV.conclusion === 'refused' && outsiderV.exitCode === EXIT_REFUSED_UNAPPROVED);
  const unreadableV = run('merge_group', [row(6183, ['AGENTS.md'])], new Map([[6183, unreadableApproval('HTTP 502')]]));
  assert('an-unreadable-review-list-is-a-REFUSAL-not-a-pass', unreadableV.conclusion === 'refused' && unreadableV.exitCode === EXIT_REFUSED_UNREADABLE);
  const missingV = run('merge_group', [row(6183, ['AGENTS.md'])]);
  assert('a-governed-pr-with-NO-recorded-reading-refuses-too-there-is-no-default-pass', missingV.exitCode === EXIT_REFUSED_UNREADABLE);
  const unattrV = run('merge_group', [{ sha: 'c'.repeat(40), subject: 'chore: x', pr: null, paths: ['CLAUDE.md'] }]);
  assert('an-unattributed-governed-commit-is-REFUSED-with-its-own-code', unattrV.conclusion === 'refused' && unattrV.exitCode === EXIT_REFUSED_UNATTRIBUTED);
  const partial = run(
    'merge_group',
    [row(11, ['AGENTS.md']), row(12, ['skills/objectui/SKILL.md'], 'b'.repeat(40))],
    new Map([[11, authorizedPass()], [12, authorizedApprovalVerdict([])]]),
  );
  assert('one-approved-pr-does-NOT-carry-an-unapproved-sibling-through-the-same-group', partial.exitCode === EXIT_REFUSED_UNAPPROVED);
  // The workflows row's consequence for Dependabot, pinned as the ruling's and
  // not as a defect: a `github-actions` bump edits `.github/workflows/**`, and the
  // approval `dependabot-auto-merge.yml` leaves is by `github-actions[bot]`, an
  // account outside GOVERNED_APPROVERS — so the queue refuses it, and the PR leg
  // only warns, exactly as for any other governed pull request.
  const bumpRows = [row(4242, ['.github/workflows/ci.yml', '.github/workflows/lint.yml'])];
  const bumpQueued = run('merge_group', bumpRows, new Map([[4242, authorizedApprovalVerdict(approved('github-actions[bot]'))]]));
  assert('a-github-actions-bump-approved-only-by-the-bot-is-REFUSED-at-the-queue-with-code-3', bumpQueued.conclusion === 'refused' && bumpQueued.exitCode === EXIT_REFUSED_UNAPPROVED);
  const bumpWarned = run('pull_request', bumpRows, new Map([[4242, approvalVerdict(approved('github-actions[bot]'))]]));
  assert('and-the-same-bump-is-not-reddened-on-its-pull-request', bumpWarned.exitCode === EXIT_CLEAR);

  // -- the pull_request leg is an EARLY WARNING and never reddens -------------
  const warnedV = run('pull_request', [row(6183, ['AGENTS.md'])], new Map([[6183, approvalVerdict([])]]));
  assert('a-governed-unapproved-PULL-REQUEST-is-WARNED-not-refused', warnedV.conclusion === 'warned' && warnedV.exitCode === EXIT_CLEAR);
  assert(
    'the-pr-leg-never-reddens-under-ANY-approval-state-that-is-the-permanently-red-poison',
    ['unapproved', 'unreadable', 'approved'].every(
      (state) => run('pull_request', [row(1, ['AGENTS.md'])], new Map([[1, { state, approvers: [], changesRequestedBy: [], reviewsRead: 0 }]])).exitCode === EXIT_CLEAR,
    ),
  );
  assert('and-an-unattributed-governed-commit-does-not-redden-a-pr-run-either', run('pull_request', [{ sha: 'c'.repeat(40), subject: 'x', pr: null, paths: ['CLAUDE.md'] }]).exitCode === EXIT_CLEAR);

  // -- the replay fixtures ---------------------------------------------------
  for (const replay of REPLAYS) {
    const rows = [row(replay.pr, replay.files, 'e'.repeat(40), replay.subject)];
    const queued = run('merge_group', rows, new Map([[replay.pr, authorizedApprovalVerdict([])]]));
    assert(`replay-REFUSES-at-the-queue: ${replay.name}`, queued.exitCode === EXIT_REFUSED_UNAPPROVED, JSON.stringify(queued.conclusion));
    const early = run('pull_request', rows, new Map([[replay.pr, approvalVerdict([])]]));
    assert(`replay-only-WARNS-on-the-pr: ${replay.name}`, early.conclusion === 'warned' && early.exitCode === EXIT_CLEAR);
    const text = renderGuardVerdict(queued);
    assert(`replay-names-its-governed-paths: ${replay.name}`, replay.files.filter((f) => governedPathsIn([f]).length > 0).every((f) => text.includes(f)), text);
    // The subject the fixture carries is the one `enumerateRows` would parse,
    // so the attribution leg is exercised on the same string a queue build sees.
    assert(`replay-subject-attributes-to-its-own-pr: ${replay.name}`, pullNumberFromSubject(replay.subject) === replay.pr, replay.subject);
  }

  // -- ⭐ the ordering guarantee, measured with a spy that THROWS -------------
  //
  // "The path test runs first and a clear diff makes no API call" is a claim
  // about control flow, so it is tested by making the API impossible to touch.
  // A mock returning [] would have passed against a version that called it.
  let apiTouched = 0;
  const explode = () => {
    apiTouched += 1;
    throw new Error('the API must not be reached for a diff that touches nothing governed');
  };
  let orderedClear = null;
  let orderedThrow = null;
  try {
    orderedClear = await runGuard({ event: 'merge_group', rows: clearRows, fetchReviews: explode });
  } catch (error) {
    orderedThrow = String(error?.message ?? error);
  }
  assert(
    'a-clear-diff-NEVER-constructs-a-review-request',
    apiTouched === 0 && orderedThrow === null && orderedClear?.exitCode === EXIT_CLEAR && orderedClear?.conclusion === 'clear',
    `apiTouched=${apiTouched} threw=${orderedThrow ?? 'no'}`,
  );
  // …and the other half: a governed diff DOES reach the review read, so the
  // case above proves an ordering rather than a dead code path. The review list
  // it gets carries an approval left on an OLDER commit — the ruled direction,
  // measured end to end rather than only on the pure predicate.
  const trace = [];
  const traced = await runGuard({
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchReviews: () => {
      trace.push('reviews');
      return [approvedAt(GOVERNED_APPROVERS[0], OLD)];
    },
  });
  assert('a-governed-queue-diff-reads-the-review-list-and-nothing-else', trace.join() === 'reviews', trace.join());
  assert(
    'the-authorized-predicate-is-wired-end-to-end-an-approval-on-an-OLDER-commit-CLEARS',
    traced.conclusion === 'cleared' && traced.exitCode === EXIT_CLEAR && traced.apiCalls === 1,
    JSON.stringify({ conclusion: traced.conclusion, apiCalls: traced.apiCalls }),
  );
  const tracedOutsider = await runGuard({
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchReviews: () => [approvedAt('not-authorized', HEAD)],
  });
  assert('the-authorized-predicate-is-wired-end-to-end-an-unauthorized-approval-still-REFUSES', tracedOutsider.exitCode === EXIT_REFUSED_UNAPPROVED);
  // The two legs read the same list and differ only in the predicate: the queue
  // leg requires an authorized approver, the early warning takes any. Asserting
  // both halves in one case is what makes "the legs still differ" measured.
  const prLeg = await runGuard({
    event: 'pull_request',
    rows: [row(1, ['AGENTS.md'])],
    fetchReviews: () => approved('anyone'),
  });
  assert(
    'the-pr-leg-keeps-the-ANY-approver-reading-while-the-queue-leg-requires-an-authorized-one',
    prLeg.conclusion === 'warned' && prLeg.apiCalls === 1 &&
      renderGuardVerdict(prLeg).includes('✅ APPROVED review present, by: anyone') &&
      renderGuardVerdict(prLeg).includes('1 review lookup(s).') &&
      authorizedApprovalVerdict(approved('anyone')).state === 'unapproved',
    renderGuardVerdict(prLeg),
  );
  // A throwing reader on a GOVERNED diff becomes a refusal, never a pass — and
  // `runGuard` must CONTAIN the throw rather than propagate it, so this is
  // caught too: an escaping error would abort every case after it, and an
  // aborted self-test hides the failures it already collected.
  let thrown = null;
  let thrownEscaped = null;
  try {
    thrown = await runGuard({
      event: 'merge_group',
      rows: [row(1, ['AGENTS.md'])],
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
  // ⭐ The retired head read, measured rather than assumed. This case replaces
  // the one that pinned "an unreadable PR head refuses with exit 4 before the
  // review request is built": that ordering existed only because the sha pin
  // needed a head, and a mechanism removed by a ruling must be checked ABSENT,
  // not left to be inferred from the code reading clean. One governed pull
  // request now costs exactly ONE lookup, and it is the review list.
  let readsPerPull = 0;
  const oneRead = await runGuard({
    event: 'merge_group',
    rows: [row(1, ['AGENTS.md'])],
    fetchReviews: () => {
      readsPerPull += 1;
      return [approvedAt(GOVERNED_APPROVERS[0], OLD)];
    },
  });
  assert(
    'the-queue-leg-costs-exactly-ONE-review-lookup-per-governed-pr-the-head-read-is-retired',
    readsPerPull === 1 && oneRead.apiCalls === 1 && oneRead.conclusion === 'cleared',
    `readsPerPull=${readsPerPull} apiCalls=${oneRead.apiCalls} conclusion=${oneRead.conclusion}`,
  );

  // -- the words a reader acts on --------------------------------------------
  const refusalText = renderGuardVerdict(refusedV);
  assert('a-refusal-names-the-exact-paths-that-matched', refusalText.includes('AGENTS.md'), refusalText);
  assert('a-refusal-names-the-pull-request', refusalText.includes('#6183'), refusalText);
  assert('a-refusal-states-what-would-satisfy-it', /What satisfies this check/.test(refusalText) && /DRAFT/.test(refusalText) && /APPROVED review/.test(refusalText), refusalText);
  assert('a-refusal-names-the-preferred-remedy-first-and-it-is-DEQUEUE-not-approve', refusalText.indexOf('DRAFT') < refusalText.indexOf('obtain an APPROVED review'), refusalText);
  // ⭐ Ruling C (maintainer 2026-09-13): the remedy is an ORDER, not a menu —
  // out of the queue as a DRAFT first, then the authorized approval, then the
  // claiming seat lands it. The pin reads all three positions rather than the
  // first two, because a remedy that stopped at the approval would leave a
  // seat waiting for a merge nobody is going to perform. The landing sentence
  // is spelled here as a literal, NOT imported from the renderer, so this pin
  // states independently what the text must say.
  const claimingSeatLands = 'the claiming seat readies it and arms auto-merge, and the queue lands it';
  assert(
    'a-refusal-orders-the-remedy-DRAFT-then-the-authorized-APPROVAL-then-the-claiming-seat-lands-it-ruling-C',
    refusalText.indexOf('DRAFT') < refusalText.indexOf('obtain an APPROVED review') &&
      refusalText.indexOf('obtain an APPROVED review') < refusalText.indexOf(claimingSeatLands) &&
      /that approval IS the review record/.test(refusalText) &&
      /2026-09-13/.test(refusalText),
    refusalText,
  );
  assert('a-refusal-forecloses-the-edit-the-check-remedy', /Neither of those is "edit this check"/.test(refusalText), refusalText);
  assert('a-refusal-carries-the-runnable-derivation-command', refusalText.includes('check-governed-queue-guard.mjs --test'), refusalText);
  assert('a-refusal-names-the-incident-it-descends-from', /6183/.test(refusalText) && /5b3290fd5/.test(refusalText), refusalText);
  const clearText = renderGuardVerdict(clearV);
  assert('a-clear-run-says-it-cost-zero-lookups', /ZERO review lookups/.test(clearText), clearText);
  assert('a-clear-run-points-at-the-register-rather-than-listing-surfaces', clearText.includes('GOVERNED_SURFACES') && !clearText.includes('docs/adr/**'), clearText);
  const warnText = renderGuardVerdict(warnedV);
  assert('the-warning-says-out-loud-that-it-is-deliberately-green', /EARLY WARNING/.test(warnText) && /GREEN here/.test(warnText), warnText);
  assert('the-warning-tells-a-seat-what-not-to-do', /flip it ready, enqueue it, or arm auto-merge/.test(warnText), warnText);
  // ⭐ ... and says out loud that the prohibition is CONDITIONAL, and what a
  // seat DOES do once the approval is on record. An unconditional ⛔ here
  // would tell a seat to sit on a pull request ruling C says it should land.
  assert(
    'the-warnings-prohibition-is-CONDITIONAL-and-names-the-claiming-seat-landing-after-an-authorized-approval',
    /while no authorized APPROVED review is on/.test(warnText) &&
      warnText.indexOf('flip it ready, enqueue it, or arm auto-merge') < warnText.indexOf(claimingSeatLands) &&
      GOVERNED_APPROVERS.every((login) => warnText.includes(login)) &&
      /2026-09-13/.test(warnText),
    warnText,
  );
  // ⭐ The warning names the exact mechanism of the incident, because the seat
  // reading it is the seat about to make the same call.
  assert('the-warning-names-the-hidden-draft-false-side-effect', /draft: false/.test(warnText) && /update_pull_request/.test(warnText), warnText);
  assert('the-warning-forecasts-the-queue-refusal', /REFUSES it/.test(warnText), warnText);
  assert('an-outstanding-changes-request-is-reported-even-though-it-does-not-flip-the-verdict', /CHANGES_REQUESTED from: b/.test(renderGuardVerdict(run('merge_group', [row(1, ['AGENTS.md'])], new Map([[1, approvalVerdict([...approved('a'), { state: 'CHANGES_REQUESTED', user: { login: 'b' } }])]])))));
  const kinds = [refusedV, unreadableV, unattrV].map((v) => renderGuardVerdict(v));
  assert('the-three-refusal-kinds-render-three-different-explanations', new Set(kinds).size === 3);
  assert('the-unreadable-refusal-says-it-is-deliberately-not-a-pass', /refusal and not a pass/.test(kinds[1]), kinds[1]);
  assert(
    'the-refusal-remedy-names-every-authorized-approver-from-the-constant',
    GOVERNED_APPROVERS.every((login) => refusalText.includes(login)) && refusalText.includes('GOVERNED_APPROVERS'),
    refusalText,
  );
  assert('the-refusal-remedy-states-the-agent-no-approve-prohibition', /An agent seat never submits that approval/.test(refusalText), refusalText);
  const olderText = renderGuardVerdict(olderV);
  assert(
    'an-older-commit-approval-renders-as-CLEARED-and-nothing-in-the-output-calls-it-stale',
    /CLEARED/.test(olderText) && olderText.includes(GOVERNED_APPROVERS[0]) && !/STALE/i.test(olderText) && !olderText.includes(OLD.slice(0, 12)),
    olderText,
  );
  assert(
    'an-unauthorized-refusal-says-the-approval-never-counts',
    /APPROVED by account\(s\) outside GOVERNED_APPROVERS: not-authorized — never counts/.test(renderGuardVerdict(outsiderV)),
    renderGuardVerdict(outsiderV),
  );
  const clearedText = renderGuardVerdict(clearedV);
  assert(
    'the-cleared-summary-states-the-ruled-predicate-and-derives-its-accounts-from-the-constant',
    /regardless of which commit/.test(clearedText) && /2026-09-04/.test(clearedText) && GOVERNED_APPROVERS.every((login) => clearedText.includes(login)),
    clearedText,
  );
  assert(
    'an-authorized-pass-names-the-approver-and-pins-NO-head-sha',
    clearedText.includes(`by: ${GOVERNED_APPROVERS[0]}`) && !clearedText.includes(HEAD.slice(0, 12)),
    clearedText,
  );

  // -- the seat-side `--test` predicate --------------------------------------
  const governedTest = testVerdict(['AGENTS.md', 'packages/core/src/index.ts']);
  assert('--test-reports-a-mixed-diff-as-GOVERNED', governedTest.governed && governedTest.hitPaths.join() === 'AGENTS.md' && governedTest.clearPaths.join() === 'packages/core/src/index.ts');
  const clearTest = testVerdict(['packages/core/src/index.ts', 'package.json']);
  assert('--test-reports-an-ordinary-diff-as-NOT-GOVERNED', !clearTest.governed && clearTest.checked === 2);
  const governedTestText = renderTestVerdict(governedTest);
  assert('--test-names-the-surface-and-the-file', /GOVERNED/.test(governedTestText) && governedTestText.includes('AGENTS.md') && governedTestText.includes('the repo-root agent instruction file'), governedTestText);
  assert(
    '--test-prescribes-DRAFT-then-an-authorized-APPROVED-review-then-the-claiming-seat-lands-it-ruling-C',
    governedTestText.indexOf('DRAFT') > -1 &&
      governedTestText.indexOf('DRAFT') < governedTestText.indexOf('APPROVED review by an authorized approver') &&
      governedTestText.indexOf('APPROVED review by an authorized approver') < governedTestText.indexOf(claimingSeatLands) &&
      /That approval IS the review record for a governed surface/.test(governedTestText) &&
      /An agent seat never submits that approval/.test(governedTestText) &&
      /2026-09-13/.test(governedTestText) &&
      GOVERNED_APPROVERS.every((login) => governedTestText.includes(login)),
    governedTestText,
  );
  // ⛔ The pre-ruling-C wording, pinned in the REFUSING direction across every
  // rendering a seat acts on. It told a seat to leave the merge to the
  // maintainer and called that merge the review record; ruling C moved the
  // landing to the claiming seat, so the old wording under-permits the text a
  // seat is told to act on. A negative is the only pin that catches a
  // paragraph drifting back.
  for (const [where, text] of [
    ['--test', governedTestText],
    ['refusal', refusalText],
    ['early-warning', warnText],
  ]) {
    assert(
      `⛔ the-${where}-text-never-tells-a-seat-to-leave-the-merge-to-the-maintainer-nor-calls-that-merge-the-record`,
      !/leave the merge to the maintainer/.test(text) && !/human merge IS the review record/.test(text) && !/merge by hand/.test(text),
      text,
    );
  }
  assert('--test-names-the-check-a-queue-build-would-run', governedTestText.includes(CHECK_CONTEXT_NAME), governedTestText);
  assert('--test-on-a-clear-list-says-the-normal-route-applies', /NOT GOVERNED/.test(renderTestVerdict(clearTest)), renderTestVerdict(clearTest));
  // Empty input is BAD USAGE, not a clearance: `--test` with no paths would
  // otherwise print "not governed" about a question nobody asked.
  assert('--test-with-no-paths-is-BAD-USAGE-not-a-clearance', runTestMode(['node', 'x', '--test']) === EXIT_BAD_USAGE);

  // -- ⛔ objectui#9018: the contract-review carrier is the enqueue gate ------
  //
  // The eleven measured enqueues of 2026-09-09 are replayed at the bottom of
  // this section with their PREDICTED DIRECTION, because the whole claim of this
  // leg is "it would have refused these" — and SIX of them it would NOT have,
  // which is the boundary that must keep being measured rather than remembered.

  // ⭐ The mirror is no longer pinned against a local source: the sweeper whose
  // H31 owned the spelling is not in this tree since objectui#10208 (see the
  // constant's own comment). What is still pinned is the property the mirror
  // rests on: this guard runs with no install, so it does not reach into
  // `scripts/pm/` for anything.
  try {
    const selfSource = readFileSync(join(repoRoot, 'scripts', 'check-governed-queue-guard.mjs'), 'utf8');
    const pmImports = selfSource.split('\n').filter((l) => /^import\s.*from\s+'[^']*\/pm\//.test(l));
    assert(
      'this-guard-imports-NOTHING-out-of-scripts-pm-which-is-WHY-the-label-is-mirrored',
      pmImports.length === 0,
      `${pmImports.join(' | ')} — the workflow runs this file with no install; coupling it to a PM sweeper is how a gate stops running`,
    );
  } catch (error) {
    assert('this-guards-own-source-is-readable-so-the-mirror-REASON-can-be-pinned', false, String(error?.message ?? error).split('\n')[0]);
  }
  assert(
    'the-two-carrier-codes-are-distinct-non-zero-and-collide-with-no-governed-code',
    new Set([EXIT_CLEAR, EXIT_CANNOT_RUN, EXIT_BAD_USAGE, EXIT_REFUSED_UNAPPROVED, EXIT_REFUSED_UNREADABLE, EXIT_REFUSED_UNATTRIBUTED, EXIT_REFUSED_CARRIER, EXIT_REFUSED_CARRIER_UNREADABLE]).size === 8 &&
      EXIT_REFUSED_CARRIER !== 0 &&
      EXIT_REFUSED_CARRIER_UNREADABLE !== 0,
    JSON.stringify([EXIT_REFUSED_CARRIER, EXIT_REFUSED_CARRIER_UNREADABLE]),
  );

  // -- enumeration: the under-enumeration trap, which is this leg's whole port --
  const carrierRow = (pr, sha = 'a'.repeat(40)) => ({ sha, subject: `x (#${pr})`, pr, paths: ['README.md'] });
  assert(
    'group-pulls-dedupe-and-keep-group-order',
    JSON.stringify(carrierPullsInGroup([carrierRow(7), carrierRow(3), carrierRow(7)])) === JSON.stringify([7, 3]),
    JSON.stringify(carrierPullsInGroup([carrierRow(7), carrierRow(3), carrierRow(7)])),
  );
  assert(
    'a-multi-PR-group-does-NOT-collapse-to-the-queue-refs-LAST-pr',
    JSON.stringify(carrierPullsInGroup([carrierRow(11), carrierRow(22)], 22)) === JSON.stringify([11, 22]),
    'the head ref names only the last PR; keying the leg to it lets an earlier open carrier ride in behind it',
  );
  // ⭐ The same trap stated as the DEFECT rather than as the shape: a group whose
  // head ref names a BARE pull request, carrying an earlier GATED one. A head-ref
  // implementation reads this group as clear. This one refuses it.
  const underEnumTrap = await runCarrierGuard({
    event: EVENT_MERGE_GROUP,
    rows: [carrierRow(11), carrierRow(22)],
    namedPull: 22,
    fetchLabels: async (pull) => (pull === 11 ? ['size/s', CONTRACT_REVIEW_LABEL] : ['size/s']),
  });
  assert(
    'the-UNDER-ENUMERATION-defect-itself-a-gated-PR-behind-a-bare-head-ref-is-REFUSED-not-cleared',
    underEnumTrap.exitCode === EXIT_REFUSED_CARRIER && underEnumTrap.apiCalls === 2,
    JSON.stringify({ exit: underEnumTrap.exitCode, reads: underEnumTrap.apiCalls }),
  );
  assert(
    'the-queue-ref-is-the-fallback-ONLY-when-nothing-is-attributed',
    JSON.stringify(carrierPullsInGroup([{ sha: 'b'.repeat(40), subject: 'no pr here', pr: null, paths: [] }], 99)) === JSON.stringify([99]),
  );
  assert(
    'no-rows-and-no-named-pull-yields-no-pulls-never-a-phantom-zero',
    carrierPullsInGroup([], null).length === 0 && carrierPullsInGroup(undefined, 0).length === 0,
  );

  // -- the verdict table ------------------------------------------------------
  const carrierRun = (event, pulls, states) => {
    const readings = new Map();
    for (const [pr, state] of Object.entries(states)) {
      const n = Number(pr);
      readings.set(
        n,
        state === 'unreadable'
          ? { pr: n, state: 'unreadable', labels: [], reason: 'HTTP 403 (fixture)' }
          : { pr: n, state, labels: state === 'gated' ? ['priority:p2', CONTRACT_REVIEW_LABEL] : ['priority:p2'] },
      );
    }
    return carrierVerdict({ event, pulls, readings, apiCalls: pulls.length });
  };
  const gatedOne = carrierRun(EVENT_MERGE_GROUP, [5], { 5: 'gated' });
  assert('an-OPEN-carrier-on-a-queued-PR-REFUSES-with-6', gatedOne.exitCode === EXIT_REFUSED_CARRIER && gatedOne.conclusion === 'refused', JSON.stringify(gatedOne.exitCode));
  const bareOne = carrierRun(EVENT_MERGE_GROUP, [5], { 5: 'bare' });
  assert('a-queued-PR-without-the-carrier-PASSES-with-0', bareOne.exitCode === EXIT_CLEAR && bareOne.conclusion === 'clear', JSON.stringify(bareOne.exitCode));
  const unreadableOne = carrierRun(EVENT_MERGE_GROUP, [5], { 5: 'unreadable' });
  assert(
    'an-unreadable-label-set-REFUSES-with-its-OWN-code-7-and-never-passes',
    unreadableOne.exitCode === EXIT_REFUSED_CARRIER_UNREADABLE && unreadableOne.conclusion === 'refused',
    JSON.stringify(unreadableOne.exitCode),
  );
  const noPull = carrierVerdict({ event: EVENT_MERGE_GROUP, pulls: [], readings: new Map(), apiCalls: 0 });
  assert('a-merge-group-naming-NO-pull-request-REFUSES-with-7', noPull.exitCode === EXIT_REFUSED_CARRIER_UNREADABLE && noPull.refusalKind === 'no-pull');
  // ⭐ 7 is not a worse 6: the two refusals are reached for DIFFERENT reasons and
  // the reason is carried in the verdict, not only in the code.
  assert(
    'the-two-refusals-carry-DIFFERENT-refusalKinds-so-7-is-never-just-a-worse-6',
    gatedOne.refusalKind === 'gated' && unreadableOne.refusalKind === 'unreadable' && noPull.refusalKind === 'no-pull',
    JSON.stringify([gatedOne.refusalKind, unreadableOne.refusalKind, noPull.refusalKind]),
  );
  const carrierMixed = carrierRun(EVENT_MERGE_GROUP, [11, 22], { 11: 'gated', 22: 'bare' });
  assert(
    'a-bare-PR-does-NOT-carry-a-gated-sibling-through-the-group',
    carrierMixed.exitCode === EXIT_REFUSED_CARRIER,
    'PR B being clean is not a reading about PR A',
  );
  const carrierBlind = carrierRun(EVENT_MERGE_GROUP, [11, 22], { 11: 'gated', 22: 'unreadable' });
  assert(
    'an-unreadable-row-beside-a-gated-one-reports-the-reading-it-could-NOT-make',
    carrierBlind.exitCode === EXIT_REFUSED_CARRIER_UNREADABLE && carrierBlind.refusalKind === 'unreadable',
    'folding 7 into 6 would hide an outage behind a refusal that looks explained',
  );
  // A reading that never arrived is not a pass either — the same fail-closed
  // default `guardVerdict` gives an approval nobody recorded.
  const missingReading = carrierVerdict({ event: EVENT_MERGE_GROUP, pulls: [5], readings: new Map(), apiCalls: 1 });
  assert('a-pull-with-NO-recorded-reading-REFUSES-rather-than-defaulting-to-bare', missingReading.exitCode === EXIT_REFUSED_CARRIER_UNREADABLE);

  // -- the pull_request leg: not applicable, silent, and it reads NO label -----
  const carrierPrLeg = carrierVerdict({ event: EVENT_PULL_REQUEST, pulls: [5], readings: new Map() });
  assert('the-pull_request-leg-is-NOT-APPLICABLE-and-exits-clear', carrierPrLeg.conclusion === 'not-applicable' && carrierPrLeg.exitCode === EXIT_CLEAR);
  assert('the-pull_request-leg-renders-NOTHING-so-that-legs-output-stays-byte-identical', renderCarrierVerdict(carrierPrLeg) === '');
  let labelsTouched = 0;
  const explodeLabels = () => {
    labelsTouched += 1;
    throw new Error('the carrier leg must not read a label on the pull_request leg');
  };
  const prLegRun = await runCarrierGuard({ event: EVENT_PULL_REQUEST, rows: [carrierRow(5)], fetchLabels: explodeLabels });
  assert(
    'the-pull_request-leg-makes-ZERO-label-reads-measured-with-a-spy-that-THROWS',
    labelsTouched === 0 && prLegRun.apiCalls === 0 && prLegRun.conclusion === 'not-applicable',
    `labelsTouched=${labelsTouched}`,
  );

  // -- end to end through `runCarrierGuard`, with the reader injected ---------
  const e2eGated = await runCarrierGuard({
    event: EVENT_MERGE_GROUP,
    rows: [carrierRow(11), carrierRow(22)],
    fetchLabels: async (pull) => (pull === 11 ? ['size/s', CONTRACT_REVIEW_LABEL] : ['size/s']),
  });
  assert(
    'end-to-end-one-label-read-per-queued-PR-and-the-open-carrier-refuses',
    e2eGated.apiCalls === 2 && e2eGated.exitCode === EXIT_REFUSED_CARRIER,
    JSON.stringify({ apiCalls: e2eGated.apiCalls, exit: e2eGated.exitCode }),
  );
  const e2eThrows = await runCarrierGuard({
    event: EVENT_MERGE_GROUP,
    rows: [carrierRow(11)],
    fetchLabels: async () => {
      throw new Error('GET /repos/o/r/pulls/11 answered HTTP 403');
    },
  });
  assert(
    'a-throwing-label-read-becomes-a-REFUSAL-and-never-escapes-as-a-rejection',
    e2eThrows.exitCode === EXIT_REFUSED_CARRIER_UNREADABLE && /403/.test(renderCarrierVerdict(e2eThrows)),
    renderCarrierVerdict(e2eThrows),
  );
  // ⭐ THE THIRD LEG — ACCEPTANCE, in the same run as the two refusals. Without
  // it the after-state reads as "a guard that now refuses everything", and a
  // gate nobody can get past is a gate everyone routes around.
  let acceptReads = 0;
  const e2eAccept = await runCarrierGuard({
    event: EVENT_MERGE_GROUP,
    rows: [carrierRow(31), carrierRow(32), carrierRow(33)],
    namedPull: 33,
    fetchLabels: async (pull) => {
      acceptReads += 1;
      return pull === 32 ? ['tests', 'package: core'] : ['documentation', 'priority:p3'];
    },
  });
  assert(
    'a-three-PR-group-with-NO-carrier-anywhere-is-CLEAR-exit-0-every-PR-actually-read',
    e2eAccept.exitCode === EXIT_CLEAR &&
      e2eAccept.conclusion === 'clear' &&
      acceptReads === 3 &&
      e2eAccept.entries.length === 3 &&
      e2eAccept.entries.every((entry) => entry.state === 'bare'),
    JSON.stringify({ exit: e2eAccept.exitCode, reads: acceptReads, states: e2eAccept.entries.map((entry) => entry.state) }),
  );
  assert(
    'and-that-acceptance-still-PRINTS-the-label-not-verdict-boundary-rather-than-a-bare-green',
    /reads the LABEL, not the verdict/.test(renderCarrierVerdict(e2eAccept)) && /✅  CLEAR/.test(renderCarrierVerdict(e2eAccept)),
    renderCarrierVerdict(e2eAccept),
  );

  // -- the words a reader acts on ---------------------------------------------
  const gatedText = renderCarrierVerdict(gatedOne);
  assert(
    'the-refusal-QUOTES-the-rule-verbatim-untranslated',
    gatedText.includes('双肢命中任一 ⇒ 无席内条款②复核 PASS 在案 ⛔ 禁止入队') && gatedText.includes('开着的载体恒 = 真实待审'),
    gatedText,
  );
  // ⚠️ The rule does NOT live in this repository, and a citation a reader greps
  // for and cannot find is worse than no citation: the refusal names the sibling.
  assert(
    'the-refusal-CITES-the-sibling-repository-because-objectui-has-no-pm-dispatch-skill-tree',
    gatedText.includes('objectstack-ai/objectstack .claude/skills/pm-dispatch/SKILL.md') && /SIBLING/.test(gatedText),
    gatedText,
  );
  assert(
    'the-refusal-NAMES-WHO-CAN-ACT-and-forbids-stripping-the-label-to-get-past-it',
    /同席剥标/.test(gatedText) && /Stripping the label to get past this check/.test(gatedText) && /DRAFT/.test(gatedText),
    gatedText,
  );
  assert(
    'the-refusals-DRAFT-remedy-carries-this-repositorys-OWN-measured-reason-that-disarming-auto-merge-does-not-dequeue',
    /objectui#6183 measured exactly that/.test(gatedText),
    gatedText,
  );
  assert(
    'the-unreadable-refusal-names-the-cause-and-reads-as-a-refusal-not-a-pass',
    /could NOT be read/.test(renderCarrierVerdict(unreadableOne)) && /REFUSED/.test(renderCarrierVerdict(unreadableOne)),
    renderCarrierVerdict(unreadableOne),
  );
  assert(
    'the-no-pull-refusal-explains-that-an-unattributable-queue-entry-fails-CLOSED',
    /names NO pull request/.test(renderCarrierVerdict(noPull)) && /Fail closed/.test(renderCarrierVerdict(noPull)),
    renderCarrierVerdict(noPull),
  );
  assert(
    'the-CLEAR-states-the-label-not-verdict-boundary-so-green-is-never-read-as-the-review-happened',
    /reads the LABEL, not the verdict/.test(renderCarrierVerdict(bareOne)),
    renderCarrierVerdict(bareOne),
  );
  // ⚠️ objectui has no `check-clause2-carriers.mjs` to defer the verdict question
  // to — the sibling does — and no sweeper copy since objectui#10208. Naming a
  // file that does not exist here would be a refusal pointing a reader at
  // nothing, so the boundary names the ABSENCE.
  assert(
    'the-boundary-names-the-ABSENCE-and-no-file-this-repo-does-not-have',
    /NO check that/.test(renderCarrierVerdict(bareOne)) &&
      !renderCarrierVerdict(bareOne).includes('check-clause2-carriers') &&
      !renderCarrierVerdict(bareOne).includes('check-half-states'),
    renderCarrierVerdict(bareOne),
  );
  const carrierKinds = [gatedText, renderCarrierVerdict(unreadableOne), renderCarrierVerdict(noPull)];
  assert('the-three-carrier-refusal-kinds-render-three-different-explanations', new Set(carrierKinds).size === 3);

  // -- the label reader's own contract ----------------------------------------
  const labelArgs = { apiUrl: 'https://api.example', slug: 'o/r', token: null };
  const fakeLabelRes = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });
  assert(
    'the-label-reader-answers-the-names-on-the-PULL-object-the-scope-already-granted',
    JSON.stringify(await makeLabelReader({ ...labelArgs, fetchImpl: fakeLabelRes({ labels: [{ name: 'a' }, { name: CONTRACT_REVIEW_LABEL }] }) })(7)) ===
      JSON.stringify(['a', CONTRACT_REVIEW_LABEL]),
  );
  let labelUrl = '';
  await makeLabelReader({
    ...labelArgs,
    fetchImpl: async (url) => {
      labelUrl = url;
      return { ok: true, status: 200, json: async () => ({ labels: [] }) };
    },
  })(7);
  assert(
    'and-it-reads-the-PULLS-route-not-the-ISSUES-one-which-would-need-a-scope-the-workflow-does-not-grant',
    labelUrl === 'https://api.example/repos/o/r/pulls/7' && !labelUrl.includes('/issues/'),
    labelUrl,
  );
  const labelReaderThrow = async (fetchImpl) => {
    try {
      await makeLabelReader({ ...labelArgs, fetchImpl })(7);
      return null;
    } catch (error) {
      return String(error?.message ?? error);
    }
  };
  assert('a-non-2xx-label-read-throws-with-its-status', /HTTP 403/.test(await labelReaderThrow(fakeLabelRes({}, false, 403))));
  assert(
    'a-body-with-no-labels-array-throws-never-silently-reads-as-an-absent-carrier',
    /no labels array/.test(await labelReaderThrow(fakeLabelRes({}))),
  );

  // -- the zero-cost clear, re-measured for this leg --------------------------
  //
  // A verdict may not deny its own evidence. The merge_group clear is now SCOPED
  // (this leg took its outage promise away); the pull_request one keeps its
  // pre-#9018 bytes exactly, because that leg makes no label read at all.
  const clearMgText = renderGuardVerdict(guardVerdict({ event: EVENT_MERGE_GROUP, governed: [], unattributed: [], apiCalls: 0 }));
  const clearPrText = renderGuardVerdict(guardVerdict({ event: EVENT_PULL_REQUEST, governed: [], unattributed: [], apiCalls: 0 }));
  assert(
    'the-merge_group-zero-cost-clear-SCOPES-its-outage-promise-because-the-carrier-leg-took-it-away',
    clearMgText.includes('Scoped to the GOVERNED-SURFACE leg') && clearMgText.includes('An outage there DOES refuse this merge group.'),
    clearMgText,
  );
  assert(
    'the-pull_request-zero-cost-clear-keeps-its-pre-9018-bytes-carrying-NO-carrier-note',
    !clearPrText.includes('Scoped to the GOVERNED-SURFACE leg') &&
      clearPrText.includes('so a GitHub API outage can never block a diff that touches nothing governed.'),
    clearPrText,
  );

  // -- the replay: the eleven measured enqueues of 2026-09-09 -----------------
  //
  // ⚠️ PROVENANCE, stated rather than implied: the carrier state at
  // `added_to_merge_queue` was read from each pull request's own event log by
  // the sibling's card (objectstack#17040 → PR objectstack#17484) and is CARRIED
  // here, not re-measured — `GET /repos/{o}/{r}/issues/{n}/events` is not
  // reachable from the seat that landed this. What WAS re-measured here, against
  // the live pull objects on 2026-09-11 and through the very field this leg
  // reads: objectui#8779 STILL carries `needs:contract-review` today, having
  // merged with it open (`carrier: true` below), and objectui#8164 carries no
  // such label (`carrier: false`).
  //
  // ⛔ objectui#8164 is the row that landed a real published-face defect, and it
  // is one of the SIX this leg does NOT catch. Reading it as a case that must
  // REFUSE inverts the boundary: the carrier was stripped a day before the
  // enqueue, so there is no label for a label reader to see. Making it refuse
  // would require reading the VERDICT, which is a strictly larger rule than the
  // one ruled and is deliberately not taken here.
  const INCIDENTS_9018 = [
    { pr: 8723, repo: 'objectui', carrier: true, note: 'enqueued 01:58:38Z, carrier stripped 02:11:28Z — after' },
    { pr: 16998, repo: 'objectstack', carrier: true, note: 'enqueued 02:02:08Z, carrier stripped 02:10:51Z — after' },
    { pr: 16783, repo: 'objectstack', carrier: true, note: 'enqueued 06:11:15Z, carrier NEVER stripped, merged carrying it' },
    { pr: 17036, repo: 'objectstack', carrier: true, note: 'enqueued 04:46:19Z, carrier NEVER stripped, merged carrying it' },
    { pr: 8779, repo: 'objectui', carrier: true, note: 'enqueued 06:26:20Z, carrier NEVER stripped — re-measured 2026-09-11: the label is STILL on it' },
    { pr: 17085, repo: 'objectstack', carrier: false, note: 'stripped 07:38:11Z, enqueued 07:39:41Z — 90s, no verdict on record' },
    { pr: 8795, repo: 'objectui', carrier: false, note: 'stripped 09:41:40Z, enqueued 09:42:27Z — 47s, PASS posted 6s after the strip' },
    { pr: 8796, repo: 'objectui', carrier: false, note: 'stripped 10:28:43Z, enqueued 10:28:53Z — 10s, verdict of record was CHANGES REQUIRED' },
    { pr: 17067, repo: 'objectstack', carrier: false, note: 'stripped 07:51:52Z, enqueued 11:42:45Z — newest verdict was FAIL' },
    { pr: 8799, repo: 'objectui', carrier: false, note: 'stripped 11:23:13Z, enqueued 11:23:24Z — 11s, no verdict on the new head' },
    { pr: 8164, repo: 'objectui', carrier: false, note: 'stripped 2026-09-08, enqueued 11:59:19Z — SELF-REVIEW, real defect landed, and this leg does NOT catch it' },
  ];
  for (const incident of INCIDENTS_9018) {
    const replay = await runCarrierGuard({
      event: EVENT_MERGE_GROUP,
      rows: [carrierRow(incident.pr)],
      fetchLabels: async () => (incident.carrier ? ['priority:p2', CONTRACT_REVIEW_LABEL] : ['priority:p2']),
    });
    const expected = incident.carrier ? EXIT_REFUSED_CARRIER : EXIT_CLEAR;
    assert(
      `replay-${incident.repo}#${incident.pr}-${incident.carrier ? 'REFUSED' : 'passes (the boundary)'}`,
      replay.exitCode === expected,
      `${incident.note} — expected ${expected}, got ${replay.exitCode}`,
    );
  }
  assert(
    'the-replay-population-splits-5-refused-6-passed-and-that-second-number-is-the-honest-limit',
    INCIDENTS_9018.filter((i) => i.carrier).length === 5 && INCIDENTS_9018.filter((i) => !i.carrier).length === 6,
    JSON.stringify(INCIDENTS_9018.map((i) => [i.pr, i.carrier])),
  );
  assert(
    'objectui-contributes-SIX-of-the-eleven-and-only-TWO-of-those-six-are-refused-by-this-leg',
    INCIDENTS_9018.filter((i) => i.repo === 'objectui').length === 6 &&
      INCIDENTS_9018.filter((i) => i.repo === 'objectui' && i.carrier).length === 2,
    JSON.stringify(INCIDENTS_9018.filter((i) => i.repo === 'objectui').map((i) => [i.pr, i.carrier])),
  );
  // ⭐ The whole group replayed as ONE merge group, which is what the queue
  // actually builds: eleven pull requests, five carriers open. A head-ref
  // implementation would read only the last (#8164, bare) and clear it.
  const wholeGroup = await runCarrierGuard({
    event: EVENT_MERGE_GROUP,
    rows: INCIDENTS_9018.map((i) => carrierRow(i.pr)),
    namedPull: INCIDENTS_9018[INCIDENTS_9018.length - 1].pr,
    fetchLabels: async (pull) =>
      INCIDENTS_9018.find((i) => i.pr === pull)?.carrier ? ['priority:p2', CONTRACT_REVIEW_LABEL] : ['priority:p2'],
  });
  assert(
    'all-eleven-as-ONE-group-is-REFUSED-although-the-queue-head-ref-names-a-BARE-pull-request',
    wholeGroup.exitCode === EXIT_REFUSED_CARRIER &&
      wholeGroup.apiCalls === 11 &&
      wholeGroup.entries.filter((entry) => entry.state === 'gated').length === 5,
    JSON.stringify({ exit: wholeGroup.exitCode, reads: wholeGroup.apiCalls }),
  );

  // -- the WIRING pins: the workflow and the required-context register --------
  //
  // Without these, renaming the job detaches the context this repository has
  // written down as blocking, and the name declared here becomes a name nothing
  // publishes. Read from disk on purpose: a constant asserting against itself
  // proves nothing.
  try {
    const wf = readFileSync(join(repoRoot, '.github', 'workflows', CHECK_WORKFLOW), 'utf8');
    assert('the-workflow-exists-and-declares-the-job-id-this-file-names', wf.includes(`\n  ${CHECK_JOB_ID}:\n`), CHECK_JOB_ID);
    assert('the-workflow-publishes-EXACTLY-the-context-name-this-file-declares', wf.includes(`name: ${CHECK_CONTEXT_NAME}\n`), CHECK_CONTEXT_NAME);
    assert('the-workflow-triggers-on-merge_group-the-leg-that-actually-refuses', /^ {2}merge_group:\s*$/m.test(wf), 'merge_group trigger absent');
    assert('the-workflow-triggers-on-pull_request-the-early-warning-leg', /^ {2}pull_request:\s*$/m.test(wf), 'pull_request trigger absent');
    // ⭐ `ready_for_review` is the addition that matters: flipping a governed
    // draft to ready is the first move of the exact sequence #6183 took, and it
    // is NOT in GitHub's default `types:` set. Naming `types:` REPLACES the
    // default set rather than extending it, so all four are restated.
    assert('the-workflow-re-fires-on-ready_for_review-the-first-move-of-the-incident', /types:\s*\[opened, synchronize, reopened, ready_for_review\]/.test(wf), 'ready_for_review absent from types');
    assert('the-workflow-invokes-THIS-script', wf.includes('scripts/check-governed-queue-guard.mjs'), 'invocation absent');
    assert('the-workflow-runs-the-self-test-before-the-live-judgment', wf.indexOf('--self-test') < wf.indexOf('GITHUB_TOKEN'), 'the self-test does not precede the live step');
    assert('the-workflow-checks-out-full-history-a-truncated-diff-answers-with-silence', /fetch-depth:\s*0/.test(wf), 'fetch-depth: 0 absent');
    assert('the-workflow-declares-pull-requests-read-the-only-scope-the-review-read-needs', /pull-requests:\s*read/.test(wf), 'pull-requests: read absent');
    // ⛔ A skipped job counts as SUCCESS in branch protection, so a path filter
    // would hand the queue a green verdict for a diff the filter mis-scoped —
    // on the one check whose entire job is to refuse. The path test belongs
    // INSIDE the script, where "nothing governed" costs zero API calls.
    assert('the-workflow-carries-no-paths-filter-a-skipped-guard-counts-as-SUCCESS', !/^\s*paths(-ignore)?:/m.test(wf), 'a paths filter would make this guard skippable');
  } catch (error) {
    assert('the-workflow-file-is-readable', false, String(error?.message ?? error).split('\n')[0]);
  }
  try {
    const gate = readFileSync(join(repoRoot, 'scripts', 'dependabot-merge-gate.mjs'), 'utf8');
    assert(
      'this-repository-has-written-the-context-down-as-blocking',
      gate.includes(`'${CHECK_CONTEXT_NAME}'`),
      `${CHECK_CONTEXT_NAME} is absent from scripts/dependabot-merge-gate.mjs — REQUIRED_CONTEXTS is this repo's own answer to "which checks are blocking", and a guard outside it is a guard the queue floor cannot derive`,
    );
  } catch (error) {
    assert('the-required-context-register-is-readable', false, String(error?.message ?? error).split('\n')[0]);
  }

  for (const f of failures) console.error(`  x ${f}`);
  if (failures.length > 0) {
    console.error(`FAIL check-governed-queue-guard self-test: ${failures.length} of ${checked} case(s) failed.`);
    return 1;
  }
  console.log(
    `OK check-governed-queue-guard self-test: ${checked} cases pass ` +
      '(the six ruled surfaces pinned in both directions including the widenings NOT taken, the queue/PR ' +
      'event split, latest-decisive approval reduction, the authorized-approval-record predicate on the queue ' +
      'leg per the 2026-09-04 ruling — counts on an OLDER commit, on no commit_id and on an unparsable one; ' +
      'never for an unauthorized, dismissed, superseded, non-decisive or absent review — with the PR leg ' +
      'still taking any approver, multi-PR group decomposition, four replayed governed shapes, the zero-API ' +
      'ordering guarantee measured with throwing spies, the retired head read measured ABSENT at one lookup ' +
      'per governed PR, the unreadable-review-list refusal, the seat-side --test predicate, the ruling-C ' +
      'landing narration (DRAFT, then an authorized approval, then the claiming seat lands it) pinned in the ' +
      '--test, refusal and early-warning texts with the pre-ruling-C wording pinned ABSENT, and the workflow ' +
      '+ required-context wiring pins), plus the SECOND queue predicate objectui#9018 added on the merge_group ' +
      'leg — the contract-review carrier, read from the pull object under the scope the review read already ' +
      'needs, its label a hand-kept mirror with ' +
      'this file proven to import nothing out of scripts/pm/, fail-closed on an unreadable label set, on a ' +
      'reading that never arrived and on a group naming no pull request, enumerated PER COMMIT so a bare ' +
      'pull request cannot carry a gated sibling through and the under-enumeration defect itself is replayed ' +
      'as a refusal, silent and read-free on the pull_request leg whose bytes are unchanged while the ' +
      'merge_group zero-cost clear is SCOPED because this leg took that promise away, an ACCEPTANCE case ' +
      'showing a three-PR group with no carrier anywhere clearing at exit 0 with every pull request actually ' +
      'read, and the eleven measured enqueues of 2026-09-09 replayed one by one and again as a single group ' +
      '— five refused, six passed, that second number being the boundary a label reader cannot cross and ' +
      'objectui#8164 being in it).',
  );
  return 0;
}

if (isEntrypoint(import.meta.url) && process.argv.includes('--self-test')) {
  process.exit(await selfTest());
}
