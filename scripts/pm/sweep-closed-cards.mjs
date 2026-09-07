#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sweep-closed-cards — the closed-card residue sweep (#16005).
 *
 *   node scripts/pm/sweep-closed-cards.mjs                  # DRY RUN: print the plan, write nothing
 *   node scripts/pm/sweep-closed-cards.mjs --write          # act: strip the labels, post one comment per card
 *   node scripts/pm/sweep-closed-cards.mjs --json           # the run summary as one JSON document
 *   node scripts/pm/sweep-closed-cards.mjs --self-test      # offline, no network at all
 *
 * ## What it removes, and what it never touches
 *
 * GitHub closes a card when a pull request carrying `Fixes #N` merges, and it
 * leaves every label in place. The pm loop's state labels are CLAIMS that work
 * is in flight, so on a card the platform has already closed on a merged
 * delivery they are stale claims — and the seat has been paying a hand round
 * trip per landing to remove them (the filing card measured eighteen identical
 * ones in a single objectui shift).
 *
 * The label set is `PM_RESIDUE_LABELS`, IMPORTED from `check-half-states.mjs`
 * rather than restated here: H22 owns that set, its docblock argues each
 * inclusion and each exclusion, and a second copy would be a second answer to
 * one question. ⛔ Never inline the list. Everything else on the card —
 * `domain:*`, `priority:*`, type, `finding`, `needs-user-decision`, `pm:seat`,
 * `pm:epic`, `pm:retriage` — is ownership or outcome, not a state claim, and is
 * left exactly as found.
 *
 * ## ⚖️ The two rulings this sweep sits between, and how it obeys both
 *
 * 1. Maintainer ruling, 2026-08-31, verbatim and untranslated, recorded in
 *    `check-half-states.mjs`'s H22 section: 「13605 已关卡 为什么要清理。普查时
 *    不应该只看open的卡片吗，其他同意」 — with the operative reason that closed
 *    cards are an archive, not a state, because every census, patrol, candidate
 *    and mutex query forces `state:open`. A BACKFILL over the accumulated stock
 *    (measured there: 2,063 closed cards carrying `pm:dispatched`, back to
 *    2026-08-02) is the write that ruling refused by name.
 * 2. The same ruling's item ③ KEPT close-time hygiene — strip the state label in
 *    the same stroke as the close — as the convention, at zero incremental cost.
 *    The dispatch ruling on #16005 mechanizes exactly that stroke, because the
 *    closing stroke is GitHub's and not the seat's, so "the same stroke" was
 *    never actually available to the seat that owes it.
 *
 * ⇒ So the ACTION SET is bounded to the FRESH EDGE by `--since-hours`
 * (`DEFAULT_WINDOW_HOURS`, twelve patrol runs of slack over the six-hourly
 * schedule). A card closed before the floor is counted and REPORTED, never
 * written and never even fetched. `--all-time` removes the floor and is the
 * deliberate, opt-in spelling of the refused backfill: it exists so a seat can
 * MEASURE the stock in dry run, and the workflow never passes it.
 *
 * ⛔ Do not "simplify" the window away. Without it the first scheduled run
 * would post roughly two thousand comments onto archived cards and perform
 * several thousand label writes — the refused backfill, executed four times a
 * day by a machine.
 *
 * ## The condition to act, and the two routes that establish it
 *
 * A card is stripped only when BOTH hold:
 *
 *   - `state_reason` is `completed` — `not_planned` and `duplicate` are
 *     outcomes that were never a delivery; and
 *   - its closing is a MERGED pull request, established by one of two routes.
 *
 * ROUTE A — the closing COMMIT. The timeline's last `closed` event carries
 * `commit_id` when GitHub closed the card from a commit message. That commit is
 * then confirmed to be contained in the repo's default branch.
 *
 * ROUTE B — the closing PULL REQUEST. On this board the seat usually closes the
 * card by hand seconds after the merge, so GitHub never performs the auto-close
 * and route A finds `commit_id: null` (measured 2026-09-05 over the eight most
 * recently closed `pm:dispatched` cards: eight of eight). Route B reads the
 * timeline's `cross-referenced` / `connected` events for pull requests whose
 * BODY carries a closing keyword bound to THIS card's number, and confirms the
 * pull request itself is merged into the default branch.
 *
 * ⚠️ Route B is deliberately narrower than "a merged PR that mentions this
 * card". A cross-reference is created by any mention, and stripping on that
 * relation would de-label cards a merged PR merely discussed. The relation used
 * is the one GitHub's own closer uses — a closing keyword bound to the number —
 * read through `closingKeywordTargets` so a body QUOTING the keyword in
 * backticks does not deliver. `Part of #N` is deliberately NOT accepted here:
 * it closes nothing, so it cannot be a closing.
 *
 * ⛔ A card with a delivering pull request that is still OPEN is LEFT, with a
 * row of its own. That is H8's refusal, one layer down and for its reason: a
 * card whose remaining half is in flight must not read as un-dispatched.
 *
 * A closed card that neither route can attribute to a merged pull request —
 * closed by hand with no delivery, `not_planned`, `duplicate` — is OUT. The
 * seat that closed it owes the strip; this sweep says so in its report and
 * writes nothing.
 *
 * ## Containment: the orientation of the compare, measured
 *
 * `GET /repos/{owner}/{repo}/compare/{base}...{head}` reports `status` for HEAD
 * relative to BASE, and getting the orientation backwards inverts the verdict
 * silently. Measured against this repo on 2026-09-05:
 *
 *   compare/main...{an older commit on main}  -> status `behind`,  ahead_by 0
 *   compare/{that same commit}...main         -> status `ahead`,   ahead_by 5
 *   compare/main...{an open PR's head}        -> status `ahead`,   ahead_by 3
 *   compare/main...{main's own tip}           -> status `identical`
 *
 * ⇒ This file asks `compare/{defaultBranch}...{sha}` and accepts `behind` or
 * `identical`, AND requires `ahead_by === 0` — the invariant those two statuses
 * encode (the head introduces no commit the branch lacks, i.e. it is an
 * ancestor). Two readings rather than one, because the statuses are a summary
 * and the count is the thing that decides.
 *
 * ## Exit codes
 *
 *   0  every judged card came out clean or stripped — INCLUDING a run that
 *      found nothing to do. Nothing-to-do is never an alarm.
 *   1  usage.
 *   2  at least one card is UNJUDGED: a REST read or write failed on it. The
 *      run reports which cards and why, and never skips one silently — an
 *      unjudged card is not a clean card (#4690).
 *   3  PREREQUISITE NOT MET, imported from `check-half-states.mjs`: the
 *      population read itself failed, so NO card was judged and this run says
 *      nothing at all about the board.
 *
 * ## Cost
 *
 * Per run: one default-branch read, one listing page per residue label (the
 * `since` filter keeps the windowed population to one page per label on a busy
 * board — measured 2026-09-05: 6 requests for 78 in-window cards), then two
 * reads per CANDIDATE card (its timeline, plus one compare or one pull-request
 * read). Writes add one DELETE per label removed, one label read-back and one
 * comment per stripped card. `--max-cards` caps the candidates a run will judge
 * and the cap is REPORTED whenever it binds.
 *
 * ## Adopting this in a sibling repo
 *
 * The workflow step that calls this file is gated on the repository name, so a
 * verbatim copy of `half-state-patrol.yml` in a sibling repo does not run it.
 * A sibling that wants it copies THIS file too and drops the gate — and needs
 * its own patrol anchor first (objectui#5986). Nothing here is repo-specific:
 * the board is `resolveSweepRepo`'s answer and the branch is the repo's own
 * default branch, read at runtime.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import {
  EXIT_PREREQUISITE_NOT_MET,
  PM_RESIDUE_LABELS,
  PROXY_FLAG,
  closingKeywordTargets,
  labelNames,
  proxyRearmPlan,
  resolveSweepRepo,
} from './check-half-states.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_UNJUDGED = 2;

/**
 * The re-exec guard, per script rather than shared with the sweeper: two
 * scripts sharing one guard name means the first one's re-exec silently
 * disarms the second's when they run in the same process tree.
 */
const PROXY_REARM_GUARD = 'OS_CLOSED_CARD_SWEEP_PROXY_REARMED';

/**
 * The action window, in hours. Six-hourly patrol, twelve runs of slack: a card
 * closed while the patrol was down for three days is still swept when it comes
 * back, and nothing older is ever written to.
 *
 * ⛔ Widening this is not a tuning decision — it is the boundary the
 * 2026-08-31 ruling draws between close-time hygiene (owed) and a backfill of
 * the archive (refused). The header states that in full.
 */
export const DEFAULT_WINDOW_HOURS = 72;

/** How many CANDIDATE cards one run will judge. Reported whenever it binds. */
export const DEFAULT_MAX_CARDS = 200;

/** The quota backstop on each label's listing — a ceiling that announces itself. */
export const LISTING_PAGE_CEILING = 10;

/** The machine-findable marker every comment this sweep posts carries. */
export const COMMENT_MARKER = 'os-closed-card-sweep';

/** The attribution footer every comment carries, in the comment-channel form. */
export const COMMENT_FOOTER = '_Generated by [Claude Code](https://claude.ai/code)_';

// ---------------------------------------------------------------------------
// Pure core — every function below is offline and is what `--self-test` pins.
// ---------------------------------------------------------------------------

/**
 * The residue labels this card actually carries, in `PM_RESIDUE_LABELS` order.
 * ⛔ The set is imported, never restated: H22 owns it.
 */
export function residueLabelsOn(issue) {
  const names = labelNames(issue);
  return PM_RESIDUE_LABELS.filter((label) => names.includes(label));
}

/** The labels that must survive the strip, so the read-back has something to compare against. */
export function survivingLabels(issue) {
  const residue = new Set(residueLabelsOn(issue));
  return labelNames(issue).filter((name) => !residue.has(name));
}

/**
 * The LAST `closed` event on the timeline. A card can be closed, reopened and
 * closed again; only the closing that is still in force can have closed it.
 */
export function lastClosedEvent(timeline) {
  let last = null;
  for (const event of timeline ?? []) if (event?.event === 'closed') last = event;
  return last;
}

/**
 * The pull requests whose bodies declare they CLOSE this card, read off the
 * timeline's cross-reference and connection events.
 *
 * ⚠️ The timeline's embedded pull-request payload carries no `head`, so the
 * branch-name channel `prDeliversCard` falls back to is unavailable here — and
 * that is correct for this question anyway: a branch name closes nothing. The
 * body is the only channel a closing can be read from, which is exactly the
 * channel GitHub's own closer reads.
 */
export function closingPullRequestRefs(timeline, number) {
  const target = String(number);
  const found = new Map();
  for (const event of timeline ?? []) {
    if (event?.event !== 'cross-referenced' && event?.event !== 'connected') continue;
    const src = event?.source?.issue;
    if (!src?.pull_request || typeof src.number !== 'number') continue;
    if (!closingKeywordTargets(src.body ?? '').has(target)) continue;
    found.set(src.number, {
      number: src.number,
      state: src.state ?? null,
      mergedAt: src.pull_request.merged_at ?? null,
      url: src.html_url ?? null,
    });
  }
  return [...found.values()].sort((a, b) => a.number - b.number);
}

/**
 * Is `sha` contained in the branch this compare was taken against? Pure over the
 * compare payload; the orientation and the two readings are argued in the header.
 */
export function commitIsContained(compare) {
  if (!compare || typeof compare !== 'object') return false;
  const status = compare.status;
  return (status === 'behind' || status === 'identical') && compare.ahead_by === 0;
}

/**
 * PHASE 1 — the offline screen. Decides whether a listed card is worth a
 * network read at all, so the cost model is visible in one function.
 *
 * @param {object} issue          a row from the closed listing
 * @param {{floorMs?: number|null}} [options]  `null` floor = `--all-time`
 */
export function screenCard(issue, { floorMs = null } = {}) {
  if (issue?.pull_request) return { verdict: 'skip', kind: 'pull-request' };
  if (issue?.state !== 'closed') return { verdict: 'skip', kind: 'open' };
  const residue = residueLabelsOn(issue);
  if (residue.length === 0) return { verdict: 'skip', kind: 'clean' };
  if (floorMs !== null) {
    const closedMs = Date.parse(issue?.closed_at ?? '');
    if (!Number.isFinite(closedMs)) {
      return { verdict: 'skip', kind: 'undateable', residue, detail: 'the card carries no readable `closed_at`, so the window cannot place it' };
    }
    if (closedMs < floorMs) {
      return { verdict: 'skip', kind: 'out-of-window', residue, detail: `closed ${issue.closed_at}, before the action floor` };
    }
  }
  if (issue?.state_reason !== 'completed') {
    return {
      verdict: 'leave',
      kind: 'not-completed',
      residue,
      detail: `\`state_reason\` is ${issue?.state_reason === null || issue?.state_reason === undefined ? 'unset' : `\`${issue.state_reason}\``}, so this close was never a delivery`,
    };
  }
  return { verdict: 'candidate', residue };
}

/**
 * PHASE 2 — the verdict, over evidence the live layer gathered. Pure: the
 * self-test drives every branch below with fixtures and no network.
 *
 * @param {object} issue
 * @param {object} evidence
 *   @param {string[]} evidence.residue
 *   @param {{sha: string, contained: boolean|null, status?: string, error?: string}|null} [evidence.closingCommit]
 *   @param {Array<{number: number, merged: boolean, baseRef: string|null, mergeCommitSha: string|null, state: string|null, error?: string}>} [evidence.closingPrs]
 * @param {{defaultBranch?: string}} [options]
 */
export function judgeCandidate(issue, evidence = {}, { defaultBranch = 'main' } = {}) {
  const residue = evidence.residue ?? residueLabelsOn(issue);
  const unreadable = [];
  const commit = evidence.closingCommit ?? null;
  const prs = evidence.closingPrs ?? [];

  if (commit?.error) unreadable.push(`the closing commit \`${String(commit.sha).slice(0, 10)}\` could not be placed: ${commit.error}`);
  for (const pr of prs) if (pr?.error) unreadable.push(`pull request #${pr.number} could not be read: ${pr.error}`);

  // H8's refusal, FIRST and ahead of both routes: a card with a delivery still
  // in flight has a state claim that is not stale, whatever else closed it.
  // Ordering is the whole safety property here — a route that answered before
  // this test would strip the one card class this file must never strip.
  const openDeliveries = prs.filter((pr) => !pr.error && !pr.merged);
  const mergedDeliveries = prs.filter((pr) => !pr.error && pr.merged);
  if (openDeliveries.length > 0) {
    return {
      verdict: 'leave',
      kind: 'open-delivery',
      residue,
      detail:
        `a pull request that declares it closes this card is not merged (${openDeliveries.map((p) => `#${p.number}`).join(', ')}) — ` +
        'the state claim is not stale while a delivery is in flight',
      unreadable,
    };
  }

  // ROUTE A — the closing commit, contained in the default branch.
  if (commit && commit.contained === true) {
    return {
      verdict: 'strip',
      route: 'commit',
      residue,
      evidence: {
        commit: commit.sha,
        containment: `contained in \`${defaultBranch}\` (compare status \`${commit.status ?? 'unknown'}\`)`,
        branch: defaultBranch,
        prs: mergedDeliveries.map((p) => p.number),
      },
      unreadable,
    };
  }

  // A commit that is READABLE and NOT contained is a finding of its own: the
  // close happened on something that never reached the branch this repo ships.
  const commitOffBranch = commit && commit.contained === false;

  // ROUTE B — a merged closing pull request, confirmed into the default branch.
  // ⛔ `baseRef` must be READ, never assumed: an unfetched ref carries `null`,
  // and accepting `null` here would strip on a merge whose base nobody looked at.
  const onBranch = mergedDeliveries.filter((pr) => pr.fetched === true && pr.baseRef === defaultBranch);
  if (onBranch.length > 0) {
    return {
      verdict: 'strip',
      route: 'pull-request',
      residue,
      evidence: {
        commit: onBranch.find((p) => p.mergeCommitSha)?.mergeCommitSha ?? null,
        containment: `merged into \`${defaultBranch}\``,
        branch: defaultBranch,
        prs: onBranch.map((p) => p.number),
      },
      unreadable,
    };
  }

  if (unreadable.length > 0) {
    return { verdict: 'unjudged', residue, detail: unreadable.join('; ') };
  }
  if (mergedDeliveries.length > 0) {
    return {
      verdict: 'leave',
      kind: 'merged-elsewhere',
      residue,
      detail: `every closing pull request merged into a branch other than \`${defaultBranch}\` (${mergedDeliveries.map((p) => `#${p.number} into \`${p.baseRef}\``).join(', ')})`,
    };
  }
  if (commitOffBranch) {
    return {
      verdict: 'leave',
      kind: 'commit-off-branch',
      residue,
      detail: `the closing commit \`${String(commit.sha).slice(0, 10)}\` is not contained in \`${defaultBranch}\` (compare status \`${commit.status ?? 'unknown'}\`)`,
    };
  }
  return {
    verdict: 'leave',
    kind: 'no-closing-delivery',
    residue,
    detail:
      'closed with no merged pull request declaring it closes this card — closed by hand, and the seat that closed it owes the strip',
  };
}

/**
 * The comment one stripped card gets. Pure, so its every property is pinned
 * offline — this text is a write onto someone else's card.
 *
 * ⛔ No angle-bracket-shaped fragment goes in here: GitHub's body sanitizer
 * eats short ones, backticked or not, and a comment that loses its middle is a
 * machine posting nonsense onto a card nobody asked it to touch.
 */
export function strippedComment({ removed, survived, evidence, provenance = '' }) {
  const lines = [
    `${COMMENT_MARKER} — machine-findable marker for this generated comment.`,
    '',
    `Removed the pm-loop state label(s) this closed card no longer claims: ${removed.map((l) => `\`${l}\``).join(', ')}.`,
    '',
  ];
  if (evidence?.prs?.length) {
    lines.push(`- Closing pull request: ${evidence.prs.map((n) => `#${n}`).join(', ')}, merged.`);
  }
  if (evidence?.commit) {
    lines.push(`- Closing commit \`${String(evidence.commit).slice(0, 10)}\`, ${evidence.containment}.`);
  } else {
    lines.push(`- Containment: ${evidence?.containment ?? 'unknown'}.`);
  }
  lines.push(
    survived.length > 0
      ? `- Left untouched: ${survived.map((l) => `\`${l}\``).join(', ')} — ownership, priority and outcome are not state claims.`
      : '- No other label was on the card.',
    '- The label set was read back after the write and matched.',
    '',
    'A state label claims work is in flight. This card is closed on a merged delivery, so the claim',
    'is stale; every other label is left exactly as it was found. Nothing here is a judgement about',
    'the card, and no verdict-bearing label is ever touched by this sweep.',
    '',
  );
  if (provenance) lines.push(`_${provenance}_`, '');
  lines.push(COMMENT_FOOTER);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The listing, the window and the caps — path builders kept pure and pinned.
// ---------------------------------------------------------------------------

/**
 * One page of the closed cards carrying ONE residue label.
 *
 * ⚠️ One label per request, unioned locally afterwards: the listing endpoint's
 * `labels` filter is an AND across the names it is given, so a six-label query
 * answers a question nobody asked and answers it empty.
 *
 * `since` filters on `updated_at`, which for a closed card is at or after its
 * `closed_at` — so every card closed inside the window is returned, and the
 * exact `closed_at` test happens locally. That over-approximation is the point:
 * a filter that could drop an in-window card would make a short read look like
 * a clean board.
 */
export function closedListingPath(repo, label, page, sinceIso = null) {
  const query = [
    'state=closed',
    `labels=${encodeURIComponent(label)}`,
    ...(sinceIso ? [`since=${encodeURIComponent(sinceIso)}`, 'sort=updated', 'direction=desc'] : []),
    'per_page=100',
    `page=${page}`,
  ].join('&');
  return `/repos/${repo}/issues?${query}`;
}

/** The action floor, or `null` for `--all-time`. */
export function actionFloorMs(nowMs, windowHours) {
  return windowHours === null ? null : nowMs - windowHours * 3_600_000;
}

/**
 * The run's counts and its exit code, from the judged rows alone — so the exit
 * register is pinned offline and cannot drift from what the report printed.
 *
 * ⛔ `nothing to do` is exit 0, always. A sweep that finds a clean board and a
 * sweep that finds nothing in its window are both successful runs; only an
 * UNJUDGED card moves the code, because that is the one outcome where the run
 * does not know what it was looking at.
 */
export function summariseRun(rows) {
  const counts = { strip: 0, leave: 0, unjudged: 0, skipped: 0, failed: 0 };
  for (const row of rows ?? []) {
    if (row.verdict === 'strip') counts.strip += 1;
    else if (row.verdict === 'leave') counts.leave += 1;
    else if (row.verdict === 'unjudged') counts.unjudged += 1;
    else counts.skipped += 1;
    if (row.writeFailed) counts.failed += 1;
  }
  const exitCode = counts.unjudged > 0 || counts.failed > 0 ? EXIT_UNJUDGED : EXIT_OK;
  return { counts, exitCode };
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

async function rest(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/** The board's own default branch — never a hardcoded `main`, so the file stays repo-agnostic. */
async function readDefaultBranch(repo) {
  const meta = await rest(`/repos/${repo}`);
  return meta?.default_branch ?? 'main';
}

async function listClosedCardsWithResidue(repo, { sinceIso, stats }) {
  const byNumber = new Map();
  for (const label of PM_RESIDUE_LABELS) {
    let exhausted = false;
    let page = 1;
    for (; page <= LISTING_PAGE_CEILING; page++) {
      const batch = await rest(closedListingPath(repo, label, page, sinceIso));
      stats.listingRequests += 1;
      for (const row of Array.isArray(batch) ? batch : []) {
        if (!row?.pull_request) byNumber.set(row.number, row);
      }
      if (!Array.isArray(batch) || batch.length < 100) {
        exhausted = true;
        break;
      }
    }
    if (!exhausted) stats.truncatedLabels.push(label);
  }
  return [...byNumber.values()];
}

/** How many pull requests one card's evidence pass will read. Beyond it the card is UNJUDGED, never guessed. */
export const PR_READS_PER_CARD = 5;

async function gatherEvidence(repo, card, defaultBranch, stats) {
  const evidence = { residue: residueLabelsOn(card), closingCommit: null, closingPrs: [] };
  const timeline = await rest(`/repos/${repo}/issues/${card.number}/timeline?per_page=100`);
  stats.evidenceRequests += 1;

  const closed = lastClosedEvent(timeline);
  if (closed?.commit_id) {
    try {
      const compare = await rest(`/repos/${repo}/compare/${defaultBranch}...${closed.commit_id}`);
      stats.evidenceRequests += 1;
      evidence.closingCommit = { sha: closed.commit_id, contained: commitIsContained(compare), status: compare?.status ?? null };
    } catch (err) {
      evidence.closingCommit = { sha: closed.commit_id, contained: null, error: err.message };
    }
  }

  const refs = closingPullRequestRefs(timeline, card.number);
  // Route A already answered the question the pull-request read exists to
  // answer, so it is not taken. The refs still ride along: an OPEN delivery is
  // readable from the timeline payload alone and is what H8's refusal turns on.
  const commitSettles = evidence.closingCommit?.contained === true;
  let reads = 0;
  for (const ref of refs) {
    const merged = Boolean(ref.mergedAt);
    if (!merged || commitSettles) {
      evidence.closingPrs.push({ number: ref.number, merged, baseRef: null, mergeCommitSha: null, state: ref.state, fetched: false });
      continue;
    }
    if (reads >= PR_READS_PER_CARD) {
      evidence.closingPrs.push({
        number: ref.number,
        merged: true,
        baseRef: null,
        mergeCommitSha: null,
        state: ref.state,
        fetched: false,
        error: `not read — this card declares more than ${PR_READS_PER_CARD} closing pull requests`,
      });
      continue;
    }
    try {
      const pr = await rest(`/repos/${repo}/pulls/${ref.number}`);
      stats.evidenceRequests += 1;
      reads += 1;
      evidence.closingPrs.push({
        number: ref.number,
        merged: pr?.merged === true,
        baseRef: pr?.base?.ref ?? null,
        mergeCommitSha: pr?.merge_commit_sha ?? null,
        state: pr?.state ?? null,
        fetched: true,
      });
    } catch (err) {
      evidence.closingPrs.push({ number: ref.number, merged: true, baseRef: null, mergeCommitSha: null, state: ref.state, fetched: false, error: err.message });
    }
  }
  return evidence;
}

/**
 * The write: one DELETE per label, then a comparison read-back, then one comment.
 *
 * The endpoint is ADDITIVE by construction — `DELETE /issues/{n}/labels/{name}`
 * names exactly one label and cannot rewrite the set, so a label another actor
 * adds mid-run survives. The read-back is what turns that into a reading: it
 * proves the residue really went, and it NAMES a label that vanished without
 * this sweep touching it.
 *
 * ⛔ A label that disappeared underneath us is REPORTED, never re-attached.
 * Re-adding it would be this sweep overruling another actor's deliberate write
 * on a card it was only ever cleared to subtract state claims from.
 */
async function stripCard(repo, card, residue, { provenance, evidence }) {
  const expectedSurvivors = survivingLabels(card);
  const removed = [];
  for (const label of residue) {
    await rest(`/repos/${repo}/issues/${card.number}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' });
    removed.push(label);
  }
  const after = await rest(`/repos/${repo}/issues/${card.number}/labels?per_page=100`);
  const afterNames = (Array.isArray(after) ? after : []).map((l) => l?.name).filter(Boolean);
  const stillResidue = residue.filter((label) => afterNames.includes(label));
  const vanished = expectedSurvivors.filter((label) => !afterNames.includes(label));
  if (stillResidue.length > 0) {
    return { removed, afterNames, vanished, failure: `the read-back still shows ${stillResidue.map((l) => `\`${l}\``).join(', ')} — the removal did not land` };
  }
  await rest(`/repos/${repo}/issues/${card.number}/comments`, {
    method: 'POST',
    body: {
      body: strippedComment({
        removed,
        survived: afterNames,
        evidence,
        provenance,
      }),
    },
  });
  return { removed, afterNames, vanished, failure: null };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function row(card, verdict, extra = {}) {
  return {
    number: card.number,
    title: card.title ?? '',
    url: card.html_url ?? null,
    closed_at: card.closed_at ?? null,
    verdict,
    kind: null,
    residue: [],
    detail: null,
    removed: [],
    vanished: [],
    writeFailed: false,
    ...extra,
  };
}

async function sweep(repo, options) {
  const stats = { listingRequests: 0, evidenceRequests: 0, writeRequests: 0, truncatedLabels: [] };
  const defaultBranch = await readDefaultBranch(repo);
  stats.listingRequests += 1;

  const floorMs = actionFloorMs(options.nowMs, options.windowHours);
  const sinceIso = floorMs === null ? null : new Date(floorMs).toISOString();
  const listed = await listClosedCardsWithResidue(repo, { sinceIso, stats });

  const rows = [];
  const candidates = [];
  for (const card of listed) {
    const screen = screenCard(card, { floorMs });
    if (screen.verdict === 'candidate') {
      candidates.push({ card, residue: screen.residue });
      continue;
    }
    rows.push(row(card, screen.verdict, { kind: screen.kind, residue: screen.residue ?? [], detail: screen.detail ?? null }));
  }

  // Freshest first, so a bound cap defers the OLDEST candidates — the ones the
  // next run will still find, rather than the ones a seat is waiting on.
  candidates.sort((a, b) => (Date.parse(b.card.closed_at ?? '') || 0) - (Date.parse(a.card.closed_at ?? '') || 0));
  const judging = candidates.slice(0, options.maxCards);
  const deferred = candidates.slice(options.maxCards);
  for (const { card, residue } of deferred) {
    rows.push(row(card, 'skip', {
      kind: 'cap-deferred',
      residue,
      detail: `beyond this run's cap of ${options.maxCards} candidate cards — NOT judged, and the next run will see it again`,
    }));
  }

  for (const { card, residue } of judging) {
    let evidence;
    try {
      evidence = await gatherEvidence(repo, card, defaultBranch, stats);
    } catch (err) {
      rows.push(row(card, 'unjudged', { residue, detail: `the evidence pass failed: ${err.message}` }));
      continue;
    }
    const judged = judgeCandidate(card, evidence, { defaultBranch });
    const out = row(card, judged.verdict, {
      kind: judged.kind ?? judged.route ?? null,
      residue: judged.residue,
      detail: judged.detail ?? null,
      evidence: judged.evidence ?? null,
    });
    if (judged.unreadable?.length) {
      out.detail = [out.detail, `partial reads: ${judged.unreadable.join('; ')}`].filter(Boolean).join(' · ');
    }
    if (judged.verdict === 'strip' && options.write) {
      try {
        const written = await stripCard(repo, card, judged.residue, { provenance: options.provenance, evidence: judged.evidence });
        stats.writeRequests += judged.residue.length + 2;
        out.removed = written.removed;
        out.vanished = written.vanished;
        if (written.failure) {
          out.writeFailed = true;
          out.detail = written.failure;
        }
      } catch (err) {
        out.writeFailed = true;
        out.detail = `the write failed: ${err.message}`;
      }
    }
    rows.push(out);
  }

  return { repo, defaultBranch, sinceIso, rows, stats, listed: listed.length, candidates: candidates.length };
}

function countKinds(rows, verdict) {
  const out = new Map();
  for (const r of rows) {
    if (r.verdict !== verdict) continue;
    out.set(r.kind ?? 'other', (out.get(r.kind ?? 'other') ?? 0) + 1);
  }
  return [...out.entries()].map(([kind, n]) => `${n} ${kind}`).join(' · ') || 'none';
}

export function renderRun(result, options) {
  const { counts, exitCode } = summariseRun(result.rows);
  const mode = options.write ? 'WRITE' : 'DRY RUN — nothing was written';
  const window = result.sinceIso
    ? `cards closed since ${result.sinceIso} (${options.windowHours}h)`
    : 'ALL TIME — the window is off, and this is the shape the 2026-08-31 ruling refuses as a WRITE';
  const lines = [
    `closed-card sweep — ${result.repo} · ${mode}`,
    `  window: ${window}`,
    `  residue labels (imported from check-half-states.mjs): ${PM_RESIDUE_LABELS.join(', ')}`,
    `  default branch: ${result.defaultBranch}`,
    `  listed: ${result.listed} closed card(s) carrying residue · candidates: ${result.candidates}`,
    `  requests: ${result.stats.listingRequests} listing · ${result.stats.evidenceRequests} evidence · ${result.stats.writeRequests} write`,
    `  verdicts: ${counts.strip} strip · ${counts.leave} leave · ${counts.unjudged} unjudged · ${counts.skipped} not judged`,
    `  not judged, by reason: ${countKinds(result.rows, 'skip')}`,
    `  left, by reason: ${countKinds(result.rows, 'leave')}`,
  ];
  if (result.stats.truncatedLabels.length > 0) {
    lines.push(
      `  ⚠️  the page ceiling (${LISTING_PAGE_CEILING}) BOUND the listing for ${result.stats.truncatedLabels.join(', ')} —`,
      '      that population was read short, so this run is not a complete inventory of it.',
    );
  }
  const capDeferred = result.rows.filter((r) => r.kind === 'cap-deferred').length;
  if (capDeferred > 0) {
    lines.push(`  ⚠️  the per-run cap (${options.maxCards}) BOUND this run: ${capDeferred} candidate(s) were NOT judged.`);
  }

  const section = (title, rows) => {
    if (rows.length === 0) return;
    lines.push('', `${title} (${rows.length})`);
    for (const r of rows.slice(0, options.listCap)) {
      const labels = r.residue.length ? r.residue.join(',') : '-';
      const tail = r.detail ? ` — ${r.detail}` : r.evidence ? ` — ${r.evidence.prs?.length ? `closing PR ${r.evidence.prs.map((n) => `#${n}`).join(', ')}, ` : ''}${r.evidence.commit ? `commit \`${String(r.evidence.commit).slice(0, 10)}\`, ` : ''}${r.evidence.containment}` : '';
      lines.push(`  #${r.number}  [${labels}]${tail}`);
    }
    if (rows.length > options.listCap) lines.push(`  … and ${rows.length - options.listCap} more (list capped for readability, not for judgement)`);
  };

  section('STRIP', result.rows.filter((r) => r.verdict === 'strip'));
  section('LEFT', result.rows.filter((r) => r.verdict === 'leave'));
  section('UNJUDGED — these cards were NOT read as clean', result.rows.filter((r) => r.verdict === 'unjudged' || r.writeFailed));

  lines.push(
    '',
    counts.unjudged + counts.failed > 0
      ? `⚠️  ${counts.unjudged + counts.failed} card(s) unjudged. An unjudged card is not a clean card; exit ${EXIT_UNJUDGED}.`
      : `✓ every judged card came out clean or stripped; exit ${EXIT_OK}.`,
  );
  return { text: lines.join('\n'), exitCode };
}

export function renderJson(result, options) {
  const { counts, exitCode } = summariseRun(result.rows);
  return {
    tool: 'sweep-closed-cards',
    repo: result.repo,
    mode: options.write ? 'write' : 'dry-run',
    default_branch: result.defaultBranch,
    window_hours: options.windowHours,
    since: result.sinceIso,
    residue_labels: PM_RESIDUE_LABELS,
    listed: result.listed,
    candidates: result.candidates,
    cap: options.maxCards,
    cap_bound: result.rows.some((r) => r.kind === 'cap-deferred'),
    page_ceiling_bound: result.stats.truncatedLabels,
    requests: result.stats,
    counts,
    exit_code: exitCode,
    cards: result.rows.map((r) => ({
      number: r.number,
      verdict: r.verdict,
      kind: r.kind,
      residue: r.residue,
      removed: r.removed,
      vanished: r.vanished,
      detail: r.detail,
      evidence: r.evidence ?? null,
      url: r.url,
    })),
  };
}

/**
 * The refusal printer. Its load-bearing half is the last paragraph: a run that
 * could not read the board must never be legible as a run that found a clean
 * one (#4690) — and on a report-only sweep that risk is sharper than on a gate.
 */
function reportPrerequisiteNotMet(err, { swept = 0 } = {}) {
  console.error(
    `\nsweep-closed-cards: PREREQUISITE NOT MET — ${err.message}\n\n` +
      `  Fix:  run this where node's fetch reaches api.github.com with a token that can read issues\n` +
      `        (a GitHub Actions runner, or an agent container with ${PROXY_FLAG} — this script re-execs\n` +
      `        itself with that flag when HTTPS_PROXY is set).\n\n` +
      (swept === 0
        ? '  NOTHING WAS SWEPT: no card was listed and no card was judged, so this run says nothing\n' +
          '  about whether the board carries residue. It is not a clean board and it is not a dirty\n' +
          '  one — it is no reading at all.\n'
        : `  NOTHING FURTHER WAS JUDGED: the transport failed after ${swept} card(s) had been listed.\n` +
          '  An empty strip list here is not a clean board.\n') +
      `\n  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from ${EXIT_UNJUDGED}'s "read the board, could not judge a card".\n` +
      '  Capture it BEFORE any pipe: `node scripts/pm/sweep-closed-cards.mjs > /tmp/sweep.log 2>&1; echo "EXIT=$?"`.)',
  );
  return EXIT_PREREQUISITE_NOT_MET;
}

// ---------------------------------------------------------------------------
// --self-test — offline, no network, every branch above driven by fixtures.
//
// The battery ledger this self-test's floor is evaluated against: `battery()`
// opens one, every assertion is attributed to the one most recently opened, and
// a section that stops running names ITSELF at the floor rather than going
// quiet. The counts are a FLOOR, never an equality — adding cases is ordinary
// work and must not go red.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the residue set is imported from H22, never restated': 6,
  'the offline screen: which cards cost a network read': 11,
  'the closing evidence readers: commit, pull requests, containment': 14,
  'the verdict: every case the ruling names': 14,
  'the comment a machine writes on someone else\'s card': 9,
  'the listing path, the window and the caps': 10,
  'the exit register: nothing to do is never an alarm': 7,
  'the report: what a reader is told, and what it refuses to imply': 7,
  'the CLI: the one decision a typo must never make': 8,
});
const SELF_TEST_BATTERY_FLOOR = 9;
const UNATTRIBUTED_BATTERY = '(unattributed)';

let selfTestReachedVerdict = false;

export function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => { openBattery = name; };
  const cases = [];
  const t = (name, ok, detail) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    cases.push({ name, ok: Boolean(ok), detail });
  };

  const CARD = (over = {}) => ({
    number: 100,
    title: 'a card',
    state: 'closed',
    state_reason: 'completed',
    closed_at: '2026-09-05T12:00:00Z',
    html_url: 'https://github.com/o/r/issues/100',
    labels: [{ name: 'pm:dispatched' }, { name: 'domain:skills' }, { name: 'priority:p3' }],
    ...over,
  });
  const XREF = (number, body, mergedAt, state = 'closed') => ({
    event: 'cross-referenced',
    source: { type: 'issue', issue: { number, body, state, pull_request: { merged_at: mergedAt }, html_url: `https://github.com/o/r/pull/${number}` } },
  });
  const CLOSED_EVENT = (commitId = null) => ({ event: 'closed', commit_id: commitId, created_at: '2026-09-05T12:00:00Z' });
  const NOW = Date.parse('2026-09-05T18:00:00Z');
  const FLOOR = actionFloorMs(NOW, DEFAULT_WINDOW_HOURS);

  // -- the residue set is imported from H22, never restated ------------------
  battery('the residue set is imported from H22, never restated');
  t('the set this file acts on IS H22\'s exported constant', PM_RESIDUE_LABELS.includes('pm:dispatched') && PM_RESIDUE_LABELS.includes('pm:queue'));
  t('⛔ and this file declares no second copy of it — a restated set is a second answer to one question',
    !/(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*\[\s*(?:\/\/[^\n]*\n\s*)?'pm:(?:dispatched|queue)'/.test(readFileSync(SELF_PATH, 'utf8')));
  t('residue is read off the card in the imported set\'s order', residueLabelsOn(CARD({ labels: [{ name: 'pm:queue' }, { name: 'pm:dispatched' }] })).join() === 'pm:dispatched,pm:queue');
  t('a card carrying none reads empty', residueLabelsOn(CARD({ labels: [{ name: 'domain:skills' }] })).length === 0);
  // The ruling's third fixture: the decision inbox is an OUTCOME, not a state claim.
  t('`needs-user-decision` beside `pm:dispatched`: only the state claim is residue',
    residueLabelsOn(CARD({ labels: [{ name: 'needs-user-decision' }, { name: 'pm:dispatched' }] })).join() === 'pm:dispatched');
  t('…and everything else is what the strip must leave behind',
    survivingLabels(CARD({ labels: [{ name: 'needs-user-decision' }, { name: 'pm:dispatched' }] })).join() === 'needs-user-decision');

  // -- the offline screen ----------------------------------------------------
  battery('the offline screen: which cards cost a network read');
  t('an OPEN card carrying residue is never touched, whatever else is true of it', screenCard(CARD({ state: 'open' }), { floorMs: FLOOR }).kind === 'open');
  t('…and it is skipped, not left — a left card is one this sweep judged', screenCard(CARD({ state: 'open' }), { floorMs: FLOOR }).verdict === 'skip');
  t('a closed card with no residue is clean, and costs no read', screenCard(CARD({ labels: [{ name: 'domain:skills' }] }), { floorMs: FLOOR }).kind === 'clean');
  t('the IDEMPOTENCE case: the same card re-screened after its strip reads clean', screenCard(CARD({ labels: [{ name: 'domain:skills' }, { name: 'priority:p3' }] }), { floorMs: FLOOR }).kind === 'clean');
  t('a card closed before the action floor is out of window', screenCard(CARD({ closed_at: '2026-08-02T00:00:00Z' }), { floorMs: FLOOR }).kind === 'out-of-window');
  t('…and `--all-time` puts that same archived card back in play', screenCard(CARD({ closed_at: '2026-08-02T00:00:00Z' }), { floorMs: null }).verdict === 'candidate');
  t('a card closed inside the window with residue is a candidate', screenCard(CARD(), { floorMs: FLOOR }).verdict === 'candidate');
  t('`not_planned` is LEFT and reported, never stripped', screenCard(CARD({ state_reason: 'not_planned' }), { floorMs: FLOOR }).kind === 'not-completed');
  t('`duplicate` likewise', screenCard(CARD({ state_reason: 'duplicate' }), { floorMs: FLOOR }).kind === 'not-completed');
  t('an unreadable `closed_at` is skipped as undateable, never assumed fresh', screenCard(CARD({ closed_at: null }), { floorMs: FLOOR }).kind === 'undateable');
  t('a pull request row that slipped into the listing is not a card', screenCard(CARD({ pull_request: {} }), { floorMs: FLOOR }).kind === 'pull-request');

  // -- the closing evidence readers -----------------------------------------
  battery('the closing evidence readers: commit, pull requests, containment');
  t('the LAST closed event wins — a card can be closed, reopened and closed again',
    lastClosedEvent([CLOSED_EVENT('aaa'), { event: 'reopened' }, CLOSED_EVENT('bbb')])?.commit_id === 'bbb');
  t('no closed event reads null, not a guess', lastClosedEvent([{ event: 'labeled' }]) === null);
  t('a merged PR whose body closes this card is a closing reference', closingPullRequestRefs([XREF(200, 'Fixes #100', '2026-09-05T11:00:00Z')], 100).length === 1);
  t('…and its merge is carried through from the timeline payload', closingPullRequestRefs([XREF(200, 'Fixes #100', '2026-09-05T11:00:00Z')], 100)[0].mergedAt !== null);
  t('⛔ a PR that merely MENTIONS the card is not a closing — a cross-reference is any mention', closingPullRequestRefs([XREF(200, 'see #100 for context', '2026-09-05T11:00:00Z')], 100).length === 0);
  t('⛔ `Part of #100` closes nothing, so it is not a closing either', closingPullRequestRefs([XREF(200, 'Part of #100', '2026-09-05T11:00:00Z')], 100).length === 0);
  t('⛔ a body QUOTING the keyword in backticks does not deliver', closingPullRequestRefs([XREF(200, 'the body says `Fixes #100` in a code span', '2026-09-05T11:00:00Z')], 100).length === 0);
  t('a closing keyword bound to a DIFFERENT card is not this card\'s closing', closingPullRequestRefs([XREF(200, 'Fixes #101', '2026-09-05T11:00:00Z')], 100).length === 0);
  t('a cross-reference from an ISSUE, not a pull request, is ignored', closingPullRequestRefs([{ event: 'cross-referenced', source: { issue: { number: 300, body: 'Fixes #100' } } }], 100).length === 0);
  t('two events naming one pull request yield one reference', closingPullRequestRefs([XREF(200, 'Fixes #100', null), XREF(200, 'Fixes #100', null)], 100).length === 1);
  t('containment: `behind` with no commits ahead is contained', commitIsContained({ status: 'behind', ahead_by: 0 }) === true);
  t('containment: `identical` is contained', commitIsContained({ status: 'identical', ahead_by: 0 }) === true);
  t('⛔ `ahead` is NOT contained — the orientation is measured in this file\'s header', commitIsContained({ status: 'ahead', ahead_by: 3 }) === false);
  t('⛔ nor is a `behind` that still carries commits the branch lacks', commitIsContained({ status: 'behind', ahead_by: 2 }) === false);

  // -- the verdict -----------------------------------------------------------
  battery('the verdict: every case the ruling names');
  const mergedPr = { number: 200, merged: true, baseRef: 'main', mergeCommitSha: 'abc1234567', state: 'closed', fetched: true };
  const stripByPr = judgeCandidate(CARD(), { residue: ['pm:dispatched'], closingPrs: [mergedPr] }, { defaultBranch: 'main' });
  t('a card closed by a merged `Fixes` pull request is STRIPPED', stripByPr.verdict === 'strip');
  t('…by the pull-request route, and the route is named in the row', stripByPr.route === 'pull-request');
  t('…and only the residue labels are removed', stripByPr.residue.join() === 'pm:dispatched');
  t('…and the evidence names the pull request the strip rests on', stripByPr.evidence.prs.join() === '200');
  const byCommit = judgeCandidate(CARD(), { residue: ['pm:dispatched'], closingCommit: { sha: 'deadbeef00', contained: true, status: 'behind' } }, { defaultBranch: 'main' });
  t('a card closed by a commit contained in the default branch is STRIPPED', byCommit.verdict === 'strip' && byCommit.route === 'commit');
  const byHand = judgeCandidate(CARD(), { residue: ['pm:dispatched'], closingPrs: [] }, { defaultBranch: 'main' });
  t('a card closed BY HAND is left, and the row says the closing seat owes the strip', byHand.verdict === 'leave' && byHand.kind === 'no-closing-delivery');
  const offBranch = judgeCandidate(CARD(), { residue: ['pm:dispatched'], closingCommit: { sha: 'deadbeef00', contained: false, status: 'diverged' } }, { defaultBranch: 'main' });
  t('a closing commit that never reached the default branch is LEFT and reported', offBranch.verdict === 'leave' && offBranch.kind === 'commit-off-branch');
  const openDelivery = judgeCandidate(CARD(), { residue: ['pm:dispatched'], closingPrs: [{ number: 201, merged: false, baseRef: null, mergeCommitSha: null, state: 'open', fetched: false }] }, { defaultBranch: 'main' });
  t('⛔ a card whose delivery is still OPEN is left — H8\'s refusal, one layer down', openDelivery.verdict === 'leave' && openDelivery.kind === 'open-delivery');
  t('…and that refusal outranks BOTH routes, even a contained closing commit',
    judgeCandidate(CARD(), { residue: ['pm:dispatched'], closingCommit: { sha: 'deadbeef00', contained: true, status: 'behind' }, closingPrs: [{ number: 201, merged: false, baseRef: null, state: 'open', fetched: false }] }, { defaultBranch: 'main' }).kind === 'open-delivery');
  t('a pull request merged into some OTHER branch does not close the card here',
    judgeCandidate(CARD(), { residue: ['pm:dispatched'], closingPrs: [{ ...mergedPr, baseRef: 'release/v5' }] }, { defaultBranch: 'main' }).kind === 'merged-elsewhere');
  t('⛔ an UNFETCHED base is never accepted as the default branch',
    judgeCandidate(CARD(), { residue: ['pm:dispatched'], closingPrs: [{ ...mergedPr, baseRef: null, fetched: false }] }, { defaultBranch: 'main' }).verdict === 'leave');
  const unreadable = judgeCandidate(CARD(), { residue: ['pm:dispatched'], closingPrs: [{ number: 202, merged: true, baseRef: null, mergeCommitSha: null, state: 'closed', fetched: false, error: 'HTTP 502' }] }, { defaultBranch: 'main' });
  t('a card whose evidence could not be read is UNJUDGED, never silently skipped', unreadable.verdict === 'unjudged');
  t('…and the row carries why, so the next run\'s reader can act on it', String(unreadable.detail).includes('502'));
  t('a card carrying two residue labels has both in the strip set',
    judgeCandidate(CARD({ labels: [{ name: 'pm:dispatched' }, { name: 'pm:queue' }] }), { closingPrs: [mergedPr] }, { defaultBranch: 'main' }).residue.join() === 'pm:dispatched,pm:queue');

  // -- the comment -----------------------------------------------------------
  battery('the comment a machine writes on someone else\'s card');
  const comment = strippedComment({
    removed: ['pm:dispatched'],
    survived: ['domain:skills', 'priority:p3'],
    evidence: { prs: [200], commit: 'abc1234567', containment: 'merged into `main`', branch: 'main' },
    provenance: 'run 42',
  });
  t('it carries the machine-findable marker on its first line', comment.split('\n')[0].startsWith(COMMENT_MARKER));
  t('it names the labels removed', comment.includes('`pm:dispatched`'));
  t('it names the labels left alone', comment.includes('`domain:skills`') && comment.includes('`priority:p3`'));
  t('it names the closing pull request', comment.includes('#200'));
  t('it names the closing commit, short', comment.includes('`abc1234567`'));
  t('it says the read-back happened, because that is the claim a reader checks', comment.includes('read back'));
  t('it carries the run provenance when a caller supplies one', comment.includes('run 42'));
  t('it ends with the attribution footer', comment.trimEnd().endsWith(COMMENT_FOOTER));
  // The sanitizer eats short angle-bracket fragments, backticked or not, and a
  // comment that loses its middle is a machine posting nonsense on a card.
  t('⛔ it contains no angle-bracket-shaped fragment for the body sanitizer to eat', !/[<>]/.test(comment));

  // -- the listing path, the window and the caps -----------------------------
  battery('the listing path, the window and the caps');
  t('the listing is scoped to CLOSED cards', closedListingPath('o/r', 'pm:dispatched', 1).includes('state=closed'));
  t('the label is URL-encoded, so `pm:*` survives the colon', closedListingPath('o/r', 'pm:on-hold', 1).includes('labels=pm%3Aon-hold'));
  t('one label per request — a multi-label query answers a different question', (closedListingPath('o/r', 'pm:queue', 1).match(/labels=/g) ?? []).length === 1);
  t('the path is repo-relative, keeping this file repo-agnostic', closedListingPath('o/r', 'pm:queue', 2).startsWith('/repos/o/r/issues?'));
  t('it carries the page it was asked for, at 100 rows', closedListingPath('o/r', 'pm:queue', 7).includes('page=7') && closedListingPath('o/r', 'pm:queue', 7).includes('per_page=100'));
  t('the window is spelled as `since` + updated-descending, so a just-closed card is on page 1',
    closedListingPath('o/r', 'pm:queue', 1, '2026-09-02T18:00:00Z').includes('sort=updated') && closedListingPath('o/r', 'pm:queue', 1, '2026-09-02T18:00:00Z').includes('since='));
  t('`--all-time` sends no `since` at all', !closedListingPath('o/r', 'pm:queue', 1, null).includes('since='));
  t('the action floor is the window subtracted from now', actionFloorMs(NOW, 24) === NOW - 86_400_000);
  t('a null window is no floor — that is `--all-time`, and it is opt-in', actionFloorMs(NOW, null) === null);
  t('the caps are real numbers, and the per-card pull-request read cap is one of them', DEFAULT_MAX_CARDS > 0 && LISTING_PAGE_CEILING > 0 && PR_READS_PER_CARD > 0);

  // -- the exit register -----------------------------------------------------
  battery('the exit register: nothing to do is never an alarm');
  t('a run that judged nothing at all exits 0', summariseRun([]).exitCode === EXIT_OK);
  t('a run that found only clean cards exits 0', summariseRun([{ verdict: 'skip', kind: 'clean' }]).exitCode === EXIT_OK);
  t('a run that stripped exits 0', summariseRun([{ verdict: 'strip' }]).exitCode === EXIT_OK);
  t('a run that LEFT cards it judged exits 0 — leaving is a verdict, not a failure', summariseRun([{ verdict: 'leave' }]).exitCode === EXIT_OK);
  t('one unjudged card moves the exit to 2', summariseRun([{ verdict: 'strip' }, { verdict: 'unjudged' }]).exitCode === EXIT_UNJUDGED);
  t('a write that did not land is unjudged too — the card\'s state is now unknown', summariseRun([{ verdict: 'strip', writeFailed: true }]).exitCode === EXIT_UNJUDGED);
  t('the counts a reader is given match the rows', summariseRun([{ verdict: 'strip' }, { verdict: 'leave' }, { verdict: 'skip' }]).counts.strip === 1);

  // -- the report ------------------------------------------------------------
  battery('the report: what a reader is told, and what it refuses to imply');
  const result = {
    repo: 'o/r',
    defaultBranch: 'main',
    sinceIso: '2026-09-02T18:00:00Z',
    listed: 3,
    candidates: 2,
    stats: { listingRequests: 7, evidenceRequests: 4, writeRequests: 0, truncatedLabels: ['pm:dispatched'] },
    rows: [
      row(CARD(), 'strip', { kind: 'pull-request', residue: ['pm:dispatched'], evidence: { prs: [200], commit: 'abc1234567', containment: 'merged into `main`', branch: 'main' } }),
      row(CARD({ number: 101 }), 'leave', { kind: 'no-closing-delivery', residue: ['pm:dispatched'], detail: 'closed by hand' }),
      row(CARD({ number: 102 }), 'skip', { kind: 'cap-deferred', residue: ['pm:queue'] }),
    ],
  };
  const opts = { write: false, windowHours: DEFAULT_WINDOW_HOURS, maxCards: DEFAULT_MAX_CARDS, listCap: 10 };
  const rendered = renderRun(result, opts);
  t('a dry run says so in its first line — no reader should have to infer it', rendered.text.split('\n')[0].includes('DRY RUN'));
  t('the window is stated, because the population it excludes is the ruling\'s subject', rendered.text.includes('2026-09-02T18:00:00Z'));
  t('a bound page ceiling is announced — a short read must never read as a clean one', rendered.text.includes('BOUND the listing'));
  t('a bound per-run cap is announced too, and says those cards were NOT judged', rendered.text.includes('BOUND this run') && rendered.text.includes('NOT judged'));
  t('the stripped card is listed with the pull request the strip rests on', rendered.text.includes('#100') && rendered.text.includes('#200'));
  t('the left card is listed with its reason', rendered.text.includes('closed by hand'));
  const json = renderJson(result, opts);
  t('the JSON summary carries the counts, the caps and every card', json.counts.strip === 1 && json.cap_bound === true && json.cards.length === 3);

  // -- the CLI ---------------------------------------------------------------
  battery('the CLI: the one decision a typo must never make');
  t('the default is a DRY RUN — writing is something a caller has to ask for', parseOptions([]).options.write === false);
  t('`--write` is the ask, and it is exact', parseOptions(['--write']).options.write === true);
  t('`--dry-run` is a real flag, so the workflow can name the mode it is in', parseOptions(['--dry-run']).options.write === false);
  t('⛔ the two mode flags together are a refusal, not a precedence rule', parseOptions(['--write', '--dry-run']).ok === false);
  t('⛔ an unrecognised argument is REFUSED — a caller who thinks it passed a mode flag and did not is the failure this closes',
    parseOptions(['--wirte']).ok === false);
  t('…and the refusal names the arguments that do exist', String(parseOptions(['--nope']).error).includes('--since-hours'));
  t('a bad window is refused rather than rounded to something safe-looking', parseOptions(['--since-hours=0']).ok === false && parseOptions(['--since-hours=x']).ok === false);
  t('`--all-time` is the null window, and it parses', parseOptions(['--all-time']).options.windowHours === null);
  t('a bad cap is refused too', parseOptions(['--max-cards=0']).ok === false);

  // -- the floor -------------------------------------------------------------
  const floorFailure = (message) => { cases.push({ name: message, ok: false }); };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  let breached = false;
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    breached = true;
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    breached = true;
    floorFailure(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    breached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (breached) {
    floorFailure('A battery at or below its floor means cases STOPPED RUNNING — find what stopped registering and restore it.');
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ sweep-closed-cards self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ sweep-closed-cards self-test: ${cases.length} cases pass across ${declared.length} batteries ` +
      '(the imported residue set, the offline screen, the two closing routes with the measured compare ' +
      'orientation, every verdict the ruling names including the open-delivery refusal, the comment ' +
      'this sweep writes onto other people\'s cards, the window and both caps, and the exit register).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  if (process.env[PROXY_REARM_GUARD] === '1') return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

export function readOption(argv, name, fallback) {
  const prefix = `--${name}=`;
  const hit = (argv ?? []).find((a) => a.startsWith(prefix));
  return hit === undefined ? fallback : hit.slice(prefix.length);
}

/** The flags this tool takes. An argument outside this set is a typo, and a typo is refused. */
export const KNOWN_FLAGS = Object.freeze(['--write', '--dry-run', '--json', '--all-time', '--self-test', '--help', '-h']);
export const KNOWN_OPTIONS = Object.freeze(['since-hours', 'max-cards', 'list-cap', 'provenance']);

/**
 * Parse argv into the run's options, or refuse. Pure, so the refusals are
 * pinned offline — this is the layer that decides whether a run WRITES, and a
 * misread flag there is a machine writing to a board nobody asked it to.
 *
 * ⛔ An unrecognised argument is a REFUSAL, never a shrug. The dangerous
 * direction is silent: a caller who believes it passed a mode flag and did not
 * gets a run that behaves like the default, and the default is the only thing
 * standing between a typo and a write.
 */
export function parseOptions(argv, { nowMs = Date.now() } = {}) {
  const args = argv ?? [];
  for (const arg of args) {
    if (KNOWN_FLAGS.includes(arg)) continue;
    const named = /^--([a-z-]+)=/.exec(arg);
    if (named && KNOWN_OPTIONS.includes(named[1])) continue;
    return { ok: false, error: `\`${arg}\` is not an argument this tool takes. Flags: ${KNOWN_FLAGS.join(' ')}; options: ${KNOWN_OPTIONS.map((o) => `--${o}=…`).join(' ')}.` };
  }
  if (args.includes('--write') && args.includes('--dry-run')) {
    return { ok: false, error: '--write and --dry-run together say two different things about the one decision that matters. Pass one.' };
  }
  const allTime = args.includes('--all-time');
  const windowRaw = readOption(args, 'since-hours', String(DEFAULT_WINDOW_HOURS));
  const windowHours = allTime ? null : Number(windowRaw);
  if (windowHours !== null && (!Number.isFinite(windowHours) || windowHours <= 0)) {
    return { ok: false, error: `--since-hours=${windowRaw} is not a positive number of hours.` };
  }
  const maxCards = Number(readOption(args, 'max-cards', String(DEFAULT_MAX_CARDS)));
  if (!Number.isInteger(maxCards) || maxCards <= 0) {
    return { ok: false, error: '--max-cards must be a positive whole number of cards.' };
  }
  const listCap = Number(readOption(args, 'list-cap', '25'));
  if (!Number.isInteger(listCap) || listCap <= 0) {
    return { ok: false, error: '--list-cap must be a positive whole number of rows.' };
  }
  return {
    ok: true,
    options: {
      write: args.includes('--write'),
      json: args.includes('--json'),
      windowHours,
      maxCards,
      listCap,
      provenance: readOption(args, 'provenance', ''),
      nowMs,
    },
  };
}

const USAGE = [
  'sweep-closed-cards — strip the pm-loop state labels from cards GitHub closed on a merged delivery.',
  '',
  '  node scripts/pm/sweep-closed-cards.mjs [--write | --dry-run] [--json] [--since-hours=N | --all-time]',
  '                                         [--max-cards=N] [--provenance=TEXT]',
  '  node scripts/pm/sweep-closed-cards.mjs --self-test',
  '',
  `  default: DRY RUN over cards closed in the last ${DEFAULT_WINDOW_HOURS}h. --write is what acts.`,
  '  --all-time removes the action floor. Read this file\'s header before passing it with --write:',
  '  the unbounded write is the backfill the 2026-08-31 maintainer ruling refused by name.',
].join('\n');

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }

  const repoRes = resolveSweepRepo(process.env);
  if (!repoRes.valid) {
    console.error(
      `sweep-closed-cards: ${repoRes.source}=${JSON.stringify(repoRes.repo)} is not a repository in ` +
        '`owner`/`name` form. Refusing to fall back to a different board — a sweep of the wrong repo ' +
        'writes labels onto cards nobody asked about.',
    );
    return EXIT_USAGE;
  }

  const parsed = parseOptions(argv);
  if (!parsed.ok) {
    console.error(`sweep-closed-cards: ${parsed.error}`);
    return EXIT_USAGE;
  }
  const options = parsed.options;

  if (options.write && options.windowHours === null) {
    console.error(
      '⚠️  --write with --all-time: this is the unbounded backfill the 2026-08-31 maintainer ruling\n' +
        '    refused by name (this file\'s header quotes it). Proceeding, because a caller who typed both\n' +
        '    flags asked for it — but the scheduled patrol never does, and a seat should not either\n' +
        '    without a ruling that says so.',
    );
  }

  let result;
  try {
    result = await sweep(repoRes.repo, options);
  } catch (err) {
    return reportPrerequisiteNotMet(err);
  }

  if (options.json) {
    const doc = renderJson(result, options);
    console.log(JSON.stringify(doc, null, 2));
    return doc.exit_code;
  }
  const rendered = renderRun(result, options);
  console.log(rendered.text);
  return rendered.exitCode;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ sweep-closed-cards self-test: selfTest() returned without reaching its verdict, so no\n' +
          'success line was printed. Exiting 0 here would report a self-test that never finished as\n' +
          'a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  } else {
    const rearmed = rearmThroughProxy(process.argv.slice(2));
    if (rearmed !== null) process.exit(rearmed);
    main(process.argv.slice(2)).then((code) => process.exit(code));
  }
}
