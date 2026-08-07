// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5903] ONE `TursoDriver`, ONE answer — the two transports held against each
 * other on the NULL / no-value family.
 *
 * # What this file is for
 *
 * #5903 was not "remote compiles a filter wrongly". It was **the same driver
 * answering one filter two ways, chosen by the `url` it was constructed with**:
 * `TursoDriver extends SqlDriver`, so LOCAL mode inherited #5146's NULL-safe
 * `$not` (PR #5296) and #5298's NULL-safe `$ne`/`$nin`/`$notContains` (PR #5962)
 * for free, while REMOTE mode compiles filters in
 * `RemoteTransport.buildWhereSQL` — an independent emitter that inherited none
 * of it. Measured on `origin/main` at `b5bdf48af`, against the fixture below:
 *
 * | filter | LOCAL | REMOTE |
 * |---|---|---|
 * | `{ d: { $ne: 'v1' } }`         | `['2','3','4']` | `['2']` |
 * | `{ d: { $nin: ['v1'] } }`      | `['2','3','4']` | `['2']` |
 * | `{ d: { $notContains: 'v1' } }`| `['2','3','4']` | `['2']` |
 * | `{ $not: { d: 'v1' } }`        | `['2','3','4']` | `['2']` |
 * | `{ d: { $exists: 'yes' } }`    | `INVALID_FILTER`| `['1','2']` |
 *
 * A filter-logic conformance suite exists for each transport already
 * (`turso-filter-logic-conformance` / `turso-remote-filter-logic-conformance`),
 * and since this PR both run the `$ne` and `$not` rows of `FILTER_LOGIC_CASES`.
 * What they cannot do is fail on the DIFFERENCE: they are separate files with
 * separate fixtures, so a divergence shows up as one suite red and the other
 * green, in whichever order someone happens to read them. This file makes the
 * difference itself the assertion.
 *
 * # Why it is the cross-pin for a second implementation
 *
 * `RemoteTransport` carries its own copy of the #5146/#5298 polarity table —
 * `nullValueSatisfiesOperator` / `nullSafeNegationOperand` in
 * `remote-transport.ts`, the third in-tree instance after `driver-sql`'s and
 * `service-analytics`'s `read-scope-sql.ts`. The copy is deliberate (that file's
 * header gives the two reasons), and a deliberate copy owes a pin that goes red
 * when the copies drift. This is it, and it is stronger than a text comparison
 * would be: it does not ask whether the two implementations LOOK alike, it asks
 * whether they ANSWER alike, on rows, through the real driver.
 *
 * # Why every case asserts the canonical answer too
 *
 * Parity alone is satisfiable by breaking both transports the same way — the
 * failure mode a "the two agree" suite invites. So each case carries the row ids
 * the ruling requires, and both faces are checked against them. Agreement is
 * necessary; agreement on the RIGHT answer is the assertion.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILTER_LOGIC_ROWS } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import type { DriverQuery } from '@objectstack/spec/contracts';

/**
 * The SHARED conformance fixture, not a private one. `d` is valued on rows 1-2
 * (`v1`, `v2`) and NULL on rows 3-4, which is the whole instrument: a filter
 * that silently drops no-value rows loses exactly half the table. Reusing it
 * means this suite and `FILTER_LOGIC_CASES` cannot drift apart about what a
 * no-value row IS.
 */
const CONFORMANCE_OBJECT = {
  name: 'conformance',
  fields: {
    a: { type: 'string' },
    b: { type: 'string' },
    c: { type: 'string' },
    d: { type: 'string' },
    owner: { type: 'string' },
    status: { type: 'string' },
    parent_object: { type: 'string' },
    parent_id: { type: 'string' },
  },
};

const ids = (rows: Array<Record<string, unknown>>): string[] =>
  rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));

/**
 * Every case both transports must answer identically, with the answer the
 * #5146 / #5298 rulings require.
 *
 * Read the list as three groups: the four operators the rulings cover, the
 * INVERSIONS that prove the polarity is per operator rather than a blanket null
 * escape, and the shapes where a lost parenthesis would show up.
 */
const PARITY_CASES: Array<{ name: string; filter: unknown; expected: string[]; why: string }> = [
  // ── The four operators, positive direction: a no-value row IS returned ────
  {
    name: '$ne excludes the value, keeps the rows that have none',
    filter: { d: { $ne: 'v1' } },
    expected: ['2', '3', '4'],
    why: '#5298. Bare `d <> ?` is UNKNOWN for a NULL d, so rows 3-4 vanished on remote.',
  },
  {
    name: '$nin holds vacuously for a value that is not there',
    filter: { d: { $nin: ['v1'] } },
    expected: ['2', '3', '4'],
    why: '#5298. `NOT IN` is UNKNOWN for a NULL column, exactly like `<>`.',
  },
  {
    name: '$nin over BOTH values still keeps the no-value rows',
    filter: { d: { $nin: ['v1', 'v2'] } },
    expected: ['3', '4'],
    why: 'The complement of the case above: nothing is left but the rows with no value, so a transport that drops them answers the empty set.',
  },
  {
    name: '$notContains is true of a value that is not there',
    filter: { d: { $notContains: 'v1' } },
    expected: ['2', '3', '4'],
    why: '#5298. `NOT LIKE` is UNKNOWN for a NULL column — and it is the operator with NO dialect one-operator form, which is why all three implementations use the OR expansion.',
  },
  {
    name: '$notContains matching every valued row leaves only the no-value rows',
    filter: { d: { $notContains: 'v' } },
    expected: ['3', '4'],
    why: 'Both v1 and v2 contain "v", so this is the LIKE half of the $nin complement above.',
  },
  {
    name: '$not of an equality returns the rows with no value',
    filter: { $not: { d: 'v1' } },
    expected: ['2', '3', '4'],
    why: '#5146, the original ruling. This is the shape a CEL `!expr` read scope lowers to.',
  },

  // ── The inversions: polarity is per OPERATOR, never a blanket null escape ─
  {
    name: '$ne: null stays TOTAL — "has any value" is false for a row with none',
    filter: { d: { $ne: null } },
    expected: ['1', '2'],
    why: '#5298 is explicit that polarity follows the COMPARAND, not the operator name. `IS NOT NULL` is already total and must NOT be widened to include the rows it exists to exclude.',
  },
  {
    name: '$not of $ne means "is the value", and a no-value row is not it',
    filter: { $not: { d: { $ne: 'v1' } } },
    expected: ['1'],
    why: 'The widening trap #5146 names: a blanket `OR col IS NULL` under the negation would hand back rows 3-4 — exactly the rows the filter excludes.',
  },
  {
    name: '$not of $nin means "is among the list"',
    filter: { $not: { d: { $nin: ['v1'] } } },
    expected: ['1'],
    why: 'Same inversion through the set operator.',
  },
  {
    name: '$not of $notContains means "does contain"',
    filter: { $not: { d: { $notContains: 'v1' } } },
    expected: ['1'],
    why: 'Same inversion through the substring operator.',
  },
  {
    name: '$not of $null true is the valued rows',
    filter: { $not: { d: { $null: true } } },
    expected: ['1', '2'],
    why: '`IS NULL` is already total, so the rewrite must leave it alone — a guard stacked on it would compile a contradiction.',
  },
  {
    name: '$not of $exists false is the valued rows',
    filter: { $not: { d: { $exists: false } } },
    expected: ['1', '2'],
    why: '`$exists: false` and `$null: true` are one question asked twice (#5298 ③), so their negations must agree.',
  },

  // ── De Morgan, and the shapes a lost parenthesis leaks ────────────────────
  {
    name: '$not over a nested $or',
    filter: { $not: { $or: [{ d: 'v1' }, { d: 'v2' }] } },
    expected: ['3', '4'],
    why: 'The guard rides each LEAF, not the NOT: hoisted above this $or, a NULL d would satisfy the negation even when the other disjunct is satisfied.',
  },
  {
    name: '$not over a nested $and',
    filter: { $not: { $and: [{ d: 'v1' }, { a: 'x' }] } },
    expected: ['2', '3', '4'],
    why: 'De Morgan is sound over two-valued leaves, so nesting needs no special case.',
  },
  {
    name: 'a NULL-safe $ne ANDs with a sibling key instead of leaking past it',
    filter: { a: 'qq', d: { $ne: 'v1' } },
    expected: ['3', '4'],
    why: 'THE parenthesis case. `buildWhereSQL` joins a node\'s clauses with a bare AND, so an unwrapped `d IS NULL OR d <> ?` parses as `(a = ? AND d IS NULL) OR d <> ?` and leaks row 2 — a row the caller\'s own `a` predicate excludes.',
  },
  {
    name: 'a NULL-safe $notContains ANDs with a sibling key too',
    filter: { a: 'qq', d: { $notContains: 'v1' } },
    expected: ['3', '4'],
    why: 'The same trap on the LIKE branch, where the guard is applied inside `pushLike` rather than at the call site.',
  },
  {
    name: 'a NULL-safe $ne inside one $or branch does not widen its sibling branch',
    filter: { $or: [{ a: 'x', d: { $ne: 'v1' } }, { a: 'qq', b: 'y' }] },
    expected: ['2', '3'],
    why: 'Row 1 (a=x, d=v1) must stay out and row 4 (a=qq, b=zz) must stay out; a leaked OR pulls both back in.',
  },
];

/** Every non-boolean `$exists` comparand both transports must REFUSE. */
const NON_BOOLEAN_EXISTS: unknown[] = ['yes', 1, 0, null, undefined, {}, 'false', []];

/**
 * [#6050] Every COMPARAND position an `undefined` can occupy, which both
 * transports must refuse with the same code and the same sentence.
 *
 * #6047 deliberately left this column of the matrix uncovered — it was writing
 * the NULL-safe polarity table and `undefined` turned out to be a DIFFERENT
 * defect underneath it, filed as #6050 rather than settled as a rider. This is
 * that column, measured on `origin/main` at `cba7454df` before the fix:
 *
 * | filter | LOCAL | REMOTE |
 * |---|---|---|
 * | `{ d: undefined }`                    | knex `Undefined binding(s)` | `['3','4']` |
 * | `{ d: { $eq: undefined } }`           | knex `Undefined binding(s)` | `['3','4']` |
 * | `{ $not: { d: undefined } }`          | knex `Undefined binding(s)` | `['1','2']` |
 * | `{ d: { $ne: undefined } }`           | `['1','2']`                 | `['1','2']` |
 * | `{ $not: { d: { $ne: undefined } } }` | `[]`                        | `['3','4']` |
 * | `{ d: { $in: [undefined] } }`         | knex `Undefined binding(s)` | `[]` |
 * | `{ d: { $gt: undefined } }`           | knex `Undefined binding(s)` | `[]` |
 *
 * Note the two rows that were never a CRASH-vs-answer split: `$ne: undefined`
 * agreed by coincidence, and `$not: { $ne: undefined }` disagreed while BOTH
 * sides answered — this driver's own guard contradicting its own emitter
 * (`=== null` versus `== null`), which is the #5298 invariant broken at its
 * definition. Ruled REFUSED on 2026-08-07, per #5347-A.
 */
const UNDEFINED_COMPARANDS: Array<[label: string, where: unknown]> = [
  ['a direct comparand', { d: undefined }],
  ['$eq', { d: { $eq: undefined } }],
  ['$ne', { d: { $ne: undefined } }],
  ['$gt', { d: { $gt: undefined } }],
  ['$contains', { d: { $contains: undefined } }],
  ['$notContains', { d: { $notContains: undefined } }],
  ['an $in member', { d: { $in: [undefined] } }],
  ['an $in member beside a good one', { d: { $in: ['v1', undefined] } }],
  ['a $nin member', { d: { $nin: [undefined] } }],
  ['inside $and', { $and: [{ d: undefined }] }],
  ['inside $or, beside a satisfiable disjunct', { $or: [{ a: 'x' }, { d: undefined }] }],
  ['inside $not', { $not: { d: undefined } }],
  ['inside $not, one operator down', { $not: { d: { $ne: undefined } } }],
];

describe('[#5903] TursoDriver LOCAL and REMOTE answer the NULL family identically', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([CONFORMANCE_OBJECT]);
    for (const row of FILTER_LOGIC_ROWS) {
      await local.create('conformance', { ...row }, { bypassTenantAudit: true });
    }

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://parity.turso.io', client: stub as never });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(CONFORMANCE_OBJECT.name, CONFORMANCE_OBJECT);
    for (const row of FILTER_LOGIC_ROWS) {
      await remote.create('conformance', { ...row });
    }
  });

  afterAll(async () => {
    await local.disconnect();
    await remote.disconnect();
    stub.close();
  });

  /**
   * The fixture control, on BOTH faces. A parity suite whose two sides seeded
   * different rows compares nothing, and a `d` stored as `''` instead of NULL
   * would turn every case below green for the wrong reason.
   */
  it('both transports hold the same four rows, with `d` really NULL on 3 and 4', async () => {
    expect(ids(await local.find('conformance', {}))).toEqual(['1', '2', '3', '4']);
    expect(ids(await remote.find('conformance', {}))).toEqual(['1', '2', '3', '4']);
    for (const driver of [local, remote]) {
      expect(ids(await driver.find('conformance', { where: { d: { $null: true } } } as DriverQuery))).toEqual(['3', '4']);
      expect(ids(await driver.find('conformance', { where: { d: { $null: false } } } as DriverQuery))).toEqual(['1', '2']);
    }
  });

  for (const c of PARITY_CASES) {
    it(c.name, async () => {
      const localIds = ids(await local.find('conformance', { where: c.filter } as DriverQuery));
      const remoteIds = ids(await remote.find('conformance', { where: c.filter } as DriverQuery));
      // Agreement first — this is the assertion #5903 is about.
      expect(remoteIds, `local/remote divergence. ${c.why}`).toEqual(localIds);
      // …and agreement on the RIGHT answer, so a shared regression cannot pass
      // by making both faces wrong in the same direction.
      expect(localIds, c.why).toEqual(c.expected);
    });
  }

  it('count() agrees with find() on both transports, case for case', async () => {
    // A `count` that disagrees with the list under it is the same divergence
    // wearing a total instead of a row set — and remote builds its COUNT
    // statement separately from its SELECT.
    for (const c of PARITY_CASES) {
      expect(await local.count('conformance', { where: c.filter } as DriverQuery), `local ${c.name}`).toBe(
        c.expected.length,
      );
      expect(await remote.count('conformance', { where: c.filter } as DriverQuery), `remote ${c.name}`).toBe(
        c.expected.length,
      );
    }
  });

  it('both transports REFUSE a non-boolean `$exists` comparand', async () => {
    // The fork that pointed the OTHER way: PR #5962 landed this refusal on
    // `driver-sql` (so LOCAL inherited it) while remote kept answering, which
    // made a filter out of contract throw on one url and return the valued rows
    // on another. Both faces speak `INVALID_FILTER` / 400 now.
    for (const value of NON_BOOLEAN_EXISTS) {
      const where = { d: { $exists: value } };
      for (const [label, driver] of [['local', local], ['remote', remote]] as const) {
        const err = (await driver
          .find('conformance', { where } as unknown as DriverQuery)
          .catch((e) => e)) as Error & { code?: string; status?: number };
        expect(err, `${label} ${JSON.stringify(value) ?? 'undefined'}`).toBeInstanceOf(Error);
        expect(err.code, label).toBe('INVALID_FILTER');
        expect(err.status, label).toBe(400);
        expect(err.message, label).toContain(
          'requires a boolean comparand (true or false)',
        );
      }
    }
  });

  it('both transports still COMPILE the two booleans `$exists` declares', async () => {
    for (const driver of [local, remote]) {
      expect(ids(await driver.find('conformance', { where: { d: { $exists: true } } } as DriverQuery))).toEqual(['1', '2']);
      expect(ids(await driver.find('conformance', { where: { d: { $exists: false } } } as DriverQuery))).toEqual(['3', '4']);
    }
  });

  // ── [#6050] The `undefined` column of the matrix ───────────────────────────

  describe('[#6050] both transports refuse an undefined comparand, identically', () => {
    for (const [label, where] of UNDEFINED_COMPARANDS) {
      it(`refuses ${label} on both faces, with one code and one sentence`, async () => {
        const errors: Record<string, Error & { code?: string; status?: number }> = {};
        for (const [faceLabel, driver] of [['local', local], ['remote', remote]] as const) {
          const err = (await driver
            .find('conformance', { where } as unknown as DriverQuery)
            .catch((e) => e)) as Error & { code?: string; status?: number };
          expect(err, faceLabel).toBeInstanceOf(Error);
          // The ENVELOPE is half the fix (#1116 / #4436): LOCAL used to throw
          // knex's bare `Undefined binding(s)` with neither code nor status, so
          // an assertion that only checked "it threw" would have passed on the
          // driver this issue was filed against.
          expect(err.code, faceLabel).toBe('INVALID_FILTER');
          expect(err.status, faceLabel).toBe(400);
          errors[faceLabel] = err;
        }
        // #5240 — one condition, one wording. The two compilers are independent
        // implementations, so the sentence is what holds them together; only
        // the transport prefix and the `on '<object>'` qualifier may differ.
        const requirement =
          '@objectstack/spec FieldOperatorsSchema declares no undefined comparand';
        expect(errors.local.message).toContain(requirement);
        expect(errors.remote.message).toContain(requirement);
        expect(errors.local.message).toContain('Write null if you meant the null predicate');
        expect(errors.remote.message).toContain('Write null if you meant the null predicate');
      });
    }

    /**
     * ⛔ The control this whole block needs: refusing `undefined` must not have
     * cost `null` a single answer, on either face. Every row below is one of
     * `PARITY_CASES`' own null spellings, re-asserted here so a regression
     * caused by the #6050 gate is attributed to the gate.
     */
    it('null comparands still answer identically, and correctly, on both faces', async () => {
      const NULL_CASES: Array<[unknown, string[]]> = [
        [{ d: null }, ['3', '4']],
        [{ d: { $eq: null } }, ['3', '4']],
        [{ d: { $ne: null } }, ['1', '2']],
        [{ d: { $null: true } }, ['3', '4']],
        [{ d: { $null: false } }, ['1', '2']],
        [{ $not: { d: null } }, ['1', '2']],
        [{ $not: { d: { $ne: null } } }, ['3', '4']],
        [{ d: { $in: ['v1', null] } }, ['1']],
      ];
      for (const [where, expected] of NULL_CASES) {
        const localIds = ids(await local.find('conformance', { where } as DriverQuery));
        const remoteIds = ids(await remote.find('conformance', { where } as DriverQuery));
        expect(remoteIds, `divergence on ${JSON.stringify(where)}`).toEqual(localIds);
        expect(localIds, `wrong answer on ${JSON.stringify(where)}`).toEqual(expected);
      }
    });
  });
});
