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
import {
  normalizeRows,
  resolveSeedTenancySeam,
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
} from './seed-tenancy-backfill.js';

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
