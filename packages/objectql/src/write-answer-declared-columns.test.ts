// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29538] A write answers the record the next read of the row answers: every
 * stored declared column the driver did not echo is `null`, as on driver-sql.
 *
 * The write-side twin of #29408 (`selected-declared-columns-answered.test.ts`,
 * the read half). The driver here stores only the keys a write carried and
 * echoes exactly the stored row, the driver-mongodb / driver-memory shape.
 * Measured on `origin/main` before the fix, through the engine and the
 * protocol doors: on that shape every write answer below left out each
 * unwritten declared column (`note`, `qty` and the registry-injected system
 * columns) while the next `findOne` answered them `null`, and the formula
 * `doubled` read `null` in the write answer (a fault on the missing `qty`)
 * but `-1` on the read. driver-sql answered both the same.
 *
 * driver-mongodb is pinned in its own package
 * (`mongodb-declared-column-null-on-write.test.ts`) and driver-sql with the
 * security plugin composed in `@objectstack/runtime`
 * (`declared-column-null-on-write.test.ts`), where a field-level-refused
 * column is pinned absent; this file is the driver-memory shape's pin.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;

interface DriverAst {
  where?: Record<string, unknown>;
  fields?: string[];
  limit?: number;
}

function makeSparseDriver(name: string, unechoed: readonly string[] = []) {
  const tables = new Map<string, Map<string, Row>>();
  const tableFor = (o: string): Map<string, Row> => {
    let t = tables.get(o);
    if (!t) { t = new Map<string, Row>(); tables.set(o, t); }
    return t;
  };
  // Equality on plain keys only. A combinator or any other operator is
  // REFUSED, never read as a field name.
  const matches = (row: Row, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) throw new Error(`sparse fake: filter operator ${k} is not implemented`);
      if (v !== null && typeof v === 'object') throw new Error(`sparse fake: operator on ${k} is not implemented`);
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const run = (object: string, ast: DriverAst | undefined): Row[] => {
    let out = Array.from(tableFor(object).values()).filter((r) => matches(r, ast?.where));
    if (typeof ast?.limit === 'number') out = out.slice(0, ast.limit);
    const fields = Array.isArray(ast?.fields) && ast.fields.length > 0 ? ast.fields : undefined;
    return out.map((r) => (fields
      ? Object.fromEntries(Object.entries(r).filter(([k]) => k === 'id' || fields.includes(k)))
      : { ...r }));
  };
  let seq = 0;
  // A key given `undefined` is not stored, as driver-mongodb's insert doors
  // drop it; the echo is the stored row and nothing else.
  const stored = (data: Row): Row => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  // A driver that stores a column but does not echo it (#1872's shape).
  const echo = (row: Row): Row => Object.fromEntries(Object.entries(row).filter(([k]) => !unechoed.includes(k)));
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
      const row: Row = { ...stored(data), id: (data.id as string | undefined) ?? `new_${seq}` };
      tableFor(object).set(String(row.id), row);
      return echo(row);
    },
    async update(object: string, id: string, data: Row): Promise<Row | null> {
      const prior = tableFor(object).get(id);
      if (!prior) return null;
      const next: Row = { ...prior, ...stored(data), id };
      tableFor(object).set(id, next);
      return echo(next);
    },
    async updateMany(object: string, ast: DriverAst, data: Row): Promise<number> {
      const hits = Array.from(tableFor(object).values()).filter((r) => matches(r, ast?.where));
      for (const r of hits) tableFor(object).set(String(r.id), { ...r, ...stored(data) });
      return hits.length;
    },
    async delete(object: string, id: string): Promise<boolean> { return tableFor(object).delete(id); },
    async count(object: string, ast?: DriverAst): Promise<number> { return run(object, ast).length; },
    registerExternalObject() {},
    async syncSchema() {},
  };
  return {
    driver,
    stored: (object: string, id: string) => tableFor(object).get(id),
  };
}

const ITEM = 'nk_write_item';
const PACKAGE_ID = 'com.example.nk_write';

/** `note` and `qty` are never written; `doubled` reads the unwritten `qty`. */
const ITEM_FIELDS = {
  title: { type: 'text' },
  note: { type: 'text' },
  qty: { type: 'number' },
  doubled: { type: 'formula', expression: { dialect: 'cel', source: 'record.qty != null ? record.qty * 2 : -1' } },
};

async function boot(unechoed: readonly string[] = []) {
  const engine = new ObjectQL();
  const local = makeSparseDriver('memory', unechoed);
  engine.registerDriver(local.driver as never, true);
  await engine.init();
  engine.registry.registerObject({ name: ITEM, label: 'Item', fields: ITEM_FIELDS } as never, PACKAGE_ID);
  return { engine, local, protocol: new ObjectStackProtocolImplementation(engine as never) };
}

const own = (row: unknown, key: string): boolean =>
  row != null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, key);

type Booted = Awaited<ReturnType<typeof boot>>;
type Answer = Row | null | undefined;

/** One write door: performs the write and hands back the record body it answered. */
type WritePath = [string, (h: Booted, existingId: string) => Promise<Answer>];

const WRITE_PATHS: WritePath[] = [
  ['engine.insert', async (h) => await h.engine.insert(ITEM, { title: 'a' }) as Row],
  ['engine.insert (batch)', async (h) => ((await h.engine.insert(ITEM, [{ title: 'b1' }, { title: 'b2' }])) as Row[])[1]],
  ['engine.insertMany (partial outcomes)', async (h) => ((await h.engine.insertMany(ITEM, [{ title: 'c' }])) as Array<{ record?: Row }>)[0]!.record],
  ['engine.update by id', async (h, id) => await h.engine.update(ITEM, { id, title: 'u' }) as Row],
  ['createData (POST /data/:object)', async (h) => ((await h.protocol.createData({ object: ITEM, data: { title: 'd' } })) as { record: Row }).record],
  ['updateData (PATCH /data/:object/:id)', async (h, id) => ((await h.protocol.updateData({ object: ITEM, id, data: { title: 'p' } })) as { record: Row }).record],
  ['createManyData', async (h) => ((await h.protocol.createManyData({ object: ITEM, records: [{ title: 'm' }] })) as { records: Row[] }).records[0]],
  ['updateManyData', async (h, id) => ((await h.protocol.updateManyData({ object: ITEM, records: [{ id, data: { title: 'n' } }] } as never)) as { results: Array<{ data: Row }> }).results[0]!.data],
  ['batch create', async (h) => ((await h.protocol.batchData({ object: ITEM, request: { operation: 'create', records: [{ data: { title: 'bc' } }] } as never })) as { results: Array<{ data: Row }> }).results[0]!.data],
  ['batch update', async (h, id) => ((await h.protocol.batchData({ object: ITEM, request: { operation: 'update', records: [{ id, data: { title: 'bu' } }] } as never })) as { results: Array<{ data: Row }> }).results[0]!.data],
  ['batch upsert, update arm', async (h, id) => ((await h.protocol.batchData({ object: ITEM, request: { operation: 'upsert', records: [{ id, data: { title: 'xu' } }] } as never })) as { results: Array<{ data: Row }> }).results[0]!.data],
  ['batch upsert, create arm', async (h) => ((await h.protocol.batchData({ object: ITEM, request: { operation: 'upsert', records: [{ id: 'nk_up_new', data: { title: 'xc' } }] } as never })) as { results: Array<{ data: Row }> }).results[0]!.data],
];

describe('[#29538] a write answers the record the next read answers', () => {
  let h: Booted;
  let existingId: string;
  beforeEach(async () => {
    h = await boot();
    existingId = String(((await h.engine.insert(ITEM, { title: 'seed' })) as Row).id);
  });

  it('the fixture is real: the stored row carries no key for the unwritten columns', () => {
    const stored = h.local.stored(ITEM, existingId)!;
    expect(own(stored, 'note')).toBe(false);
    expect(own(stored, 'qty')).toBe(false);
  });

  it.each(WRITE_PATHS)('%s: the write answer deep-equals the next findOne', async (_label, write) => {
    const answer = await write(h, existingId);
    expect(answer).toBeTruthy();
    const next = await h.engine.findOne(ITEM, { where: { id: answer!.id } });
    expect(answer).toStrictEqual(next);
    // The unwritten stored columns are present as `null`, not missing keys.
    expect(own(answer, 'note')).toBe(true);
    expect(answer!.note).toBeNull();
    expect(own(answer, 'qty')).toBe(true);
    expect(answer!.qty).toBeNull();
  });

  it.each(WRITE_PATHS)('%s: FORMULA CONTROL — the formula over the unwritten column evaluates against null, as the read does', async (_label, write) => {
    const answer = await write(h, existingId);
    expect(answer!.doubled).toBe(-1);
  });

  it('a stored value and a stored null are answered as stored', async () => {
    const answer = await h.engine.update(ITEM, { id: existingId, note: 'kept', qty: null }) as Row;
    expect(answer).toMatchObject({ note: 'kept', qty: null, doubled: -1 });
    expect(answer).toStrictEqual(await h.engine.findOne(ITEM, { where: { id: existingId } }));
  });

  it('the driver\'s stored row is never mutated by the answer', async () => {
    await h.engine.update(ITEM, { id: existingId, title: 'again' });
    expect(own(h.local.stored(ITEM, existingId), 'note')).toBe(false);
  });

  it('a predicate update still answers its affected-row count, not a record body', async () => {
    const count = await h.engine.update(ITEM, { title: 'many' }, { where: { title: 'seed' }, multi: true } as never);
    expect(count).toBe(1);
  });
});

describe('[#29538] a column the write carried a value for is never answered null', () => {
  // The driver stores `note` but leaves it out of its echo. The answer must not
  // claim a `null` the row does not hold; a reader layering the payload under
  // the answer (trigger-record-change's flow record) keeps the written value.
  let h: Booted;
  beforeEach(async () => { h = await boot(['note']); });

  it('insert: a written, unechoed column stays absent; an unwritten one is null', async () => {
    const answer = await h.engine.insert(ITEM, { title: 'w', note: 'written' }) as Row;
    expect(h.local.stored(ITEM, String(answer.id))!.note).toBe('written');
    expect(own(answer, 'note')).toBe(false);
    expect(answer.qty).toBeNull();
  });

  it('insert (batch): each row is judged by its own payload', async () => {
    const [carried, bare] = await h.engine.insert(ITEM, [{ title: 'x', note: 'n1' }, { title: 'y' }]) as Row[];
    expect(own(carried, 'note')).toBe(false);
    expect(own(bare, 'note')).toBe(true);
    expect(bare!.note).toBeNull();
  });

  it('update by id: a value the prior row stored and the echo dropped stays absent', async () => {
    const seeded = await h.engine.insert(ITEM, { title: 's', note: 'kept' }) as Row;
    const answer = await h.engine.update(ITEM, { id: seeded.id, title: 's2' }) as Row;
    expect(h.local.stored(ITEM, String(seeded.id))!.note).toBe('kept');
    expect(own(answer, 'note')).toBe(false);
    expect(answer.qty).toBeNull();
  });

  it('update by id: a PATCH that clears the prior value is answered null', async () => {
    const seeded = await h.engine.insert(ITEM, { title: 's', note: 'kept' }) as Row;
    const answer = await h.engine.update(ITEM, { id: seeded.id, note: null }) as Row;
    expect(own(answer, 'note')).toBe(true);
    expect(answer.note).toBeNull();
  });
});
