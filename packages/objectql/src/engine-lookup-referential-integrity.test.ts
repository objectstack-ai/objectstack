// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4441] A `lookup` must not accept an id that exists in no row of the object
 * it declares.
 *
 * The field metadata is unambiguous —
 * `{"type":"lookup","required":true,"reference":"sys_permission_set",
 *   "deleteBehavior":"set_null"}` — and `deleteBehavior` shows the platform
 * already reasons about this edge on the DELETE side. The insert side never
 * checked, so both of these created a row:
 *
 *   POST /data/sys_position_permission_set
 *        {"position_id":"…","permission_set_id":"ps_does_not_exist_at_all"} → 200
 *   POST /data/showcase_task
 *        {"title":"…","project":"proj_does_not_exist","status":"backlog"}   → 200
 *
 * On the RBAC link tables a dangling row is a security-surface record that
 * resolves to nothing: the audience-anchor gate has to resolve that permission
 * set to evaluate the grant, so the binding is an unevaluable gate input.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const permissionSet = {
  name: 'ref_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

// The RBAC link-table shape: a required lookup that an audience gate must
// resolve.
const binding = {
  name: 'ref_position_permission_set',
  label: 'Binding',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    permission_set_id: {
      name: 'permission_set_id', label: 'Permission Set',
      type: 'lookup' as const, reference: 'ref_permission_set',
      required: true, deleteBehavior: 'set_null' as const,
    },
    note: { name: 'note', label: 'Note', type: 'text' as const },
  },
};

// An ordinary application object with an OPTIONAL lookup, to prove the rule is
// about resolvability rather than about `required`.
const task = {
  name: 'ref_task',
  label: 'Task',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    project: {
      name: 'project', label: 'Project',
      type: 'lookup' as const, reference: 'ref_permission_set',
    },
    tags: {
      name: 'tags', label: 'Tags',
      type: 'lookup' as const, reference: 'ref_permission_set', multiple: true,
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
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
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

/** Capture a rejection so its structured `fields[]` can be inspected. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

describe('[#4441] a lookup id that resolves to nothing is refused', () => {
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
    engine.registry.registerObject(task);
    await engine.insert('ref_permission_set', { id: 'ps_real', name: 'Real' }, { context: { isSystem: true } } as any);
  });

  it('the RBAC link table refuses a binding that points at nothing', async () => {
    const err = await refusalOf(() =>
      engine.insert(
        'ref_position_permission_set',
        { permission_set_id: 'ps_does_not_exist_at_all' },
        { context: userCtx } as any,
      ),
    );

    // The envelope the issue asks for: 400-shaped `fields[]`, naming the field
    // and the unresolvable id — the same shape a `required` violation carries.
    expect(err.name).toBe('ValidationError');
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0]).toMatchObject({
      field: 'permission_set_id',
      code: 'reference_not_found',
      value: 'ps_does_not_exist_at_all',
    });
    expect(err.fields[0].message).toContain('ps_does_not_exist_at_all');

    // …and nothing was written. A security-surface row that resolves to
    // nothing must not exist even briefly.
    expect(stores.get('ref_position_permission_set')?.size ?? 0).toBe(0);
  });

  it('a resolvable binding is unaffected', async () => {
    const row: any = await engine.insert(
      'ref_position_permission_set',
      { permission_set_id: 'ps_real' },
      { context: userCtx } as any,
    );
    expect(row.permission_set_id).toBe('ps_real');
  });

  it('an ordinary application object is covered too', async () => {
    const err = await refusalOf(() =>
      engine.insert('ref_task', { title: 'T', project: 'proj_does_not_exist' }, { context: userCtx } as any),
    );
    expect(err.fields[0]).toMatchObject({ field: 'project', code: 'reference_not_found' });
  });

  it('an UPDATE that repoints a lookup at nothing is refused', async () => {
    const row: any = await engine.insert(
      'ref_task', { title: 'T', project: 'ps_real' }, { context: userCtx } as any,
    );
    const err = await refusalOf(() =>
      engine.update('ref_task', { project: 'gone' }, { where: { id: row.id }, context: userCtx } as any),
    );
    expect(err.fields[0]).toMatchObject({ field: 'project', code: 'reference_not_found' });
    // The stored value did not move.
    const after: any = await engine.findOne('ref_task', { where: { id: row.id } } as any);
    expect(after.project).toBe('ps_real');
  });

  it('a BULK update is refused as well — the call site, not just the switch', async () => {
    await engine.insert('ref_task', { title: 'A', project: 'ps_real' }, { context: userCtx } as any);
    const err = await refusalOf(() =>
      engine.update(
        'ref_task', { project: 'gone' },
        { where: { title: 'A' }, multi: true, context: userCtx } as any,
      ),
    );
    expect(err.fields[0]).toMatchObject({ field: 'project', code: 'reference_not_found' });
  });

  it('clearing a lookup is not a dangling reference', async () => {
    const row: any = await engine.insert(
      'ref_task', { title: 'T', project: 'ps_real' }, { context: userCtx } as any,
    );
    // `null` / '' mean "no link" — exactly what `deleteBehavior: 'set_null'`
    // produces, so they must never be validated as ids.
    await engine.update('ref_task', { project: null }, { where: { id: row.id }, context: userCtx } as any);
    await engine.update('ref_task', { project: '' }, { where: { id: row.id }, context: userCtx } as any);
    const after: any = await engine.findOne('ref_task', { where: { id: row.id } } as any);
    expect(after.project === null || after.project === '').toBe(true);
  });

  it('every element of a multi-value lookup is checked', async () => {
    const err = await refusalOf(() =>
      engine.insert(
        'ref_task', { title: 'T', tags: ['ps_real', 'ps_missing'] }, { context: userCtx } as any,
      ),
    );
    expect(err.fields[0]).toMatchObject({ field: 'tags', code: 'reference_not_found', value: 'ps_missing' });
  });

  it('a system-context write is exempt, so seed replay keeps its ordering freedom', async () => {
    // Seeds, package install and boot provisioning legitimately write rows in
    // an order that only resolves once the batch completes. Failing them closed
    // would turn an ordering detail into a boot failure.
    const row: any = await engine.insert(
      'ref_position_permission_set',
      { permission_set_id: 'ps_not_yet_seeded' },
      { context: { isSystem: true } } as any,
    );
    expect(row.permission_set_id).toBe('ps_not_yet_seeded');
  });

  it('a server-stamped lookup is never reported as the caller\'s bad reference', async () => {
    // `owner_id` / `organization_id` / `created_by` are lookups too, written by
    // hooks and middleware rather than by the request. The check reads only
    // caller-supplied keys, so a stamp pointing at an unseeded row cannot turn
    // into a caller-facing rejection.
    const row: any = await engine.insert(
      'ref_task', { title: 'T' }, { context: { ...userCtx, userId: 'user_not_in_this_db' } } as any,
    );
    expect(row.title).toBe('T');
  });

  it('a value the PLATFORM derived is never reported as the caller\'s bad reference', async () => {
    // A form serializes an unpicked control as an explicit `null`, and
    // `applyFieldDefaults` then fills it from `defaultValue` — including the
    // `current_user` token (#2706). The key IS in the payload, but the id that
    // lands is the platform's, so checking it would reject an ordinary insert
    // whenever the acting principal has no row in the target (exactly what a
    // bare-engine / test driver looks like). Whether to check is decided by the
    // caller's own raw value, not by key presence.
    engine.registry.registerObject({
      name: 'ref_defaulted',
      label: 'Defaulted',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' as const },
        owner: {
          name: 'owner', label: 'Owner', type: 'lookup' as const,
          reference: 'ref_permission_set', defaultValue: 'ps_not_a_row',
        },
      },
    } as any);

    const explicitNull: any = await engine.insert(
      'ref_defaulted', { title: 'T', owner: null }, { context: userCtx } as any,
    );
    expect(explicitNull.owner).toBe('ps_not_a_row');

    const omitted: any = await engine.insert(
      'ref_defaulted', { title: 'T2' }, { context: userCtx } as any,
    );
    expect(omitted.owner).toBe('ps_not_a_row');

    // …but a value the caller DID name is still checked.
    const err = await refusalOf(() =>
      engine.insert('ref_defaulted', { title: 'T3', owner: 'nope' }, { context: userCtx } as any),
    );
    expect(err.fields[0]).toMatchObject({ field: 'owner', code: 'reference_not_found', value: 'nope' });
  });

  it('a READONLY lookup is not the caller\'s to answer for', async () => {
    // By construction, not by exemption: `stripReadonlyFields` /
    // `stripReadonlyForInsert` remove a non-system caller's value from a
    // readonly field before the write, so anything still there was written by
    // the PLATFORM — outside this check's stated scope.
    //
    // The real case that found this: `sys_metadata_history.recorded_by` is a
    // `lookup('sys_user', { readonly: true })` the metadata repository fills
    // with `actor ?? 'system'` — a SENTINEL STRING, not a user id — on a write
    // that carries no `isSystem`. Checking it rejected ordinary metadata
    // authoring (package create / publish / clone) in the dogfood gate.
    engine.registry.registerObject({
      name: 'ref_history',
      label: 'History',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        note: { name: 'note', label: 'Note', type: 'text' as const },
        recorded_by: {
          name: 'recorded_by', label: 'Recorded By',
          type: 'lookup' as const, reference: 'ref_permission_set', readonly: true,
        },
      },
    } as any);

    const row: any = await engine.insert(
      'ref_history', { note: 'n', recorded_by: 'system' }, { context: userCtx } as any,
    );
    expect(row.recorded_by).toBe('system');
  });

  it('…and the issue\'s own fields are NOT readonly, so they stay enforced', () => {
    // The narrowing above must not quietly cover the two fields #4441 names.
    for (const [obj, field] of [
      ['ref_position_permission_set', 'permission_set_id'],
      ['ref_task', 'project'],
    ] as const) {
      const def: any = (engine.registry.getObject(obj) as any).fields[field];
      expect(def.readonly, `${obj}.${field} must not be readonly`).not.toBe(true);
    }
  });

  it('an unresolvable TARGET object fails open rather than blocking every write', async () => {
    // A reference to an object that is not registered (another datasource, a
    // package not installed) cannot be checked. An integrity check that cannot
    // run must not invent a rejection.
    engine.registry.registerObject({
      name: 'ref_orphan',
      label: 'Orphan',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        other: { name: 'other', label: 'Other', type: 'lookup' as const, reference: 'not_registered_anywhere' },
      },
    } as any);
    const row: any = await engine.insert(
      'ref_orphan', { other: 'whatever' }, { context: userCtx } as any,
    );
    expect(row.other).toBe('whatever');
  });
});
