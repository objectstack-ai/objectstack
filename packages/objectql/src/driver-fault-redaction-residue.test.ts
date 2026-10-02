// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21345] The two positions the engine-boundary cut (#21274) did not reach.
 *
 *  1. **The raw-statement door.** `ObjectQL.execute` hands the driver a
 *     statement the engine did not compose. The boundary cut ran on a message
 *     only when the shared leak predicate recognised it, and the predicate
 *     reads a statement by four leading verbs, a list ruled frozen. A raw
 *     statement opening with any other word (a common-table-expression form, a
 *     dialect's upsert or merge verb), whose diagnostic matched no dialect
 *     phrasing either, left the driver's declared fault with the statement and
 *     the bound values on its `cause`'s `message` and `stack`. The door now
 *     says it sent a statement (`{ statementSent: true }`), and the cut runs by
 *     construction.
 *  2. **The lifecycle sweep.** The Archiver reaches drivers directly, never
 *     through an engine door, so a cold write's fault carried the archived
 *     row's values into the sweep's WARN line and its `report.errors` entry.
 *     The sweep's per-object catch now cuts the fault with the same helper.
 *
 * The raw-path shapes below mirror, property for property, the faults
 * `driver-sql`'s raw terminal raised off better-sqlite3 13, PostgreSQL 16 and
 * MySQL 8.0 for such statements: a composed `DATABASE_ERROR`/500 envelope with
 * the dialect error under a non-enumerable `cause`. The real-driver pin is
 * `packages/qa/dogfood/test/raw-statement-fault-redaction.test.ts`.
 *
 * Every pin plants a synthetic sentinel and asserts it is ABSENT. Controls:
 * the class and the codes survive, a statement the predicate already
 * recognised is cut exactly as before, and an error that is not a driver dump
 * leaves as the same reference.
 */

import { describe, it, expect } from 'vitest';
import { inspect, types as utilTypes } from 'node:util';
import { isMissingTableError, looksLikeInternalErrorLeak, mapDataError } from '@objectstack/types';
import { ObjectQL } from './engine.js';
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { redactPropagatedDriverFault } from './driver-fault-redaction.js';
import { LifecycleService, type LifecycleObjectLike } from './lifecycle/lifecycle-service.js';

/** The caller's value. Synthetic; asserted ABSENT from every carrier. */
const S = 'SENTINEL-21345-BOUND-VALUE';

// ── The measured driver shapes ──────────────────────────────────────────────

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

/**
 * `driver-sql`'s raw terminal, as it raised every shape below: a composed
 * message with no statement and no separator, the declared code and status,
 * and the dialect error under a NON-enumerable `cause`.
 */
function rawStatementEnvelope(cause: Error): Error {
  const envelope = Object.assign(
    new Error(
      'The database refused to run a raw statement. The driver could not attribute the failure ' +
        'to any part of the request, so no verdict about the statement is claimed here.',
    ),
    { code: 'DATABASE_ERROR', status: 500 },
  );
  Object.defineProperty(envelope, 'cause', { value: cause, enumerable: false, writable: true, configurable: true });
  return envelope;
}

interface RawShape {
  readonly id: string;
  readonly cause: () => Error;
  /** The database's own words, as they must survive on the cut `cause`. */
  readonly diagnostic: string;
}

/** Statements opening with a verb the shared predicate does not list. */
const UNLISTED: readonly RawShape[] = [
  {
    id: 'sqlite, common-table-expression form, diagnostic matching no phrasing',
    cause: () => new SqliteError(
      `with probe(v) as (select '${S}') select nosuch_fn(v) from probe - no such function: nosuch_fn`,
      'SQLITE_ERROR',
    ),
    diagnostic: 'no such function: nosuch_fn',
  },
  {
    id: 'sqlite, dialect upsert verb, diagnostic matching no phrasing',
    cause: () => new SqliteError(
      `replace into \`probe_t\` (\`zzz\`) values ('${S}') - table probe_t has no column named zzz`,
      'SQLITE_ERROR',
    ),
    diagnostic: 'table probe_t has no column named zzz',
  },
  {
    id: 'pg, common-table-expression form, value in the diagnostic',
    cause: () => new DatabaseError(
      `with probe(v) as (select $1::int) select v from probe - invalid input syntax for type integer: "${S}"`,
      { code: '22P02' },
    ),
    diagnostic: 'invalid input syntax for type integer: [value redacted]',
  },
  {
    id: 'pg, dialect merge verb, value in the diagnostic',
    cause: () => new DatabaseError(
      'merge into probe_t t using (select $1::int as v) s on false when not matched then insert (id) values (s.v)' +
        ` - invalid input syntax for type integer: "${S}"`,
      { code: '22P02' },
    ),
    diagnostic: 'invalid input syntax for type integer: [value redacted]',
  },
  {
    id: 'mysql, common-table-expression form, diagnostic matching no phrasing',
    cause: () => mysqlError(
      `with probe(v) as (select '${S}') select nosuch_fn(v) from probe`,
      'FUNCTION probe_db.nosuch_fn does not exist',
      { code: 'ER_SP_DOES_NOT_EXIST', errno: 1305, sqlState: '42000' },
    ),
    diagnostic: 'FUNCTION probe_db.nosuch_fn does not exist',
  },
  {
    id: 'mysql, dialect upsert verb, value in the diagnostic',
    cause: () => mysqlError(
      `replace into \`probe_t\` (\`id\`) values ('${S}')`,
      `Incorrect integer value: '${S}' for column 'id' at row 1`,
      { code: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', errno: 1366, sqlState: 'HY000' },
    ),
    diagnostic: "Incorrect integer value: [value redacted] for column 'id' at row 1",
  },
];

/** The control: the same doors with a statement opening with a listed verb. */
const LISTED: readonly RawShape[] = [
  {
    id: 'sqlite, listed verb',
    cause: () => new SqliteError(`select nosuch_fn('${S}') - no such function: nosuch_fn`, 'SQLITE_ERROR'),
    diagnostic: 'no such function: nosuch_fn',
  },
  {
    id: 'pg, listed verb',
    cause: () => new DatabaseError(`select $1::int - invalid input syntax for type integer: "${S}"`, { code: '22P02' }),
    diagnostic: 'invalid input syntax for type integer: [value redacted]',
  },
  {
    id: 'mysql, listed verb',
    cause: () => mysqlError(`select nosuch_fn('${S}')`, 'FUNCTION probe_db.nosuch_fn does not exist', {
      code: 'ER_SP_DOES_NOT_EXIST', errno: 1305, sqlState: '42000',
    }),
    diagnostic: 'FUNCTION probe_db.nosuch_fn does not exist',
  },
];

const BRANCHED_ON = ['name', 'code', 'errno', 'sqlState', 'severity', 'routine', 'status'] as const;

// ── Instruments ──────────────────────────────────────────────────────────────

/** Every path, from `root`, at which the sentinel is reachable through OWN properties. */
function sentinelCarriers(value: unknown, path = 'error', seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return value.includes(S) ? [path] : [];
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
    hits.push(...sentinelCarriers(v, `${path}.${String(key)}`, seen));
  }
  return hits;
}

/** What a logger can print of an error: inspected (default and hidden fields), `String()` and JSON. */
function renderingsCarrying(error: unknown): string[] {
  let json = '';
  try {
    json = JSON.stringify(error) ?? '';
  } catch {
    json = '';
  }
  const renderings: Record<string, string> = {
    inspect: inspect(error),
    inspectHidden: inspect(error, { depth: 8, showHidden: true }),
    string: String(error),
    json,
  };
  return Object.entries(renderings).filter(([, text]) => text.includes(S)).map(([carrier]) => carrier);
}

function expectNoSentinel(error: unknown): void {
  expect(sentinelCarriers(error)).toEqual([]);
  expect(renderingsCarrying(error)).toEqual([]);
}

function restAnswer(error: unknown): { status: number; code: unknown; field: unknown } {
  const mapped = mapDataError(error, 'probe');
  return { status: mapped.status, code: mapped.body.code, field: mapped.body.field };
}

// ── Position 1: the helper, per measured raw-path shape ──────────────────────

describe('[#21345] position 1 — a raw statement the predicate does not recognise is cut by construction', () => {
  for (const shape of UNLISTED) {
    describe(shape.id, () => {
      it('the raw fault carries the value on its cause, and the predicate does not recognise it (non-vacuity)', () => {
        const raw = rawStatementEnvelope(shape.cause());
        expect(sentinelCarriers(raw)).toEqual(expect.arrayContaining(['error.cause.message', 'error.cause.stack']));
        expect(looksLikeInternalErrorLeak((raw.cause as Error).message)).toBe(false);
      });

      it('no carrier of the propagated fault holds the value', () => {
        expectNoSentinel(redactPropagatedDriverFault(rawStatementEnvelope(shape.cause()), { statementSent: true }));
      });

      it('keeps the envelope, its non-enumerable cause, the class, the codes and the diagnostic', () => {
        const rawCause = shape.cause() as Error & Record<string, unknown>;
        const raw = rawStatementEnvelope(rawCause) as Error & Record<string, unknown>;
        const out = redactPropagatedDriverFault(raw, { statementSent: true }) as Error & Record<string, unknown>;
        expect(utilTypes.isNativeError(out)).toBe(true);
        expect(out.message).toBe(raw.message);
        expect(out.code).toBe('DATABASE_ERROR');
        expect(out.status).toBe(500);
        expect(Object.getOwnPropertyDescriptor(out, 'cause')?.enumerable).toBe(false);
        const cause = out.cause as Error & Record<string, unknown>;
        expect(Object.getPrototypeOf(cause)).toBe(Object.getPrototypeOf(rawCause));
        for (const key of BRANCHED_ON) expect(cause[key], key).toBe(rawCause[key]);
        expect(cause.message).toContain(shape.diagnostic);
        expect(cause.message.startsWith('[statement and bound values redacted] - ')).toBe(true);
      });

      it('answers the REST door and the missing-table classifier exactly as the raw fault does', () => {
        const raw = rawStatementEnvelope(shape.cause());
        const out = redactPropagatedDriverFault(raw, { statementSent: true });
        expect(restAnswer(out)).toEqual(restAnswer(raw));
        expect(isMissingTableError(out, 'probe_t')).toBe(isMissingTableError(raw, 'probe_t'));
      });

      it('is idempotent: a second pass returns the same reference', () => {
        const once = redactPropagatedDriverFault(rawStatementEnvelope(shape.cause()), { statementSent: true });
        expect(redactPropagatedDriverFault(once, { statementSent: true })).toBe(once);
        expect(redactPropagatedDriverFault(once)).toBe(once);
      });
    });
  }

  describe('control — a statement the predicate already recognised is cut exactly as before', () => {
    for (const shape of LISTED) {
      it(shape.id, () => {
        const raw = rawStatementEnvelope(shape.cause());
        const before = redactPropagatedDriverFault(raw) as Error;
        const after = redactPropagatedDriverFault(raw, { statementSent: true }) as Error;
        expectNoSentinel(before);
        const [b, a] = [before.cause as Error & Record<string, unknown>, after.cause as Error & Record<string, unknown>];
        expect(a.message).toBe(b.message);
        expect(a.stack).toBe(b.stack);
        expect(a.sql).toBe(b.sql);
        expect(a.sqlMessage).toBe(b.sqlMessage);
        expect(a.message).toContain(shape.diagnostic);
      });
    }
  });

  it('control — an error that is not a driver dump leaves as the same reference', () => {
    const plain = new Error('Selected driver does not implement execute()');
    const declared = Object.assign(new Error('The database refused to run a raw statement.'), { code: 'DATABASE_ERROR', status: 500 });
    for (const error of [plain, declared, 'a string', null, undefined]) {
      expect(redactPropagatedDriverFault(error, { statementSent: true })).toBe(error);
    }
  });
});

// ── Position 1: the door ─────────────────────────────────────────────────────

function capturingLogger() {
  const lines: Array<{ level: string; text: string }> = [];
  const push = (level: string) => (msg: unknown, meta?: unknown) =>
    void lines.push({ level, text: `${String(msg)} ${inspect(meta, { depth: 8, showHidden: true })}` });
  const logger: any = {
    lines,
    trace() {}, fatal() {},
    debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'),
    child() { return logger; },
  };
  return logger;
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => { throw new Error('expected the door to refuse'); },
    (e: unknown) => e,
  );
}

async function executeAgainst(cause: () => Error) {
  const logger = capturingLogger();
  const engine = new ObjectQL({ logger });
  const state: { raw?: Error } = {};
  engine.registerDriver({
    name: 'raw', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async find() { return []; }, async findOne() { return null; }, async count() { return 0; },
    async create() { return {}; }, async update() { return {}; }, async delete() { return true; },
    async execute() {
      state.raw = rawStatementEnvelope(cause());
      throw state.raw;
    },
    async syncSchema() {}, async initObjects() {},
  } as any, true);
  await engine.init();
  const error = await caught(engine.execute('a raw statement', { args: [S] }));
  return { error, raw: state.raw, logger };
}

describe('[#21345] position 1 — ObjectQL.execute leaves no value on any carrier', () => {
  for (const shape of UNLISTED) {
    it(shape.id, async () => {
      const { error, raw, logger } = await executeAgainst(shape.cause);
      expect(raw, 'the driver was reached').toBeDefined();
      expect(sentinelCarriers(raw).length, 'the raw fault carried the value').toBeGreaterThan(0);
      expectNoSentinel(error);
      expect(logger.lines.filter((l: { text: string }) => l.text.includes(S))).toEqual([]);
      const out = error as Error & Record<string, unknown>;
      expect(out.code).toBe('DATABASE_ERROR');
      expect(out.status).toBe(500);
      expect((out.cause as Error & { code?: unknown }).code).toBe((raw!.cause as Error & { code?: unknown }).code);
      expect((out.cause as Error).message).toContain(shape.diagnostic);
    });
  }

  for (const shape of LISTED) {
    it(`control — ${shape.id}: the door's answer equals the #21274 cut`, async () => {
      const { error, raw } = await executeAgainst(shape.cause);
      expectNoSentinel(error);
      const expected = redactPropagatedDriverFault(raw) as Error;
      expect((error as Error).message).toBe(expected.message);
      expect(((error as Error).cause as Error).message).toBe((expected.cause as Error).message);
    });
  }
});

// ── Position 2: the lifecycle sweep ──────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;
const AUDIT_OBJ: LifecycleObjectLike = {
  name: 'sys_audit_log',
  lifecycle: {
    class: 'audit',
    retention: { maxAge: '90d' },
    archive: { after: '90d', to: 'archive', keep: '7y' },
  } as any,
};
const ROW = { id: 'a', created_at: '2020-01-01T00:00:00.000Z', payload: S };

/** Write faults a cold upsert or a hot bulk delete raises, the row's value inlined by the driver. */
const COLD_WRITE_FAULTS: readonly RawShape[] = [
  {
    id: 'sqlite unique violation on the cold upsert',
    cause: () => new SqliteError(
      "insert into `sys_audit_log` (`created_at`, `id`, `payload`) values ('2020-01-01T00:00:00.000Z', 'a', " +
        `'${S}') on conflict (\`id\`) do update set \`payload\` = excluded.\`payload\` - UNIQUE constraint failed: sys_audit_log.payload`,
      'SQLITE_CONSTRAINT_UNIQUE',
    ),
    diagnostic: 'UNIQUE constraint failed: sys_audit_log.payload',
  },
  {
    id: 'pg invalid input on the cold upsert (value in the diagnostic)',
    cause: () => new DatabaseError(
      'insert into "sys_audit_log" ("created_at", "id", "payload") values ($1, $2, $3) on conflict ("id") do update set "payload" = excluded."payload"' +
        ` - invalid input syntax for type integer: "${S}"`,
      { code: '22P02' },
    ),
    diagnostic: 'invalid input syntax for type integer: [value redacted]',
  },
  {
    id: 'mysql duplicate entry on the cold upsert (value in the diagnostic)',
    cause: () => mysqlError(
      "insert into `sys_audit_log` (`created_at`, `id`, `payload`) values ('2020-01-01 00:00:00.000', 'a', " +
        `'${S}') on duplicate key update \`payload\` = values(\`payload\`)`,
      `Duplicate entry '${S}' for key 'sys_audit_log.uq_payload'`,
      { code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000' },
    ),
    diagnostic: "Duplicate entry [value redacted] for key 'sys_audit_log.uq_payload'",
  },
];

function sweepWith(fault: { upsert?: () => Error; bulkDelete?: () => Error }) {
  const warnings: string[] = [];
  const raised: Error[] = [];
  const hotDeleted: unknown[] = [];
  const raise = (make: () => Error) => {
    const e = make();
    raised.push(e);
    throw e;
  };
  const cold = {
    name: 'archive',
    async syncSchema() {},
    async find() { return []; },
    async upsert(_object: string, row: Record<string, unknown>) {
      if (fault.upsert) raise(fault.upsert);
      return row;
    },
    async bulkDelete() {},
    async deleteMany() { return 0; },
  };
  const hot = {
    name: 'default',
    async find() { return [ROW]; },
    async upsert() { return {}; },
    async bulkDelete(_object: string, ids: unknown[]) {
      if (fault.bulkDelete) raise(fault.bulkDelete);
      hotDeleted.push(...ids);
    },
    async deleteMany() { return 0; },
  };
  const engine: any = {
    registry: { getAllObjects: () => [AUDIT_OBJ] },
    async delete(_object: string, options?: Record<string, unknown>) {
      assertEngineDeleteDispatch(options);
      return { deletedCount: 0 };
    },
    getDriverForObject: () => hot,
    datasource: (name: string) => (name === 'archive' ? cold : undefined),
  };
  const service = new LifecycleService({
    getEngine: () => engine,
    logger: { info: () => {}, debug: () => {}, warn: (msg: string) => void warnings.push(String(msg)) },
    now: () => FIXED_NOW,
    initialDelayMs: 1,
    sweepIntervalMs: 10,
  });
  return { run: () => service.sweep(), warnings, raised, hotDeleted };
}

describe('[#21345] position 2 — a direct-driver fault in the Archiver reaches neither the sweep log nor its report', () => {
  for (const shape of COLD_WRITE_FAULTS) {
    it(`cold write — ${shape.id}`, async () => {
      const sweep = sweepWith({ upsert: shape.cause });
      const report = await sweep.run();
      expect(sweep.raised).toHaveLength(1);
      expect(sweep.raised[0].message.includes(S), 'the raw fault carried the value').toBe(true);

      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].object).toBe('sys_audit_log');
      expect(report.errors[0].error.includes(S)).toBe(false);
      expect(report.errors[0].error).toContain(shape.diagnostic);

      const lines = sweep.warnings.filter((w) => w.includes('sweep of sys_audit_log failed'));
      expect(lines).toHaveLength(1);
      expect(sweep.warnings.filter((w) => w.includes(S))).toEqual([]);
      expect(lines[0]).toContain(shape.diagnostic);

      // The Archiver's own safety rule is unchanged: nothing the cold store
      // did not take is deleted hot.
      expect(sweep.hotDeleted).toEqual([]);
    });
  }

  it('hot delete — a sqlite fault on the bulk delete of the copied rows', async () => {
    const sweep = sweepWith({
      bulkDelete: () => new SqliteError(
        `delete from \`sys_audit_log\` where \`id\` in ('${S}') - SQLITE_BUSY: database is locked`,
        'SQLITE_BUSY',
      ),
    });
    const report = await sweep.run();
    expect(sweep.raised[0].message.includes(S), 'the raw fault carried the value').toBe(true);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].error.includes(S)).toBe(false);
    expect(report.errors[0].error).toContain('SQLITE_BUSY: database is locked');
    expect(sweep.warnings.filter((w) => w.includes(S))).toEqual([]);
  });

  it('control — a fault that is not a driver dump is reported and logged exactly as before', async () => {
    const message = 'archive datasource refused the write: quota reached';
    const sweep = sweepWith({ upsert: () => new Error(message) });
    const report = await sweep.run();
    expect(report.errors).toEqual([{ object: 'sys_audit_log', error: message }]);
    expect(sweep.warnings).toContain(`[lifecycle] sweep of sys_audit_log failed (${message})`);
  });
});
