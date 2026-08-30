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

/**
 * #6347 — the phrase corpus.
 *
 * The defect this pins is a **substring** one, so it cannot be caught by
 * checking one phrase at a time: Postgres' write-path missing-COLUMN message,
 * `column "label" of relation "sys_team" does not exist`, contains a complete
 * legal missing-TABLE phrase (`relation "sys_team" does not exist`) inside it.
 * Measured on `origin/main` before the fix, straight against the signature's
 * message regex: write-path phrase => `true`, read-path phrase
 * (`column "bogus" does not exist`) => `false`. Only the second half was ever
 * pinned (see "rejects other 'does not exist' objects" above), which is why the
 * first half survived — the test suite asked about the phrasing the consumer's
 * own read path produces, and the hole is in the other one.
 *
 * So the corpus is driven as a table, both directions in one place:
 *
 *  - `LOUD` — must NEVER be judged benign. A false benign here is not a wrong
 *    log line: `DatabaseLoader.nextEventSeq` answers `return 1` on `true`, so a
 *    misjudged column error restarts `event_seq` at 1 against a history table
 *    full of rows, and the colliding insert SUCCEEDS.
 *  - `BENIGN` — must STILL be judged benign, verbatim. An exclusion is a
 *    subtraction, and the guarded surface may not shrink while it is applied.
 *
 * Reverse verification, direction predicted BEFORE running (2026-08-08):
 * deleting `MISSING_TABLE.excludes` turns the write-path / sub-object rows of
 * `LOUD` RED, while every `BENIGN` row and every read-path row stays green.
 * Measured: `8 failed | 48 passed` — the direction held, and the count came in
 * two ABOVE the six rows predicted by counting phrases, because two rows go red
 * through the code channel rather than the phrase: `42703 whose message is a
 * genuine missing-table phrase` and the `cause`-rescue case below. Both are
 * part of the same repair (a code is a fact, prose is a guess) and are recorded
 * here rather than trimmed to fit the prediction. The read-path rows are green
 * in both directions on purpose: they were never the hole, and a corpus that
 * could not tell the two apart would be reporting the wrong repair.
 */
describe('isMissingTableError — Postgres sub-object phrases are NOT missing tables (#6347)', () => {
    /** Errors that must stay LOUD — `isMissingTableError` must answer `false`. */
    const LOUD: ReadonlyArray<readonly [name: string, error: unknown]> = [
        // ── the reported hole: the write-path (INSERT/UPDATE/ALTER) phrasing ──
        [
            'PG write-path missing column, bare message',
            new Error('column "label" of relation "sys_team" does not exist'),
        ],
        [
            'PG write-path missing column, with SQLSTATE 42703',
            Object.assign(new Error('column "label" of relation "sys_team" does not exist'), {
                code: '42703',
            }),
        ],
        [
            'PG write-path missing column, thrown as a bare string',
            'column "label" of relation "sys_team" does not exist',
        ],
        [
            'PG write-path missing column, wrapped as `cause`',
            Object.assign(new Error('insert into "sys_team" failed'), {
                cause: Object.assign(
                    new Error('column "label" of relation "sys_team" does not exist'),
                    { code: '42703' },
                ),
            }),
        ],
        [
            'PG write-path missing column, single-quoted identifiers',
            new Error("column 'label' of relation 'sys_team' does not exist"),
        ],
        // ── the same shape for other sub-objects of an EXISTING relation ──
        [
            'PG missing constraint of a relation (42704)',
            Object.assign(
                new Error('constraint "uq_sys_team_name" of relation "sys_team" does not exist'),
                { code: '42704' },
            ),
        ],
        // ── the read-path phrasing: already excluded before #6347, kept pinned ──
        [
            'PG read-path missing column, bare message',
            new Error('column "bogus" does not exist'),
        ],
        [
            'PG read-path missing column, with SQLSTATE 42703',
            Object.assign(new Error('column "bogus" does not exist'), { code: '42703' }),
        ],
        // ── code-first: 42703 means not-a-table whatever the prose says ──
        [
            '42703 with an opaque message',
            Object.assign(new Error('db error'), { code: '42703' }),
        ],
        [
            '42703 whose message is a genuine missing-table phrase (code wins, loudly)',
            Object.assign(new Error('relation "sys_team" does not exist'), { code: '42703' }),
        ],
        // ── the docblock's other named neighbours, still excluded ──
        [
            'PG missing role (42704)',
            Object.assign(new Error('role "app_rw" does not exist'), { code: '42704' }),
        ],
        [
            'PG missing database (3D000)',
            Object.assign(new Error('database "objectstack" does not exist'), { code: '3D000' }),
        ],
        // ── other dialects' missing-column prose, for completeness ──
        [
            'MySQL unknown column (ER_BAD_FIELD_ERROR)',
            Object.assign(new Error("Unknown column 'label' in 'field list'"), {
                code: 'ER_BAD_FIELD_ERROR',
                errno: 1054,
            }),
        ],
        [
            'SQLite unknown column on a read',
            Object.assign(new Error('no such column: bogus'), { code: 'SQLITE_ERROR' }),
        ],
        [
            'SQLite unknown column on a write',
            Object.assign(new Error('table sys_team has no column named label'), {
                code: 'SQLITE_ERROR',
            }),
        ],
    ];

    /** Errors that must STILL be benign — the guarded surface, verbatim. */
    const BENIGN: ReadonlyArray<readonly [name: string, error: unknown]> = [
        ['SQLite / libsql message', new Error('no such table: sys_metadata_history')],
        ['SQLite message with a schema prefix', new Error('no such table: main.sys_metadata_history')],
        [
            'libsql remote, driver prefix in front of the phrase',
            new Error('SQLITE_UNKNOWN: SQLite error: no such table: sys_metadata_history'),
        ],
        ['PG message', new Error('relation "sys_metadata_history" does not exist')],
        [
            'PG SQLSTATE 42P01 with an opaque message',
            Object.assign(new Error('db error'), { code: '42P01' }),
        ],
        ['MySQL message', new Error("Table 'app.sys_metadata_history' doesn't exist")],
        [
            'MySQL ER_NO_SUCH_TABLE',
            Object.assign(new Error('opaque'), { code: 'ER_NO_SUCH_TABLE' }),
        ],
        ['MySQL errno 1146', Object.assign(new Error('opaque'), { errno: 1146 })],
        ['a bare thrown string', 'no such table: sys_metadata_history'],
        [
            'genuine missing table wrapped as `cause`',
            Object.assign(new Error('find failed'), {
                cause: Object.assign(new Error('relation "sys_metadata_history" does not exist'), {
                    code: '42P01',
                }),
            }),
        ],
    ];

    it.each(LOUD)('stays loud: %s', (_name, error) => {
        expect(isMissingTableError(error)).toBe(false);
    });

    it.each(BENIGN)('still benign: %s', (_name, error) => {
        expect(isMissingTableError(error)).toBe(true);
    });

    it('does not let a sub-object phrase be rescued by a missing-table `cause`', () => {
        // Recognising "a column of an existing relation" ENDS the question: the
        // exclusion returns false without descending. The alternative — keep
        // walking and let a nested 42P01 win — would put the corrupting verdict
        // back one level down, reachable by any driver that wraps.
        const err = Object.assign(
            new Error('column "label" of relation "sys_team" does not exist'),
            {
                code: '42703',
                cause: Object.assign(new Error('relation "sys_team" does not exist'), {
                    code: '42P01',
                }),
            },
        );
        expect(isMissingTableError(err)).toBe(false);
    });

    it('leaves the DDL predicate alone — `already exists` on a column still matches', () => {
        // The exclusion is scoped to MISSING_TABLE. `ALREADY_EXISTS` documents
        // that Postgres' own `column "x" of relation "y" already exists` matches
        // its test, and it is genuinely benign there: the column IS provisioned.
        const err = Object.assign(
            new Error('column "environment_id" of relation "sys_metadata" already exists'),
            { code: '42701' },
        );
        expect(isSchemaAlreadyExistsError(err)).toBe(true);
        expect(isMissingTableError(err)).toBe(false);
    });
});

describe('isMissingTableError — the phrase must name the table that was READ (#13324)', () => {
    /**
     * The measured defect. Reading a VIEW whose base table is gone fails with a
     * phrase that answers the shape test perfectly and names something else.
     *
     * Both spellings libsql produces are pinned: the wrapper's `SQLITE_ERROR: `
     * prefix and the bare `cause` message underneath it, since the predicate
     * walks the `cause` chain and must reach the same verdict at either node.
     */
    const VIEW_OVER_MISSING_BASE = 'no such table: main.table_that_does_not_exist';

    it('answers NOT benign for a view whose base table is missing', () => {
        // Measured against a real libsql file database: `CREATE VIEW
        // sys_metadata AS SELECT … FROM table_that_does_not_exist`, then
        // `SELECT * FROM sys_metadata`. `sys_metadata` exists and may be backed
        // by rows; the licence "there are no rows" is false about it.
        const err = Object.assign(new Error(`SQLITE_ERROR: ${VIEW_OVER_MISSING_BASE}`), {
            code: 'SQLITE_ERROR',
            cause: Object.assign(new Error(VIEW_OVER_MISSING_BASE), { code: 'SQLITE_ERROR' }),
        });
        expect(isMissingTableError(err, 'sys_metadata')).toBe(false);
    });

    it('is the ONLY thing that separates the view case from a genuine miss', () => {
        // ⛔ The two are byte-identical in shape, measured on libsql — a view
        // over `absent_base`, and a genuine missing table the caller qualified.
        // Any repair that reads only the phrase must answer both the same way,
        // which is why the read's name is a parameter and not a regex.
        const viewFault = new Error('no such table: main.absent_base');
        const genuineMiss = new Error('no such table: main.orders');
        expect(viewFault.message.replace('absent_base', 'orders')).toBe(genuineMiss.message);

        expect(isMissingTableError(viewFault, 'orders')).toBe(false);
        expect(isMissingTableError(genuineMiss, 'orders')).toBe(true);
    });

    /**
     * ⛔ Fence: every shape recognised today for a GENUINE missing table must
     * still be recognised. A suite that silently lost a true positive is the
     * failure mode this repair is most likely to cause, so each limb of the
     * signature is pinned with the read named.
     */
    const TRUE_POSITIVES: ReadonlyArray<readonly [string, unknown, string]> = [
        ['sqlite `no such table: X`', new Error('no such table: sys_metadata_history'), 'sys_metadata_history'],
        [
            'sqlite schema-qualified `no such table: main.X`',
            new Error('no such table: main.sys_metadata_history'),
            'sys_metadata_history',
        ],
        [
            'PG `relation "x" does not exist`',
            Object.assign(new Error('relation "sys_metadata_history" does not exist'), { code: '42P01' }),
            'sys_metadata_history',
        ],
        [
            'MySQL `table "x" doesn\'t exist`',
            new Error("Table 'app.sys_metadata_history' doesn't exist"),
            'sys_metadata_history',
        ],
        ['MySQL `unknown table`', new Error("Unknown table 'app.sys_metadata_history'"), 'sys_metadata_history'],
        [
            'the SQLSTATE limb, message carrying no name at all',
            Object.assign(new Error('db error'), { code: '42P01' }),
            'sys_metadata_history',
        ],
        [
            'the mysql2 symbolic-code limb',
            Object.assign(new Error('db error'), { code: 'ER_NO_SUCH_TABLE' }),
            'sys_metadata_history',
        ],
        [
            'the errno limb',
            Object.assign(new Error('opaque'), { errno: 1146 }),
            'sys_metadata_history',
        ],
        [
            'the driver wrapper, original attached as `cause`',
            Object.assign(new Error("The database refused to run this query for object 'sys_file'."), {
                code: 'DATABASE_ERROR',
                cause: new Error('no such table: sys_file'),
            }),
            'sys_file',
        ],
    ];

    it.each(TRUE_POSITIVES)('still benign: %s', (_name, error, readObject) => {
        expect(isMissingTableError(error, readObject)).toBe(true);
    });

    describe('the comparison folds away what two dialects spell differently', () => {
        it('ignores case', () => {
            expect(isMissingTableError(new Error('no such table: SYS_METADATA'), 'sys_metadata')).toBe(true);
        });

        it('ignores the MySQL database qualifier', () => {
            expect(
                isMissingTableError(new Error("Table 'app.sys_metadata' doesn't exist"), 'sys_metadata'),
            ).toBe(true);
        });

        it('ignores the legacy `namespace__short` object prefix `resolveTableName` strips', () => {
            // A caller naming the object `crm__account` reads the table
            // `account`; a strict comparison would call that a mismatch and
            // turn a genuine missing table loud.
            expect(isMissingTableError(new Error('no such table: account'), 'crm__account')).toBe(true);
        });
    });

    describe('no evidence means "as we were", never "be loud"', () => {
        it('keeps the pre-#13324 verdict when the caller names nothing', () => {
            // The parameter is optional because this is a published export.
            // Omitting it must reproduce the old behaviour EXACTLY — including
            // the old behaviour on the very error this card is about.
            expect(isMissingTableError(new Error(VIEW_OVER_MISSING_BASE))).toBe(true);
            expect(isMissingTableError(new Error('no such table: sys_metadata'))).toBe(true);
        });

        it('ignores a non-string second argument', () => {
            // Before this card the second positional parameter was the internal
            // `depth` counter. A stale numeric argument must not be read as a
            // table name (which would compare against `"0"` and answer loud).
            expect(isMissingTableError(new Error('no such table: sys_metadata'), 0 as never)).toBe(true);
        });

        it('leaves a phrase with no extractable name benign', () => {
            // `unknown table` with nothing quoted after it names nothing, so it
            // cannot contradict the caller.
            expect(isMissingTableError(new Error('unknown table'), 'sys_metadata')).toBe(true);
        });
    });

    it('does not let a mismatching phrase be rescued by a matching `cause`', () => {
        // Same disposition #6347 gave the sub-object exclusion: recognition
        // ends the question rather than descending, so a nested phrase naming
        // the read table cannot restore the benign verdict.
        const err = Object.assign(new Error('no such table: main.some_other_table'), {
            cause: Object.assign(new Error('relation "sys_metadata" does not exist'), { code: '42P01' }),
        });
        expect(isMissingTableError(err, 'sys_metadata')).toBe(false);
    });

    it('leaves the DDL predicate untouched', () => {
        // The new channel is scoped to MISSING_TABLE; `isSchemaAlreadyExistsError`
        // takes no read name and must not have acquired one.
        const err = Object.assign(new Error('table sys_metadata already exists'), {
            code: 'SQLITE_ERROR',
        });
        expect(isSchemaAlreadyExistsError(err)).toBe(true);
    });
});
