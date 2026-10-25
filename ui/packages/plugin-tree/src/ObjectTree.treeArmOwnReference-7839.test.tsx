/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7839 — `detectParentField`'s `tree` arm accepts a `tree` field only
 * when its `reference` is ABSENT or names THIS object, mirroring the rule the
 * parse door already enforces.
 *
 * Before:  `if (def?.type === 'tree') return key;`
 * After:   the same, gated on `ref === undefined || ref === objectName`.
 *
 * Form copied from `ObjectTree.referenceArms-6837.test.tsx` (the sibling pin on
 * the same function). ⛔ Do not invent a second form.
 *
 * ## 1. The contract being mirrored — read, not paraphrased
 *
 * `@objectstack/spec`'s `refuseForeignTreeReference`
 * (`packages/spec/src/data/object.zod.ts`, objectstack#14892 / #15979) skips a
 * field unless it is foreign-shaped:
 *
 *     if (type !== 'tree' || reference === undefined || reference === ownName) continue;
 *
 * So the accept set is exactly {absent, own name} — `reference` stays OPTIONAL
 * on a `tree` (under this rule it is a redundant self-annotation), and only a
 * value naming ANOTHER object is refused. The spec's kernel predicate
 * `hasDetectableParentField` (`packages/spec/src/kernel/
 * functional-completeness.ts`) reads the identical rule and carries the
 * `ownName` guard as `own !== undefined && def.reference === own`; its docblock
 * named THIS reader as the one place still out of step ("On that arm this
 * predicate is STRICTER than objectui's `detectParentField` … tightening the
 * renderer is an objectui follow-up"). This file is that follow-up's pin.
 *
 * ## 2. ⚠️ What this pin deliberately does NOT assert — measured, not assumed
 *
 * The obvious extra control would be a live two-directional probe that
 * `ObjectSchema.safeParse` REFUSES the foreign shape, proving the renderer
 * mirrors a running contract rather than a remembered one. It is not here
 * because it would be RED, and the reason is worth recording rather than
 * discovering twice. Probed on the copy this branch actually installs
 * (`@objectstack/spec@17.2.0`, resolved through `packages/plugin-tree`):
 *
 *   | shape on an object named `business_unit`        | 17.2.0 verdict |
 *   |-------------------------------------------------|----------------|
 *   | `{ type: 'tree' }`                              | ACCEPT         |
 *   | `{ type: 'tree', reference: 'business_unit' }`   | ACCEPT         |
 *   | `{ type: 'tree', reference: 'other_object' }`    | **ACCEPT**     |
 *
 * `refuseForeignTreeReference` landed on objectstack `main` after 17.2.0 was
 * cut, and objectui tracks the spec by npm semver, not by SHA. So the renderer
 * is tightening AHEAD of its installed parse door — which is the whole reason
 * the tightening is worth doing at the renderer at all: until the pin moves,
 * this function is the only thing standing between a foreign-shaped `tree` and
 * a forest grouped on a pointer into a table it does not point at. The one
 * spec-anchored control below therefore pins only the half 17.2.0 already
 * answers, and that half is the one the live arms rest on: `reference` is
 * OPTIONAL on a `tree`, so the accept-when-absent arm is not blessing a shape
 * the schema rejects.
 *
 * ⛔ When the pin moves, do not delete that control — add the refusal leg
 * beside it. A green "absence is accepted" is what stops a future reading of
 * this rule from drifting to "a `tree` must self-annotate".
 *
 * ## 3. Reachability, stated so the pin is not mistaken for a live bug fix
 *
 * From PARSED metadata the refused shape is unreachable on a spec at or past
 * `refuseForeignTreeReference`. It is reachable from a HAND-BUILT schema:
 * `getObjectSchema` is a required member of the published `DataSource`
 * interface and `useSettledSchema` calls it on the generic `dataSource`, so a
 * third-party implementation reaches this reader raw — the same
 * door the sibling pin names. Defence in depth, not a hot path.
 *
 * ## 4. Ablation direction, predicted before running
 *
 * Restore `if (def?.type === 'tree') return key;` on the committed tree and the
 * two refusal cases below go RED (the foreign `tree` is picked again, so the
 * masked lookup never gets its turn) while every live arm and every `lookup`
 * control stays GREEN — that contrast is what makes the controls controls
 * rather than duplicates of the pins. MODULE RESOLUTION: this file imports the
 * component by RELATIVE SOURCE PATH (`./ObjectTree`), so both legs resolve to
 * SOURCE — no package `exports` hop, no `dist`, and therefore NO REBUILD LEG to
 * get wrong.
 */
import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import { ObjectTree } from './ObjectTree';

afterEach(cleanup);

/** The object every probe below declares itself to be. */
const OWN = 'business_unit';
const FOREIGN = 'other_object';

/**
 * A two-node self-referencing hierarchy. `Engineering` nests under `Acme` ONLY
 * if the parent pointer is auto-detected — which is the whole observable here,
 * because the schema below deliberately omits `parentField`.
 */
const RECORDS = [
  { id: '1', name: 'Acme', parent_id: null },
  { id: '2', name: 'Engineering', parent_id: '1' },
];

/**
 * The field maps under test. Every one of them still declares `parent_id` as
 * an EXPANDABLE type, so the settle signal in `mount` is independent of which
 * arm the detector takes — a refusal probe cannot be satisfied by a schema
 * that never arrived.
 */
const FIELD_MAPS: Record<string, Record<string, unknown>> = {
  // Live arms — the accept set the spec declares.
  tree_no_reference: { name: { type: 'text' }, parent_id: { type: 'tree' } },
  tree_own_reference: { name: { type: 'text' }, parent_id: { type: 'tree', reference: OWN } },
  // The refusal — the one shape this card removed from the accept set.
  tree_foreign_reference: { name: { type: 'text' }, parent_id: { type: 'tree', reference: FOREIGN } },
  // The masking case: before the tightening the foreign `tree` won BY POSITION
  // and the self-referencing lookup after it never got its turn.
  foreign_tree_masking_a_self_lookup: {
    name: { type: 'text' },
    decoy: { type: 'tree', reference: FOREIGN },
    parent_id: { type: 'lookup', reference: OWN },
  },
  // `lookup` controls — this arm did not move, and must stay green through
  // BOTH ablation legs.
  lookup_own_reference: { name: { type: 'text' }, parent_id: { type: 'lookup', reference: OWN } },
  lookup_foreign_reference: { name: { type: 'text' }, parent_id: { type: 'lookup', reference: FOREIGN } },
};

function makeDataSource(fields: Record<string, unknown>) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({ name: OWN, fields }),
    find: vi.fn(async () => RECORDS),
  } as any;
}

/** No `parentField` — auto-detection is what is under test. */
const TREE_SCHEMA = {
  type: 'object-tree',
  objectName: OWN,
  labelField: 'name',
  fields: ['name'],
} as any;

/**
 * Mount over one field map and wait for the SCHEMA-DEPENDENT commit to happen.
 *
 * The settle signal is deliberately ARM-independent: the record query is gated
 * on the settled schema and carries `$expand`, and `buildExpandFields` decides
 * that from the field's `type` alone — the `reference` target is irrelevant to
 * it. So a `find` carrying `$expand: ['parent_id']` proves the component
 * consumed this schema for the refusal probes just as much as for the live
 * ones, which is what stops a refusal from being satisfiable by a schema that
 * never arrived.
 */
async function mount(fields: Record<string, unknown>) {
  const ds = makeDataSource(fields);
  const view = render(<ObjectTree schema={TREE_SCHEMA} dataSource={ds} />);
  await waitFor(() =>
    expect(
      ds.find.mock.calls.some((c: any[]) => c[1]?.$expand?.includes('parent_id')),
    ).toBe(true),
  );
  await waitFor(() => expect(view.getAllByTestId('object-tree-row').length).toBe(2));
  return { ds, view };
}

/** The rendered depth of one node — 1 once the parent pointer is detected, 0 while it is not. */
function depthOf(view: ReturnType<typeof render>, label: string) {
  const row = view
    .getAllByTestId('object-tree-row')
    .find((r) => r.textContent?.includes(label));
  return row?.getAttribute('data-depth');
}

describe('ObjectTree auto-detects a `tree` parent pointer only when it is this object\'s own (objectui#7839)', () => {
  describe('live arms — the accept set the spec declares (without these, a detector that stopped detecting anything would pass the refusal too)', () => {
    it('accepts a `tree` with NO `reference` — the spec keeps the key optional', async () => {
      const { view } = await mount(FIELD_MAPS.tree_no_reference);
      expect(depthOf(view, 'Engineering')).toBe('1');
    });

    it('accepts a `tree` whose `reference` names THIS object', async () => {
      const { view } = await mount(FIELD_MAPS.tree_own_reference);
      expect(depthOf(view, 'Engineering')).toBe('1');
    });

    it('the root stays a root either way, so depth is reading the hierarchy and not the row order', async () => {
      const { view } = await mount(FIELD_MAPS.tree_own_reference);
      expect(depthOf(view, 'Acme')).toBe('0');
    });
  });

  describe('the refusal — a foreign-referencing `tree` is not a parent pointer', () => {
    it('does NOT pick a `tree` whose `reference` names another object', async () => {
      const { view } = await mount(FIELD_MAPS.tree_foreign_reference);
      expect(depthOf(view, 'Engineering')).toBe('0');
    });

    it('and still renders every record as a root rather than rendering nothing', async () => {
      // Guards the refusal above against the degenerate pass: a tree that
      // rendered no rows at all would also report no nested child.
      const { view } = await mount(FIELD_MAPS.tree_foreign_reference);
      expect(view.getAllByTestId('object-tree-row').length).toBe(2);
      expect(depthOf(view, 'Acme')).toBe('0');
      expect(view.getByText('Engineering')).toBeTruthy();
    });

    it('and no longer MASKS a self-referencing lookup declared after it', async () => {
      // The behavioural half a pure "is it skipped?" assertion cannot see:
      // skipping is only correct if the loop then keeps looking. Before the
      // tightening the foreign `tree` won by position and this rendered flat.
      const { view } = await mount(FIELD_MAPS.foreign_tree_masking_a_self_lookup);
      expect(depthOf(view, 'Engineering')).toBe('1');
    });
  });

  describe('the `lookup` arm did not move — regression control', () => {
    // These must stay green through BOTH ablation legs. If they move, the
    // tightening took the whole detector with it and the pins above are
    // reporting on rubble rather than on a narrowed arm.
    it('still detects a self-referencing `lookup`', async () => {
      const { view } = await mount(FIELD_MAPS.lookup_own_reference);
      expect(depthOf(view, 'Engineering')).toBe('1');
    });

    it('still refuses a foreign `lookup`', async () => {
      const { view } = await mount(FIELD_MAPS.lookup_foreign_reference);
      expect(depthOf(view, 'Engineering')).toBe('0');
    });
  });

  describe('the accept-when-absent arm is not blessing a shape the schema rejects', () => {
    // The only spec-anchored control 17.2.0 can answer today; see §2 of the
    // module docblock for the leg that is deliberately absent and why.
    it('`FieldSchema` accepts a `tree` field with no `reference`', () => {
      const parsed = FieldSchema.safeParse({ name: 'parent_id', type: 'tree', label: 'Parent' });
      expect(parsed.success).toBe(true);
    });

    it('and accepts one that self-annotates, so both live arms are spec-legal shapes', () => {
      const parsed = FieldSchema.safeParse({
        name: 'parent_id',
        type: 'tree',
        label: 'Parent',
        reference: OWN,
      });
      expect(parsed.success).toBe(true);
    });
  });
});
