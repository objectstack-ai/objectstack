// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit tests for the xlsx colour helpers on the export path: {@link toArgb}
 * (hex → exceljs ARGB) and {@link cellFontColor} (select/radio option colour
 * for one cell). Both are pure and return `undefined` whenever a cell should
 * stay unstyled, so the export never emits an invalid workbook.
 */

import { describe, it, expect } from 'vitest';
import {
  toArgb,
  cellFontColor,
  exportContentDisposition,
  buildFieldMetaMap,
  type ExportFieldMeta,
} from './export-format';

describe('exportContentDisposition', () => {
  const NOW = new Date(2026, 6, 14, 15, 30, 45); // 2026-07-14 15:30:45 local

  it('uses the localized label in filename* and the API name as ASCII fallback', () => {
    expect(exportContentDisposition('contracts', '合同', 'xlsx', NOW)).toBe(
      `attachment; filename="contracts-20260714-153045.xlsx"; filename*=UTF-8''${encodeURIComponent('合同-20260714-153045.xlsx')}`,
    );
  });

  it('falls back to the API name when no label is available', () => {
    expect(exportContentDisposition('contracts', undefined, 'csv', NOW)).toBe(
      `attachment; filename="contracts-20260714-153045.csv"; filename*=UTF-8''contracts-20260714-153045.csv`,
    );
  });

  it('sanitizes hostile characters in both names', () => {
    const header = exportContentDisposition('a/b', '合 同: v2?', 'csv', NOW);
    expect(header).toContain('filename="a_b-20260714-153045.csv"');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('合 同_ v2-20260714-153045.csv')}`);
  });

  it('percent-encodes RFC 5987 non-attr-chars that encodeURIComponent leaves alone', () => {
    const header = exportContentDisposition('obj', "a'b(c)", 'csv', NOW);
    expect(header).toContain("filename*=UTF-8''a%27b%28c%29-20260714-153045.csv");
  });

  it('zero-pads date and time parts', () => {
    const early = new Date(2026, 0, 5, 9, 8, 7);
    expect(exportContentDisposition('obj', undefined, 'json', early)).toContain(
      'filename="obj-20260105-090807.json"',
    );
  });
});

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

/**
 * `buildFieldMetaMap` builds PRESENTATION metadata only (#6536).
 *
 * The eight constraint keys (`required` / `system` / `readonly` / `hasDefault` /
 * `min` / `max` / `minLength` / `maxLength`) were retired under ADR-0049 once
 * #4633 ruling D (PR #6532) replaced the import dry run's hand-copied pre-check
 * mirror with `DataProtocol.validateData` — the engine reads the object's own
 * schema, so nothing consulted the copies any more.
 *
 * WHY THE ASSERTION IS AN EXACT KEY SET, and not eight `not.toHaveProperty`
 * calls: a removal is only observable as ABSENCE, and absence has no natural
 * red. Pinning the whole set is what gives this test a direction — restore any
 * retired key to the builder and it goes red on an unexpected key, drop a
 * surviving presentation key and it goes red on a missing one. Written as
 * per-key absence checks it could only ever catch the first of those, and it
 * would stay green against a NINTH constraint key added later, which is exactly
 * the drift ADR-0049 is about.
 *
 * Note these are the keys `buildFieldMetaMap` WRITES, so every one is present
 * on every entry even when its value is `undefined` — the builder assigns each
 * unconditionally rather than omitting it.
 */
describe('buildFieldMetaMap — presentation keys only (#6536)', () => {
  const PRESENTATION_KEYS = [
    'displayField', 'label', 'multiple', 'name', 'options', 'reference', 'type',
  ];

  /** One field declaring every retired constraint key alongside the presentation ones. */
  const FIELD = {
    name: 'amount',
    type: 'number',
    label: '金额',
    reference: 'contracts',
    displayField: 'title',
    multiple: false,
    // The eight retired keys — still legal on a field definition, since the
    // ENGINE reads them off the object schema. They must not travel into the
    // export/import metadata copy.
    required: true,
    system: true,
    readonly: true,
    defaultValue: 0, // the input `hasDefault` used to be derived from
    min: 1,
    max: 99,
    minLength: 2,
    maxLength: 20,
  };

  it('stores exactly the presentation keys — object-map `fields` shape', () => {
    const meta = buildFieldMetaMap({ fields: { amount: FIELD } }).get('amount')!;
    expect(Object.keys(meta).sort()).toEqual(PRESENTATION_KEYS);
  });

  it('stores exactly the presentation keys — array `fields` shape', () => {
    const meta = buildFieldMetaMap({ fields: [FIELD] }).get('amount')!;
    expect(Object.keys(meta).sort()).toEqual(PRESENTATION_KEYS);
  });

  it('still carries the presentation values it is built for', () => {
    const meta = buildFieldMetaMap({ fields: { amount: FIELD } }).get('amount')!;
    expect(meta).toEqual({
      name: 'amount',
      type: 'number',
      label: '金额',
      options: undefined,
      reference: 'contracts',
      displayField: 'title',
      multiple: false,
    });
  });
});
