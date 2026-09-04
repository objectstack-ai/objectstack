#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-live-db-isolation (#10382) -- no live suite anywhere in the tree may
// name its database or schema with a constant.
//
//   node scripts/check-live-db-isolation.mjs
//   node scripts/check-live-db-isolation.mjs --self-test
//
// ## The property, and why it needs a REPO-WIDE watcher
//
// CI provisions ONE Postgres and ONE MySQL for the whole `temporal-conformance`
// job, and points every live leg at them through `OS_TEST_POSTGRES_URL` /
// `OS_TEST_MYSQL_URL`. Two suites that name the same database therefore meet on
// a real server, and every live suite in this repo issues `drop database` (or
// `drop schema`) when it is done. So a shared name is not contention, it is
// destruction: the loser's tables vanish mid-run, or -- when the shared name is
// the one the URL itself carries -- the loser cannot even complete a handshake.
//
// #9350 established the fix (derive the name from the test file) and enforced it
// in `packages/drivers/driver-sql/src/live-dialect-matrix.isolation.test.ts`.
// That scan reads its own package only. It was green, correctly, while two live
// suites in `packages/metadata-protocol` named their databases
// `os_metadata_protocol_9381` and `os_metadata_protocol_9434` -- distinct from
// each other purely because two authors typed two different strings. A
// per-package scan cannot see the package that has not been written yet, and the
// next live suite will be in a third package. Hence this one, which is not
// scoped to any package and needs none to opt in.
//
// ## What this gate proves, and what it deliberately leaves to the suites
//
// It proves a SOURCE property: the identifier that reaches a live `create
// database` / `drop database` / `use` / `create schema` / `drop schema` is not a
// literal, and is not an identifier initialised from a literal. That is exactly
// the state the two metadata-protocol files were in, so this gate reds on the
// pre-#10382 tree -- which is the only control in that change that does.
//
// It deliberately does NOT try to prove the names are DISTINCT. That needs the
// derivation actually run over the real file list, which is running code, and it
// lives where it can run:
//
//   packages/drivers/driver-sql/src/live-dialect-matrix.isolation.test.ts
//   packages/metadata-protocol/src/migrations/live-mysql-database.isolation.test.ts
//
// Neither half subsumes the other. A derived-but-colliding name passes here and
// fails there; a package with no isolation suite at all passes there (vacuously)
// and fails here. Both are required, and each header says so.
//
// ## Why a source scan rather than a runtime check
//
// Same reason #9350 gives for its own scan: a detector with no dependencies
// cannot itself fail to resolve in CI, and the thing being prevented is a file
// being WRITTEN, which is a source-time event. The price is that it sees only
// the spellings it knows -- so every spelling it recognises is pinned by
// `--self-test`, and a live file whose DDL it cannot parse at all is reported,
// never skipped.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// This self-test used to decide success by "no failure was recorded" and
// nothing else, so "every case held" and "the cases never ran" printed the same
// line. Closed the way PR #13487 validated on check-doc-authoring: what is
// pinned is the registered NAMES, not a number. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3 keeps
// a total "right" the moment a sibling grows. A set difference says WHICH
// battery stopped; a count says only that something did.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
//
// The machinery lives HERE, at module scope, rather than inside the self-test:
// this self-test's assertion sink is not a block-bodied helper in its body (it
// is a concise arrow, or a module-scope function), so there is no in-body
// helper to thread a per-run ledger through. Module scope is safe because the
// self-test runs once per process, and it is what lets the existing sink route
// through `registerCase()` with no case rewritten and no assertion changed.
const SELF_TEST_BATTERIES = Object.freeze({
  '1. the literal-in-the-DDL form': 1,
  '2. the literal-behind-an-identifier form -- the pre-#10382 tree, exactly': 2,
  '3. the fixed form -- derived from a call': 1,
  '4. the Postgres spelling, both directions': 2,
  '5. a loop variable is derived too -- driver-sql\'s globalSetup shape, which': 1,
  '6. the detector must be able to see nothing, without that meaning "clean"': 1,
  '7. comments are not source -- the reason codeOf exists': 1,
  '8. the live-file needle must MATCH a real read and not the cell form': 2,
  '9. `use strict` and friends are not live DDL': 1,
  '10. the dispatch-gates population declaration': 4,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 10;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// ⚠️ None of these helpers is named with a self-test spelling, deliberately and
// on the record: `check:pm-dispatch-gates` anchors on a top-level declaration
// whose NAME spells self-test, and every such name owes a row in that gate's
// COMPOUND_ANCHOR_LEDGER. These are the battery ROSTER's machinery -- they hold
// no fixtures to mask and read no path literal -- so the accurate name is the
// one that says `battery`, not the one that would owe a ledger row for a role
// this code does not have.

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's own assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared battery RAN, and ran its cases (#13489).
 *
 * Evaluated after every battery has had its chance and BEFORE the verdict, so
 * the success line can only be printed by a run in which the set of batteries
 * that registered assertions EQUALS the set declared.
 */
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
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['packages', 'apps', 'examples'];

/**
 * The population this gate walks, declared for `scripts/pm/dispatch-gates.mjs`.
 *
 * `ROOTS` is a runtime constant, and the derivation reads SOURCE TEXT: three
 * bare top-level words carry no separator, and `hintCovers` refuses a bare
 * single-segment literal by design (accepting them was priced at +139084
 * fabricated (gate, file) pairs, because `packages`, `apps` and `examples` are
 * path COMPONENTS in dozens of gates that never read those roots). So this gate
 * declared no path at all and was scored `undetermined` for EVERY card: it
 * appeared in no dispatch brief and in no `--commands` harvest, while CI ran it
 * on every pull request. The subtree spelling is the escape the idiom exists to
 * be — the same claim `ROOTS` makes, written where a text scanner can read it.
 *
 * ⛔ Not a whole-tree marker: this gate reads three subtrees, and the liveness
 * predicate that vouches for a whole-tree declaration is documented as too weak
 * to tell a seeded subtree walk apart from a repo-root one.
 *
 * The self-test derives the coupling from `ROOTS` on both sides rather than
 * re-spelling it, so widening or renaming a root cannot leave this declaration
 * describing the old population.
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**', 'apps/**', 'examples/**'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.next', 'build']);

/**
 * The env-var read that marks a file as talking to a PROVISIONED live server.
 *
 * Assembled rather than written out, for the reason #9350's scan records after
 * flagging itself on its first run: a literal here would make this file's own
 * source match, and adding an exclusion list is the exact shape of hole the scan
 * exists to close.
 */
const LIVE_ENV_READ = new RegExp('process' + String.raw`\.env\.OS_TEST_(?:MYSQL|POSTGRES)_URL`);

/** Backtick, spelled as a code point so it never appears literally in here. */
const BT = '\\x60';

/**
 * A live DDL statement head plus the start of its operand. `use` is included
 * without a database/schema keyword because that is how MySQL spells it.
 */
const STATEMENT = new RegExp(
  String.raw`\b(create\s+database|drop\s+database|create\s+schema|drop\s+schema|use)\b` +
    String.raw`(?:\s+if\s+(?:not\s+)?exists)?\s+([^\n;]{0,160})`,
  'gi',
);

/** The quoted identifier a live statement names, backtick or ANSI double quote. */
const QUOTED_NAME = new RegExp(
  String.raw`^\\?(?:` + BT + String.raw`([^` + BT + String.raw`\n]*?)\\?` + BT +
    String.raw`|"([^"\n]*?)")`,
);

/** Exactly one interpolation and nothing else -- `${DB}`. */
const SOLE_INTERPOLATION = /^\$\{\s*([A-Za-z_$][\w$]*)\s*\}$/;

/**
 * Source with block and line comments BLANKED -- replaced space-for-space
 * rather than deleted, so prose is never a hit and the line numbers this gate
 * reports are still the line numbers in the real file. Deleting the comments
 * was the first spelling and it reported `…live-mysql.test.ts:45` for a
 * statement that lives on line 81; a gate that points at the wrong line is a
 * gate the next author stops believing.
 */
export function codeOf(source) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank);
}

/** Is this initialiser a constant string? */
function isLiteralInit(init) {
  const trimmed = init.trim();
  if (/^['"]/.test(trimmed)) return true;
  // a template literal with no interpolation is just as constant
  if (new RegExp('^' + BT).test(trimmed) && !trimmed.includes('${')) return true;
  return false;
}

/** The initialiser of `const <ident> = ...` in this source, or undefined. */
export function initialiserOf(code, ident) {
  const decl = new RegExp(
    String.raw`\b(?:const|let|var)\s+` + ident + String.raw`\s*(?::[^=\n]+)?=\s*([^\n]+)`,
  ).exec(code);
  return decl ? decl[1] : undefined;
}

/**
 * Every violation in one file's source. Exported so `--self-test` drives the
 * real function rather than a paraphrase of it.
 */
export function violationsIn(code) {
  const found = [];
  for (const match of code.matchAll(STATEMENT)) {
    const verb = match[1].replace(/\s+/g, ' ').toLowerCase();
    const named = QUOTED_NAME.exec(match[2]);
    // Not a quoted identifier: `use strict`, a `use` in a string, a statement
    // built some other way. Nothing to judge, and nothing to report.
    if (!named) continue;
    const name = named[1] ?? named[2] ?? '';
    const line = code.slice(0, match.index).split('\n').length;

    if (!name.includes('${')) {
      found.push({ line, verb, name, why: `names the literal "${name}"` });
      continue;
    }
    const sole = SOLE_INTERPOLATION.exec(name);
    if (!sole) continue; // interpolated with extra structure -- derived enough
    const init = initialiserOf(code, sole[1]);
    if (init !== undefined && isLiteralInit(init)) {
      found.push({
        line,
        verb,
        name,
        why: `interpolates ${sole[1]}, which is the constant ${init.trim().replace(/;$/, '')}`,
      });
    }
  }
  return found;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (/\.m?ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const files = [];
  for (const root of ROOTS) {
    const abs = join(REPO_ROOT, root);
    try {
      if (statSync(abs).isDirectory()) walk(abs, files);
    } catch {
      /* a root that does not exist in this checkout is not an error */
    }
  }

  const live = [];
  for (const file of files.sort()) {
    const code = codeOf(readFileSync(file, 'utf8'));
    if (LIVE_ENV_READ.test(code)) live.push({ file: relative(REPO_ROOT, file), code });
  }

  // Vacuity guard. Every judgement below iterates this list, so a list that came
  // back empty would report success having read nothing -- the failure mode this
  // whole family of gates exists to prevent.
  if (live.length < 2) {
    console.error(
      `check-live-db-isolation: found ${live.length} live-server file(s) in the tree. ` +
        'At least two are expected (driver-sql\'s matrix and metadata-protocol\'s migrations). ' +
        'Either the detector stopped matching, or the live suites moved -- both are defects ' +
        'in this gate, not a clean run.',
    );
    process.exit(1);
  }

  const offenders = [];
  for (const { file, code } of live) {
    for (const v of violationsIn(code)) offenders.push({ file, ...v });
  }

  console.log(`check-live-db-isolation: ${live.length} live-server file(s) scanned`);
  for (const { file } of live) console.log(`  - ${file}`);

  if (offenders.length > 0) {
    console.error('\ncheck-live-db-isolation: FAIL');
    for (const o of offenders) {
      console.error(`  ${o.file}:${o.line}  ${o.verb} ${o.why}`);
    }
    console.error(
      '\nA live suite must derive its database/schema from its own test FILE, never from a\n' +
        'constant. CI points every live leg at one server, and each of these suites issues a\n' +
        "drop when it finishes -- so two suites sharing a name destroy each other's fixture,\n" +
        'and a name equal to the one in the connection URL breaks the next handshake outright.\n' +
        'Use a no-argument resolver seeded from vitest\'s own testPath:\n' +
        '  packages/drivers/driver-sql/src/live-dialect-matrix.testkit.ts   currentLiveSchema()\n' +
        '  packages/metadata-protocol/src/migrations/live-mysql-database.testkit.ts\n' +
        '                                                          currentLiveMysqlDatabase()\n' +
        'A resolver takes no argument on purpose: there is then no parameter a copy-paste can\n' +
        'carry over from the file it was copied from.',
    );
    process.exit(1);
  }

  console.log('check-live-db-isolation: PASS -- every live suite derives its database');
}

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-live-db-isolation self-test reached its verdict';

function selfTest() {
  const cases = [];
  const bt = String.fromCharCode(96);
  const check = (label, ok) => {
    registerCase();
    return cases.push({ label, ok });
  };

  // 1. the literal-in-the-DDL form
  battery('1. the literal-in-the-DDL form');
  const literalDdl = `await c.query(${bt}CREATE DATABASE IF NOT EXISTS \\${bt}conformance\\${bt}${bt});`;
  check('flags a database named by a literal', violationsIn(literalDdl).length === 1);

  // 2. the literal-behind-an-identifier form -- the pre-#10382 tree, exactly
  battery('2. the literal-behind-an-identifier form -- the pre-#10382 tree, exactly');
  const literalConst =
    `const DB = 'os_metadata_protocol_9381';\n` +
    `await c.query(${bt}CREATE DATABASE IF NOT EXISTS \\${bt}\${DB}\\${bt}${bt});\n` +
    `await c.query(${bt}USE \\${bt}\${DB}\\${bt}${bt});`;
  check('flags an identifier initialised from a literal', violationsIn(literalConst).length === 2);
  check(
    'names the offending constant in the message',
    violationsIn(literalConst)[0].why.includes('os_metadata_protocol_9381'),
  );

  // 3. the fixed form -- derived from a call
  battery('3. the fixed form -- derived from a call');
  const derived =
    `const DB = currentLiveMysqlDatabase();\n` +
    `await c.query(${bt}CREATE DATABASE IF NOT EXISTS \\${bt}\${DB}\\${bt}${bt});\n` +
    `await c.query(${bt}DROP DATABASE IF EXISTS \\${bt}\${DB}\\${bt}${bt});`;
  check('passes a database derived from a call', violationsIn(derived).length === 0);

  // 4. the Postgres spelling, both directions
  battery('4. the Postgres spelling, both directions');
  const pgLiteral = `await db.raw(${bt}create schema if not exists "public"${bt});`;
  const pgDerived =
    `const schema = currentLiveSchema();\n` +
    `await db.raw(${bt}create schema if not exists "\${schema}"${bt});`;
  check('flags a schema named by a literal', violationsIn(pgLiteral).length === 1);
  check('passes a schema derived from a call', violationsIn(pgDerived).length === 0);

  // 5. a loop variable is derived too -- driver-sql's globalSetup shape, which
  //    has no declaration for the gate to find and must not be flagged for it
  battery('5. a loop variable is derived too -- driver-sql\'s globalSetup shape, which');
  const loopVar =
    `for (const { schema } of liveSchemaLedger()) {\n` +
    `  await db.raw(${bt}create database if not exists \\${bt}\${schema}\\${bt}${bt});\n` +
    `}`;
  check('passes an identifier with no local literal declaration', violationsIn(loopVar).length === 0);

  // 6. the detector must be able to see nothing, without that meaning "clean"
  battery('6. the detector must be able to see nothing, without that meaning "clean"');
  check('reports no violation in source with no live DDL', violationsIn('const x = 1;').length === 0);

  // 7. comments are not source -- the reason codeOf exists
  battery('7. comments are not source -- the reason codeOf exists');
  const inComment = `// CREATE DATABASE IF NOT EXISTS \\${bt}conformance\\${bt}\nconst x = 1;`;
  check('ignores DDL that appears only in a comment', violationsIn(codeOf(inComment)).length === 0);

  // 8. the live-file needle must MATCH a real read and not the cell form --
  //    without this, a needle that silently stopped matching would report a
  //    clean scan of an empty population forever
  battery('8. the live-file needle must MATCH a real read and not the cell form');
  check(
    'the live-file needle matches a direct env read',
    LIVE_ENV_READ.test('const U = process' + '.env.OS_TEST_MYSQL_URL;'),
  );
  check(
    'the live-file needle does not match the cell form',
    !LIVE_ENV_READ.test('const U = MYSQL_CELL.url;'),
  );

  // 9. `use strict` and friends are not live DDL
  battery('9. `use strict` and friends are not live DDL');
  check('does not flag a non-identifier use', violationsIn(`'use strict';`).length === 0);

  // 10. the dispatch-gates population declaration
  battery('10. the dispatch-gates population declaration');
  check(
    'every separator-less ROOT is declared in the subtree spelling (a bare root is refused as too '
      + 'generic, so it needs the glob)',
    ROOTS.filter((r) => !r.includes('/')).every((r) => ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)),
  );
  check(
    'and it declares no root this gate does not walk — a declaration that can drift from the scan '
      + 'replaces a silent gate with a lying one',
    ROOT_DIR_WATCH_HINTS.every((h) => ROOTS.includes(h.replace(/\/\*+$/, ''))),
  );
  check(
    'the declared form is NOT a ROOTS entry — the glob form would send the walk at a directory the '
      + 'tree does not have',
    !ROOTS.some((r) => ROOT_DIR_WATCH_HINTS.includes(r)),
  );
  check(
    'the declaration is not empty — an empty hint list reads exactly like the undetermined verdict '
      + 'it exists to leave',
    ROOT_DIR_WATCH_HINTS.length === ROOTS.length,
  );

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push({ label: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.label}`);
  if (failed.length > 0) {
    console.error(`\ncheck-live-db-isolation --self-test: ${failed.length}/${cases.length} FAILED`);
    process.exit(1);
  }
  console.log(`\ncheck-live-db-isolation --self-test: PASS (${cases.length} cases)`);

  return SELF_TEST_VERDICT;
}

// This file exports its detector so `--self-test` drives the real functions
// rather than a paraphrase of them, which means it can be imported FOR those
// exports — and an unguarded top-level dispatch would then run the whole scan,
// and its `process.exit`, inside the importer. `check:entry-guard` enforces this
// (and caught exactly that here on the first run).
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-live-db-isolation self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  }
  else main();
}
