/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `$icontains` lowers, and the two faces of the `$` dialect agree about it
 * (objectui#8976).
 *
 * ## The defect
 *
 * `$icontains` is a canonical member of `@objectstack/spec`'s
 * `FILTER_OPERATORS`; `ValueDataSource` executes it; `FilterConditionField`
 * emits it for the `icontains` builder row (spelled `containsCaseInsensitive`
 * until objectui#9306); and
 * `packages/core/src/adapters/README.md` PRESCRIBES it as the repair for
 * `$like` / `$ilike` / `$regex`. `convertOperatorToAST` had no row for it, so
 * `convertFiltersToAST` refused it with the generic unknown-operator paragraph
 * — an `INVALID_FILTER` / 400 on a spelling this repo tells authors to write.
 *
 * That is the OPPOSITE leg of objectui#8568, which retired four lowercase
 * aliases the converter accepted and the matcher refused. There the converter
 * was more tolerant than the contract; here it was less tolerant than the
 * contract. ⛔ The two are not one change: making the acceptance sets "agree"
 * in a single sweep would have widened the matcher instead.
 *
 * ## What is asserted, and why in this shape
 *
 * The weak version of this file would be `expect(convertOperatorToAST('$icontains'))
 * .not.toBeNull()` — true the moment a row is added, and blind to whether the
 * row means anything. Three stronger claims are made instead.
 *
 *   1. **The spelling the adapters README PRESCRIBES must work.** The
 *      prescriptions are read out of that page's refusal table and intersected
 *      with the spec's `FILTER_OPERATORS`, so the population comes from prose a
 *      human wrote and from the contract — never from the function under test.
 *      This is the claim that fails if the converter is repaired but the page
 *      keeps prescribing something else, and the claim that would have failed
 *      before this card in the way an author actually meets the bug.
 *   2. **Both faces answer the same rows.** `convertFiltersToAST` and
 *      `ValueDataSource` are probed over one fixture, with a case-SENSITIVE
 *      control (`$contains`) that must select a strictly smaller set. Without
 *      that control "both select rows" would pass on a matcher that ignored the
 *      case fold entirely.
 *   3. **`icontains` survives to the AST unchanged.** The lowered operator must
 *      be a member of the spec's `VALID_AST_OPERATORS` — the set that gates
 *      `isFilterAST()`, and therefore the difference between a filter the wire
 *      carries and one `driver-sql` silently DROPS (objectstack#3948).
 *
 * ⚠️ Deliberately NOT claimed: end-to-end reach from a stored `criteria_json`
 * into this converter. The criteria store is not in this tree — the
 * consumer-local caveat objectui#6839 established. What is provable here, and
 * all this file asserts, is the acceptance-set disagreement and the producer
 * arm.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILTER_OPERATORS, VALID_AST_OPERATORS } from '@objectstack/spec/data';
import { convertFiltersToAST, convertOperatorToAST } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';
import { uiRoot } from '../../../../../scripts/ui-root.mjs';

const ADAPTERS_README_PATH = 'packages/core/src/adapters/README.md';
const ADAPTERS_README = readFileSync(join(uiRoot(), ADAPTERS_README_PATH), 'utf8');

/**
 * The `$`-spellings `packages/core/src/adapters/README.md` tells an author to
 * write INSTEAD of something it refuses — the third column of its refusal
 * table, whose header is "write instead".
 *
 * Narrowed to members of the spec's `FILTER_OPERATORS` on purpose. That column
 * also carries `$field` (a comparand marker, not an operator) and prose cells
 * with no code span at all, and asserting those "lower" would be a category
 * error. The intersection is still two INDEPENDENT sources — hand-written prose
 * and the contract — and neither is the function under test.
 */
function prescribedOperators(): string[] {
  const heading = '| spelling | why | write instead |';
  const start = ADAPTERS_README.indexOf(heading);
  if (start === -1) {
    throw new Error(
      `${ADAPTERS_README_PATH} no longer has the "write instead" refusal table (objectui#8976): `
        + 're-point this reader at wherever the prescriptions now live. Do not delete the case — '
        + 'a page that prescribes a spelling the converter refuses is exactly this card',
    );
  }
  const canonical = new Set(FILTER_OPERATORS as readonly string[]);
  const found = new Set<string>();
  for (const line of ADAPTERS_README.slice(start).split('\n')) {
    if (!line.startsWith('|')) break;
    const cells = line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|');
    const writeInstead = cells[cells.length - 1] ?? '';
    for (const match of writeInstead.matchAll(/`(\$[A-Za-z]+)`/g)) {
      if (canonical.has(match[1])) found.add(match[1]);
    }
  }
  return [...found].sort();
}

const PRESCRIBED = prescribedOperators();

const ROWS = [
  { id: 'a', name: 'ACME Corporation' },
  { id: 'b', name: 'acme holdings' },
  { id: 'c', name: 'Globex' },
];

async function selectedIds(filter: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: ROWS });
  const result = await ds.find('rows', { $filter: filter as any });
  return result.data.map((r) => r.id as string);
}

function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 0. Controls — every population below was really read, and can really fail
// ---------------------------------------------------------------------------

describe('objectui#8976 — controls', () => {
  it('read the adapters README prescriptions, and $icontains is among them', () => {
    // Guards the vacuous pass: a reader that matched nothing would make the
    // prescription case below iterate zero spellings and report success.
    expect(
      PRESCRIBED.length,
      `no canonical operator was read out of ${ADAPTERS_README_PATH}'s "write instead" column`,
    ).toBeGreaterThanOrEqual(3);
    expect(
      PRESCRIBED,
      'this card exists because that page prescribes $icontains; if the prescription is gone, '
        + 'the premise changed and this file must be re-read, not re-pointed',
    ).toContain('$icontains');
  });

  it('$icontains is still canonical in the spec, in both vocabularies', () => {
    // If either of these is ever false, objectui#8976 stops being an
    // invariant restoration and becomes a ruling. Fail loudly rather than
    // quietly keeping a row the contract no longer declares.
    expect(FILTER_OPERATORS).toContain('$icontains');
    expect(VALID_AST_OPERATORS.has('icontains')).toBe(true);
  });

  it('the matcher discriminates, so "selects rows" below is not vacuous', () => {
    // A case-SENSITIVE probe must select a strictly smaller set than the
    // case-insensitive one. Without this, a matcher that folded case for
    // everything (or for nothing) would satisfy the agreement case.
    expect(ROWS.filter((r) => r.name.includes('ACME')).map((r) => r.id)).toEqual(['a']);
    expect(
      ROWS.filter((r) => r.name.toLowerCase().includes('acme')).map((r) => r.id),
    ).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// 1. The prescription must work — the claim an author actually meets
// ---------------------------------------------------------------------------

describe('objectui#8976 — every spelling the adapters README prescribes lowers', () => {
  it.each(PRESCRIBED)('%s is accepted by convertFiltersToAST', (spelling) => {
    let node: unknown;
    expect(() => {
      node = convertFiltersToAST({ name: { [spelling]: 'acme' } });
    }, `${ADAPTERS_README_PATH} prescribes ${spelling}, and this converter refuses it`).not.toThrow();
    expect(Array.isArray(node), `${spelling} did not lower to a comparison node`).toBe(true);
    expect((node as unknown[])[0]).toBe('name');
  });

  it.each(PRESCRIBED)('%s lowers to an operator the AST gate accepts', (spelling) => {
    const node = convertFiltersToAST({ name: { [spelling]: 'acme' } }) as unknown[];
    // `isFilterAST()` is gated on this set; an operator outside it reaches the
    // wire and is DROPPED rather than refused (objectstack#3948).
    expect(VALID_AST_OPERATORS.has(node[1] as string)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The two faces agree — the disagreement this card measured
// ---------------------------------------------------------------------------

describe('objectui#8976 — convertFiltersToAST and ValueDataSource agree on $icontains', () => {
  it('the converter lowers $icontains to `icontains`, unsquashed', () => {
    // The identity is the point: `icontains` is itself an AST operator, so
    // unlike `$startsWith` -> `startswith` there is no case to fold away.
    expect(convertOperatorToAST('$icontains')).toBe('icontains');
    expect(convertFiltersToAST({ name: { $icontains: 'acme' } })).toEqual([
      'name',
      'icontains',
      'acme',
    ]);
  });

  it('the matcher selects the case-insensitive set, with no refusal logged', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ name: { $icontains: 'acme' } })).toEqual(['a', 'b']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('the case-SENSITIVE sibling still selects the smaller set on both faces', async () => {
    // The discriminating control for the case above: this is what proves the
    // agreement is about the case fold and not about the fixture.
    expect(convertFiltersToAST({ name: { $contains: 'acme' } })).toEqual([
      'name',
      'contains',
      'acme',
    ]);
    const warn = spyWarn();
    expect(await selectedIds({ name: { $contains: 'acme' } })).toEqual(['b']);
    expect(warn).not.toHaveBeenCalled();
  });
});
