// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit tests for the xlsx colour helpers on the export path: {@link toArgb}
 * (hex → exceljs ARGB) and {@link cellFontColor} (select/radio option colour
 * for one cell). Both are pure and return `undefined` whenever a cell should
 * stay unstyled, so the export never emits an invalid workbook.
 */

import { describe, it, expect } from 'vitest';
import { toArgb, cellFontColor, type ExportFieldMeta } from './export-format';

describe('toArgb', () => {
  it('expands 3-digit hex to opaque ARGB', () => {
    expect(toArgb('#3ab')).toBe('FF33AABB');
    expect(toArgb('abc')).toBe('FFAABBCC'); // leading # optional
  });

  it('prefixes 6-digit hex with the opaque alpha, upper-cased', () => {
    expect(toArgb('#e11d48')).toBe('FFE11D48');
    expect(toArgb('E11D48')).toBe('FFE11D48');
  });

  it('returns undefined for anything that is not plain hex', () => {
    for (const bad of ['', '  ', '#12', '#12345', '#1234567', 'red', 'rgb(1,2,3)', '#gggggg', null, undefined, 42, {}]) {
      expect(toArgb(bad as unknown)).toBeUndefined();
    }
  });
});

describe('cellFontColor', () => {
  const priority: ExportFieldMeta = {
    name: 'priority', type: 'select', label: '优先级',
    options: [{ label: '高', value: 'high', color: '#e11d48' }, { label: '低', value: 'low', color: '#3ab' }],
  };

  it('resolves the matched select option colour to ARGB', () => {
    expect(cellFontColor('high', priority)).toBe('FFE11D48');
    expect(cellFontColor('low', priority)).toBe('FF33AABB');
  });

  it('works for radio the same as select', () => {
    const radio: ExportFieldMeta = { ...priority, type: 'radio' };
    expect(cellFontColor('high', radio)).toBe('FFE11D48');
  });

  it('returns undefined when the cell should stay unstyled', () => {
    // No/blank value.
    expect(cellFontColor(null, priority)).toBeUndefined();
    expect(cellFontColor(undefined, priority)).toBeUndefined();
    // Value has no matching option.
    expect(cellFontColor('urgent', priority)).toBeUndefined();
    // Matched option carries no colour.
    const noColor: ExportFieldMeta = { name: 'p', type: 'select', options: [{ label: 'X', value: 'x' }] };
    expect(cellFontColor('x', noColor)).toBeUndefined();
    // Non-option field type is never coloured, even with a hex-looking value.
    const text: ExportFieldMeta = { name: 't', type: 'text' };
    expect(cellFontColor('#e11d48', text)).toBeUndefined();
    // Missing metadata entirely.
    expect(cellFontColor('high', undefined)).toBeUndefined();
    // Multiselect is out of scope (ambiguous single font colour for many values).
    const multi: ExportFieldMeta = { ...priority, type: 'multiselect' };
    expect(cellFontColor('high', multi)).toBeUndefined();
  });
});
