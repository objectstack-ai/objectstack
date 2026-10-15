// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10 item 5; ruling 6163114098, Q3 A] The v18 boot refusal on a
 * REAL kernel: the guard's `kernel:ready` throw must stop `bootstrap()`, which
 * the unit pins beside this file cannot show (they call the hook by hand).
 *
 * The composition is `os serve`'s data spine — the SQL driver over a SQLite
 * file, ObjectQL, the platform objects — plus the guard. Each case seeds the
 * file before the boot, the way a v17 runtime or the ceremony left it:
 *
 *  1. a v17-shape database (a table whose object declares no organization
 *     column still carries a physical `organization_id`) is refused, with the
 *     refusal's code, and the kernel never reaches `running`;
 *  2. the same database with the ceremony's marker verified boots;
 *  3. a fresh database boots.
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
import { DriverPlugin } from './driver-plugin.js';
import {
  isOrganizationOwnershipBootRefusal,
  OrganizationOwnershipBootGuardPlugin,
} from './organization-ownership-boot-guard.js';

const dirs: string[] = [];
const kernels: ObjectKernel[] = [];

function databaseFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-ownership-guard-'));
  dirs.push(dir);
  return join(dir, 'data.db');
}

/**
 * What a v17 runtime left: `sys_migration_journal` (its object declares no
 * organization column, `systemFields.tenant: false`) still carrying the
 * injected one.
 */
function seedV17Shape(file: string, marker?: { verifiedAt: string | null }): void {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE sys_migration_journal (id TEXT PRIMARY KEY, organization_id TEXT)');
  if (marker) {
    db.exec('CREATE TABLE sys_migration (id TEXT PRIMARY KEY, last_run_at TEXT, verified_at TEXT, blocking INTEGER)');
    db.prepare('INSERT INTO sys_migration (id, last_run_at, verified_at, blocking) VALUES (?, ?, ?, ?)')
      .run('adr-0131-organization-ownership', '2026-10-14T00:00:00.000Z', marker.verifiedAt, 0);
  }
  db.close();
}

async function boot(file: string): Promise<{ kernel: ObjectKernel; error: unknown }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  await kernel.use(new DriverPlugin(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
  })));
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new PlatformObjectsPlugin() as never);
  await kernel.use(new OrganizationOwnershipBootGuardPlugin());
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
    expect(isOrganizationOwnershipBootRefusal(error)).toBe(true);
    expect((error as { tables?: string[] }).tables).toEqual(['sys_migration_journal']);
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
    expect(isOrganizationOwnershipBootRefusal(error)).toBe(true);
  });

  it('⭐ a fresh database boots', async () => {
    const { kernel, error } = await boot(databaseFile());
    expect(error).toBeNull();
    expect(kernel.getState()).toBe('running');
  });
});
