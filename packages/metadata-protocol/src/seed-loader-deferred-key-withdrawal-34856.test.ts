// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * [#34856] A seed row that landed while a reference in its `externalId` was
 * still empty — the person it names had not signed up yet — and that a person
 * then deleted stays deleted, as a row whose key was complete at landing does.
 *
 * The record of landed rows (`sys_seed_landed_key`, `landedKeys: 'honour'`)
 * keyed a row by its key as stored, references resolved, and recorded nothing
 * for a key with an empty component. Such a row was therefore never recorded,
 * and the next load, finding neither the row nor a record of it, inserted it
 * again. Measured before the fix with exactly these loads: the deleted row was
 * back on the next load, whether the person was still missing or had signed up
 * since.
 *
 * The row is now recorded under the id derived from its key as AUTHORED (the
 * id it lands with, `seedDeferredKeyRowId`): the one identity a load can
 * compute both while the reference is still empty and after it resolves.
 *
 * Each load runs a fresh loader over the same store, as a restart does. The
 * engine double is the one `seed-loader-deferred-key-reference.test.ts` drives:
 * `where` by equality (an absent column matches `null`), a supplied id kept, a
 * second row under one id refused. A person's delete removes the row from the
 * store directly, as the app's own delete would.
 */

const ORG = 'org_dkw34856test';

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
  dkw_person: { name: 'dkw_person', fields: { name: { type: 'text' } } },
  dkw_task: {
    name: 'dkw_task',
    fields: {
      name: { type: 'text' },
      assignee: { type: 'lookup', reference: 'dkw_person' },
      notes: { type: 'text' },
    },
  },
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
  return { object: 'dkw_task', externalId: ['name', 'assignee'], mode, env: ['prod', 'dev', 'test'], records };
}

/** One load by a fresh loader — a restart. */
async function load(engine: IDataEngine, seeds: any[], landedKeys: 'honour' | 'reseed' = 'honour') {
  return new SeedLoaderService(engine, createMetadata(), createLogger() as never, { landedKeys })
    .load({ seeds, config: CONFIG });
}

function signUp(store: Record<string, any[]>, name: string): string {
  const id = `person-${name.toLowerCase()}`;
  (store.dkw_person ??= []).push({ id, name, organization_id: ORG });
  return id;
}

/** A person deletes the seeded task named `name` in the app. */
function deleteTask(store: Record<string, any[]>, name: string): void {
  const before = store.dkw_task.length;
  store.dkw_task = store.dkw_task.filter((r) => r.name !== name);
  expect(store.dkw_task.length).toBe(before - 1);
}

describe('seed: a row whose key reference was empty at landing stays deleted (#34856)', () => {
  for (const mode of ['ignore', 'upsert'] as const) {
    it(`${mode}: deleted while the person is still missing, it is not inserted again`, async () => {
      const { engine, store } = createEngine();
      const seeds = [taskSeed(mode, [{ name: 'Onboard', assignee: 'Alice', notes: 'first week' }])];

      await load(engine, seeds);
      expect(store.dkw_task).toHaveLength(1);
      deleteTask(store, 'Onboard');
      const second = await load(engine, seeds);
      await load(engine, seeds);

      expect(store.dkw_task).toHaveLength(0);
      expect(second.success).toBe(true);
      expect(second.summary.totalSkipped).toBe(1);
      expect(second.summary.totalInserted).toBe(0);
    });

    it(`${mode}: deleted, then the person signs up, it is still not inserted again`, async () => {
      const { engine, store } = createEngine();
      const seeds = [taskSeed(mode, [{ name: 'Onboard', assignee: 'Alice', notes: 'first week' }])];

      await load(engine, seeds);
      deleteTask(store, 'Onboard');
      signUp(store, 'Alice');
      const second = await load(engine, seeds);
      await load(engine, seeds);

      expect(store.dkw_task).toHaveLength(0);
      expect(second.summary.totalSkipped).toBe(1);
      expect(second.summary.totalInserted).toBe(0);
    });
  }

  it('the row is recorded under the id it landed with, derived from its key as authored', async () => {
    const { engine, store } = createEngine();
    await load(engine, [taskSeed('ignore', [{ name: 'Onboard', assignee: 'Alice' }])]);

    expect(store.dkw_task).toHaveLength(1);
    expect(store.dkw_task[0].id).toMatch(/^seed_/);
    expect(store.sys_seed_landed_key).toEqual([
      expect.objectContaining({ object_name: 'dkw_task', seed_key: JSON.stringify([['id', store.dkw_task[0].id]]) }),
    ]);
  });

  it('CONTROL: a row whose key was complete at landing, deleted, stays deleted as before', async () => {
    const { engine, store } = createEngine();
    signUp(store, 'Alice');
    const seeds = [taskSeed('ignore', [{ name: 'Onboard', assignee: 'Alice' }])];

    await load(engine, seeds);
    expect(store.dkw_task[0].id).toMatch(/^gen-/);
    deleteTask(store, 'Onboard');
    const second = await load(engine, seeds);

    expect(store.dkw_task).toHaveLength(0);
    expect(second.summary.totalSkipped).toBe(1);
  });

  it('CONTROL: a deferred-key row never landed here still lands, beside one a person deleted', async () => {
    const { engine, store } = createEngine();
    await load(engine, [taskSeed('ignore', [{ name: 'Onboard', assignee: 'Alice' }])]);
    deleteTask(store, 'Onboard');

    // An upgrade adds a second record to the seed, its key reference empty too.
    const upgraded = [taskSeed('ignore', [
      { name: 'Onboard', assignee: 'Alice' },
      { name: 'Review', assignee: 'Alice' },
    ])];
    const second = await load(engine, upgraded);
    await load(engine, upgraded);

    expect(store.dkw_task.map((r) => r.name)).toEqual(['Review']);
    expect(second.summary.totalInserted).toBe(1);
    expect(second.summary.totalSkipped).toBe(1);
  });

  it('CONTROL: the deferred-key row a person kept is found again, not withdrawn, and filled once the person signs up', async () => {
    const { engine, store } = createEngine();
    const seeds = [taskSeed('ignore', [{ name: 'Onboard', assignee: 'Alice' }])];

    await load(engine, seeds);
    const firstLanded = store.dkw_task[0].id;
    await load(engine, seeds);
    const alice = signUp(store, 'Alice');
    await load(engine, seeds);

    expect(store.dkw_task).toHaveLength(1);
    expect(store.dkw_task[0]).toMatchObject({ id: firstLanded, assignee: alice });
  });

  it('CONTROL: a deliberate re-seed brings the deleted deferred-key row back', async () => {
    const { engine, store } = createEngine();
    const seeds = [taskSeed('ignore', [{ name: 'Onboard', assignee: 'Alice' }])];

    await load(engine, seeds);
    deleteTask(store, 'Onboard');
    await load(engine, seeds, 'reseed');

    expect(store.dkw_task).toHaveLength(1);
    expect(store.dkw_task[0].name).toBe('Onboard');
    expect(store.dkw_task[0].assignee ?? null).toBeNull();
  });
});
