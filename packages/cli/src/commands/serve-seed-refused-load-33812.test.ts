// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppPlugin } from '@objectstack/runtime';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { composeSeedSettledMessage } from '../utils/seed-settled-message.js';
import { printSeedResultAfterBanner } from '../utils/format.js';

/**
 * A boot seed whose load is REFUSED (a `Seed.dependsOn` the loader cannot
 * honour) must read as a failed seed on the two channels built to say so: the
 * banner's `Seeds:` line and the `objectstack:seed-settled` message.
 *
 * A refused load writes no row and answers `success: false` with its refusal
 * in `errors[]` and every row counter at zero. The single-tenant boot seed
 * records its outcome for those channels (`recordSeedOutcome`), and from the
 * counters alone a source that wrote nothing and rejected nothing is dropped
 * from the `Seeds:` line and leaves `ok: true` — a clean-looking boot that
 * seeded nothing. Driven here end to end: AppPlugin's real boot seed and
 * SeedLoaderService over an in-memory engine, then the `seed-summary` service as the
 * CLI reads it, the settled message and the banner line. The control
 * is the same boot with a load that succeeds.
 */

function rowMatches(row: any, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`engine double: unsupported combinator ${k}`);
    if (v !== null && typeof v === 'object') {
      throw new Error(`engine double: unsupported value operator on ${k}: ${JSON.stringify(v)}`);
    }
    return (row[k] ?? null) === (v ?? null);
  });
}

function createEngine() {
  const store: Record<string, any[]> = {};
  let next = 0;
  const engine: any = {
    store,
    async find(object: string, query?: any) {
      let rows = (store[object] ?? []).filter((r) => rowMatches(r, query?.where));
      if (typeof query?.limit === 'number') rows = rows.slice(0, query.limit);
      return rows.map((r) => ({ ...r }));
    },
    async findOne(object: string, query?: any) {
      assertEngineFindOnePredicate(object, query);
      return (await engine.find(object, { ...query, limit: 1 }))[0] ?? null;
    },
    async insert(object: string, data: any) {
      const mint = (d: any) => ({ id: d.id ?? `gen_${++next}`, ...d });
      const rows = Array.isArray(data) ? data.map(mint) : [mint(data)];
      (store[object] ??= []).push(...rows);
      return Array.isArray(data) ? rows.map((r) => ({ ...r })) : { ...rows[0] };
    },
    async update(object: string, data: any, options?: any) {
      assertEngineUpdateDispatch(data, options);
      const row = (store[object] ?? []).find((r) => r.id === data.id);
      if (row) Object.assign(row, data);
      return row ? { ...row } : null;
    },
    async count(object: string, query?: any) {
      return (await engine.find(object, query)).length;
    },
    async aggregate() {
      return [];
    },
  };
  return engine;
}

const OBJECTS: Record<string, any> = {
  crm_case: { name: 'crm_case', fields: { name: { type: 'text' } } },
};

const metadataService = {
  getObject: vi.fn(async (name: string) => OBJECTS[name]),
  listObjects: vi.fn(async () => Object.values(OBJECTS)),
  get: vi.fn(async (_type: string, name: string) => OBJECTS[name]),
  list: vi.fn(async () => []),
  register: vi.fn(async () => {}),
  unregister: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  listNames: vi.fn(async () => []),
};

const bundle = (dataset: Record<string, unknown> = {}) => ({
  id: 'refused_load_app',
  data: [{ object: 'crm_case', externalId: 'name', records: [{ name: 'CASE-1' }, { name: 'CASE-2' }], ...dataset }],
});

/** Boot AppPlugin's inline seed on a context with a real service map; answer the map. */
async function boot(dataset?: Record<string, unknown>) {
  const engine = createEngine();
  const services = new Map<string, unknown>();
  const ctx: any = {
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    registerService: vi.fn((name: string, svc: unknown) => {
      if (services.has(name)) throw new Error(`service '${name}' already registered`);
      services.set(name, svc);
    }),
    getService: vi.fn((name: string) => {
      if (name === 'objectql') return engine;
      if (name === 'metadata') return metadataService;
      return services.get(name);
    }),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
  };
  await new AppPlugin(bundle(dataset) as any).start(ctx);
  // What the CLI reads back after `runtime.start()` (`runtimeSeedSettlementChannels`).
  const recorded = services.get('seed-summary');
  return { engine, summary: Array.isArray(recorded) && recorded.length > 0 ? (recorded as any[]) : undefined };
}

describe('a boot seed refused by dependsOn reads as a failed seed (banner and settled message)', () => {
  const OLD_BUDGET = process.env.OS_INLINE_SEED_BUDGET_MS;
  const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;
  let lines: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.OS_MULTI_ORG_ENABLED;
    process.env.OS_INLINE_SEED_BUDGET_MS = '8000';
    lines = [];
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
  });
  afterEach(() => {
    spy.mockRestore();
    if (OLD_BUDGET === undefined) delete process.env.OS_INLINE_SEED_BUDGET_MS;
    else process.env.OS_INLINE_SEED_BUDGET_MS = OLD_BUDGET;
    if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
  });

  it('the refused load: nothing written, the source is a problem on the Seeds line, and the settled message is not ok', async () => {
    const { engine, summary } = await boot({ dependsOn: ['no_such_object'] });

    expect(engine.store.crm_case ?? []).toHaveLength(0);
    expect(summary).toEqual([expect.objectContaining({ source: 'refused_load_app', inserted: 0 })]);
    expect(summary![0]!.rejected).toBeGreaterThan(0);

    expect(composeSeedSettledMessage(undefined, summary).ok).toBe(false);

    printSeedResultAfterBanner(summary ?? []);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('⚠ Seeds:');
    expect(lines[0]).toContain('refused_load_app');
  });

  it('control: the same boot with a load that succeeds reads ok, with its rows on the Seeds line', async () => {
    const { engine, summary } = await boot();

    expect(engine.store.crm_case).toHaveLength(2);
    expect(summary).toEqual([expect.objectContaining({ source: 'refused_load_app', inserted: 2, rejected: 0 })]);

    expect(composeSeedSettledMessage(undefined, summary).ok).toBe(true);

    printSeedResultAfterBanner(summary ?? []);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('⚠');
    expect(lines[0]).toContain('refused_load_app 2 rows');
  });
});
