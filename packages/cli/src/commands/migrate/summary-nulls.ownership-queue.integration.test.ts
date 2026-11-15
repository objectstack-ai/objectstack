// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D1] A stack that declares `queues` and `assignmentRules` boots
 * through the migrate path, and `os migrate summary-nulls` fills its new
 * roll-ups on that stack.
 *
 * The engine refuses, at `kernel:ready`, a stack declaring either key with no
 * `ownership-queue` service registered. `os serve` registers it (`sharing` is
 * on its always-on slate); every one-shot `bootSchemaStack` boot whose plugin
 * set carried no sharing provider refused instead, so a queue-using app could
 * run no data migration at all. `bootSchemaStack` now composes the provider
 * `os serve` mounts, for its declarations only, whenever the boot lacks it
 * (`../../utils/migrate-ownership-queue.ts`).
 *
 * ## The fixture
 *
 * One app object owning two roll-ups (`count`, `sum`) over a master-detail
 * child, one declared queue and one declared assignment rule routing the
 * child into it. The parent and child rows are written through the DRIVER,
 * below the engine's door, which is how rows stored before the roll-ups were
 * declared hold them: `NULL`, never recomputed.
 *
 * Pinned:
 *  1. `os migrate summary-nulls` — dry run, then `--apply` — runs on that
 *     stack: the dry run counts the `NULL` values and writes none, the apply
 *     fills each with its real aggregate, a re-run reads zero.
 *  2. Each composition a migrate subcommand boots with gets the provider
 *     once: the plain data stack (`account-issuer`, `duplicates`,
 *     `multi-value-columns`), a data-migration plugin set
 *     (`buildDataMigrationPlugins`, the rest of the data family), the host
 *     composition (`packageless-overlays`, `security-catalog-overlays`) and
 *     the served-platform composition (`plan`, `apply`, `unmapped-columns`,
 *     `organization-ownership`), which already mounts the provider and so is
 *     not given a second one.
 *  3. No sharing runtime is armed: no `sharing` service (registered only by
 *     the provider's `start()`), while the `ownership-queue` service is.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { OWNERSHIP_QUEUE_SERVICE } from '@objectstack/spec/contracts';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import MigrateSummaryNulls from './summary-nulls.js';
// [#10126] Pay the first transform of the dist-resolved workspace deps the
// boot reaches through dynamic `import()`s at MODULE LOAD, not inside a
// clocked case (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/plugin-sharing';
import '@objectstack/plugin-audit';
import '@objectstack/platform-objects/plugin';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 120_000;
const ORG = 'org_sqn';

const ARTIFACT = {
  manifest: { id: 'com.example.summary-queue', name: 'Summary Queue', version: '0.0.0', type: 'app' },
  objects: [
    {
      name: 'sqn_account',
      fields: {
        name: { type: 'text' },
        contract_count: { type: 'summary', summaryOperations: { object: 'sqn_contract', field: 'id', function: 'count' } },
        contract_total: { type: 'summary', summaryOperations: { object: 'sqn_contract', field: 'amount', function: 'sum' } },
      },
    },
    {
      name: 'sqn_contract',
      fields: {
        title: { type: 'text' },
        amount: { type: 'number' },
        account: { type: 'master_detail', reference: 'sqn_account' },
      },
    },
  ],
  queues: [{ name: 'sqn_intake', label: 'Contract intake', members: [] }],
  assignmentRules: [{
    name: 'sqn_contract_intake',
    label: 'Contract intake',
    object: 'sqn_contract',
    active: true,
    entries: [{ name: 'all', assignTo: { type: 'queue', value: 'sqn_intake' } }],
  }],
};

/** Env that would point a boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_ARTIFACT_PATH'] as const;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();
let dir: string;
let dbFile: string;

function probe(): SqlDriver {
  return new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
}

async function accounts(): Promise<Array<{ id: string; contract_count: unknown; contract_total: unknown }>> {
  const driver = probe();
  try {
    return await (driver as any).knex('sqn_account').select('id', 'contract_count', 'contract_total').orderBy('id');
  } finally {
    await driver.disconnect();
  }
}

/** One command run through oclif, its `--json` document captured. */
async function runJson(argv: string[]): Promise<{ payload: any; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  // Installed before the boot: a `--json` boot reserves stdout and keeps
  // whatever `process.stdout.write` is at that moment.
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let exitCode = 0;
  try {
    try {
      await MigrateSummaryNulls.run(argv, { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      exitCode = (error as { oclif?: { exit?: number } }).oclif?.exit ?? 1;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any;
    try { payload = JSON.parse(out); } catch { payload = { unparsed: out.slice(-600) }; }
    return { payload, exitCode: exitCode || ((process.exitCode as number | undefined) ?? 0) };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  process.env.NODE_ENV = 'test';
  dir = mkdtempSync(join(tmpdir(), 'os-summary-queue-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  // The standalone stack reads `OS_ARTIFACT_PATH`, else `<cwd>/dist/objectstack.json`.
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(ARTIFACT));
  dbFile = join(dir, 'app.db');

  // The tables, from a plain one-shot boot of this stack — itself the
  // composition `account-issuer` / `duplicates` boot with.
  const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, projectRoot: dir });
  await stack.shutdown();

  // The before-state, below the engine's door: no recompute ever ran.
  const driver = probe();
  try {
    const k = (driver as any).knex;
    await k('sqn_account').insert([
      { id: 'a_busy', name: 'Busy', organization_id: ORG },
      { id: 'a_quiet', name: 'Quiet', organization_id: ORG },
    ]);
    await k('sqn_contract').insert([
      { id: 'c1', title: 'C1', amount: 10, account: 'a_busy', organization_id: ORG },
      { id: 'c2', title: 'C2', amount: 32, account: 'a_busy', organization_id: ORG },
    ]);
  } finally {
    await driver.disconnect();
  }
}, 180_000);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// The command takes `process.cwd()` as the project root, as a real invocation does.
beforeEach(() => { process.chdir(dir); });
afterEach(() => { process.chdir(savedCwd); });

describe('os migrate summary-nulls on a stack declaring queues and assignmentRules', () => {
  it('the dry run boots, counts the NULL roll-ups and writes none; --apply fills them; a re-run reads zero', async () => {
    expect(await accounts()).toEqual([
      { id: 'a_busy', contract_count: null, contract_total: null },
      { id: 'a_quiet', contract_count: null, contract_total: null },
    ]);

    const preview = await runJson(['--database-url', `file:${dbFile}`, '--json']);
    expect(preview.payload?.error, JSON.stringify(preview.payload).slice(0, 600)).toBeUndefined();
    expect(preview.exitCode).toBe(0);
    expect(preview.payload.apply).toBe(false);
    expect(preview.payload.report.nullRows).toBe(4);
    expect(preview.payload.report.filled).toBe(0);
    expect((await accounts()).every((a) => a.contract_count === null && a.contract_total === null)).toBe(true);

    const applied = await runJson(['--apply', '--yes', '--database-url', `file:${dbFile}`, '--json']);
    expect(applied.payload?.error, JSON.stringify(applied.payload).slice(0, 600)).toBeUndefined();
    expect(applied.exitCode).toBe(0);
    expect(applied.payload.report.failures).toEqual([]);
    expect(applied.payload.report.filled).toBe(4);
    expect(await accounts()).toEqual([
      { id: 'a_busy', contract_count: 2, contract_total: 42 },
      { id: 'a_quiet', contract_count: 0, contract_total: 0 },
    ]);

    const again = await runJson(['--database-url', `file:${dbFile}`, '--json']);
    expect(again.payload?.error).toBeUndefined();
    expect(again.payload.report.nullRows).toBe(0);
  }, CASE_TIMEOUT_MS);
});

describe('every composition an os migrate subcommand boots with registers the ownership-queue service once', () => {
  const COMPOSITIONS: Array<{ label: string; options: () => Promise<Record<string, unknown>> }> = [
    { label: 'the plain data stack (account-issuer, duplicates, multi-value-columns)', options: async () => ({}) },
    {
      label: 'a data-migration plugin set (buildDataMigrationPlugins, the rest of the data family)',
      options: async () => ({ extraPlugins: await buildDataMigrationPlugins({ audit: true }) }),
    },
    { label: 'the host composition (packageless-overlays, security-catalog-overlays)', options: async () => ({ composeHostStack: true }) },
    {
      label: 'the served-platform composition (plan, apply, unmapped-columns, organization-ownership)',
      options: async () => ({ composeHostStack: true, composeServedPlatform: true }),
    },
  ];

  for (const composition of COMPOSITIONS) {
    it(composition.label, async () => {
      const stack = await bootSchemaStack({
        jsonOutput: false,
        databaseUrl: `file:${dbFile}`,
        projectRoot: dir,
        deferSchemaDdl: true,
        readOnlyProbe: true,
        ...(await composition.options()),
      });
      try {
        expect(stack.kernel.getService(OWNERSHIP_QUEUE_SERVICE)).toBeTruthy();
        // The provider's runtime is not armed: `sharing` is registered by its `start()` only.
        expect(() => stack.kernel.getService('sharing')).toThrow();
      } finally {
        await stack.shutdown();
      }
    }, CASE_TIMEOUT_MS);
  }
});
