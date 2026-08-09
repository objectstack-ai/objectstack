// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5288 — `resolveEffectiveDatasource`: the datasource an object's rows are
 * actually on, by NAME.
 *
 * The engine has five resolution steps (`getDriver`), and everyone who only
 * needed the NAME used to read `object.datasource` — step 1. That value is the
 * DECLARATION, and `ObjectSchema.datasource` carries `.default('default')`, so
 * an object placed by a `datasourceMapping` rule, by the ADR-0057 §3.6
 * lifecycle split, or by its package's `defaultDatasource` still answered
 * `'default'` — which in `getDriver` means "no explicit binding, keep looking",
 * never "the primary DB". Analytics' `getObjectDatasource` probe was such a
 * reader, and #5033's query-time diagnostic composed from it therefore named a
 * database the rows are not in.
 *
 * These cases pin the accessor against `getDriver` itself: for every routing
 * mechanism, the NAME it answers is the name of the driver `getDriver` picks.
 * One resolution order, two shapes of answer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

/** Owning package for the probe objects — no manifest is registered for it, so
 *  step 4 stays a no-op unless a case registers one. */
const PKG = 'com.example.probe';

function stubDriver(name: string) {
  return {
    name,
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async find() {
      return [];
    },
    async findOne() {
      return null;
    },
    async create(_o: string, d: Record<string, unknown>) {
      return d;
    },
    async update() {
      return {};
    },
    async upsert() {
      return {};
    },
    async delete() {
      return true;
    },
    async count() {
      return 0;
    },
    async bulkCreate() {
      return [];
    },
    async bulkUpdate() {
      return [];
    },
    async bulkDelete() {},
    async beginTransaction() {
      return {};
    },
    async commit() {},
    async rollback() {},
  } as any;
}

describe('resolveEffectiveDatasource — one name per routing step (#5288)', () => {
  let engine: ObjectQL;
  let primary: any;

  beforeEach(async () => {
    engine = new ObjectQL();
    primary = stubDriver('memory');
    engine.registerDriver(primary, true);
    await engine.init();
  });

  // ── Step 1: an explicit binding. The one step the old declared read got right ─

  it('answers the explicit `datasource` — the step the declared read already had', () => {
    engine.registerDriver(stubDriver('warehouse'));
    engine.registry.registerObject({ name: 'wh_fact', datasource: 'warehouse', fields: {} }, PKG);

    expect(engine.resolveEffectiveDatasource('wh_fact')).toBe('warehouse');
    // …and it is the driver `getDriver` picks, not a parallel opinion about it.
    expect(engine.getDriverForObject('wh_fact')).toBe(engine.getDriverByName('warehouse'));
  });

  // ── Step 2: a datasourceMapping rule ────────────────────────────────────────

  it('answers the mapped datasource for an object a mapping rule places (step 2)', () => {
    engine.registerDriver(stubDriver('archive'));
    engine.setDatasourceMapping([{ objectPattern: 'log_*', datasource: 'archive' }]);
    engine.registry.registerObject({ name: 'log_request', fields: {} }, PKG);

    // What the probe used to read — the declaration — says nothing at all here.
    expect(engine.getObject('log_request')?.datasource).toBeUndefined();

    expect(engine.resolveEffectiveDatasource('log_request')).toBe('archive');
    expect(engine.getDriverForObject('log_request')).toBe(engine.getDriverByName('archive'));
  });

  // ── Step 3: the ADR-0057 §3.6 lifecycle split — #5033's own object ──────────

  it('answers `telemetry` for a lifecycle-classed ledger (step 3) — the #5033 case', () => {
    engine.registerDriver(stubDriver(ObjectQL.LIFECYCLE_DATASOURCE));
    engine.registry.registerObject({
      name: 'sys_audit_log',
      lifecycle: { class: 'audit', retention: { maxAge: '90d' } },
      fields: {},
    }, PKG);

    expect(engine.resolveEffectiveDatasource('sys_audit_log')).toBe('telemetry');
    expect(engine.getDriverForObject('sys_audit_log')).toBe(
      engine.getDriverByName(ObjectQL.LIFECYCLE_DATASOURCE),
    );
  });

  it('is Zod-parse independent: the declared read answers `default`, this answers `telemetry`', () => {
    // The exact shape the defect wore in a real deployment. `ObjectSchema` gives
    // `datasource` a `.default('default')`, so a PARSED object carries the
    // string `'default'` — and the old probe reported it as if it were a
    // database name, for an object the engine had routed elsewhere.
    engine.registerDriver(stubDriver(ObjectQL.LIFECYCLE_DATASOURCE));
    const parsed = ObjectSchema.parse({
      name: 'sys_audit_log',
      label: 'Audit log',
      lifecycle: { class: 'audit', retention: { maxAge: '90d' } },
      fields: { action: { type: 'text', label: 'Action' } },
    });
    expect(parsed.datasource).toBe('default');
    engine.registry.registerObject(parsed, PKG);

    expect(engine.resolveEffectiveDatasource('sys_audit_log')).toBe('telemetry');
  });

  it('does NOT invent lifecycle routing when no telemetry datasource is registered', () => {
    // Step 3 is opt-in by the datasource's existence. Without it the ledger
    // really is on the default store, and saying `'telemetry'` would be the
    // same lie in the other direction.
    engine.registry.registerObject({
      name: 'sys_audit_log',
      lifecycle: { class: 'audit', retention: { maxAge: '90d' } },
      fields: {},
    }, PKG);

    expect(engine.resolveEffectiveDatasource('sys_audit_log')).toBeUndefined();
    expect(engine.getDriverForObject('sys_audit_log')).toBe(primary);
  });

  // ── Step 4: the owning package's defaultDatasource ──────────────────────────

  it("answers the owning package's `defaultDatasource` (step 4)", () => {
    engine.registerDriver(stubDriver('billing_db'));
    engine.registerApp({
      id: 'com.example.billing',
      name: 'billing',
      defaultDatasource: 'billing_db',
      objects: [{ name: 'invoice', fields: {} }],
    });

    expect(engine.getObject('invoice')?.datasource).toBeUndefined();
    expect(engine.resolveEffectiveDatasource('invoice')).toBe('billing_db');
    expect(engine.getDriverForObject('invoice')).toBe(engine.getDriverByName('billing_db'));
  });

  it('ignores a package default whose datasource has no driver, exactly as getDriver does', () => {
    engine.registerApp({
      id: 'com.example.billing',
      name: 'billing',
      defaultDatasource: 'never_connected',
      objects: [{ name: 'invoice', fields: {} }],
    });

    // Step 4 answers only when the driver exists — the rows are on the default
    // store, and that is what both the driver lookup and the name report.
    expect(engine.resolveEffectiveDatasource('invoice')).toBeUndefined();
    expect(engine.getDriverForObject('invoice')).toBe(primary);
  });

  // ── Step 5 / no routing at all: unchanged, and deliberately `undefined` ─────

  it('answers `undefined` for an object nothing binds — it rides the default driver', () => {
    // Unchanged from what the declared read answered for such an object, and
    // deliberate: the default driver keeps its NATURAL name (#3826, here
    // `memory`), so that name identifies a DRIVER, not a datasource anyone bound
    // this object to. Callers that want it have `getDefaultDriverName()`.
    engine.registry.registerObject({ name: 'biz_account', fields: {} }, PKG);

    expect(engine.resolveEffectiveDatasource('biz_account')).toBeUndefined();
    expect(engine.getDriverForObject('biz_account')).toBe(primary);
    expect(engine.getDefaultDriverName()).toBe('memory');
  });

  it('answers `undefined` for an object this engine has never heard of', () => {
    expect(engine.resolveEffectiveDatasource('no_such_object')).toBeUndefined();
  });

  // ── Precedence and the broken-deployment case ──────────────────────────────

  it('keeps getDriver’s precedence: an explicit binding outranks lifecycle routing', () => {
    engine.registerDriver(stubDriver(ObjectQL.LIFECYCLE_DATASOURCE));
    engine.registerDriver(stubDriver('special'));
    engine.registry.registerObject({
      name: 'probe_pinned',
      datasource: 'special',
      lifecycle: { class: 'telemetry', retention: { maxAge: '14d' } },
      fields: {},
    }, PKG);

    expect(engine.resolveEffectiveDatasource('probe_pinned')).toBe('special');
  });

  it('keeps getDriver’s precedence: a mapping rule outranks lifecycle routing', () => {
    engine.registerDriver(stubDriver(ObjectQL.LIFECYCLE_DATASOURCE));
    engine.registerDriver(stubDriver('archive'));
    engine.setDatasourceMapping([{ objectPattern: 'sys_audit_*', datasource: 'archive' }]);
    engine.registry.registerObject({
      name: 'sys_audit_log',
      lifecycle: { class: 'audit', retention: { maxAge: '90d' } },
      fields: {},
    }, PKG);

    expect(engine.resolveEffectiveDatasource('sys_audit_log')).toBe('archive');
    expect(engine.getDriverForObject('sys_audit_log')).toBe(engine.getDriverByName('archive'));
  });

  it('names a binding whose driver is missing instead of throwing', () => {
    // A naming probe exists to be READ, including while the deployment is
    // broken: `getDriver` refuses to serve this object (it will not silently
    // write to the default store — #4462), and the name it refuses ON is
    // precisely what a diagnostic needs to print.
    engine.registry.registerObject({ name: 'wh_fact', datasource: 'warehouse', fields: {} }, PKG);

    expect(engine.resolveEffectiveDatasource('wh_fact')).toBe('warehouse');
    expect(() => engine.getDriverForObject('wh_fact')).not.toThrow();
    expect(engine.getDriverForObject('wh_fact')).toBeUndefined();
  });
});
