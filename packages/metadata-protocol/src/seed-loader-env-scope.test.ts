// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

/**
 * `Seed.env` is ENFORCED, not merely authorable (framework#4704).
 *
 * The key was authorable, defaulted and type-checked for releases while being
 * completely inert: `filterByEnv` gated on the LOADER CONFIG's env, and none of
 * the six call sites that build a `SeedLoaderRequest` (app boot, per-org
 * replay, hot reload, package apply, draft publish, marketplace install) ever
 * passed one — so `config.env` was always `undefined`, the filter
 * short-circuited, and `dataset.env` was never read. A dataset marked
 * `env: ['dev']` seeded into production exactly as if it were marked
 * `['prod']` — and the rows most likely to carry that marking are demo users,
 * fake customers and seeded credentials.
 *
 * The loader now resolves the environment itself, from NODE_ENV — the repo's
 * one established environment source (`os start` defaults it to `production`,
 * `os dev` sets `development`, vitest sets `test`).
 *
 * These tests pin the three outcomes SEPARATELY, because a fix that only
 * proved the first would be indistinguishable from one that dropped every
 * dataset, or from one that dropped none:
 *   1. scoped dataset + matching environment      → seeded
 *   2. scoped dataset + non-matching environment  → NOT seeded
 *   3. unscoped dataset (schema default)          → seeded everywhere
 *   4. environment indeterminate                  → seeded, but LOUDLY
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createEngine() {
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
    findOne: vi.fn(async () => null),
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
    update: vi.fn(async (_o: string, data: any) => data),
    delete: vi.fn(async () => ({ deleted: 1 })),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store };
}

function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    account: { name: 'account', fields: { name: { type: 'text' } } },
    demo_user: { name: 'demo_user', fields: { name: { type: 'text' } } },
  };
  return {
    getObject: vi.fn(async (name: string) => objects[name]),
    listObjects: vi.fn(async () => Object.values(objects)),
    register: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

const BASE_CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

/** A production-safe dataset (schema default: every environment). */
const ACCOUNT_DATASET = {
  object: 'account',
  externalId: 'name',
  mode: 'upsert',
  env: ['prod', 'dev', 'test'],
  records: [{ name: 'Acme Corporation' }],
};

/** The dangerous kind: demo rows the author scoped to development only. */
const DEMO_DATASET = {
  object: 'demo_user',
  externalId: 'name',
  mode: 'upsert',
  env: ['dev'],
  records: [{ name: 'Demo Person' }],
};

async function seedUnder(nodeEnv: string | undefined, seeds: any[], configOverrides: any = {}) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;

  const { engine, store } = createEngine();
  const logger = createLogger();
  const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
    seeds,
    config: { ...BASE_CONFIG, ...configOverrides },
  } as any);

  return { result, store, logger };
}

const seededObjects = (store: Record<string, any[]>) => Object.keys(store).sort();

describe('Seed.env is enforced against the runtime environment (#4704)', () => {
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  // ── 1. The regression itself ────────────────────────────────────────────

  it('does NOT seed an env:[dev] dataset under NODE_ENV=production', async () => {
    const { result, store } = await seedUnder('production', [ACCOUNT_DATASET, DEMO_DATASET]);

    expect(seededObjects(store)).toEqual(['account']);
    expect(store.demo_user).toBeUndefined();
    expect(result.summary.objectsProcessed).toBe(1);
    expect(result.summary.totalInserted).toBe(1);
  });

  it('DOES seed the same env:[dev] dataset under NODE_ENV=development', async () => {
    const { result, store } = await seedUnder('development', [ACCOUNT_DATASET, DEMO_DATASET]);

    expect(seededObjects(store)).toEqual(['account', 'demo_user']);
    expect(store.demo_user).toHaveLength(1);
    expect(result.summary.objectsProcessed).toBe(2);
    expect(result.summary.totalInserted).toBe(2);
  });

  // The two above must DIFFER — a fix that dropped everything, or nothing,
  // would satisfy one of them alone.
  it('produces a different result in production than in development', async () => {
    const prod = await seedUnder('production', [ACCOUNT_DATASET, DEMO_DATASET]);
    const dev = await seedUnder('development', [ACCOUNT_DATASET, DEMO_DATASET]);

    expect(seededObjects(prod.store)).not.toEqual(seededObjects(dev.store));
    expect(prod.result.summary.totalInserted).toBeLessThan(dev.result.summary.totalInserted);
  });

  // ── 2. Unscoped datasets are untouched (no behaviour change) ────────────

  it('seeds a dataset carrying the schema default in EVERY environment', async () => {
    for (const nodeEnv of ['production', 'development', 'test']) {
      const { store } = await seedUnder(nodeEnv, [ACCOUNT_DATASET]);
      expect(store.account, `account should seed under NODE_ENV=${nodeEnv}`).toHaveLength(1);
    }
  });

  it('treats a dataset with no env key at all as unrestricted (schema default)', async () => {
    const noEnv = { object: 'account', externalId: 'name', mode: 'upsert', records: [{ name: 'Acme Corporation' }] };
    const { store } = await seedUnder('production', [noEnv]);

    expect(store.account).toHaveLength(1);
  });

  it('honours a multi-environment scope that includes the running environment', async () => {
    const prodAndTest = { ...DEMO_DATASET, env: ['prod', 'test'] };
    const underProd = await seedUnder('production', [prodAndTest]);
    const underDev = await seedUnder('development', [prodAndTest]);

    expect(underProd.store.demo_user).toHaveLength(1);
    expect(underDev.store.demo_user).toBeUndefined();
  });

  // ── 3. Indeterminate environment: permissive, but loud ──────────────────

  it('seeds everything BUT warns loudly when NODE_ENV is unset', async () => {
    const { store, logger } = await seedUnder(undefined, [ACCOUNT_DATASET, DEMO_DATASET]);

    // Permissive: pre-fix behaviour preserved, no deployment silently loses rows.
    expect(seededObjects(store)).toEqual(['account', 'demo_user']);

    // Loud: names the datasets AND the remedy.
    const warning = logger.warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('Cannot determine the runtime environment'));
    expect(warning).toBeDefined();
    expect(warning).toContain('demo_user');
    expect(warning).toContain('NODE_ENV');
    expect(warning).toContain('config.env');
    // The unscoped dataset is not the operator's problem — don't name it.
    expect(warning).not.toContain('account (env:');
  });

  it('warns the same way for a NODE_ENV that names no seed environment', async () => {
    const { store, logger } = await seedUnder('staging', [DEMO_DATASET]);

    expect(store.demo_user).toHaveLength(1);
    expect(
      logger.warn.mock.calls.some((c) => String(c[0]).includes('Cannot determine the runtime environment')),
    ).toBe(true);
  });

  it('stays SILENT when the environment is indeterminate but nothing is scoped', async () => {
    const { store, logger } = await seedUnder(undefined, [ACCOUNT_DATASET]);

    expect(store.account).toHaveLength(1);
    expect(
      logger.warn.mock.calls.some((c) => String(c[0]).includes('Cannot determine the runtime environment')),
    ).toBe(false);
  });

  // The three indeterminate/determinate outcomes must be mutually distinguishable.
  it('distinguishes filtered, permissive-and-warned, and clean loads', async () => {
    const filtered = await seedUnder('production', [ACCOUNT_DATASET, DEMO_DATASET]);
    const permissive = await seedUnder(undefined, [ACCOUNT_DATASET, DEMO_DATASET]);
    const clean = await seedUnder('production', [ACCOUNT_DATASET]);

    const warned = (l: any) =>
      l.warn.mock.calls.some((c: any[]) => String(c[0]).includes('Cannot determine the runtime environment'));

    expect([seededObjects(filtered.store), warned(filtered.logger)]).toEqual([['account'], false]);
    expect([seededObjects(permissive.store), warned(permissive.logger)]).toEqual([['account', 'demo_user'], true]);
    expect([seededObjects(clean.store), warned(clean.logger)]).toEqual([['account'], false]);
  });

  // ── 4. Explicit config.env still wins ───────────────────────────────────

  it('lets an explicit config.env override NODE_ENV', async () => {
    // Host says "seed as production" while running under a dev NODE_ENV.
    const { store } = await seedUnder('development', [ACCOUNT_DATASET, DEMO_DATASET], { env: 'prod' });

    expect(seededObjects(store)).toEqual(['account']);
  });

  it('accepts the seed-enum spellings of NODE_ENV', async () => {
    const { store } = await seedUnder('prod', [ACCOUNT_DATASET, DEMO_DATASET]);
    expect(seededObjects(store)).toEqual(['account']);

    const dev = await seedUnder('DEV', [ACCOUNT_DATASET, DEMO_DATASET]);
    expect(seededObjects(dev.store)).toEqual(['account', 'demo_user']);
  });

  // ── 5. Skipping is reported, never mysterious ───────────────────────────

  it('names every skipped dataset so missing demo rows are one log line to explain', async () => {
    const { logger } = await seedUnder('production', [ACCOUNT_DATASET, DEMO_DATASET]);

    const info = logger.info.mock.calls.map((c) => String(c[0])).find((m) => m.includes('skipped'));
    expect(info).toBeDefined();
    expect(info).toContain('demo_user');
    expect(info).toContain("'prod'");
  });
});
