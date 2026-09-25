// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20082] `current_user.can(object, verb)` in the engine's two VALUE sites —
 * a `formula` field and a CEL `defaultValue` — answered from the registered
 * effective-permission resolver, driven through the real engine.
 *
 * Before this, both sites built their own `current_user` and passed no
 * `permissions`, so with a resolver registered a `can` formula read `null` on
 * every `find` / `findOne` / write echo with no log line, and a `can` default
 * was left unset with a warn (a `required` one refused the write). The table
 * pins every site × every case, and the cells follow each site's own rule:
 *
 *  - the map (a granted verb, a denied verb) ⇒ the boolean `can` answers;
 *  - NO resolver ⇒ NO permission data (the contract member's rule for an absent
 *    method): a formula reads `null` WITH a warn naming the fields; a default
 *    is left unset with the site's existing warn, which carries formula's own
 *    refusal — ⛔ never an implicit grant, never a silent answer;
 *  - the resolver THROWS ⇒ fail CLOSED: a read cannot refuse a row for one
 *    computed field, so the formula reads `null` with a warn carrying the
 *    error; a write refuses a row whose `can` default needed the map, with the
 *    resolution's own error, untouched.
 *
 * And the resolution counts: at most ONE ask per operation — per `find` (not
 * per row), per write across its defaults, option gates and response formulas
 * — none at all for an operation that cannot need it, and never kept across
 * operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

import '@objectstack/spec';
import '@objectstack/formula';

const cel = (source: string) => ({ dialect: 'cel' as const, source });

/**
 * An in-memory driver that hands back shallow COPIES, never live rows: the
 * formula pass writes onto the rows a driver returns, so a leaking double would
 * store the computed values and a later read would pass with the evaluation
 * gone.
 */
function makeDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where as Record<string, unknown>).every(([k, v]) => {
      if (k === '$and') return (v as unknown[]).every((w) => matches(row, w));
      const cond = v as Record<string, unknown> | null;
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$in' in cond) return Array.isArray(cond.$in) && cond.$in.includes(row[k]);
        if ('$eq' in cond) return row[k] === cond.$eq;
        throw new Error(`test driver: unsupported condition on ${k}`);
      }
      return row[k] === cond;
    });
  };
  const writes: Array<{ op: string; object: string; data: Record<string, unknown> }> = [];
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // Hold the caller's bound (`check:objectql-double-limit`).
      const bounded = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return bounded.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      writes.push({ op: 'create', object, data: { ...data } });
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      writes.push({ op: 'update', object, data: { ...data } });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany() { return 0; },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
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

/** A resolver that records every ask; `answer` is a value, or a function that may throw. */
function countingResolver(answer: unknown | (() => unknown)) {
  const asks: unknown[] = [];
  const fn = async (ctx: unknown) => {
    asks.push(ctx);
    return typeof answer === 'function' ? (answer as () => unknown)() : answer;
  };
  return { fn, asks };
}

const ACTING = { userId: 'u1', positions: ['sales_rep'] } as any;
const SYSTEM = { isSystem: true } as any;
/** The `objects` slot of `/auth/me/permissions`: `edit` granted on crm_account, `delete` not. */
const MAP = { crm_account: { allowRead: true, allowEdit: true } };
const BOOM = Object.assign(new Error('permission store unreachable'), { code: 'AUTHZ_STORE_UNAVAILABLE', status: 503 });

const CASE_OBJECT = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text' },
    stage: {
      type: 'select',
      options: [
        { value: 'open' },
        { value: 'escalated', visibleWhen: "current_user.can('crm_account', 'edit')" },
      ],
    },
    may_edit_account: { type: 'formula', expression: cel("current_user.can('crm_account', 'edit')") },
    may_delete_account: { type: 'formula', expression: cel("current_user.can('crm_account', 'delete')") },
    // The control formula: evaluates on every cell, map or no map.
    label: { type: 'formula', expression: cel("'case:' + record.subject") },
    edit_flag: { type: 'boolean', defaultValue: cel("current_user.can('crm_account', 'edit')") },
    delete_flag: { type: 'boolean', defaultValue: cel("current_user.can('crm_account', 'delete')") },
  },
};
/** A `required` field defaulted by `can` — refused by required-validation when the default cannot evaluate. */
const GATE_OBJECT = {
  name: 'crm_gate',
  fields: {
    subject: { type: 'text' },
    flag: { type: 'boolean', required: true, defaultValue: cel("current_user.can('crm_account', 'edit')") },
  },
};
/** The control object: a formula and a CEL default, neither calling `can`. */
const NOTE_OBJECT = {
  name: 'crm_note',
  fields: {
    body: { type: 'text' },
    shout: { type: 'formula', expression: cel("record.body + '!'") },
    author: { type: 'text', defaultValue: cel('current_user.id') },
  },
};

type Scenario = 'granted' | 'denied' | 'no resolver' | 'resolver throws';

/**
 * The table: what each case registers, and what each site reads. `formula` and
 * `defaultField` name the field the scenario reads — the granted verb's field
 * or the denied verb's; the throw/no-resolver cases read the granted verb's,
 * so a `null` there can only be the missing map, never a denial.
 */
const TABLE: Array<{
  scenario: Scenario;
  resolver?: () => unknown;
  formula: 'may_edit_account' | 'may_delete_account';
  defaultField: 'edit_flag' | 'delete_flag';
  reads: boolean | null;
  warnReason?: 'no-permission-source' | 'permission-resolution-failed';
  defaulted: boolean | undefined | 'refused';
}> = [
  { scenario: 'granted', resolver: () => MAP, formula: 'may_edit_account', defaultField: 'edit_flag', reads: true, defaulted: true },
  { scenario: 'denied', resolver: () => MAP, formula: 'may_delete_account', defaultField: 'delete_flag', reads: false, defaulted: false },
  { scenario: 'no resolver', formula: 'may_edit_account', defaultField: 'edit_flag', reads: null, warnReason: 'no-permission-source', defaulted: undefined },
  { scenario: 'resolver throws', resolver: () => { throw BOOM; }, formula: 'may_edit_account', defaultField: 'edit_flag', reads: null, warnReason: 'permission-resolution-failed', defaulted: 'refused' },
];

describe('#20082 — formula fields and CEL defaults answer `can` from the security service', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let log: ReturnType<typeof captureLogger>;

  beforeEach(async () => {
    log = captureLogger();
    engine = new ObjectQL({ logger: log.logger });
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    for (const def of [CASE_OBJECT, GATE_OBJECT, NOTE_OBJECT]) engine.registry.registerObject(def as any, 'test-package');
  });

  /** Rows stored directly, as a system seed would leave them — every default field already valued. */
  function seed(count: number): void {
    for (let i = 0; i < count; i++) {
      d.storeFor('crm_case').set(`c${i}`, { id: `c${i}`, subject: `s${i}`, stage: 'open', edit_flag: false, delete_flag: false });
    }
  }
  const formulaWarns = () => log.warns.filter((w) => Array.isArray(w.meta?.fields));
  const defaultWarns = (field: string) => log.warns.filter((w) => w.meta?.field === field && w.meta?.error?.kind);
  const created = (object: string) => d.writes.filter((w) => w.op === 'create' && w.object === object);

  async function refusal(p: Promise<unknown>): Promise<any> {
    try {
      await p;
    } catch (err) {
      return err;
    }
    throw new Error('expected the write to be refused');
  }

  for (const row of TABLE) {
    describe(`${row.scenario}`, () => {
      let asks: unknown[];
      beforeEach(() => {
        asks = [];
        if (row.resolver) {
          const r = countingResolver(row.resolver);
          asks = r.asks;
          engine.registerEffectiveObjectPermissionsResolver(r.fn);
        }
      });

      /** One read's formula cells: the scenario's value, the control evaluated, and one warn at most. */
      function expectFormulaCells(records: Array<Record<string, unknown>>, reads: number) {
        for (const rec of records) {
          expect(rec[row.formula]).toBe(row.reads);
          expect(rec.label).toBe(`case:${String(rec.subject)}`);
        }
        const warns = formulaWarns();
        if (!row.warnReason) {
          expect(warns).toHaveLength(0);
          return;
        }
        // ONE line per read operation, never per row — naming every `can` field.
        expect(warns).toHaveLength(reads);
        for (const w of warns) {
          expect(w.meta).toMatchObject({ object: 'crm_case', reason: row.warnReason });
          expect(w.meta.fields).toEqual(['may_edit_account', 'may_delete_account']);
          if (row.warnReason === 'permission-resolution-failed') expect(w.meta.error).toBe(BOOM);
        }
      }

      it('formula field on find — one resolution for the whole result set', async () => {
        seed(4);
        const rows = await engine.find('crm_case', { context: ACTING } as any) as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(4);
        expectFormulaCells(rows, 1);
        expect(asks).toHaveLength(row.resolver ? 1 : 0);
      });

      it('formula field on findOne', async () => {
        seed(2);
        const rec = await engine.findOne('crm_case', { where: { id: 'c1' }, context: ACTING } as any) as Record<string, unknown>;
        expectFormulaCells([rec], 1);
        expect(asks).toHaveLength(row.resolver ? 1 : 0);
      });

      it('formula field on the update echo', async () => {
        seed(1);
        const echo = await engine.update('crm_case', { subject: 'renamed' }, { where: { id: 'c0' }, context: ACTING } as any) as Record<string, unknown>;
        expectFormulaCells([echo], 1);
        expect(asks).toHaveLength(row.resolver ? 1 : 0);
      });

      it('CEL defaultValue on insert — and the insert echo\'s formula reuses the same resolution', async () => {
        const write = engine.insert('crm_case', { subject: 'n' }, { context: ACTING } as any);
        if (row.defaulted === 'refused') {
          // Fail CLOSED with the resolution's own error, untouched: ⛔ not read
          // as "no grants" (which would STORE `false`), and nothing written.
          const err = await refusal(write);
          expect(err).toBe(BOOM);
          expect(err.code).toBe('AUTHZ_STORE_UNAVAILABLE');
          expect(err.status).toBe(503);
          expect(err).not.toBeInstanceOf(ValidationError);
          expect(created('crm_case')).toHaveLength(0);
          expect(asks).toHaveLength(1);
          return;
        }
        const echo = await write as Record<string, unknown>;
        const stored = created('crm_case');
        expect(stored).toHaveLength(1);
        if (row.defaulted === undefined) {
          // Unset — neither a grant nor a denial — with the site's warn, which
          // carries formula's own "no permission data" refusal.
          expect(stored[0].data[row.defaultField] ?? null).toBeNull();
          const warns = defaultWarns(row.defaultField);
          expect(warns).toHaveLength(1);
          expect(warns[0].meta).toMatchObject({ object: 'crm_case', field: row.defaultField, error: { kind: 'runtime' } });
          expect(String(warns[0].meta.error.message)).toContain('carries no permission data');
        } else {
          expect(stored[0].data[row.defaultField]).toBe(row.defaulted);
          expect(defaultWarns(row.defaultField)).toHaveLength(0);
        }
        // The echo's formulas: the same answers, and one resolution for the whole write.
        expectFormulaCells([echo], 1);
        expect(asks).toHaveLength(row.resolver ? 1 : 0);
      });

      it('a `required` field defaulted by `can`', async () => {
        const write = engine.insert('crm_gate', { subject: 'g' }, { context: ACTING } as any);
        if (row.defaulted === 'refused') {
          expect(await refusal(write)).toBe(BOOM);
          expect(created('crm_gate')).toHaveLength(0);
        } else if (row.defaulted === undefined) {
          // Unchanged from before the seam: unset, so required-validation refuses.
          const err = await refusal(write);
          expect(err).toBeInstanceOf(ValidationError);
          expect(err.code).toBe('VALIDATION_FAILED');
          expect(err.fields).toEqual([expect.objectContaining({ field: 'flag', code: 'required' })]);
          expect(created('crm_gate')).toHaveLength(0);
        } else {
          // The map is in hand, so the default evaluates to a real value and the
          // required field is satisfied — the row was refused here before. (This
          // object's default asks the GRANTED verb; the denied verb's cell is the
          // next test.)
          await expect(write).resolves.toBeTruthy();
          expect(created('crm_gate')[0].data.flag).toBe(true);
        }
      });
    });
  }

  it('a `required` field defaulted by the DENIED verb stores `false` — a real answer, so it is admitted', async () => {
    engine.registry.registerObject({
      name: 'crm_gate_denied',
      fields: { flag: { type: 'boolean', required: true, defaultValue: cel("current_user.can('crm_account', 'delete')") } },
    } as any, 'test-package');
    engine.registerEffectiveObjectPermissionsResolver(countingResolver(MAP).fn);
    await engine.insert('crm_gate_denied', {}, { context: ACTING } as any);
    expect(created('crm_gate_denied')[0].data.flag).toBe(false);
  });

  it('ONE resolution for a write that needs the map three ways: default, option gate and response formula', async () => {
    const r = countingResolver(MAP);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    const echo = await engine.insert('crm_case', { subject: 'x', stage: 'escalated' }, { context: ACTING } as any) as Record<string, unknown>;
    expect(created('crm_case')[0].data).toMatchObject({ stage: 'escalated', edit_flag: true, delete_flag: false });
    expect(echo.may_edit_account).toBe(true);
    expect(r.asks).toHaveLength(1);
  });

  it('ONE resolution for a batch insert of N rows, and for a by-id update picking a gated option', async () => {
    const r = countingResolver(MAP);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    await engine.insert('crm_case', Array.from({ length: 6 }, (_, i) => ({ subject: `b${i}` })) as any, { context: ACTING } as any);
    expect(created('crm_case')).toHaveLength(6);
    expect(created('crm_case').every((w) => w.data.edit_flag === true && w.data.delete_flag === false)).toBe(true);
    expect(r.asks).toHaveLength(1);

    await engine.update('crm_case', { stage: 'escalated' }, { where: { id: 'r_1' }, context: ACTING } as any);
    expect(r.asks).toHaveLength(2);
  });

  it('validate() previews the defaults and the option gate with ONE resolution', async () => {
    const r = countingResolver(MAP);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    const preview = await engine.validate('crm_gate', [{ subject: 'a' }, { subject: 'b' }], { mode: 'insert', context: ACTING } as any);
    expect(preview.valid).toBe(true);
    expect(r.asks).toHaveLength(1);
  });

  it('never cached across operations: two finds ask twice', async () => {
    seed(3);
    const r = countingResolver(MAP);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    await engine.find('crm_case', { context: ACTING } as any);
    await engine.find('crm_case', { context: ACTING } as any);
    expect(r.asks).toHaveLength(2);
  });

  it('control: no `can` anywhere ⇒ never asks, even a resolver that would THROW, and no warn', async () => {
    const r = countingResolver(() => { throw BOOM; });
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    const echo = await engine.insert('crm_note', { body: 'hi' }, { context: ACTING } as any) as Record<string, unknown>;
    expect(echo.shout).toBe('hi!');
    expect(created('crm_note')[0].data.author).toBe('u1');
    const rows = await engine.find('crm_note', { context: ACTING } as any) as Array<Record<string, unknown>>;
    expect(rows[0].shout).toBe('hi!');
    expect(r.asks).toHaveLength(0);
    expect(formulaWarns()).toHaveLength(0);
  });

  it('a row that SUPPLIES the `can`-defaulted fields never asks, so a failing resolver cannot refuse it', async () => {
    const r = countingResolver(() => { throw BOOM; });
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    // The formula leg of the echo still reads null (with its warn): only the
    // default path was spared, because only the default path did not need it.
    await expect(
      engine.insert('crm_case', { subject: 's', edit_flag: true, delete_flag: false }, { context: ACTING } as any),
    ).resolves.toBeTruthy();
    expect(created('crm_case')[0].data).toMatchObject({ edit_flag: true, delete_flag: false });
    expect(r.asks).toHaveLength(1); // the echo's formulas — the default path asked nothing
  });

  it('a system read (no acting user) never asks — `can` would be about nobody', async () => {
    seed(2);
    const r = countingResolver(MAP);
    engine.registerEffectiveObjectPermissionsResolver(r.fn);
    await engine.find('crm_case', { context: SYSTEM } as any);
    await engine.find('crm_case', {} as any);
    expect(r.asks).toHaveLength(0);
    expect(formulaWarns()).toHaveLength(0);
  });

  it('partial mode (insertMany): a failed resolution refuses only the rows whose `can` default needed it', async () => {
    engine.registerEffectiveObjectPermissionsResolver(countingResolver(() => { throw BOOM; }).fn);
    const out = await engine.insertMany('crm_case', [
      { subject: 'needs' },
      { subject: 'supplies', edit_flag: false, delete_flag: true },
    ], { context: ACTING } as any);
    expect(out[0].ok).toBe(false);
    expect((out[0] as { error: unknown }).error).toBe(BOOM);
    expect(out[1].ok).toBe(true);
    expect(created('crm_case').map((w) => w.data.subject)).toEqual(['supplies']);
  });

  it('a map that is not the published shape fails closed the same way (formula\'s door)', async () => {
    engine.registerEffectiveObjectPermissionsResolver(countingResolver({ crm_account: true }).fn);
    const err = await refusal(engine.insert('crm_case', { subject: 'n' }, { context: ACTING } as any));
    expect(err).toBeInstanceOf(TypeError);
    expect(String(err.message)).toContain("the entry for 'crm_account' is not an EffectiveObjectPermission");
    expect(created('crm_case')).toHaveLength(0);

    seed(1);
    const rows = await engine.find('crm_case', { context: ACTING } as any) as Array<Record<string, unknown>>;
    expect(rows[0].may_edit_account).toBeNull();
    expect(formulaWarns().at(-1)?.meta).toMatchObject({ reason: 'permission-resolution-failed' });
  });
});
