// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A standalone MongoDB server refuses the unit a hooked write opens — and the
 * refusal says so, instead of the MongoDB client's retryable-writes hint.
 *
 * Measured on a MongoDB 8.0 standalone as the default store: every write on an
 * object carrying a metadata `before*` hook was refused with "This MongoDB
 * deployment does not support retryable writes. Please add retryWrites=false to
 * your connection string.", and with `retryWrites=false` the answer was the
 * same. The write opens a unit (`opensAfterAbortUnit`), the unit is a client
 * session in a transaction, and a standalone server answers the first command
 * under it with code 20 "Transaction numbers are only allowed on a replica set
 * member or mongos" — which the client rewrites into that hint for a write.
 *
 * No server runs here (`mongodb-memory-server` is opt-in, #5517). The fakes
 * below answer as the two topologies do: the STANDALONE fake throws, for any
 * command that carries a session, exactly the errors the client builds —
 * `MongoServerError` instances from the `mongodb` package, the write one being
 * the client's rewrite with the server's error as `originalError`, the read one
 * the server's error itself. The REPLICA-SET fake runs the same commands.
 *
 * The pins, and what each alone would miss:
 *  - the refusal pins (insert / update / delete through the wired engine)
 *    assert `code` + `status` and the first sentence, and that the client's
 *    hint is gone: a bare rejection is what the defect already looked like;
 *  - CONTROL, the replica set: the same hooked write is stored, so the mapping
 *    is not "refuse every unit";
 *  - CONTROL, no hook: on the standalone fake a write that opens no unit is
 *    stored and starts no session, so the mapping is not "refuse every write";
 *  - the pass-through pins: an unrelated error under a session, and the same
 *    standalone shape WITHOUT a session, reach the caller unchanged;
 *  - the boot pins: `connect()` warns once for a standalone `hello`, and not for
 *    a replica set member, a `mongos`, or a probe that fails.
 */

import { describe, it, expect, vi } from 'vitest';
import { MongoServerError } from 'mongodb';
import type { Hook } from '@objectstack/spec/data';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { MongoDBDriver } from './mongodb-driver.js';
import {
  isStandaloneHello,
  isStandaloneTransactionFault,
  refusalForUnitFault,
  standaloneStoreWarning,
} from './mongodb-standalone-unit.js';

type Doc = Record<string, unknown>;
type Topology = 'standalone' | 'replica-set';

const SERVER_TEXT = 'Transaction numbers are only allowed on a replica set member or mongos';
const CLIENT_HINT =
  'This MongoDB deployment does not support retryable writes. Please add retryWrites=false to your connection string.';

/** The server's own answer — what a READ under the session gets. */
const serverError = () => new MongoServerError({ ok: 0, code: 20, codeName: 'IllegalOperation', errmsg: SERVER_TEXT });
/** The client's rewrite of it — what a WRITE under the session gets (`execute_operation.js`). */
const clientRewrite = () => new MongoServerError({ message: CLIENT_HINT, errmsg: CLIENT_HINT, originalError: serverError() });

interface Session { inTransaction(): boolean; committed: boolean; aborted: boolean }

/**
 * A fake `MongoClient` + `Db`. Every collection command reads its options'
 * `session`: on `standalone` a command carrying one throws what the client
 * throws there, on `replica-set` it runs. Filters are equality on plain keys
 * (plus `$eq`), which is all the doors below send.
 */
function fakeMongo(topology: Topology, hello: Doc | Error = topology === 'standalone' ? { isWritablePrimary: true } : { setName: 'rs0', isWritablePrimary: true }) {
  const docs = new Map<string, Doc[]>();
  const rows = (name: string) => docs.get(name) ?? (docs.set(name, []), docs.get(name)!);
  const sessions: Session[] = [];
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
  const strip = ({ _id, ...rest }: Doc) => rest;
  const guard = (options: { session?: unknown } | undefined, write: boolean) => {
    if (topology === 'standalone' && options?.session !== undefined) throw write ? clientRewrite() : serverError();
  };
  const collection = (name: string) => ({
    insertOne: async (doc: Doc, o?: { session?: unknown }) => { guard(o, true); rows(name).push({ _id: `oid_${rows(name).length}`, ...doc }); return {}; },
    updateOne: async (filter: Doc, update: { $set: Doc }, o?: { session?: unknown }) => {
      guard(o, true);
      const d = rows(name).find((x) => matches(x, filter));
      if (d) Object.assign(d, update.$set);
      return { matchedCount: d ? 1 : 0 };
    },
    deleteOne: async (filter: Doc, o?: { session?: unknown }) => {
      guard(o, true);
      const all = rows(name);
      const i = all.findIndex((x) => matches(x, filter));
      if (i >= 0) all.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
    findOne: async (filter: Doc, o?: { session?: unknown }) => {
      guard(o, false);
      const d = rows(name).find((x) => matches(x, filter));
      return d ? strip(d) : null;
    },
    find: (filter: Doc, o?: { session?: unknown; limit?: number }) => ({
      toArray: async () => {
        guard(o, false);
        const found = rows(name).filter((x) => matches(x, filter)).map(strip);
        return typeof o?.limit === 'number' ? found.slice(0, o.limit) : found;
      },
    }),
    countDocuments: async (filter: Doc, o?: { session?: unknown }) => { guard(o, false); return rows(name).filter((x) => matches(x, filter)).length; },
  });
  const db = {
    collection,
    command: async (cmd: Doc) => {
      if ('hello' in cmd) { if (hello instanceof Error) throw hello; return hello; }
      return { ok: 1 };
    },
  };
  const client = {
    connect: async () => {},
    close: async () => {},
    db: () => db,
    startSession: () => {
      let open = false;
      const s: Session & Doc = {
        committed: false,
        aborted: false,
        inTransaction: () => open,
        startTransaction: () => { open = true; },
        commitTransaction: async () => { open = false; s.committed = true; },
        abortTransaction: async () => { open = false; s.aborted = true; },
        endSession: async () => {},
      };
      sessions.push(s);
      return s;
    },
  };
  return { client, db, docs: rows, sessions };
}

function makeDriver(fake: ReturnType<typeof fakeMongo>) {
  const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/standalone_unit' });
  (driver as any).client = fake.client;
  (driver as any).db = fake.db;
  return driver;
}

const obj = (name: string) => ({
  name, label: name, fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text' } },
});

/** `case` carries metadata `before*` hooks on `events`; `note` carries none. Neither hook fails. */
async function makeEngine(topology: Topology, events: string[]) {
  const fake = fakeMongo(topology);
  const driver = makeDriver(fake);
  (driver as any).connect = async () => {};
  (driver as any).disconnect = async () => {};
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registry.registerObject(obj('case') as never, '__test__');
  engine.registry.registerObject(obj('note') as never, '__test__');
  const hooks = [{ name: 'stamp', object: 'case', events, handler: () => {} }] as unknown as Hook[];
  bindHooksToEngine(engine, hooks, { packageId: 'app:t', logger: quiet as any });
  return { engine, fake };
}

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: unknown) => e as Error & { code?: unknown; status?: unknown; cause?: unknown });

const FIRST_SENTENCE = /^This MongoDB server is a standalone mongod, and MongoDB runs transactions only on a replica set member or through mongos, so the transaction this write runs in cannot be carried and the write is refused\./;

function expectStandaloneRefusal(err: Awaited<ReturnType<typeof refusalOf>>) {
  expect(err).not.toBeNull();
  expect(err?.code).toBe('NOT_IMPLEMENTED');
  expect(err?.status).toBe(501);
  expect(err?.message).toMatch(FIRST_SENTENCE);
  expect(err?.message).toContain('metadata before* hook');
  expect(err?.message).toContain('--replSet');
  // The client's hint is what the defect said; it is not the refusal any more.
  expect(err?.message).not.toContain('Please add retryWrites=false');
  // …and the client's error is kept, not discarded.
  expect(isStandaloneTransactionFault(err?.cause)).toBe(true);
}

describe('a standalone MongoDB server refuses the unit a metadata before* hook opens — naming the cause', () => {
  it('insert on an object with a beforeInsert hook: refused NOT_IMPLEMENTED/501 with the replica-set fix, nothing stored', async () => {
    const { engine, fake } = await makeEngine('standalone', ['beforeInsert']);
    expectStandaloneRefusal(await refusalOf(engine.insert('case', { name: 'c1' })));
    expect(fake.docs('case')).toEqual([]);
    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0].committed).toBe(false);
  });

  it('update and delete on an object with beforeUpdate / beforeDelete hooks: refused the same way, the row untouched', async () => {
    const { engine, fake } = await makeEngine('standalone', ['beforeUpdate', 'beforeDelete']);
    // No beforeInsert hook, so this insert opens no unit and is stored.
    const row = await engine.insert('case', { name: 'before' }) as Doc;
    expectStandaloneRefusal(await refusalOf(engine.update('case', { name: 'after' }, { where: { id: row.id } } as never)));
    expectStandaloneRefusal(await refusalOf(engine.delete('case', { where: { id: row.id } } as never)));
    expect(fake.docs('case').map(({ _id, ...r }) => r)).toMatchObject([{ id: row.id, name: 'before' }]);
  });

  it('CONTROL replica set: the same hooked insert is stored, inside a committed unit', async () => {
    const { engine, fake } = await makeEngine('replica-set', ['beforeInsert']);
    await engine.insert('case', { name: 'c1' });
    expect(fake.docs('case')).toMatchObject([{ name: 'c1' }]);
    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0].committed).toBe(true);
  });

  it('CONTROL no hook: on the standalone server a write on an object that opens no unit is stored, no session started', async () => {
    const { engine, fake } = await makeEngine('standalone', ['beforeInsert']);
    await engine.insert('note', { name: 'n1' });
    expect(fake.docs('note')).toMatchObject([{ name: 'n1' }]);
    expect(fake.sessions).toHaveLength(0);
  });
});

describe('the mapping changes what a unit fault says, nothing else', () => {
  it('a read under the session (the server\'s own spelling) is refused the same way', async () => {
    const fake = fakeMongo('standalone');
    const driver = makeDriver(fake);
    const trx = await driver.beginTransaction();
    expectStandaloneRefusal(await refusalOf(driver.find('case', {} as never, { transaction: trx } as never)));
    expectStandaloneRefusal(await refusalOf(driver.count('case', {} as never, { transaction: trx } as never)));
  });

  it('PASS-THROUGH: an unrelated error under a session reaches the caller as it was', async () => {
    const fake = fakeMongo('replica-set');
    const duplicate = new MongoServerError({ ok: 0, code: 11000, errmsg: 'E11000 duplicate key error' });
    (fake.db as any).collection = () => ({ insertOne: async () => { throw duplicate; } });
    const driver = makeDriver(fake);
    const trx = await driver.beginTransaction();
    expect(await refusalOf(driver.create('case', { name: 'x' }, { transaction: trx } as never))).toBe(duplicate);
  });

  it('PASS-THROUGH: the standalone shape WITHOUT a session is not mapped — no unit ran, so that cause is not the cause', async () => {
    const fake = fakeMongo('replica-set');
    const rewrite = clientRewrite();
    (fake.db as any).collection = () => ({ insertOne: async () => { throw rewrite; } });
    const driver = makeDriver(fake);
    expect(await refusalOf(driver.create('case', { name: 'x' }))).toBe(rewrite);
  });

  it('the recogniser: both spellings yes; another IllegalOperation, another text, and non-errors no', () => {
    expect(isStandaloneTransactionFault(serverError())).toBe(true);
    expect(isStandaloneTransactionFault(clientRewrite())).toBe(true);
    expect(isStandaloneTransactionFault(new MongoServerError({ ok: 0, code: 20, errmsg: 'some other illegal operation' }))).toBe(false);
    expect(isStandaloneTransactionFault(new MongoServerError({ ok: 0, code: 251, errmsg: SERVER_TEXT }))).toBe(false);
    expect(isStandaloneTransactionFault(new Error(CLIENT_HINT))).toBe(false);
    expect(isStandaloneTransactionFault(undefined)).toBe(false);
    const other = new Error('boom');
    expect(refusalForUnitFault(other)).toBe(other);
  });
});

describe('connect() says once, at boot, that a standalone store carries no units', () => {
  const connectWith = async (hello: Doc | Error) => {
    const fake = fakeMongo('standalone', hello);
    const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/standalone_unit' });
    (driver as any).client = fake.client;
    const warn = vi.spyOn((driver as any).logger, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn((driver as any).logger, 'debug').mockImplementation(() => {});
    await driver.connect();
    return { warn, debug };
  };

  it('a standalone hello: one warning naming the database, the affected writes and the replica-set fix', async () => {
    const { warn } = await connectWith({ isWritablePrimary: true, maxWireVersion: 25 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(standaloneStoreWarning('standalone_unit'));
    expect(String(warn.mock.calls[0][0])).toMatch(/^MongoDB database 'standalone_unit' is served by a standalone mongod, which runs no transactions\./);
    expect(String(warn.mock.calls[0][0])).toContain('metadata before*');
    expect(String(warn.mock.calls[0][0])).toContain('--replSet');
  });

  it.each([
    ['a replica set member', { setName: 'rs0', isWritablePrimary: true }],
    ['a mongos (or a load balancer in front of one)', { msg: 'isdbgrid', isWritablePrimary: true }],
  ])('CONTROL %s: no warning', async (_label, hello) => {
    const { warn } = await connectWith(hello);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a probe that fails: no warning (nothing is known), the failure at debug, and connect() still resolves', async () => {
    const { warn, debug } = await connectWith(new Error('not authorized'));
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('isStandaloneHello reads only setName and msg', () => {
    expect(isStandaloneHello({ isWritablePrimary: true })).toBe(true);
    expect(isStandaloneHello({ setName: '' })).toBe(true);
    expect(isStandaloneHello({ setName: 'rs0' })).toBe(false);
    expect(isStandaloneHello({ msg: 'isdbgrid' })).toBe(false);
    expect(isStandaloneHello(null)).toBe(false);
  });
});
