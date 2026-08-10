// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5710] better-auth's `contains` is a LITERAL substring search — the adapter
 * must not translate it into a bare `$regex`.
 *
 * `convertWhere()` used to emit `{ field: { $regex: condition.value } }`, which
 * puts an unescaped, caller-supplied comparand (`/admin/list-users`'
 * `searchValue`, a SCIM filter value) into a PATTERN position. What that value
 * then meant depended on the backend under the auth path:
 *
 *   - driver-memory compiled it to `new RegExp(value)` — `a.b` matched `axb`,
 *     `^x` anchored, and an unbalanced `(` was an illegal pattern;
 *   - driver-sql / -sqlite-wasm / -turso compiled it to a substring
 *     `LIKE '%value%'` with `%`/`_`/`\` escaped — metacharacters literal.
 *
 * So one better-auth query answered differently on the memory double an app's
 * tests run against and on the SQL backend production runs (#4706's shape, on
 * the authentication path). These pins hold the operator at `$contains` — a
 * member of the spec's `FILTER_OPERATORS`, i.e. one every backend is required
 * to evaluate, as a literal substring.
 *
 * Three faces, deliberately: the first pins WHAT the adapter emits (the
 * contract), the second pins what a real backend then ANSWERS (the behaviour),
 * and the third pins the property that lets the second face FAIL at all (the
 * discrimination). The first alone cannot see a translation that is spelled
 * right and evaluated wrong; the second alone cannot say which operator earned
 * the result; and without the third, face 2 would be an always-green pin the
 * day the backend starts aliasing `$regex` again.
 *
 * ## Backend note (#5893 / #5830 / #5704)
 *
 * Face 2's backend was `InMemoryDriver` when this file landed with #5812; it is
 * now `@objectstack/driver-sql` + better-sqlite3 `:memory:`, the harness its
 * sibling `auth-where-operator-coverage.test.ts` already uses (PR #5880), built
 * the way the rest of the repo builds an ephemeral store (`examples/app-crm`,
 * `cli db clean`, PR #5715's `makeDefaultDriver()`).
 *
 * The swap was DEFERRED once, on measurement, and this is the deferral being
 * discharged rather than forgotten — the history matters because it names the
 * exact hazard this file now guards against:
 *
 *   - **Then (#5830, PR #5880).** driver-sql routed `$regex` through the same
 *     `applyContainsLike` as `$contains` (a `case '$regex':` fallthrough), so
 *     the SQL backend answered the two operators cell-for-cell alike. Measured
 *     there: with the defect restored, memory failed 3 of these behavioural
 *     pins and sqlite passed all 4. Migrating then would have produced pins
 *     that are green because nothing distinguishes them — coverage that is
 *     blind to the very defect it names.
 *   - **Now (#5702, PR #6549).** The fallthrough is deleted and `$regex` is
 *     RETIRED: driver-sql refuses it by name in the ADR-0112 envelope
 *     (`code: 'INVALID_FILTER'`, `status: 400`), prescribing `$icontains`. The
 *     defect is therefore witnessed on the SQL arm again — not as a different
 *     row set, but as a REFUSAL, which is a strictly better reason: a bare
 *     `$regex` from this adapter no longer answers a subtly wrong question, it
 *     answers nothing and says why.
 *
 * Re-measured for #5893 before this file moved (both directions, `flock`-ed
 * local run, and again with the defect restored):
 *
 *   - fixed adapter, sqlite: `$contains 'a.b'` → `['a.b']`, `'^a'` → `[]`,
 *     `'('` → `['x(y']`, `'xb'` → `['axb']` — identical, value for value, to
 *     what memory answered, so the migration costs the fixture nothing;
 *   - defect restored (adapter emits a bare `$regex` again), sqlite: all four
 *     behavioural pins RED via the refusal, plus the contract face.
 *
 * Face 3 exists so that this stays true without anyone re-measuring by hand. It
 * is the load-bearing half of the migration: if driver-sql ever re-aliases
 * `$regex` onto the substring path, face 3 goes red and says so, instead of
 * face 2 quietly reverting to the always-green pin #5830 refused to create.
 *
 * Case semantics are deliberately untested here, exactly as in the sibling
 * file — but the REASON changed under this file, so it is restated rather than
 * left stale. It used to be that sqlite's `LIKE` folds ASCII case, so
 * `$contains` folded on this backend while the contract layer called it
 * case-SENSITIVE (#5701 Q2 = A), and driver-sql could pin that gap only through
 * the compiled SQL. **#6518 closed it**: the SQL family emits `GLOB` on the
 * SQLite dialects now, so `$contains` is case-exact here too and
 * `sql-driver-icontains-and-retired-operators.test.ts` pins it in ROWS.
 *
 * Nothing below moves either way. Every fixture is lower-case and every
 * comparand matches its row's case exactly, so the four behavioural pins hold
 * identically before and after that change — case belongs to the driver's own
 * conformance suites, while what this file is about is which OPERATOR the
 * adapter emits.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { FILTER_OPERATORS } from '@objectstack/spec/data';
import type { QueryAST } from '@objectstack/spec/data';
import type { IDataEngine } from '@objectstack/core';
import { createObjectQLAdapterFactory } from './objectql-adapter';

/**
 * The columns face 2 reads, declared — a real table has to be told.
 *
 * `emailVerified` / `createdAt` / `updatedAt` used to be seeded alongside these
 * and are gone with the backend swap: they were camelCase keys no assertion
 * ever read, which only a schemaless store would have accepted (`sys_user`
 * spells them `email_verified` / `created_at` / `updated_at`). Declaring the
 * fixture down to what it actually asserts on is #5806's "resolve by declaring,
 * not by relaxing" — the alternative would be declaring three columns to hold
 * values nothing looks at.
 */
const SYS_USER = {
  name: 'sys_user',
  fields: {
    name: { type: 'text', name: 'name' },
    email: { type: 'text', name: 'email' },
  },
};

/**
 * A read-only engine facade over a REAL `SqlDriver`.
 *
 * Only the three read verbs the `contains` path uses are declared. The write
 * verbs are deliberately absent rather than stubbed: seeding goes through the
 * driver directly (below), so a hand-written `delete`/`update` here would be a
 * dispatch contract this test neither needs nor is able to honour
 * (`check:engine-double-contract`, #4550).
 */
function sqlReadEngine(driver: SqlDriver): IDataEngine {
  // The query bag is forwarded with its declared driver-side type and no `any`
  // erasure: `query-options/no-any-erasure` (#4674/#4918) counts a test-side
  // `find(obj, … as any)` too, and nothing here needs to be off-contract.
  return {
    find: (object: string, query: QueryAST) => driver.find(object, query),
    findOne: (object: string, query: QueryAST) => driver.findOne(object, query),
    count: (object: string, query?: QueryAST) => driver.count(object, query),
  } as unknown as IDataEngine;
}

/** Rows whose `name`s differ only in how a regex would read the comparand. */
const SEED = [
  { id: 'u_literal', name: 'a.b', email: 'literal@example.com' },
  { id: 'u_wildcard', name: 'axb', email: 'wildcard@example.com' },
  { id: 'u_paren', name: 'x(y', email: 'paren@example.com' },
];

/**
 * Live `:memory:` databases, closed after each test — the database dies with
 * its connection, so nothing touches the host filesystem, but a file this size
 * would otherwise hold one open pool per behavioural case.
 */
const openDrivers: SqlDriver[] = [];

afterEach(async () => {
  while (openDrivers.length) {
    const driver = openDrivers.pop();
    try { await driver?.disconnect(); } catch { /* noop */ }
  }
});

async function seededAdapter() {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  // Real DDL through the driver's own path — the table every row below lands in
  // is created by the backend, not conjured by a store on first write.
  await driver.initObjects([SYS_USER]);
  for (const row of SEED) await driver.create('sys_user', row);
  const engine = sqlReadEngine(driver);
  const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
  return { driver, engine, adapter };
}

/** `findMany` with a single better-auth `contains` condition on `name`. */
function containsQuery(value: string) {
  return {
    model: 'user',
    where: [{ field: 'name', value, operator: 'contains', connector: 'AND' }],
    limit: 100,
  } as any;
}

// ---------------------------------------------------------------------------
// Face 1 — the contract: which ObjectQL operator the translation emits
// ---------------------------------------------------------------------------

describe('[#5710] convertWhere: better-auth `contains` → `$contains`', () => {
  let engine: IDataEngine;

  beforeEach(() => {
    engine = {
      insert: vi.fn().mockResolvedValue({ id: '1' }),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    } as unknown as IDataEngine;
  });

  it('emits `$contains`, never a bare `$regex`, for a `contains` search', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany(containsQuery('a.b'));

    const [object, query] = (engine.find as any).mock.calls[0];
    expect(object).toBe('sys_user');
    expect(query.where).toEqual({ name: { $contains: 'a.b' } });
    // Spelled out separately: `toEqual` above would still pass if a second,
    // regex-shaped limb were added under a different field.
    expect(JSON.stringify(query.where)).not.toContain('$regex');
  });

  it('emits an operator every backend is required to evaluate', () => {
    // The whole point of the flip: `$contains` is in the protocol's runtime
    // allowlist, `$regex` never was — it survived only because this adapter
    // produced it, which is why #5702's loud refusal was ordered after #5812's
    // flip and is now the thing face 3 reads.
    expect(FILTER_OPERATORS).toContain('$contains');
    expect(FILTER_OPERATORS).not.toContain('$regex');
  });

  it('leaves the other operators untouched', async () => {
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);
    await adapter.findMany({
      model: 'user',
      where: [
        { field: 'email', value: 'a@b.com', operator: 'eq', connector: 'AND' },
        { field: 'name', value: ['x', 'y'], operator: 'in', connector: 'AND' },
      ],
      limit: 100,
    } as any);

    const [, query] = (engine.find as any).mock.calls[0];
    expect(query.where).toEqual({ email: 'a@b.com', name: { $in: ['x', 'y'] } });
  });
});

// ---------------------------------------------------------------------------
// Face 2 — the behaviour: what a real backend answers
// ---------------------------------------------------------------------------

describe('[#5710] the comparand is a literal substring on a real backend', () => {
  it('does not read `.` as a wildcard — `a.b` matches `a.b`, not `axb`', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(containsQuery('a.b'));

    // The pin, stated in both directions: the metacharacter row is NOT matched
    // (a bare `$regex` matched it through `.` on the memory backend, and is
    // refused outright on this one), and the literal row still is.
    expect(rows.map((r) => r.name)).toEqual(['a.b']);
  });

  it('does not read `^` as an anchor', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(containsQuery('^a'));

    // As a pattern, `^a` matched `a.b` and `axb`. As a substring, nothing here
    // contains the two characters `^a`.
    expect(rows).toEqual([]);

    // A control read on the SAME fixture, because "no rows" is the one answer a
    // broken query and a correct one can both produce: an empty seed, a table
    // that never got its DDL, or a predicate the backend silently dropped would
    // all satisfy the assertion above. `a` is a substring of two of these three
    // rows, so this says the store is live and the predicate really selects.
    const control: any[] = await adapter.findMany(containsQuery('a'));
    expect(control.map((r) => r.name).sort()).toEqual(['a.b', 'axb']);
  });

  it('matches a value that is not a legal regex, instead of failing on it', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(containsQuery('('));

    // `new RegExp('(')` throws — under `$regex` this comparand could not
    // produce an answer at all (the mingo path threw, the reference matcher
    // swallowed it into a silent no-match). It is just a character now.
    expect(rows.map((r) => r.name)).toEqual(['x(y']);
  });

  it('answers an ordinary metacharacter-free search unchanged', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(containsQuery('xb'));

    expect(rows.map((r) => r.name)).toEqual(['axb']);
  });
});

// ---------------------------------------------------------------------------
// Face 3 — the discrimination: this backend can tell the two operators apart
// ---------------------------------------------------------------------------

describe('[#5893] the backend refuses the operator face 2 must never see', () => {
  it('refuses a bare `$regex` in the ADR-0112 envelope, naming its replacement', async () => {
    const { engine } = await seededAdapter();

    // Sent through the SAME engine facade the adapter reads on, so this is the
    // literal path a regressed `convertWhere` would take — not a parallel one.
    const err: any = await engine
      .find('sys_user', { where: { name: { $regex: 'a.b' } } })
      .then(() => null, (e: unknown) => e);

    // `code` AND `status`, never a bare `rejects.toThrow()`: the defect has two
    // fields and a throw-only assertion carries one bit. Before #5702 this call
    // did not throw at ALL — it ANSWERED, with `['a.b']` — so an assertion that
    // only says "the promise rejected" cannot separate "refused with the wrong
    // envelope" from "did not refuse at all", which are exactly the two ways
    // this guard can rot.
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    // The message is the operating instruction: which operator was refused, and
    // what to write instead (#5702 prescribes the replacement, not a list).
    expect(err.message).toContain('$regex');
    expect(err.message).toContain('$icontains');
  });

  it('answers the operator the adapter DOES emit, on the same fixture', async () => {
    const { engine } = await seededAdapter();

    // The other half of the pair, and the reason this face is not just a
    // driver-sql test living in the wrong package: refusing everything would
    // satisfy the case above. `$contains` and `$regex` must be told APART by
    // this backend — one answers, the other is refused — because that
    // difference is the whole reason face 2 is allowed to live on sqlite
    // (#5830 measured the world where it was not, and deferred the migration).
    const rows = await engine.find('sys_user', { where: { name: { $contains: 'a.b' } } });

    expect((rows as any[]).map((r) => r.name)).toEqual(['a.b']);
  });
});
