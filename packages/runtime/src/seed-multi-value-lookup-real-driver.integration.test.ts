// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-driver regression for multi-value lookup seeds (framework#3911).
//
// A `multiple: true` lookup is stored in a JSON column, so the resolved id
// ARRAY takes a serialize → SQLite TEXT → parse round-trip that an in-memory
// mock driver never performs. That round-trip is exactly what the loader's
// replay comparison reads back on the next boot, so it decides whether a
// seeded association is stable or rewritten (or duplicated) on every restart.
// The unit suite in metadata-protocol proves the resolution; only the real
// SqlDriver can prove the stored shape and the replay.

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

const AUTHOR = {
  name: 'author',
  fields: { name: { type: 'text', required: true } },
};
const BOOK = {
  name: 'book',
  fields: {
    name: { type: 'text', required: true },
    authors: { type: 'lookup', reference: 'author', multiple: true },
    reviewer: { type: 'lookup', reference: 'author' },
  },
};

const SEED_CONFIG = {
  dryRun: false, haltOnError: false, multiPass: true,
  defaultMode: 'upsert', batchSize: 1000, transaction: false,
} as any;
const logger = { info() {}, warn() {}, error() {}, debug() {} };

function metadataFor(objects: any[]) {
  const byName = new Map(objects.map((o) => [o.name, o]));
  return {
    getObject: async (name: string) => byName.get(name),
    listObjects: async () => objects,
    register: async () => {}, get: async (_t: string, n: string) => byName.get(n),
    list: async () => [], unregister: async () => {}, exists: async () => false, listNames: async () => [],
  } as any;
}

/** The issue's minimal repro, verbatim. */
const SEEDS = [
  {
    object: 'author', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'],
    records: [{ name: 'Alice' }, { name: 'Bob' }],
  },
  {
    object: 'book', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'],
    records: [{ name: 'Refactoring', authors: ['Alice', 'Bob'] }],
  },
];

/**
 * [#10629] This fixture provisions the seeded business objects and nothing else, so the engine's
 * own single-tenant probe (`ObjectQL.probeInstallOrganizations`, memoised once
 * per engine) reads a `sys_organization` that was never created. The probe is
 * fail-soft by construction — it catches `isMissingTableError` and only that —
 * but the driver and the engine each log the fault on the way out. Withheld and
 * asserted rather than muted; `expected-read-refusal-noise.ts` says why.
 */
const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('multi-value lookup seeds on a REAL SqlDriver (framework#3911)', () => {
  let dir: string | null = null;
  let engine: ObjectQL | null = null;
  /** [#10629] The expected-noise capture belonging to the latest boot. */
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    // [#10629] The capture is a PIN, not a mute — asserted after teardown so a
    // failure here can never leave the engine running. Every test in this file
    // boots and writes, so the probe fires for each of them: this holds for a
    // single `-t` run as well as for the whole file.
    expect(noise?.silentChannels() ?? ['no capture was installed']).toEqual([]);
    noise = null;
  });

  async function boot(objects: any[]) {
    dir = mkdtempSync(join(tmpdir(), 'os-seed-multi-real-'));
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    // [#10629] Installed before the driver runs a statement and before the
    // engine issues a read — the two sinks the expected refusal travels out on.
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects(objects); // real tables, real JSON column
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of objects) engine.registry.registerObject(o as any);
    return engine;
  }

  it('stores the resolved id ARRAY and reads it back through the JSON column', async () => {
    const e = await boot([AUTHOR, BOOK]);
    const loader = new SeedLoaderService(e as any, metadataFor([AUTHOR, BOOK]), logger);

    const result = await loader.load({ seeds: SEEDS as any, config: SEED_CONFIG });
    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);

    const authors: any[] = await e.find('author', {});
    const alice = authors.find((r) => r.name === 'Alice')!;
    const bob = authors.find((r) => r.name === 'Bob')!;
    const book: any = (await e.find('book', {}))[0];

    // The bug: `authors` was dropped entirely and the row landed without it.
    expect(Array.isArray(book.authors)).toBe(true);
    expect(book.authors).toEqual([alice.id, bob.id]);
  });

  it('replays idempotently — the array survives a second boot with no churn or duplicates', async () => {
    const e = await boot([AUTHOR, BOOK]);
    const loader = new SeedLoaderService(e as any, metadataFor([AUTHOR, BOOK]), logger);

    await loader.load({ seeds: SEEDS as any, config: SEED_CONFIG });
    const first: any = (await e.find('book', {}))[0];

    // Second boot over the same database — the replay path compares the freshly
    // resolved id array against the JSON-parsed stored one.
    const replay = await loader.load({ seeds: SEEDS as any, config: SEED_CONFIG });

    expect(replay.success).toBe(true);
    expect(replay.summary.totalUpdated).toBe(0);   // no updated_at churn
    expect(replay.summary.totalSkipped).toBe(3);   // 2 authors + 1 book
    expect(await e.count('book', {})).toBe(1);     // no duplicate row

    const after: any = (await e.find('book', {}))[0];
    expect(after.id).toBe(first.id);
    expect(after.authors).toEqual(first.authors);
  });

  it('resolves against authors that already exist in the database', async () => {
    const e = await boot([AUTHOR, BOOK]);
    const alice = await e.insert('author', { name: 'Alice' });
    const bob = await e.insert('author', { name: 'Bob' });

    const loader = new SeedLoaderService(e as any, metadataFor([AUTHOR, BOOK]), logger);
    const result = await loader.load({ seeds: [SEEDS[1]] as any, config: SEED_CONFIG });

    expect(result.success).toBe(true);
    const book: any = (await e.find('book', {}))[0];
    expect(book.authors).toEqual([alice.id, bob.id]);
  });
});
