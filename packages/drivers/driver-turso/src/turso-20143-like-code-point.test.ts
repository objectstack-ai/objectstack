// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20143] `TursoDriver` LOCAL and REMOTE — `$like` / `$ilike` `_` is ONE
 * Unicode code point, and the spec's `matchesLikePattern` now gives the same
 * rows.
 *
 * Both transports were already right: LOCAL inherits `SqlDriver`'s GLOB
 * predicate and REMOTE compiles its own, both over the spec's
 * `likePatternToGlobPattern`, and GLOB's `?` counts code points. The JS faces
 * compiled `likePatternToRegexSource` with no flags and counted UTF-16 code
 * units, so measured at base `e7f69dbb` `$like: '_'` returned a stored `😀` on
 * both transports and not in `matchesLikePattern`. The spec's
 * `likePatternToRegExp` now compiles with the `u` flag.
 *
 * REMOTE runs twice — on `makeLibsqlSqliteStub` (better-sqlite3 behind the
 * `@libsql/client` interface) and on a real `@libsql/client` `file::memory:`
 * engine — so the libSQL build's own answer is pinned, not only the stub's. A
 * real Turso server is not measured here. This package does not depend on
 * `formula`, so its JS half is the spec's `matchesLikePattern`, the predicate
 * `formula` evaluates `$like` / `$ilike` by.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { matchesLikePattern } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const GRIN = String.fromCodePoint(0x1f600);
const SCRIPT_A = String.fromCodePoint(0x1d49c);
const OBJECT = { name: 'like_code_point', fields: { label: { type: 'string' }, v: { type: 'text' } } };

const ROWS: Readonly<Record<string, string>> = {
  x: 'x',
  grin: GRIN,
  grin_grin: GRIN + GRIN,
  a_grin_b: 'a' + GRIN + 'b',
  a_grin_grin_b: 'a' + GRIN + GRIN + 'b',
  upper_script_b: 'A' + SCRIPT_A + 'B',
  ab: 'ab',
  axb: 'axb',
  axyb: 'axyb',
};

/** [op, pattern, the code-point rows]. */
const FAMILY: ReadonlyArray<readonly ['$like' | '$ilike', string, readonly string[]]> = [
  ['$like', '_', ['grin', 'x']],
  ['$like', '__', ['ab', 'grin_grin']],
  ['$like', 'a_b', ['a_grin_b', 'axb']],
  ['$like', 'a__b', ['a_grin_grin_b', 'axyb']],
  ['$like', '___', ['a_grin_b', 'axb', 'upper_script_b']],
  ['$like', GRIN + '_', ['grin_grin']],
  ['$like', '_' + GRIN, ['grin_grin']],
  ['$ilike', '_', ['grin', 'x']],
  ['$ilike', 'A_B', ['a_grin_b', 'axb', 'upper_script_b']],
  ['$ilike', 'A__B', ['a_grin_grin_b', 'axyb']],
];

function specAnswer(op: '$like' | '$ilike', pattern: string): string[] {
  return Object.entries(ROWS)
    .filter(([, v]) => matchesLikePattern(v, pattern, op === '$ilike'))
    .map(([label]) => label)
    .sort();
}

describe('[#20143] TursoDriver LOCAL and REMOTE — `_` is one code point', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let remoteLibsql: TursoDriver;
  let stub: LibsqlSqliteStub;
  let libsql: Client;

  const labels = async (driver: TursoDriver, where: DriverQuery['where']): Promise<string[]> =>
    ((await driver.find(OBJECT.name, { where }, { bypassTenantAudit: true })) as Array<{ label: string }>)
      .map((r) => r.label)
      .sort();

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://like-code-point.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(OBJECT.name, OBJECT);

    libsql = createClient({ url: 'file::memory:' });
    remoteLibsql = new TursoDriver({ url: 'libsql://like-code-point-libsql.turso.io', client: libsql });
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

  it('both remote engines stored every value whole, as UTF-8 (the premise)', async () => {
    const expected = Object.fromEntries(
      Object.entries(ROWS).map(([l, v]) => [l, Buffer.from(v, 'utf8').toString('hex').toUpperCase()]),
    );
    const sql = `select label, hex(v) as h from ${OBJECT.name}`;
    const onStub = stub.raw.prepare(sql).all() as Array<{ label: string; h: string }>;
    expect(Object.fromEntries(onStub.map((r) => [r.label, r.h]))).toEqual(expected);
    const onLibsql = (await libsql.execute(sql)).rows as unknown as Array<{ label: string; h: string }>;
    expect(Object.fromEntries(onLibsql.map((r) => [r.label, r.h]))).toEqual(expected);
  });

  for (const [op, pattern, expected] of FAMILY) {
    it(`${op} ${JSON.stringify(pattern)} answers the code-point rows on every transport`, async () => {
      const where = { v: { [op]: pattern } } as DriverQuery['where'];
      expect({
        local: await labels(local, where),
        remote: await labels(remote, where),
        remoteLibsql: await labels(remoteLibsql, where),
      }).toEqual({ local: [...expected], remote: [...expected], remoteLibsql: [...expected] });
    });
  }

  it("the spec's matchesLikePattern answers the same rows on every family cell", () => {
    const differing = FAMILY.filter(([op, pattern, expected]) =>
      JSON.stringify(specAnswer(op, pattern)) !== JSON.stringify(expected),
    ).map(([op, pattern]) => `${op} ${JSON.stringify(pattern)}: ${JSON.stringify(specAnswer(op, pattern))}`);
    expect(differing).toEqual([]);
  });
});
