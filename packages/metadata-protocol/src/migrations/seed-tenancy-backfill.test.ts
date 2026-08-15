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
    expect(sql).toContain(SEQUENCES_TABLE);
  });

  it('the stamp excludes identifiers already taken in the target organization', () => {
    const sql = buildStampSql('crm_case', ['case_number']);
    expect(sql).toContain(`UPDATE "crm_case" SET "${ORGANIZATION_FIELD}" = ?`);
    expect(sql).toContain(`WHERE "${ORGANIZATION_FIELD}" IS NULL`);
    // Without this the whole UPDATE is refused by the partitioned unique index on
    // any install that already minted duplicates, rolling back even the rows that
    // had no conflict.
    expect(sql).toContain('"case_number" NOT IN (SELECT "case_number" FROM "crm_case"');
  });

  it('the stamp guards EVERY split field of a multi-autonumber object', () => {
    const sql = buildStampSql('crm_case', ['case_number', 'ticket_no']);
    expect(sql).toContain('"case_number" NOT IN');
    expect(sql).toContain('"ticket_no" NOT IN');
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
    expect(buildCounterMergeSql()).toContain('SET last_value = ?');
    expect(buildCounterMergeSql()).toContain('WHERE object = ? AND field = ? AND tenant_id = ?');
    expect(buildGlobalCounterDeleteSql()).toContain('WHERE object = ? AND field = ? AND tenant_id = ?');
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
