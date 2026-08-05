#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-driver-conformance -- every driver runs every shared conformance
// case-set, or its absence is a recorded, tracked decision (#4363).
//
// `packages/spec/src/data/*-conformance.ts` holds the case-sets that exist so
// the independent driver implementations answer ONE standard rather than each
// having its own idea: filter combinator semantics (#3774), temporal storage
// form (ADR-0053), deterministic paged reads (objectui#3106 / #4363). Each was
// introduced with some version of the claim that a future driver "is held to
// this by a gate rather than by remembering it".
//
// There was no gate. The case-sets are exports sitting in a package; nothing
// obliged a driver to import them, and the coverage matrix had three holes on
// the day this script was written -- one of them in the very case-set whose
// changeset made the claim. That is the declared-not-enforced shape Prime
// Directive #10 is about, so the fix is the gate rather than a correction to
// the sentence.
//
//   node scripts/check-driver-conformance.mjs
//   node scripts/check-driver-conformance.mjs --self-test
//
// ## Scope: the IDataDriver implementers
//
// `packages/plugins/driver-*` -- discovered from disk, never listed here, so a
// new driver package is in scope the moment it exists. Other consumers of the
// same case-sets (`packages/formula`'s `matchesFilter`, service-analytics'
// native-SQL strategy) are DELIBERATELY out of scope: they are not drivers,
// they implement a different subset, and enrolling them means answering "which
// case-sets even apply" per consumer -- a question this gate would have to
// guess at. Their coverage is asserted by their own suites today. If that rots,
// it wants its own gate, not a looser one here.
//
// ## Invariants
//
//   DISCOVERED  at least one driver package was found. Zero is not an empty
//               matrix, it is a broken run: the other three invariants iterate
//               the discovered set, so they all pass vacuously and this script
//               prints OK while checking nothing. The case-set axis cannot fail
//               this way -- CASE_SETS is a declared expectation, so a vanished
//               `spec/src/data` fails CLASSIFIED's reverse direction -- but the
//               driver axis is disk-discovery with nothing declared to
//               reconcile against, and RECONCILED's reverse direction walks
//               LEDGER, which is empty in the intended steady state.
//   CONSUMED    every (driver x case-set) cell is either covered -- some file
//               under the package's `src/` imports the case-set's marker export
//               from `@objectstack/spec/data` -- or carries a DEBT/EXEMPT entry
//               below. A new driver must arrive covered.
//   CLASSIFIED  every case-set exported by `spec/src/data/*-conformance.ts` is
//               named in CASE_SETS. A new shared fixture nobody classified
//               fails this run rather than silently dropping out of coverage --
//               the #4203 lesson, applied in the direction that actually rots.
//   RECONCILED  in both directions: a DEBT/EXEMPT entry for a cell that is now
//               covered, for a driver that no longer exists, or for a case-set
//               that no longer exists, is an error. A ledger that can only
//               accrete rots into a list nobody trusts.
//
// ## What "covered" means, and what it deliberately does not
//
// This checks that the shared fixture is IMPORTED AND REFERENCED, not that the
// assertions over it are good. A gate cannot judge assertion quality, and one
// that tried would be the kind of verifier that reports success while degrading
// (route-ownership rule 3). What it can do is make the absence loud, which is
// the failure mode that actually happened: three drivers silently not running a
// standard three changesets said they were held to.
//
// ## DEBT is frozen debt, not a permission slip
//
// Every entry was measured against `main`. To clear one: write the suite, then
// delete the entry in the same PR. Deleting without the suite fails CONSUMED;
// keeping the entry alongside the suite fails RECONCILED.
//
// ## Dead scan roots are a hard error (#4930)
//
// Both axes of the matrix are read off disk, from two declared directories:
// DRIVERS_DIR and CASE_SETS_DIR. `listDir` used to be
// `try { return readdirSync(dir); } catch { return []; }`, so a root that was
// renamed, moved or made unreadable simply produced an empty axis. DISCOVERED
// and CLASSIFIED do catch that today — but they catch it as a *consequence*,
// and they name the wrong cause: a renamed `packages/spec/src/data` reports five
// separate "CASE_SETS names X, which <file> no longer exports" errors, which
// reads as five deliberate deletions rather than one directory that moved. The
// author's next action follows the message, so the message has to be the cause.
//
// Both roots are therefore resolved before anything is discovered, and a dead
// one fails BY NAME up front. The `listDir` swallow is gone with them: an error
// during a walk means the corpus was only partly read, and partial evidence of
// coverage is exactly the wrong thing to resolve in coverage's favour.
// Deliberately no whitelist and no optional-root flag — see `assertRootsResolvable`.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRIVERS_DIR = join(ROOT, 'packages', 'plugins');
const CASE_SETS_DIR = join(ROOT, 'packages', 'spec', 'src', 'data');

// ── The case-sets ───────────────────────────────────────────────────────────
//
// `marker` is the export a suite cannot run the case-set without naming, so its
// presence is evidence the fixture is actually driven rather than re-declared
// locally. Reconciled against the files on disk by CLASSIFIED below.

const CASE_SETS = [
  {
    file: 'filter-logic-conformance.ts',
    marker: 'FILTER_LOGIC_CASES',
    what: 'filter combinator semantics ($and/$or/$not nesting) — #3774',
  },
  {
    file: 'temporal-conformance.ts',
    marker: 'TEMPORAL_CASES',
    what: 'temporal storage form and comparand coercion — ADR-0053',
  },
  {
    file: 'temporal-conformance.ts',
    marker: 'TEMPORAL_TIME_CASES',
    what: 'canonical `Field.time` storage and comparison — #3994',
  },
  {
    file: 'pagination-conformance.ts',
    marker: 'PAGINATION_CASES',
    what: 'a sorted paged read is a partition — objectui#3106',
  },
  {
    file: 'pagination-conformance.ts',
    marker: 'PAGINATION_UNORDERED_CASES',
    what: 'an UNSORTED paged read is a partition too — #4363',
  },
];

// ── The ledger ──────────────────────────────────────────────────────────────
//
// One entry per uncovered (driver x case-set) cell. `kind` is DEBT (should be
// covered, is not yet) or EXEMPT (cannot meaningfully apply). Both are measured
// claims; neither is a default.
//
// EMPTY, as of #4405 — every cell of the matrix is covered by a suite. The two
// FILTER_LOGIC_CASES rows this ledger opened with are both cleared:
//
//   driver-mongodb      `translateFilter` was the independent fifth backend
//                       #3774 never enrolled when it named "the four". It now
//                       drives the shared cases twice: server-free over the
//                       MongoDB documents it emits (the half that always runs,
//                       because the mongod binary is not always fetchable), and
//                       against a real mongod.
//   driver-sqlite-wasm  Inherits SqlDriver's filter compiler, so what its suite
//                       pins is the sql.js dialect executing the compiled
//                       predicate — the same seam its temporal and pagination
//                       suites cover for their clauses. It was tracked as DEBT
//                       rather than EXEMPT because "inherits, therefore fine" is
//                       the assumption those suites exist to disprove; the suite
//                       is what disproves it, not the entry.
//
// An empty ledger is the intended steady state, not a reason to delete the
// mechanism: the next driver that arrives uncovered fails CONSUMED and lands
// its measured entry here.
//
// ## What driver-mongodb's cells mean since #5517 — read this before trusting them
//
// This gate judges coverage by IMPORT: does some file under the package's `src/`
// name the marker export. That is deliberate (see "What 'covered' means"), and it
// is why no entry below changed when #5517 made the mongodb suites that need a
// real mongod OPT-IN (`OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1`, gate in
// `packages/plugins/driver-mongodb/src/test-mongod.ts`): the files still exist
// and still import the markers, so CONSUMED still passes — honestly, but about
// less than it did. Recorded here rather than as a ledger entry because an entry
// for a covered cell fails RECONCILED; this is the only place the fact fits.
//
// Measured on the day of that change, per marker, for driver-mongodb:
//
//   FILTER_LOGIC_CASES         still runs by default — `mongodb-filter-logic-
//                              translation.test.ts` drives the whole case-set
//                              server-free over the documents `translateFilter`
//                              emits. The real-mongod twin
//                              (`mongodb-filter-logic-conformance.test.ts`) is
//                              opt-in.
//   PAGINATION_CASES,          opt-in only. `mongodb-pagination-conformance.test.ts`
//   PAGINATION_UNORDERED_CASES keeps a server-free half, but it asserts the SORT
//                              SPEC, not the partition property the case-sets
//                              define.
//   TEMPORAL_CASES,            opt-in only — `mongodb-temporal-conformance.test.ts`
//   TEMPORAL_TIME_CASES        has no server-free half.
//
// Why: on a cold binary cache two vitest workers downloaded the same ~123 MB
// archive and the loser's `rename` blew up an all-green run as an unhandled
// rejection, ejecting unrelated PRs from the merge queue. The maintainer retired
// the download rather than fund single-flight/prewarm for a family whose
// investment is frozen (#5499). Un-freezing it is what should re-run these cells
// in CI; until then, this note is the honest state of the mongo column.

const LEDGER = [];

// ── Discovery ───────────────────────────────────────────────────────────────

/** A declared scan root that could not be resolved to a directory. Carries the names. */
class DeadRootError extends Error {
  constructor(dead) {
    super(`unresolvable scan root(s): ${dead.map((d) => `${d.root} — ${d.reason}`).join('; ')}`);
    this.name = 'DeadRootError';
    this.dead = dead;
    /** @type {string[]} just the root paths, for callers that only need to point. */
    this.roots = dead.map((d) => d.root);
  }
}

/**
 * Resolve every declared scan root before discovering anything; throw naming the
 * ones that are not directories.
 *
 * Deliberately no whitelist and no `optional: true` marker. `packages/plugins`,
 * `packages/spec/src/data` and every driver's `src/` are git-tracked directories
 * with tracked files in them, so any checkout that can run
 * `pnpm check:driver-conformance` has all of them. An optional marker "just in
 * case" would hand the next author a supported way to silence this failure
 * instead of fixing the rename — the empty `catch { return []; }` again, only
 * spelled politely. If a root ever does become legitimately absent, that is a real
 * decision: record it with its condition and a test, don't relax the check.
 *
 * @throws {DeadRootError}
 */
function assertRootsResolvable(roots) {
  const dead = [];
  for (const root of roots) {
    let st = null;
    try {
      st = statSync(root);
    } catch (err) {
      dead.push({
        root,
        reason: err?.code === 'ENOENT' ? 'does not exist' : `cannot be read (${err?.code ?? err})`,
      });
      continue;
    }
    if (!st.isDirectory()) dead.push({ root, reason: 'exists but is not a directory' });
  }
  if (dead.length) throw new DeadRootError(dead);
}

/**
 * The entries of a directory the caller has already asserted is a scan root.
 *
 * No catch: an unresolvable root fails loudly in `assertRootsResolvable`, and an
 * error here means the axis was only partly read — which must not resolve in
 * coverage's favour (#4930).
 */
const listDir = (dir) => readdirSync(dir);

/** Driver packages, from disk — never a hardcoded list. */
function discoverDrivers() {
  return listDir(DRIVERS_DIR)
    .filter((name) => name.startsWith('driver-'))
    .filter((name) => {
      try {
        return statSync(join(DRIVERS_DIR, name, 'package.json')).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * DISCOVERED — the errors for a discovery that found nothing.
 *
 * Split out from `audit()` so the self-test can drive the invariant itself
 * rather than a proxy for it. The previous guard lived only in the self-test
 * and read `drivers.length >= 3 && drivers.includes('driver-sql')` — a
 * hardcoded name and count inside the one script whose stated rule is that
 * drivers come from disk and are never listed. Both would have needed editing
 * the next time a driver is added or the packages move, which is exactly when
 * the guard matters.
 */
function discoveredErrors(drivers) {
  if (drivers.length) return [];
  return [
    `DISCOVERED: no driver package found under ${DRIVERS_DIR.slice(ROOT.length + 1)}/. `
      + 'Either these packages moved and DRIVERS_DIR is stale, or they are gone. '
      + 'Every other invariant iterates the discovered set, so a zero-driver run '
      + 'reports OK having checked nothing — it fails here instead.',
  ];
}

/** Every `*-conformance.ts` under spec/src/data, and the case-set exports in it. */
function discoverCaseSets() {
  const found = [];
  for (const file of listDir(CASE_SETS_DIR).filter((f) => f.endsWith('-conformance.ts'))) {
    const src = readFileSync(join(CASE_SETS_DIR, file), 'utf8');
    // A case-set is an exported `_CASES` const: the thing a suite iterates.
    // `_ROWS` / `_ALL_IDS` are its fixture data, driven through the cases.
    for (const m of src.matchAll(/^export const ([A-Z0-9_]*_CASES)\b/gm)) {
      found.push({ file, marker: m[1] });
    }
  }
  return found;
}

/**
 * Every `.ts` file under a directory, recursively.
 *
 * A driver's `src/` is a scan root like the other two: "this driver does not run
 * the shared cases" must mean the files were read and the marker was absent, never
 * that the directory could not be opened. So it is asserted, and nothing in the
 * walk is swallowed (#4930).
 */
function walkTs(dir, out = []) {
  assertRootsResolvable([dir]);
  walkTsInto(dir, out);
  return out;
}

function walkTsInto(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walkTsInto(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Does this driver package drive `marker`?
 *
 * Requires BOTH an import naming it from `@objectstack/spec/data` and a
 * reference outside that import — an unused import is not coverage, and it is
 * the shape a half-finished suite leaves behind.
 */
function consumes(driverDir, marker) {
  for (const file of walkTs(join(driverDir, 'src'))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes(marker)) continue;
    const imported = new RegExp(
      `import[\\s\\S]*?\\b${marker}\\b[\\s\\S]*?from\\s+['"]@objectstack/spec/data['"]`,
    ).test(src);
    if (!imported) continue;
    // Count references outside the import statement(s).
    const withoutImports = src.replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
    if (new RegExp(`\\b${marker}\\b`).test(withoutImports)) return file;
  }
  return null;
}

// ── The run ─────────────────────────────────────────────────────────────────

function audit() {
  // Both axes come off disk, so both roots must resolve before a single cell of
  // the matrix is believed. Throws DeadRootError — `report()` turns it into a red
  // that names the directory rather than the five downstream symptoms (#4930).
  assertRootsResolvable([DRIVERS_DIR, CASE_SETS_DIR]);

  const drivers = discoverDrivers();
  const errors = [];
  const rows = [];

  // DISCOVERED — the precondition the other three iterate over.
  errors.push(...discoveredErrors(drivers));

  // CLASSIFIED — both directions between CASE_SETS and the files on disk.
  const onDisk = discoverCaseSets();
  const classified = new Set(CASE_SETS.map((c) => c.marker));
  for (const { file, marker } of onDisk) {
    if (!classified.has(marker)) {
      errors.push(
        `CLASSIFIED: ${file} exports ${marker}, which no row of CASE_SETS names. `
          + 'Classify it (and say which drivers must run it) rather than letting a new shared '
          + 'standard start life uncovered.',
      );
    }
  }
  const onDiskMarkers = new Set(onDisk.map((c) => c.marker));
  for (const c of CASE_SETS) {
    if (!onDiskMarkers.has(c.marker)) {
      errors.push(`CLASSIFIED: CASE_SETS names ${c.marker}, which ${c.file} no longer exports.`);
    }
  }

  // CONSUMED + collect the matrix.
  const ledgerHit = new Set();
  for (const driver of drivers) {
    const dir = join(DRIVERS_DIR, driver);
    for (const c of CASE_SETS) {
      const where = consumes(dir, c.marker);
      const entry = LEDGER.find((l) => l.driver === driver && l.marker === c.marker);
      if (entry) ledgerHit.add(`${driver}::${c.marker}`);

      if (where && entry) {
        errors.push(
          `RECONCILED: ${driver} now runs ${c.marker} (${where.slice(ROOT.length + 1)}), `
            + `but the ledger still carries a ${entry.kind} entry for it. Delete the entry.`,
        );
        rows.push({ driver, marker: c.marker, state: 'covered' });
      } else if (where) {
        rows.push({ driver, marker: c.marker, state: 'covered' });
      } else if (entry) {
        rows.push({ driver, marker: c.marker, state: entry.kind.toLowerCase() });
      } else {
        errors.push(
          `CONSUMED: ${driver} does not run ${c.marker} (${c.what}). Add a suite that drives `
            + 'the shared cases, or add a measured DEBT/EXEMPT entry to the ledger in '
            + 'scripts/check-driver-conformance.mjs saying why not.',
        );
        rows.push({ driver, marker: c.marker, state: 'MISSING' });
      }
    }
  }

  // RECONCILED — ledger rows pointing at things that no longer exist.
  for (const entry of LEDGER) {
    if (!drivers.includes(entry.driver)) {
      errors.push(`RECONCILED: ledger entry for ${entry.driver}, which is not a driver package.`);
    } else if (!classified.has(entry.marker)) {
      errors.push(`RECONCILED: ledger entry names ${entry.marker}, which CASE_SETS does not.`);
    }
  }

  return { drivers, rows, errors };
}

function reportDeadRoots(err) {
  console.error('\n  x check-driver-conformance: declared scan root(s) do not resolve, so the matrix would\n' +
    '    have been built from an axis nothing could read:\n');
  for (const d of err.dead) console.error(`    ${d.root.startsWith(ROOT) ? d.root.slice(ROOT.length + 1) : d.root} — ${d.reason}`);
  console.error(
    '\n  DRIVERS_DIR and CASE_SETS_DIR (scripts/check-driver-conformance.mjs) must both be' +
    '\n  directories in the checkout. If one was renamed or moved, point the constant at it; if it' +
    '\n  was deleted, that is a deliberate decision to record. Do NOT restore a tolerant skip: this' +
    '\n  used to be `catch { return []; }`, and a dead root produced an empty axis whose downstream' +
    '\n  errors named the wrong cause (#4930).\n',
  );
}

function report() {
  let audited;
  try {
    audited = audit();
  } catch (err) {
    if (!(err instanceof DeadRootError)) throw err;
    reportDeadRoots(err);
    process.exit(1);
    return;
  }
  const { drivers, rows, errors } = audited;

  const covered = rows.filter((r) => r.state === 'covered').length;
  const debt = rows.filter((r) => r.state === 'debt').length;
  const exempt = rows.filter((r) => r.state === 'exempt').length;

  const width = Math.max(...drivers.map((d) => d.length), 8);
  console.log(`\ndriver conformance matrix (${drivers.length} drivers x ${CASE_SETS.length} case-sets)\n`);
  console.log(
    '  ' + 'driver'.padEnd(width) + '  ' + CASE_SETS.map((c) => c.marker.replace(/_CASES$/, '')).join('  '),
  );
  for (const driver of drivers) {
    const cells = CASE_SETS.map((c) => {
      const row = rows.find((r) => r.driver === driver && r.marker === c.marker);
      const glyph = { covered: 'ok', debt: 'DEBT', exempt: 'exempt', MISSING: 'MISSING' }[row.state];
      return glyph.padEnd(c.marker.replace(/_CASES$/, '').length);
    });
    console.log('  ' + driver.padEnd(width) + '  ' + cells.join('  '));
  }
  console.log('');

  if (errors.length) {
    for (const e of errors) console.error(`  x ${e}`);
    console.error(`\ncheck-driver-conformance: ${errors.length} problem(s).\n`);
    process.exit(1);
  }

  // Print the ledger's reasons, not only its counts. An entry whose
  // justification is never surfaced is how a ledger decays into a list nobody
  // reads — and these rows are the whole reason this run is green.
  for (const entry of LEDGER) {
    console.log(`  ${entry.kind}  ${entry.driver} × ${entry.marker}`);
    console.log(`        ${entry.why}`);
    if (entry.issue) console.log(`        tracked: ${entry.issue}`);
  }
  if (LEDGER.length) console.log('');

  console.log(
    `check-driver-conformance: OK — ${covered} covered cell(s), ${debt} in the DEBT ledger, `
      + `${exempt} exempt.\n`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// A guard that cannot fail is not a guard. This drives the three invariants
// against synthetic inputs so a refactor that neuters the detection fails here
// rather than silently passing every future PR.

function selfTest() {
  const failures = [];
  const expect = (label, cond) => {
    if (!cond) failures.push(label);
  };

  // CONSUMED: an unused import must not count as coverage.
  const tmp = join(ROOT, 'node_modules', '.check-driver-conformance-selftest');
  try {
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(
      join(tmp, 'src', 'a.test.ts'),
      "import { PAGINATION_CASES } from '@objectstack/spec/data';\n// never referenced again\n",
    );
    expect('unused import must not count as coverage', consumes(tmp, 'PAGINATION_CASES') === null);

    writeFileSync(
      join(tmp, 'src', 'a.test.ts'),
      "import { PAGINATION_CASES } from '@objectstack/spec/data';\nfor (const c of PAGINATION_CASES) {}\n",
    );
    expect('driven import must count as coverage', consumes(tmp, 'PAGINATION_CASES') !== null);

    // A locally re-declared fixture is not the shared standard.
    writeFileSync(
      join(tmp, 'src', 'a.test.ts'),
      'const PAGINATION_CASES = [];\nfor (const c of PAGINATION_CASES) {}\n',
    );
    expect(
      'local re-declaration must not count as coverage',
      consumes(tmp, 'PAGINATION_CASES') === null,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // CLASSIFIED: discovery must actually find the case-sets on disk, or the
  // reconciliation is vacuous and every future fixture drops out silently.
  const found = discoverCaseSets().map((c) => c.marker);
  expect('discovers FILTER_LOGIC_CASES on disk', found.includes('FILTER_LOGIC_CASES'));
  expect('discovers TEMPORAL_CASES on disk', found.includes('TEMPORAL_CASES'));
  expect('discovers PAGINATION_UNORDERED_CASES on disk', found.includes('PAGINATION_UNORDERED_CASES'));

  // DISCOVERED: the invariant itself, in both directions, then against the
  // real tree. No driver name or count is asserted — the point of the gate is
  // that the set comes from disk.
  expect('a discovery that found nothing is an error', discoveredErrors([]).length === 1);
  expect('a discovery that found something is not', discoveredErrors(['driver-anything']).length === 0);
  expect('discovers driver packages from disk', discoverDrivers().length > 0);

  // --- Reverse proof for the dead-root hard error (#4930), made permanent. ---
  // Everything above ran over roots that resolve, which proves nothing about a
  // gate whose failure mode is discovering an empty axis. So break a root the way
  // a rename breaks it, require red naming that root and not the survivor, then
  // restore it and require green again. Red-then-green, in the same run, every run.
  const tmpRoots = join(ROOT, 'node_modules', '.check-driver-conformance-selftest-roots');
  try {
    mkdirSync(join(tmpRoots, 'live'), { recursive: true });
    const missing = join(tmpRoots, 'renamed-away');
    let deadErr = null;
    try { assertRootsResolvable([join(tmpRoots, 'live'), missing]); } catch (err) { deadErr = err; }
    expect('a renamed scan root throws instead of yielding an empty axis', deadErr instanceof DeadRootError);
    expect('the failure names the dead root', deadErr?.roots?.join(',') === missing);
    expect('the failure does not blame the surviving root', !/live/.test(deadErr?.message ?? ''));
    expect('the failure says why', deadErr?.dead?.[0]?.reason === 'does not exist');

    // A root that exists but is not a directory is dead in the same way: the old
    // `catch { return []; }` swallowed its ENOTDIR exactly as it swallowed ENOENT.
    const asFile = join(tmpRoots, 'a-file');
    writeFileSync(asFile, 'not a directory');
    let notDirErr = null;
    try { assertRootsResolvable([asFile]); } catch (err) { notDirErr = err; }
    expect('a scan root that is a file is dead too',
      notDirErr?.dead?.[0]?.reason === 'exists but is not a directory');

    // An entry the walk cannot stat inside a driver's src/ is the same defect one
    // level in: `catch { continue; }` used to drop it, and a dropped file that
    // held the marker reads as "this driver does not run the case-set".
    mkdirSync(join(tmpRoots, 'pkg', 'src'), { recursive: true });
    writeFileSync(join(tmpRoots, 'pkg', 'src', 'a.ts'), 'export const a = 1;\n');
    expect('a readable src/ walks clean', walkTs(join(tmpRoots, 'pkg', 'src')).length === 1);
    symlinkSync(join(tmpRoots, 'no-such-target'), join(tmpRoots, 'pkg', 'src', 'dangling'));
    let partialErr = null;
    try { walkTs(join(tmpRoots, 'pkg', 'src')); } catch (err) { partialErr = err; }
    expect('an entry the walk cannot stat is an error, not a smaller corpus', partialErr?.code === 'ENOENT');
    rmSync(join(tmpRoots, 'pkg', 'src', 'dangling'));

    // ...and roots that resolve are green, so the reds above were caused by the
    // broken roots and nothing else.
    let restored = null;
    try { assertRootsResolvable([join(tmpRoots, 'live'), join(tmpRoots, 'pkg', 'src')]); } catch (err) { restored = err; }
    expect('roots that resolve raise nothing', restored === null);
    expect('restoring the tree makes the walk green again', walkTs(join(tmpRoots, 'pkg', 'src')).length === 1);

    // The real roots this gate runs against resolve — the assertion is wired in,
    // not merely defined.
    let realErr = null;
    try { assertRootsResolvable([DRIVERS_DIR, CASE_SETS_DIR]); } catch (err) { realErr = err; }
    expect('the real DRIVERS_DIR and CASE_SETS_DIR both resolve', realErr === null);
  } finally {
    rmSync(tmpRoots, { recursive: true, force: true });
  }

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-driver-conformance --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: detects driven / unused / re-declared fixtures, discovers both axes, and holds the '
      + 'dead-root hard error (red when a scan root is renamed, green when restored).',
  );
}

if (process.argv.includes('--self-test')) selfTest();
else report();
