// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8682 half B — a driver-level write fault is logged WITHOUT the caller's
// values.
//
// Measured on `origin/main` @ 3508678 with planted canaries, a single insert
// carrying one misspelled field name:
//
//   message  carries SENSITIVE-CANARY-9f3a2b   true
//   stack    carries SENSITIVE-CANARY-9f3a2b   true    ← the same statement twice
//
// `Logger.error(msg, error, meta)` serializes exactly `error.message` and
// `error.stack` (`ObjectLogger.write`, and both `@objectstack/observability`
// loggers do the same), so those two fields ARE the exposure — redacting one
// and not the other would have moved the leak rather than closed it.
//
// ⛔ What this suite must never be read as licence for: LOWERING the level or
// DROPPING the entry. Every case below that asserts a value is gone has a
// sibling asserting the line is still there, at `error`, still saying `Insert
// operation failed`, still naming the object AND the failing column the
// database itself named. "Stopped leaking" and "stopped reporting" are the two
// outcomes this file exists to tell apart — a driver fault nobody can debug is
// the tolerant-fallback direction, not the loud one.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { redactBoundStatement, redactStatementFromMessage } from './driver-fault-redaction.js';

/** The canaries the card planted, kept verbatim so a leak is unmistakable. */
const SECRET = 'SENSITIVE-CANARY-9f3a2b';
const DESCRIPTION = 'DESCRIPTION-VALUE-CANARY';

/** knex's shape: the fully bound statement, ` - `, then the database's own words. */
const BOUND_INSERT =
  'insert into `crm_account` (`description`, `name`, `zzz_secret_field`) values '
  + `('${DESCRIPTION}', 'P689 probe', '${SECRET}')`
  + ' returning * - table crm_account has no column named zzz_secret_field';

describe('redactStatementFromMessage', () => {
  it('keeps the database`s diagnostic and drops the bound statement', () => {
    const out = redactStatementFromMessage(BOUND_INSERT);

    expect(out).toContain('table crm_account has no column named zzz_secret_field');
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(DESCRIPTION);
    expect(out).not.toContain('insert into');
  });

  it('cuts at the LAST separator, so a value containing " - " leaves no fragment', () => {
    // The reason the cut is the last separator and not the first: cutting early
    // would leave the tail of the value standing in what we then log as "the
    // diagnostic".
    const out = redactStatementFromMessage(
      "insert into `t` (`label`) values ('2026 - Q3 secret plan') returning * - table t has no column named label",
    );

    expect(out).toContain('table t has no column named label');
    expect(out).not.toContain('Q3 secret plan');
  });

  it.each([
    ['postgres', 'insert into "t" ("c") values (\'boundvalue\') - column "c" of relation "t" does not exist', 'column "c" of relation "t" does not exist'],
    ['mysql via knex', "insert into `t` (`c`) values ('boundvalue') - Unknown column 'c' in 'field list'", "Unknown column 'c' in 'field list'"],
    ['update — values ride the `set` clause', "update `t` set `c` = 'boundvalue' where `id` = 'r1' - table t has no column named c", 'table t has no column named c'],
    ['delete — values ride the `where` clause', "delete from `t` where `email` = 'boundvalue@example.com' - no such column: email", 'no such column: email'],
  ])('%s', (_dialect, message, diagnostic) => {
    const out = redactStatementFromMessage(message);

    expect(out).toContain(diagnostic);
    // The bound literal, and the statement that carried it, are both gone.
    expect(out).not.toContain('boundvalue');
    expect(out).not.toMatch(/insert into|update `|delete from/);
  });

  it('leaves a driver dump that carries no statement exactly as it was', () => {
    // Nothing to cut: these are already the diagnostic, and the column they
    // name is the operator's whole answer.
    for (const message of [
      'UNIQUE constraint failed: sys_user.email',
      'NOT NULL constraint failed: sys_team.organization_id',
      'SQLITE_CONSTRAINT_NOTNULL: NOT NULL constraint failed: t.c',
    ]) {
      expect(redactStatementFromMessage(message)).toBe(message);
    }
  });

  it('leaves ordinary business and validation prose alone, dashes included', () => {
    // The verdict comes from `looksLikeInternalErrorLeak`, which is pinned from
    // both directions in `@objectstack/types`. A hook's own message is not a
    // driver dump however it is punctuated, and mangling it would replace a
    // real answer with a redaction notice.
    for (const message of [
      'name is required',
      'Order 4711 - cannot be closed while lines are open',
      "Object 'ghost' is not registered",
      '删除被阻断:该客户下仍有未结订单',
    ]) {
      expect(redactStatementFromMessage(message)).toBe(message);
    }
  });
});

describe('redactBoundStatement', () => {
  it('redacts `stack` too — the statement opened it a second time', () => {
    const original = new Error(BOUND_INSERT);
    original.name = 'SqliteError';
    original.stack = `SqliteError: ${BOUND_INSERT}\n    at Database.prepare (/x/better-sqlite3.js:1:1)\n    at create (/x/driver.js:2:2)`;

    const redacted = redactBoundStatement(original) as Error;

    expect(redacted.message).not.toContain(SECRET);
    expect(redacted.stack).not.toContain(SECRET);
    expect(redacted.stack).not.toContain(DESCRIPTION);
    // The frames survive: the redaction narrows WHAT is written, it does not
    // take the operator's stack away.
    expect(redacted.stack).toContain('at Database.prepare (/x/better-sqlite3.js:1:1)');
    expect(redacted.stack).toContain('at create (/x/driver.js:2:2)');
    expect(redacted.stack).toContain('SqliteError: table crm_account has no column named zzz_secret_field');
  });

  it('rebuilds a header that spanned several lines', () => {
    // A bound statement can contain newlines, so the header is not reliably one
    // line — which is why the frames are found rather than the message matched.
    const original = new Error("insert into `t`\n(`c`)\nvalues ('multi\nline secret') - table t has no column named c");
    original.name = 'SqliteError';
    original.stack = `SqliteError: ${original.message}\n    at only (/x/y.js:1:1)`;

    const redacted = redactBoundStatement(original) as Error;

    expect(redacted.stack).not.toContain('line secret');
    expect(redacted.stack).toBe('SqliteError: table t has no column named c [statement and bound values redacted]\n    at only (/x/y.js:1:1)');
  });

  it('returns the SAME error when there is nothing to redact', () => {
    // Identity, not equality: a validation failure, a hook's business error and
    // a bare `Error` from our own code must reach the log untouched, and the
    // cheapest proof of that is that no new object was made.
    const untouched = new Error('name is required');

    expect(redactBoundStatement(untouched)).toBe(untouched);
  });

  it('passes a non-Error through unchanged', () => {
    expect(redactBoundStatement('a thrown string')).toBe('a thrown string');
    expect(redactBoundStatement(undefined)).toBe(undefined);
  });
});

/**
 * The engine-level half: the SAME insert the card measured, but on a DECLARED
 * field whose physical column is missing — schema drift, the one shape that
 * still reaches the driver after half A's door closed the undeclared-key route.
 * This is the case the redaction exists for, and the case where the ERROR line
 * must survive intact.
 */
describe('#8682 half B — the write-path loggers', () => {
  function makeCapturingLogger() {
    const lines: Array<{ level: string; msg: string; err?: any; meta?: any }> = [];
    const logger: any = {
      lines,
      trace() {}, fatal() {},
      debug() {}, info() {},
      warn(msg: string) { lines.push({ level: 'warn', msg: String(msg) }); },
      error(msg: string, err?: any, meta?: any) { lines.push({ level: 'error', msg: String(msg), err, meta }); },
      child() { return logger; },
    };
    return logger;
  }

  async function insertAgainstADriftedColumn() {
    const logger = makeCapturingLogger();
    const engine = new ObjectQL({ logger });
    const driver: any = {
      name: 'drifted', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
      async find() { return []; },
      async findOne() { return null; },
      async create(object: string, data: Record<string, unknown>) {
        const cols = Object.keys(data).sort();
        const stmt = `insert into \`${object}\` (${cols.map((c) => `\`${c}\``).join(', ')}) values (${cols.map((c) => `'${String(data[c])}'`).join(', ')}) returning *`;
        const e: any = new Error(`${stmt} - table ${object} has no column named secret_note`);
        e.name = 'SqliteError';
        e.code = 'SQLITE_ERROR';
        e.stack = `SqliteError: ${stmt} - table ${object} has no column named secret_note\n    at Database.prepare (/x/better-sqlite3.js:1:1)`;
        throw e;
      },
      async update() { return {}; }, async updateMany() { return 0; },
      async delete() { return true; }, async deleteMany() { return 0; }, async count() { return 0; },
      async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
      async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
    };
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'crm_account',
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true, readonly: true },
        name: { name: 'name', type: 'text' },
        description: { name: 'description', type: 'text' },
        // DECLARED — and the table does not have it. The door in half A cannot
        // see this and must not: it is drift, not a caller mistake.
        secret_note: { name: 'secret_note', type: 'text' },
      },
    } as any, 'test');

    let thrown: any = null;
    try {
      await engine.insert('crm_account', {
        name: 'P689 probe', description: DESCRIPTION, secret_note: SECRET,
      } as any);
    } catch (e) { thrown = e; }
    const line = logger.lines.find((l: any) => l.msg === 'Insert operation failed');
    return { line, thrown };
  }

  it('the entry survives — same level, same message, same object', async () => {
    const { line } = await insertAgainstADriftedColumn();

    expect(line).toBeDefined();
    expect(line!.level).toBe('error');
    expect(line!.meta).toEqual({ object: 'crm_account' });
  });

  it('the failing column is still named — the fault stays debuggable', async () => {
    const { line } = await insertAgainstADriftedColumn();

    expect(String(line!.err?.message)).toContain('has no column named secret_note');
    expect(String(line!.err?.stack)).toContain('at Database.prepare');
  });

  it('neither `message` nor `stack` carries a caller value', async () => {
    const { line } = await insertAgainstADriftedColumn();

    for (const field of [String(line!.err?.message), String(line!.err?.stack)]) {
      expect(field).not.toContain(SECRET);
      expect(field).not.toContain(DESCRIPTION);
      expect(field).not.toContain('insert into');
    }
  });

  it('the RETHROWN error is untouched — the caller`s 400 must not move', async () => {
    // `mapDataError` reads the driver's raw message to extract the failing
    // field and answer `400 INVALID_FIELD`. Redacting what we THROW would break
    // that answer; the redaction is one argument at one call site.
    const { thrown } = await insertAgainstADriftedColumn();

    expect(String(thrown?.message)).toContain('insert into');
    expect(String(thrown?.message)).toContain(SECRET);
  });
});
