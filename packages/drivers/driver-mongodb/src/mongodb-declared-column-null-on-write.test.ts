// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29538] driver-mongodb through the engine: a write answers the record the
 * next read answers — a declared column the write never touched is `null` in
 * the insert and update answer, as on the following `findOne` (#29408).
 *
 * This driver stores no key for a field given no value (`withoutUndefinedOwnKeys`
 * at the insert doors), its `create` / `bulkCreate` echo the document they
 * inserted, and its `update` re-reads the document. So the row each write
 * hands the engine is sparse. Measured on `origin/main` before the fix with
 * this same harness: every write answer below carried no `note` / `qty` key
 * and answered the formula `doubled` as `null` (a fault on the missing
 * `qty`), while the next `findOne` answered `note: null`, `qty: null` and
 * `doubled: -1`.
 *
 * Runs without a server, on the fake `Db` of
 * `mongodb-declared-column-null-on-read.test.ts`, with the write calls the
 * engine's insert and by-id update doors reach. The fake keeps each document
 * as inserted and answers a projection as a real mongod does — the named keys
 * the document HAS. The real-server suites are gated on `mongodb-memory-server`
 * (#5517).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { MongoDBDriver } from './mongodb-driver.js';

type Doc = Record<string, unknown>;

/**
 * A fake `Db`: one store of documents kept as inserted, served through a
 * collection that declares ONLY the native `Collection` members the path under
 * test calls. Two shapes, one per path: the single-row doors (`create`,
 * `update`, `findOne`) reach `insertOne` / `updateOne` / `findOne`; the batch
 * door (`bulkCreate`) reaches `insertMany`, and its next read is a `find`.
 */
function fakeStore() {
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
  // Equality on plain keys only — the writes and reads below address a row
  // by `id` alone. A combinator or any other operator is REFUSED, never read
  // as a field name.
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
  const push = (doc: Doc) => { docs.push({ _id: `oid_${docs.length}`, ...doc }); };
  const pick = (filter: Doc) => docs.find((x) => matches(x, filter));
  const pickAll = (filter: Doc, options?: { projection?: Record<string, number> }) =>
    docs.filter((x) => matches(x, filter)).map((d) => project(d, options?.projection));
  return { docs, push, pick, pickAll, project };
}

/** The single-row doors: `create`, `update` and `findOne`. */
function singleRowDb() {
  const store = fakeStore();
  const collection = {
    insertOne: async (doc: Doc) => { store.push(doc); return {}; },
    updateOne: async (filter: Doc, update: { $set?: Doc }) => {
      const updateOps = Object.keys(update);
      if (updateOps.length !== 1 || updateOps[0] !== '$set') throw new Error(`fake Db: update ${updateOps.join(',')} is not implemented`);
      const d = store.pick(filter);
      if (d) Object.assign(d, update.$set);
      return { matchedCount: d ? 1 : 0 };
    },
    findOne: async (filter: Doc, options: { projection?: Record<string, number> }) => {
      const d = store.pick(filter);
      return d ? store.project(d, options?.projection) : null;
    },
  };
  return { db: { collection: () => collection }, docs: store.docs };
}

/** The batch door: `bulkCreate`, and `find` for the next read. */
function batchDb() {
  const store = fakeStore();
  const collection = {
    insertMany: async (many: Doc[]) => { for (const doc of many) store.push(doc); return {}; },
    find: (filter: Doc, options: { projection?: Record<string, number> }) => ({
      toArray: async () => store.pickAll(filter, options),
    }),
  };
  return { db: { collection: () => collection }, docs: store.docs };
}

const OBJECT = 'nk_mongo_write_item';

const own = (row: unknown, key: string): boolean =>
  row != null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, key);

describe('[#29538] driver-mongodb: a write answers the record the next read answers', () => {
  let engine: ObjectQL;
  let docs: Doc[];

  const boot = async (fake: { db: unknown; docs: Doc[] }) => {
    const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/unused' });
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
      fields: {
        name: { type: 'text' },
        note: { type: 'text' },
        qty: { type: 'number' },
        doubled: { type: 'formula', expression: { dialect: 'cel', source: 'record.qty != null ? record.qty * 2 : -1' } },
      },
    } as never);
  };

  beforeEach(async () => { await boot(singleRowDb()); });

  const expectAnswerIsNextRead = async (answer: Doc, next?: Doc) => {
    expect(answer).toStrictEqual(next ?? await engine.findOne(OBJECT, { where: { id: answer.id } }));
    expect(own(answer, 'note')).toBe(true);
    expect(answer.note).toBeNull();
    expect(own(answer, 'qty')).toBe(true);
    expect(answer.qty).toBeNull();
    // FORMULA CONTROL: evaluated against the `null`, as the read evaluates it.
    expect(answer.doubled).toBe(-1);
  };

  it('insert: the answer deep-equals the next findOne', async () => {
    const answer = await engine.insert(OBJECT, { name: 'Ada' }) as Doc;
    expect(own(docs[0], 'note')).toBe(false);
    await expectAnswerIsNextRead(answer);
  });

  it('batch insert (bulkCreate): every answered row deep-equals its next read', async () => {
    await boot(batchDb());
    const answers = await engine.insert(OBJECT, [{ name: 'Ada' }, { name: 'Bo' }]) as Doc[];
    expect(answers).toHaveLength(2);
    expect(own(docs[0], 'note')).toBe(false);
    for (const answer of answers) {
      const [next] = await engine.find(OBJECT, { where: { id: answer.id } }) as Doc[];
      await expectAnswerIsNextRead(answer, next);
    }
  });

  it('update by id: the answer deep-equals the next findOne', async () => {
    const created = await engine.insert(OBJECT, { name: 'Ada' }) as Doc;
    const answer = await engine.update(OBJECT, { id: created.id, name: 'Ada L.' }) as Doc;
    expect(answer.name).toBe('Ada L.');
    await expectAnswerIsNextRead(answer);
    // The stored document still carries no key for the column: only the
    // answer is shaped, never what the write stores.
    expect(own(docs[0], 'note')).toBe(false);
  });
});
