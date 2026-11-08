// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31328 — Oracle as a federation dialect, decided WITHOUT a server.
 *
 * knex compiles a statement for whichever client it was configured with, so
 * every Oracle arm this driver emits is checkable here: the row-limiting
 * clause, the text-match constructs, the date buckets, the bindings a
 * temporal comparand becomes, and every refusal (DDL, upsert, `''`, JSON
 * membership). The live cell — the same arms EXECUTED against Oracle — is
 * `sql-driver-oracle-federation-live.test.ts`, opt-in via
 * `OS_TEST_ORACLE_URL`. No connection is opened here: knex builds its pool
 * lazily, and nothing below runs a statement.
 */

import { describe, it, expect } from 'vitest';
import type { Knex } from 'knex';
import type { FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './index.js';
import {
  ORACLE_SESSION_SETUP_SQL,
  oracleDayBinding,
  oracleInstantBinding,
  oracleRaw16AsUuid,
  oracleWallClockAsUtc,
  withOracleFederationClient,
} from './sql-driver-oracle-dialect.js';
import { oracleColumnTypeString } from './sql-driver-oracle-introspection.js';
import { UnsupportedDialectEmissionError } from './dialect-emission-refusal.js';

const ORACLE_CONFIG = {
  client: 'oracledb',
  // Never dialled: knex opens a connection only when a statement runs.
  connection: { user: 'nobody', password: 'unused', connectString: '127.0.0.1:1/NONE' },
  schemaMode: 'external',
} as const;

class OracleProbe extends SqlDriver {
  constructor() {
    super(ORACLE_CONFIG as any);
    (this as any).name = 'ora';
    this.registerExternalObject({
      name: 'cust',
      external: {
        remoteName: 'CUST',
        columnMap: { CUST_ID: 'id', FULL_NAME: 'name', SIGNUP: 'signup', SEEN_AT: 'seen_at', TAGS: 'tags', ACTIVE: 'active' },
      },
      fields: {
        name: { type: 'text' },
        signup: { type: 'date' },
        seen_at: { type: 'datetime' },
        tags: { type: 'tags' },
        active: { type: 'boolean' },
      },
    } as any);
  }
  builder(): Knex.QueryBuilder {
    return (this as any).getBuilder('cust');
  }
  compileWhere(where: FilterCondition): Knex.Sql {
    const b = this.builder();
    this.applyFilters(b, where);
    return b.toSQL();
  }
}

const probe = () => new OracleProbe();

describe('#31328 the Oracle client: identity and paging', () => {
  it('dialectName is oracle', () => {
    expect((probe() as any).dialectName).toBe('oracle');
  });

  it('pages with OFFSET … ROWS FETCH NEXT … ROWS ONLY, after the ORDER BY, and never the ROWNUM wrapper', () => {
    const sql = probe().builder().select('*').orderBy('CUST_ID').offset(10).limit(5).toSQL();
    expect(sql.sql).toBe('select * from "CUST" order by "CUST_ID" asc offset ? rows fetch next ? rows only');
    expect(sql.bindings).toEqual([10, 5]);
    expect(sql.sql).not.toMatch(/rownum/i);
  });

  it('a limit alone fetches without an offset; an offset of 0 is omitted', () => {
    expect(probe().builder().select('*').orderBy('CUST_ID').limit(3).toSQL().sql)
      .toBe('select * from "CUST" order by "CUST_ID" asc fetch next ? rows only');
    expect(probe().builder().select('*').orderBy('CUST_ID').offset(0).limit(3).toSQL().sql)
      .toBe('select * from "CUST" order by "CUST_ID" asc fetch next ? rows only');
  });

  it('quotes identifiers as written, so an UPPER-case catalog name is the one the statement names', () => {
    const sql = probe().compileWhere({ name: 'Aurora' });
    expect(sql.sql).toBe('select * from "CUST" where "FULL_NAME" = ?');
  });
});

describe('#31328 text matching (#6518 contract)', () => {
  it('$contains is a case-exact LIKE with a bound ESCAPE', () => {
    const { sql, bindings } = probe().compileWhere({ name: { $contains: '50%_' } });
    expect(sql).toBe('select * from "CUST" where "FULL_NAME" LIKE ? ESCAPE ?');
    expect(sql).not.toMatch(/lower|upper|translate/i);
    expect(bindings).toEqual(['%50\\%\\_%', '\\']);
  });

  it('$icontains folds BOTH sides with the ASCII-only translate()', () => {
    const { sql } = probe().compileWhere({ name: { $icontains: 'acme' } });
    const fold = `'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'`;
    expect(sql).toBe(`select * from "CUST" where translate("FULL_NAME", ${fold}) LIKE translate(?, ${fold}) ESCAPE ?`);
    expect(sql).not.toMatch(/lower\(|upper\(/i);
  });

  it('$startsWith anchors the pattern on the left', () => {
    const { bindings } = probe().compileWhere({ name: { $startsWith: 'Bor' } });
    expect(bindings[0]).toBe('Bor%');
  });
});

describe("#31328 '' is NULL in Oracle — refused, never answered", () => {
  const refusal = (where: FilterCondition) => {
    try {
      probe().compileWhere(where);
    } catch (e) {
      return e as Error & { code?: string; status?: number };
    }
    throw new Error('expected the filter refused');
  };

  for (const [label, where] of [
    ['equality', { name: '' }],
    ['$eq', { name: { $eq: '' } }],
    ['$ne', { name: { $ne: '' } }],
    ['$in holding the empty string', { name: { $in: ['a', ''] } }],
    ['$nin holding the empty string', { name: { $nin: [''] } }],
    ['$gt', { name: { $gt: '' } }],
  ] as const) {
    it(`${label}: INVALID_FILTER / 400, pointing at $null / $empty`, () => {
      const err = refusal(where as FilterCondition);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('empty-string comparand on an Oracle table');
      expect(err.message).toContain('"$null"');
    });
  }

  it('the pattern operators keep compiling: their pattern is built before binding', () => {
    expect(() => probe().compileWhere({ name: { $contains: '' } })).not.toThrow();
    expect(() => probe().compileWhere({ name: { $startsWith: '' } })).not.toThrow();
  });

  it('$null / $empty — the spelling the refusal prescribes — compile', () => {
    expect(probe().compileWhere({ name: { $null: true } }).sql).toMatch(/"FULL_NAME" is null/);
    expect(() => probe().compileWhere({ name: { $empty: true } })).not.toThrow();
  });
});

describe('#31328 JSON-array membership has no Oracle construct — refused', () => {
  it('$contains on a multi-value field is INVALID_FILTER, not a substring test over the JSON text', () => {
    let err: (Error & { code?: string }) | undefined;
    try {
      probe().compileWhere({ tags: { $contains: 'red' } });
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.message).toContain('not modelled for Oracle');
  });
});

describe('#31328 temporal comparands bind as instants, never as text', () => {
  it('a datetime comparand is a Date (sent as TIMESTAMP WITH TIME ZONE at +00:00)', () => {
    const { bindings } = probe().compileWhere({ seen_at: { $gt: '2026-01-10T08:00:00.000Z' } });
    expect(bindings[0]).toBeInstanceOf(Date);
    expect((bindings[0] as Date).toISOString()).toBe('2026-01-10T08:00:00.000Z');
  });

  it("a date comparand is its day's UTC midnight", () => {
    const { bindings } = probe().compileWhere({ signup: '2026-02-15' });
    expect((bindings[0] as Date).toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });

  it('a value that is not a canonical instant or day is passed through for Oracle to refuse', () => {
    expect(oracleInstantBinding('not a date')).toBe('not a date');
    expect(oracleDayBinding('2026-02')).toBe('2026-02');
    expect(oracleInstantBinding(42)).toBe(42);
  });

  it('the client binds every Date as DB_TYPE_TIMESTAMP_TZ, and a boolean as 1 / 0', () => {
    const d = probe();
    const client = (d as any).knex.client;
    const at = new Date('2026-03-10T02:30:00.000Z');
    const [date, flag, text] = client.prepBindings([at, true, 'x']);
    expect(date).toEqual({ val: at, type: client.driver.DB_TYPE_TIMESTAMP_TZ });
    expect(flag).toBe(1);
    expect(text).toBe('x');
  });
});

describe('#31328 read presentation', () => {
  it('a zone-less DATE / TIMESTAMP is read as the UTC instant its wall clock names', () => {
    // node-oracledb Thin builds the Date with the LOCAL constructor.
    const materialised = new Date(2026, 0, 10, 8, 0, 0, 250);
    expect((oracleWallClockAsUtc(materialised) as Date).toISOString()).toBe('2026-01-10T08:00:00.250Z');
    expect(oracleWallClockAsUtc(null)).toBe(null);
  });

  it('RAW(16) reads as a lowercase hyphenated uuid; any other width stays a Buffer', () => {
    const raw = Buffer.from('5FBBE5DF2AC00247E063020011AC1F54', 'hex');
    expect(oracleRaw16AsUuid(raw)).toBe('5fbbe5df-2ac0-0247-e063-020011ac1f54');
    const eight = Buffer.alloc(8);
    expect(oracleRaw16AsUuid(eight)).toBe(eight);
  });
});

describe('#31328 date buckets', () => {
  it.each([
    ['year', `to_char(sys_extract_utc("SEEN_AT"), 'YYYY')`],
    ['month', `to_char(sys_extract_utc("SEEN_AT"), 'YYYY-MM')`],
    ['day', `to_char(sys_extract_utc("SEEN_AT"), 'YYYY-MM-DD')`],
    ['quarter', `to_char(sys_extract_utc("SEEN_AT"), 'YYYY"-Q"Q')`],
    ['week', `to_char(sys_extract_utc("SEEN_AT"), 'IYYY"-W"IW')`],
  ] as const)('a datetime field buckets by %s in UTC, over its mapped column', (granularity, expected) => {
    const bucket = (probe() as any).buildDateBucketExpr('seen_at', granularity, 'cust', 'SEEN_AT');
    expect((probe() as any).knex.raw(bucket.sql, bucket.bindings).toQuery()).toBe(expected);
  });

  it('a date field keeps its calendar day (no zone conversion)', () => {
    const bucket = (probe() as any).buildDateBucketExpr('signup', 'month', 'cust', 'SIGNUP');
    expect(bucket.sql).toBe(`to_char(??, 'YYYY-MM')`);
  });
});

describe('#31328 federation only: no DDL, no upsert', () => {
  it('schema emission is refused by name, with the federation-only reason', async () => {
    // A MANAGED driver over the oracle client — the configuration the spec
    // refuses at authoring; the external-mode gate would answer first otherwise.
    const managed = new SqlDriver({ ...ORACLE_CONFIG, schemaMode: 'managed' } as any);
    const err = await managed.initObjects([{ name: 'anything', fields: { a: { type: 'text' } } } as any]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnsupportedDialectEmissionError);
    expect((err as UnsupportedDialectEmissionError).reason).toBe('federation-only');
    expect((err as Error).message).toContain("is a federation-only dialect");
    expect((err as Error).message).toContain("schemaMode: 'external'");
  });

  it('upsert is NOT_IMPLEMENTED / 501, before any statement is built', async () => {
    const err = (await probe().upsert('cust', { id: 'c1', name: 'x' }).then(() => null, (e: unknown) => e)) as
      | (Error & { code?: string; status?: number })
      | null;
    expect(err?.code).toBe('NOT_IMPLEMENTED');
    expect(err?.status).toBe(501);
    expect(err?.message).toContain('MERGE');
  });
});

describe('#31328 the connection', () => {
  it('every pooled connection runs the session pin, then the host afterCreate', async () => {
    const ran: string[] = [];
    const config = withOracleFederationClient({
      client: 'oracledb',
      pool: { min: 0, afterCreate: (_c: unknown, done: (e?: unknown) => void) => { ran.push('host'); done(); } },
    });
    const connection = { execute: async (sql: string) => { ran.push(sql); } };
    await new Promise<void>((resolve, reject) => config.pool.afterCreate(connection, (e: unknown) => (e ? reject(e) : resolve())));
    expect(ran).toEqual([ORACLE_SESSION_SETUP_SQL, 'host']);
    expect(ORACLE_SESSION_SETUP_SQL).toContain("TIME_ZONE = 'UTC'");
    expect(ORACLE_SESSION_SETUP_SQL).toContain("NLS_COMP = 'BINARY'");
  });

  it('every other client config is returned untouched', () => {
    const pg = { client: 'pg', connection: {} };
    expect(withOracleFederationClient(pg)).toBe(pg);
  });
});

describe('#31328 introspection type strings', () => {
  it.each([
    [{ DATA_TYPE: 'NUMBER', DATA_PRECISION: 10, DATA_SCALE: 2, DATA_LENGTH: 22 }, 'NUMBER(10,2)'],
    [{ DATA_TYPE: 'NUMBER', DATA_PRECISION: 10, DATA_SCALE: 0, DATA_LENGTH: 22 }, 'NUMBER(10,0)'],
    [{ DATA_TYPE: 'NUMBER', DATA_PRECISION: null, DATA_SCALE: 0, DATA_LENGTH: 22 }, 'NUMBER(*,0)'],
    [{ DATA_TYPE: 'NUMBER', DATA_PRECISION: null, DATA_SCALE: null, DATA_LENGTH: 22 }, 'NUMBER'],
    [{ DATA_TYPE: 'RAW', DATA_PRECISION: null, DATA_SCALE: null, DATA_LENGTH: 16 }, 'RAW(16)'],
    [{ DATA_TYPE: 'TIMESTAMP(6) WITH TIME ZONE', DATA_PRECISION: null, DATA_SCALE: 6, DATA_LENGTH: 13 }, 'TIMESTAMP(6) WITH TIME ZONE'],
  ] as const)('%o → %s', (row, expected) => {
    expect(oracleColumnTypeString(row as any)).toBe(expected);
  });
});
