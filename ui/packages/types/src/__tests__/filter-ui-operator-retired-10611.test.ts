/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `FilterUISchema.filters[].operator` is REFUSED on the
 * `filter-ui` node (objectui#10611, ADR-0049 enforce-or-remove).
 *
 * ## The failure this pin exists to prevent
 *
 * Both published faces declared a per-filter `operator` (a seven-member enum on
 * the mirror, the same union on the TS face) and the docs page taught it, but
 * `filter-ui`'s renderer never read it: it picks each control from `type` and
 * reports a change as a field → value record with no operator in it (a host
 * `onChange` function receives that bare record; only the authored window
 * event's `detail` is `{ values }`), and it does no matching of its own. So
 * `operator: 'gt'`, a member of that enum, type-checked and parsed green
 * through `objectui validate`; a nonsense id was refused by the enum and did
 * not type-check; and both rendered and emitted exactly what a filter without
 * it does.
 * The render reading and the producer census are recorded on the card's pull
 * request as a one-time measurement; this file is the instrument that keeps the
 * contract.
 *
 * ## Why a tombstone and not a deletion
 *
 * `operator` sits on the `filters[]` ELEMENT, a plain `z.object`, which STRIPS
 * an undeclared key (it is not the node's `.passthrough()` — that one KEEPS
 * it). Either way a deleted member would have been a silent accept; block (c)
 * pins the element's strip on a misspelling, so the reason is a reading and not
 * prose.
 *
 * ## How refusals are asserted
 *
 * By the issue ENVELOPE — `code` and `path`, and that it is the ONLY issue, so a
 * refusal cannot ride on some other failure of the same document — at the public
 * door `safeValidateSchema` (the tolerant face) and
 * on the mirror. The wording is not pinned; that the message and the published
 * `.describe()` metadata are one string is.
 *
 * The `@ts-expect-error` directive in block (d) is REAL enforcement: this
 * package type-checks its tests through `tsconfig.test.json`, so re-widening the
 * member fails the build on the unused directive (TS2578). A green `vitest` run
 * is NOT evidence about it — type assertions are erased before it runs.
 */

import { describe, it, expect } from 'vitest';
import type { FilterUISchema } from '../views';
import { FilterUISchema as FilterUIMirror } from '../zod/views.zod';
import { safeValidateSchema } from '../zod/index.zod';

type FilterEntry = FilterUISchema['filters'][number];

const QTY = { field: 'qty', label: 'Qty', type: 'number' } as const;
const NAME = { field: 'name', label: 'Name', type: 'text' } as const;
const node = (filters: Array<Record<string, unknown>>) => ({ type: 'filter-ui', layout: 'inline', filters });

/**
 * Every member of the retired enum (so a partial re-widening shows up), plus a
 * spelling the enum never admitted and a nonsense id. The one-time render
 * reading on the pull request sampled a subset of these (it lists which) and
 * gave each sampled one the same output as no operator at all.
 */
const AUTHORED = ['equals', 'contains', 'startsWith', 'gt', 'lt', 'between', 'in', 'greater_than', 'zz_nonsense_op'];

type Issue = { code: string; path: PropertyKey[]; message: string };
const issuesOf = (r: { success: boolean; error?: { issues: Issue[] } }): Issue[] => r.error?.issues ?? [];

const elementShape = (
  (FilterUIMirror.shape.filters as unknown as { element: { shape: Record<string, { description?: string }> } }).element
).shape;

/* ── (a) refused by name, at the entry's own path ─────────────────────────── */

describe('objectui#10611 (a) — `filters[].operator` is RETIRED on `filter-ui`', () => {
  it.each(AUTHORED.map((op) => [op]))(
    'refuses `operator: %s` at the public door and on the mirror: ONE `invalid_type` issue at the entry',
    (op) => {
      const doc = node([QTY, { ...NAME, operator: op }]);
      for (const r of [safeValidateSchema(doc), FilterUIMirror.safeParse(doc)]) {
        expect(r.success, `an authored \`operator: ${op}\` was ACCEPTED`).toBe(false);
        expect(issuesOf(r).map(({ code, path }) => ({ code, path }))).toEqual([
          { code: 'invalid_type', path: ['filters', 1, 'operator'] },
        ]);
      }
    },
  );

  it('the refusal message and the published `.describe()` metadata are ONE string', () => {
    const r = FilterUIMirror.safeParse(node([{ ...QTY, operator: 'gt' }]));
    expect(issuesOf(r)[0]!.message).toBe(elementShape.operator!.description);
  });

  it('stays DECLARED on the entry shape — a tombstone, not a deletion (see block c)', () => {
    expect(Object.keys(elementShape)).toContain('operator');
  });
});

/* ── (b) LIT CONTROL: the same entries without `operator` parse ───────────── */

describe('objectui#10611 (b) — LIT CONTROL: a `filters[]` entry without `operator` parses, at both doors', () => {
  it('the same two entries, no operator', () => {
    const doc = node([QTY, NAME]);
    expect(issuesOf(safeValidateSchema(doc))).toEqual([]);
    expect(issuesOf(FilterUIMirror.safeParse(doc))).toEqual([]);
  });

  it('every surviving entry member, on one entry', () => {
    const doc = node([
      { field: 'status', label: 'Status', type: 'select', placeholder: 'Any', options: [{ label: 'Open', value: 'open' }] },
    ]);
    expect(issuesOf(safeValidateSchema(doc))).toEqual([]);
  });
});

/* ── (c) why a tombstone: an undeclared entry key is STRIPPED in silence ──── */

describe('objectui#10611 (c) — CONTROL: an undeclared `filters[]` key is STRIPPED, not refused', () => {
  it('a misspelled `operatr` parses green and is gone after the parse — what a deletion would have left', () => {
    const r = FilterUIMirror.safeParse(node([{ ...QTY, operatr: 'gt' }]));
    expect(r.success).toBe(true);
    expect(Object.keys((r.data as { filters: Array<Record<string, unknown>> }).filters[0]!)).not.toContain('operatr');
  });
});

/* ── (d) the TS twin carries the same contract ───────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type assertionOperatorRetired = Expect<Equal<FilterEntry['operator'], undefined>>;
/** The helper can FAIL — control on a surviving optional member of the same entry. */
export type assertionEqualCanFail = Expect<Equal<Equal<FilterEntry['label'], undefined>, false>>;

describe('objectui#10611 (d) — the TS twin refuses what the mirror refuses', () => {
  it('an authored `operator` is a compile error — checked by `tsc -p tsconfig.test.json`', () => {
    // Not `as const`: a readonly literal would fail for a reason of its own, and
    // the `@ts-expect-error` would pass without testing.
    const refused: FilterUISchema = {
      type: 'filter-ui',
      // @ts-expect-error — retired: `filter-ui` does not read a per-filter operator
      filters: [{ field: 'qty', type: 'number', operator: 'gt' }],
    };
    expect(refused.filters).toHaveLength(1);
  });

  it('CONTROL — the same entry without `operator` compiles', () => {
    const node: FilterUISchema = { type: 'filter-ui', filters: [{ field: 'qty', type: 'number' }] };
    expect(node.filters[0]!.type).toBe('number');
  });
});
