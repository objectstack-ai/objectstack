// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The update door's rule, in its insert door's order: the value an update
// JUDGES and STORES is the payload left after the fields the caller may not
// write are removed. The caller's payload meets the read-only strips in the
// form the caller sent it, and only what survives them is put into its stored
// shape (a multi-valued field's array) and judged.
//
// Pinned on a multi-valued field locked by a TRUE `readonlyWhen`, for the
// spellings a caller may send it in, on the by-id path and the bulk path. The
// controls hold the unchanged halves: an unlocked field still stores the
// array form, a hook's value on a locked field is still the server's, and a
// value that is not a list at all is still refused with the same code.
//
// Real engine, an in-memory driver; the suite's shape.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { ValidationError } from './validation/record-validator.js';

function makeDriver() {
  const rows = new Map<string, Record<string, unknown>>();
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`test double: unsupported combinator ${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.entries(v).every(([op, target]: [string, any]) => {
          if (op === '$in') return (target as unknown[]).includes(row[k]);
          if (op === '$eq') return row[k] === target;
          throw new Error(`test double: unsupported operator ${op}`);
        });
      }
      return row[k] === v;
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: any) {
      const hit = [...rows.values()].filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? hit.slice(0, ast.limit) : hit;
    },
    async findOne(_o: string, ast: any) {
      for (const r of rows.values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async count() { return rows.size; },
    async create(_o: string, data: Record<string, unknown>) {
      const row = { ...data };
      rows.set(row.id as string, row);
      return row;
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      const row = { ...(rows.get(id) ?? {}), ...data, id };
      rows.set(id, row);
      return row;
    },
    async updateMany(_o: string, ast: any, data: Record<string, unknown>) {
      let count = 0;
      for (const row of [...rows.values()]) {
        if (!matches(row, ast?.where)) continue;
        rows.set(row.id as string, { ...row, ...data, id: row.id });
        count += 1;
      }
      return count;
    },
    async delete(_o: string, id: string) { return rows.delete(id); },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rows };
}

const OPTIONS = [
  { label: 'A', value: 'a' },
  { label: 'B', value: 'b' },
  { label: 'C', value: 'c' },
];

describe('the update door judges and stores the payload left after the fields the caller may not write are removed', () => {
  let engine: ObjectQL;
  let rows: ReturnType<typeof makeDriver>['rows'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    rows = d.rows;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'claim',
      fields: {
        status: { type: 'text' },
        tags: { type: 'multiselect', options: OPTIONS, readonlyWhen: "record.status == 'approved'" },
        picks: { type: 'select', multiple: true, options: OPTIONS, readonlyWhen: "record.status == 'approved'" },
        note: { type: 'text' },
      },
    } as any);
    // A lock whose predicate READS a multi-valued field of the payload.
    engine.registry.registerObject({
      name: 'claim_view',
      fields: {
        tags: { type: 'multiselect', options: OPTIONS },
        note: { type: 'text', readonlyWhen: "'b' in record.tags" },
      },
    } as any);
    rows.set('v1', { id: 'v1', tags: ['a'], note: 'n' });
    rows.set('c1', { id: 'c1', status: 'approved', tags: ['a'], picks: ['a'], note: 'n' });
    rows.set('c2', { id: 'c2', status: 'approved', tags: ['a'], picks: ['a'], note: 'n' });
    rows.set('o1', { id: 'o1', status: 'open', tags: ['a'], picks: ['a'], note: 'n' });
  });

  const drops = () => {
    const events: Array<{ fields: string[]; reason: string }> = [];
    return { events, options: { onFieldsDropped: (e: any) => events.push({ fields: [...e.fields], reason: e.reason }) } };
  };
  const ctx = { userId: 'u1' };

  // ── by id ──────────────────────────────────────────────────────────────

  it.each([
    ['a single value', 'b'],
    ['a list', ['b']],
  ])('by id: a locked multi-valued field keeps its stored value, whatever form the caller writes it in (form %#)', async (_label, sent) => {
    const { events, options } = drops();
    await engine.update('claim', { id: 'c1', tags: sent, picks: sent, note: 'changed' }, { context: ctx, ...options } as any);
    expect(rows.get('c1')).toMatchObject({ tags: ['a'], picks: ['a'], note: 'changed' });
    expect(events).toEqual([{ fields: ['tags', 'picks'], reason: 'readonly_when' }]);
  });

  it('by id, CONTROL: an unlocked multi-valued field still stores a single value in its list form', async () => {
    const { events, options } = drops();
    await engine.update('claim', { id: 'o1', tags: 'b', picks: 'c' }, { context: ctx, ...options } as any);
    expect(rows.get('o1')).toMatchObject({ tags: ['b'], picks: ['c'] });
    expect(events).toEqual([]);
  });

  it('by id, CONTROL: a hook-written value on a locked field is still the server\'s, stored in its list form', async () => {
    engine.registerHook('beforeUpdate', async (hc: any) => {
      if (hc.input?.data && 'note' in hc.input.data) hc.input.data.tags = 'c';
    }, { object: 'claim' } as any);
    await engine.update('claim', { id: 'c1', note: 'changed' }, { context: ctx } as any);
    expect(rows.get('c1')).toMatchObject({ tags: ['c'], note: 'changed' });
  });

  it('by id, CONTROL: a value that is no list at all is still refused on an unlocked field, with the same code', async () => {
    const err = await engine.update('claim', { id: 'o1', tags: { a: 1 } }, { context: ctx } as any).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe('VALIDATION_FAILED');
    expect((err as ValidationError).fields.map((f) => [f.field, f.code])).toEqual([['tags', 'invalid_type']]);
    expect(rows.get('o1')).toMatchObject({ tags: ['a'] });
  });

  it('by id: a value the lock removes is not judged — the update stores what is left', async () => {
    const { events, options } = drops();
    await engine.update('claim', { id: 'c1', tags: { a: 1 }, note: 'changed' }, { context: ctx, ...options } as any);
    expect(rows.get('c1')).toMatchObject({ tags: ['a'], note: 'changed' });
    expect(events).toEqual([{ fields: ['tags'], reason: 'readonly_when' }]);
  });

  it('by id, CONTROL: a lock reading a multi-valued field reads it in its stored list form', async () => {
    const { events, options } = drops();
    await engine.update('claim_view', { id: 'v1', tags: 'b', note: 'changed' }, { context: ctx, ...options } as any);
    expect(rows.get('v1')).toMatchObject({ tags: ['b'], note: 'n' });
    expect(events).toEqual([{ fields: ['note'], reason: 'readonly_when' }]);
  });

  // ── bulk ───────────────────────────────────────────────────────────────

  it.each([
    ['a single value', 'b'],
    ['a list', ['b']],
  ])('bulk: a locked multi-valued field keeps its stored value on every row, whatever form the caller writes it in (form %#)', async (_label, sent) => {
    const { events, options } = drops();
    await engine.update('claim', { tags: sent, picks: sent, note: 'changed' }, {
      where: { id: { $in: ['c1', 'c2'] } }, multi: true, context: ctx, ...options,
    } as any);
    for (const id of ['c1', 'c2']) expect(rows.get(id)).toMatchObject({ tags: ['a'], picks: ['a'], note: 'changed' });
    expect(events.filter((e) => e.reason === 'readonly_when').flatMap((e) => e.fields).sort()).toEqual(['picks', 'tags']);
  });

  it('bulk, CONTROL: an unlocked multi-valued field still stores a single value in its list form', async () => {
    await engine.update('claim', { tags: 'b' }, { where: { id: { $in: ['o1'] } }, multi: true, context: ctx } as any);
    expect(rows.get('o1')).toMatchObject({ tags: ['b'] });
  });
});
