// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14095 — the insert door's ONE error contract for a driver's unique-constraint
 * refusal.
 *
 * ## What was measured, and why it is a defect rather than a preference
 *
 * The platform recommends "declare a unique index, attempt the insert, swallow
 * the violation" — `createWithAutonumberResync`'s own doc argues against the
 * read-then-write alternative. A real application could not complete that
 * pattern: on the driver that enforces the index, the RAW driver error
 * propagated out of `engine.insert` (`name=SqliteError`,
 * `code='SQLITE_CONSTRAINT_UNIQUE'`, `Object.keys(err) = ['code']`, message =
 * the whole compiled INSERT), so the app's only readings were a dialect code
 * (which stops being idempotent the day the store changes) or the message text.
 * The platform's own dialect-independent predicate lives in
 * `@objectstack/types`, which an application cannot resolve.
 *
 * Triage ruled (2026-09-01) for wrapping in ObjectQL: 「抛一个带既有词表码
 * (`DUPLICATE_RECORD` 已在 ADR-0112 台账里)的平台错误,原驱动错误作 `cause`
 * ⇒ `insert` 在每个驱动上有同一份契约」.
 *
 * ## What this file pins
 *
 * Both directions, because only the pair is a contract:
 *
 *   - every driver-error EXIT of the insert door turns a recognised unique
 *     violation into the envelope — single row, batch via `bulkCreate`, batch
 *     via the per-row fallback loop, `insertMany`'s partial mode, and the
 *     last-chance create the autonumber resync issues when the field vanished
 *     mid-flight; and
 *   - **nothing else moves**: a NOT NULL violation, a deadlock, a missing table
 *     and an unreachable store leave the door as the very object the driver
 *     threw — asserted on IDENTITY, not on a message match, so a future
 *     "helpful" re-wrap cannot pass this file.
 *
 * Refusal cases assert `code` AND `status` (ADR-0112), never `toThrow()` alone:
 * a bare `toThrow` is green both when the door envelopes correctly and when a
 * driver throws a raw error, which is the whole distinction under test.
 *
 * The driver fixtures are the dialect shapes `engine-autonumber-resync.test.ts`
 * measured; they are restated here rather than shared because this file asks a
 * different question of them (what the DOOR raises, not whether the resync
 * re-issues) and a shared fixture module would couple the two files' futures.
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
 * The double's `getObject`, typed.
 *
 * `createRegistryModuleMock` hands back a FUNCTION with the instance members
 * assigned onto it (`Object.assign(SchemaRegistry, instance)`), so the mocked
 * `getObject` is reachable off the imported binding at run time — but the
 * binding's STATIC type is the real class, which declares `getObject` on
 * instances only. Narrowed once here rather than cast at each call site, so
 * `tsconfig.test.json` (which does compile this file — the package's plain
 * `typecheck` excludes tests and would have said nothing) stays satisfied
 * without an assertion in the middle of a test body.
 */
const registryDouble = SchemaRegistry as unknown as { getObject: ReturnType<typeof vi.fn> };

type Row = Record<string, unknown>;

/* --------------------------------------------------------------------------
 * Driver fixtures — the shapes the supported dialects actually raise.
 * ----------------------------------------------------------------------- */

/** better-sqlite3: names the COLUMN, and buries it behind the compiled statement. */
const sqliteDuplicate = () =>
  Object.assign(
    new Error(
      'insert into `doc` (`email`, `id`, `title`) values (?, ?, ?) - ' +
        'UNIQUE constraint failed: doc.email',
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

/** driver-memory (#13197): already an ADR-0112 envelope, in the platform's own vocabulary. */
const memoryDuplicate = () =>
  Object.assign(
    new Error('Unique constraint violated on `doc.email`: a record with that value already exists.'),
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

interface DriverOpts {
  /** What `create` / `bulkCreate` reject with. `null` = accept everything. */
  refuse?: (() => unknown) | null;
  /** Omit `bulkCreate` so a batch takes the engine's per-row fallback loop. */
  noBulkCreate?: boolean;
}

function makeDriver(opts: DriverOpts = {}) {
  const refuse = opts.refuse ?? null;
  const stored: Row[] = [];
  const driver: any = {
    name: 'fake',
    version: '0.0.0',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    execute: vi.fn(),
    find: vi.fn(async () => []),
    findOne: vi.fn(),
    create: vi.fn(async (_obj: string, row: Row) => {
      if (refuse) throw refuse();
      const written = { id: `new${stored.length + 1}`, ...row };
      stored.push(written);
      return written;
    }),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
  if (!opts.noBulkCreate) {
    driver.bulkCreate = vi.fn(async (_obj: string, rows: Row[]) => {
      if (refuse) throw refuse();
      return rows.map((row, i) => ({ id: `new${stored.length + i + 1}`, ...row }));
    });
  }
  return driver as IDataDriver & { create: any; bulkCreate?: any };
}

function makeRig(opts: DriverOpts = {}, schema: unknown = SCHEMA) {
  registryDouble.getObject.mockReturnValue(schema);
  const driver = makeDriver(opts);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  return { engine, driver };
}

/** The rejection, as the value the caller actually receives. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  return run().then(
    () => {
      throw new Error('expected the insert to be refused');
    },
    (e) => e as any,
  );
}

describe('engine.insert — a driver unique violation is a DUPLICATE_RECORD envelope (#14095)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ====================================================================== *
   * (1) The envelope itself
   * ==================================================================== */

  describe('the envelope, on the single-row door', () => {
    it('carries the ADR-0112 code AND status, with the driver error whole on `cause`', async () => {
      const raw = sqliteDuplicate();
      const { engine } = makeRig({ refuse: () => raw });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't', email: 'a@b.example' }));

      // The two halves a refusal test must assert — never `toThrow()` alone.
      expect(failure.code).toBe(DUPLICATE_RECORD_CODE);
      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      // The driver's own diagnosis is preserved rather than replaced — and it is
      // the SAME object, not a copy, so nothing about it was lost in transit.
      expect(failure.cause).toBe(raw);
      expect(failure).toBeInstanceOf(DuplicateRecordError);
      expect(failure.name).toBe('DuplicateRecordError');
    });

    it('names the object, and the COLUMN when the dialect determinably named one', async () => {
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't', email: 'a@b.example' }));

      expect(failure.object).toBe('doc');
      expect(failure.field).toBe('email');
      expect(failure.message).toContain("'doc'");
      expect(failure.message).toContain("'email'");
      expect(failure.message).toContain('No record was written');
    });

    it('reads the column out of Postgres DETAIL, which is not on the message at all', async () => {
      const { engine } = makeRig({ refuse: postgresDuplicate });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't', email: 'a@b.example' }));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.field).toBe('email');
    });

    it('names NO field when the dialect named an INDEX — never the index as a column', async () => {
      // MySQL's `for key 'idx_doc_email'` is an index name. `uniqueViolationColumn`
      // refuses it on the maintainer's 2026-08-08 ruling (#6544): a wrong field
      // name is worse than none, because it sends the author to correct an input
      // that was never the problem. This door does not widen that contract.
      const { engine } = makeRig({ refuse: mysqlDuplicate });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't', email: 'a@b.example' }));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.field).toBeUndefined();
      expect('field' in failure).toBe(true); // the class declares it; the VALUE is absent
      expect(failure.message).toContain("'doc'");
      expect(failure.message).not.toContain('idx_doc_email');
    });

    it('normalises a driver that already speaks an envelope — one code, not two', async () => {
      // driver-memory raises `UNIQUE_VIOLATION` / 409 (#13197). It is a platform
      // envelope, but it is a DIFFERENT one, so an application branching on the
      // insert door would still need two spellings. The door answers one.
      const raw = memoryDuplicate();
      const { engine } = makeRig({ refuse: () => raw });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't', email: 'a@b.example' }));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
      expect((failure.cause as any).code).toBe('UNIQUE_VIOLATION');
    });

    it('is idempotent — an envelope reaching a seam twice does not nest', async () => {
      const inner = sqliteDuplicate();
      const already = new DuplicateRecordError('doc', inner, 'email');
      const { engine } = makeRig({ refuse: () => already });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't' }));

      expect(failure).toBe(already);
      expect(failure.cause).toBe(inner);
    });
  });

  /* ====================================================================== *
   * (2) Every driver-error exit of the door, not just the easy one
   * ==================================================================== */

  describe('the same contract on every path a driver create failure leaves by', () => {
    it('batch insert through `bulkCreate`', async () => {
      const raw = sqliteDuplicate();
      const { engine, driver } = makeRig({ refuse: () => raw });
      await engine.init();

      const failure = await refusalOf(() =>
        engine.insert('doc', [{ title: 'a', email: 'a@b.example' }, { title: 'b', email: 'a@b.example' }]),
      );

      expect((driver as any).bulkCreate).toHaveBeenCalledTimes(1);
      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
      expect(failure.field).toBe('email');
    });

    it('batch insert through the per-row fallback loop (a driver with no `bulkCreate`)', async () => {
      const raw = postgresDuplicate();
      const { engine, driver } = makeRig({ refuse: () => raw, noBulkCreate: true });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', [{ title: 'a', email: 'a@b.example' }]));

      expect((driver as any).bulkCreate).toBeUndefined();
      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
    });

    it("insertMany's partial-row mode — a driver write failure is still a whole-call rejection", async () => {
      const raw = sqliteDuplicate();
      const { engine } = makeRig({ refuse: () => raw });
      await engine.init();

      const failure = await refusalOf(() => engine.insertMany('doc', [{ title: 'a', email: 'a@b.example' }]));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
    });

    it('the scoped-repository facade reaches the same envelope', async () => {
      // `ScopedContext.object(name).insert(data)` is what a hook reaches as
      // `ctx.api.object(name)` — it delegates to this same door, so it inherits
      // the contract rather than declaring a second one.
      const raw = sqliteDuplicate();
      const { engine } = makeRig({ refuse: () => raw });
      await engine.init();

      const repo = new ScopedContext({} as any, engine as any).object('doc');
      const failure = await refusalOf(() => repo.insert({ title: 't' }));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.cause).toBe(raw);
    });

    it('the autonumber resync\'s LAST-CHANCE create, after the field vanished mid-flight', async () => {
      // The one exit that sits OUTSIDE the resync loop's own `try`: the engine
      // re-seeds, finds nothing left to re-issue because the field is gone from
      // the schema, and issues one final create. Its rejection is a second
      // driver-error exit, and it is enveloped on the same terms as the first.
      const numbered = {
        name: 'doc',
        fields: { title: { type: 'text' }, doc_no: { type: 'autonumber', required: true, format: 'D-{0000}' } },
      };
      const raw = mysqlDuplicate();
      const { engine } = makeRig({ refuse: () => raw }, numbered);
      await engine.init();

      // The first refusal is attributed to the number this insert issued, so the
      // engine re-seeds; the schema it re-reads no longer declares the field, so
      // `applyAutonumbers` issues nothing and the last-chance create runs.
      registryDouble.getObject.mockReturnValue({
        name: 'doc',
        fields: { title: { type: 'text' } },
      });

      const failure = await refusalOf(() => engine.insert('doc', { title: 't' }));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.cause).toBe(raw);
    });
  });

  /* ====================================================================== *
   * (3) The negative side — the positive controls
   * ==================================================================== */

  describe('nothing that is not a unique violation changes shape', () => {
    const controls: Array<[string, () => unknown]> = [
      ['a NOT NULL violation', notNullViolation],
      ['a missing table', missingTable],
      ['a deadlock', deadlock],
      ['an unreachable store', unreachableStore],
    ];

    for (const [label, make] of controls) {
      it(`${label} leaves the single-row door as the very object the driver threw`, async () => {
        const raw = make();
        const { engine } = makeRig({ refuse: () => raw });
        await engine.init();

        const failure = await refusalOf(() => engine.insert('doc', { title: 't' }));

        // Identity, not a message match: this is the assertion a future
        // "helpful" re-wrap of every driver error would have to break.
        expect(failure).toBe(raw);
        expect(failure.code).not.toBe('DUPLICATE_RECORD');
        expect(failure).not.toBeInstanceOf(DuplicateRecordError);
        expect(failure.status).toBeUndefined();
      });

      it(`${label} leaves the BATCH door unchanged too`, async () => {
        const raw = make();
        const { engine } = makeRig({ refuse: () => raw });
        await engine.init();

        const failure = await refusalOf(() => engine.insert('doc', [{ title: 't' }]));

        expect(failure).toBe(raw);
        expect(failure).not.toBeInstanceOf(DuplicateRecordError);
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
   * (4) The envelope does not break the consumers of the raw error
   * ==================================================================== */

  describe('every existing reader of the raw error keeps its answer', () => {
    it('the shared predicate still says yes, through the `cause` chain', async () => {
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't' }));

      // `isUniqueViolationError` walks `cause`, so a consumer holding the
      // envelope gets the same verdict it got from the raw error — which is what
      // makes REST's 409 arm and the import runner survive this change.
      expect(isUniqueViolationError(failure)).toBe(true);
      expect(uniqueViolationColumn(failure)).toBe('email');
    });

    it('the message never opens with a SQL verb', async () => {
      // `@objectstack/rest`'s importer runs every row error through
      // `sanitizeRowError`, whose backstop DISCARDS any message starting with
      // `insert`/`update`/`delete`/`select`/`with`/`replace` as a leaked
      // statement. A message opening "Insert on 'doc' …" would be replaced by
      // generic text — measured, which is why the wording is pinned here.
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't' }));

      expect(/^\s*(insert|update|delete|select|with|replace)\s/i.test(failure.message)).toBe(false);
    });

    it('carries none of the driver statement or its bound values', async () => {
      // #8682's discipline, one layer out: the compiled statement stays where it
      // was, on `cause`. REST's declared-4xx arm ships `message` to the client
      // verbatim, so quoting the driver here would move the leak onto the wire.
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't' }));

      expect(failure.message).not.toMatch(/insert into/i);
      expect(failure.message).not.toContain('values (?');
      expect(String((failure.cause as Error).message)).toMatch(/insert into/i);
    });

    it('addresses the application author on `developerMessage`, as DELETE_RESTRICTED does', async () => {
      const { engine } = makeRig({ refuse: sqliteDuplicate });
      await engine.init();

      const failure = await refusalOf(() => engine.insert('doc', { title: 't' }));

      expect(failure.developerMessage).toContain('DUPLICATE_RECORD');
      expect(failure.developerMessage).toContain('cause');
    });
  });
});
