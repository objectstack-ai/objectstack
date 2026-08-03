// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4728 / #4825 — the classifications that decide whether a driver failure may
 * be silenced.
 *
 * Both directions are pinned deliberately, for both predicates. A test suite
 * that only proves the benign case is recognised would pass just as happily on
 * `() => true`, which is exactly the bug being fixed (one benign reason excusing
 * every reason).
 */

import { describe, it, expect } from 'vitest';
import { isMissingTableError, isSchemaAlreadyExistsError } from './schema-sync-errors.js';

describe('isSchemaAlreadyExistsError', () => {
    describe('benign — the table/column is already provisioned', () => {
        it('recognises the SQLite message (code is the undifferentiated SQLITE_ERROR)', () => {
            const err = Object.assign(new Error('table sys_metadata already exists'), {
                code: 'SQLITE_ERROR',
            });
            expect(isSchemaAlreadyExistsError(err)).toBe(true);
        });

        it('recognises the SQLite duplicate-column message', () => {
            const err = Object.assign(new Error('duplicate column name: environment_id'), {
                code: 'SQLITE_ERROR',
            });
            expect(isSchemaAlreadyExistsError(err)).toBe(true);
        });

        it('recognises PostgreSQL duplicate_table by SQLSTATE', () => {
            const err = Object.assign(new Error('relation "sys_metadata" already exists'), {
                code: '42P07',
            });
            expect(isSchemaAlreadyExistsError(err)).toBe(true);
        });

        it('recognises PostgreSQL duplicate_column by SQLSTATE even with an opaque message', () => {
            const err = Object.assign(new Error('db error'), { code: '42701' });
            expect(isSchemaAlreadyExistsError(err)).toBe(true);
        });

        it('recognises MySQL ER_TABLE_EXISTS_ERROR by code and by errno', () => {
            expect(
                isSchemaAlreadyExistsError(
                    Object.assign(new Error("Table 'sys_metadata' already exists"), {
                        code: 'ER_TABLE_EXISTS_ERROR',
                    }),
                ),
            ).toBe(true);
            expect(
                isSchemaAlreadyExistsError(Object.assign(new Error('opaque'), { errno: 1050 })),
            ).toBe(true);
        });

        it('follows an error wrapped as `cause`', () => {
            const inner = Object.assign(new Error('relation "sys_metadata" already exists'), {
                code: '42P07',
            });
            const outer = Object.assign(new Error('syncSchema failed'), { cause: inner });
            expect(isSchemaAlreadyExistsError(outer)).toBe(true);
        });

        it('accepts a bare thrown string', () => {
            expect(isSchemaAlreadyExistsError('table sys_metadata already exists')).toBe(true);
        });
    });

    describe('NOT benign — the table/column does not exist', () => {
        it('rejects insufficient privileges', () => {
            const err = Object.assign(new Error('permission denied for schema public'), {
                code: '42501',
            });
            expect(isSchemaAlreadyExistsError(err)).toBe(false);
        });

        it('rejects a datasource that never connected', () => {
            const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
                code: 'ECONNREFUSED',
                errno: -111,
            });
            expect(isSchemaAlreadyExistsError(err)).toBe(false);
        });

        it('rejects an incompatible column type', () => {
            const err = Object.assign(
                new Error('column "metadata" cannot be cast automatically to type jsonb'),
                { code: '42804' },
            );
            expect(isSchemaAlreadyExistsError(err)).toBe(false);
        });

        it('rejects a read-only / disk-full driver failure', () => {
            const err = Object.assign(new Error('attempt to write a readonly database'), {
                code: 'SQLITE_READONLY',
            });
            expect(isSchemaAlreadyExistsError(err)).toBe(false);
        });

        it('rejects values that carry no signal at all', () => {
            expect(isSchemaAlreadyExistsError(undefined)).toBe(false);
            expect(isSchemaAlreadyExistsError(null)).toBe(false);
            expect(isSchemaAlreadyExistsError(new Error(''))).toBe(false);
            expect(isSchemaAlreadyExistsError({})).toBe(false);
            expect(isSchemaAlreadyExistsError(42)).toBe(false);
        });

        it('does not follow a cause chain forever', () => {
            // Deeply nested benign cause beyond the cap is treated as NOT benign —
            // erring toward loud, never toward silent.
            let err: Error = new Error('table x already exists');
            for (let i = 0; i < 8; i++) {
                err = Object.assign(new Error(`wrap ${i}`), { cause: err });
            }
            expect(isSchemaAlreadyExistsError(err)).toBe(false);
        });
    });
});

/**
 * #4825 — the READ-side counterpart. `nextEventSeq()` may only answer "1" when
 * the table genuinely has no rows to collide with; every other read failure has
 * to stay loud, because the rows are still there and were merely not seen.
 */
describe('isMissingTableError', () => {
    describe('benign — the table has not been provisioned yet', () => {
        it('recognises the SQLite message (code is the undifferentiated SQLITE_ERROR)', () => {
            const err = Object.assign(new Error('no such table: sys_metadata_history'), {
                code: 'SQLITE_ERROR',
            });
            expect(isMissingTableError(err)).toBe(true);
        });

        it('recognises PostgreSQL undefined_table by SQLSTATE, even with an opaque message', () => {
            expect(isMissingTableError(Object.assign(new Error('db error'), { code: '42P01' }))).toBe(
                true,
            );
        });

        it('recognises the PostgreSQL undefined_table message', () => {
            const err = new Error('relation "sys_metadata_history" does not exist');
            expect(isMissingTableError(err)).toBe(true);
        });

        it('recognises MySQL ER_NO_SUCH_TABLE by code, by errno and by message', () => {
            expect(
                isMissingTableError(
                    Object.assign(new Error('opaque'), { code: 'ER_NO_SUCH_TABLE' }),
                ),
            ).toBe(true);
            expect(isMissingTableError(Object.assign(new Error('opaque'), { errno: 1146 }))).toBe(
                true,
            );
            expect(
                isMissingTableError(new Error("Table 'app.sys_metadata_history' doesn't exist")),
            ).toBe(true);
        });

        it('follows an error wrapped as `cause`', () => {
            const inner = Object.assign(new Error('no such table: sys_metadata_history'), {
                code: 'SQLITE_ERROR',
            });
            const outer = Object.assign(new Error('find failed'), { cause: inner });
            expect(isMissingTableError(outer)).toBe(true);
        });

        it('accepts a bare thrown string', () => {
            expect(isMissingTableError('no such table: sys_metadata_history')).toBe(true);
        });
    });

    describe('NOT benign — the rows may exist and simply were not read', () => {
        it('rejects a dropped connection', () => {
            const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
            expect(isMissingTableError(err)).toBe(false);
        });

        it('rejects a statement timeout', () => {
            const err = Object.assign(new Error('canceling statement due to statement timeout'), {
                code: '57014',
            });
            expect(isMissingTableError(err)).toBe(false);
        });

        it('rejects insufficient privileges on an EXISTING table', () => {
            const err = Object.assign(
                new Error('permission denied for table sys_metadata_history'),
                { code: '42501' },
            );
            expect(isMissingTableError(err)).toBe(false);
        });

        it('rejects a locked/busy database', () => {
            const err = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
            expect(isMissingTableError(err)).toBe(false);
        });

        /**
         * The reason the message test demands the word table/relation instead of
         * a bare "does not exist". Each of these is a REAL failure against a
         * table that may be full of rows — classifying any of them benign would
         * restart numbering at 1 and collide.
         */
        it('rejects other "does not exist" objects — role, database, column', () => {
            expect(
                isMissingTableError(
                    Object.assign(new Error('role "app_rw" does not exist'), { code: '42704' }),
                ),
            ).toBe(false);
            expect(
                isMissingTableError(
                    Object.assign(new Error('database "objectstack" does not exist'), {
                        code: '3D000',
                    }),
                ),
            ).toBe(false);
            expect(
                isMissingTableError(
                    Object.assign(new Error('column "event_seq" does not exist'), { code: '42703' }),
                ),
            ).toBe(false);
        });

        it('rejects values that carry no signal at all', () => {
            expect(isMissingTableError(undefined)).toBe(false);
            expect(isMissingTableError(null)).toBe(false);
            expect(isMissingTableError(new Error(''))).toBe(false);
            expect(isMissingTableError({})).toBe(false);
            expect(isMissingTableError(42)).toBe(false);
        });

        it('does not follow a cause chain forever', () => {
            let err: Error = new Error('no such table: sys_metadata_history');
            for (let i = 0; i < 8; i++) {
                err = Object.assign(new Error(`wrap ${i}`), { cause: err });
            }
            expect(isMissingTableError(err)).toBe(false);
        });
    });
});

/**
 * The two predicates share one matcher but must never collapse into each
 * other's negation: both ask "is this THE one benign reason?", and an error
 * neither recognises has to be loud under both.
 */
describe('the two classifications are independent, not complementary', () => {
    it('an "already exists" DDL error is not a missing-table read error', () => {
        const err = Object.assign(new Error('table sys_metadata_history already exists'), {
            code: '42P07',
        });
        expect(isSchemaAlreadyExistsError(err)).toBe(true);
        expect(isMissingTableError(err)).toBe(false);
    });

    it('a missing-table read error is not a benign DDL error', () => {
        const err = Object.assign(new Error('no such table: sys_metadata_history'), {
            code: '42P01',
        });
        expect(isMissingTableError(err)).toBe(true);
        expect(isSchemaAlreadyExistsError(err)).toBe(false);
    });

    it('an unrecognised failure is benign under NEITHER — the default is loud', () => {
        const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
        expect(isSchemaAlreadyExistsError(err)).toBe(false);
        expect(isMissingTableError(err)).toBe(false);
    });
});
