// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Import dry run == real write, for the WHOLE validation family (#4633).
 *
 * The dry run's stated contract is that it reports the verdict the real write
 * produces. It used to keep that promise with a hand-copied MIRROR of a slice
 * of the engine's rules (`import-coerce.ts`'s `firstMissingRequiredField` /
 * `firstConstraintViolation`), which structurally could not cover the rest of
 * the family — and the gap was measured on a `Field.address`: a CSV cell aimed
 * at a structured value shape passed the dry run and was rejected by the write
 * with `VALIDATION_FAILED`.
 *
 * Ruling D (maintainer, 2026-08-06) replaced prediction with the verdict
 * itself: the dry run asks `DataProtocol.validateData` (#6037 / PR #6474),
 * which runs the same `validateRecord` / `evaluateValidationRules` `insert()`
 * runs. So this file never pins the dry run's output ALONE — every case runs
 * BOTH halves against one live engine and asserts they agree. A test that
 * pinned only the dry run would stay green while the two drifted apart again,
 * which is the entire defect.
 *
 * Both ADR-0104 postures are exercised, because the maintainer explicitly
 * VETOED an unconditionally-strict pre-check (option B): on a warn-first
 * deployment the write ACCEPTS a bad value shape after warning, so a dry run
 * that reported `failed` there would be a mirror-induced phantom defect. The
 * posture cases below are what keeps that veto enforced rather than minuted.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
  delete process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED;
  delete process.env.OS_ALLOW_LAX_VALUE_SHAPES;
});

/**
 * The issue's own object: HotCRM's account with a json-backed `Field.address`
 * (`billing_address`), plus the fields the retiring mirror used to cover so
 * their verdicts can be re-asserted through the new route.
 */
const CRM_ACCOUNT = {
  name: 'crm_account', label: 'Account', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name', required: true },
    // The issue's field. `coerceCell` routes `address` through its catch-all
    // ("pass through"), so the cell reaches validation as a bare string.
    billing_address: { name: 'billing_address', type: 'address' as const, label: 'Billing Address' },
    // Formerly covered by the mirror — kept so retiring it cannot silently
    // retire its coverage.
    tier: {
      name: 'tier', type: 'select' as const, label: 'Tier', required: true, defaultValue: 'standard',
      options: [{ label: 'Standard', value: 'standard' }, { label: 'Gold', value: 'gold' }],
    },
    penalty_amount: { name: 'penalty_amount', type: 'number' as const, label: '处罚金额', min: 0, max: 9999999.99 },
    nickname: { name: 'nickname', type: 'text' as const, label: 'Nickname', minLength: 3, maxLength: 5 },
  },
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(makeSqliteDriver(), true);
  await engine.init();
  engine.registry.registerObject(CRM_ACCOUNT as any);
  await engine.syncSchemas();

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import',
  );
  return { engine, protocol, route };
}

describe('import dry run == real write (#4633)', () => {
  let route: any;
  let engine: any;

  const imp = (body: any) => {
    const res = makeRes();
    return route.handler({ params: { object: 'crm_account' }, body } as any, res).then(() => res);
  };

  /**
   * Run the SAME payload twice — dry run, then for real — and hand back both
   * row reports. Every case in this file compares the two; the contract under
   * test is agreement, so a case that read only one of them could not fail
   * when they diverge.
   */
  const bothWays = async (rows: any[], extra: Record<string, unknown> = {}) => {
    const dry = await imp({ format: 'json', dryRun: true, rows, ...extra });
    const real = await imp({ format: 'json', rows, ...extra });
    return { dry: dry._json, real: real._json };
  };

  const verdictOf = (report: any, i = 0) => {
    const r = report.results[i];
    return { ok: r.ok, action: r.action, field: r.field, code: r.code, error: r.error };
  };

  describe('structured value shapes — self-certified (strict) deployment', () => {
    beforeEach(async () => {
      process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED = '1';
      ({ route, engine } = await boot());
    });

    it("the issue's repro: a string aimed at a `Field.address` is refused by BOTH halves, identically", async () => {
      const rows = [{ id: 'a1', name: 'Acme', billing_address: '123 Main St, Springfield' }];
      const { dry, real } = await bothWays(rows);

      // The measured defect: dry run said `{ ok: 1, created: 1 }` here while
      // the write said `{ errors: 1 }`.
      expect(dry).toMatchObject({ dryRun: true, total: 1, ok: 0, errors: 1, created: 0 });
      expect(real).toMatchObject({ total: 1, ok: 0, errors: 1, created: 0 });

      // Rejection-class case: assert the ENVELOPE (code + message), not merely
      // that the row was not ok. `invalid_type` is the field-level code
      // `record-validator.ts` fails a bad value shape with, and the message is
      // the engine's own sentence — the same one the issue measured on write.
      expect(verdictOf(dry)).toMatchObject({
        ok: false, action: 'failed', field: 'billing_address', code: 'invalid_type',
      });
      expect(verdictOf(dry).error).toContain('Billing Address has an invalid address value');
      // Agreement is the contract: pin the two against each other so this case
      // fails if EITHER side drifts.
      expect(verdictOf(dry)).toEqual(verdictOf(real));

      expect(await engine.findOne('crm_account', { where: { id: 'a1' } })).toBeNull();
    });

    it('a well-formed address object is accepted by both halves', async () => {
      const rows = [{
        id: 'a2', name: 'Globex',
        billing_address: { street: '1 Infinite Loop', city: 'Cupertino', country: 'US' },
      }];
      const { dry, real } = await bothWays(rows);
      expect(dry).toMatchObject({ ok: 1, errors: 0, created: 1 });
      expect(real).toMatchObject({ ok: 1, errors: 0, created: 1 });
      expect(await engine.findOne('crm_account', { where: { id: 'a2' } })).toBeTruthy();
    });
  });

  describe('structured value shapes — warn-first (un-migrated) deployment', () => {
    beforeEach(async () => {
      // The posture option B was vetoed over: `record-validator.ts` ADMITS the
      // row here after warning, so the write CREATES it.
      process.env.OS_ALLOW_LAX_VALUE_SHAPES = '1';
      ({ route, engine } = await boot());
    });

    it('ADMITS the same row the strict deployment refuses — and the dry run says `created`, not `failed`', async () => {
      const rows = [{ id: 'a3', name: 'Initech', billing_address: '123 Main St, Springfield' }];
      const { dry, real } = await bothWays(rows);

      // An unconditionally-strict pre-check would report `errors: 1` here while
      // the write reports `created: 1` — the phantom defect the ruling rejected.
      expect(dry).toMatchObject({ dryRun: true, total: 1, ok: 1, errors: 0, created: 1 });
      expect(real).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
      expect(verdictOf(dry)).toEqual(verdictOf(real));

      // The row IS written on this deployment — that is what makes the dry
      // run's `created` truthful rather than lenient.
      expect(await engine.findOne('crm_account', { where: { id: 'a3' } })).toBeTruthy();
    });

    it('reports the admission as a per-row WARNING, so "accepted for now" is visible', async () => {
      const rows = [{ id: 'a4', name: 'Umbrella', billing_address: 'not an address object' }];
      const dry = (await imp({ format: 'json', dryRun: true, rows }))._json;
      expect(dry.results[0]).toMatchObject({ ok: true, action: 'created' });
      expect(dry.results[0].warnings).toEqual([
        expect.objectContaining({ field: 'billing_address', code: 'invalid_type' }),
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // The retiring mirror's coverage. `firstMissingRequiredField` and
  // `firstConstraintViolation` are gone; every verdict they used to produce
  // must still arrive — now from the engine, through `validateData`.
  // ───────────────────────────────────────────────────────────────────────
  describe('the retired mirror’s verdicts still arrive, through the new route', () => {
    beforeEach(async () => { ({ route, engine } = await boot()); });

    it('required + no value: same verdict from both halves (was `firstMissingRequiredField`)', async () => {
      const rows = [{ id: 'r1', billing_address: null }]; // `name` is required
      const { dry, real } = await bothWays(rows, { runAutomations: false });
      expect(dry).toMatchObject({ ok: 0, errors: 1, created: 0 });
      expect(real).toMatchObject({ ok: 0, errors: 1, created: 0 });
      expect(verdictOf(dry)).toMatchObject({ field: 'name', code: 'required', error: 'Name is required' });
      expect(verdictOf(dry)).toEqual(verdictOf(real));
      expect(await engine.findOne('crm_account', { where: { id: 'r1' } })).toBeNull();
    });

    it('required WITH a schema default is satisfied without being mapped — no false alarm', async () => {
      // `tier` is required and defaulted. The write applies the default before
      // validating, so the preview must too; reporting `required` here would be
      // a false alarm on a row the write happily creates.
      const rows = [{ id: 'r2', name: 'Stark' }];
      const { dry, real } = await bothWays(rows, { runAutomations: false });
      expect(dry).toMatchObject({ ok: 1, errors: 0, created: 1 });
      expect(real).toMatchObject({ ok: 1, errors: 0, created: 1 });
      expect((await engine.findOne('crm_account', { where: { id: 'r2' } }))?.tier).toBe('standard');
    });

    it('numeric range: same verdict from both halves (was `firstConstraintViolation`, #3956)', async () => {
      const rows = [{ id: 'r3', name: 'Wayne', penalty_amount: -500 }];
      const { dry, real } = await bothWays(rows);
      expect(dry).toMatchObject({ ok: 0, errors: 1, created: 0 });
      expect(real).toMatchObject({ ok: 0, errors: 1, created: 0 });
      // #3957 — the message names the field by its declared LABEL.
      expect(verdictOf(dry)).toMatchObject({
        field: 'penalty_amount', code: 'min_value', error: '处罚金额 must be ≥ 0',
      });
      expect(verdictOf(dry)).toEqual(verdictOf(real));
    });

    it('string length: same verdict from both halves (was `firstConstraintViolation`, #3956)', async () => {
      const rows = [{ id: 'r4', name: 'Oscorp', nickname: 'toolongname' }];
      const { dry, real } = await bothWays(rows);
      expect(dry).toMatchObject({ ok: 0, errors: 1, created: 0 });
      expect(real).toMatchObject({ ok: 0, errors: 1, created: 0 });
      expect(verdictOf(dry)).toMatchObject({
        field: 'nickname', code: 'max_length', error: 'Nickname must be ≤ 5 characters (got 11)',
      });
      expect(verdictOf(dry)).toEqual(verdictOf(real));
    });

    it('numeric range, the other bound: above `max`, same verdict from both halves', async () => {
      const rows = [{ id: 'r3b', name: 'Wayne', penalty_amount: 1e9 }];
      const { dry, real } = await bothWays(rows);
      expect(dry).toMatchObject({ ok: 0, errors: 1, created: 0 });
      expect(real).toMatchObject({ ok: 0, errors: 1, created: 0 });
      expect(verdictOf(dry)).toMatchObject({ field: 'penalty_amount', code: 'max_value' });
      expect(verdictOf(dry)).toEqual(verdictOf(real));
    });

    it('string length, the other bound: below `minLength`, same verdict from both halves', async () => {
      const rows = [{ id: 'r4b', name: 'Oscorp', nickname: 'ab' }];
      const { dry, real } = await bothWays(rows);
      expect(dry).toMatchObject({ ok: 0, errors: 1, created: 0 });
      expect(real).toMatchObject({ ok: 0, errors: 1, created: 0 });
      expect(verdictOf(dry)).toMatchObject({
        field: 'nickname', code: 'min_length', error: 'Nickname must be ≥ 3 characters (got 2)',
      });
      expect(verdictOf(dry)).toEqual(verdictOf(real));
    });

    it('a bounded field the row omits is not a finding — a bound never fires on an absent value', async () => {
      const rows = [{ id: 'r4c', name: 'Tyrell' }]; // no penalty_amount, no nickname
      const { dry, real } = await bothWays(rows);
      expect(dry).toMatchObject({ ok: 1, errors: 0, created: 1 });
      expect(real).toMatchObject({ ok: 1, errors: 0, created: 1 });
    });

    it('boundary values stay legal — the new route must not over-reject either', async () => {
      const rows = [{ id: 'r5', name: 'Cyberdyne', penalty_amount: 0, nickname: 'exact' }];
      const { dry, real } = await bothWays(rows);
      expect(dry).toMatchObject({ ok: 1, errors: 0, created: 1 });
      expect(real).toMatchObject({ ok: 1, errors: 0, created: 1 });
    });

    it('update mode judges only the supplied keys — an unmapped required field is not a finding', async () => {
      await engine.insert('crm_account', { id: 'r6', name: 'Hooli', tier: 'gold' });
      const body = { writeMode: 'update', matchFields: ['id'] };
      const dry = (await imp({ format: 'json', dryRun: true, rows: [{ id: 'r6', nickname: 'okay' }], ...body }))._json;
      const real = (await imp({ format: 'json', rows: [{ id: 'r6', nickname: 'okay' }], ...body }))._json;
      expect(dry).toMatchObject({ ok: 1, errors: 0, updated: 1 });
      expect(real).toMatchObject({ ok: 1, errors: 0, updated: 1 });
    });

    it('update mode still bound-checks a supplied value, both halves', async () => {
      await engine.insert('crm_account', { id: 'r7', name: 'Aperture', penalty_amount: 10 });
      const body = { writeMode: 'update', matchFields: ['id'] };
      const rows = [{ id: 'r7', penalty_amount: -1 }];
      const dry = (await imp({ format: 'json', dryRun: true, rows, ...body }))._json;
      const real = (await imp({ format: 'json', rows, ...body }))._json;
      expect(dry).toMatchObject({ ok: 0, errors: 1, updated: 0 });
      expect(real).toMatchObject({ ok: 0, errors: 1, updated: 0 });
      expect(verdictOf(dry)).toMatchObject({ field: 'penalty_amount', code: 'min_value' });
      expect(verdictOf(dry)).toEqual(verdictOf(real));
    });
  });
});
