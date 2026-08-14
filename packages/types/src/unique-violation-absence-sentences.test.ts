// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8590] `isUniqueViolationError` vs the sentences that say a unique
 * constraint is **ABSENT** — the superstring class, pinned per dialect.
 *
 * # The defect this file closes
 *
 * The predicate's message limb was a bare `unique constraint`. A word pair is
 * not a condition: every dialect that can say "this row violated a unique
 * constraint" can also say "there is no unique constraint here", and the same
 * two words sit adjacent in both. So the predicate answered `true` for errors
 * meaning the exact opposite of what it claims to detect — and 409
 * `UNIQUE_VIOLATION` is what `rest-server.ts` maps that verdict to, telling a
 * client to change a value when nothing was ever compared.
 *
 * # Everything below was raised on a live server, never transcribed
 *
 * Same rule as `unbacked-conflict-target.test.ts`: a fixture nobody observed a
 * server emit is not evidence. Measured for #8590 on:
 *
 *  - **SQLite** via better-sqlite3, knex 3.3.0
 *  - **PostgreSQL 16.13** via `pg` 8.22.0, knex 3.3.0
 *  - **MariaDB 10.11.14** via `mysql2` 3.23.1, knex 3.3.0 — the MySQL-wire
 *    family the `Duplicate entry` / `ER_DUP_ENTRY` / errno 1062 vocabulary was
 *    written for, and the dialect #8590's triage required measuring before the
 *    limb was narrowed.
 *
 * Each dialect was driven through BOTH conditions — a unique index that exists
 * and was violated, and a unique constraint that is absent — plus the
 * NOT NULL / FOREIGN KEY near misses that share the wording.
 *
 * # ⚠️ Postgres was NOT clean either — the finding that chose the fix
 *
 * #8590 was filed reading the collision as SQLite-only, with Postgres escaping
 * "by luck of word order" because its ON CONFLICT sentence says `unique or
 * exclusion constraint` (not adjacent). Sweeping the dialects for the fix found
 * {@link PG_FK_ABSENCE}: PostgreSQL 42830, raised when a FOREIGN KEY references
 * a non-unique column, puts the pair **adjacent** in its own absence sentence.
 *
 * That is what decided the fix's shape. The card offered two candidates:
 *
 *  1. a negative lookahead on SQLite's missing-index sentence, and
 *  2. requiring a violation phrasing.
 *
 * Both close the SQLite case; only (2) closes 42830, because (1) is a blocklist
 * and can only enumerate absence sentences somebody already tripped over. The
 * limb is now an allowlist of violation phrasings, which restores the module's
 * own stated default — **unrecognised is `false`** — to the message channel.
 *
 * The suites below pin both halves: absence sentences stay `false`, and every
 * measured violation spelling stays `true`, because a narrowing that also drops
 * a real conflict would trade this bug for a worse one.
 */

import { describe, expect, it } from 'vitest';
import { isUniqueViolationError, uniqueViolationColumn } from './unique-violation.js';

/**
 * PostgreSQL 42830. Raised by `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`
 * and by an inline `REFERENCES` at CREATE TABLE, both measured. The words
 * `unique constraint` are adjacent, and the sentence says there is none.
 */
const PG_FK_ABSENCE = 'there is no unique constraint matching given keys for referenced table "xa_parent"';

/**
 * The measured ABSENCE sentences: a unique constraint is missing, nothing
 * collided, and no client should ever be told to change a value for these.
 *
 * `knexPrefixed` is what a caller actually catches — knex builds the message as
 * STATEMENT + ` - ` + the server's sentence — and `bare` is the server's
 * sentence alone. Both are pinned, or the verdict would depend on how many
 * layers the error passed through.
 */
const ABSENCE = [
    {
        label: 'sqlite: ON CONFLICT target with no backing unique index',
        bare: 'ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint',
        knexPrefixed:
            'insert into `xtalk_plain` (`email`, `id`, `req`, `title`) values ' +
            "('a@b.com', '1', 'r', 'x') on conflict (`email`) do update set " +
            '`title` = excluded.`title` - ON CONFLICT clause does not match any ' +
            'PRIMARY KEY or UNIQUE constraint',
    },
    {
        label: 'postgres: ON CONFLICT target with no backing unique index',
        bare: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
        knexPrefixed:
            'insert into "xtalk_plain" ("email", "id", "req", "title") values ($1, $2, $3, $4) ' +
            'on conflict ("email") do update set "title" = excluded."title" - there is no unique ' +
            'or exclusion constraint matching the ON CONFLICT specification',
    },
    {
        label: 'postgres 42830: FOREIGN KEY referencing a non-unique column',
        bare: PG_FK_ABSENCE,
        knexPrefixed:
            'alter table xa_child add constraint fk_pe foreign key (parent_email) references ' +
            `xa_parent(email) - ${PG_FK_ABSENCE}`,
    },
    {
        label: 'postgres 42830: the same absence, inline REFERENCES at CREATE TABLE',
        bare: PG_FK_ABSENCE,
        knexPrefixed:
            'create table xa_child2 (id text primary key, pe text references xa_parent(email)) - ' +
            PG_FK_ABSENCE,
    },
] as const;

/**
 * The measured VIOLATION spellings — an index EXISTS and a row broke it. Every
 * one of these was `true` before #8590 and must stay `true` after it: the limb
 * was narrowed, and the whole risk of narrowing is dropping a real conflict.
 *
 * `column` is what {@link uniqueViolationColumn} may resolve, `undefined` where
 * the dialect names an index rather than a column (#6544's contract).
 */
const VIOLATIONS = [
    {
        label: 'sqlite: UNIQUE constraint failed, names the column',
        bare: 'UNIQUE constraint failed: xtalk_uniq.email',
        knexPrefixed:
            'insert into `xtalk_uniq` (`email`, `id`, `title`) values ' +
            "('a@b.com', '2', 'y') - UNIQUE constraint failed: xtalk_uniq.email",
        column: 'email',
    },
    {
        label: 'sqlite: the same on a PRIMARY KEY',
        bare: 'UNIQUE constraint failed: xtalk_uniq.id',
        knexPrefixed:
            'insert into `xtalk_uniq` (`email`, `id`, `title`) values ' +
            "('other@b.com', '1', 'q') - UNIQUE constraint failed: xtalk_uniq.id",
        column: 'id',
    },
    {
        label: 'postgres: duplicate key value violates unique constraint',
        bare: 'duplicate key value violates unique constraint "xtalk_uniq_email_unique"',
        knexPrefixed:
            'insert into "xtalk_uniq" ("email", "id", "title") values ($1, $2, $3) - ' +
            'duplicate key value violates unique constraint "xtalk_uniq_email_unique"',
        column: undefined,
    },
    {
        label: 'mysql: Duplicate entry for a unique key',
        bare: "Duplicate entry 'a@b.com' for key 'xtalk_uniq_email_unique'",
        knexPrefixed:
            'insert into `xtalk_uniq` (`email`, `id`, `title`) values ' +
            "('a@b.com', '2', 'y') - Duplicate entry 'a@b.com' for key 'xtalk_uniq_email_unique'",
        column: undefined,
    },
    {
        label: 'mysql: the same on a PRIMARY KEY',
        bare: "Duplicate entry '1' for key 'PRIMARY'",
        knexPrefixed:
            'insert into `xtalk_uniq` (`email`, `id`, `title`) values ' +
            "('other@b.com', '1', 'q') - Duplicate entry '1' for key 'PRIMARY'",
        column: undefined,
    },
] as const;

/**
 * The near misses. Every one shares vocabulary with a positive above — SQLite's
 * `constraint failed`, Postgres' `violates ... constraint` — which is exactly
 * why the limb may not key on either half alone.
 */
const NEAR_MISSES = [
    ['sqlite NOT NULL', 'NOT NULL constraint failed: xtalk_plain.req'],
    ['sqlite FOREIGN KEY', 'foreign key mismatch - "xa_child" referencing "xa_parent"'],
    ['postgres not-null', 'null value in column "req" of relation "xtalk_plain" violates not-null constraint'],
    ['postgres foreign key', 'insert or update on table "xa_child" violates foreign key constraint "fk_pe"'],
    ['mysql not-null', "Column 'req' cannot be null"],
    [
        'mysql foreign key',
        "Can't create table `os8590`.`xa_child` (errno: 150 \"Foreign key constraint is incorrectly formed\")",
    ],
] as const;

describe('[#8590] an ABSENT unique constraint is never a unique violation', () => {
    for (const sentence of ABSENCE) {
        it(`${sentence.label} — bare server sentence`, () => {
            expect(isUniqueViolationError(new Error(sentence.bare))).toBe(false);
        });

        it(`${sentence.label} — knex-prefixed`, () => {
            expect(isUniqueViolationError(new Error(sentence.knexPrefixed))).toBe(false);
        });

        it(`${sentence.label} — as a plain string`, () => {
            expect(isUniqueViolationError(sentence.bare)).toBe(false);
        });

        /**
         * The column extractor is gated on the predicate, so a `false` verdict
         * must take the column answer with it. A caller that got `email` here
         * would render "a record with this email already exists" for a table
         * that has no unique index on `email` at all.
         */
        it(`${sentence.label} — names no conflicting column either`, () => {
            expect(uniqueViolationColumn(new Error(sentence.knexPrefixed))).toBeUndefined();
        });
    }

    /**
     * The discriminator, stated as a test rather than only in prose: this is
     * the sentence a negative lookahead on SQLite's wording would still claim.
     * It is the reason the limb is an allowlist of violation phrasings.
     */
    it('postgres 42830 is the case that rules out a lookahead on SQLite’s sentence', () => {
        expect(PG_FK_ABSENCE).toMatch(/unique constraint/i);
        expect(PG_FK_ABSENCE).not.toMatch(/PRIMARY KEY or/i);
        expect(isUniqueViolationError(new Error(PG_FK_ABSENCE))).toBe(false);
    });
});

describe('[#8590] every measured violation spelling still answers true', () => {
    for (const violation of VIOLATIONS) {
        it(`${violation.label} — bare server sentence`, () => {
            expect(isUniqueViolationError(new Error(violation.bare))).toBe(true);
        });

        it(`${violation.label} — knex-prefixed`, () => {
            expect(isUniqueViolationError(new Error(violation.knexPrefixed))).toBe(true);
        });

        it(`${violation.label} — as a plain string`, () => {
            expect(isUniqueViolationError(violation.bare)).toBe(true);
        });

        it(`${violation.label} — the column answer is unchanged`, () => {
            expect(uniqueViolationColumn(new Error(violation.knexPrefixed))).toBe(violation.column);
        });
    }

    /**
     * Ruling on #8590: the narrowing had to keep BOTH dialects' genuine
     * spellings, because the limb it replaced was inherited verbatim from the
     * REST branch and covered both. Asserted as one statement so a future
     * narrowing that keeps only one of them cannot pass.
     */
    it('keeps both spellings the retired `unique constraint` limb covered', () => {
        expect(isUniqueViolationError('UNIQUE constraint failed: sys_user.email')).toBe(true);
        expect(
            isUniqueViolationError('duplicate key value violates unique constraint "sys_user_email_key"'),
        ).toBe(true);
    });
});

describe('[#8590] the near misses that share the vocabulary', () => {
    for (const [label, message] of NEAR_MISSES) {
        it(`${label} is not a unique violation`, () => {
            expect(isUniqueViolationError(new Error(message))).toBe(false);
        });
    }
});

describe('[#8590] the code and errno channels are untouched by the narrowing', () => {
    /**
     * The narrowing was to the MESSAGE channel only. These are the channels a
     * driver sets when it has a real conflict, and a message-limb change must
     * not have moved them — measured `code` / `errno` values, message
     * deliberately uninformative so only the channel under test can answer.
     */
    const CHANNELS: Array<[string, Record<string, unknown>]> = [
        ['postgres SQLSTATE 23505', { code: '23505' }],
        ['mysql ER_DUP_ENTRY', { code: 'ER_DUP_ENTRY' }],
        ['mysql errno 1062', { errno: 1062 }],
        ['mysql numeric code 1062', { code: 1062 }],
        ['sqlite SQLITE_CONSTRAINT_UNIQUE', { code: 'SQLITE_CONSTRAINT_UNIQUE' }],
    ];

    for (const [label, channel] of CHANNELS) {
        it(`${label} still answers true on the code channel alone`, () => {
            expect(isUniqueViolationError(Object.assign(new Error('insert failed'), channel))).toBe(true);
        });
    }

    /**
     * ⚠️ The absence sentences carry codes too, and those codes are NOT in the
     * vocabulary — SQLite answers the generic `SQLITE_ERROR` and Postgres
     * answers 42830 / 42P10 (`invalid_column_reference`). Pinned because a
     * later "let's also read the code" change is exactly how the message-side
     * fix would be undone from the other channel.
     */
    it('does not claim an absence sentence through its code channel', () => {
        expect(
            isUniqueViolationError(Object.assign(new Error(ABSENCE[0].bare), { code: 'SQLITE_ERROR' })),
        ).toBe(false);
        expect(
            isUniqueViolationError(Object.assign(new Error(ABSENCE[1].bare), { code: '42P10' })),
        ).toBe(false);
        expect(
            isUniqueViolationError(Object.assign(new Error(PG_FK_ABSENCE), { code: '42830' })),
        ).toBe(false);
    });
});

describe('[#8590] the driver refusal that wraps the raw error as `cause`', () => {
    /**
     * `SqlDriver.upsert` recognises the unbacked target and throws a refusal
     * that keeps the raw driver error as its own `cause` — and this predicate
     * walks `cause`. So before #8590 the refusal ITSELF answered `true` here,
     * one step down, even though its own message says the index is missing.
     *
     * Nothing user-visible depended on that: the refusal declares
     * `status: 400`, and `rest-server.ts` reads `declaredHttpStatus` before it
     * reaches the unique-violation branch, so the 400 wins. That gate is the
     * only thing that stood between this and a 409 on the wire, which is why
     * the verdict is pinned here rather than left to it.
     */
    const refusal = () =>
        Object.assign(
            new Error(
                'Cannot upsert into "crm_contact_plain" on conflict keys ("email"): no PRIMARY KEY or ' +
                    'UNIQUE index backs them, so the merge target does not exist and the database refuses ' +
                    'the statement.',
            ),
            { code: 'VALIDATION_ERROR', status: 400, cause: new Error(ABSENCE[0].knexPrefixed) },
        );

    it('is not a unique violation, and neither is the cause it carries', () => {
        expect(isUniqueViolationError(refusal())).toBe(false);
    });

    it('its own prose is not a unique violation either', () => {
        expect(isUniqueViolationError(refusal().message)).toBe(false);
    });

    /**
     * The other direction, unchanged: a refusal wrapping a REAL conflict is
     * still recognised through the same `cause` walk. The walk was never the
     * defect — the vocabulary it applied was.
     */
    it('still reaches a real conflict one step down the cause chain', () => {
        const wrapped = Object.assign(new Error('Write failed'), {
            cause: new Error('duplicate key value violates unique constraint "sys_user_email_key"'),
        });
        expect(isUniqueViolationError(wrapped)).toBe(true);
    });
});
