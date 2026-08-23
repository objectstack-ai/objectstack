// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

/**
 * Declared pointer-pair resolution — #11339 (ADR-0052 §5, the ActivityPointer
 * model).
 *
 * `sys_activity.record_id` is a plain `text` column whose value is a record id
 * of the object the sibling `object_name` column names. Before #11339 the seed
 * loader resolved natural keys only for `lookup`/`master_detail`/`user`
 * fields, so a packaged app's activity seed loaded "successfully" while
 * storing the literal natural key — rows that attach to nothing: the shipped
 * console timeline filters on `{ object_name, record_id }` with the target's
 * REAL id and finds zero rows (measured downstream in
 * objectstack-ai/hotcrm#1258).
 *
 * The fix is a declared carrier: a `text` field carrying
 * `referenceVia: '<sibling>'` derives a per-ROW reference whose target object
 * is read from the sibling column, and flows through the SAME resolution
 * machinery as static references — same probes, same deferral, same loud
 * refusal. These tests pin both halves of the contract change:
 *  - the ACCEPT half: natural keys now resolve to internal ids (per row,
 *    in-memory and DB probes, pass-2 deferral for order independence);
 *  - the REFUSE half: an unresolvable or un-addressable pointer is a loud,
 *    counted failure — never the silently stored literal it used to be.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** Same faithful engine shape as seed-loader-engine-schema-fallback.test.ts:
 *  where-filtering find, id-dispatch-asserting update/delete, and a
 *  `getSchema` backed by the schema map (the ObjectQL registry stand-in). */
function createFaithfulEngine(schemas: Record<string, any>) {
  const store: Record<string, any[]> = {};
  let idCounter = 0;

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let records = store[objectName] || [];
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return r[k] === v;
          }),
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
    getSchema: vi.fn((objectName: string) => schemas[objectName]),
  } as unknown as IDataEngine & { getSchema: ReturnType<typeof vi.fn> };

  return { engine, store };
}

/** Objects known only to the engine registry — the marketplace-install path
 *  the downstream measurement ran on (metadata service knows nothing). */
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

/** The measured shape: a business target plus the sys_activity pointer pairs
 *  exactly as plugin-audit declares them after #11339. */
const SCHEMAS: Record<string, any> = {
  crm_lead: {
    name: 'crm_lead',
    fields: {
      name: { type: 'text', required: true },
      status: { type: 'text' },
    },
  },
  sys_activity: {
    name: 'sys_activity',
    fields: {
      type: { type: 'select' },
      summary: { type: 'text', required: true },
      object_name: { type: 'text' },
      record_id: { type: 'text', referenceVia: 'object_name' },
      record_label: { type: 'text' },
      source_object: { type: 'text' },
      source_id: { type: 'text', referenceVia: 'source_object' },
    },
  },
  // The counter-example: same column names, NO declaration — the loader must
  // keep treating these as plain text (stored verbatim), because resolving
  // undeclared pairs would rewrite data on every object that happens to share
  // the idiom's spelling.
  sys_audit_like: {
    name: 'sys_audit_like',
    fields: {
      summary: { type: 'text', required: true },
      object_name: { type: 'text' },
      record_id: { type: 'text' },
    },
  },
};

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

const LEAD_SEED = {
  object: 'crm_lead',
  externalId: 'name',
  mode: 'upsert',
  env: ['prod', 'dev', 'test'],
  records: [{ name: 'Lisa Thompson', status: 'qualified' }],
};

function activitySeed(records: Array<Record<string, unknown>>) {
  return {
    object: 'sys_activity',
    externalId: 'summary',
    mode: 'upsert',
    env: ['prod', 'dev', 'test'],
    records,
  };
}

function newService(schemas: Record<string, any> = SCHEMAS) {
  const { engine, store } = createFaithfulEngine(schemas);
  const logger = createLogger();
  const service = new SeedLoaderService(engine, createEmptyMetadata(), logger);
  return { service, engine, store, logger };
}

describe('seed pointer-pair resolution (#11339 — referenceVia)', () => {
  it('resolves record_id through the object object_name names, so the console filter shape matches', async () => {
    const { service, store } = newService();

    const result = await service.load({
      seeds: [
        LEAD_SEED,
        activitySeed([
          { type: 'completed', summary: 'Discovery call', object_name: 'crm_lead', record_id: 'Lisa Thompson' },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const leadId = store.crm_lead.find((r) => r.name === 'Lisa Thompson')!.id;
    // The exact filter the shipped console bundle issues — the downstream
    // measurement's failing read, now the passing one:
    const attached = store.sys_activity.filter(
      (r) => r.object_name === 'crm_lead' && r.record_id === leadId,
    );
    expect(attached).toHaveLength(1);
    // …and the measured failure shape is gone: no row stores the literal key.
    expect(store.sys_activity.filter((r) => r.record_id === 'Lisa Thompson')).toHaveLength(0);
  });

  it('resolves each row against ITS OWN sibling value, and the source pair independently of the regarding pair', async () => {
    const { service, store } = newService({
      ...SCHEMAS,
      crm_case: { name: 'crm_case', fields: { name: { type: 'text', required: true } } },
      sys_email: { name: 'sys_email', fields: { name: { type: 'text', required: true } } },
    });

    const result = await service.load({
      seeds: [
        LEAD_SEED,
        {
          object: 'crm_case',
          externalId: 'name',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'Broken widget' }],
        },
        {
          object: 'sys_email',
          externalId: 'name',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'Re: pricing' }],
        },
        activitySeed([
          // Row 1 points at the lead; its source drills to the email row.
          {
            type: 'completed', summary: 'Email follow-up',
            object_name: 'crm_lead', record_id: 'Lisa Thompson',
            source_object: 'sys_email', source_id: 'Re: pricing',
          },
          // Row 2 points at a DIFFERENT object — per-row targets, one dataset.
          { type: 'created', summary: 'Case opened', object_name: 'crm_case', record_id: 'Broken widget' },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const leadId = store.crm_lead[0].id;
    const caseId = store.crm_case[0].id;
    const emailId = store.sys_email[0].id;
    const row1 = store.sys_activity.find((r) => r.summary === 'Email follow-up')!;
    const row2 = store.sys_activity.find((r) => r.summary === 'Case opened')!;
    expect(row1.record_id).toBe(leadId);
    expect(row1.source_id).toBe(emailId);
    expect(row2.record_id).toBe(caseId);
  });

  it('resolves through the target DATASET\'s declared externalId, like static references do', async () => {
    const { service, store } = newService({
      ...SCHEMAS,
      crm_lead: {
        name: 'crm_lead',
        fields: { name: { type: 'text' }, email: { type: 'text', required: true } },
      },
    });

    const result = await service.load({
      seeds: [
        {
          object: 'crm_lead',
          externalId: 'email',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'Lisa Thompson', email: 'lisa@example.com' }],
        },
        activitySeed([
          { type: 'completed', summary: 'Call', object_name: 'crm_lead', record_id: 'lisa@example.com' },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(store.sys_activity[0].record_id).toBe(store.crm_lead[0].id);
  });

  it('defers to pass 2 when the activity dataset loads before its target — order independence', async () => {
    const { service, store, engine } = newService();

    // sys_activity FIRST: no static dependency edge exists (the target is a
    // per-row fact), so topological order cannot save this — pass 2 must.
    const result = await service.load({
      seeds: [
        activitySeed([
          { type: 'completed', summary: 'Discovery call', object_name: 'crm_lead', record_id: 'Lisa Thompson' },
        ]),
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const leadId = store.crm_lead.find((r) => r.name === 'Lisa Thompson')!.id;
    expect(store.sys_activity[0].record_id).toBe(leadId);
    // It really went through the back-fill write, not through luck of ordering.
    expect((engine.update as any).mock.calls.length).toBeGreaterThan(0);
    const activityResult = result.results.find((r: any) => r.object === 'sys_activity')!;
    expect(activityResult.referencesResolved).toBeGreaterThan(0);
  });

  it('REFUSES an unresolvable pointer loudly instead of storing the literal (the measured silent failure)', async () => {
    const { service, store, logger } = newService();

    const result = await service.load({
      seeds: [
        LEAD_SEED,
        activitySeed([
          { type: 'completed', summary: 'Ghost call', object_name: 'crm_lead', record_id: 'No Such Lead' },
        ]),
      ] as any,
      config: CONFIG,
    });

    // The contract change this card ships: this load can no longer read as a
    // clean success — before #11339 it was `success: true` with the literal
    // stored, at every gate green.
    expect(result.success).toBe(false);
    expect(result.errors.some((e: any) => e.field === 'record_id' && String(e.message).includes('crm_lead'))).toBe(true);
    expect(logger.error).toHaveBeenCalled();
    // Never stored verbatim: the row (written in pass 1, pointer deferred)
    // carries NO record_id rather than the unresolvable literal.
    const row = store.sys_activity.find((r) => r.summary === 'Ghost call')!;
    expect(row.record_id ?? null).toBeNull();
    expect(store.sys_activity.filter((r) => r.record_id === 'No Such Lead')).toHaveLength(0);
  });

  it('REFUSES an un-addressable pointer (id half authored, type half empty) — the record is not seeded', async () => {
    const { service, store, logger } = newService();

    const result = await service.load({
      seeds: [
        activitySeed([
          { type: 'completed', summary: 'Orphan pointer', record_id: 'Lisa Thompson' },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(false);
    const err = result.errors.find((e: any) => e.field === 'record_id');
    expect(err).toBeDefined();
    // The message names the pair field so the author knows the one-line fix.
    expect(String(err!.message)).toContain('object_name');
    expect(logger.error).toHaveBeenCalled();
    expect(store.sys_activity ?? []).toHaveLength(0);
    const activityResult = result.results.find((r: any) => r.object === 'sys_activity')!;
    expect(activityResult.errored).toBe(1);
  });

  it('keeps an internal-id-shaped value verbatim (advanced seeds may wire real ids)', async () => {
    const { service, store } = newService();
    const uuid = '123e4567-e89b-42d3-a456-426614174000';

    const result = await service.load({
      seeds: [
        activitySeed([
          { type: 'completed', summary: 'Wired by id', object_name: 'crm_lead', record_id: uuid },
        ]),
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(store.sys_activity[0].record_id).toBe(uuid);
  });

  it('leaves UNDECLARED pairs alone: same column names without referenceVia still store verbatim', async () => {
    const { service, store } = newService();

    const result = await service.load({
      seeds: [
        {
          object: 'sys_audit_like',
          externalId: 'summary',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ summary: 'Plain text row', object_name: 'crm_lead', record_id: 'Lisa Thompson' }],
        },
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    // Undeclared = untouched: the loader must not invent pointer semantics
    // from column spellings — only the declared carrier opts an object in.
    expect(store.sys_audit_like[0].record_id).toBe('Lisa Thompson');
  });

  it('dry-run reports the would-fail pointer without writing or logging at error', async () => {
    const { service, store, logger } = newService();

    const result = await service.load({
      seeds: [
        activitySeed([
          { type: 'completed', summary: 'Orphan pointer', record_id: 'Lisa Thompson' },
          { type: 'completed', summary: 'Ghost target', object_name: 'crm_lead', record_id: 'No Such Lead' },
        ]),
      ] as any,
      config: { ...CONFIG, dryRun: true },
    });

    // Both defects are visible in the report the caller reads…
    expect(result.errors.filter((e: any) => e.field === 'record_id').length).toBe(2);
    // …and nothing was written or shouted about a simulated outcome (#4997).
    expect(store.sys_activity ?? []).toHaveLength(0);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
