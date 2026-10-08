// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22183 — `ImportRequest.createMissingOptions`, end to end through the REAL
// engine.
//
// ## The defect
//
// With the option on, the import's cell coercion kept a `select` /
// `multiselect` cell that matched no option, and the engine's write-path option
// check then refused the same value ("Priority must be one of: high, low"). So
// on every writable field the option changed WHICH stage refused the row, never
// WHETHER it was refused.
//
// ## The fix
//
// Coercion reports the values it kept; the import runner hands exactly those to
// each write as `ExecutionContext.keptOptionValues`; the record validator's
// option arms admit a listed value on that write and still refuse every other
// value outside the options. The field's option list is never written.
//
// ## Pins
//
//  (a) the import door: with the option on, a kept select value and a kept
//      multiselect item are STORED, on the batched path, the per-row path, an
//      update-mode import and the dry run;
//  (b) control: with the option off the same cells are refused at coercion;
//  (c) the admission is the import's only: a plain write of the same value is
//      refused, and so is a write naming a different kept value;
//  (d) a LATER edit of such a row: one that leaves the field out is accepted,
//      one that sends the kept value back is judged against the options again
//      and refused, and one that picks an option is accepted — the row stays
//      editable and the option list is unchanged.
//
// (a) was red before the fix: every row came back refused by the engine.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel, runImport, type ImportProtocolLike } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

const OBJECT = 'kept_ticket';
const PRIORITY_OPTIONS = [{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }];
const TAG_OPTIONS = [{ value: 'important', label: 'Important' }, { value: 'review', label: 'Review' }];

/** A store-backed stub driver: the stored row IS the verdict. */
function makeStubDriver() {
  const rows = new Map<string, Record<string, any>>();
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`stub driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return Object.entries(v).every(([op, target]) => {
          if (op === '$eq') return row?.[k] === target;
          if (op === '$in') return Array.isArray(target) && target.includes(row?.[k]);
          // REFUSE, never silently match.
          throw new Error(`stub driver: unsupported operator ${op}`);
        });
      }
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'kept-store', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async find(_o: string, ast: any) {
      const hits = Array.from(rows.values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits;
      return page.map((r) => ({ ...r }));
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

/** The field findings of an engine refusal, or `null` when the write landed. */
async function refusal(write: () => Promise<unknown>) {
  try {
    await write();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    const err = e as ValidationError;
    return { code: err.code, fields: err.fields.map((f) => ({ field: f.field, code: f.code })) };
  }
}

describe('#22183 — createMissingOptions keeps an unmatched option value through the engine', () => {
  let kernel: ObjectKernel;
  let objectql: ObjectQL;
  let stub: ReturnType<typeof makeStubDriver>;

  beforeEach(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    stub = makeStubDriver();
    await kernel.use({
      name: 'kept-store-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.kept-store', stub.driver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    objectql = kernel.getService<ObjectQL>('objectql');
    objectql.registry.registerObject({
      name: OBJECT,
      label: 'Kept Ticket',
      datasource: 'kept-store',
      fields: {
        code: { name: 'code', label: 'Code', type: 'text' },
        title: { name: 'title', label: 'Title', type: 'text' },
        priority: { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS },
        tags: { name: 'tags', label: 'Tags', type: 'multiselect', options: TAG_OPTIONS },
      },
    } as any, 'test', 'test');
  });

  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  const storedByCode = (code: string) => {
    const hits = Array.from(stub.rows.values()).filter((r) => r.code === code);
    expect(hits.length, `exactly one stored row for code ${code}`).toBe(1);
    return hits[0]!;
  };

  const metaMap = new Map<string, any>([
    ['code', { name: 'code', type: 'text' }],
    ['title', { name: 'title', type: 'text' }],
    ['priority', { name: 'priority', type: 'select', options: PRIORITY_OPTIONS }],
    ['tags', { name: 'tags', type: 'multiselect', options: TAG_OPTIONS }],
  ]);

  const ROWS = [
    { code: 'sel', title: 'kept select', priority: 'Bogus' },
    { code: 'multi', title: 'kept multiselect item', tags: 'Important, Bogus' },
    { code: 'plain', title: 'matched', priority: 'High' },
  ];

  function importer(p: ImportProtocolLike) {
    return (over: Record<string, unknown>) => runImport({
      p,
      objectName: OBJECT,
      metaMap,
      writeMode: 'insert',
      matchFields: ['code'],
      dryRun: false,
      runAutomations: false,
      trimWhitespace: true,
      createMissingOptions: true,
      skipBlankMatchKey: false,
      context: { userId: 'usr_importer' },
      rows: ROWS,
      ...over,
    } as any);
  }

  /** The real protocol: batched creates (`insertManyData`), `validateData`. */
  const fullProtocol = () => new ObjectStackProtocolImplementation(objectql as never) as unknown as ImportProtocolLike;
  /** The same protocol offering only the per-row calls, so each row is its own `createData`. */
  const perRowProtocol = (): ImportProtocolLike => {
    const impl = fullProtocol();
    return {
      findData: (args) => impl.findData(args),
      createData: (args) => impl.createData(args),
      updateData: (args) => impl.updateData(args),
    };
  };

  for (const [label, protocol] of [['batched', fullProtocol], ['per-row', perRowProtocol]] as const) {
    it(`(a) ${label}: a kept select value and a kept multiselect item are stored`, async () => {
      const summary = await importer(protocol())({});
      expect(summary.results.map((r) => ({ ok: r.ok, action: r.action, code: r.code }))).toEqual([
        { ok: true, action: 'created', code: undefined },
        { ok: true, action: 'created', code: undefined },
        { ok: true, action: 'created', code: undefined },
      ]);
      expect(storedByCode('sel').priority).toBe('Bogus');
      expect(storedByCode('multi').tags).toEqual(['important', 'Bogus']);
      expect(storedByCode('plain').priority).toBe('high');
      // The option list is the author's, unchanged.
      expect((objectql.registry.getObject(OBJECT) as any).fields.priority.options.map((o: any) => o.value)).toEqual(['high', 'low']);
    });
  }

  it('(a) the dry run admits what the write would, and stores nothing', async () => {
    const summary = await importer(fullProtocol())({ dryRun: true });
    expect(summary.results.map((r) => ({ ok: r.ok, action: r.action }))).toEqual([
      { ok: true, action: 'created' },
      { ok: true, action: 'created' },
      { ok: true, action: 'created' },
    ]);
    expect(stub.rows.size).toBe(0);
  });

  it('(a) an update-mode import stores the kept value on the matched row', async () => {
    stub.rows.set('rec_u', { id: 'rec_u', code: 'u', title: 'existing', priority: 'low' });
    const summary = await importer(fullProtocol())({
      writeMode: 'update', rows: [{ code: 'u', priority: 'Legacy', tags: 'Review; Archived' }],
    });
    expect(summary.results.map((r) => ({ ok: r.ok, action: r.action }))).toEqual([{ ok: true, action: 'updated' }]);
    expect(storedByCode('u')).toMatchObject({ priority: 'Legacy', tags: ['review', 'Archived'] });
  });

  it('(b) control: with the option off the same cells are refused at coercion', async () => {
    const summary = await importer(fullProtocol())({ createMissingOptions: false });
    expect(summary.results.map((r) => ({ ok: r.ok, code: r.code, field: r.field }))).toEqual([
      { ok: false, code: 'invalid_option', field: 'priority' },
      { ok: false, code: 'invalid_option', field: 'tags' },
      { ok: true, code: undefined, field: undefined },
    ]);
    expect(Array.from(stub.rows.values()).map((r) => r.code)).toEqual(['plain']);
  });

  it('(c) the admission is the import\'s only: a plain write, or a write naming another value, is refused', async () => {
    const ctx = { userId: 'usr_editor' };
    expect(await refusal(() => objectql.insert(OBJECT, { code: 'w1', priority: 'Bogus' }, { context: ctx } as any))).toEqual({
      code: 'VALIDATION_FAILED', fields: [{ field: 'priority', code: 'invalid_option' }],
    });
    expect(await refusal(() => objectql.insert(
      OBJECT, { code: 'w2', priority: 'Bogus' }, { context: { ...ctx, keptOptionValues: { priority: ['Other'] } } } as any,
    ))).toEqual({ code: 'VALIDATION_FAILED', fields: [{ field: 'priority', code: 'invalid_option' }] });
    expect(stub.rows.size).toBe(0);
  });

  it('(d) a later edit: leaving the field out is accepted, sending the kept value back is judged again, picking an option is accepted', async () => {
    await importer(fullProtocol())({});
    const sel = storedByCode('sel');
    const multi = storedByCode('multi');
    const protocol = new ObjectStackProtocolImplementation(objectql as never);
    const ctx = { userId: 'usr_editor' };

    // The record form's edit writes only the fields that changed.
    await protocol.updateData({ object: OBJECT, id: sel.id, data: { title: 'edited' }, context: ctx } as any);
    expect(storedByCode('sel')).toMatchObject({ title: 'edited', priority: 'Bogus' });
    await protocol.updateData({ object: OBJECT, id: multi.id, data: { title: 'edited too' }, context: ctx } as any);
    expect(storedByCode('multi')).toMatchObject({ title: 'edited too', tags: ['important', 'Bogus'] });

    // A write that sends the field is judged against the options, as any write is.
    expect(await refusal(() => protocol.updateData({
      object: OBJECT, id: sel.id, data: { title: 'echo', priority: 'Bogus' }, context: ctx,
    } as any))).toEqual({ code: 'VALIDATION_FAILED', fields: [{ field: 'priority', code: 'invalid_option' }] });
    expect(await refusal(() => protocol.updateData({
      object: OBJECT, id: multi.id, data: { tags: ['important', 'Bogus', 'review'] }, context: ctx,
    } as any))).toEqual({ code: 'VALIDATION_FAILED', fields: [{ field: 'tags', code: 'invalid_option' }] });
    expect(storedByCode('sel').title).toBe('edited');

    // Picking an option is accepted.
    await protocol.updateData({ object: OBJECT, id: sel.id, data: { priority: 'low' }, context: ctx } as any);
    expect(storedByCode('sel').priority).toBe('low');
  });
});
