// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5710] better-auth's `contains` is a LITERAL substring search — the adapter
 * must not translate it into a bare `$regex`.
 *
 * `convertWhere()` used to emit `{ field: { $regex: condition.value } }`, which
 * puts an unescaped, caller-supplied comparand (`/admin/list-users`'
 * `searchValue`, a SCIM filter value) into a PATTERN position. What that value
 * then means depended on the backend under the auth path:
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
 * Two faces, deliberately: the first pins WHAT the adapter emits (the contract),
 * the second pins what a real backend then ANSWERS (the behaviour). The first
 * alone cannot see a translation that is spelled right and evaluated wrong; the
 * second alone cannot say which operator earned the result.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { FILTER_OPERATORS } from '@objectstack/spec/data';
import type { QueryAST } from '@objectstack/spec/data';
import type { IDataEngine } from '@objectstack/core';
import { createObjectQLAdapterFactory } from './objectql-adapter';

/** Keeps the driver's own lifecycle logging out of the test output. */
const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

/**
 * A read-only engine facade over a REAL `InMemoryDriver`.
 *
 * Only the three read verbs the `contains` path uses are declared. The write
 * verbs are deliberately absent rather than stubbed: seeding goes through the
 * driver directly (below), so a hand-written `delete`/`update` here would be a
 * dispatch contract this test neither needs nor is able to honour
 * (`check:engine-double-contract`, #4550).
 */
function memoryReadEngine(driver: InMemoryDriver): IDataEngine {
  // The query bag is forwarded with its declared driver-side type and no `any`
  // erasure: `query-options/no-any-erasure` (#4674/#4918) counts a test-side
  // `find(obj, … as any)` too, and nothing here needs to be off-contract.
  return {
    find: (object: string, query: QueryAST) => driver.find(object, query),
    findOne: (object: string, query: QueryAST) => driver.findOne(object, query),
    count: (object: string, query?: QueryAST) => driver.count(object, query),
  } as unknown as IDataEngine;
}

const NOW = new Date('2026-08-06T00:00:00.000Z').toISOString();

/** Rows whose `name`s differ only in how a regex would read the comparand. */
const SEED = [
  { id: 'u_literal', name: 'a.b', email: 'literal@example.com' },
  { id: 'u_wildcard', name: 'axb', email: 'wildcard@example.com' },
  { id: 'u_paren', name: 'x(y', email: 'paren@example.com' },
];

async function seededAdapter() {
  const driver = new InMemoryDriver({ logger: silentLogger });
  await driver.connect();
  for (const row of SEED) {
    await driver.create('sys_user', { ...row, emailVerified: false, createdAt: NOW, updatedAt: NOW });
  }
  const adapter: any = (createObjectQLAdapterFactory(memoryReadEngine(driver)) as any)({} as any);
  return { driver, adapter };
}

/** `findMany` with a single better-auth `contains` condition on `name`. */
function containsQuery(value: string) {
  return {
    model: 'user',
    where: [{ field: 'name', value, operator: 'contains', connector: 'AND' }],
    limit: 100,
  } as any;
}

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
    // produced it (driver-memory's `filter-refusal.ts` says so in as many
    // words), which is why #5702's loud refusal is ordered after this PR.
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

describe('[#5710] the comparand is a literal substring on a real backend', () => {
  it('does not read `.` as a wildcard — `a.b` matches `a.b`, not `axb`', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(containsQuery('a.b'));

    // The pin, stated in both directions: the metacharacter row is NOT matched
    // (a bare `$regex` matched it through `.`), and the literal row still is.
    expect(rows.map((r) => r.name)).toEqual(['a.b']);
  });

  it('does not read `^` as an anchor', async () => {
    const { adapter } = await seededAdapter();
    const rows: any[] = await adapter.findMany(containsQuery('^a'));

    // As a pattern, `^a` matched `a.b` and `axb`. As a substring, nothing here
    // contains the two characters `^a`.
    expect(rows).toEqual([]);
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
