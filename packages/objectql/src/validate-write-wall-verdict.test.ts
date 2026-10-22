// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25062] `validate()` reads the Layer 0 tenant write wall's verdict on each
// row through `registerWriteWallVerdict`, and nothing else, to answer a row's
// `organization_id` as the write does.
//
// ## The defect
//
// The preview runs no middleware, so the wall never judged its rows. It ran
// the static-`readonly` strip unconditionally: a caller's organization the
// wall admits (and the write stores as sent, `judgesOrganization`) was
// reported DROPPED, and an organization the wall refuses (the write answers
// 403) was answered VALID.
//
// ## What this file holds the engine to, with a stand-in verdict
//
//  - unregistered, or answering `null`: the strip runs exactly as before;
//  - admitted, the wall judging the organization: the column stays on the row
//    and is not reported, while every other read-only key is still taken, and
//    an AUTHORED read-only `organization_id` keeps its strip;
//  - admitted, the wall not judging it: the strip takes it, as before;
//  - refused: THAT row answers `valid: false` with the verdict's field, code
//    and message, its neighbours are judged as before, the set's `valid` is
//    the conjunction, and the refused row reaches no strip (the write refuses
//    it before any strip runs), so the batch listener hears nothing from it;
//  - the verdict is asked with the rows as the preview holds them (after the
//    defaults, before any hook), the mode and the caller's context;
//  - an `update`-mode preview spares the column on the update's own view;
//  - a verdict that answers the wrong number of rows, or throws, rejects the
//    preview.
//
// The producer is `@objectstack/plugin-security` (`writeWallVerdict`, from the
// method its step 3.7 calls). The two packages together, against the real
// write, are pinned in `organizations/src/validate-preview-wall-verdict.test.ts`
// and, at the HTTP import door, `rest/src/import-dryrun-tenant-wall-parity.test.ts`.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import type { WriteWallRowVerdict, WriteWallVerdict } from './engine.js';

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
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row?.[k] === v;
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // The caller's bound, applied AFTER the filter and by PRESENCE
      // (`check:objectql-double-limit`).
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const row = { ...data };
      storeFor(object).set(String(data.id), row);
      return row;
    },
    async update() { return null; }, async updateMany() { return 0; },
    async delete() { return true; }, async count() { return 0; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

const OBJECT = 'qa_ledger';
const AUTHORED = 'qa_authored';
const NAMED = 'org_c';
const SESSION = { userId: 'usr_member', tenantId: 'org_a' };
const DENIED = 'PERMISSION_DENIED';
const PLACEMENT = "[Security] Access denied: the insert would place 'qa_ledger' in another tenant (organization_id is outside the caller's organization scope)";
const NO_ORGANIZATION = "[Security] Access denied: 'qa_ledger' is scoped to an organization, and this session has no active organization — so this insert has no organization to place the record in. Join or select an active organization and retry.";

const ADMIT_JUDGED: WriteWallRowVerdict = { admitted: true, judgesOrganization: true };
const ADMIT_UNJUDGED: WriteWallRowVerdict = { admitted: true, judgesOrganization: false };
const refused = (field: 'organization_id' | '_record', message: string): WriteWallRowVerdict =>
  ({ admitted: false, field, code: DENIED, message });

describe('[#25062] validate() answers a row\'s organization from the write wall\'s verdict', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  /** Every call the stand-in verdict received. */
  let asked: Array<{ object: string; operation: string; context: unknown; rows: Record<string, unknown>[] }>;

  beforeEach(async () => {
    asked = [];
    const logger: any = {
      warn() {}, debug() {}, info() {}, error() {}, trace() {}, fatal() {},
      child() { return logger; },
    };
    engine = new ObjectQL({ logger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      fields: {
        name: { type: 'text' },
        tier: { type: 'text', defaultValue: 'standard' },
        // Another read-only key the caller may send: the spare never covers it.
        ref_code: { type: 'text', readonly: true },
      },
    } as any);
    // An app object whose AUTHOR declares its own read-only organization_id:
    // the wall's verdict does not spare it, as it does not on the write.
    engine.registry.registerObject({
      name: AUTHORED,
      fields: { name: { type: 'text' }, organization_id: { type: 'text', readonly: true } },
    } as any);
  });

  /** Register a stand-in verdict answering `answer(rows)` and recording the call. */
  const register = (answer: (rows: readonly Record<string, unknown>[]) => readonly WriteWallRowVerdict[] | null) => {
    const verdict: WriteWallVerdict = async (object, operation, context, rows) => {
      asked.push({ object, operation, context, rows: rows.map((r) => ({ ...r })) });
      return answer(rows);
    };
    engine.registerWriteWallVerdict(verdict);
  };

  const preview = async (data: unknown, mode: 'insert' | 'update' = 'insert', object = OBJECT) => {
    const heard: Array<{ fields: string[]; reason: string }> = [];
    const result = await engine.validate(object, data as any, {
      mode,
      context: SESSION as any,
      onFieldsDropped: (e: any) => heard.push({ fields: [...e.fields], reason: e.reason }),
    });
    return { result, heard };
  };
  const ORG_DROP = { object: OBJECT, fields: ['organization_id'], reason: 'readonly' };

  it('PRECONDITION: the platform injects organization_id as a read-only column on this object', () => {
    const field = (engine.getSchema(OBJECT) as any)?.fields?.organization_id;
    expect(field?.readonly, 'the strip has the column to take').toBe(true);
  });

  it('UNREGISTERED: the strip takes the organization and reports it, exactly as before', async () => {
    const { result, heard } = await preview({ name: 'one', organization_id: NAMED });

    expect(result.valid).toBe(true);
    expect(result.results[0]?.droppedFields).toEqual([ORG_DROP]);
    expect(heard).toEqual([{ fields: ['organization_id'], reason: 'readonly' }]);
  });

  it('NULL: a verdict that does not ask the wall leaves the strip as before', async () => {
    register(() => null);
    const { result } = await preview({ name: 'one', organization_id: NAMED });

    expect(asked.length).toBeGreaterThan(0);
    expect(result.results[0]).toEqual({ valid: true, errors: [], warnings: [], droppedFields: [ORG_DROP] });
  });

  it('ADMITTED and JUDGED: the organization stays on the row and is not reported; another read-only key still is', async () => {
    register((rows) => rows.map(() => ADMIT_JUDGED));
    const { result, heard } = await preview({ name: 'one', organization_id: NAMED, ref_code: 'X-1' });

    expect(result.valid).toBe(true);
    expect(result.results[0]?.droppedFields).toEqual([{ object: OBJECT, fields: ['ref_code'], reason: 'readonly' }]);
    expect(heard).toEqual([{ fields: ['ref_code'], reason: 'readonly' }]);
  });

  it('ADMITTED, NOT JUDGED: the strip takes the organization, as before', async () => {
    register((rows) => rows.map(() => ADMIT_UNJUDGED));
    const { result } = await preview({ name: 'one', organization_id: NAMED });

    expect(result.results[0]?.droppedFields).toEqual([ORG_DROP]);
  });

  it('ADMITTED and JUDGED on an AUTHORED read-only organization_id: the author\'s declaration keeps the strip', async () => {
    register((rows) => rows.map(() => ADMIT_JUDGED));
    const { result } = await preview({ name: 'one', organization_id: NAMED }, 'insert', AUTHORED);

    expect(result.results[0]?.droppedFields).toEqual([{ object: AUTHORED, fields: ['organization_id'], reason: 'readonly' }]);
  });

  it('REFUSED: that row answers the write\'s refusal, its neighbours are judged as before, and the set is the conjunction', async () => {
    register((rows) => rows.map((row) => (row.name === 'forged' ? refused('organization_id', PLACEMENT) : ADMIT_JUDGED)));
    const { result, heard } = await preview([
      { name: 'first', organization_id: 'org_a' },
      { name: 'forged', organization_id: NAMED, ref_code: 'X-2' },
      { name: 'third', ref_code: 'X-3' },
    ]);

    expect(result.valid).toBe(false);
    expect(result.results[0]).toEqual({ valid: true, errors: [], warnings: [] });
    expect(result.results[1]).toEqual({
      valid: false,
      errors: [{ field: 'organization_id', code: DENIED, message: PLACEMENT }],
      warnings: [],
    });
    expect(result.results[2]).toEqual({
      valid: true, errors: [], warnings: [],
      droppedFields: [{ object: OBJECT, fields: ['ref_code'], reason: 'readonly' }],
    });
    // The refused row reaches no strip: the batch listener hears the third
    // row's `ref_code` and nothing of the second's.
    expect(heard).toEqual([{ fields: ['ref_code'], reason: 'readonly' }]);
  });

  it('REFUSED on the caller\'s state: the refusal names `_record`', async () => {
    register((rows) => rows.map(() => refused('_record', NO_ORGANIZATION)));
    const { result } = await preview({ name: 'one' });

    expect(result.valid).toBe(false);
    expect(result.results[0]?.errors).toEqual([{ field: '_record', code: DENIED, message: NO_ORGANIZATION }]);
  });

  it('ASKED with the rows as the preview holds them: after the defaults, before any hook, with the mode and the context', async () => {
    let hookRan = false;
    engine.registerHook('beforeInsert', async () => { hookRan = true; }, { object: OBJECT });
    register((rows) => rows.map(() => ADMIT_JUDGED));
    await preview({ name: 'one', organization_id: NAMED });

    expect(asked, 'the strips left the row alone, so it is asked once').toHaveLength(1);
    expect(asked[0]).toMatchObject({ object: OBJECT, operation: 'insert', context: SESSION });
    expect(asked[0]!.rows).toEqual([expect.objectContaining({ name: 'one', organization_id: NAMED, tier: 'standard' })]);
    expect(hookRan, 'the preview runs no hook').toBe(false);
  });

  it('ASKED AGAIN about a row the strips changed, as the write\'s stored-image half judges it, and only about that row', async () => {
    // The stand-in answers as a crossing operator's wall does: it does not
    // judge the organization, and a stored row naming none has nowhere to land.
    register((rows) => rows.map((row) => (row.organization_id == null ? refused('_record', NO_ORGANIZATION) : ADMIT_UNJUDGED)));
    const { result, heard } = await preview([
      { name: 'named', organization_id: NAMED },
      { name: 'unnamed' },
    ]);

    expect(asked).toHaveLength(2);
    expect(asked[0]!.rows.map((r) => r.name)).toEqual(['named', 'unnamed']);
    expect(asked[1]!.rows, 'the stripped row, as the write would store it').toEqual([
      expect.not.objectContaining({ organization_id: expect.anything() }),
    ]);
    expect(asked[1]!.rows[0]).toMatchObject({ name: 'named' });
    expect(result.results[0]).toEqual({
      valid: false,
      errors: [{ field: '_record', code: DENIED, message: NO_ORGANIZATION }],
      warnings: [],
    });
    // The second row named no organization to begin with: refused on the
    // first answer, never stripped and never asked again.
    expect(result.results[1]?.valid).toBe(false);
    expect(heard, 'a refused row drops nothing').toEqual([]);
  });

  it('UPDATE mode: a judged organization stays on the update\'s own view; an unjudged one is taken', async () => {
    storeFor(OBJECT).set('r1', { id: 'r1', name: 'stored', organization_id: 'org_a' });

    register((rows) => rows.map(() => ADMIT_JUDGED));
    const judged = await preview({ id: 'r1', organization_id: NAMED }, 'update');
    expect(asked[0]).toMatchObject({ operation: 'update', rows: [{ id: 'r1', organization_id: NAMED }] });
    expect(judged.result.results[0]).toEqual({ valid: true, errors: [], warnings: [] });

    register((rows) => rows.map(() => ADMIT_UNJUDGED));
    const unjudged = await preview({ id: 'r1', organization_id: NAMED }, 'update');
    expect(unjudged.result.results[0]?.droppedFields).toEqual([ORG_DROP]);
  });

  it('a verdict that answers the wrong number of rows rejects the preview', async () => {
    register(() => [ADMIT_JUDGED]);
    await expect(preview([{ name: 'one' }, { name: 'two' }])).rejects.toThrow(/answered 1 verdict\(s\) for 2 row\(s\)/);
  });

  it('a verdict that throws rejects the preview, as a refusal to resolve fails the write', async () => {
    engine.registerWriteWallVerdict(async () => { throw new Error('wall unavailable'); });
    await expect(preview({ name: 'one' })).rejects.toThrow('wall unavailable');
  });
});
