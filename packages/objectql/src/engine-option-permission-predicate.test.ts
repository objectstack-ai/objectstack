// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18783] The ENGINE half of `current_user.can(object, verb)` in an option's
 * `visibleWhen`, driven through the real engine and a real driver.
 *
 * The rule-validator suite hands `permissions` in by hand, which pins the
 * evaluator and nothing about how the map reaches it. Everything below is a
 * call-site fact (PD #10: check the CALL SITE, bulk paths included):
 *
 *  - the map comes from the registered resolver — the security plugin's
 *    `ISecurityService.getEffectiveObjectPermissions` — and a `can` gate is
 *    ENFORCED with it on insert, by-id update, bulk update and `validate()`;
 *  - it is resolved at most ONCE per write (N rows, one resolution), never
 *    kept across writes (a revoked grant is seen on the very next write);
 *  - a write whose gates never call `can` never asks — so it cannot be refused
 *    by a resolution it did not depend on (the ruling's control);
 *  - no resolver ⇒ NO permission data: the gate stays loudly unevaluable and
 *    the value is admitted with the warn naming the missing input — ⛔ not a
 *    denial;
 *  - a resolver that THROWS fails the write CLOSED with its own error, and a
 *    map that is not the published shape is refused the same way.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

import '@objectstack/spec';
import '@objectstack/formula';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      const cond = v as any;
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$in' in cond) return Array.isArray(cond.$in) && cond.$in.includes(row?.[k]);
        if ('$eq' in cond) return row?.[k] === cond.$eq;
      }
      return row?.[k] === cond;
    });
  };
  const writes: Array<{ op: string; object: string; data: any }> = [];
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // Hold the caller's bound (`check:objectql-double-limit`).
      const bounded = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      const fields: string[] | undefined = ast?.fields;
      if (!fields) return bounded;
      return bounded.map((r) => {
        const out: any = {};
        for (const f of fields) if (r[f] !== undefined) out[f] = r[f];
        return out;
      });
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      writes.push({ op: 'create', object, data });
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      writes.push({ op: 'update', object, data });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async updateMany(object: string, _ast: any, data: Record<string, unknown>) {
      writes.push({ op: 'updateMany', object, data });
      return 0;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, writes };
}

/** A logger whose `warn` lines the cases read back; everything else is swallowed. */
function captureLogger() {
  const warns: Array<{ msg: string; meta: any }> = [];
  const noop = () => {};
  const logger: any = {
    debug: noop, info: noop, error: noop, trace: noop, fatal: noop,
    warn: (msg: string, meta?: any) => warns.push({ msg, meta }),
    child: () => logger,
  };
  return { warns, logger };
}

/** A resolver that records every ask. `answer` may change between writes. */
function countingResolver(initial: unknown | ((ctx: unknown) => unknown)) {
  const asks: unknown[] = [];
  let answer = initial;
  const fn = async (ctx: unknown) => {
    asks.push(ctx);
    return typeof answer === 'function' ? (answer as (c: unknown) => unknown)(ctx) : answer;
  };
  return { fn, asks, set: (next: unknown) => { answer = next; } };
}

const ACTING = { userId: 'u1', positions: ['sales_rep'] } as any;
/** The `objects` slot of `/auth/me/permissions` for two subjects. */
const MAY_EDIT = { crm_account: { allowRead: true, allowEdit: true } };
const READ_ONLY = { crm_account: { allowRead: true } };

describe('#18783 — the engine answers `can` in option visibleWhen from the security service', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let log: ReturnType<typeof captureLogger>;

  beforeEach(async () => {
    log = captureLogger();
    engine = new ObjectQL({ logger: log.logger });
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'crm_case',
      fields: {
        subject: { type: 'text' },
        stage: {
          type: 'select',
          options: [
            { value: 'open' },
            // The authored shape the ruling names: gated on the subject's GRANT.
            { value: 'escalated', visibleWhen: "current_user.can('crm_account', 'edit')" },
            // The control: gated, but not on `can`.
            { value: 'vip', visibleWhen: "'vip_desk' in current_user.positions" },
          ],
        },
      },
    } as any, 'test-package');
  });

  const created = () => d.writes.filter((w) => w.op === 'create' && w.object === 'crm_case');

  async function refusal(p: Promise<unknown>): Promise<any> {
    try {
      await p;
    } catch (err) {
      return err;
    }
    throw new Error('expected the write to be refused');
  }

  it('REFUSES a `can`-gated option on insert for a subject whose map withholds the verb', async () => {
    const r = countingResolver(READ_ONLY);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);

    const err = await refusal(engine.insert('crm_case', { subject: 's', stage: 'escalated' }, { context: ACTING } as any));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toEqual([expect.objectContaining({ field: 'stage', code: 'invalid_option' })]);
    expect(created()).toHaveLength(0);
    // Asked with the write's own acting subject.
    expect(r.asks).toHaveLength(1);
    expect(r.asks[0]).toMatchObject({ userId: 'u1' });
  });

  it('ADMITS it for a subject whose map grants the verb', async () => {
    engine.registerEffectiveObjectPermissionsResolver(countingResolver(MAY_EDIT).fn);
    await expect(
      engine.insert('crm_case', { subject: 's', stage: 'escalated' }, { context: ACTING } as any),
    ).resolves.toBeTruthy();
    expect(created()).toHaveLength(1);
    expect(log.warns.filter((w) => /visibleWhen/.test(w.msg))).toHaveLength(0);
  });

  it('control: a write whose gates never call `can` never asks — even a resolver that would THROW', async () => {
    const r = countingResolver(() => { throw new Error('must not be asked'); });
    engine.registerEffectiveObjectPermissionsResolver(r.fn);

    await expect(engine.insert('crm_case', { subject: 's', stage: 'open' }, { context: ACTING } as any)).resolves.toBeTruthy();
    await expect(
      engine.insert('crm_case', { subject: 's', stage: 'vip' }, { context: { userId: 'u2', positions: ['vip_desk'] } } as any),
    ).resolves.toBeTruthy();
    // …and the non-`can` gate is still enforced exactly as before.
    await expect(engine.insert('crm_case', { subject: 's', stage: 'vip' }, { context: ACTING } as any)).rejects.toBeInstanceOf(ValidationError);
    expect(r.asks).toHaveLength(0);
  });

  it('NO resolver ⇒ no permission data: loudly unevaluable and ADMITTED, never a silent denial', async () => {
    await expect(
      engine.insert('crm_case', { subject: 's', stage: 'escalated' }, { context: ACTING } as any),
    ).resolves.toBeTruthy();
    const gate = log.warns.filter((w) => w.meta?.field === 'stage');
    expect(gate).toHaveLength(1);
    expect(gate[0].meta).toMatchObject({ value: 'escalated', reason: 'predicate-fault' });
    expect(gate[0].meta.error.message).toContain('carries no permission data');
  });

  it('a resolver that THROWS fails the write CLOSED with its own error, untouched', async () => {
    const boom = Object.assign(new Error('permission store unreachable'), { code: 'AUTHZ_STORE_UNAVAILABLE', status: 503 });
    engine.registerEffectiveObjectPermissionsResolver(async () => { throw boom; });

    const err = await refusal(engine.insert('crm_case', { subject: 's', stage: 'escalated' }, { context: ACTING } as any));
    expect(err).toBe(boom);
    expect(err.code).toBe('AUTHZ_STORE_UNAVAILABLE');
    expect(err.status).toBe(503);
    // ⛔ Not read as "no grants" — that would be a refusal dressed as a decision.
    expect(err).not.toBeInstanceOf(ValidationError);
    expect(created()).toHaveLength(0);
  });

  it('a map that is not the published shape is refused the same way (formula\'s door)', async () => {
    engine.registerEffectiveObjectPermissionsResolver(async () => ({ crm_account: true }));
    const err = await refusal(engine.insert('crm_case', { subject: 's', stage: 'escalated' }, { context: ACTING } as any));
    expect(err).toBeInstanceOf(TypeError);
    expect(String(err.message)).toContain("the entry for 'crm_account' is not an EffectiveObjectPermission");
    expect(created()).toHaveLength(0);
  });

  it('a system write (no acting user) never asks — `can` would be about nobody', async () => {
    const r = countingResolver(MAY_EDIT);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    await expect(engine.insert('crm_case', { subject: 's', stage: 'escalated' })).resolves.toBeTruthy();
    await expect(
      engine.insert('crm_case', { subject: 's', stage: 'escalated' }, { context: { isSystem: true } } as any),
    ).resolves.toBeTruthy();
    expect(r.asks).toHaveLength(0);
  });

  it('ONE resolution for a batch insert of N rows', async () => {
    const r = countingResolver(MAY_EDIT);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    const rows = Array.from({ length: 7 }, (_, i) => ({ subject: `s${i}`, stage: 'escalated' }));
    await engine.insert('crm_case', rows as any, { context: ACTING } as any);
    expect(created()).toHaveLength(7);
    expect(r.asks).toHaveLength(1);
  });

  for (const N of [1, 25]) {
    it(`ONE resolution for a bulk update across ${N} matched row(s), and the gate holds per row`, async () => {
      for (let i = 0; i < N; i++) d.storeFor('crm_case').set(`c${i}`, { id: `c${i}`, subject: 'bulk', stage: 'open' });

      const granted = countingResolver(MAY_EDIT);
      engine.registerEffectiveObjectPermissionsResolver(granted.fn);
      await engine.update('crm_case', { stage: 'escalated' }, { where: { subject: 'bulk' }, multi: true, context: ACTING } as any);
      expect(d.writes.filter((w) => w.op === 'updateMany')).toHaveLength(1);
      expect(granted.asks).toHaveLength(1);

      const withheld = countingResolver(READ_ONLY);
      engine.registerEffectiveObjectPermissionsResolver(withheld.fn);
      const err = await refusal(
        engine.update('crm_case', { stage: 'escalated' }, { where: { subject: 'bulk' }, multi: true, context: ACTING } as any),
      );
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.fields[0]).toMatchObject({ field: 'stage', code: 'invalid_option' });
      expect(d.writes.filter((w) => w.op === 'updateMany')).toHaveLength(1);
      expect(withheld.asks).toHaveLength(1);
    });
  }

  it('by-id update: the gate is enforced on the PATCH, with one resolution', async () => {
    engine.registerEffectiveObjectPermissionsResolver(countingResolver(MAY_EDIT).fn);
    const made = await engine.insert('crm_case', { subject: 's', stage: 'open' }, { context: ACTING } as any) as any;

    const r = countingResolver(READ_ONLY);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    const err = await refusal(
      engine.update('crm_case', { stage: 'escalated' }, { where: { id: made.id }, context: ACTING } as any),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fields).toEqual([expect.objectContaining({ field: 'stage', code: 'invalid_option' })]);
    expect(r.asks).toHaveLength(1);
    expect(d.writes.filter((w) => w.op === 'update')).toHaveLength(0);
  });

  it('never cached across writes: a grant revoked between two writes is refused on the second', async () => {
    const r = countingResolver(MAY_EDIT);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    await expect(
      engine.insert('crm_case', { subject: 'a', stage: 'escalated' }, { context: ACTING } as any),
    ).resolves.toBeTruthy();

    r.set(READ_ONLY); // the grant is revoked between the two requests
    await expect(
      engine.insert('crm_case', { subject: 'b', stage: 'escalated' }, { context: ACTING } as any),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(r.asks).toHaveLength(2);
  });

  it('validate() previews the write with the SAME map, resolved once', async () => {
    const r = countingResolver(READ_ONLY);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    const preview = await engine.validate(
      'crm_case', [{ subject: 'a', stage: 'escalated' }, { subject: 'b', stage: 'open' }],
      { mode: 'insert', context: ACTING } as any,
    );
    expect(preview.results?.[0]?.valid).toBe(false);
    expect(preview.results?.[0]?.errors).toEqual([expect.objectContaining({ field: 'stage', code: 'invalid_option' })]);
    expect(preview.results?.[1]?.valid).toBe(true);
    expect(r.asks).toHaveLength(1);

    r.set(MAY_EDIT);
    const admitted = await engine.validate('crm_case', { subject: 'a', stage: 'escalated' }, { mode: 'insert', context: ACTING } as any);
    expect(admitted.results?.[0]?.valid).toBe(true);
  });
});
