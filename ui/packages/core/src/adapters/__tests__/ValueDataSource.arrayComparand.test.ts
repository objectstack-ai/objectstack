/**
 * ObjectUI — ValueDataSource, ARRAY comparand (objectui#8514)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `{ tags: ['a', 'b'] }` took the simple-equality branch — the operator loop is
 * guarded by `!Array.isArray(condition)` — and `!==` compares REFERENCES, so it
 * excluded every row including the deep-equal one. Silent, fail-closed.
 *
 * ## What these cases are checked against
 *
 * The repair is a REFUSAL, not a deep-equality reading, and the file's own
 * docblock carries the census that decided it. So the discriminating axis here
 * is not "the deep-equal row comes back" — it is that the matcher SAYS it
 * cannot read the shape, and that the negations stop selecting everything.
 *
 * Two wrong fixes this file is built to redden, stated before the assertions
 * that catch them:
 *
 *   1. **Deep-equality** (`JSON.stringify(a) === JSON.stringify(b)`, the
 *      caricature the card names). It returns the deep-equal row, logs nothing,
 *      and answers `$ne` with the non-equal rows — so every "is refused"
 *      assertion below fails on it, and so does the `$ne` row set.
 *   2. **Routing an array into the operator loop** by dropping the
 *      `!Array.isArray(condition)` guard, which reads the array's INDICES as
 *      operator names — the shape `$not` had. It produces refusals naming
 *      `'0'` / `'1'`, so the message assertions name the offender.
 *
 * Assertion ORDER is deliberate (objectui#8506): each block states its
 * discriminating expectation first and its control afterwards, so a failure
 * summary names the defect rather than the scaffolding.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ValueDataSource } from '../ValueDataSource';

interface Row { id: string; tags: unknown; role: string }

const ROWS: Row[] = [
  { id: 'equal', tags: ['a', 'b'], role: 'admin' },
  { id: 'reordered', tags: ['b', 'a'], role: 'user' },
  { id: 'superset', tags: ['a', 'b', 'c'], role: 'admin' },
  { id: 'shorter', tags: ['a'], role: 'user' },
  { id: 'scalar', tags: 'a', role: 'admin' },
];

const ALL_IDS = ROWS.map((r) => r.id);

function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

async function selectedIds(filter: unknown, rows: Row[] = ROWS): Promise<string[]> {
  const ds = new ValueDataSource<Row>({ items: rows });
  const res = await ds.find('t', { $filter: filter as never });
  return (res.data as Row[]).map((r) => r.id);
}

/** Every distinct refusal `find()` drained for this filter. */
async function refusalsFor(filter: unknown, rows: Row[] = ROWS): Promise<string[]> {
  const warn = spyWarn();
  await selectedIds(filter, rows);
  const messages = warn.mock.calls.map((c) => String(c[0]));
  warn.mockRestore();
  return messages;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The headline — an array comparand is REFUSED, and says so
// ---------------------------------------------------------------------------

describe('objectui#8514 — an array comparand is refused, in both dialects', () => {
  it('the implicit-equality position names the field and prescribes $in', async () => {
    const [message, ...rest] = await refusalsFor({ tags: ['a', 'b'] });

    // Discriminating: a deep-equality fix logs nothing at all.
    expect(message).toBeDefined();
    expect(message).toContain("comparand for field 'tags'");
    expect(message).toContain('is an ARRAY');
    expect(message).toContain('$in');
    // One distinct refusal per `find()`, not one per row.
    expect(rest).toEqual([]);
  });

  it('the array never reaches the operator loop, so no INDEX is read as a key', async () => {
    // The hazard the card names: dropping `matchesFilter`'s
    // `!Array.isArray(condition)` guard routes `['a','b']` into the operator
    // loop, where `Object.entries` yields `['0','a']` and the refusal names the
    // INDEX. This assertion is first in its own case on purpose — measured, the
    // block above catches that same leg one assertion earlier, so this one had
    // never run where it was originally written (objectui#8506's lesson).
    const message = (await refusalsFor({ tags: ['a', 'b'] }))[0] ?? '';
    expect(message).not.toMatch(/'\d+'/);
    expect(message).toContain("comparand for field 'tags'");
  });

  it('the $-operator positions are refused too, including the fail-OPEN negation', async () => {
    // $ne against an array was `value !== target` — always true — so it
    // selected EVERY row in silence. This is the assertion that moves rows.
    expect(await selectedIds({ tags: { $ne: ['a', 'b'] } })).toEqual([]);
    expect(await selectedIds({ tags: { $eq: ['a', 'b'] } })).toEqual([]);

    const message = (await refusalsFor({ tags: { $ne: ['a', 'b'] } }))[0];
    expect(message).toContain("operator '$ne'");
    expect(message).toContain('is an ARRAY');
  });

  it('the AST dialect answers the same question the same way', async () => {
    expect(await selectedIds(['tags', '!=', ['a', 'b']])).toEqual([]);
    expect(await selectedIds(['tags', '=', ['a', 'b']])).toEqual([]);

    const message = (await refusalsFor(['tags', '=', ['a', 'b']]))[0];
    expect(message).toContain("operator '='");
    expect(message).toContain('is an ARRAY');
  });
});

// ---------------------------------------------------------------------------
// 2. The rows that must NOT be selected — the deep-equality caricature's axis
// ---------------------------------------------------------------------------

describe('objectui#8514 — no array comparand selects anything, however similar', () => {
  // A deep-equality fix returns `['equal']` here; a JSON.stringify one returns
  // `['equal']` too. Both fail. A set-equality reading would add `reordered`,
  // a contains-all reading `superset` — each named so the failure says which
  // invented semantics was implemented.
  it.each([
    ['deep-equal row', ['a', 'b'], 'equal'],
    ['same set, different order', ['b', 'a'], 'reordered'],
    ['a subset of a stored superset', ['a', 'b', 'c'], 'superset'],
    ['a single-element list', ['a'], 'shorter'],
  ])('%s selects nothing', async (_label, comparand) => {
    expect(await selectedIds({ tags: comparand })).toEqual([]);
    expect(await selectedIds(['tags', '=', comparand])).toEqual([]);
  });

  it('an empty array comparand is refused rather than read as "no constraint"', async () => {
    expect(await selectedIds({ tags: [] })).toEqual([]);
    expect((await refusalsFor({ tags: [] }))[0]).toContain('is an ARRAY');
  });
});

// ---------------------------------------------------------------------------
// 3. Controls — the harness discriminates, and nothing else moved
// ---------------------------------------------------------------------------

describe('objectui#8514 — controls', () => {
  it('CONTROL: the broken answer is the full set, so the cases above discriminate', async () => {
    expect(await selectedIds({})).toEqual(ALL_IDS);
  });

  it('CONTROL: scalar equality is untouched, and stays silent', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ role: 'admin' })).toEqual(['equal', 'superset', 'scalar']);
    expect(await selectedIds({ tags: 'a' })).toEqual(['scalar']);
    expect(await selectedIds(['role', '=', 'admin'])).toEqual(['equal', 'superset', 'scalar']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('CONTROL: the three operators that DECLARE an array comparand still execute', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ role: { $in: ['admin'] } })).toEqual(['equal', 'superset', 'scalar']);
    expect(await selectedIds({ role: { $nin: ['admin'] } })).toEqual(['reordered', 'shorter']);
    expect(await selectedIds(['role', 'in', ['admin']])).toEqual(['equal', 'superset', 'scalar']);
    expect(
      await selectedIds({ n: { $between: [2, 3] } }, [
        { id: 'lo', tags: [], role: 'x' },
        { id: 'hi', tags: [], role: 'x' },
      ].map((r, i) => ({ ...r, n: i + 2 })) as never),
    ).toEqual(['lo', 'hi']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('CONTROL: the null operators never read the value slot, so no array reaches the guard', async () => {
    const warn = spyWarn();
    expect(await selectedIds(['tags', 'is_not_null'])).toEqual(ALL_IDS);
    expect(warn).not.toHaveBeenCalled();
  });
});
