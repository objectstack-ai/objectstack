#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * card-pick — which ready cards a seat takes next, read off the live board under the grade rules.
 *
 *   node scripts/pm/card-pick.mjs --order area:fleet --seat repo:objectstack#5 --why
 *   node scripts/pm/card-pick.mjs --order epic:#35205,area:ux,area:build --limit 3 --json
 *   node scripts/pm/card-pick.mjs --order area:ux --fixture board.json      # offline, no network
 *   node scripts/pm/card-pick.mjs --self-test                               # offline, no network at all
 *
 * ## Why this file exists
 *
 * Every executing seat, every fire, and the coordinator on every wake, retyped the pick order by hand: list the
 * queue, sort it by grade, walk the maintainer-named areas and epics, drop what is assigned, decided, blocked or
 * claimed, and say why each other card is not a candidate. The rule is short; the reading is long, and the reading
 * is where a seat sends itself the wrong card. This file is the reading. ⛔ It writes nothing: its output is input to
 * a claim, and the claim's own re-read still arbitrates.
 *
 * ## The rules it encodes — rule text on `main`, pinned by the self-test
 *
 * `docs/NORTH-STAR.md` "Priority" rule 3 (`RULE_PHRASES`), read with `references/execution-duties.md`'s candidate
 * definition and `references/state-machine.md`'s `Blocked-by:` contract:
 *
 *   1. `priority:p0` first, past every cap (leg `p0`).
 *   2. `priority:p1` next, whatever area it belongs to, a paused area included (leg `p1 jump`).
 *   3. Then the areas and epics `--order` names, in that order (leg `order k`). Inside an epic, its child order
 *      whatever the grade (`GET …/issues/N/sub_issues`; leg `epic child k`); inside an area, p2 by the same-grade
 *      tiebreak, then p3 by the same tiebreak (leg `order k p3 close-out`).
 *   4. A card the order reaches that carries no grade comes after every graded leg (leg `ungraded`): the label order
 *      is p0 > p1 > the named order > ungraded.
 *   5. An area's p3 is a pick, ranked after every p2 of that same item and before the next item: "p2 first, p3 left
 *      for the close-out"; "in an area with no sub-epic, p2 before p3". So an area holding only p3 cards yields its
 *      p3 as the next pick, never an empty queue. The reader cannot tell whether an area has a sub-epic, so every
 *      area item ranks this way; a sub-epic is named as an `epic:` item and keeps its child order.
 *   6. At one grade: a non-fleet card first (`isFleetCard`), then a `Bug`, then the card opened first.
 *   7. Not a candidate: an assignee, `pm:dispatched`, `needs-user-decision`, `pm:retriage`, a second pm state, an
 *      epic or tracking parent (`pm:epic`, `tracking`), an open line-start `Blocked-by:` target in the body or a
 *      comment (a PR target holds until it MERGES; closed unmerged keeps the block), a newest `Claim:` (not
 *      followed by a `Release:`), and a fleet card with no triage audit record (`references/seat-lifecycle.md`'s
 *      blocking-point vocabulary).
 *   8. Leases are not read: a lease guards file overlap, and overlap is checked at claim time (`overlap-check.mjs`).
 *
 * ## What it does NOT read — named in the footer of every run
 *
 * The maintainer's direct dispatch (the first leg of 取卡全序, three provenance pieces), the contract-surface leg
 * (`references/lanes/spec.md`), a `tooling` card's three-gate admission (triage's reading: only one gate is a
 * machine line), the multi-seat odd/even alternation, batching a p3 onto a PR that touches the same files (rule
 * ④'s "or batched", a judgement over a diff), lane ownership (a `domain:*` card outside the seat's lane, a cloud
 * card or a security card is listed but may not be claimed; each row prints its `domain:*` so the seat can read it)
 * and an area item that holds a sub-epic (rule 3 ③ binds that sub-epic's child order; the reader ranks the area p2
 * before p3 unless the sub-epic is named as an `epic:` item). A seat reads those itself; the output says so every
 * time, so an absent leg never reads as a leg that found nothing.
 *
 * ## What it reads — REST through `gh api`, every page
 *
 *   1. every open issue carrying `pm:queue` (`readAllPages`), pull requests dropped, the count compared with the
 *      platform's own `GET /search/issues` total — a gap is INCOMPLETE (exit 4), ⛔ never a clean pick list;
 *   2. each named epic's row and `GET …/issues/N/sub_issues`, every page, for the child order;
 *   3. a card's comment thread, only for a card the order reaches, in rank order — every one with `--why`, and only
 *      until `--limit` picks without it (the rest are counted as not reached);
 *   4. each `Blocked-by:` target's row, cross-repo included (`blockerTargetKey`), once per run;
 *   5. a fleet card's sub-issue parent only when its thread carries no triage audit (`h74NeedsParentRead`).
 *
 * Every reader is borrowed, never re-spelled: `check-half-states.mjs` owns the `Blocked-by:` line, the target row,
 * the claim and release markers, the seat signature, the fleet reading, the grade ladder, H67's age order and H74's
 * triage audit; `gh-pages.mjs` owns the paging.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  complete: every read answered and the walk counted what the platform counts
 *   1  `--self-test` failed
 *   2  usage
 *   3  PREREQUISITE NOT MET — the queue listing or the platform count could not be read; nothing was ranked
 *   4  INCOMPLETE — a count gap, an epic that could not be read, or a card whose thread, `Blocked-by:` target or
 *      sub-issue parent could not be read; the list is printed with each gap named and every card such a read holds
 *      printed even without `--why`, ⛔ never as a clean answer
 *
 * ## Self-test
 *
 * `--self-test` drives the ranking, the exclusions, the reads and the CLI against fixtures, with the floor and the
 * handshake AGENTS.md § "Writing a `--self-test`" requires (copied, never imported), and pins the rule text.
 */

import { readFileSync } from 'node:fs';

import { isEntrypoint } from '../invoked-as.mjs';
import {
  CLAIM_COMMENT_MARKER,
  DECISION_INBOX_LABEL,
  DEFAULT_SWEEP_REPO,
  GRADE_LADDER,
  H74_PARENT_UNREADABLE,
  PM_EXCLUSIVE_STATE_LABELS,
  RELEASE_COMMENT_MARKER,
  SEAT_SIGNATURE_LINE,
  SEAT_SIGNATURE_SEPARATOR,
  blockerResolutionFromRow,
  blockerTargetsFor,
  gradeRung,
  h67ReadOrder,
  h74NeedsParentRead,
  h74QueuedWithoutTriageAudit,
  isFleetCard,
  labelNames,
  markerMatches,
  readSignatureLine,
  subIssueParentPath,
} from './check-half-states.mjs';
import { ghApi, readAllPages } from './gh-pages.mjs';

const REPO_ROOT = new URL('../../', import.meta.url);

export const EXIT_OK = 0;
export const EXIT_SELF_TEST_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = 3;
export const EXIT_INCOMPLETE = 4;

export const QUEUE_LABEL = 'pm:queue';
export const DEFAULT_LIMIT = 5;
/** Labels that make a card a parent of work rather than work (H74's exemption list carries both). */
export const PARENT_LABELS = Object.freeze(['pm:epic', 'tracking']);

/** Where the rules live, and the phrases this file is built from — the self-test pins each one present. */
export const NORTH_STAR_PATH = 'docs/NORTH-STAR.md';
export const RULE_PHRASES = Object.freeze([
  'A seat takes its next card in this order: ① p0, dispatched in the same round, past every concurrency cap',
  '② p1, ahead of the next card of the area being dispatched, whatever area it belongs to, a held or paused area included',
  '③ the next card of the area being dispatched, in the order of the areas and sub-epics the maintainer names, and inside one by its own child order and `Blocked-by:`',
  '④ inside an area, p2 and p3 are only a reference: p2 first, p3 left for the close-out or batched; in an area with no sub-epic, p2 before p3, and at the same grade the card opened first goes first',
]);
export const DUTIES_PATH = '.claude/skills/pm-dispatch/references/execution-duties.md';
export const DUTIES_PHRASES = Object.freeze([
  '候选 = open、未 assign、无 `needs-user-decision`、无 `pm:retriage`',
  '取卡全序:维护者直派插队卡(出处三件)> 契约面卡(判据见 `references/lanes/spec.md`)> 标签序',
  '同级先非车队卡(作者非 `Bot` 且首行非席位签名),再 `Bug`、卡龄',
  '本车道开放卡现读 `card-pick.mjs --order <序>`',
  '开放 = 未派发(无 `pm:dispatched`、无 assignee)',
]);
export const STATE_MACHINE_PATH = '.claude/skills/pm-dispatch/references/state-machine.md';
export const STATE_MACHINE_PHRASES = Object.freeze([
  '正典标记 = 行首 `Blocked-by: #N`',
  '合并才放,关而未合并 ⛔ 不放',
]);
export const LIFECYCLE_PATH = '.claude/skills/pm-dispatch/references/seat-lifecycle.md';
export const LIFECYCLE_PHRASES = Object.freeze(['无分诊审计、他席 `Claim:`', '`card-pick.mjs --order <序> --why`', '`outside --order`']);

/** The legs this file cannot read, printed under every run. */
export const UNREAD_LEGS = Object.freeze([
  "the maintainer's direct dispatch (取卡全序 leg 1, three provenance pieces) — not on the board as a label",
  'the contract-surface leg (取卡全序 leg 2, `references/lanes/spec.md`) — a judgement over the diff, not a label',
  "a `tooling` card's three-gate admission — triage's reading; flagged on the row, not judged",
  'multi-seat odd/even alternation — the seat applies it to this list',
  "batching a p3 onto a PR that touches the same files (rule ④'s \"or batched\") — a judgement over a diff; here every area p3 ranks as its close-out",
  "lane ownership — a `domain:*` card outside this seat's lane, a cloud card or a security card is listed here but a seat may not claim it; read each row's `domain:*` against your lane",
  "an area item that holds a sub-epic — ranked here p2 before p3, but rule 3 ③ binds that sub-epic's child order; name it as `epic:#N` in --order to get it",
]);

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

/** `--order` parsed: `epic:#N` / `epic:N` and `area:x`, in the order given. `{ ok, items }` or `{ ok: false, error }`. */
export function parseOrder(text) {
  const items = [];
  for (const raw of String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const epic = /^epic:#?(\d+)$/.exec(raw);
    const area = /^area:([a-z0-9][a-z0-9-]*)$/.exec(raw);
    if (epic) items.push({ kind: 'epic', number: Number(epic[1]), name: `epic:#${epic[1]}` });
    else if (area) items.push({ kind: 'area', label: `area:${area[1]}`, name: `area:${area[1]}` });
    else return { ok: false, error: `--order item \`${raw}\` is neither epic:#N nor area:NAME` };
  }
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.name)) return { ok: false, error: `--order names \`${it.name}\` twice` };
    seen.add(it.name);
  }
  return { ok: true, items };
}

/**
 * `--seat LANE#N` parsed by the seat signature's own grammar (`SEAT_SIGNATURE_LINE`, borrowed, never re-spelled), so
 * every lane a signature can carry is accepted, an epic seat's `epic:#N#1` included. Pure.
 */
export function parseSeat(text) {
  const v = String(text ?? '');
  if (/\s/.test(v)) return null;
  const m = SEAT_SIGNATURE_LINE.exec(`${v}${SEAT_SIGNATURE_SEPARATOR}seat${SEAT_SIGNATURE_SEPARATOR}session_parseseat`);
  return m ? { lane: m[1], seat: Number(m[2]), name: `${m[1]}#${m[2]}` } : null;
}

const GRADE_NAMES = Object.freeze(['p0', 'p1', 'p2', 'p3']);
export const gradeName = (issue) => {
  const rung = gradeRung(issue);
  return rung === null ? 'ungraded' : GRADE_NAMES[rung];
};
export const issueType = (issue) => {
  const t = issue?.type;
  const name = typeof t === 'string' ? t : t?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
};
const areaOf = (issue) => labelNames(issue).filter((l) => l.startsWith('area:')).join(',') || 'no area';
/** The card's lane labels, printed on every row: the reader does not judge lane ownership, the seat does. Pure. */
export const domainOf = (issue) => labelNames(issue).filter((l) => l.startsWith('domain:')).join(',') || 'no domain';

/**
 * The same-grade order: a non-fleet card first, then a `Bug`, then the card opened first. H67's read order supplies
 * rank → fleet → age → number; a STABLE sort on rank → fleet → Bug then slots the Bug tiebreak in above age without
 * re-spelling either half. Pure.
 */
export function sameGradeOrder(cards) {
  const base = h67ReadOrder(cards, Number.MAX_SAFE_INTEGER).read;
  const rank = (i) => {
    const r = gradeRung(i);
    return r === null ? GRADE_LADDER.length : r;
  };
  const fleet = (i) => (isFleetCard(i) ? 1 : 0);
  const bug = (i) => (issueType(i) === 'Bug' ? 0 : 1);
  return [...base].sort((a, b) => rank(a) - rank(b) || fleet(a) - fleet(b) || bug(a) - bug(b));
}

/**
 * The reasons a card is not a candidate that its own row can answer — no read. Pure.
 * ⚠ The `pm:queue` population is the caller's; a closed card or a PR never reaches here.
 */
export function labelReasons(issue) {
  const labels = labelNames(issue);
  const out = [];
  if (Array.isArray(issue?.assignees) ? issue.assignees.length > 0 : Boolean(issue?.assignee)) {
    out.push(`assigned (${(issue.assignees ?? [issue.assignee]).map((a) => a?.login ?? '?').join(', ')})`);
  }
  if (labels.includes('pm:dispatched')) out.push('pm:dispatched');
  if (labels.includes(DECISION_INBOX_LABEL)) out.push(DECISION_INBOX_LABEL);
  if (labels.includes('pm:retriage')) out.push('pm:retriage');
  for (const l of PARENT_LABELS) if (labels.includes(l)) out.push(`${l} parent`);
  for (const l of PM_EXCLUSIVE_STATE_LABELS) {
    if (![QUEUE_LABEL, 'pm:dispatched', DECISION_INBOX_LABEL].includes(l) && labels.includes(l)) out.push(`second pm state ${l}`);
  }
  return out;
}

/**
 * Where the order puts a card: `{ leg, legRank, orderIndex, childIndex }` or `null` when nothing reaches it. Pure.
 * `children` maps an epic number to its child numbers in the epic's own order.
 */
export function placeCard(issue, items, children) {
  const rung = gradeRung(issue);
  if (rung === 0) return { leg: 'p0', legRank: 0, orderIndex: -1, childIndex: -1 };
  if (rung === 1) return { leg: 'p1 jump', legRank: 1, orderIndex: -1, childIndex: -1 };
  const labels = labelNames(issue);
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    let childIndex = -1;
    if (it.kind === 'epic') {
      childIndex = (children.get(it.number) ?? []).indexOf(issue.number);
      if (childIndex === -1) continue;
    } else if (!labels.includes(it.label)) continue;
    if (rung === 3 && it.kind === 'area') return { leg: `order ${k + 1} p3 close-out`, legRank: 1.75, orderIndex: k, childIndex, item: it.name };
    if (rung === null && it.kind === 'area') return { leg: 'ungraded', legRank: 2, orderIndex: k, childIndex, item: it.name };
    return { leg: it.kind === 'epic' ? `epic child ${childIndex + 1}` : `order ${k + 1}`, legRank: 1.5, orderIndex: k, childIndex, item: it.name };
  }
  return null;
}

/**
 * Rank the in-scope cards: p0, p1, then each order item in turn (an epic by child order whatever the grade; an area
 * by the same-grade order, every p2 ahead of every p3), then the ungraded leg. Pure.
 */
export function rankCards(placed) {
  const byLeg = (pred) => placed.filter(pred);
  const out = [];
  out.push(...sameGradeOrder(byLeg((p) => p.place.leg === 'p0').map((p) => p.issue)));
  out.push(...sameGradeOrder(byLeg((p) => p.place.leg === 'p1 jump').map((p) => p.issue)));
  const orderIndexes = [...new Set(placed.map((p) => p.place.orderIndex).filter((k) => k >= 0))].sort((a, b) => a - b);
  for (const k of orderIndexes) {
    const inItem = byLeg((p) => p.place.orderIndex === k && p.place.legRank === 1.5);
    const epic = inItem.filter((p) => p.place.childIndex >= 0).sort((a, b) => a.place.childIndex - b.place.childIndex);
    out.push(...epic.map((p) => p.issue));
    out.push(...sameGradeOrder(inItem.filter((p) => p.place.childIndex < 0).map((p) => p.issue)));
    out.push(...sameGradeOrder(byLeg((p) => p.place.orderIndex === k && p.place.legRank === 1.75).map((p) => p.issue)));
  }
  for (const k of orderIndexes) out.push(...sameGradeOrder(byLeg((p) => p.place.orderIndex === k && p.place.leg === 'ungraded').map((p) => p.issue)));
  return { ranked: out };
}

/**
 * The newest ownership marker on a thread: the newest comment carrying `Claim:` or `Release:` (the shared markers),
 * and who signed it. `null` when neither appears. Pure.
 */
export function ownershipOf(comments) {
  let newest = null;
  for (const c of comments ?? []) {
    const body = String(c?.body ?? '');
    const claim = markerMatches(CLAIM_COMMENT_MARKER, body);
    const release = markerMatches(RELEASE_COMMENT_MARKER, body);
    if (!claim && !release) continue;
    const at = Date.parse(c?.created_at ?? '');
    if (newest === null || !Number.isFinite(newest.at) || (Number.isFinite(at) && at >= newest.at)) {
      newest = { kind: release && !claim ? 'release' : 'claim', at, signature: readSignatureLine(body) };
    }
  }
  return newest;
}

/** The claim reason for a thread, judged against `--seat`: `null` when the card is free. Pure. */
export function claimReason(comments, seat) {
  const own = ownershipOf(comments);
  if (own === null || own.kind === 'release') return null;
  const sig = own.signature;
  if (!sig) return 'Claim: (unsigned) — another session holds it unless the claim names you';
  const who = `${sig.lane}#${sig.seat}`;
  if (seat && seat.name === who) return `Claim: by this seat (${who}) — already yours, not a new pick`;
  return `Claim: by ${who}`;
}

const ageDays = (issue, nowMs) => {
  const t = Date.parse(issue?.created_at ?? '');
  return Number.isFinite(t) ? `${Math.max(0, Math.floor((nowMs - t) / 86_400_000))}d` : '?d';
};

// ---------------------------------------------------------------------------
// The walk — `get` is injected (`{ ok, value }` / `{ ok: false, error }`, gh-pages' shape)
// ---------------------------------------------------------------------------

const is404 = (r) => !r.ok && /\b404\b|Not Found/i.test(String(r.error ?? ''));

export async function pick({ repo, items, seat, limit = DEFAULT_LIMIT, why = false, nowMs = Date.now(), get = ghApi }) {
  const incomplete = [];
  const reads = { pages: 0, threads: 0, targets: 0, parents: 0, epics: 0 };
  const getCounted = get;

  // 1. the queue, every page, against the platform's count.
  const listed = readAllPages(`/repos/${repo}/issues?state=open&labels=${encodeURIComponent(QUEUE_LABEL)}`, {
    get: (p) => {
      reads.pages += 1;
      return getCounted(p);
    },
  });
  if (!listed.ok) return { prerequisite: `the ${QUEUE_LABEL} listing could not be read: ${listed.error}` };
  const queue = listed.value.filter((row) => row && !row.pull_request);
  const total = getCounted(`/search/issues?q=${encodeURIComponent(`repo:${repo} is:issue is:open label:${QUEUE_LABEL}`)}&per_page=1`);
  if (!total.ok || typeof total.value?.total_count !== 'number') return { prerequisite: `the platform count could not be read: ${total.error ?? 'no total_count'}` };
  if (total.value.incomplete_results === true) incomplete.push('the platform count answered incomplete_results');
  if (total.value.total_count !== queue.length) incomplete.push(`the walk returned ${queue.length} ${QUEUE_LABEL} issue(s) and the platform counts ${total.value.total_count}`);

  // 2. each named epic's child order.
  const children = new Map();
  const epicRows = new Map();
  for (const it of items.filter((i) => i.kind === 'epic')) {
    reads.epics += 1;
    const row = getCounted(`/repos/${repo}/issues/${it.number}`);
    const subs = readAllPages(`/repos/${repo}/issues/${it.number}/sub_issues`, { get: getCounted });
    if (!subs.ok) {
      incomplete.push(`${it.name}'s children could not be read (${subs.error}) — its leg is empty`);
      continue;
    }
    if (row.ok) epicRows.set(it.number, row.value);
    children.set(it.number, subs.value.map((s) => s?.number).filter(Number.isInteger));
  }

  // 3. place every card; the label-only reasons first.
  const rows = [];
  const placed = [];
  for (const issue of queue) {
    const reasons = labelReasons(issue);
    const place = placeCard(issue, items, children);
    const row = { issue, place, reasons, flags: [], read: false, gap: false };
    rows.push(row);
    if (reasons.length) continue;
    if (place === null) {
      row.reasons.push(`outside --order (${gradeName(issue)} · ${areaOf(issue)})`);
      continue;
    }
    placed.push(row);
  }
  for (const row of rows) if (labelNames(row.issue).includes('tooling')) row.flags.push('tooling: three-gate admission unread');

  // 4. walk in rank order, reading threads lazily.
  const { ranked } = rankCards(placed);
  const rowOf = new Map(rows.map((r) => [r.issue.number, r]));
  const targetCache = new Map();
  const resolveTarget = (t) => {
    if (targetCache.has(t.key)) return targetCache.get(t.key);
    reads.targets += 1;
    const r = getCounted(`/repos/${t.repo}/issues/${t.number}`);
    const res = r.ok ? blockerResolutionFromRow(t, r.value) : { ...t, state: 'unresolved', detail: r.error };
    targetCache.set(t.key, res);
    return res;
  };
  const evaluate = (row) => {
    const { issue } = row;
    reads.threads += 1;
    const thread = readAllPages(`/repos/${repo}/issues/${issue.number}/comments`, { get: getCounted });
    row.read = true;
    if (!thread.ok) {
      row.reasons.push(`thread unreadable (${thread.error})`);
      row.gap = true;
      incomplete.push(`#${issue.number}'s thread could not be read`);
      return;
    }
    const comments = thread.value;
    const bodies = comments.map((c) => String(c?.body ?? ''));
    for (const t of blockerTargetsFor(issue, bodies, repo)) {
      const res = resolveTarget(t);
      const name = t.local ? `#${t.number}` : t.key;
      if (res.state === 'unresolved') {
        row.reasons.push(`Blocked-by: ${name} (unreadable — held, never read as closed)`);
        row.gap = true;
        incomplete.push(`#${issue.number}'s Blocked-by: ${name} could not be read (${res.detail ?? 'no detail'})`);
      }
      else if (res.state === 'open') row.reasons.push(`Blocked-by: ${name} (open)`);
      else if (res.unmerged) row.reasons.push(`Blocked-by: ${name} (PR closed unmerged — the block stays)`);
    }
    const claim = claimReason(comments, seat);
    if (claim) row.reasons.push(claim);
    let parent = row.place?.childIndex >= 0 ? epicRows.get(Number(row.place.item.replace(/\D/g, ''))) : undefined;
    if (parent === undefined && h74NeedsParentRead(issue, bodies)) {
      reads.parents += 1;
      const p = getCounted(subIssueParentPath(repo, issue.number));
      parent = p.ok ? p.value : is404(p) ? null : H74_PARENT_UNREADABLE;
    }
    if (h74QueuedWithoutTriageAudit(issue, bodies, parent) !== null) {
      row.reasons.push(parent === H74_PARENT_UNREADABLE ? 'no triage audit (parent unreadable — unjudged, held)' : 'no triage audit — knock triage');
    }
    if (parent === H74_PARENT_UNREADABLE) {
      row.gap = true;
      incomplete.push(`#${issue.number}'s sub-issue parent could not be read`);
    }
  };
  const picks = [];
  let notReached = 0;
  for (const issue of ranked) {
    const row = rowOf.get(issue.number);
    if (picks.length >= limit && !why) {
      notReached += 1;
      continue;
    }
    evaluate(row);
    if (row.reasons.length === 0) {
      if (picks.length < limit) picks.push(row);
      else row.reasons.push(`below --limit ${limit} (a candidate)`);
    }
  }
  const pickSet = new Set(picks.map((r) => r.issue.number));
  const others = rows.filter((r) => !pickSet.has(r.issue.number) && r.reasons.length > 0);
  const held = others.filter((r) => r.gap);
  return {
    repo,
    items,
    seat,
    limit,
    why,
    nowMs,
    enumerated: queue.length,
    totalCount: total.value.total_count,
    reads,
    complete: incomplete.length === 0,
    incomplete,
    picks,
    others,
    held,
    notReached,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function rowLine(row, rank, nowMs) {
  const i = row.issue;
  const leg = row.place?.leg ?? '—';
  const where = row.place?.item ?? areaOf(i);
  const parts = [`#${i.number}`, gradeName(i), where, domainOf(i), issueType(i) ?? 'no type', leg, ageDays(i, nowMs), isFleetCard(i) ? 'fleet' : 'non-fleet'];
  const title = String(i.title ?? '').replace(/\s+/g, ' ').slice(0, 90);
  const flags = row.flags.length ? ` [${row.flags.join('; ')}]` : '';
  return `${rank === null ? '' : `${rank} · `}${parts.join(' · ')} — ${title}${flags}`;
}

export function verdictLine(r) {
  if (!r.complete) return `card-pick INCOMPLETE — ${r.incomplete.join('; ')}. ⛔ Not a clean pick list: re-run when the reads answer.`;
  return `card-pick COMPLETE — ${r.picks.length} pick(s)`;
}

export function renderText(r) {
  const at = new Date(r.nowMs).toISOString().slice(0, 16) + 'Z';
  const L = [`card-pick — ${r.repo} · order ${r.items.map((i) => i.name).join(', ') || '(none: p0/p1 only)'} · seat ${r.seat?.name ?? '(none)'} · ${at}`];
  L.push(`read: ${r.enumerated} open ${QUEUE_LABEL} issue(s) over ${r.reads.pages} page(s) · the platform counts ${r.totalCount} · threads ${r.reads.threads} · Blocked-by targets ${r.reads.targets} · parents ${r.reads.parents} · epics ${r.reads.epics}`);
  L.push(`Picks (limit ${r.limit}) — rank · #N · grade · area/epic · domain · type · leg · age · fleet:`);
  if (r.picks.length === 0) L.push('  (none — every card the order reaches has a named blocking point; --why lists them)');
  r.picks.forEach((row, k) => L.push(`  ${rowLine(row, k + 1, r.nowMs)}`));
  if (r.why) {
    L.push(`Not a pick (--why) — ${r.others.length} card(s), each with its blocking point:`);
    const sorted = [...r.others].sort((a, b) => (a.place ? 0 : 1) - (b.place ? 0 : 1) || a.issue.number - b.issue.number);
    for (const row of sorted) L.push(`  · #${row.issue.number} · ${gradeName(row.issue)} · ${row.place?.item ?? areaOf(row.issue)} · ${domainOf(row.issue)} — ${row.reasons.join('; ')}`);
  } else {
    if (r.held.length > 0) {
      L.push(`Held by a read that did not answer — ${r.held.length} card(s), printed without --why (⛔ not a card the order skipped):`);
      for (const row of r.held) L.push(`  · ${rowLine(row, null, r.nowMs)} — ${row.reasons.join('; ')}`);
    }
    if (r.notReached > 0) L.push(`Not reached: ${r.notReached} lower-ranked card(s) were not read once --limit filled (--why reads them all).`);
  }
  L.push('Not read by this reader — the seat reads these itself:');
  for (const leg of UNREAD_LEGS) L.push(`  · ${leg}`);
  L.push(verdictLine(r));
  return L.join('\n');
}

export function renderJson(r) {
  const card = (row) => ({
    number: row.issue.number,
    title: row.issue.title ?? '',
    grade: gradeName(row.issue),
    area: areaOf(row.issue),
    domain: domainOf(row.issue),
    type: issueType(row.issue),
    leg: row.place?.leg ?? null,
    order_item: row.place?.item ?? null,
    fleet: isFleetCard(row.issue),
    created_at: row.issue.created_at ?? null,
    flags: row.flags,
    reasons: row.reasons,
    thread_read: row.read,
  });
  return {
    repo: r.repo,
    order: r.items.map((i) => i.name),
    seat: r.seat?.name ?? null,
    complete: r.complete,
    incomplete_reasons: r.incomplete,
    enumerated: r.enumerated,
    total_count: r.totalCount,
    reads: r.reads,
    picks: r.picks.map(card),
    not_a_pick: r.why ? r.others.map(card) : null,
    held_on_unread: r.held.map(card),
    not_reached: r.notReached,
    unread_legs: UNREAD_LEGS,
    verdict: verdictLine(r),
  };
}

// ---------------------------------------------------------------------------
// Fixture — an offline board the same `get` answers
// ---------------------------------------------------------------------------

/**
 * A `get` over a fixture: `{ issues, total_count?, comments?: {N: []}, sub_issues?: {N: []}, rows?: {"o/r#N": row},
 * parents?: {N: row} }`. A path the fixture does not hold answers 404, so a fixture can never read as a board that
 * answered; a `null` comment list, row or parent answers HTTP 502, a read that failed. Pure.
 */
export function fixtureGet(fixture, repo) {
  const page = (rows, path) => {
    const q = new URLSearchParams(path.split('?')[1] ?? '');
    const per = Number(q.get('per_page') ?? 100);
    const p = Number(q.get('page') ?? 1);
    return rows.slice((p - 1) * per, p * per);
  };
  const issues = fixture.issues ?? [];
  return (path) => {
    const bare = path.split('?')[0];
    if (bare === `/repos/${repo}/issues`) return { ok: true, value: page(issues, path) };
    if (bare === '/search/issues') return { ok: true, value: { total_count: fixture.total_count ?? issues.filter((i) => !i.pull_request).length, incomplete_results: false } };
    let m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(bare);
    if (m) return fixture.comments?.[m[2]] === null ? { ok: false, error: 'HTTP 502' } : { ok: true, value: page(fixture.comments?.[m[2]] ?? [], path) };
    m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/sub_issues$/.exec(bare);
    if (m) return fixture.sub_issues?.[m[1]] ? { ok: true, value: page(fixture.sub_issues[m[1]], path) } : { ok: false, error: 'HTTP 404 Not Found' };
    m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/parent$/.exec(bare);
    if (m) {
      if (fixture.parents?.[m[1]] === null) return { ok: false, error: 'HTTP 502' };
      return fixture.parents?.[m[1]] ? { ok: true, value: fixture.parents[m[1]] } : { ok: false, error: 'HTTP 404 Not Found' };
    }
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(bare);
    if (m) {
      if (fixture.rows?.[`${m[1]}#${m[2]}`] === null) return { ok: false, error: 'HTTP 502' };
      const row = fixture.rows?.[`${m[1]}#${m[2]}`] ?? (m[1] === repo ? issues.find((i) => i.number === Number(m[2])) : undefined);
      return row ? { ok: true, value: row } : { ok: false, error: 'HTTP 404 Not Found' };
    }
    return { ok: false, error: `HTTP 404 Not Found (${bare})` };
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'card-pick — which ready cards a seat takes next (read-only; the claim re-read still arbitrates).',
  '',
  '  node scripts/pm/card-pick.mjs --order epic:#N,area:NAME,… [--seat LANE#N] [--repo OWNER/NAME]',
  '                                [--limit N] [--why] [--json] [--fixture FILE] [--now ISO]',
  '  node scripts/pm/card-pick.mjs --self-test',
  '',
  '  --order  the maintainer-named order, epics and areas mixed; p0 and p1 jump it whatever their area.',
  '  --seat   this seat, so its own Claim: reads as already yours rather than another seat\'s.',
  '  --why    every other queue card with its named blocking point (reads every thread the order reaches).',
  '  Exits: 0 complete · 2 usage · 3 prerequisite (queue unreadable) · 4 INCOMPLETE (a gap, named; held cards printed).',
].join('\n');

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_SWEEP_REPO, order: null, seat: null, limit: DEFAULT_LIMIT, why: false, json: false, fixture: null, nowMs: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = /^(--[a-z]+)=(.*)$/.exec(a);
    const flag = eq ? eq[1] : a;
    const take = () => (eq ? eq[2] : argv[++i]);
    if (flag === '--why' && !eq) opts.why = true;
    else if (flag === '--json' && !eq) opts.json = true;
    else if ((flag === '--help' || flag === '-h') && !eq) opts.help = true;
    else if (flag === '--repo') {
      opts.repo = String(take() ?? '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) return { error: `--repo must be OWNER/NAME, got \`${opts.repo}\`` };
    } else if (flag === '--order') {
      const v = take();
      if (v === undefined) return { error: '--order needs a value (epic:#N and area:NAME, comma-separated; --order "" for p0/p1 only)' };
      const parsed = parseOrder(v);
      if (!parsed.ok) return { error: parsed.error };
      opts.order = parsed.items;
    } else if (flag === '--seat') {
      const v = take();
      opts.seat = parseSeat(v);
      if (!opts.seat) return { error: `--seat must be LANE#N (a seat signature's first part), got \`${v}\`` };
    } else if (flag === '--limit') {
      const v = take();
      if (!/^[1-9][0-9]*$/.test(String(v ?? ''))) return { error: `--limit must be a positive integer, got \`${v}\`` };
      opts.limit = Number(v);
    } else if (flag === '--fixture') {
      opts.fixture = take();
      if (!opts.fixture) return { error: '--fixture needs a file' };
    } else if (flag === '--now') {
      const v = take();
      opts.nowMs = Date.parse(String(v ?? ''));
      if (!Number.isFinite(opts.nowMs)) return { error: `--now must be an ISO time, got \`${v}\`` };
    } else return { error: `\`${a}\` is not an argument this tool takes` };
  }
  if (!opts.help && opts.order === null) return { error: '--order is required (the maintainer-named order: epic:#N and area:NAME, comma-separated); a pick list with no order is p0/p1 only, so say so with --order ""' };
  return { opts };
}

export async function main(argv, deps = {}) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`card-pick: ${parsed.error}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const o = parsed.opts;
  if (o.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  let get = deps.get ?? ghApi;
  let nowMs = o.nowMs ?? deps.nowMs ?? Date.now();
  if (o.fixture) {
    let fixture;
    try {
      fixture = JSON.parse(readFileSync(o.fixture, 'utf8'));
    } catch (e) {
      console.error(`card-pick: --fixture \`${o.fixture}\` could not be read as JSON (${e.message})`);
      return EXIT_USAGE;
    }
    get = fixtureGet(fixture, o.repo);
    if (o.nowMs === null && fixture.now) nowMs = Date.parse(fixture.now);
  }
  const r = await pick({ repo: o.repo, items: o.order, seat: o.seat, limit: o.limit, why: o.why, nowMs, get });
  if (r.prerequisite) {
    console.error(`card-pick: PREREQUISITE NOT MET — ${r.prerequisite}. ⛔ No pick list: nothing was ranked.`);
    return EXIT_PREREQUISITE;
  }
  console.log(o.json ? JSON.stringify(renderJson(r), null, 2) : renderText(r));
  return r.complete ? EXIT_OK : EXIT_INCOMPLETE;
}

// ---------------------------------------------------------------------------
// Self-test — floor (battery names pinned) + handshake, copied from the landed shape
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the rule text: every phrase this file is built from is in the file that writes it': 5,
  'the grade legs: p0 above everything, p1 jumps the named order, the ungraded leg comes last': 6,
  "p3: an area's close-out after every p2 of that item; an epic's children keep their child order": 7,
  'Blocked-by: an open target holds, a closed-unmerged PR holds, a merged PR and a closed issue release, cross-repo is read': 7,
  'the same-grade order and the epic child order': 5,
  'the candidate definition: label reasons, claims and the triage audit': 9,
  'the walk: every page, the count checked, the limit and --why': 11,
  'the CLI: usage, exits and the footer': 12,
});
const SELF_TEST_BATTERY_FLOOR = 8;
const UNATTRIBUTED_BATTERY = '(unattributed)';
const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

const quiet = (fn) => async (...args) => {
  const log = console.log;
  const err = console.error;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    return { code: await fn(...args), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
};

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true) => {
    const key = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(key, (batteryCases.get(key) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const REPO = 'objectstack-ai/objectstack';
  const NOW = Date.parse('2026-11-19T12:00:00Z');
  const HUMAN = { login: 'someone', type: 'User' };
  const APP = { login: 'objectstack-fleet[bot]', type: 'Bot' };
  const SIG = 'repo:objectstack#1 · os-warren · session_01ABCDEFGH';
  const AUDIT = 'triage#1 · os-tri · session_01TRIAGEXY\n\n## Triage\n\narea · type · severity';
  let n = 100;
  const card = (labels, extra = {}) => ({
    number: ++n,
    title: `card ${n}`,
    labels: [QUEUE_LABEL, ...labels].map((name) => ({ name })),
    created_at: '2026-11-10T00:00:00Z',
    user: HUMAN,
    assignees: [],
    body: 'x',
    ...extra,
  });
  const run = (fixture, opts = {}) =>
    pick({ repo: REPO, items: parseOrder(opts.order ?? 'area:ux').items, seat: parseSeat(opts.seat ?? 'repo:objectstack#5'), limit: opts.limit ?? 10, why: opts.why ?? true, nowMs: NOW, get: opts.get ?? fixtureGet(fixture, REPO) });
  const nums = (rows) => rows.map((r) => r.issue.number);

  battery('the rule text: every phrase this file is built from is in the file that writes it');
  {
    const read = (p) => readFileSync(new URL(p, REPO_ROOT), 'utf8');
    t('⭐ NORTH-STAR "Priority" rule 3 still says what this file encodes (a reworded rule reds here)', RULE_PHRASES.filter((p) => !read(NORTH_STAR_PATH).includes(p)), []);
    t('execution-duties.md: the candidate definition, 取卡全序 and the same-grade order are its phrases', DUTIES_PHRASES.filter((p) => !read(DUTIES_PATH).includes(p)), []);
    t('state-machine.md: the line-start Blocked-by contract, a PR released by its merge only', STATE_MACHINE_PHRASES.filter((p) => !read(STATE_MACHINE_PATH).includes(p)), []);
    t('seat-lifecycle.md: the blocking-point vocabulary, and the pointer here', LIFECYCLE_PHRASES.filter((p) => !read(LIFECYCLE_PATH).includes(p)), []);
    t('the grade ladder this file names is the shared one', GRADE_LADDER.join(','), 'priority:p0,priority:p1,priority:p2,priority:p3');
  }

  battery('the grade legs: p0 above everything, p1 jumps the named order, the ungraded leg comes last');
  {
    const named2 = card(['area:ux', 'priority:p2'], { created_at: '2026-01-01T00:00:00Z' });
    const other1 = card(['area:build', 'priority:p1']);
    const p0 = card(['area:data', 'priority:p0']);
    const ungraded = card(['area:ux'], { created_at: '2025-01-01T00:00:00Z' });
    const outside2 = card(['area:build', 'priority:p2']);
    const comments = Object.fromEntries([named2, other1, p0, ungraded, outside2].map((c) => [c.number, [{ body: AUDIT }]]));
    const r = await run({ issues: [named2, ungraded, outside2, other1, p0], comments });
    t('⭐ p0 is first, past everything', nums(r.picks)[0], p0.number);
    t('⭐ an unnamed-area p1 beats a named-area p2', nums(r.picks).indexOf(other1.number) < nums(r.picks).indexOf(named2.number), true);
    t('the named-area p2 comes before the ungraded card in that area, however old', nums(r.picks).join(), [p0, other1, named2, ungraded].map((c) => c.number).join());
    t('a p2 outside the order is not a pick, and says why', r.others.find((o) => o.issue.number === outside2.number)?.reasons[0], 'outside --order (p2 · area:build)');
    t('the legs are named on the row', r.picks.map((p) => p.place.leg).join('|'), 'p0|p1 jump|order 1|ungraded');
    const r2 = await run({ issues: [named2, other1], comments }, { order: 'area:build,area:ux' });
    t('the order items are walked in the order given', nums(r2.picks).join(), [other1, named2].map((c) => c.number).join());
  }

  battery("p3: an area's close-out after every p2 of that item; an epic's children keep their child order");
  {
    const p3a = card(['area:ux', 'priority:p3'], { created_at: '2025-01-01T00:00:00Z' });
    const p3b = card(['area:ux', 'priority:p3']);
    const p2 = card(['area:ux', 'priority:p2']);
    const comments = Object.fromEntries([p3a, p3b, p2].map((c) => [c.number, [{ body: AUDIT }]]));
    const only = await run({ issues: [p3b, p3a], comments }, { limit: 10 });
    t('⭐ an area holding only p3 cards yields its p3 cards as picks, oldest first — never an empty queue', nums(only.picks).join(), [p3a, p3b].map((c) => c.number).join());
    const r = await run({ issues: [p3b, p2, p3a], comments }, { limit: 10 });
    t('⭐ a p2 ranks ahead of every p3 in the same item, an older p3 included', nums(r.picks).join(), [p2, p3a, p3b].map((c) => c.number).join());
    t('…and the p3 rows name their leg', r.picks.map((p) => p.place.leg).join('|'), 'order 1|order 1 p3 close-out|order 1 p3 close-out');
    const build2 = card(['area:build', 'priority:p2']);
    const ungraded = card(['area:ux'], { created_at: '2024-01-01T00:00:00Z' });
    const c2 = { ...comments, [build2.number]: [{ body: AUDIT }], [ungraded.number]: [{ body: AUDIT }] };
    const two = await run({ issues: [build2, p3a, ungraded], comments: c2 }, { order: 'area:ux,area:build' });
    t("an item's p3 closes that item before the next item's p2; the ungraded leg still comes last", nums(two.picks).join(), [p3a, build2, ungraded].map((c) => c.number).join());
    const out = await run({ issues: [p3a], comments }, { order: 'area:build' });
    t('a p3 outside the order is not a pick, and says why', [out.picks.length, out.others[0]?.reasons[0]], [0, 'outside --order (p3 · area:ux)']);
    const e3 = card(['priority:p3']);
    const e2 = card(['priority:p2']);
    const ec = Object.fromEntries([e3, e2].map((c) => [c.number, [{ body: AUDIT }]]));
    const er = await run({ issues: [e2, e3], comments: ec, sub_issues: { 600: [e3, e2].map((c) => ({ number: c.number })) }, rows: { [`${REPO}#600`]: { number: 600, labels: [] } } }, { order: 'epic:#600' });
    t("⭐ an epic's children follow child order whatever the grade: a p3 first child ranks ahead of a p2 second child", nums(er.picks).join(), [e3, e2].map((c) => c.number).join());
    t('…under the epic child leg, never the close-out leg', er.picks.map((p) => p.place.leg).join('|'), 'epic child 1|epic child 2');
  }

  battery('Blocked-by: an open target holds, a closed-unmerged PR holds, a merged PR and a closed issue release, cross-repo is read');
  {
    const onOpen = card(['area:ux', 'priority:p2'], { body: 'Blocked-by: #900' });
    const onAbandoned = card(['area:ux', 'priority:p2'], { body: 'Blocked-by: #901' });
    const onMerged = card(['area:ux', 'priority:p2'], { body: 'Blocked-by: #902' });
    const onClosed = card(['area:ux', 'priority:p2'], { body: 'Blocked-by: #903' });
    const onComment = card(['area:ux', 'priority:p2']);
    const crossRepo = card(['area:ux', 'priority:p2'], { body: 'Blocked-by: objectstack-ai/cloud#77' });
    const rows = {
      [`${REPO}#900`]: { number: 900, state: 'open' },
      [`${REPO}#901`]: { number: 901, state: 'closed', pull_request: { merged_at: null } },
      [`${REPO}#902`]: { number: 902, state: 'closed', pull_request: { merged_at: '2026-11-18T00:00:00Z' } },
      [`${REPO}#903`]: { number: 903, state: 'closed' },
      'objectstack-ai/cloud#77': { number: 77, state: 'open' },
    };
    const all = [onOpen, onAbandoned, onMerged, onClosed, onComment, crossRepo];
    const comments = Object.fromEntries(all.map((c) => [c.number, [{ body: AUDIT }]]));
    comments[onComment.number].push({ body: 'Blocked-by: #900', created_at: '2026-11-18T00:00:00Z' });
    const asked = [];
    const base = fixtureGet({ issues: all, comments, rows }, REPO);
    const r = await run(null, { get: (p) => (asked.push(p), base(p)) });
    const why = (c) => r.others.find((o) => o.issue.number === c.number)?.reasons.join('; ') ?? 'PICKED';
    t('⭐ an open Blocked-by target excludes the card', why(onOpen), 'Blocked-by: #900 (open)');
    t('⭐ a closed-but-unmerged PR target still blocks', why(onAbandoned), 'Blocked-by: #901 (PR closed unmerged — the block stays)');
    t('a merged PR target releases', why(onMerged), 'PICKED');
    t('a closed issue target releases', why(onClosed), 'PICKED');
    t('a Blocked-by: line in a COMMENT holds too', why(onComment), 'Blocked-by: #900 (open)');
    t('⭐ a cross-repo target is read from its own repo', [why(crossRepo), asked.includes('/repos/objectstack-ai/cloud/issues/77')], ['Blocked-by: objectstack-ai/cloud#77 (open)', true]);
    t('one target named twice is read once', asked.filter((p) => p === `/repos/${REPO}/issues/900`).length, 1);
  }

  battery('the same-grade order and the epic child order');
  {
    const fleetOld = card(['area:ux', 'priority:p2'], { user: APP, created_at: '2025-01-01T00:00:00Z' });
    const humanNew = card(['area:ux', 'priority:p2'], { created_at: '2026-11-01T00:00:00Z' });
    const humanBug = card(['area:ux', 'priority:p2'], { created_at: '2026-11-05T00:00:00Z', type: { name: 'Bug' } });
    const humanOld = card(['area:ux', 'priority:p2'], { created_at: '2026-10-01T00:00:00Z' });
    const signed = card(['area:ux', 'priority:p2'], { created_at: '2024-01-01T00:00:00Z', body: `${SIG}\n\nbody` });
    const all = [fleetOld, humanNew, humanBug, humanOld, signed];
    const comments = Object.fromEntries(all.map((c) => [c.number, [{ body: AUDIT }]]));
    const r = await run({ issues: all, comments });
    t('⭐ non-fleet first, then Bug, then the card opened first; a seat-signed body reads as the fleet\'s', nums(r.picks).join(), [humanBug, humanOld, humanNew, signed, fleetOld].map((c) => c.number).join());
    const c1 = card(['priority:p2'], { created_at: '2026-11-11T00:00:00Z' });
    const c2 = card(['priority:p2'], { created_at: '2026-01-01T00:00:00Z' });
    const c3 = card([], {});
    const epicIssues = [c1, c2, c3];
    const ec = Object.fromEntries(epicIssues.map((c) => [c.number, [{ body: AUDIT }]]));
    const er = await run({ issues: epicIssues, comments: ec, sub_issues: { 500: [c3, c1, c2].map((c) => ({ number: c.number })) }, rows: { [`${REPO}#500`]: { number: 500, labels: [] } } }, { order: 'epic:#500' });
    t('⭐ inside an epic the child order rules, not the age and not the grade', nums(er.picks).join(), [c3, c1, c2].map((c) => c.number).join());
    t('…and the row names its child position', er.picks[0].place.leg, 'epic child 1');
    const jump = card(['priority:p1']);
    const jr = await run({ issues: [...epicIssues, jump], comments: { ...ec, [jump.number]: [] }, sub_issues: { 500: [c3, c1, c2, jump].map((c) => ({ number: c.number })) } }, { order: 'epic:#500' });
    t('a p1 child jumps its own epic\'s order', [nums(jr.picks)[0], jr.picks[0].place.leg], [jump.number, 'p1 jump']);
    const gone = await run({ issues: epicIssues, comments: ec }, { order: 'epic:#501' });
    t('an epic whose children cannot be read is a named gap, never an empty leg read as clean', [gone.complete, gone.incomplete[0]?.startsWith('epic:#501')], [false, true]);
  }

  battery('the candidate definition: label reasons, claims and the triage audit');
  {
    t('an assignee is not a candidate', labelReasons(card([], { assignees: [{ login: 'os-bill' }] })), ['assigned (os-bill)']);
    t('needs-user-decision and pm:retriage are not candidates', labelReasons(card([DECISION_INBOX_LABEL, 'pm:retriage'])), [DECISION_INBOX_LABEL, 'pm:retriage']);
    t('an epic or tracking parent is not a candidate', labelReasons(card(['pm:epic'])), ['pm:epic parent']);
    t('a second pm state is named', labelReasons(card(['pm:blocked'])), ['second pm state pm:blocked']);
    const claim = (sig, at = '2026-11-18T00:00:00Z') => ({ body: `${sig}\n\nClaim: round 1\nBranch: x`, created_at: at });
    t('⭐ another seat\'s Claim: excludes', claimReason([claim(SIG)], parseSeat('repo:objectstack#5')), 'Claim: by repo:objectstack#1');
    t('this seat\'s own Claim: reads as already yours', claimReason([claim(SIG)], parseSeat('repo:objectstack#1')), 'Claim: by this seat (repo:objectstack#1) — already yours, not a new pick');
    t('a Release: after the Claim: frees the card', claimReason([claim(SIG), { body: 'Release: session gone · back to queue', created_at: '2026-11-18T05:00:00Z' }], null), null);
    const fleetCard = card(['area:ux', 'priority:p2'], { user: APP });
    const r = await run({ issues: [fleetCard], comments: { [fleetCard.number]: [{ body: 'just a note' }] } });
    t('⭐ a fleet card with no triage audit record is not a candidate', r.others[0]?.reasons, ['no triage audit — knock triage']);
    const r2 = await run({ issues: [{ ...fleetCard }], comments: { [fleetCard.number]: [{ body: AUDIT }] } });
    t('…and its audit record makes it one', nums(r2.picks), [fleetCard.number]);
  }

  battery('the walk: every page, the count checked, the limit and --why');
  {
    const many = Array.from({ length: 130 }, () => card(['area:ux', 'priority:p2']));
    const comments = Object.fromEntries(many.map((c) => [c.number, [{ body: AUDIT }]]));
    const r = await run({ issues: many, comments }, { limit: 3, why: false });
    t('every page is walked (130 cards over two pages)', [r.enumerated, r.reads.pages], [130, 2]);
    t('⭐ without --why the walk stops reading at --limit and counts the rest', [r.picks.length, r.reads.threads, r.notReached], [3, 3, 127]);
    const w = await run({ issues: many, comments }, { limit: 3, why: true });
    t('with --why every card the order reaches is read and the rest named', [w.reads.threads, w.others.length], [130, 127]);
    t('a candidate below the limit says so', w.others[0].reasons[0], 'below --limit 3 (a candidate)');
    const gap = await run({ issues: many.slice(0, 2), comments, total_count: 5 }, { why: false });
    t('⭐ a count gap is INCOMPLETE, never clean', [gap.complete, gap.incomplete[0]], [false, `the walk returned 2 ${QUEUE_LABEL} issue(s) and the platform counts 5`]);
    const dead = await run(null, { get: () => ({ ok: false, error: 'HTTP 403' }) });
    t('an unreadable queue is a prerequisite, nothing ranked', Boolean(dead.prerequisite), true);
    const unread = await run({ issues: [many[0]], comments: { [many[0].number]: null } }, { why: false });
    t('a thread that cannot be read holds the card, makes the run INCOMPLETE, and the held card is printed without --why', [unread.picks.length, unread.complete, nums(unread.held), renderText(unread).includes(`#${many[0].number} · p2`)], [0, false, [many[0].number], true]);
    const onUnread = card(['area:ux', 'priority:p2'], { body: 'Blocked-by: #904' });
    const ur = await run({ issues: [onUnread], comments: { [onUnread.number]: [{ body: AUDIT }] }, rows: { [`${REPO}#904`]: null } }, { why: false });
    t('⭐ an unreadable Blocked-by: target holds the card AND makes the run INCOMPLETE, the gap named', [ur.picks.length, ur.complete, ur.incomplete[0]], [0, false, `#${onUnread.number}'s Blocked-by: #904 could not be read (HTTP 502)`]);
    t('⭐ …and the held card is printed without --why', [renderText(ur).includes('Held by a read that did not answer — 1 card(s)'), renderText(ur).includes(`#${onUnread.number} · p2`)], [true, true]);
    const orphan = card(['area:ux', 'priority:p2'], { user: APP });
    const pr = await run({ issues: [orphan], comments: { [orphan.number]: [{ body: 'just a note' }] }, parents: { [orphan.number]: null } }, { why: false });
    t('⭐ an unreadable sub-issue parent makes the run INCOMPLETE, the gap named, the held card printed without --why', [pr.complete, pr.incomplete[0], nums(pr.held), renderText(pr).includes('no triage audit (parent unreadable — unjudged, held)')], [false, `#${orphan.number}'s sub-issue parent could not be read`, [orphan.number], true]);
    const quietRun = await run({ issues: [many[0]], comments }, { why: false });
    t('a complete run prints no held block', [quietRun.complete, renderText(quietRun).includes('Held by a read')], [true, false]);
  }

  battery('the CLI: usage, exits and the footer');
  {
    t('--order is required', Boolean(parseArgs([]).error), true);
    t('a malformed --order item is refused', Boolean(parseArgs(['--order', 'ux']).error), true);
    t('a malformed --seat is refused', Boolean(parseArgs(['--order', 'area:ux', '--seat', 'five']).error), true);
    t('an unknown flag is refused, never ignored', Boolean(parseArgs(['--order', 'area:ux', '--lane', 'x']).error), true);
    t('both spellings of an option are read', [parseArgs(['--order=area:ux', '--limit=2']).opts.limit, parseArgs(['--order', 'epic:#7']).opts.order[0].number], [2, 7]);
    t('--order as the last argument with no value is a usage error; --order "" is the p0/p1-only order', [Boolean(parseArgs(['--order']).error), parseArgs(['--order', '']).opts?.order], [true, []]);
    t('--seat reads every lane a seat signature carries, an epic seat\'s epic:#N included', [parseSeat('epic:#35205#1')?.name, parseSeat('domain:ui#2')?.name, parseSeat('area:ux#1'), parseSeat('repo:objectstack#5 x')], ['epic:#35205#1', 'domain:ui#2', null, null]);
    t('⭐ the footer names lane ownership and the sub-epic an area item holds, beside the five legs it named before', [UNREAD_LEGS.length, UNREAD_LEGS.some((l) => l.startsWith('lane ownership — ')), UNREAD_LEGS.some((l) => l.startsWith('an area item that holds a sub-epic — '))], [7, true, true]);
    const c = card(['area:ux', 'priority:p2', 'domain:ui']);
    const ok = await quiet(main)(['--order', 'area:ux'], { get: fixtureGet({ issues: [c], comments: { [c.number]: [] } }, REPO), nowMs: NOW });
    t('a complete run exits 0', ok.code, EXIT_OK);
    t('⭐ each row prints its domain:* label, so the seat reads lane ownership off the row', ok.out.includes(`#${c.number} · p2 · area:ux · domain:ui · `), true);
    t('⭐ every run names the legs it cannot read', UNREAD_LEGS.every((l) => ok.out.includes(l)), true);
    const down = await quiet(main)(['--order', 'area:ux'], { get: () => ({ ok: false, error: 'HTTP 403' }) });
    t('an unread queue exits 3, a usage error 2', [down.code, (await quiet(main)(['--bogus'])).code], [EXIT_PREREQUISITE, EXIT_USAGE]);
  }

  const failed = cases.filter((x) => !x.ok);
  for (const f of failed) console.error(`  ✗ ${f.name} — ${f.detail}`);
  const floor = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor.push(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR}`);
  for (const [name, count] of batteryCases) if (!(name in SELF_TEST_BATTERIES)) floor.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES`);
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) floor.push(count === 0 ? `self-test battery "${name}" DID NOT RUN` : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}`);
  }
  for (const f of floor) console.error(`  ✗ ${f}`);
  if (failed.length || floor.length) {
    console.error(`✗ card-pick self-test: ${failed.length} of ${cases.length} case(s) failed${floor.length ? `, ${floor.length} floor breach(es)` : ''}.`);
    selfTestReachedVerdict = true;
    return EXIT_SELF_TEST_FAILED;
  }
  console.log(`✓ card-pick self-test: ${cases.length} cases pass across ${declared.length} batteries — offline, no network.`);
  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    selfTest().then((code) => {
      if (!selfTestReachedVerdict) {
        console.error('\n✗ card-pick self-test: selfTest() returned without reaching its verdict, so no success line was\nprinted. Exiting 0 here would report a self-test that never finished as one that passed.\n');
        process.exit(1);
      }
      process.exit(code);
    });
  } else {
    main(argv).then((code) => process.exit(code));
  }
}
