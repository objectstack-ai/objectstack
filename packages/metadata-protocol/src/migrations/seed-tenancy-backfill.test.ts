// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8686 unit half — the parts the real-driver integration test cannot reach.
 *
 * `packages/runtime`'s `seed-tenancy-autonumber-split.integration.test.ts` drives
 * this module end to end on a real `SqlDriver`, which is the assertion that
 * matters for behaviour. It can only do that on ONE dialect, though, and two of
 * the failure modes here are invisible on that dialect by construction:
 *
 *   - **result shape.** better-sqlite3 returns a bare row array; `pg` returns
 *     `{ rows }`; `mysql2` returns `[rows, fields]`. Every branch of this
 *     migration treats "no rows" as "healthy install, nothing to do", so a
 *     reader that understood only sqlite's shape would report a clean bill of
 *     health on Postgres and MySQL while the split sat there minting duplicates.
 *     That is a silent no-op, not a crash — nothing would ever surface it.
 *   - **identifier safety.** Object and field names are read out of
 *     `_objectstack_sequences` and interpolated into SQL (a table name cannot be
 *     a bound parameter in any dialect). Values are always bound; identifiers are
 *     gated, and the gate has to be asserted directly because a live driver would
 *     simply error on a bad name rather than show which layer refused it.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  backfillSeedTenancy,
  buildSeedTenancyReceipt,
  normalizeRows,
  resolveSeedTenancyLedger,
  resolveSeedTenancySeam,
  SEED_TENANCY_MIGRATION_ID,
  buildOrganizationProbeSql,
  buildSplitProbeSql,
  buildCollisionProbeSql,
  buildStampSql,
  buildCounterMergeSql,
  buildGlobalCounterDeleteSql,
  buildSequencesPresenceSql,
  SEQUENCES_TABLE,
  GLOBAL_TENANT,
  ORGANIZATION_FIELD,
  ORGANIZATION_TABLE,
} from './seed-tenancy-backfill.js';
import type { SeedTenancyBackfillResult } from './seed-tenancy-backfill.js';

describe('#8686 normalizeRows — one reader for three dialect shapes', () => {
  const rows = [{ object: 'crm_case', field: 'case_number' }];

  it('reads better-sqlite3 / knex: a bare row array', () => {
    expect(normalizeRows(rows)).toEqual(rows);
  });

  it('reads pg: { rows, rowCount }', () => {
    expect(normalizeRows({ rows, rowCount: 1, command: 'SELECT' })).toEqual(rows);
  });

  it('reads mysql2: the [rows, fields] tuple', () => {
    expect(normalizeRows([rows, [{ name: 'object' }, { name: 'field' }]])).toEqual(rows);
  });

  it('reads emptiness as emptiness, not as a shape it failed to parse', () => {
    // All four spellings of "this install has no split". They must be
    // indistinguishable from each other, and distinguishable from a shape the
    // reader did not understand — which is why the mysql2 case above is pinned
    // separately rather than being swallowed by this one.
    expect(normalizeRows([])).toEqual([]);
    expect(normalizeRows({ rows: [] })).toEqual([]);
    expect(normalizeRows([[], []])).toEqual([]);
    expect(normalizeRows(undefined)).toEqual([]);
  });

  it('never invents rows from an unrecognized shape', () => {
    expect(normalizeRows({ affectedRows: 3 })).toEqual([]);
    expect(normalizeRows('OK')).toEqual([]);
    expect(normalizeRows(0)).toEqual([]);
  });
});

describe('#8686 SQL builders', () => {
  it('the split probe LEFT JOINs, so a fresh install (no org counter yet) is still detected', () => {
    const sql = buildSplitProbeSql();
    // The distinction this whole fix turns on: an inner join here would find
    // nothing on a fresh install — the exact case the card reproduces — and the
    // repair would decline seconds before the first duplicate is minted.
    expect(sql).toContain('LEFT JOIN');
    expect(sql).not.toMatch(/\bFROM\s+"_objectstack_sequences"\s+g\s+JOIN\b/);
    expect(sql).toContain('"_objectstack_sequences" g LEFT JOIN');
    expect(sql).toContain(SEQUENCES_TABLE);
  });

  it('the stamp excludes identifiers already taken in the target organization', () => {
    const sql = buildStampSql('crm_case', ['case_number']);
    expect(sql).toContain(`UPDATE "crm_case" SET "${ORGANIZATION_FIELD}" = ?`);
    expect(sql).toContain(`WHERE "${ORGANIZATION_FIELD}" IS NULL`);
    // Without this the whole UPDATE is refused by the partitioned unique index on
    // any install that already minted duplicates, rolling back even the rows that
    // had no conflict.
    expect(sql).toContain('"case_number" NOT IN (SELECT');
    expect(sql).toContain('FROM "crm_case"');
  });

  it('the stamp guards EVERY split field of a multi-autonumber object', () => {
    const sql = buildStampSql('crm_case', ['case_number', 'ticket_no']);
    expect(sql).toContain('"case_number" NOT IN');
    expect(sql).toContain('"ticket_no" NOT IN');
    // One derived table per guard: MySQL rejects a repeated derived-table alias
    // in one statement, and the guards are all in one statement.
    expect(sql).toContain('AS "taken_0"');
    expect(sql).toContain('AS "taken_1"');
  });

  it('the collision probe asks for values held on BOTH sides of the split', () => {
    const sql = buildCollisionProbeSql('crm_case', 'case_number');
    expect(sql).toContain(`WHERE "${ORGANIZATION_FIELD}" IS NULL`);
    expect(sql).toContain(`WHERE "${ORGANIZATION_FIELD}" IS NOT NULL`);
    expect(sql).toContain('GROUP BY "case_number"');
  });

  it('counter statements bind every value and name no literal tenant', () => {
    // The tenant id reaching these is an organization id read from the database.
    // It is bound, never interpolated.
    expect(buildCounterMergeSql()).toContain('SET "last_value" = ?');
    expect(buildCounterMergeSql()).toContain('WHERE "object" = ? AND "field" = ? AND "tenant_id" = ?');
    expect(buildGlobalCounterDeleteSql()).toContain(
      'WHERE "object" = ? AND "field" = ? AND "tenant_id" = ?',
    );
    expect(buildCounterMergeSql()).not.toContain(GLOBAL_TENANT);
    expect(buildGlobalCounterDeleteSql()).not.toContain(GLOBAL_TENANT);
  });

  it('the presence probe reads no rows', () => {
    expect(buildSequencesPresenceSql()).toContain('WHERE 1 = 0');
  });
});

describe('#8686 identifier gate', () => {
  // Names arrive from `_objectstack_sequences` rows and are interpolated, so the
  // gate is the boundary. A refusal is a thrown Error, never a silently mangled
  // statement — a builder that "sanitized" its way to a valid-looking query would
  // run against a table nobody named.
  const hostile = [
    'crm_case; DROP TABLE sys_user',
    'crm_case"',
    "crm_case'",
    'crm case',
    '1_case',
    '',
  ];

  for (const name of hostile) {
    it(`refuses ${JSON.stringify(name)} as an object name`, () => {
      expect(() => buildStampSql(name, ['case_number'])).toThrow(/unsafe identifier/);
      expect(() => buildCollisionProbeSql(name, 'case_number')).toThrow(/unsafe identifier/);
    });

    it(`refuses ${JSON.stringify(name)} as a field name`, () => {
      expect(() => buildStampSql('crm_case', [name])).toThrow(/unsafe identifier/);
      expect(() => buildCollisionProbeSql('crm_case', name)).toThrow(/unsafe identifier/);
    });
  }

  it('accepts the platform’s own snake_case machine names', () => {
    expect(() => buildStampSql('crm_case', ['case_number'])).not.toThrow();
    expect(() => buildCollisionProbeSql('_odd_but_legal', 'f1')).not.toThrow();
  });
});

describe('#9381 dialect-aware statement text', () => {
  // MySQL does not run with `ANSI_QUOTES` — measured on a live MySQL 8.0.46,
  // whose `sql_mode` is
  // ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,
  // ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION, and nothing in
  // `driver-sql` sets one. `"x"` is therefore a STRING LITERAL there, and every
  // statement this module builds was an `ER_PARSE_ERROR` before this fix.
  //
  // The live counterpart of this suite is
  // `seed-tenancy-backfill.live-mysql.test.ts`, which RUNS the statements on a
  // real server. This one pins the text so the seam is covered on every
  // machine, with or without a MySQL.
  const BACKTICK = String.fromCharCode(96);
  const bt = (name: string) => `${BACKTICK}${name}${BACKTICK}`;

  for (const client of ['mysql', 'mysql2']) {
    describe(`client=${client}`, () => {
      it('quotes every table and column with backticks, never with double quotes', () => {
        const statements = [
          buildSequencesPresenceSql(client),
          buildSplitProbeSql(client),
          buildOrganizationProbeSql(client),
          buildCollisionProbeSql('crm_case', 'case_number', client),
          buildStampSql('crm_case', ['case_number'], client),
          buildCounterMergeSql(client),
          buildGlobalCounterDeleteSql(client),
        ];
        for (const sql of statements) {
          expect(sql).not.toContain('"');
          expect(sql).toContain(BACKTICK);
        }
        expect(buildSequencesPresenceSql(client)).toContain(bt(SEQUENCES_TABLE));
        expect(buildStampSql('crm_case', ['case_number'], client)).toContain(
          `UPDATE ${bt('crm_case')} SET ${bt(ORGANIZATION_FIELD)} = ?`,
        );
      });

      it('quotes `last_value` — a RESERVED word on MySQL 8.0 — wherever it is unqualified', () => {
        // `LAST_VALUE()` is a window function there, so a bare `last_value` is a
        // parse error even when the table name is spelled correctly. Measured.
        const merge = buildCounterMergeSql(client);
        expect(merge).toContain(`SET ${bt('last_value')} = ?`);
        expect(merge).not.toMatch(/(?<![`\w])last_value(?![`\w])/);
      });

      it('routes the stamp guard through a derived table (MySQL rejects the self-reference)', () => {
        // ER_UPDATE_TABLE_USED (1093): "You can't specify target table 'crm_case'
        // for update in FROM clause". Not a quoting problem — the statement stays
        // refused after the identifiers are spelled the MySQL way.
        const sql = buildStampSql('crm_case', ['case_number'], client);
        expect(sql).toContain(`AS ${bt('taken_0')})`);
        expect(sql).not.toMatch(
          new RegExp(`NOT IN \\(SELECT ${BACKTICK}case_number${BACKTICK} FROM`),
        );
      });
    });
  }

  for (const client of ['pg', 'better-sqlite3', 'sqlite3', undefined]) {
    it(`keeps the ANSI spelling for client=${String(client)}`, () => {
      const statements = [
        buildSequencesPresenceSql(client),
        buildSplitProbeSql(client),
        buildOrganizationProbeSql(client),
        buildCollisionProbeSql('crm_case', 'case_number', client),
        buildStampSql('crm_case', ['case_number'], client),
        buildCounterMergeSql(client),
        buildGlobalCounterDeleteSql(client),
      ];
      for (const sql of statements) {
        expect(sql).not.toContain(BACKTICK);
        expect(sql).toContain('"');
      }
    });
  }

  it('the seam carries the dialect, so a caller cannot drop it', () => {
    // The structural half of the fix: `backfillSeedTenancy` takes the pair, and
    // the resolver is what produces the pair. A driver that reports no client
    // still resolves — ANSI is the right default for the two dialects that want
    // it, and for a MySQL running with ANSI_QUOTES.
    const driver = {
      execute: async () => [],
      config: { client: 'mysql2' },
    };
    const seam = resolveSeedTenancySeam({ driver });
    expect(seam?.client).toBe('mysql2');
    expect(typeof seam?.exec).toBe('function');

    const clientless = resolveSeedTenancySeam({ driver: { execute: async () => [] } });
    expect(clientless?.client).toBeUndefined();
    expect(resolveSeedTenancySeam({})).toBeUndefined();
  });
});

/**
 * #9451 — the durable receipt.
 *
 * The behaviour that matters (a row that is still in the database after the
 * process is gone) is pinned on a real boot in
 * `packages/cli/src/utils/platform-migrations-arming.integration.test.ts`. What
 * lives here is what that test cannot show: the FIELD READING, which is a
 * decision rather than an observation, and the two failure directions —
 * because "the receipt could not be written" must be loud, and must never break
 * the boot it rides on (2026-08-15: best-effort-never-fails-boot).
 */
describe('#9451 the seed-tenancy repair leaves a durable receipt', () => {
  /** One split object, one organization, no collisions — drives the repair to `applied`. */
  function fakeSeamExec(overrides: { collisions?: Record<string, unknown>[] } = {}) {
    return async (sql: string, _params?: unknown[]): Promise<unknown> => {
      // Dispatched on the statements the module actually compiles, so a builder
      // that changed shape breaks this fixture rather than silently turning it
      // into a healthy install.
      if (sql.includes('WHERE 1 = 0')) return []; // presence probe
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
      if (sql.includes('rows_holding')) return overrides.collisions ?? [];
      if (sql.startsWith('UPDATE') || sql.startsWith('DELETE')) return [];
      if (sql.includes('tenant_id')) return [{ tenant_id: 'org_a', last_value: 1 }];
      return [];
    };
  }

  /** An in-memory `sys_migration`, duck-typed exactly as the engine is. */
  function fakeLedger(options: { rows?: Record<string, unknown>[]; failWrites?: boolean } = {}) {
    const rows = options.rows ?? [];
    const calls: Array<{ op: string; data: Record<string, unknown> }> = [];
    return {
      rows,
      calls,
      ledger: {
        getObject: (name: string) => (name === 'sys_migration' ? { name } : undefined),
        find: async (_object: string, opts: any) =>
          rows.filter((r) => r.id === opts?.where?.id).slice(0, opts?.limit ?? rows.length),
        insert: async (_object: string, data: Record<string, unknown>) => {
          if (options.failWrites) throw new Error('no such table: sys_migration');
          calls.push({ op: 'insert', data });
          rows.push(data);
          return data;
        },
        update: async (
          _object: string,
          data: Record<string, unknown>,
          opts?: Record<string, unknown>,
        ) => {
          // The double must refuse exactly what `ObjectQL.update` refuses — a
          // fake looser than the producer is how a dead write path ships with
          // its suite green. The receipt is addressed by `data.id`, so this
          // also pins that the row carries one.
          assertEngineUpdateDispatch(data as any, opts as any);
          if (options.failWrites) throw new Error('no such table: sys_migration');
          calls.push({ op: 'update', data });
          return data;
        },
      },
    };
  }

  function createLogger() {
    const info: string[] = [];
    const warn: string[] = [];
    const error: string[] = [];
    return {
      info, warn, error,
      logger: {
        info: (m: string) => void info.push(m),
        warn: (m: string) => void warn.push(m),
        error: (m: string) => void error.push(m),
      },
    };
  }

  const appliedResult: SeedTenancyBackfillResult = {
    status: 'applied',
    splits: [
      { object: 'crm_case', field: 'case_number', globalLastValue: 38, organizationLastValue: 1 },
    ],
    collisions: [{ object: 'crm_case', field: 'case_number', value: 'CASE-00001', rows: 2 }],
    objectsStamped: 1,
    organizationId: 'org_a',
  };

  it('[the reading] verified_at is null, blocking is 0, collisions are advisory', () => {
    const flag = buildSeedTenancyReceipt(appliedResult, '2026-08-20T00:00:00.000Z');

    expect(flag.id).toBe(SEED_TENANCY_MIGRATION_ID);
    // No self-check ran, so no certificate is claimed. `verified_at` set would
    // read as "this deployment's scan passed" to `isDataMigrationFlagVerified`,
    // which nothing here earned.
    expect(flag.verified_at).toBeNull();
    // This repair gates no consumer, so a blocking count would be a signal with
    // no receiver — and 0 is the value every reader of that column requires.
    expect(flag.blocking).toBe(0);
    // Already-minted duplicates need an operator decision and never block.
    expect(flag.advisory).toBe(1);
    expect(flag.last_run_at).toBe('2026-08-20T00:00:00.000Z');
    expect(flag.applied_at).toBe('2026-08-20T00:00:00.000Z');
    // ADR-0104's escape-hatch protocol is not this repair's, so its columns are
    // left alone rather than written with values nothing reads.
    expect(flag.deviation_observed_at).toBeUndefined();
    expect(flag.deviation_detail).toBeUndefined();

    // The card's four questions — when, which objects, which organization, what
    // collided — are answerable from the row alone.
    expect(JSON.parse(String(flag.details))).toEqual({
      status: 'applied',
      objectsStamped: 1,
      organizationId: 'org_a',
      splits: ['crm_case.case_number'],
      collisions: ['crm_case.case_number=CASE-00001'],
    });
  });

  it('[applied] the repair writes the row through the ledger on the seam', async () => {
    const store = fakeLedger();
    const log = createLogger();
    const result = await backfillSeedTenancy(
      { exec: fakeSeamExec(), client: 'better-sqlite3', ledger: store.ledger },
      log.logger,
    );

    expect(result.status).toBe('applied');
    expect(store.calls.map((c) => c.op)).toEqual(['insert']);
    const written = store.calls[0].data;
    expect(written.id).toBe(SEED_TENANCY_MIGRATION_ID);
    expect(written.created_at).toBe(written.last_run_at);
    expect(JSON.parse(String(written.details)).objectsStamped).toBe(1);
    expect(log.info.join('\n')).toContain('sys_migration');
  });

  it('[no-split] a healthy install stays silent — no row, no log', async () => {
    const store = fakeLedger();
    const log = createLogger();
    const result = await backfillSeedTenancy(
      {
        exec: async (sql: string) => (sql.includes('SELECT 1') ? [] : []),
        client: 'better-sqlite3',
        ledger: store.ledger,
      },
      log.logger,
    );

    expect(result.status).toBe('no-split');
    expect(store.calls).toEqual([]);
    expect(store.rows).toEqual([]);
    // A ledger of non-events is not a receipt. The overwhelming majority of
    // boots are healthy and must not narrate — the card argues for this silence.
    expect(log.info).toEqual([]);
    expect(log.warn).toEqual([]);
  });

  it('[re-run] a later applied run overwrites its own row rather than appending', async () => {
    const store = fakeLedger({
      rows: [{ id: SEED_TENANCY_MIGRATION_ID, last_run_at: '2026-01-01T00:00:00.000Z', blocking: 0 }],
    });
    await backfillSeedTenancy(
      { exec: fakeSeamExec(), client: 'better-sqlite3', ledger: store.ledger },
      createLogger().logger,
    );

    // The ledger's grain is one row per migration; per-RUN history is
    // `sys_migration_journal`'s job, not this row's.
    expect(store.calls.map((c) => c.op)).toEqual(['update']);
    expect(store.rows).toHaveLength(1);
  });

  it('[never-fails-boot] a failed receipt write is reported at error and does not throw', async () => {
    const store = fakeLedger({ failWrites: true });
    const log = createLogger();

    const result = await backfillSeedTenancy(
      { exec: fakeSeamExec(), client: 'better-sqlite3', ledger: store.ledger },
      log.logger,
    );

    // The repair itself stands — a boot must never fail because bookkeeping did
    // (2026-08-15 ruling).
    expect(result.status).toBe('applied');
    expect(result.objectsStamped).toBe(1);

    // And the loss is LOUD. `warn` here would be the #4420 shape on this card's
    // own subject: rows rewritten, nothing persisted to say so, every log line
    // reading clean.
    expect(log.error).toHaveLength(1);
    expect(log.warn).toEqual([]);
    const message = log.error[0];
    expect(message).toContain('NO durable record');
    // The two things an `error` owes: the consequence, and the fix.
    expect(message).toContain('is not retried');
    expect(message).toContain('capture this boot');
    expect(message).toContain('PlatformObjectsPlugin');
  });

  it('[no ledger] a kernel without sys_migration is told what was lost', async () => {
    const log = createLogger();
    const noLedger = {
      getObject: () => undefined,
      find: async () => [],
      insert: async () => { throw new Error('must not be called'); },
      update: async (_object: string, data: Record<string, unknown>, opts?: Record<string, unknown>) => {
        assertEngineUpdateDispatch(data as any, opts as any);
        throw new Error('must not be called');
      },
    };

    await backfillSeedTenancy(
      { exec: fakeSeamExec(), client: 'better-sqlite3', ledger: noLedger },
      log.logger,
    );

    // Functional absence, not a durability failure: nothing claimed to persist
    // and then did not — the ledger simply is not composed on this kernel.
    expect(log.error).toEqual([]);
    expect(log.warn.join('\n')).toContain('not registered on this kernel');
  });

  it('[the receipt is out of the repair\'s own reach] sys_migration can never be re-tenanted by it', async () => {
    const log = createLogger();
    // The receipt row carries a kernel-injected `organization_id` like every
    // other row, and it is written BEFORE any organization is adopted. If the
    // repair could see `sys_` objects it would be rewriting its own evidence.
    const result = await backfillSeedTenancy(
      {
        exec: async (sql: string) => {
          if (sql.includes('LEFT JOIN')) {
            return [
              { object: 'sys_migration', field: 'seq', global_last_value: 7, organization_last_value: 2 },
            ];
          }
          return [];
        },
        client: 'better-sqlite3',
      },
      log.logger,
    );

    // PLATFORM_NAMESPACE (`^(sys_|cloud_|ai_)`) filters it out of the split
    // probe itself, so the guard is the mechanism and not the fixture: the
    // repair reports a healthy install and touches nothing.
    expect(result.status).toBe('no-split');
    expect(result.splits).toEqual([]);
    expect(result.objectsStamped).toBe(0);
  });

  it('[resolver] the ledger rides on the seam, and only when the host is an engine', () => {
    const engine = {
      driver: { execute: async () => [], config: { client: 'better-sqlite3' } },
      getObject: () => ({}),
      find: async () => [],
      insert: async () => ({}),
      update: async (_object: string, data: Record<string, unknown>, opts?: Record<string, unknown>) => {
        assertEngineUpdateDispatch(data as any, opts as any);
        return {};
      },
    };
    expect(resolveSeedTenancySeam(engine)?.ledger).toBeDefined();

    // A driver-only host resolves an exec but no ledger — the repair still runs
    // and says, loudly, that it could not record itself.
    expect(resolveSeedTenancySeam({ driver: { execute: async () => [] } })?.ledger).toBeUndefined();
    expect(resolveSeedTenancyLedger({ getObject: () => ({}), find: async () => [] })).toBeUndefined();
  });
});
