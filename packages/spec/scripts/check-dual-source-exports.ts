// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-dual-source-exports.ts — no two entry points of @objectstack/spec may
 * export the same name for DIFFERENT declarations.
 *
 * `api-surface/` records every `name (kind)` per entry point, so a name
 * appearing on two entries is VISIBLE there — but nothing distinguishes the two
 * ways that can happen, and only one of them is fine:
 *
 *   - re-export: both entries resolve to the SAME declaration. One symbol,
 *     two import paths. Harmless, common (root `.` re-exports the domains).
 *   - dual-source: each entry resolves to its OWN declaration under a shared
 *     name. Which type you get depends on nothing but the import path.
 *
 * The dual-source case is the #4411 trap. Spec carried two differently-shaped
 * `MetadataWatchEvent`s on `./kernel` and `./system` — plus ten more pairs in
 * the same file — and the naming intuition pointed the WRONG way: the copy that
 * looked canonical (normalized enums, required fields, a `.describe()` per
 * property) was the dead one. An auto-import or a model completion picking by
 * name, or by which copy reads as more rigorous, picked the dead one; because
 * the shapes overlapped heavily, the wrong pick compiled and failed later, at
 * an edge value (`add` vs `added`) or on a field one copy made required. No
 * human review catches this: each file is locally reasonable.
 *
 * So the distinction is drawn where it exists — SYMBOL IDENTITY, not name.
 * Every export of every public entry is resolved through its alias chain to
 * the original symbol; a name whose entries resolve to two or more distinct
 * symbols is dual-source. Judging by name alone would drown the signal in
 * ~80 legitimate re-exports.
 *
 * The existing dual-sources are recorded in `dual-source-exports.baseline.json`
 * — a shrink-only ratchet. A NEW dual-source name fails this gate; an entry
 * that stops being dual-source (converged or renamed) fails until its baseline
 * line is deleted, so the ledger cannot quietly stop ratcheting. Fix a new
 * finding by NOT introducing the second declaration: import the existing one
 * and re-export it, or pick a different name. Growing the baseline is a
 * deliberate act that shows up in review as a baseline diff.
 *
 * ## Usage
 *
 *     pnpm --filter @objectstack/spec check:dual-source-exports    # self-test + audit
 *     tsx scripts/check-dual-source-exports.ts --update            # rewrite baseline (review the diff!)
 *     tsx scripts/check-dual-source-exports.ts --self-test         # fixture check only
 *
 * Reads the built dist — run after `pnpm --filter @objectstack/spec build`.
 * The declaration bundler emits each source module into exactly one output
 * chunk, so distinct dist declarations imply distinct source declarations; the
 * self-test pins the detector itself, and the count assertions keep a silent
 * resolution failure from reading as "clean".
 *
 * That precondition is enforced since #7181, and `--update` is why it matters
 * here more than in this file's two sibling gates. #7181 was filed on the reading
 * that all three "are check-only — none writes a tracked artifact, so none can
 * launder a wrong baseline into a commit". This one does: `--update` REWRITES
 * `dual-source-exports.baseline.json`, and on a stale dist it writes a partition
 * computed from declarations that predate the edit. The ratchet then makes that
 * self-consistent in both directions — a name that only became dual-source after
 * the last build is written out as clean, and the plain run compares the same
 * baseline against the same stale dist and agrees. That is #7122's laundering
 * shape exactly, one artifact over. See lib/dist-freshness.ts.
 */
import ts from 'typescript';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { EXIT_PREREQUISITE_NOT_MET, inspectDistFreshness, prerequisiteNotMetText } from './lib/dist-freshness';

const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const BASELINE_PATH = resolve(PKG_DIR, 'dual-source-exports.baseline.json');
const SELF_TEST = process.argv.includes('--self-test');
const UPDATE = process.argv.includes('--update');

/** Public entry points → their built CJS `.d.ts`, read from the exports map. */
function collectEntries(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));
  const entries: Record<string, string> = {};
  for (const [sub, val] of Object.entries<any>(pkg.exports ?? {})) {
    if (!sub.startsWith('.')) continue;
    const dts = val?.require?.types ?? val?.import?.types;
    if (typeof dts === 'string' && dts.endsWith('.d.ts')) entries[sub] = resolve(PKG_DIR, dts);
  }
  return entries;
}

function kindOf(flags: ts.SymbolFlags): string {
  if (flags & ts.SymbolFlags.Function) return 'function';
  if (flags & ts.SymbolFlags.Class) return 'class';
  if (flags & ts.SymbolFlags.Enum) return 'enum';
  if (flags & ts.SymbolFlags.Interface) return 'interface';
  if (flags & ts.SymbolFlags.TypeAlias) return 'type';
  if (flags & ts.SymbolFlags.Variable) return 'const';
  if (flags & ts.SymbolFlags.Namespace) return 'namespace';
  return 'other';
}

type ScanResult = {
  /** Stable line per dual-source name: `Name — [./a, ./b (kind)] ≠ [./c (kind)]`. */
  findings: string[];
  /** Total distinct export names seen across all entries. */
  names: number;
  /** Names on ≥2 entries that resolved to ONE symbol — the benign re-exports. */
  reExports: number;
};

/**
 * Group every entry's exports by name, then partition each name's entries by
 * the ORIGINAL symbol they resolve to. One partition = re-export; two or more
 * = dual-source. The finding line encodes the partition (which entries share a
 * declaration), not declaration positions — chunk file names carry content
 * hashes and would churn the baseline on every build.
 */
function scan(program: ts.Program, entries: Record<string, string>): ScanResult {
  const checker = program.getTypeChecker();
  const unalias = (s: ts.Symbol): ts.Symbol =>
    s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

  // name → (original symbol → entries exporting it under that name)
  const byName = new Map<string, Map<ts.Symbol, string[]>>();

  for (const [sub, file] of Object.entries(entries)) {
    const sf = program.getSourceFile(file);
    const moduleSym = sf && checker.getSymbolAtLocation(sf);
    if (!moduleSym) throw new Error(`Could not resolve module symbol for ${sub} (${file}). Is the package built?`);
    for (const exported of checker.getExportsOfModule(moduleSym)) {
      const name = exported.getName();
      const original = unalias(exported);
      let groups = byName.get(name);
      if (!groups) byName.set(name, (groups = new Map()));
      let subs = groups.get(original);
      if (!subs) groups.set(original, (subs = []));
      subs.push(sub);
    }
  }

  const result: ScanResult = { findings: [], names: byName.size, reExports: 0 };
  for (const [name, groups] of byName) {
    const multiEntry = [...groups.values()].some((subs) => subs.length > 1) || groups.size > 1;
    if (groups.size === 1) {
      if (multiEntry) result.reExports++;
      continue;
    }
    const parts = [...groups.entries()]
      .map(([sym, subs]) => `[${subs.sort().join(', ')} (${kindOf(sym.getFlags())})]`)
      .sort();
    result.findings.push(`${name} — ${parts.join(' ≠ ')}`);
  }
  result.findings.sort();
  return result;
}

function makeProgram(files: string[], extra: ts.CompilerOptions = {}): ts.Program {
  return ts.createProgram(files, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
    ...extra,
  });
}

// ── Self-test: the handshake flag ────────────────────────────────────────────
//
// Set by `selfTest()` only after its verdict line prints, and read at the
// dispatch below: a `return` that leaves the function above that line prints
// nothing, and here it does not even stop — control falls through to the audit,
// which on a fresh dist prints its own green line and exits 0. A self-test that
// never finished, reported as one that passed. ⛔ AN EXIT CODE IS NOT A
// HANDSHAKE: `fail()` below exits 1 on its own, so the exit code stays
// load-bearing; the flag is the thing an early return cannot carry with it.
let selfTestReachedVerdict = false;

// ── The self-test's own battery roster and floor ─────────────────────────────
//
// Reaching the `✅ self-test` line used to be this self-test's ONLY success
// condition, so "every case held" and "the cases never ran" printed the same
// line — no count, nothing to compare. The shrink was measured on this file's
// sibling `check-exported-any.ts`, whose self-test has the same anatomy:
// deleting one name from a fixture name list de-registers that case and the run
// still prints its verdict byte-identically and still exits 0.
//
// Closed the way `scripts/check-agent-model-declared.mjs` and its TypeScript
// ports (`scripts/check-test-typecheck.mts`, `check-duration-unit-keys.ts` in
// this very directory) closed it — COPIED and ⛔ never imported, because every
// self-test has to keep running standalone as
// `tsx scripts/check-dual-source-exports.ts --self-test`, and a shared
// assertion module would be one point of failure for every instrument at once.
// What is pinned is the registered NAMES, not a number.
//
// A BATTERY HERE IS A SECTION: this self-test is a sequence of assertions
// grouped by what they hold, so each group opens with `battery('<name>')` and
// every `expect()` after it is attributed to that name until the next opens.
//
// ⛔ A pinned TOTAL is not the repair — a battery falling from 4 cases to 1
// keeps a total "right" the moment a sibling grows — and ⛔ neither is a roster
// DERIVED from the run: a count taken from the cases that ran can never notice
// one that stopped. The two fixture name lists are exactly what a shrink
// deletes from, so their floors are their live lengths.
//
// The counts are a FLOOR, not an equality: adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running.
const SELF_TEST_BATTERIES: Readonly<Record<string, number>> = Object.freeze({
  'the fixture compiles: two entries over one shared declaration source': 1,
  'the fixture RESOLVES: the counts that keep both legs below non-vacuous': 2,
  'the RED leg: one name, two declarations — flagged in both faces of the trap': 2,
  'the GREEN leg: a re-export of ONE declaration, and a single-entry name, are NOT flagged': 4,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 4;

// The key a case is filed under when no battery is open. It is not a declared
// battery, so it reds by the same set difference rather than silently inflating
// whichever battery happened to open last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * Pin both edges: a true dual-source must be flagged (a false negative makes
 * the gate dormant — green forever, indistinguishable from clean), and a
 * re-export must NOT be (a false positive drowns the signal in the ~80
 * legitimate re-exports the real surface carries).
 */
function selfTest(): void {
  const fail = (msg: string): never => {
    console.error(`✗ self-test: ${msg}`);
    process.exit(1);
  };

  // The battery ledger this self-test's floor is evaluated against.
  // `battery()` opens a battery; every `expect()` below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  //
  // Registration is the FIRST statement of `expect()`, before the outcome is
  // consulted, because the floor asserts REACH: a case that runs and FAILS
  // still registers (and `fail()` exits loudly on its own), and only a case that
  // never runs at all goes missing from the ledger. Routing registration
  // through the failure path instead would register a case only when it failed
  // — a fully green run would register 0 and every battery would read DID NOT
  // RUN, the floor inverted rather than installed.
  const seen = new Map<string, number>();
  let openBattery: string | undefined;
  const battery = (name: string): void => {
    openBattery = name;
  };
  const expect = (ok: boolean, msg: string | (() => string)): void => {
    const attributedTo = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(attributedTo, (seen.get(attributedTo) ?? 0) + 1);
    if (!ok) fail(typeof msg === 'function' ? msg() : msg);
  };

  const dir = mkdtempSync(join(tmpdir(), 'spec-dual-source-'));
  try {
    // shared.ts — the single-source declarations both entries re-export.
    writeFileSync(join(dir, 'shared.ts'), [
      `export type SharedType = { a: string };`,
      `export const sharedConst = 1;`,
    ].join('\n'), 'utf8');
    // Entry A: re-exports shared, declares its own TrueDup + Mixed (type).
    writeFileSync(join(dir, 'a.ts'), [
      `export { SharedType, sharedConst } from './shared';`,
      `export type TrueDup = { fromA: true };`,
      `export type Mixed = { a: string };`,
      `export type OnlyA = { onlyA: true };`,
    ].join('\n'), 'utf8');
    // Entry B: re-exports shared, declares its own TrueDup + Mixed (const) —
    // the type-vs-const face of the same trap.
    writeFileSync(join(dir, 'b.ts'), [
      `export type { SharedType } from './shared';`,
      `export { sharedConst } from './shared';`,
      `export type TrueDup = { fromB: true };`,
      `export const Mixed = { a: 'b' };`,
      `export type OnlyB = { onlyB: true };`,
    ].join('\n'), 'utf8');

    const entries = { './a': join(dir, 'a.ts'), './b': join(dir, 'b.ts') };
    const program = makeProgram(Object.values(entries));
    battery('the fixture compiles: two entries over one shared declaration source');
    const syntactic = program.getSyntacticDiagnostics();
    expect(
      syntactic.length === 0,
      () => `fixture does not parse: ${ts.flattenDiagnosticMessageText(syntactic[0].messageText, ' ')}`,
    );

    const { findings, names, reExports } = scan(program, entries);
    const flagged = new Set(findings.map((f) => f.split(' — ')[0]));

    // 6 distinct names (SharedType, sharedConst, TrueDup, Mixed, OnlyA, OnlyB).
    // Fewer means exports are not resolving, and every assertion below would
    // pass vacuously — the exact way a gate goes dormant.
    battery('the fixture RESOLVES: the counts that keep both legs below non-vacuous');
    expect(names === 6, `saw ${names} export names, expected 6 — the fixture's modules are not resolving`);
    expect(reExports === 2, `saw ${reExports} re-exported names, expected 2 (SharedType, sharedConst) — alias resolution is broken`);

    battery('the RED leg: one name, two declarations — flagged in both faces of the trap');
    for (const name of ['TrueDup', 'Mixed']) {
      expect(flagged.has(name), `missed \`${name}\` — two declarations share the name and the gate is DORMANT`);
    }
    battery('the GREEN leg: a re-export of ONE declaration, and a single-entry name, are NOT flagged');
    for (const name of ['SharedType', 'sharedConst', 'OnlyA', 'OnlyB']) {
      expect(!flagged.has(name), `false positive on \`${name}\` — only same-name DIFFERENT-declaration exports may be flagged`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases ──────────────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered EQUALS the set declared, each at or above its own
  // count. A set difference names WHICH battery stopped; a count says only that
  // something did — and, before this block existed, not even that.
  const floorProblems: string[] = [];
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorProblems.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorProblems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorProblems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — ${SELF_TEST_BATTERIES[name] - count} case(s) that used to run no longer do.`,
    );
  }
  if (floorProblems.length > 0) {
    for (const problem of floorProblems) console.error(`✗ self-test floor: ${problem}`);
    console.error(
      '✗ self-test floor: A battery below its floor means cases STOPPED RUNNING — the battery is the ' +
        'bug, not the number. Find what stopped registering (a name deleted from a fixture name list, ' +
        'a guard that now skips, an early return) and restore it.',
    );
    process.exit(1);
  }

  // The count is printed because a reader had to hand-tally the assertions to
  // get one, and it is printed AFTER the floor rather than instead of it: the
  // number is evidence, the floor is the proof.
  const registered = [...seen.values()].reduce((a, b) => a + b, 0);
  console.log(
    '✅  self-test: flags same-name different-declaration exports, and nothing else — ' +
      `${registered} case(s) across ${declaredBatteries.length} batteries, every battery at or above ` +
      'its pinned floor.',
  );
  selfTestReachedVerdict = true;
}

if (SELF_TEST) {
  selfTest();
  // The handshake. Without it a `return` above the verdict prints nothing and
  // does not even stop: control reaches the audit below, which on a fresh dist
  // prints its own green line and exits 0 — a self-test that never finished,
  // reported as one that passed. `fail()`'s own exit code stays load-bearing;
  // this refuses to believe a SILENT success.
  if (!selfTestReachedVerdict) {
    console.error(
      '\n✗ check-dual-source-exports self-test: selfTest() returned without reaching its verdict,\n' +
        'so no verdict line was printed. Exiting 0 here would report a self-test that never\n' +
        'finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
  process.exit(0);
}

// ── Audit ────────────────────────────────────────────────────────────────────

// BEFORE a single `.d.ts` is read (#7181, adopting #7122's primitive). `--update`
// is `generate`-shaped — it writes a tracked baseline — so it gets the writing
// damage, and the plain run gets the false-green one. Placed after `--self-test`
// on purpose: that path builds its own fixture in a temp dir and never reads
// `dist/`, so refusing it on a stale dist would refuse a run that is unaffected.
const freshness = inspectDistFreshness(
  PKG_DIR,
  UPDATE ? 'generate' : 'check',
  UPDATE
    ? 'pnpm --filter @objectstack/spec exec tsx scripts/check-dual-source-exports.ts --update'
    : 'pnpm --filter @objectstack/spec check:dual-source-exports',
);
if (!freshness.fresh) {
  // PREREQUISITE NOT MET, not a finding (#19227) — in BOTH modes. `--update` is
  // the writing half, and a refusal there is still "nothing was measured": the
  // baseline on disk is untouched, so no ratchet verdict exists to report.
  console.error(
    prerequisiteNotMetText(
      UPDATE ? 'check-dual-source-exports.ts --update' : 'check:dual-source-exports',
      freshness,
    ),
  );
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}

const entries = collectEntries();
const { findings, names, reExports } = scan(makeProgram(Object.values(entries)), entries);

interface Baseline { _comment: string; entries: string[] }

const BASELINE_COMMENT =
  'Accepted cross-entry DUAL-SOURCE exports of @objectstack/spec (#4446): names that two or more ' +
  'public entry points export for DIFFERENT declarations, so which type a consumer gets depends on ' +
  'the import path — the #4411 trap. Shrink-only ratchet, judged by symbol identity (a re-export of ' +
  'one declaration from many entries is fine and not listed). A NEW name here fails ' +
  'check:dual-source-exports: converge on one declaration and re-export it, or rename one side — ' +
  'growing this list needs maintainer sign-off and shows up as this file in the diff. An entry that ' +
  'stops being dual-source fails until its line is deleted. Regenerate with: ' +
  'tsx scripts/check-dual-source-exports.ts --update (after pnpm build).';

if (UPDATE) {
  const doc: Baseline = { _comment: BASELINE_COMMENT, entries: findings };
  writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + '\n');
  console.log(`Wrote ${findings.length} dual-source entr${findings.length === 1 ? 'y' : 'ies'} to dual-source-exports.baseline.json — review the diff before committing.`);
  process.exit(0);
}

let baseline: Baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`No baseline at ${BASELINE_PATH}. Run \`tsx scripts/check-dual-source-exports.ts --update\` after a build and commit it.`);
  process.exit(1);
}

const known = new Set(baseline.entries);
const current = new Set(findings);
const fresh = findings.filter((f) => !known.has(f));
const stale = baseline.entries.filter((e) => !current.has(e));

if (fresh.length === 0 && stale.length === 0) {
  console.log(
    `✅  no new dual-source exports: ${names} names across ${Object.keys(entries).length} entry points — ` +
      `${reExports} re-exported (single declaration), ${findings.length} accepted dual-source (baseline).`,
  );
  process.exit(0);
}

if (fresh.length > 0) {
  console.error(`❌  ${fresh.length} NEW dual-source export name(s) — two entry points now export the same name for different declarations:\n`);
  for (const f of fresh) console.error(`    • ${f}`);
  console.error(
    '\nWhich type a consumer gets now depends on nothing but the import path. An auto-import or a\n' +
      'model completion resolves this by coin-flip, and because such shapes usually overlap, the wrong\n' +
      'pick compiles and fails later at an edge value — the #4411 trap this gate exists to prevent\n' +
      '(eleven names were declared twice across ./kernel and ./system, and the copy that LOOKED\n' +
      'canonical was the dead one).\n\n' +
      'Fix it at the declaration, not the ledger:\n' +
      '  - if both should be one concept: keep ONE declaration and re-export it from the other entry\n' +
      '    (the MetadataManagerConfig pattern — system re-exports kernel’s; a re-export is not flagged);\n' +
      '  - if they are genuinely different concepts: one of them is misnamed — rename it.\n\n' +
      'If a maintainer decides a new dual-source must stand, add the line to\n' +
      'dual-source-exports.baseline.json — deliberately, in review, with the reason in the PR.',
  );
}

if (stale.length > 0) {
  console.error(`\n❌  ${stale.length} stale baseline entr${stale.length === 1 ? 'y' : 'ies'} — no longer dual-source, delete the line(s):\n`);
  for (const e of stale) console.error(`    • ${e}`);
  console.error(
    '\nThe baseline is shrink-only. A stale line stays available to cover the NEXT same-name collision\n' +
      "under the last one's justification, which is how a ratchet quietly stops ratcheting. (If the\n" +
      'partition merely changed shape, the new form is reported above as a new finding — replace the\n' +
      'line, deliberately.)',
  );
}

process.exit(1);
