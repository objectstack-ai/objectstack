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

// #8823 — the tail is kept because it names IDENTIFIERS, and on MySQL's
// duplicate-entry family it does not: `ER_DUP_ENTRY` prints the conflicting
// VALUE in the diagnostic itself. These cases pin both halves of the remedy —
// the value goes, the index name stays — because a fix that blanked the tail
// would trade away exactly the debuggability #8682 paid for.
//
// ⛔ Not a demonstrated deployment leak: no live MySQL server was measured.
// The inputs are this repo's own recorded mysql2 phrasings
// (`packages/types/src/unique-violation.ts`) in knex's documented shape.
describe('#8823 — a caller value inlined in the diagnostic itself', () => {
  const EMAIL = 'acme@example.com';
  const BOUND_DUP_ENTRY =
    'insert into `crm_account` (`email`, `name`) values '
    + `('${EMAIL}', 'Acme')`
    + ` - Duplicate entry '${EMAIL}' for key 'crm_account.email'`;

  it('drops the conflicting value and keeps the index the operator needs', () => {
    const out = redactStatementFromMessage(BOUND_DUP_ENTRY);

    expect(out).not.toContain(EMAIL);
    // The index name is the answer to "which constraint?" and survives whole.
    expect(out).toContain("for key 'crm_account.email'");
    // Still legibly MySQL's own diagnostic, not a blanked tail.
    expect(out).toContain('Duplicate entry');
    expect(out).toBe(
      "Duplicate entry [value redacted] for key 'crm_account.email' [statement and bound values redacted]",
    );
  });

  it('redacts a BARE diagnostic too — the shape that reaches us without a statement', () => {
    // Before #9030 the shared leak predicate did not recognise this phrasing,
    // so a bare `Duplicate entry …` was turned away at the door and kept its
    // value. That limb landed for a different reason; the two compose here.
    const out = redactStatementFromMessage(`Duplicate entry '${EMAIL}' for key 'crm_account.email'`);

    expect(out).not.toContain(EMAIL);
    expect(out).toBe("Duplicate entry [value redacted] for key 'crm_account.email'");
    // No statement was present, so the entry must not claim one was removed.
    expect(out).not.toContain('[statement and bound values redacted]');
  });

  it('leaves no fragment when the value itself contained " - "', () => {
    // The statement cut takes the LAST separator, which lands INSIDE a value
    // spelled like this — measured on the shipped function, it logged
    // `Q3 plan' for key 't.label'`. The words are not reconstructed: an anchor
    // is evidence about the value, not licence to assert the template.
    const out = redactStatementFromMessage(
      "insert into `t` (`label`) values ('2026 - Q3 plan')"
      + " - Duplicate entry '2026 - Q3 plan' for key 't.label'",
    );

    expect(out).not.toContain('Q3 plan');
    expect(out).not.toContain('2026');
    expect(out).toContain("for key 't.label'");
  });

  it.each([
    ["an unescaped quote in the value", "Duplicate entry 'O'Brien' for key 't.name'", 'Brien', "for key 't.name'"],
    ['a composite key value', "Duplicate entry 'acme-x' for key 't.idx_a_b'", 'acme-x', "for key 't.idx_a_b'"],
    ['the PRIMARY key', "Duplicate entry 'r1' for key 'PRIMARY'", "'r1'", "for key 'PRIMARY'"],
    // Ambiguous: the value may itself contain the anchor. Resolving to the LAST
    // anchor discards more, which is the only direction that cannot leak.
    ['a value that mimics the anchor', "Duplicate entry 'a' for key 'b' for key 't.n'", "for key 'b'", "for key 't.n'"],
  ])('%s', (_shape, diagnostic, gone, kept) => {
    const out = redactStatementFromMessage(`insert into \`t\` (\`c\`) values ('v') - ${diagnostic}`);

    expect(out).not.toContain(gone);
    expect(out).toContain(kept);
    expect(out).toContain('[value redacted]');
  });

  it('leaves every IDENTIFIER-bearing tail exactly as it was', () => {
    // The other three dialect shapes the card measured, plus the MySQL family
    // that names a column rather than a value. Redacting these would be the
    // regression #8682's triage warned about, not a fix.
    for (const [statement, diagnostic] of [
      ["insert into `t` (`c`) values ('v')", "Unknown column 'zzz' in 'field list'"],
      ["insert into `t` (`c`) values ('v')", 'UNIQUE constraint failed: crm_account.email'],
      ['insert into "t" ("c") values (\'v\')', 'duplicate key value violates unique constraint "crm_account_email_key"'],
      ["insert into `t` (`c`) values ('v')", 'NOT NULL constraint failed: sys_team.organization_id'],
    ]) {
      const out = redactStatementFromMessage(`${statement} - ${diagnostic}`);

      expect(out).toBe(`${diagnostic} [statement and bound values redacted]`);
      expect(out).not.toContain('[value redacted]');
    }
  });

  it('does not reach into a bound value that merely looks like the template', () => {
    // The templates are read only AFTER the cut, where nothing but the
    // database's own words is left — so a caller storing this text in a column
    // cannot steer what survives.
    const out = redactStatementFromMessage(
      "insert into `t` (`note`) values ('Duplicate entry \\'x\\' for key \\'k\\'')"
      + ' - table t has no column named note',
    );

    expect(out).toBe('table t has no column named note [statement and bound values redacted]');
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

  /**
   * The one driver double in this file. #8823 needed a MySQL-shaped fault and
   * the shape is a PARAMETER rather than a second double — one fake engine per
   * file keeps the contract the double implements reviewable in one place.
   */
  const DRIFTED_COLUMN = {
    name: 'SqliteError',
    code: 'SQLITE_ERROR',
    diagnostic: (object: string) => `table ${object} has no column named secret_note`,
  };

  async function insertAgainstADriftedColumn(fault = DRIFTED_COLUMN) {
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
        const text = `${stmt} - ${fault.diagnostic(object)}`;
        const e: any = new Error(text);
        e.name = fault.name;
        e.code = fault.code;
        e.stack = `${fault.name}: ${text}\n    at Database.prepare (/x/better-sqlite3.js:1:1)`;
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

  /**
   * [#8823] The same write path, with the fault MySQL raises instead — where
   * the caller's value is in the DIAGNOSTIC and not only in the statement, so
   * the statement cut alone never reached it.
   */
  const MYSQL_DUPLICATE_ENTRY = {
    name: 'Error',
    code: 'ER_DUP_ENTRY',
    diagnostic: (object: string) => `Duplicate entry '${SECRET}' for key '${object}.secret_note'`,
  };

  it('MySQL duplicate entry — the entry survives and still names the index', async () => {
    const { line } = await insertAgainstADriftedColumn(MYSQL_DUPLICATE_ENTRY);

    expect(line).toBeDefined();
    expect(line!.level).toBe('error');
    expect(line!.meta).toEqual({ object: 'crm_account' });
    // The operator's answer to "which constraint?" is kept whole.
    expect(String(line!.err?.message)).toContain("for key 'crm_account.secret_note'");
    expect(String(line!.err?.stack)).toContain('at Database.prepare');
  });

  it('MySQL duplicate entry — neither `message` nor `stack` carries the value', async () => {
    const { line } = await insertAgainstADriftedColumn(MYSQL_DUPLICATE_ENTRY);

    for (const field of [String(line!.err?.message), String(line!.err?.stack)]) {
      expect(field).not.toContain(SECRET);
      expect(field).not.toContain(DESCRIPTION);
      expect(field).not.toContain('insert into');
    }
  });

  it('MySQL duplicate entry — the RETHROWN error is still untouched', async () => {
    // Same boundary as above: the log narrows, the caller's answer does not
    // move. `isUniqueViolationError` and `uniqueViolationColumn` read this
    // message downstream and must keep seeing the driver's own text.
    const { thrown } = await insertAgainstADriftedColumn(MYSQL_DUPLICATE_ENTRY);

    expect(String(thrown?.message)).toContain('insert into');
    expect(String(thrown?.message)).toContain(SECRET);
    expect(String(thrown?.message)).toContain('Duplicate entry');
    expect((thrown as any)?.code).toBe('ER_DUP_ENTRY');
  });
});
