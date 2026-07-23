// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

/**
 * Reference-graph fallback to the ENGINE schema registry.
 *
 * Marketplace-installed packages register their objects through the `manifest`
 * service straight into the ObjectQL registry (`ql.registerApp`) — AFTER
 * `bridgeObjectsToMetadataService` ran at boot — so the metadata service never
 * hears about them. `buildDependencyGraph` used to consult ONLY
 * `metadata.getObject()`, leaving the reference graph empty for those objects:
 * every lookup / master_detail seed value was written verbatim (the raw
 * externalId string, e.g. `crm_contact.crm_account = 'Acme Corporation'`)
 * instead of the target record's id. Under `controlled_by_parent` RLS a
 * dangling parent reference makes the whole child object invisible to
 * everyone, platform admins included.
 *
 * These tests pin the fix: when metadata misses, the loader resolves the
 * object definition from the engine's `getSchema()` (feature-detected — the
 * ObjectQL engine exposes it; the IDataEngine contract does not require it).
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** Same faithful engine as seed-loader-replay.test.ts (where-filtering find),
 *  plus a `getSchema` backed by a mutable schema map — the stand-in for the
 *  ObjectQL SchemaRegistry that `registerApp` fills. */
function createFaithfulEngine(schemas: Record<string, any>) {
  const store: Record<string, any[]> = {};
  let idCounter = 0;

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let records = store[objectName] || [];
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => r[k] === v),
        );
      }
      if (typeof query?.limit === 'number') {
        records = records.slice(0, query.limit);
      }
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
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }
      return data;
    }),
    delete: vi.fn(async () => ({ deleted: 1 })),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
    getSchema: vi.fn((objectName: string) => schemas[objectName]),
  } as unknown as IDataEngine & { getSchema: ReturnType<typeof vi.fn> };

  return { engine, store };
}

/** Mirrors the shipped HotCRM template's shape: a master_detail parent keyed
 *  by `name`, a child dataset keyed by `email`, plus a self-referencing
 *  lookup — the exact surfaces the marketplace install corrupted. */
const ENGINE_SCHEMAS: Record<string, any> = {
  crm_account: {
    name: 'crm_account',
    fields: {
      name: { type: 'text', required: true },
      industry: { type: 'text' },
    },
  },
  crm_contact: {
    name: 'crm_contact',
    sharingModel: 'controlled_by_parent',
    fields: {
      last_name: { type: 'text', required: true },
      email: { type: 'text' },
      crm_account: { type: 'master_detail', reference: 'crm_account', required: true },
      reports_to: { type: 'lookup', reference: 'crm_contact' },
    },
  },
  crm_opportunity: {
    name: 'crm_opportunity',
    fields: {
      name: { type: 'text', required: true },
      crm_account: { type: 'lookup', reference: 'crm_account', required: true },
    },
  },
};

/** A metadata service that has never heard of the crm_* objects — the
 *  marketplace-install reality this regression pins. */
function createEmptyMetadata(): IMetadataService {
  return {
    getObject: vi.fn(async () => undefined),
    listObjects: vi.fn(async () => []),
    register: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
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
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

const SEEDS = [
  {
    object: 'crm_account',
    externalId: 'name',
    mode: 'upsert',
    env: ['prod', 'dev', 'test'],
    records: [
      { name: 'Acme Corporation', industry: 'technology' },
      { name: 'Globex Inc', industry: 'manufacturing' },
    ],
  },
  {
    object: 'crm_contact',
    externalId: 'email',
    mode: 'upsert',
    env: ['prod', 'dev', 'test'],
    records: [
      { last_name: 'Smith', email: 'john.smith@acme.example.com', crm_account: 'Acme Corporation' },
      {
        last_name: 'Jones',
        email: 'sarah.jones@acme.example.com',
        crm_account: 'Acme Corporation',
        reports_to: 'john.smith@acme.example.com',
      },
    ],
  },
  {
    object: 'crm_opportunity',
    externalId: 'name',
    mode: 'upsert',
    env: ['prod', 'dev', 'test'],
    records: [{ name: 'Acme Expansion', crm_account: 'Acme Corporation' }],
  },
] as any[];

describe('seed reference graph — engine schema fallback (marketplace objects)', () => {
  it('resolves lookup/master_detail natural keys when objects exist only in the engine registry', async () => {
    const { engine, store } = createFaithfulEngine(ENGINE_SCHEMAS);
    const metadata = createEmptyMetadata();

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalErrored).toBe(0);

    const acmeId = store.crm_account.find((r) => r.name === 'Acme Corporation')!.id;
    const john = store.crm_contact.find((r) => r.email === 'john.smith@acme.example.com')!;
    const sarah = store.crm_contact.find((r) => r.email === 'sarah.jones@acme.example.com')!;
    const opp = store.crm_opportunity.find((r) => r.name === 'Acme Expansion')!;

    // The corruption this pins against: the raw externalId string landing in
    // the reference column. Every reference must be the parent's internal id.
    expect(john.crm_account).toBe(acmeId);
    expect(sarah.crm_account).toBe(acmeId);
    expect(opp.crm_account).toBe(acmeId);
    expect(sarah.reports_to).toBe(john.id);

    // Dependency ordering came from the engine schemas too: parent before child.
    expect(result.dependencyGraph.insertOrder.indexOf('crm_account')).toBeLessThan(
      result.dependencyGraph.insertOrder.indexOf('crm_contact'),
    );
    expect(result.summary.totalReferencesResolved).toBeGreaterThanOrEqual(4);
  });

  it('prefers the metadata service definition when it exists (no engine probe)', async () => {
    const { engine, store } = createFaithfulEngine({});
    const metadata = createEmptyMetadata();
    (metadata.getObject as any).mockImplementation(async (name: string) => ENGINE_SCHEMAS[name]);

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const acmeId = store.crm_account.find((r) => r.name === 'Acme Corporation')!.id;
    expect(store.crm_contact.find((r) => r.email === 'john.smith@acme.example.com')!.crm_account).toBe(acmeId);
    expect((engine as any).getSchema).not.toHaveBeenCalled();
  });

  it('survives an engine without getSchema (contract-minimal engines keep the old behavior)', async () => {
    const { engine, store } = createFaithfulEngine({});
    delete (engine as any).getSchema;
    const metadata = createEmptyMetadata();

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: SEEDS,
      config: CONFIG,
    });

    // No schema source at all → no reference graph; values pass through as
    // before (this documents, not endorses, the legacy degradation).
    expect(result.summary.totalReferencesResolved).toBe(0);
    expect(store.crm_contact.every((r) => r.crm_account === 'Acme Corporation')).toBe(true);
  });
});
