/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The widget id is a function of the (type, `multiple`) PAIR, not of the type
 * string alone (objectui#3986).
 *
 * `mapFieldTypeToFormType` mapped `select` to `field:select` unconditionally,
 * while `SelectField` delegated to `MultiSelectField` whenever the metadata said
 * `multiple`. Three correct pieces, one gap between them: the component that
 * RENDERED was `MultiSelectField`, but everything keyed on the widget id — above
 * all the label-association declaration (`ComponentMeta.labelling`, resolved via
 * `getMeta('select')`) — was still answering for the single-value combobox. The
 * host label of a normal `{ type: 'select', multiple: true }` picklist therefore
 * emitted a `for` at the chip row's wrapper `div`, where a `for` is inert.
 *
 * `select` cannot simply be declared `labelling: 'group'` instead: the
 * single-value trigger IS labelable, and a bare `select` is a builtin the form
 * renderer resolves without the registry at all (pinned in
 * `form-group-label-association.test.ts`). The producer has to name the widget
 * that renders, which is what this file pins.
 *
 * Metadata only — nothing renders here, so no widget module is loaded.
 */

import { describe, it, expect } from 'vitest';
import { mapFieldTypeToFormType } from './field-type-alias';

describe('select carries its arity in the widget id (objectui#3986)', () => {
  it('maps select + multiple to the multi-value widget', () => {
    // The one assertion that was `field:select` before this change.
    expect(mapFieldTypeToFormType('select', { multiple: true })).toBe('field:multiselect');
  });

  it('keeps the single-value widget without multiple, and for multiple: false', () => {
    // The guard direction: single-select must not move. Its trigger is a
    // labelable `button[role=combobox]` and its `for` association works — taking
    // that away would break a field that is fine to fix one that is not.
    expect(mapFieldTypeToFormType('select')).toBe('field:select');
    expect(mapFieldTypeToFormType('select', {})).toBe('field:select');
    expect(mapFieldTypeToFormType('select', { multiple: false })).toBe('field:select');
    expect(mapFieldTypeToFormType('select', { multiple: null })).toBe('field:select');
  });

  it('is idempotent for the type that is already inherently multi', () => {
    // `multiselect` is a type in its own right; the arity override must not turn
    // it into something else, whichever way the flag is set.
    expect(mapFieldTypeToFormType('multiselect')).toBe('field:multiselect');
    expect(mapFieldTypeToFormType('multiselect', { multiple: true })).toBe('field:multiselect');
  });

  /**
   * The spec's multi-capable set is larger than the widget-moving set, and the
   * difference is the whole reason this override is table-driven rather than a
   * `config.multiple` branch sprinkled per type:
   *
   *   `MULTI_CAPABLE_TYPES` = select / lookup / file / image (+ `radio` on the
   *   select branch, `user` storing like `lookup`)
   *
   * Every member except `select` renders BOTH arities inside one widget —
   * `LookupField`, `FileField`, `ImageField` each read `multiple` themselves — so
   * their widget id, and with it their `labelling` declaration, is correct for
   * either arity. Moving them would point at widgets that do not exist.
   */
  // `owner` was listed here beside `user` until objectui#4814 retired the
  // spelling. It is dropped rather than kept-and-passing: the assertion would
  // still be green (both arities reach the tombstone), but it would be pinning
  // the arity behaviour of a REFUSAL, which says nothing about this override.
  const UNMOVED_MULTI_CAPABLE = ['lookup', 'master_detail', 'user', 'file', 'image', 'radio'] as const;

  it.each(UNMOVED_MULTI_CAPABLE)('%s resolves identically with and without multiple', (type) => {
    expect(mapFieldTypeToFormType(type, { multiple: true })).toBe(mapFieldTypeToFormType(type));
  });

  it('does not invent a widget for an unknown type flagged multiple', () => {
    // The fallback is unchanged: an unknown type is `field:text` at either arity,
    // never `field:text-multiple`-anything.
    expect(mapFieldTypeToFormType('something-unknown', { multiple: true })).toBe('field:text');
  });
});
