// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8567] `isUnbackedConflictTargetError` — the dialect-spanning "no unique
 * index backs this `ON CONFLICT` target" predicate, and the pin that keeps it
 * from ever becoming `isUniqueViolationError`.
 *
 * # Every recognised string here was measured, not composed
 *
 * The SQLite fixture is #8445's transcript; the Postgres fixtures are #8567's,
 * read off the thrown `DatabaseError` from a real PostgreSQL 16.13 raised
 * through knex 3.3.0 + pg 8.22.0 — the same path `SqlDriver.upsert` takes. The
 * card that filed this work ruled that transcribing a dialect's wording from
 * memory is not evidence, so a fixture nobody observed a server emit does not
 * belong in this file.
 *
 * # The disjointness suite is the reason this file exists
 *
 * A boolean predicate is cheap to test and cheap to get catastrophically
 * wrong in exactly one way: by answering the NEIGHBOURING question.
 * `isUniqueViolationError` says "a unique index exists and the row violated
 * it"; this one says "no unique index exists at all". Both fire while a caller
 * is upserting, both are about uniqueness, and knex prefixes both with the same
 * statement text — so a limb borrowed from one into the other produces a
 * confident, plausible, inverted answer.
 *
 * The pins below therefore run every measured text through BOTH predicates and
 * record both verdicts. A one-directional pin would miss the likelier drift:
 * not this predicate growing a `duplicate entry` limb, but the unique-violation
 * vocabulary growing an `ON CONFLICT` one, because that is the file people
 * extend.
 *
 * ⚠️ Running it that way is what found **#8590**: on SQLite the separation is
 * ALREADY broken in the pre-existing direction — `isUniqueViolationError`
 * claims the unbacked-target error, because SQLite's missing-index sentence
 * ends `…PRIMARY KEY or UNIQUE constraint` and that vocabulary matches the word
 * pair `unique constraint` wherever it appears. Not fixed here (it moves
 * verdicts in six packages); pinned as measured, per dialect, so the fix
 * announces itself. See the suite below.
 */

import { describe, expect, it } from 'vitest';
import { isUnbackedConflictTargetError } from './unbacked-conflict-target.js';
import { isUniqueViolationError } from './unique-violation.js';

/**
 * The condition, as each dialect that can raise it actually words it.
 *
 * `knexPrefixed` is what a caller really catches: knex builds the message as
 * STATEMENT + ` - ` + the server's sentence, so the recognised text is always a
 * tail. `bare` is the same sentence as the server alone would give it — the
 * shape a driver that does not wrap, or a caller that already unwrapped, hands
 * over. Both must be recognised, or the predicate's verdict would depend on how
 * many layers the error passed through.
 */
const UNBACKED = {
    sqlite: {
        label: 'sqlite (better-sqlite3, #8445)',
        bare: 'ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint',
        knexPrefixed:
            'insert into `crm_contact_plain` (`created_at`, `email`, `id`, `title`) values ' +
            "('2026-08-13T00:00:00.000Z', 'a@b.com', 'ib21mSZ', 'x') on conflict (`email`) do " +
            'update set `email` = excluded.`email` - ON CONFLICT clause does not match any ' +
            'PRIMARY KEY or UNIQUE constraint',
        code: 'SQLITE_ERROR',
    },
    postgres: {
        label: 'postgres 16.13 (pg 8.22.0, #8567)',
        bare: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
        knexPrefixed:
            'insert into "plain" ("email", "id", "title") values ($1, $2, $3) on conflict ' +
            '("email") do update set "title" = excluded."title" - there is no unique or ' +
            'exclusion constraint matching the ON CONFLICT specification',
        code: '42P10',
    },
} as const;

/**
 * The OPPOSITE condition, in each dialect's words — a unique index that EXISTS
 * and was violated. Sourced from `unique-violation.ts`'s own measured table.
 */
const UNIQUE_VIOLATIONS = [
    ['sqlite', 'UNIQUE constraint failed: sys_user.email'],
    ['postgres', 'duplicate key value violates unique constraint "sys_user_email_key"'],
    ['mysql', "Duplicate entry 'acme@example.com' for key 'idx_email_unique'"],
] as const;

describe('[#8567] isUnbackedConflictTargetError — the measured dialect vocabulary', () => {
    for (const dialect of Object.values(UNBACKED)) {
        it(`recognises ${dialect.label}, knex-prefixed`, () => {
            expect(isUnbackedConflictTargetError(new Error(dialect.knexPrefixed))).toBe(true);
        });

        it(`recognises ${dialect.label}, bare server sentence`, () => {
            expect(isUnbackedConflictTargetError(new Error(dialect.bare))).toBe(true);
        });

        it(`recognises ${dialect.label} as a plain string`, () => {
            expect(isUnbackedConflictTargetError(dialect.bare)).toBe(true);
        });
    }

    /**
     * The condition is the same on both dialects, so a caller must not be able
     * to tell them apart by the verdict — that is what "dialect-spanning"
     * means, and it is the property #8445 could not have.
     */
    it('answers the same on both dialects — Postgres is no longer the odd one out', () => {
        const verdicts = Object.values(UNBACKED).map((d) => isUnbackedConflictTargetError(new Error(d.knexPrefixed)));
        expect(verdicts).toEqual([true, true]);
    });
});

describe('[#8567] the `code` channel is deliberately unread — measured over-match', () => {
    /**
     * Postgres' `42P10` is `invalid_column_reference`, NOT "unbacked conflict
     * target". Both messages below were raised on the same PG 16.13 cluster
     * that produced the fixture above and carry the identical code. A predicate
     * that read `code` would answer "add a unique index" to a caller whose
     * actual mistake is an out-of-range sort position.
     */
    const OTHER_42P10 = [
        ['ORDER BY position', 'select id from plain order by 7 - ORDER BY position 7 is not in select list'],
        ['GROUP BY position', 'select id from plain group by 9 - GROUP BY position 9 is not in select list'],
    ] as const;

    for (const [label, message] of OTHER_42P10) {
        it(`does not claim a 42P10 raised by an out-of-range ${label}`, () => {
            const err = Object.assign(new Error(message), { code: '42P10', severity: 'ERROR' });
            expect(isUnbackedConflictTargetError(err)).toBe(false);
        });
    }

    /**
     * The mirror: a code alone must not carry the verdict either. If someone
     * later adds a `codes` set, this goes red — which is the intended alarm,
     * not an obstacle. The reason lives in the module head.
     */
    it('does not claim an error whose only unbacked-looking signal is `code: 42P10`', () => {
        const err = Object.assign(new Error('something else went wrong'), { code: '42P10' });
        expect(isUnbackedConflictTargetError(err)).toBe(false);
    });

    /**
     * SQLite's side of the same argument: the generic code it raises here is
     * the code it raises for a missing table, which `driver-sql`'s suite
     * already requires to come back as itself.
     */
    it('does not claim an unrelated SQLITE_ERROR', () => {
        const err = Object.assign(new Error('insert into `never_created` ... - no such table: never_created'), {
            code: 'SQLITE_ERROR',
        });
        expect(isUnbackedConflictTargetError(err)).toBe(false);
    });
});

describe('[#8567] ⚠️ separation from isUniqueViolationError — the inverse condition', () => {
    /**
     * ⚠️ This suite was written expecting clean disjointness in both
     * directions. It went RED on the first run, and the measurement won: on
     * SQLite, `isUniqueViolationError` ALREADY claims the unbacked-target
     * error. Filed as **#8590**, deliberately not fixed here — narrowing that
     * predicate moves verdicts in six consuming packages and needs its own
     * measured pass.
     *
     * The cause is a superstring collision, not a judgement call. Its message
     * limb is `/unique constraint|…/i`, and SQLite's sentence for the MISSING
     * index ends `…any PRIMARY KEY or UNIQUE constraint` — the two words sit
     * adjacent inside a sentence that says the constraint is absent. Postgres
     * escapes only on word order (`unique or exclusion constraint` is not
     * adjacent), which is the tell that a word pair is being matched rather
     * than a condition.
     *
     * So the pins below record the state as MEASURED, per dialect, rather than
     * as hoped. When #8590 lands, the SQLite row goes red and points straight
     * at itself — which is the entire reason to pin a known defect instead of
     * leaving the direction untested.
     */
    const UNIQUE_VIOLATION_VERDICT_ON_UNBACKED: Record<string, boolean> = {
        // ⚠️ THE DEFECT (#8590). Correct value is `false`; flip it when #8590 lands.
        sqlite: true,
        // Correct today, and only by luck of word order — see above.
        postgres: false,
    };

    for (const [key, dialect] of Object.entries(UNBACKED)) {
        it(`${dialect.label}: this predicate claims it, and isUniqueViolationError's verdict is pinned as measured`, () => {
            expect(isUnbackedConflictTargetError(new Error(dialect.knexPrefixed))).toBe(true);
            expect(
                isUniqueViolationError(new Error(dialect.knexPrefixed)),
                'if this changed, #8590 either landed (SQLite → false: delete the exception) or ' +
                    'regressed (Postgres → true: a new limb is matching the missing-index sentence)',
            ).toBe(UNIQUE_VIOLATION_VERDICT_ON_UNBACKED[key]);
        });
    }

    /**
     * The direction this card CAN break, and therefore the one that carries no
     * exceptions: nothing that is a real unique violation may be claimed as an
     * unbacked target. A false positive here sends an operator to create an
     * index that already exists and is doing its job, while the duplicate that
     * actually failed goes unexplained.
     */
    for (const [dialect, message] of UNIQUE_VIOLATIONS) {
        it(`${dialect}: a real unique violation is NOT an unbacked target`, () => {
            expect(isUniqueViolationError(new Error(message))).toBe(true);
            // If this flips, an operator is sent to create an index that
            // already exists and is doing its job.
            expect(isUnbackedConflictTargetError(new Error(message))).toBe(false);
        });
    }

    /**
     * The knex-prefixed unique violation is the sharpest case: its statement
     * text contains the literal words `on conflict`, so a predicate loosened to
     * match the clause rather than the server's sentence would claim it — and
     * would invert the answer on the one input where the two questions are
     * hardest to tell apart by eye.
     */
    it('does not claim a unique violation that arrived with `on conflict` in its statement text', () => {
        const message =
            'insert into `crm_contact` (`email`, `id`) values (?, ?) on conflict (`email`) do update ' +
            'set `email` = excluded.`email` - UNIQUE constraint failed: crm_contact.email';

        expect(isUniqueViolationError(new Error(message))).toBe(true);
        expect(isUnbackedConflictTargetError(new Error(message))).toBe(false);
    });
});

describe('[#8567] the `cause` chain and non-error inputs', () => {
    it('follows a wrapped driver error down the cause chain', () => {
        const raw = new Error(UNBACKED.postgres.knexPrefixed);
        const wrapped = Object.assign(new Error('upsert failed'), { cause: raw });
        expect(isUnbackedConflictTargetError(wrapped)).toBe(true);
    });

    /**
     * The driver's own refusal keeps the raw error as `cause`, so re-asking the
     * predicate about a refusal already built still answers `true`. That is the
     * correct answer — the refusal is not a different condition — and pinning it
     * documents that a second envelope pass cannot mislabel it.
     */
    it('still recognises the condition through the refusal that already enveloped it', () => {
        const refusal = Object.assign(
            new Error('Cannot upsert into "crm_contact_plain" on conflict keys ("email"): no PRIMARY KEY or UNIQUE index backs them.'),
            { code: 'VALIDATION_ERROR', status: 400, cause: new Error(UNBACKED.sqlite.knexPrefixed) },
        );
        expect(isUnbackedConflictTargetError(refusal)).toBe(true);
    });

    it('stops following the cause chain rather than recursing without bound', () => {
        const nest = (depth: number): Error => {
            let err = new Error(UNBACKED.sqlite.bare);
            for (let i = 0; i < depth; i++) err = Object.assign(new Error(`wrap ${i}`), { cause: err });
            return err;
        };
        expect(isUnbackedConflictTargetError(nest(4))).toBe(true);
        expect(isUnbackedConflictTargetError(nest(9))).toBe(false);
    });

    it('never throws on a self-referential cause', () => {
        const err = new Error('wrapped') as Error & { cause?: unknown };
        err.cause = err;
        expect(isUnbackedConflictTargetError(err)).toBe(false);
    });

    for (const value of [null, undefined, 0, 42, true, false, {}, [], new Error('boom')]) {
        it(`is false for ${JSON.stringify(value) ?? String(value)}`, () => {
            expect(isUnbackedConflictTargetError(value)).toBe(false);
        });
    }
});
