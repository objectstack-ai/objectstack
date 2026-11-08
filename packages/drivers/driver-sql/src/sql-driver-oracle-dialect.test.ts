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

  it('a Date against a NON-temporal column is bound as the canonical instant text, not a TIMESTAMP', () => {
    // Bound as TIMESTAMP WITH TIME ZONE, Oracle would convert the TEXT column
    // to compare it, and raise on every row that is not a timestamp.
    const { bindings } = probe().compileWhere({ name: { $gte: new Date('2020-01-01T00:00:00.000Z') as any } });
    expect(bindings[0]).toBe('2020-01-01T00:00:00.000Z');
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

describe("#31328 $empty on a text column is the null row (Oracle stores '' as NULL)", () => {
  it('$empty: true compiles IS NULL, with no comparison against an empty string', () => {
    const { sql, bindings } = probe().compileWhere({ name: { $empty: true } });
    expect(sql).toBe('select * from "CUST" where "FULL_NAME" is null');
    expect(bindings).toEqual([]);
  });

  it('$empty: false compiles IS NOT NULL — `<> \'\'` would be UNKNOWN on every row', () => {
    const { sql, bindings } = probe().compileWhere({ name: { $empty: false } });
    expect(sql).toBe('select * from "CUST" where "FULL_NAME" is not null');
    expect(bindings).toEqual([]);
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

// ── #31390 RAW(16) uuid columns bind through HEXTORAW ────────────────────────

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const UUID_HEX = '0F8FAD5BD9CB469FA16570867728950E';
const UUID_2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const UUID_2_HEX = '7C9E6679742540DE944BE07FC1F90AE7';

/**
 * An Oracle driver whose catalog read is answered from `catalog` (remote
 * table → its RAW(16) columns; a missing entry throws, as a failed read), and
 * whose statements are captured instead of sent: `_query` records the SQL
 * and bindings and answers `respond(obj)` as the rows.
 */
class OracleUuidProbe extends SqlDriver {
  catalogReads: string[] = [];
  sent: Array<{ sql: string; bindings: unknown[] }> = [];
  respond: (obj: { sql: string; method?: string }) => unknown[] = () => [];
  constructor(private readonly catalog: Record<string, string[]>) {
    super(ORACLE_CONFIG as any);
    (this as any).name = 'ora';
    this.registerExternalObject({
      name: 'acct',
      external: { remoteName: 'ACCT', columnMap: { ACCT_ID: 'id', NAME: 'name' } },
      fields: { name: { type: 'text' } },
    } as any);
    this.registerExternalObject({
      name: 'ord',
      external: {
        remoteName: 'ORD',
        columnMap: { ORD_ID: 'id', ACCT_REF: 'account', LEGACY_REF: 'legacy_account', NOTE: 'note' },
      },
      fields: {
        account: { type: 'lookup', reference: 'acct' },
        // The control: a lookup over a VARCHAR2 uuid column (the catalog does not list it).
        legacy_account: { type: 'lookup', reference: 'acct' },
        note: { type: 'text' },
      },
    } as any);
    const client = (this as any).knex.client;
    client.acquireConnection = async () => ({});
    client.releaseConnection = async () => undefined;
    client._query = async (_conn: unknown, obj: any) => {
      this.sent.push({ sql: obj.sql, bindings: obj.bindings });
      obj.response = this.respond(obj);
      obj.rowsAffected = 1;
      return obj;
    };
  }
  protected override readOracleRawUuidColumns(remoteTable: string): Promise<string[]> {
    this.catalogReads.push(remoteTable);
    const columns = this.catalog[remoteTable];
    return columns ? Promise.resolve(columns) : Promise.reject(new Error('ORA-00942 (stubbed)'));
  }
  prime(object: string): Promise<void> {
    return (this as any).primeOracleRawUuidColumns(object);
  }
  compileWhere(object: string, where: FilterCondition): Knex.Sql {
    const b = (this as any).getBuilder(object);
    this.applyFilters(b, where);
    return b.toSQL();
  }
  compileInsert(object: string, row: Record<string, unknown>): Knex.Sql {
    const formatted = (this as any).applyWriteColumnMap(object, (this as any).formatInput(object, row));
    return (this as any).getBuilder(object).insert(formatted).toSQL();
  }
}

const CATALOG = { ACCT: ['ACCT_ID'], ORD: ['ORD_ID', 'ACCT_REF'] };
const primed = async () => {
  const p = new OracleUuidProbe(CATALOG);
  await p.prime('acct');
  await p.prime('ord');
  return p;
};
const caught = (fn: () => unknown): Error & { code?: string; status?: number } => {
  try {
    fn();
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
  throw new Error('expected a refusal');
};

describe('#31390 a RAW(16) uuid comparand binds as HEXTORAW(?) over its hex digits', () => {
  it('equality on a lookup over a RAW(16) column', async () => {
    const { sql, bindings } = (await primed()).compileWhere('ord', { account: UUID });
    expect(sql).toBe('select * from "ORD" where "ACCT_REF" = HEXTORAW(?)');
    expect(bindings).toEqual([UUID_HEX]);
  });

  it('$eq on the SYS_GUID key itself (the mapped id)', async () => {
    const { sql, bindings } = (await primed()).compileWhere('acct', { id: { $eq: UUID } });
    expect(sql).toBe('select * from "ACCT" where "ACCT_ID" = HEXTORAW(?)');
    expect(bindings).toEqual([UUID_HEX]);
  });

  it('$in binds every member, upper- or lower-case input alike', async () => {
    const { sql, bindings } = (await primed()).compileWhere('ord', { account: { $in: [UUID, UUID_2.toUpperCase()] } });
    expect(sql).toBe('select * from "ORD" where "ACCT_REF" in (HEXTORAW(?), HEXTORAW(?))');
    expect(bindings).toEqual([UUID_HEX, UUID_2_HEX]);
  });

  it('the 32 hex digits undashed (the RAWTOHEX form) bind the same bytes', async () => {
    const { sql, bindings } = (await primed()).compileWhere('acct', { id: UUID_HEX.toLowerCase() });
    expect(sql).toBe('select * from "ACCT" where "ACCT_ID" = HEXTORAW(?)');
    expect(bindings).toEqual([UUID_HEX]);
  });

  it('$ne keeps its null-safe shape around the bound comparand', async () => {
    const { sql, bindings } = (await primed()).compileWhere('ord', { account: { $ne: UUID } });
    expect(sql).toBe('select * from "ORD" where ("ACCT_REF" is null or "ACCT_REF" <> HEXTORAW(?))');
    expect(bindings).toEqual([UUID_HEX]);
  });

  it('a null comparand stays IS NULL', async () => {
    const { sql, bindings } = (await primed()).compileWhere('ord', { account: null });
    expect(sql).toBe('select * from "ORD" where "ACCT_REF" is null');
    expect(bindings).toEqual([]);
  });

  it('control: a lookup over a VARCHAR2 uuid column binds the text, as before', async () => {
    const { sql, bindings } = (await primed()).compileWhere('ord', { legacy_account: UUID });
    expect(sql).toBe('select * from "ORD" where "LEGACY_REF" = ?');
    expect(bindings).toEqual([UUID]);
  });

  it('control: a pattern operator on the RAW(16) column compiles its text pattern as before, unjudged', async () => {
    const { sql, bindings } = (await primed()).compileWhere('ord', { account: { $contains: 'abc' } });
    expect(sql).toBe('select * from "ORD" where "ACCT_REF" LIKE ? ESCAPE ?');
    expect(bindings).toEqual(['%abc%', '\\']);
  });

  it('control: a uuid-shaped value in a text column binds the text — the value is never the evidence', async () => {
    const { sql, bindings } = (await primed()).compileWhere('ord', { note: UUID });
    expect(sql).toBe('select * from "ORD" where "NOTE" = ?');
    expect(bindings).toEqual([UUID]);
  });
});

describe('#31390 a comparand that is not uuid text is INVALID_FILTER, never sent', () => {
  for (const [label, where] of [
    ['equality', { account: 'not-a-uuid' }],
    ['$eq with valid hex of another length', { account: { $eq: '0f8fad5b' } }],
    ['$in holding one bad member', { account: { $in: [UUID, 'nope'] } }],
    ['$ne with a number', { account: { $ne: 42 } }],
    ['31 hex digits', { id: UUID_HEX.slice(1) }],
  ] as const) {
    it(`${label}: INVALID_FILTER / 400`, async () => {
      const p = await primed();
      const err = caught(() => p.compileWhere(label === '31 hex digits' ? 'acct' : 'ord', where as FilterCondition));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });
  }

  it('through the find door: refused, and no statement reaches the database', async () => {
    const p = await primed();
    await expect(p.find('ord', { where: { account: 'not-a-uuid' } })).rejects.toMatchObject({
      code: 'INVALID_FILTER',
      status: 400,
    });
    expect(p.sent).toEqual([]);
  });
});

describe('#31390 a written RAW(16) uuid value binds as HEXTORAW(?)', () => {
  it('insert: the key and the lookup bind through HEXTORAW, the text column as text', async () => {
    const { sql, bindings } = (await primed()).compileInsert('ord', { id: UUID, account: UUID_2, legacy_account: UUID, note: 'x' });
    expect(sql).toBe('insert into "ORD" ("ACCT_REF", "LEGACY_REF", "NOTE", "ORD_ID") values (HEXTORAW(?), ?, ?, HEXTORAW(?))');
    expect(bindings).toEqual([UUID_2_HEX, UUID, 'x', UUID_HEX]);
  });

  it('a null write stays a null bind', async () => {
    const { sql, bindings } = (await primed()).compileInsert('ord', { id: UUID, account: null });
    expect(sql).toBe('insert into "ORD" ("ACCT_REF", "ORD_ID") values (?, HEXTORAW(?))');
    expect(bindings).toEqual([null, UUID_HEX]);
  });

  it('a value that is not uuid text is VALIDATION_ERROR / 400 through create, and nothing is sent', async () => {
    const p = await primed();
    await expect(p.create('ord', { id: UUID, account: 'acct-17' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(p.sent).toEqual([]);
  });

  it('update by key: the SET value and the key bind through HEXTORAW, and the read-back is by the same key', async () => {
    const p = await primed();
    await p.update('ord', UUID, { account: UUID_2 });
    expect(p.sent.map((s) => s.sql)).toEqual([
      'update "ORD" set "ACCT_REF" = HEXTORAW(:1) where "ORD_ID" = HEXTORAW(:2)',
      'select * from "ORD" where "ORD_ID" = HEXTORAW(:1) fetch next :2 rows only',
    ]);
    expect(p.sent[0]!.bindings).toEqual([UUID_2_HEX, UUID_HEX]);
    expect(p.sent[1]!.bindings).toEqual([UUID_HEX, 1]);
  });

  it('delete and bulkDelete by key bind through HEXTORAW', async () => {
    const p = await primed();
    await p.delete('ord', UUID);
    await p.bulkDelete('ord', [UUID, UUID_2]);
    expect(p.sent.map((s) => [s.sql, s.bindings])).toEqual([
      ['delete from "ORD" where "ORD_ID" = HEXTORAW(:1)', [UUID_HEX]],
      ['delete from "ORD" where "ORD_ID" in (HEXTORAW(:1), HEXTORAW(:2))', [UUID_HEX, UUID_2_HEX]],
    ]);
  });

  for (const [label, written] of [['upper-case', UUID.toUpperCase()], ['undashed', UUID_HEX]] as const) {
    it(`create reads its row back by the HEXTORAW key, matching a ${label} written id to the read form`, async () => {
      const p = await primed();
      p.respond = (obj) => (obj.sql.startsWith('select') ? [{ ORD_ID: UUID, ACCT_REF: UUID_2, NOTE: 'x' }] : []);
      const row = await p.create('ord', { id: written, account: UUID_2, note: 'x' });
      expect(p.sent.map((s) => s.sql)).toEqual([
        'insert into "ORD" ("ACCT_REF", "NOTE", "ORD_ID") values (HEXTORAW(:1), :2, HEXTORAW(:3))',
        'select * from "ORD" where "ORD_ID" in (HEXTORAW(:1))',
      ]);
      expect(row).toMatchObject({ id: UUID, account: UUID_2, note: 'x' });
    });
  }
});

describe('#31390 which columns: read from the catalog, once per object', () => {
  it('the doors read the catalog once per object, not once per statement', async () => {
    const p = new OracleUuidProbe(CATALOG);
    await p.find('ord', { where: { account: UUID } });
    await p.count('ord', { where: { account: UUID } });
    await p.find('acct', { where: { id: UUID } });
    await p.find('ord', { where: { account: UUID_2 } });
    expect(p.catalogReads).toEqual(['ORD', 'ACCT']);
    expect(p.sent.every((s) => s.sql.includes('HEXTORAW('))).toBe(true);
  });

  it('a failed catalog read records nothing: the statement binds text as before, and the next door asks again', async () => {
    const p = new OracleUuidProbe({});
    await p.find('ord', { where: { account: UUID } });
    expect(p.sent[0]).toMatchObject({ sql: 'select * from "ORD" where "ACCT_REF" = :1', bindings: [UUID] });
    await p.find('ord', { where: { account: UUID } });
    expect(p.catalogReads).toEqual(['ORD', 'ORD']);
  });

  it('an empty catalog answer (no RAW(16) column) binds text, and is not asked again', async () => {
    const p = new OracleUuidProbe({ ORD: [] });
    await p.find('ord', { where: { account: UUID } });
    await p.find('ord', { where: { account: 'not-a-uuid' } });
    expect(p.sent.map((s) => s.bindings)).toEqual([[UUID], ['not-a-uuid']]);
    expect(p.catalogReads).toEqual(['ORD']);
  });

  it('re-registering an object forgets its catalog reading', async () => {
    const p = await primed();
    p.registerExternalObject({
      name: 'ord',
      external: { remoteName: 'ORD', columnMap: { ORD_ID: 'id', ACCT_REF: 'account' } },
      fields: { account: { type: 'lookup', reference: 'acct' } },
    } as any);
    expect(p.compileWhere('ord', { account: UUID }).sql).toBe('select * from "ORD" where "ACCT_REF" = ?');
  });
});

describe('#31390 every other dialect binds exactly as before', () => {
  const ORD = {
    name: 'ord',
    external: { remoteName: 'ORD', columnMap: { ORD_ID: 'id', ACCT_REF: 'account', NOTE: 'note' } },
    fields: { account: { type: 'lookup', reference: 'acct' }, note: { type: 'text' } },
  };
  /** A non-Oracle driver whose uuid-column registry is POISONED: only the dialect guard keeps it out. */
  const poisoned = (config: Record<string, unknown>) => {
    const d = new SqlDriver({ ...config, schemaMode: 'external' } as any) as any;
    d.name = 'other';
    d.registerExternalObject(ORD);
    d.oracleRawUuidFieldsByObject.set('ord', new Set(['id', 'account']));
    d.readOracleRawUuidColumns = () => {
      throw new Error('the catalog read is Oracle-only');
    };
    return d;
  };

  for (const [client, where, insert] of [
    ['pg', 'select * from "ORD" where "ACCT_REF" = ?', 'insert into "ORD" ("ACCT_REF", "NOTE", "ORD_ID") values (?, ?, ?)'],
    ['mysql2', 'select * from `ORD` where `ACCT_REF` = ?', 'insert into `ORD` (`ACCT_REF`, `NOTE`, `ORD_ID`) values (?, ?, ?)'],
    ['mssql', 'select * from [ORD] where [ACCT_REF] = ?', 'insert into [ORD] ([ACCT_REF], [NOTE], [ORD_ID]) values (?, ?, ?)'],
  ] as const) {
    it(`${client}: comparands (coerceFilterValue) and written values (formatInput) are the text`, () => {
      const d = poisoned({ client, connection: { host: '127.0.0.1', port: 1 } });
      const sel = d.getBuilder('ord');
      d.applyFilters(sel, { account: UUID });
      expect(sel.toSQL().sql).toBe(where);
      expect(sel.toSQL().bindings).toEqual([UUID]);
      const sel2 = d.getBuilder('ord');
      d.applyFilters(sel2, { account: 'not-a-uuid' });
      expect(sel2.toSQL().bindings).toEqual(['not-a-uuid']);
      const ins = d.getBuilder('ord').insert(d.applyWriteColumnMap('ord', d.formatInput('ord', { id: UUID, account: UUID_2, note: 'x' }))).toSQL();
      expect(ins.sql).toBe(insert);
      expect(ins.bindings).toEqual([UUID_2, 'x', UUID]);
    });
  }

  it('sqlite: the doors (find, create, update, delete, bulkDelete) and the read-back send the same statements', async () => {
    const d = poisoned({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await d.connect();
    try {
      await d.knex.raw('create table ORD (ORD_ID text primary key, ACCT_REF text, NOTE text)');
      const sent: Array<[string, unknown[]]> = [];
      d.knex.on('query', (q: { sql: string; bindings: unknown[] }) => sent.push([q.sql, q.bindings]));
      await d.create('ord', { id: UUID, account: UUID_2, note: 'x' });
      await d.find('ord', { where: { account: UUID_2 } });
      await d.update('ord', UUID, { account: UUID });
      await d.readBackInsertedRows('ord', 'ord', [{ id: UUID }]);
      await d.delete('ord', UUID);
      await d.bulkDelete('ord', [UUID, UUID_2]);
      expect(sent).toEqual([
        ['insert into `ORD` (`ACCT_REF`, `NOTE`, `ORD_ID`) values (?, ?, ?) returning *', [UUID_2, 'x', UUID]],
        ['select * from `ORD` where `ACCT_REF` = ?', [UUID_2]],
        ['update `ORD` set `ACCT_REF` = ? where `ORD_ID` = ?', [UUID, UUID]],
        ['select * from `ORD` where `ORD_ID` = ? limit ?', [UUID, 1]],
        ['select * from `ORD` where `ORD_ID` in (?)', [UUID]],
        ['delete from `ORD` where `ORD_ID` = ?', [UUID]],
        ['delete from `ORD` where `ORD_ID` in (?, ?)', [UUID, UUID_2]],
      ]);
    } finally {
      await d.disconnect();
    }
  });
});
