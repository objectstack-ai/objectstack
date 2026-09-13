// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16657] The operator records this package stores name the DIALECT, not the
 * driver's composed refusal.
 *
 * ## The regression
 *
 * Since #16019 the raw-SQL seam every probe and backfill here runs through
 * declares its own fault — `DATABASE_ERROR` / 500, a composed message that
 * discloses neither the statement nor the diagnostic, and the dialect error
 * whole under a non-enumerable `cause`. The driver prints the dialect text to
 * its warn sink one line earlier, so a live console lost nothing. Every record
 * this package STORES did: `detail` and `error` fields began carrying *"the
 * database refused to run a raw statement"*, and the reader of a customer
 * install's backfill record a week later has no console line to fall back on.
 *
 * ## The control, in both directions
 *
 * Every case below asserts the envelope's OWN message first — the composed
 * sentence, which is exactly what these fields used to hold — and only then the
 * record's. A fixture that could not produce the "before" half would make every
 * "after" assertion unfalsifiable.
 *
 * The negative direction is pinned per site as well: a seam failure that is NOT
 * a declared raw-statement fault is NOT unwrapped — its `cause` is never walked
 * and the record reads the thrown value's own message channel,
 * `messageChannelOf(error) || String(error)`, at every site here but the one
 * noted below — because the alternative, a helper that unwraps whatever it is
 * handed, is the message sniffing #16019 exists to remove.
 *
 * ⚠️ That formula is now the WHOLE record at every site this change touched —
 * all nine in this package, fourteen across the repository. It was eight of
 * those nine until #17167: `seed-tenancy-backfill`'s ORGANIZATION probe spelled
 * `operatorFacingErrorText(e) || 'unknown error'` — the file's last fallback —
 * so where the channel was EMPTY that record read `'unknown error'` and never
 * `''`. Measured at that probe before the removal: a thrown `''`, a thrown
 * `[]`, and an `Error` whose `name` and `message` are both empty each recorded
 * `'unknown error'`; the control `new Error('boom')` recorded `'boom'`. All
 * three now record `''` and the control is unmoved.
 *
 * ⚠️ The fallback was load-bearing rather than leftover, which is why its
 * removal is not a one-liner: the site read `organizationProbeError === ''` as
 * "the probe did not fail", so deleting the placeholder and putting NOTHING in
 * its place routes a thrown `''` down the benign `no-organization-yet` path
 * instead of the ambiguous one (measured by ablation, both before and after
 * #17167) — the "unknown read as zero" confusion #9261 exists to prevent. The
 * fact now travels in the TYPE (`string | undefined`), so the status arm is
 * pinned beside the record arm in the empty-channel case below: a re-added
 * placeholder and a lost discrimination each redden one of them.
 *
 * ⚠️ That channel is a RULE, not byte-identity with what each site used to
 * compute. Every negative pin below throws a NON-EMPTY `new Error(…)`, the
 * shape for which the rule and the replaced expression agree; they differ
 * elsewhere — at the `error instanceof Error ? … : String(error)` sites
 * (`runProbe`, the seam-failure fan-out, both `partial-index-probe` legs)
 * `new Error('')` recorded `''` and now records `'Error'`, and `{message:'x'}`
 * recorded `'[object Object]'` and now records `'x'`; at the five
 * `(e as Error).message` sites in `seed-tenancy-backfill` a thrown `'x'`
 * recorded `undefined` — `'unknown error'` at the one site that spelled
 * `|| 'unknown error'` — and now records `'x'`, and a thrown `null` threw a
 * `TypeError` out of the catch at all five where it now records `'null'`.
 *
 * ⚠️ The composed sentence here is the producer's, copied. `driver-sql`'s
 * `sql-driver-16657-operator-facing-cause-text.test.ts` pins the copy against a
 * REAL `SqlDriver.execute()` refusal, so a reworded envelope reddens there
 * instead of turning these cases into tests of their own fixture.
 */

import { describe, it, expect } from 'vitest';

import { collectRuntimeIndexPreflight } from './runtime-index-preflight.js';
import { probeThenReplaceIndex, type IndexExec } from './partial-index-probe.js';
import {
    backfillSeedTenancy,
    buildGlobalCounterProbeSql,
    ORGANIZATION_TABLE,
    SEQUENCES_TABLE,
} from './seed-tenancy-backfill.js';
import { TABLE_IS_PRESENT_ROWS, isTablePresenceCatalogSql } from './read-probe.testkit.js';

/** `rawStatementFaultError`'s composed message, verbatim (`sql-driver.ts`). */
const COMPOSED =
    'The database refused to run a raw statement. The driver could not attribute the failure ' +
    'to any part of the request, so no verdict about the statement is claimed here. The ' +
    "backend's own diagnostic and the statement were written to the server log for an " +
    'operator to read.';

/** knex 3.3.0 + better-sqlite3: `<formatted statement> - <engine diagnostic>`. */
const DIALECT_TEXT = 'select "foo" from "sys_metadata" - no such column: foo';

/** The envelope the raw terminal composes, cause carrier and all. */
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

/** The "before" half, asserted once so every case below can lean on it. */
it('[the fixture] the envelope IS the composed sentence and hides the dialect', () => {
    const thrown = rawStatementFault();
    expect(thrown.message).toBe(COMPOSED);
    expect(thrown.message).not.toContain('no such column');
    expect((thrown as { cause?: Error }).cause?.message).toBe(DIALECT_TEXT);
});

function createLogger() {
    const warn: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    return {
        warn,
        logger: {
            warn: (message: string, meta?: Record<string, unknown>) => {
                warn.push({ message, meta });
            },
            info: () => {},
            error: () => {},
        },
    };
}

describe('[#16657] runtime-index-preflight — the per-probe detail', () => {
    it('a duplicate probe refused by the backend reports the dialect text', async () => {
        const exec: IndexExec = async (sql: string) => {
            if (sql.includes('HAVING')) throw rawStatementFault();
            return [];
        };

        const results = await collectRuntimeIndexPreflight(exec);

        expect(results.length).toBeGreaterThan(0);
        for (const probe of results) {
            expect(probe.status).toBe('unreadable');
            expect(probe.detail).toBe(DIALECT_TEXT);
            expect(probe.detail).not.toContain('refused to run a raw statement');
        }
    });

    it('a dead seam reports the dialect text on every probe', async () => {
        // The liveness statement itself is refused, so ONE failure is fanned out
        // to every probe — the record shape an operator reads for a whole run.
        const exec: IndexExec = async () => {
            throw rawStatementFault('no such table: main.sys_metadata');
        };

        const results = await collectRuntimeIndexPreflight(exec);

        expect(results.every((p) => p.detail === 'no such table: main.sys_metadata')).toBe(true);
    });

    it('an UNDECLARED seam failure reaches the detail on its own message channel', async () => {
        const exec: IndexExec = async () => {
            throw new Error('connection terminated unexpectedly');
        };

        const results = await collectRuntimeIndexPreflight(exec);

        expect(results.every((p) => p.detail === 'connection terminated unexpectedly')).toBe(true);
    });
});

describe('[#16657] partial-index-probe — the detail both callers report', () => {
    const options = {
        indexName: 'idx_real',
        probeIndexName: 'idx_probe',
        buildSql: (name: string) => `CREATE UNIQUE INDEX ${name} ON t (a) WHERE b IS NULL`,
    };

    it('a refused PROBE build reports the dialect text', async () => {
        const exec: IndexExec = async (sql: string) => {
            if (sql.includes('CREATE')) throw rawStatementFault();
            return [];
        };

        const outcome = await probeThenReplaceIndex(exec, options);

        expect(outcome.failedAt).toBe('probe');
        expect(outcome.detail).toBe(DIALECT_TEXT);
    });

    it('a refused REPLACE build reports the dialect text', async () => {
        const exec: IndexExec = async (sql: string) => {
            if (sql.includes(`CREATE UNIQUE INDEX ${options.indexName}`)) throw rawStatementFault();
            return [];
        };

        const outcome = await probeThenReplaceIndex(exec, options);

        expect(outcome.failedAt).toBe('replace');
        expect(outcome.detail).toBe(DIALECT_TEXT);
    });

    it('the VERDICT is still taken from the error object, not the text', async () => {
        // The dialect word the `unsupported` arm matches sits in the CAUSE, and
        // `classifyIndexFailure` is cause-following — untouched by this change.
        const exec: IndexExec = async (sql: string) => {
            if (sql.includes('CREATE')) {
                throw rawStatementFault('near "where": syntax error');
            }
            return [];
        };

        const outcome = await probeThenReplaceIndex(exec, options);

        expect(outcome.status).toBe('unsupported');
        expect(outcome.detail).toBe('near "where": syntax error');
    });

    it('an UNDECLARED build failure reports its own message channel, no cause walked', async () => {
        const exec: IndexExec = async (sql: string) => {
            if (sql.includes('CREATE')) throw new Error('disk I/O error');
            return [];
        };

        const outcome = await probeThenReplaceIndex(exec, options);

        expect(outcome.detail).toBe('disk I/O error');
    });
});

describe('[#16657] seed-tenancy-backfill — the stored operator record', () => {
    /**
     * The statements the module compiles, dispatched the way
     * `seed-tenancy-backfill.test.ts`'s own fixture dispatches them, with one
     * injectable refusal so a single run can be pointed at one seam at a time.
     *
     * `thrown` defaults to the declared raw-statement fault every case below
     * asserts against; the empty-channel cases (#17167) pass their own value,
     * which is why it is a parameter rather than a second fixture.
     */
    function seamExec(refuse: (sql: string) => boolean, thrown: unknown = rawStatementFault()) {
        return async (sql: string): Promise<unknown> => {
            if (refuse(sql)) throw thrown;
            if (isTablePresenceCatalogSql(sql, SEQUENCES_TABLE)) return TABLE_IS_PRESENT_ROWS;
            if (sql.includes('WHERE 1 = 0')) return [];
            if (sql.includes('LEFT JOIN')) {
                return [
                    {
                        object: 'crm_case',
                        field: 'case_number',
                        global_last_value: 38,
                        organization_last_value: 1,
                    },
                ];
            }
            if (sql.includes(ORGANIZATION_TABLE)) return [{ id: 'org_a' }];
            if (sql.includes('rows_holding')) return [];
            return [];
        };
    }

    it('[absent] a refused split probe stores the dialect text as `detail`', async () => {
        const result = await backfillSeedTenancy({
            exec: seamExec((sql) => sql.includes('LEFT JOIN')),
            client: 'better-sqlite3',
        });

        expect(result.status).toBe('absent');
        expect(result.detail).toBe(DIALECT_TEXT);
        expect(result.detail).not.toContain('refused to run a raw statement');
    });

    it('[ambiguous] a refused organization probe names the dialect in the report', async () => {
        const log = createLogger();
        const result = await backfillSeedTenancy(
            { exec: seamExec((sql) => sql.includes(ORGANIZATION_TABLE)), client: 'better-sqlite3' },
            log.logger,
        );

        expect(result.status).toBe('skipped-ambiguous-organization');
        const line = log.warn.find((w) => w.message.includes('probe FAILED'));
        expect(line?.message).toContain(DIALECT_TEXT);
        expect(line?.meta?.organizationProbeError).toBe(DIALECT_TEXT);
    });

    it('[#17167] an EMPTY channel at the organization probe is recorded empty, and still FAILED', async () => {
        // The site that used to spell `|| 'unknown error'`. Two arms, because
        // the placeholder was doing two jobs and only one of them was a record:
        //   · the RECORD arm — the helper's return as is, `''` and all, which
        //     is what the other four sites in that file do with these shapes;
        //   · the STATUS arm — an empty channel is still a FAILED probe, so the
        //     run must stay on the ambiguous path and must not become
        //     `no-organization-yet` (#9261's "unknown is not zero").
        // A placeholder coming back reddens the first; a discrimination lost
        // with it reddens the second.
        const emptyNameAndMessage = new Error('');
        emptyNameAndMessage.name = '';
        const EMPTY_CHANNEL: Array<[string, unknown]> = [
            ["a thrown ''", ''],
            ['a thrown []', []],
            ['an Error whose name and message are both empty', emptyNameAndMessage],
        ];

        for (const [label, thrown] of EMPTY_CHANNEL) {
            const log = createLogger();
            const result = await backfillSeedTenancy(
                {
                    exec: seamExec((sql) => sql.includes(ORGANIZATION_TABLE), thrown),
                    client: 'better-sqlite3',
                },
                log.logger,
            );

            expect(result.status, label).toBe('skipped-ambiguous-organization');
            const line = log.warn.find((w) => w.message.includes('probe FAILED'));
            expect(line?.meta?.organizationProbeError, label).toBe('');
            expect(line?.message, label).not.toContain('unknown error');
        }

        // The control: the same fixture, a NON-EMPTY channel. Without it, a
        // record that had stopped being written at all would pass every
        // assertion above.
        const control = createLogger();
        const controlResult = await backfillSeedTenancy(
            {
                exec: seamExec((sql) => sql.includes(ORGANIZATION_TABLE), new Error('boom')),
                client: 'better-sqlite3',
            },
            control.logger,
        );
        expect(controlResult.status).toBe('skipped-ambiguous-organization');
        expect(
            control.warn.find((w) => w.message.includes('probe FAILED'))?.meta
                ?.organizationProbeError,
        ).toBe('boom');
    });

    it('[collision probe] the warn meta carries the dialect text', async () => {
        const log = createLogger();
        await backfillSeedTenancy(
            { exec: seamExec((sql) => sql.includes('rows_holding')), client: 'better-sqlite3' },
            log.logger,
        );

        const line = log.warn.find((w) => w.message.includes('already-minted duplicates'));
        expect(line?.meta?.error).toBe(DIALECT_TEXT);
    });

    it('[stamp] the warn meta carries the dialect text', async () => {
        const log = createLogger();
        await backfillSeedTenancy(
            {
                exec: seamExec(
                    (sql) => sql.startsWith('UPDATE') && !sql.includes(SEQUENCES_TABLE),
                ),
                client: 'better-sqlite3',
            },
            log.logger,
        );

        const line = log.warn.find((w) => w.message.includes('could not stamp'));
        expect(line?.meta?.error).toBe(DIALECT_TEXT);
    });

    it('[counter merge] the warn meta carries the dialect text', async () => {
        const log = createLogger();
        await backfillSeedTenancy(
            {
                // The first statement `mergeSplitCounter` issues — matched by
                // BUILDING it here, so a builder that changes shape breaks this
                // fixture instead of silently never refusing anything.
                exec: seamExec(
                    (sql) =>
                        sql === buildGlobalCounterProbeSql(true, 'better-sqlite3') ||
                        sql === buildGlobalCounterProbeSql(false, 'better-sqlite3'),
                ),
                client: 'better-sqlite3',
            },
            log.logger,
        );

        const line = log.warn.find((w) => w.message.includes('could not merge the counter'));
        expect(line?.meta?.error).toBe(DIALECT_TEXT);
    });

    it('an UNDECLARED refusal reads its own message channel at every site', async () => {
        // No site here carries a fallback any more — the ORGANIZATION probe's
        // `|| 'unknown error'` was the last one and #17167 removed it, which
        // the empty-channel case below pins. This pin drives the duplicates
        // warning with a NON-EMPTY message, the shape for which the channel is
        // the whole answer at every site.
        const log = createLogger();
        const bare = async (sql: string): Promise<unknown> => {
            if (sql.includes('rows_holding')) throw new Error('connection terminated unexpectedly');
            return seamExec(() => false)(sql);
        };

        await backfillSeedTenancy({ exec: bare, client: 'better-sqlite3' }, log.logger);

        const line = log.warn.find((w) => w.message.includes('already-minted duplicates'));
        expect(line?.meta?.error).toBe('connection terminated unexpectedly');
    });
});
