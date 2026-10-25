/**
 * ObjectUI — ValueDataSource, `{ $field }` comparand (objectui#8515)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `@objectstack/spec/data` declares a field-reference comparand — "compare this
 * field against that field" — and both platform evaluation paths execute it.
 * Neither of this adapter's matchers dereferenced it: both compared the
 * reference OBJECT against the stored value, so every such filter answered with
 * no rows and no diagnostic.
 *
 * ## What these cases are checked against
 *
 * The implemented half and the refused half are BOTH load-bearing, and the
 * wrong fixes this file is built to redden differ in which half they break:
 *
 *   1. **No resolution at all** (the state before this card): every "resolves"
 *      row set below empties out.
 *   2. **The naive resolve** — `record[ref.$field]` wherever a `$field` appears,
 *      with no position check, no `addDays` check and no dotted-path check. It
 *      passes every "resolves" case and fails every refusal case. That is the
 *      plausible wrong fix, and it is the dangerous one: ignoring an `addDays`
 *      offset returns WRONG rows where the defect returned none.
 *
 * Assertion ORDER is deliberate (objectui#8506): the discriminating expectation
 * leads each case and the controls follow, so a failure summary names the
 * defect rather than the scaffolding.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ValueDataSource } from '../ValueDataSource';

interface Row { id: string; amount: number; budget: number | null; label: string }

const ROWS: Row[] = [
  { id: 'eq', amount: 7, budget: 7, label: 'x' },
  { id: 'under', amount: 3, budget: 9, label: 'y' },
  { id: 'over', amount: 10, budget: 5, label: 'z' },
];

function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

async function selectedIds(filter: unknown, rows: Row[] = ROWS): Promise<string[]> {
  const ds = new ValueDataSource<Row>({ items: rows });
  const res = await ds.find('t', { $filter: filter as never });
  return (res.data as Row[]).map((r) => r.id);
}

async function refusalsFor(filter: unknown, rows: Row[] = ROWS): Promise<string[]> {
  const warn = spyWarn();
  await selectedIds(filter, rows);
  const messages = warn.mock.calls.map((c) => String(c[0]));
  warn.mockRestore();
  return messages;
}

const REF = { $field: 'budget' };

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The headline — the reference is DEREFERENCED on the six scalar operators
// ---------------------------------------------------------------------------

describe('objectui#8515 — a { $field } comparand resolves against the record', () => {
  // Each row set is a different subset of ROWS, so "no resolution" (every set
  // empties) and "resolution" are distinguishable case by case rather than in
  // aggregate.
  it.each([
    ['$eq', '=', ['eq']],
    ['$ne', '!=', ['under', 'over']],
    ['$gt', '>', ['over']],
    ['$gte', '>=', ['eq', 'over']],
    ['$lt', '<', ['under']],
    ['$lte', '<=', ['eq', 'under']],
  ])('%s / %s compares amount against the referenced budget column', async (dollarOp, astOp, expected) => {
    // Discriminating: unresolved, every one of these is [].
    expect(await selectedIds({ amount: { [dollarOp]: REF } })).toEqual(expected);
    // Both dialects agree — the property objectui#8447 established for this pair
    // of matchers, applied to the comparand rather than to the operator.
    expect(await selectedIds(['amount', astOp, REF])).toEqual(expected);
  });

  it('resolving is SILENT — a working filter logs nothing', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ amount: { $lte: REF } })).toEqual(['eq', 'under']);
    expect(await selectedIds(['amount', '<=', REF])).toEqual(['eq', 'under']);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. The positions the spec removed, and the two malformed references
// ---------------------------------------------------------------------------

describe('objectui#8515 — the positions a reference is NOT a comparand for', () => {
  it('a reference inside a list comparand is refused, not resolved (objectstack#7596)', async () => {
    // $nin is the direction that matters: an unresolved member drops an
    // EXCLUSION the author wrote, so the row passes and the result set WIDENS.
    // The naive resolve returns rows here; no resolution returns all three.
    expect(await selectedIds({ label: { $nin: [REF] } })).toEqual([]);
    expect(await selectedIds({ label: { $in: [REF] } })).toEqual([]);
    expect(await selectedIds({ amount: { $between: [REF, 9] } })).toEqual([]);

    const message = (await refusalsFor({ label: { $nin: [REF] } }))[0];
    expect(message).toContain('inside the list comparand');
    expect(message).toContain("'$nin'");
  });

  it('a reference on a non-scalar operator is refused by name', async () => {
    expect(await selectedIds({ label: { $contains: REF } })).toEqual([]);

    const message = (await refusalsFor({ label: { $contains: REF } }))[0];
    expect(message).toContain('not a comparand for operator');
    expect(message).toContain("'$contains'");
  });

  it('an addDays offset is refused rather than silently dropped', async () => {
    // The failure this guards is the WORST direction available here: resolving
    // the bare column and ignoring the offset answers with wrong rows, where
    // the original defect answered with none.
    expect(await selectedIds({ amount: { $lte: { $field: 'budget', addDays: 3 } } })).toEqual([]);

    const message = (await refusalsFor({ amount: { $lte: { $field: 'budget', addDays: 3 } } }))[0];
    expect(message).toContain('addDays');
    expect(message).toContain('temporal class');
  });

  it('a dotted path is refused, because this matcher addresses a flat record', async () => {
    expect(await selectedIds({ amount: { $eq: { $field: 'nested.budget' } } })).toEqual([]);

    const message = (await refusalsFor({ amount: { $eq: { $field: 'nested.budget' } } }))[0];
    expect(message).toContain("dotted path 'nested.budget'");
  });

  it('a non-string $field is refused rather than compared as an object', async () => {
    expect(await selectedIds({ amount: { $eq: { $field: 42 } } })).toEqual([]);
    expect((await refusalsFor({ amount: { $eq: { $field: 42 } } }))[0])
      .toContain('non-string $field');
  });

  it('the hand-authored implicit form keeps its ruled fate, with the working spelling named', async () => {
    // objectstack#7597: `{ amount: { $field: 'budget' } }` is an operator spec
    // named `$field`, not a comparand. It stays fail-closed; only the message
    // improves, so an author can act on it.
    expect(await selectedIds({ amount: REF })).toEqual([]);

    const message = (await refusalsFor({ amount: REF }))[0];
    expect(message).toContain("reads as an operator named '$field'");
    expect(message).toContain('$eq');
  });
});

// ---------------------------------------------------------------------------
// 3. Controls — the harness discriminates, and nothing else moved
// ---------------------------------------------------------------------------

describe('objectui#8515 — controls', () => {
  it('CONTROL: the unfiltered answer is the full set, so the cases above discriminate', async () => {
    expect(await selectedIds({})).toEqual(['eq', 'under', 'over']);
  });

  it('CONTROL: a LITERAL comparand on the same operators is untouched, and silent', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ amount: { $eq: 7 } })).toEqual(['eq']);
    expect(await selectedIds({ amount: { $lte: 7 } })).toEqual(['eq', 'under']);
    expect(await selectedIds(['amount', '>', 7])).toEqual(['over']);
    expect(await selectedIds({ label: { $contains: 'x' } })).toEqual(['eq']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('CONTROL: list operators with ordinary members still execute', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ label: { $in: ['x', 'z'] } })).toEqual(['eq', 'over']);
    expect(await selectedIds({ label: { $nin: ['x'] } })).toEqual(['under', 'over']);
    expect(await selectedIds({ amount: { $between: [3, 7] } })).toEqual(['eq', 'under']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('CONTROL: a plain object comparand that is NOT a reference keeps its own refusal', async () => {
    const message = (await refusalsFor({ profile: { verified: true } }))[0];
    expect(message).toContain('non-operator key');
  });
});
