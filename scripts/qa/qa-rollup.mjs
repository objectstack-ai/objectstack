#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * qa-rollup — area x latest-verdict x staleness matrix over the `qa-run` records.
 *
 *   node scripts/qa/qa-rollup.mjs                  # print the matrix (reads GitHub)
 *   node scripts/qa/qa-rollup.mjs --target <ref>   # compare staleness against <ref>
 *   node scripts/qa/qa-rollup.mjs --json           # same data, machine-readable
 *   node scripts/qa/qa-rollup.mjs --self-test      # exercise the parser offline
 *
 * ## What this answers
 *
 * "What is the latest verdict for every checklist selector, and is it stale?"
 * Today that question costs a human one issue-read per record (34 as of
 * 2026-08-21). This prints it as one table.
 *
 * ## It is a generated VIEW, not a tracker
 *
 * No state is written anywhere — no cache, no checked-in snapshot, no last-run
 * file. The `qa-run` issues stay the only source of truth; this script reads
 * them, computes, prints, and exits. Run it again and you get today's answer,
 * not a remembered one. (Board rule, #9486.)
 *
 * ## Why the TITLE is the input and the BODY is not
 *
 * Measured over the whole live corpus on 2026-08-18 (23 records, open+closed):
 *
 *   - The title is the only uniform machine-readable field the corpus has, and
 *     it is the record author's OWN item-level summary.
 *   - The bodies are not one shape and never were. 9 of 23 records (the
 *     2026-08-11 `92f26f75` wave) contain NO markdown table at all — they are
 *     prose with `## PASS - 4 items` headings. The other 14 carry 26 DISTINCT
 *     table header shapes.
 *   - Worse than heterogeneous: most of those tables are CLAUSE-level, not
 *     item-level (`clause | verdict | oracle evidence` appears 38 times,
 *     `# | clause | verdict | oracle evidence` 22 more). They use the word
 *     "verdict" for a different unit. A parser that greps for verdict cells
 *     counts CLAUSES and reports them as ITEMS — a confidently wrong matrix,
 *     which is worse than no matrix.
 *
 * So this reads the field that is actually a contract and does NOT pretend to
 * have read the bodies. The output says so, every run, so that no reader can
 * mistake this view for a body-derived one.
 *
 * ## ONE canonical title shape, and this parser is STRICT about it
 *
 * Maintainer ruling, 2026-08-20 (option 2 on the drift card): the run-record
 * title is tightened to exactly ONE shape, and this parser matches that shape
 * and nothing else. The contract, documented in full at
 * `.claude/skills/checklist-test/SKILL.md`:
 *
 *   QA run | <selector> (<judged>/<total>) | <sha8> | <YYYY-MM-DD> | <counts>
 *
 *   - five `·`-separated fields, always;
 *   - `(<judged>/<total>)` is MANDATORY and is bare digits only. The phrasings
 *     the corpus grew -- `(FULL area)`, `(77 items)`, `(5 of 10 items)`,
 *     `(6/14 items consulted)`, and omitting the parenthetical altogether --
 *     are all RETIRED. `(FULL area)` is the reason the ruling exists: it
 *     declares no total, and a record wearing it judged 13 of its area's 33
 *     items while reading as complete coverage;
 *   - `<sha8>` is exactly 8 lowercase hex characters;
 *   - `<counts>` is ` / `-separated `<n> <VERDICT>` segments in report order,
 *     each bucket at most once, uppercase, NOT-RUN spelled `NOT-RUN`. The
 *     trailing `(11 not-run)` parenthetical the corpus also used is RETIRED.
 *
 * ⛔ Do NOT re-add tolerant multi-shape parsing here. Accepting five spellings
 * of one field is precisely the tolerant-consumer shape the ruling kills: it
 * fossilizes authoring errors into a second de-facto contract and hides them
 * (AGENTS.md Prime Directive #12). One strict contract, and deviation is loud.
 *
 * ## Existing records are NOT migrated -- and "unparsed" is split in two
 *
 * The ruling is new-records-only: every record written before the contract
 * keeps its own shape and simply does not parse. Measured on 2026-08-21 the
 * corpus is 34 records and NONE of them matches the canonical shape, so an
 * undifferentiated "Not parsed" list would be 34 rows deep -- and the first
 * genuine deviation by a NEW record would be invisible inside it. That would
 * defeat the enforcement surface the ruling is relying on.
 *
 * So the render partitions the unparsed set by `CANONICAL_FROM`, using the
 * GitHub API's `created_at` -- an API fact, never anything read out of the
 * title. Nothing is extracted from a legacy title, no legacy shape is
 * recognised, and every record is equally unparsed; only the EXPLANATION
 * differs. Records that predate the contract are expected, and say so;
 * records written after it are the signal.
 *
 * Either way a record is PRINTED, never dropped. A roll-up that silently omits
 * records is the "derived list read as authoritative" defect this repo has paid
 * for repeatedly (#9294, #9331, #9503, #9590).
 *
 * ## Staleness is THREE-valued, because a shallow clone cannot always tell
 *
 * `git merge-base --is-ancestor` needs the sha present locally with enough
 * history behind it. CI containers here clone shallow (measured: boundary
 * `713ccbc95`, 2026-08-16). The `92f26f75` wave predates that boundary, so
 * `--is-ancestor` answers *false* for commits that almost certainly ARE
 * ancestors. Reading that false as "not behind -> fresh" would render the NINE
 * STALEST RECORDS IN THE CORPUS AS FRESH — the failure inverted, silently.
 *
 * So freshness is `current` | `stale` | `unknown`, never a two-way boolean, and
 * `unknown` carries its reason (`shallow` / `unreachable` / `diverged`).
 * "Could not tell" renders as `?`, and `?` is never counted as fresh.
 *
 * ## Rate limit
 *
 * REST core only: one `GET /issues?labels=qa-run&state=all&per_page=100` per
 * 100 records (measured: 1 call for the whole corpus), against a 15000/hr core
 * quota. Deliberately NOT the search API (30/min) and NOT GraphQL, whose quota
 * was measurably under pressure in this repo (2699/5000 remaining) when this
 * was written. Comments are never paginated — the bodies are not parsed at all.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isEntrypoint } from '../invoked-as.mjs';

/** The verdict vocabulary, in report order. */
export const VERDICTS = ['PASS', 'PARTIAL', 'FAIL', 'BLOCKED', 'NOT-RUN'];

const TITLE_PREFIX = 'QA run';
const SEP = '·'; // MIDDLE DOT, the field separator the records use

/**
 * The date the canonical title contract takes effect. A record created BEFORE
 * this predates the contract and is not expected to match it (the ruling is
 * new-records-only, with no migration); a record created on or after it that
 * fails to parse is a real deviation.
 *
 * This is a presentation boundary only — it never relaxes the parser, which
 * has exactly one accepted shape regardless of date. If this PR lands later
 * than the date below, bump this one constant to the merge date.
 */
export const CANONICAL_FROM = '2026-08-22';

/**
 * Whether a record predates the canonical contract, from the GitHub API's
 * `created_at`.
 *
 * Deliberately reads an API fact rather than the title: a legacy title is not
 * parsed at all, so no field of it — including its date field — may be
 * consulted to decide how to describe it.
 *
 * @param {string|null|undefined} createdAt ISO 8601 timestamp from the API
 * @returns {boolean} true when the record predates the contract
 */
export function predatesContract(createdAt) {
  if (typeof createdAt !== 'string' || createdAt.length < 10) return false;
  return createdAt.slice(0, 10) < CANONICAL_FROM;
}

/**
 * Parse one `qa-run` issue title against the ONE canonical shape.
 *
 *   QA run · <selector> (<judged>/<total>) · <sha8> · <YYYY-MM-DD> · <counts>
 *
 * Strict by ruling (2026-08-20). Every rejection carries a reason naming the
 * field that failed and what was expected, because the reason is what the
 * "Not parsed" section prints and that section is the enforcement surface —
 * a bare "did not match" would tell an author nothing about what to fix.
 *
 * ⛔ Never widen this to accept a second phrasing of a field. The retired
 * spellings are pinned as REJECTED in `--self-test`; re-accepting one turns
 * this back into the tolerant consumer the ruling removed.
 *
 * Pure: every input is an argument, so `--self-test` exercises the real code
 * path rather than a re-implementation.
 *
 * @param {string} title raw issue title
 * @returns {{ok: true, selector: string, selectorKind: string, judged: number,
 *            total: number, sha: string, date: string,
 *            counts: Record<string, number>}
 *          | {ok: false, reason: string}}
 */
export function parseRunTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') {
    return { ok: false, reason: 'empty title' };
  }
  const fields = title.split(SEP).map((f) => f.trim());
  if (fields[0] !== TITLE_PREFIX) {
    return { ok: false, reason: `first field is ${JSON.stringify(fields[0])}, expected ${JSON.stringify(TITLE_PREFIX)}` };
  }
  if (fields.length !== 5) {
    return { ok: false, reason: `${fields.length} ${SEP}-separated fields, expected 5` };
  }
  const [, selectorField, shaField, dateField, countsField] = fields;

  // selector + the MANDATORY judged/total parenthetical, in its one spelling.
  const parenMatch = /^(.*?)\s*\((\d+)\/(\d+)\)$/.exec(selectorField);
  if (!parenMatch) {
    return {
      ok: false,
      reason: `selector field ${JSON.stringify(selectorField)} does not end in a mandatory \`(<judged>/<total>)\` — bare digits only, no words`,
    };
  }
  const selector = parenMatch[1].trim();
  if (selector === '') return { ok: false, reason: 'empty selector' };
  if (selector.includes('(') || selector.includes(')')) {
    return { ok: false, reason: `selector ${JSON.stringify(selector)} contains a parenthesis` };
  }
  const judged = Number(parenMatch[2]);
  const total = Number(parenMatch[3]);
  if (judged > total) {
    return { ok: false, reason: `judged ${judged} exceeds total ${total}` };
  }

  if (!/^[0-9a-f]{8}$/.test(shaField)) {
    return {
      ok: false,
      reason: `sha field ${JSON.stringify(shaField)} is not exactly 8 lowercase hex characters`,
    };
  }
  if (!isCalendarDate(dateField)) {
    return { ok: false, reason: `date field ${JSON.stringify(dateField)} is not a real YYYY-MM-DD date` };
  }

  const parsedCounts = parseCounts(countsField);
  if (!parsedCounts.ok) return parsedCounts;

  return {
    ok: true,
    selector,
    selectorKind: classifySelector(selector),
    judged,
    total,
    sha: shaField,
    date: dateField,
    counts: parsedCounts.counts,
  };
}

/**
 * The counts field, in its one spelling: ` / `-separated `<n> <VERDICT>`
 * segments, verdicts uppercase and in report order, each bucket at most once.
 *
 * A bucket that is ABSENT means the record did not declare it, which is not
 * the same as declaring zero — the render shows the two differently, so an
 * author who means zero writes `0 FAIL`. That is why this refuses to invent
 * missing buckets rather than defaulting them.
 *
 * @param {string} field
 * @returns {{ok: true, counts: Record<string, number>} | {ok: false, reason: string}}
 */
function parseCounts(field) {
  if (field === '') return { ok: false, reason: 'counts field is empty' };
  const counts = {};
  let lastIndex = -1;
  for (const segment of field.split('/')) {
    const seg = segment.trim();
    const m = /^(\d+) ([A-Z][A-Z-]*)$/.exec(seg);
    if (!m) {
      return {
        ok: false,
        reason: `counts segment ${JSON.stringify(seg)} is not \`<n> <VERDICT>\` with an uppercase verdict`,
      };
    }
    const word = m[2];
    const index = VERDICTS.indexOf(word);
    if (index === -1) {
      return { ok: false, reason: `${JSON.stringify(word)} is not a verdict (expected one of ${VERDICTS.join(', ')})` };
    }
    if (word in counts) {
      return { ok: false, reason: `verdict ${word} declared more than once` };
    }
    if (index <= lastIndex) {
      return { ok: false, reason: `verdict ${word} is out of report order (${VERDICTS.join(' / ')})` };
    }
    lastIndex = index;
    counts[word] = Number(m[1]);
  }
  return { ok: true, counts };
}

/**
 * What KIND of thing a selector names. The corpus mixes areas with
 * cross-cutting selectors, and rolling a tier up as if it were an area would
 * double-count items that belong to both.
 *
 * @param {string} selector
 * @returns {'area'|'tier'|'priority'|'other'}
 */
export function classifySelector(selector) {
  if (/^tier\d*[a-z]*:/i.test(selector)) return 'tier';
  if (/^priority:/i.test(selector)) return 'priority';
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(selector)) return 'area';
  return 'other';
}

/**
 * A real calendar date, not merely a `\d{4}-\d{2}-\d{2}`-shaped string.
 * The date is the primary key for "latest wins", so an impossible date must be
 * reported as unparseable rather than silently ordering the roll-up.
 *
 * @param {string} s
 * @returns {boolean}
 */
export function isCalendarDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Classify a record's subject sha against the comparison target.
 *
 * THREE-valued on purpose. See the header: in a shallow clone `isAncestor`
 * answers false for genuinely-old commits, so a boolean here would render the
 * stalest records as fresh. Every `unknown` carries the reason it is unknown.
 *
 * Pure: the git facts arrive as a plain object, so `--self-test` can drive
 * every branch including the ones a given container cannot reproduce.
 *
 * @param {{sha: string, date: string}} record
 * @param {{sha: string|null, ref: string}} target
 * @param {{resolved: boolean, isAncestor: boolean|null, behind: number|null,
 *          commitDate: string|null}} git facts about `record.sha`
 * @param {{shallow: boolean, boundaryDate: string|null}} repo
 * @returns {{state: 'current'|'stale'|'unknown', reason: string|null, behind: number|null}}
 */
export function classifyFreshness(record, target, git, repo) {
  if (target.sha && record.sha.length > 0 && target.sha.startsWith(record.sha)) {
    return { state: 'current', reason: null, behind: 0 };
  }
  if (!git.resolved) {
    return { state: 'unknown', reason: 'unreachable', behind: null };
  }
  if (git.isAncestor === true) {
    return { state: 'stale', reason: null, behind: git.behind };
  }
  // Not an ancestor. In a shallow clone that is not evidence of anything if the
  // commit predates the graft boundary -- the history simply is not there.
  const predatesBoundary =
    repo.shallow && repo.boundaryDate && git.commitDate && git.commitDate < repo.boundaryDate;
  if (predatesBoundary) {
    return { state: 'unknown', reason: 'shallow', behind: null };
  }
  return { state: 'unknown', reason: 'diverged', behind: null };
}

/**
 * Latest-per-selector wins: a superseded record never shadows its replacement.
 * Ordering key is (date, issue number) -- the number breaks same-day ties in
 * filing order, which is the order the records were written.
 *
 * Pure.
 *
 * @param {Array<{number: number, parsed: object}>} records parsed, ok-only
 * @returns {{latest: object[], superseded: object[]}}
 */
export function rollUp(records) {
  const bySelector = new Map();
  for (const rec of records) {
    const key = rec.parsed.selector;
    const prior = bySelector.get(key);
    if (!prior || isNewer(rec, prior)) {
      bySelector.set(key, rec);
    }
  }
  const latestSet = new Set([...bySelector.values()].map((r) => r.number));
  const latest = [...bySelector.values()].sort(
    (a, b) =>
      a.parsed.selectorKind.localeCompare(b.parsed.selectorKind) ||
      a.parsed.selector.localeCompare(b.parsed.selector),
  );
  const superseded = records
    .filter((r) => !latestSet.has(r.number))
    .sort((a, b) => b.number - a.number);
  return { latest, superseded };
}

function isNewer(a, b) {
  if (a.parsed.date !== b.parsed.date) return a.parsed.date > b.parsed.date;
  return a.number > b.number;
}

/**
 * The canonical area vocabulary, read from the checklist itself so that an area
 * added there shows up here as a gap rather than silently not existing.
 *
 * @param {string} root repository root (or a fixture root in --self-test)
 * @returns {Array<{area: string, items: number}>}
 */
export function readAreas(root) {
  const dir = join(root, 'docs', 'qa', 'platform-checklist', 'areas');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      out.push({
        area: parsed.area ?? file.replace(/\.json$/, ''),
        items: Array.isArray(parsed.items) ? parsed.items.length : 0,
      });
    } catch {
      out.push({ area: file.replace(/\.json$/, ''), items: 0 });
    }
  }
  return out;
}

/**
 * The "judged" cell: how many items this record actually judged, over how many
 * the selector covers.
 *
 * One provenance now — the record's own mandatory `(<judged>/<total>)`. The
 * earlier version had three more branches (summed counts over a declared
 * total, the checklist area's item count marked `*`, and a free-text note),
 * which existed solely because the retired phrasings declared no judged/total.
 * With the parenthetical mandatory there is nothing left to infer, and
 * inferring a denominator the record never claimed is exactly the confident
 * nonsense the contract removes.
 *
 * Pure.
 *
 * @param {{judged: number, total: number}} parsed
 * @returns {string}
 */
export function judgedCell(parsed) {
  return `${parsed.judged}/${parsed.total}`;
}

const FRESHNESS_CELL = {
  current: 'current',
  stale: 'STALE',
  unknown: '?',
};

/**
 * Render the whole view as markdown, ready to paste as a wave-anchor comment.
 *
 * Pure: takes the computed model, returns a string.
 *
 * @param {object} model
 * @returns {string}
 */
export function renderMarkdown(model) {
  const L = [];
  const { computedOn, rows, superseded, unparseable, areaGaps, openRecords, corpus } = model;

  L.push('## QA roll-up — latest verdict per selector, with staleness');
  L.push('');
  L.push('_A generated view. No state is written anywhere; the `qa-run` issues remain the only');
  L.push('source of truth. Re-run to refresh._');
  L.push('');

  // Provenance -- a reader must be able to tell WHICH tree produced this.
  L.push('**computedOn**');
  L.push('');
  L.push(`- target: \`${computedOn.targetRef}\` = \`${computedOn.targetSha ?? 'unresolved'}\``);
  L.push(`- repository: ${computedOn.shallow ? `shallow clone (graft boundary \`${computedOn.boundary ?? '?'}\`, ${computedOn.boundaryDate ?? '?'})` : 'full clone'}`);
  L.push(`- corpus: ${corpus.total} \`qa-run\` records (${corpus.open} open, ${corpus.closed} closed), ${corpus.parsed} parsed, ${corpus.unparseable} unparseable`);
  L.push(`- contract: ONE canonical title shape, strict, effective \`${CANONICAL_FROM}\` (new records only — earlier records are not migrated)`);
  L.push(`- source: issue TITLES only — bodies are not parsed (see caveat below)`);
  L.push(`- API: ${computedOn.apiCalls} REST call(s), core quota`);
  L.push(`- generated: ${computedOn.generatedAt}`);
  L.push('');

  L.push(`| selector | kind | latest | date | subject | fresh? | ${VERDICTS.join(' | ')} | judged |`);
  L.push(`|---|---|---|---|---|---|${VERDICTS.map(() => '--:').join('|')}|---|`);
  for (const r of rows) {
    const cells = VERDICTS.map((v) => (v in r.counts ? String(r.counts[v]) : '—'));
    const fresh =
      r.freshness.state === 'stale'
        ? `STALE${r.freshness.behind != null ? ` (${r.freshness.behind} behind)` : ''}`
        : r.freshness.state === 'unknown'
          ? `? ${r.freshness.reason}`
          : FRESHNESS_CELL.current;
    L.push(
      `| \`${r.selector}\` | ${r.selectorKind} | #${r.number} | ${r.date} | \`${r.sha}\` | ${fresh} | ${cells.join(' | ')} | ${r.judgedCell} |`,
    );
  }
  if (rows.length === 0) {
    L.push('_No record matches the canonical title shape yet. Every record in the corpus predates');
    L.push(`the contract (effective \`${CANONICAL_FROM}\`) and is listed below — this table fills in as`);
    L.push('runs adopt the shape. An empty table here is the expected state immediately after the');
    L.push('contract lands, not a failure of this view._');
  }
  L.push('');
  L.push('`—` = the record did not declare that bucket (which is NOT the same as declaring zero).');
  L.push('`?` = could not be computed, never "fresh" — see reason.');
  L.push('');

  // The enforcement surface, split so that a NEW deviation cannot hide inside
  // the legacy backlog. The split reads the API's `created_at`, never the
  // title: a legacy title is not parsed at all, so no field of it is consulted.
  const legacy = unparseable.filter((u) => predatesContract(u.createdAt));
  const deviations = unparseable.filter((u) => !predatesContract(u.createdAt));

  if (deviations.length > 0) {
    L.push(`### Not parsed — ${deviations.length} record(s) deviating from the contract`);
    L.push('');
    L.push(`These were written on or after \`${CANONICAL_FROM}\`, so the canonical title shape applied`);
    L.push('to them. Each is a title to fix, and the reason names the field that failed.');
    L.push('');
    L.push('| record | title | why |');
    L.push('|---|---|---|');
    for (const u of deviations) {
      L.push(`| #${u.number} | ${escapeCell(u.title)} | ${escapeCell(u.reason)} |`);
    }
    L.push('');
  } else {
    L.push('### Not parsed — no deviations');
    L.push('');
    L.push('Every record written under the canonical contract matches it.');
    L.push('');
  }

  if (legacy.length > 0) {
    L.push(`### Predates the canonical contract — ${legacy.length} record(s)`);
    L.push('');
    L.push(`Written before \`${CANONICAL_FROM}\`, when the title convention had several shapes. The`);
    L.push('tightening ruling is new-records-only: these are **not** migrated and are **not**');
    L.push('defects. They are listed rather than dropped, because a roll-up that silently omits');
    L.push('records reads as authoritative and is not — but nothing is extracted from their');
    L.push('titles, so they contribute no verdict to the table above.');
    L.push('');
    L.push('| record | title |');
    L.push('|---|---|');
    for (const u of legacy) {
      L.push(`| #${u.number} | ${escapeCell(u.title)} |`);
    }
    L.push('');
  }

  if (areaGaps.length > 0) {
    L.push(`### Checklist areas with no run record — ${areaGaps.length}`);
    L.push('');
    L.push('These areas exist in `docs/qa/platform-checklist/areas/` but no `qa-run` record');
    L.push('names them as its selector. Absence of a verdict, not a verdict of NOT-RUN.');
    L.push('');
    L.push('| area | items |');
    L.push('|---|--:|');
    for (const g of areaGaps) L.push(`| \`${g.area}\` | ${g.items} |`);
    L.push('');
  }

  L.push(`### Close-out debt — ${openRecords.length} open record(s)`);
  L.push('');
  if (openRecords.length === 0) {
    L.push('Every `qa-run` record is closed.');
  } else {
    for (const o of openRecords) L.push(`- #${o.number} — \`${o.selector ?? '?'}\` (${o.date ?? '?'})`);
  }
  L.push('');

  if (superseded.length > 0) {
    L.push(`### Superseded — ${superseded.length} record(s)`);
    L.push('');
    L.push('Shown so the roll-up is auditable: each was replaced by a later run of the same selector.');
    L.push('');
    for (const s of superseded) {
      L.push(`- #${s.number} \`${s.selector}\` (${s.date}) — superseded by #${s.supersededBy}`);
    }
    L.push('');
  }

  L.push('### Caveat — what this did NOT read');
  L.push('');
  L.push('The per-item verdict tables inside the record bodies are **not** parsed. Measured over');
  L.push('this corpus, they are not one shape: some records carry no table at all, the rest carry');
  L.push('many distinct header shapes, and most of those tables are clause-level rather than');
  L.push('item-level — they use the word "verdict" for a different unit. Counting them as items');
  L.push('would produce a confidently wrong matrix. The numbers above are each record\'s own');
  L.push('title-line summary, which is the only uniform machine-readable field the corpus has.');

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

/** Facts about the repository itself, needed to tell "not behind" from "cannot tell". */
export function readRepoFacts(root) {
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']) === 'true';
  let boundary = null;
  let boundaryDate = null;
  const commonDir = git(root, ['rev-parse', '--git-common-dir']);
  if (shallow && commonDir) {
    const shallowFile = join(root, commonDir, 'shallow');
    const direct = commonDir.startsWith('/') ? join(commonDir, 'shallow') : shallowFile;
    try {
      const lines = readFileSync(direct, 'utf8').trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        boundary = lines[0].slice(0, 9);
        boundaryDate = git(root, ['log', '-1', '--format=%ad', '--date=short', lines[0]]);
      }
    } catch {
      /* boundary unknown; classifyFreshness degrades to `diverged`, still not `fresh` */
    }
  }
  return { shallow, boundary, boundaryDate };
}

/** Facts about ONE record sha, relative to the target. */
export function readShaFacts(root, sha, targetSha) {
  const type = git(root, ['cat-file', '-t', `${sha}^{commit}`]);
  if (type !== 'commit') {
    return { resolved: false, isAncestor: null, behind: null, commitDate: null };
  }
  const commitDate = git(root, ['log', '-1', '--format=%ad', '--date=short', sha]);
  let isAncestor = null;
  if (targetSha) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, targetSha], {
        cwd: root,
        stdio: 'ignore',
      });
      isAncestor = true;
    } catch {
      isAncestor = false;
    }
  }
  let behind = null;
  if (isAncestor === true && targetSha) {
    const n = git(root, ['rev-list', '--count', `${sha}..${targetSha}`]);
    behind = n == null ? null : Number(n);
  }
  return { resolved: true, isAncestor, behind, commitDate };
}

/**
 * Fetch every `qa-run` record. REST core quota, paginated by Link header.
 * Returns the raw issues plus the call count, so the view can report its cost.
 */
async function fetchRunRecords(repo, token) {
  const out = [];
  let calls = 0;
  let url = `https://api.github.com/repos/${repo}/issues?labels=qa-run&state=all&per_page=100`;
  while (url) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'objectstack-qa-rollup' };
    if (isUsableToken(token)) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    calls += 1;
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}\n${authHint(res.status, token)}`);
    }
    const page = await res.json();
    for (const issue of page) {
      if (issue.pull_request) continue; // a PR is not a run record
      out.push(issue);
    }
    const link = res.headers.get('link') ?? '';
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = next ? next[1] : null;
  }
  return { issues: out, calls };
}

/**
 * Whether a token value is worth sending as a Bearer credential.
 *
 * Some environments export a PLACEHOLDER in `GH_TOKEN` and inject the real
 * credential at an egress proxy. Forwarding the placeholder is worse than
 * sending nothing: it overrides the injected credential and the request comes
 * back 401, which reads as "you have no access to this repo" when access is
 * in fact fine. Measured in this repo's agent container, where `GH_TOKEN` is
 * literally the string `proxy-injected`.
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isUsableToken(token) {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  if (t === '') return false;
  if (/^(proxy-injected|placeholder|none|null|undefined|x+)$/i.test(t)) return false;
  return true;
}

/**
 * Turn an auth failure into the two remedies that actually apply, rather than
 * a bare status code.
 *
 * @param {number} status
 * @param {string} token
 * @returns {string}
 */
export function authHint(status, token) {
  if (status !== 401 && status !== 403 && status !== 404) return '';
  const lines = [];
  if (!isUsableToken(token)) {
    lines.push('  - no usable GH_TOKEN/GITHUB_TOKEN was sent (the value looked like a placeholder).');
    if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
      lines.push('  - HTTPS_PROXY is set but Node is not routing through it, so a proxy that injects');
      lines.push('    credentials never saw this request. Retry with NODE_USE_ENV_PROXY=1.');
    }
  } else {
    lines.push('  - the supplied token was rejected; check that it can read this repository.');
  }
  return lines.join('\n');
}

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return git(here, ['rev-parse', '--show-toplevel']) ?? join(here, '..', '..');
}

async function main(argv) {
  const targetRef = valueOf(argv, '--target') ?? 'origin/main';
  const repo = valueOf(argv, '--repo') ?? 'objectstack-ai/objectstack';
  const asJson = argv.includes('--json');
  const root = repoRoot();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  const { issues, calls } = await fetchRunRecords(repo, token);
  const targetSha = git(root, ['rev-parse', targetRef]);
  const repoFacts = readRepoFacts(root);

  const parsedOk = [];
  const unparseable = [];
  for (const issue of issues) {
    const parsed = parseRunTitle(issue.title);
    if (parsed.ok) parsedOk.push({ number: issue.number, state: issue.state, parsed });
    else
      unparseable.push({
        number: issue.number,
        title: issue.title,
        reason: parsed.reason,
        createdAt: issue.created_at ?? null,
      });
  }

  const { latest, superseded } = rollUp(parsedOk);
  const latestBySelector = new Map(latest.map((r) => [r.parsed.selector, r.number]));

  const areas = readAreas(root);

  const rows = latest.map((r) => {
    const shaFacts = readShaFacts(root, r.parsed.sha, targetSha);
    const freshness = classifyFreshness(r.parsed, { sha: targetSha, ref: targetRef }, shaFacts, repoFacts);
    return {
      number: r.number,
      selector: r.parsed.selector,
      selectorKind: r.parsed.selectorKind,
      date: r.parsed.date,
      sha: r.parsed.sha,
      counts: r.parsed.counts,
      judgedCell: judgedCell(r.parsed),
      freshness,
    };
  });

  const seenAreas = new Set(parsedOk.map((r) => r.parsed.selector));
  const areaGaps = areas.filter((a) => !seenAreas.has(a.area));

  const openRecords = issues
    .filter((i) => i.state === 'open')
    .map((i) => {
      const p = parseRunTitle(i.title);
      return { number: i.number, selector: p.ok ? p.selector : null, date: p.ok ? p.date : null };
    })
    .sort((a, b) => b.number - a.number);

  const model = {
    computedOn: {
      targetRef,
      targetSha: targetSha ? targetSha.slice(0, 9) : null,
      shallow: repoFacts.shallow,
      boundary: repoFacts.boundary,
      boundaryDate: repoFacts.boundaryDate,
      apiCalls: calls,
      generatedAt: new Date().toISOString(),
    },
    corpus: {
      total: issues.length,
      open: issues.filter((i) => i.state === 'open').length,
      closed: issues.filter((i) => i.state === 'closed').length,
      parsed: parsedOk.length,
      unparseable: unparseable.length,
    },
    rows,
    superseded: superseded.map((s) => ({
      number: s.number,
      selector: s.parsed.selector,
      date: s.parsed.date,
      supersededBy: latestBySelector.get(s.parsed.selector),
    })),
    unparseable,
    areaGaps,
    openRecords,
  };

  process.stdout.write(asJson ? `${JSON.stringify(model, null, 2)}\n` : `${renderMarkdown(model)}\n`);
}

function valueOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/* ------------------------------------------------------------------ *
 * --self-test: exercises the pure core offline. No network, no git.
 *
 * Two fixture sets, and BOTH are load-bearing. FIXTURE_TITLES pins what the
 * canonical contract accepts; RETIRED_TITLES pins what it must now REJECT,
 * using the real phrasings the live corpus grew. A tightening whose test suite
 * only checks the happy path passes just as well after someone re-widens the
 * parser, so the rejections are the half that actually holds the ruling.
 * ------------------------------------------------------------------ */

/**
 * The canonical title shape, in the variations it legitimately has: which
 * buckets a record declares is the author's to choose, everything else is
 * fixed.
 */
export const FIXTURE_TITLES = [
  // three buckets; a fully-judged selector
  'QA run · tier2c:browser-2 (18/18) · e4e5c6e3 · 2026-08-18 · 10 PASS / 4 PARTIAL / 4 FAIL',
  // all five buckets, NOT-RUN in its one spelling, partial coverage declared
  'QA run · access-security (9/20) · e4e5c6e3 · 2026-08-17 · 1 PASS / 7 PARTIAL / 0 FAIL / 2 BLOCKED / 10 NOT-RUN',
  // the shape a run that reached 1 of 12 items must now write -- this is the
  // record that used to be titled "(FULL area)" while judging almost nothing
  'QA run · studio-authoring (1/12) · e4e5c6e3 · 2026-08-17 · 0 PASS / 1 PARTIAL / 11 NOT-RUN',
  // a non-area selector; judged/total is mandatory for it too
  'QA run · priority:P0 (18/18) · e4e5c6e3 · 2026-08-17 · 7 PASS / 7 PARTIAL / 2 FAIL / 2 BLOCKED',
  // a single bucket is legal; an omitted bucket is "not declared", not zero
  'QA run · ai (4/7) · 92f26f75 · 2026-08-11 · 4 PASS',
];

/**
 * Real phrasings from the live corpus that the contract RETIRES, each with the
 * substring its rejection reason must name. Re-accepting any of these is the
 * regression this list exists to catch.
 */
export const RETIRED_TITLES = [
  // the five judged/total phrasings the corpus grew, all retired in favour of
  // the bare `(<judged>/<total>)`
  ['QA run · studio-authoring (FULL area) · e4e5c6e3 · 2026-08-17 · 0 PASS / 1 PARTIAL / 0 FAIL', 'selector field'],
  ['QA run · tier1:automated-pins (77 items) · e4e5c6e3 · 2026-08-17 · 35 PASS / 39 PARTIAL / 0 FAIL', 'selector field'],
  ['QA run · automation (5 of 10 items) · e4e5c6e3 · 2026-08-17 · 1 PASS / 3 PARTIAL / 1 BLOCKED', 'selector field'],
  ['QA run · integration-system (6/14 items consulted) · e4e5c6e3 · 2026-08-17 · 2 PASS / 4 PARTIAL / 8 NOT-RUN', 'selector field'],
  ['QA run · priority:P0 · e4e5c6e3 · 2026-08-17 · 7 PASS / 7 PARTIAL / 2 FAIL / 2 BLOCKED', 'selector field'],
  // the second NOT-RUN spelling: a trailing parenthetical on the counts field
  ['QA run · approvals (1/11) · e4e5c6e3 · 2026-08-17 · 0 PASS / 1 PARTIAL / 0 FAIL (10 not-run)', 'counts segment'],
  // lowercase verdicts
  ['QA run · search (4/4) · 92f26f75 · 2026-08-11 · 2 pass / 2 fail', 'counts segment'],
  // the 2026-08-20 wave: five fields, but judged/total standing alone in the
  // sha position and no counts field at all
  ['QA run · repo-wide pin sweep · 19f98fa1 · 2026-08-20 · 15/15', 'selector field'],
  // a 7-character sha
  ['QA run · scan-functionality (14/14) · 79ebb37 · 2026-08-21 · 7 PASS / 7 FAIL', 'sha field'],
  // an uppercase sha
  ['QA run · cli (6/6) · E4E5C6E3 · 2026-08-17 · 6 PASS', 'sha field'],
  // shapes no record wrote, but that a strict parser must still refuse
  ['QA run · i18n (5/4) · 92f26f75 · 2026-08-11 · 5 PASS', 'exceeds total'],
  ['QA run · i18n (2/4) · 92f26f75 · 2026-08-11 · 1 PASS / 1 PASS', 'more than once'],
  ['QA run · i18n (2/4) · 92f26f75 · 2026-08-11 · 1 FAIL / 1 PASS', 'out of report order'],
  ['QA run · i18n (2/4) · 92f26f75 · 2026-08-11 · 2 SKIPPED', 'is not a verdict'],
  ['QA run · i18n (2/4) · 92f26f75 · 2026-08-11 · 2026-13-99', 'counts segment'],
  ['QA run · i18n (2/4) · 92f26f75 · 2026-13-99 · 2 PASS', 'date field'],
];

function assert(cond, msg, failures) {
  if (!cond) failures.push(msg);
  return cond ? 1 : 0;
}

async function selfTest() {
  const failures = [];
  let checked = 0;

  // --- every real shape parses -------------------------------------------
  for (const title of FIXTURE_TITLES) {
    const p = parseRunTitle(title);
    checked += assert(p.ok, `fixture must parse: ${title}\n    -> ${p.ok ? '' : p.reason}`, failures);
  }

  const byIndex = FIXTURE_TITLES.map(parseRunTitle);

  // --- the ONE judged/total spelling --------------------------------------
  checked += assert(byIndex[0].judged === 18 && byIndex[0].total === 18, '"(18/18)" -> 18/18', failures);
  checked += assert(byIndex[1].judged === 9 && byIndex[1].total === 20, '"(9/20)" -> 9/20', failures);
  checked += assert(byIndex[2].judged === 1 && byIndex[2].total === 12, '"(1/12)" -> 1/12', failures);
  // the parenthetical must not leak into the selector
  checked += assert(byIndex[0].selector === 'tier2c:browser-2', 'selector excludes the parenthetical', failures);
  checked += assert(byIndex[3].selector === 'priority:P0', 'non-area selector survives intact', failures);

  // --- the ONE NOT-RUN spelling -------------------------------------------
  checked += assert(byIndex[1].counts['NOT-RUN'] === 10, 'segment "10 NOT-RUN" counts as NOT-RUN', failures);
  checked += assert(byIndex[2].counts['NOT-RUN'] === 11, 'segment "11 NOT-RUN" counts as NOT-RUN', failures);
  checked += assert(byIndex[3].counts.BLOCKED === 2, 'BLOCKED parsed', failures);

  // an UNDECLARED bucket must be absent, not zero -- the render shows it as
  // "—", and conflating the two would invent a fact the record never stated.
  checked += assert(!('PARTIAL' in byIndex[4].counts), 'undeclared PARTIAL stays absent, not 0', failures);
  checked += assert(!('NOT-RUN' in byIndex[0].counts), 'undeclared NOT-RUN stays absent, not 0', failures);
  checked += assert(byIndex[0].counts.FAIL === 4, 'declared 4 FAIL parsed', failures);
  checked += assert(byIndex[1].counts.FAIL === 0, 'declared 0 FAIL is present AND zero', failures);

  // --- selector kinds -----------------------------------------------------
  checked += assert(classifySelector('tier2c:browser-2') === 'tier', 'tier selector classified', failures);
  checked += assert(classifySelector('priority:P0') === 'priority', 'priority selector classified', failures);
  checked += assert(classifySelector('studio-authoring') === 'area', 'area selector classified', failures);

  // --- every RETIRED phrasing is rejected, by the right reason -------------
  // This is the half that holds the ruling: a parser re-widened to accept one
  // of these passes every happy-path assertion above.
  for (const [title, expectedReason] of RETIRED_TITLES) {
    const p = parseRunTitle(title);
    checked += assert(
      p.ok === false && typeof p.reason === 'string' && p.reason.includes(expectedReason),
      `retired shape must be rejected naming ${JSON.stringify(expectedReason)}: ${JSON.stringify(title)}\n    -> ${p.ok ? 'PARSED' : p.reason}`,
      failures,
    );
  }

  // --- malformed titles are REPORTED, never silently dropped --------------
  const bad = [
    ['', 'empty'],
    ['Some other issue title', 'not a run record'],
    ['QA run · thing (1/1) · deadbeef · 2026-08-18', 'too few fields'],
    ['QA run · thing (1/1) · deadbeef · 2026-08-18 · 1 PASS · extra', 'too many fields'],
    ['QA run ·  (1/1) · deadbeef · 2026-08-18 · 1 PASS', 'empty selector'],
  ];
  for (const [title, why] of bad) {
    const p = parseRunTitle(title);
    checked += assert(p.ok === false && typeof p.reason === 'string' && p.reason.length > 0, `must reject (${why}) with a reason: ${JSON.stringify(title)}`, failures);
  }

  // --- the judged cell now has ONE provenance -----------------------------
  // The record's own mandatory parenthetical. Nothing is inferred from the
  // checklist, because there is no longer a record that declares no total.
  checked += assert(judgedCell(byIndex[0]) === '18/18', 'judged cell is the declared judged/total', failures);
  checked += assert(judgedCell(byIndex[2]) === '1/12', 'a 1-of-12 run renders as 1/12, never as complete', failures);

  // --- the legacy boundary reads created_at, never the title --------------
  checked += assert(predatesContract('2026-08-18T03:18:26Z') === true, 'a 2026-08-18 record predates the contract', failures);
  checked += assert(predatesContract(`${CANONICAL_FROM}T00:00:00Z`) === false, 'a record created on the effective date is under the contract', failures);
  checked += assert(predatesContract('2026-09-01T00:00:00Z') === false, 'a later record is under the contract', failures);
  checked += assert(predatesContract(null) === false, 'a missing created_at is not treated as legacy', failures);

  // --- freshness is three-valued -----------------------------------------
  const repoShallow = { shallow: true, boundaryDate: '2026-08-16' };
  const repoFull = { shallow: false, boundaryDate: null };
  const target = { sha: 'e4e5c6e3aaaaaaaa', ref: 'origin/main' };

  const current = classifyFreshness(
    { sha: 'e4e5c6e3', date: '2026-08-17' },
    target,
    { resolved: true, isAncestor: true, behind: 0, commitDate: '2026-08-17' },
    repoShallow,
  );
  checked += assert(current.state === 'current', 'sha equal to target -> current', failures);

  const stale = classifyFreshness(
    { sha: 'abcdef12', date: '2026-08-17' },
    target,
    { resolved: true, isAncestor: true, behind: 122, commitDate: '2026-08-17' },
    repoShallow,
  );
  checked += assert(stale.state === 'stale' && stale.behind === 122, 'ancestor behind target -> stale with distance', failures);

  // THE regression this script exists to prevent: a pre-boundary commit in a
  // shallow clone answers `isAncestor === false`, and that must NOT read as
  // fresh. Nine of the twenty-three live records are exactly this shape.
  const shallowUnknown = classifyFreshness(
    { sha: '92f26f75', date: '2026-08-11' },
    target,
    { resolved: true, isAncestor: false, behind: null, commitDate: '2026-08-11' },
    repoShallow,
  );
  checked += assert(shallowUnknown.state === 'unknown', 'pre-boundary + shallow -> unknown, NOT fresh', failures);
  checked += assert(shallowUnknown.reason === 'shallow', 'pre-boundary unknown names `shallow` as the reason', failures);
  checked += assert(shallowUnknown.state !== 'current', 'pre-boundary must never classify as current', failures);

  // the same facts in a FULL clone mean something different: genuinely diverged
  const diverged = classifyFreshness(
    { sha: '92f26f75', date: '2026-08-11' },
    target,
    { resolved: true, isAncestor: false, behind: null, commitDate: '2026-08-11' },
    repoFull,
  );
  checked += assert(diverged.state === 'unknown' && diverged.reason === 'diverged', 'full clone + not ancestor -> unknown/diverged', failures);

  const unreachable = classifyFreshness(
    { sha: 'ffffffff', date: '2026-08-01' },
    target,
    { resolved: false, isAncestor: null, behind: null, commitDate: null },
    repoShallow,
  );
  checked += assert(unreachable.state === 'unknown' && unreachable.reason === 'unreachable', 'unresolvable sha -> unknown/unreachable', failures);

  // no combination of inputs may yield a two-way boolean
  checked += assert(
    ['current', 'stale', 'unknown'].includes(unreachable.state),
    'freshness state stays in its vocabulary',
    failures,
  );

  // --- latest-per-selector wins ------------------------------------------
  const recs = [
    { number: 7695, parsed: { selector: 'studio-authoring', selectorKind: 'area', date: '2026-08-11' } },
    { number: 9353, parsed: { selector: 'studio-authoring', selectorKind: 'area', date: '2026-08-17' } },
    { number: 9330, parsed: { selector: 'access-security', selectorKind: 'area', date: '2026-08-17' } },
  ];
  const rolled = rollUp(recs);
  checked += assert(rolled.latest.length === 2, 'two selectors -> two latest rows', failures);
  checked += assert(
    rolled.latest.find((r) => r.parsed.selector === 'studio-authoring').number === 9353,
    'the newer studio-authoring record wins',
    failures,
  );
  checked += assert(
    rolled.superseded.length === 1 && rolled.superseded[0].number === 7695,
    'the older record is reported as superseded, not dropped',
    failures,
  );

  // same-day tie breaks by issue number (filing order)
  const sameDay = rollUp([
    { number: 100, parsed: { selector: 'x', selectorKind: 'area', date: '2026-08-17' } },
    { number: 101, parsed: { selector: 'x', selectorKind: 'area', date: '2026-08-17' } },
  ]);
  checked += assert(sameDay.latest[0].number === 101, 'same-day tie -> higher issue number wins', failures);

  // --- the render must never hide a record --------------------------------
  const md = renderMarkdown({
    computedOn: {
      targetRef: 'origin/main',
      targetSha: 'b057e53f4',
      shallow: true,
      boundary: '713ccbc95',
      boundaryDate: '2026-08-16',
      apiCalls: 1,
      generatedAt: '2026-08-18T00:00:00.000Z',
    },
    corpus: { total: 3, open: 0, closed: 3, parsed: 1, unparseable: 2 },
    rows: [
      {
        number: 9353,
        selector: 'studio-authoring',
        selectorKind: 'area',
        date: '2026-08-17',
        sha: 'e4e5c6e3',
        counts: { PASS: 0, PARTIAL: 1, 'NOT-RUN': 11 },
        judgedCell: '1/12',
        freshness: { state: 'unknown', reason: 'shallow', behind: null },
      },
    ],
    superseded: [],
    unparseable: [
      // written under the contract -> a deviation to fix
      { number: 4242, title: 'QA run · broken', reason: '2 fields, expected 5', createdAt: '2026-09-01T00:00:00Z' },
      // written before it -> expected, not a defect
      { number: 7627, title: 'QA run · ai (FULL area) · 92f26f75 · 2026-08-11 · 4 PASS / 3 FAIL', reason: 'selector field …', createdAt: '2026-08-11T09:22:08Z' },
    ],
    areaGaps: [{ area: 'dashboards', items: 10 }],
    openRecords: [],
  });
  checked += assert(md.includes('#4242'), 'unparseable record appears in the rendered view', failures);
  checked += assert(md.includes('2 fields, expected 5'), 'unparseable reason appears in the rendered view', failures);
  checked += assert(md.includes('#7627'), 'a legacy record appears in the rendered view too, never dropped', failures);
  checked += assert(md.includes('dashboards'), 'area with no record appears as a gap', failures);
  checked += assert(md.includes('? shallow'), 'unknown freshness renders as ? with its reason', failures);
  checked += assert(!/\bcurrent\b.*studio-authoring/.test(md), 'an unknown row is not rendered as current', failures);
  checked += assert(md.includes('computedOn'), 'provenance block is present', failures);
  checked += assert(md.includes('713ccbc95'), 'provenance names the shallow boundary', failures);
  checked += assert(md.includes('No state is written'), 'the view states that it writes nothing', failures);
  checked += assert(md.includes('bodies are not parsed'), 'the view states it did not read the bodies', failures);
  // an undeclared bucket renders as the em dash, not as 0
  checked += assert(/\|\s*—\s*\|/.test(md), 'undeclared bucket renders as — rather than 0', failures);

  // THE enforcement surface: a deviation written under the contract must be
  // separated from the legacy backlog, or the first real one is invisible
  // inside 34 rows of records that were never expected to match.
  const deviationHeading = md.indexOf('deviating from the contract');
  const legacyHeading = md.indexOf('Predates the canonical contract');
  checked += assert(deviationHeading !== -1, 'deviations get their own section', failures);
  checked += assert(legacyHeading !== -1, 'legacy records get their own section', failures);
  checked += assert(deviationHeading < legacyHeading, 'the deviation section comes first', failures);
  checked += assert(
    md.indexOf('#4242') < legacyHeading && md.indexOf('#7627') > legacyHeading,
    'each record is filed under the right heading',
    failures,
  );
  checked += assert(md.includes(CANONICAL_FROM), 'the render names the effective date', failures);
  // the legacy section must not read as a defect list
  checked += assert(/not\*\* migrated/.test(md), 'the legacy section says these are not migrated', failures);

  // with no canonical record yet, the empty table explains itself rather than
  // rendering as a silent blank
  const emptyMd = renderMarkdown({
    computedOn: { targetRef: 'origin/main', targetSha: 'b057e53f4', shallow: false, boundary: null, boundaryDate: null, apiCalls: 1, generatedAt: '2026-08-22T00:00:00.000Z' },
    corpus: { total: 1, open: 0, closed: 1, parsed: 0, unparseable: 1 },
    rows: [],
    superseded: [],
    unparseable: [{ number: 7627, title: 'QA run · ai (FULL area) · 92f26f75 · 2026-08-11 · 4 PASS', reason: 'selector field …', createdAt: '2026-08-11T09:22:08Z' }],
    areaGaps: [],
    openRecords: [],
  });
  checked += assert(
    emptyMd.includes('No record matches the canonical title shape yet'),
    'an empty table explains itself instead of rendering blank',
    failures,
  );
  checked += assert(emptyMd.includes('#7627'), 'the legacy record is still listed when the table is empty', failures);

  if (failures.length > 0) {
    console.error(`✗ qa-rollup --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ qa-rollup --self-test: ${checked} assertions over ${FIXTURE_TITLES.length} canonical shapes and ${RETIRED_TITLES.length} retired ones`,
  );
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else if (isEntrypoint(import.meta.url)) {
  await main(process.argv.slice(2));
}
