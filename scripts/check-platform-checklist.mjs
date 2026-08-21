#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-platform-checklist — keep the standing platform test checklist
// (docs/qa/platform-checklist/) machine-readable, append-only and honest.
//
// ## The failure this exists for
//
// Release verification used to live in one-off surfaces: a hand-written table
// per release (docs/plans/release-15.1-test-plan.md) and a checkbox issue per
// release (#3358). Both worked once and then rotted: items could not be reused
// across releases, results were checkboxes with no revision to pin them to, and
// every fixture gap the run discovered (#3408 phone persona never seeded, #3409
// per-group sign-off never launched, #3415 four of five projects silently
// rejected by seed validation) had to be rediscovered from prose. The standing
// checklist replaces those one-offs with a durable ledger; this gate keeps the
// ledger's invariants from decaying the same way.
//
// ## What this checks (deliberately dumb, presence-level — house ledger style)
//
//   - every docs/qa/platform-checklist/areas/*.json parses and its `area`
//     matches its filename;
//   - every item carries the required fields with sane enum values;
//   - ids are `<area>.<slug>`, globally unique, and — append-only discipline —
//     never removed: ids retired from service stay in the file with
//     `status: "retired"` (this check cannot see deletions; the README makes
//     removal a review-time offence, and `supersededBy` targets must resolve);
//   - `revision` matches the last `history` entry, so a semantic edit that
//     forgets to bump the revision (silently re-validating old run results)
//     fails here;
//   - active items have at least one acceptance clause, and every clause names
//     its oracle — a clause with no oracle is an invitation to tick on vibes,
//     which is the exact AI-accuracy failure the RUNNER.md protocol exists to
//     prevent.
//   - every `traps` entry is a trap RUNNER.md's `### Trap vocabulary` table
//     actually defines, and every documented trap is used by some item — the
//     vocabulary is READ from that table, never copied into this file, and a
//     table this script cannot parse is a refusal rather than an empty
//     allow-list (see the trap-vocabulary block below for why that matters).
//
// It does NOT judge whether an item is testable or its oracle sufficient — no
// static check can. It guarantees the *structure* a run can be trusted against.
//
// Usage: node scripts/check-platform-checklist.mjs   (pnpm check:platform-checklist)

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { maskComments } from './js-comment-mask.mjs';
import { join, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const AREAS_DIR = join(ROOT, 'docs/qa/platform-checklist/areas');

const STATUSES = new Set(['active', 'draft', 'retired']);
const PRIORITIES = new Set(['P0', 'P1', 'P2']);
const SURFACES = new Set(['browser', 'api', 'cli', 'build', 'mixed']);
const ORACLES = new Set(['api', 'network', 'screenshot', 'dom', 'log', 'test', 'build']);
const BLOCKED_BY = new Set(['fixture', 'environment', 'dependency', 'product-bug']);

const errors = [];
const err = (file, id, msg) => errors.push(`${file}${id ? ` · ${id}` : ''}: ${msg}`);

// ── Trap vocabulary ─────────────────────────────────────────────────────────
// Every other enum-ish field above is a hardcoded `Set`. `traps` deliberately
// is NOT, and that choice is the whole design of this block.
//
// RUNNER.md rule 3 tells a runner to "check the `traps` field and rule each
// listed trap out". The definitions that make that instruction executable live
// in ONE place — RUNNER.md's `### Trap vocabulary` table — and nothing used to
// hold the items and the table together: the string `traps` did not appear in
// this file at all. Measured on `main` at 6b0be02209: 19 distinct traps in use
// across 205 items, 11 documented, 8 used-but-undocumented (#10416 wrote the
// eight definitions; this check is why they cannot come back). Two drift
// shapes, and the validator saw neither:
//
//   1. a value nobody ever defined, exactly as the eight arrived;
//   2. a TYPO in a documented one — `hydration-races`, `wrong-persona ` —
//      which is the likelier and the worse of the two, because it reads as a
//      documented trap right up until someone greps the table for it.
//      `hydration-race` is on 79 of the 205 items; one mistyped instance is
//      simply a twentieth trap that no runner rules out and nobody notices.
//
// Both close the same way — check the vocabulary — and a hardcoded `TRAPS` set
// would close NEITHER honestly: it only moves the drift one level up, between
// this script and RUNNER.md, with nothing watching that seam either.
//
// ## Why the parser carries a positive control that runs on EVERY invocation
//
// A markdown-table extractor has one failure mode that matters: it reads zero
// rows — heading renamed, table moved, a row's backtick spelling changed — and
// every item then validates against an empty allow-list. Zero violations. A
// green line indistinguishable from the green a working parse prints. That is
// the silent-success direction this tree treats as worse than no check at all
// (#4690), so `extractTrapVocabulary` REFUSES on a table it cannot recognise
// and never returns an empty vocabulary with no complaint — and a fixture
// battery proves the refusal still fires.
//
// The battery runs inline, on every invocation, not only behind `--self-test`,
// because a `--self-test` here would otherwise execute NOWHERE: this gate is
// not CI-wired by maintainer decision (README "Operating cadence"), and its
// `pnpm` alias lives in root package.json, declared territory of the
// @changesets/cli v3 lane (#9465) while that runs. A self-test nothing runs is
// the documented defect of #10574/#10573 — CI enforcing the spelling of a
// guarantee while never once checking the guarantee still holds. The battery
// is in-memory string work (~1 ms of a ~270 ms run), so "always" costs nothing
// worth naming, and its assertion count is printed on the OK line: the green
// states how many rows it read and that its own control passed.

const RUNNER_FILE = join(ROOT, 'docs/qa/platform-checklist/RUNNER.md');
const TRAP_HEADING = '### Trap vocabulary';

/**
 * Extract the trap vocabulary from RUNNER.md's `### Trap vocabulary` table.
 *
 * Returns `{ traps, duplicates, refusal }`. A non-null `refusal` means the
 * table could not be recognised and the caller MUST treat it as a hard
 * failure. This never returns an empty `traps` with a null `refusal`: an empty
 * vocabulary and a working parse are not allowed to look alike.
 */
function extractTrapVocabulary(md) {
  const no = (refusal) => ({ traps: [], duplicates: [], refusal });
  const lines = String(md).split('\n');

  const h = lines.findIndex((l) => l.trimEnd().startsWith(TRAP_HEADING));
  if (h === -1) {
    return no(`the "${TRAP_HEADING}" heading is not in the file — renamed, moved or removed. Restore it: this check reads the vocabulary from that table and refuses to guess.`);
  }

  let i = h + 1;
  for (; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) return no(`no markdown table under "${TRAP_HEADING}" — the next heading arrives first`);
    if (lines[i].trimStart().startsWith('|')) break;
  }
  if (i >= lines.length) return no(`no markdown table under "${TRAP_HEADING}" — the file ends first`);

  const header = lines[i].trim();
  if (!/^\|\s*trap\s*\|/i.test(header)) {
    return no(`the first table under "${TRAP_HEADING}" is not the trap table — expected a "| trap | … |" header row, found ${JSON.stringify(header.slice(0, 60))}`);
  }
  if (!/^\|[\s:|-]+\|$/.test((lines[i + 1] ?? '').trim())) {
    return no(`the trap table's header row is not followed by a markdown separator row — found ${JSON.stringify((lines[i + 1] ?? '').trim().slice(0, 60))}. This parser cannot read that shape, and reading it wrong would shrink the vocabulary silently.`);
  }

  const rows = [];
  const unreadable = [];
  for (i += 2; i < lines.length && lines[i].trimStart().startsWith('|'); i++) {
    const m = lines[i].trim().match(/^\|\s*`([^`]+)`\s*\|/);
    if (m) rows.push(m[1]);
    else unreadable.push(lines[i].trim().slice(0, 60));
  }

  if (unreadable.length) {
    return no(`${unreadable.length} row(s) of the trap table do not name a single backticked trap in the first cell — e.g. ${JSON.stringify(unreadable[0])}. Every row must read "| \`trap-name\` | what it fakes | counter |"; a row this parser cannot read would drop that trap out of the vocabulary without a word.`);
  }
  if (rows.length === 0) {
    return no(`the trap table under "${TRAP_HEADING}" has a header but ZERO rows. An empty vocabulary would make every item's \`traps\` validate against nothing and report zero problems, so this is a refusal — never an empty allow-list.`);
  }

  const seen = new Set();
  const duplicates = [];
  for (const t of rows) {
    if (seen.has(t)) duplicates.push(t);
    seen.add(t);
  }
  return { traps: [...seen], duplicates, refusal: null };
}

/** Levenshtein, for the did-you-mean that makes drift shape 2 readable. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function didYouMean(name, vocabulary) {
  let best = null;
  let bestD = Infinity;
  for (const t of vocabulary) {
    const d = editDistance(name, t);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best !== null && bestD <= 3 ? ` — did you mean \`${best}\`?` : '';
}

/** Problems with one item's `traps`, as message strings. Pure; battery-tested below. */
function trapProblems(item, vocabulary) {
  const out = [];
  if (item.traps === undefined) return out; // optional field: 8 of 205 items carry none
  if (!Array.isArray(item.traps)) {
    out.push(`"traps" must be an array of trap names from RUNNER.md's \`${TRAP_HEADING}\` table`);
    return out;
  }
  const seen = new Set();
  item.traps.forEach((t, i) => {
    if (typeof t !== 'string' || !t.trim()) {
      out.push(`traps[${i}] must be a non-empty string`);
      return;
    }
    if (t !== t.trim()) {
      out.push(`traps[${i}] ${JSON.stringify(t)} has surrounding whitespace — a padded name is a different string to everyone who greps the table for it`);
    }
    const name = t.trim();
    if (seen.has(name)) out.push(`traps[${i}] \`${name}\` is listed twice`);
    seen.add(name);
    if (!vocabulary.has(name)) {
      out.push(
        `traps[${i}] \`${name}\` is not in RUNNER.md's \`${TRAP_HEADING}\` table${didYouMean(name, vocabulary)}` +
          ` — either it is a typo of a documented trap, or it is a new one; document it in that table (name · what it fakes · the counter) before using it, so the runner told to "rule each listed trap out" has something to rule out.`,
      );
    }
  });
  return out;
}

/**
 * The positive control. Proves the extractor reads a good table AND refuses an
 * empty / renamed / reshaped one, and that the item-side checker catches both
 * drift shapes. Zero I/O — every subject is a literal fixture.
 */
function selfTestTrapVocabulary() {
  const failures = [];
  let checked = 0;
  const t = (what, ok) => {
    checked++;
    if (!ok) failures.push(what);
  };

  const table = (...rows) => ['prose above', '', `${TRAP_HEADING} (\`traps\` field)`, '', '| trap | what it fakes | counter |', '|---|---|---|', ...rows, '', '## Next section', '| not | a | trap |'].join('\n');

  const good = extractTrapVocabulary(table('| `hydration-race` | empty nav | settle, then read |', '| `stale-dist` | src edits with no effect | rebuild |'));
  t('P1 a well-formed table yields exactly its rows', good.refusal === null && good.traps.join(',') === 'hydration-race,stale-dist');
  t('P2 the row scan stops at the table, not at the next table in the file', !good.traps.includes('not'));
  t('P3 a clean parse reports no duplicates', good.duplicates.length === 0);

  const dup = extractTrapVocabulary(table('| `stale-dist` | a | b |', '| `stale-dist` | c | d |'));
  t('P4 a trap documented twice is reported', dup.refusal === null && dup.duplicates.join(',') === 'stale-dist' && dup.traps.length === 1);

  // ── the refusals: each of these, returning an empty vocabulary quietly, is
  //    the fail-open this whole block exists to make impossible ──────────────
  const refusals = [
    ['R1 a table with a header and ZERO rows', table()],
    ['R2 the heading renamed away', table('| `stale-dist` | a | b |').replace(TRAP_HEADING, '### Traps you may hit')],
    ['R3 no table under the heading (prose, then the next heading)', ['', TRAP_HEADING, '', 'See the skill for the list.', '', '## Next section', ''].join('\n')],
    ['R4 a row that lost its backticks', table('| `hydration-race` | a | b |', '| stale-dist | c | d |')],
    ['R5 a different table sitting under the heading', table('| `stale-dist` | a | b |').replace('| trap | what it fakes | counter |', '| oracle | when | why |')],
    ['R6 an empty file', ''],
    ['R7 the separator row missing', ['', TRAP_HEADING, '', '| trap | what it fakes | counter |', '| `stale-dist` | a | b |', ''].join('\n')],
    ['R8 the heading present but the file ends', ['', TRAP_HEADING, ''].join('\n')],
  ];
  for (const [what, md] of refusals) {
    const r = extractTrapVocabulary(md);
    t(`${what} is REFUSED, not read as an empty vocabulary`, typeof r.refusal === 'string' && r.refusal.length > 0 && r.traps.length === 0);
  }

  // The invariant behind every refusal above, asserted as an invariant rather
  // than case by case: no input may yield "nothing to check" without saying so.
  const allInputs = [...refusals.map(([, md]) => md), table('| `x` | a | b |'), '| trap |\n|---|\n| `y` |'];
  t(
    'R9 no input yields an empty vocabulary with no refusal',
    allInputs.every((md) => {
      const r = extractTrapVocabulary(md);
      return r.traps.length > 0 || (typeof r.refusal === 'string' && r.refusal.length > 0);
    }),
  );

  // ── the item side: both drift shapes the card names ───────────────────────
  const vocab = new Set(['hydration-race', 'stale-dist', 'wrong-persona']);
  t('C1 a documented trap passes', trapProblems({ traps: ['hydration-race'] }, vocab).length === 0);
  t('C2 an item with no traps is fine (optional field)', trapProblems({}, vocab).length === 0);
  const invented = trapProblems({ traps: ['totally-invented-trap'] }, vocab);
  t('C3 drift shape 1 — an undocumented trap is flagged', invented.length === 1 && invented[0].includes('totally-invented-trap'));
  const typo = trapProblems({ traps: ['hydration-races'] }, vocab);
  t('C4 drift shape 2 — a TYPO of a documented trap is flagged', typo.length === 1 && typo[0].includes('hydration-races'));
  t('C5 the typo message names the trap that was meant', typo.length === 1 && typo[0].includes('did you mean `hydration-race`'));
  const padded = trapProblems({ traps: ['wrong-persona '] }, vocab);
  t('C6 a trailing-space spelling is flagged, not trimmed away', padded.some((m) => m.includes('whitespace')));
  t('C7 a non-array "traps" is flagged', trapProblems({ traps: 'hydration-race' }, vocab).length === 1);
  t('C8 an empty-string trap is flagged', trapProblems({ traps: [''] }, vocab).length === 1);
  t('C9 a trap listed twice on one item is flagged', trapProblems({ traps: ['stale-dist', 'stale-dist'] }, vocab).some((m) => m.includes('twice')));

  return { checked, failures };
}

if (process.argv.slice(2).includes('--self-test')) {
  const r = selfTestTrapVocabulary();
  if (r.failures.length === 0) {
    console.log(`✓ check-platform-checklist --self-test: ${r.checked} assertions — the trap-table extractor reads a good table and REFUSES an empty/renamed/reshaped one.`);
    process.exit(0);
  }
  console.error(`✗ check-platform-checklist --self-test — ${r.failures.length} failure(s)\n`);
  for (const f of r.failures) console.error(`  • ${f}`);
  process.exit(1);
}

// The extractor's own positive control, before it is trusted with anything.
const trapControl = selfTestTrapVocabulary();
if (trapControl.failures.length) {
  console.error("check-platform-checklist: the trap-vocabulary extractor's own positive control FAILED — this check cannot be trusted, and a green from it would mean nothing.\n");
  for (const f of trapControl.failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

if (!existsSync(RUNNER_FILE)) {
  console.error(`check-platform-checklist: missing ${RUNNER_FILE} — the trap vocabulary lives in its "${TRAP_HEADING}" table and \`traps\` has nothing to validate against.`);
  process.exit(1);
}
const trapTable = extractTrapVocabulary(readFileSync(RUNNER_FILE, 'utf8'));
if (trapTable.refusal) {
  console.error(`check-platform-checklist: cannot read the trap vocabulary out of docs/qa/platform-checklist/RUNNER.md — ${trapTable.refusal}`);
  console.error('\nThis is a REFUSAL, not a pass: with no vocabulary, every item\'s `traps` would validate against an empty set and report zero problems.');
  process.exit(1);
}
const TRAPS = new Set(trapTable.traps);
for (const d of trapTable.duplicates) {
  err('RUNNER.md', null, `\`${TRAP_HEADING}\` lists \`${d}\` twice — one trap, one row, one definition`);
}

if (!existsSync(AREAS_DIR)) {
  console.error(`check-platform-checklist: missing ${AREAS_DIR}`);
  process.exit(1);
}

const files = readdirSync(AREAS_DIR).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('check-platform-checklist: no area files found — the ledger cannot be empty.');
  process.exit(1);
}

const allIds = new Map(); // id -> file
const allItems = [];

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(AREAS_DIR, file), 'utf8'));
  } catch (e) {
    err(file, null, `does not parse as JSON: ${e.message}`);
    continue;
  }
  const stem = basename(file, '.json');
  if (doc.area !== stem) err(file, null, `"area" is ${JSON.stringify(doc.area)} but the filename says "${stem}"`);
  if (typeof doc.title !== 'string' || !doc.title) err(file, null, 'missing "title"');
  if (!Array.isArray(doc.items) || doc.items.length === 0) {
    err(file, null, '"items" must be a non-empty array');
    continue;
  }

  for (const item of doc.items) {
    const id = typeof item.id === 'string' ? item.id : '<no id>';
    const where = (msg) => err(file, id, msg);

    if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(id)) where('id must be "<area>.<slug>" in kebab-case');
    else if (!id.startsWith(`${doc.area}.`)) where(`id must be prefixed with its own area ("${doc.area}.")`);
    if (allIds.has(id)) where(`duplicate id — already defined in ${allIds.get(id)}; ids are immutable and never reused`);
    allIds.set(id, file);
    allItems.push({ file, item });

    if (typeof item.title !== 'string' || !item.title) where('missing "title"');
    if (!STATUSES.has(item.status)) where(`"status" must be one of ${[...STATUSES].join('|')}`);
    if (!PRIORITIES.has(item.priority)) where(`"priority" must be one of ${[...PRIORITIES].join('|')}`);
    if (!SURFACES.has(item.surface)) where(`"surface" must be one of ${[...SURFACES].join('|')}`);
    if (typeof item.since !== 'string' || !/^v\d+(\.\d+)?$/.test(item.since)) {
      where('"since" must be the release that introduced the capability, e.g. "v16" or "v16.0"');
    }

    if (!Number.isInteger(item.revision) || item.revision < 1) where('"revision" must be an integer >= 1');
    if (!Array.isArray(item.history) || item.history.length === 0) {
      where('"history" must be a non-empty array — every item records why it exists');
    } else {
      const last = item.history[item.history.length - 1];
      if (last.revision !== item.revision) {
        where(`"revision" (${item.revision}) must equal the last history entry's revision (${last.revision}) — a semantic edit bumps both`);
      }
      for (const h of item.history) {
        if (!Number.isInteger(h.revision) || typeof h.date !== 'string' || typeof h.change !== 'string') {
          where('each history entry needs { revision, date, change }');
          break;
        }
      }
    }

    if (!Array.isArray(item.steps) || item.steps.length === 0) where('"steps" must be a non-empty array of strings');

    for (const msg of trapProblems(item, TRAPS)) where(msg);

    if (item.status === 'retired') {
      if (typeof item.retiredReason !== 'string' || !item.retiredReason) where('retired items must carry "retiredReason"');
    } else {
      if (!Array.isArray(item.acceptance) || item.acceptance.length === 0) {
        where('active/draft items must have at least one acceptance clause');
      } else {
        item.acceptance.forEach((c, i) => {
          if (typeof c.clause !== 'string' || !c.clause) where(`acceptance[${i}] missing "clause"`);
          if (!ORACLES.has(c.oracle)) where(`acceptance[${i}] "oracle" must be one of ${[...ORACLES].join('|')}`);
          if (typeof c.verify !== 'string' || !c.verify) where(`acceptance[${i}] missing "verify" — how the oracle is consulted`);
        });
      }
    }

    if (item.blocked !== undefined) {
      if (!BLOCKED_BY.has(item.blocked?.by)) where(`"blocked.by" must be one of ${[...BLOCKED_BY].join('|')}`);
      if (typeof item.blocked?.ref !== 'string' || !item.blocked.ref) {
        where('"blocked.ref" must name the tracking issue/fixture gap — waive-with-a-reference, never silently');
      }
    }

    if (item.automated !== undefined && item.automated !== null) {
      if (typeof item.automated.ref !== 'string' || !item.automated.ref) where('"automated.ref" must point at the pinning test');
    }

    if (item.enumSource !== undefined) {
      const es = item.enumSource;
      if (typeof es?.file !== 'string' || typeof es?.export !== 'string' || !Number.isInteger(es?.expect)) {
        where('"enumSource" needs { file, export, expect } — the spec enum this item\'s variants matrix was authored against');
      }
    }
  }
}

// ── Variants-freshness ratchet ──────────────────────────────────────────────
// A matrix item's `variants` list is hand-authored against a spec value enum
// (49 field types, 20 chart types, …). When the spec grows or shrinks that
// enum, nothing used to force the matrix to follow — the drift was only caught
// indirectly by the showcase coverage.test.ts demonstrability gate. `enumSource`
// pins the enum here: {file, export, expect}. This check extracts the CURRENT
// member count from the spec source (comment-stripped, deduped — enum blocks
// carry prose comments quoting member names) and fails when it no longer equals
// `expect`. Fixing the failure = revising the item's variants for the new
// member(s), bumping the item revision, and updating `expect` — exactly the
// "platform grew a capability, the checklist must follow" moment this gate
// exists to force. Extractor rot is loud, not fail-open: a missing file or
// export is an error, never a silent skip.
function extractEnumMembers(absFile, exportName) {
  // Masked ONCE, up front, rather than per-segment: comment spans are blanked
  // in place, so every offset below still indexes the real file, and the
  // bracket walk can no longer be closed early by a `]` that lives in a
  // comment. Masking a SLICE would be the same defect one level down -- a
  // fragment starting mid-file has no literal context to scan from.
  const src = maskComments(readFileSync(absFile, 'utf8'));
  const decl = src.match(new RegExp(`(?:export\\s+)?const\\s+${exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^=]*=`));
  if (!decl) return null;
  const start = src.indexOf('[', decl.index + decl[0].length);
  if (start === -1) return null;
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') {
      depth--;
      if (depth === 0) {
        const seg = src.slice(start, j + 1);
        const seen = new Set();
        for (const m of seg.matchAll(/'([a-zA-Z0-9_\-]+)'/g)) seen.add(m[1]);
        return [...seen];
      }
    }
  }
  return null;
}

for (const { file, item } of allItems) {
  const es = item.enumSource;
  if (!es || typeof es.file !== 'string' || typeof es.export !== 'string') continue;
  const abs = join(ROOT, es.file);
  if (!existsSync(abs)) {
    err(file, item.id, `enumSource.file not found: ${es.file} — the pinned spec source moved; re-point the pin`);
    continue;
  }
  const members = extractEnumMembers(abs, es.export);
  if (members === null) {
    err(file, item.id, `enumSource export "${es.export}" not found in ${es.file} — renamed or reshaped; re-point the pin (extractor must stay loud, never fail-open)`);
    continue;
  }
  if (members.length !== es.expect) {
    err(file, item.id, `VARIANTS STALE — ${es.export} in ${es.file} now has ${members.length} members but this item's variants were authored against ${es.expect}. The platform grew/shrank this surface: revise the variants matrix, bump the item revision, and set enumSource.expect to ${members.length}.`);
  }
}

// Cross-file referential integrity: supersededBy must land on a real id.
for (const { file, item } of allItems) {
  if (item.supersededBy !== undefined && !allIds.has(item.supersededBy)) {
    err(file, item.id, `"supersededBy" points at unknown id "${item.supersededBy}"`);
  }
}

// Trap vocabulary, the other direction. Bidirectional on purpose, mirroring
// the coverage ratchet's UNCLASSIFIED/ORPHAN pair: a documented trap nobody
// lists is a definition the runner is never asked to rule out, and the usual
// reason for one is that the item carrying it was retyped or retired.
const usedTraps = new Set();
for (const { item } of allItems) {
  if (!Array.isArray(item.traps)) continue;
  for (const t of item.traps) if (typeof t === 'string' && t.trim()) usedTraps.add(t.trim());
}
for (const t of TRAPS) {
  if (!usedTraps.has(t)) {
    err(
      'RUNNER.md',
      null,
      `\`${TRAP_HEADING}\` documents \`${t}\` but no checklist item lists it — put it on the items it protects, or drop the row; a definition nothing points at is one no run will ever rule out`,
    );
  }
}

// ── Capability-coverage ratchet ─────────────────────────────────────────────
// "凡是有的能力, 都要测试" made mechanical: the universe of governed metadata
// kinds is derived from packages/spec/liveness/*.json (the ADR-0049 ledger
// set), and coverage.json must map every kind to ≥1 checklist item or waive it
// with a reason. Bidirectional, mirroring the liveness ledger's own
// UNCLASSIFIED/ORPHAN discipline: an unmapped kind fails (the platform grew a
// capability the checklist doesn't test), and a mapped kind with no liveness
// ledger fails (the entry outlived the capability).
const COVERAGE_FILE = join(ROOT, 'docs/qa/platform-checklist/coverage.json');
const LIVENESS_DIR = join(ROOT, 'packages/spec/liveness');
let waivedCount = 0;
let mappedCount = 0;
if (!existsSync(COVERAGE_FILE)) {
  err('coverage.json', null, 'missing — every liveness-governed metadata kind must be mapped or waived');
} else if (!existsSync(LIVENESS_DIR)) {
  err('coverage.json', null, `cannot derive the kind universe: ${LIVENESS_DIR} not found`);
} else {
  let cov;
  try {
    cov = JSON.parse(readFileSync(COVERAGE_FILE, 'utf8'));
  } catch (e) {
    cov = null;
    err('coverage.json', null, `does not parse as JSON: ${e.message}`);
  }
  if (cov) {
    const universe = readdirSync(LIVENESS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => basename(f, '.json'))
      .sort();
    const map = cov.metadataKinds ?? {};
    for (const kind of universe) {
      const entry = map[kind];
      if (entry === undefined) {
        err('coverage.json', kind, 'UNCLASSIFIED — the platform has this capability (liveness ledger exists) but the checklist neither tests nor waives it. Add items or a waiver with a reason.');
        continue;
      }
      const hasItems = Array.isArray(entry.items) && entry.items.length > 0;
      const hasWaiver = typeof entry.waived === 'string' && entry.waived.trim().length > 0;
      if (hasItems === hasWaiver) {
        err('coverage.json', kind, 'must have EITHER non-empty "items" OR a non-empty "waived" reason — not both, not neither');
        continue;
      }
      if (hasItems) {
        mappedCount++;
        for (const id of entry.items) {
          if (!allIds.has(id)) err('coverage.json', kind, `maps to unknown item id "${id}"`);
          else {
            const mapped = allItems.find((r) => r.item.id === id);
            if (mapped?.item.status === 'retired') {
              err('coverage.json', kind, `maps to retired item "${id}" — point at its successor or re-waive the kind`);
            }
          }
        }
      } else {
        waivedCount++;
      }
    }
    for (const kind of Object.keys(map)) {
      if (!universe.includes(kind)) {
        err('coverage.json', kind, `ORPHAN — mapped kind has no packages/spec/liveness/${kind}.json ledger; remove the entry or restore the ledger`);
      }
    }
  }
}

if (errors.length) {
  console.error(`check-platform-checklist: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\nContract: docs/qa/platform-checklist/README.md (authoring) · RUNNER.md (execution).');
  process.exit(1);
}

const total = allItems.length;
const active = allItems.filter(({ item }) => item.status === 'active').length;
console.log(
  `check-platform-checklist: OK — ${files.length} areas, ${total} items (${active} active); coverage: ${mappedCount} kinds mapped, ${waivedCount} waived;` +
    ` traps: ${TRAPS.size} documented, ${usedTraps.size} in use (extractor control: ${trapControl.checked} assertions).`,
);
