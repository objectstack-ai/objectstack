// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29645] A string-typed field (`BOUNDED_STRING_FIELD_TYPES`) refuses ANY
 * object as its value, not only a plain object or an array (#29133).
 *
 * Measured on `origin/main` @ `7dae3b3c` before the change, through the engine
 * (insert, update by id, update by predicate), on SQLite (the physical column)
 * and on driver-memory (the engine's read; it keeps what it is handed):
 *
 *   value on text / textarea / markdown /    base SQLite (stored)   base memory (read)   head
 *   html / richtext / code / signature /
 *   qrcode / password
 *   new Date(…)                              "1767312000000.0"      the Date itself      invalid_type
 *   new Map(…), new Set(…)                   "{}"                   the Map / the Set    invalid_type
 *   a class instance { k: 1 }                '{"k":1}'              the instance         invalid_type
 *   new Uint8Array([1, 2])                   '{"0":1,"1":2}'        the typed array      invalid_type
 *   value on email / url / phone             invalid_email / _url / _phone (by accident)  invalid_type
 *
 * (`password` reads back masked, so its stored column is the only answer.)
 * The arm's object test was `isPlainObjectValue`, which is prototype-strict,
 * so these fell through to the string reading; on the three format types that
 * reading failed the format regex, an accident of `String(value)`. The arm
 * now asks the option arms' test (`isObjectValue`, #29562), so every object is
 * refused with the same wire code and sentence as a plain one. A string, a
 * number and a boolean keep #29241's rule: judged, and stored, as a string.
 */

import { describe, it, expect } from 'vitest';
import { BOUNDED_STRING_FIELD_TYPES } from '@objectstack/spec/data';
import { normalizeNumericStringValues, validateRecord, validateRecordInScope, ValidationError } from './record-validator.js';
import { ObjectQL } from '../engine.js';

const STRING_TYPES = [...BOUNDED_STRING_FIELD_TYPES];

class Widget {
  k = 1;
}

const NON_PLAIN: ReadonlyArray<readonly [string, () => unknown]> = [
  ['a Date', () => new Date('2026-01-02T00:00:00Z')],
  ['a Map', () => new Map([['a', 1]])],
  ['a Set', () => new Set(['a'])],
  ['a class instance', () => new Widget()],
  ['a typed array', () => new Uint8Array([1, 2])],
];

/** A string each type's own format admits: the plain-string control. */
const CONTROL: Record<string, string> = { email: 'a@b.co', url: 'https://example.com', phone: '+15551234567' };
const controlFor = (type: string) => CONTROL[type] ?? 'plain';

function errorsOf(
  schema: { fields: Record<string, any> },
  data: Record<string, unknown>,
  mode: 'insert' | 'update',
) {
  try {
    validateRecord(schema, data, mode);
  } catch (e) {
    if (e instanceof ValidationError) return e.fields;
    throw e;
  }
  return [];
}

describe('#29645 — a string-typed field refuses any object, not only a plain one', () => {
  it('reads the spec set, which still holds the twelve members this pin was written against', () => {
    expect(STRING_TYPES.sort()).toEqual(
      ['code', 'email', 'html', 'markdown', 'password', 'phone', 'qrcode', 'richtext', 'signature', 'text', 'textarea', 'url'],
    );
  });

  for (const type of STRING_TYPES) {
    const schema = { fields: { f: { type, label: 'F' } } };
    for (const [shape, make] of NON_PLAIN) {
      for (const mode of ['insert', 'update'] as const) {
        it(`${type}: refuses ${shape} on ${mode} as invalid_type`, () => {
          const errs = errorsOf(schema, { f: make() }, mode);
          expect(errs.map((e) => [e.field, e.code])).toEqual([['f', 'invalid_type']]);
          expect(errs[0].constraint).toMatchObject({ type, detail: 'expected a string, received an object' });
        });
      }
    }

    it(`${type}: control — a plain string still lands`, () => {
      expect(errorsOf(schema, { f: controlFor(type) }, 'insert')).toEqual([]);
      expect(errorsOf(schema, { f: controlFor(type) }, 'update')).toEqual([]);
    });
  }

  it('says the field, the type and the received shape in the message', () => {
    const errs = errorsOf({ fields: { title: { type: 'text', label: 'Title' } } }, { title: new Date(0) }, 'insert');
    expect(errs[0].message).toContain('Title');
    expect(errs[0].message).toContain('text');
    expect(errs[0].message).toContain('expected a string, received an object');
  });

  it('refuses it on a readonly field too (a shape arm, reached under the readonly scope)', () => {
    const schema = { fields: { stamp: { type: 'text', label: 'Stamp', readonly: true } } };
    let err: unknown = null;
    try {
      validateRecordInScope(schema, { stamp: new Date(0) }, 'insert', 'include');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields.map((f) => [f.field, f.code])).toEqual([['stamp', 'invalid_type']]);
  });
});

describe('#29645 — what the rule leaves alone', () => {
  const schema = { fields: { title: { type: 'text', label: 'Title', maxLength: 5 }, payload: { type: 'json', label: 'P' } } };

  it('a number and a boolean keep #29241: written as their string, then judged as one', () => {
    const row = normalizeNumericStringValues(schema, { title: 42, payload: 1 });
    expect(row).toEqual({ title: '42', payload: 1 });
    expect(errorsOf(schema, row, 'insert')).toEqual([]);
    expect(normalizeNumericStringValues(schema, { title: true }).title).toBe('true');
    expect(errorsOf(schema, { title: 123456 }, 'insert')[0].code).toBe('max_length');
  });

  it('the door leaves an object as sent: the arm, not the door, refuses it', () => {
    const row = { title: new Date(0) };
    expect(normalizeNumericStringValues(schema, row)).toBe(row);
  });

  it('a json field still holds a Date or a Map (outside the set)', () => {
    expect(errorsOf(schema, { payload: new Date(0) }, 'insert')).toEqual([]);
    expect(errorsOf(schema, { payload: new Map() }, 'insert')).toEqual([]);
  });
});

/** The driver-facing half: every engine door reaches the rule and writes nothing. */
describe('#29645 — write path end to end: the driver is never written', () => {
  async function boot() {
    const engine = new ObjectQL();
    const writes: unknown[] = [];
    const rows = new Map<string, Record<string, unknown>>([['rec_1', { id: 'rec_1', title: 'orig' }]]);
    engine.registerDriver({
      name: 'recording', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async execute() { return null; },
      async find() { return Array.from(rows.values()); },
      async findOne(_o: string, ast: any) { return rows.get(ast?.where?.id) ?? null; },
      async create(_o: string, data: unknown) { writes.push(data); return { ...(data as object), id: 'x' }; },
      async update(_o: string, id: string, data: unknown) { writes.push(data); return { ...(data as object), id }; },
      async updateMany(_o: unknown, _a: unknown, data: unknown) { writes.push(data); return 0; },
      async delete() { return true; }, async count() { return rows.size; },
      async bulkCreate(_o: string, data: unknown[]) { writes.push(...data); return data.map((d, i) => ({ ...(d as object), id: `b${i}` })); },
      async bulkUpdate() { return []; }, async bulkDelete() {},
      async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
    } as any, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'text_object', label: 'Text object',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' },
        mail: { name: 'mail', label: 'Mail', type: 'email' },
      },
    } as any);
    return { engine, writes, rows };
  }

  it('insert, insertMany, update by id and update by predicate refuse it VALIDATION_FAILED', async () => {
    const { engine, writes, rows } = await boot();
    for (const [field, run] of [
      ['title', () => engine.insert('text_object', { title: new Date(0) } as any)],
      ['title', () => engine.insert('text_object', [{ title: 'ok' }, { title: new Set(['a']) }] as any)],
      ['title', () => engine.update('text_object', { title: new Map() } as any, { where: { id: 'rec_1' } } as any)],
      ['title', () => engine.update('text_object', { title: new Widget() } as any, { multi: true } as any)],
      ['mail', () => engine.insert('text_object', { mail: new Uint8Array([1]) } as any)],
    ] as const) {
      const err = await run().then(() => null, (e: unknown) => e as ValidationError);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err!.code).toBe('VALIDATION_FAILED');
      expect(err!.fields.map((f) => [f.field, f.code])).toEqual([[field, 'invalid_type']]);
    }
    expect(writes).toEqual([]);
    expect(rows.get('rec_1')).toEqual({ id: 'rec_1', title: 'orig' });
  });

  it('control: a plain string reaches the driver as sent', async () => {
    const { engine, writes } = await boot();
    await engine.insert('text_object', { title: 'plain', mail: 'a@b.co' } as any);
    await engine.update('text_object', { title: 'again' } as any, { where: { id: 'rec_1' } } as any);
    expect(writes).toEqual([
      expect.objectContaining({ title: 'plain', mail: 'a@b.co' }),
      expect.objectContaining({ title: 'again' }),
    ]);
  });
});
