// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7536] `$like` / `$ilike` answer the SAME rows on BOTH turso transports.
 *
 * ## Why this driver needs its own parity suite for these two operators
 *
 * `TursoDriver` is the one driver with TWO filter compilers. Local mode extends
 * `SqlDriver` and inherits its emitter; remote mode compiles SQL itself in
 * `RemoteTransport.buildWhereSQL`, because it speaks a wire protocol rather
 * than knex. So every operator has to be implemented twice here, and "twice"
 * is where a pattern language forks: the two could easily agree about
 * `%Industries` and disagree about `a\\_b` or `a*b`, which no single-transport
 * suite would notice.
 *
 * #7536 narrows that risk deliberately — both sides call the SPEC's
 * `likePatternToGlobPattern`, so the translation itself is one function rather
 * than two. What is still per-transport, and therefore what these cases
 * actually pin, is everything around it: which operand gets the `lower()` fold,
 * whether the pattern is bound or interpolated, and whether the comparand gate
 * fires with the same verdict on both sides.
 *
 * The GLOB detour is #6518's and applies with full force here: libSQL is
 * SQLite, SQLite's `LIKE` folds ASCII unconditionally, and `$like` is
 * case-SENSITIVE by contract — so a transport that reached for `LIKE` would
 * over-match, and only the case rows below would catch it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const OBJECT = {
  name: 'like_parity',
  fields: { name: { type: 'string' } },
};

/**
 * The same shape `sql-driver-like-pattern.test.ts` uses: rows that differ by
 * PREFIX and SUFFIX, so a whole-value match and a substring match return
 * visibly different sets. With only the bare word present the fold and the fix
 * agree, which is how the original defect stayed invisible.
 */
const ROWS = [
  { id: '1', name: 'Acme Industries' },
  { id: '2', name: 'Industries Ltd' },
  { id: '3', name: 'Industries' },
  { id: '4', name: 'ACME INDUSTRIES' },
  { id: '5', name: '100% match' },
  { id: '6', name: '100X match' },
  { id: '7', name: 'a_b' },
  { id: '8', name: 'axb' },
  { id: '9', name: 'a*b' },
] as const;

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const ids = (rows: Array<Record<string, unknown>>): string[] =>
  rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));

describe('[#7536] TursoDriver LOCAL and REMOTE run one pattern language', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);
    for (const row of ROWS) await local.create(OBJECT.name, { ...row }, { bypassTenantAudit: true });

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://like-parity.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(OBJECT.name, OBJECT);
    for (const row of ROWS) await remote.create(OBJECT.name, { ...row });
  });

  afterAll(async () => {
    await local.disconnect();
    await remote.disconnect();
    stub.close();
  });

  it('both transports hold the same nine rows (the premise)', async () => {
    const all = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    expect(ids(await local.find(OBJECT.name, {}))).toEqual(all);
    expect(ids(await remote.find(OBJECT.name, {}))).toEqual(all);
  });

  /** Every case asserts the two transports agree BEFORE asserting the answer. */
  const CASES: Array<[string, Record<string, unknown>, string[]]> = [
    // The card's own table.
    ['a wildcard pattern binds the caller\'s %', { name: { $like: '%Industries' } }, ['1', '3']],
    ['a wildcard-free pattern is EXACT, not a substring', { name: { $like: 'Industries' } }, ['3']],
    ['% at the end', { name: { $like: 'Industries%' } }, ['2', '3']],
    // The pattern language.
    ['_ matches exactly one character', { name: { $like: 'a_b' } }, ['7', '8', '9']],
    ['a backslash escapes _ back to a literal', { name: { $like: 'a\\_b' } }, ['7']],
    ['a backslash escapes % back to a literal', { name: { $like: '100\\% match' } }, ['5']],
    // GLOB's own metacharacters are ORDINARY to LIKE. Untranslated, `a*b`
    // matches every row on a SQLite engine — the widening the shared
    // translation's self-closing `[*]` class prevents, on both transports.
    ['* is a literal, not a GLOB wildcard', { name: { $like: 'a*b' } }, ['9']],
    // Case.
    ['$like is case-SENSITIVE', { name: { $like: 'Acme%' } }, ['1']],
    ['$ilike folds ASCII case', { name: { $ilike: 'acme%' } }, ['1', '4']],
    ['$ilike folds the other direction too', { name: { $ilike: 'ACME%' } }, ['1', '4']],
    // The control: `$contains` must NOT have moved.
    ['the $contains control still wraps in %…%', { name: { $contains: 'Industries' } }, ['1', '2', '3']],
  ];

  for (const [name, where, expected] of CASES) {
    it(name, async () => {
      const localIds = ids(await local.find(OBJECT.name, { where } as DriverQuery));
      const remoteIds = ids(await remote.find(OBJECT.name, { where } as DriverQuery));
      // The difference IS the assertion — reported first, so a fork between the
      // two emitters reads as a fork rather than as two unrelated wrong answers.
      expect(remoteIds, 'remote disagrees with local').toEqual(localIds);
      expect(localIds).toEqual(expected);
    });
  }

  // ── Refusals must match too, envelope included ────────────────────────────

  const REFUSED: Array<[string, Record<string, unknown>, string]> = [
    ['a non-string pattern', { name: { $like: 42 } }, '$like'],
    ['an object pattern', { name: { $like: {} } }, '$like'],
    ['a dangling trailing backslash', { name: { $like: 'abc\\' } }, 'backslash'],
  ];

  for (const [name, where, mention] of REFUSED) {
    it(`refuses ${name} on BOTH transports, in the ADR-0112 envelope`, async () => {
      for (const [face, driver] of [['local', local], ['remote', remote]] as const) {
        const err = await driver
          .find(OBJECT.name, { where } as DriverQuery)
          .then(() => null, (e: unknown) => e as WireBearingError);
        expect(err, `${face} compiled a filter that must be refused`).not.toBeNull();
        expect(err!.code, face).toBe('INVALID_FILTER');
        expect(err!.status, face).toBe(400);
        expect(err!.message, `${face} — ${mention}`).toContain(mention);
      }
    });
  }
});
