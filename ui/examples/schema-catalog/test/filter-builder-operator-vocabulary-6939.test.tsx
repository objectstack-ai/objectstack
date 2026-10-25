/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6939's remainder — the `filter-builder` row's fourth divergence,
 * measured in BOTH directions because this repair pulls two ways at once.
 *
 * ## What changed in the corpus
 *
 * Three catalog entries authored `conditions[].operator` in the spec's ALIAS
 * table (`eq` / `lt` / `gt`) while `FilterOperatorSchema` declares the spec's
 * canonical members (`equals` / `less_than` / `greater_than`). Every one of
 * those documents therefore failed `safeValidateSchema`. The seven spellings
 * were rewritten to the declared vocabulary — contract-first, the protocol
 * being the side that is right — and ⛔ the enum was not widened by one member
 * to meet them.
 *
 * ## The two directions, and why neither alone is the acceptance
 *
 *   - **NEW — it validates.** The property this card ADDS. Pinned below per
 *     entry, and paired with a refusal control so `.success` cannot go green
 *     by a mirror that accepts everything.
 *   - **PRESERVED — it renders the same.** The property this card must NOT
 *     break. ⚠️ objectui#6318's rule is that *a "correction" that renders
 *     identically proves the edit was wrong*; that rule was written where the
 *     correction repaired a BROKEN render. Here it inverts: objectui#7561 (PR
 *     #9305) had already routed the operator trigger's identity comparison
 *     through `normalizeFilterOperator`, so all three dialects already drew
 *     their label — the alias spellings were validation-broken, not
 *     render-broken. ⇒ a render that MOVES is this card's failure signal, and
 *     that is what the identity legs below exist to catch.
 *
 * The "before" arm is not read from git history: it is reconstructed in memory
 * from the same tree by swapping only the operator spellings back, so the proof
 * keeps working in a checkout that never saw the old bytes.
 *
 * ## objectui#9559 — the two refusal legs that MOVED (ruling B, ratified)
 *
 * This file used to pin the alias dialect (`eq` / `lt` / `gt`) and the
 * dropdown's camelCase ids (`notEquals`, `greaterThan`) as REFUSED. The ruling
 * on objectui#9559 made `FilterOperatorSchema` the spec rule's own operator
 * member, which accepts every spelling the protocol accepts and normalises it
 * on parse — so both legs now assert ACCEPTED, and that the parsed document
 * comes back in the canonical spelling these fixtures author. The
 * contract-first control moved one level up and is still here:
 * `an invented operator is refused` below — nothing wider than the protocol.
 * The fixtures themselves stay canonical, and the NEW-direction legs above
 * still hold unchanged.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { safeValidateSchema, FilterOperatorSchema } from '@object-ui/types/zod';
import { getExample } from '../src/index.js';

/** The three entries whose rows carry an operator at all. */
const AFFECTED = [
  'components-complex-filter-builder/product-search',
  'components-complex-filter-builder/search-interface',
  'components-complex-filter-builder/with-conditions',
] as const;

type AffectedId = (typeof AFFECTED)[number];

/**
 * The spelling each entry authored BEFORE this repair, keyed by the declared
 * member it was rewritten to. Read in this direction the table is a control,
 * not a recipe: it reconstructs the refused document so both halves of the
 * claim can be measured against it.
 */
const FORMER_ALIAS: Record<string, string> = {
  equals: 'eq',
  greater_than: 'gt',
  less_than: 'lt',
};

/**
 * The dropdown's own camelCase id for the same three operators. ⚠️ `equals` is
 * spelled identically in both vocabularies — the overlap is real and the legs
 * below name it rather than assume it away.
 */
const DROPDOWN_ID: Record<string, string> = {
  equals: 'equals',
  greater_than: 'greaterThan',
  less_than: 'lessThan',
};

/**
 * Taken FROM the mirror rather than restated beside it. Since objectui#9559 the
 * mirror is a preprocess-into-enum pipe (the spec rule's own member), so the
 * declared canonical members are its OUTPUT side's options.
 */
const DECLARED_OPERATORS: readonly string[] = FilterOperatorSchema.out.options;

function asAuthored(id: AffectedId): Record<string, unknown> {
  return getExample(id).schema as Record<string, unknown>;
}

/** The `filter-builder` node, whether it is the root or nested in a `stack`. */
function builderNode(doc: Record<string, unknown>): Record<string, unknown> {
  if (doc.type === 'filter-builder') return doc;
  const child = (doc.children as Record<string, unknown>[]).find(
    (c) => c.type === 'filter-builder',
  );
  if (!child) throw new Error('entry no longer carries a filter-builder');
  return child;
}

function operatorsOf(doc: Record<string, unknown>): string[] {
  const group = builderNode(doc).value as { conditions: { operator: string }[] };
  return group.conditions.map((c) => c.operator);
}

/** The same entry with ONLY the operator spellings rewritten through `table`. */
function withOperators(id: AffectedId, table: Record<string, string>): Record<string, unknown> {
  const doc = asAuthored(id);
  const swap = (b: Record<string, unknown>) => {
    const group = b.value as { conditions: Record<string, unknown>[] };
    return {
      ...b,
      value: {
        ...group,
        conditions: group.conditions.map((c) => ({
          ...c,
          operator: table[c.operator as string] ?? c.operator,
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

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

function measure(schema: unknown) {
  const { container, unmount } = render(
    <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />,
  );
  const out = {
    text: container.textContent ?? '',
    elements: container.querySelectorAll('*').length,
    inputs: Array.from(container.querySelectorAll('input')).map((e) => e.getAttribute('type')),
    // The row's cells are `div.col-span-4`, field / operator / value in order,
    // so `nth-child(2)` is the operator cell.
    operatorTriggers: Array.from(
      container.querySelectorAll('div.col-span-4:nth-child(2) [role="combobox"]'),
    ).map((e) => e.textContent),
  };
  unmount();
  return out;
}

describe('objectui#6939 — NEW: the catalog entries now pass `safeValidateSchema`', () => {
  it.each(AFFECTED)('%s validates as authored', (id) => {
    expect(reasons(asAuthored(id))).toEqual([]);
  });

  it('the `stack`-rooted entry validates at its NESTED node too', () => {
    // `search-interface.json` roots at `stack`; `objectui check` validates the
    // parsed document rather than each child, so the nested `filter-builder` is
    // measured here rather than left to the root's verdict.
    expect(reasons(builderNode(asAuthored('components-complex-filter-builder/search-interface')))).toEqual([]);
  });

  it.each(AFFECTED)('%s: every authored operator is a DECLARED member', (id) => {
    const ops = operatorsOf(asAuthored(id));
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) expect(DECLARED_OPERATORS).toContain(op);
  });

  /** The document the whole-document gate hands back — the PARSED shape. */
  function parsedDoc(schema: unknown): Record<string, unknown> {
    const r = safeValidateSchema(schema);
    if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return r.data as Record<string, unknown>;
  }

  it.each(AFFECTED)(
    '%s: the alias dialect it used to author is ACCEPTED and normalised back (objectui#9559)',
    (id) => {
      const aliased = withOperators(id, FORMER_ALIAS);
      // Anti-vacuity: the reconstruction really did move every row, so the
      // acceptance is about the alias and not about an untouched document.
      const before = operatorsOf(asAuthored(id));
      const after = operatorsOf(aliased);
      expect(after.length).toBe(before.length);
      for (const [i, op] of before.entries()) expect(after[i]).not.toBe(op);
      expect(reasons(aliased)).toEqual([]);
      // The one visible change the ruling names: the parsed document carries the
      // canonical spelling, i.e. exactly what the fixture itself authors.
      expect(operatorsOf(parsedDoc(aliased))).toEqual(before);
    },
  );

  it.each(AFFECTED)(
    '%s: the dropdown\'s own camelCase dialect is ACCEPTED and normalised back (objectui#9559)',
    (id) => {
      const dropdown = withOperators(id, DROPDOWN_ID);
      // `equals` coincides across the two vocabularies, so only the rows that
      // actually moved carry this leg; assert at least one did.
      const before = operatorsOf(asAuthored(id));
      const after = operatorsOf(dropdown);
      expect(after).not.toEqual(before);
      expect(reasons(dropdown)).toEqual([]);
      expect(operatorsOf(parsedDoc(dropdown))).toEqual(before);
    },
  );

  it('`.success` is not vacuous — an invented operator is refused', () => {
    // ⚠️ The payload is deliberately spelled for THIS test — it names the card
    // and the component, so nobody reaches for it as a repo-wide "is this
    // token absent" control. A generic-looking absent token consumed as a test
    // literal stops being absent the moment this file lands, and the next
    // reader who trusts it gets a non-zero from a token they believed clean.
    const INVENTED = 'filter_builder_6939_invented_operator';
    const bogus = withOperators('components-complex-filter-builder/product-search', {
      equals: INVENTED,
      greater_than: INVENTED,
      less_than: INVENTED,
    });
    expect(DECLARED_OPERATORS).not.toContain(INVENTED);
    expect(operatorsOf(bogus)).not.toEqual(operatorsOf(asAuthored('components-complex-filter-builder/product-search')));
    expect(reasons(bogus)).not.toEqual([]);
  });
});

describe('objectui#6939 — PRESERVED: the rewrite cost no pixel', () => {
  it.each(AFFECTED)('%s: as authored renders exactly as the alias arm did', (id) => {
    const aliased = withOperators(id, FORMER_ALIAS);
    // ⛔ Anti-vacuity on the ARM, before anything is rendered — the same guard
    // the NEW-direction twin carries on its own use of this table (the leg
    // named `the alias dialect it used to author is ACCEPTED and normalised
    // back`).
    // `withOperators` falls through on a key it does not hold
    // (`table[c.operator] ?? c.operator`) and `FORMER_ALIAS` is keyed on the
    // DECLARED spellings, so against a corpus re-authored in the alias dialect
    // this arm is an identity transform: the same document rendered twice and
    // asserted equal to itself. Measured — without these two lines the whole
    // leg stays GREEN under a revert of the three catalog files to `eq` / `gt`
    // / `lt`, which is this card's own failure class reproduced inside the pin
    // that carries its headline claim.
    const beforeOps = operatorsOf(asAuthored(id));
    const afterOps = operatorsOf(aliased);
    expect(afterOps.length).toBe(beforeOps.length);
    for (const [i, op] of beforeOps.entries()) expect(afterOps[i]).not.toBe(op);
    const authored = measure(asAuthored(id));
    const asItWas = measure(aliased);
    // Anti-vacuity first: a tile that failed to mount would make every equality
    // below trivially true.
    expect(authored.text).not.toContain('failed to render');
    expect(authored.elements).toBeGreaterThan(10);
    expect(authored.operatorTriggers.length).toBeGreaterThan(0);
    // The three readings that would move if the repair had cost anything.
    expect(authored.text).toBe(asItWas.text);
    expect(authored.elements).toBe(asItWas.elements);
    expect(authored.inputs).toEqual(asItWas.inputs);
    expect(authored.operatorTriggers).toEqual(asItWas.operatorTriggers);
  });

  it.each(AFFECTED)('%s: and no operator cell is blank', (id) => {
    // The symptom objectui#7561 removed, restated as the floor this card must
    // not fall back through. ⛔ Not the same claim as the identity above: two
    // blank columns are also identical.
    const m = measure(asAuthored(id));
    expect(m.operatorTriggers.length).toBeGreaterThan(0);
    expect(m.operatorTriggers.filter((t) => t === '')).toEqual([]);
  });

  it('the identity legs can fail — a DIFFERENT operator moves the render', () => {
    // Without this, the equalities above would be satisfied by a `measure` that
    // reported the same thing for every tree it was given.
    //
    // ⭐ The swap table is DERIVED from whatever the entry currently spells,
    // never keyed on the spellings this card happens to have landed. Measured:
    // a hard-coded `{ equals: …, greater_than: … }` table makes this leg an
    // identity transform — and so, silently, a passing assertion about nothing
    // — the moment the corpus is re-authored in another dialect. That is the
    // failure this whole card is about, reproduced inside its own pin.
    const id = 'components-complex-filter-builder/product-search' as const;
    const table = Object.fromEntries(
      operatorsOf(asAuthored(id)).map((op) => [op, op === 'is_null' ? 'contains' : 'is_null']),
    );
    const authored = measure(asAuthored(id));
    const different = measure(withOperators(id, table));
    // The swap really reached the tree it was given.
    expect(operatorsOf(withOperators(id, table))).not.toEqual(operatorsOf(asAuthored(id)));
    expect(different.operatorTriggers).not.toEqual(authored.operatorTriggers);
    expect(different.text).not.toBe(authored.text);
  });
});
