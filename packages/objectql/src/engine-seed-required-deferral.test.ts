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
  /**
   * Every line in the ORDER it was emitted, across levels — which is how the
   * author reads a seed run, and the only shape in which "the loader said it
   * BEFORE the engine did" (#11674's B half) is a measurable claim rather than
   * an assertion about two unrelated arrays.
   */
  const lines: Array<{ level: string; message: string }> = [];
  const at = (level: string) => (...a: unknown[]) => {
    calls[level].push(a);
    lines.push({ level, message: String(a[0]) });
  };
  return { calls, lines, info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
}

/** The load-time early signal, isolated from every other line the loader logs. */
const EARLY_SIGNAL = /is `required: true`, but record #/;

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
    // NOT a shape any adopted object has — the boundary of the early signal's
    // predicate. `required` AND `readonly`: required-validation skips readonly
    // fields on insert, so a deferral here is accepted by this very engine.
    engine.registry.registerObject({
      name: 'rq_approval_ro',
      fields: {
        process_name: { type: 'text', required: true },
        object_name: { type: 'text', required: true },
        record_id: { type: 'text', required: true, readonly: true, referenceVia: 'object_name' },
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
    const approvalRo = (engine.getSchema('rq_approval_ro') as any)?.fields?.record_id;
    expect(approvalRo?.required, 'registry dropped required on the readonly variant').toBe(true);
    expect(approvalRo?.readonly, 'registry dropped readonly — the boundary case would measure the ordinary one').toBe(true);
  });

  const loader = (logger: ReturnType<typeof silentLogger> = silentLogger()) =>
    new SeedLoaderService(engine as unknown as IDataEngine, emptyMetadata(), logger as any);

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
  it('EARLY SIGNAL: the loader names the required deferral BEFORE the engine rejects the row (#11674 B)', async () => {
    const logger = silentLogger();
    // Exactly case 1's scenario. The measured failure below is UNCHANGED — the
    // signal moves when the author learns, it does not move the verdict.
    const result = await loader(logger).load({
      seeds: [
        { object: 'rq_approval', mode: 'insert', env: ENV, records: [
          { process_name: 'flow:discount', object_name: 'rq_lead', record_id: 'Lisa Thompson', status: 'pending' },
        ] },
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    // ⛔ ACCEPT SET UNCHANGED: same rejection, same counters, same success.
    expect(storeFor('rq_approval').size).toBe(0);
    expect(result.success).toBe(false);

    const signalAt = logger.lines.findIndex((l) => l.level === 'warn' && EARLY_SIGNAL.test(l.message));
    const rejectionAt = logger.lines.findIndex((l) => l.level === 'error' && /record_id/.test(l.message));
    expect(signalAt, 'the early signal never fired against the real engine').toBeGreaterThanOrEqual(0);
    expect(rejectionAt, 'the engine did not reject — the ordering claim would be vacuous').toBeGreaterThanOrEqual(0);
    // THE claim of this half of the card, measured rather than argued: the
    // loader says it first, on the engine that really does the rejecting.
    expect(signalAt).toBeLessThan(rejectionAt);

    const signal = logger.lines[signalAt].message;
    expect(signal).toContain('rq_approval.record_id is `required: true`');
    expect(signal).toContain('Order the `rq_lead` dataset BEFORE `rq_approval`');
  });

  it('DOES NOT FIRE for the optional id half — the case the write-back really did make order-independent', async () => {
    const logger = silentLogger();
    const result = await loader(logger).load({
      seeds: [
        { object: 'rq_ledger', mode: 'insert', env: ENV, records: [
          { action: 'read', object_name: 'rq_lead', record_id: 'Lisa Thompson' },
        ] },
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    // Same deferral, same order, same engine — only `required` differs, and
    // this one heals. A signal that fired here would be a false alarm on every
    // correctly-authored optional pointer in the repo.
    expect(result.success).toBe(true);
    expect(logger.lines.some((l) => EARLY_SIGNAL.test(l.message))).toBe(false);
  });

  /**
   * ⛔ THE REFUSAL FORK, measured — triage's 2026-08-24 ruling admits a
   * load-time REFUSAL "only on an arm where the pass-1 insert is measured to be
   * rejected by the real engine anyway", and says that any reachable
   * configuration where a refusal would reject a load that succeeds today is a
   * fork on which the refusal arm must NOT ship.
   *
   * The two cases below are that measurement, against the real engine, on the
   * same predicate a refusal would have to key on ("this dataset defers a
   * reference on a `required` column"). Both SUCCEED today. They are pinned
   * because they are the reason the shipped diagnostic is warn-only, and
   * because they are exactly the boundary the warning's predicate must keep
   * honouring — the same fixtures answer both questions.
   */
  it('REFUSAL FORK 1: a required deferral on the UPDATE arm succeeds today — an omitted column is not a cleared one', async () => {
    // Round 1: the row exists, seeded in the correct order.
    await loader().load({
      seeds: [
        LEAD_SEED,
        { object: 'rq_approval', externalId: 'process_name', mode: 'upsert', env: ENV, records: [
          { process_name: 'flow:discount', object_name: 'rq_lead', record_id: 'Lisa Thompson', status: 'pending' },
        ] },
      ] as any,
      config: CONFIG,
    });
    expect(storeFor('rq_approval').size, 'round 1 did not seed — round 2 would measure an insert').toBe(1);

    // Round 2 — the dev-server-restart shape: the same row is replayed, now
    // pointing at a lead THIS load seeds later. The pointer cannot resolve in
    // pass 1, so the loader defers by deleting required `record_id` — the
    // identical predicate case 1 fails on.
    const logger = silentLogger();
    const result = await loader(logger).load({
      seeds: [
        { object: 'rq_approval', externalId: 'process_name', mode: 'upsert', env: ENV, records: [
          { process_name: 'flow:discount', object_name: 'rq_lead', record_id: 'Marco Diaz', status: 'approved' },
        ] },
        { object: 'rq_lead', externalId: 'name', mode: 'upsert', env: ENV, records: [{ name: 'Marco Diaz' }] },
      ] as any,
      config: CONFIG,
    });

    // MEASURED: it SUCCEEDS. Update-mode validation checks only the fields the
    // write supplies, and the deferral removed the key rather than nulling it
    // — so the required check never runs, and pass 2 back-fills the resolved
    // id afterwards. A load-time refusal keyed on the deferral would have
    // rejected this load. ⇒ refusal arm not shipped.
    expect(result.success).toBe(true);
    const marcoId = [...storeFor('rq_lead').values()].find((r) => r.name === 'Marco Diaz')!.id;
    expect([...storeFor('rq_approval').values()][0].record_id).toBe(marcoId);
    // …and the warning correctly stays silent here, for the same reason.
    expect(logger.lines.some((l) => EARLY_SIGNAL.test(l.message))).toBe(false);
  });

  it('REFUSAL FORK 2: a required READONLY column deferring on INSERT is accepted today — required-validation skips it', async () => {
    const logger = silentLogger();
    const result = await loader(logger).load({
      seeds: [
        { object: 'rq_approval_ro', mode: 'insert', env: ENV, records: [
          { process_name: 'flow:discount', object_name: 'rq_lead', record_id: 'Lisa Thompson' },
        ] },
        LEAD_SEED,
      ] as any,
      config: CONFIG,
    });

    // MEASURED: the row LANDS. Same deferral, same `required: true`, same
    // engine as case 1 — the only difference is `readonly`, which
    // required-validation skips on insert. A load-time refusal keyed on
    // `required` alone would have rejected a row this engine accepts.
    expect(storeFor('rq_approval_ro').size, 'the deferred insert was rejected — the fork claim would be wrong').toBe(1);
    expect(result.success).toBe(true);
    // The warning's predicate MIRRORS the contract's rather than approximating
    // it, so it stays silent here too. If this ever flips, the predicate and
    // the write contract have drifted apart.
    expect(logger.lines.some((l) => EARLY_SIGNAL.test(l.message))).toBe(false);
  });
});
