// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5813] `convertWhere()` translates better-auth's WHOLE where-operator
 * vocabulary, or refuses the query by name — it never drops a predicate.
 *
 * The adapter's `if / else if` chain covered eight of better-auth's eleven
 * operators. `not_in` / `starts_with` / `ends_with` fell off the end of it: no
 * key was written into `filter`, nothing was logged, and a `where` carrying
 * only such a condition compiled to `{}`.
 *
 * A dropped predicate does not narrow a result set, it WIDENS it — on the
 * identity tables, through a mounted admin route:
 *
 *   - `GET /api/v1/auth/admin/list-users?searchOperator=starts_with` puts the
 *     caller's `searchValue` straight into `where` (better-auth's admin plugin
 *     routes), so it answered with EVERY user instead of the matching ones, and
 *     `filterOperator`'s enum is the whole vocabulary — `not_in` included, so
 *     it excluded nobody;
 *   - `update` / `delete` / `consumeOne` / `incrementOne` resolve their target
 *     with `findOne(filter)` first, so `{}` picked an ARBITRARY row and the
 *     write landed on the wrong record.
 *
 * Three faces, and each sees something the others cannot:
 *
 *   1. CONTRACT — what the adapter emits. A spy engine says which ObjectQL
 *      operator earned the result; a behavioural pass alone could be right for
 *      the wrong reason.
 *   2. VOCABULARY — that the emitted set covers better-auth's own runtime
 *      `whereOperators` list, member by member. This is the face that would
 *      have caught #5813 before it shipped, and it is the one that catches the
 *      NEXT operator better-auth adds: the other two only ever test the
 *      operators someone remembered to write a case for.
 *   3. BEHAVIOUR — what a REAL backend then answers, read and write. A
 *      translation that is spelled right and evaluated wrong looks identical to
 *      face 1.
 *
 * Plus the tail: an operator outside the vocabulary must THROW. #5813 existed
 * because the chain had no `else`; restoring the invariant means the next
 * unhandled operator is refused by name rather than silently widening a query
 * (the #3948 family's discipline — driver-memory's matcher `default:` arm and
 * objectql's `having` were both changed to refuse for this reason).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { whereOperators } from '@better-auth/core/db/adapter';
import { FILTER_OPERATORS } from '@objectstack/spec/data';
import type { QueryAST } from '@objectstack/spec/data';
import type { IDataEngine } from '@objectstack/core';
import {
  createObjectQLAdapterFactory,
  createObjectQLAdapter,
  SUPPORTED_WHERE_OPERATORS,
} from './objectql-adapter';

/** Keeps the driver's own lifecycle logging out of the test output. */
const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

const NOW = new Date('2026-08-06T00:00:00.000Z').toISOString();

/**
 * Rows chosen so each of the three operators has something to EXCLUDE that a
 * neighbouring operator would have matched — a fixture where every row passes
 * cannot tell "the predicate was applied" from "the predicate was dropped".
 *
 *   starts_with 'abc' → abc_one, abc_z   (x_abc contains it but does not start with it)
 *   ends_with   'abc' → x_abc            (abc_one / abc_z start with it instead)
 *   not_in [abc_one, x_abc] → abc_z, zed
 *
 * All lowercase on purpose. `$startsWith`/`$endsWith` are case-SENSITIVE at the
 * contract layer (#5701 Q2=A) but driver-memory's mingo path compiles them with
 * the `i` flag while its own reference matcher uses `String.prototype
 * .startsWith` — that in-driver divergence is #5702's budget, not this PR's, so
 * no fixture here varies by case and no assertion below depends on which way it
 * is resolved.
 */
const SEED = [
  { id: 'u_abc1', name: 'abc_one', email: 'abc-one@example.com' },
  { id: 'u_xabc', name: 'x_abc', email: 'x-abc@example.com' },
  { id: 'u_abcz', name: 'abc_z', email: 'abc-z@example.com' },
  { id: 'u_zed', name: 'zed', email: 'zed@example.com' },
];

/**
 * An engine facade over a REAL `InMemoryDriver`.
 *
 * `delete` opens with ObjectQL's OWN dispatch predicate
 * ({@link assertEngineDeleteDispatch}) instead of a hand-mirrored `if`, so this
 * double cannot accept a call the real engine refuses (#4550, from #4434) — and
 * the by-id branch is the only one the adapter ever takes, because it resolves
 * the row first and then deletes it by primary key. `update` is deliberately
 * absent: nothing here exercises it, and an unexercised write verb is a second
 * contract to keep honest for no gain.
 */
function memoryEngine(driver: InMemoryDriver): IDataEngine {
  // The query bag keeps its declared driver-side type with no `any` erasure —
  // `query-options/no-any-erasure` (#4674/#4918) counts test-side calls too.
  return {
    find: (object: string, query: QueryAST) => driver.find(object, query),
    findOne: (object: string, query: QueryAST) => driver.findOne(object, query),
    count: (object: string, query?: QueryAST) => driver.count(object, query),
    delete: async (object: string, options: Record<string, unknown>) => {
      const dispatch = assertEngineDeleteDispatch(options);
      // `by-id` is the only reachable branch here; `multi` would mean the
      // adapter stopped resolving the row first, which is a different bug.
      if (dispatch.kind !== 'by-id') throw new Error(`unexpected dispatch: ${dispatch.kind}`);
      return driver.delete(object, dispatch.id as string);
    },
  } as unknown as IDataEngine;
}

async function seededAdapter() {
  const driver = new InMemoryDriver({ logger: silentLogger });
  await driver.connect();
  for (const row of SEED) {
    await driver.create('sys_user', { ...row, emailVerified: false, createdAt: NOW, updatedAt: NOW });
  }
  const adapter: any = (createObjectQLAdapterFactory(memoryEngine(driver)) as any)({} as any);
  return { driver, adapter };
}

/** A `findMany` carrying exactly one better-auth condition. */
function oneConditionQuery(field: string, operator: string, value: unknown) {
  return {
    model: 'user',
    where: [{ field, value, operator, connector: 'AND' }],
    limit: 100,
  } as any;
}

/**
 * A representative comparand per operator, used to drive every member of
 * better-auth's vocabulary through the adapter in the coverage face. `in` /
 * `not_in` must be arrays — better-auth's own `transformWhereClause` throws
 * `Value must be an array` for `in` otherwise.
 */
const COMPARAND: Record<string, unknown> = {
  eq: 'zed',
  ne: 'zed',
  lt: 'zed',
  lte: 'zed',
  gt: 'zed',
  gte: 'zed',
  in: ['zed'],
  not_in: ['zed'],
  contains: 'zed',
  starts_with: 'zed',
  ends_with: 'zed',
};

// ---------------------------------------------------------------------------
// Face 1 — the contract: which ObjectQL operator each translation emits
// ---------------------------------------------------------------------------

describe('[#5813] convertWhere emits the three missing operators', () => {
  let engine: IDataEngine;

  beforeEach(() => {
    engine = {
      insert: vi.fn().mockResolvedValue({ id: '1' }),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    } as unknown as IDataEngine;
  });

  const adapterOf = () => (createObjectQLAdapterFactory(engine) as any)({} as any);

  it.each([
    ['not_in', ['a@b.com', 'c@d.com'], 'email', { email: { $nin: ['a@b.com', 'c@d.com'] } }],
    ['starts_with', 'abc', 'name', { name: { $startsWith: 'abc' } }],
    ['ends_with', 'abc', 'name', { name: { $endsWith: 'abc' } }],
  ])('%s → the ObjectQL operator, not an empty filter', async (operator, value, field, expected) => {
    await adapterOf().findMany(oneConditionQuery(field as string, operator as string, value));

    const [object, query] = (engine.find as any).mock.calls[0];
    expect(object).toBe('sys_user');
    expect(query.where).toEqual(expected);
    // Spelled out separately because it is the DEFECT's exact shape, and the
    // one an `toEqual` regression would be least likely to name in its output:
    // an empty filter is a whole-table read, not a narrow one.
    expect(query.where).not.toEqual({});
  });

  it('the three operators it emits are ones every backend must evaluate', () => {
    // Same reasoning as #5710's `$contains` pin: an operator outside the
    // protocol's runtime allowlist is one some backend is free not to answer,
    // which is how the auth path ends up meaning different things on the memory
    // double an app's tests use and the SQL backend production runs (#4706).
    expect(FILTER_OPERATORS).toContain('$nin');
    expect(FILTER_OPERATORS).toContain('$startsWith');
    expect(FILTER_OPERATORS).toContain('$endsWith');
  });

  it('carries the predicate into `count` too, not only `find`', async () => {
    // `/admin/list-users` answers with rows AND a total; a filter dropped on
    // the count path reports the whole table's size next to a filtered page.
    await adapterOf().count({
      model: 'user',
      where: [{ field: 'name', value: 'abc', operator: 'starts_with', connector: 'AND' }],
    } as any);

    const [, query] = (engine.count as any).mock.calls[0];
    expect(query.where).toEqual({ name: { $startsWith: 'abc' } });
  });

  it('combines a translated operator with its neighbours instead of replacing them', async () => {
    await adapterOf().findMany({
      model: 'user',
      where: [
        { field: 'name', value: 'abc', operator: 'starts_with', connector: 'AND' },
        { field: 'email', value: ['x@y.com'], operator: 'not_in', connector: 'AND' },
        { field: 'emailVerified', value: true, operator: 'eq', connector: 'AND' },
      ],
      limit: 100,
    } as any);

    const [, query] = (engine.find as any).mock.calls[0];
    expect(query.where).toEqual({
      name: { $startsWith: 'abc' },
      email: { $nin: ['x@y.com'] },
      // `supportsBooleans: false` — better-auth converts `true` to `1` before
      // the adapter sees it, so this is what an untouched `eq` looks like.
      email_verified: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Face 2 — the vocabulary: every member of better-auth's list is translated
// ---------------------------------------------------------------------------

describe('[#5813] the whole better-auth vocabulary is covered', () => {
  it('the adapter list and the runtime list from better-auth are the same set', () => {
    // Read from `@better-auth/core/db/adapter` at RUNTIME, not restated here.
    // A restated list agrees with upstream exactly until upstream changes —
    // which is the event this pin exists to catch, and the event that created
    // #5813 in the first place.
    expect([...SUPPORTED_WHERE_OPERATORS].sort()).toEqual([...whereOperators].sort());
  });

  it.each(whereOperators.map((op) => [op]))(
    '`%s` produces a predicate rather than an empty filter',
    async (operator) => {
      const engine = {
        find: vi.fn().mockResolvedValue([]),
      } as unknown as IDataEngine;
      const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);

      await adapter.findMany(oneConditionQuery('name', operator, COMPARAND[operator]));

      const [, query] = (engine.find as any).mock.calls[0];
      // Deliberately weaker than face 1: this face asserts only that the
      // condition SURVIVED translation. Which key it becomes is face 1's
      // question, and stating it twice would mean a new operator's pin fails
      // here for a reason this test cannot explain.
      expect(Object.keys(query.where)).toEqual(['name']);
    },
  );
});

// ---------------------------------------------------------------------------
// Face 3 — the behaviour: what a real backend answers, read and write
// ---------------------------------------------------------------------------

describe('[#5813] the predicates really filter on a real backend', () => {
  it('`starts_with` excludes a row that merely CONTAINS the value', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(oneConditionQuery('name', 'starts_with', 'abc'));

    // `x_abc` is the discriminating row: a dropped predicate returns all four,
    // a `contains` translation returns three, only an anchored prefix returns
    // these two.
    expect(rows.map((r) => r.name).sort()).toEqual(['abc_one', 'abc_z']);
  });

  it('`ends_with` excludes the rows that START with the value', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(oneConditionQuery('name', 'ends_with', 'abc'));

    expect(rows.map((r) => r.name)).toEqual(['x_abc']);
  });

  it('`not_in` really excludes the listed rows', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(
      oneConditionQuery('name', 'not_in', ['abc_one', 'x_abc']),
    );

    expect(rows.map((r) => r.name).sort()).toEqual(['abc_z', 'zed']);
  });

  it('`count` counts the matches, not the table', async () => {
    const { adapter } = await seededAdapter();
    const n: number = await adapter.count({
      model: 'user',
      where: [{ field: 'name', value: 'abc', operator: 'starts_with', connector: 'AND' }],
    } as any);

    // The whole table is 4. A dropped predicate is not "a slightly wrong
    // number" on this path — it is the table's size.
    expect(n).toBe(2);
  });

  it('a write selects its OWN row, not an arbitrary one', async () => {
    const { driver, adapter } = await seededAdapter();

    // The sharpest half of #5813. `delete` resolves its target with
    // `findOne(filter)` and then deletes by id, so an empty filter deleted
    // whatever row came back first — `abc_one` here, four rows away from the
    // one the caller named.
    await adapter.delete({
      model: 'user',
      where: [{ field: 'name', value: 'zed', operator: 'starts_with', connector: 'AND' }],
    } as any);

    // Read back through the driver with a TYPED query bag — an `as any` here
    // would be counted by `check:query-options-erasure` (#4674/#4918), and
    // nothing about this read is off-contract.
    const left = await driver.find('sys_user', {
      object: 'sys_user',
      fields: ['id'],
    } satisfies QueryAST);
    expect(left.map((r: any) => r.id).sort()).toEqual(['u_abc1', 'u_abcz', 'u_xabc']);
  });
});

// ---------------------------------------------------------------------------
// The tail — an operator outside the vocabulary is refused by name
// ---------------------------------------------------------------------------

describe('[#5813] an unrecognised operator is refused, never dropped', () => {
  const fabricated = 'fuzzy';

  it('throws from the factory adapter, naming the operator and the field', async () => {
    const engine = { find: vi.fn().mockResolvedValue([]) } as unknown as IDataEngine;
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);

    // better-auth's own `transformWhereClause` forwards `operator` untouched —
    // it validates only that `in` carries an array — so an operator from a
    // newer better-auth, or a caller that builds a clause by hand, reaches
    // `convertWhere` verbatim.
    await expect(
      adapter.findMany(oneConditionQuery('name', fabricated, 'abc')),
    ).rejects.toThrow(/fuzzy/);

    // The message is the operating instruction: which operator, on which
    // field, and what the supported set is.
    await expect(
      adapter.findMany(oneConditionQuery('name', fabricated, 'abc')),
    ).rejects.toThrow(/'name'/);

    // And the read never happened — refusing means answering nothing, not
    // answering a wider question.
    expect((engine.find as any).mock.calls.length).toBe(0);
  });

  it('throws on the legacy raw adapter too — one `convertWhere`, one rule', async () => {
    const engine = { find: vi.fn().mockResolvedValue([]) } as unknown as IDataEngine;
    const adapter = createObjectQLAdapter(engine);

    await expect(
      adapter.findMany({
        model: 'user',
        where: [{ field: 'name', value: 'abc', operator: fabricated, connector: 'AND' }] as any,
        limit: 100,
      }),
    ).rejects.toThrow(/fuzzy/);
  });

  it('lists the supported operators so the message says what to do', async () => {
    const engine = { find: vi.fn().mockResolvedValue([]) } as unknown as IDataEngine;
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);

    await expect(
      adapter.findMany(oneConditionQuery('name', fabricated, 'abc')),
    ).rejects.toThrow(/starts_with/);
  });
});

// ---------------------------------------------------------------------------
// Scope of the refusal — `mode` is not an operator (#5814's seam)
// ---------------------------------------------------------------------------

describe('[#5813] the refusal is scoped to operators', () => {
  it('a `mode` it does not read is not a reason to refuse the query', async () => {
    const engine = { find: vi.fn().mockResolvedValue([]) } as unknown as IDataEngine;
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);

    // `Where.mode: 'insensitive'` is a sibling FIELD of `operator`, not a
    // member of the vocabulary. `convertWhere` still ignores it — that gap is
    // #5814, which is in the decision box because "case-insensitive equality"
    // has no ObjectQL operator to translate INTO, and picking one changes the
    // public filter contract.
    //
    // This pin says only what #5813 changed: the tail refusal reads `operator`
    // and nothing else, so it neither refuses `mode` nor pretends to honour it.
    // When #5814 lands, the `case` arms below are where a mode-aware
    // translation attaches, and the `default` arm is where an unrepresentable
    // mode would be refused — the same seam, one level in.
    await expect(
      adapter.findMany({
        model: 'user',
        where: [
          { field: 'name', value: 'abc', operator: 'starts_with', connector: 'AND', mode: 'insensitive' },
        ],
        limit: 100,
      } as any),
    ).resolves.toEqual([]);

    const [, query] = (engine.find as any).mock.calls[0];
    expect(query.where).toEqual({ name: { $startsWith: 'abc' } });
  });
});
