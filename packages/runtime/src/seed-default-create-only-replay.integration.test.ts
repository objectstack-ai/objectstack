// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A seed with no `mode` is create-only (#30081) — measured on a REAL
 * `SqlDriver` under a real `ObjectQL`.
 *
 * A seed is replayed on every single-tenant boot, on every package install or
 * upgrade and on every publish. With the old `upsert` default each replay
 * wrote the shipped value back over a customer's edit to a seeded row, in
 * production too and with no signal (measured on the card before the change,
 * ruling 6631016988, option A). The default is now `ignore`.
 *
 * The request is built the way every replay site builds it after the change:
 * through `SeedLoaderRequestSchema`, with no `defaultMode` of its own. Pinned,
 * for a dataset that declares no mode, across a replay of a NEW seed version:
 *
 *  1. A customer's edit to a seeded row survives the replay.
 *  2. A record the new version adds, missing from the table, is inserted.
 *  3. A row the customer never touched is left as it is — the new version's
 *     value does not reach it and its `updated_at` does not move.
 *
 * Control, same steps with `mode: 'upsert'` declared: the shipped value is
 * written back over the customer's edit and onto the untouched row, whose
 * `updated_at` moves — so (1) and (3) above are the default's doing, not a
 * loader that writes nothing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import { SeedLoaderRequestSchema } from '@objectstack/spec/data';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';

const ROW = {
  name: 'seed_owned_row',
  fields: {
    name: { type: 'text', required: true },
    stage: { type: 'text' },
    amount: { type: 'number' },
  },
};
const OBJECTS = [ROW];
const SYSTEM = { context: { isSystem: true } } as any;
const logger = { info() {}, warn() {}, error() {}, debug() {} };

/** The package's first version, then the upgrade it ships later. */
const V1 = [
  { name: 'edited', stage: 'new', amount: 1 },
  { name: 'untouched', stage: 'new', amount: 2 },
];
const V2 = [
  { name: 'edited', stage: 'shipped-v2', amount: 1 },
  { name: 'untouched', stage: 'new', amount: 20 },
  { name: 'added', stage: 'new', amount: 3 },
];

/** The request every replay site builds: parsed, with no mode of its own. */
function request(records: unknown[], mode?: 'upsert') {
  return SeedLoaderRequestSchema.parse({
    seeds: [{ object: 'seed_owned_row', records, ...(mode ? { mode } : {}) }],
    config: { multiPass: true },
  });
}

function metadataFor(objects: any[]) {
  const byName = new Map(objects.map((o) => [o.name, o]));
  return {
    getObject: async (name: string) => byName.get(name),
    listObjects: async () => objects,
    register: async () => {}, get: async (_t: string, n: string) => byName.get(n),
    list: async () => [], unregister: async () => {}, exists: async () => false, listNames: async () => [],
  } as any;
}

describe('the replay request every site builds (#30081)', () => {
  it('carries the create-only default and no mode of the caller\'s own', () => {
    const parsed = request(V1);
    expect(parsed.seeds[0].mode).toBe('ignore');
    expect(parsed.config.defaultMode).toBe('ignore');
    expect(request(V1, 'upsert').seeds[0].mode).toBe('upsert');
  });
});

describe('a seed with no mode is create-only on replay, on a REAL SqlDriver (#30081)', () => {
  let dir: string | null = null;
  let engine: ObjectQL | null = null;
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    expect(noise?.tablesSeen() ?? ['no capture was installed']).toEqual([]);
    noise = null;
  });

  async function boot() {
    // Only `Date` is faked, so each step stamps a distinct `updated_at`.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T10:00:00.000Z'));
    dir = mkdtempSync(join(tmpdir(), 'os-seed-create-only-'));
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    noise = captureExpectedReadRefusals(['sys_organization']);
    noise.captureDriver(driver);
    await driver.initObjects(OBJECTS);
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of OBJECTS) engine.registry.registerObject(o as any);
    const knex = (driver as any).knex;
    const stored = async (name: string) =>
      (await knex('seed_owned_row').where({ name }).first()) as Record<string, any> | undefined;
    const loader = new SeedLoaderService(engine as any, metadataFor(OBJECTS), logger);

    /** First load, then a customer edit, then the upgrade's replay. */
    async function installEditUpgrade(mode?: 'upsert') {
      const first = await loader.load(request(V1, mode));
      expect(first.errors.map((x: any) => x.message)).toEqual([]);
      expect(first.summary.totalInserted).toBe(2);
      const untouchedBefore = await stored('untouched');

      vi.setSystemTime(new Date('2026-11-04T11:00:00.000Z'));
      const edited = await stored('edited');
      await engine!.update('seed_owned_row', { id: edited!.id, stage: 'customer-edit' }, SYSTEM);
      expect((await stored('edited'))!.stage).toBe('customer-edit');

      vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
      const replay = await loader.load(request(V2, mode));
      expect(replay.errors.map((x: any) => x.message)).toEqual([]);
      return { replay, untouchedBefore: untouchedBefore! };
    }

    return { stored, installEditUpgrade };
  }

  it('a customer edit survives, a missing row is inserted, an untouched row and its updated_at stay put', async () => {
    const { stored, installEditUpgrade } = await boot();
    const { replay, untouchedBefore } = await installEditUpgrade();

    expect(replay.summary.totalInserted).toBe(1);
    expect(replay.summary.totalUpdated).toBe(0);
    expect(replay.summary.totalSkipped).toBe(2);

    // (1) the customer's edit is still there
    expect((await stored('edited'))!.stage).toBe('customer-edit');
    // (2) the record the upgrade added is inserted
    expect(await stored('added')).toMatchObject({ stage: 'new', amount: 3 });
    // (3) the untouched row keeps its first value and its updated_at
    const untouchedAfter = (await stored('untouched'))!;
    expect(untouchedBefore.updated_at).toBeTruthy();
    expect(untouchedAfter.amount).toBe(2);
    expect(untouchedAfter.updated_at).toEqual(untouchedBefore.updated_at);
  });

  it('control: an explicit upsert still writes the shipped value back on replay', async () => {
    const { stored, installEditUpgrade } = await boot();
    const { replay, untouchedBefore } = await installEditUpgrade('upsert');

    expect(replay.summary.totalInserted).toBe(1);
    expect(replay.summary.totalUpdated).toBe(2);

    expect((await stored('edited'))!.stage).toBe('shipped-v2');
    expect(await stored('added')).toMatchObject({ stage: 'new', amount: 3 });
    const untouchedAfter = (await stored('untouched'))!;
    expect(untouchedAfter.amount).toBe(20);
    expect(untouchedAfter.updated_at).not.toEqual(untouchedBefore.updated_at);
  });
});
