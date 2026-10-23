// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A unique index whose rows already violate it: `os migrate plan` and `os
 * migrate apply` name why the apply cannot create it, and never offer
 * `--allow-destructive` for it.
 *
 * ## What used to happen
 *
 * Measured on a SQLite file whose rows duplicate two newly declared unique
 * indexes, one plain and one organization-scoped. The ADR-0120 D4 duplicate
 * pre-flight marked each `create_index` BLOCKED in its message, and yet:
 *
 *     os migrate plan        → Apply with: os migrate apply (add --allow-destructive for drops / tightenings)
 *     os migrate apply --yes → ⚠ 2 destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).
 *     os migrate apply --allow-destructive --yes → ✗ PARTIAL apply …   exit 1
 *
 * The block lived in the message only, and the seam both doors read for "an
 * entry the apply cannot perform" (`SchemaStack.driftApplyLimit`) asked the
 * driver by op type.
 *
 * ## What is pinned
 *
 * The driver declares the block on the entry (`ManagedDriftEntry.applyLimit`,
 * the conflicting groups as the reason) and the seam reads it, so the
 * rendering PR #24954 and PR #25029 built for declared limits takes over:
 *
 *  1. `plan`: each blocked entry is listed with its limit, naming the
 *     conflicting group; the footer offers `--allow-destructive` for nothing
 *     and says those changes remain drift.
 *  2. `apply --yes`: the same listing; no line before the prompt or after the
 *     apply offers a re-run with `--allow-destructive`.
 *  3. `apply --allow-destructive --yes`: the same listing, and the entries are
 *     named as not applied. The verdict is unchanged: an entry the operator
 *     confirmed and the driver did not apply makes the run PARTIAL, exit 1, as
 *     on the Turso REMOTE transport (`apply.remote-face.integration.test.ts`).
 *  4. CONTROL: a duplicate-free unique index the database lacks is listed and
 *     footed as it always was, and a plain apply creates it.
 *
 * Real boot, real commands, a real SQLite file read back through a connection
 * of its own.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { isExitSignal } from '../../utils/format.js';
import MigrateApply from './apply.js';
import MigratePlan from './plan.js';

// Paid at module load, not inside a clocked case (`check:test-source-alias`).
import '@objectstack/runtime';
import '@objectstack/objectql';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;

/** Env that would point a boot somewhere other than the fixture, or change what it composes. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'OS_DATABASE_AUTH_TOKEN',
  'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH', 'OS_TELEMETRY_DB', 'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED', 'OS_SKIP_SCHEMA_SYNC', 'NODE_ENV',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET',
] as const;

const PLAIN = 'os25031_plain';
const SCOPED = 'os25031_scoped';
const PLAIN_INDEX = `uniq_${PLAIN}_code`;
const SCOPED_INDEX = `uniq_${SCOPED}_organization_id_code`;

/** `code` is declared unique on both: platform-wide on the first, per organization on the second. */
const HOST_CONFIG = [
  'export default {',
  "  manifest: { id: 'com.example.os25031', name: 'os25031', version: '0.0.0', type: 'app' },",
  '  objects: [',
  `    { name: '${PLAIN}', tenancy: { enabled: false }, fields: { code: { type: 'text', unique: true } } },`,
  `    { name: '${SCOPED}', fields: { code: { type: 'text', unique: true } } },`,
  '  ],',
  '};',
  '',
].join('\n');

/** The two tables, made by hand before any index exists, with their rows. */
const seedSql = (duplicates: boolean): string[] => [
  `CREATE TABLE "${PLAIN}" ("id" TEXT PRIMARY KEY, "code" TEXT)`,
  `CREATE TABLE "${SCOPED}" ("id" TEXT PRIMARY KEY, "organization_id" TEXT, "code" TEXT)`,
  `INSERT INTO "${PLAIN}" ("id", "code") VALUES ('p1', 'A'), ('p2', '${duplicates ? 'A' : 'B'}')`,
  // `org_y` shares the code with `org_x`'s rows: no duplicate under the organization key.
  `INSERT INTO "${SCOPED}" ("id", "organization_id", "code") VALUES ('s1', 'org_x', 'Q'), ('s2', 'org_x', '${duplicates ? 'Q' : 'R'}'), ('s3', 'org_y', 'Q')`,
];

let dir: string;
let projectDir: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

/** Run statements against the file through a connection of their own. */
function local<T>(file: string, read: (db: Database.Database) => T): T {
  const db = new Database(file);
  try {
    return read(db);
  } finally {
    db.close();
  }
}

const indexesOf = (file: string, table: string): string[] =>
  local(file, (db) => (db.prepare(`PRAGMA index_list("${table}")`).all() as Array<{ name: string }>).map((r) => r.name));

/** Seed the hand-made tables, then the environment's own syncing boot over them. */
async function buildFixture(file: string, duplicates: boolean): Promise<void> {
  local(file, (db) => { for (const sql of seedSql(duplicates)) db.exec(sql); });
  const stack = await bootSchemaStack({
    jsonOutput: false,
    databaseUrl: `file:${file}`,
    projectRoot: projectDir,
    composeHostStack: true,
    composeServedPlatform: true,
  });
  await stack.shutdown();
}

/** The real command, with its human lines captured. */
async function run(command: typeof MigrateApply | typeof MigratePlan, args: string[]): Promise<{ lines: string; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  const said: string[] = [];
  const capture = (...parts: unknown[]) => { said.push(parts.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  process.chdir(projectDir);
  let thrownExit: number | undefined;
  try {
    try {
      await (command === MigrateApply ? MigrateApply.run(args, { root: CLI_ROOT }) : MigratePlan.run(args, { root: CLI_ROOT }));
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    return {
      lines: said.join('\n'),
      exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0,
    };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

/** The line the listing prints under an index entry's heading: its finding and its remedy. */
function entryLine(lines: string, index: string): string {
  const all = lines.split('\n');
  const at = all.findIndex((l) => l.includes(`[${index}]`) && l.includes('[create_index]'));
  expect(at, `no ${index} [create_index] entry in:\n${lines.slice(-3000)}`).toBeGreaterThanOrEqual(0);
  return all[at + 1]!;
}

/** The plan's closing lines: what to apply with, and what this database cannot apply. */
const planFooter = (lines: string) =>
  lines.split('\n').filter((l) => /Apply with:|cannot be applied on this database/.test(l)).join('\n');

/** Every line that offers a re-run with --allow-destructive. */
const reRunOffers = (lines: string) =>
  lines.split('\n').filter((l) => /re-run with --allow-destructive to include them|add --allow-destructive/.test(l));

const LIMITED = '"os migrate apply" cannot apply it on this database';

/** Each blocked entry is listed with its limit, which names its conflicting group. */
function expectBlockedListing(lines: string): void {
  const plain = entryLine(lines, PLAIN_INDEX);
  expect(plain).toContain(LIMITED);
  expect(plain.slice(plain.indexOf(LIMITED))).toContain('code="A"');
  const scoped = entryLine(lines, SCOPED_INDEX);
  expect(scoped).toContain(LIMITED);
  expect(scoped.slice(scoped.indexOf(LIMITED))).toContain('organization_id="org_x", code="Q"');
}

beforeAll(() => {
  for (const key of OVERRIDING_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'os-blocked-unique-'));
  projectDir = join(dir, 'project');
  mkdirSync(join(projectDir, 'dist'), { recursive: true });
  writeFileSync(join(projectDir, 'objectstack.config.ts'), HOST_CONFIG);
  process.env.OS_ARTIFACT_PATH = join(projectDir, 'dist', 'objectstack.json'); // deliberately absent
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
});

afterAll(() => {
  for (const key of OVERRIDING_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('a unique index its rows violate: listed with why, never offered --allow-destructive', () => {
  it('plan: each blocked entry names its conflicting group, and the footer offers --allow-destructive for nothing', async () => {
    const file = join(dir, 'plan.db');
    await buildFixture(file, true);
    expect(indexesOf(file, PLAIN)).not.toContain(PLAIN_INDEX);

    const plan = await run(MigratePlan, ['--database-url', `file:${file}`]);
    expect(plan.exitCode, plan.lines.slice(-1500)).toBe(0);
    expectBlockedListing(plan.lines);
    expect(reRunOffers(plan.lines)).toEqual([]);
    expect(planFooter(plan.lines)).toContain('cannot be applied on this database');
  }, CASE_TIMEOUT_MS);

  it('apply --yes: the same listing, and no re-run with --allow-destructive is offered before the prompt or after', async () => {
    const file = join(dir, 'apply.db');
    await buildFixture(file, true);

    const apply = await run(MigrateApply, ['--database-url', `file:${file}`, '--yes']);
    expect(apply.exitCode, apply.lines.slice(-1500)).toBe(0);
    expectBlockedListing(apply.lines);
    expect(reRunOffers(apply.lines)).toEqual([]);
    expect(apply.lines).toContain('2 destructive change(s) remain drift that a re-run with --allow-destructive cannot apply');
    expect(indexesOf(file, PLAIN)).not.toContain(PLAIN_INDEX);
    expect(indexesOf(file, SCOPED)).not.toContain(SCOPED_INDEX);
  }, CASE_TIMEOUT_MS);

  it('apply --allow-destructive --yes: the same listing, both entries named as not applied, the run PARTIAL as before', async () => {
    const file = join(dir, 'apply-destructive.db');
    await buildFixture(file, true);

    const apply = await run(MigrateApply, ['--database-url', `file:${file}`, '--allow-destructive', '--yes']);
    expectBlockedListing(apply.lines);
    expect(reRunOffers(apply.lines)).toEqual([]);
    expect(apply.lines).toContain(`${PLAIN}.code — create_index ${PLAIN_INDEX} (destructive)`);
    expect(apply.lines).toContain(`create_index ${SCOPED_INDEX} (destructive)`);
    expect(apply.lines).toContain('PARTIAL apply');
    expect(apply.exitCode).toBe(1);
    expect(indexesOf(file, PLAIN)).not.toContain(PLAIN_INDEX);
  }, CASE_TIMEOUT_MS);
});

describe('CONTROL: a duplicate-free unique index reads and applies as it always has', () => {
  it('plan lists it with its own finding and the unchanged footer; a plain apply creates it', async () => {
    const file = join(dir, 'clean.db');
    await buildFixture(file, false);
    // The boot built both over clean rows; take them away so the plan has two creates.
    local(file, (db) => db.exec(`DROP INDEX "${PLAIN_INDEX}"; DROP INDEX "${SCOPED_INDEX}";`));

    const plan = await run(MigratePlan, ['--database-url', `file:${file}`]);
    expect(plan.exitCode, plan.lines.slice(-1500)).toBe(0);
    expect(entryLine(plan.lines, PLAIN_INDEX)).not.toContain(LIMITED);
    expect(entryLine(plan.lines, SCOPED_INDEX)).not.toContain(LIMITED);
    expect(planFooter(plan.lines)).toBe('  Apply with: os migrate apply (add --allow-destructive for drops / tightenings)');

    const apply = await run(MigrateApply, ['--database-url', `file:${file}`, '--yes']);
    expect(apply.exitCode, apply.lines.slice(-1500)).toBe(0);
    expect(indexesOf(file, PLAIN)).toContain(PLAIN_INDEX);
    expect(indexesOf(file, SCOPED)).toContain(SCOPED_INDEX);
  }, CASE_TIMEOUT_MS);
});
