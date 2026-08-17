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

// #9160 — the families the LIVE probe raised, driven through the real function.
//
// ⛔ Every message below was raised off a thrown error against MySQL 8.0.46 and
// PostgreSQL 16.13 by `sql-driver-diagnostic-value-probe.test.ts`, and is copied
// here byte-for-byte with only the canary and the generated table name folded to
// readable ones. That probe is the WARRANT for each entry: nothing here comes
// from a reading of the manual, which is the standing rule
// (`packages/types/src/unique-violation.ts`). If the probe goes red because a
// server changed its phrasing, these fixtures are the stale half.
//
// The probe lives in `driver-sql` rather than here because that is the package
// the `Temporal Conformance (live PG + MySQL)` job runs against live servers,
// and because reaching this internal function from there would mean widening
// `@objectstack/objectql`'s public surface.
describe('#9160 — the value-bearing families the live probe measured', () => {
  const CANARY = 'SENSITIVE-CANARY-9160';

  describe('mysql ER_TRUNCATED_WRONG_VALUE_FOR_FIELD (1366)', () => {
    // Verbatim: "Incorrect integer value: 'SENSITIVE-CANARY-9160' for column 'age' at row 1"
    const diagnostic = `Incorrect integer value: '${CANARY}' for column 'age' at row 1`;

    it('drops the caller value and keeps the column the operator needs', () => {
      const out = redactStatementFromMessage(
        `insert into \`t\` (\`age\`) values ('${CANARY}') - ${diagnostic}`,
      );

      expect(out).not.toContain(CANARY);
      // The failing column is the answer to "which field?" and survives whole.
      expect(out).toContain("for column 'age' at row 1");
      expect(out).toContain('Incorrect integer value:');
      expect(out).toBe(
        "Incorrect integer value: [value redacted] for column 'age' at row 1"
        + ' [statement and bound values redacted]',
      );
    });

    it('handles the `decimal` and `datetime` spellings the same way', () => {
      // Both measured live; 1292 reuses this template for datetimes.
      for (const [type, column] of [['decimal', 'amount'], ['datetime', 'when_at']]) {
        const out = redactStatementFromMessage(
          `insert into \`t\` (\`${column}\`) values ('${CANARY}')`
          + ` - Incorrect ${type} value: '${CANARY}' for column '${column}' at row 1`,
        );

        expect(out).not.toContain(CANARY);
        expect(out).toContain(`for column '${column}' at row 1`);
      }
    });

    it('resolves an anchor-mimicking value to the LAST anchor', () => {
      // Measured: a value spelled `…' for column 'x' at row 1` really does print
      // two anchors. Greedy discards both — the only direction that cannot leak.
      const out = redactStatementFromMessage(
        "insert into `t` (`age`) values ('x')"
        + " - Incorrect integer value: 'CANARY' for column 'x' at row 1' for column 'age' at row 1",
      );

      expect(out).not.toContain('CANARY');
      expect(out).not.toContain("for column 'x'");
      expect(out).toContain("for column 'age' at row 1");
    });

    it('recovers when the value itself contained " - " and ate the head', () => {
      // The cut takes the LAST separator, which lands inside a value spelled
      // like this. The `for column … at row N` anchor is what recovers it.
      const out = redactStatementFromMessage(
        "insert into `t` (`age`) values ('2026 - Q3 plan')"
        + " - Incorrect integer value: '2026 - Q3 plan' for column 'age' at row 1",
      );

      expect(out).not.toContain('Q3 plan');
      expect(out).not.toContain('2026');
      expect(out).toContain("for column 'age' at row 1");
    });
  });

  describe('postgres invalid_text_representation (22P02) / invalid_datetime_format (22007)', () => {
    // ⛔ The family the #8823 note was waiting for. Postgres' UNIQUE violation is
    // saved only because its value sits on `error.detail`, which
    // `ObjectLogger.write` never serializes — "coincidence, not a defence". This
    // family puts the caller's value on `error.message`, which IS serialized, so
    // the coincidence does not cover it. Measured, not predicted.
    it('drops the caller value and keeps the type Postgres named', () => {
      const out = redactStatementFromMessage(
        `insert into "t" ("age") values ($1) - invalid input syntax for type integer: "${CANARY}"`,
      );

      expect(out).not.toContain(CANARY);
      // "which type did it fail to parse as?" is the operator's question.
      expect(out).toContain('invalid input syntax for type integer:');
      expect(out).toBe(
        'invalid input syntax for type integer: [value redacted]'
        + ' [statement and bound values redacted]',
      );
    });

    it('handles multi-word type names', () => {
      // Measured live: `timestamp with time zone`, plus numeric/boolean/uuid.
      for (const type of ['timestamp with time zone', 'numeric', 'boolean', 'uuid']) {
        const out = redactStatementFromMessage(
          `insert into "t" ("c") values ($1) - invalid input syntax for type ${type}: "${CANARY}"`,
        );

        expect(out).not.toContain(CANARY);
        expect(out).toContain(`invalid input syntax for type ${type}:`);
      }
    });

    it('leaves the VALUELESS json spelling untouched', () => {
      // Measured: `invalid input syntax for type json` carries no caller value on
      // `message` at all (its offending token is on `detail`). Redacting it would
      // delete a diagnostic that never leaked.
      const out = redactStatementFromMessage(
        `insert into "t" ("doc") values ('${CANARY}'::json) - invalid input syntax for type json`,
      );

      expect(out).toBe('invalid input syntax for type json [statement and bound values redacted]');
      expect(out).not.toContain('[value redacted]');
    });
  });

  describe('postgres numeric_value_out_of_range (22003)', () => {
    it('drops the out-of-range value and keeps the type', () => {
      // Verbatim: `value "99999999999" is out of range for type integer`.
      const out = redactStatementFromMessage(
        'insert into "t" ("age") values ($1) - value "99999999999" is out of range for type integer',
      );

      expect(out).not.toContain('99999999999');
      expect(out).toContain('is out of range for type integer');
      expect(out).toBe(
        'value [value redacted] is out of range for type integer'
        + ' [statement and bound values redacted]',
      );
    });
  });

  describe('mysql ER_TRUNCATED_WRONG_VALUE (1292), the column-less spelling', () => {
    it('drops the value that runs to end of message', () => {
      // Measured, but only raisable through a raw `cast(… as signed)` — recorded
      // as a fact about SHAPE, not a claim that a write path produces it.
      const out = redactStatementFromMessage(
        `insert into t (age) select cast('${CANARY}' as signed)`
        + ` - Truncated incorrect INTEGER value: '${CANARY}'`,
      );

      expect(out).not.toContain(CANARY);
      expect(out).toContain('Truncated incorrect INTEGER value:');
    });
  });

  it('leaves every family the probe measured as IDENTIFIER-ONLY exactly as it was', () => {
    // ⛔ The other half of the contract, and the reason the probe raises these
    // too: a zero is only readable next to a positive. Redacting any of these
    // would delete the diagnostic an operator came for — the expensive
    // direction #8682 paid to avoid. All six raised live.
    for (const diagnostic of [
      // mysql
      "Out of range value for column 'age' at row 1",              // 1264
      "Data too long for column 'label' at row 1",                 // 1406
      "Unknown column 'zzz_nonexistent_field' in 'field list'",     // 1054
      // postgres — value on `detail`, never on `message`
      'duplicate key value violates unique constraint "t_email_key"', // 23505
      'null value in column "id" of relation "t" violates not-null constraint', // 23502
      'value too long for type character varying(20)',             // 22001
      'numeric field overflow',                                    // 22003 sibling
    ]) {
      const out = redactStatementFromMessage(`insert into \`t\` (\`c\`) values ('v') - ${diagnostic}`);

      expect(out).toBe(`${diagnostic} [statement and bound values redacted]`);
      expect(out).not.toContain('[value redacted]');
    }
  });
});

describe('#9275 — a value containing " - " no longer eats the template head', () => {
  // Every string below was raised off a live server at HEAD (PostgreSQL 16.13,
  // MySQL 8.0.46, the configuration CI uses) with the canary
  // `SENSITIVE-CANARY-9275 - 2026 - Q3`, and the residue each one produced
  // BEFORE this change is quoted next to it. `sql-driver-diagnostic-value-probe`
  // raises the same shapes and asserts the server still prints them.
  const CANARY = 'SENSITIVE-CANARY-9275';
  const DASHED = `${CANARY} - 2026 - Q3`;
  /** The piece that stood in the log before the cut learned about heads. */
  const RESIDUE = 'Q3';

  describe('the head-anchored cut — families whose value runs to end of message', () => {
    it('postgres 22P02: keeps the head the operator came for, drops the value whole', () => {
      // Measured before: `Q3" [statement and bound values redacted]`.
      const out = redactStatementFromMessage(
        `insert into "t" ("age") values ($1) - invalid input syntax for type integer: "${DASHED}"`,
      );

      expect(out).not.toContain(RESIDUE);
      expect(out).not.toContain(CANARY);
      expect(out).toBe(
        'invalid input syntax for type integer: [value redacted]'
        + ' [statement and bound values redacted]',
      );
    });

    it('postgres 22007: the multi-word type name survives too', () => {
      const out = redactStatementFromMessage(
        `insert into "t" ("when_at") values ($1)`
        + ` - invalid input syntax for type timestamp with time zone: "${DASHED}"`,
      );

      expect(out).not.toContain(RESIDUE);
      expect(out).toBe(
        'invalid input syntax for type timestamp with time zone: [value redacted]'
        + ' [statement and bound values redacted]',
      );
    });

    it('mysql 1292: the column-less spelling keeps its head as well', () => {
      // Measured before: `Q3' [statement and bound values redacted]`.
      const out = redactStatementFromMessage(
        `insert into t (age) select cast('${DASHED}' as signed)`
        + ` - Truncated incorrect INTEGER value: '${DASHED}'`,
      );

      expect(out).not.toContain(RESIDUE);
      expect(out).toBe(
        'Truncated incorrect INTEGER value: [value redacted]'
        + ' [statement and bound values redacted]',
      );
    });

    it('keeps the lower-case type spellings the same server prints', () => {
      // `INTEGER`, `DOUBLE` and `time` were all raised live — the head pattern's
      // `i` flag is load-bearing, not decoration.
      for (const type of ['INTEGER', 'DOUBLE', 'time']) {
        const out = redactStatementFromMessage(
          `update t set age = label + 0 - Truncated incorrect ${type} value: '${DASHED}'`,
        );

        expect(out).not.toContain(RESIDUE);
        expect(out).toBe(
          `Truncated incorrect ${type} value: [value redacted] [statement and bound values redacted]`,
        );
      }
    });
  });

  describe('postgres 22003 — the third family, which takes the ANCHOR remedy', () => {
    // ⛔ #9160 left this row without a head-gone recovery on the reasoning that
    // an out-of-range value is a NUMBER and cannot contain ` - `. Measured
    // through the driver's own bind path, that is false: Postgres detects the
    // overflow while scanning digits, before it rejects the trailing junk, so it
    // echoes the caller's whole string.
    it('recovers the head-gone residue through its right anchor', () => {
      // Measured before: `Q3" is out of range for type integer […]`.
      const out = redactStatementFromMessage(
        'insert into "t" ("age") values ($1)'
        + ` - value "99999999999 - 2026 - ${RESIDUE}" is out of range for type integer`,
      );

      expect(out).not.toContain(RESIDUE);
      expect(out).not.toContain('99999999999');
      expect(out).toBe(
        '[value redacted] is out of range for type integer'
        + ' [statement and bound values redacted]',
      );
    });

    it('still keeps the head when the value carried no separator', () => {
      // The intact template must keep reporting `value …`, so the anchor remedy
      // does not quietly cost the head in the ordinary case.
      const out = redactStatementFromMessage(
        'insert into "t" ("age") values ($1) - value "99999999999" is out of range for type integer',
      );

      expect(out).toBe(
        'value [value redacted] is out of range for type integer'
        + ' [statement and bound values redacted]',
      );
    });
  });

  describe('the steering the amendment admits, and the bound on it', () => {
    it('resolves a value that MIMICS a head to the LAST head, leaking nothing', () => {
      // ⛔ The ordering that carries the safety argument. A hostile value spells
      // a known head inside itself; taking the FIRST head would cut before the
      // decoy and leave the real value standing behind it. Taking the LAST cuts
      // at the decoy, so no part of the value can survive.
      const out = redactStatementFromMessage(
        `insert into "t" ("age") values ('${CANARY} - invalid input syntax for type integer: "decoy')`
        + ` - invalid input syntax for type integer: "${CANARY} - invalid input syntax for type integer: "decoy"`,
      );

      expect(out).not.toContain(CANARY);
      expect(out).not.toContain('decoy');
      expect(out).toBe(
        'invalid input syntax for type integer: [value redacted]'
        + ' [statement and bound values redacted]',
      );
    });

    it('SUPPRESSES a real diagnostic when a value forges a head — over-redaction, never exposure', () => {
      // The honest cost of the amendment, asserted rather than discovered later.
      // A crafted value makes the cut land inside the STATEMENT, so the operator
      // reads the forged head instead of the `Unknown column` the server really
      // replied. What must NOT happen is any of the statement surviving — the
      // head invariant (only end-of-message templates may declare a `head`) is
      // what turns this into lost detail rather than a leak.
      const out = redactStatementFromMessage(
        "insert into `t` (`a`, `b`) values"
        + " ('x - Truncated incorrect INTEGER value: 'forged', 'SECOND-VALUE-CANARY')"
        + " - Unknown column 'zzz' in 'field list'",
      );

      expect(out).not.toContain('SECOND-VALUE-CANARY');
      expect(out).not.toContain('forged');
      expect(out).toBe(
        'Truncated incorrect INTEGER value: [value redacted]'
        + ' [statement and bound values redacted]',
      );
    });

    it('every head-bearing family swallows to END OF MESSAGE — the invariant, behaviourally', () => {
      // ⛔ The structural property the `head` field documents: a template may
      // declare a `head` only if its value runs to end of message. If one ever
      // gets a `head` while keeping a right anchor, a head-anchored cut landing
      // inside the statement would keep everything after that anchor — which is
      // statement, which is caller values. This case forges each head over a
      // statement carrying a second value and asserts nothing survives.
      for (const head of [
        'invalid input syntax for type integer: "',
        "Truncated incorrect INTEGER value: '",
      ]) {
        const out = redactStatementFromMessage(
          `insert into \`t\` (\`a\`, \`b\`) values ('x - ${head}forged', 'SECOND-VALUE-CANARY')`
          + " - Unknown column 'zzz' in 'field list'",
        );

        expect(out).not.toContain('SECOND-VALUE-CANARY');
        expect(out).not.toContain('forged');
        expect(out).not.toContain('insert into');
        expect(out).toContain('[value redacted]');
      }
    });
  });

  describe('the ordinary case is byte-identical — no head, no change', () => {
    it('cuts at the last separator when no known head stands after one', () => {
      // #8682's original answer is untouched wherever this amendment has nothing
      // to say, which is every message that carries no measured head.
      const out = redactStatementFromMessage(
        "insert into `t` (`label`) values ('2026 - Q3 secret plan')"
        + ' returning * - table t has no column named label',
      );

      expect(out).toBe('table t has no column named label [statement and bound values redacted]');
      expect(out).not.toContain('Q3 secret plan');
    });

    it('leaves the identifier-only families exactly as they were', () => {
      // The six the probe pins. Over-matching is the expensive direction, and a
      // cut that learned about heads must not have taught itself to fire here.
      for (const diagnostic of [
        "Out of range value for column 'age' at row 1",
        "Data too long for column 'label' at row 1",
        "Unknown column 'zzz_nonexistent_field' in 'field list'",
        'duplicate key value violates unique constraint "t_email_key"',
        'null value in column "id" of relation "t" violates not-null constraint',
        'value too long for type character varying(20)',
        'numeric field overflow',
      ]) {
        const out = redactStatementFromMessage(
          `insert into \`t\` (\`c\`) values ('2026 - Q3 plan') - ${diagnostic}`,
        );

        expect(out).toBe(`${diagnostic} [statement and bound values redacted]`);
        expect(out).not.toContain('[value redacted]');
        expect(out).not.toContain('Q3 plan');
      }
    });

    it('leaves the VALUELESS json spelling untouched, separator in the value or not', () => {
      // It has no `: "`, so no head matches and nothing changes — the guard that
      // keeps the amendment from redacting a diagnostic that never leaked.
      const out = redactStatementFromMessage(
        `insert into "t" ("doc") values ('2026 - Q3'::json) - invalid input syntax for type json`,
      );

      expect(out).toBe('invalid input syntax for type json [statement and bound values redacted]');
      expect(out).not.toContain('[value redacted]');
    });
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
