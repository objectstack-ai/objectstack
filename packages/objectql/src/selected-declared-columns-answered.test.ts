// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29408] A read answers every stored declared column it SELECTED: a column
 * the driver returned no key for is `null`, as driver-sql's column answers.
 *
 * The driver here stores only the keys a write carried and answers a
 * projection the way MongoDB does — a named key the document lacks is simply
 * absent. That is the driver-mongodb / driver-memory shape (both measured
 * through the engine on `origin/main`: no key for a never-written declared
 * field, where driver-sql answers `null`), and the one this engine seam exists
 * for. driver-mongodb is pinned in its own package
 * (`mongodb-declared-column-null-on-read.test.ts`) and driver-sql in
 * `@objectstack/runtime` (`declared-column-null-on-read.test.ts`); this file is
 * the driver-memory shape's pin.
 *
 * What must stay absent is pinned beside what must appear: a column the read
 * did not select, a column outside the declared set, a federated object's
 * unprovisioned injected column, a platform timestamp a federated object
 * neither declares nor has injected (`systemFields: false` /
 * `systemFields.audit: false`), and a `formula` field (virtual, never
 * `null`-filled itself; it is computed after the fill, so over an unwritten
 * input it now evaluates against `null` instead of faulting). Field-level security's refusal is
 * pinned on a real driver with the security plugin composed, in the runtime
 * file named above.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

import { ObjectQL } from './engine.js';
import { selectedStoredColumns, withSelectedColumnsAnswered } from './declared-read-columns.js';

type Row = Record<string, unknown>;

interface DriverAst {
  where?: Record<string, unknown>;
  fields?: string[];
  limit?: number;
}

function makeSparseDriver(name: string) {
  const tables = new Map<string, Map<string, Row>>();
  const tableFor = (o: string): Map<string, Row> => {
    let t = tables.get(o);
    if (!t) { t = new Map<string, Row>(); tables.set(o, t); }
    return t;
  };
  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const run = (object: string, ast: DriverAst | undefined): Row[] => {
    let out = Array.from(tableFor(object).values()).filter((r) => matches(r, ast?.where));
    if (typeof ast?.limit === 'number') out = out.slice(0, ast.limit);
    const fields = Array.isArray(ast?.fields) && ast.fields.length > 0 ? ast.fields : undefined;
    // A projection keeps the named keys the stored document HAS — no key for
    // one it lacks — plus `id`, as driver-mongodb projects.
    return out.map((r) => (fields
      ? Object.fromEntries(Object.entries(r).filter(([k]) => k === 'id' || fields.includes(k)))
      : { ...r }));
  };
  let seq = 0;
  const driver = {
    name, version: '0.0.0', supports: {},
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
    async checkHealth(): Promise<boolean> { return true; },
    async execute(): Promise<null> { return null; },
    async find(object: string, ast?: DriverAst): Promise<Row[]> { return run(object, ast); },
    async findOne(object: string, ast?: DriverAst): Promise<Row | null> { return run(object, ast)[0] ?? null; },
    async create(object: string, data: Row): Promise<Row> {
      seq += 1;
      const row: Row = { ...data, id: (data.id as string | undefined) ?? `new_${seq}` };
      tableFor(object).set(String(row.id), row);
      return { ...row };
    },
    async update(object: string, id: string, data: Row): Promise<Row> {
      const next: Row = { ...tableFor(object).get(id), ...data, id };
      tableFor(object).set(id, next);
      return { ...next };
    },
    async delete(object: string, id: string): Promise<boolean> { return tableFor(object).delete(id); },
    async count(object: string, ast?: DriverAst): Promise<number> { return run(object, ast).length; },
    registerExternalObject() {},
    async syncSchema() {},
  };
  return {
    driver,
    seed: (object: string, row: Row) => { tableFor(object).set(String(row.id), { ...row }); },
    stored: (object: string, id: string) => tableFor(object).get(id),
  };
}

const ITEM = 'nk_item';
const REMOTE = 'nk_remote_customer';
/** Federated, and opted out of the injected columns: nothing provisions a timestamp. */
const REMOTE_BARE = 'nk_remote_bare';
/** Federated, audit family off: no injected timestamp either. */
const REMOTE_NO_AUDIT = 'nk_remote_no_audit';
/** Federated, the author maps a remote `updated_at`: a declared column. */
const REMOTE_MAPPED = 'nk_remote_mapped';
const PACKAGE_ID = 'com.example.nk';

/** The fields of {@link ITEM}: `note` and `qty` are never written on `itm_1`. */
const ITEM_FIELDS = {
  name: { type: 'text' },
  note: { type: 'text' },
  qty: { type: 'number' },
  doubled: { type: 'formula', expression: { dialect: 'cel', source: 'record.qty != null ? record.qty * 2 : -1' } },
};

async function boot() {
  const engine = new ObjectQL();
  const local = makeSparseDriver('memory');
  const remote = makeSparseDriver('nk_external');
  engine.registerDriver(local.driver as never, true);
  engine.registerDriver(remote.driver as never);
  await engine.init();
  engine.registry.registerObject({ name: ITEM, label: 'Item', fields: ITEM_FIELDS } as never, PACKAGE_ID);
  engine.registry.registerObject({
    name: REMOTE,
    datasource: 'nk_external',
    external: { remoteName: 'customers' },
    fields: { name: { type: 'text' }, email: { type: 'text' } },
  } as never, PACKAGE_ID);
  // Only `name` written — every other declared column is a key the driver
  // never stored. `id` and the two timestamps are stored the way a driver
  // stamps them.
  local.seed(ITEM, { id: 'itm_1', name: 'Ada', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' });
  engine.registry.registerObject({
    name: REMOTE_BARE,
    datasource: 'nk_external',
    external: { remoteName: 'bare' },
    systemFields: false,
    fields: { name: { type: 'text' }, email: { type: 'text' } },
  } as never, PACKAGE_ID);
  engine.registry.registerObject({
    name: REMOTE_NO_AUDIT,
    datasource: 'nk_external',
    external: { remoteName: 'no_audit' },
    systemFields: { audit: false },
    fields: { name: { type: 'text' }, email: { type: 'text' } },
  } as never, PACKAGE_ID);
  engine.registry.registerObject({
    name: REMOTE_MAPPED,
    datasource: 'nk_external',
    external: { remoteName: 'mapped' },
    systemFields: false,
    fields: { name: { type: 'text' }, updated_at: { type: 'datetime' } },
  } as never, PACKAGE_ID);
  remote.seed(REMOTE, { id: 'cus_1', name: 'Remote Co' });
  remote.seed(REMOTE_BARE, { id: 'bar_1', name: 'Bare Co' });
  remote.seed(REMOTE_NO_AUDIT, { id: 'noa_1', name: 'No Audit Co' });
  remote.seed(REMOTE_MAPPED, { id: 'map_1', name: 'Mapped Co' });
  return { engine, local, protocol: new ObjectStackProtocolImplementation(engine as never) };
}

const own = (row: unknown, key: string): boolean =>
  row != null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, key);

describe('[#29408] a selected declared column the driver did not return is answered null', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { h = await boot(); });

  it('the fixture is real: the stored row carries no key for the unwritten columns', () => {
    const stored = h.local.stored(ITEM, 'itm_1')!;
    expect(own(stored, 'note')).toBe(false);
    expect(own(stored, 'qty')).toBe(false);
  });

  it('a whole-record read (findOne, no projection) answers every unwritten stored column null', async () => {
    const row = await h.engine.findOne(ITEM, { where: { id: 'itm_1' } });
    expect(row).toMatchObject({ id: 'itm_1', name: 'Ada', note: null, qty: null });
    expect(own(row, 'note')).toBe(true);
    expect(own(row, 'qty')).toBe(true);
  });

  it('a list read (find, no projection) answers them null too', async () => {
    const rows = await h.engine.find(ITEM, {});
    expect(rows).toHaveLength(1);
    expect(own(rows[0], 'note')).toBe(true);
    expect(rows[0]).toMatchObject({ note: null, qty: null });
  });

  it('an explicit projection naming the column answers it null, on find and findOne', async () => {
    const one = await h.engine.findOne(ITEM, { where: { id: 'itm_1' }, fields: ['name', 'note'] });
    expect(own(one, 'note')).toBe(true);
    expect(one!.note).toBeNull();
    const rows = await h.engine.find(ITEM, { fields: ['name', 'note'] });
    expect(own(rows[0], 'note')).toBe(true);
    expect(rows[0]!.note).toBeNull();
  });

  it('NOT SELECTED stays absent: a projection that does not name the column never answers it', async () => {
    const one = await h.engine.findOne(ITEM, { where: { id: 'itm_1' }, fields: ['name'] });
    expect(own(one, 'note')).toBe(false);
    expect(own(one, 'qty')).toBe(false);
    const rows = await h.engine.find(ITEM, { fields: ['name'] });
    expect(own(rows[0], 'note')).toBe(false);
    expect(own(rows[0], 'qty')).toBe(false);
  });

  it('a formula field is never null-filled itself: over its unwritten input it evaluates against null', async () => {
    const row = await h.engine.findOne(ITEM, { where: { id: 'itm_1' } });
    expect(row!.doubled).toBe(-1);
    const narrowed = await h.engine.findOne(ITEM, { where: { id: 'itm_1' }, fields: ['name', 'doubled'] });
    // `qty` was read for the formula (the projection widening) and is cut off
    // the answer again: widening is not selecting.
    expect(narrowed!.doubled).toBe(-1);
    expect(own(narrowed, 'qty')).toBe(false);
  });

  it('a stored value and a stored null are answered as stored', async () => {
    await h.engine.update(ITEM, { id: 'itm_1', note: 'kept', qty: null } as never);
    const row = await h.engine.findOne(ITEM, { where: { id: 'itm_1' } });
    expect(row).toMatchObject({ note: 'kept', qty: null });
  });

  it('FEDERATED stays absent: an unprovisioned injected column of an external object is not answered', async () => {
    const row = await h.engine.findOne(REMOTE, { where: { id: 'cus_1' } });
    // The declared remote column the driver did not return is answered…
    expect(own(row, 'email')).toBe(true);
    expect(row!.email).toBeNull();
    // …the platform's injected anchors, which have no storage behind them
    // on a federated object, are not.
    for (const injected of ['organization_id', 'owner_id', 'created_by', 'created_at']) {
      expect(own(row, injected)).toBe(false);
    }
  });

  it.each([
    ['systemFields: false', REMOTE_BARE, 'bar_1'],
    ['systemFields.audit: false', REMOTE_NO_AUDIT, 'noa_1'],
  ])('UNPROVISIONED TIMESTAMP stays absent: a federated object with %s is not answered created_at / updated_at', async (_label, object, id) => {
    const one = await h.engine.findOne(object, { where: { id } });
    const rows = await h.engine.find(object, {});
    const named = await h.engine.findOne(object, { where: { id }, fields: ['name', 'created_at', 'updated_at'] });
    for (const row of [one, rows[0], named]) {
      expect(own(row, 'created_at')).toBe(false);
      expect(own(row, 'updated_at')).toBe(false);
      // The remote's own primary key backs `id`.
      expect(row!.id).toBe(id);
    }
    // The declared remote column the driver did not return is still answered.
    expect(own(one, 'email')).toBe(true);
    expect(one!.email).toBeNull();
  });

  it('a timestamp the federated object DECLARES is a remote column, and is answered null', async () => {
    const row = await h.engine.findOne(REMOTE_MAPPED, { where: { id: 'map_1' } });
    expect(own(row, 'updated_at')).toBe(true);
    expect(row!.updated_at).toBeNull();
    expect(own(row, 'created_at')).toBe(false);
  });

  it('the doors: GET /data/:object/:id (getData) and the list route (findData) carry the null', async () => {
    const got: any = await h.protocol.getData({ object: ITEM, id: 'itm_1' });
    expect(own(got.record, 'note')).toBe(true);
    expect(got.record.note).toBeNull();
    const listed: any = await h.protocol.findData({ object: ITEM, query: {} });
    expect(own(listed.records[0], 'note')).toBe(true);
    expect(listed.records[0].note).toBeNull();
  });

  it('the driver\'s stored row is never mutated by the read', async () => {
    await h.engine.find(ITEM, {});
    await h.engine.findOne(ITEM, { where: { id: 'itm_1' } });
    expect(own(h.local.stored(ITEM, 'itm_1'), 'note')).toBe(false);
  });
});

describe('[#29408] selectedStoredColumns — the set a row is answered on', () => {
  const schema = { fields: ITEM_FIELDS };

  it('no projection selects every stored declared column and the provisioned three, never a formula', () => {
    expect([...selectedStoredColumns(schema, undefined)!].sort()).toEqual(
      ['created_at', 'id', 'name', 'note', 'qty', 'updated_at'],
    );
  });

  it('a local object keeps the provisioned three whatever systemFields says: driver-sql builds them on every table', () => {
    const optedOut = { systemFields: false, fields: { name: { type: 'text' } } };
    expect([...selectedStoredColumns(optedOut, undefined)!].sort()).toEqual(
      ['created_at', 'id', 'name', 'updated_at'],
    );
  });

  it('OUTSIDE THE DECLARED SET stays absent: a projected name no field declares is never selected', () => {
    expect([...selectedStoredColumns(schema, ['name', 'ghost', 'doubled'])!]).toEqual(['name']);
    expect(withSelectedColumnsAnswered({ id: 'x' }, selectedStoredColumns(schema, ['ghost']))).toStrictEqual({ id: 'x' });
  });

  it('no checkable field map is no opinion: the row is returned as given', () => {
    const row = { id: 'x' };
    expect(selectedStoredColumns({ fields: {} }, undefined)).toBeUndefined();
    expect(withSelectedColumnsAnswered(row, selectedStoredColumns(undefined, undefined))).toBe(row);
  });

  it('an own key holding undefined is answered null; nothing to answer keeps the reference', () => {
    const selected = selectedStoredColumns(schema, ['name', 'note'])!;
    expect(withSelectedColumnsAnswered({ name: 'a', note: undefined }, selected)).toStrictEqual({ name: 'a', note: null });
    const full = { name: 'a', note: 'b' };
    expect(withSelectedColumnsAnswered(full, selected)).toBe(full);
  });
});
