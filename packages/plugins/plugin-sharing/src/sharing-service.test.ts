// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { SharingService } from './sharing-service.js';
import { buildSharingMiddleware } from './sharing-plugin.js';

// ─────────────────────────────────────────────────────────────────────
// In-memory fake engine
// ─────────────────────────────────────────────────────────────────────

interface FakeRow {
  [k: string]: any;
}

function makeFakeEngine(schemas: Record<string, any>) {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (name: string) => (tables[name] ??= []);

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    if (filter.$or && Array.isArray(filter.$or)) {
      return filter.$or.some((f: any) => matches(row, f));
    }
    if (filter.$and && Array.isArray(filter.$and)) {
      return filter.$and.every((f: any) => matches(row, f));
    }
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or' || k === '$and') continue;
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }

  return {
    _tables: tables,
    schemas,
    getSchema(name: string) { return schemas[name]; },
    async find(object: string, options?: any) {
      const table = ensure(object);
      const filter = options?.filter ?? options?.where;
      let out = table.filter(r => matches(r, filter));
      if (options?.orderBy?.[0]) {
        // Canonical SortNode key only (spec/data/query.zod.ts): the real
        // engine strips an unknown `direction:` key and defaults to asc, so
        // the mock must too — honoring both keys masks wrong-key sorts.
        const { field, order } = options.orderBy[0];
        out = [...out].sort((a, b) => {
          const av = a[field]; const bv = b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return order === 'desc' ? -cmp : cmp;
        });
      }
      return out.slice(0, options?.limit ?? 1000);
    },
    async insert(object: string, data: any) {
      const row = { ...data };
      ensure(object).push(row);
      return row;
    },
    async update(object: string, idOrData: any, dataOrOptions?: any) {
      // Engine signature is overloaded — handle the (data, options)
      // shape used by SharingService.grant() where id lives on data.
      const data = typeof idOrData === 'object' ? idOrData : dataOrOptions;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const table = ensure(object);
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete(object: string, options?: any) {
      const table = ensure(object);
      const id = options?.where?.id ?? options?.id;
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table.splice(i, 1);
      return { id };
    },
  };
}

const ACCOUNT_SCHEMA = {
  name: 'account',
  sharingModel: 'private',
  fields: { id: {}, name: {}, owner_id: {} },
};

const LEAD_SCHEMA = {
  name: 'lead',
  sharingModel: 'public_read',
  fields: { id: {}, name: {}, owner_id: {} },
};

// [ADR-0090 D1] A CUSTOM object with NO sharingModel + an owner field —
// the objectui#2348 leave_request incident shape. Under the secure default
// this now resolves PRIVATE (owner-scoped), never silently public.
const UNSET_OWD_SCHEMA = {
  name: 'task',
  // no sharingModel — custom object ⇒ defaults to private (ADR-0090 D1)
  fields: { id: {}, name: {}, owner_id: {} },
};

// A SYSTEM object with no sharingModel keeps the public fall-through
// (explicit ADR-0066 posture + bypass lists own the sys_* surface).
// Explicitly-public custom object (post-ADR-0090 D1 the only way to be public).
const EXPLICIT_PUBLIC_SCHEMA = {
  name: 'task',
  sharingModel: 'public_read_write',
  fields: { id: {}, name: {}, owner_id: {} },
};

const SYS_UNSET_OWD_SCHEMA = {
  name: 'sys_widget',
  isSystem: true,
  fields: { id: {}, name: {}, owner_id: {} },
};

// ADR-0056 D1 — canonical OWD vocabulary maps onto the same enforced behaviours.
const CANON_PUBLIC_READ_SCHEMA = {
  name: 'kbarticle',
  sharingModel: 'public_read', // canonical alias of legacy `read`
  fields: { id: {}, name: {}, owner_id: {} },
};
const CANON_PUBLIC_RW_SCHEMA = {
  name: 'whiteboard',
  sharingModel: 'public_read_write', // canonical alias of "public" (no record filter)
  fields: { id: {}, name: {}, owner_id: {} },
};

const ORPHAN_SCHEMA = {
  name: 'note',
  sharingModel: 'private',
  // no owner_id — sharing skipped
  fields: { id: {}, body: {} },
};

// ─────────────────────────────────────────────────────────────────────

describe('SharingService.buildReadFilter', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({
      account: ACCOUNT_SCHEMA,
      lead: LEAD_SCHEMA,
      task: UNSET_OWD_SCHEMA,
      sys_widget: SYS_UNSET_OWD_SCHEMA,
      note: ORPHAN_SCHEMA,
      kbarticle: CANON_PUBLIC_READ_SCHEMA,
      whiteboard: CANON_PUBLIC_RW_SCHEMA,
      sys_record_share: { name: 'sys_record_share' },
    });
    svc = new SharingService({ engine });
  });

  it('returns null for system context', async () => {
    expect(await svc.buildReadFilter('account', { isSystem: true })).toBeNull();
  });

  it('returns null for objects in the bypass list', async () => {
    expect(await svc.buildReadFilter('sys_user', { userId: 'u1' })).toBeNull();
  });

  it('[ADR-0090 D1] custom object with UNSET sharingModel defaults to PRIVATE (the objectui#2348 incident regression)', async () => {
    // 张三 (u1) must NOT read 李四's records on an OWD-less custom object:
    // the read filter narrows to owner_id = u1 instead of passing null.
    const f = await svc.buildReadFilter('task', { userId: 'u1' });
    expect(f).toEqual({ owner_id: 'u1' });
  });

  it('[ADR-0090 D1] system object with unset sharingModel keeps the public fall-through', async () => {
    expect(await svc.buildReadFilter('sys_widget', { userId: 'u1' })).toBeNull();
  });

  it('[ADR-0090 D4] an unrecognised stored sharingModel fails CLOSED to private', async () => {
    engine.schemas.legacy = { name: 'legacy', sharingModel: 'read_write', fields: { id: {}, owner_id: {} } } as any;
    const f = await svc.buildReadFilter('legacy', { userId: 'u1' });
    expect(f).toEqual({ owner_id: 'u1' });
  });

  it('returns null for read-only-sharing objects (writes are gated, reads are not)', async () => {
    expect(await svc.buildReadFilter('lead', { userId: 'u1' })).toBeNull();
  });

  it('canonical public_read reads like `read` (everyone reads → no filter) [ADR-0056 D1]', async () => {
    expect(await svc.buildReadFilter('kbarticle', { userId: 'u1' })).toBeNull();
  });

  it('canonical public_read_write is unscoped on read [ADR-0056 D1]', async () => {
    expect(await svc.buildReadFilter('whiteboard', { userId: 'u1' })).toBeNull();
  });

  it('returns null for objects without owner_id even when private', async () => {
    expect(await svc.buildReadFilter('note', { userId: 'u1' })).toBeNull();
  });

  it('returns deny-all for private object with no userId', async () => {
    const f = await svc.buildReadFilter('account', {});
    expect(f).toEqual({ id: '__deny_all__' });
  });

  it('returns owner-only filter when user has no explicit shares', async () => {
    const f = await svc.buildReadFilter('account', { userId: 'alice' });
    expect(f).toEqual({ owner_id: 'alice' });
  });

  it('returns owner OR shared-record filter when grants exist', async () => {
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'alice' }, { userId: 'admin' });
    await svc.grant({ object: 'account', recordId: 'a2', recipientId: 'alice', accessLevel: 'edit' }, { userId: 'admin' });
    const f: any = await svc.buildReadFilter('account', { userId: 'alice' });
    expect(f.$or).toBeDefined();
    expect(f.$or[0]).toEqual({ owner_id: 'alice' });
    expect(f.$or[1].id.$in.sort()).toEqual(['a1', 'a2']);
  });
});

describe('SharingService.canEdit', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({
      account: ACCOUNT_SCHEMA,
      lead: LEAD_SCHEMA,
      task: EXPLICIT_PUBLIC_SCHEMA,
      kbarticle: CANON_PUBLIC_READ_SCHEMA,
      whiteboard: CANON_PUBLIC_RW_SCHEMA,
      sys_record_share: { name: 'sys_record_share' },
    });
    svc = new SharingService({ engine });
    engine._tables.account = [
      { id: 'a1', name: 'Acme', owner_id: 'alice' },
      { id: 'a2', name: 'Beta', owner_id: 'bob' },
    ];
    engine._tables.lead = [
      { id: 'l1', name: 'Lead1', owner_id: 'alice' },
    ];
    engine._tables.kbarticle = [
      { id: 'k1', name: 'KB1', owner_id: 'alice' },
    ];
  });

  it('returns true for system context', async () => {
    expect(await svc.canEdit('account', 'a1', { isSystem: true })).toBe(true);
  });

  it('returns true for public objects', async () => {
    expect(await svc.canEdit('task', 'anything', { userId: 'bob' })).toBe(true);
  });

  it('returns true for record owner', async () => {
    expect(await svc.canEdit('account', 'a1', { userId: 'alice' })).toBe(true);
  });

  it('returns false for non-owner without share', async () => {
    expect(await svc.canEdit('account', 'a1', { userId: 'bob' })).toBe(false);
  });

  it('returns false for read-only share', async () => {
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'read' }, { userId: 'admin' });
    expect(await svc.canEdit('account', 'a1', { userId: 'bob' })).toBe(false);
  });

  it('returns true for edit share', async () => {
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'edit' }, { userId: 'admin' });
    expect(await svc.canEdit('account', 'a1', { userId: 'bob' })).toBe(true);
  });

  // [#3865] Enforcement stays deliberately WIDER than authoring: `full` is no
  // longer grantable, but a row persisted before the boot backfill ran still
  // means `edit`. Dropping it from the gate would silently REVOKE access.
  it("still honours a stored 'full' share written before it was retired", async () => {
    engine._tables.sys_record_share = [
      {
        id: 'shr_legacy', object_name: 'account', record_id: 'a1',
        recipient_type: 'user', recipient_id: 'bob', access_level: 'full',
      },
    ];
    expect(await svc.canEdit('account', 'a1', { userId: 'bob' })).toBe(true);
  });

  it('enforces canEdit for sharingModel=read', async () => {
    expect(await svc.canEdit('lead', 'l1', { userId: 'alice' })).toBe(true);
    expect(await svc.canEdit('lead', 'l1', { userId: 'bob' })).toBe(false);
  });

  it('canonical public_read gates writes to the owner [ADR-0056 D1]', async () => {
    expect(await svc.canEdit('kbarticle', 'k1', { userId: 'alice' })).toBe(true);
    expect(await svc.canEdit('kbarticle', 'k1', { userId: 'bob' })).toBe(false);
  });

  it('canonical public_read_write lets anyone write [ADR-0056 D1]', async () => {
    expect(await svc.canEdit('whiteboard', 'anything', { userId: 'bob' })).toBe(true);
  });
});

describe('SharingService.grant / listShares / revoke', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({ account: ACCOUNT_SCHEMA, sys_record_share: {} });
    svc = new SharingService({ engine });
  });

  it('creates a new grant on first call', async () => {
    const r = await svc.grant(
      { object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'edit' },
      { userId: 'admin' },
    );
    expect(r.id).toMatch(/^shr_/);
    expect(r.access_level).toBe('edit');
    expect(r.granted_by).toBe('admin');
    expect(engine._tables.sys_record_share.length).toBe(1);
  });

  it('upserts on second call with same (object, record, recipient)', async () => {
    const a = await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob' }, { userId: 'admin' });
    const b = await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'edit' }, { userId: 'admin' });
    expect(engine._tables.sys_record_share.length).toBe(1);
    expect(b.id).toBe(a.id);
    expect(b.access_level).toBe('edit');
  });

  // [#3865] `full` claimed "Full Access (Transfer, Share, Delete)" while both
  // gates matched `edit`/`full` alike — it granted exactly `edit`. Retired from
  // the authoring surface; an older client still sending it is normalised
  // rather than rejected (that would revoke access it already had).
  it("normalises the retired 'full' level to 'edit' instead of persisting it", async () => {
    const r = await svc.grant(
      { object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'full' as any },
      { userId: 'admin' },
    );
    expect(r.access_level).toBe('edit');
    expect(engine._tables.sys_record_share[0].access_level).toBe('edit');
  });

  it('rejects an unrecognised access level instead of silently persisting it', async () => {
    // A level no gate matches is a grant that looks issued and enforces
    // nothing — the same declared-but-inert trap `full` was (ADR-0078).
    await expect(
      svc.grant(
        { object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'admin' as any },
        { userId: 'admin' },
      ),
    ).rejects.toThrow(/VALIDATION_FAILED/);
    // Rejected before the upsert even queries — the table is never touched.
    expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
  });


  it('listShares returns all grants on a record', async () => {
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob' }, { userId: 'admin' });
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'carol', accessLevel: 'edit' }, { userId: 'admin' });
    const rows = await svc.listShares('account', 'a1', { userId: 'admin' });
    expect(rows.length).toBe(2);
  });

  it('listShares returns the newest grant first', async () => {
    // Regression: the query sorted with the non-canonical `direction: 'desc'`
    // key, which SortNode strips — so it sorted ascending (oldest first).
    engine._tables.sys_record_share = [
      { id: 'shr_old', object_name: 'account', record_id: 'a1', recipient_id: 'bob', created_at: '2026-01-01T00:00:00Z' },
      { id: 'shr_new', object_name: 'account', record_id: 'a1', recipient_id: 'carol', created_at: '2026-02-01T00:00:00Z' },
    ];
    const rows = await svc.listShares('account', 'a1', { userId: 'admin' });
    expect(rows.map(r => r.id)).toEqual(['shr_new', 'shr_old']);
  });

  it('revoke removes the row', async () => {
    const r = await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob' }, { userId: 'admin' });
    await svc.revoke(r.id, { userId: 'admin' });
    expect(engine._tables.sys_record_share.length).toBe(0);
  });

  it('rejects grant input missing required fields', async () => {
    await expect(svc.grant({} as any, {})).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(svc.grant({ object: 'account' } as any, {})).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(svc.grant({ object: 'account', recordId: 'a1' } as any, {})).rejects.toThrow(/VALIDATION_FAILED/);
  });
});

describe('buildSharingMiddleware (engine integration)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({
      account: ACCOUNT_SCHEMA,
      lead: LEAD_SCHEMA,
      task: EXPLICIT_PUBLIC_SCHEMA,
      sys_record_share: {},
    });
    svc = new SharingService({ engine });
    engine._tables.account = [
      { id: 'a1', name: 'Acme', owner_id: 'alice' },
      { id: 'a2', name: 'Beta', owner_id: 'bob' },
    ];
  });

  it('adds visibility filter on find', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'find',
      ast: {},
      context: { userId: 'alice' },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toEqual({ owner_id: 'alice' });
  });

  it('skips read filter for system context', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'find',
      ast: {},
      context: { isSystem: true },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toBeUndefined();
  });

  it('throws FORBIDDEN on update by non-owner', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'update',
      data: { id: 'a1', name: 'X' },
      context: { userId: 'bob' },
    };
    await expect(mw(ctx, async () => {})).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('allows update by owner', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'update',
      data: { id: 'a1', name: 'X' },
      context: { userId: 'alice' },
    };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('allows delete after explicit edit grant', async () => {
    await svc.grant({ object: 'account', recordId: 'a2', recipientId: 'alice', accessLevel: 'edit' }, { userId: 'admin' });
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'delete',
      options: { where: { id: 'a2' } },
      context: { userId: 'alice' },
    };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('does not block insert', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'insert',
      data: { id: 'a3', owner_id: 'eve' },
      context: { userId: 'eve' },
    };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('preserves caller-provided filter via $and', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'find',
      ast: { where: { name: 'Acme' } },
      context: { userId: 'alice' },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toEqual({ $and: [{ name: 'Acme' }, { owner_id: 'alice' }] });
  });

  // ─── Bulk (multi) write owner scoping (#2982) ───────────────────
  it('bulk update: injects the editable-rows filter so a non-owner cannot touch peers', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'update',
      options: { multi: true, where: { name: 'X' } },
      ast: { where: { name: 'X' } },
      data: { status: 'archived' },
      context: { userId: 'bob' },
    };
    let nextCalled = false;
    await mw(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    // bob's bulk update is constrained to rows bob owns.
    expect(ctx.ast.where).toEqual({ $and: [{ name: 'X' }, { owner_id: 'bob' }] });
  });

  it('bulk delete: injects the owner filter (no single id to canEdit-gate)', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'delete',
      options: { multi: true, where: {} },
      ast: {},
      context: { userId: 'bob' },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toEqual({ owner_id: 'bob' });
  });

  it('bulk update: edit-shared records widen the editable set', async () => {
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'edit' }, { userId: 'admin' });
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'update',
      options: { multi: true, where: {} },
      ast: {},
      data: { status: 'x' },
      context: { userId: 'bob' },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toEqual({ $or: [{ owner_id: 'bob' }, { id: { $in: ['a1'] } }] });
  });

  it('bulk update on a public_read (read) object is STILL owner-write-scoped', async () => {
    // The crux of #2982: reads are open on a public_read object (buildReadFilter
    // returns null), but writes remain owner-scoped — a distinction the old
    // single-id-only gate missed for multi writes.
    engine._tables.lead = [{ id: 'l1', owner_id: 'alice' }];
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'lead',
      operation: 'update',
      options: { multi: true, where: {} },
      ast: {},
      data: { status: 'x' },
      context: { userId: 'bob' },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toEqual({ owner_id: 'bob' });
  });

  it('bulk update: system context is unrestricted', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'update',
      options: { multi: true, where: {} },
      ast: {},
      data: { status: 'x' },
      context: { isSystem: true },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toBeUndefined();
  });

  it('bulk update on a fully public object: no owner filter', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'task', // EXPLICIT_PUBLIC_SCHEMA
      operation: 'update',
      options: { multi: true, where: {} },
      ast: {},
      data: { status: 'x' },
      context: { userId: 'bob' },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toBeUndefined();
  });
});
