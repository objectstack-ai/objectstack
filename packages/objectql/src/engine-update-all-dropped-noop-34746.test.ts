// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An update whose every caller-supplied key is dropped (a static `readonly`
// field, a `readonlyWhen`-locked field) is a no-op: no driver write, no audit
// stamps, `afterUpdate` does not run, and the answer is the current record
// (by-id) or zero written rows (predicate), with the drops still reported
// through `onFieldsDropped` — the channel the REST `droppedFields` answer is
// built from. Both branches. An update where at least one key survives —
// a caller field, or a key a `beforeUpdate` hook wrote — takes the unchanged
// path. Strict mode refuses a dropped key, as before.
//
// The rule, as implemented: the caller supplied at least one key (the row's own
// address `id` aside), every one of them was taken by one of the engine's
// strips on this call, and the payload the strips left holds nothing but the
// platform's own update stamps (`updated_at`, `updated_by`).
//
// Booted through the real `ObjectQLPlugin`, so the stamps are the builtin
// `sys_stamp_audit_update` hook's, not a test stand-in's.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

const OBJECT = 'nd_task';
const T_SEED = '2026-11-01T09:00:00.000Z';
const T_UPDATE = '2026-11-19T10:00:00.000Z';
const SEEDER = 'usr_seed';
const EDITOR = 'usr_editor';

/** A store-backed stub driver that records every write it is handed. */
function makeCapturingDriver() {
  const rows = new Map<string, Record<string, any>>();
  const writes: Array<{ verb: 'update' | 'updateMany'; data: Record<string, unknown> }> = [];
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`stub driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return Object.entries(v).every(([op, target]) => {
          if (op === '$eq') return row?.[k] === target;
          if (op === '$in') return Array.isArray(target) && target.includes(row?.[k]);
          throw new Error(`stub driver: unsupported operator ${op}`);
        });
      }
      return row?.[k] === v;
    });
  };
  const driver: any = {
    name: 'nd-store', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async find(_o: string, ast: any) {
      return Array.from(rows.values()).filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
    },
    async findOne(_o: string, ast: any) {
      for (const r of rows.values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(_o: string, data: Record<string, unknown>) {
      const row = { ...data };
      rows.set(String(row.id), row);
      return { ...row };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      writes.push({ verb: 'update', data: { ...data } });
      const row = { ...rows.get(id), ...data, id };
      rows.set(id, row);
      return { ...row };
    },
    async updateMany(_o: string, ast: any, data: Record<string, unknown>) {
      writes.push({ verb: 'updateMany', data: { ...data } });
      let count = 0;
      for (const row of [...rows.values()]) {
        if (!matches(row, ast?.where)) continue;
        rows.set(row.id, { ...row, ...data, id: row.id });
        count += 1;
      }
      return count;
    },
    async delete(_o: string, id: string) { return rows.delete(id); },
    async count(_o: string, ast: any) {
      return Array.from(rows.values()).filter((r) => matches(r, ast?.where)).length;
    },
  };
  return { driver, rows, writes };
}

describe('an update whose every caller-supplied key is dropped is a no-op', () => {
  let kernel: ObjectKernel;
  let objectql: ObjectQL;
  let stub: ReturnType<typeof makeCapturingDriver>;
  const afterUpdateCalls: Array<{ id: unknown }> = [];
  /** When set, a `beforeUpdate` hook writes this value onto `derived`. */
  let hookWritesDerived: string | undefined;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    stub = makeCapturingDriver();
    await kernel.use({
      name: 'nd-store-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.nd-store', stub.driver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    objectql = kernel.getService<ObjectQL>('objectql');
    // The audit family is not declared: the registry injects it, as on every
    // real object.
    objectql.registry.registerObject({
      name: OBJECT,
      label: 'No-op Task',
      datasource: 'nd-store',
      fields: {
        title: { name: 'title', label: 'Title', type: 'text' },
        status: { name: 'status', label: 'Status', type: 'text' },
        total_score: { name: 'total_score', label: 'Total Score', type: 'number', readonly: true },
        locked_note: { name: 'locked_note', label: 'Locked Note', type: 'text', readonlyWhen: "record.status == 'closed'" },
        derived: { name: 'derived', label: 'Derived', type: 'text' },
      },
    } as any, 'test', 'test');
    objectql.registerHook('afterUpdate', async (ctx: any) => {
      afterUpdateCalls.push({ id: ctx.input?.id ?? ctx.result?.id });
    }, { object: OBJECT });
    objectql.registerHook('beforeUpdate', async (ctx: any) => {
      if (hookWritesDerived !== undefined) ctx.input.data.derived = hookWritesDerived;
    }, { object: OBJECT });
  });

  afterAll(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(T_UPDATE));
    stub.rows.clear();
    stub.writes.length = 0;
    afterUpdateCalls.length = 0;
    hookWritesDerived = undefined;
    const seeded = (id: string, status: string) => ({
      id, title: `t-${id}`, status, total_score: 7, locked_note: 'frozen', derived: null,
      created_at: T_SEED, updated_at: T_SEED, created_by: SEEDER, updated_by: SEEDER,
    });
    stub.rows.set('t1', seeded('t1', 'closed'));
    stub.rows.set('t2', seeded('t2', 'closed'));
  });

  const asEditor = (extra: Record<string, unknown> = {}) => ({
    context: { userId: EDITOR } as any,
    ...extra,
  });

  // ── by-id ──────────────────────────────────────────────────────────────

  describe('by-id', () => {
    it('a payload of only a static readonly field writes nothing, runs no afterUpdate and answers the current record', async () => {
      const drops: any[] = [];
      const result: any = await objectql.update(
        OBJECT, { id: 't1', total_score: 100 },
        asEditor({ onFieldsDropped: (e: any) => drops.push(e) }) as any,
      );
      expect(stub.writes).toEqual([]);
      expect(afterUpdateCalls).toEqual([]);
      expect(drops).toEqual([{ object: OBJECT, fields: ['total_score'], reason: 'readonly' }]);
      expect(stub.rows.get('t1')).toMatchObject({ total_score: 7, updated_at: T_SEED, updated_by: SEEDER });
      expect(result).toMatchObject({ id: 't1', title: 't-t1', total_score: 7, updated_at: T_SEED, updated_by: SEEDER });
    });

    it('a payload of only a readonlyWhen-locked field writes nothing and runs no afterUpdate', async () => {
      const drops: any[] = [];
      const result: any = await objectql.update(
        OBJECT, { id: 't1', locked_note: 'x' },
        asEditor({ onFieldsDropped: (e: any) => drops.push(e) }) as any,
      );
      expect(stub.writes).toEqual([]);
      expect(afterUpdateCalls).toEqual([]);
      expect(drops).toEqual([{ object: OBJECT, fields: ['locked_note'], reason: 'readonly_when' }]);
      expect(stub.rows.get('t1')).toMatchObject({ locked_note: 'frozen', updated_at: T_SEED, updated_by: SEEDER });
      expect(result).toMatchObject({ id: 't1', locked_note: 'frozen', updated_at: T_SEED });
    });

    it('both drop reasons at once are still all dropped', async () => {
      await objectql.update(OBJECT, { id: 't1', total_score: 100, locked_note: 'x' }, asEditor() as any);
      expect(stub.writes).toEqual([]);
      expect(afterUpdateCalls).toEqual([]);
    });

    it('control: one surviving caller field takes the unchanged path — stamps written, afterUpdate runs', async () => {
      await objectql.update(OBJECT, { id: 't1', total_score: 100, title: 'new' }, asEditor() as any);
      expect(stub.writes).toEqual([
        { verb: 'update', data: { title: 'new', updated_at: T_UPDATE, updated_by: EDITOR } },
      ]);
      expect(afterUpdateCalls).toEqual([{ id: 't1' }]);
    });

    it('a key a beforeUpdate hook wrote survives, so the update is not all dropped', async () => {
      hookWritesDerived = 'from-hook';
      await objectql.update(OBJECT, { id: 't1', total_score: 100 }, asEditor() as any);
      expect(stub.writes).toEqual([
        { verb: 'update', data: { derived: 'from-hook', updated_at: T_UPDATE, updated_by: EDITOR } },
      ]);
      expect(afterUpdateCalls).toEqual([{ id: 't1' }]);
    });

    it('strict mode still refuses the dropped key and writes nothing', async () => {
      let err: any;
      try {
        await objectql.update(OBJECT, { id: 't1', total_score: 100 }, asEditor({ strictReadonlyWrites: true }) as any);
      } catch (e) {
        err = e;
      }
      expect(err?.code).toBe('ERR_READONLY_FIELD_REJECTED');
      expect(err?.fields).toEqual(['total_score']);
      expect(stub.writes).toEqual([]);
      expect(afterUpdateCalls).toEqual([]);
    });
  });

  // ── predicate ──────────────────────────────────────────────────────────

  describe('predicate (multi)', () => {
    const multi = (extra: Record<string, unknown> = {}) =>
      asEditor({ where: { status: 'closed' }, multi: true, ...extra });

    it('a payload of only a static readonly field writes no row, runs no afterUpdate and answers 0', async () => {
      const drops: any[] = [];
      const result = await objectql.update(
        OBJECT, { total_score: 100 }, multi({ onFieldsDropped: (e: any) => drops.push(e) }) as any,
      );
      expect(stub.writes).toEqual([]);
      expect(afterUpdateCalls).toEqual([]);
      expect(result).toBe(0);
      expect(drops).toEqual([{ object: OBJECT, fields: ['total_score'], reason: 'readonly' }]);
      expect(stub.rows.get('t1')).toMatchObject({ updated_at: T_SEED, updated_by: SEEDER });
      expect(stub.rows.get('t2')).toMatchObject({ updated_at: T_SEED, updated_by: SEEDER });
    });

    it('a payload of only a readonlyWhen-locked field writes no row and runs no afterUpdate', async () => {
      const result = await objectql.update(OBJECT, { locked_note: 'x' }, multi() as any);
      expect(stub.writes).toEqual([]);
      expect(afterUpdateCalls).toEqual([]);
      expect(result).toBe(0);
    });

    it('control: one surviving caller field takes the unchanged path — every matched row stamped, afterUpdate per row', async () => {
      const result = await objectql.update(OBJECT, { total_score: 100, title: 'bulk' }, multi() as any);
      expect(stub.writes).toEqual([
        { verb: 'updateMany', data: { title: 'bulk', updated_at: T_UPDATE, updated_by: EDITOR } },
      ]);
      expect(result).toBe(2);
      expect(afterUpdateCalls).toHaveLength(2);
    });

    it('a key a beforeUpdate hook wrote survives on the predicate path too', async () => {
      hookWritesDerived = 'from-hook';
      await objectql.update(OBJECT, { total_score: 100 }, multi() as any);
      expect(stub.writes).toEqual([
        { verb: 'updateMany', data: { derived: 'from-hook', updated_at: T_UPDATE, updated_by: EDITOR } },
      ]);
      expect(afterUpdateCalls).toHaveLength(2);
    });
  });
});
