// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20024] Both of `TursoDriver`'s compilers read the whole STORED value for a
 * `$like` / `$ilike` pattern WITHOUT U+0000, and answer the same rows.
 *
 * LOCAL mode inherits `SqlDriver`'s `likePatternPredicate`; REMOTE mode
 * compiles in `RemoteTransport.pushLikePattern`, an independent emitter that
 * restates the same rule. Both emitted `GLOB`, and `glob()` reads the stored
 * value as a C string, only up to its first U+0000. Measured at base
 * `fe677aeeed` on local mode and on remote mode over a real `@libsql/client`
 * engine (SQLite 3.45.1) alike: `$like: 'a'` returned `'a'` + U+0000 + `'b'`,
 * and `$like: '_'` missed a lone U+0000. Both now rewrite a value holding
 * U+0000 before `GLOB` reads it, each U+0000 becoming one stand-in character
 * the pattern never names literally.
 *
 * Each case asserts the JavaScript answer on EVERY transport, not merely that
 * they agree: parity alone is satisfied by breaking all of them the same way.
 * REMOTE runs twice — on `makeLibsqlSqliteStub` (better-sqlite3 behind the
 * `@libsql/client` interface) and on a real `@libsql/client` `file::memory:`
 * engine — so the libSQL build's own answer is pinned, not only the stub's. A
 * real Turso server, and its wire encoding of a string holding U+0000, are not
 * measured here. The last case holds the two emitters to one statement text.
 *
 * The literal rows are the ones `driver-sql`'s `sql-driver-20024-like-stored-nul`
 * suite pins and checks against `@objectstack/formula`. This package does not
 * depend on `formula`, so its wider grid is held to the spec's own
 * `matchesLikePattern`, the translation `formula` evaluates `$like` / `$ilike`
 * by (a NULL value matches no pattern).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { matchesLikePattern } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const NUL = String.fromCharCode(0x00);
const SOH = String.fromCharCode(0x01);
const OBJECT = { name: 'stored_nul_like', fields: { label: { type: 'string' }, v: { type: 'text' } } };

/** label → stored value: U+0000 leading, interior, trailing, doubled, and none. */
const ROWS: Readonly<Record<string, string | null>> = {
  nul_mid: 'a' + NUL + 'b',
  nul_trail: 'ab' + NUL,
  nul_lead: NUL + 'z',
  nul_only: NUL,
  nul_two: NUL + NUL,
  nul_multi: 'a' + NUL + 'b' + NUL + 'c',
  upper_nul: 'A' + NUL + 'B',
  pct_nul: '%' + NUL + '_',
  bs_nul: '\\' + NUL + '\\',
  mb_nul: 'é' + NUL + 'ü',
  cjk_nul: '中' + NUL + '文',
  soh_nul: SOH + NUL + SOH,
  a: 'a',
  ab: 'ab',
  a_b: 'a_b',
  a_soh_b: 'a' + SOH + 'b',
  eu: 'éü',
  empty: '',
  missing: null,
};

const EVERY_VALUE = Object.keys(ROWS).filter((l) => ROWS[l] !== null).sort();

const CASES: ReadonlyArray<{ name: string; where: DriverQuery['where']; expected: readonly string[] }> = [
  { name: "$like 'a'", where: { v: { $like: 'a' } }, expected: ['a'] },
  { name: "$like ''", where: { v: { $like: '' } }, expected: ['empty'] },
  { name: "$like '%b'", where: { v: { $like: '%b' } }, expected: ['a_b', 'a_soh_b', 'ab', 'nul_mid'] },
  { name: "$like 'a_b'", where: { v: { $like: 'a_b' } }, expected: ['a_b', 'a_soh_b', 'nul_mid'] },
  { name: "$like '_'", where: { v: { $like: '_' } }, expected: ['a', 'nul_only'] },
  { name: "$like '__'", where: { v: { $like: '__' } }, expected: ['ab', 'eu', 'nul_lead', 'nul_two'] },
  { name: "$like 'a%c'", where: { v: { $like: 'a%c' } }, expected: ['nul_multi'] },
  { name: "$like '%%'", where: { v: { $like: '%%' } }, expected: EVERY_VALUE },
  { name: "$like 'é_ü'", where: { v: { $like: 'é_ü' } }, expected: ['mb_nul'] },
  { name: "$like '\\%_\\_'", where: { v: { $like: '\\%_\\_' } }, expected: ['pct_nul'] },
  { name: "$like '\\\\_\\\\'", where: { v: { $like: '\\\\_\\\\' } }, expected: ['bs_nul'] },
  { name: "$like 'ab%'", where: { v: { $like: 'ab%' } }, expected: ['ab', 'nul_trail'] },
  { name: "$like 'ab_'", where: { v: { $like: 'ab_' } }, expected: ['nul_trail'] },
  { name: "$like '_' + U+0001 + '_'", where: { v: { $like: '_' + SOH + '_' } }, expected: ['a_soh_b'] },
  { name: "$ilike 'A_B'", where: { v: { $ilike: 'A_B' } }, expected: ['a_b', 'a_soh_b', 'nul_mid', 'upper_nul'] },
  { name: "$ilike 'É_Ü'", where: { v: { $ilike: 'É_Ü' } }, expected: [] },
  {
    name: "$not $like 'a_b'",
    where: { $not: { v: { $like: 'a_b' } } },
    expected: EVERY_VALUE.filter((l) => !['a_b', 'a_soh_b', 'nul_mid'].includes(l)).concat('missing').sort(),
  },
  {
    name: "$or [$like '_', $like '%c']",
    where: { $or: [{ v: { $like: '_' } }, { v: { $like: '%c' } }] },
    expected: ['a', 'nul_multi', 'nul_only'],
  },
  {
    name: "$and [$like 'a%', $like '%b']",
    where: { $and: [{ v: { $like: 'a%' } }, { v: { $like: '%b' } }] },
    expected: ['a_b', 'a_soh_b', 'ab', 'nul_mid'],
  },
  {
    name: "$not $or [$like '%b', $ilike 'A%']",
    where: { $not: { $or: [{ v: { $like: '%b' } }, { v: { $ilike: 'A%' } }] } },
    expected: [
      'bs_nul', 'cjk_nul', 'empty', 'eu', 'mb_nul', 'missing', 'nul_lead', 'nul_only', 'nul_two', 'pct_nul', 'soh_nul',
    ],
  },
];

/** The wider grid: every pattern below is held to the spec's `matchesLikePattern` on every transport. */
const GRID: ReadonlyArray<readonly ['$like' | '$ilike', string]> = [
  ...[
    '', '%', '%%', '_', '__', '___', 'a', 'b', 'z', 'ab', 'a%', '%a', '%a%', 'a_', '_b', 'a_b', 'a%b', '%b', '%z',
    '_z', 'ab%', 'ab_', 'ab_%', 'a%b%c', '%b%', '__b', 'a__b', '%_%', '_%', '%_', '_%_', '\\%', '\\_', '\\\\',
    '%\\%%', '%\\_%', '\\%_\\_', '\\\\_\\\\', '%\\\\', 'é%', '%ü', 'é_ü', '_ü', '中%', '%文', '中_文', '%c', 'a%c',
    '%' + SOH + '%', SOH + '_' + SOH, '_' + SOH + '_', SOH + '%', '_' + SOH,
  ].map((p) => ['$like', p] as const),
  ...['', '%', '_', 'A%', '%B', 'A_B', 'AB', 'a_b', '%A%', 'É%', 'é_ü', 'É_Ü', '\\A%', '%' + SOH + '%'].map(
    (p) => ['$ilike', p] as const,
  ),
];

/** The spec's own answer for one bare pattern over the same rows. */
function specAnswer(op: '$like' | '$ilike', pattern: string): string[] {
  return Object.entries(ROWS)
    .filter(([, v]) => typeof v === 'string' && matchesLikePattern(v, pattern, op === '$ilike'))
    .map(([label]) => label)
    .sort();
}

/** A real libSQL client whose `execute` also records each statement and its args. */
function recordingClient(inner: Client): { client: Client; calls: Array<{ sql: string; args: unknown[] }> } {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const client = new Proxy(inner, {
    get(target, prop) {
      if (prop === 'execute') {
        return (stmt: InStatement, ...rest: unknown[]) => {
          calls.push(
            typeof stmt === 'string'
              ? { sql: stmt, args: [] }
              : { sql: stmt.sql, args: Array.isArray(stmt.args) ? [...stmt.args] : [] },
          );
          return (target.execute as (...a: unknown[]) => unknown).call(target, stmt, ...rest);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { client, calls };
}

/** LOCAL mode's own compiled WHERE, without reaching into privates. */
class CompilerProbeDriver extends TursoDriver {
  compile(where: DriverQuery['where']): { sql: string; bindings: readonly unknown[] } {
    const builder = this.getKnex()(OBJECT.name);
    this.applyFilters(builder, where);
    const { sql, bindings } = builder.toSQL();
    return { sql, bindings };
  }
}

describe('[#20024] TursoDriver LOCAL and REMOTE — $like / $ilike read the whole stored value', () => {
  let local: CompilerProbeDriver;
  let remote: TursoDriver;
  let remoteLibsql: TursoDriver;
  let stub: LibsqlSqliteStub;
  let libsql: Client;
  let libsqlCalls: Array<{ sql: string; args: unknown[] }>;

  const labels = async (driver: TursoDriver, where: DriverQuery['where']): Promise<string[]> =>
    ((await driver.find(OBJECT.name, { where }, { bypassTenantAudit: true })) as Array<{ label: string }>)
      .map((r) => r.label)
      .sort();

  beforeAll(async () => {
    local = new CompilerProbeDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://stored-nul-like.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(OBJECT.name, OBJECT);

    libsql = createClient({ url: 'file::memory:' });
    const recorded = recordingClient(libsql);
    libsqlCalls = recorded.calls;
    remoteLibsql = new TursoDriver({ url: 'libsql://stored-nul-like-libsql.turso.io', client: recorded.client });
    await remoteLibsql.connect();
    expect(remoteLibsql.transportMode).toBe('remote');
    await remoteLibsql.syncSchema(OBJECT.name, OBJECT);

    for (const [label, v] of Object.entries(ROWS)) {
      await local.create(OBJECT.name, { label, v }, { bypassTenantAudit: true });
      await remote.create(OBJECT.name, { label, v });
      await remoteLibsql.create(OBJECT.name, { label, v });
    }
  });

  afterAll(async () => {
    await local.disconnect();
    await remote.disconnect();
    await remoteLibsql.disconnect();
    stub.close();
    libsql.close();
  });

  it('both remote engines stored every value whole (the premise)', async () => {
    const expected = Object.fromEntries(
      Object.entries(ROWS).map(([l, v]) => [l, v === null ? null : Buffer.from(v, 'utf8').toString('hex').toUpperCase()]),
    );
    const sql = `select label, case when v is null then null else hex(v) end as h from ${OBJECT.name}`;
    const onStub = stub.raw.prepare(sql).all() as Array<{ label: string; h: string | null }>;
    expect(Object.fromEntries(onStub.map((r) => [r.label, r.h]))).toEqual(expected);
    const onLibsql = (await libsql.execute(sql)).rows as unknown as Array<{ label: string; h: string | null }>;
    expect(Object.fromEntries(onLibsql.map((r) => [r.label, r.h]))).toEqual(expected);
  });

  for (const c of CASES) {
    it(`${c.name} answers the JavaScript rows on every transport`, async () => {
      expect({
        local: await labels(local, c.where),
        remote: await labels(remote, c.where),
        remoteLibsql: await labels(remoteLibsql, c.where),
      }).toEqual({ local: [...c.expected], remote: [...c.expected], remoteLibsql: [...c.expected] });
    });
  }

  it(`every one of the ${GRID.length} grid patterns answers the spec's rows on every transport`, async () => {
    const differing: string[] = [];
    for (const [op, pattern] of GRID) {
      const where = { v: { [op]: pattern } } as DriverQuery['where'];
      const want = specAnswer(op, pattern);
      for (const [name, driver] of [['local', local], ['remote', remote], ['remoteLibsql', remoteLibsql]] as const) {
        const got = await labels(driver, where);
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          differing.push(`${name} ${op} ${JSON.stringify(pattern)}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
        }
      }
    }
    expect(differing).toEqual([]);
  });

  it('the remote emitter sends the local compiler’s predicate text and bindings', async () => {
    const patterns: ReadonlyArray<readonly ['$like' | '$ilike', string]> = [
      ['$like', 'ab%'], ['$like', '%'], ['$like', 'a_b'], ['$like', 'a\\%b'], ['$like', '%b'], ['$like', ''],
      ['$like', '_' + SOH + '_'], ['$ilike', 'A_B'], ['$ilike', 'AB%'],
    ];
    for (const [op, pattern] of patterns) {
      const where = { v: { [op]: pattern } } as DriverQuery['where'];
      const { sql, bindings } = local.compile(where);
      const predicate = sql.replace(/^select \* from `stored_nul_like` where /, '').replace(/`/g, '"');
      libsqlCalls.length = 0;
      await remoteLibsql.find(OBJECT.name, { where });
      const select = libsqlCalls.find((c) => /\bFROM\b/i.test(c.sql));
      expect(select, `${op} ${JSON.stringify(pattern)}`).toBeDefined();
      expect(select!.sql, `${op} ${JSON.stringify(pattern)}`).toContain(predicate);
      expect(select!.args.slice(0, bindings.length), `${op} ${JSON.stringify(pattern)}`).toEqual([...bindings]);
    }
  });
});
