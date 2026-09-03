// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Fixture sources for the tier predicate in `vitest-tiers.ts` (#14554).
 *
 * ## Why these exist
 *
 * Until #14554 the integration population was a hand-written list in
 * `vitest.config.ts` and the pin asserted list == predicate. That comparison
 * was also, incidentally, the only check on the PREDICATE: a regex that
 * stopped matching showed up as the list disagreeing with it. Deriving the
 * population from the predicate deletes the list — and with it that accidental
 * second opinion, because the config and the pin now compute the same answer
 * from the same code and will always agree with each other.
 *
 * These cases are the deliberate replacement. Each is a whole (tiny) test file
 * whose tier is known by construction, so a weakened regex reddens on the
 * signal it weakened and says which one. Without them, a predicate that
 * matched NOTHING would empty the integration tier, run the whole suite
 * serialised in `unit`, and leave every population assertion in the pin green.
 *
 * ## ⛔ Why they are NOT in `test/`, and not inside the pin
 *
 * The predicate reads test files as TEXT, and `maskComments` blanks comments
 * but deliberately leaves string and template literals intact. A fixture that
 * spells a spawn or a kernel boot therefore CLASSIFIES ITS OWN HOST FILE the
 * moment that host is a `*.test.ts` on disk: the pin would move itself into
 * the integration tier and then fail its own last case. Keeping the fixtures
 * in a module that is not a test file — this one — is what makes them safe to
 * spell literally, which is the only way they are worth anything as fixtures.
 *
 * ⛔ Do not rename this file to `*.test.ts` and do not move it under `test/`.
 * Both are silent: the population simply gains a file whose tier is a fiction.
 */

import type { TierSignals } from './vitest-tiers.js';

export interface PredicateCase {
  /** Names the case in the pin's failure output. */
  name: string;
  /** A whole test file, as source text. */
  source: string;
  /** The tier the predicate must return. */
  integration: boolean;
  /**
   * The signals that must be TRUE for this source. Every signal
   * `tierSignals` declares has to appear in some case's `fires` — the pin
   * asserts that union, so adding a signal without a fixture is itself red.
   */
  fires: Array<keyof TierSignals>;
  /** Signals that must be FALSE — how a false-positive case states its point. */
  silent?: Array<keyof TierSignals>;
  /** The defect this case catches if the predicate is weakened. */
  why: string;
}

export const PREDICATE_CASES: PredicateCase[] = [
  // -------------------------------------------------------------------------
  // SPAWN — the real CLI, or this package's source in a cold tsx child
  // -------------------------------------------------------------------------
  {
    name: 'runServe() from the serve-process helper',
    integration: true,
    fires: ['runServe'],
    why: 'the helper body spawns the source entry; six files reach the CLI only this way',
    source: [
      "import { runServe } from './helpers/serve-process.js';",
      "it('serves', async () => {",
      "  const proc = await runServe({ args: ['--help'] });",
      '  expect(proc.exitCode).toBe(0);',
      '});',
    ].join('\n'),
  },
  {
    name: 'child_process + the `run.js` entry basename',
    integration: true,
    fires: ['childProcess', 'entryBasename'],
    why: 'spawning the built entry directly is the oldest spawn shape in this package',
    source: [
      "import { spawnSync } from 'node:child_process';",
      "it('exits 0', () => {",
      "  const r = spawnSync(process.execPath, ['bin/run.js', '--help']);",
      '  expect(r.status).toBe(0);',
      '});',
    ].join('\n'),
  },
  {
    name: 'child_process + the `run-dev.js` entry basename',
    integration: true,
    fires: ['childProcess', 'entryBasename'],
    why: 'the `-dev` alternation in the basename regex is load-bearing and easy to drop',
    source: [
      "import { spawn } from 'node:child_process';",
      "it('boots dev', () => {",
      "  const child = spawn(process.execPath, ['bin/run-dev.js']);",
      '  expect(child.pid).toBeGreaterThan(0);',
      '});',
    ].join('\n'),
  },
  {
    name: 'child_process + the helper CLI path constant',
    integration: true,
    fires: ['childProcess', 'helperCliOrTsx'],
    why: 'five files spawn through the exported path constant and name no basename at all',
    source: [
      "import { execFileSync } from 'node:child_process';",
      "import { CLI } from './helpers/serve-process.js';",
      "it('builds', () => {",
      "  execFileSync(process.execPath, [CLI, 'build']);",
      '});',
    ].join('\n'),
  },
  {
    name: 'child_process + the tsx binary under node_modules/.bin',
    integration: true,
    fires: ['childProcess', 'tsxBin'],
    why: 'a cold tsx child runs this package from SOURCE and costs the same as a spawn',
    source: [
      "import { spawnSync } from 'node:child_process';",
      "it('runs source', () => {",
      "  spawnSync('node_modules/.bin/tsx', ['src/entry.ts']);",
      '});',
    ].join('\n'),
  },

  // -------------------------------------------------------------------------
  // KERNEL — a real kernel or driver, booted in process
  // -------------------------------------------------------------------------
  {
    name: 'bootSchemaStack from schema-migrate',
    integration: true,
    fires: ['bootSchemaStack'],
    why: 'boots the real migration stack in process',
    source: [
      "import { bootSchemaStack } from '../src/utils/schema-migrate.js';",
      "it('migrates', async () => {",
      '  const stack = await bootSchemaStack({});',
      '  expect(stack).toBeDefined();',
      '});',
    ].join('\n'),
  },
  {
    name: 'a value import of better-sqlite3',
    integration: true,
    fires: ['betterSqlite3'],
    why: 'opens a real database',
    source: [
      "import Database from 'better-sqlite3';",
      "it('opens', () => {",
      "  const db = new Database(':memory:');",
      '  expect(db.open).toBe(true);',
      '});',
    ].join('\n'),
  },
  {
    name: 'a require() of better-sqlite3',
    integration: true,
    fires: ['betterSqlite3'],
    why: 'the CJS spelling opens the same database the ESM one does',
    source: [
      "const Database = require('better-sqlite3');",
      "it('opens', () => {",
      "  expect(new Database(':memory:').open).toBe(true);",
      '});',
    ].join('\n'),
  },
  {
    name: 'a value import of an @objectstack/driver-* package',
    integration: true,
    fires: ['driverPackage'],
    why: 'a driver import brings a real connection path with it',
    source: [
      "import { SqlDriver } from '@objectstack/driver-sql';",
      "it('connects', () => {",
      '  expect(new SqlDriver({})).toBeDefined();',
      '});',
    ].join('\n'),
  },
  {
    name: 'a `new ObjectQL(` construction',
    integration: true,
    fires: ['objectQLCtor'],
    why: 'the shape a name-based tier can never see — it landed on an EXISTING unit file and ejected five PRs',
    source: [
      "it('queries', async () => {",
      "  const objectql = new ObjectQL({ datasource: 'default' });",
      "  await objectql.find('sys_user');",
      '});',
    ].join('\n'),
  },

  // -------------------------------------------------------------------------
  // The false positives the predicate was tuned against — every one of these
  // was a real miscount of the text-match census #13504 replaced.
  // -------------------------------------------------------------------------
  {
    name: 'a type-only driver import',
    integration: false,
    fires: [],
    silent: ['driverPackage'],
    why: 'erased before anything resolves — it loads no driver',
    source: [
      "import type { SqlDriver } from '@objectstack/driver-sql';",
      'export const shape: SqlDriver | null = null;',
    ].join('\n'),
  },
  {
    name: 'a type-only import of bootSchemaStack',
    integration: false,
    fires: [],
    silent: ['bootSchemaStack'],
    why: 'a type import of a booter boots nothing',
    source: [
      "import type { bootSchemaStack } from '../src/utils/schema-migrate.js';",
      'export type Boot = typeof bootSchemaStack;',
    ].join('\n'),
  },
  {
    name: 'an inline `type` specifier for the helper CLI constant',
    integration: false,
    fires: ['childProcess'],
    silent: ['helperCliOrTsx'],
    why: 'inline `type X` is stripped from the clause before the name is matched',
    source: [
      "import { execFileSync } from 'node:child_process';",
      "import { type CLI } from './helpers/serve-process.js';",
      "it('reads git', () => {",
      "  execFileSync('git', ['status']);",
      '});',
    ].join('\n'),
  },
  {
    name: 'a spelling list that names better-sqlite3',
    integration: false,
    fires: [],
    silent: ['betterSqlite3'],
    why: 'a list that SAYS the name opens no database',
    source: [
      "const CONTRACT_ONLY_SPELLINGS = ['better-sqlite3', 'mysql2'];",
      "it('declares the dialects', () => {",
      "  expect(CONTRACT_ONLY_SPELLINGS).toContain('better-sqlite3');",
      '});',
    ].join('\n'),
  },
  {
    name: 'child_process with no entry, helper constant or tsx binary',
    integration: false,
    fires: ['childProcess'],
    silent: ['entryBasename', 'helperCliOrTsx', 'tsxBin'],
    why: "this pin's own shape: importing child_process to ASK a tool something is not spawning the CLI",
    source: [
      "import { execFileSync } from 'node:child_process';",
      "import { childEnv } from './helpers/serve-process.js';",
      "it('asks git', () => {",
      "  execFileSync('git', ['status'], { env: childEnv() });",
      '});',
    ].join('\n'),
  },
  {
    name: 'prose that names every signal, in comments only',
    integration: false,
    fires: [],
    silent: ['runServe', 'entryBasename', 'tsxBin', 'betterSqlite3', 'driverPackage', 'objectQLCtor'],
    why: 'proves the mask is actually applied — without it, documentation classifies files',
    source: [
      '/**',
      ' * This file used to call runServe( and construct new ObjectQL( against a',
      " * better-sqlite3 database opened by '@objectstack/driver-sql', spawned as",
      ' * bin/run.js through node_modules/.bin/tsx. It no longer does any of it.',
      ' */',
      "it('is documentation', () => {",
      '  expect(true).toBe(true);',
      '});',
    ].join('\n'),
  },
];
