// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20024] Both of `TursoDriver`'s compilers read the whole STORED value for a
 * `$contains` / `$notContains` / `$icontains` / `$endsWith` comparand WITHOUT
 * U+0000, and answer the same rows.
 *
 * LOCAL mode inherits `SqlDriver`'s `textMatchPredicate`; REMOTE mode compiles
 * in `RemoteTransport.pushLike`, an independent emitter that restates the same
 * rule. Both emitted `GLOB` for such a comparand, and `glob()` reads the stored
 * value as a C string, only up to its first U+0000. Measured at base
 * `9d81af714` on local mode and on remote mode over a real `@libsql/client`
 * engine (SQLite 3.45.1) alike: `$contains: 'b'` missed `'a'` + U+0000 + `'b'`,
 * `$endsWith: 'a'` returned it, and `$icontains: 'B'` missed `'A'` + U+0000 +
 * `'B'`. Both now send every `contains` / `ends` comparand to the length-aware
 * constructs #19999 introduced, and keep `GLOB` for a `$startsWith` comparand
 * free of U+0000, whose answer the value's cut cannot change.
 *
 * Each case asserts the JavaScript answer on EVERY transport, not merely that
 * they agree: parity alone is satisfied by breaking all of them the same way.
 * REMOTE runs twice — on `makeLibsqlSqliteStub` (better-sqlite3 behind the
 * `@libsql/client` interface) and on a real `@libsql/client` `file::memory:`
 * engine — so the libSQL build's own answer is pinned, not only the stub's. A
 * real Turso server, and its wire encoding of a string holding U+0000, are not
 * measured here. The rows are the ones `driver-sql`'s and
 * `driver-sqlite-wasm`'s #20024 suites pin, where they are also checked against
 * `@objectstack/formula`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const NUL = String.fromCharCode(0x00);
const OBJECT = { name: 'stored_nul_text_match', fields: { label: { type: 'string' }, v: { type: 'text' } } };

/** label → stored value: U+0000 at the start, middle and end, and none. */
const ROWS: Readonly<Record<string, string | null>> = {
  nul_mid: 'a' + NUL + 'b',
  nul_trail: 'ab' + NUL,
  nul_lead: NUL + 'z',
  plain: 'plain',
  empty: '',
  upper_nul: 'A' + NUL + 'B',
  glob_nul: 'x' + NUL + '*?[y',
  accent_nul: 'CAFÉ' + NUL,
  missing: null,
  b_nul_a: 'b' + NUL + 'a',
  mb_nul: 'é' + NUL + 'ü',
  zz_nul_b: 'zz' + NUL + 'b',
};

const EVERY_VALUE = Object.keys(ROWS).filter((l) => ROWS[l] !== null).sort();

const CASES: ReadonlyArray<{ name: string; where: DriverQuery['where']; expected: readonly string[] }> = [
  { name: "$contains 'b'", where: { v: { $contains: 'b' } }, expected: ['b_nul_a', 'nul_mid', 'nul_trail', 'zz_nul_b'] },
  { name: "$contains 'z'", where: { v: { $contains: 'z' } }, expected: ['nul_lead', 'zz_nul_b'] },
  { name: "$contains '*?[y'", where: { v: { $contains: '*?[y' } }, expected: ['glob_nul'] },
  { name: "$contains 'ü'", where: { v: { $contains: 'ü' } }, expected: ['mb_nul'] },
  { name: "$contains ''", where: { v: { $contains: '' } }, expected: EVERY_VALUE },
  {
    name: "$notContains 'b'",
    where: { v: { $notContains: 'b' } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain', 'upper_nul'],
  },
  { name: "$notContains ''", where: { v: { $notContains: '' } }, expected: ['missing'] },
  {
    name: "$icontains 'B'",
    where: { v: { $icontains: 'B' } },
    expected: ['b_nul_a', 'nul_mid', 'nul_trail', 'upper_nul', 'zz_nul_b'],
  },
  { name: "$icontains 'é'", where: { v: { $icontains: 'é' } }, expected: ['mb_nul'] },
  { name: "$endsWith 'a'", where: { v: { $endsWith: 'a' } }, expected: ['b_nul_a'] },
  { name: "$endsWith 'b'", where: { v: { $endsWith: 'b' } }, expected: ['nul_mid', 'zz_nul_b'] },
  { name: "$endsWith 'z'", where: { v: { $endsWith: 'z' } }, expected: ['nul_lead'] },
  { name: "$endsWith 'ab'", where: { v: { $endsWith: 'ab' } }, expected: [] },
  { name: "$endsWith ''", where: { v: { $endsWith: '' } }, expected: EVERY_VALUE },
  { name: "$startsWith 'a'", where: { v: { $startsWith: 'a' } }, expected: ['nul_mid', 'nul_trail'] },
  { name: "$startsWith 'z'", where: { v: { $startsWith: 'z' } }, expected: ['zz_nul_b'] },
  // `$not` / `$or` / `$and` over the moved shapes, with the '' and NULL rows.
  {
    name: "$not $contains 'b'",
    where: { $not: { v: { $contains: 'b' } } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain', 'upper_nul'],
  },
  {
    name: "$not $notContains 'b'",
    where: { $not: { v: { $notContains: 'b' } } },
    expected: ['b_nul_a', 'nul_mid', 'nul_trail', 'zz_nul_b'],
  },
  {
    name: "$not $icontains 'B'",
    where: { $not: { v: { $icontains: 'B' } } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain'],
  },
  {
    name: "$not $endsWith 'b'",
    where: { $not: { v: { $endsWith: 'b' } } },
    expected: ['accent_nul', 'b_nul_a', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'nul_trail', 'plain', 'upper_nul'],
  },
  { name: "$not $endsWith ''", where: { $not: { v: { $endsWith: '' } } }, expected: ['missing'] },
  {
    name: "$or [$contains 'b', $endsWith 'z']",
    where: { $or: [{ v: { $contains: 'b' } }, { v: { $endsWith: 'z' } }] },
    expected: ['b_nul_a', 'nul_lead', 'nul_mid', 'nul_trail', 'zz_nul_b'],
  },
  {
    name: "$and [$notContains 'z', $endsWith 'b']",
    where: { $and: [{ v: { $notContains: 'z' } }, { v: { $endsWith: 'b' } }] },
    expected: ['nul_mid'],
  },
  {
    name: "$not $or [$endsWith 'a', $icontains 'B']",
    where: { $not: { $or: [{ v: { $endsWith: 'a' } }, { v: { $icontains: 'B' } }] } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain'],
  },
];

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

describe('[#20024] TursoDriver LOCAL and REMOTE — a comparand without U+0000 reads the whole stored value', () => {
  let local: TursoDriver;
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
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://stored-nul-text.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(OBJECT.name, OBJECT);

    libsql = createClient({ url: 'file::memory:' });
    const recorded = recordingClient(libsql);
    libsqlCalls = recorded.calls;
    remoteLibsql = new TursoDriver({ url: 'libsql://stored-nul-text-libsql.turso.io', client: recorded.client });
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

  it('the remote sends no GLOB for contains / ends, and keeps it for a $startsWith free of U+0000', async () => {
    const sent = async (where: DriverQuery['where']) => {
      libsqlCalls.length = 0;
      await remoteLibsql.find(OBJECT.name, { where });
      const select = libsqlCalls.find((c) => /\bFROM\b/i.test(c.sql));
      expect(select, JSON.stringify(where)).toBeDefined();
      return select!;
    };

    for (const op of ['$contains', '$notContains', '$icontains', '$endsWith'] as const) {
      const { sql, args } = await sent({ v: { [op]: 'a*b' } } as DriverQuery['where']);
      expect(sql, op).not.toMatch(/GLOB/);
      expect(sql, op).toMatch(/instr\(|substr\(CAST\(/);
      expect(args, op).toContain('a*b');
      expect(args, op).not.toContain('*a[*]b*');
    }

    // An empty suffix takes `instr()`; `-length('')` never reaches `substr()`.
    const empty = await sent({ v: { $endsWith: '' } });
    expect(empty.sql).toMatch(/instr\("v", \?\) > 0/);
    expect(empty.sql).not.toMatch(/substr\(/);

    const starts = await sent({ v: { $startsWith: 'a*b' } });
    expect(starts.sql).toContain('"v" GLOB ?');
    expect(starts.args).toContain('a[*]b*');
  });
});
