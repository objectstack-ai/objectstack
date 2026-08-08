// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6250 — one dialect table, driven through BOTH faces of the unique-violation
 * verdict.
 *
 * The defect was a fork: four hand-written vocabularies answered "is this a
 * unique-constraint violation?" and no two agreed, so the REST mapping's copy
 * could miss MySQL entirely without any other copy noticing. A fix that left
 * each face with its own fixtures would have rebuilt exactly that — the next
 * dialect added to the predicate but not to the mapping (or the reverse) would
 * still ship green.
 *
 * So {@link DIALECT_SAMPLES} below is the single source, and every case runs
 * twice:
 *
 *   face 1 — `isUniqueViolationError` (`@objectstack/types`), the predicate;
 *   face 2 — `mapDataError` (this package), the wire envelope a client sees.
 *
 * A dialect that regresses on either face goes red here, and adding a dialect
 * to only one of them cannot go green.
 *
 * **This file lives in `@objectstack/rest` and not in the predicate's own
 * package** for the one reason that matters: `@objectstack/types` cannot import
 * `@objectstack/rest` (that is the dependency direction), so this is the only
 * package that can see both faces at once. `packages/types/src/unique-violation.test.ts`
 * is its complement, not a second copy — it pins the shapes a table of realistic
 * driver errors cannot express (non-object throws, `cause` depth, null-safety)
 * and deliberately does NOT restate the dialect vocabulary.
 *
 * Samples are seeded from the four implementations #6250 inventories — between
 * them they encode what the drivers we ship actually emit — plus the two
 * spellings the premise re-measurement turned up (a knex-prefixed MySQL message,
 * and a Postgres error whose only unique-violation signal is SQLSTATE on `code`).
 */

import { describe, it, expect } from 'vitest';
import { isUniqueViolationError, looksLikeInternalErrorLeak } from '@objectstack/types';
import { mapDataError } from './rest-server.js';

/**
 * The user data value MySQL embeds in its conflict message. Kept as a named
 * constant because two different assertions stand on it: it is what makes the
 * sample realistic, and it is what the 409 body must never echo.
 */
const OFFENDING_VALUE = 'acme@example.com';

/** The index name Postgres and MySQL name in their conflict text. */
const OFFENDING_INDEX = 'idx_email_unique';

interface DialectSample {
    /** Which driver family emits this text. */
    readonly dialect: 'postgres' | 'mysql' | 'sqlite';
    /** Human label — also the test name. */
    readonly label: string;
    /** Which channel carries the signal, so a regression names the channel it lost. */
    readonly channel: 'code' | 'message' | 'errno' | 'cause';
    /** Built fresh per assertion so no test can mutate another's fixture. */
    readonly build: () => unknown;
    /** Face 1: what the shared predicate must answer. */
    readonly unique: boolean;
    /** Face 2: the exact wire envelope `mapDataError` must produce. */
    readonly rest: { readonly status: number; readonly code: string };
}

/** Attach driver metadata to an `Error` the way a real driver does. */
function driverError(message: string, extra: Record<string, unknown> = {}): Error {
    return Object.assign(new Error(message), extra);
}

/**
 * The shared table.
 *
 * Positives cover each dialect in BOTH spellings the issue names — the
 * machine-readable code and the message substring — because the pre-fix mapping
 * read only the second, and only for two of the three dialects.
 *
 * Negatives are the other constraint failures each dialect can raise on the very
 * same INSERT. They matter as much as the positives: a predicate that answers
 * "unique" too often is a worse bug than the one being fixed, because 409 tells
 * an SDK not to retry and points the user at a value that is not the problem.
 * Their expected REST envelopes are the *status quo* — this change must not move
 * them.
 */
const DIALECT_SAMPLES: readonly DialectSample[] = [
    // ---------------------------------------------------------------- MySQL
    // The reported defect. Before #6250 this was `500 INTERNAL_ERROR`: the
    // message matches no limb of `looksLikeInternalErrorLeak`, so it never
    // reached the 409 branch nested inside it.
    {
        dialect: 'mysql',
        label: 'ER_DUP_ENTRY — bare driver message (the #6250 report)',
        channel: 'message',
        build: () =>
            driverError(
                `ER_DUP_ENTRY: Duplicate entry '${OFFENDING_VALUE}' for key '${OFFENDING_INDEX}'`,
                { code: 'ER_DUP_ENTRY', errno: 1062 },
            ),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    // The same conflict as knex actually re-throws it — the failing statement
    // prefixed to the driver's reason. Before #6250 this was `500
    // DATABASE_ERROR`: `insert into ` DID trip the leak heuristic, but the
    // nested substring test still did not recognise MySQL, so the conflict was
    // reported as a database fault. Same hole, second spelling.
    {
        dialect: 'mysql',
        label: 'ER_DUP_ENTRY — knex-prefixed statement + reason',
        channel: 'message',
        build: () =>
            driverError(
                'insert into `sys_user` (`email`) values (?) - ' +
                    `ER_DUP_ENTRY: Duplicate entry '${OFFENDING_VALUE}' for key '${OFFENDING_INDEX}'`,
                { code: 'ER_DUP_ENTRY', errno: 1062 },
            ),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    // `code` alone, with prose that says nothing recognisable. mysql2 sets both
    // fields; this isolates the code channel so losing it cannot hide behind
    // the message channel still passing.
    {
        dialect: 'mysql',
        label: 'ER_DUP_ENTRY — code channel only',
        channel: 'code',
        build: () => driverError('insert failed', { code: 'ER_DUP_ENTRY' }),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    // The numeric twin of the same condition, isolated the same way.
    {
        dialect: 'mysql',
        label: 'errno 1062 — numeric channel only',
        channel: 'errno',
        build: () => driverError('insert failed', { errno: 1062 }),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    // Pool/query-builder layers re-throw with the original attached.
    {
        dialect: 'mysql',
        label: 'ER_DUP_ENTRY — wrapped as `cause`',
        channel: 'cause',
        build: () =>
            driverError('Write failed', {
                cause: driverError(
                    `ER_DUP_ENTRY: Duplicate entry '${OFFENDING_VALUE}' for key '${OFFENDING_INDEX}'`,
                    { code: 'ER_DUP_ENTRY', errno: 1062 },
                ),
            }),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    // Negative: MySQL's NOT NULL. Stays the structured 400 the field-level
    // branch already produces — a required value, not a taken one.
    {
        dialect: 'mysql',
        label: 'ER_BAD_NULL_ERROR — not-null is NOT a unique violation',
        channel: 'message',
        build: () =>
            driverError("ER_BAD_NULL_ERROR: Column 'email' cannot be null", {
                code: 'ER_BAD_NULL_ERROR',
                errno: 1048,
            }),
        unique: false,
        rest: { status: 400, code: 'VALIDATION_FAILED' },
    },
    // Negative: MySQL's foreign key. Note the near-miss wording — it carries
    // both "constraint" and a quoted key name, and must still not read as unique.
    {
        dialect: 'mysql',
        label: 'ER_NO_REFERENCED_ROW_2 — foreign key is NOT a unique violation',
        channel: 'message',
        build: () =>
            driverError(
                'ER_NO_REFERENCED_ROW_2: Cannot add or update a child row: a foreign key constraint fails ' +
                    '(`app`.`sys_order`, CONSTRAINT `fk_customer` FOREIGN KEY (`customer_id`) REFERENCES `sys_user` (`id`))',
                { code: 'ER_NO_REFERENCED_ROW_2', errno: 1452 },
            ),
        unique: false,
        rest: { status: 500, code: 'DATABASE_ERROR' },
    },

    // ------------------------------------------------------------- PostgreSQL
    {
        dialect: 'postgres',
        label: 'duplicate key value violates unique constraint — message',
        channel: 'message',
        build: () =>
            driverError(
                `duplicate key value violates unique constraint "${OFFENDING_INDEX}"`,
                { code: '23505' },
            ),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    // SQLSTATE alone. Before #6250 this was `500 INTERNAL_ERROR` too — the
    // mapping read no code channel at all, so the hole was never MySQL-only.
    {
        dialect: 'postgres',
        label: 'SQLSTATE 23505 — code channel only',
        channel: 'code',
        build: () => driverError('insert failed', { code: '23505' }),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    // The `DETAIL:` line Postgres appends names the column AND the value.
    // Included because it is the shape the 409 body must not forward.
    {
        dialect: 'postgres',
        label: 'duplicate key with DETAIL naming column and value',
        channel: 'message',
        build: () =>
            driverError(
                `duplicate key value violates unique constraint "${OFFENDING_INDEX}" - ` +
                    `DETAIL: Key (email)=(${OFFENDING_VALUE}) already exists.`,
                { code: '23505' },
            ),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    // Negative: Postgres NOT NULL (23502).
    {
        dialect: 'postgres',
        label: '23502 not-null — NOT a unique violation',
        channel: 'message',
        build: () =>
            driverError(
                'null value in column "email" of relation "sys_user" violates not-null constraint',
                { code: '23502' },
            ),
        unique: false,
        rest: { status: 400, code: 'VALIDATION_FAILED' },
    },
    // Negative: Postgres foreign key (23503).
    {
        dialect: 'postgres',
        label: '23503 foreign key — NOT a unique violation',
        channel: 'message',
        build: () =>
            driverError(
                'insert or update on table "sys_order" violates foreign key constraint "sys_order_customer_fkey"',
                { code: '23503' },
            ),
        unique: false,
        rest: { status: 500, code: 'DATABASE_ERROR' },
    },

    // ------------------------------------------------------------------ SQLite
    // Already 409 before #6250 — its prose happens to contain the substring the
    // old mapping looked for. Pinned so the migration cannot narrow it.
    {
        dialect: 'sqlite',
        label: 'UNIQUE constraint failed — message',
        channel: 'message',
        build: () =>
            driverError('UNIQUE constraint failed: sys_user.email', {
                code: 'SQLITE_CONSTRAINT_UNIQUE',
            }),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    {
        dialect: 'sqlite',
        label: 'SQLITE_CONSTRAINT_UNIQUE — code channel only',
        channel: 'code',
        build: () => driverError('insert failed', { code: 'SQLITE_CONSTRAINT_UNIQUE' }),
        unique: true,
        rest: { status: 409, code: 'UNIQUE_VIOLATION' },
    },
    // Negative: SQLite NOT NULL. Shares the words "constraint failed" with the
    // positive above, which is exactly why the predicate must not key on them.
    {
        dialect: 'sqlite',
        label: 'NOT NULL constraint failed — NOT a unique violation',
        channel: 'message',
        build: () =>
            driverError('NOT NULL constraint failed: sys_user.email', {
                code: 'SQLITE_CONSTRAINT_NOTNULL',
            }),
        unique: false,
        rest: { status: 400, code: 'VALIDATION_FAILED' },
    },
    // Negative: SQLite foreign key — the other "constraint failed" sibling.
    {
        dialect: 'sqlite',
        label: 'FOREIGN KEY constraint failed — NOT a unique violation',
        channel: 'message',
        build: () =>
            driverError('FOREIGN KEY constraint failed', {
                code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
            }),
        unique: false,
        rest: { status: 500, code: 'DATABASE_ERROR' },
    },
];

/** The positives, for the assertions that only concern conflicts. */
const CONFLICTS = DIALECT_SAMPLES.filter((s) => s.unique);

describe('#6250 face 1 — the shared predicate (@objectstack/types)', () => {
    it.each(DIALECT_SAMPLES.map((s) => [`${s.dialect}/${s.channel}: ${s.label}`, s] as const))(
        '%s',
        (_name, sample) => {
            expect(isUniqueViolationError(sample.build())).toBe(sample.unique);
        },
    );

    it('covers all three dialects on both channels — the fork this predicate retires', () => {
        const covered = new Set(CONFLICTS.map((s) => `${s.dialect}:${s.channel}`));
        expect(covered).toContain('mysql:message');
        expect(covered).toContain('mysql:code');
        expect(covered).toContain('postgres:message');
        expect(covered).toContain('postgres:code');
        expect(covered).toContain('sqlite:message');
        expect(covered).toContain('sqlite:code');
    });
});

describe('#6250 face 2 — the REST wire envelope (mapDataError)', () => {
    /**
     * `code` AND `status`, never "it stopped being a 500". Asserting the status
     * alone would stay green if the conflict came back as, say, 409
     * `DELETE_RESTRICTED` — and `UNIQUE_VIOLATION` is the registered code the
     * API contract promises (`packages/spec/src/api/error-code-ledger.zod.ts`),
     * which is the whole of what a front end keys on to say "already taken".
     */
    it.each(DIALECT_SAMPLES.map((s) => [`${s.dialect}/${s.channel}: ${s.label}`, s] as const))(
        '%s',
        (_name, sample) => {
            const r = mapDataError(sample.build(), 'sys_user');
            expect(r.status).toBe(sample.rest.status);
            expect(r.body.code).toBe(sample.rest.code);
        },
    );

    it('names the requested object on a conflict, and omits it when the route had none', () => {
        const sample = CONFLICTS[0];
        expect(mapDataError(sample.build(), 'sys_user').body.object).toBe('sys_user');
        expect(mapDataError(sample.build()).body).not.toHaveProperty('object');
    });
});

/**
 * The status-code fix must not become an information-disclosure regression.
 *
 * MySQL interpolates the OFFENDING USER DATA into its conflict message
 * (`Duplicate entry 'acme@example.com' …`) and Postgres interpolates the index
 * name and, in its `DETAIL:` line, the column and the value. A 409 that
 * forwarded any of that would hand one tenant another tenant's data through an
 * error body — while the pre-#6250 500 that this replaces disclosed nothing.
 */
describe('#6250 — the 409 body echoes nothing the driver said', () => {
    it.each(CONFLICTS.map((s) => [`${s.dialect}: ${s.label}`, s] as const))(
        'withholds the driver text for %s',
        (_name, sample) => {
            const err = sample.build();
            const r = mapDataError(err, 'sys_user');
            const wire = JSON.stringify(r.body);

            expect(r.status).toBe(409);
            expect(wire).not.toContain(OFFENDING_VALUE);
            expect(wire).not.toContain(OFFENDING_INDEX);
            expect(wire).not.toContain((err as Error).message);
            // The physical column, and the SQL a knex-wrapped error carries.
            expect(wire.toLowerCase()).not.toContain('insert into');
            expect(wire.toLowerCase()).not.toContain('sys_user.email');
        },
    );

    it('says the same sentence for every dialect — the body is fixed text, not driver prose', () => {
        const bodies = new Set(
            CONFLICTS.map((s) => String(mapDataError(s.build(), 'sys_user').body.error)),
        );
        expect(bodies).toEqual(new Set(['A record with this value already exists']));
    });
});

/**
 * The leak classifier was deliberately left byte-identical (#6250's security
 * flag): the fix hoists the conflict question OUT of it rather than widening
 * its criteria, so nothing else it guards can be reclassified as safe-to-expose
 * as a side effect. These pin the two halves of that.
 */
describe('#6250 — the fix did not widen the internal-leak classifier', () => {
    it('a MySQL conflict is still not classified as a leak — it no longer has to be', () => {
        const err = driverError(
            `ER_DUP_ENTRY: Duplicate entry '${OFFENDING_VALUE}' for key '${OFFENDING_INDEX}'`,
            { code: 'ER_DUP_ENTRY', errno: 1062 },
        );
        // Unchanged: the heuristic still does not recognise this phrasing…
        expect(looksLikeInternalErrorLeak(err.message)).toBe(false);
        // …and that no longer decides whether the conflict is seen.
        expect(mapDataError(err, 'sys_user').status).toBe(409);
    });

    it('driver text that is a leak but NOT a conflict still gets the sanitised 500', () => {
        // A genuine SQL dump with no conflict in it: must stay DATABASE_ERROR,
        // and must not be swept into 409 by a predicate that says yes too often.
        const r = mapDataError(
            driverError('select * from `sys_user` where `id` = ? - SQLITE_ERROR: syntax error'),
            'sys_user',
        );
        expect(r.status).toBe(500);
        expect(r.body.code).toBe('DATABASE_ERROR');
    });

    it('a deliberate business message is untouched by the new branch', () => {
        const r = mapDataError(driverError('删除被阻断:该客户下仍有未结订单'), 'sys_user');
        expect(r.status).not.toBe(409);
    });
});
