// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6518] ONE `TursoDriver`, ONE answer — the two transports held against each
 * other on the TEXT family, and both held to `FILTER_TEXT_CASES`.
 *
 * # Why this file exists rather than one more case in each transport's suite
 *
 * This driver compiles a filter TWICE, and which copy runs is chosen by the
 * `url` it was constructed with: LOCAL inherits `SqlDriver` (so it gets
 * `textMatchPredicate`), while REMOTE compiles in
 * `RemoteTransport.buildWhereSQL` — an independent emitter that inherits none
 * of it and carries its own `pushLike`. #6518 had to move BOTH, and a
 * per-transport suite cannot fail on the DIFFERENCE: a divergence shows up as
 * one file red and the other green, in whichever order someone reads them.
 * `turso-local-remote-null-parity.test.ts` made that argument for the NULL
 * family; this is the same argument for the text family, and the text family is
 * where the second emitter was actually asked to re-derive an escape rule.
 *
 * That matters more here than it looks. #6518 did not only flip a flag — it
 * changed the OPERATOR (`LIKE` → `GLOB`, because SQLite's `LIKE` folds ASCII
 * case and #4706 Q2 = A says the `$contains` family is case-SENSITIVE) and with
 * it the escaped character class (`%` / `_` / `\` → `*` / `?` / `[`, spelled as
 * self-closing classes because GLOB has no `ESCAPE` clause). Two emitters, one
 * new escape rule, and an unescaped metacharacter is a filter bypass: this is
 * exactly the shape where a copy gets migrated halfway.
 *
 * # Why the case-set and not a private fixture
 *
 * `FILTER_TEXT_CASES` is the contract (#5701 / #4706), so running it here is
 * what `scripts/check-driver-conformance.mjs` reads as this driver's coverage —
 * and it is read honestly, because both transports answer every row of it. The
 * case-set's own invariant is the one asserted: a backend returns the SAME ROW
 * SET or REFUSES with `INVALID_FILTER`, never a third, quieter answer.
 *
 * # Why every case asserts the canonical answer too
 *
 * Parity alone is satisfiable by breaking both transports the same way — the
 * failure mode a "the two agree" suite invites. So each case is checked against
 * the row ids the ruling requires, on both faces. Agreement is necessary;
 * agreement on the RIGHT answer is the assertion.
 *
 * # Reverse verification, direction predicted BEFORE it was run
 *
 * Predicted: reverting EITHER emitter alone turns the five case-sensitivity
 * rows red, and turns them red as a PARITY failure naming which transport
 * drifted. Measured: reverting `pushLike` to `LIKE` leaves the local column
 * green and the remote column returning `['1','2']` where the case-set demands
 * `['2']`, so the parity assertion and the canonical assertion fail together —
 * which is the outcome that distinguishes this file from two separate suites.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { FILTER_TEXT_CASES, FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

/** The shared nine-row fixture, so a verdict here is comparable to one anywhere. */
const TEXT_OBJECT = {
  name: 'text_conformance',
  fields: { name: { type: 'string' } },
};

/** The error a refused filter produced — never a bare `toThrow()`. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const ids = (rows: Array<Record<string, unknown>>): string[] =>
  rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));

describe('[#6518] TursoDriver LOCAL and REMOTE answer FILTER_TEXT_CASES identically', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([TEXT_OBJECT]);
    for (const row of FILTER_TEXT_ROWS) {
      await local.create(TEXT_OBJECT.name, { ...row }, { bypassTenantAudit: true });
    }

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://text-parity.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(TEXT_OBJECT.name, TEXT_OBJECT);
    for (const row of FILTER_TEXT_ROWS) {
      await remote.create(TEXT_OBJECT.name, { ...row });
    }
  });

  afterAll(async () => {
    await local.disconnect();
    await remote.disconnect();
    stub.close();
  });

  /**
   * The fixture control, on BOTH faces. A parity suite whose two sides seeded
   * different rows compares nothing — and the two rows that carry the whole
   * case axis (`ACME Corp` / `acme corp`) would be indistinguishable from a
   * mis-seeded table by the case results alone.
   */
  it('both transports hold the same nine rows, cased as the fixture cases them', async () => {
    expect(ids(await local.find(TEXT_OBJECT.name, {}))).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    );
    expect(ids(await remote.find(TEXT_OBJECT.name, {}))).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    );
    for (const driver of [local, remote]) {
      const rows = await driver.find(TEXT_OBJECT.name, {} as DriverQuery);
      const byId = new Map(rows.map((r) => [String(r.id), String(r.name)]));
      expect(byId.get('1')).toBe('ACME Corp');
      expect(byId.get('2')).toBe('acme corp');
      expect(byId.get('3')).toBe('CAFÉ');
      expect(byId.get('4')).toBe('café');
    }
  });

  for (const testCase of FILTER_TEXT_CASES) {
    it(testCase.name, async () => {
      if (testCase.expectRejection) {
        for (const [face, driver] of [['local', local], ['remote', remote]] as const) {
          const err = await driver
            .find(TEXT_OBJECT.name, { where: testCase.filter } as DriverQuery)
            .then(() => null, (e: unknown) => e as WireBearingError);
          expect(err, `${face} compiled a filter the case-set requires refused`).not.toBeNull();
          // `code` AND `status`, never a bare rejection: this driver's whole
          // family of filter refusals exists to reach the client as a
          // 400-class error rather than an opaque 500 (ADR-0112).
          expect(err!.code, face).toBe(testCase.code);
          expect(err!.status, face).toBe(400);
          for (const mention of testCase.mustMention) {
            expect(err!.message, `${face} — ${mention}`).toContain(mention);
          }
        }
        return;
      }

      const localIds = ids(await local.find(TEXT_OBJECT.name, { where: testCase.filter } as DriverQuery));
      const remoteIds = ids(await remote.find(TEXT_OBJECT.name, { where: testCase.filter } as DriverQuery));
      // The difference IS the assertion — reported before the canonical one, so
      // a drift between the two emitters reads as a drift rather than as two
      // unrelated wrong answers.
      expect(remoteIds, `${testCase.name} — LOCAL vs REMOTE`).toEqual(localIds);
      expect(localIds, testCase.note ?? testCase.name).toEqual([...testCase.expected]);
    });
  }

  /**
   * The GLOB escape class, on both faces. `FILTER_TEXT_ROWS` has no `*`, `?` or
   * `[` row — it encodes the CONTRACT, which knows nothing about any dialect's
   * pattern syntax — so the new metacharacters are pinned here, where the
   * dialect is known. Unescaped, `*a*b*` is a wildcard pattern that matches
   * rows 7, 8 and 9; escaped, it matches none of them.
   */
  for (const comparand of ['a*b', 'a?b', 'a[b'] as const) {
    it(`treats ${JSON.stringify(comparand)} as literal text on both transports`, async () => {
      for (const [face, driver] of [['local', local], ['remote', remote]] as const) {
        expect(ids(await driver.find(TEXT_OBJECT.name, { where: { name: { $contains: comparand } } } as DriverQuery)), face)
          .toEqual([]);
        expect(ids(await driver.find(TEXT_OBJECT.name, { where: { name: { $icontains: comparand } } } as DriverQuery)), face)
          .toEqual([]);
      }
    });
  }
});
