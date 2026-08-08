// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * sanitizeRowError() — driver/query-builder errors embed the whole failing SQL
 * statement in `err.message`; it must never reach the importer verbatim
 * (framework#3566). Common constraint failures map to human wording.
 *
 * ## #6544 — one dialect table, driven through BOTH faces
 *
 * This site used to carry its own three-dialect regex chain: one of the four
 * private vocabularies #6250 inventoried, which between them disagreed about
 * MySQL. It now reads `@objectstack/types`' `isUniqueViolationError` /
 * `uniqueViolationColumn` pair.
 *
 * {@link DIALECT_SAMPLES} is the single corpus and every sample runs through
 * both faces in the same file:
 *
 *   face 1 — `uniqueViolationColumn` (`@objectstack/types`), the column answer;
 *   face 2 — `sanitizeRowError` (this package), the sentence the importer shows.
 *
 * A dialect that regresses on either goes red here, and teaching one face a
 * dialect without the other cannot go green. The table lives in this package
 * for the same reason #6250's does: `@objectstack/types` cannot import
 * `@objectstack/rest`, so this is the side that can see both faces at once.
 * `packages/types/src/unique-violation.test.ts` is its complement — it pins the
 * *shapes* (objects, `cause` depth, the `detail` channel) a table of flat driver
 * messages cannot express, and deliberately does not restate the vocabulary.
 *
 * The samples are message strings rather than error objects because that is
 * exactly what reaches this function: `toFailedResult` hands it `err.message`.
 */

import { describe, it, expect } from 'vitest';
import { isUniqueViolationError, uniqueViolationColumn } from '@objectstack/types';
import { sanitizeRowError } from './import-runner';

/** The wording used when the row conflicts but no column is determinable. */
const UNNAMED_CONFLICT = 'A record with this value already exists.';

/** The offending user data MySQL and Postgres interpolate into their conflict text. */
const OFFENDING_VALUE = 'acme@example.com';

interface DialectSample {
  /** Which driver family emits this text. */
  readonly dialect: 'postgres' | 'mysql' | 'sqlite';
  /** Human label — also the test name. */
  readonly label: string;
  /** The driver text exactly as it reaches `sanitizeRowError` (`err.message`). */
  readonly message: string;
  /** Is this a unique violation at all? (the shared predicate's answer) */
  readonly conflict: boolean;
  /** Face 1: the column `uniqueViolationColumn` must name, or `undefined`. */
  readonly column: string | undefined;
  /** Face 2: the exact sentence the importer must show. */
  readonly sanitized: string;
}

/**
 * The shared table.
 *
 * Positives cover each dialect in both the "names a column" and the "names an
 * index" spelling, because the ruling this implements is precisely about
 * telling those apart. Negatives are the sibling constraint failures the same
 * INSERT can raise — SQLite's are the sharp ones, since `NOT NULL constraint
 * failed:` shares its shape with the unique positive.
 */
const DIALECT_SAMPLES: readonly DialectSample[] = [
  // ------------------------------------------------------------------ SQLite
  // SQLite names `table.column` pairs — real columns, so it answers.
  {
    dialect: 'sqlite',
    label: 'UNIQUE constraint failed — knex-prefixed, names a column',
    message:
      'insert into `sys_user` (`email`, `name`, `phone_number`) values ' +
      "('a@b.com', 'zhoujunyi', '13800000000') - UNIQUE constraint failed: sys_user.phone_number",
    conflict: true,
    column: 'phone_number',
    sanitized: 'A record with this phone_number already exists.',
  },
  {
    dialect: 'sqlite',
    label: 'UNIQUE constraint failed — bare driver message',
    message: 'UNIQUE constraint failed: sys_user.email',
    conflict: true,
    column: 'email',
    sanitized: 'A record with this email already exists.',
  },
  // Composite: no single offending column, so naming the first would point the
  // form at `tenant_id` when what was typed twice is `email`.
  {
    dialect: 'sqlite',
    label: 'UNIQUE constraint failed — composite key names no single column',
    message: 'UNIQUE constraint failed: sys_user.tenant_id, sys_user.email',
    conflict: true,
    column: undefined,
    sanitized: UNNAMED_CONFLICT,
  },
  // SQLite's other spelling, for a partial or expression index. An INDEX name.
  {
    dialect: 'sqlite',
    label: 'UNIQUE constraint failed: index — an index name is not a column',
    message: "UNIQUE constraint failed: index 'idx_lower_email'",
    conflict: true,
    column: undefined,
    sanitized: UNNAMED_CONFLICT,
  },
  // Negative — shares "constraint failed:" and the `table.column` shape with
  // the positives above, and must not be swept into the conflict branch.
  {
    dialect: 'sqlite',
    label: 'NOT NULL constraint failed — a required value, not a taken one',
    message: 'insert into `sys_user` (...) values (...) - NOT NULL constraint failed: sys_user.name',
    conflict: false,
    column: undefined,
    sanitized: 'name is required.',
  },
  // Negative — the other "constraint failed" sibling.
  {
    dialect: 'sqlite',
    label: 'FOREIGN KEY constraint failed — not a unique violation',
    message: 'insert into `sys_order` (`customer_id`) values (?) - FOREIGN KEY constraint failed',
    conflict: false,
    column: undefined,
    sanitized: 'FOREIGN KEY constraint failed',
  },

  // ------------------------------------------------------------------- MySQL
  // ⚠️ The user-visible change this PR discloses. MySQL's duplicate-entry text
  // names the INDEX and never the column — including MySQL 8's table-qualified
  // `sys_user.email`, which LOOKS like `table.column` and is not one. The old
  // private regex read it as a column; the ruling says `undefined`.
  {
    dialect: 'mysql',
    label: 'ER_DUP_ENTRY — MySQL 8 `table.index`, which is NOT `table.column`',
    message:
      'insert into `sys_user` (`email`) values (?) - ' +
      `ER_DUP_ENTRY: Duplicate entry '${OFFENDING_VALUE}' for key 'sys_user.email'`,
    conflict: true,
    column: undefined,
    sanitized: UNNAMED_CONFLICT,
  },
  {
    dialect: 'mysql',
    label: 'ER_DUP_ENTRY — a named index resolves to no column',
    message: `ER_DUP_ENTRY: Duplicate entry '${OFFENDING_VALUE}' for key 'idx_email_unique'`,
    conflict: true,
    column: undefined,
    sanitized: UNNAMED_CONFLICT,
  },
  // Negative — MySQL's not-null.
  {
    dialect: 'mysql',
    label: "ER_BAD_NULL_ERROR — not-null is not a unique violation",
    message: "ER_BAD_NULL_ERROR: Column 'email' cannot be null",
    conflict: false,
    column: undefined,
    sanitized: "ER_BAD_NULL_ERROR: Column 'email' cannot be null",
  },
  // Negative — near-miss wording: it carries "constraint" AND a `KEY (...)`
  // parenthesised column list, and must still not read as unique.
  {
    dialect: 'mysql',
    label: 'ER_NO_REFERENCED_ROW_2 — foreign key text carries a `KEY (col)` list',
    message:
      'ER_NO_REFERENCED_ROW_2: Cannot add or update a child row: a foreign key constraint fails ' +
      '(`app`.`sys_order`, CONSTRAINT `fk_customer` FOREIGN KEY (`customer_id`) REFERENCES `sys_user` (`id`))',
    conflict: false,
    column: undefined,
    sanitized:
      'ER_NO_REFERENCED_ROW_2: Cannot add or update a child row: a foreign key constraint fails ' +
      '(`app`.`sys_order`, CONSTRAINT `fk_customer` FOREIGN KEY (`customer_id`) REFERENCES `sys_user` (`id`))',
  },

  // -------------------------------------------------------------- PostgreSQL
  // Only the `DETAIL:` line names columns; the constraint in the first sentence
  // is an index name.
  {
    dialect: 'postgres',
    label: 'duplicate key + DETAIL — the DETAIL line names the column',
    message:
      'insert into "sys_user" ... - duplicate key value violates unique constraint "sys_user_email_key" ' +
      `Detail: Key (email)=(${OFFENDING_VALUE}) already exists.`,
    conflict: true,
    column: 'email',
    sanitized: 'A record with this email already exists.',
  },
  {
    dialect: 'postgres',
    label: 'duplicate key + DETAIL — a quoted mixed-case column survives',
    message:
      'duplicate key value violates unique constraint "sys_user_email_key" ' +
      `Detail: Key ("emailAddress")=(${OFFENDING_VALUE}) already exists.`,
    conflict: true,
    column: 'emailAddress',
    sanitized: 'A record with this emailAddress already exists.',
  },
  // No DETAIL line: the only identifier present is the constraint (index) name.
  // Before #6544 this fell through to the SQL backstop and echoed the driver's
  // sentence — index name and all — at the importer.
  {
    dialect: 'postgres',
    label: 'duplicate key without DETAIL — only an index name is present',
    message:
      'insert into "sys_user" ("email") values ($1) - ' +
      'duplicate key value violates unique constraint "sys_user_email_key"',
    conflict: true,
    column: undefined,
    sanitized: UNNAMED_CONFLICT,
  },
  {
    dialect: 'postgres',
    label: 'duplicate key + DETAIL — composite key names no single column',
    message:
      'duplicate key value violates unique constraint "sys_user_tenant_email_key" ' +
      `Detail: Key (tenant_id, email)=(1, ${OFFENDING_VALUE}) already exists.`,
    conflict: true,
    column: undefined,
    sanitized: UNNAMED_CONFLICT,
  },
  // An expression index: `lower(email)` is not a column, and the old regex used
  // to hand back the fragment `lower(email` as if it were one.
  {
    dialect: 'postgres',
    label: 'duplicate key + DETAIL — an expression index is not a column',
    message:
      'duplicate key value violates unique constraint "idx_lower_email" ' +
      `Detail: Key (lower(email))=(${OFFENDING_VALUE}) already exists.`,
    conflict: true,
    column: undefined,
    sanitized: UNNAMED_CONFLICT,
  },
  // Negative — Postgres not-null (23502).
  {
    dialect: 'postgres',
    label: '23502 not-null — not a unique violation',
    message: 'null value in column "email" of relation "sys_user" violates not-null constraint',
    conflict: false,
    column: undefined,
    sanitized: 'null value in column "email" of relation "sys_user" violates not-null constraint',
  },
  // Negative — Postgres foreign key (23503). Its own sentence opens with the
  // word `insert`, so the SQL backstop claims it and hands back generic copy.
  // Unchanged by #6544, and pinned because it is the one negative whose
  // sentence is not its own text.
  {
    dialect: 'postgres',
    label: '23503 foreign key — not a unique violation (claimed by the SQL backstop)',
    message:
      'insert or update on table "sys_order" violates foreign key constraint "sys_order_customer_fkey"',
    conflict: false,
    column: undefined,
    sanitized: 'The database rejected this row (a value may be invalid or already in use).',
  },
];

const named = (s: DialectSample) => [`${s.dialect}: ${s.label}`, s] as const;

describe('#6544 face 1 — uniqueViolationColumn (@objectstack/types)', () => {
  it.each(DIALECT_SAMPLES.map(named))('%s', (_name, sample) => {
    expect(uniqueViolationColumn(sample.message)).toBe(sample.column);
  });

  it.each(DIALECT_SAMPLES.map(named))('is a conflict? %s', (_name, sample) => {
    expect(isUniqueViolationError(sample.message)).toBe(sample.conflict);
  });

  it('never answers with an index name, on any dialect', () => {
    const answers = DIALECT_SAMPLES.map((s) => uniqueViolationColumn(s.message)).filter(
      (c): c is string => c !== undefined,
    );
    // Every sample naming an index spells it `idx_*`, `*_key` or `sqlite_autoindex_*`.
    for (const answer of answers) {
      expect(answer).not.toMatch(/^idx_|_key$|^sqlite_autoindex/);
    }
    // …and the table really does exercise the refusal, on all three dialects.
    const refused = DIALECT_SAMPLES.filter((s) => s.conflict && s.column === undefined);
    expect(new Set(refused.map((s) => s.dialect))).toEqual(
      new Set(['mysql', 'postgres', 'sqlite']),
    );
  });
});

describe('#6544 face 2 — sanitizeRowError (the sentence the importer shows)', () => {
  it.each(DIALECT_SAMPLES.map(named))('%s', (_name, sample) => {
    expect(sanitizeRowError(sample.message)).toBe(sample.sanitized);
  });

  it('never leaks the failing SQL statement, on any sample', () => {
    for (const sample of DIALECT_SAMPLES) {
      expect(sanitizeRowError(sample.message)).not.toMatch(/insert into/i);
    }
  });

  it('a conflict with no determinable column never echoes the driver identifier', () => {
    const unnamed = DIALECT_SAMPLES.filter((s) => s.conflict && s.column === undefined);
    expect(unnamed.length).toBeGreaterThan(0);
    for (const sample of unnamed) {
      const out = sanitizeRowError(sample.message);
      expect(out).toBe(UNNAMED_CONFLICT);
      expect(out).not.toContain('idx_');
      expect(out).not.toContain('_key');
      expect(out).not.toContain(OFFENDING_VALUE);
    }
  });
});

/**
 * #6544's disclosed behaviour change, pinned on its own so it cannot be undone
 * by accident or "fixed" by someone reading it as a regression.
 *
 * MySQL's `Duplicate entry … for key '<id>'` names an INDEX. The retired regex
 * chain rendered that identifier as if it were a column, so a deployment whose
 * index is `idx_email_unique` told the user "A record with this
 * idx_email_unique already exists." and one on MySQL 8 (`for key
 * 'sys_user.email'`) got a plausible-looking `email` that is still an index
 * name that merely happens to match. Under the maintainer's ruling both are
 * `undefined`: pointing a form at a field that does not exist is worse than
 * generic copy. The cost — MySQL importers usually no longer name a column —
 * is accepted, not accidental.
 */
describe('#6544 — MySQL stops naming a column (deliberate, user-visible)', () => {
  it.each([
    ["a named index", 'idx_email_unique'],
    ["MySQL 8's table-qualified index", 'sys_user.email'],
    ["an index that happens to match no column", 'uniq_2'],
  ])('%s yields the generic sentence, not the identifier', (_label, key) => {
    const message = `ER_DUP_ENTRY: Duplicate entry '${OFFENDING_VALUE}' for key '${key}'`;

    // It is still recognised as a conflict — only the NAMING narrowed.
    expect(isUniqueViolationError(message)).toBe(true);
    expect(uniqueViolationColumn(message)).toBeUndefined();

    const out = sanitizeRowError(message);
    expect(out).toBe(UNNAMED_CONFLICT);
    expect(out).not.toContain(key.split('.').pop());
  });
});

describe('sanitizeRowError — the non-dialect behaviour', () => {
  it('never leaks a raw SQL statement even for an unrecognized reason', () => {
    const raw = 'insert into `sys_user` (`email`) values (?) - some cryptic driver failure';
    const out = sanitizeRowError(raw);
    expect(out).not.toMatch(/insert into/i);
    // salvages the trailing non-SQL reason
    expect(out).toBe('some cryptic driver failure');
  });

  it('falls back to a generic message when only SQL is present', () => {
    const raw = 'insert into `sys_user` (`email`) values (?)';
    expect(sanitizeRowError(raw)).toBe(
      'The database rejected this row (a value may be invalid or already in use).',
    );
  });

  it('passes already-friendly messages through unchanged', () => {
    expect(sanitizeRowError('User already exists. Use another email.')).toBe(
      'User already exists. Use another email.',
    );
  });

  it('a business rule from a hook is not swept into the conflict branch', () => {
    expect(sanitizeRowError('删除被阻断:该客户下仍有未结订单')).toBe(
      '删除被阻断:该客户下仍有未结订单',
    );
  });

  it('handles empty / non-string input', () => {
    expect(sanitizeRowError('')).toBe('Row failed');
    expect(sanitizeRowError(undefined)).toBe('Row failed');
    expect(sanitizeRowError(null)).toBe('Row failed');
  });
});
