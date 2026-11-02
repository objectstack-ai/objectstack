// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A seed replay compares a blank in its STORED form — measured on a REAL
 * `SqlDriver` under a real `ObjectQL`.
 *
 * The engine's write door stores some blanks as `null` (`blankStorageForm`,
 * `@objectstack/core`): any blank on a non-string-typed column (#20308),
 * exactly `''` on an optional unique text column (#29176), and exactly `''` on
 * an optional one-string column on the `$empty` table's `null_only` row
 * (#29277). A seed that writes `''` there lands as `null`, so a replay that
 * compared the seed's `''` with the stored `null` literally read every such
 * row as changed and rewrote it on every boot — the churn `isNoOpReplay`
 * exists to prevent (`updated_at` bump, re-validation, a phantom history
 * edit). The loader now asks the same predicate the door asks.
 *
 * Pinned, one arm per column, each against its own control:
 *
 *  1. A seed `''` on each arm's column lands as `null`, and a replay of the
 *     same seed skips every row (`totalUpdated: 0`).
 *  2. Control: on a plain optional text column the door keeps `''`, so a
 *     stored `null` against a seed `''` is still a change: the row is
 *     rewritten, and stores `''`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';

const ROW = {
  name: 'blank_replay_row',
  fields: {
    name: { type: 'text', required: true },
    qty: { type: 'number' },
    due: { type: 'date' },
    sku: { type: 'text', unique: true },
    stage: { type: 'select', options: [{ value: 'a', label: 'A' }] },
    note: { type: 'text' },
  },
};
const OBJECTS = [ROW];

const ENV = ['prod', 'dev', 'test'];
const SEED_CONFIG = {
  dryRun: false, haltOnError: false, multiPass: true,
  defaultMode: 'upsert', batchSize: 1000, transaction: false,
} as any;
const logger = { info() {}, warn() {}, error() {}, debug() {} };

/** One row per arm, each blank on its own column only. */
const SEED = {
  object: 'blank_replay_row', externalId: 'name', mode: 'upsert', env: ENV,
  records: [
    { name: 'typed-number', qty: '' },
    { name: 'typed-date', due: '' },
    { name: 'unique-text', sku: '' },
    { name: 'one-string', stage: '' },
  ],
};

function metadataFor(objects: any[]) {
  const byName = new Map(objects.map((o) => [o.name, o]));
  return {
    getObject: async (name: string) => byName.get(name),
    listObjects: async () => objects,
    register: async () => {}, get: async (_t: string, n: string) => byName.get(n),
    list: async () => [], unregister: async () => {}, exists: async () => false, listNames: async () => [],
  } as any;
}

describe('a seed replay compares a blank in its stored form, on a REAL SqlDriver', () => {
  let dir: string | null = null;
  let engine: ObjectQL | null = null;
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    expect(noise?.tablesSeen() ?? ['no capture was installed']).toEqual([]);
    noise = null;
  });

  async function boot() {
    dir = mkdtempSync(join(tmpdir(), 'os-seed-blank-replay-'));
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
    const stored = async (name: string) => (await knex('blank_replay_row').where({ name }).first()) as Record<string, unknown>;
    return { loader: new SeedLoaderService(engine as any, metadataFor(OBJECTS), logger), stored };
  }

  it('each blank-as-null arm lands as null, and a replay skips every row', async () => {
    const { loader, stored } = await boot();

    const first = await loader.load({ seeds: [SEED] as any, config: SEED_CONFIG });
    expect(first.errors.map((x: any) => x.message)).toEqual([]);
    expect(first.summary.totalInserted).toBe(4);
    expect((await stored('typed-number')).qty).toBeNull();
    expect((await stored('typed-date')).due).toBeNull();
    expect((await stored('unique-text')).sku).toBeNull();
    expect((await stored('one-string')).stage).toBeNull();

    const replay = await loader.load({ seeds: [SEED] as any, config: SEED_CONFIG });
    expect(replay.errors.map((x: any) => x.message)).toEqual([]);
    expect(replay.summary.totalInserted).toBe(0);
    expect(replay.summary.totalUpdated).toBe(0);
    expect(replay.summary.totalSkipped).toBe(4);
  });

  it("control: a plain text column keeps '', so a stored null against a seed '' is still a change", async () => {
    const { loader, stored } = await boot();
    const seedNull = { ...SEED, records: [{ name: 'plain', note: null }] };
    const seedBlank = { ...SEED, records: [{ name: 'plain', note: '' }] };

    const first = await loader.load({ seeds: [seedNull] as any, config: SEED_CONFIG });
    expect(first.summary.totalInserted).toBe(1);
    expect((await stored('plain')).note).toBeNull();

    const changed = await loader.load({ seeds: [seedBlank] as any, config: SEED_CONFIG });
    expect(changed.errors.map((x: any) => x.message)).toEqual([]);
    expect(changed.summary.totalUpdated).toBe(1);
    expect((await stored('plain')).note).toBe('');
  });
});
