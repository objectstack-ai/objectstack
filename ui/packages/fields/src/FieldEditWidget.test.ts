/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { FieldType } from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
import {
  FORM_FIELD_TYPES,
  INLINE_EXCLUDED_FIELD_TYPES,
  hasFieldEditWidget,
  isInlineExcludedFieldType,
  mapFieldTypeToFormType,
} from './index';

/**
 * A field type the form can render — either a direct widget-map key, or a spec
 * spelling that resolves onto one through the alias table (`secret` →
 * `field:password`, `autonumber` → `field:auto_number`, …).
 *
 * `FORM_FIELD_TYPES` alone is `Object.keys(fieldWidgetMap)`, which does NOT
 * include the alias-only spellings — see the note at index.tsx's
 * `resolveFormWidgetType`. Using it as the definition of "a real type" made the
 * staleness check below reject `secret`, a genuine spec field type the form
 * renders, purely because it arrives via an alias.
 */
function isRenderableFormType(t: string): boolean {
  // `text` is the alias table's fallback, so a non-`field:text` result means an
  // explicit entry exists. `text` itself is a direct widget key, so it is
  // already covered by the first clause and no real type is missed here.
  return FORM_FIELD_TYPES.includes(t) || mapFieldTypeToFormType(t) !== 'field:text';
}

/**
 * Drift-guard: the inline cell editor reuses the form's field widgets, but the
 * two lists were hand-maintained separately and drifted — `lookup` (and other
 * relational types) had a perfectly good form widget yet fell back to a plain
 * text box inline, because nobody wired it up. This pins the contract: every
 * type the FORM can render must have an explicit inline decision — an editor or
 * a documented exclusion — so a new form widget can never again silently become
 * an editable text box (or a missing one) in the grid.
 */
describe('inline editor ↔ form widget parity', () => {
  it('every form field type either has an inline editor or is explicitly excluded', () => {
    const undecided = FORM_FIELD_TYPES.filter(
      (t) => !hasFieldEditWidget(t) && !INLINE_EXCLUDED_FIELD_TYPES.has(t),
    );
    // If this fails: a form widget type has no inline decision. Either add it to
    // EDIT_WIDGETS (inline-editable) or to INLINE_EXCLUDED_FIELD_TYPES (with a
    // reason) in FieldEditWidget.tsx.
    expect(undecided).toEqual([]);
  });

  it('the exclusion set lists only real form types (no stale entries)', () => {
    const stale = [...INLINE_EXCLUDED_FIELD_TYPES].filter((t) => !isRenderableFormType(t));
    expect(stale).toEqual([]);
  });

  it('credential types are never inline-editable', () => {
    // The grid's fallback for a type with no inline editor is a PLAIN TEXT input.
    // Both of these are masked on read, so that input would show the mask as the
    // value and write it straight back; `secret` also round-trips through an
    // encrypted store (ADR-0100), so the cell holds an opaque ref, not the value.
    for (const t of ['password', 'secret']) {
      expect(hasFieldEditWidget(t), `${t} must not have an inline editor`).toBe(false);
      expect(INLINE_EXCLUDED_FIELD_TYPES.has(t), `${t} must be explicitly excluded`).toBe(true);
    }
  });

  it('relational fields use the standard picker inline (regression: lookup was a text box)', () => {
    // `owner` stood beside `user` here until objectui#4931. It is NOT merely
    // dropped for convenience: this assertion pinned the exact branch that card
    // removed — `EDIT_WIDGETS`' `owner` key, the road by which objectui#4814's
    // retirement was bypassed — so keeping it in any form would be pinning the
    // bug. Its replacement fact (the retirement gate answers `false`, and the
    // grid degrades to a read-only cell rather than a text box) is asserted in
    // one place, `__tests__/FieldEditWidget.retiredFieldType.test.tsx`.
    for (const t of ['lookup', 'master_detail', 'user']) {
      expect(hasFieldEditWidget(t)).toBe(true);
    }
  });

  it('computed / binary form types are NOT inline-editable (excluded)', () => {
    for (const t of ['formula', 'summary', 'auto_number', 'file', 'image']) {
      expect(hasFieldEditWidget(t)).toBe(false);
      expect(INLINE_EXCLUDED_FIELD_TYPES.has(t)).toBe(true);
    }
  });

  it('structured-value types edit inline with their form widget (color/address/location/code/…)', () => {
    for (const t of ['color', 'address', 'location', 'geolocation', 'code', 'qrcode']) {
      expect(hasFieldEditWidget(t)).toBe(true);
      expect(INLINE_EXCLUDED_FIELD_TYPES.has(t)).toBe(false);
    }
  });
});

/**
 * #2942 — the guard above iterates FORM_FIELD_TYPES (the form widget-map
 * keys), so a SPEC field type that reaches the form only through the alias
 * table could sit in neither set and silently fall back to the grid's plain
 * text input: `json`, `composite`, `record`, `repeater`, `tree`, `video`,
 * `audio`, `autonumber` all did. This pins the contract at the spec boundary:
 * every `FieldType` member must resolve (alias-aware) to an inline editor or
 * a documented exclusion.
 */
describe('inline editor ↔ SPEC FieldType parity (#2942)', () => {
  const specTypes: string[] = enumOptions(FieldType);

  it('reads a non-empty enum from the spec', () => {
    expect(specTypes, 'could not read FieldType.options from the spec').not.toEqual([]);
  });

  it('every spec field type resolves to an inline decision (editor or exclusion)', () => {
    const undecided = specTypes.filter(
      (t) => !hasFieldEditWidget(t) && !isInlineExcludedFieldType(t),
    );
    // If this fails: a spec field type would fall back to a plain text input
    // inline. Give it a widget (EDIT_WIDGETS / the alias table) or a
    // documented exclusion (INLINE_EXCLUDED_FIELD_TYPES).
    expect(undecided).toEqual([]);
  });

  it('the structured/computed spec spellings are closed corruption paths', () => {
    // Excluded (alias-aware): editing these through a text box corrupts the value.
    for (const t of ['composite', 'record', 'repeater', 'video', 'audio', 'autonumber']) {
      expect(isInlineExcludedFieldType(t), `${t} must be excluded from inline editing`).toBe(true);
      expect(hasFieldEditWidget(t), `${t} must not resolve to an editor`).toBe(false);
    }
    // Editable through their form widgets: json → the JSON editor (objectui#11448;
    // the code editor before it), tree → lookup picker.
    for (const t of ['json', 'tree']) {
      expect(hasFieldEditWidget(t), `${t} must resolve to its form widget`).toBe(true);
    }
  });
});
