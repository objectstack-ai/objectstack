// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
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
      // [#4550] Pinned to ObjectQL.delete's own dispatch predicate — see the
      // note in sharing-rule.test.ts for what a looser fake cost (#4434).
      assertEngineDeleteDispatch(options);
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
    // Setup grants run as system — grant authorization has its own suite below.
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'alice' }, { isSystem: true });
    await svc.grant({ object: 'account', recordId: 'a2', recipientId: 'alice', accessLevel: 'edit' }, { isSystem: true });
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
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'read' }, { isSystem: true });
    expect(await svc.canEdit('account', 'a1', { userId: 'bob' })).toBe(false);
  });

  it('returns true for edit share', async () => {
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'edit' }, { isSystem: true });
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

describe('[ADR-0111 D3] SharingService.canDelete — the verb boundary', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({
      account: ACCOUNT_SCHEMA,
      lead: LEAD_SCHEMA,
      task: EXPLICIT_PUBLIC_SCHEMA,
      note: ORPHAN_SCHEMA,
      sys_record_share: { name: 'sys_record_share' },
    });
    svc = new SharingService({ engine });
    engine._tables.account = [
      { id: 'a1', name: 'Acme', owner_id: 'alice' },
      { id: 'a2', name: 'Beta', owner_id: 'bob' },
    ];
  });

  it('system context, public objects, and owner-less objects all allow delete (matches canEdit)', async () => {
    expect(await svc.canDelete('account', 'a1', { isSystem: true })).toBe(true);
    expect(await svc.canDelete('task', 'anything', { userId: 'carol' })).toBe(true);
    engine._tables.note = [{ id: 'n1', body: 'x' }];
    expect(await svc.canDelete('note', 'n1', { userId: 'carol' })).toBe(true);
  });

  it('the record owner may delete', async () => {
    expect(await svc.canDelete('account', 'a1', { userId: 'alice' })).toBe(true);
  });

  it('a non-owner without ownership may NOT delete', async () => {
    expect(await svc.canDelete('account', 'a1', { userId: 'bob' })).toBe(false);
  });

  it('an EDIT share grants canEdit but NOT canDelete', async () => {
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'edit' }, { isSystem: true });
    expect(await svc.canEdit('account', 'a1', { userId: 'bob' })).toBe(true);
    expect(await svc.canDelete('account', 'a1', { userId: 'bob' })).toBe(false);
  });

  it("a legacy 'full' share likewise grants edit but not delete", async () => {
    engine._tables.sys_record_share = [{
      id: 'shr_legacy', object_name: 'account', record_id: 'a1',
      recipient_type: 'user', recipient_id: 'bob', access_level: 'full',
    }];
    expect(await svc.canEdit('account', 'a1', { userId: 'bob' })).toBe(true);
    expect(await svc.canDelete('account', 'a1', { userId: 'bob' })).toBe(false);
  });

  it('Modify All (writeScope=org) may delete a record it does not own', async () => {
    expect(await svc.canDelete('account', 'a1', { userId: 'admin', __writeScope: 'org' } as any)).toBe(true);
  });

  it('a principal-less context may not delete a private record', async () => {
    expect(await svc.canDelete('account', 'a1', {})).toBe(false);
  });
});

describe('SharingService.grant / listShares / revoke', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({ account: ACCOUNT_SCHEMA, sys_record_share: {} });
    svc = new SharingService({ engine });
    // [ADR-0111 D1] admin OWNS a1 — the grants below exercise the legitimate
    // owner path through the management gate (unauthorized paths have their
    // own suite below).
    engine._tables.account = [{ id: 'a1', name: 'Acme', owner_id: 'admin' }];
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

  // [ADR-0111 D3] The verb boundary: an edit-level share opens UPDATE but NOT
  // delete. alice holds an edit share on a2 (owned by bob) — update passes,
  // delete is refused (delete needs ownership / write depth / Modify All).
  it('an edit share allows update but NOT delete (ADR-0111 D3)', async () => {
    await svc.grant({ object: 'account', recordId: 'a2', recipientId: 'alice', accessLevel: 'edit' }, { isSystem: true });
    const mw = buildSharingMiddleware(svc);

    let updateNext = false;
    await mw(
      { object: 'account', operation: 'update', data: { id: 'a2', name: 'X' }, context: { userId: 'alice' } } as any,
      async () => { updateNext = true; },
    );
    expect(updateNext).toBe(true);

    await expect(
      mw(
        { object: 'account', operation: 'delete', options: { where: { id: 'a2' } }, context: { userId: 'alice' } } as any,
        async () => {},
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('the record owner may delete their own record', async () => {
    const mw = buildSharingMiddleware(svc);
    let nextCalled = false;
    await mw(
      { object: 'account', operation: 'delete', options: { where: { id: 'a1' } }, context: { userId: 'alice' } } as any,
      async () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(true);
  });

  it('Modify All (writeScope=org) may delete a record it does not own', async () => {
    const mw = buildSharingMiddleware(svc);
    let nextCalled = false;
    await mw(
      { object: 'account', operation: 'delete', options: { where: { id: 'a2' } }, context: { userId: 'admin', __writeScope: 'org' } } as any,
      async () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(true);
  });

  it('bulk delete scopes to owned rows ALONE — an edit share does not widen it (ADR-0111 D3)', async () => {
    await svc.grant({ object: 'account', recordId: 'a2', recipientId: 'bob', accessLevel: 'edit' }, { isSystem: true });
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'account',
      operation: 'delete',
      options: { multi: true, where: {} },
      ast: {},
      context: { userId: 'bob' },
    };
    await mw(ctx, async () => {});
    // bob's edit share on a2 widens a bulk UPDATE but NOT a bulk delete.
    expect(ctx.ast.where).toEqual({ owner_id: 'bob' });
  });

  it('bulk update DOES widen by the edit share (contrast with delete)', async () => {
    await svc.grant({ object: 'account', recordId: 'a2', recipientId: 'bob', accessLevel: 'edit' }, { isSystem: true });
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
    expect(ctx.ast.where).toEqual({ $or: [{ owner_id: 'bob' }, { id: { $in: ['a2'] } }] });
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
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'edit' }, { isSystem: true });
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

// ─────────────────────────────────────────────────────────────────────
// [ADR-0111] Share-management authority — the #3902 reproduction.
// mallory: an ordinary signed-in user with no grants of any kind.
// alice:   owner of account a1.  admin: holds Modify All via the probe.
// ─────────────────────────────────────────────────────────────────────

describe('[ADR-0111 D1] SharingService.canManageShares', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  beforeEach(() => {
    engine = makeFakeEngine({ account: ACCOUNT_SCHEMA, sys_record_share: {} });
    engine._tables.account = [{ id: 'a1', name: 'Acme', owner_id: 'alice' }];
  });

  it('system context manages everything', async () => {
    const svc = new SharingService({ engine });
    expect(await svc.canManageShares('account', 'a1', { isSystem: true })).toBe(true);
  });

  it('the record owner manages their record', async () => {
    const svc = new SharingService({ engine });
    expect(await svc.canManageShares('account', 'a1', { userId: 'alice' })).toBe(true);
  });

  it('a non-owner without Modify All does NOT manage (fail closed, no security plugin)', async () => {
    const svc = new SharingService({ engine });
    expect(await svc.canManageShares('account', 'a1', { userId: 'mallory' })).toBe(false);
  });

  it('Modify All Data (security probe) manages a record it does not own', async () => {
    const svc = new SharingService({
      engine,
      securityService: () => ({ hasWriteBypass: async () => true }),
    });
    expect(await svc.canManageShares('account', 'a1', { userId: 'admin' })).toBe(true);
  });

  it('a throwing probe fails CLOSED to deny', async () => {
    const svc = new SharingService({
      engine,
      securityService: () => ({ hasWriteBypass: async () => { throw new Error('boom'); } }),
    });
    expect(await svc.canManageShares('account', 'a1', { userId: 'admin' })).toBe(false);
  });

  it('a missing record and a principal-less context both deny', async () => {
    const svc = new SharingService({ engine });
    expect(await svc.canManageShares('account', 'nope', { userId: 'alice' })).toBe(false);
    expect(await svc.canManageShares('account', 'a1', {})).toBe(false);
  });

  // ── [ADR-0111 D1 DEPTH] hierarchy-manager authority ──────────────────
  // a1 is owned by alice. bob is alice's manager (own_and_reports covers alice);
  // carol is an unrelated peer. The enterprise resolver is stubbed.
  it('a hierarchy manager whose write DEPTH covers the owner may manage the record', async () => {
    const svc = new SharingService({
      engine,
      securityService: () => ({
        hasWriteBypass: async () => false,
        resolveWriteScope: async () => 'own_and_reports',
      }),
      hierarchyResolver: () => ({
        // bob manages alice; nobody else in bob's reports.
        resolveOwnerIds: async (ctx: any) => ctx.userId === 'bob' ? ['bob', 'alice'] : [ctx.userId],
      }),
    });
    expect(await svc.canManageShares('account', 'a1', { userId: 'bob' })).toBe(true);
  });

  it('a peer with the same DEPTH scope but NOT covering the owner is denied', async () => {
    const svc = new SharingService({
      engine,
      securityService: () => ({
        hasWriteBypass: async () => false,
        resolveWriteScope: async () => 'unit',
      }),
      hierarchyResolver: () => ({
        resolveOwnerIds: async (ctx: any) => [ctx.userId], // carol's unit owner-set excludes alice
      }),
    });
    expect(await svc.canManageShares('account', 'a1', { userId: 'carol' })).toBe(false);
  });

  it("a probe reporting 'org' does NOT widen management (fail-open guard — only Modify All via hasWriteBypass grants org)", async () => {
    const svc = new SharingService({
      engine,
      securityService: () => ({
        hasWriteBypass: async () => false, // NOT a real Modify-All holder
        resolveWriteScope: async () => 'org', // the fail-open unmatched-object default
      }),
      // A resolver that would (wrongly) return everyone if consulted.
      hierarchyResolver: () => ({ resolveOwnerIds: async () => ['alice', 'bob', 'carol'] }),
    });
    expect(await svc.canManageShares('account', 'a1', { userId: 'stranger' })).toBe(false);
  });

  it("'own' scope adds nothing beyond the ownership check (non-owner denied)", async () => {
    const svc = new SharingService({
      engine,
      securityService: () => ({
        hasWriteBypass: async () => false,
        resolveWriteScope: async () => 'own',
      }),
      hierarchyResolver: () => ({ resolveOwnerIds: async (ctx: any) => [ctx.userId] }),
    });
    expect(await svc.canManageShares('account', 'a1', { userId: 'mallory' })).toBe(false);
  });

  it('DEPTH branch needs the enterprise resolver — a manager scope with no resolver falls back to owner-only', async () => {
    const svc = new SharingService({
      engine,
      securityService: () => ({
        hasWriteBypass: async () => false,
        resolveWriteScope: async () => 'unit',
      }),
      // No hierarchyResolver → resolveOwnerScopeIds fails closed to [me], which
      // excludes alice, so bob cannot manage alice's record.
    });
    expect(await svc.canManageShares('account', 'a1', { userId: 'bob' })).toBe(false);
  });
});

describe('[ADR-0111 D1/D4/D5] the #3902 Mallory reproduction', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({ account: ACCOUNT_SCHEMA, sys_record_share: {} });
    svc = new SharingService({ engine });
    engine._tables.account = [{ id: 'a1', name: 'Acme', owner_id: 'alice' }];
  });

  it('① Mallory cannot revoke a share alice granted (was: 204, silent revoke)', async () => {
    const share = await svc.grant(
      { object: 'account', recordId: 'a1', recipientId: 'colleague', accessLevel: 'edit' },
      { userId: 'alice' },
    );
    await expect(
      svc.revoke(share.id, { userId: 'mallory' }, { object: 'account', recordId: 'a1' }),
    ).rejects.toThrow(/PERMISSION_DENIED/);
    expect(engine._tables.sys_record_share.length).toBe(1); // still there
    // alice (owner) still can — symmetric with grant.
    await svc.revoke(share.id, { userId: 'alice' }, { object: 'account', recordId: 'a1' });
    expect(engine._tables.sys_record_share.length).toBe(0);
  });

  it('② Mallory cannot enumerate the shares on alice\'s record (was: 200, full list)', async () => {
    await svc.grant({ object: 'account', recordId: 'a1', recipientId: 'colleague' }, { userId: 'alice' });
    await expect(
      svc.listShares('account', 'a1', { userId: 'mallory' }),
    ).rejects.toThrow(/PERMISSION_DENIED/);
    // The owner keeps the list.
    expect((await svc.listShares('account', 'a1', { userId: 'alice' })).length).toBe(1);
  });

  it('③ Mallory cannot grant herself access (was: 201, row persisted with granted_by=mallory)', async () => {
    await expect(
      svc.grant(
        { object: 'account', recordId: 'a1', recipientId: 'mallory', accessLevel: 'edit' },
        { userId: 'mallory' },
      ),
    ).rejects.toThrow(/PERMISSION_DENIED/);
    expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
  });

  it('missing/invisible record reads as NOT_FOUND, not as a permission verdict', async () => {
    await expect(
      svc.listShares('account', 'ghost', { userId: 'mallory' }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe('[ADR-0111 D4] revoke ownership + source validation', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({
      account: ACCOUNT_SCHEMA,
      lead: LEAD_SCHEMA,
      sys_record_share: {},
    });
    svc = new SharingService({ engine });
    engine._tables.account = [{ id: 'a1', owner_id: 'alice' }];
    engine._tables.lead = [{ id: 'l1', owner_id: 'alice' }];
  });

  it('a share id cannot be revoked through an unrelated record path (scope mismatch → NOT_FOUND)', async () => {
    const share = await svc.grant(
      { object: 'account', recordId: 'a1', recipientId: 'bob' },
      { userId: 'alice' },
    );
    await expect(
      svc.revoke(share.id, { userId: 'alice' }, { object: 'lead', recordId: 'l1' }),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(engine._tables.sys_record_share.length).toBe(1);
  });

  it('a rule-materialised share refuses manual revoke (CONFLICT — the reconcile would resurrect it)', async () => {
    engine._tables.sys_record_share = [{
      id: 'shr_rule', object_name: 'account', record_id: 'a1',
      recipient_type: 'user', recipient_id: 'bob', access_level: 'read',
      source: 'rule', source_id: 'srule_1',
    }];
    await expect(
      svc.revoke('shr_rule', { userId: 'alice' }, { object: 'account', recordId: 'a1' }),
    ).rejects.toThrow(/CONFLICT/);
    // The system path (rule reconciliation) still deletes by id.
    await svc.revoke('shr_rule', { isSystem: true });
    expect(engine._tables.sys_record_share.length).toBe(0);
  });

  it('a missing share id is NOT_FOUND for a user, a no-op for system', async () => {
    await expect(
      svc.revoke('shr_ghost', { userId: 'alice' }, { object: 'account', recordId: 'a1' }),
    ).rejects.toThrow(/NOT_FOUND/);
    await svc.revoke('shr_ghost', { isSystem: true }); // no throw
  });
});

describe('[ADR-0111 D7] no inert grants', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({
      account: ACCOUNT_SCHEMA,
      whiteboard: CANON_PUBLIC_RW_SCHEMA,
      note: ORPHAN_SCHEMA,
      detail_item: {
        name: 'detail_item',
        sharingModel: 'controlled_by_parent',
        fields: { id: {}, owner_id: {} },
      },
      sys_record_share: {},
    });
    svc = new SharingService({ engine });
    engine._tables.account = [{ id: 'a1', owner_id: 'alice' }];
    engine._tables.whiteboard = [{ id: 'w1', owner_id: 'alice' }];
    engine._tables.note = [{ id: 'n1' }];
    engine._tables.detail_item = [{ id: 'd1', owner_id: 'alice' }];
  });

  it('refuses non-user recipient types instead of persisting rows no gate reads', async () => {
    // Every non-`user` member of RecordShareRecipientType — no `as any`
    // needed since #4539 aligned the contract type to the storage select.
    for (const recipientType of ['group', 'position', 'unit_and_subordinates', 'guest'] as const) {
      await expect(
        svc.grant(
          { object: 'account', recordId: 'a1', recipientId: 'g1', recipientType },
          { userId: 'alice' },
        ),
      ).rejects.toThrow(/VALIDATION_FAILED/);
    }
    expect(engine._tables.sys_record_share ?? []).toHaveLength(0);
  });

  it('refuses a grant on a public object (no gate would ever consult it)', async () => {
    await expect(
      svc.grant({ object: 'whiteboard', recordId: 'w1', recipientId: 'bob' }, { userId: 'alice' }),
    ).rejects.toThrow(/SHARING_NOT_ENABLED/);
  });

  it('refuses a grant on an owner-less object', async () => {
    await expect(
      svc.grant({ object: 'note', recordId: 'n1', recipientId: 'bob' }, { userId: 'alice' }),
    ).rejects.toThrow(/SHARING_NOT_ENABLED/);
  });

  it('refuses a grant on a controlled_by_parent detail (share the master instead)', async () => {
    await expect(
      svc.grant({ object: 'detail_item', recordId: 'd1', recipientId: 'bob' }, { userId: 'alice' }),
    ).rejects.toThrow(/SHARING_NOT_ENABLED.*master/);
  });

  it('refuses a grant on a bypass object', async () => {
    await expect(
      svc.grant({ object: 'sys_user', recordId: 'u1', recipientId: 'bob' }, { userId: 'alice' }),
    ).rejects.toThrow(/SHARING_NOT_ENABLED/);
  });

  it('a manual grant coexists with a rule-materialised row instead of clobbering it', async () => {
    engine._tables.sys_record_share = [{
      id: 'shr_rule', object_name: 'account', record_id: 'a1',
      recipient_type: 'user', recipient_id: 'bob', access_level: 'read',
      source: 'rule', source_id: 'srule_1',
    }];
    const manual = await svc.grant(
      { object: 'account', recordId: 'a1', recipientId: 'bob', accessLevel: 'edit' },
      { userId: 'alice' },
    );
    expect(manual.id).not.toBe('shr_rule');
    expect(engine._tables.sys_record_share.length).toBe(2);
    const rule = engine._tables.sys_record_share.find(r => r.id === 'shr_rule');
    expect(rule?.source).toBe('rule'); // untouched
  });
});

describe('[ADR-0111 D5] sys_record_share read self-scope (middleware)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: SharingService;
  beforeEach(() => {
    engine = makeFakeEngine({ account: ACCOUNT_SCHEMA, sys_record_share: {} });
    svc = new SharingService({ engine });
  });

  const findCtx = (context: any): any => ({
    object: 'sys_record_share',
    operation: 'find',
    ast: {},
    context,
  });

  it('a plain user is scoped to rows that NAME them (recipient or grantor)', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx = findCtx({ userId: 'mallory', systemPermissions: [] });
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toEqual({
      $or: [{ recipient_id: 'mallory' }, { granted_by: 'mallory' }],
    });
  });

  it('manage_sharing (and the legacy manage_platform_settings) keeps the tenant-wide list', async () => {
    const mw = buildSharingMiddleware(svc);
    for (const cap of ['manage_sharing', 'manage_platform_settings']) {
      const ctx = findCtx({ userId: 'admin', systemPermissions: [cap] });
      await mw(ctx, async () => {});
      expect(ctx.ast.where).toBeUndefined();
    }
  });

  it('a principal-less caller sees nothing (deny-all)', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx = findCtx({});
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toEqual({ id: '__deny_all__' });
  });

  it('system context is untouched', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx = findCtx({ isSystem: true });
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toBeUndefined();
  });

  it('composes with a caller-provided filter instead of replacing it', async () => {
    const mw = buildSharingMiddleware(svc);
    const ctx: any = {
      object: 'sys_record_share',
      operation: 'find',
      ast: { where: { object_name: 'account' } },
      context: { userId: 'bob', systemPermissions: [] },
    };
    await mw(ctx, async () => {});
    expect(ctx.ast.where).toEqual({
      $and: [
        { object_name: 'account' },
        { $or: [{ recipient_id: 'bob' }, { granted_by: 'bob' }] },
      ],
    });
  });
});
