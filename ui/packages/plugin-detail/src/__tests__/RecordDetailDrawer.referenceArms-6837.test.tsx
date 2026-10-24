/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6837 (first slice) — the drawer's relationship-target chain drops the
 * two arms NO CONTRACT DECLARES, and keeps the two that carry the value.
 *
 * Before:  `def.reference_to ?? def.reference ?? def.referenceTo ?? def.target`
 * After:   `def.reference_to ?? def.reference`
 *
 * ## 1. The measurement this pin stands on (not just its conclusion)
 *
 * THE CELL: a value inside an object schema's `fields` container — literally
 * what this component reads, `objectSchema.fields[name]`. Producer census by
 * STRUCTURE WALK (TypeScript compiler API over every tracked `.ts`/`.tsx`, plus
 * parsed JSON/YAML), recording each hit's ancestor property chain; EMIT
 * positions only, so `def.target` (a read) is never counted as a producer.
 * Subject and control terms were extracted BY THE SAME PASS, FROM THE SAME
 * CELLS, IN THE SAME UNITS — the control sits on the JOIN, not merely on the
 * terms.
 *
 *   | term           | role    | repo-wide emits | IN THE CELL   |
 *   |----------------|---------|-----------------|---------------|
 *   | `target`       | SUBJECT | 1329 / 366 files| **0** / 0     |
 *   | `referenceTo`  | SUBJECT |   80 /  41 files| **2** / 2     |
 *   | `reference`    | CONTROL |  194 /  75 files|  92 / 36      |
 *   | `reference_to` | CONTROL |  136 /  87 files|  52 / 36      |
 *
 * A second, INDEPENDENT cell test that does not rely on a `fields` ancestor —
 * "the enclosing object's own `type` is reference-bearing"
 * (`EXPANDABLE_FIELD_TYPES`) — agrees: `target` 0, and every one of the 29
 * `referenceTo` hits is a test fixture at OTHER seams (action params, the
 * filter builder, the retirement machinery), none in `plugin-detail` and none
 * reaching this drawer.
 *
 * The two in-cell `referenceTo` hits are NEGATIVE fixtures of the retirement
 * machinery itself (`object-fields-io.spec-keys`, `MetadataFieldsPage
 * .specKeyReference`): they poison a draft with the retired key precisely to
 * assert the read door STRIPS it. A fixture asserting removal is not a producer.
 *
 * Why `target`'s repo-wide 1329 is not a counter-example: every one of those
 * emits belongs to a DIFFERENT TIER. Attributed by the enclosing object's own
 * `type` value they are `api` (137), `url` (35), `script` (32), `form` (16),
 * `flow` (13), `back` (9), `modal` (6), `fault` (5) — action and navigation
 * nodes — plus 1062 with no sibling `type` at all (DOM event targets, link
 * targets). Not one lands on a field definition.
 *
 * ## 2. Why refusal is correct, not merely unused-today
 *
 * `@objectstack/spec`'s `FieldSchema` refuses BOTH deleted spellings BY NAME
 * with `unrecognized_keys`, each carrying its own "did you mean `reference`"
 * rename — measured two-directionally against the installed spec, alongside
 * `reference` parsing clean. `referenceTo` is additionally in
 * `RETIRED_FIELD_KEYS` (objectui#6041 / #6519), so the designer read door
 * strips it before any draft round-trips. So these were not "redundant"
 * fallbacks: they were INVENTED tolerance surface — a silent absorption point
 * for a producer that ought to fail visibly (AGENTS.md #0.1).
 *
 * ## 3. No precedence inversion exists here — stated rather than fabricated
 *
 * Both deleted arms sat at the END of the chain
 * (`reference_to ?? reference ?? referenceTo ?? target`), so neither could ever
 * preempt a contract-carrying spelling. There is therefore NO inversion case to
 * pin, and this file deliberately does not invent one: a
 * `{ reference: 'a', target: 'b' }` case would resolve to `'a'` both before and
 * after the change and would measure nothing. (Copied from PR #6916 / card
 * #6840, which set this form and made the same call for `value`.)
 *
 * ## 4. THE FLOOR, restated where someone would try to re-widen it
 *
 * ⛔ Do not re-add a spelling arm to this chain. A producer emitting a refused
 * spelling is fixed AT THE PRODUCER, or canonicalised ONCE at the ingestion
 * choke point — `normalizeSchemaReferenceKeys`, which folds a legacy spelling
 * onto `reference`. Never a renderer-side alias: that is
 * how twenty per-consumer dual-key fallbacks got written under a normalizer
 * whose own docstring said it existed "so per-consumer dual-key fallbacks
 * can't drift".
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
 * contracts, their in-repo producers (this drawer's emit among them) and those
 * readers to `reference` in one step, and `plugin-grid`'s
 * `relationalMetaCopySet.derivation.test.ts` gate dropped its `reference_to`
 * row with them. So the drawer now EMITS `reference`, and the helper below
 * reads that key.
 *
 * ## 5. Ablation direction, predicted before running
 *
 * Restore either deleted arm on the committed tree and the matching refusal
 * goes RED while every live-arm control stays GREEN — that contrast is what
 * makes the controls controls rather than duplicates of the pins. The pin
 * imports the component by RELATIVE SOURCE PATH (`../RecordDetailDrawer`), so
 * no package `exports` hop and no `dist` leg is involved.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { RecordDetailDrawer } from '../RecordDetailDrawer';

/**
 * The drawer hands its derived field list to `DetailView` as `schema.fields`.
 * Standing in for `DetailView` captures that list without rendering the whole
 * detail tree — the resolved `reference_to` under test is a property of the
 * list, not of how DetailView paints it. (Same harness as
 * `expandableFamily.identity-5874.test.tsx`, which pins the sibling rule
 * derived from the very same `.map()`.)
 */
const capturedFields: { current: any[] } = { current: [] };
vi.mock('../DetailView', () => ({
  DetailView: ({ schema }: any) => {
    capturedFields.current = schema?.fields ?? [];
    return <div data-testid="detail-view-stub" />;
  },
}));

/** Every probe is a `lookup`, so only the target SPELLING varies between them. */
const FIELD_DEFS: Record<string, Record<string, unknown>> = {
  // Live arm — the ONE spelling the protocol declares. objectui#6837 half 2
  // deleted the `reference_to` READ; objectui#11070 round 4 moved the EMIT to
  // `reference`, the key its target contract (`DetailViewField`) now declares.
  spec_spelling: { type: 'lookup', label: 'Spec', reference: 'crm_account' },
  // Deleted arms — refused by name, zero producers in the cell.
  legacy_snake: { type: 'lookup', label: 'Legacy snake', reference_to: 'crm_account' },
  legacy_camel: { type: 'lookup', label: 'Legacy camel', referenceTo: 'crm_account' },
  invented: { type: 'lookup', label: 'Invented', target: 'crm_account' },
  // Non-relation control: carries no target spelling at all.
  plain_text: { type: 'text', label: 'Plain' },
};

const RECORD: Record<string, unknown> = {
  id: 'r1',
  legacy_snake: 'acc-1',
  spec_spelling: 'acc-1',
  legacy_camel: 'acc-1',
  invented: 'acc-1',
  plain_text: 'hello',
};

/** Render the drawer over `fields` and return the list handed to DetailView. */
function resolveFields(fields: Record<string, unknown>) {
  capturedFields.current = [];
  render(
    <RecordDetailDrawer
      open
      onClose={() => {}}
      title="Probe"
      record={RECORD}
      recordId="r1"
      objectName="probe"
      objectSchema={{ name: 'probe', fields } as any}
      onFieldSave={async () => {}}
    />,
  );
  return capturedFields.current;
}

/** The `reference` the drawer resolved for one field name. */
function resolvedTarget(name: string, fields: Record<string, unknown> = FIELD_DEFS) {
  const field = resolveFields(fields).find((f: any) => f.name === name);
  // Nothing emits the retired spelling any more (objectui#11070 round 4).
  expect(field?.reference_to).toBeUndefined();
  return field?.reference;
}

describe('RecordDetailDrawer resolves only contract-declared target spellings (objectui#6837)', () => {
  describe('live arms — the value still arrives (without these, a drawer that stopped resolving anything would pass the refusals too)', () => {
    it('resolves `reference`, the spelling `FieldSchema` accepts', () => {
      expect(resolvedTarget('spec_spelling')).toBe('crm_account');
    });

    it('still derives the whole field list, relations and non-relations alike', () => {
      // Guards the refusals below against the degenerate pass: a drawer that
      // produced no fields at all would satisfy every `toBeUndefined()`.
      const names = resolveFields(FIELD_DEFS).map((f: any) => f.name);
      expect(names).toEqual(
        expect.arrayContaining(['spec_spelling', 'legacy_snake', 'legacy_camel', 'invented', 'plain_text']),
      );
    });

    it('marks the relation fields readonly, so the list is genuinely populated', () => {
      const f = resolveFields(FIELD_DEFS).find((x: any) => x.name === 'spec_spelling');
      expect(f?.readonly).toBe(true);
    });
  });

  describe('refusals — one named case per deleted key', () => {
    it('does NOT read `reference_to` (objectui#6837 half 2: `FieldSchema` refuses it by name with its own rename hint; objectstack#13847 normalizes it away on the serve path)', () => {
      expect(resolvedTarget('legacy_snake')).toBeUndefined();
    });

    it("does NOT read `referenceTo` (RETIRED_FIELD_KEYS, objectui#6041/#6519; `FieldSchema` refuses it by name)", () => {
      expect(resolvedTarget('legacy_camel')).toBeUndefined();
    });

    it("does NOT read `target` (no contract declares it; 0 producers in the cell against controls of 92 and 52)", () => {
      expect(resolvedTarget('invented')).toBeUndefined();
    });
  });

  describe('the ingestion choke point is what makes the `referenceTo` deletion lossless', () => {
    it('a `referenceTo`-only def that came through `normalizeSchemaReferenceKeys` STILL resolves', () => {
      // This is the mechanism, not a formality: the normalizer folds a
      // legacy `reference_to` / `referenceTo` onto `reference`, so every def
      // that entered through MetadataProvider or
      // ObjectStackAdapter.getObjectSchema already carries `reference` by the
      // time the drawer sees it. The deleted arm was dead weight for those.
      const schema = { name: 'probe', fields: { legacy_camel: { ...FIELD_DEFS.legacy_camel } } };
      normalizeSchemaReferenceKeys(schema);
      expect(resolvedTarget('legacy_camel', schema.fields)).toBe('crm_account');
    });

    it('a `target`-only def does NOT resolve even through the normalizer — nothing in the stack ever declared it', () => {
      // `normalizeFieldReferenceKeys` never read `target` either. So unlike
      // `referenceTo`, `target` had no home anywhere in the stack: not in the
      // spec, not at the choke point, not in the retirement registry.
      const schema = { name: 'probe', fields: { invented: { ...FIELD_DEFS.invented } } };
      normalizeSchemaReferenceKeys(schema);
      expect(resolvedTarget('invented', schema.fields)).toBeUndefined();
    });
  });
});
