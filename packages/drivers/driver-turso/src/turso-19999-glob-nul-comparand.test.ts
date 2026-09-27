// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19999] Both of `TursoDriver`'s compilers compare a text comparand holding
 * U+0000 whole — against the whole stored value — and answer the same rows.
 *
 * LOCAL mode inherits `SqlDriver`'s `textMatchPredicate`; REMOTE mode compiles
 * in `RemoteTransport.pushLike`, an independent emitter that restates the same
 * rule. Both emitted `GLOB`, whose `glob()` reads its pattern and the stored
 * value as C strings and cuts each at its first U+0000. Measured before the
 * fix, on this stub and on a local libSQL engine (`@libsql/client`, SQLite
 * 3.45.1) alike: `$contains` / `$endsWith` of a comparand starting with U+0000
 * matched every row, and `$startsWith` of one matched `''`. Both now send such
 * a comparand to a length-aware construct — `instr()`, or a suffix comparison
 * over BLOB — and keep `GLOB` for every other comparand.
 *
 * Each case asserts the JavaScript answer on BOTH transports, not merely that
 * they agree: parity alone is satisfied by breaking both the same way. The
 * rows are the ones `driver-sql`'s and `driver-sqlite-wasm`'s #19999 suites
 * pin, where they are also checked against `@objectstack/formula`.
 *
 * The remote half runs on `makeLibsqlSqliteStub` (better-sqlite3 behind the
 * `@libsql/client` interface). What it does not model is a real Turso server
 * and its wire encoding of a string holding U+0000; that is not measured here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const NUL = String.fromCharCode(0x00);
const OBJECT = { name: 'nul_text_match', fields: { label: { type: 'string' }, v: { type: 'text' } } };

/** label → stored value; the first five are the rows the card measured. */
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
};

type TextOp = '$contains' | '$notContains' | '$icontains' | '$startsWith' | '$endsWith';

const NUL_CASES: ReadonlyArray<{ op: TextOp; comparand: string; expected: readonly string[] }> = [
  { op: '$contains', comparand: NUL, expected: ['accent_nul', 'glob_nul', 'nul_lead', 'nul_mid', 'nul_trail', 'upper_nul'] },
  { op: '$endsWith', comparand: NUL, expected: ['accent_nul', 'nul_trail'] },
  { op: '$contains', comparand: NUL + 'b', expected: ['nul_mid'] },
  { op: '$contains', comparand: 'a' + NUL, expected: ['nul_mid'] },
  { op: '$startsWith', comparand: NUL, expected: ['nul_lead'] },
  { op: '$startsWith', comparand: 'a' + NUL, expected: ['nul_mid'] },
  { op: '$endsWith', comparand: NUL + 'b', expected: ['nul_mid'] },
  { op: '$startsWith', comparand: NUL + 'z', expected: ['nul_lead'] },
  { op: '$endsWith', comparand: 'A' + NUL + 'B', expected: ['upper_nul'] },
  { op: '$endsWith', comparand: 'zz' + NUL + 'b', expected: [] },
  { op: '$startsWith', comparand: 'ab' + NUL + 'x', expected: [] },
  { op: '$notContains', comparand: NUL, expected: ['empty', 'missing', 'plain'] },
  {
    op: '$notContains',
    comparand: NUL + 'b',
    expected: ['accent_nul', 'empty', 'glob_nul', 'missing', 'nul_lead', 'nul_trail', 'plain', 'upper_nul'],
  },
  { op: '$icontains', comparand: NUL + 'B', expected: ['nul_mid', 'upper_nul'] },
  { op: '$icontains', comparand: 'a' + NUL + 'B', expected: ['nul_mid', 'upper_nul'] },
  { op: '$icontains', comparand: 'cafÉ' + NUL, expected: ['accent_nul'] },
  { op: '$icontains', comparand: 'café' + NUL, expected: [] },
  { op: '$contains', comparand: NUL + '*', expected: ['glob_nul'] },
  { op: '$contains', comparand: NUL + '*?[', expected: ['glob_nul'] },
  { op: '$startsWith', comparand: 'x' + NUL + '*', expected: ['glob_nul'] },
  { op: '$endsWith', comparand: NUL + '*?[y', expected: ['glob_nul'] },
  { op: '$notContains', comparand: NUL + '?', expected: Object.keys(ROWS).sort() },
];

const show = (s: string) => JSON.stringify(s).replace(/\\u0000/g, 'U+0000');

/**
 * `$not` over `$endsWith`, which tells a NULL predicate from a false one where a
 * bare `$endsWith` cannot. `''` ends with no comparand holding U+0000, so each
 * negation below must return the `empty` row — and `substr()` over a
 * zero-length BLOB is NULL, not the empty blob, so the suffix construct has to
 * say false there itself.
 */
const NOT_ENDS_CASES: ReadonlyArray<{ comparand: string; expected: readonly string[] }> = [
  { comparand: NUL, expected: ['empty', 'glob_nul', 'missing', 'nul_lead', 'nul_mid', 'plain', 'upper_nul'] },
  {
    comparand: NUL + 'b',
    expected: ['accent_nul', 'empty', 'glob_nul', 'missing', 'nul_lead', 'nul_trail', 'plain', 'upper_nul'],
  },
  { comparand: 'a' + NUL, expected: Object.keys(ROWS).sort() },
];

describe('[#19999] TursoDriver LOCAL and REMOTE — a comparand holding U+0000 is compared whole', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;
  const executed: string[] = [];

  const labels = async (driver: TursoDriver, where: DriverQuery['where']): Promise<string[]> =>
    ((await driver.find(OBJECT.name, { where }, { bypassTenantAudit: true })) as Array<{ label: string }>)
      .map((r) => r.label)
      .sort();

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);

    stub = makeLibsqlSqliteStub();
    // The stub is wrapped so the remote STATEMENTS are readable as well as its rows.
    const recording: LibsqlSqliteStub = {
      ...stub,
      async execute(stmt: unknown) {
        executed.push(typeof stmt === 'string' ? stmt : String((stmt as { sql?: unknown }).sql ?? ''));
        return stub.execute(stmt);
      },
    };
    remote = new TursoDriver({ url: 'libsql://nul-text.turso.io', client: asLibsqlClient(recording) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(OBJECT.name, OBJECT);

    for (const [label, v] of Object.entries(ROWS)) {
      await local.create(OBJECT.name, { label, v }, { bypassTenantAudit: true });
      await remote.create(OBJECT.name, { label, v });
    }
  });

  afterAll(async () => {
    await local.disconnect();
    await remote.disconnect();
    stub.close();
  });

  it('the remote stored every value whole (the premise)', () => {
    const rows = stub.raw
      .prepare(`select label, case when v is null then null else hex(v) end as h from ${OBJECT.name}`)
      .all() as Array<{ label: string; h: string | null }>;
    const stored = Object.fromEntries(rows.map((r) => [r.label, r.h]));
    for (const [label, v] of Object.entries(ROWS)) {
      expect(stored[label], label).toBe(v === null ? null : Buffer.from(v, 'utf8').toString('hex').toUpperCase());
    }
  });

  for (const c of NUL_CASES) {
    it(`${c.op} ${show(c.comparand)} answers the JavaScript rows on both transports`, async () => {
      const where = { v: { [c.op]: c.comparand } } as DriverQuery['where'];
      expect({ local: await labels(local, where), remote: await labels(remote, where) }).toEqual({
        local: [...c.expected],
        remote: [...c.expected],
      });
    });
  }

  for (const c of NOT_ENDS_CASES) {
    it(`$not $endsWith ${show(c.comparand)} returns the '' row on both transports`, async () => {
      const where = { $not: { v: { $endsWith: c.comparand } } } as DriverQuery['where'];
      expect({ local: await labels(local, where), remote: await labels(remote, where) }).toEqual({
        local: [...c.expected],
        remote: [...c.expected],
      });
    });
  }

  // [#20024] Of the comparands without U+0000, only `$startsWith`'s keeps GLOB;
  // every `contains` / `ends` one reads the whole stored value
  // (`turso-20024-glob-stored-nul.test.ts`).
  it('the remote keeps GLOB for a $startsWith without U+0000, and never uses it for a comparand holding U+0000', async () => {
    executed.length = 0;
    await remote.find(OBJECT.name, { where: { v: { $startsWith: 'a*b' } } });
    expect(executed.join('\n')).toContain('"v" GLOB ?');

    for (const op of ['$contains', '$notContains', '$icontains', '$startsWith', '$endsWith'] as const) {
      executed.length = 0;
      await remote.find(OBJECT.name, { where: { v: { [op]: 'a' + NUL + '*' } } as DriverQuery['where'] });
      const sql = executed.join('\n');
      expect(sql, op).toMatch(/\bFROM\b/i);
      expect(sql, op).not.toMatch(/GLOB/);
    }
  });
});
