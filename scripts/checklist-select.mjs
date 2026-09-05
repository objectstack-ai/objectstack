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
// Prefix-less conveniences (paste a filename/path, no prefix to remember):
//   records-forms.json      a list-directory (areas/) filename = area:records-forms
//   …/areas/records-forms.json   the full path works too (matched by basename)
//   packages/foo/bar.ts     any path with a `/` or a code extension = file:<that path>
//
// Blocked items (carrying `blocked:{by,ref}`) are EXCLUDED by default — they cannot run
// on stock fixtures. Pass --include-blocked to list them too (the runner records them as
// blocked with their fixture reason, per RUNNER.md).
//
// Output: a table (id · priority · surface · blocked?) to stderr for humans, and — with
// --json — a machine list to stdout for the runner to fan out over.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';

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

  // No recognized prefix → try, in order: a checklist area FILE from the list dir
  // (`records-forms.json`, or a full `…/areas/records-forms.json` path) → that area;
  // a framework SOURCE-file path (has a `/` or a code extension) → resolve like `file:`;
  // then a bare item id; then a bare area name. Lets you paste a list-directory filename
  // or a source path with no prefix to remember.
  if (key === null) {
    const raw = val.replace(/^\.?\//, '');
    const base = basename(raw);
    if (base.endsWith('.json')) {
      const stem = base.slice(0, -'.json'.length); // "records-forms.json" → "records-forms"
      const inArea = active.filter((it) => it.id.startsWith(`${stem}.`));
      if (inArea.length) return inArea;
    }
    if (raw.includes('/') || /\.(tsx?|jsx?|mjs|cjs)$/.test(base)) {
      return selectItems(`file:${raw}`, items, coverage);
    }
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
// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// Reaching the success line without an `eq` having exited used to be this
// self-test's ONLY success condition, so "every case held" and "the cases
// never ran" printed the same line. Closed the way PR #13487 validated on
// check-doc-authoring: what is pinned is the registered NAMES, not a
// number. The floor requires the OPENED set to equal the DECLARED set with
// each battery at or above its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. It
// carries fewer than the two named section banners the sectioning criterion
// needs, and ⛔ a comment is NOT promoted to a section head — that is a
// judgement per comment this transplant does not make. The hoisted single
// battery is the shape PR #14896, PR #15003 and PR #15217 landed for exactly
// this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'checklist-select self-test': 17,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

let selfTestReachedVerdict = false;

function selfTest() {
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
  battery('checklist-select self-test');
  const FIX = [
    { id: 'a.one', status: 'active', priority: 'P0', surface: 'browser', since: 'v16', source: ['packages/foo/bar.ts'] },
    { id: 'a.two', status: 'active', priority: 'P1', surface: 'api', since: 'v16.1', source: ['#3358'], blocked: { by: 'fixture', ref: '#1' } },
    { id: 'b.three', status: 'active', priority: 'P0', surface: 'api', since: 'v15', source: ['packages/foo/baz.ts'] },
    { id: 'b.gone', status: 'retired', priority: 'P0', surface: 'api', since: 'v15', retiredReason: 'x' },
  ];
  const COV = { metadataKinds: { hook: { items: ['a.one'] } } };
  const ids = (sel) => selectItems(sel, FIX, COV).map((i) => i.id).sort();
  // Counted, never transcribed (#15305): the success line below used to carry a
  // hand-typed `17`, a number nothing derived and nothing compared — accurate on
  // the day it was typed and silently wrong the first time a case is added or
  // removed. It is now read off this counter.
  let cases = 0;
  const eq = (got, want, name) => {
    registerCase();
    cases += 1;
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
  // prefix-less conveniences
  eq(ids('a.json'), ['a.one', 'a.two'], 'bare area-file name .json → area');
  eq(ids('docs/qa/platform-checklist/areas/b.json'), ['b.three'], 'area-file full path → area (by basename)');
  eq(ids('packages/foo/bar.ts'), ['a.one'], 'bare source path (has /) → file: mode');
  eq(ids('bar.ts'), ['a.one'], 'bare source basename (code ext) → file: mode');
  eq(ids('missing.json'), [], 'unmatched .json name → empty, no throw');
  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  // The floor's refusal joins the SAME sink the cases use — a `✗` line on stderr
  // and exit 1 — so a breached floor cannot be printed over by the success line.
  const floorFailure = (message) => { console.error(`✗ ${message}`); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  if (floorBreached) process.exit(1);

  console.log(`✓ checklist-select self-test: ${cases} cases pass.`);
  selfTestReachedVerdict = true;
  process.exit(0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
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
}

// The dispatch runs only when node ran THIS file. Imported for `selectItems`
// (the skill's front half is a pure resolver), the old top-level CLI printed a
// usage block to the importer's stderr and killed it with exit 2 mid-import.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ checklist-select self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  }
  main();
}
