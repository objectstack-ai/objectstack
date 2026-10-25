/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#7561's acceptance criterion, mechanised: **same tree, swap only the
 * operator spelling, the label must appear.**
 *
 * The card measured it through the real `SchemaRenderer` and reported the two
 * columns this file re-measures rather than quotes:
 *
 *   as authored          `… Category Remove condition Price Remove condition …`
 *   operators corrected  `… Category Equals Remove condition Price Less than …`
 *
 * Three catalog entries carry the rows this measures — `product-search`,
 * `with-conditions`, and the `filter-builder` nested inside `search-interface`.
 * No `SelectItem` in the operator dropdown carries a spelling from outside its
 * own vocabulary (camelCase then, the protocol's ids since objectui#9306), and
 * the trigger used to match its value LITERALLY
 * against the mounted items, so any other spelling of the same operator drew a
 * blank operator cell over a row that filtered correctly.
 *
 * ⚠️ **What these entries author has since changed, and the pin was re-aimed
 * rather than deleted.** When objectui#7561 landed they authored the spec's
 * ALIAS table (`eq` / `lt` / `gt`), and this file's last assertion was a fence
 * saying so — objectui#7561's own scope forbade touching catalog data, and the
 * fence existed to stop a lenient "repair" being smuggled in as one. That fence
 * was lifted by objectui#6939's remainder, which rewrote those seven spellings
 * to the DECLARED vocabulary so the entries validate. ⇒ the assertion is
 * INVERTED below, not dropped: it still names the key that moved, and it still
 * refuses a migration back to a legacy alias dialect (which the mirror has
 * accepted and normalised since objectui#9559, so the fence now guards the
 * published example rather than validation).
 *
 * ## Why the swap is the control and not a repair
 *
 * ⛔ No catalog data is changed BY THIS FILE. The swap happens in memory, as a
 * CONTROL: after objectui#7561's repair the two columns must be the SAME text,
 * because `normalizeFilterOperator` folds every spelling of one operator onto
 * one canonical member and the trigger now resolves through it. Before that
 * repair they differ — which is what makes this measurement able to fail.
 *
 * ⭐ The corrected column deliberately uses the camelCase ids (`lessThan`),
 * not the spec's canonical `less_than`. When objectui#7561 landed those were
 * the dropdown's OWN ids, the ones mounted, so that column was the "what it
 * would have looked like if authored in the renderer's dialect" arm the card
 * described. Since objectui#9306 the dropdown mounts the canonical ids and the
 * camelCase ones are the spec's DEPRECATED alias form, which the builder folds
 * at its read boundary — so the same column now measures the other direction:
 * a filter stored before that change still draws its label. Both arms
 * rendering the same text is the claim either way; neither arm is a
 * recommendation about which vocabulary an author SHOULD use — the canonical
 * one, per objectui#9306's ruling, which this control does not re-decide.
 *
 * ⚠️ The two vocabularies OVERLAP on three members (`equals`, `contains`,
 * `in` are spelled identically in both), so "the arms are two dialects" cannot
 * be stated as "no member of one appears in the other". The anti-vacuity leg
 * below therefore asserts that at least one row's spelling really moved, and
 * names the overlap instead of pretending it away.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { FilterOperatorSchema } from '@object-ui/types/zod';
import { getExample } from '../src/index.js';

/**
 * Taken FROM the mirror, never restated beside it — the OUTPUT side's options,
 * since objectui#9559 made the mirror the spec rule's own preprocess-into-enum
 * member: the canonical members, which is what a parse hands back.
 */
const DECLARED_OPERATORS: readonly string[] = FilterOperatorSchema.out.options;

/** The three entries whose rows carry an alias-table operator. */
const AFFECTED = [
  'components-complex-filter-builder/product-search',
  'components-complex-filter-builder/search-interface',
  'components-complex-filter-builder/with-conditions',
] as const;

/**
 * The operator label each row of each entry owes, in row order. Derived by
 * hand from the entry's own `operator` plus the field's type bucket, so a
 * fixture edit that changed an operator would redden here rather than silently
 * re-baseline.
 */
const EXPECTED: Record<(typeof AFFECTED)[number], string[]> = {
  'components-complex-filter-builder/product-search': ['Equals', 'Less than', 'Greater than'],
  'components-complex-filter-builder/search-interface': ['Equals', 'Greater than'],
  'components-complex-filter-builder/with-conditions': ['Greater than', 'Equals'],
};

/**
 * The declared spellings these entries author → the camelCase id each folds
 * from: the dropdown's own id before objectui#9306, the deprecated alias form
 * after it (see this file's header). Covers the spec's alias table too, so an
 * entry re-authored in EITHER off-canonical dialect is still carried by the
 * control arm rather than silently passed through as an identity.
 */
const CORRECTION: Record<string, string> = {
  // what the catalog authors today — `@objectstack/spec`'s canonical members
  equals: 'equals',
  not_equals: 'notEquals',
  greater_than: 'greaterThan',
  greater_than_or_equal: 'greaterOrEqual',
  less_than: 'lessThan',
  less_than_or_equal: 'lessOrEqual',
  not_in: 'notIn',
  // the alias table these entries authored before objectui#6939's remainder
  eq: 'equals',
  ne: 'notEquals',
  lt: 'lessThan',
  lte: 'lessOrEqual',
  gt: 'greaterThan',
  gte: 'greaterOrEqual',
  nin: 'notIn',
};

/**
 * The members whose two spellings COINCIDE — a row on one of these cannot show
 * the control arm moving, and saying so is what keeps the anti-vacuity leg
 * honest rather than accidentally satisfied.
 */
const SPELT_ALIKE = new Set(
  Object.entries(CORRECTION)
    .filter(([authored, mounted]) => authored === mounted)
    .map(([authored]) => authored),
);

function asAuthored(id: (typeof AFFECTED)[number]): Record<string, unknown> {
  return getExample(id).schema as Record<string, unknown>;
}

function builderNode(doc: Record<string, unknown>): Record<string, unknown> {
  if (doc.type === 'filter-builder') return doc;
  const child = (doc.children as Record<string, unknown>[]).find(
    (c) => c.type === 'filter-builder',
  );
  if (!child) throw new Error('entry no longer carries a filter-builder');
  return child;
}

/** The same entry with ONLY the operator spellings swapped — nothing else. */
function operatorsCorrected(id: (typeof AFFECTED)[number]): Record<string, unknown> {
  const doc = asAuthored(id);
  const swap = (b: Record<string, unknown>) => {
    const group = b.value as { conditions: Record<string, unknown>[] };
    return {
      ...b,
      value: {
        ...group,
        conditions: group.conditions.map((c) => ({
          ...c,
          operator: CORRECTION[c.operator as string] ?? c.operator,
        })),
      },
    };
  };
  if (doc.type === 'filter-builder') return swap(doc);
  return {
    ...doc,
    children: (doc.children as Record<string, unknown>[]).map((c) =>
      c.type === 'filter-builder' ? swap(c) : c,
    ),
  };
}

function measure(schema: unknown) {
  const { container, unmount } = render(
    <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />,
  );
  const out = {
    text: container.textContent ?? '',
    // The row's cells are `div.col-span-4`, field / operator / value in order,
    // so `nth-child(2)` is the operator cell.
    operatorTriggers: Array.from(
      container.querySelectorAll('div.col-span-4:nth-child(2) [role="combobox"]'),
    ).map((e) => e.textContent),
  };
  unmount();
  return out;
}

describe('objectui#7561 — the alias spellings the catalog authors render a label', () => {
  it.each(AFFECTED)('%s: every operator cell names its operator', (id) => {
    const m = measure(asAuthored(id));
    // Anti-vacuity first: a selector that matched nothing would make every
    // claim below trivially true.
    expect(m.operatorTriggers.length).toBe(EXPECTED[id].length);
    expect(m.operatorTriggers.length).toBeGreaterThan(0);
    expect(m.operatorTriggers).toEqual(EXPECTED[id]);
    // The symptom, stated as the user saw it: not one blank operator cell.
    expect(m.operatorTriggers.filter((t) => t === '')).toEqual([]);
  });

  it.each(AFFECTED)('%s: as authored === operators corrected (the card\'s control)', (id) => {
    const authored = measure(asAuthored(id));
    const corrected = measure(operatorsCorrected(id));
    expect(authored.text).toBe(corrected.text);
    expect(authored.operatorTriggers).toEqual(corrected.operatorTriggers);
  });

  it('the control is a real swap — it changes the tree it is given', () => {
    // Without this, a broken `operatorsCorrected` would compare each entry to
    // ITSELF and the equality above would hold for any component at all.
    for (const id of AFFECTED) {
      const before = builderNode(asAuthored(id)).value as {
        conditions: { operator: string }[];
      };
      const after = builderNode(operatorsCorrected(id)).value as {
        conditions: { operator: string }[];
      };
      const beforeOps = before.conditions.map((c) => c.operator);
      const afterOps = after.conditions.map((c) => c.operator);
      expect(afterOps).not.toEqual(beforeOps);
      // Every authored operator is a spelling the control table knows, so no
      // row slipped through as an unmapped identity…
      expect(beforeOps.every((o) => o in CORRECTION)).toBe(true);
      // …and every row that is NOT one of the coinciding members really moved,
      // which is the arms being two dialects stated in the form the overlap
      // permits. (⛔ `afterOps.some(o => o in CORRECTION) === false` is the
      // form this once used and it is not available: `equals` is a member of
      // both vocabularies.)
      const moved = beforeOps.filter((o) => !SPELT_ALIKE.has(o));
      expect(moved.length).toBeGreaterThan(0);
      for (const [i, op] of beforeOps.entries()) {
        if (SPELT_ALIKE.has(op)) expect(afterOps[i]).toBe(op);
        else expect(afterOps[i]).not.toBe(op);
      }
    }
  });

  it('⛔ the catalog files author the CANONICAL vocabulary, not a legacy alias', () => {
    // INVERTED by objectui#6939's remainder — see this file's header. The
    // entries spell their operators the way `FilterOperatorSchema` declares its
    // canonical members; the two-column equality above is what says the
    // rewrite cost no pixel.
    //
    // ⛔ If someone migrates them back to `eq` / `lt` / `gt`, or forward to the
    // dropdown's own `greaterThan`, this reddens. Since objectui#9559 the
    // mirror ACCEPTS both and normalises them on parse (they are rows of the
    // spec's alias table), so this is no longer a validation question: the
    // catalog is what new authors copy, and the spec marks that table a
    // deprecated bridge new producers must not emit.
    for (const id of AFFECTED) {
      const group = builderNode(asAuthored(id)).value as {
        conditions: { operator: string }[];
      };
      expect(group.conditions.length).toBeGreaterThan(0);
      for (const c of group.conditions) {
        expect(DECLARED_OPERATORS).toContain(c.operator);
      }
    }
  });
});
