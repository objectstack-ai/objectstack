// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21274] A driver fault is redacted where it LEAVES THE ENGINE, not only in
 * the engine's own log line.
 *
 * The engine's write doors logged a failed driver call with the bound
 * statement cut (#8682), then rethrew the raw error. Every in-process consumer
 * that logs what it caught therefore printed the statement and the caller's
 * values; the auth library's logger was the measured one. The cut now also
 * runs at the engine boundary, on the error itself
 * (`redactPropagatedDriverFault`), and these pins hold it there.
 *
 * ## What is pinned
 *
 *  1. Per measured driver shape (SQLite, PostgreSQL, MySQL; the shapes below
 *     mirror errors raised off live servers, property for property): no
 *     carrier of the propagated error holds the sentinel — `message`, `stack`,
 *     every own property (non-enumerable and symbol-keyed included), the
 *     `cause` chain, and the renderings a logger produces.
 *  2. What callers branch on survives: the class (prototype), `name`, the
 *     codes, Postgres' identifier fields and the database's own diagnostic.
 *  3. The REST answer does not move: `mapDataError` gives the same status,
 *     code and `field` for the redacted error as for the raw one, and every
 *     shared classifier gives the same verdict.
 *  4. Every engine door that reaches a driver exits through the cut.
 *  5. Control: the engine's own WARN line is byte-identical to the line the
 *     raw error has always produced.
 *
 * The live per-dialect pin, through a real `SqlDriver` and the auth library's
 * logger, is `plugin-auth`'s `driver-fault-auth-log-carriers.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { inspect, types as utilTypes } from 'node:util';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import {
  DRIVER_TARGETED_TABLE,
  declareTargetedTable,
  isMissingTableError,
  isUniqueViolationError,
  looksLikeInternalErrorLeak,
  mapDataError,
  uniqueViolationColumn,
} from '@objectstack/types';
import { ObjectQL } from './engine.js';
import { DuplicateRecordError } from './duplicate-record-error.js';
import { SummaryRecomputeError } from './summary-errors.js';
import { redactBoundStatement, redactPropagatedDriverFault } from '@objectstack/types';

/** The caller's value. Synthetic; asserted ABSENT from every carrier. */
const S = 'SENTINEL-21274-BOUND-VALUE';
const OBJECT = 'doc';

// ── The measured driver shapes ──────────────────────────────────────────────
//
// Measured off thrown errors (knex 3, better-sqlite3 13, node-postgres 8 on
// PostgreSQL 16, mysql2 3 on MySQL 8.0): which own properties each driver
// attaches, which carry the bound statement or a caller value, and which carry
// the class and code.

/** better-sqlite3: `code` is its only own property beyond `message`/`stack`. */
class SqliteError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
Object.defineProperty(SqliteError.prototype, 'name', { value: 'SqliteError' });

/** node-postgres: every protocol field own and enumerable, `name` own. */
class DatabaseError extends Error {
  [key: string]: unknown;
  constructor(message: string, fields: Record<string, unknown>) {
    super(message);
    this.name = 'error';
    Object.assign(this, {
      length: 120, severity: 'ERROR', code: undefined, detail: undefined, hint: undefined,
      position: undefined, internalPosition: undefined, internalQuery: undefined,
      where: undefined, schema: undefined, table: undefined, column: undefined,
      dataType: undefined, constraint: undefined, file: 'x.c', line: '1', routine: 'r',
      ...fields,
    });
  }
}

/** mysql2: a plain `Error` with own enumerable `code`/`errno`/`sqlState`/`sqlMessage`/`sql`. */
function mysqlError(statement: string, sqlMessage: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error(`${statement} - ${sqlMessage}`), { ...fields, sqlMessage, sql: statement });
}

const SQLITE_INSERT = `insert into \`doc\` (\`id\`, \`title\`) values ('r1', '${S}')`;
const PG_INSERT = 'insert into "doc" ("id", "title") values ($1, $2)';
const MYSQL_INSERT = `insert into \`doc\` (\`id\`, \`title\`) values ('r1', '${S}')`;

interface Shape {
  readonly id: string;
  readonly make: () => Error;
  /** The database's own words, as they must survive the cut. */
  readonly diagnostic: string;
}

const SHAPES: readonly Shape[] = [
  {
    id: 'sqlite unique violation',
    make: () => new SqliteError(`${SQLITE_INSERT} - UNIQUE constraint failed: doc.title`, 'SQLITE_CONSTRAINT_UNIQUE'),
    diagnostic: 'UNIQUE constraint failed: doc.title',
  },
  {
    id: 'sqlite unknown column',
    make: () => new SqliteError(`insert into \`doc\` (\`id\`, \`zzz\`) values ('r1', '${S}') - table doc has no column named zzz`, 'SQLITE_ERROR'),
    diagnostic: 'table doc has no column named zzz',
  },
  {
    id: 'sqlite not-null violation',
    make: () => new SqliteError(`${SQLITE_INSERT} - NOT NULL constraint failed: doc.title`, 'SQLITE_CONSTRAINT_NOTNULL'),
    diagnostic: 'NOT NULL constraint failed: doc.title',
  },
  {
    id: 'sqlite update, unknown column',
    make: () => new SqliteError(`update \`doc\` set \`zzz\` = '${S}' where \`id\` = '${S}' - no such column: zzz`, 'SQLITE_ERROR'),
    diagnostic: 'no such column: zzz',
  },
  {
    id: 'sqlite read, missing table',
    make: () => new SqliteError(`select * from \`doc_absent\` where \`id\` = '${S}' - no such table: doc_absent`, 'SQLITE_ERROR'),
    diagnostic: 'no such table: doc_absent',
  },
  {
    id: 'pg 23505 unique violation (value on detail)',
    make: () => new DatabaseError(`${PG_INSERT} - duplicate key value violates unique constraint "doc_title_unique"`, {
      code: '23505', detail: `Key (title)=(${S}) already exists.`, schema: 'public', table: 'doc', constraint: 'doc_title_unique',
    }),
    diagnostic: 'duplicate key value violates unique constraint "doc_title_unique"',
  },
  {
    id: 'pg 23502 not-null violation (row on detail)',
    make: () => new DatabaseError(`${PG_INSERT} - null value in column "title" of relation "doc" violates not-null constraint`, {
      code: '23502', detail: `Failing row contains (r1, ${S}, null).`, schema: 'public', table: 'doc', column: 'title',
    }),
    diagnostic: 'null value in column "title" of relation "doc" violates not-null constraint',
  },
  {
    id: 'pg 22P02 invalid input (value in diagnostic and context)',
    make: () => new DatabaseError(`${PG_INSERT} - invalid input syntax for type integer: "${S}"`, {
      code: '22P02', where: `unnamed portal parameter $2 = '${S}'`,
    }),
    diagnostic: 'invalid input syntax for type integer: [value redacted]',
  },
  {
    id: 'pg 22001 value too long (statement only)',
    make: () => new DatabaseError(`${PG_INSERT} - value too long for type character varying(8)`, { code: '22001' }),
    diagnostic: 'value too long for type character varying(8)',
  },
  {
    id: 'pg internal statement (internalQuery)',
    make: () => new DatabaseError(`${PG_INSERT} - division by zero`, {
      code: '22012', internalQuery: `select 1 / 0 where '${S}' = '${S}'`, where: `PL/pgSQL function f() line 3 at SQL statement`,
    }),
    diagnostic: 'division by zero',
  },
  {
    id: 'mysql 1062 duplicate entry (value in diagnostic)',
    make: () => mysqlError(MYSQL_INSERT, `Duplicate entry '${S}' for key 'doc.doc_title_unique'`, {
      code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000',
    }),
    diagnostic: "Duplicate entry [value redacted] for key 'doc.doc_title_unique'",
  },
  {
    id: 'mysql 1054 unknown column',
    make: () => mysqlError(`insert into \`doc\` (\`id\`, \`zzz\`) values ('r1', '${S}')`, "Unknown column 'zzz' in 'field list'", {
      code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22',
    }),
    diagnostic: "Unknown column 'zzz' in 'field list'",
  },
  {
    id: 'mysql 1366 incorrect value (value in diagnostic)',
    make: () => mysqlError(MYSQL_INSERT, `Incorrect integer value: '${S}' for column 'age' at row 1`, {
      code: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', errno: 1366, sqlState: 'HY000',
    }),
    diagnostic: "Incorrect integer value: [value redacted] for column 'age' at row 1",
  },
  {
    id: 'mysql 1406 data too long',
    make: () => mysqlError(MYSQL_INSERT, "Data too long for column 'title' at row 1", {
      code: 'ER_DATA_TOO_LONG', errno: 1406, sqlState: '22001',
    }),
    diagnostic: "Data too long for column 'title' at row 1",
  },
  {
    id: 'mysql 1048 null into not-null',
    make: () => mysqlError(MYSQL_INSERT, "Column 'title' cannot be null", {
      code: 'ER_BAD_NULL_ERROR', errno: 1048, sqlState: '23000',
    }),
    diagnostic: "Column 'title' cannot be null",
  },
];

/** The keys a caller branches on, wherever a shape carries them. */
const BRANCHED_ON = [
  'name', 'code', 'errno', 'sqlState', 'severity', 'routine', 'file', 'line', 'position',
  'schema', 'table', 'column', 'dataType', 'constraint', 'hint', 'status', 'httpStatus',
  'field', 'object', 'developerMessage',
] as const;

// ── Instruments ──────────────────────────────────────────────────────────────

/** Every path, from `root`, at which `needle` is reachable through OWN properties. */
function textCarriers(value: unknown, needle: string, path = 'error', seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return value.includes(needle) ? [path] : [];
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const hits: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    let v: unknown;
    try {
      v = 'value' in descriptor ? descriptor.value : (value as Record<PropertyKey, unknown>)[key];
    } catch {
      continue;
    }
    hits.push(...textCarriers(v, needle, `${path}.${String(key)}`, seen));
  }
  return hits;
}

/** Every path at which the caller's value is reachable. */
function sentinelCarriers(value: unknown): string[] {
  return textCarriers(value, S);
}

/**
 * The bound statement a raw fixture leads with, minus its leading kind — the
 * part that must never survive. Every fixture's diagnostic is free of ` - `,
 * so the last separator is where the statement ends.
 */
function statementBody(raw: Error): string {
  return raw.message
    .slice(0, raw.message.lastIndexOf(' - '))
    .replace(/^(insert into|update|select|delete from) /i, '');
}

/** What a logger can print of an error: the inspected form (hidden fields too), `String()` and JSON. */
function renderings(error: unknown): Record<string, string> {
  let json = '';
  try {
    json = JSON.stringify(error) ?? '';
  } catch {
    json = '';
  }
  return {
    inspect: inspect(error, { depth: 8, showHidden: true }),
    string: String(error),
    json,
  };
}

function expectNoSentinel(error: unknown): void {
  expect(sentinelCarriers(error)).toEqual([]);
  for (const [carrier, text] of Object.entries(renderings(error))) {
    expect(text.includes(S), `the ${carrier} rendering carries the caller's value`).toBe(false);
  }
}

/** The REST answer, reduced to what a client branches on. */
function restAnswer(error: unknown): { status: number; code: unknown; field: unknown } {
  const mapped = mapDataError(error, OBJECT);
  return { status: mapped.status, code: mapped.body.code, field: mapped.body.field };
}

// ── 1–3. The cut, per measured shape ────────────────────────────────────────

describe('[#21274] redactPropagatedDriverFault — per measured driver shape', () => {
  for (const shape of SHAPES) {
    describe(shape.id, () => {
      it('the raw fixture carries the bound statement (non-vacuity), and the cut does not mutate it', () => {
        const raw = shape.make();
        const before = { value: sentinelCarriers(raw), statement: textCarriers(raw, statementBody(raw)) };
        expect(before.statement.length).toBeGreaterThan(0);
        redactPropagatedDriverFault(raw);
        expect({ value: sentinelCarriers(raw), statement: textCarriers(raw, statementBody(raw)) }).toEqual(before);
      });

      it('no carrier of the propagated error holds the caller value', () => {
        expectNoSentinel(redactPropagatedDriverFault(shape.make()));
      });

      it('no carrier holds the bound statement: only its kind survives', () => {
        const raw = shape.make();
        expect(textCarriers(redactPropagatedDriverFault(raw), statementBody(raw))).toEqual([]);
      });

      it('keeps the class, the codes and the database diagnostic', () => {
        const raw = shape.make() as unknown as Record<string, unknown>;
        const out = redactPropagatedDriverFault(raw) as Error & Record<string, unknown>;
        expect(out).not.toBe(raw);
        expect(Object.getPrototypeOf(out)).toBe(Object.getPrototypeOf(raw));
        expect(utilTypes.isNativeError(out)).toBe(true);
        for (const key of BRANCHED_ON) expect(out[key], key).toBe(raw[key]);
        expect(out.message).toContain(shape.diagnostic);
      });

      it('answers every shared classifier, and the REST door, exactly as the raw error does', () => {
        const raw = shape.make();
        const out = redactPropagatedDriverFault(raw) as Error;
        expect(looksLikeInternalErrorLeak(out.message)).toBe(looksLikeInternalErrorLeak(raw.message));
        expect(isUniqueViolationError(out)).toBe(isUniqueViolationError(raw));
        expect(uniqueViolationColumn(out)).toBe(uniqueViolationColumn(raw));
        expect(isMissingTableError(out, 'doc_absent')).toBe(isMissingTableError(raw, 'doc_absent'));
        expect(restAnswer(out)).toEqual(restAnswer(raw));
      });

      it('is idempotent: a second boundary returns the same reference', () => {
        const once = redactPropagatedDriverFault(shape.make());
        expect(redactPropagatedDriverFault(once)).toBe(once);
      });
    });
  }

  it('the statement is replaced by its kind and the marker; no identifier list or VALUES clause survives', () => {
    const out = redactPropagatedDriverFault(SHAPES[0].make()) as Error;
    expect(out.message).toBe('insert into [statement and bound values redacted] - UNIQUE constraint failed: doc.title');
    const pg = redactPropagatedDriverFault(SHAPES[8].make()) as Error;
    expect(pg.message).toBe('insert into [statement and bound values redacted] - value too long for type character varying(8)');
  });

  it("keeps Postgres' key identifiers on `detail` (REST's 409 names the column from them) and cuts the values", () => {
    const out = redactPropagatedDriverFault(SHAPES[5].make()) as Error & { detail: string };
    expect(out.detail).toBe('Key (title)=([value redacted])');
    expect(uniqueViolationColumn(out)).toBe('title');
  });

  it('returns a non-driver error as the SAME reference — validation, business and policy errors leave untouched', () => {
    const validation = Object.assign(new Error('Validation failed: title is required'), { code: 'VALIDATION_FAILED', fields: [] });
    const business = new Error('An invoice cannot be closed twice');
    const policy = Object.assign(new Error('[Security] Access denied: operation insert'), { code: 'PERMISSION_DENIED' });
    const plainCause = new DuplicateRecordError(OBJECT, new Error('a store said no'), 'title');
    for (const error of [validation, business, policy, plainCause, 'a string', null, undefined, 42]) {
      expect(redactPropagatedDriverFault(error)).toBe(error);
    }
  });

  describe('an envelope that wraps a driver error leaves with its own fields and a cut `cause`', () => {
    for (const [label, cause] of [
      ['sqlite', SHAPES[0].make],
      ['pg', SHAPES[5].make],
      ['mysql', SHAPES[10].make],
    ] as const) {
      it(`DuplicateRecordError over a ${label} unique violation`, () => {
        const raw = cause();
        const envelope = new DuplicateRecordError(OBJECT, raw, 'title');
        const out = redactPropagatedDriverFault(envelope) as DuplicateRecordError;
        expectNoSentinel(out);
        expect(out).toBeInstanceOf(DuplicateRecordError);
        expect(out.code).toBe('DUPLICATE_RECORD');
        expect(out.status).toBe(409);
        expect(out.field).toBe('title');
        expect(out.message).toBe(envelope.message);
        expect(out.developerMessage).toBe(envelope.developerMessage);
        const outCause = out.cause as Error & { code?: unknown };
        expect(Object.getPrototypeOf(outCause)).toBe(Object.getPrototypeOf(raw));
        expect(outCause.code).toBe((raw as Error & { code?: unknown }).code);
        expect(isUniqueViolationError(out)).toBe(true);
        expect(restAnswer(out)).toEqual(restAnswer(envelope));
      });
    }

    it("the driver's DATABASE_ERROR read envelope: composed message kept, non-enumerable `cause` cut, targeted table kept", () => {
      const raw = SHAPES[4].make();
      const envelope = declareTargetedTable(
        Object.assign(new Error("The database refused to run this query for object 'doc'."), {
          code: 'DATABASE_ERROR',
          status: 500,
        }),
        'doc_absent',
      );
      Object.defineProperty(envelope, 'cause', { value: raw, enumerable: false, writable: true, configurable: true });

      const out = redactPropagatedDriverFault(envelope) as Error & Record<PropertyKey, unknown>;
      expectNoSentinel(out);
      expect(out.message).toBe(envelope.message);
      expect(out.code).toBe('DATABASE_ERROR');
      expect(out.status).toBe(500);
      expect(Object.getOwnPropertyDescriptor(out, 'cause')?.enumerable).toBe(false);
      expect(out[DRIVER_TARGETED_TABLE]).toBe('doc_absent');
      expect(isMissingTableError(out, 'doc')).toBe(isMissingTableError(envelope, 'doc'));
      expect(restAnswer(out)).toEqual(restAnswer(envelope));
    });
  });
});

// ── 4–5. Every engine door exits through the cut; the WARN line is unchanged ──

type Failing = 'read' | 'write' | 'execute' | 'commit';

/**
 * A driver whose chosen surface throws `make()` — reads answer benignly when
 * writes are the ones failing, as a real store would. The last raw instance
 * thrown is kept, so a pin can compare the engine's log line against it.
 */
function faultingDriver(make: () => Error, failing: Failing) {
  const state: { lastRaw?: Error } = {};
  const fail = (surface: Failing) => async (): Promise<never> => {
    if (surface !== failing) throw new Error('unreachable');
    state.lastRaw = make();
    throw state.lastRaw;
  };
  const read = <T>(benign: T) => async () => {
    if (failing === 'read') return fail('read')();
    return benign;
  };
  const write = fail('write');
  const driver = {
    name: 'faulting', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    find: read([{ id: 'r1', title: 't', token: 'tok' }]),
    findOne: read({ id: 'r1', title: 't', token: 'tok' }),
    count: read(1),
    aggregate: read([]),
    create: failing === 'write' ? write : async (_o: string, row: Record<string, unknown>) => ({ id: 'r1', ...row }),
    bulkCreate: failing === 'write' ? write : async (_o: string, rows: Record<string, unknown>[]) => rows.map((r, i) => ({ id: `r${i}`, ...r })),
    update: failing === 'write' ? write : async () => ({ id: 'r1', title: 't' }),
    updateMany: failing === 'write' ? write : async () => 1,
    delete: failing === 'write' ? write : async () => true,
    deleteMany: failing === 'write' ? write : async () => 1,
    execute: failing === 'execute' ? fail('execute') : async () => [],
    async beginTransaction() { return { trx: true }; },
    commit: failing === 'commit' ? fail('commit') : async () => {},
    async rollback() {},
    async syncSchema() {}, async initObjects() {},
  };
  return { driver: driver as any, state };
}

function capturingLogger() {
  const lines: Array<{ level: string; msg: string; meta?: any }> = [];
  const push = (level: string) => (msg: string, meta?: any) => void lines.push({ level, msg: String(msg), meta });
  const logger: any = {
    lines,
    trace() {}, fatal() {},
    debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'),
    child() { return logger; },
  };
  return logger;
}

async function bootEngine(make: () => Error, failing: Failing) {
  const logger = capturingLogger();
  const engine = new ObjectQL({ logger });
  const { driver, state } = faultingDriver(make, failing);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: OBJECT,
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true, readonly: true },
      title: { name: 'title', type: 'text' },
      token: { name: 'token', type: 'text', internal: true },
    },
  } as any, 'test');
  return { engine, logger, state };
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => { throw new Error('expected the door to refuse'); },
    (e: unknown) => e,
  );
}

const DOORS: ReadonlyArray<readonly [string, Failing, (e: ObjectQL) => Promise<unknown>]> = [
  ['insert', 'write', (e) => e.insert(OBJECT, { title: S })],
  ['insert (batch)', 'write', (e) => e.insert(OBJECT, [{ title: S }, { title: 'b' }])],
  ['update by id', 'write', (e) => e.update(OBJECT, { id: 'r1', title: S })],
  ['update by predicate', 'write', (e) => e.update(OBJECT, { title: S }, { multi: true, where: { title: 't' } } as any)],
  ['delete by id', 'write', (e) => e.delete(OBJECT, { where: { id: 'r1' } } as any)],
  ['delete by predicate', 'write', (e) => e.delete(OBJECT, { multi: true, where: { title: 't' } } as any)],
  ['find', 'read', (e) => e.find(OBJECT, { where: { title: S } })],
  ['findOne', 'read', (e) => e.findOne(OBJECT, { where: { title: S } })],
  ['count', 'read', (e) => e.count(OBJECT, { where: { title: S } })],
  ['aggregate', 'read', (e) => e.aggregate(OBJECT, { groupBy: ['title'], aggregations: [{ function: 'count', alias: 'n' }] } satisfies EngineAggregateOptions)],
  ['execute', 'execute', (e) => e.execute('select 1', { object: OBJECT, args: [S] })],
  ['resolveInternalField', 'read', (e) => e.resolveInternalField(OBJECT, ['r1'], 'token')],
  ['transaction (commit refused)', 'commit', (e) => e.transaction(async () => 'done')],
];

/** One representative per dialect for the door sweep. */
const DOOR_SHAPES = [SHAPES[1], SHAPES[6], SHAPES[11]];

describe('[#21274] every engine door that reaches a driver exits through the cut', () => {
  for (const shape of DOOR_SHAPES) {
    for (const [door, failing, run] of DOORS) {
      it(`${door} — ${shape.id}`, async () => {
        const { engine, state } = await bootEngine(shape.make, failing);
        const error = await caught(run(engine));
        expect(state.lastRaw, 'the driver was reached').toBeDefined();
        expect(sentinelCarriers(state.lastRaw).length, 'the raw error carried the value').toBeGreaterThan(0);
        expectNoSentinel(error);
        const out = error as Error & Record<string, unknown>;
        const raw = state.lastRaw as Error & Record<string, unknown>;
        expect(Object.getPrototypeOf(out)).toBe(Object.getPrototypeOf(raw));
        for (const key of BRANCHED_ON) expect(out[key], key).toBe(raw[key]);
        expect(out.message).toContain(shape.diagnostic);
      });
    }
  }

  for (const shape of [SHAPES[0], SHAPES[5], SHAPES[10]]) {
    for (const [door, run] of [
      ['insert', (e: ObjectQL) => e.insert(OBJECT, { title: S })],
      ['update by id', (e: ObjectQL) => e.update(OBJECT, { id: 'r1', title: S })],
    ] as const) {
      it(`${door}: a unique violation leaves as DuplicateRecordError with its field, and a cut cause — ${shape.id}`, async () => {
        const { engine, state } = await bootEngine(shape.make, 'write');
        const error = (await caught(run(engine))) as DuplicateRecordError;
        expectNoSentinel(error);
        expect(error).toBeInstanceOf(DuplicateRecordError);
        expect(error.code).toBe('DUPLICATE_RECORD');
        expect(error.status).toBe(409);
        expect(error.field).toBe(uniqueViolationColumn(state.lastRaw));
        const cause = error.cause as Error & { code?: unknown };
        expect(Object.getPrototypeOf(cause)).toBe(Object.getPrototypeOf(state.lastRaw));
        expect(cause.code).toBe((state.lastRaw as Error & { code?: unknown }).code);
      });
    }
  }

  it('a middleware that logs what it caught sees the cut error too', async () => {
    const { engine } = await bootEngine(SHAPES[1].make, 'write');
    const seen: unknown[] = [];
    engine.registerMiddleware(async (_ctx, next) => {
      try {
        await next();
      } catch (e) {
        seen.push(e);
        throw e;
      }
    });
    await caught(engine.insert(OBJECT, { title: S }));
    expect(seen).toHaveLength(1);
    expectNoSentinel(seen[0]);
  });

  it("a SummaryRecomputeError's failures carry the cut error, not the raw one", async () => {
    const engine = new ObjectQL({ logger: capturingLogger() });
    const rows = new Map<string, Record<string, unknown>>();
    engine.registerDriver({
      name: 'summary', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async find(object: string) { return [...rows.values()].filter((r) => r.__object === object); },
      async findOne(object: string) { return [...rows.values()].find((r) => r.__object === object) ?? null; },
      async create(object: string, data: Record<string, unknown>) {
        const row = { ...data, id: (data.id as string) ?? `${object}_${rows.size + 1}`, __object: object };
        rows.set(row.id as string, row);
        return row;
      },
      async update(object: string) {
        if (object === 'inv') throw SHAPES[3].make();
        return null;
      },
      async count() { return 0; },
      async aggregate() { return [{ value: 1 }]; },
      async delete() { return true; },
      async syncSchema() {}, async initObjects() {},
    } as any, true);
    await engine.init();
    engine.summaryRetryOptions = { sleep: async () => {}, backoffBaseMs: 0 };
    engine.registry.registerObject({
      name: 'inv',
      fields: {
        name: { type: 'text' },
        line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
      },
    } as any);
    engine.registry.registerObject({
      name: 'inv_line',
      fields: { amount: { type: 'number' }, inv: { type: 'master_detail', reference: 'inv' } },
    } as any);

    const parent = await engine.insert('inv', { name: 'INV-1' });
    const error = (await caught(engine.insert('inv_line', { inv: parent.id, amount: 5 }))) as SummaryRecomputeError;
    expect(error).toBeInstanceOf(SummaryRecomputeError);
    expect(error.failures).toHaveLength(1);
    expectNoSentinel(error.failures[0].error);
    expect((error.failures[0].error as { code?: unknown }).code).toBe('SQLITE_ERROR');
  });
});

describe("[#21274] control — the engine's own WARN line is byte-identical to the line the raw error produces", () => {
  const WRITE_DOORS: ReadonlyArray<readonly [string, string, (e: ObjectQL) => Promise<unknown>]> = [
    ['insert', 'Insert operation failed', (e) => e.insert(OBJECT, { title: S })],
    ['update', 'Update operation failed', (e) => e.update(OBJECT, { id: 'r1', title: S })],
    ['delete', 'Delete operation failed', (e) => e.delete(OBJECT, { where: { id: 'r1' } } as any)],
  ];

  for (const shape of [SHAPES[0], SHAPES[1], SHAPES[6], SHAPES[10], SHAPES[11]]) {
    for (const [door, message, run] of WRITE_DOORS) {
      it(`${door} — ${shape.id}`, async () => {
        const { engine, logger, state } = await bootEngine(shape.make, 'write');
        await caught(run(engine));
        const entries = logger.lines.filter((l: { msg: string }) => l.msg === message);
        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe('warn');
        const expected = redactBoundStatement(state.lastRaw) as Error;
        expect(entries[0].meta).toEqual({ object: OBJECT, error: { message: expected.message, stack: expected.stack } });
      });
    }
  }

  it('the logged message, spelled out for three dialects', async () => {
    const logged: string[] = [];
    for (const shape of [SHAPES[0], SHAPES[6], SHAPES[11]]) {
      const { engine, logger } = await bootEngine(shape.make, 'write');
      await caught(engine.insert(OBJECT, { title: S }));
      logged.push(logger.lines.find((l: { msg: string }) => l.msg === 'Insert operation failed').meta.error.message);
    }
    expect(logged).toEqual([
      'UNIQUE constraint failed: doc.title [statement and bound values redacted]',
      'null value in column "title" of relation "doc" violates not-null constraint [statement and bound values redacted]',
      "Unknown column 'zzz' in 'field list' [statement and bound values redacted]",
    ]);
  });
});
