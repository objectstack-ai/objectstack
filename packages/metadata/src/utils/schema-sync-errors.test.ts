// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4728 — the classification that decides whether a DDL failure may be silenced.
 *
 * Both directions are pinned deliberately. A test suite that only proves the
 * benign case is recognised would pass just as happily on `() => true`, which is
 * exactly the bug being fixed (one benign reason excusing every reason).
 */

import { describe, it, expect } from 'vitest';
import { isSchemaAlreadyExistsError } from './schema-sync-errors.js';

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
