// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22957] A `tree` field's `deleteBehavior` is what a delete of the record it
 * references does: `set_null` (the default the spec materializes) clears the
 * child's parent, `cascade` deletes the subtree, `restrict` refuses the delete.
 *
 * ## The defect
 *
 * `FieldSchema` materializes `deleteBehavior: 'set_null'` on a `tree` beside
 * `lookup`, because the type "is in the relational family, where the key
 * states delete semantics". The referential delete walk admitted
 * `master_detail` and `lookup` only, so it never read a `tree` relation:
 * deleting a parent answered success and left every child holding the
 * deleted id, and an authored `cascade` or `restrict` was inert the same way.
 * Measured at the public doors on `examples/app-showcase`
 * (`showcase_field_zoo.f_tree`): `os verify --delete-behaviors` reported it
 * contradicted through REST and the system door.
 *
 * ## What is pinned here
 *
 *  - `set_null`, materialized by the spec's own parse and authored, clears the
 *    child's parent and keeps the child;
 *  - `cascade` deletes the whole subtree, past `MAX_CASCADE_DEPTH`, and
 *    nothing outside it;
 *  - `restrict` refuses with the ADR-0112 envelope naming the tree's own object
 *    as the dependent, and keeps the row; a leaf still deletes;
 *  - a REQUIRED tree's `set_null` escalates to that refusal, as a required
 *    `lookup`'s does;
 *  - a cycle in the data terminates: a corrupt row pointing at its own
 *    descendant, and a row pointing at itself;
 *  - a subtree cascade is one unit of work: a refusal from a node deep in it
 *    rolls back the nodes already deleted (`planCascadeAtomicity` reads the
 *    same family);
 *  - `multiple: true` is refused on a `tree` by the parse, and a raw
 *    registration around it is read single-valued, as the walk's multi-value
 *    arbiter (`isMultiValueField`) reads it for every type;
 *  - CONTROLS: `lookup` (default `set_null`, `cascade`, `restrict`) and
 *    `master_detail` (default `cascade`, `restrict`) answer exactly as before;
 *  - [#23065] a `tree` that names no `reference` is a reference to its own
 *    object: the registry writes that self-reference at registration (the door
 *    a metadata save and a raw registration reach without the spec's parse), so
 *    every behaviour above takes effect on it too.
 *
 * The driver has REAL snapshot rollback (the `engine-cascade-delete-atomic`
 * shape): a stub whose rollback is a no-op cannot tell "refused and rolled
 * back" from "refused halfway", so the atomicity pin would pass vacuously.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema, ObjectSchema } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;

function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string): Map<string, Row> => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const committed: unknown[] = [];
  const rolledBack: unknown[] = [];
  const snapshots = new Map<unknown, Map<string, Map<string, Row>>>();
  let nextId = 0;
  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Row)) {
      if (k.startsWith('$')) continue;
      const exp = v && typeof v === 'object' && '$eq' in (v as Row) ? (v as Row).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {},
    committed, rolledBack,
    rowsOf: (o: string): Row[] => Array.from(storeFor(o).values()),
    rowOf: (o: string, id: unknown): Row | undefined => storeFor(o).get(String(id)),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: { where?: unknown; limit?: unknown } | undefined) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: { where?: unknown } | undefined) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Row) {
      nextId += 1;
      const id = (data.id as string | undefined) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      const s = storeFor(o);
      const cur = s.get(String(id));
      if (!cur) throw new Error(`not found ${o}/${id}`);
      const up = { ...cur, ...data, id };
      s.set(String(id), up);
      return up;
    },
    async upsert(o: string, data: Row) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: { where?: unknown } | undefined) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() {
      const handle = { __trx: snapshots.size + committed.length + rolledBack.length + 1 };
      const snap = new Map<string, Map<string, Row>>();
      for (const [o, s] of stores) snap.set(o, new Map(Array.from(s, ([k, v]) => [k, { ...v }])));
      snapshots.set(handle, snap);
      return handle;
    },
    async commit(handle: unknown) { snapshots.delete(handle); committed.push(handle); },
    async rollback(handle: unknown) {
      const snap = snapshots.get(handle);
      if (snap) { stores.clear(); for (const [o, s] of snap) stores.set(o, s); }
      snapshots.delete(handle);
      rolledBack.push(handle);
    },
  };
  return driver;
}

async function makeEngine(objects: unknown[]) {
  const quiet = () => {};
  const engine = new ObjectQL({ logger: { debug: quiet, info: quiet, warn: quiet, error: quiet } } as any);
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o as any, '__test__');
  return { engine, driver };
}

const id = { name: 'id', type: 'text' as const, primaryKey: true };
const name = { name: 'name', type: 'text' as const };

/** An object whose hierarchy is the `tree` field `parent`, declared as `parentDef`. */
const treeObject = (objectName: string, parentDef: Record<string, unknown>) => ({
  name: objectName,
  label: objectName,
  fields: { id, name, parent: { name: 'parent', ...parentDef } },
});

/** The tree field as the spec's parse produces it, which is what a built artifact carries. */
const parsedTree = (reference: string, extra: Record<string, unknown> = {}) =>
  FieldSchema.parse({ type: 'tree', reference, ...extra }) as Record<string, unknown>;

const namesOf = (rows: Row[]) => rows.map((r) => r.name).sort();

async function refusalOf(promise: Promise<unknown>): Promise<any> {
  try { await promise; } catch (err) { return err; }
  throw new Error('expected the delete to be refused');
}

describe('[#22957] a tree field\'s deleteBehavior takes effect on a parent delete', () => {
  describe('set_null — the materialized default and the authored value', () => {
    it('the spec\'s parse materializes set_null on a tree that authors nothing', () => {
      // The premise the engine pins below read: the value a built artifact carries.
      expect(parsedTree('zt_node').deleteBehavior).toBe('set_null');
    });

    it.each([
      ['materialized by the parse', parsedTree('zt_node')],
      ['authored', { type: 'tree', reference: 'zt_node', deleteBehavior: 'set_null' }],
      ['absent (a raw registration around the parse)', { type: 'tree', reference: 'zt_node' }],
    ])('%s: deleting the parent clears the child\'s parent and keeps the child', async (_label, def) => {
      const { engine, driver } = await makeEngine([treeObject('zt_node', def)]);
      const p = await engine.insert('zt_node', { name: 'P' });
      const c = await engine.insert('zt_node', { name: 'C', parent: p.id });
      const bystander = await engine.insert('zt_node', { name: 'B', parent: c.id });

      await engine.delete('zt_node', { where: { id: p.id } } as any);

      expect(driver.rowOf('zt_node', p.id)).toBeUndefined();
      expect(driver.rowOf('zt_node', c.id)).toMatchObject({ name: 'C', parent: null });
      // The other direction: a row that never referenced the deleted record is untouched.
      expect(driver.rowOf('zt_node', bystander.id)).toMatchObject({ name: 'B', parent: c.id });
    });
  });

  describe('cascade — a subtree delete', () => {
    const node = treeObject('zt_branch', { type: 'tree', reference: 'zt_branch', deleteBehavior: 'cascade' });

    it('deletes the node and every descendant, and nothing outside the subtree', async () => {
      const { engine, driver } = await makeEngine([node]);
      const root = await engine.insert('zt_branch', { name: 'root' });
      const a = await engine.insert('zt_branch', { name: 'a', parent: root.id });
      const b = await engine.insert('zt_branch', { name: 'b', parent: a.id });
      await engine.insert('zt_branch', { name: 'c', parent: b.id });
      await engine.insert('zt_branch', { name: 'b2', parent: a.id });
      await engine.insert('zt_branch', { name: 'a2', parent: root.id });
      const other = await engine.insert('zt_branch', { name: 'other' });
      await engine.insert('zt_branch', { name: 'other_kid', parent: other.id });

      await engine.delete('zt_branch', { where: { id: a.id } } as any);

      expect(namesOf(driver.rowsOf('zt_branch'))).toEqual(['a2', 'other', 'other_kid', 'root']);
      // One unit of work: the hierarchy makes the object reference itself.
      expect(driver.committed).toHaveLength(1);
      expect(driver.rolledBack).toHaveLength(0);
    });

    it('reaches past MAX_CASCADE_DEPTH (10): a 15-level chain is deleted whole', async () => {
      // The cap bounds `planCascadeAtomicity`'s schema walk. The row cascade
      // is bounded by its set, so a deep subtree is never cut off part-way,
      // which would strand nodes whose parent is gone.
      const { engine, driver } = await makeEngine([node]);
      const top = await engine.insert('zt_branch', { name: 'L0' });
      let prev = top;
      for (let i = 1; i < 15; i++) prev = await engine.insert('zt_branch', { name: `L${i}`, parent: prev.id });
      const outside = await engine.insert('zt_branch', { name: 'outside' });

      await engine.delete('zt_branch', { where: { id: top.id } } as any);

      expect(namesOf(driver.rowsOf('zt_branch'))).toEqual(['outside']);
      expect(driver.rowOf('zt_branch', outside.id)).toBeDefined();
    });

    it('terminates on a corrupt cycle: a row pointing at its own descendant', async () => {
      const { engine, driver } = await makeEngine([node]);
      const r = await engine.insert('zt_branch', { name: 'R' });
      const k = await engine.insert('zt_branch', { name: 'K', parent: r.id });
      const g = await engine.insert('zt_branch', { name: 'G', parent: k.id });
      const outside = await engine.insert('zt_branch', { name: 'outside' });
      // Written at the driver, the way corrupt data arrives: R's parent is its grandchild.
      await driver.update('zt_branch', r.id, { parent: g.id });

      await engine.delete('zt_branch', { where: { id: k.id } } as any);

      // K's subtree is G, whose subtree is R, whose subtree is K: each once.
      expect(namesOf(driver.rowsOf('zt_branch'))).toEqual(['outside']);
      expect(driver.rowOf('zt_branch', outside.id)).toBeDefined();
    });

    it('terminates on a row that is its own parent', async () => {
      const { engine, driver } = await makeEngine([node]);
      const s = await engine.insert('zt_branch', { name: 'S' });
      const kid = await engine.insert('zt_branch', { name: 'kid', parent: s.id });
      await driver.update('zt_branch', s.id, { parent: s.id });

      await engine.delete('zt_branch', { where: { id: s.id } } as any);

      expect(driver.rowOf('zt_branch', s.id)).toBeUndefined();
      expect(driver.rowOf('zt_branch', kid.id)).toBeUndefined();
    });

    it('is one unit of work: a refusal deep in the subtree rolls back the nodes already deleted', async () => {
      const { engine, driver } = await makeEngine([node]);
      const root = await engine.insert('zt_branch', { name: 'root' });
      await engine.insert('zt_branch', { name: 'k1', parent: root.id });
      const k2 = await engine.insert('zt_branch', { name: 'k2', parent: root.id });
      const vetoed = await engine.insert('zt_branch', { name: 'vetoed', parent: k2.id });
      engine.registerHook(
        'beforeDelete',
        async (ctx: any) => {
          if (String(ctx.input?.id) === String(vetoed.id)) {
            throw Object.assign(new Error('this node is held'), { status: 409 });
          }
        },
        { object: 'zt_branch' },
      );

      const err = await refusalOf(engine.delete('zt_branch', { where: { id: root.id } } as any));

      expect(err).toMatchObject({ status: 409 });
      // k1 was cascaded away before the hook on `vetoed` refused: it is back.
      expect(namesOf(driver.rowsOf('zt_branch'))).toEqual(['k1', 'k2', 'root', 'vetoed']);
      expect(driver.rolledBack).toHaveLength(1);
      expect(driver.committed).toHaveLength(0);
    });
  });

  describe('restrict', () => {
    const node = treeObject('zt_held', { type: 'tree', reference: 'zt_held', deleteBehavior: 'restrict' });

    it('refuses a parent delete while a child references it, and keeps both rows', async () => {
      const { engine, driver } = await makeEngine([node]);
      const p = await engine.insert('zt_held', { name: 'P' });
      const c = await engine.insert('zt_held', { name: 'C', parent: p.id });

      const err = await refusalOf(engine.delete('zt_held', { where: { id: p.id } } as any));

      expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'zt_held' });
      expect(driver.rowOf('zt_held', p.id)).toMatchObject({ name: 'P' });
      expect(driver.rowOf('zt_held', c.id)).toMatchObject({ name: 'C', parent: p.id });
    });

    it('lets a leaf go: nothing references it', async () => {
      const { engine, driver } = await makeEngine([node]);
      const p = await engine.insert('zt_held', { name: 'P' });
      const c = await engine.insert('zt_held', { name: 'C', parent: p.id });

      await engine.delete('zt_held', { where: { id: c.id } } as any);

      expect(driver.rowOf('zt_held', c.id)).toBeUndefined();
      expect(driver.rowOf('zt_held', p.id)).toMatchObject({ name: 'P' });
    });
  });

  describe('required', () => {
    it('a required tree\'s set_null cannot clear the parent, so the parent delete is refused', async () => {
      // The escalation a required `lookup` already takes: a parent that must
      // be present cannot be cleared, so the delete is refused rather than
      // answered with the child's own `required` refusal.
      const { engine, driver } = await makeEngine([
        treeObject('zt_rooted', parsedTree('zt_rooted', { required: true })),
      ]);
      // A required hierarchy's top points at itself; the engine refuses a
      // reference to a row that does not exist yet, so it is written at the
      // driver.
      const root = await driver.create('zt_rooted', { id: 'root', name: 'root', parent: 'root' });
      const c = await engine.insert('zt_rooted', { name: 'C', parent: root.id });

      const err = await refusalOf(engine.delete('zt_rooted', { where: { id: root.id } } as any));

      expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'zt_rooted' });
      expect(driver.rowOf('zt_rooted', root.id)).toMatchObject({ name: 'root' });
      expect(driver.rowOf('zt_rooted', c.id)).toMatchObject({ name: 'C', parent: root.id });
    });
  });

  describe('multiple: true', () => {
    it('is refused on a tree by the spec\'s parse, so no multi-valued tree reaches the walk through it', () => {
      const result = FieldSchema.safeParse({ type: 'tree', reference: 'zt_multi', multiple: true });
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((i) => i.path.join('.') === 'multiple')).toBe(true);
    });

    it('a raw registration around the parse is read single-valued, as the walk reads every type', async () => {
      // `isMultiValueField` is the walk's one multi-value arbiter, and a
      // `tree` is not a multi-capable type: the probe asks scalar equality
      // and `set_null` writes `null`, never a member-removed array.
      const { engine, driver } = await makeEngine([
        treeObject('zt_multi', { type: 'tree', reference: 'zt_multi', multiple: true }),
      ]);
      const p = await engine.insert('zt_multi', { name: 'P' });
      const c = await engine.insert('zt_multi', { name: 'C', parent: p.id });

      await engine.delete('zt_multi', { where: { id: p.id } } as any);

      expect(driver.rowOf('zt_multi', p.id)).toBeUndefined();
      expect(driver.rowOf('zt_multi', c.id)).toMatchObject({ name: 'C', parent: null });
    });
  });

  describe('CONTROLS — lookup and master_detail are unchanged', () => {
    const account = { name: 'zc_account', label: 'Account', fields: { id, name } };
    const ref = (fieldName: string, def: Record<string, unknown>) => ({ [fieldName]: { name: fieldName, ...def } });

    it('lookup: the default clears, cascade deletes; master_detail: the default cascades', async () => {
      const { engine, driver } = await makeEngine([
        account,
        { name: 'zc_cleared', label: 'Cleared', fields: { id, name, ...ref('account', FieldSchema.parse({ type: 'lookup', reference: 'zc_account' }) as Row) } },
        { name: 'zc_cascaded', label: 'Cascaded', fields: { id, name, ...ref('account', { type: 'lookup', reference: 'zc_account', deleteBehavior: 'cascade' }) } },
        { name: 'zc_detail', label: 'Detail', fields: { id, name, ...ref('account', { type: 'master_detail', reference: 'zc_account' }) } },
      ]);
      const a = await engine.insert('zc_account', { name: 'A' });
      const cleared = await engine.insert('zc_cleared', { name: 'n', account: a.id });
      await engine.insert('zc_cascaded', { name: 'c', account: a.id });
      await engine.insert('zc_detail', { name: 'd', account: a.id });

      await engine.delete('zc_account', { where: { id: a.id } } as any);

      expect(driver.rowsOf('zc_account')).toHaveLength(0);
      expect(driver.rowOf('zc_cleared', cleared.id)).toMatchObject({ name: 'n', account: null });
      expect(driver.rowsOf('zc_cascaded')).toHaveLength(0);
      expect(driver.rowsOf('zc_detail')).toHaveLength(0);
    });

    it.each([
      ['lookup', 'zc_lookup_held'],
      ['master_detail', 'zc_detail_held'],
    ])('%s + restrict still refuses with the envelope and keeps the row', async (type, holder) => {
      const { engine, driver } = await makeEngine([
        account,
        { name: holder, label: holder, fields: { id, name, ...ref('account', { type, reference: 'zc_account', deleteBehavior: 'restrict' }) } },
      ]);
      const a = await engine.insert('zc_account', { name: 'A' });
      await engine.insert(holder, { name: 'h', account: a.id });

      const err = await refusalOf(engine.delete('zc_account', { where: { id: a.id } } as any));

      expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: holder });
      expect(driver.rowOf('zc_account', a.id)).toMatchObject({ name: 'A' });
    });

    it('an object nothing references opens no transaction for its delete', async () => {
      // The `'none'` verdict of `planCascadeAtomicity`, unchanged: the plain
      // delete is the CONTROL the atomicity pin above is read against.
      const { engine, driver } = await makeEngine([account]);
      const a = await engine.insert('zc_account', { name: 'A' });

      await engine.delete('zc_account', { where: { id: a.id } } as any);

      expect(driver.rowsOf('zc_account')).toHaveLength(0);
      expect(driver.committed).toHaveLength(0);
      expect(driver.rolledBack).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// [#23065] A `tree` field that names no `reference` references the object that
// declares it. The spec's object parse writes that down, and so does the
// registry, for the doors that reach it without the parse: a metadata save
// stores the authored body verbatim, and a raw `registerObject` is never
// parsed. Before, no reader could read the target off such a field, so the walk
// above never reached it: the parent delete answered success and the child kept
// the deleted id, whatever `deleteBehavior` said.
// ---------------------------------------------------------------------------

describe('[#23065] a tree field that names no reference is a reference to its own object', () => {
  /** The tree field with no `reference`, as a raw registration carries it. */
  const bare = (extra: Record<string, unknown> = {}) => ({ type: 'tree', ...extra });

  it('the registry writes the self-reference at registration, and leaves the caller\'s definition alone', async () => {
    const definition = treeObject('zr_node', bare());
    const { engine } = await makeEngine([definition]);
    expect((engine.registry.getObject('zr_node') as any)?.fields?.parent?.reference).toBe('zr_node');
    // The registered copy carries it; the object the caller handed in does not.
    expect(definition.fields.parent).not.toHaveProperty('reference');
  });

  it('an extension\'s tree references the object it extends', async () => {
    const { engine } = await makeEngine([{ name: 'zr_base', label: 'Base', fields: { id, name } }]);
    engine.registry.registerObject(
      { name: 'zr_base', fields: { parent_node: { name: 'parent_node', type: 'tree' } } } as any,
      '__ext__', undefined, 'extend',
    );
    expect((engine.registry.getObject('zr_base') as any)?.fields?.parent_node?.reference).toBe('zr_base');
  });

  it.each([
    ['absent (a raw registration)', bare()],
    ['materialized by the spec\'s field parse', FieldSchema.parse({ type: 'tree' }) as Record<string, unknown>],
    ['authored', bare({ deleteBehavior: 'set_null' })],
  ])('set_null, %s: deleting the parent clears the child\'s parent and keeps the child', async (_label, def) => {
    const { engine, driver } = await makeEngine([treeObject('zr_node', def)]);
    const p = await engine.insert('zr_node', { name: 'P' });
    const c = await engine.insert('zr_node', { name: 'C', parent: p.id });
    const bystander = await engine.insert('zr_node', { name: 'B', parent: c.id });

    await engine.delete('zr_node', { where: { id: p.id } } as any);

    expect(driver.rowOf('zr_node', p.id)).toBeUndefined();
    expect(driver.rowOf('zr_node', c.id)).toMatchObject({ name: 'C', parent: null });
    expect(driver.rowOf('zr_node', bystander.id)).toMatchObject({ name: 'B', parent: c.id });
  });

  it('the object the spec\'s parse produced registers the same way (the declared-stack door)', async () => {
    const parsed = ObjectSchema.parse({ name: 'zr_parsed', fields: { name: { type: 'text' }, parent: { type: 'tree' } } });
    expect(parsed.fields.parent.reference).toBe('zr_parsed');
    const { engine, driver } = await makeEngine([parsed]);
    const p = await engine.insert('zr_parsed', { name: 'P' });
    const c = await engine.insert('zr_parsed', { name: 'C', parent: p.id });

    await engine.delete('zr_parsed', { where: { id: p.id } } as any);

    expect(driver.rowOf('zr_parsed', c.id)).toMatchObject({ name: 'C', parent: null });
  });

  it('restrict refuses with the envelope naming the tree\'s own object, and keeps both rows', async () => {
    const { engine, driver } = await makeEngine([treeObject('zr_held', bare({ deleteBehavior: 'restrict' }))]);
    const p = await engine.insert('zr_held', { name: 'P' });
    const c = await engine.insert('zr_held', { name: 'C', parent: p.id });

    const err = await refusalOf(engine.delete('zr_held', { where: { id: p.id } } as any));

    expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'zr_held' });
    expect(driver.rowOf('zr_held', p.id)).toMatchObject({ name: 'P' });
    expect(driver.rowOf('zr_held', c.id)).toMatchObject({ name: 'C', parent: p.id });
  });

  it('cascade deletes the subtree, and nothing outside it, as one unit of work', async () => {
    const { engine, driver } = await makeEngine([treeObject('zr_branch', bare({ deleteBehavior: 'cascade' }))]);
    const root = await engine.insert('zr_branch', { name: 'root' });
    const a = await engine.insert('zr_branch', { name: 'a', parent: root.id });
    await engine.insert('zr_branch', { name: 'b', parent: a.id });
    await engine.insert('zr_branch', { name: 'a2', parent: root.id });

    await engine.delete('zr_branch', { where: { id: a.id } } as any);

    expect(namesOf(driver.rowsOf('zr_branch'))).toEqual(['a2', 'root']);
    expect(driver.committed).toHaveLength(1);
    expect(driver.rolledBack).toHaveLength(0);
  });

  it('CONTROL: a tree that wrote its own name registers exactly as written', async () => {
    const { engine } = await makeEngine([treeObject('zr_written', { type: 'tree', reference: 'zr_written' })]);
    expect((engine.registry.getObject('zr_written') as any)?.fields?.parent?.reference).toBe('zr_written');
  });
});
