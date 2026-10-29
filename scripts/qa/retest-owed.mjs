#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * retest-owed — which checklist items does a landed QA-sourced fix still owe a
 * retest?
 *
 *   node scripts/qa/retest-owed.mjs                  # the table (reads GitHub, writes nothing)
 *   node scripts/qa/retest-owed.mjs --json           # the same rows, machine-readable
 *   node scripts/qa/retest-owed.mjs --as-of <ISO>    # the answer as it stood at that instant
 *   node scripts/qa/retest-owed.mjs --repo <o/r>     # another repository (default objectstack-ai/objectstack)
 *   node scripts/qa/retest-owed.mjs --self-test      # the pure core, offline
 *
 * ## What this answers
 *
 * `checklist-test` SKILL §5 trigger 2 says the seat accepting a QA-extracted
 * fix appends the affected items to the wave anchor's retest list. That step is
 * discipline, and discipline nobody performs leaves the list empty while the
 * fixes land: on one release wave twenty such fix cards closed and the anchor's
 * retest list still read "None yet". This reader computes the list instead.
 *
 * A fix card is any CLOSED issue whose body carries a §5 provenance line
 *
 *   QA-source: #RECORD · area.item · clause
 *
 * and it OWES a retest when it closed after the subject commit of the newest
 * `qa-run` record that judged `area.item`. Per item the output names the fix
 * card(s), the record that last judged the item, and whether a record whose
 * subject postdates the fix has already re-judged it.
 *
 * ## It is a generated VIEW, and it writes nothing
 *
 * Same rule as `qa-rollup.mjs`: no cache, no snapshot, no state file, and ⛔ no
 * GitHub write of any kind. The issues stay the only source of truth; re-run it
 * and you get today's answer. Appending its rows to an anchor, or running the
 * owed items, is a session's act, never this script's.
 *
 * ## Why a separate script and not a `qa-rollup` mode
 *
 * `qa-rollup` reads record TITLES and promises, in its header and on every
 * render, that it parses no body. This question cannot be answered from titles:
 * which items a record judged lives in its body, and which fix a card made lives
 * in the card's body. A mode that read bodies would break the promise the
 * roll-up prints. What the two share is the title contract, so this file
 * imports `parseRunTitle` rather than growing a second reader of it.
 *
 * ## What "the record judged the item" means here, and its blind side
 *
 * Record bodies are not one shape (measured over 160 records: per-item tables,
 * per-clause tables, `### area.item — PASS` headings, verdict bullets, prose).
 * So a record counts as judging an item on any of three facts, and on nothing
 * else:
 *
 *   1. it is the record a fix card's `QA-source:` line names for that item;
 *   2. its title selector IS the item id and declares a PASS, PARTIAL or FAIL;
 *   3. one of its body lines names the item as the line's FIRST checklist id
 *      and carries an oracle-consulted verdict word (pass / partial / fail and
 *      their inflections), and the same line says nothing about not-run.
 *
 * `blocked` and `not-run` are not judgments: RUNNER's verdicts say nothing was
 * consulted. Protocol lines (`QA-source:`, `Carried-forward:`, `Extracted:`,
 * `Parked-on:`, `Superseded-by:`) are skipped: a carried verdict is not a new
 * one.
 *
 * Every miss of rule 3 lands on the SAFE side: a re-judgment written in a shape
 * the rule cannot see leaves the item OWED, never cleared. When a later record
 * names the item without a readable verdict line, the row says so
 * ("unconfirmed: #N names it"), so a reader knows which record to open. What the
 * rule can get wrong in the unsafe direction is a verdict line that names the
 * item first while judging something else; the first-id rule and the not-run
 * veto keep that narrow, and the self-test pins both.
 *
 * Per-item ids are read in their bare `area.item` form only — the one locator
 * §5 prescribes for record tables, extraction cards and the resolver alike. A
 * record that wrote area-local short ids is invisible to rule 3.
 *
 * ## The post-publish npm smoke
 *
 * A `QA-source:` line whose locator is `smoke:npm-VERSION` names a cell of a
 * published-package smoke, not a checklist item. Its retest is the NEXT such
 * smoke, so it is re-judged by any `smoke:npm-*` record whose subject postdates
 * the fix. Any other non-item locator is listed under "not read", never dropped.
 *
 * ## Time is three-valued, because a sha cannot always be resolved
 *
 * A record's subject time is the committer time of its title's `sha8`, read
 * from the local clone first and from the REST commits endpoint second (cloud
 * clones are shallow). When neither answers, the record's `created_at` still
 * bounds it from above: a run cannot test a commit that did not exist yet. So
 * an unresolved record created before the fix closed cannot clear it, and one
 * created after it makes the row `unknown` rather than owed or cleared.
 *
 * ## Cost, and the endpoints it is allowed to use
 *
 * Repository-scoped REST only: cloud sessions are bound to their repositories
 * and refuse the search API and the `/repositories/ID/...` form of the next
 * links GitHub returns (measured: 403). Page numbers are no way round it —
 * they stop at 10,000 results (measured: `page=100` answers 422). So a listing
 * follows each `rel="next"` link with its query carried onto the
 * `/repos/OWNER/REPO/...` path it started from.
 *
 *   - the `qa-run` records: one call per 100 (2 calls for 160 records);
 *   - closed issues updated since the oldest record was filed — a fix card can
 *     only cite a record that already existed, so that bound is exact
 *     (measured: 99 calls, about two minutes, for 9,900 issues and PRs);
 *   - one commits call per subject sha the local clone lacks.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isEntrypoint } from '../invoked-as.mjs';
import { authHint, isUsableToken, parseRunTitle } from './qa-rollup.mjs';

// ── The self-test's own battery roster and floor ────────────────────────────
//
// Copied from `qa-rollup.mjs`, never imported (AGENTS.md "Writing a
// `--self-test`"): what is pinned is the registered battery NAMES, each at or
// above its own count, and the roster's size. A pinned TOTAL would stay
// "right" while one battery fell from 9 cases to 3.
const SELF_TEST_BATTERIES = Object.freeze({
  'QA-source lines are read in their one shape': 9,
  'locator kinds': 5,
  'a record judges an item only on a verdict line': 12,
  'owed, re-judged and unknown are decided on subject time': 9,
  'npm smoke cells are re-judged by the next smoke': 3,
  'nothing read is dropped': 6,
  'as-of replays the past': 3,
  'the render names every section': 8,
  'a listing stays on the repository path': 2,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 9;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference.
const UNATTRIBUTED_BATTERY = '(no battery open)';

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/** The floor: every declared battery ran, and ran its cases. */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

const SEP = '·'; // MIDDLE DOT, the field separator §5 and the record titles use

/** A bare checklist id, `area.item`: two kebab-case segments joined by one dot. */
const ITEM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The same shape, found inside a line; a following `.x` makes it a filename, not an id. */
const ITEM_ID_IN_TEXT = /(?<![A-Za-z0-9._/-])[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*(?![A-Za-z0-9_-]|\.[A-Za-z0-9])/g;

/** The published-package smoke's selector, `smoke:npm-VERSION`. */
const NPM_SMOKE = /^smoke:npm-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

/** An oracle-consulted verdict word (RUNNER "Verdicts": `blocked` / `not-run` consulted nothing). */
const JUDGED_WORD = /\b(pass|passes|passed|partial|fail|fails|failed)\b/i;

/** A line that also speaks of not running: never read as a judgment. */
const NOT_RUN_WORD = /\bnot[- ]run\b/i;

/** §5's machine lines, and the RUNNER carry-forward: they cite verdicts, they do not make them. */
const PROTOCOL_LINE = /^\s*(?:[-*>]\s*)?(?:QA-source|Carried-forward|Extracted|Parked-on|Superseded-by):/i;

/** A closed issue whose close is not a landed fix. */
const NOT_A_LANDING = new Set(['not_planned', 'duplicate']);

/**
 * Read every `QA-source:` line out of a card body.
 *
 * Strict, like the title contract: a line is a provenance line only when it
 * STARTS with `QA-source:` (prose that quotes one — "carry a `QA-source:` line"
 * — is not one), and it is read only in §5's one shape, three `·` fields:
 * `#RECORD` (or `owner/repo#RECORD`), a locator, a clause. Anything else is
 * returned as `malformed` with the reason, so the caller lists it.
 *
 * Pure.
 *
 * @param {string|null|undefined} body
 * @returns {{entries: Array<{repo: string|null, record: number, locator: string,
 *            kind: string, clause: string, line: string}>,
 *            malformed: Array<{line: string, reason: string}>}}
 */
export function parseQaSourceLines(body) {
  const entries = [];
  const malformed = [];
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    const m = /^\s*QA-source:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const line = raw.trim();
    const fields = m[1].split(SEP).map((f) => f.trim());
    if (fields.length !== 3) {
      malformed.push({ line, reason: `${fields.length} ${SEP}-separated field(s), expected 3 (#RECORD ${SEP} area.item ${SEP} clause)` });
      continue;
    }
    const [refField, locator, clause] = fields;
    const ref = /^(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#(\d+)$/.exec(refField);
    if (!ref) {
      malformed.push({ line, reason: `record field ${JSON.stringify(refField)} is not #N or owner/repo#N` });
      continue;
    }
    if (locator === '' || clause === '') {
      malformed.push({ line, reason: 'empty locator or clause field' });
      continue;
    }
    entries.push({ repo: ref[1] ?? null, record: Number(ref[2]), locator, kind: locatorKind(locator), clause, line });
  }
  return { entries, malformed };
}

/**
 * What a `QA-source:` locator names.
 *
 * @param {string} locator
 * @returns {'item'|'npm-smoke'|'unrecognized'}
 */
export function locatorKind(locator) {
  if (ITEM_ID.test(locator)) return 'item';
  if (NPM_SMOKE.test(locator)) return 'npm-smoke';
  return 'unrecognized';
}

/**
 * Which checklist items one record judged, and with which verdict words —
 * facts 2 and 3 of the header (fact 1 comes from the cards, not the record).
 *
 * `areas` is the checklist's area vocabulary: an id-shaped token whose area is
 * not a checklist area (a hostname, a dotted config key) is not an item.
 *
 * Pure.
 *
 * @param {{title: string, body?: string|null}} record
 * @param {Set<string>} areas
 * @returns {{judged: Map<string, Set<string>>, mentioned: Set<string>}}
 */
export function readRecordItems(record, areas) {
  const judged = new Map();
  const mentioned = new Set();
  const mark = (id, word) => {
    if (!judged.has(id)) judged.set(id, new Set());
    judged.get(id).add(word);
  };

  const parsed = parseRunTitle(record.title);
  if (parsed.ok) {
    const id = parsed.selector.replace(/^item:/, '');
    if (ITEM_ID.test(id) && areas.has(id.split('.')[0])) {
      mentioned.add(id);
      for (const word of ['PASS', 'PARTIAL', 'FAIL']) {
        if ((parsed.counts[word] ?? 0) > 0) mark(id, word.toLowerCase());
      }
    }
  }

  for (const raw of String(record.body ?? '').split(/\r?\n/)) {
    if (PROTOCOL_LINE.test(raw)) continue;
    const line = raw.replace(/[`*]/g, '');
    const ids = (line.match(ITEM_ID_IN_TEXT) ?? []).filter((id) => areas.has(id.split('.')[0]));
    if (ids.length === 0) continue;
    for (const id of ids) mentioned.add(id);
    if (NOT_RUN_WORD.test(line)) continue;
    const word = JUDGED_WORD.exec(line);
    if (!word) continue;
    mark(ids[0], normaliseVerdict(word[1]));
  }
  return { judged, mentioned };
}

function normaliseVerdict(word) {
  const w = word.toLowerCase();
  if (w.startsWith('pass')) return 'pass';
  if (w.startsWith('fail')) return 'fail';
  return 'partial';
}

/**
 * The item verdict RUNNER would derive from the words a record wrote for it:
 * any fail → FAIL; only pass → PASS; anything else judged → PARTIAL. Display
 * only — whether a record judged at all is what decides a row.
 *
 * @param {Set<string>} words
 * @returns {string}
 */
export function deriveVerdict(words) {
  if (words.has('fail')) return 'FAIL';
  if ([...words].every((w) => w === 'pass')) return 'PASS';
  return 'PARTIAL';
}

/**
 * Decide every row.
 *
 * Pure: the cards, the records and the subject times arrive as plain data, so
 * the self-test drives every branch, including the ones no live corpus shows on
 * the day it is run.
 *
 * @param {object} input
 * @param {Array<{number: number, title?: string, body?: string, state: string,
 *         state_reason?: string|null, closed_at?: string|null}>} input.cards
 *        closed issues carrying a `QA-source:` line
 * @param {Array<{number: number, title: string, body?: string, created_at: string}>} input.records
 *        the `qa-run` records
 * @param {Map<string, string|null>} input.subjectTimes sha8 → ISO committer time, null when unresolved
 * @param {Set<string>} input.areas the checklist's area vocabulary
 * @param {Map<string, string>} [input.itemStatus] item id → its checklist `status`
 * @param {string|null} [input.asOf] ISO instant; records filed and cards closed after it are ignored
 * @param {string} [input.repo] the repository the records live in
 * @returns {{owed: object[], unknown: object[], rejudged: object[],
 *            notRead: object[], notLanded: object[]}}
 */
export function computeRetestOwed({ cards, records, subjectTimes, areas, itemStatus = new Map(), asOf = null, repo = '' }) {
  const before = (iso) => asOf === null || (typeof iso === 'string' && iso <= asOf);

  const recs = records
    .filter((r) => before(r.created_at))
    .map((r) => {
      const parsed = parseRunTitle(r.title);
      const items = readRecordItems(r, areas);
      const sha = parsed.ok ? parsed.sha : null;
      return {
        number: r.number,
        createdAt: r.created_at,
        selector: parsed.ok ? parsed.selector : null,
        sha,
        subjectTime: sha ? (subjectTimes.get(sha) ?? null) : null,
        ...items,
      };
    });
  const byNumber = new Map(recs.map((r) => [r.number, r]));

  const notRead = [];
  const notLanded = [];
  // key → { kind, item, label, cards: [{card, entry}] }
  const groups = new Map();

  for (const card of cards) {
    if (card.state !== 'closed' || !before(card.closed_at)) continue;
    const { entries, malformed } = parseQaSourceLines(card.body);
    if (NOT_A_LANDING.has(card.state_reason ?? '')) {
      notLanded.push({ card: card.number, stateReason: card.state_reason, closedAt: card.closed_at });
      continue;
    }
    for (const m of malformed) notRead.push({ card: card.number, line: m.line, reason: m.reason });
    for (const entry of entries) {
      if (entry.repo && repo && entry.repo !== repo) {
        notRead.push({ card: card.number, line: entry.line, reason: `the record lives in ${entry.repo}, not ${repo}` });
        continue;
      }
      if (entry.kind === 'unrecognized') {
        notRead.push({
          card: card.number,
          line: entry.line,
          reason: `locator ${JSON.stringify(entry.locator)} is neither a checklist item id (area.item) nor smoke:npm-VERSION`,
        });
        continue;
      }
      const key = entry.kind === 'item' ? entry.locator : `${entry.locator} ${SEP} ${entry.clause}`;
      if (!groups.has(key)) groups.set(key, { kind: entry.kind, item: entry.locator, label: key, cards: [] });
      groups.get(key).cards.push({ card, entry });
    }
  }

  // The time a record's subject is known to be no later than: its committer
  // time when resolved, else its own filing time (an upper bound).
  const upperBound = (r) => r.subjectTime ?? r.createdAt;

  const owed = [];
  const unknown = [];
  const rejudged = [];

  for (const group of [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))) {
    const judgesFor = (entry) => {
      const set = new Map();
      if (group.kind === 'item') {
        for (const r of recs) if (r.judged.has(group.item)) set.set(r.number, r);
      } else {
        for (const r of recs) if (r.selector && /^smoke:npm-/.test(r.selector)) set.set(r.number, r);
      }
      const source = byNumber.get(entry.record);
      if (source) set.set(source.number, source);
      return [...set.values()];
    };

    const perCard = group.cards.map(({ card, entry }) => {
      const closedAt = card.closed_at;
      const judges = judgesFor(entry);
      const after = judges
        .filter((r) => r.subjectTime && r.subjectTime > closedAt)
        .sort((a, b) => a.subjectTime.localeCompare(b.subjectTime) || a.number - b.number);
      const maybe = judges.filter((r) => !r.subjectTime && r.createdAt > closedAt);
      const last = [...judges].sort((a, b) => upperBound(b).localeCompare(upperBound(a)) || b.number - a.number)[0] ?? null;
      let status = 'owed';
      if (after.length) status = 'rejudged';
      else if (maybe.length) status = 'unknown';
      const mentionedBy = status === 'owed' && group.kind === 'item'
        ? recs
          .filter((r) => !r.judged.has(group.item) && r.mentioned.has(group.item) && upperBound(r) > closedAt)
          .map((r) => r.number)
          .sort((a, b) => a - b)
        : [];
      return {
        card: card.number,
        closedAt,
        record: entry.record,
        clause: entry.clause,
        status,
        last,
        rejudgedBy: after[0] ?? null,
        unresolved: maybe.map((r) => r.number),
        mentionedBy,
      };
    });

    for (const status of ['owed', 'unknown', 'rejudged']) {
      const these = perCard.filter((c) => c.status === status);
      if (these.length === 0) continue;
      const last = these.map((c) => c.last).filter(Boolean)
        .sort((a, b) => upperBound(b).localeCompare(upperBound(a)) || b.number - a.number)[0] ?? null;
      const row = {
        item: group.label,
        kind: group.kind,
        itemStatus: group.kind === 'item' ? (itemStatus.get(group.item) ?? 'absent') : null,
        fixCards: these.map((c) => ({ number: c.card, closedAt: c.closedAt, record: c.record, clause: c.clause })),
        lastJudged: last ? describeRecord(last, group) : null,
        rejudgedBy: status === 'rejudged'
          ? describeRecord(these.map((c) => c.rejudgedBy).sort((a, b) => b.subjectTime.localeCompare(a.subjectTime))[0], group)
          : null,
        unresolved: [...new Set(these.flatMap((c) => c.unresolved))].sort((a, b) => a - b),
        mentionedBy: [...new Set(these.flatMap((c) => c.mentionedBy))].sort((a, b) => a - b),
      };
      ({ owed, unknown, rejudged })[status].push(row);
    }
  }

  return { owed, unknown, rejudged, notRead, notLanded };
}

function describeRecord(r, group) {
  const words = group.kind === 'item' ? r.judged.get(group.item) : null;
  return {
    number: r.number,
    sha: r.sha,
    subjectTime: r.subjectTime,
    createdAt: r.createdAt,
    verdict: words && words.size ? deriveVerdict(words) : null,
  };
}

/**
 * Render the model as markdown, ready to paste into a wave anchor's retest list.
 *
 * Pure.
 *
 * @param {object} model
 * @returns {string}
 */
export function renderMarkdown(model) {
  const { computedOn, corpus, owed, unknown, rejudged, notRead, notLanded } = model;
  const L = [];
  const cardList = (row) => row.fixCards.map((c) => `#${c.number} (${c.closedAt.slice(0, 10)})`).join(', ');
  const rec = (d) => (d ? `#${d.number} \`${d.sha ?? '?'}\`${d.subjectTime ? ` ${d.subjectTime.slice(0, 10)}` : ' (subject unresolved)'}${d.verdict ? ` ${d.verdict}` : ''}` : '—');
  const itemCell = (row) => `\`${row.item}\`${row.itemStatus && row.itemStatus !== 'active' ? ` (${row.itemStatus})` : ''}`;

  L.push('## Retest owed — QA-sourced fixes that landed after the last verdict on their item');
  L.push('');
  L.push('_A generated view. Nothing is written anywhere; the `qa-run` records and the fix cards remain');
  L.push('the only source of truth. Re-run to refresh._');
  L.push('');
  L.push('**computedOn**');
  L.push('');
  L.push(`- repository: \`${computedOn.repo}\``);
  L.push(`- as of: ${computedOn.asOf ?? 'now'}`);
  L.push(`- records: ${corpus.records} \`qa-run\` records (${corpus.recordsParsed} with a canonical title)`);
  L.push(`- fix cards: ${corpus.cards} closed issues carry a \`QA-source:\` line, out of ${corpus.scanned} closed issues and PRs updated since ${corpus.since}`);
  L.push(`- subject times: ${corpus.shasResolved}/${corpus.shas} subject shas resolved`);
  L.push(`- API: ${computedOn.apiCalls} REST call(s), repository-scoped`);
  L.push(`- generated: ${computedOn.generatedAt}`);
  L.push('');

  L.push(`### Owed — ${owed.length} row(s)`);
  L.push('');
  if (owed.length === 0) {
    L.push('Every landed QA-sourced fix has been re-judged by a record whose subject postdates it.');
  } else {
    L.push('| item | fix card(s) | last judged by | re-judged? |');
    L.push('|---|---|---|---|');
    for (const row of owed) {
      const note = row.mentionedBy.length ? `no — unconfirmed: ${row.mentionedBy.map((n) => `#${n}`).join(', ')} names it without a verdict line` : 'no';
      L.push(`| ${itemCell(row)} | ${cardList(row)} | ${rec(row.lastJudged)} | ${note} |`);
    }
  }
  L.push('');

  if (unknown.length > 0) {
    L.push(`### Unknown — ${unknown.length} row(s)`);
    L.push('');
    L.push('A record filed after the fix closed may have re-judged the item, but its subject sha did not');
    L.push('resolve, so whether its subject postdates the fix cannot be told. Never counted as re-judged.');
    L.push('');
    L.push('| item | fix card(s) | unresolved record(s) |');
    L.push('|---|---|---|');
    for (const row of unknown) L.push(`| ${itemCell(row)} | ${cardList(row)} | ${row.unresolved.map((n) => `#${n}`).join(', ')} |`);
    L.push('');
  }

  L.push(`### Re-judged — ${rejudged.length} row(s)`);
  L.push('');
  if (rejudged.length > 0) {
    L.push('| item | fix card(s) | re-judged by |');
    L.push('|---|---|---|');
    for (const row of rejudged) L.push(`| ${itemCell(row)} | ${cardList(row)} | ${rec(row.rejudgedBy)} |`);
  } else {
    L.push('None.');
  }
  L.push('');

  L.push(`### Not read — ${notRead.length} line(s)`);
  L.push('');
  if (notRead.length > 0) {
    L.push('`QA-source:` lines this reader cannot place on a checklist item or an npm smoke cell. Listed,');
    L.push('never dropped: each is a provenance line to correct, or a retest to track by hand.');
    L.push('');
    L.push('| card | line | why |');
    L.push('|---|---|---|');
    for (const n of notRead) L.push(`| #${n.card} | ${escapeCell(n.line)} | ${escapeCell(n.reason)} |`);
  } else {
    L.push('None.');
  }
  L.push('');

  L.push(`### Closed without a fix — ${notLanded.length} card(s)`);
  L.push('');
  L.push(notLanded.length
    ? `${notLanded.map((n) => `#${n.card} (${n.stateReason})`).join(', ')} — closed as not planned or duplicate, so no fix landed and no retest is owed.`
    : 'None.');
  L.push('');

  L.push('### How a record counts as judging an item');
  L.push('');
  L.push('It is the record a fix card\'s `QA-source:` line names; or its title selector is the item id');
  L.push('with a PASS, PARTIAL or FAIL count; or one of its body lines names the item first and carries');
  L.push('a pass / partial / fail verdict with no not-run on the same line. A re-judgment written in any');
  L.push('other shape leaves the row owed — the safe side — and "unconfirmed" points at it.');
  return L.join('\n');
}

function escapeCell(s) {
  return String(s).replace(/\|/g, '\\|');
}

/* ------------------------------------------------------------------ *
 * I/O shell. Everything above is pure and self-tested; everything
 * below talks to git and to GitHub, and writes nothing anywhere.
 * ------------------------------------------------------------------ */

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return git(here, ['rev-parse', '--show-toplevel']) ?? join(here, '..', '..');
}

/** The checklist's area vocabulary and every item's status, read from the tree. */
export function readChecklist(root) {
  const dir = join(root, 'docs', 'qa', 'platform-checklist', 'areas');
  const areas = new Set();
  const itemStatus = new Map();
  if (!existsSync(dir)) return { areas, itemStatus };
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    areas.add(doc.area ?? file.replace(/\.json$/, ''));
    for (const it of doc.items ?? []) itemStatus.set(it.id, it.status);
  }
  return { areas, itemStatus };
}

function makeClient(token) {
  let calls = 0;
  const get = async (url) => {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'objectstack-retest-owed' };
    if (isUsableToken(token)) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    calls += 1;
    return res;
  };
  return { get, calls: () => calls };
}

/** Every page of a repository-scoped listing, following GitHub's next links (see the header). */
async function listAll(client, first) {
  const out = [];
  let url = `${first}${first.includes('?') ? '&' : '?'}per_page=100`;
  while (url) {
    const res = await client.get(url);
    if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}\n${authHint(res.status, process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '')}`);
    out.push(...(await res.json()));
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '');
    url = next ? onPathOf(url, next[1]) : null;
  }
  return out;
}

/** `next`'s query on `current`'s path: the `/repositories/ID` path GitHub links to is refused here. */
export function onPathOf(current, next) {
  const moved = new URL(current);
  moved.search = new URL(next).search;
  return moved.toString();
}

/** sha8 → committer time: the local clone first, the REST commits endpoint second. */
async function resolveSubjectTimes(client, root, repo, shas) {
  const times = new Map();
  for (const sha of shas) {
    const local = git(root, ['log', '-1', '--format=%cI', `${sha}^{commit}`]);
    if (local) {
      times.set(sha, new Date(local).toISOString().replace('.000Z', 'Z'));
      continue;
    }
    const res = await client.get(`https://api.github.com/repos/${repo}/commits/${sha}`);
    if (!res.ok) {
      times.set(sha, null);
      continue;
    }
    const body = await res.json();
    times.set(sha, body?.commit?.committer?.date ?? null);
  }
  return times;
}

async function main(argv) {
  const repo = valueOf(argv, '--repo') ?? 'objectstack-ai/objectstack';
  const asJson = argv.includes('--json');
  const asOfRaw = valueOf(argv, '--as-of');
  let asOf = null;
  if (asOfRaw !== null) {
    const t = new Date(asOfRaw);
    if (Number.isNaN(t.getTime())) {
      console.error(`retest-owed: --as-of ${JSON.stringify(asOfRaw)} is not a date or ISO instant`);
      process.exit(2);
    }
    asOf = t.toISOString().replace('.000Z', 'Z');
  }
  const root = repoRoot();
  const { areas, itemStatus } = readChecklist(root);
  if (areas.size === 0) {
    console.error('retest-owed: no checklist areas under docs/qa/platform-checklist/areas — refusing to read every id as unknown');
    process.exit(1);
  }
  const client = makeClient(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '');
  const api = `https://api.github.com/repos/${repo}`;

  const records = (await listAll(client, `${api}/issues?labels=qa-run&state=all`)).filter((i) => !i.pull_request);
  if (records.length === 0) {
    console.error(`retest-owed: no \`qa-run\` records in ${repo} — nothing could have judged anything`);
    process.exit(1);
  }
  const since = records.map((r) => r.created_at).sort()[0];
  const scanned = await listAll(client, `${api}/issues?state=closed&since=${encodeURIComponent(since)}`);
  const cards = scanned.filter((i) => !i.pull_request && /^\s*QA-source:/m.test(i.body ?? ''));

  const shas = [...new Set(records.map((r) => parseRunTitle(r.title)).filter((p) => p.ok).map((p) => p.sha))].sort();
  const subjectTimes = await resolveSubjectTimes(client, root, repo, shas);

  const result = computeRetestOwed({ cards, records, subjectTimes, areas, itemStatus, asOf, repo });
  const model = {
    computedOn: { repo, asOf, apiCalls: client.calls(), generatedAt: new Date().toISOString() },
    corpus: {
      records: records.length,
      recordsParsed: records.filter((r) => parseRunTitle(r.title).ok).length,
      since,
      scanned: scanned.length,
      cards: cards.length,
      shas: shas.length,
      shasResolved: [...subjectTimes.values()].filter(Boolean).length,
    },
    ...result,
  };
  process.stdout.write(asJson ? `${JSON.stringify(model, null, 2)}\n` : `${renderMarkdown(model)}\n`);
}

function valueOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/* ------------------------------------------------------------------ *
 * --self-test: the pure core, offline. No network, no git.
 * ------------------------------------------------------------------ */

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` above that line prints nothing and would still exit 0.
let selfTestReachedVerdict = false;

function selfTest() {
  const failures = [];
  let checked = 0;
  const check = (cond, msg) => {
    registerCase();
    checked += 1;
    if (!cond) failures.push(msg);
  };

  const AREAS = new Set(['records-forms', 'i18n', 'approvals', 'cli']);

  // --- QA-source lines are read in their one shape -----------------------
  battery('QA-source lines are read in their one shape');
  const canonical = parseQaSourceLines('Title line\n\nQA-source: #26450 · i18n.surface-matrix · n1\nmore');
  check(canonical.entries.length === 1 && canonical.malformed.length === 0, 'one canonical line → one entry');
  check(canonical.entries[0]?.record === 26450 && canonical.entries[0]?.locator === 'i18n.surface-matrix' && canonical.entries[0]?.clause === 'n1', 'record, locator and clause are read');
  const xrepo = parseQaSourceLines('QA-source: objectstack-ai/objectstack#25479 · approvals.record-page-decisions · negative[1]');
  check(xrepo.entries[0]?.repo === 'objectstack-ai/objectstack' && xrepo.entries[0]?.record === 25479, 'the owner/repo#N form names its repository');
  const quoted = parseQaSourceLines('- Carry `QA-source: #24783 · records-forms.x · acceptance[4]`, a revision bump');
  check(quoted.entries.length === 0 && quoted.malformed.length === 0, 'prose QUOTING a provenance line is not one');
  const twoField = parseQaSourceLines('QA-source: #26639 · observation 3');
  check(twoField.entries.length === 0 && /2 ·-separated field\(s\), expected 3/.test(twoField.malformed[0]?.reason ?? ''), 'a two-field line is malformed, by its field count');
  const noHash = parseQaSourceLines('QA-source: 18.1.0 re-cut thread · Docker image · Build and push');
  check(/record field/.test(noHash.malformed[0]?.reason ?? ''), 'a record field without #N is malformed, naming that field');
  const indented = parseQaSourceLines('  QA-source: #1 · cli.flag-command-error-ux · a0');
  check(indented.entries.length === 1, 'leading whitespace is allowed');
  const two = parseQaSourceLines('QA-source: #1 · cli.a-b · a0\nQA-source: #2 · cli.c-d · a1');
  check(two.entries.length === 2, 'every line of a card is read');
  check(parseQaSourceLines(null).entries.length === 0, 'an empty body reads as no lines, not a throw');

  // --- locator kinds -------------------------------------------------------
  battery('locator kinds');
  check(locatorKind('records-forms.record-discussion-mentions') === 'item', 'area.item → item');
  check(locatorKind('smoke:npm-18.2.0') === 'npm-smoke', 'smoke:npm-VERSION → npm-smoke');
  check(locatorKind('smoke:npm-19.0.0-next.3') === 'npm-smoke', 'a prerelease smoke is a smoke');
  check(locatorKind('ux-walkthrough') === 'unrecognized', 'a bare word is not an item');
  check(locatorKind('records-forms') === 'unrecognized', 'an area alone is not an item');

  // --- a record judges an item only on a verdict line ----------------------
  battery('a record judges an item only on a verdict line');
  const body = [
    '| item | revision | verdict | clauses |',
    '|---|---|---|---|',
    '| i18n.surface-matrix | 12 | PASS | 15 |',
    '| `records-forms.field-history-tracking` | 9 | FAIL | 9 |',
    '### approvals.inbox-keyboard-flow (r3) — PASS',
    '| cli.verify-verdict-exit-mapping | 2 | unit | NOT-RUN | earlier PASS stands |',
    '| records-forms.form-dirty-guard | 6 | BLOCKED | 4 |',
    '- records-forms.cascading-options: pass (4/4), see records-forms.cascading-multilevel-and-clear',
    'Carried-forward: #100 · records-forms.carried · PASS',
    'The run named records-forms.mention-only in passing.',
    '| host.example | 1 | PASS | 1 |',
    '| `showcase-smoke.spec.ts` | 1 | PASS | 1 |',
  ].join('\n');
  const seen = readRecordItems({ title: 'QA run · release-x (5/6) · aaaaaaaa · 2026-10-27 · 4 PASS / 1 FAIL', body }, AREAS);
  check(seen.judged.get('i18n.surface-matrix')?.has('pass'), 'an item-level table row is a judgment');
  check(seen.judged.get('records-forms.field-history-tracking')?.has('fail'), 'a back-ticked id is read');
  check(seen.judged.get('approvals.inbox-keyboard-flow')?.has('pass'), 'a `### id — PASS` heading is a judgment');
  check(!seen.judged.has('cli.verify-verdict-exit-mapping') && seen.mentioned.has('cli.verify-verdict-exit-mapping'), 'a NOT-RUN line is a mention, never a judgment');
  check(!seen.judged.has('records-forms.form-dirty-guard'), 'BLOCKED alone consulted nothing');
  check(seen.judged.get('records-forms.cascading-options')?.has('pass'), 'a verdict bullet judges its first id');
  check(!seen.judged.has('records-forms.cascading-multilevel-and-clear'), 'a second id on a verdict line is a cross-reference, not a judgment');
  check(!seen.judged.has('records-forms.carried') && !seen.mentioned.has('records-forms.carried'), 'a Carried-forward line is not a judgment');
  check(seen.mentioned.has('records-forms.mention-only') && !seen.judged.has('records-forms.mention-only'), 'a mention without a verdict word is a mention');
  check(!seen.mentioned.has('host.example'), 'an id-shaped token outside the area vocabulary is not an item');
  check(!seen.judged.has('showcase-smoke.spec'), 'a filename is not an id');
  const single = readRecordItems({ title: 'QA run · cli.flag-command-error-ux (1/1) · bbbbbbbb · 2026-10-19 · 1 PASS', body: 'prose only' }, AREAS);
  check(single.judged.get('cli.flag-command-error-ux')?.has('pass'), 'a record whose selector IS the item judged it, from the title');

  // --- owed, re-judged and unknown are decided on subject time --------------
  battery('owed, re-judged and unknown are decided on subject time');
  const rec = (number, sha, created, extra = '') => ({ number, title: `QA run · release-x (1/1) · ${sha} · ${created.slice(0, 10)} · 1 PASS`, body: extra, created_at: created });
  const card = (number, closed, line, stateReason = 'completed') => ({ number, state: 'closed', state_reason: stateReason, closed_at: closed, body: `Repro.\n${line}\n` });
  const RECORDS = [
    rec(10, 'aaaaaaaa', '2026-10-27T05:00:00Z', '| i18n.surface-matrix | 1 | FAIL |'),
    rec(20, 'bbbbbbbb', '2026-10-29T05:00:00Z', '| i18n.surface-matrix | 2 | PASS |\n| records-forms.x-y | 1 | PASS |'),
    rec(30, 'cccccccc', '2026-10-30T05:00:00Z', '| approvals.a-b | 1 | PASS |'),
    rec(40, 'dddddddd', '2026-10-26T05:00:00Z', 'Mentions cli.late-mention only.'),
  ];
  const TIMES = new Map([
    ['aaaaaaaa', '2026-10-27T01:00:00Z'],
    ['bbbbbbbb', '2026-10-29T03:00:00Z'],
    ['cccccccc', null],
    ['dddddddd', '2026-10-26T01:00:00Z'],
  ]);
  const CARDS = [
    card(101, '2026-10-27T09:00:00Z', 'QA-source: #10 · i18n.surface-matrix · n1'),
    card(102, '2026-10-29T09:00:00Z', 'QA-source: #10 · i18n.surface-matrix · n2'),
    card(103, '2026-10-28T09:00:00Z', 'QA-source: #30 · approvals.a-b · a0'),
    card(104, '2026-10-31T09:00:00Z', 'QA-source: #30 · approvals.a-b · a1'),
    card(105, '2026-10-26T09:00:00Z', 'QA-source: #40 · cli.late-mention · a0'),
  ];
  const r1 = computeRetestOwed({ cards: CARDS, records: [...RECORDS, rec(50, 'eeeeeeee', '2026-10-30T00:00:00Z', 'The run touched cli.late-mention.')], subjectTimes: new Map([...TIMES, ['eeeeeeee', '2026-10-29T23:00:00Z']]), areas: new Set(['i18n', 'approvals', 'cli', 'records-forms']) });
  const row = (list, item) => list.find((r) => r.item === item);
  check(row(r1.rejudged, 'i18n.surface-matrix')?.fixCards.map((c) => c.number).join() === '101', 'a fix closed before a later subject is re-judged');
  check(row(r1.rejudged, 'i18n.surface-matrix')?.rejudgedBy?.number === 20, 're-judged names the record whose subject postdates the fix');
  check(row(r1.owed, 'i18n.surface-matrix')?.fixCards.map((c) => c.number).join() === '102', 'a fix closed after the newest subject is owed');
  check(row(r1.owed, 'i18n.surface-matrix')?.lastJudged?.number === 20, 'owed names the record that last judged the item');
  check(row(r1.unknown, 'approvals.a-b')?.unresolved.join() === '30', 'an unresolved record filed after the fix makes the row unknown, never re-judged');
  check(row(r1.owed, 'approvals.a-b')?.fixCards.map((c) => c.number).join() === '104', 'an unresolved record filed BEFORE the fix cannot clear it');
  check(row(r1.owed, 'cli.late-mention')?.mentionedBy.join() === '50', 'a later record that only names the item is pointed at as unconfirmed');
  check(row(r1.owed, 'cli.late-mention')?.lastJudged?.number === 40, 'the QA-source record counts as a judge of its own item');
  check(!r1.owed.some((r) => r.item === 'records-forms.x-y'), 'a judged item no fix card names owes nothing');

  // --- npm smoke cells are re-judged by the next smoke ----------------------
  battery('npm smoke cells are re-judged by the next smoke');
  const smokeRecs = [
    { number: 60, title: 'QA run · smoke:npm-18.2.0 (25/25) · ffffffff · 2026-10-27 · 22 PASS / 3 FAIL', body: 'A1 PASS', created_at: '2026-10-27T11:00:00Z' },
    { number: 70, title: 'QA run · smoke:npm-18.3.0 (25/25) · 99999999 · 2026-11-03 · 25 PASS', body: 'D3 PASS', created_at: '2026-11-03T11:00:00Z' },
  ];
  const smokeTimes = new Map([['ffffffff', '2026-10-26T20:00:00Z'], ['99999999', '2026-11-02T20:00:00Z']]);
  const smokeCards = [card(201, '2026-10-27T17:00:00Z', 'QA-source: #60 · smoke:npm-18.2.0 · D3')];
  const s1 = computeRetestOwed({ cards: smokeCards, records: smokeRecs, subjectTimes: smokeTimes, areas: AREAS });
  check(s1.rejudged[0]?.item === 'smoke:npm-18.2.0 · D3' && s1.rejudged[0]?.rejudgedBy?.number === 70, 'the next smoke:npm-* record re-judges a smoke cell');
  const s2 = computeRetestOwed({ cards: smokeCards, records: [smokeRecs[0]], subjectTimes: smokeTimes, areas: AREAS });
  check(s2.owed[0]?.kind === 'npm-smoke' && s2.owed[0]?.lastJudged?.number === 60, 'before the next smoke, the cell is owed to it');
  check(s2.owed[0]?.itemStatus === null, 'a smoke cell carries no checklist status');

  // --- nothing read is dropped -----------------------------------------------
  battery('nothing read is dropped');
  const odd = computeRetestOwed({
    cards: [
      card(301, '2026-10-27T15:00:00Z', 'QA-source: #26639 · observation 3'),
      card(302, '2026-10-27T15:00:00Z', 'QA-source: #27377 · ux-walkthrough · track 2'),
      card(303, '2026-10-27T15:00:00Z', 'QA-source: other/repo#5 · i18n.surface-matrix · n1'),
      card(304, '2026-10-27T15:00:00Z', 'QA-source: #10 · i18n.surface-matrix · n1', 'not_planned'),
      card(305, '2026-10-27T15:00:00Z', 'QA-source: #10 · i18n.gone-item · n1'),
      { number: 306, state: 'open', state_reason: null, closed_at: null, body: 'QA-source: #10 · i18n.surface-matrix · n1' },
    ],
    records: RECORDS,
    subjectTimes: TIMES,
    areas: new Set(['i18n']),
    itemStatus: new Map([['i18n.surface-matrix', 'active']]),
    repo: 'objectstack-ai/objectstack',
  });
  check(odd.notRead.some((n) => n.card === 301 && /expected 3/.test(n.reason)), 'a malformed line is listed with its reason');
  check(odd.notRead.some((n) => n.card === 302 && /neither a checklist item id/.test(n.reason)), 'an unrecognised locator is listed with its reason');
  check(odd.notRead.some((n) => n.card === 303 && /other\/repo/.test(n.reason)), 'a record in another repository is listed, not guessed at');
  check(odd.notLanded.some((n) => n.card === 304 && n.stateReason === 'not_planned'), 'a card closed as not planned is listed as no landing');
  check(row(odd.owed, 'i18n.gone-item')?.itemStatus === 'absent', 'an item the checklist no longer has is still listed, marked absent');
  check(![...odd.owed, ...odd.rejudged, ...odd.unknown].some((r) => r.fixCards.some((c) => c.number === 306)), 'an open card has landed nothing');

  // --- as-of replays the past ---------------------------------------------------
  battery('as-of replays the past');
  const past = computeRetestOwed({ cards: CARDS, records: RECORDS, subjectTimes: TIMES, areas: AREAS, asOf: '2026-10-28T00:00:00Z' });
  check(row(past.owed, 'i18n.surface-matrix')?.fixCards.map((c) => c.number).join() === '101', 'a record filed after as-of does not clear an older fix');
  check(!past.owed.concat(past.rejudged).some((r) => r.fixCards.some((c) => c.number === 102)), 'a card closed after as-of is not yet a landing');
  check(!past.unknown.length && !past.owed.some((r) => r.item === 'approvals.a-b'), 'cards citing a record filed after as-of are not yet read');

  // --- the render names every section ------------------------------------------
  battery('the render names every section');
  const md = renderMarkdown({
    computedOn: { repo: 'objectstack-ai/objectstack', asOf: null, apiCalls: 3, generatedAt: '2026-10-29T00:00:00.000Z' },
    corpus: { records: 4, recordsParsed: 4, since: '2026-08-11T00:00:00Z', scanned: 10, cards: 5, shas: 4, shasResolved: 3 },
    ...r1,
    notRead: odd.notRead,
    notLanded: odd.notLanded,
  });
  check(md.includes('### Owed — '), 'the owed section is present');
  check(md.includes('### Unknown — '), 'the unknown section is present when a row is unknown');
  check(md.includes('### Re-judged — '), 'the re-judged section is present');
  check(md.includes('#102'), 'an owed fix card is printed');
  check(md.includes('unconfirmed: #50'), 'an unconfirmed pointer is printed');
  check(md.includes('observation 3'), 'a not-read line is printed');
  check(md.includes('#304 (not_planned)'), 'a closed-without-fix card is printed');
  check(md.includes('Nothing is written anywhere'), 'the view states that it writes nothing');

  // --- a listing stays on the repository path ---------------------------------
  battery('a listing stays on the repository path');
  const hop = onPathOf(
    'https://api.github.com/repos/o/r/issues?state=closed&per_page=100',
    'https://api.github.com/repositories/42/issues?state=closed&per_page=100&after=Y3Vy%3D',
  );
  check(new URL(hop).pathname === '/repos/o/r/issues', 'the next link is followed on the /repos path, never /repositories/ID');
  check(new URL(hop).searchParams.get('after') === 'Y3Vy=' && new URL(hop).searchParams.get('state') === 'closed', 'the next link\'s cursor and filters are carried over');

  for (const message of batteryFloorFailures()) failures.push(message);
  if (failures.length > 0) {
    console.error(`✗ retest-owed --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`✓ retest-owed --self-test: ${checked} assertions in ${Object.keys(SELF_TEST_BATTERIES).length} batteries.`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ retest-owed self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    await main(process.argv.slice(2));
  }
}
