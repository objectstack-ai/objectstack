/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SelectOption ↔ `@objectstack/spec` drift guard (#3090, objectstack#4115).
 *
 * Unlike the FormField pair — two genuinely different concepts on two layers —
 * a select option is ONE concept in two dialects, so the zod schema is now a
 * spec derivation: spec keys flow in by reference, with two pinned divergences
 * (`value` widened for UI-land, `visibleWhen` kept on objectui's #2212 wire
 * contract) and two UI-only extensions (`disabled`, `icon`).
 *
 * What the old hand copy silently did, all fixed by the derivation and pinned
 * here so it cannot regress:
 *
 *  - `color` — stripped, while `@object-ui/fields` renders it (badge/dot).
 *  - `default` — stripped.
 *  - `visibleWhen` — stripped, while the select widgets evaluate it for
 *    per-option gating; a gated option survived `objectui validate` with its
 *    gate removed.
 *
 * EDITED by objectui#12736 (triage scoping B): the derivation now reads the
 * spec's FORM-VIEW option, `FormSelectOptionSchema` (`@objectstack/spec/ui`),
 * not the object-field `SelectOptionSchema`. The form-view option leaves out
 * the object-field option's `default` and `kind`, and this schema REFUSES both
 * by name instead of carrying them (`default` used to be "kept" here, and
 * nothing on the form path read it). The object-field keys are therefore no
 * longer this schema's spec keys; they are its named refusals, derived as the
 * set difference of the two spec shapes, never listed.
 */

import { describe, it, expect } from 'vitest';
import { SelectOptionSchema as SpecSelectOptionSchema } from '@objectstack/spec/data';
import { FormSelectOptionSchema as SpecFormSelectOptionSchema } from '@objectstack/spec/ui';
import { SelectOptionSchema } from '../zod/form.zod.js';

const specKeys = Object.keys(SpecFormSelectOptionSchema.shape).sort();
const localKeys = Object.keys(SelectOptionSchema.shape).sort();
/** The object-field option's keys the form-view option leaves out — derived. */
const objectFieldOnlyKeys = Object.keys(SpecSelectOptionSchema.shape).filter((k) => !specKeys.includes(k));

describe('SelectOptionSchema derives from the spec', () => {
  it('carries every spec key', () => {
    for (const key of specKeys) {
      expect(localKeys, `spec key '${key}' missing locally`).toContain(key);
    }
  });

  it('extends the spec by exactly the documented UI-only keys, plus the object-field-only refusals', () => {
    const extensions = localKeys.filter((k) => !specKeys.includes(k));
    // If the spec ever claims one of the UI-only names, this fails and the two
    // meanings must be reconciled instead of silently shadowed. The refusals
    // (objectui#12736) are read off the two spec shapes, not listed.
    expect(extensions).toEqual([...objectFieldOnlyKeys, 'disabled', 'icon'].sort());
    // Control: the derived refusal set is not empty, so the line above is not
    // passing on a vacuous difference.
    expect(objectFieldOnlyKeys.length).toBeGreaterThan(0);
  });

  it('keeps the spec keys the old hand copy stripped', () => {
    // EDITED by objectui#12736: `default` left this fixture — the form-view
    // option does not take it, and it is now refused (see the boundary pin
    // `select-option-form-view-boundary-12736.test.ts`).
    const parsed = SelectOptionSchema.parse({
      label: 'China',
      value: 'cn',
      color: 'red',
      visibleWhen: "'admin' in current_user.positions",
    });
    expect(parsed.color).toBe('red');
    expect(parsed.visibleWhen).toBe("'admin' in current_user.positions");
  });

  it('accepts the { dialect, source } expression shape too (#2212)', () => {
    const expr = { dialect: 'cel', source: 'record.country == "cn"' };
    const parsed = SelectOptionSchema.parse({ label: 'X', value: 'x', visibleWhen: expr });
    expect(parsed.visibleWhen).toEqual(expr);
  });
});

describe('pinned divergences from the spec', () => {
  it('widens `value` beyond the spec on purpose (UI forms bind numbers/booleans)', () => {
    // Ours accepts…
    expect(SelectOptionSchema.safeParse({ label: 'N', value: 42 }).success).toBe(true);
    expect(SelectOptionSchema.safeParse({ label: 'B', value: true }).success).toBe(true);
    // …what the spec (machine-identifier values) rejects. If the spec widens,
    // this fails → drop the local `value` override.
    expect(SpecSelectOptionSchema.safeParse({ label: 'N', value: 42 }).success).toBe(false);
  });

  it('keeps a bare-string visibleWhen verbatim (no envelope canonicalization)', () => {
    // The spec's ExpressionInput pipe rewrites a string into an envelope at
    // parse time; this schema's output shape must stay stable for existing
    // consumers of `safeValidateSchema` output.
    const parsed = SelectOptionSchema.parse({ label: 'X', value: 'x', visibleWhen: 'record.a == 1' });
    expect(parsed.visibleWhen).toBe('record.a == 1');
  });
});
