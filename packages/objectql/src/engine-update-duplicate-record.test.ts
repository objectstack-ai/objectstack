// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14390 — the update door's ONE error contract for a driver's unique-constraint
 * refusal: the insert door's (#14095), one verb over.
 *
 * ## What was measured, and why it is a defect rather than a preference
 *
 * A real `ObjectQL` engine on a real `driver-sqlite-wasm` store, an object
 * carrying a declared unique index on `email`, two rows, the second driven onto
 * the first's value through `engine.update`. What left the door, by-id and by
 * predicate (`multi: true`) alike:
 *
 * ```
 * name=Error  code=undefined  status=undefined  cause=absent  keys=[]
 * message: update `duly_note` set `id` = '…', `email` = 'a@b.example', … where `id` = '…' - UNIQUE constraint failed: duly_note.email
 * ```
 *
 * No `code`, no `status`, no `cause`, the compiled UPDATE with its bound values
 * as the message — the shape #14095 measured on insert. The REST boundary
 * sanitises an error carrying neither `code` nor `status` into
 * `500 INTERNAL_ERROR`, so the same user action answered `409 DUPLICATE_RECORD`
 * on create and `500 INTERNAL_ERROR` on edit: an application branching on
 * `code === 'DUPLICATE_RECORD'` for its create path fell through to the generic
 * branch on its edit path, on every driver.
 *
 * ## What this file pins
 *
 * Both directions, because only the pair is a contract:
 *
 *   - BOTH driver-error exits of the update door turn a recognised unique
 *     violation into the envelope — the by-id `driver.update` call and the
 *     predicate `driver.updateMany` call — and the scoped-repository facade a
 *     hook reaches as `ctx.api.object(name)` inherits it; and
 *   - **nothing else moves**: a NOT NULL violation, a deadlock, a missing table
 *     and an unreachable store leave BOTH exits as the very object the driver
 *     threw — asserted on IDENTITY, not on a message match, one pin per class
 *     per exit (triage ruling, 2026-09-02).
 *
 * Two things the insert file never had to decide:
 *
 *   - **A multi-row write names no row.** The driver's error does not say which
 *     of the N matched rows conflicted, and the envelope invents nothing: it
 *     carries exactly the keys the by-id envelope carries, and `field` only
 *     when the dialect determinably named a column.
 *   - **Placement.** The envelope sits on the two driver exits, NOT on the
 *     door's outer `catch`: that `catch` also sees the `afterUpdate` dispatch
 *     and the roll-up recompute, so a raw unique violation raised by a nested
 *     driver call inside a hook must NOT come out attributed to this object.
 *     Pinned below with an `afterUpdate` hook that throws a raw driver shape.
 *
 * Refusal cases assert `code` AND `status` (ADR-0112), never `toThrow()` alone:
 * a bare `toThrow` is green both when the door envelopes correctly and when a
 * driver throws a raw error, which is the whole distinction under test.
 *
 * The driver fixtures are the dialect shapes measured for #14095, restated in
 * their UPDATE form (the SQLite message inlines the SET clause's bound values,
 * exactly as measured above). Restated rather than shared with the insert file
 * because the two files ask different questions of them and a shared fixture
 * module would couple their futures.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isUniqueViolationError, uniqueViolationColumn } from '@objectstack/types';
import { ObjectQL, ScopedContext } from './engine';
import { DuplicateRecordError, DUPLICATE_RECORD_CODE } from './duplicate-record-error';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';

vi.mock('./registry', async () => {
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

/**
 * The double's `getObject`, typed — see the insert pin file for why the
 * narrowing lives here rather than as a cast at each call site.
 */
const registryDouble = SchemaRegistry as unknown as { getObject: ReturnType<typeof vi.fn> };

type Row = Record<string, unknown>;

/* --------------------------------------------------------------------------
 * Driver fixtures — the shapes the supported dialects actually raise on UPDATE.
 * ----------------------------------------------------------------------- */

/** better-sqlite3 / sql.js: names the COLUMN, behind the compiled statement with its bound values. */
const sqliteDuplicate = () =>
  Object.assign(
    new Error(
      "update `doc` set `email` = 'a@b.example', `updated_at` = '2026-09-02T09:47:44.127Z' " +
        "where `id` = 'r2' - UNIQUE constraint failed: doc.email",
    ),
    { code: 'SQLITE_CONSTRAINT_UNIQUE' },
  );

/** node-postgres: the column is in the DETAIL line, not the message. */
const postgresDuplicate = () =>
  Object.assign(new Error('duplicate key value violates unique constraint "doc_email_key"'), {
    code: '23505',
    detail: 'Key (email)=(a@b.example) already exists.',
  });

/** mysql2: names the INDEX. `uniqueViolationColumn` refuses to read it as a column. */
const mysqlDuplicate = () =>
  Object.assign(new Error("Duplicate entry 'a@b.example' for key 'idx_doc_email'"), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
  });

/**
 * driver-memory (#13197 / #13239): already an ADR-0112 envelope, in the
 * platform's own vocabulary — the declared-index sentence measured on a real
 * `InMemoryDriver` for this card, which names the KEY COLUMNS in parentheses
 * and no single column, so `uniqueViolationColumn` answers `undefined` for it.
 */
const memoryDuplicate = () =>
  Object.assign(
    new Error(
      'Unique constraint violated on `doc` over (`email`): a record with the values ' +
        '{"email":"a@b.example"} already exists. No record was written.',
    ),
    { code: 'UNIQUE_VIOLATION', status: 409 },
  );

/* -------- the negative side: failures that must NOT change shape --------- */

const notNullViolation = () =>
  Object.assign(new Error('NOT NULL constraint failed: doc.title'), {
    code: 'SQLITE_CONSTRAINT_NOTNULL',
  });

const missingTable = () =>
  Object.assign(new Error('SQLITE_ERROR: no such table: doc'), { code: 'SQLITE_ERROR' });

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });

const unreachableStore = () =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });

/* --------------------------------------------------------------------------
 * Rig
 * ----------------------------------------------------------------------- */

const SCHEMA = {
  name: 'doc',
  fields: {
    title: { type: 'text' },
    email: { type: 'text' },
  },
  indexes: [{ name: 'idx_doc_email', fields: ['email'], unique: true }],
};

/** The rows the store holds; the by-id path's not-found gate reads them back. */
const STORED: Row[] = [
  { id: 'r1', title: 'a', email: 'a@b.example' },
  { id: 'r2', title: 'b', email: 'c@d.example' },
  { id: 'r3', title: 'b', email: 'e@f.example' },
];

interface DriverOpts {
  /** What `update` / `updateMany` reject with. `null` = accept everything. */
  refuse?: (() => unknown) | null;
}

function makeDriver(opts: DriverOpts = {}) {
  const refuse = opts.refuse ?? null;
  const driver: any = {
    name: 'fake',
    version: '0.0.0',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    execute: vi.fn(),
    find: vi.fn(async () => []),
    // The by-id branch reads the prior row before it writes (#7867's
    // not-found gate), so the double must be able to find what it holds.
    findOne: vi.fn(async (_obj: string, ast: { where?: { id?: unknown } }) =>
      STORED.find((row) => row.id === ast?.where?.id) ?? null,
    ),
    create: vi.fn(),
    update: vi.fn(async (_obj: string, id: string, data: Row) => {
      if (refuse) throw refuse();
      return { ...(STORED.find((row) => row.id === id) ?? { id }), ...data };
    }),
    updateMany: vi.fn(async () => {
      if (refuse) throw refuse();
      return 2;
    }),
    delete: vi.fn(),
    count: vi.fn(),
  };
  return driver as IDataDriver & { update: any; updateMany: any };
}

/** A logger that records what the door's `Update operation failed` line carried. */
function recordingLogger() {
  const errors: Array<{ msg: string; err: unknown; meta: unknown }> = [];
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn((msg: string, err?: unknown, meta?: unknown) => {
      errors.push({ msg, err, meta });
    }),
  };
  return { logger, errors };
}

function makeRig(opts: DriverOpts = {}, schema: unknown = SCHEMA) {
  registryDouble.getObject.mockReturnValue(schema);
  const driver = makeDriver(opts);
  const { logger, errors } = recordingLogger();
  const engine = new ObjectQL({ logger });
  engine.registerDriver(driver, true);
  return { engine, driver, errors };
}

/** The rejection, as the value the caller actually receives. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  return run().then(
    () => {
      throw new Error('expected the update to be refused');
    },
    (e) => e as any,
  );
}

/** The by-id door: a scalar payload id, the row the store holds. */
const byId = (engine: ObjectQL, data: Row = { email: 'a@b.example' }) =>
  engine.update('doc', { id: 'r2', ...data });

/** The predicate door: N matched rows driven onto ONE unique value. */
const byPredicate = (engine: ObjectQL, data: Row = { email: 'a@b.example' }) =>
  engine.update('doc', data, { where: { title: 'b' }, multi: true } as any);

describe('engine.update — a driver unique violation is a DUPLICATE_RECORD envelope (#14390)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ====================================================================== *
   * (1) The envelope itself, on the by-id door
   * ==================================================================== */

  describe('the envelope, on the by-id door', () => {
    it('carries the ADR-0112 code AND status, with the driver error whole on `cause`', async () => {
      const raw = sqliteDuplicate();
      const { engine, driver } = makeRig({ refuse: () => raw });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      // The two halves a refusal test must assert — never `toThrow()` alone.
      expect(failure.code).toBe(DUPLICATE_RECORD_CODE);
      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      // The driver's own diagnosis is preserved rather than replaced — and it is
      // the SAME object, not a copy, so nothing about it was lost in transit.
      expect(failure.cause).toBe(raw);
      expect(failure).toBeInstanceOf(DuplicateRecordError);
      expect(failure.name).toBe('DuplicateRecordError');
      // Non-vacuity: the by-id exit is the one that threw.
      expect(driver.update).toHaveBeenCalledTimes(1);
      expect(driver.updateMany).not.toHaveBeenCalled();
    });

    it('names the object, and the COLUMN when the dialect determinably named one', async () => {
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      expect(failure.object).toBe('doc');
      expect(failure.field).toBe('email');
      expect(failure.message).toContain("'doc'");
      expect(failure.message).toContain("'email'");
      expect(failure.message).toContain('No record was written');
    });

    it('reads the column out of Postgres DETAIL, which is not on the message at all', async () => {
      const { engine } = makeRig({ refuse: postgresDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.field).toBe('email');
    });

    it('names NO field when the dialect named an INDEX — never the index as a column', async () => {
      // MySQL's `for key 'idx_doc_email'` is an index name; `uniqueViolationColumn`
      // refuses it under the maintainer's 2026-08-08 ruling (#6544). This door
      // does not widen that contract.
      const { engine } = makeRig({ refuse: mysqlDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.field).toBeUndefined();
      expect('field' in failure).toBe(true); // the class declares it; the VALUE is absent
      expect(failure.message).not.toContain('idx_doc_email');
    });

    it('normalises a driver that already speaks an envelope — one code, not two', async () => {
      // driver-memory refuses with `UNIQUE_VIOLATION` / 409. A platform envelope,
      // but a DIFFERENT one; an application branching on the update door would
      // still need two spellings. The door answers one.
      const raw = memoryDuplicate();
      const { engine } = makeRig({ refuse: () => raw });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
      expect((failure.cause as any).code).toBe('UNIQUE_VIOLATION');
      // Measured on a real InMemoryDriver: its declared-index sentence names the
      // key columns in parentheses and no single column, so the column reader
      // answers `undefined` and the envelope reports no `field` — the same
      // answer the predicate gives, asked of the raw error directly.
      expect(uniqueViolationColumn(raw)).toBeUndefined();
      expect(failure.field).toBeUndefined();
    });

    it('is idempotent — an envelope reaching a seam twice does not nest', async () => {
      const inner = sqliteDuplicate();
      const already = new DuplicateRecordError('doc', inner, 'email');
      const { engine } = makeRig({ refuse: () => already });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      expect(failure).toBe(already);
      expect(failure.cause).toBe(inner);
    });
  });

  /* ====================================================================== *
   * (2) The predicate door — and what a multi-row write does NOT claim
   * ==================================================================== */

  describe('the same contract on the predicate (`multi: true`) door', () => {
    it('envelopes the `updateMany` refusal on the same terms', async () => {
      const raw = sqliteDuplicate();
      const { engine, driver } = makeRig({ refuse: () => raw });
      await engine.init();

      const failure = await refusalOf(() => byPredicate(engine));

      expect(driver.updateMany).toHaveBeenCalledTimes(1);
      expect(driver.update).not.toHaveBeenCalled();
      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
      expect(failure.object).toBe('doc');
      expect(failure).toBeInstanceOf(DuplicateRecordError);
    });

    it('carries `field` only when the dialect named a column — and invents no row attribution', async () => {
      // Two matched rows were driven onto one value. The driver's error names
      // the column and nothing about WHICH row lost; so does the envelope.
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byPredicate(engine));

      expect(failure.field).toBe('email');
      // No "one of N", no row index, no count — the envelope carries exactly the
      // keys the by-id envelope carries. A fabricated row attribution is worse
      // than an absent one (triage ruling, 2026-09-02).
      const single = await refusalOf(() => byId(engine));
      expect(Object.keys(failure).sort()).toEqual(Object.keys(single).sort());
      expect(failure).not.toHaveProperty('rows');
      expect(failure).not.toHaveProperty('count');
      expect(failure).not.toHaveProperty('index');
      expect(failure.message).not.toMatch(/\b(one of|of \d+|rows?|matched)\b/i);
      expect(failure.message).toBe(single.message);
    });

    it('names NO field on the predicate door when the dialect named an index', async () => {
      const { engine } = makeRig({ refuse: mysqlDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byPredicate(engine));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.field).toBeUndefined();
    });

    it('normalises driver-memory’s own `UNIQUE_VIOLATION` on the predicate door too', async () => {
      const raw = memoryDuplicate();
      const { engine } = makeRig({ refuse: () => raw });
      await engine.init();

      const failure = await refusalOf(() => byPredicate(engine));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
    });
  });

  /* ====================================================================== *
   * (3) The facades reach the same door
   * ==================================================================== */

  describe('the scoped-repository facade reaches the same envelope', () => {
    it('`ctx.api.object(name).update(data)` — the form a hook reaches', async () => {
      // `ScopedContext.object(name).update(data)` delegates to this same door, so
      // it inherits the contract rather than declaring a second one.
      const raw = sqliteDuplicate();
      const { engine } = makeRig({ refuse: () => raw });
      await engine.init();

      const repo = new ScopedContext({} as any, engine as any).object('doc');
      const failure = await refusalOf(() => repo.update({ id: 'r2', email: 'a@b.example' }));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
    });

    it('`updateById(id, data)` — the by-id alias', async () => {
      const raw = postgresDuplicate();
      const { engine } = makeRig({ refuse: () => raw });
      await engine.init();

      const repo = new ScopedContext({} as any, engine as any).object('doc');
      const failure = await refusalOf(() => repo.updateById('r2', { email: 'a@b.example' }));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
      expect(failure.field).toBe('email');
    });
  });

  /* ====================================================================== *
   * (4) The negative side — the positive controls, one per class PER EXIT
   * ==================================================================== */

  describe('nothing that is not a unique violation changes shape', () => {
    const controls: Array<[string, () => unknown]> = [
      ['a NOT NULL violation', notNullViolation],
      ['a missing table', missingTable],
      ['a deadlock', deadlock],
      ['an unreachable store', unreachableStore],
    ];

    for (const [label, make] of controls) {
      it(`${label} leaves the by-id door as the very object the driver threw`, async () => {
        const raw = make();
        const { engine, driver } = makeRig({ refuse: () => raw });
        await engine.init();

        const failure = await refusalOf(() => byId(engine));

        // Identity, not a message match: this is the assertion a future
        // "helpful" re-wrap of every driver error would have to break.
        expect(driver.update).toHaveBeenCalledTimes(1);
        expect(failure).toBe(raw);
        expect(failure.code).not.toBe('DUPLICATE_RECORD');
        expect(failure).not.toBeInstanceOf(DuplicateRecordError);
        expect(failure.status).toBeUndefined();
      });

      it(`${label} leaves the predicate door unchanged too`, async () => {
        const raw = make();
        const { engine, driver } = makeRig({ refuse: () => raw });
        await engine.init();

        const failure = await refusalOf(() => byPredicate(engine));

        expect(driver.updateMany).toHaveBeenCalledTimes(1);
        expect(failure).toBe(raw);
        expect(failure).not.toBeInstanceOf(DuplicateRecordError);
        expect(failure.status).toBeUndefined();
      });
    }

    it('a NOT NULL violation is refused as a NOT NULL violation, not as a conflict', async () => {
      // SQLite spells NOT NULL and UNIQUE with the same `… constraint failed:
      // t.c` shape, so this is the case a message-matching wrap gets wrong. The
      // verdict comes from the shared predicate, which deliberately excludes the
      // bare `constraint failed` word pair.
      expect(isUniqueViolationError(notNullViolation())).toBe(false);
    });
  });

  /* ====================================================================== *
   * (5) Placement — the envelope is on the driver exits, not the outer catch
   * ==================================================================== */

  describe('the envelope is this door’s, not the hook phase’s', () => {
    it('a raw unique violation thrown INSIDE an afterUpdate hook is not attributed to this object', async () => {
      // The door's outer `catch` also encloses the `afterUpdate` dispatch. A
      // hook that reaches a store directly (not through `ctx.api`, which
      // envelopes on its own door with its own object name) can surface a RAW
      // unique violation from some OTHER table. Enveloping at the outer catch
      // would stamp `object: 'doc'` on it — a wrong attribution, which is worse
      // than none. So the write itself succeeds here, and what the caller gets
      // is exactly what the hook threw.
      const nested = sqliteDuplicate();
      const { engine, driver } = makeRig({ refuse: null });
      engine.registerHook('afterUpdate', async () => {
        throw nested;
      }, { object: 'doc' });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      expect(driver.update).toHaveBeenCalledTimes(1);
      expect(failure).toBe(nested);
      expect(failure).not.toBeInstanceOf(DuplicateRecordError);
      expect(failure.code).toBe('SQLITE_CONSTRAINT_UNIQUE');
      expect(failure.status).toBeUndefined();
    });
  });

  /* ====================================================================== *
   * (6) The envelope does not break the consumers of the raw error
   * ==================================================================== */

  describe('every existing reader of the raw error keeps its answer', () => {
    it('the shared predicate still says yes, through the `cause` chain', async () => {
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      // `isUniqueViolationError` walks `cause`, so a consumer holding the
      // envelope gets the same verdict it got from the raw error.
      expect(isUniqueViolationError(failure)).toBe(true);
      expect(uniqueViolationColumn(failure)).toBe('email');
    });

    it('the message never opens with a SQL verb', async () => {
      // `@objectstack/rest`'s importer runs every row error through
      // `sanitizeRowError`, whose backstop DISCARDS any message starting with
      // `insert`/`update`/`delete`/`select`/`with`/`replace` as a leaked
      // statement — and the raw message here DOES open with `update`.
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      expect(/^\s*(insert|update|delete|select|with|replace)\s/i.test(failure.message)).toBe(false);
      expect(/^\s*update\s/i.test(String((failure.cause as Error).message))).toBe(true);
    });

    it('carries none of the driver statement or its bound values', async () => {
      // #8682's discipline, one layer out: the compiled statement stays where it
      // was, on `cause`. REST's declared-4xx arm ships `message` to the client
      // verbatim, so quoting the driver here would move the leak onto the wire.
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      expect(failure.message).not.toMatch(/update `doc`/i);
      expect(failure.message).not.toContain('set `email`');
      expect(failure.message).not.toContain('a@b.example');
      expect(failure.message).not.toContain("'r2'");
      expect(String((failure.cause as Error).message)).toMatch(/update `doc` set/i);
    });

    it('addresses the application author on `developerMessage`, and does not call the write an insert', async () => {
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));

      expect(failure.developerMessage).toContain('DUPLICATE_RECORD');
      expect(failure.developerMessage).toContain('cause');
      expect(failure.developerMessage).not.toMatch(/this insert/i);
    });
  });

  /* ====================================================================== *
   * (7) The operator log keeps the driver's diagnosis
   * ==================================================================== */

  describe('the `Update operation failed` line', () => {
    it('logs the driver’s own diagnosis (the envelope’s `cause`), redacted, not the envelope', async () => {
      // Measured on a real sqlite store before this change: the line carried
      // `UNIQUE constraint failed: duly_note.email [statement and bound values
      // redacted]`. It must carry the same after — the platform logger
      // serializes `message` and `stack` only, so logging the envelope would
      // drop the failing column.
      const { engine, errors } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byId(engine));
      expect(failure.code).toBe('DUPLICATE_RECORD');

      const line = errors.find((e) => e.msg === 'Update operation failed');
      expect(line).toBeDefined();
      const logged = line!.err as Error;
      expect(logged).toBeInstanceOf(Error);
      expect(logged.message).toContain('UNIQUE constraint failed: doc.email');
      expect(logged.message).not.toContain('Duplicate record refused');
      // …and the redaction still holds: no statement, no bound value.
      expect(logged.message).not.toMatch(/update `doc` set/i);
      expect(logged.message).not.toContain('a@b.example');
      expect(line!.meta).toEqual({ object: 'doc' });
    });

    it('logs the same way on the predicate door', async () => {
      const { engine, errors } = makeRig({ refuse: postgresDuplicate });
      await engine.init();

      const failure = await refusalOf(() => byPredicate(engine));
      expect(failure.code).toBe('DUPLICATE_RECORD');

      const line = errors.find((e) => e.msg === 'Update operation failed');
      expect(line).toBeDefined();
      expect((line!.err as Error).message).toContain('violates unique constraint');
      expect((line!.err as Error).message).not.toContain('Duplicate record refused');
    });

    it('a non-enveloped failure is logged exactly as before — the driver error itself', async () => {
      const raw = deadlock();
      const { engine, errors } = makeRig({ refuse: () => raw });
      await engine.init();

      await refusalOf(() => byId(engine));

      const line = errors.find((e) => e.msg === 'Update operation failed');
      expect(line).toBeDefined();
      expect(line!.err).toBe(raw);
    });
  });
});
