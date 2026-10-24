/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6837 (second slice) — `detectParentField`'s relationship-target
 * chain drops the arm NO CONTRACT DECLARES, and keeps the two that carry the
 * value.
 *
 * Before:  `def?.reference || def?.reference_to || def?.referenceTo`
 * After:   `def?.reference || def?.reference_to`
 *
 * Form copied from `RecordDetailDrawer.referenceArms-6837.test.tsx` (PR #6920),
 * which copied it from PR #6916 / card #6840. ⛔ Do not invent a second form.
 *
 * ## 1. The measurement this pin stands on (not just its conclusion)
 *
 * THE CELL: a value inside an object schema's `fields` container — literally
 * what this function reads, `objectSchema.fields[key]`. Producer census by
 * STRUCTURE WALK (TypeScript compiler API over every tracked `.ts`/`.tsx`, plus
 * parsed JSON), recording each hit's ancestor property chain; EMIT positions
 * only (`PropertyAssignment` / `ShorthandPropertyAssignment`), so
 * `def?.referenceTo` — a `PropertyAccessExpression`, i.e. a READ — is never
 * counted as a producer, and a `PropertySignature` is bucketed as a
 * DECLARATION, never as one either. Subject and control were extracted BY THE
 * SAME PASS, FROM THE SAME CELLS, IN THE SAME UNITS, so the control sits on the
 * JOIN and not merely on the terms.
 *
 *   | term           | role    | repo-wide emits  | IN THE CELL |
 *   |----------------|---------|------------------|-------------|
 *   | `referenceTo`  | SUBJECT |  81 /  42 files  | **2** / 2   |
 *   | `reference`    | CONTROL | 195 /  76 files  |  92 / 36    |
 *   | `reference_to` | CONTROL | 137 /  88 files  |  52 / 36    |
 *
 * Both halves of the control discipline. (1) THE QUERY RAN: the controls are
 * hot — 92 and 52 — in the very cells where the subject collapses to 2, from
 * the same pass. (2) THE QUESTION WAS RIGHT: a mis-posed cell would have moved
 * subject and control together; instead it separates 92-to-2. Third check, the
 * one only this key affords: `referenceTo` is not a term the scanner cannot
 * see — it is hot repo-wide at 81 emits across 42 files, and collapses to 2
 * only under the cell restriction. The zero-ish is produced by the RESTRICTION,
 * not by scanner blindness.
 *
 * The two surviving in-cell hits are NEGATIVE fixtures of the retirement
 * machinery itself (`object-fields-io.spec-keys.test.ts:235`,
 * `MetadataFieldsPage.specKeyReference.test.tsx:75`): they poison a draft with
 * the retired key precisely to assert the read door STRIPS it before
 * `ObjectSchema.safeParse` sees it. A fixture asserting removal is not a
 * producer.
 *
 * SEAM-LOCAL control, the one this file owes over and above the repo-wide pass:
 * `plugin-tree` contains **zero** `referenceTo` emits at any position, in any
 * cell — while its own fixture corpus is hot on a surviving spelling
 * (`ObjectTree.fieldFormatting.test.tsx:51-52` and
 * `ObjectTree.settledSchemaKeying-6481.test.tsx:62-71` emit `reference`, six
 * hits in all, every one of them in a `fields` container feeding THIS
 * component). So the corpus that actually feeds this reader is hot on what
 * survives and empty on what goes.
 *
 * ## 2. Why refusal is correct, not merely unused-today
 *
 * `@objectstack/spec` 17.2.0's `FieldSchema` (`@objectstack/spec/data`), probed
 * two-directionally on this branch's installed copy:
 *
 *   - `reference: 'crm_account'`     → ACCEPT
 *   - `reference_to: 'crm_account'`  → REFUSE, `unrecognized_keys`
 *   - `referenceTo: 'crm_account'`   → REFUSE, `unrecognized_keys`,
 *     "Did you mean `referenceTo` → `reference`?"
 *
 * The alias entry is a RENAME HINT ATTACHED TO A REFUSAL, not an acceptance:
 * the spec names `referenceTo` explicitly in order to refuse it. `referenceTo`
 * is additionally a tombstone in `RETIRED_FIELD_KEY_TOMBSTONES`
 * (`@object-ui/types/internal/retired-field-keys`, `retiredBy: 'objectui#6041'`,
 * `specEquivalent: 'reference'`) at all three strip sites, so the designer read
 * door removes it before a draft round-trips. So this arm was not a "redundant"
 * fallback: it was INVENTED tolerance surface — a silent absorption point for a
 * producer that ought to fail visibly (AGENTS.md #0.1).
 *
 * ⚠️ What this does NOT rest on: any claim that no production producer of
 * `reference_to` exists. That question cannot be answered from inside this repo
 * — restricting the cell to production files collapses the CONTROL too, and
 * this repo is a UI library, not a metadata-app repo. `reference_to` and
 * `reference` are therefore deliberately untouched here; see §4.
 *
 * ## 3. No precedence inversion exists here — stated rather than fabricated
 *
 * The deleted arm sat at the END of the chain, and this chain is already
 * CANONICAL-FIRST (`reference || reference_to || referenceTo`), so it could
 * never preempt a contract-carrying spelling. There is therefore NO inversion
 * case to pin, and this file deliberately does not invent one: a
 * `{ reference: 'business_unit', referenceTo: 'other' }` case resolves to
 * `'business_unit'` both before and after the change and would measure nothing.
 * (Same call, for the same reason, as PR #6916 and PR #6920.)
 *
 * ⚠️ One asymmetry worth naming rather than glossing: this chain uses `||`,
 * not `??`, so it also skips the empty string. That is unchanged by this slice
 * — the arms move, the operator does not.
 *
 * ## 4. THE FLOOR, restated where someone would try to re-widen it
 *
 * ⛔ Do not re-add a spelling arm to this chain. A producer emitting a refused
 * spelling is fixed AT THE PRODUCER, or canonicalised ONCE at the ingestion
 * choke point — `normalizeSchemaReferenceKeys`, which folds a legacy spelling
 * onto `reference`. Never a renderer-side alias: that is how ~20 per-consumer
 * dual-key fallbacks got written under a normalizer whose own docstring said
 * it existed "so per-consumer dual-key fallbacks can't drift".
 *
 * ⭐ THAT OPEN SCOPE IS NOW CLOSED FOR THIS READER — objectui#6837 half 2.
 * Maintainer ruling 2026-08-31 (第 6 场总监席决裁批 #14), 原文照录:
 * "objectui不是前端的项目吗?后端的元数据只要对,前端按协议执行就行了呀".
 * Protocol normalization belongs on the SERVER. objectstack#13847 landed that
 * half — a `field-reference-to-alias` conversion rewrites stored
 * `reference_to` -> `reference` on the serve path and in `os migrate meta` —
 * so this reader keeps ONE arm, `reference`, and the `reference_to` case below
 * moved from the live group to the refusal group.
 *
 * ⭐ The tier-boundary caveat this paragraph used to carry is now CLOSED too
 * (objectui#11070 round 4, the seat's answer A under the same ruling). It was
 * about ObjectUI's OWN contracts — `LookupFieldMetadata`,
 * `DetailViewFieldSchema` and the `FieldMetadata` bag — which declared
 * `reference_to`, so the three widget-seam readers of that bag
 * (`fields/src/index.tsx#LookupCellRenderer`, `widgets/LookupField.tsx`,
 * `widgets/UserField.tsx`) were not narrowed by half 2. Round 4 moved those
 * contracts, their in-repo producers and those readers to `reference` in one
 * step, and `plugin-grid`'s `relationalMetaCopySet.derivation.test.ts` gate
 * dropped its `reference_to` row with them.
 *
 * ## 5. Ablation direction, predicted before running
 *
 * Restore the deleted arm on the committed tree and the refusal below goes RED
 * while every live-arm control stays GREEN — that contrast is what makes the
 * controls controls rather than duplicates of the pins. MODULE RESOLUTION: this
 * file imports the component by RELATIVE SOURCE PATH (`./ObjectTree`) and
 * `@object-ui/core` is aliased by the root `vitest.config.mts` to
 * `packages/core/src`, so both legs resolve to SOURCE — no package `exports`
 * hop, no `dist`, and therefore NO REBUILD LEG to get wrong.
 */
import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { ObjectTree } from './ObjectTree';

afterEach(cleanup);

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
 * Every probe is a self-referencing `lookup`, so only the target SPELLING
 * varies. ⚠️ `lookup` and not `tree`, and objectui#7839 made that choice
 * STRICTLY more load-bearing rather than retiring it. The `tree` arm now reads
 * a target too (absent, or this object's own name), but it reads only the ONE
 * declared spelling: a `tree` carrying just a refused spelling has, to that
 * arm, no `reference` AT ALL, so it is accepted as the parent pointer and every
 * refusal below would invert to green. On a `lookup` the same def is simply
 * not a self-reference, which is what keeps the chain observable.
 */
const FIELD_DEFS: Record<string, Record<string, unknown>> = {
  // Live arm — the ONE spelling the protocol declares. objectui#6837 half 2
  // deleted the `reference_to` arm too, so this is now the whole accept set.
  spec_spelling: { type: 'lookup', reference: 'business_unit' },
  // Deleted arms — both refused by `FieldSchema` by NAME, each with its own
  // "did you mean -> `reference`?" rename (measured on @objectstack/spec
  // 17.2.0, positive control `reference`, negative control a nonsense key
  // which gets no rename hint).
  legacy_snake: { type: 'lookup', reference_to: 'business_unit' },
  legacy_camel: { type: 'lookup', referenceTo: 'business_unit' },
};

function makeDataSource(parentDef: Record<string, unknown>) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'business_unit',
      fields: { name: { type: 'text' }, parent_id: parentDef },
    }),
    find: vi.fn(async () => RECORDS),
  } as any;
}

/** No `parentField` — auto-detection is what is under test. */
const TREE_SCHEMA = {
  type: 'object-tree',
  objectName: 'business_unit',
  labelField: 'name',
  fields: ['name'],
} as any;

/**
 * Mount over one field def and wait for the SCHEMA-DEPENDENT commit to happen.
 *
 * The settle signal is deliberately spelling-INDEPENDENT: the record query is
 * gated on the settled schema and carries `$expand`, and `buildExpandFields`
 * decides that from the field's `type` alone ("the `reference` / `reference_to`
 * target is irrelevant to the decision"). So a `find` carrying
 * `$expand: ['parent_id']` proves the component consumed this schema — for the
 * refusal probe just as much as for the live-arm ones, which is what stops the
 * refusal from being satisfiable by a schema that never arrived.
 */
async function mount(parentDef: Record<string, unknown>) {
  const ds = makeDataSource(parentDef);
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

describe('ObjectTree detects a parent pointer only through contract-declared target spellings (objectui#6837)', () => {
  describe('live arms — the value still arrives (without these, a tree that stopped detecting anything would pass the refusal too)', () => {
    it('resolves `reference`, the spelling `FieldSchema` accepts', async () => {
      const { view } = await mount(FIELD_DEFS.spec_spelling);
      expect(depthOf(view, 'Engineering')).toBe('1');
    });

    it('the root stays a root either way, so depth is reading the hierarchy and not the row order', async () => {
      const { view } = await mount(FIELD_DEFS.spec_spelling);
      expect(depthOf(view, 'Acme')).toBe('0');
    });
  });

  describe('refusals — one named case per deleted key', () => {
    it('does NOT read `reference_to` (objectui#6837 half 2: `FieldSchema` refuses it by name with its own rename hint; objectstack#13847 normalizes it away on the serve path)', async () => {
      const { view } = await mount(FIELD_DEFS.legacy_snake);
      expect(depthOf(view, 'Engineering')).toBe('0');
    });

    it('does NOT read `referenceTo` (RETIRED_FIELD_KEY_TOMBSTONES, objectui#6041/#6519; `FieldSchema` refuses it by name)', async () => {
      const { view } = await mount(FIELD_DEFS.legacy_camel);
      expect(depthOf(view, 'Engineering')).toBe('0');
    });

    it('and still renders every record as a root rather than rendering nothing', async () => {
      // Guards the refusal above against the degenerate pass: a tree that
      // rendered no rows at all would also report no nested child.
      const { view } = await mount(FIELD_DEFS.legacy_camel);
      expect(view.getAllByTestId('object-tree-row').length).toBe(2);
      expect(depthOf(view, 'Acme')).toBe('0');
      expect(view.getByText('Engineering')).toBeTruthy();
    });
  });

  describe('the ingestion choke point is what makes the deletion lossless', () => {
    it('a `referenceTo`-only def that came through `normalizeSchemaReferenceKeys` STILL resolves', async () => {
      // The mechanism, not a formality: the normalizer folds a legacy
      // `reference_to` / `referenceTo` onto `reference`, so every def that
      // entered through `MetadataProvider` or
      // `ObjectStackAdapter.getObjectSchema` already carries `reference` by
      // the time this component sees it. The deleted arm was dead weight there.
      //
      // ⚠️ And this is exactly why the pin above still matters: the door is
      // NOT total. `getObjectSchema` is a required member of the published
      // `DataSource` interface and `useSettledSchema` calls it on the generic
      // `dataSource`, so a third-party implementation reaches this reader raw.
      const schema = {
        name: 'business_unit',
        fields: { parent_id: { ...FIELD_DEFS.legacy_camel } },
      };
      normalizeSchemaReferenceKeys(schema);
      const { view } = await mount(schema.fields.parent_id as Record<string, unknown>);
      expect(depthOf(view, 'Engineering')).toBe('1');
    });
  });
});
