/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5880 — the TARGET-REQUIRED DEGRADE set is stated once per package,
 * and this file is the only thing holding the two statements together.
 *
 * The rule: "this picker widget cannot query without a DECLARED target, so
 * degrade it to a plain text input." It has exactly two production statements,
 * both spelled `new Set(['lookup', 'master_detail'])`:
 *
 *  - `packages/app-shell/src/utils/paramToField.ts` — read by the exported
 *    `paramDegradesWithoutTarget(param)`, keyed on `ActionParamDef.referenceTo`;
 *  - `packages/plugin-grid/src/components/bulkParamToField.ts` — read inline in
 *    `bulkParamToField`, keyed on `BulkActionParam.object`.
 *
 * The two are documented as twins ("mirrors app-shell's `paramToField`", "same
 * last-resort fallback as app-shell's `paramToField`"), and before this file
 * NOTHING mechanical held them together: no shared object, no pin, no gate that
 * could report a split. Members were identical, so there was no measured
 * divergence — the latent kind, not a live defect.
 *
 * Cost if it drifts: a third picker widget that needs a declared target gets
 * added to one set. The bulk dialog then silently stops degrading it — a picker
 * that cannot query, rendered as a picker.
 *
 * ## Why a PIN and not a shared constant
 *
 * A shared member set was the alternative, and it is declined on measurement,
 * not on taste:
 *
 *  1. It would only share the MEMBER half. The two predicates read different
 *     fields on different types (`ActionParamDef.referenceTo` vs
 *     `BulkActionParam.object`), so each surface keeps its own "has a target?"
 *     half either way. The shared constant therefore buys no coverage this pin
 *     does not already have — both catch exactly membership drift.
 *  2. It costs a NEW EXPORTED SYMBOL on a published package (`@object-ui/core`
 *     or `@object-ui/types`) — a permanent public surface, for a two-member
 *     internal heuristic. This pin exports nothing and publishes nothing.
 *  3. objectui#5312 ruled the deliberate separation for the SIBLING rule in
 *     these same two files (`LOOKUP_WIDGET_TYPES` vs `widgetNeedsDataSource`),
 *     because `user` is reference-bearing but must never degrade. Converging
 *     the member set of the smaller rule would re-open the question #5312 shut.
 *
 * The pin lives in app-shell rather than plugin-grid because the dependency
 * direction already runs that way: `@object-ui/app-shell` declares
 * `@object-ui/plugin-grid` in `devDependencies` and `peerDependencies`, while
 * plugin-grid does not depend on app-shell. The cross-package source import
 * below is the shape already established by
 * `packages/app-shell/src/layout/__tests__/activityItemType-6730.test.ts` and
 * `packages/plugin-grid/src/__tests__/rowRecordCrudVerdict.test.tsx`. So this
 * file adds no dependency edge at all.
 *
 * ## Why the sets are DERIVED, not read
 *
 * Neither `LOOKUP_WIDGET_TYPES` is exported, and neither should become exported
 * just to be testable — that is the published-surface cost item 2 refuses. So
 * each set is derived through its own package's real adapter, over one shared
 * probe vocabulary. That reads the EFFECTIVE rule, which is the thing that can
 * drift, rather than the text of a declaration.
 *
 * ## Why CONTENTS and not cardinality
 *
 * "Both sets have two members" passes against two sets that disagree — swap a
 * member on one side and the count is untouched. The load-bearing assertion is
 * set equality over the derived contents.
 *
 * ## Ablation direction, predicted before running
 *
 * Add a member to (or drop one from) EITHER package's set and the equality goes
 * RED, with a message naming both packages and the side that moved. The lit
 * control below goes red in the same run when app-shell is the side that moved,
 * and stays green when plugin-grid is — which is what makes it a control on
 * probe liveness rather than a second copy of the pin.
 *
 * The control earned its keep on first run: it caught that this file's probe
 * vocabulary reaches `tree`, a degrading row the narrower sweep in
 * `paramToField.test.ts` never sees. That was the instrument being wrong, not
 * the sets — both packages degrade `tree`, and neither set was touched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FORM_FIELD_TYPES } from '@object-ui/fields';
import { type ActionParamDef } from '@object-ui/core';
import { FieldType } from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
import type { BulkActionParam } from '@object-ui/types';

import { paramDegradesWithoutTarget } from './paramToField';
// The twin, by source path — see the dependency-direction note above.
import { bulkParamToField } from '../../../plugin-grid/src/components/bulkParamToField';

/**
 * The spec's own `FieldType` vocabulary.
 *
 * The wrapper walk is `@object-ui/test-support`'s shared reader (objectui#6924);
 * the THROW stays HERE, because the reader deliberately answers `[]` rather than
 * raising and this read is module-scope. A bare `enumOptions` call would trade a
 * loud failure for a silently empty vocabulary, and every assertion below would
 * then pass over nothing.
 */
const readSpecFieldTypes = (): readonly string[] => {
  const options = enumOptions(FieldType);
  if (options.length === 0) {
    throw new Error('could not read FieldType.options from @objectstack/spec');
  }
  return options;
};

/**
 * Param-only dialect spellings BOTH modules fold onto the canonical widget
 * vocabulary (`PARAM_TYPE_ALIASES` / `BULK_PARAM_TYPE_ALIASES`). Neither map is
 * exported, so they are restated here as inputs to probe with — never as the
 * answer being checked.
 */
const PARAM_DIALECT = ['reference', 'checkbox', 'datetime-local', 'autonumber'] as const;

/**
 * The probe domain, and why it is complete for this question.
 *
 * Both sets are tested against WIDGET KEYS — the output of
 * `resolveParamWidgetType` / `resolveBulkParamWidgetType`. `FORM_FIELD_TYPES` is
 * `Object.keys(fieldWidgetMap)`, i.e. the entire widget-key domain, so any key a
 * future author could add to either set is probed here. The spec vocabulary and
 * the param dialect are added because a set member could also be added in a RAW
 * spelling by mistake; `no-such-type` is the unknown-input control.
 */
const PROBE_VOCABULARY: readonly string[] = [
  ...new Set<string>([
    ...FORM_FIELD_TYPES,
    ...readSpecFieldTypes(),
    ...PARAM_DIALECT,
    'no-such-type',
  ]),
].sort();

/** app-shell's set, read through the ONE exported answer to the question. */
const shellDegrades = (type: string): boolean =>
  paramDegradesWithoutTarget({ name: 'probe', label: 'Probe', type } as ActionParamDef);

/**
 * plugin-grid's set, read through `bulkParamToField`.
 *
 * `bulkParamToField` exposes no predicate, so degradation is observed as the
 * difference the declared target makes: the widget collapses to `text` WITHOUT
 * a target and does not collapse WITH one. Both halves are needed — a param
 * that resolves to `text` anyway (`text` itself, `no-such-type`) yields `text`
 * on both passes and is correctly not counted as degrading.
 */
const gridDegrades = (type: string): boolean => {
  const base = { name: 'probe', label: 'Probe', type } as BulkActionParam;
  const withoutTarget = bulkParamToField(base, false);
  const withTarget = bulkParamToField({ ...base, object: 'accounts' }, false);
  return withoutTarget.type === 'text' && withTarget.type !== 'text';
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the target-required degrade set is the same set in both packages (objectui#5880)', () => {
  it('app-shell `paramToField` and plugin-grid `bulkParamToField` degrade exactly the same types', () => {
    // plugin-grid warns on every degrading probe by design (dev-only guidance
    // for the param author); silence it so the sweep does not flood the run.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const shellSet = PROBE_VOCABULARY.filter(shellDegrades);
      const gridSet = PROBE_VOCABULARY.filter(gridDegrades);

      // LIT CONTROL, not the pin. Two EMPTY sets are equal, so the equality
      // below would pass vacuously if the probe stopped reaching either
      // adapter. Naming the rows that actually degrade keeps the sweep from
      // going quietly hollow.
      //
      // TWO of the four rows are NOT set members — they reach the members by
      // resolution, and both were measured here rather than assumed:
      //   - `reference` — folded onto `lookup` by both modules' own alias map
      //     (`PARAM_TYPE_ALIASES` / `BULK_PARAM_TYPE_ALIASES`);
      //   - `tree` — a spec `FieldType` that is NOT a widget-map key, so
      //     `resolveFormWidgetType` sends it through
      //     `packages/fields/src/field-type-alias.ts` (`tree: 'field:lookup'`)
      //     and it arrives as `lookup`. It is absent from the narrower sweep in
      //     `paramToField.test.ts` only because that vocabulary is
      //     `FORM_FIELD_TYPES` + the dialect, and `tree` is in neither.
      // Both sides agree on both rows, which is the point.
      //
      // If a deliberate, CO-ORDINATED membership change lands, this line is
      // updated with it — that is a behaviour change and wants the thought.
      expect(
        shellSet,
        "app-shell's degrade set is not the one objectui#5880 measured. Either the probe went " +
          'HOLLOW (it reached no adapter, and the equality below would then prove nothing by ' +
          'comparing two empty sets), or `LOOKUP_WIDGET_TYPES` in ' +
          'packages/app-shell/src/utils/paramToField.ts MOVED — in which case plugin-grid\'s twin ' +
          'in packages/plugin-grid/src/components/bulkParamToField.ts needs the same move, and ' +
          'this line is updated with it.',
      ).toEqual(['lookup', 'master_detail', 'reference', 'tree']);

      // THE PIN. Contents, not cardinality: "both have 2 members" is satisfied
      // by two sets that disagree.
      expect(
        gridSet,
        'the target-required degrade set has DRIFTED: `LOOKUP_WIDGET_TYPES` in ' +
          'packages/plugin-grid/src/components/bulkParamToField.ts no longer degrades the same ' +
          'types as `LOOKUP_WIDGET_TYPES` in packages/app-shell/src/utils/paramToField.ts. ' +
          'These two are documented twins with no shared object between them — whichever side ' +
          'moved, the other needs the same move (or objectui#5880 needs re-deciding).',
      ).toEqual(shellSet);
    } finally {
      warn.mockRestore();
    }
  });

  it('the probe reaches BOTH adapters — neither side is answering for the other', () => {
    // Control on the derivation itself: `gridDegrades` observes plugin-grid's
    // module, not app-shell's. A copy-paste that pointed both readers at the
    // same adapter would make the pin above unfalsifiable, and this is what
    // notices. plugin-grid's degrade path warns; app-shell's does not.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(gridDegrades('lookup')).toBe(true);
      expect(
        warn.mock.calls.some(([m]) => String(m).includes('[BulkActionDialog]')),
        'gridDegrades did not reach plugin-grid `bulkParamToField`',
      ).toBe(true);

      warn.mockClear();
      expect(shellDegrades('lookup')).toBe(true);
      expect(
        warn.mock.calls.length,
        'shellDegrades reached plugin-grid — the two readers are not independent',
      ).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});
