// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os migrate record-currency-codes` — the explicit backfill of the currency
// code a `record`-mode amount owes on rows stored before the switch (ADR-0144,
// ruling 6492000994, letter B).
//
// Every fixture writes its rows STRAIGHT INTO THE DRIVER STORE, bypassing the
// engine's insert path, which is exactly what a database holds after an
// existing `dynamic` / `fixed` amount was switched to `record`: amounts stored
// when no code was owed. Inserting them through the engine now would be
// refused (`ERR_CURRENCY_CODE_REQUIRED`), and there would be nothing to test.
// The backfill's writes go through the real engine, so its own record-mode
// guard and the code field's `valueDomain` judge each one.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  backfillRecordCurrencyCodes,
  formatRecordCurrencyBackfillReport,
  recordCurrencyBackfillComplete,
} from './record-currency-backfill.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const writes: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  // Implicit equality plus the comparison operators the keyset walk emits.
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
      return value === cond;
    }
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$gt': return value > target;
        case '$gte': return value >= target;
        case '$lt': return value < target;
        case '$lte': return value <= target;
        case '$in': return Array.isArray(target) && target.includes(value);
        case '$nin': return Array.isArray(target) && !target.includes(value);
        default: return true;
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k === '$not') return !matches(row, v);
      return checkOp(row?.[k], v);
    });
  };
  let failUpdateFor: string | null = null;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      // Rows are seeded in id order and never re-keyed, so the store's order is
      // the `id` order the keyset walk seeks by.
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const row = { ...data };
      storeFor(object).set(String(row.id), row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      if (failUpdateFor && id === failUpdateFor) throw new Error('driver refused this row');
      writes.push({ object, id, data });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
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
  return {
    driver,
    storeFor,
    writes,
    failUpdateFor: (id: string | null) => { failUpdateFor = id; },
  };
}

const quietLogger = { info: () => {}, warn: () => {} };

describe('backfillRecordCurrencyCodes — rows stored before the switch to record mode', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;

  /** A row as the database holds it after the switch: written before any code was owed. */
  const stored = (id: string, row: Record<string, unknown>) => {
    d.storeFor('deal').set(id, { id, name: id, ...row });
  };
  const deal = (id: string) => d.storeFor('deal').get(id);
  /** Every row read the driver was asked for, counted beside the double rather than inside it. */
  const reads = () => vi.mocked(d.driver.find).mock.calls.length + vi.mocked(d.driver.findOne).mock.calls.length;

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    vi.spyOn(d.driver, 'find');
    vi.spyOn(d.driver, 'findOne');
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'deal',
      fields: {
        name: { type: 'text' },
        amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
        currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
        // Still `dynamic`: it owes no code, and a run naming it is refused.
        budget: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
      },
    } as any);
  });

  /** The state every case starts from: one row of each kind the walk tells apart. */
  const seedMixed = () => {
    stored('d1', { amount: 120 });                           // codeless — filled
    stored('d2', { amount: 0, currency_code: null });        // 0 is an amount — filled
    stored('d3', { amount: 75, currency_code: '   ' });      // white space is no code — filled
    stored('d4', { amount: 300, currency_code: 'EUR' });     // holds a code — never touched
    stored('d5', { amount: null });                          // no amount — no code owed
    stored('d6', { currency_code: 'JPY' });                  // code and no amount — never touched
  };

  it('a dry run counts every kind of row and writes nothing', async () => {
    seedMixed();
    const report = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD',
    });

    expect(report).toMatchObject({
      object: 'deal', field: 'amount', codeField: 'currency_code', code: 'USD',
      scannedRecords: 6, codeless: 3, written: 0, skippedCodePresent: 2, skippedAmountBlank: 1,
      applied: false, truncated: false, failures: [],
    });
    expect(report.sampleRecordIds).toEqual(['d1', 'd2', 'd3']);
    expect(d.writes).toEqual([]);
    expect(deal('d1').currency_code).toBeUndefined();
  });

  it('--apply writes the supplied code into the codeless rows only, through the engine', async () => {
    seedMixed();
    const report = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD', apply: true,
    });

    expect(report).toMatchObject({ codeless: 3, written: 3, skippedCodePresent: 2, skippedAmountBlank: 1, applied: true });
    expect(deal('d1').currency_code).toBe('USD');
    expect(deal('d2').currency_code).toBe('USD');
    expect(deal('d3').currency_code).toBe('USD');
    // A row holding a code keeps it; a blank amount gets none.
    expect(deal('d4').currency_code).toBe('EUR');
    expect(deal('d5').currency_code).toBeUndefined();
    expect(deal('d6').currency_code).toBe('JPY');
    expect(d.writes.map((w) => w.id).sort()).toEqual(['d1', 'd2', 'd3']);
    // The amounts are the rows' own and are never rewritten.
    expect(deal('d1').amount).toBe(120);
    expect(recordCurrencyBackfillComplete(report)).toBe(true);
  });

  it('is idempotent — a second run finds nothing left and writes nothing', async () => {
    seedMixed();
    await backfillRecordCurrencyCodes(engine, quietLogger, { object: 'deal', field: 'amount', code: 'USD', apply: true });
    const writesAfterFirst = d.writes.length;

    const again = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD', apply: true,
    });
    expect(again).toMatchObject({ codeless: 0, written: 0, skippedCodePresent: 5, skippedAmountBlank: 1 });
    expect(d.writes.length).toBe(writesAfterFirst);
    expect(formatRecordCurrencyBackfillReport(again)).toContain(
      '✓ Every deal.amount amount already has its currency code — nothing to backfill.',
    );
  });

  it('a walk the cap cuts short says so, and never claims every row was examined', async () => {
    // Two coded rows first, so the capped walk meets no codeless row at all.
    stored('c1', { amount: 1, currency_code: 'EUR' });
    stored('c2', { amount: 2, currency_code: 'EUR' });
    stored('c3', { amount: 3 });
    const capped = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD', maxRecords: 2,
    });
    expect(capped).toMatchObject({ scannedRecords: 2, codeless: 0, truncated: true });
    const lines = formatRecordCurrencyBackfillReport(capped);
    expect(lines).toContain('No codeless deal.amount amount among the 2 row(s) examined.');
    expect(lines.some((l) => l.includes('nothing to backfill'))).toBe(false);
    expect(lines).toContain('⚠ Walk incomplete — some rows were not examined; re-run without the cap to finish.');
    // The run was unscoped, so its one-organization verdict saw only those rows.
    expect(lines.some((l) => l.includes('The organization check saw only the rows examined'))).toBe(true);
    expect(recordCurrencyBackfillComplete(capped)).toBe(false);

    // A scoped run names its organization, so it owes no organization-check line.
    const scoped = formatRecordCurrencyBackfillReport({ ...capped, organizationId: 'org_a' });
    expect(scoped.some((l) => l.includes('The organization check'))).toBe(false);
    // The same walk, uncapped, is complete and says so.
    const whole = await backfillRecordCurrencyCodes(engine, quietLogger, { object: 'deal', field: 'amount', code: 'USD' });
    expect(whole).toMatchObject({ scannedRecords: 3, codeless: 1, truncated: false });
  });

  it('a code that is not an ISO 4217 member is refused before any row is read', async () => {
    seedMixed();
    for (const code of ['usd', 'XYZ', 'US', ' USD', '']) {
      const before = reads();
      const err = await backfillRecordCurrencyCodes(engine, quietLogger, {
        object: 'deal', field: 'amount', code, apply: true,
      }).then(() => null, (e: unknown) => e as Record<string, unknown>);
      expect(err, code).toMatchObject({ code: 'INVALID_FIELD', status: 400, httpStatus: 400, field: 'currency_code' });
      expect(String(err?.message)).toContain('Refused before the walk read or wrote any row.');
      expect(reads(), code).toBe(before);
    }
    expect(d.writes).toEqual([]);
  });

  it('a field that is not a record-mode currency field is refused before any row is read', async () => {
    seedMixed();
    for (const field of ['budget', 'name', 'nope']) {
      const err = await backfillRecordCurrencyCodes(engine, quietLogger, {
        object: 'deal', field, code: 'USD', apply: true,
      }).then(() => null, (e: unknown) => e as Record<string, unknown>);
      expect(err, field).toMatchObject({ code: 'INVALID_FIELD', status: 400, field });
      expect(String(err?.message)).toContain(`'deal.${field}' is not a record-mode currency field`);
    }
    expect(reads()).toBe(0);
    expect(d.writes).toEqual([]);
  });

  it('an object the registry does not declare is refused with OBJECT_NOT_FOUND', async () => {
    await expect(backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'nope', field: 'amount', code: 'USD',
    })).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404, object: 'nope' });
  });

  it('one row whose write fails is reported and does not stop the rest; a re-run finishes it', async () => {
    seedMixed();
    d.failUpdateFor('d2');
    const report = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD', apply: true,
    });
    expect(report.written).toBe(2);
    expect(report.failures).toEqual([{ recordId: 'd2', error: expect.stringContaining('driver refused this row') }]);
    expect(recordCurrencyBackfillComplete(report)).toBe(false);
    expect(deal('d2').currency_code).toBeNull();

    d.failUpdateFor(null);
    const again = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD', apply: true,
    });
    expect(again).toMatchObject({ codeless: 1, written: 1, failures: [] });
    expect(deal('d2').currency_code).toBe('USD');
  });

  it('the dry-run report names what it would write, what it skipped, and claims no row or table', async () => {
    seedMixed();
    const report = await backfillRecordCurrencyCodes(engine, quietLogger, { object: 'deal', field: 'amount', code: 'USD' });
    expect(formatRecordCurrencyBackfillReport(report)).toEqual([
      'Scanned 6 row(s) of deal for an amount in amount beside a blank currency code in currency_code.',
      'Would write USD into currency_code on 3 codeless row(s).',
      '  e.g. d1, d2, d3',
      '· Skipped: 2 row(s) already holding a code (never overwritten), 1 row(s) with a blank amount (no code owed).',
      'Dry run — no row or table was written. Re-run with --apply to backfill.',
    ]);
  });
});

// [ADR-0144 Open item 13, ruling 6670707546 item A] Each organization has its
// own home currency, so one code is right for at most the organizations that
// share it: the run is scoped by organization, and an unscoped run over the
// rows of more than one organization is refused before any write.
describe('backfillRecordCurrencyCodes — one organization at a time', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let posture: string | undefined;

  const stored = (id: string, row: Record<string, unknown>) => {
    d.storeFor('deal').set(id, { id, name: id, ...row });
  };
  const deal = (id: string) => d.storeFor('deal').get(id);
  const run = (options: Record<string, unknown> = {}) =>
    backfillRecordCurrencyCodes(engine, quietLogger, { object: 'deal', field: 'amount', code: 'USD', ...options });
  const refused = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Record<string, any>);

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    vi.spyOn(d.driver, 'find');
    vi.spyOn(d.driver, 'update');
    engine.registerDriver(d.driver, true);
    await engine.init();
    posture = undefined;
    engine.setTenancyPostureProvider(() => posture);
    engine.registry.registerObject({
      name: 'deal',
      fields: {
        name: { type: 'text' },
        amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
        currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
      },
    } as any);
    // Two organizations, each with codeless rows, and one row of A that holds a code.
    stored('a1', { organization_id: 'org_a', amount: 100 });
    stored('a2', { organization_id: 'org_a', amount: 200 });
    stored('a3', { organization_id: 'org_a', amount: 300, currency_code: 'CNY' });
    stored('b1', { organization_id: 'org_b', amount: 400 });
  });

  it('the object stores the organization the run counts by (the registry injects organization_id)', () => {
    expect(engine.getObject('deal')?.fields).toHaveProperty('organization_id');
  });

  it('two organizations and no scope: refused before any write, the refusal carrying each organization\'s codeless count', async () => {
    for (const apply of [false, true]) {
      const err = await refused(run({ apply }));
      expect(err, `apply: ${apply}`).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400, field: 'organizationId' });
      expect(err?.organizations).toEqual([
        { organizationId: 'org_a', scannedRecords: 3, codeless: 2, written: 0, skippedCodePresent: 1, skippedAmountBlank: 0 },
        { organizationId: 'org_b', scannedRecords: 1, codeless: 1, written: 0, skippedCodePresent: 0, skippedAmountBlank: 0 },
      ]);
      expect(String(err?.message)).toContain('Refused before any row was written.');
    }
    expect(vi.mocked(d.driver.update)).not.toHaveBeenCalled();
    expect(d.writes).toEqual([]);
    expect(deal('a1').currency_code).toBeUndefined();
    expect(deal('b1').currency_code).toBeUndefined();
  });

  it('an organization scope writes that organization\'s codeless rows only, read and written as it', async () => {
    const report = await run({ organizationId: 'org_a', apply: true });
    expect(report).toMatchObject({
      organizationId: 'org_a', allOrganizations: false,
      scannedRecords: 3, codeless: 2, written: 2, skippedCodePresent: 1, failures: [],
    });
    expect(report.organizations).toEqual([
      { organizationId: 'org_a', scannedRecords: 3, codeless: 2, written: 2, skippedCodePresent: 1, skippedAmountBlank: 0 },
    ]);
    expect(deal('a1').currency_code).toBe('USD');
    expect(deal('a2').currency_code).toBe('USD');
    expect(deal('a3').currency_code).toBe('CNY');
    expect(deal('b1').currency_code).toBeUndefined();
    expect(d.writes.map((w) => w.id).sort()).toEqual(['a1', 'a2']);
    // The walk filters on the row's own organization; every write runs as it.
    for (const [, ast] of vi.mocked(d.driver.find).mock.calls.filter(([o]: unknown[]) => o === 'deal')) {
      expect(JSON.stringify((ast as any).where)).toContain('"organization_id":"org_a"');
    }
    expect(formatRecordCurrencyBackfillReport(report)[0]).toBe(
      'Scanned 3 row(s) of deal in organization org_a for an amount in amount beside a blank currency code in currency_code.',
    );
  });

  it('under a walled posture the scope also reaches the driver as the organization predicate', async () => {
    posture = 'isolated';
    await run({ organizationId: 'org_b', apply: true });
    const finds = vi.mocked(d.driver.find).mock.calls.filter(([o]: unknown[]) => o === 'deal');
    expect(finds.length).toBeGreaterThan(0);
    for (const call of finds) expect(call[2]).toMatchObject({ tenantId: 'org_b' });
    expect(vi.mocked(d.driver.update).mock.calls.map((c: unknown[]) => c[1])).toEqual(['b1']);
    expect(deal('b1').currency_code).toBe('USD');
    expect(deal('a1').currency_code).toBeUndefined();
  });

  it('allOrganizations writes the one code into every organization\'s codeless rows, counted apart', async () => {
    const report = await run({ allOrganizations: true, apply: true });
    expect(report).toMatchObject({ organizationId: null, allOrganizations: true, codeless: 3, written: 3 });
    expect(report.organizations.map((o) => [o.organizationId, o.codeless, o.written])).toEqual([['org_a', 2, 2], ['org_b', 1, 1]]);
    expect(['a1', 'a2', 'b1'].map((id) => deal(id).currency_code)).toEqual(['USD', 'USD', 'USD']);
    expect(deal('a3').currency_code).toBe('CNY');
    expect(formatRecordCurrencyBackfillReport(report).slice(0, 3)).toEqual([
      'Scanned 4 row(s) of deal in every organization for an amount in amount beside a blank currency code in currency_code.',
      '  organization org_a: 2 codeless row(s), 2 written',
      '  organization org_b: 1 codeless row(s), 1 written',
    ]);
  });

  it('an organization scope beside allOrganizations, or a blank one, is refused before any row is read', async () => {
    for (const options of [{ organizationId: 'org_a', allOrganizations: true }, { organizationId: '' }, { organizationId: '  ' }]) {
      const err = await refused(run({ ...options, apply: true }));
      expect(err, JSON.stringify(options)).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, field: 'organizationId' });
      expect(String(err?.message)).toContain('Refused before the walk read or wrote any row.');
    }
    expect(vi.mocked(d.driver.find)).not.toHaveBeenCalled();
    expect(d.writes).toEqual([]);
  });

  it('an organization scope on an object that stores no organization is refused before any row is read', async () => {
    engine.registry.registerObject({
      name: 'shared_deal',
      tenancy: { enabled: false },
      fields: {
        amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
        currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
      },
    } as any);
    expect(engine.getObject('shared_deal')?.fields).not.toHaveProperty('organization_id');
    const err = await refused(backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'shared_deal', field: 'amount', code: 'USD', organizationId: 'org_a', apply: true,
    }));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'organization_id' });
    expect(vi.mocked(d.driver.find)).not.toHaveBeenCalled();
  });

  it('rows of one organization (and rows naming none) run unscoped exactly as before', async () => {
    d.storeFor('deal').delete('b1');
    stored('n1', { amount: 50 }); // a row that names no organization
    const report = await run({ apply: true });
    expect(report).toMatchObject({ organizationId: null, allOrganizations: false, codeless: 3, written: 3, failures: [] });
    expect(['a1', 'a2', 'n1'].map((id) => deal(id).currency_code)).toEqual(['USD', 'USD', 'USD']);
    expect(report.organizations.map((o) => o.organizationId)).toEqual(['org_a', null]);
    // The unscoped run's writes keep the unscoped system context, as before.
    for (const call of vi.mocked(d.driver.update).mock.calls) expect((call[3] as any)?.tenantId).toBeUndefined();
    // Its report reads as it did before the scope existed: no organization line.
    expect(formatRecordCurrencyBackfillReport(report)[0]).toBe(
      'Scanned 4 row(s) of deal for an amount in amount beside a blank currency code in currency_code.',
    );
    expect(formatRecordCurrencyBackfillReport(report).some((l) => l.includes('organization'))).toBe(false);
  });
});
