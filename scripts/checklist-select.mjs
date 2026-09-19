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
// PLANNED items (`status: "planned"`) are never runnable by any selector and there is no
// flag that makes them so — the capability does not exist yet, so there is nothing to
// drive and no oracle to consult. They are REPORTED instead: the same selector resolves
// against them and they are printed under a PLANNED heading for the run record to carry
// as the verdict `planned`. ⛔ A planned id must not reach a runner; whatever verdict
// came back would be about nothing.
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
 *
 * `opts.status` picks WHICH pool the same selector resolves against, and
 * defaults to the runnable one. A `planned` item records a capability the
 * definition requires and the platform does not yet verify: there is nothing to
 * drive, so it must never reach a runner — but it must not vanish either, or a
 * selector answers "nothing here" about an area whose gap the ledger is
 * deliberately carrying. Resolving one selector against both pools is what lets
 * the CLI below report a planned item AS planned while running nothing for it.
 *
 * @param {string} selector
 * @param {object[]} items
 * @param {{metadataKinds?: Record<string, {items?: string[]}>}} [coverage]
 * @param {{status?: string}} [opts]
 * @returns {object[]} the matched items (order: as declared)
 */
export function selectItems(selector, items, coverage = { metadataKinds: {} }, opts = {}) {
  const active = items.filter((it) => it.status === (opts.status ?? 'active'));
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
      // `opts` rides along: a prefix-less path resolved against the planned
      // pool must stay in the planned pool, or the convenience form silently
      // answers from a different ledger than the one asked about.
      return selectItems(`file:${raw}`, items, coverage, opts);
    }
    const asId = byId(val);
    if (asId.length) return asId;
    return active.filter((it) => it.id.startsWith(`${val}.`));
  }
  return []; // unknown prefix
}

/**
 * The same selector, resolved against the PLANNED pool. The runner reports what
 * this returns as `planned` and drives none of it (RUNNER.md "Verdicts") — a
 * planned item is never `pass`, never `fail`, never `blocked`, because no
 * oracle was consulted and none could have been.
 *
 * ⛔ Not a variant of `--include-blocked`: a blocked item is a real test the
 * environment cannot run today, and hiding it is a fixture problem. A planned
 * item has nothing to run at all.
 */
export function selectPlanned(selector, items, coverage = { metadataKinds: {} }) {
  return selectItems(selector, items, coverage, { status: 'planned' });
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
// 17 → 31: the `planned` status. Every selector shape is driven against the
// runnable pool to prove a planned item is in NONE of them, and against the
// planned pool to prove it is still reachable — the two halves of "skipped by
// every selector, reported as `planned`".
const SELF_TEST_BATTERIES = Object.freeze({
  'checklist-select self-test': 31,
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
    { id: 'b.promised', status: 'planned', priority: 'P1', surface: 'api', since: null, personas: ['admin'], source: ['packages/foo/baz.ts'] },
  ];
  const COV = { metadataKinds: { hook: { items: ['a.one'] }, widget: { items: ['b.promised'] } } };
  const ids = (sel) => selectItems(sel, FIX, COV).map((i) => i.id).sort();
  const plannedIds = (sel) => selectPlanned(sel, FIX, COV).map((i) => i.id).sort();
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
  // ── planned items: skipped by every selector, reported by their own ───────
  // The runnable pool is what a runner drives, so the FIRST direction is that a
  // planned item never appears in it — by any spelling of any selector, which
  // is why each shape is driven rather than the one that happens to be handy.
  eq(ids('all'), ['a.one', 'a.two', 'b.three'], 'all excludes planned as well as retired');
  eq(ids('area:b'), ['b.three'], 'area: excludes planned');
  eq(ids('b.promised'), [], 'a planned item asked for BY ID is still not runnable');
  eq(ids('priority:P1'), ['a.two'], 'priority: excludes planned');
  eq(ids('surface:api'), ['a.two', 'b.three'], 'surface: excludes planned');
  eq(ids('capability:widget'), [], 'capability: excludes planned — a kind mapped only to planned items resolves to nothing runnable');
  eq(ids('file:packages/foo/baz.ts'), ['b.three'], 'file: excludes planned');
  // The second direction — and the one that makes the first safe. If planned
  // items were only dropped, a selector would answer "nothing here" about an
  // area whose gap the ledger is deliberately carrying.
  eq(plannedIds('all'), ['b.promised'], 'the planned pool is reachable by the same selector');
  eq(plannedIds('area:b'), ['b.promised'], 'area: resolves against the planned pool');
  eq(plannedIds('b.promised'), ['b.promised'], 'a bare planned id resolves in the planned pool');
  eq(plannedIds('capability:widget'), ['b.promised'], 'capability: resolves against the planned pool — this is where a capability-gap card points');
  eq(plannedIds('packages/foo/baz.ts'), ['b.promised'], 'the prefix-less path form keeps the pool it was asked about');
  eq(plannedIds('area:a'), [], 'an area with no planned items reports none — the pool is not a fallback');
  eq(plannedIds('b.gone'), [], 'retired is not planned — two different absences, not one');
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
  const planned = selectPlanned(selector, items, coverage);

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
  // Reported, never returned. The JSON the runner fans out over stays the
  // RUNNABLE list — a planned id reaching a runner would be driven, and
  // whatever verdict came back would be about nothing. What the run record owes
  // these ids is the verdict `planned`, which no oracle is consulted for.
  if (planned.length) {
    console.error(`\n  ${planned.length} PLANNED item(s) matched this selector — not run, and not runnable: the definition requires the capability and the platform does not verify it yet.`);
    console.error('  Record each as `planned` in the run record (⛔ never pass/fail/blocked — no oracle was consulted), and do not drive any of them.');
    for (const it of planned) {
      console.error(`    ${it.priority}  ${String(it.surface ?? '-').padEnd(8)}  ${it.id}${it.since ? `  → target ${it.since}` : ''}`);
    }
  }
  if (matched.length === 0) {
    // A selector that matched ONLY planned items is answered, not refused: the
    // ledger has something to say about it and said it above. "Nothing matched"
    // would send the caller off to fix a selector that is working.
    if (planned.length) {
      console.error('\n  (nothing to run: every match is planned — report them as `planned` and stop)');
      return;
    }
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
