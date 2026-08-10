#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// checklist-select — resolve a SELECTOR into the concrete set of platform-checklist
// items to run. The deterministic front half of the `checklist-test` skill: the skill
// drives a browser, this script decides WHAT to drive, with zero LLM guesswork.
//
//   node scripts/checklist-select.mjs <selector> [--json] [--include-blocked]
//   node scripts/checklist-select.mjs --self-test
//
// ## Selectors (one per invocation)
//
//   <area>.<slug>            an exact item id            e.g. platform-core.console-login
//   item:<id>               same, explicit
//   area:<area>             every item in an area        e.g. area:records-forms
//   <area>                  bare area name = area:<area> e.g. approvals
//   capability:<kind>       items mapped to a metadata kind in coverage.json  e.g. capability:hook
//   priority:P0|P1|P2       every item at that priority
//   surface:browser|api|... every item on that execution surface
//   since:vN                every item introduced in release vN (prefix match: since:v16 ⊇ v16.0)
//   file:<path>             ★ items whose `source[]` cites this framework file (or its
//                           basename / containing dir) — "test whatever covers this file"
//   all                     every active item
//
// Blocked items (carrying `blocked:{by,ref}`) are EXCLUDED by default — they cannot run
// on stock fixtures. Pass --include-blocked to list them too (the runner records them as
// blocked with their fixture reason, per RUNNER.md).
//
// Output: a table (id · priority · surface · blocked?) to stderr for humans, and — with
// --json — a machine list to stdout for the runner to fan out over.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const AREAS_DIR = join(ROOT, 'docs/qa/platform-checklist/areas');
const COVERAGE = join(ROOT, 'docs/qa/platform-checklist/coverage.json');

/** Load every item once, tagged with its area. */
function loadItems(areasDir = AREAS_DIR) {
  const items = [];
  for (const f of readdirSync(areasDir).filter((f) => f.endsWith('.json')).sort()) {
    const doc = JSON.parse(readFileSync(join(areasDir, f), 'utf8'));
    for (const it of doc.items || []) items.push(it);
  }
  return items;
}

/**
 * Resolve a selector string against a set of items (+ optional coverage map).
 * Pure and side-effect-free so the self-test can exercise it directly.
 * @returns {object[]} the matched items (order: as declared)
 */
export function selectItems(selector, items, coverage = { metadataKinds: {} }) {
  const active = items.filter((it) => it.status === 'active');
  const byId = (id) => active.filter((it) => it.id === id);

  if (selector === 'all') return active;

  const [rawKey, ...rest] = selector.includes(':') ? selector.split(':') : [null, selector];
  const key = rawKey; // null when the selector had no prefix
  const val = rest.join(':'); // rejoin so file:path/with:colons survives (rare)

  if (key === 'item') return byId(val);
  if (key === 'area') return active.filter((it) => it.id.startsWith(`${val}.`));
  if (key === 'capability') {
    const mapped = new Set((coverage.metadataKinds?.[val]?.items) || []);
    return active.filter((it) => mapped.has(it.id));
  }
  if (key === 'priority') return active.filter((it) => it.priority === val);
  if (key === 'surface') return active.filter((it) => it.surface === val);
  if (key === 'since') return active.filter((it) => it.since === val || (it.since || '').startsWith(`${val}.`));
  if (key === 'file') {
    const p = val.replace(/^\.?\//, '');
    const base = basename(p);
    const dir = dirname(p);
    // Narrowest-useful precedence: prefer items citing the exact path or its
    // basename ("test whatever covers THIS file"); only when nothing cites the
    // file directly fall back to a directory-level match (so `file:<a-dir>`
    // still resolves the items covering that area of the tree).
    const exact = active.filter((it) => (it.source || []).some((s) => s.includes(p) || s.includes(base)));
    if (exact.length) return exact;
    if (dir !== '.') return active.filter((it) => (it.source || []).some((s) => s.includes(dir)));
    return [];
  }

  // No recognized prefix → treat the whole string as an id, else as an area name.
  if (key === null) {
    const asId = byId(val);
    if (asId.length) return asId;
    return active.filter((it) => it.id.startsWith(`${val}.`));
  }
  return []; // unknown prefix
}

function isBlocked(it) {
  return it.blocked !== undefined;
}

// ── self-test ────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) {
  const FIX = [
    { id: 'a.one', status: 'active', priority: 'P0', surface: 'browser', since: 'v16', source: ['packages/foo/bar.ts'] },
    { id: 'a.two', status: 'active', priority: 'P1', surface: 'api', since: 'v16.1', source: ['#3358'], blocked: { by: 'fixture', ref: '#1' } },
    { id: 'b.three', status: 'active', priority: 'P0', surface: 'api', since: 'v15', source: ['packages/foo/baz.ts'] },
    { id: 'b.gone', status: 'retired', priority: 'P0', surface: 'api', since: 'v15', retiredReason: 'x' },
  ];
  const COV = { metadataKinds: { hook: { items: ['a.one'] } } };
  const ids = (sel) => selectItems(sel, FIX, COV).map((i) => i.id).sort();
  const eq = (got, want, name) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) { console.error(`✗ ${name}: got ${g}, want ${w}`); process.exit(1); }
  };
  eq(ids('all'), ['a.one', 'a.two', 'b.three'], 'all excludes retired');
  eq(ids('a.one'), ['a.one'], 'bare id');
  eq(ids('item:a.one'), ['a.one'], 'item: prefix');
  eq(ids('a'), ['a.one', 'a.two'], 'bare area');
  eq(ids('area:b'), ['b.three'], 'area: prefix');
  eq(ids('capability:hook'), ['a.one'], 'capability via coverage');
  eq(ids('priority:P0'), ['a.one', 'b.three'], 'priority');
  eq(ids('surface:api'), ['a.two', 'b.three'], 'surface');
  eq(ids('since:v16'), ['a.one', 'a.two'], 'since prefix (v16 ⊇ v16.1)');
  eq(ids('file:packages/foo/bar.ts'), ['a.one'], 'file exact');
  eq(ids('file:foo'), ['a.one', 'b.three'], 'file dir match');
  eq(ids('nope.xxx'), [], 'unknown id → empty');
  console.log('✓ checklist-select self-test: 12 cases pass.');
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const json = args.includes('--json');
const includeBlocked = args.includes('--include-blocked');
const selector = args.find((a) => !a.startsWith('--'));

if (!selector) {
  console.error('usage: node scripts/checklist-select.mjs <selector> [--json] [--include-blocked]');
  console.error('       selectors: <id> | area:<a> | capability:<k> | priority:P0 | surface:api | since:vN | file:<path> | all');
  process.exit(2);
}
if (!existsSync(AREAS_DIR)) {
  console.error(`checklist-select: ${AREAS_DIR} not found`);
  process.exit(1);
}

const items = loadItems();
const coverage = existsSync(COVERAGE) ? JSON.parse(readFileSync(COVERAGE, 'utf8')) : { metadataKinds: {} };
let matched = selectItems(selector, items, coverage);
const droppedBlocked = includeBlocked ? [] : matched.filter(isBlocked);
if (!includeBlocked) matched = matched.filter((it) => !isBlocked(it));

if (json) {
  process.stdout.write(JSON.stringify(matched.map((it) => ({ id: it.id, priority: it.priority, surface: it.surface, since: it.since, revision: it.revision })), null, 2) + '\n');
}

console.error(`\nselector: ${selector} → ${matched.length} runnable item(s)${droppedBlocked.length ? ` (${droppedBlocked.length} blocked, hidden — pass --include-blocked)` : ''}\n`);
for (const it of matched) {
  console.error(`  ${it.priority}  ${String(it.surface).padEnd(8)}  ${it.id}${isBlocked(it) ? '  [BLOCKED]' : ''}`);
}
if (droppedBlocked.length) {
  console.error(`\n  hidden (blocked): ${droppedBlocked.map((i) => i.id).join(', ')}`);
}
if (matched.length === 0) {
  console.error('  (nothing matched — check the selector; try `all` or `area:<name>`)');
  process.exit(1);
}
