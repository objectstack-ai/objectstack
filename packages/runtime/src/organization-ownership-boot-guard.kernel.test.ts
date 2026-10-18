// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10 item 5; ruling 6163114098, Q3 A] The v18 boot refusal on a
 * REAL kernel: the guard's throw must stop `bootstrap()`, which the unit pins
 * beside this file cannot show (they call the plugin by hand).
 *
 * The composition is `os serve`'s data spine — the SQL driver over a SQLite
 * file, ObjectQL, the platform objects — plus the guard. Each case seeds the
 * file before the boot, the way a v17 runtime or the ceremony left it:
 *
 *  1. a v17-shape database (a table whose object declares no organization
 *     column still carries a physical `organization_id`) is refused, with the
 *     refusal's code, and the kernel never reaches `running`;
 *  2. the same database with the ceremony's marker verified boots;
 *  3. a fresh database boots;
 *  4. a database the ceremony ran on to the end (no column left) whose marker
 *     is NOT verified — its post-check found rows still without their
 *     organization — is refused, naming the re-run;
 *  5. ⭐ a refused boot writes nothing: the plugins that write rows in their
 *     own `start()` — `AppPlugin` (the inline seed) and plugin-auth's
 *     identity-objects plugin (the Default Organization, `AuthPlugin`'s twin
 *     invariant) — are `use()`d BEFORE the guard, the hostile slot, and the
 *     refused file holds no organization and no seed row; the same composition
 *     over a fresh file writes both (the probe can see a write).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { AppPlugin } from './app-plugin.js';
import { DriverPlugin } from './driver-plugin.js';
import {
  isOrganizationOwnershipBootRefusal,
  ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE,
  OrganizationOwnershipBootGuardPlugin,
  type OrganizationOwnershipBootRefusal,
} from './organization-ownership-boot-guard.js';

const dirs: string[] = [];
const kernels: ObjectKernel[] = [];

/**
 * The refusal a failed boot carries. The guard refuses from its `start()`, and
 * the kernel reports a failed `start()` as its own error with the plugin's as
 * the `cause` — the shape a host that composes the guard reads.
 */
function refusalIn(error: unknown): OrganizationOwnershipBootRefusal | undefined {
  for (let e = error, depth = 0; !!e && typeof e === 'object' && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    if (isOrganizationOwnershipBootRefusal(e)) return e;
  }
  return undefined;
}
const MARKER = 'adr-0131-organization-ownership';

function databaseFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-ownership-guard-'));
  dirs.push(dir);
  return join(dir, 'data.db');
}

function sql<T = Record<string, unknown>>(file: string, statement: string): T[] {
  const db = new DatabaseSync(file);
  try {
    return db.prepare(statement).all() as T[];
  } finally {
    db.close();
  }
}

/**
 * What a v17 runtime left: `sys_migration_journal` (its object declares no
 * organization column, `systemFields.tenant: false`) still carrying the
 * injected one.
 */
function seedV17Shape(file: string, marker?: { verifiedAt: string | null }): void {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE sys_migration_journal (id TEXT PRIMARY KEY, organization_id TEXT)');
  if (marker) writeMarker(db, marker.verifiedAt);
  db.close();
}

function writeMarker(db: DatabaseSync, verifiedAt: string | null, blocking = 0): void {
  db.exec('CREATE TABLE IF NOT EXISTS sys_migration (id TEXT PRIMARY KEY, last_run_at TEXT, verified_at TEXT, applied_at TEXT, blocking INTEGER)');
  db.prepare('INSERT INTO sys_migration (id, last_run_at, verified_at, applied_at, blocking) VALUES (?, ?, ?, ?, ?)')
    .run(MARKER, '2026-10-14T00:00:00.000Z', verifiedAt, '2026-10-14T00:00:00.000Z', blocking);
}

/** An app whose inline seed writes two rows of an organization-owned object. */
const seededApp = () => new AppPlugin({
  id: 'com.test.guard_seed',
  name: 'guard_seed',
  version: '1.0.0',
  type: 'app',
  objects: [{ name: 'guard_event', label: 'Event', fields: { subject: { name: 'subject', type: 'text', label: 'Subject' } } }],
  data: [{ object: 'guard_event', mode: 'upsert', externalId: 'subject', records: [{ subject: 'one' }, { subject: 'two' }] }],
});

/**
 * Boot `os serve`'s data spine over `file`, the guard composed. With
 * `writers`, the plugins that write rows in their `start()` are `use()`d first —
 * before the engine and before the guard — so only their declared ordering can
 * put the guard's judgment ahead of their writes.
 */
async function boot(file: string, opts: { writers?: boolean } = {}): Promise<{ kernel: ObjectKernel; error: unknown }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  if (opts.writers) {
    await kernel.use(seededApp());
    await kernel.use(createIdentityObjectsPlugin() as never);
  }
  await kernel.use(new DriverPlugin(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
  })));
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new OrganizationOwnershipBootGuardPlugin());
  await kernel.use(new PlatformObjectsPlugin() as never);
  try {
    await kernel.bootstrap();
    return { kernel, error: null };
  } catch (error) {
    return { kernel, error };
  }
}

afterEach(async () => {
  for (const kernel of kernels.splice(0)) {
    if (kernel.getState() === 'running') await kernel.shutdown();
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the v18 boot refusal on a real kernel (ADR-0131 D10 item 5)', () => {
  it('⭐ a v17-shape database stops the boot with the refusal, before the kernel runs', async () => {
    const file = databaseFile();
    seedV17Shape(file);
    const { kernel, error } = await boot(file);
    const refusal = refusalIn(error);
    expect(refusal?.code, String(error)).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(refusal?.tables).toEqual(['sys_migration_journal']);
    // Refused in `start()`: the kernel's start-failure error carries it as its cause.
    expect((error as Error).message).toMatch(/^Plugin com\.objectstack\.organization-ownership-boot-guard failed to start/);
    expect((error as Error).cause).toBe(refusal);
    expect(kernel.getState()).not.toBe('running');
  });

  it('⭐ the same database, its ceremony marker verified, boots', async () => {
    const file = databaseFile();
    seedV17Shape(file, { verifiedAt: '2026-10-14T01:00:00.000Z' });
    const { kernel, error } = await boot(file);
    expect(error).toBeNull();
    expect(kernel.getState()).toBe('running');
  });

  it('control: an unverified marker is still refused', async () => {
    const file = databaseFile();
    seedV17Shape(file, { verifiedAt: null });
    const { error } = await boot(file);
    expect(refusalIn(error)?.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
  });

  it('⭐ a fresh database boots', async () => {
    const { kernel, error } = await boot(databaseFile());
    expect(error).toBeNull();
    expect(kernel.getState()).toBe('running');
  });

  it('⭐ a ceremony that ran every step and did not verify (no v17 column left, marker unverified) is refused, naming the re-run', async () => {
    const file = databaseFile();
    const db = new DatabaseSync(file);
    writeMarker(db, null, 602);
    db.close();
    const { kernel, error } = await boot(file);
    const refusal = refusalIn(error);
    expect(refusal?.code, String(error)).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(refusal?.tables).toEqual([]);
    expect(refusal?.message).toMatch(/^The organization-ownership ceremony has not finished on this database: its marker/);
    expect(refusal?.message).toContain("os migrate organization-ownership --apply --plan-file PLAN --backup-taken");
    expect(kernel.getState()).not.toBe('running');
  });

  it('control: the same database with its marker verified boots', async () => {
    const file = databaseFile();
    const db = new DatabaseSync(file);
    writeMarker(db, '2026-10-14T01:00:00.000Z');
    db.close();
    expect((await boot(file)).error).toBeNull();
  });
});

describe('a refused boot writes nothing (ADR-0131 D10 item 5: the guard judges before any plugin writes)', () => {
  it('⭐ the seed and the Default Organization, use()d ahead of the guard, start only after it judged: the refused file holds neither', async () => {
    const file = databaseFile();
    seedV17Shape(file);
    const { kernel, error } = await boot(file, { writers: true });
    expect(refusalIn(error)?.code, String(error)).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(kernel.getState()).not.toBe('running');
    // The engine's additive schema sync ran before the refusal (the ceremony's
    // rewrite step waits for it); the rows did not.
    const tables = sql<{ name: string }>(file, `SELECT name FROM sqlite_master WHERE type = 'table'`).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['sys_organization', 'guard_event']));
    expect(sql(file, 'SELECT id FROM sys_organization')).toEqual([]);
    expect(sql(file, 'SELECT id FROM guard_event')).toEqual([]);
  });

  it('control: the same composition over a fresh file writes the Default Organization and the seed', async () => {
    const file = databaseFile();
    const { kernel, error } = await boot(file, { writers: true });
    expect(error).toBeNull();
    expect(sql<{ slug: string }>(file, 'SELECT slug FROM sys_organization').map((o) => o.slug)).toEqual(['default']);
    expect(sql<{ subject: string }>(file, 'SELECT subject FROM guard_event ORDER BY subject').map((r) => r.subject)).toEqual(['one', 'two']);
    expect(kernel.getState()).toBe('running');
  });
});
