// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29408] driver-mongodb through the engine: a declared column the read
 * selected and the write never touched is answered `null`, as driver-sql's
 * column answers — not a missing key.
 *
 * This driver stores no key for a field given no value (`withoutUndefinedOwnKeys`
 * at the insert doors, `mongodb-driver.ts`), and a MongoDB projection that
 * names a key the document lacks returns no such key. So the row the driver
 * hands the engine is sparse; the engine answers it on the selected stored
 * columns (`selectedStoredColumns`, `@objectstack/objectql`'s
 * `declared-read-columns.ts`). Measured on `origin/main` before the fix with
 * this same harness: every read below answered no `note` key.
 *
 * Runs without a server, on the fake `Db` pattern `mongodb-findone-options.test.ts`
 * established (`getCollection` is `this.db.collection(name)`). The fake answers
 * a projection as a real mongod does — the named keys the document HAS, never
 * an own key holding `undefined` for one it lacks — which is the one property
 * of the server this pin depends on. The real-server suites are gated on
 * `mongodb-memory-server` (#5517).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { MongoDBDriver } from './mongodb-driver.js';

type Doc = Record<string, unknown>;

/** A fake `Db`: one collection, stored documents kept as inserted. */
function fakeDb() {
  const docs: Doc[] = [];
  const project = (doc: Doc, projection: Record<string, number> | undefined): Doc => {
    const keep = Object.keys(projection ?? {}).filter((k) => projection![k] === 1);
    const out: Doc = {};
    for (const [k, v] of Object.entries(doc)) {
      if (k === '_id' && projection?._id === 0) continue;
      if (keep.length > 0 && !keep.includes(k)) continue;
      out[k] = v;
    }
    return out;
  };
  // Equality on plain keys only — the reads below filter by `id` alone. A
  // combinator or any other operator is REFUSED, never read as a field name.
  const matches = (doc: Doc, filter: Doc | undefined): boolean =>
    Object.entries(filter ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake Db: filter operator ${k} is not implemented`);
      if (v !== null && typeof v === 'object') {
        const ops = Object.keys(v as Doc);
        if (ops.length !== 1 || ops[0] !== '$eq') throw new Error(`fake Db: operator ${ops.join(',')} is not implemented`);
        return doc[k] === (v as Doc).$eq;
      }
      return doc[k] === v;
    });
  const collection = {
    insertOne: async (doc: Doc) => { docs.push({ _id: `oid_${docs.length}`, ...doc }); return { insertedId: `oid_${docs.length}` }; },
    findOne: async (filter: Doc, options: { projection?: Record<string, number> }) => {
      const d = docs.find((x) => matches(x, filter));
      return d ? project(d, options?.projection) : null;
    },
    find: (filter: Doc, options: { projection?: Record<string, number> }) => ({
      toArray: async () => docs.filter((x) => matches(x, filter)).map((d) => project(d, options?.projection)),
    }),
  };
  return { db: { collection: () => collection }, docs };
}

const OBJECT = 'nk_mongo_item';

const own = (row: unknown, key: string): boolean =>
  row != null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, key);

describe('[#29408] driver-mongodb: a selected, unwritten declared column reads null through the engine', () => {
  let engine: ObjectQL;
  let docs: Doc[];
  let id: string;

  beforeEach(async () => {
    const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/unused' });
    const fake = fakeDb();
    docs = fake.docs;
    (driver as any).db = fake.db;
    (driver as any).connect = async () => {};
    (driver as any).disconnect = async () => {};
    engine = new ObjectQL();
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Item',
      fields: { name: { type: 'text' }, note: { type: 'text' } },
    } as never);
    const created = await engine.insert(OBJECT, { name: 'Ada' }) as Doc;
    id = String(created.id);
  });

  it('the fixture is real: the stored document carries no key for the unwritten column', () => {
    expect(docs).toHaveLength(1);
    expect(own(docs[0], 'note')).toBe(false);
  });

  it('whole-record read and list read answer it null', async () => {
    const one = await engine.findOne(OBJECT, { where: { id } });
    expect(own(one, 'note')).toBe(true);
    expect(one!.note).toBeNull();
    const rows = await engine.find(OBJECT, {});
    expect(own(rows[0], 'note')).toBe(true);
    expect(rows[0]!.note).toBeNull();
  });

  it('a projection naming it answers it null', async () => {
    const one = await engine.findOne(OBJECT, { where: { id }, fields: ['name', 'note'] });
    expect(own(one, 'note')).toBe(true);
    expect(one!.note).toBeNull();
  });

  it('NOT SELECTED stays absent: a projection that does not name it never answers it', async () => {
    const one = await engine.findOne(OBJECT, { where: { id }, fields: ['name'] });
    expect(own(one, 'note')).toBe(false);
    const rows = await engine.find(OBJECT, { fields: ['name'] });
    expect(own(rows[0], 'note')).toBe(false);
  });
});
