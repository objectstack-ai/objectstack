// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34800] A seed dataset whose composite `externalId` includes a reference the
 * first load must leave empty — the person it names has not signed up yet —
 * holds ONE row across boots, and the reference lands on that row once the
 * person exists.
 *
 * ## Why a real engine and a real driver over one file
 *
 * The defect is about what the database STORES: the row lands with the key's
 * reference column NULL, and every later boot compared its key against that
 * stored row. So this file runs the real `SeedLoaderService` behind a real
 * `ObjectQL`, over a real `SqlDriver` on one better-sqlite3 FILE, and each boot
 * is a new engine, driver and loader over it — a restart, which is also what
 * drops the person references a loader holds in memory. Measured on main
 * before the fix with exactly these boots: 1 → 2 → 3 rows while the person
 * never appears, 1 → 2 → 2 when the person appears after the first boot, on
 * both paths below. The loader-level cases, controls included, live in
 * `packages/metadata-protocol/src/seed-loader-deferred-key-reference.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSeedLandedKey } from '@objectstack/platform-objects';
import { SeedLoaderRequestSchema, type EngineQueryOptions } from '@objectstack/spec/data';

const ORG = 'org_dkr34800realdrv';

const PERSON = { name: 'dkr_person', label: 'Person', fields: { name: { type: 'text' } } };
const TASK = {
  name: 'dkr_task',
  label: 'Task',
  fields: {
    name: { type: 'text' },
    assignee: { type: 'lookup', reference: 'dkr_person' },
    notes: { type: 'text' },
  },
};

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) {
    try { await cleanups.pop()!(); } catch { /* already closed */ }
  }
});

function metadataFor(objects: any[]) {
  const byName = new Map(objects.map((o) => [o.name, o]));
  return {
    getObject: vi.fn(async (name: string) => byName.get(name)),
    listObjects: vi.fn(async () => objects),
    getObjects: vi.fn(async () => objects),
    get: vi.fn(async (_t: string, n: string) => byName.get(n)),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
    register: vi.fn(async () => {}),
    unregister: vi.fn(async () => {}),
  } as any;
}

const SYSTEM: EngineQueryOptions = { context: { isSystem: true } };

/**
 * Three boots over one database file. Before boot `signUpBefore` (when given)
 * the person the seed names is created, as a sign-up between restarts would.
 */
async function bootThreeTimes(opts: { mode: 'ignore' | 'upsert'; ledger: boolean; signUpBefore?: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'os-34800-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const objects: any[] = opts.ledger ? [PERSON, TASK, SysSeedLandedKey] : [PERSON, TASK];
  const seeds = [{
    object: 'dkr_task',
    mode: opts.mode,
    externalId: ['name', 'assignee'],
    records: [{ name: 'Onboard', assignee: 'Alice', notes: 'first week' }],
  }];
  const counts: number[] = [];
  let rows: any[] = [];
  for (let boot = 1; boot <= 3; boot++) {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of objects) engine.registry.registerObject(o, 'com.objectstack.test.34800');
    await driver.initObjects(objects.map((o) => engine.registry.getObject(o.name) ?? o) as any);
    try {
      if (boot === opts.signUpBefore) {
        await engine.insert('dkr_person', { name: 'Alice', organization_id: ORG }, SYSTEM as any);
      }
      const loader = new SeedLoaderService(
        engine as never,
        metadataFor(objects),
        { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        opts.ledger ? { landedKeys: 'honour' } : {},
      );
      await loader.load(SeedLoaderRequestSchema.parse({ seeds, config: { multiPass: true, organizationId: ORG } }) as never);
      rows = (await engine.find('dkr_task', SYSTEM)) as any[];
      counts.push(rows.length);
      if (boot === 3) {
        const people = (await engine.find('dkr_person', SYSTEM)) as any[];
        return { counts, rows, aliceId: people[0]?.id as string | undefined };
      }
    } finally {
      await engine.destroy();
      await driver.disconnect();
    }
  }
  throw new Error('unreachable');
}

describe('seed: a composite key over a reference empty on the first boot (sqlite-file, #34800)', () => {
  it('per-organization replay with the landed-key record: the person never appears, one row across three boots', async () => {
    const { counts, rows } = await bootThreeTimes({ mode: 'ignore', ledger: true });

    expect(counts).toEqual([1, 1, 1]);
    expect(rows[0]).toMatchObject({ name: 'Onboard', assignee: null, organization_id: ORG });
  });

  it('no landed-key record, upsert: the person appears after the first boot, the reference lands on the row first landed', async () => {
    const { counts, rows, aliceId } = await bootThreeTimes({ mode: 'upsert', ledger: false, signUpBefore: 2 });

    expect(counts).toEqual([1, 1, 1]);
    expect(aliceId).toBeTruthy();
    expect(rows[0]).toMatchObject({ name: 'Onboard', assignee: aliceId });
  });
});
