// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10 item 5; ruling record 6269955919, ① A] The boot guard on the
 * Turso REMOTE face (`libsql://`), on a real kernel: the birth marker needs the
 * ledger's store to read as created from empty, and the remote face answers
 * that from what its own schema doors counted
 * (`RemoteTransport.schemaSyncStats`) — so
 *
 *  1. ⭐ R1: a fresh remote database boots, the guard writing its birth marker,
 *     and the next boot over it boots on that marker;
 *  2. ⭐ a remote database an earlier boot created without the guard (an 18.0
 *     pre-release install's: tables present, no marker) is refused, naming the ceremony.
 *
 * The remote transport talks to a SQLite file through `@libsql/client`, the
 * double the driver's own remote-face pins use (`turso-remote-*.test.ts`).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { ObjectKernel } from '@objectstack/core';
import { TursoDriver } from '@objectstack/driver-turso';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { ORGANIZATION_OWNERSHIP_SHAPE_GENERATION } from '@objectstack/spec/system';
import { DriverPlugin } from './driver-plugin.js';
import {
  isOrganizationOwnershipBootRefusal,
  OrganizationOwnershipBootGuardPlugin,
  ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE,
} from './organization-ownership-boot-guard.js';

const MARKER = 'adr-0131-organization-ownership';
const dirs: string[] = [];
const kernels: ObjectKernel[] = [];
const clients: Client[] = [];

function databaseFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-ownership-guard-remote-'));
  dirs.push(dir);
  return join(dir, 'remote.db');
}

function refusalIn(error: unknown): { code?: string; message?: string } | undefined {
  for (let e = error, depth = 0; !!e && typeof e === 'object' && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    if (isOrganizationOwnershipBootRefusal(e)) return e as { code?: string; message?: string };
  }
  return undefined;
}

/** `os serve`'s data spine over a REMOTE Turso database (the transport's file double), the guard composed. */
async function boot(file: string): Promise<{ kernel: ObjectKernel; error: unknown }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  const client = createClient({ url: `file:${file}` });
  clients.push(client);
  await kernel.use(new DriverPlugin(new TursoDriver({ url: 'libsql://ownership-guard.example.turso.io', client })));
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

const markerRows = (file: string): Array<{ verified_at: string | null; details: string }> => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('SELECT verified_at, details FROM sys_migration WHERE id = ?').all(MARKER) as never;
  } finally {
    db.close();
  }
};

afterEach(async () => {
  for (const kernel of kernels.splice(0)) {
    if (kernel.getState() === 'running') await kernel.shutdown();
  }
  for (const client of clients.splice(0)) client.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('[ADR-0131 D10 item 5] the boot guard on the Turso remote face', () => {
  it('⭐ R1: a fresh remote database boots, the guard writing its birth marker; the next boot reads it and boots', async () => {
    const file = databaseFile();
    const first = await boot(file);
    expect(first.error, String((first.error as Error | null)?.message)).toBeNull();
    expect(first.kernel.getState()).toBe('running');
    const [row] = markerRows(file);
    expect(row?.verified_at).toBeTruthy();
    expect(JSON.parse(String(row!.details)).birth).toMatchObject({ shapeGeneration: ORGANIZATION_OWNERSHIP_SHAPE_GENERATION });
    await first.kernel.shutdown();

    const second = await boot(file);
    expect(second.error, String((second.error as Error | null)?.message)).toBeNull();
    expect(markerRows(file)).toHaveLength(1);
  }, 60_000);

  it('⭐ a remote database an earlier boot created without the guard (an 18.0 pre-release install: no marker) is refused, naming the ceremony', async () => {
    const file = databaseFile();
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE sys_migration (id TEXT PRIMARY KEY, last_run_at TEXT, verified_at TEXT, applied_at TEXT, blocking INTEGER)');
    db.close();
    const { kernel, error } = await boot(file);
    const refusal = refusalIn(error);
    expect(refusal?.code, String(error)).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(refusal?.message).toMatch(/^This database carries no organization-ownership marker/);
    expect(kernel.getState()).not.toBe('running');
    expect(markerRows(file)).toEqual([]);
  }, 60_000);
});
