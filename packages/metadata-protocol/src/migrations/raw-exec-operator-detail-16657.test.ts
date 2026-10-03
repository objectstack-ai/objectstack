// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [commit 5a95b0e93] The operator records this package stores name the DIALECT, not the
 * driver's composed refusal.
 *
 * ## The regression
 *
 * Since #16019 the raw-SQL seam every probe and backfill here runs through
 * declares its own fault — `DATABASE_ERROR` / 500, a composed message that
 * discloses neither the statement nor the diagnostic, and the dialect error
 * whole under a non-enumerable `cause`. The driver prints the dialect's
 * diagnostic to its warn sink one line earlier, with the statement and its
 * bound values cut (#21385), so a live console lost nothing. Every record
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
 * those nine until commit dc709b2cf: `seed-tenancy-backfill`'s ORGANIZATION probe spelled
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
 * commit dc709b2cf) — the "unknown read as zero" confusion #9261 exists to prevent. The
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
import { inspect } from 'node:util';
import { redactStatementFromMessage } from '@objectstack/types';

import { collectRuntimeIndexPreflight } from './runtime-index-preflight.js';
import { probeThenReplaceIndex, type IndexExec } from './partial-index-probe.js';
import {
    backfillSeedTenancy,
    buildGlobalCounterProbeSql,
    ORGANIZATION_TABLE,
    SEQUENCES_TABLE,
} from './seed-tenancy-backfill.js';
import { readTablePresence } from './read-probe.js';
import { TABLE_IS_PRESENT_ROWS, isTablePresenceCatalogSql } from './read-probe.testkit.js';

/** `rawStatementFaultError`'s composed message, verbatim (`sql-driver.ts`). */
const COMPOSED =
    'The database refused to run a raw statement. The driver could not attribute the failure ' +
    'to any part of the request, so no verdict about the statement is claimed here. The ' +
    "backend's own diagnostic was written to the server log for an operator to read, with " +
    'the statement and its bound values cut.';

/** knex 3.3.0 + better-sqlite3: `<formatted statement> - <engine diagnostic>`. */
const DIALECT_TEXT = 'select "foo" from "sys_metadata" - no such column: foo';

/**
 * [#21418] What every record below stores for {@link DIALECT_TEXT}: the helper's
 * answer, which is THE driver-fault cut's, under the rule the driver's own raw
 * terminal writes its log line by. Spelled as the cutter's answer rather than
 * as a string, so these cases pin that each site stores the helper's text and
 * never pin the cutter's marker wording.
 */
const RECORDED = redactStatementFromMessage(DIALECT_TEXT, { statementSent: true });

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
            expect(probe.detail).toBe(RECORDED);
            expect(probe.detail).toContain('no such column: foo');
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
        expect(outcome.detail).toBe(RECORDED);
    });

    it('a refused REPLACE build reports the dialect text', async () => {
        const exec: IndexExec = async (sql: string) => {
            if (sql.includes(`CREATE UNIQUE INDEX ${options.indexName}`)) throw rawStatementFault();
            return [];
        };

        const outcome = await probeThenReplaceIndex(exec, options);

        expect(outcome.failedAt).toBe('replace');
        expect(outcome.detail).toBe(RECORDED);
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
     * asserts against; the empty-channel cases (commit dc709b2cf) pass their own value,
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
        expect(result.detail).toBe(RECORDED);
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
        expect(line?.message).toContain(RECORDED);
        expect(line?.meta?.organizationProbeError).toBe(RECORDED);
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
        expect(line?.meta?.error).toBe(RECORDED);
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
        expect(line?.meta?.error).toBe(RECORDED);
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
        expect(line?.meta?.error).toBe(RECORDED);
    });

    it('an UNDECLARED refusal reads its own message channel at every site', async () => {
        // No site here carries a fallback any more — the ORGANIZATION probe's
        // `|| 'unknown error'` was the last one and commit dc709b2cf removed it, which
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

/**
 * [#21418] The family's fourth position, pinned at every site in this package
 * that writes `operatorFacingErrorText`'s answer: a synthetic sentinel bound
 * into a raw statement reaches none of the carriers the site writes — the
 * result it returns, a log line's message or its meta — while the dialect's
 * diagnostic and the verdict the site takes from the error object survive.
 *
 * The cut is the helper's, by construction; no site here cuts anything itself,
 * and none needs to. These cases pin that each site writes nothing BUT the
 * helper's answer, so a site that one day embeds `cause.message` (or the
 * statement it sent) beside it reddens here.
 *
 * Two shapes of fault, matching the census on #21418:
 *  - where the site binds a VALUE itself (the backfill's stamp and counter
 *    merge bind the organization id), the fixture composes the dialect text
 *    from the statement and parameters the site really sent, inlined as knex
 *    prints them on SQLite and MySQL, and the sentinel IS that organization id;
 *  - where the site binds identifiers only, the raw path's `cause` carries the
 *    sentinel in a synthetic bound statement, and — at the unique-index probe —
 *    in MySQL's value-bearing duplicate-entry diagnostic, the shape a unique
 *    index built over duplicate stored rows raises.
 */
describe('[#21418] a bound sentinel reaches no carrier at any site in this package', () => {
    const SENTINEL = 'SENTINEL-21418-BOUND-VALUE';

    /** knex's message for a refused raw statement: values inlined, then the dialect's words. */
    function knexDump(sql: string, params: readonly unknown[] = [], diagnostic: string): string {
        let i = 0;
        const inlined = sql.replace(/\?/g, () => `'${String(params[i++])}'`);
        return `${inlined} - ${diagnostic}`;
    }

    /** The identifier-only sites' fault: the sentinel bound into a statement on the raw path. */
    const BOUND_DIALECT_TEXT = knexDump(
        'select "v" from "sys_setting" where "v" = ?',
        [SENTINEL],
        'no such column: v',
    );

    /** Every text a recorded log call carries, meta rendered the way a logger would. */
    function logged(log: ReturnType<typeof createLogger>): string {
        return log.warn.map((w) => `${w.message} ${inspect(w.meta, { depth: 8 })}`).join('\n');
    }

    it('[the fixture] the raw path really carries the sentinel on the cause the helper reads', () => {
        const thrown = rawStatementFault(BOUND_DIALECT_TEXT);
        expect((thrown as { cause?: Error }).cause?.message).toContain(SENTINEL);
        expect(thrown.message).not.toContain(SENTINEL);
    });

    it('read-probe — the catalog arm and the fallback arm both report cut text', async () => {
        const exec = async () => {
            throw rawStatementFault(BOUND_DIALECT_TEXT);
        };

        const catalog = await readTablePresence(exec, {
            table: SEQUENCES_TABLE,
            client: 'better-sqlite3',
            fallbackSql: `SELECT 1 FROM ${SEQUENCES_TABLE} WHERE 1 = 0`,
        });
        // No catalog arm for an unknown client: the caller's own probe runs.
        const fallback = await readTablePresence(exec, {
            table: SEQUENCES_TABLE,
            client: 'no-such-client',
            fallbackSql: `SELECT 1 FROM ${SEQUENCES_TABLE} WHERE 1 = 0`,
        });

        for (const [arm, result] of [['catalog', catalog], ['fallback', fallback]] as const) {
            expect(result.verdict, arm).toBe('unreadable');
            expect(result.probe, arm).toBe(arm);
            expect(inspect(result), arm).not.toContain(SENTINEL);
            expect(result.detail, arm).toContain('no such column: v');
        }
    });

    it('runtime-index-preflight — the per-probe detail and the dead-seam fan-out', async () => {
        const perProbe = await collectRuntimeIndexPreflight(async (sql: string) => {
            if (sql.includes('HAVING')) throw rawStatementFault(BOUND_DIALECT_TEXT);
            return [];
        });
        const deadSeam = await collectRuntimeIndexPreflight(async () => {
            throw rawStatementFault(BOUND_DIALECT_TEXT);
        });

        for (const results of [perProbe, deadSeam]) {
            expect(results.length).toBeGreaterThan(0);
            expect(inspect(results, { depth: 8 })).not.toContain(SENTINEL);
            for (const probe of results) {
                expect(probe.status).toBe('unreadable');
                expect(probe.detail).toContain('no such column: v');
            }
        }
    });

    it('partial-index-probe — both legs, the verdict still read off the error object', async () => {
        // MySQL raises this when a UNIQUE index is built over duplicate stored
        // rows: the conflicting value sits in the dialect's own diagnostic.
        const duplicate = (sql: string): Error => {
            const err = rawStatementFault(
                knexDump(sql, [], `Duplicate entry '${SENTINEL}' for key 't.idx_real'`),
            );
            Object.assign((err as unknown as { cause: object }).cause, { code: 'ER_DUP_ENTRY', errno: 1062 });
            return err;
        };
        const options = {
            indexName: 'idx_real',
            probeIndexName: 'idx_probe',
            buildSql: (name: string) => `CREATE UNIQUE INDEX ${name} ON t (a) WHERE b IS NULL`,
        };

        const atProbe = await probeThenReplaceIndex(async (sql: string) => {
            if (sql.startsWith('CREATE')) throw duplicate(sql);
            return [];
        }, options);
        const atReplace = await probeThenReplaceIndex(async (sql: string) => {
            if (sql.startsWith(`CREATE UNIQUE INDEX ${options.indexName}`)) throw duplicate(sql);
            return [];
        }, options);

        expect(atProbe.failedAt).toBe('probe');
        expect(atProbe.status).toBe('conflict');
        expect(atReplace.failedAt).toBe('replace');
        for (const outcome of [atProbe, atReplace]) {
            expect(inspect(outcome)).not.toContain(SENTINEL);
            expect(outcome.detail).toContain("for key 't.idx_real'");
        }
    });

    describe('seed-tenancy-backfill — all five sites', () => {
        /**
         * The backfill's own fixture shape (see the `[#16657]` block above),
         * with the organization the probe finds BEING the sentinel, so the
         * stamp and the counter merge bind it themselves, and every refusal
         * composed from the statement and parameters actually sent.
         *
         * ⚠️ The run's receipt names the organization it adopted, on purpose
         * and not through the helper: `organizationId` is a declared field of
         * the result (and of the `info` line a repair writes, which this
         * logger does not record). So the scan below reads the result WITHOUT
         * that one field, and pins the field's value separately, rather than
         * calling a declared receipt a leak.
         */
        function sentinelExec(refuse: (sql: string) => boolean) {
            return async (sql: string, params?: unknown[]): Promise<unknown> => {
                if (refuse(sql)) {
                    throw rawStatementFault(knexDump(sql, params, 'database table is locked'));
                }
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
                if (sql.includes(ORGANIZATION_TABLE)) return [{ id: SENTINEL }];
                if (sql.includes('rows_holding')) return [];
                return [];
            };
        }

        /** The site's own fault really carried the sentinel: the non-vacuity leg. */
        function boundBy(refuse: (sql: string) => boolean) {
            const seen: string[] = [];
            const exec = sentinelExec(refuse);
            return {
                seen,
                exec: async (sql: string, params?: unknown[]) => {
                    try {
                        return await exec(sql, params);
                    } catch (e) {
                        seen.push(String((e as { cause?: Error }).cause?.message));
                        throw e;
                    }
                },
            };
        }

        const SITES: Array<[site: string, refuse: (sql: string) => boolean, line: string, binds: boolean]> = [
            ['split probe → result `detail`', (sql) => sql.includes('LEFT JOIN'), '', false],
            ['organization probe → warn message and meta', (sql) => sql.includes(ORGANIZATION_TABLE), 'probe FAILED', false],
            ['collision probe → warn meta', (sql) => sql.includes('rows_holding'), 'already-minted duplicates', false],
            [
                'stamp → warn meta',
                (sql) => sql.startsWith('UPDATE') && !sql.includes(SEQUENCES_TABLE),
                'could not stamp',
                true,
            ],
            [
                'counter merge → warn meta',
                (sql) =>
                    sql === buildGlobalCounterProbeSql(true, 'better-sqlite3') ||
                    sql === buildGlobalCounterProbeSql(false, 'better-sqlite3'),
                'could not merge the counter',
                false,
            ],
        ];

        for (const [site, refuse, line, binds] of SITES) {
            it(site, async () => {
                const log = createLogger();
                const fixture = boundBy(refuse);
                // The sites that bind nothing of their own are handed the
                // synthetic bound statement; the stamp binds the sentinel itself.
                const exec = binds
                    ? fixture.exec
                    : async (sql: string, params?: unknown[]) => {
                          if (refuse(sql)) {
                              fixture.seen.push(BOUND_DIALECT_TEXT);
                              throw rawStatementFault(BOUND_DIALECT_TEXT);
                          }
                          return fixture.exec(sql, params);
                      };

                const result = await backfillSeedTenancy({ exec, client: 'better-sqlite3' }, log.logger);

                expect(fixture.seen.length, 'the site was never refused').toBeGreaterThan(0);
                expect(fixture.seen.every((m) => m.includes(SENTINEL))).toBe(true);
                const { organizationId, ...carriers } = result as typeof result & { organizationId?: string };
                expect([undefined, SENTINEL]).toContain(organizationId);
                expect(inspect(carriers, { depth: 8 })).not.toContain(SENTINEL);
                expect(logged(log)).not.toContain(SENTINEL);
                if (line === '') {
                    expect(result.status).toBe('absent');
                    expect(result.detail).toContain('no such column: v');
                } else {
                    const warned = log.warn.find((w) => w.message.includes(line));
                    expect(warned, `no warn line for ${site}`).toBeDefined();
                    expect(inspect(warned?.meta, { depth: 8 })).toContain(
                        binds ? 'database table is locked' : 'no such column: v',
                    );
                }
            });
        }

        it('the presence probe → warn meta and result `detail`, where read-probe\'s answer is logged', async () => {
            const log = createLogger();
            const result = await backfillSeedTenancy(
                {
                    exec: async (sql: string) => {
                        if (isTablePresenceCatalogSql(sql, SEQUENCES_TABLE)) {
                            throw rawStatementFault(BOUND_DIALECT_TEXT);
                        }
                        return [];
                    },
                    client: 'better-sqlite3',
                },
                log.logger,
            );

            expect(result.status).toBe('unreadable');
            expect(inspect(result, { depth: 8 })).not.toContain(SENTINEL);
            expect(logged(log)).not.toContain(SENTINEL);
            expect(result.detail).toContain('no such column: v');
        });
    });
});
