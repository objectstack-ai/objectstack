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

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

const LEDGER = [];

// ── Discovery ───────────────────────────────────────────────────────────────

const listDir = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

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

/** Every `.ts` file under a directory, recursively. */
function walkTs(dir, out = []) {
  for (const entry of listDir(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walkTs(full, out);
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
  const drivers = discoverDrivers();
  const errors = [];
  const rows = [];

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

function report() {
  const { drivers, rows, errors } = audit();

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

  // Discovery must find the drivers, for the same reason.
  const drivers = discoverDrivers();
  expect('discovers driver packages from disk', drivers.length >= 3 && drivers.includes('driver-sql'));

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-driver-conformance --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log('OK  self-test: detects driven / unused / re-declared fixtures, and discovers both axes.');
}

if (process.argv.includes('--self-test')) selfTest();
else report();
