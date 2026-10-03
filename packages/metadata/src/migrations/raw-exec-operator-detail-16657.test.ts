// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [commit 5a95b0e93] The per-table `error` these migrations return names the DIALECT.
 *
 * Every migration in this directory reports per table rather than throwing, and
 * the caller stores or prints that report. Since #16019 the raw-SQL seam
 * declares its own fault with a COMPOSED message and keeps the dialect error
 * under a non-enumerable `cause`, so `err?.message` — the expression each of
 * these `catch` blocks used — began recording *"the database refused to run a
 * raw statement"* for a rename that actually failed on `no such column: foo`.
 *
 * A migration result is a stored operator record by construction: whoever reads
 * it later never saw the driver's warn line, so for them the dialect's words
 * were unrecoverable.
 *
 * Each case pins the "before" half beside the "after" one — the envelope's own
 * message is the composed sentence, and the record's is not — plus the negative
 * direction: an UNDECLARED throw is NOT unwrapped. Its `cause` is never walked
 * and the record reads the thrown value's own message channel,
 * `messageChannelOf(error) || String(error)`.
 *
 * ⚠️ That channel is a RULE, not byte-identity with what these `catch` blocks
 * used to compute, and the negative pins below do not claim otherwise: each
 * throws a NON-EMPTY `new Error(…)`, the shape for which the rule and the old
 * expression agree. They differ elsewhere — at the two `err?.message ??
 * String(err)` sites `new Error('')` recorded `''` and now records `'Error'`,
 * and `{message:42}` recorded the number where it now records
 * `'[object Object]'`; at the `error instanceof Error ? … : String(error)` site
 * `{message:'x'}` recorded `'[object Object]'` and now records `'x'`.
 *
 * ⚠️ Two, not the three this said when it was written. The third was
 * `migrateSysNotificationToEvent`, and it went with that runner when the
 * adr-0030-notification-event migration was retired.
 *
 * ⚠️ The composed sentence is the producer's, copied; `driver-sql`'s
 * `sql-driver-16657-operator-facing-cause-text.test.ts` pins the copy against a
 * real `SqlDriver.execute()` refusal.
 */

import { describe, expect, it } from 'vitest';
import { inspect } from 'node:util';
import { redactStatementFromMessage } from '@objectstack/types';

import { migrateEnvIdToProjectId } from './migrate-env-id-to-project-id.js';
import {
    AFFECTED_TABLES,
    migrateProjectIdToEnvironmentId,
} from './migrate-project-id-to-environment-id.js';
import { dropProjectionTables } from './drop-projection-tables.js';

/** `rawStatementFaultError`'s composed message, verbatim (`sql-driver.ts`). */
const COMPOSED =
    'The database refused to run a raw statement. The driver could not attribute the failure ' +
    'to any part of the request, so no verdict about the statement is claimed here. The ' +
    "backend's own diagnostic was written to the server log for an operator to read, with " +
    'the statement and its bound values cut.';

/** knex 3.3.0 + better-sqlite3: `<formatted statement> - <engine diagnostic>`. */
const DIALECT_TEXT = 'alter table "sys_metadata" rename column - no such column: env_id';

/**
 * [#21418] What each per-table record stores for a raw-path fault: the helper's
 * answer, which is THE driver-fault cut's, under the rule the driver's own raw
 * terminal writes its log line by. Spelled as the cutter's answer, so these
 * cases pin that each site stores the helper's text and never pin the cutter's
 * marker wording.
 */
const recorded = (dialect: string): string => redactStatementFromMessage(dialect, { statementSent: true });

function rawStatementFault(dialect = DIALECT_TEXT): Error {
    const err = new Error(COMPOSED) as Error & { code?: string; status?: number };
    err.code = 'DATABASE_ERROR';
    err.status = 500;
    const cause = new Error(dialect) as Error & { code?: string };
    cause.code = 'SQLITE_ERROR';
    Object.defineProperty(err, 'cause', {
        value: cause,
        enumerable: false,
        writable: true,
        configurable: true,
    });
    return err;
}

/**
 * A driver whose `PRAGMA table_info` reports `columns` and whose every other
 * statement is refused by `refusal()`. `execute` is the member `IDataDriver`
 * declares, so that is the surface these doubles offer.
 */
function refusingDriver(columns: readonly string[], refusal: () => unknown) {
    return {
        async execute(sql: string) {
            if (sql.startsWith('PRAGMA table_info')) return columns.map((name) => ({ name }));
            throw refusal();
        },
    } as never;
}

it('[the fixture] the envelope IS the composed sentence and hides the dialect', () => {
    const thrown = rawStatementFault();
    expect(thrown.message).toBe(COMPOSED);
    expect(thrown.message).not.toContain('no such column');
    expect((thrown as { cause?: Error }).cause?.message).toBe(DIALECT_TEXT);
});

describe('[#16657] migrateEnvIdToProjectId — the per-table error record', () => {
    it('a refused RENAME records the dialect text', async () => {
        const results = await migrateEnvIdToProjectId(
            refusingDriver(['id', 'env_id'], () => rawStatementFault()),
        );

        const errors = results.filter((r) => r.status === 'error');
        expect(errors.length).toBeGreaterThan(0);
        for (const row of errors) {
            expect(row.error).toBe(recorded(DIALECT_TEXT));
            expect(row.error).toContain('no such column: env_id');
            expect(row.error).not.toContain('refused to run a raw statement');
        }
    });

    it('an UNDECLARED refusal is recorded on its own message channel', async () => {
        const results = await migrateEnvIdToProjectId(
            refusingDriver(['id', 'env_id'], () => new Error('database is locked')),
        );

        expect(results.filter((r) => r.status === 'error').every((r) => r.error === 'database is locked')).toBe(true);
    });
});

describe('[#16657] migrateProjectIdToEnvironmentId — the per-table error record', () => {
    it('a refused RENAME records the dialect text', async () => {
        const results = await migrateProjectIdToEnvironmentId(
            refusingDriver(['id', 'project_id'], () => rawStatementFault()),
        );

        const errors = results.filter((r) => r.status === 'error');
        // The migration's own table list decides how many rows there are; the
        // assertion is about every one it produced, not about a count.
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.length).toBeLessThanOrEqual(AFFECTED_TABLES.length);
        for (const row of errors) expect(row.error).toBe(recorded(DIALECT_TEXT));
    });

    it('an UNDECLARED refusal is recorded on its own message channel', async () => {
        const results = await migrateProjectIdToEnvironmentId(
            refusingDriver(['id', 'project_id'], () => new Error('database is locked')),
        );

        expect(results.filter((r) => r.status === 'error').every((r) => r.error === 'database is locked')).toBe(true);
    });
});

describe('[#16657] dropProjectionTables — the per-table error record', () => {
    it('a refused DROP records the dialect text', async () => {
        const results = await dropProjectionTables({
            async execute() {
                throw rawStatementFault('drop table "sys_object" - table is locked');
            },
        } as never);

        expect(results.length).toBeGreaterThan(0);
        for (const row of results) {
            expect(row.status).toBe('error');
            expect(row.error).toBe(recorded('drop table "sys_object" - table is locked'));
            expect(row.error).toContain('table is locked');
        }
    });

    it('an UNDECLARED refusal is recorded on its own message channel', async () => {
        const results = await dropProjectionTables({
            async execute() {
                throw new Error('database is locked');
            },
        } as never);

        expect(results.every((r) => r.error === 'database is locked')).toBe(true);
    });
});

/**
 * [#21418] The family's fourth position, pinned at the three sites in this
 * package that write `operatorFacingErrorText`'s answer into a per-table
 * result: a synthetic sentinel bound into a raw statement reaches no result
 * row, while the dialect's diagnostic and each row's `status` survive.
 *
 * Every statement these migrations send binds identifiers only (the census on
 * #21418), so the raw path's `cause` carries the sentinel in a synthetic bound
 * statement, printed the way knex prints one on SQLite and MySQL. The cut is
 * the helper's, by construction; these cases pin that each site stores nothing
 * BUT the helper's answer.
 */
describe('[#21418] a bound sentinel reaches no per-table record', () => {
    const SENTINEL = 'SENTINEL-21418-BOUND-VALUE';
    const BOUND_DIALECT_TEXT =
        `update "sys_metadata" set "env_id" = '${SENTINEL}' - no such column: env_id`;

    it('[the fixture] the raw path really carries the sentinel on the cause the helper reads', () => {
        const thrown = rawStatementFault(BOUND_DIALECT_TEXT);
        expect((thrown as { cause?: Error }).cause?.message).toContain(SENTINEL);
        expect(thrown.message).not.toContain(SENTINEL);
    });

    const SITES: Array<[site: string, run: () => Promise<Array<{ status: string; error?: string }>>]> = [
        [
            'migrateEnvIdToProjectId',
            () => migrateEnvIdToProjectId(refusingDriver(['id', 'env_id'], () => rawStatementFault(BOUND_DIALECT_TEXT))),
        ],
        [
            'migrateProjectIdToEnvironmentId',
            () =>
                migrateProjectIdToEnvironmentId(
                    refusingDriver(['id', 'project_id'], () => rawStatementFault(BOUND_DIALECT_TEXT)),
                ),
        ],
        [
            'dropProjectionTables',
            () =>
                dropProjectionTables({
                    async execute() {
                        throw rawStatementFault(BOUND_DIALECT_TEXT);
                    },
                } as never),
        ],
    ];

    for (const [site, run] of SITES) {
        it(site, async () => {
            const results = await run();
            const errors = results.filter((r) => r.status === 'error');

            expect(errors.length, 'the site was never refused').toBeGreaterThan(0);
            expect(inspect(results, { depth: 8 })).not.toContain(SENTINEL);
            for (const row of errors) expect(row.error).toContain('no such column: env_id');
        });
    }
});
