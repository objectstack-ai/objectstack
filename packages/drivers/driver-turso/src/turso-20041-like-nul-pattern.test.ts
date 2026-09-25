// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20041] Both of `TursoDriver`'s compilers refuse a `$like` / `$ilike`
 * pattern holding U+0000, and send nothing to the engine for it.
 *
 * LOCAL mode inherits `SqlDriver`'s walk; REMOTE mode compiles in
 * `RemoteTransport.buildWhereSQL`, whose `$like` arm sends the pattern through
 * `pushLikePattern` as a `GLOB` operand. SQLite reads a pattern only up to its
 * first U+0000, so on both the pattern was cut there and answered a different
 * question. Measured at base `8d76c2d38c`, over the same rows as `driver-sql`'s
 * probe: all 20 U+0000 cases differed from `@objectstack/formula` on local
 * mode, on remote mode over `makeLibsqlSqliteStub` and on remote mode over a
 * real `@libsql/client` `file::memory:` engine, identically (for example
 * `$like: '%'` + U+0000 returned all 12 non-NULL rows where `formula` returns
 * two).
 *
 * REMOTE runs twice, on the stub and on the real libSQL engine, for the reason
 * `turso-20024-glob-stored-nul.test.ts` gives. A real Turso server is not
 * measured here. The per-mark pin of the transport's door is in
 * `remote-transport-compile-refusal-seam.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const NUL = String.fromCharCode(0x00);
const OBJECT = { name: 'like_nul_pattern', fields: { label: { type: 'string' }, v: { type: 'text' } } };
const CLASS_STATEMENT = 'has a pattern holding the NUL character U+0000';

/** Stored values WITHOUT U+0000: a stored U+0000 is #20024's other half, not this card's. */
const ROWS: Readonly<Record<string, string | null>> = {
  ab: 'ab',
  a: 'a',
  b: 'b',
  axb: 'axb',
  AB: 'AB',
  plain: 'plain',
  empty: '',
  missing: null,
};

const NUL_PATTERNS: ReadonlyArray<readonly ['$like' | '$ilike', string]> = [
  ['$like', '%' + NUL],
  ['$like', 'a' + NUL + 'b'],
  ['$like', '\\' + NUL],
  ['$ilike', '%' + NUL + 'B'],
];

/** NUL-free controls with the rows `@objectstack/formula` answers over ROWS (checked there by the driver-sql twin). */
const CONTROLS: ReadonlyArray<{ where: DriverQuery['where']; expected: readonly string[] }> = [
  { where: { v: { $like: '%' } }, expected: ['AB', 'a', 'ab', 'axb', 'b', 'empty', 'plain'] },
  { where: { $not: { v: { $like: '%' } } }, expected: ['missing'] },
  { where: { v: { $like: 'a%' } }, expected: ['a', 'ab', 'axb'] },
  { where: { $not: { v: { $like: 'a%' } } }, expected: ['AB', 'b', 'empty', 'missing', 'plain'] },
  { where: { v: { $like: 'a_b' } }, expected: ['axb'] },
  { where: { v: { $like: '' } }, expected: ['empty'] },
  { where: { v: { $ilike: '%B' } }, expected: ['AB', 'ab', 'axb', 'b'] },
  { where: { $not: { v: { $ilike: '%B' } } }, expected: ['a', 'empty', 'missing', 'plain'] },
];

/** A real libSQL client whose `execute` also records each statement. */
function recordingClient(inner: Client): { client: Client; calls: string[] } {
  const calls: string[] = [];
  const client = new Proxy(inner, {
    get(target, prop) {
      if (prop === 'execute') {
        return (stmt: InStatement, ...rest: unknown[]) => {
          calls.push(typeof stmt === 'string' ? stmt : stmt.sql);
          return (target.execute as (...a: unknown[]) => unknown).call(target, stmt, ...rest);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { client, calls };
}

describe('[#20041] TursoDriver LOCAL and REMOTE refuse a $like / $ilike pattern holding U+0000', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let remoteLibsql: TursoDriver;
  let stub: LibsqlSqliteStub;
  let libsql: Client;
  let libsqlCalls: string[];
  let logged: string[];

  const quietLogger = () => ({
    warn: (m: string) => { logged.push(String(m)); },
    error: () => {},
    info: () => {},
    debug: () => {},
  });

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://like-nul-pattern.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(OBJECT.name, OBJECT);

    libsql = createClient({ url: 'file::memory:' });
    const recorded = recordingClient(libsql);
    libsqlCalls = recorded.calls;
    remoteLibsql = new TursoDriver({ url: 'libsql://like-nul-pattern-libsql.turso.io', client: recorded.client });
    await remoteLibsql.connect();
    expect(remoteLibsql.transportMode).toBe('remote');
    await remoteLibsql.syncSchema(OBJECT.name, OBJECT);

    for (const [label, v] of Object.entries(ROWS)) {
      await local.create(OBJECT.name, { label, v }, { bypassTenantAudit: true });
      await remote.create(OBJECT.name, { label, v });
      await remoteLibsql.create(OBJECT.name, { label, v });
    }
    logged = [];
    for (const d of [local, remote, remoteLibsql]) (d as unknown as { logger: unknown }).logger = quietLogger();
  });

  afterAll(async () => {
    await local.disconnect();
    await remote.disconnect();
    await remoteLibsql.disconnect();
    stub.close();
    libsql.close();
  });

  const refusalOf = async (driver: TursoDriver, where: unknown): Promise<WireBearingError> => {
    const err = await driver
      .find(OBJECT.name, { where } as DriverQuery, { bypassTenantAudit: true })
      .then(() => null, (e: unknown) => e as WireBearingError);
    if (!err) throw new Error(`expected a refusal for ${JSON.stringify(where)}, but the filter resolved`);
    return err;
  };

  const expectEnvelope = (err: WireBearingError, label: string) => {
    expect(err.code, label).toBe('INVALID_FILTER');
    expect(err.status, label).toBe(400);
    expect(Object.keys(err).sort(), label).toEqual(['code', 'status']);
    expect(err.message, label).toContain(CLASS_STATEMENT);
  };

  for (const [op, pattern] of NUL_PATTERNS) {
    for (const [position, build, localPath] of [
      ['bare', () => ({ v: { [op]: pattern } }), `filter.v.${op}`],
      ['under $not', () => ({ $not: { v: { [op]: pattern } } }), `filter.$not.v.${op}`],
    ] as const) {
      it(`${op} ${JSON.stringify(pattern)} ${position}: refused on every transport, nothing sent`, async () => {
        // Unmarked: the class statement on every transport, the location in the log.
        for (const [label, driver] of [['local', local], ['remote', remote], ['remoteLibsql', remoteLibsql]] as const) {
          logged = [];
          libsqlCalls.length = 0;
          const err = await refusalOf(driver, build());
          expectEnvelope(err, label);
          expect(err.message, label).not.toContain(localPath);
          expect(err.message, label).not.toContain(`'${OBJECT.name}.v'`);
          const log = logged.join('\n');
          if (label === 'local') expect(log).toContain(`Operator "${op}" on field "v" at ${localPath}`);
          else expect(log, label).toContain(`[RemoteTransport] Operator "${op}" on '${OBJECT.name}.v'`);
          expect(libsqlCalls.filter((sql) => /\bFROM\b/i.test(sql)), label).toEqual([]);
        }

        // Author-marked: LOCAL names the operator, the field and the path...
        const author = await refusalOf(local, markFilterSubtreeProvenance(build(), 'author'));
        expectEnvelope(author, 'local author');
        expect(author.message).toContain(`Operator "${op}" on field "v" at ${localPath} ${CLASS_STATEMENT}`);
        // ...REMOTE cannot: `toRemoteFilter` rebuilds every node, so no mark
        // reaches the transport and it withholds (the declared fail-closed cost).
        for (const driver of [remote, remoteLibsql]) {
          const err = await refusalOf(driver, markFilterSubtreeProvenance(build(), 'author'));
          expectEnvelope(err, 'remote author');
          expect(err.message).toMatch(/^\[RemoteTransport\] A pattern operator/);
        }
      });
    }
  }

  it('the dangling escape keeps its own refusal on every transport, also beside a U+0000', async () => {
    for (const pattern of ['abc\\', 'a' + NUL + '\\']) {
      for (const driver of [local, remote, remoteLibsql]) {
        const err = await refusalOf(driver, { v: { $like: pattern } });
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain('ending in a lone unpaired backslash');
        expect(err.message).not.toContain(CLASS_STATEMENT);
      }
    }
  });

  for (const c of CONTROLS) {
    it(`control: ${JSON.stringify(c.where)} (no U+0000) answers the same rows on every transport`, async () => {
      const labels = async (driver: TursoDriver) =>
        ((await driver.find(OBJECT.name, { where: c.where }, { bypassTenantAudit: true })) as Array<{ label: string }>)
          .map((r) => r.label)
          .sort();
      expect({ local: await labels(local), remote: await labels(remote), remoteLibsql: await labels(remoteLibsql) })
        .toEqual({ local: [...c.expected], remote: [...c.expected], remoteLibsql: [...c.expected] });
    });
  }
});
