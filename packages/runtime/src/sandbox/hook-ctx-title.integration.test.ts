// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #11293 — a lowered hook body can name a record.
//
// Everything here runs a REAL {@link ObjectQL} engine through the REAL
// {@link QuickJSScriptRunner} via {@link hookBodyRunnerFactory}, because the
// claim under test is about what a body-only hook can reach at INVOCATION time
// inside the VM — not about a host function's return value. A unit test of the
// seam would pass on a `ctx.title` that `installCtx` never wires onto the VM,
// which is exactly the `crypto.hash` / `ctx.log` shape this package has been
// bitten by twice (#4391, #7448): declared, inferred, documented, never
// installed.
//
// ## ⚠️ REBUILD IS LOAD-BEARING FOR THIS FILE — determined, not assumed
//
// `packages/runtime/vitest.config.ts` aliases `@objectstack/core`,
// `platform-objects`, `rest`, `spec`, `types`, `service-job` and
// `service-package` to source — and NOT `@objectstack/objectql`, which is
// registered in `KNOWN_UNALIASED_TEST_IMPORTS` (`scripts/check-test-source-alias.mjs`)
// for this package. So the `ObjectQL` import below AND the
// `resolveRecordTitle` / `hookRecordState` / `resolveRelatedTitleTarget`
// imports inside `body-runner.ts` all resolve through `exports` to
// `objectql/dist`. An edit to `packages/objectql/src` that is not rebuilt is
// INVISIBLE here — and the dangerous direction is that an ablation of the
// objectql half stays GREEN, certifying a pin that measured a stale artifact.
// `pnpm --filter @objectstack/objectql build` before running this file.
//
// The sibling suite `packages/objectql/src/record-title.test.ts` is the
// opposite regime (relative imports → source, no rebuild owed) and says so.
//
// ## ⚠️ The vacuity trap
//
// Four of the five record titles measured in the exemplar app are FORMULA
// fields, so a `nameField` accessor that only read stored columns would answer
// the wrong four of five — and a test whose fixture title happened to equal a
// stored column could not tell the two implementations apart. Every formula
// fixture below composes a title that matches NO single stored column, and the
// control asserts that directly.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

/**
 * A minimal driver that also COUNTS reads per object, so "resolving a formula
 * title costs no round trip" is a measurement rather than a claim.
 */
function makeCountingDriver() {
  const rows = new Map<string, Map<string, any>>();
  const reads: string[] = [];
  const storeFor = (o: string) => {
    let s = rows.get(o);
    if (!s) { s = new Map(); rows.set(o, s); }
    return s;
  };
  const matches = (all: any[], ast: any) => {
    const id = ast?.where?.id;
    if (typeof id === 'string') return all.filter((r) => r.id === id);
    return all;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      reads.push(object);
      return matches(Array.from(storeFor(object).values()), ast);
    },
    async findOne(object: string, ast: any) {
      reads.push(object);
      return matches(Array.from(storeFor(object).values()), ast)[0] ?? null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? `r_${storeFor(object).size + 1}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const row = { ...storeFor(object).get(id), ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async syncSchema() {},
    async beginTransaction() { return { __trx: 1 }; },
    async commit() {}, async rollback() {},
    /** Seed straight into storage — no engine verb, so no read is counted. */
    seed(object: string, row: Record<string, unknown>) { storeFor(object).set(String(row.id), row); },
  };
  return { driver, reads };
}

/** `crm_case` — `nameField` is a FORMULA (four of the five measured objects). */
const CASE_OBJECT = {
  name: 'tc_case',
  label: 'Case',
  nameField: 'display_title',
  fields: {
    case_number: { name: 'case_number', label: 'No.', type: 'text' as const },
    subject: { name: 'subject', label: 'Subject', type: 'text' as const },
    status: { name: 'status', label: 'Status', type: 'text' as const },
    account_id: { name: 'account_id', label: 'Account', type: 'lookup' as const, reference: 'tc_account' },
    notified: { name: 'notified', label: 'Notified', type: 'text' as const },
    display_title: {
      name: 'display_title', label: 'Title', type: 'formula' as const,
      expression: { dialect: 'cel', source: 'record.case_number + " — " + record.subject' },
    },
  },
};

/** `crm_opportunity` — the one measured object whose title is a real column. */
const OPPORTUNITY_OBJECT = {
  name: 'tc_opportunity',
  label: 'Opportunity',
  nameField: 'name',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    notified: { name: 'notified', label: 'Notified', type: 'text' as const },
  },
};

/** The lookup target — its OWN title is a formula too. */
const ACCOUNT_OBJECT = {
  name: 'tc_account',
  label: 'Account',
  nameField: 'display_title',
  fields: {
    legal_name: { name: 'legal_name', label: 'Legal name', type: 'text' as const },
    region: { name: 'region', label: 'Region', type: 'text' as const },
    display_title: {
      name: 'display_title', label: 'Title', type: 'formula' as const,
      expression: { dialect: 'cel', source: 'record.legal_name + " (" + record.region + ")"' },
    },
  },
};

const SYS = { isSystem: true } as any;

describe('#11293 ctx.title() inside a real QuickJS hook body', () => {
  let engine: ObjectQL;
  let reads: string[];
  let seed: (object: string, row: Record<string, unknown>) => void;

  const wire = async (
    object: string,
    source: string,
    capabilities: string[] = [],
  ) => {
    engine = new ObjectQL();
    const d = makeCountingDriver();
    reads = d.reads;
    seed = (o, r) => d.driver.seed(o, r);
    engine.registerDriver(d.driver, true);
    await engine.init();
    for (const o of [CASE_OBJECT, OPPORTUNITY_OBJECT, ACCOUNT_OBJECT]) {
      engine.registry.registerObject(o as any, 'test');
    }
    engine.setDefaultBodyRunner(
      hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'test' }),
    );
    bindHooksToEngine(
      engine,
      [{
        name: 'tc_title_hook',
        object,
        events: ['beforeUpdate'],
        body: { language: 'js', source, capabilities },
      } as any],
      { packageId: 'test' },
    );
  };

  beforeEach(() => { reads = []; });

  it('resolves a FORMULA nameField — the majority case — from inside the body', async () => {
    // The body writes what it resolved into a stored column, so the assertion
    // reads a value that really crossed the VM boundary rather than a host
    // return value the sandbox may never have seen.
    await wire('tc_case', "ctx.input.notified = 'closed: ' + (await ctx.title());");
    seed('tc_case', { id: 'c1', case_number: 'CASE-0042', subject: 'Printer on fire', status: 'open' });

    const updated: any = await engine.update(
      'tc_case', { id: 'c1', status: 'closed' }, { context: SYS },
    );
    expect(updated.notified).toBe('closed: CASE-0042 — Printer on fire');
  }, 30000);

  it('CONTROL — that title equals no single stored column, so the formula genuinely ran', async () => {
    await wire('tc_case', "ctx.input.notified = await ctx.title();");
    const stored = { id: 'c2', case_number: 'CASE-0043', subject: 'Badge reader down', status: 'open' };
    seed('tc_case', stored);

    const updated: any = await engine.update(
      'tc_case', { id: 'c2', status: 'closed' }, { context: SYS },
    );
    expect(updated.notified).toBe('CASE-0043 — Badge reader down');
    // A stored-column-only implementation could only ever have produced one of
    // these values, or the id.
    expect(Object.values(stored)).not.toContain(updated.notified);
    expect(updated.notified).not.toBe('c2');
  }, 30000);

  it('MEASUREMENT — a formula title for THIS record costs no extra read', async () => {
    await wire('tc_case', "ctx.input.notified = await ctx.title();");
    seed('tc_case', { id: 'c3', case_number: 'CASE-0044', subject: 'Coffee machine', status: 'open' });

    reads.length = 0;
    await engine.update('tc_case', { id: 'c3', status: 'closed' }, { context: SYS });

    // Whatever the write itself reads, NONE of it is attributable to the title:
    // the same update with a body that never calls `ctx.title()` reads exactly
    // as much. That equality is the measurement — an absolute count would just
    // pin the update path's own behaviour.
    const withTitle = reads.length;

    await wire('tc_case', "ctx.input.notified = 'x';");
    seed('tc_case', { id: 'c3', case_number: 'CASE-0044', subject: 'Coffee machine', status: 'open' });
    reads.length = 0;
    await engine.update('tc_case', { id: 'c3', status: 'closed' }, { context: SYS });

    expect(withTitle).toBe(reads.length);
  }, 30000);

  it('resolves a STORED-COLUMN nameField the same way', async () => {
    await wire('tc_opportunity', "ctx.input.notified = await ctx.title();");
    seed('tc_opportunity', { id: 'o1', name: 'Acme — Phase 2' });

    const updated: any = await engine.update(
      'tc_opportunity', { id: 'o1', notified: 'pending' }, { context: SYS },
    );
    expect(updated.notified).toBe('Acme — Phase 2');
  }, 30000);

  it('resolves a LOOKUP-RELATED record\'s title — the case a body only holds an id for', async () => {
    await wire(
      'tc_case',
      "ctx.input.notified = 'account: ' + (await ctx.title('account_id'));",
      ['api.read'],
    );
    seed('tc_account', { id: 'acc_9', legal_name: 'Acme Industrial', region: 'EMEA' });
    seed('tc_case', {
      id: 'c4', case_number: 'CASE-0045', subject: 'Shipment late',
      status: 'open', account_id: 'acc_9',
    });

    const updated: any = await engine.update(
      'tc_case', { id: 'c4', status: 'closed' }, { context: SYS },
    );
    // The RELATED object's own title is a formula too — so this arm also proves
    // the related read is not just echoing a stored column back.
    expect(updated.notified).toBe('account: Acme Industrial (EMEA)');
    expect(updated.notified).not.toContain('acc_9');
  }, 30000);

  it('MEASUREMENT — a related title costs exactly ONE extra read, formula included', async () => {
    // The related object's `nameField` is itself a FORMULA, and the engine's
    // read path materializes formula fields onto what it returns — so the one
    // `findOne` is the whole cost. There is no second pass and no per-field
    // round trip, which is the number that decides whether this accessor is
    // usable in a hook body's hot path.
    const baseline = "ctx.input.notified = 'x';";
    const withRelated = "ctx.input.notified = await ctx.title('account_id');";
    const measure = async (source: string, caps: string[]) => {
      await wire('tc_case', source, caps);
      seed('tc_account', { id: 'acc_9', legal_name: 'Acme Industrial', region: 'EMEA' });
      seed('tc_case', {
        id: 'c9', case_number: 'CASE-0050', subject: 'Cost', status: 'open', account_id: 'acc_9',
      });
      reads.length = 0;
      await engine.update('tc_case', { id: 'c9', status: 'closed' }, { context: SYS });
      return [...reads];
    };

    const base = await measure(baseline, []);
    const related = await measure(withRelated, ['api.read']);

    expect(related.length - base.length).toBe(1);
    // …and the one extra read is of the TARGET object, not a re-read of this one.
    expect(related.filter((o) => o === 'tc_account').length).toBe(1);
    expect(base.filter((o) => o === 'tc_account').length).toBe(0);
  }, 30000);

  it('an EMPTY lookup answers null rather than throwing — an unset relationship is ordinary', async () => {
    await wire(
      'tc_case',
      "var t = await ctx.title('account_id'); ctx.input.notified = (t === null ? 'none' : t);",
      ['api.read'],
    );
    seed('tc_case', { id: 'c5', case_number: 'CASE-0046', subject: 'No account', status: 'open' });

    const updated: any = await engine.update(
      'tc_case', { id: 'c5', status: 'closed' }, { context: SYS },
    );
    expect(updated.notified).toBe('none');
  }, 30000);

  it('the related form is GATED by api.read; the bare form needs no capability', async () => {
    // Gate arm: same body, capability withheld.
    await wire('tc_case', "ctx.input.notified = await ctx.title('account_id');", []);
    seed('tc_account', { id: 'acc_9', legal_name: 'Acme Industrial', region: 'EMEA' });
    seed('tc_case', {
      id: 'c6', case_number: 'CASE-0047', subject: 'Gated', status: 'open', account_id: 'acc_9',
    });

    await expect(
      engine.update('tc_case', { id: 'c6', status: 'closed' }, { context: SYS }),
    ).rejects.toThrow(/capability 'api\.read' not granted/);

    // CONTROL arm — the SAME hook with NO capabilities resolving THIS record's
    // title succeeds. Without it, the rejection above could equally be produced
    // by a `ctx.title` that is broken for every call, and the gate would be
    // measuring nothing.
    await wire('tc_case', "ctx.input.notified = await ctx.title();", []);
    seed('tc_case', { id: 'c7', case_number: 'CASE-0048', subject: 'Ungated', status: 'open' });
    const updated: any = await engine.update(
      'tc_case', { id: 'c7', status: 'closed' }, { context: SYS },
    );
    expect(updated.notified).toBe('CASE-0048 — Ungated');
  }, 30000);

  it('a typo\'d field name is REFUSED, not answered with a missing title', async () => {
    await wire('tc_case', "ctx.input.notified = await ctx.title('acount_id');", ['api.read']);
    seed('tc_case', { id: 'c8', case_number: 'CASE-0049', subject: 'Typo', status: 'open' });

    await expect(
      engine.update('tc_case', { id: 'c8', status: 'closed' }, { context: SYS }),
    ).rejects.toThrow(/not a declared field/);
  }, 30000);
});
