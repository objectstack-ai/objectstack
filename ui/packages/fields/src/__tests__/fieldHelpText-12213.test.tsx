/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12213 — `fieldHelpText`, the one read of a field definition's help
 * line, exported from this package's entry.
 *
 * The record form (`@object-ui/plugin-form`) and `resolveActionParam` both call
 * it, so the order has one home: `inlineHelpText`, else `description`, an empty
 * string reading as absent. A served `help` key is not read: only an
 * objectstack server older than `@objectstack/spec` 17.7.0 serves one, and the
 * ruling on objectui#12213 retired that leg.
 *
 * The record form's and the action dialog's own pins
 * (`objectFormInlineHelpText-12213.test.tsx` in plugin-form,
 * `ActionParamDialog.fieldHelpLine-12213.test.tsx` in app-shell) assert the
 * line a user reads. This file pins the export itself, and its source type.
 */
import { describe, it, expect } from 'vitest';
// This package's own entry is imported RELATIVELY, for the reason
// `humanizeLabel.reexport.test.tsx` gives: a self-import resolves through the
// published `exports` map to `dist/`, which a cold CI cache does not have.
import { fieldHelpText } from '../index';

type FieldHelpTextSource = Parameters<typeof fieldHelpText>[0];

/**
 * A served field document arrives untyped (the form's `objectSchema` is not
 * typed), so a case that models one hands it over through a cast, as the data
 * itself does.
 */
const served = (doc: object) => doc as FieldHelpTextSource;

describe('fieldHelpText (objectui#12213)', () => {
  it('reads `inlineHelpText` first, over `description`', () => {
    expect(fieldHelpText({ inlineHelpText: 'Declared help', description: 'The description' })).toBe('Declared help');
  });

  it('falls back to `description` when `inlineHelpText` is absent or empty', () => {
    expect(fieldHelpText({ description: 'The description' })).toBe('The description');
    expect(fieldHelpText({ inlineHelpText: '', description: 'The description' })).toBe('The description');
  });

  it('CONTROL: answers undefined when the field declares neither, or both are empty', () => {
    expect(fieldHelpText({})).toBeUndefined();
    expect(fieldHelpText({ inlineHelpText: '', description: '' })).toBeUndefined();
  });

  it('ignores a served `help` key: `description` is read, and `help` alone answers undefined', () => {
    expect(fieldHelpText(served({ help: 'Served translated help', description: 'Served source description' }))).toBe(
      'Served source description',
    );
    expect(fieldHelpText(served({ help: 'Served help alone' }))).toBeUndefined();
    expect(fieldHelpText(served({ inlineHelpText: 'Declared help wins', help: 'Served help loses' }))).toBe(
      'Declared help wins',
    );
  });

  it('its source type has no `help` member: a typed literal carrying one does not compile', () => {
    // @ts-expect-error -- `help` is not a member of the read's source type; if
    // it were ever declared again, this directive would be unused and the
    // package's test type-check would fail.
    expect(fieldHelpText({ help: 'Served help', description: 'The description' })).toBe('The description');
  });
});
