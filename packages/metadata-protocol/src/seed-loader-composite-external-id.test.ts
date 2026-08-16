// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

/**
 * Composite externalId (framework#3434).
 *
 * A join / junction table has no single-field natural key — the PAIR of its
 * foreign keys is what's unique. Before composite externalId support, such a
 * dataset could only run `mode: 'insert'`, which re-inserts every row on each
 * replay boot and duplicates the table (the showcase memberships went 3→6→9).
 *
 * A composite `externalId: ['team', 'project']` + `mode: 'ignore'` dedupes the
 * rows across restarts, matching on the RESOLVED parent ids (a reference key
 * field is compared by the id it resolved to, which the existing DB row already
 * stores).
 *
 * Uses a faithful engine (filters `where`, mints ids) — the seed-loader.test.ts
 * mock ignores `where` and returns the whole table, which would mask replay
 * behavior. Mirrors the createFaithfulEngine helper in seed-loader-replay.test.ts.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createFaithfulEngine(): { engine: IDataEngine; store: Record<string, any[]> } {
  const store: Record<string, any[]> = {};
  let idCounter = 0;

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let records = store[objectName] || [];
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }),
        );
      }
      if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
      return records;
    }),
    findOne: vi.fn(async (objectName: string, query?: any) => {
      const rows = await (engine.find as any)(objectName, { ...query, limit: 1 });
      return rows[0] ?? null;
    }),
    insert: vi.fn(async (objectName: string, data: any) => {
      if (!store[objectName]) store[objectName] = [];
      if (Array.isArray(data)) {
        const records = data.map((d) => ({ id: `gen-${++idCounter}`, ...d }));
        store[objectName].push(...records);
        return records;
      }
      const record = { id: `gen-${++idCounter}`, ...data };
      store[objectName].push(record);
      return record;
    }),
    update: vi.fn(async (objectName: string, data: any) => {
      assertEngineUpdateDispatch(data, undefined);
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }
      return data;
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store };
}

function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    demo_team: { name: 'demo_team', fields: { name: { type: 'text' } } },
    demo_project: { name: 'demo_project', fields: { name: { type: 'text' } } },
    // The join row: two required master_detail foreign keys, no single natural key.
    demo_membership: {
      name: 'demo_membership',
      fields: {
        team: { type: 'master_detail', reference: 'demo_team', required: true },
        project: { type: 'master_detail', reference: 'demo_project', required: true },
        engagement: { type: 'text' },
      },
    },
  };
  return {
    getObject: vi.fn(async (name: string) => objects[name]),
    listObjects: vi.fn(async () => Object.values(objects)),
    register: vi.fn(async () => {}),
    get: vi.fn(async (_t: string, name: string) => objects[name]),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

// Mirrors the AppPlugin inline-seed config (defaultMode upsert, multiPass on).
const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

// Mirrors the showcase fixture: two teams, two projects, and three memberships
// keyed by the (team, project) pair. Two rows share team 'Platform' and two
// share project 'Website Relaunch', so NEITHER foreign key is unique alone —
// only the pair is.
const SEEDS = [
  {
    object: 'demo_team', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'],
    records: [{ name: 'Experience' }, { name: 'Platform' }],
  },
  {
    object: 'demo_project', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'],
    records: [{ name: 'Website Relaunch' }, { name: 'Data Platform' }],
  },
  {
    object: 'demo_membership', externalId: ['team', 'project'], mode: 'ignore', env: ['prod', 'dev', 'test'],
    records: [
      { team: 'Experience', project: 'Website Relaunch', engagement: 'owner' },
      { team: 'Platform', project: 'Data Platform', engagement: 'owner' },
      { team: 'Platform', project: 'Website Relaunch', engagement: 'contributor' },
    ],
  },
] as any[];

describe('seed composite externalId — join-table dedupe on replay (#3434)', () => {
  it('inserts each (team, project) pair once and skips them all on replay (no 3→6→9)', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    // Boot #1 — fresh DB: all three pairs are new, all insert.
    const first = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    expect(first.success).toBe(true);
    expect(store.demo_membership).toHaveLength(3);
    expect(first.results.find((r) => r.object === 'demo_membership')!.inserted).toBe(3);

    // Foreign keys land as RESOLVED parent ids (not the raw natural-key strings).
    const teamId = (name: string) => store.demo_team.find((t) => t.name === name)!.id;
    const projectId = (name: string) => store.demo_project.find((p) => p.name === name)!.id;
    expect(store.demo_membership.map((m) => `${m.team}|${m.project}`).sort()).toEqual(
      [
        `${teamId('Experience')}|${projectId('Website Relaunch')}`,
        `${teamId('Platform')}|${projectId('Data Platform')}`,
        `${teamId('Platform')}|${projectId('Website Relaunch')}`,
      ].sort(),
    );

    // Boot #2 (dev-server restart): the composite key matches the existing rows
    // by resolved id, so all three skip — the table stays at 3, not 6.
    const second = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    expect(second.success).toBe(true);
    expect(store.demo_membership).toHaveLength(3);
    const replay = second.results.find((r) => r.object === 'demo_membership')!;
    expect(replay.inserted).toBe(0);
    expect(replay.skipped).toBe(3);

    // Boot #3 — still 3 (the historical bug grew the table on every boot).
    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    expect(store.demo_membership).toHaveLength(3);
  });

  it('distinguishes pairs: a genuinely new (team, project) still inserts, sharing rows do not block it', async () => {
    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata();

    await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: SEEDS, config: CONFIG });
    expect(store.demo_membership).toHaveLength(3);

    // A 4th membership reusing an EXISTING team and an EXISTING project, but a
    // NEW pairing (Experience × Data Platform). Composite dedupe keys on the
    // full pair, so this must insert — not skip because the team or the project
    // already appears in some other row.
    const grown = structuredClone(SEEDS);
    grown[2].records.push({ team: 'Experience', project: 'Data Platform', engagement: 'reviewer' });

    const res = await new SeedLoaderService(engine, metadata, createLogger()).load({ seeds: grown, config: CONFIG });
    expect(res.success).toBe(true);
    expect(store.demo_membership).toHaveLength(4);
    const membership = res.results.find((r) => r.object === 'demo_membership')!;
    expect(membership.inserted).toBe(1); // only the new pair
    expect(membership.skipped).toBe(3);  // the original three, unchanged
  });
});
