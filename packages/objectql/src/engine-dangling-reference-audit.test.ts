// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4551] The audit against the REAL engine — end to end on the exact residual
 * #4441 documented.
 *
 * #4441's write-path guard exempts `isSystem` writes on purpose: seed replay,
 * package install and boot provisioning write in an order that only resolves
 * once the batch completes, and failing them closed turns an ordering detail
 * into a boot failure. That exemption stays. What this pins is the other half —
 * the row a system write leaves behind is now SAID OUT LOUD.
 *
 * The two halves must also stay in agreement, which is what makes this file
 * worth having on top of the unit suite (#4550: a stand-in must never be looser
 * than the real implementation). Here the audit runs on the real `ObjectQL`
 * with the real driver and the real `referenceExists`, so if the enforcement's
 * probe and the audit's probe ever diverge, these tests are where it shows.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const permissionSet = {
  name: 'aud_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

/** The RBAC link-table shape: the binding an audience gate must resolve. */
const binding = {
  name: 'aud_position_permission_set',
  label: 'Binding',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    permission_set_id: {
      name: 'permission_set_id', label: 'Permission Set',
      type: 'lookup' as const, reference: 'aud_permission_set',
      required: true, deleteBehavior: 'set_null' as const,
    },
  },
};

const history = {
  name: 'aud_history',
  label: 'History',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    note: { name: 'note', label: 'Note', type: 'text' as const },
    // `sys_metadata_history.recorded_by` in miniature: a readonly lookup the
    // platform USED to fill with the sentinel string `actor ?? 'system'` (NULL
    // since #4556). The stored `'system'` below is therefore a legacy row —
    // still the honest specimen for what a readonly reference that resolves to
    // nothing looks like (#4743).
    recorded_by: {
      name: 'recorded_by', label: 'Recorded By',
      type: 'lookup' as const, reference: 'aud_permission_set', readonly: true,
    },
  },
};

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  /** Read path: must NOT materialise a store, or a pure read would show up in
   * the "nothing was written" snapshot as a change. */
  const peek = (obj: string) => stores.get(obj) ?? new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(peek(object).values()).filter((r) => matches(r, ast?.where));
      // A real driver honours `limit`; a double that ignored it would make the
      // audit's bounded-scan reporting untestable AND looser than production.
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of peek(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return next;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      for (const r of rows) storeFor(object).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

describe('[#4551] the engine reports the dangling rows its own `isSystem` exemption allows', () => {
  let engine: ObjectQL;
  let stores: Map<string, Map<string, Record<string, unknown>>>;
  const userCtx = { userId: 'u1' };

  beforeEach(async () => {
    engine = new ObjectQL();
    const stub = makeStubDriver();
    stores = stub.stores;
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(permissionSet);
    engine.registry.registerObject(binding);
    engine.registry.registerObject(history);
    await engine.insert('aud_permission_set', { id: 'ps_real', name: 'Real' }, { context: { isSystem: true } } as any);
  });

  it('the residual, stated: a system write lands a dangling binding and the audit names it', async () => {
    // This is the write #4441 deliberately lets through.
    await engine.insert(
      'aud_position_permission_set',
      { id: 'ppr_1', permission_set_id: 'ps_never_seeded' },
      { context: { isSystem: true } } as any,
    );

    const out = await engine.inspectDanglingReferences({ objects: ['aud_position_permission_set'] });

    expect(out.undetermined).toBe(0);
    expect(out.dangling).toHaveLength(1);
    expect(out.dangling[0]).toEqual({
      objectName: 'aud_position_permission_set',
      recordId: 'ppr_1',
      field: 'permission_set_id',
      target: 'aud_permission_set',
      value: 'ps_never_seeded',
    });
  });

  it('…and the enforcement it reports on is untouched — a caller write is still refused', async () => {
    // #4551 is a REPORT. If this ever passes, the audit was smuggled into the
    // write path, which the issue explicitly forbids.
    await expect(
      engine.insert(
        'aud_position_permission_set',
        { permission_set_id: 'ps_never_seeded' },
        { context: userCtx } as any,
      ),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('a resolvable binding is not reported', async () => {
    await engine.insert(
      'aud_position_permission_set',
      { id: 'ppr_ok', permission_set_id: 'ps_real' },
      { context: { isSystem: true } } as any,
    );
    const out = await engine.inspectDanglingReferences({ objects: ['aud_position_permission_set'] });
    expect(out.dangling).toEqual([]);
    expect(out.scanned).toBe(1);
  });

  it('the audit issues NO writes — the stored rows are byte-identical afterwards', async () => {
    await engine.insert(
      'aud_position_permission_set',
      { id: 'ppr_1', permission_set_id: 'ps_never_seeded' },
      { context: { isSystem: true } } as any,
    );
    const snapshot = (): string =>
      JSON.stringify([...stores].map(([k, v]) => [k, [...v.entries()]]));
    const before = snapshot();

    const out = await engine.inspectDanglingReferences();

    expect(out.dangling.length).toBeGreaterThan(0);
    expect(snapshot()).toBe(before);
  });

  it('[#4743] a readonly lookup that resolves to nothing lands in `provenance`, not `dangling`', async () => {
    // This case used to assert "not reported at all", on the grounds that the
    // platform wrote the SENTINEL STRING `actor ?? 'system'` here. #4556 made
    // that write NULL, so the only readonly references left are real ids — and
    // a real id that names no row is a finding. It is filed apart from
    // `dangling` because it answers a different question: not "a declared link
    // is broken" but "the actor this row records is gone".
    //
    // Note what the retired assertion would have done: `dangling: []` still
    // passes, because the finding MOVED rather than vanished. Asserting where
    // it moved to is the only version of this test that can go red.
    await engine.insert(
      'aud_history', { id: 'h1', note: 'n', recorded_by: 'system' }, { context: { isSystem: true } } as any,
    );
    const out = await engine.inspectDanglingReferences({ objects: ['aud_history'] });

    expect(out.dangling).toEqual([]);
    expect(out.undetermined).toBe(0);
    expect(out.provenance).toEqual([{
      objectName: 'aud_history',
      recordId: 'h1',
      field: 'recorded_by',
      target: 'aud_permission_set',
      value: 'system',
    }]);
  });

  it('an unregistered TARGET is `undetermined`, not a finding', async () => {
    // Exactly the case `referenceExists` answers `null` for — and the audit and
    // the write-path guard read that `null` the same way: the write is allowed
    // through, and the audit declines to condemn the row it produced.
    engine.registry.registerObject({
      name: 'aud_orphan',
      label: 'Orphan',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        other: { name: 'other', label: 'Other', type: 'lookup' as const, reference: 'not_registered_anywhere' },
      },
    } as any);
    await engine.insert('aud_orphan', { id: 'o1', other: 'whatever' }, { context: userCtx } as any);

    const out = await engine.inspectDanglingReferences({ objects: ['aud_orphan'] });
    expect(out.dangling).toEqual([]);
    expect(out.undetermined).toBe(1);
  });
});
