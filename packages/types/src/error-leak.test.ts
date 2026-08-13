// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3867 — the shared internal-leak predicate.
 *
 * It was extracted from `@objectstack/rest`'s `mapDataError` so the OTHER HTTP
 * boundary (the dispatcher-plugin routes) applies the same rule. These cases
 * pin both halves of its job: catch driver/SQL dumps, and leave deliberate
 * business messages alone — the second half matters because a false positive
 * on a 4xx would replace a real answer with "Internal server error".
 */

import { describe, it, expect } from 'vitest';
import { looksLikeInternalErrorLeak, declaresServerFault, INTERNAL_ERROR_MESSAGE } from './error-leak.js';

/**
 * The eleven message shapes `service-analytics`' `read-scope-sql.ts` can refuse
 * with, verbatim in structure (identifiers substituted for readable stand-ins).
 * Shared by both describe blocks below, which is the point: they are the family
 * the heuristic cannot see and the declaration can.
 */
const READ_SCOPE_REFUSALS = [
    '[read-scope-sql] unsafe field identifier "secret policy field" — refusing to build read scope (fail-closed).',
    '[read-scope-sql] unsafe alias identifier "crm opportunity" — refusing to build read scope (fail-closed).',
    '[read-scope-sql] read scope must be a filter object (fail-closed).',
    '[read-scope-sql] "$and" requires an array (fail-closed).',
    '[read-scope-sql] unsupported top-level operator "$nor" (fail-closed).',
    '[read-scope-sql] bare array value for "restricted_region" — use { $in: [...] } (fail-closed).',
    '[read-scope-sql] "approved_by_manager" has a nested/relation value which is not supported in a read scope (fail-closed).',
    '[read-scope-sql] $in for "restricted_region" needs an array (fail-closed).',
    '[read-scope-sql] $nin for "restricted_region" needs an array (fail-closed).',
    '[read-scope-sql] $between for "deal_amount" needs [min,max] (fail-closed).',
    '[read-scope-sql] unsupported operator "$regex" on "owner_email" (fail-closed).',
];

describe('looksLikeInternalErrorLeak', () => {
    it('catches the message that motivated #3867 (raw SQL from /analytics/query)', () => {
        expect(
            looksLikeInternalErrorLeak('SELECT  FROM "sqlite_sequence" - near "FROM": syntax error'),
        ).toBe(true);
    });

    it.each([
        ['sqlite dialect code', 'SQLITE_CONSTRAINT_NOTNULL: NOT NULL constraint failed: t.c'],
        ['postgres SQLSTATE', 'error: duplicate key value violates unique constraint (SQLSTATE 23505)'],
        ['bare INSERT', 'insert into `sys_team` (`id`) values (?) - some driver detail'],
        ['bare UPDATE', 'update `sys_team` set `name` = ? - failed'],
        ['bare DELETE', 'delete from `sys_team` where `id` = ? - failed'],
        ['constraint dump', 'NOT NULL constraint failed: sys_team.organization_id'],
        ['unique violation', 'UNIQUE constraint failed: sys_user.email'],
        ['foreign key', 'FOREIGN KEY constraint failed'],
    ])('catches %s', (_label, message) => {
        expect(looksLikeInternalErrorLeak(message)).toBe(true);
    });

    it.each([
        ['a business rule thrown by a hook', '删除被阻断:该客户下仍有未结订单'],
        ['a validation message', 'name is required'],
        ['a not-found message', "Object 'ghost' is not registered"],
        ['a permission denial', '[Security] Access denied: operation on object is not permitted'],
        // Anchored deliberately: a message may MENTION a verb without being SQL.
        ['a sentence merely mentioning update', 'Cannot update this record while it is locked'],
        ['a sentence merely mentioning select', 'Please select at least one row before exporting'],
    ])('leaves %s alone', (_label, message) => {
        expect(looksLikeInternalErrorLeak(message)).toBe(false);
    });

    it('is null-safe — an error with no message is not a leak', () => {
        expect(looksLikeInternalErrorLeak(undefined)).toBe(false);
        expect(looksLikeInternalErrorLeak(null)).toBe(false);
        expect(looksLikeInternalErrorLeak('')).toBe(false);
    });

    it('exposes a replacement message that names nothing internal', () => {
        expect(INTERNAL_ERROR_MESSAGE).toBe('Internal server error');
        expect(looksLikeInternalErrorLeak(INTERNAL_ERROR_MESSAGE)).toBe(false);
    });

    /**
     * [#5811] The measurement that motivated the second predicate, kept here as a
     * pin rather than a paragraph. If someone later "helpfully" teaches the
     * heuristic to recognise `[read-scope-sql]` (direction C, explicitly
     * discouraged), this goes red and points at `declaresServerFault` instead.
     */
    it.each(READ_SCOPE_REFUSALS)('does NOT recognise a read-scope refusal: %s', (message) => {
        expect(looksLikeInternalErrorLeak(message)).toBe(false);
    });
});

/**
 * [#8132] The shipped dialects' phrasings, both directions.
 *
 * The gap this pins: the keyword set caught SQLite's `SQLITE_ERROR: no such
 * table: sys_metadata` (via the `sqlite_` limb) while the Postgres phrasing of
 * *the same condition* — `relation "sys_metadata" does not exist` — returned
 * FALSE and shipped a physical table name from every boundary that applies the
 * predicate.
 *
 * Scope is deliberately the dialects this repo actually RUNS (SQLite/libsql and
 * Postgres, via `driver-sql`), not a census of MySQL/MSSQL/Oracle spellings
 * nobody here has met — the unbounded-list trap the module note argues against.
 *
 * The negative half is the load-bearing half. A bare `includes('does not
 * exist')` would have matched "user does not exist" and started replacing
 * ordinary business answers with "Internal server error", so every phrasing is
 * anchored on the driver's own template (a QUOTED identifier, or the trailing
 * colon) and the near-miss cases below are what prove that anchor is real
 * rather than incidental.
 */
describe('looksLikeInternalErrorLeak — shipped-dialect phrasings (#8132)', () => {
    it.each([
        // Postgres 42P01. The exact string measured false on the shipping predicate.
        ['postgres missing relation', 'relation "sys_metadata" does not exist'],
        [
            'postgres missing relation wrapped in a producer sentence',
            'Failed to delete customization overlay: relation "sys_metadata" does not exist',
        ],
        // Postgres 42703, read path — no relation named, so the sub-object
        // helpers in `relation-sub-object.ts` deliberately do not see it.
        ['postgres missing column (read path)', 'column "bogus" does not exist'],
        // Postgres 42703 write path / 42704: these carry a complete missing-TABLE
        // phrase as a substring. For a LEAK verdict that overlap is harmless —
        // both spellings are a leak — which is why this predicate needs none of
        // the ordering care `matchMissingColumnOfRelation` exists to provide.
        ['postgres missing column of relation', 'column "label" of relation "sys_team" does not exist'],
        [
            'postgres missing constraint of relation',
            'constraint "uq_sys_team_name" of relation "sys_team" does not exist',
        ],
        // Postgres 42501 — names a physical table the caller never asked about.
        ['postgres permission denied for table', 'permission denied for table sys_user'],
        ['postgres permission denied for relation', 'permission denied for relation sys_user'],
        // SQLite/libsql message-only errors: the same conditions with NO
        // `SQLITE_` prefix to trip the existing limb. Measured shapes in this
        // repo — `metadata/src/utils/schema-sync-errors.ts` documents both.
        ['sqlite bare missing table', 'no such table: sys_metadata'],
        ['sqlite bare missing table with a schema prefix', 'no such table: main.sys_metadata_history'],
        ['sqlite bare missing column', 'no such column: bogus'],
    ])('catches %s', (_label, message) => {
        expect(looksLikeInternalErrorLeak(message)).toBe(true);
    });

    /**
     * ⛔ The false-positive guard. Every one of these contains the tail of a
     * phrasing above and is an ordinary message a caller is entitled to read.
     * If someone later relaxes an anchor to a bare `includes(...)`, these go red
     * — which is the whole point of writing them down.
     */
    it.each([
        ['a business message about a missing user', 'user does not exist'],
        ['a business message about a missing record', 'record does not exist'],
        ['a sentence a hook author wrote', 'The customer you selected does not exist'],
        // The quote anchor, stated as a test: unquoted prose that uses the same
        // NOUN is not a driver line. The looser `includes('relation') &&
        // includes('does not exist')` reading would match this one.
        ['prose merely using the word relation', 'This relation does not exist in the diagram'],
        ['prose merely using the word column', 'The column layout does not exist'],
        // No physical object kind, so not Postgres' ACL template.
        ['an ordinary permission refusal', 'Permission denied for this operation'],
    ])('leaves %s alone', (_label, message) => {
        expect(looksLikeInternalErrorLeak(message)).toBe(false);
    });
});

/**
 * [#5811] The declaration half. `looksLikeInternalErrorLeak` asks whether a
 * message SOUNDS internal; this asks whether the producer SAID it was a server
 * fault. The read-scope RLS refusals are the family that needs the second
 * question — they carry policy field names while sounding like ordinary prose.
 */
describe('declaresServerFault', () => {
    it('recognises the shape `read-scope-sql.ts` throws (500 + READ_SCOPE_COMPILE_FAILED)', () => {
        const err = Object.assign(
            new Error(
                '[read-scope-sql] unsafe field identifier "secret_policy_field" — refusing to build read scope (fail-closed).',
            ),
            { code: 'READ_SCOPE_COMPILE_FAILED', status: 500 },
        );
        expect(declaresServerFault(err)).toBe(true);
        // …and it is exactly the family the heuristic cannot see, which is why
        // both predicates exist.
        expect(looksLikeInternalErrorLeak(err.message)).toBe(false);
    });

    it.each(READ_SCOPE_REFUSALS)('covers every read-scope message shape: %s', (message) => {
        const err = Object.assign(new Error(message), {
            code: 'READ_SCOPE_COMPILE_FAILED',
            status: 500,
        });
        expect(declaresServerFault(err)).toBe(true);
    });

    it.each([
        ['503 with a code', 503, 'SERVICE_UNAVAILABLE'],
        ['500 with a code', 500, 'INTERNAL_ERROR'],
        ['599 with a code', 599, 'WEIRD_BUT_DECLARED'],
    ])('is true for %s', (_label, status, code) => {
        expect(declaresServerFault(Object.assign(new Error('x'), { status, code }))).toBe(true);
    });

    /**
     * ⛔ The load-bearing half. #5667 deliberately kept UNDECLARED 5xx errors
     * readable — a bare `Error` from our own code is the operator's own bug
     * report and names nothing tenant-sensitive. Widening this predicate to "any
     * 5xx" would delete that decision in one character, and these cases are what
     * makes that edit fail.
     */
    it.each([
        ['a bare Error with no envelope at all', new Error('no strategy can handle query for cube "pipeline"')],
        [
            'a 5xx status with NO code — half an envelope is not a declaration',
            Object.assign(new Error('no strategy can handle query for cube "pipeline"'), { status: 500 }),
        ],
        [
            'a 5xx status with an EMPTY code',
            Object.assign(new Error('boom'), { status: 500, code: '' }),
        ],
        [
            'a code with NO status',
            Object.assign(new Error('boom'), { code: 'READ_SCOPE_COMPILE_FAILED' }),
        ],
        [
            'a declared 4xx — the message is the caller\'s to read',
            Object.assign(new Error('Unsupported filter operator "$sortOf" on "stage".'), {
                status: 400,
                code: 'INVALID_FILTER',
            }),
        ],
        [
            'a declared 404',
            Object.assign(new Error("Cube 'ghost' not found"), { status: 404, code: 'CUBE_NOT_FOUND' }),
        ],
        [
            'a non-numeric status',
            Object.assign(new Error('boom'), { status: '500', code: 'INTERNAL_ERROR' }),
        ],
        [
            'a non-string code',
            Object.assign(new Error('boom'), { status: 500, code: 500 }),
        ],
    ])('is false for %s', (_label, err) => {
        expect(declaresServerFault(err)).toBe(false);
    });

    /**
     * Reads `status`, never `statusCode`. `status` is the channel ADR-0112
     * declares; accepting the alternate spelling would make a disclosure rule
     * depend on which one a producer happened to reach for — the consumer-side
     * leniency PD #12 removes. Pinned because "be a bit more tolerant" is the
     * single most likely well-meant edit to this function.
     */
    it('does not accept `statusCode` as a substitute for `status`', () => {
        expect(
            declaresServerFault(Object.assign(new Error('boom'), { statusCode: 500, code: 'INTERNAL_ERROR' })),
        ).toBe(false);
    });

    it('is safe on anything a `catch` can actually receive', () => {
        expect(declaresServerFault(undefined)).toBe(false);
        expect(declaresServerFault(null)).toBe(false);
        expect(declaresServerFault('a thrown string')).toBe(false);
        expect(declaresServerFault(500)).toBe(false);
        // A thrown plain object is a real shape in this repo (`throw { statusCode: 503, … }`).
        expect(declaresServerFault({ status: 500, code: 'INTERNAL_ERROR' })).toBe(true);
        expect(declaresServerFault({ statusCode: 503, message: 'Data service not available' })).toBe(false);
    });
});
