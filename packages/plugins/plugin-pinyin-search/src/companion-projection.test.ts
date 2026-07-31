// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #2486 — companion projection: before-save stamping, no-write-amplification
 * guard, backfill and rebuild reconcile. Uses a minimal fake engine (the
 * boot-backfill.test.ts pattern) with a stub registry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  bindSearchCompanionHooks,
  backfillSearchCompanion,
  rebuildSearchCompanion,
  PINYIN_SEARCH_HOOK_PACKAGE,
} from './companion-projection.js';

interface Row { [k: string]: any }

const contactSchema = {
  name: 'crm_contact',
  nameField: 'name',
  fields: {
    name: { type: 'text' },
    email: { type: 'email' },
    __search: { type: 'text', hidden: true, readonly: true, system: true },
  },
};

const plainSchema = {
  name: 'crm_note',
  fields: { title: { type: 'text' } }, // no companion provisioned
};

function makeEngine(schemas: any[]) {
  const tables: Record<string, Row[]> = {};
  const hooks: Record<string, Array<{ handler: (ctx: any) => any; opts: any }>> = {};
  const byName = new Map(schemas.map((s) => [s.name, s]));
  const engine = {
    _tables: tables,
    registry: {
      getObject: (n: string) => byName.get(n),
      getAllObjects: () => [...byName.values()],
    },
    registerHook(event: string, handler: any, opts?: any) {
      (hooks[event] ??= []).push({ handler, opts });
    },
    unregisterHooksByPackage(packageId: string) {
      let removed = 0;
      for (const [event, entries] of Object.entries(hooks)) {
        const kept = entries.filter((e) => e.opts?.packageId !== packageId);
        removed += entries.length - kept.length;
        hooks[event] = kept;
      }
      return removed;
    },
    async trigger(event: string, ctx: any) {
      for (const { handler } of hooks[event] ?? []) await handler(ctx);
    },
    // Executes the KEYSET walk the backfill emits since #4363: `orderBy` on
    // the key plus a `$gt` seek. `offset` throws rather than being served —
    // this walk updates the rows it is reading, so an offset counts into a set
    // its own writes are changing and rows slide past the cursor unconverted.
    async find(o: string, opts?: any) {
      if (opts?.offset !== undefined) {
        throw new Error('offset paging skips rows a mutating walk must visit — expected a keyset seek (#4363)');
      }
      const key = opts?.orderBy?.[0]?.field;
      const seek = opts?.where?.[key]?.$gt ?? opts?.where?.$and?.[1]?.[key]?.$gt;
      let rows: any[] = tables[o] ?? [];
      if (seek !== undefined) rows = rows.filter((r: any) => String(r[key]) > String(seek));
      const ordered = key
        ? [...rows].sort((a: any, b: any) => String(a[key]).localeCompare(String(b[key])))
        : rows;
      return ordered.slice(0, opts?.limit ?? ordered.length);
    },
    async insert(o: string, data: Row) {
      const ctx = { object: o, event: 'beforeInsert', input: { data } };
      await engine.trigger('beforeInsert', ctx);
      (tables[o] ??= []).push({ ...ctx.input.data });
      return ctx.input.data;
    },
    async update(o: string, data: Row) {
      const ctx = { object: o, event: 'beforeUpdate', input: { id: data.id, data } };
      await engine.trigger('beforeUpdate', ctx);
      const t = tables[o] ?? [];
      const i = t.findIndex((r) => r.id === data.id);
      if (i >= 0) t[i] = { ...t[i], ...ctx.input.data };
      return t[i];
    },
    _hooks: hooks,
  };
  return engine;
}

describe('bindSearchCompanionHooks', () => {
  let engine: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    engine = makeEngine([contactSchema, plainSchema]);
    bindSearchCompanionHooks(engine as any);
  });

  it('binds beforeInsert + beforeUpdate globally and is idempotent (rebind-safe)', () => {
    bindSearchCompanionHooks(engine as any); // rebind
    expect(engine._hooks.beforeInsert).toHaveLength(1);
    expect(engine._hooks.beforeUpdate).toHaveLength(1);
    expect(engine._hooks.beforeInsert[0].opts.packageId).toBe(PINYIN_SEARCH_HOOK_PACKAGE);
    expect(engine._hooks.beforeInsert[0].opts.object).toBeUndefined(); // global
  });

  it('stamps __search on insert when the name field carries CJK', async () => {
    const row = await engine.insert('crm_contact', { id: 'c1', name: '张伟' });
    expect(row.__search).toBe('zhangwei zw');
  });

  it('leaves __search null for latin names (source column already matches)', async () => {
    const row = await engine.insert('crm_contact', { id: 'c2', name: 'Ada Lovelace' });
    expect(row.__search).toBe(null);
  });

  it('recomputes on update ONLY when the source field is in the patch', async () => {
    await engine.insert('crm_contact', { id: 'c3', name: '张伟' });
    // email-only patch: no recompute, no companion key added
    const patch: Row = { id: 'c3', email: 'zw@example.com' };
    await engine.update('crm_contact', patch);
    expect('__search' in patch).toBe(false);
    // name patch: recompute
    const updated = await engine.update('crm_contact', { id: 'c3', name: '王芳' });
    expect(updated.__search).toBe('wangfang wf');
  });

  it('clears the companion when a CJK name is renamed to latin (no stale recall)', async () => {
    await engine.insert('crm_contact', { id: 'c4', name: '张伟' });
    const updated = await engine.update('crm_contact', { id: 'c4', name: 'Victor Zhang' });
    expect(updated.__search).toBe(null);
  });

  it('ignores objects without a provisioned companion column', async () => {
    const row = await engine.insert('crm_note', { id: 'n1', title: '会议纪要' });
    expect('__search' in row).toBe(false);
  });
});

describe('backfillSearchCompanion / rebuildSearchCompanion', () => {
  it('fills rows missing a blob, in pages, and skips rows that need none', async () => {
    const engine = makeEngine([contactSchema]);
    engine._tables.crm_contact = [
      { id: 'a', name: '张伟', __search: null },            // hook-bypassing write → fill
      { id: 'b', name: 'Ada', __search: null },              // latin → skip
      { id: 'c', name: '王芳', __search: 'wangfang wf' },    // already filled → skip
      { id: 'd', name: '李雷', __search: null },             // fill (second page)
    ];
    const result = await backfillSearchCompanion(engine as any, undefined, { batchSize: 2 });
    expect(result).toEqual({ objects: 1, scanned: 4, updated: 2 });
    const rows = engine._tables.crm_contact;
    expect(rows.find((r) => r.id === 'a')!.__search).toBe('zhangwei zw');
    expect(rows.find((r) => r.id === 'b')!.__search).toBe(null);
    expect(rows.find((r) => r.id === 'd')!.__search).toBe('lilei ll');
  });

  it('is idempotent — a second pass updates nothing', async () => {
    const engine = makeEngine([contactSchema]);
    engine._tables.crm_contact = [{ id: 'a', name: '张伟', __search: null }];
    await backfillSearchCompanion(engine as any);
    const second = await backfillSearchCompanion(engine as any);
    expect(second.updated).toBe(0);
  });

  it('rebuild recomputes everything, clearing stale blobs (reconcile entry)', async () => {
    const engine = makeEngine([contactSchema]);
    engine._tables.crm_contact = [
      { id: 'a', name: 'Renamed To Latin', __search: 'zhangwei zw' }, // stale → cleared
      { id: 'b', name: '王芳', __search: 'wrongblob' },               // wrong → recomputed
    ];
    const result = await rebuildSearchCompanion(engine as any);
    expect(result.updated).toBe(2);
    expect(engine._tables.crm_contact[0].__search).toBe(null);
    expect(engine._tables.crm_contact[1].__search).toBe('wangfang wf');
  });
});
