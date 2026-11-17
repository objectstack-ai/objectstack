// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * [#34800] A dataset whose `externalId` includes a reference the first load
 * must leave empty — the person it names has not signed up yet — holds ONE row
 * across loads.
 *
 * The row lands with that key column NULL (the reference is deferred to pass 2
 * and misses there too). Matching existing rows by natural key cannot find it
 * again: while the reference stays unresolvable the record keys empty, and
 * once it resolves the record carries an id the stored row does not. Measured
 * before the fix, three loads over one store: 1 → 2 → 3 rows, and 1 → 2 → 2
 * when the person appears between loads (the copy that finally carried the
 * person sat beside the first one, still NULL). The loader now lands such a
 * row with an id derived from the key as authored, and a replay whose natural
 * key misses finds the row by that id — and fills the reference onto it once
 * it resolves.
 *
 * Each load runs a fresh loader over the same store, as a restart does: the
 * held person references a loader keeps in memory do not survive it.
 *
 * The engine double filters `where` by equality (an absent column matches
 * `null`), keeps an id the write supplies and refuses a second row under one
 * id, as a primary key does, and answers the compare-and-set update form.
 */

const ORG = 'org_dkr34800test';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function rowMatches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported combinator ${k}`);
    if (v !== null && typeof v === 'object') throw new Error(`fake driver: unsupported operator on ${k}`);
    return (row[k] ?? null) === (v ?? null);
  });
}

function createEngine(): { engine: IDataEngine; store: Record<string, any[]> } {
  const store: Record<string, any[]> = {};
  let idCounter = 0;
  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let rows = (store[objectName] ?? []).filter((r) => rowMatches(r, query?.where));
      if (typeof query?.limit === 'number') rows = rows.slice(0, query.limit);
      return rows.map((r) => ({ ...r }));
    }),
    findOne: vi.fn(async (objectName: string, query?: any) => {
      assertEngineFindOnePredicate(objectName, query);
      const rows = await (engine.find as any)(objectName, { ...query, limit: 1 });
      return rows[0] ?? null;
    }),
    insert: vi.fn(async (objectName: string, data: any) => {
      const rows = (store[objectName] ??= []);
      const land = (d: any) => {
        const id = d.id ?? `gen-${++idCounter}`;
        if (rows.some((r) => r.id === id)) throw new Error(`fake driver: duplicate primary key '${id}'`);
        const row = { ...d, id };
        rows.push(row);
        return { ...row };
      };
      return Array.isArray(data) ? data.map(land) : land(data);
    }),
    update: vi.fn(async (objectName: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      const rows = store[objectName] ?? [];
      if (options?.where) {
        let n = 0;
        for (const row of rows) {
          if (!rowMatches(row, options.where)) continue;
          Object.assign(row, data);
          n += 1;
        }
        return n;
      }
      const row = rows.find((r) => r.id === data.id);
      if (!row) return null;
      Object.assign(row, data);
      return { ...row };
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async (objectName: string) => (store[objectName] ?? []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;
  return { engine, store };
}

const OBJECTS: Record<string, any> = {
  dkr_person: { name: 'dkr_person', fields: { name: { type: 'text' } } },
  dkr_task: {
    name: 'dkr_task',
    fields: {
      name: { type: 'text' },
      assignee: { type: 'lookup', reference: 'dkr_person' },
      notes: { type: 'text' },
    },
  },
  dkr_tag: { name: 'dkr_tag', fields: { name: { type: 'text' }, kind: { type: 'text' }, notes: { type: 'text' } } },
  sys_seed_landed_key: {
    name: 'sys_seed_landed_key',
    fields: { object_name: { type: 'text' }, seed_key: { type: 'textarea' } },
  },
};

function createMetadata(): IMetadataService {
  return {
    getObject: vi.fn(async (name: string) => OBJECTS[name]),
    listObjects: vi.fn(async () => Object.values(OBJECTS)),
    register: vi.fn(async () => {}),
    get: vi.fn(async (_t: string, name: string) => OBJECTS[name]),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'ignore',
  batchSize: 1000,
  transaction: false,
  organizationId: ORG,
} as any;

function taskSeed(mode: 'ignore' | 'upsert', records: Array<Record<string, unknown>>) {
  return { object: 'dkr_task', externalId: ['name', 'assignee'], mode, env: ['prod', 'dev', 'test'], records };
}

/** One load by a fresh loader — a restart. */
async function load(engine: IDataEngine, seeds: any[], landedKeys?: 'honour') {
  return new SeedLoaderService(engine, createMetadata(), createLogger() as never, landedKeys ? { landedKeys } : {})
    .load({ seeds, config: CONFIG });
}

function signUp(store: Record<string, any[]>, name: string): string {
  const id = `person-${name.toLowerCase()}`;
  (store.dkr_person ??= []).push({ id, name, organization_id: ORG });
  return id;
}

describe('seed: a key reference empty on the first load holds one row across loads (#34800)', () => {
  for (const mode of ['ignore', 'upsert'] as const) {
    it(`${mode}: three loads while the person never appears leave one row`, async () => {
      const { engine, store } = createEngine();
      const seeds = [taskSeed(mode, [{ name: 'Onboard', assignee: 'Alice', notes: 'first week' }])];

      const counts: number[] = [];
      for (let boot = 0; boot < 3; boot++) {
        await load(engine, seeds);
        counts.push(store.dkr_task.length);
      }

      expect(counts).toEqual([1, 1, 1]);
      expect(store.dkr_task[0].assignee ?? null).toBeNull();
    });

    it(`${mode}: the person appearing between loads fills the reference onto the row first landed`, async () => {
      const { engine, store } = createEngine();
      const seeds = [taskSeed(mode, [{ name: 'Onboard', assignee: 'Alice', notes: 'first week' }])];

      await load(engine, seeds);
      const firstLanded = store.dkr_task[0].id;
      const alice = signUp(store, 'Alice');
      const second = await load(engine, seeds);
      await load(engine, seeds);

      expect(second.success).toBe(true);
      expect(store.dkr_task).toHaveLength(1);
      expect(store.dkr_task[0]).toMatchObject({ id: firstLanded, name: 'Onboard', assignee: alice });
    });
  }

  it('with the landed-key record kept, the row is found too and is not reported as removed', async () => {
    const { engine, store } = createEngine();
    const seeds = [taskSeed('ignore', [{ name: 'Onboard', assignee: 'Alice' }])];

    await load(engine, seeds, 'honour');
    const alice = signUp(store, 'Alice');
    const second = await load(engine, seeds, 'honour');
    await load(engine, seeds, 'honour');

    expect(second.summary.totalSkipped).toBe(1);
    expect(store.dkr_task).toHaveLength(1);
    expect(store.dkr_task[0].assignee).toBe(alice);
  });

  it('two records that differ only in the reference stay two rows, each filled with its own person', async () => {
    const { engine, store } = createEngine();
    const seeds = [taskSeed('ignore', [
      { name: 'Onboard', assignee: 'Alice' },
      { name: 'Onboard', assignee: 'Bob' },
    ])];

    await load(engine, seeds);
    await load(engine, seeds);
    expect(store.dkr_task).toHaveLength(2);
    const [alice, bob] = [signUp(store, 'Alice'), signUp(store, 'Bob')];
    await load(engine, seeds);
    await load(engine, seeds);

    expect(store.dkr_task).toHaveLength(2);
    expect(store.dkr_task.map((r) => r.assignee).sort()).toEqual([alice, bob].sort());
  });

  it('a row a person created with the reference empty is never taken for the seed row', async () => {
    const { engine, store } = createEngine();
    store.dkr_task = [{ id: 'customer-row', name: 'Onboard', assignee: null, notes: 'mine', organization_id: ORG }];
    const seeds = [taskSeed('upsert', [{ name: 'Onboard', assignee: 'Alice', notes: 'seeded' }])];

    await load(engine, seeds);
    const alice = signUp(store, 'Alice');
    await load(engine, seeds);

    expect(store.dkr_task).toHaveLength(2);
    expect(store.dkr_task.find((r) => r.id === 'customer-row')).toEqual(
      { id: 'customer-row', name: 'Onboard', assignee: null, notes: 'mine', organization_id: ORG },
    );
    expect(store.dkr_task.find((r) => r.id !== 'customer-row')).toMatchObject({ assignee: alice, notes: 'seeded' });
  });

  it('CONTROL: a composite key whose reference resolves on the first load is matched as before, engine-minted id', async () => {
    const { engine, store } = createEngine();
    const alice = signUp(store, 'Alice');
    const seeds = [taskSeed('ignore', [{ name: 'Onboard', assignee: 'Alice' }])];

    for (let boot = 0; boot < 3; boot++) await load(engine, seeds);

    expect(store.dkr_task).toHaveLength(1);
    expect(store.dkr_task[0]).toMatchObject({ assignee: alice });
    expect(store.dkr_task[0].id).toMatch(/^gen-/);
  });

  it('CONTROL: a composite key over plain fields is matched as before, engine-minted id', async () => {
    const { engine, store } = createEngine();
    const seeds = [{
      object: 'dkr_tag', externalId: ['name', 'kind'], mode: 'upsert', env: ['prod', 'dev', 'test'],
      records: [{ name: 'Urgent', kind: 'priority' }, { name: 'Urgent', kind: 'label' }],
    }];

    for (let boot = 0; boot < 3; boot++) await load(engine, seeds);

    expect(store.dkr_tag).toHaveLength(2);
    expect(store.dkr_tag.every((r) => /^gen-/.test(r.id))).toBe(true);
  });
});
