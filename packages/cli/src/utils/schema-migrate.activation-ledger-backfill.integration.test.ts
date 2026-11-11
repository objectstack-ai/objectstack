// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32096] A one-shot CLI boot does not run the activation ledger's package
 * backfill (ADR-0150 D8 row R4): `os migrate plan` on a database an earlier
 * release left neither attempts the write nor blames a plugin for it.
 *
 * ## The measured defect
 *
 * `backfillActivationLedgerAtBoot` runs at `kernel:bootstrapped`, and the
 * declaration boot `os migrate plan` / `apply` / `stored-references` make
 * (`bootSchemaStack`) dispatches that phase. Its write met the declaration
 * boot's write guard, which refused it and named "a plugin that registers a
 * writing hook outside start()" with the advice to move the write into
 * `start()`: one stderr line and one note in the plan, on the command an
 * operator runs before upgrading, about a plugin bug that does not exist.
 *
 * ## What is pinned
 *
 * Over a database holding one ledger row that names no package for a flow one
 * package ships (the 18.3.0 shape the backfill exists for), the boot `os
 * migrate plan` makes:
 *
 *  - attempts no write: the guard records no refusal, no `Refused …()` line is
 *    printed, and no note blames a plugin;
 *  - leaves the row as it was (`package_id` still null), read back on a
 *    connection of our own after the boot is shut down;
 *  - still says what the served boot will do: one line naming the row and the
 *    package it will be bound to, the backfill's own dry-run answer.
 *
 * And over a database that does not exist yet (the plan opens it empty in
 * memory, the ledger table is a pending `create_table`), the dry run's refused
 * read prints nothing: the plan used to say "the package backfill did not
 * finish", an upgrade failure on a boot that was never going to upgrade.
 *
 * The gate's other side, a boot that does not declare itself one-shot (the
 * served boot) binding the row, is pinned beside the backfill
 * (`packages/objectql/src/activation-ledger-backfill.test.ts`).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { bootSchemaStack } from './schema-migrate.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: `bootSchemaStack` reaches them through dynamic `import()`s,
// which vitest clocks (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';
import '@objectstack/platform-objects/plugin';
import '@objectstack/plugin-audit';
import '@objectstack/service-datasource';
import '@objectstack/driver-turso';
import '@objectstack/plugin-security';
import '@objectstack/rest';

const CASE_TIMEOUT_MS = 180_000;
const PKG = 'com.example.m32096a';
const FLOW = 'm32096_flow';
const LEDGER = 'sys_metadata_activation';

const artifact = {
  manifest: { id: 'com.example.m32096', name: 'm32096', version: '1.0.0', type: 'app' },
  packages: [{
    manifest: {
      id: PKG, name: 'm32096a', version: '1.0.0', type: 'app', namespace: 'm32096a',
      objects: [{ name: 'm32096a_task', label: 'Task', fields: { title: { name: 'title', label: 'Title', type: 'text' } } }],
      flows: [{ name: FLOW, label: 'Flow', type: 'autolaunched', nodes: [{ id: 'start', type: 'start', label: 'Start' }], edges: [] }],
    },
  }],
};

let dir: string;
let dbFile: string;
const savedCwd = process.cwd();
const ENV_KEYS = ['OS_ARTIFACT_PATH', 'OS_DATABASE_URL', 'DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'NODE_ENV',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ENVIRONMENT_ID'] as const;
const savedEnv: Record<string, string | undefined> = {};

async function ledgerRows(): Promise<Array<Record<string, unknown>>> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    return await (driver as any).knex(LEDGER).select('id', 'metadata_type', 'name', 'package_id').orderBy('id');
  } finally {
    await driver.disconnect();
  }
}

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NODE_ENV = 'production';
  process.env.OS_AUTH_SECRET = 'm32096'.repeat(11);
  dir = mkdtempSync(join(tmpdir(), 'os-32096-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  process.env.OS_HOME = join(dir, 'home');
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(artifact));
  dbFile = join(dir, 'upgrade.db');
  process.chdir(dir);
  try {
    // The tables, as a served platform provisioned them.
    const stack = await bootSchemaStack({
      jsonOutput: true, databaseUrl: `file:${dbFile}`, projectRoot: dir,
      composeHostStack: true, composeServedPlatform: true, composeAuthGatedSecurity: true,
    });
    await stack.shutdown();
  } finally {
    process.chdir(savedCwd);
  }
  // The row an earlier release wrote: the package's flow switched off, naming no package.
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    const now = new Date().toISOString();
    await (driver as any).knex(LEDGER).insert({
      id: 'm32096_row', metadata_type: 'flow', name: FLOW, package_id: null, active: false, created_at: now, updated_at: now,
    });
  } finally {
    await driver.disconnect();
  }
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

interface PlanBoot { printed: string[]; notes: string[]; refusals: readonly unknown[] }

/**
 * The boot `os migrate plan` makes (`commands/migrate/plan.ts`) over `file`,
 * with every line it prints: the guard warns on `console`, the kernel logger
 * writes to the process streams.
 */
async function planBoot(file: string): Promise<PlanBoot> {
  const printed: string[] = [];
  const capture = (...args: unknown[]) => { printed.push(args.map(String).join(' ')); };
  const captureStream = ((chunk: unknown, ...rest: unknown[]) => {
    printed.push(...String(chunk).split('\n').filter(Boolean));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const spies = [
    vi.spyOn(console, 'warn').mockImplementation(capture),
    vi.spyOn(console, 'log').mockImplementation(capture),
    vi.spyOn(console, 'error').mockImplementation(capture),
    vi.spyOn(console, 'info').mockImplementation(capture),
    vi.spyOn(process.stdout, 'write').mockImplementation(captureStream),
    vi.spyOn(process.stderr, 'write').mockImplementation(captureStream),
  ];
  process.chdir(dir);
  try {
    const stack = await bootSchemaStack({
      jsonOutput: false, databaseUrl: `file:${file}`, projectRoot: dir,
      deferSchemaDdl: true, deferredDdlUnsupported: 'skip-schema-sync', readOnlyProbe: true,
      composeHostStack: true, composeServedPlatform: true, composeDeclaredDatasources: true,
    });
    const notes = [...stack.composition.notes];
    const refusals = [...(stack.composition.writeGuard?.refusals ?? [])];
    await stack.shutdown();
    return { printed, notes, refusals };
  } finally {
    process.chdir(savedCwd);
    for (const spy of spies) spy.mockRestore();
  }
}

/** A line the backfill prints: its report (`activation ledger: …`) or its failure (`the <ledger> package backfill …`). */
const backfillLines = (printed: string[]) =>
  printed.filter((line) => line.includes('[ObjectQLPlugin] activation ledger:') || line.includes(`${LEDGER} package backfill`));

describe('os migrate plan and the activation ledger backfill (#32096)', () => {
  it('attempts no backfill write over a row that names no package, blames no plugin, leaves the row, and names the bind the served boot will make', async () => {
    expect(await ledgerRows()).toEqual([{ id: 'm32096_row', metadata_type: 'flow', name: FLOW, package_id: null }]);

    const { printed, notes, refusals } = await planBoot(dbFile);

    expect(refusals).toEqual([]);
    expect(printed.filter((line) => /Refused \w+\(\)|writing hook outside start\(\)/.test(line))).toEqual([]);
    expect(notes.filter((note) => /Refused|writing hook outside start\(\)/.test(note))).toEqual([]);
    expect(await ledgerRows()).toEqual([{ id: 'm32096_row', metadata_type: 'flow', name: FLOW, package_id: null }]);
    const lines = backfillLines(printed);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`flow '${FLOW}' → ${PKG}`);
    expect(lines[0]).toContain('next served boot');
  }, CASE_TIMEOUT_MS);

  it('says nothing about the backfill on a database that does not exist yet: a dry run that cannot read the ledger is not an upgrade that failed', async () => {
    const absent = join(dir, 'absent.db');

    const { printed, refusals } = await planBoot(absent);

    expect(refusals).toEqual([]);
    expect(backfillLines(printed)).toEqual([]);
    expect(existsSync(absent)).toBe(false);
  }, CASE_TIMEOUT_MS);
});
