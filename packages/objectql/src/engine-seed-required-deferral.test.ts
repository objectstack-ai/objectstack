// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

/**
 * Seed deferral vs `required: true` — measured against the REAL engine
 * (#11674, the card's "Second, NOT measured" question).
 *
 * The seed loader defers an unresolvable reference to pass 2 by DELETING the
 * column from the row. The seed-loader suite's engine double does not
 * validate, so it accepts that insert either way and nothing in
 * `packages/metadata-protocol` may claim what a real engine does. This suite
 * closes the question with the real `ObjectQL` engine, whose record validator
 * enforces `required` on insert (ADR-0113; `SEED_OPTIONS.seedReplay` skips
 * only the `state_machine` rule — "All OTHER validation … still runs").
 *
 * Measured answers, each pinned below:
 *
 *  1. REQUIRED id half (`sys_approval_request` / `sys_record_share` /
 *     `sys_share_link` shape): the deferred insert — its required `record_id`
 *     deleted — is REJECTED by required-validation. Loud, counted, the row
 *     never lands, and pass 2 has nothing to write back onto. So #11674's
 *     internal-id write-back does NOT make these three objects
 *     order-independent: their datasets must still seed the target first.
 *  2. Same object, target seeded FIRST: the pointer resolves in pass 1, the
 *     insert carries the real id, the same engine accepts it. This isolates
 *     case 1's rejection to the deferral-deletion, not the object shape, the
 *     pointer pair, or the engine.
 *  3. OPTIONAL id half (`sys_audit_log` shape), keyless dataset, target
 *     seeded after: pass 1 inserts without the column (nothing requires it),
 *     and pass 2 back-fills through the internal id captured at insert time —
 *     #11674's fix, holding end-to-end against the engine that really
 *     validates. This is what makes `sys_audit_log` genuinely
 *     order-independent while its three required-half siblings are not.
 */

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
      return value === cond;
    }
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$in': return Array.isArray(target) && target.includes(value);
        // REFUSE, never silently match — an unsupported operator answered
        // `true` reads as a hit for every row (the where-matcher gate's class).
        default: throw new Error(`fake driver: unsupported operator ${op}`);
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k === '$not') return !matches(row, v);
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported combinator ${k}`);
      return checkOp(row?.[k], v);
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const row of [...s.values()]) {
        if (!matches(row, ast?.where)) continue;
        s.set(row.id, { ...row, ...data, id: row.id });
        count += 1;
      }
      return count;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

/** The loader falls back to `engine.getSchema` when the metadata service has
 *  nothing — the marketplace-install shape. All schemas live in the REAL
 *  engine registry here; the stub only has to answer "not mine". */
function emptyMetadata(): IMetadataService {
  return {
    getObject: async () => undefined,
    listObjects: async () => [],
    register: async () => {},
    get: async () => undefined,
    list: async () => [],
    unregister: async () => {},
    exists: async () => false,
    listNames: async () => [],
  } as unknown as IMetadataService;
}

function silentLogger() {
  const calls: Record<string, unknown[][]> = { info: [], warn: [], error: [], debug: [] };
  return {
    calls,
    info: (...a: unknown[]) => { calls.info.push(a); },
    warn: (...a: unknown[]) => { calls.warn.push(a); },
    error: (...a: unknown[]) => { calls.error.push(a); },
    debug: (...a: unknown[]) => { calls.debug.push(a); },
  } as any;
}

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'insert',
  batchSize: 1000,
  transaction: false,
} as any;

const ENV = ['prod', 'dev', 'test'];

const LEAD_SEED = {
  object: 'rq_lead',
  externalId: 'name',
  mode: 'upsert',
  env: ENV,
  records: [{ name: 'Lisa Thompson' }],
};

describe('seed deferral vs required:true, on the real engine (#11674)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'rq_lead',
      fields: { name: { type: 'text', required: true } },
    } as any, 'test-package');
    // The sys_approval_request / sys_record_share / sys_share_link shape:
    // BOTH halves required, id half a declared pointer pair.
    engine.registry.registerObject({
      name: 'rq_approval',
      fields: {
        process_name: { type: 'text', required: true },
        object_name: { type: 'text', required: true },
        record_id: { type: 'text', required: true, referenceVia: 'object_name' },
        status: { type: 'select', options: [{ value: 'pending' }, { value: 'approved' }] },
      },
    } as any, 'test-package');
    // The sys_audit_log shape: pointer pair declared, id half OPTIONAL.
    engine.registry.registerObject({
      name: 'rq_ledger',
      fields: {
        action: { type: 'text' },
        object_name: { type: 'text' },
        record_id: { type: 'text', referenceVia: 'object_name' },
      },
    } as any, 'test-package');

    // Harness sanity: the declarations the loader reads really survived
    // registry normalization. If either strips, every case below would pass a
    // different (vacuous) scenario — fail here instead, naming the reason.
    const approval = (engine.getSchema('rq_approval') as any)?.fields?.record_id;
    expect(approval?.referenceVia, 'registry dropped referenceVia — cases below would not defer at all').toBe('object_name');
    expect(approval?.required, 'registry dropped required — case 1 would measure nothing').toBe(true);
    expect((engine.getSchema('rq_ledger') as any)?.fields?.record_id?.referenceVia).toBe('object_name');
  });

  const loader = () => new SeedLoaderService(engine as unknown as IDataEngine, emptyMetadata(), silentLogger());

  it('MEASURED: the real engine REJECTS the deferred insert of a required id half — pass-2 write-back cannot save it', async () => {
    // Keyless approval dataset BEFORE its target: the pointer cannot resolve
    // in pass 1, so the loader defers by DELETING required `record_id`.
    const result = await loader().load({
      seeds: [
        { object: 'rq_approval', mode: 'insert', env: ENV, records: [
          { process_name: 'flow:discount', object_name: 'rq_lead', record_id: 'Lisa Thompson', status: 'pending' },
        ] },
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    // The row never landed: required-validation refused the column-less insert.
    expect(storeFor('rq_approval').size).toBe(0);
    expect(result.success).toBe(false);

    // The rejection is the REQUIRED check on the deleted column, reported as
    // this row's write error — not a resolution error and not silence.
    const writeError = result.errors.find(
      (e: any) => /record_id/.test(String(e.message)) && /required/i.test(String(e.message)),
    );
    expect(writeError, 'no write error names the required record_id — the engine did not reject the deferred insert').toBeDefined();

    // The load really did DEFER (this is what deleted the column): pass 2 then
    // resolved the target and reported it had no row to write back onto.
    const approvalResult = result.results.find((r: any) => r.object === 'rq_approval')!;
    expect(approvalResult.referencesDeferred).toBeGreaterThan(0);
    expect(
      result.errors.some((e: any) => String(e.message).includes('Deferred reference dropped')),
    ).toBe(true);

    // The target itself seeded fine — the failure is confined to the deferral.
    expect(storeFor('rq_lead').size).toBe(1);
  });

  it('CONTROL: the same object accepts the same row when the target seeds FIRST — the rejection is the deferral, not the shape', async () => {
    const result = await loader().load({
      seeds: [
        LEAD_SEED,
        { object: 'rq_approval', mode: 'insert', env: ENV, records: [
          { process_name: 'flow:discount', object_name: 'rq_lead', record_id: 'Lisa Thompson', status: 'pending' },
        ] },
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const leadId = [...storeFor('rq_lead').values()][0].id;
    const approval = [...storeFor('rq_approval').values()][0];
    expect(approval.record_id).toBe(leadId);
    expect(approval.process_name).toBe('flow:discount');
  });

  it('MEASURED: an OPTIONAL id half on a KEYLESS dataset heals out-of-order through the real engine (#11674 end-to-end)', async () => {
    const result = await loader().load({
      seeds: [
        { object: 'rq_ledger', mode: 'insert', env: ENV, records: [
          { action: 'read', object_name: 'rq_lead', record_id: 'Lisa Thompson' },
        ] },
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    const leadId = [...storeFor('rq_lead').values()][0].id;
    const ledger = [...storeFor('rq_ledger').values()][0];
    // Healed to the REAL id by the pass-2 back-fill — on an engine that
    // validates every write, with no externalId declared anywhere on the
    // ledger dataset.
    expect(ledger.record_id).toBe(leadId);
    const ledgerResult = result.results.find((r: any) => r.object === 'rq_ledger')!;
    expect(ledgerResult.referencesResolved).toBeGreaterThan(0);
    expect(ledgerResult.referencesDeferred).toBe(0);
    // Never the verbatim natural key.
    expect(ledger.record_id).not.toBe('Lisa Thompson');
  });
});
