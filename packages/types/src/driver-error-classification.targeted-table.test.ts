// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13438 — `isMissingTableError` prefers the table a driver DECLARED it targeted
 * over the caller-supplied `readObject`.
 *
 * The residual #13324 left behind: a caller names its OBJECT, a driver compiles
 * the statement against the PHYSICAL table, and for a federated object
 * (ADR-0015, `external.remoteName`) the two differ. `crm_order` reads
 * `legacy_orders`; when that remote is genuinely absent the phrase names
 * `legacy_orders`, the caller names `crm_order`, and the repaired predicate
 * answered NOT benign for the one case the licence exists for.
 *
 * Maintainer ruling 2026-09-01 (option 2 on the card): the driver declares the
 * table it targeted on the envelope, the predicate prefers it. The pair the
 * ruling asks for is pinned here — an absent remote reads benign again, and a
 * DIFFERENT relation's error still reads not-benign (the #13324 narrowing must
 * not reopen) — with the declaration present. The driver's half (that
 * `driver-sql` really stamps `external.remoteName`, live, on each dialect) is
 * `packages/drivers/driver-sql/src/sql-driver-13438-federated-missing-remote-envelope.test.ts`.
 *
 * This file matches the callers gate's exemption glob on purpose
 * (`driver-error-classification*.test.ts`): it exercises the one-argument
 * PUBLISHED form, because the declaration changes what that form can see.
 */

import { describe, expect, it } from 'vitest';
import {
    DRIVER_TARGETED_TABLE,
    declareTargetedTable,
    isMissingTableError,
    isSchemaAlreadyExistsError,
    targetedTableOf,
} from './driver-error-classification.js';

/** The API object name the caller reads. */
const OBJECT = 'crm_order';
/** `external.remoteName` — the table the driver actually put in the statement. */
const REMOTE = 'legacy_orders';

/**
 * The envelope `driver-sql`'s `backendStatementFaultError` composes: the
 * ADR-0112 pair, a composed message that names the OBJECT and withholds the
 * physical table, the dialect error as a non-enumerable `cause`, and — when
 * `targeted` is given — the declared target.
 */
function envelope(cause: unknown, targeted?: string, object = OBJECT): Error {
    const err = Object.assign(
        new Error(`The database refused to run this query for object '${object}'.`),
        { code: 'DATABASE_ERROR', status: 500 },
    );
    Object.defineProperty(err, 'cause', { value: cause, enumerable: false, writable: true, configurable: true });
    return targeted === undefined ? err : declareTargetedTable(err, targeted);
}

/**
 * Each dialect's spelling of "the remote table is not there", carrying the name
 * the DRIVER used. The Postgres row is the schema-qualified spelling
 * `getBuilder`'s `.withSchema(remoteSchema)` produces; the MySQL row carries
 * the database qualifier the server always prints. Both fold away.
 */
const ABSENT_REMOTE: ReadonlyArray<readonly [string, unknown]> = [
    ['sqlite `no such table: X`', Object.assign(new Error(`no such table: ${REMOTE}`), { code: 'SQLITE_ERROR' })],
    ['sqlite schema-qualified `no such table: main.X`', new Error(`no such table: main.${REMOTE}`)],
    [
        'PG `relation "X" does not exist`',
        Object.assign(new Error(`relation "${REMOTE}" does not exist`), { code: '42P01' }),
    ],
    [
        'PG schema-qualified `relation "public.X" does not exist`',
        Object.assign(new Error(`relation "public.${REMOTE}" does not exist`), { code: '42P01' }),
    ],
    [
        "MySQL `Table 'db.X' doesn't exist`",
        Object.assign(new Error(`Table 'db.${REMOTE}' doesn't exist`), { code: 'ER_NO_SUCH_TABLE', errno: 1146 }),
    ],
    ['MySQL `Unknown table`', new Error(`Unknown table 'db.${REMOTE}'`)],
];

/** The same dialects naming a relation that is NEITHER the object nor the remote. */
const OTHER_RELATION: ReadonlyArray<readonly [string, unknown]> = [
    ['sqlite, a view over a dropped base', new Error('no such table: main.absent_base')],
    [
        'PG, a join target',
        Object.assign(new Error('relation "sys_other_table" does not exist'), { code: '42P01' }),
    ],
    [
        'MySQL, a sys_* table hit inside the same statement',
        Object.assign(new Error("Table 'db.sys_other_table' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' }),
    ],
];

describe('isMissingTableError — a declared targeted table beats the caller-supplied readObject (#13438)', () => {
    describe('the defect, as a control — without a declaration the #13324 comparison is loud', () => {
        it.each(ABSENT_REMOTE)('%s: object name vs remote name reads NOT benign', (_name, cause) => {
            // This is today's verdict on `origin/main`, and the reason the card
            // exists: the phrase names the remote, the caller names the object,
            // nothing at the call site knows they are the same table.
            expect(isMissingTableError(envelope(cause), OBJECT)).toBe(false);
        });
    });

    describe('benign again — the driver declared the remote it targeted', () => {
        it.each(ABSENT_REMOTE)('%s', (_name, cause) => {
            expect(isMissingTableError(envelope(cause, REMOTE), OBJECT)).toBe(true);
        });

        it('the caller still passes its own API name and never learns the mapping', () => {
            // The whole point of option 2: `crm_order` is what the four in-repo
            // call sites pass, unchanged, and it is not consulted.
            const err = envelope(new Error(`no such table: ${REMOTE}`), REMOTE);
            expect(isMissingTableError(err, OBJECT)).toBe(true);
            expect(isMissingTableError(err, 'some_other_caller_name')).toBe(true);
        });

        it('a native object declares its own name, and matches exactly as before', () => {
            const err = envelope(new Error('no such table: sys_file'), 'sys_file', 'sys_file');
            expect(isMissingTableError(err, 'sys_file')).toBe(true);
        });
    });

    describe('the #13324 narrowing does not reopen — a DIFFERENT relation is still loud', () => {
        it.each(OTHER_RELATION)('%s, declared target present', (_name, cause) => {
            expect(isMissingTableError(envelope(cause, REMOTE), OBJECT)).toBe(false);
        });

        it('the declared target is compared, the caller-supplied name is ignored', () => {
            // A phrase naming the OBJECT while the statement targeted the REMOTE
            // is about something else — without the declaration this read
            // benign, because the caller's name happened to match.
            const namesTheObject = new Error(`no such table: ${OBJECT}`);
            expect(isMissingTableError(envelope(namesTheObject), OBJECT)).toBe(true);
            expect(isMissingTableError(envelope(namesTheObject, REMOTE), OBJECT)).toBe(false);
        });

        it('narrows the one-argument form too — the declaration is evidence the caller lacked', () => {
            // Published form, no `readObject`. Pre-#13438 this was the wide
            // verdict; with a declared target the driver has said which table
            // the statement was about, and a phrase about another one is not
            // evidence for it.
            expect(isMissingTableError(envelope(new Error('no such table: main.absent_base'), REMOTE))).toBe(false);
            expect(isMissingTableError(envelope(new Error(`no such table: ${REMOTE}`), REMOTE))).toBe(true);
            // CONTROL — undeclared, the one-argument verdict is byte-for-byte
            // the pre-#13438 one.
            expect(isMissingTableError(envelope(new Error('no such table: main.absent_base')))).toBe(true);
        });
    });

    describe('the comparison folds the declared name the way it folds readObject', () => {
        it('ignores case', () => {
            expect(isMissingTableError(envelope(new Error('no such table: LEGACY_ORDERS'), REMOTE), OBJECT)).toBe(true);
        });

        it('ignores a qualifier on the declaration itself', () => {
            // A driver that declares `schema.table` is not penalised for it.
            expect(
                isMissingTableError(envelope(new Error(`no such table: ${REMOTE}`), `public.${REMOTE}`), OBJECT),
            ).toBe(true);
        });
    });

    describe('where the declaration sits in the cause chain', () => {
        it('is found below an undeclared wrapper', () => {
            // The engine wraps the driver's envelope; the driver's declaration
            // is still the one compared.
            const wrapped = Object.assign(new Error('engine: read failed'), {
                cause: envelope(new Error(`no such table: ${REMOTE}`), REMOTE),
            });
            expect(isMissingTableError(wrapped, OBJECT)).toBe(true);
        });

        it('the declaration NEAREST the dialect phrase wins', () => {
            // An outer actor re-declaring a different target is farther from
            // the statement than the driver that compiled it.
            const inner = envelope(new Error(`no such table: ${REMOTE}`), REMOTE);
            const outer = declareTargetedTable(
                Object.assign(new Error('outer wrapper'), { cause: inner }),
                'not_the_target',
            );
            expect(isMissingTableError(outer, OBJECT)).toBe(true);
        });

        it('a declared node whose phrase mismatches is NOT rescued by a matching cause', () => {
            // Same disposition #6347 and #13324 gave the exclusion: recognition
            // ends the question rather than descending.
            const err = envelope(
                Object.assign(new Error('no such table: main.absent_base'), {
                    cause: new Error(`no such table: ${REMOTE}`),
                }),
                REMOTE,
            );
            expect(isMissingTableError(err, OBJECT)).toBe(false);
        });
    });

    describe('the carrier — readable by code, invisible to serialisation', () => {
        const err = envelope(new Error(`no such table: ${REMOTE}`), REMOTE);

        it('is read back by `targetedTableOf`', () => {
            expect(targetedTableOf(err)).toBe(REMOTE);
            expect(Object.getOwnPropertySymbols(err)).toContain(DRIVER_TARGETED_TABLE);
        });

        it('never reaches `JSON.stringify`, a spread, or `Object.keys`', () => {
            expect(JSON.stringify(err)).not.toContain(REMOTE);
            expect(Object.keys(err)).toEqual(['code', 'status']);
            const spread = { ...err };
            expect(targetedTableOf(spread)).toBeNull();
            expect(Object.getOwnPropertySymbols(spread)).not.toContain(DRIVER_TARGETED_TABLE);
        });

        it('is the global-registry symbol, so a duplicated package resolves the same key', () => {
            expect(DRIVER_TARGETED_TABLE).toBe(Symbol.for('objectstack.driver.targetedTable'));
        });

        it('is non-writable and the first declaration wins', () => {
            expect(declareTargetedTable(err, 'later_guess')).toBe(err);
            expect(targetedTableOf(err)).toBe(REMOTE);
        });
    });

    describe('no declaration means "as we were", never "be loud"', () => {
        it('an empty or non-string table declares nothing', () => {
            const empty = declareTargetedTable(new Error(`no such table: ${REMOTE}`), '');
            expect(targetedTableOf(empty)).toBeNull();
            const bogus = declareTargetedTable(new Error(`no such table: ${REMOTE}`), 0 as never);
            expect(targetedTableOf(bogus)).toBeNull();
            // …and the predicate falls back to the caller's name exactly as before.
            expect(isMissingTableError(empty, REMOTE)).toBe(true);
            expect(isMissingTableError(empty, OBJECT)).toBe(false);
        });

        it('`targetedTableOf` is tolerant of bare input', () => {
            expect(targetedTableOf(null)).toBeNull();
            expect(targetedTableOf(undefined)).toBeNull();
            expect(targetedTableOf('no such table: x')).toBeNull();
            expect(targetedTableOf(42)).toBeNull();
            expect(targetedTableOf({})).toBeNull();
            expect(targetedTableOf({ [DRIVER_TARGETED_TABLE]: 7 })).toBeNull();
        });

        it('leaves the DDL predicate untouched', () => {
            // The declaration is a fact about the MISSING_TABLE channel;
            // `isSchemaAlreadyExistsError` takes no relation and must not have
            // acquired one.
            const err = declareTargetedTable(
                Object.assign(new Error('table legacy_orders already exists'), { code: 'SQLITE_ERROR' }),
                'something_else',
            );
            expect(isSchemaAlreadyExistsError(err)).toBe(true);
        });
    });
});
