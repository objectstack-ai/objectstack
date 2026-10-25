/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The wizard's provider-less fallback interpolator must be LITERAL on both
 * sides, the way i18next is — objectui#4370, the hand-rolled copy of the
 * shared helper's objectui#3418 fix.
 *
 * `String.prototype.replace` interprets `$&`, `` $` ``, `$'` and `$$` in the
 * REPLACEMENT string; i18next does not. The `g` flag the wizard already used
 * covered the repeated-placeholder half, but not this one — the patterns live
 * in the replacement, not the needle. The values below reach this function as
 * field labels (`grid.import.missingRequiredHint`,
 * `grid.import.legacyReferenceBlocked`), which are authored metadata.
 */
import { describe, it, expect } from 'vitest';
import { __testables, IMPORT_DEFAULT_TRANSLATIONS } from './ImportWizard';

const { interpolate } = __testables;

describe('ImportWizard fallback interpolation is literal (objectui#4370)', () => {
  // [value, what `replace` produced before the fix]
  const CORRUPTING_VALUES: ReadonlyArray<readonly [string, string]> = [
    ['A$&B', 'Invalid A{{type}}B'],
    ['x$`y', 'Invalid xInvalid y'],
    ['p$$q', 'Invalid p$q'],
    ["u$'v", 'Invalid uv'],
  ];

  it.each(CORRUPTING_VALUES)('splices %j verbatim', (value, corrupted) => {
    const rendered = interpolate('Invalid {{type}}', { type: value });
    // The `$&` row is the ugly one: the PLACEHOLDER is printed back at the user.
    expect(rendered).toBe(`Invalid ${value}`);
    expect(rendered).not.toBe(corrupted);
    expect(rendered).not.toContain('{{type}}');
  });

  it('keeps a `$`-carrying field label intact in the shipped required-fields hint', () => {
    const template = IMPORT_DEFAULT_TRANSLATIONS['grid.import.missingRequiredHint'];
    const rendered = interpolate(template, { fields: 'Total$& (total)' });
    expect(rendered).toContain('Total$& (total)');
    expect(rendered).not.toContain('{{fields}}');
  });

  it('still substitutes EVERY occurrence of a placeholder', () => {
    // The `g` flag already did this; split/join must not regress it.
    expect(interpolate('{{n}} of {{n}}', { n: 3 })).toBe('3 of 3');
  });

  it('treats the placeholder name literally, with no RegExp metacharacter meaning', () => {
    // The old needle was an unescaped `new RegExp(`{{${k}}}`, 'g')`. Inert while
    // every placeholder name is a bare identifier, but the needle is now a
    // plain string, so a name carrying metacharacters can only match itself.
    expect(interpolate('a {{x.y}} b', { 'x.y': 'V' })).toBe('a V b');
    expect(interpolate('a {{xAy}} b', { 'x.y': 'V' })).toBe('a {{xAy}} b');
  });

  it('returns the template untouched when there are no vars', () => {
    expect(interpolate('Invalid {{type}}')).toBe('Invalid {{type}}');
  });
});
