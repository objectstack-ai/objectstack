// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22445 — an `update`-mode `validate()` preview judges the STORED ROW merged
// with the patch, the record the by-id update judges.
//
// ## The defect
//
// The preview read no stored row, so the record its rules judged held only
// the patch. A rule that reads a column the patch omits faulted there
// (`No such key`), and the preview refused a row that the real by-id update
// admits, because the update reads its prior row first. The refusal then said
// the omitted column was one "which this object does not declare", sending the
// author looking for a field that exists.
//
// ## The fix
//
// A row that carries its address — the `id` every update door folds into the
// payload — is judged against the row that id names, read through the READ
// DOOR under the caller's own context. With no stored row (no address, or an id
// naming no row this caller can read) the row is judged on the patch alone, and
// the refusal names the real cause: the value was not supplied.
//
// The fixture is the showcase's `showcase_cascade` shape (a `country` →
// `province` cascade whose option `visibleWhen`s read `country`), plus a
// `note` whose `requiredWhen` reads `country`.
//
// ## Pins
//
//  (a) the two preview calls the card measured admit over a stored
//      `country: 'cn'` row, and the by-id update admits the same patches;
//  (b) control: a preview whose merge really violates a rule still refuses,
//      with the refusal the write gives;
//  (c) with no stored row the refusal says the value was not supplied, never
//      "does not declare"; an undeclared key keeps "does not declare";
//  (d) a caller who cannot read the stored row gets no verdict about its
//      columns: the verdict is the one a missing row gets, whatever the hidden
//      row holds; a column the caller may not read is judged as empty;
//  (e) the real door: the import dry run of a matched row, through the
//      protocol, admits what the import's write admits and refuses what it
//      refuses.
//
// (a), (c) and (e) were red before the fix.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel, runImport, type ImportProtocolLike } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { ValidationError } from './validation/record-validator.js';

const OBJECT = 'pv_cascade';

const CASCADE = {
  name: OBJECT,
  label: 'Preview Cascade',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    owner_name: { name: 'owner_name', label: 'Owner', type: 'text' },
    country: {
      name: 'country', label: 'Country', type: 'select',
      options: [{ label: 'China', value: 'cn' }, { label: 'United States', value: 'us' }],
    },
    province: {
      name: 'province', label: 'Province', type: 'select',
      options: [
        { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
        { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
      ],
    },
    note: { name: 'note', label: 'Note', type: 'text', requiredWhen: "record.country == 'us'" },
  },
};

/** A store-backed driver: what is stored is what a later read answers. */
function makeStoreDriver() {
  const rows = new Map<string, Record<string, any>>();
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`store driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return Object.entries(v).every(([op, target]) => {
          if (op === '$eq') return row?.[k] === target;
          if (op === '$in') return Array.isArray(target) && target.includes(row?.[k]);
          throw new Error(`store driver: unsupported operator ${op}`);
        });
      }
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'pv-store', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async find(_o: string, ast: any) {
      const hits = Array.from(rows.values()).filter((r) => matches(r, ast?.where));
      return (typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits).map((r) => ({ ...r }));
    },
    async findOne(_o: string, ast: any) {
      for (const r of rows.values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(_o: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `rec_${n}`;
      const row = { ...data, id };
      rows.set(id, row);
      return { ...row };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      const row = { ...rows.get(id), ...data, id };
      rows.set(id, row);
      return { ...row };
    },
    async delete(_o: string, id: string) { return rows.delete(id); },
    async count(_o: string, ast: any) {
      return Array.from(rows.values()).filter((r) => matches(r, ast?.where)).length;
    },
  };
  return { driver, rows };
}

function makeEngine(objects: any[] = [CASCADE]) {
  const store = makeStoreDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver, true);
  engine.registerApp({ id: 'pv', name: 'Preview Stored Row', objects } as any);
  return { engine, rows: store.rows };
}

/** The one row's verdict, reduced to what a caller branches on. */
async function verdictOf(engine: ObjectQL, data: Record<string, unknown>, context?: Record<string, unknown>) {
  const out = await engine.validate(OBJECT, data, { mode: 'update', ...(context ? { context: context as any } : {}) });
  expect(out.results).toHaveLength(1);
  return out.results![0]!;
}

/** The field findings of a refused write, or `null` when the write landed. */
async function writeRefusal(write: () => Promise<unknown>) {
  try {
    await write();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    const err = e as ValidationError;
    expect(err.code).toBe('VALIDATION_FAILED');
    return err.fields.map((f) => ({ field: f.field, code: f.code }));
  }
}

const NOT_DECLARED = 'which this object does not declare';
const NOT_SUPPLIED = 'its value was not supplied';

describe('#22445 — an update-mode preview judges the stored row merged with the patch', () => {
  let engine: ObjectQL;
  let rows: Map<string, Record<string, any>>;

  beforeEach(() => {
    ({ engine, rows } = makeEngine());
    rows.set('c1', { id: 'c1', name: 'one', country: 'cn' });
  });

  describe('(a) the card\'s two preview calls admit over a stored country: cn row', () => {
    it.each([
      ['a cascade pick', { province: 'zj' }],
      ['a note', { note: 'x' }],
    ])('%s — the preview admits it, and so does the by-id update', async (_label, patch) => {
      const preview = await verdictOf(engine, { ...patch, id: 'c1' });
      expect(preview).toMatchObject({ valid: true, errors: [] });

      expect(await writeRefusal(() => engine.update(OBJECT, { ...patch, id: 'c1' }))).toBeNull();
      expect(rows.get('c1')).toMatchObject({ country: 'cn', ...patch });
    });
  });

  describe('(b) control: a merge that really violates a rule still refuses, as the write does', () => {
    it.each([
      // The patch flips the condition true and does not supply the field.
      ['a requiredWhen turned true', { country: 'us' }, [{ field: 'note', code: 'required' }]],
      // The stored country makes the picked option invisible.
      ['an option the stored row does not offer', { province: 'ca' }, [{ field: 'province', code: 'invalid_option' }]],
    ])('%s', async (_label, patch, expected) => {
      const preview = await verdictOf(engine, { ...patch, id: 'c1' });
      expect(preview.valid).toBe(false);
      expect(preview.errors.map((e) => ({ field: e.field, code: e.code }))).toEqual(expected);

      expect(await writeRefusal(() => engine.update(OBJECT, { ...patch, id: 'c1' }))).toEqual(expected);
      expect(rows.get('c1')).toEqual({ id: 'c1', name: 'one', country: 'cn' });
    });
  });

  describe('(a) the image is the row as STORED, the one the write judges', () => {
    it('a formula column the read door evaluates is judged as the write judges it', async () => {
      const { engine: e2, rows: r2 } = makeEngine([{
        name: OBJECT, label: 'Preview Amount',
        fields: {
          amount: { name: 'amount', label: 'Amount', type: 'number' },
          doubled: { name: 'doubled', label: 'Doubled', type: 'formula', expression: 'record.amount * 2', returnType: 'number' },
          memo: { name: 'memo', label: 'Memo', type: 'text', requiredWhen: 'record.doubled > 100' },
          title: { name: 'title', label: 'Title', type: 'text' },
        },
      }]);
      r2.set('a1', { id: 'a1', amount: 80 });
      // Precondition: the read door SERVES the formula, the store holds no column for it.
      expect((await e2.findOne(OBJECT, { where: { id: 'a1' } }))?.doubled).toBe(160);

      const preview = await verdictOf(e2, { title: 't', id: 'a1' });
      const write = await writeRefusal(() => e2.update(OBJECT, { title: 't', id: 'a1' }));
      expect(preview.errors.map((e) => ({ field: e.field, code: e.code }))).toEqual(write ?? []);
    });
  });

  describe('(c) with no stored row the refusal says the value was not supplied', () => {
    it.each([
      ['no address', {}],
      ['an id naming no row', { id: 'missing' }],
    ])('%s — the requiredWhen and the option gate name the real cause', async (_label, address) => {
      const preview = await verdictOf(engine, { province: 'zj', ...address });
      expect(preview.valid).toBe(false);
      const byField = Object.fromEntries(preview.errors.map((e) => [e.field, e]));
      for (const [field, rule] of [['note', 'requiredWhen'], ['province', 'visibleWhen']] as const) {
        expect(byField[field]).toMatchObject({
          code: 'rule_violation',
          constraint: expect.objectContaining({ rule, reason: 'unevaluable', missingKey: 'country' }),
        });
        expect(byField[field]!.message).toContain(NOT_SUPPLIED);
        expect(byField[field]!.message).not.toContain(NOT_DECLARED);
      }
    });

    it('a validations[] rule reading the omitted column names the same cause', async () => {
      const { engine: e2 } = makeEngine([{
        ...CASCADE,
        validations: [
          { name: 'us_needs_note', type: 'script', severity: 'error', message: 'US rows need a note',
            condition: "record.country == 'us' && record.note == null" },
          { name: 'us_branch', type: 'conditional', severity: 'error', message: 'never shown',
            when: "record.country == 'us'",
            then: { name: 'us_branch_then', type: 'script', severity: 'error', message: 'never',
              condition: 'false' } },
        ],
      }]);
      const out = await e2.validate(OBJECT, { name: 'renamed' }, { mode: 'update' });
      // The engine's findings carry `constraint` beyond the wire triple the response type names.
      const ruleOf = (e: object) => (e as { constraint?: { rule?: string } }).constraint?.rule;
      const entries = out.results![0]!.errors.filter((e) => ruleOf(e) !== undefined && ruleOf(e) !== 'requiredWhen');
      expect(entries.map(ruleOf).sort()).toEqual(['us_branch', 'us_needs_note']);
      for (const entry of entries) {
        // A `validations[]` rule with no `fields` reports against the record.
        expect(entry).toMatchObject({
          field: '_record', code: 'rule_violation', constraint: expect.objectContaining({ reason: 'unevaluable' }),
        });
        expect(entry.message).toContain(NOT_SUPPLIED);
        expect(entry.message).not.toContain(NOT_DECLARED);
      }
    });

    it('control: a key the object does not declare keeps "does not declare"', async () => {
      const { engine: e2 } = makeEngine([{
        ...CASCADE,
        fields: { ...CASCADE.fields, note: { ...CASCADE.fields.note, requiredWhen: "record.contry == 'us'" } },
      }]);
      const out = await e2.validate(OBJECT, { note: 'x' }, { mode: 'update' });
      const entry = out.results![0]!.errors.find((e) => e.field === 'note')!;
      expect(entry).toMatchObject({
        code: 'rule_violation',
        constraint: expect.objectContaining({ rule: 'requiredWhen', reason: 'unevaluable', missingKey: 'contry' }),
      });
      expect(entry.message).toContain(NOT_DECLARED);
      expect(entry.message).not.toContain(NOT_SUPPLIED);
    });
  });

  describe('(d) the stored row is read under the caller\'s read scope', () => {
    /** Read scoping shaped like the security/sharing middlewares: a caller reads only its own rows. */
    function scopeReadsToOwner(ql: ObjectQL) {
      ql.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        const userId = ctx.context?.userId;
        if (userId && !ctx.context?.isSystem && ['find', 'findOne'].includes(ctx.operation)) {
          const scoped = { owner_name: userId };
          const ast: any = ctx.ast ?? { object: ctx.object };
          ast.where = ast.where ? { $and: [ast.where, scoped] } : scoped;
          ctx.ast = ast;
        }
        await next();
      });
    }

    /** Field-level read masking shaped like the security middleware's result mask. */
    function hideCountryFrom(ql: ObjectQL, userId: string) {
      ql.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        await next();
        if (ctx.context?.userId !== userId || !['find', 'findOne'].includes(ctx.operation)) return;
        const strip = (r: any) => { if (r && typeof r === 'object') delete r.country; };
        if (Array.isArray(ctx.result)) ctx.result.forEach(strip);
        else strip(ctx.result);
      });
    }

    it('the owner\'s preview judges the stored row', async () => {
      scopeReadsToOwner(engine);
      rows.set('c1', { id: 'c1', name: 'one', owner_name: 'alice', country: 'cn' });
      expect(await verdictOf(engine, { province: 'zj', id: 'c1' }, { userId: 'alice' })).toMatchObject({ valid: true });
    });

    it('a caller who cannot read the row gets the verdict a missing row gets, whatever the row holds', async () => {
      scopeReadsToOwner(engine);
      const missing = await verdictOf(engine, { province: 'zj', id: 'nowhere' }, { userId: 'bob' });
      expect(missing.valid).toBe(false);
      for (const country of ['cn', 'us']) {
        rows.set('c1', { id: 'c1', name: 'one', owner_name: 'alice', country });
        expect(await verdictOf(engine, { province: 'zj', id: 'c1' }, { userId: 'bob' })).toEqual(missing);
      }
    });

    it('a column the caller may not read is judged as empty, whatever it holds', async () => {
      hideCountryFrom(engine, 'carol');
      const verdicts = [];
      for (const country of ['cn', 'us']) {
        rows.set('c1', { id: 'c1', name: 'one', country });
        verdicts.push(await verdictOf(engine, { province: 'zj', id: 'c1' }, { userId: 'carol' }));
      }
      expect(verdicts[0]).toEqual(verdicts[1]);
      // Judged as empty: the cascade predicate answers a clean false, not a fault.
      expect(verdicts[0]!.errors.map((e) => ({ field: e.field, code: e.code }))).toEqual([
        { field: 'province', code: 'invalid_option' },
      ]);
      // Control: a caller who may read the column gets the stored row's verdict.
      expect(await verdictOf(engine, { province: 'zj', id: 'c1' }, { userId: 'dave' })).toMatchObject({ valid: false });
      rows.set('c1', { id: 'c1', name: 'one', country: 'cn' });
      expect(await verdictOf(engine, { province: 'zj', id: 'c1' }, { userId: 'dave' })).toMatchObject({ valid: true });
    });

    /**
     * A partial-masking rule shaped like the security plugin's read mask
     * (`field-masker.ts` `maskRecord`): the KEY stays, the VALUE is replaced
     * with its mask (a value too short to keep both ends is masked whole).
     */
    function maskCountryFor(ql: ObjectQL, userId: string) {
      ql.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
        await next();
        if (ctx.context?.userId !== userId || !['find', 'findOne'].includes(ctx.operation)) return;
        const mask = (r: any) => {
          if (r && typeof r === 'object' && typeof r.country === 'string') r.country = '*'.repeat(r.country.length);
        };
        if (Array.isArray(ctx.result)) ctx.result.forEach(mask);
        else mask(ctx.result);
      });
    }

    it('(d2) a column served partially masked is judged as empty, whatever it holds', async () => {
      maskCountryFor(engine, 'erin');
      const verdicts = [];
      for (const country of ['cn', 'us']) {
        rows.set('c1', { id: 'c1', name: 'one', country });
        // Precondition: the read door serves the key, masked.
        expect(await engine.findOne(OBJECT, { where: { id: 'c1' }, context: { userId: 'erin' } as any })).toMatchObject({ country: '**' });
        verdicts.push(await verdictOf(engine, { province: 'zj', id: 'c1' }, { userId: 'erin' }));
      }
      expect(verdicts[0]).toEqual(verdicts[1]);
      expect(verdicts[0]!.errors.map((e) => ({ field: e.field, code: e.code }))).toEqual([
        { field: 'province', code: 'invalid_option' },
      ]);
    });

    it('(d3) control: a caller served the column unmasked gets the stored row\'s verdict', async () => {
      maskCountryFor(engine, 'erin');
      rows.set('c1', { id: 'c1', name: 'one', country: 'cn' });
      expect(await verdictOf(engine, { province: 'zj', id: 'c1' }, { userId: 'dave' })).toMatchObject({ valid: true, errors: [] });
      rows.set('c1', { id: 'c1', name: 'one', country: 'us' });
      const refused = await verdictOf(engine, { province: 'zj', id: 'c1' }, { userId: 'dave' });
      expect(refused.errors.map((e) => ({ field: e.field, code: e.code }))).toEqual([
        { field: 'province', code: 'invalid_option' },
      ]);
    });
  });

  describe('(a) a file reference the caller can read is judged as the id it stores', () => {
    it('the read door\'s expansion of a file id does not turn the column empty', async () => {
      const { engine: e2, rows: r2 } = makeEngine([
        {
          name: 'sys_file', label: 'File',
          fields: {
            name: { name: 'name', label: 'Name', type: 'text' },
            status: { name: 'status', label: 'Status', type: 'text' },
            url: { name: 'url', label: 'URL', type: 'text' },
          },
        },
        {
          name: OBJECT, label: 'Preview Attachment',
          fields: {
            attachment: { name: 'attachment', label: 'Attachment', type: 'file' },
            memo: { name: 'memo', label: 'Memo', type: 'text', requiredWhen: 'record.attachment != null' },
            title: { name: 'title', label: 'Title', type: 'text' },
          },
        },
      ]);
      r2.set('f1', { id: 'f1', name: 'a.pdf', status: 'committed', url: '/files/f1' });
      r2.set('a1', { id: 'a1', attachment: 'f1', memo: 'kept' });
      // Precondition: the read door serves the file EXPANDED, the store holds the id.
      const served = await e2.findOne(OBJECT, { where: { id: 'a1' } });
      expect(typeof served?.attachment).toBe('object');

      // Clearing the memo the stored attachment requires: the write refuses it.
      const preview = await verdictOf(e2, { memo: null, id: 'a1' });
      const write = await writeRefusal(() => e2.update(OBJECT, { memo: null, id: 'a1' }));
      expect(write).toEqual([{ field: 'memo', code: 'required' }]);
      expect(preview.errors.map((e) => ({ field: e.field, code: e.code }))).toEqual(write);
    });
  });
});

describe('#22445 (e) — the import dry run of a matched row, through the protocol', () => {
  let kernel: ObjectKernel;
  let objectql: ObjectQL;
  let store: ReturnType<typeof makeStoreDriver>;

  beforeEach(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    store = makeStoreDriver();
    await kernel.use({
      name: 'pv-store-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.pv-store', store.driver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    objectql = kernel.getService<ObjectQL>('objectql');
    objectql.registry.registerObject({ ...CASCADE, datasource: 'pv-store' } as any, 'test', 'test');
    store.rows.set('rec_u', { id: 'rec_u', name: 'u', country: 'cn' });
  });

  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  const metaMap = new Map<string, any>(
    Object.values(CASCADE.fields).map((f: any) => [f.name, { name: f.name, type: f.type, ...(f.options ? { options: f.options } : {}) }]),
  );

  const importUpdate = (rowsIn: Record<string, unknown>[], dryRun: boolean) => runImport({
    p: new ObjectStackProtocolImplementation(objectql as never) as unknown as ImportProtocolLike,
    objectName: OBJECT,
    metaMap,
    writeMode: 'update',
    matchFields: ['name'],
    dryRun,
    runAutomations: false,
    trimWhitespace: true,
    createMissingOptions: false,
    skipBlankMatchKey: false,
    context: { userId: 'usr_importer' },
    rows: rowsIn,
  } as any);

  const outcome = (s: Awaited<ReturnType<typeof importUpdate>>) =>
    s.results.map((r) => ({ ok: r.ok, action: r.action, ...(r.ok ? {} : { field: r.field, code: r.code }) }));

  it.each([
    ['a cascade pick', { name: 'u', province: 'zj' }],
    ['a note', { name: 'u', note: 'x' }],
  ])('%s — the dry run admits the row the import updates', async (_label, cells) => {
    const dry = await importUpdate([cells], true);
    expect(outcome(dry)).toEqual([{ ok: true, action: 'updated' }]);
    expect(store.rows.get('rec_u')).toEqual({ id: 'rec_u', name: 'u', country: 'cn' });

    const real = await importUpdate([cells], false);
    expect(outcome(real)).toEqual(outcome(dry));
  });

  it('control: the dry run refuses the row the import refuses', async () => {
    const cells = { name: 'u', country: 'us' };
    const dry = await importUpdate([cells], true);
    expect(outcome(dry)).toEqual([{ ok: false, action: 'failed', field: 'note', code: 'required' }]);
    const real = await importUpdate([cells], false);
    expect(outcome(real)).toEqual(outcome(dry));
    expect(store.rows.get('rec_u')).toEqual({ id: 'rec_u', name: 'u', country: 'cn' });
  });
});
