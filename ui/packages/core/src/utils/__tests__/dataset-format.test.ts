import { describe, it, expect } from 'vitest';
import {
  formatMeasure,
  formatDimensionValue,
  buildDatasetFieldHelpers,
  type DatasetResultField,
} from '../dataset-format';

describe('formatMeasure', () => {
  it('renders null as an em dash and passes non-numbers through', () => {
    expect(formatMeasure(null)).toBe('—');
    expect(formatMeasure(undefined)).toBe('—');
    expect(formatMeasure('n/a')).toBe('n/a');
  });

  it('formats a plain number with no currency and no misleading $', () => {
    expect(formatMeasure(1234, '0,0')).toBe('1,234');
    // No format hint → integers render verbatim (the documented plain path).
    expect(formatMeasure(1234)).toBe('1234');
    expect(formatMeasure(1234, '0,0')).not.toContain('$');
  });

  it('uses the declared currency via Intl (CNY → ¥ family, never bare/wrong)', () => {
    const out = formatMeasure(1234, '0,0', 'CNY');
    expect(out).toMatch(/[¥￥]|CN¥/);
    expect(out).toContain('1,234');
  });

  it('honors a legacy $ literal in the format string when there is no currency', () => {
    expect(formatMeasure(1000, '$0,0')).toBe('$1,000');
  });

  it('applies percent and decimal hints', () => {
    // Whole-percent storage passes through unchanged. It is the server's
    // annotation that says so (objectui#11475): an unannotated `%` pattern
    // reads a fraction, numeral's reading, and no longer guesses from size.
    expect(formatMeasure(50, '0%', undefined, 'whole')).toBe('50%');
    expect(formatMeasure(12.5, '0.0')).toBe('12.5');
  });

  it('scales fraction-stored percents to display magnitude (×100), matching the list cell', () => {
    // Percent fields store a FRACTION (0.75 ⇒ 75%); the list-view cell renderer
    // multiplies by 100, so the dataset measure formatter must too — otherwise a
    // metric card shows "0.6%" for an avg of 0.608 instead of "60.8%" (the bug).
    expect(formatMeasure(0.75, '0%')).toBe('75%');
    expect(formatMeasure(0.608_333_333, '0.0%')).toBe('60.8%');
    // Boundary: exactly 0 and exactly 1 (100% stored as 1.0). Until
    // objectui#11475 an unannotated 1.0 passed through as "1%", mirroring the
    // list renderer's strict `< 1` guess. Neither guesses now: the `%` pattern
    // states a fraction, so 1.0 is 100%.
    expect(formatMeasure(0, '0%')).toBe('0%');
    expect(formatMeasure(1, '0%')).toBe('100%');
  });

  it('honors a DECLARED percent scale over the value-magnitude heuristic (#3136)', () => {
    // The bug: a ratio of exactly 1 (full compliance) is indistinguishable from
    // 1 percentage point by magnitude alone, and the heuristic resolves it the
    // wrong way — "everything met the SLA" reads as "1% met the SLA". The
    // server now says which scale the column is on, and that wins.
    expect(formatMeasure(1, '0.0%', undefined, 'fraction')).toBe('100.0%');
    expect(formatMeasure(0.6667, '0.0%', undefined, 'fraction')).toBe('66.7%');
    expect(formatMeasure(0, '0.0%', undefined, 'fraction')).toBe('0.0%');
    // Whole-percent storage is the other half of the same ambiguity: a declared
    // `whole` column renders 1 as "1%" and is NOT scaled up, even though the
    // heuristic would have multiplied a sub-1 value by 100.
    expect(formatMeasure(1, '0.0%', undefined, 'whole')).toBe('1.0%');
    expect(formatMeasure(0.5, '0.0%', undefined, 'whole')).toBe('0.5%');
    expect(formatMeasure(80, '0.0%', undefined, 'whole')).toBe('80.0%');
    // Non-percent formats ignore the annotation entirely — it describes the
    // percentage scale, not a general multiplier.
    expect(formatMeasure(1, '0.0', undefined, 'fraction')).toBe('1.0');
  });

  it('falls back to plain formatting for an unknown currency code', () => {
    expect(formatMeasure(1234, '0,0', 'NOTACODE')).toBe('1,234');
  });
});

describe('formatDimensionValue', () => {
  it('tidies nulls and integers, leaves strings intact', () => {
    expect(formatDimensionValue(null)).toBe('—');
    expect(formatDimensionValue(42)).toBe('42');
    expect(formatDimensionValue('Backlog')).toBe('Backlog');
  });
});

describe('buildDatasetFieldHelpers', () => {
  const fields: DatasetResultField[] = [
    { name: 'status', type: 'string', label: 'Stage' },
    { name: 'amount', type: 'number', label: 'Amount', format: '0,0', currency: 'USD' },
  ];

  it('headerLabel: field label → i18n fieldLabel → raw name', () => {
    const fieldLabel = (_o: string, _f: string, fb: string) => `i18n:${fb}`;
    const { headerLabel } = buildDatasetFieldHelpers(fields, 'deal', fieldLabel);
    // i18n hook wraps the field label fallback.
    expect(headerLabel('status')).toBe('i18n:Stage');
    // unknown field → raw name flows through the i18n layer.
    expect(headerLabel('missing')).toBe('i18n:missing');
  });

  it('headerLabel falls back to field label when no object/fieldLabel given', () => {
    const { headerLabel } = buildDatasetFieldHelpers(fields, undefined);
    expect(headerLabel('amount')).toBe('Amount');
    expect(headerLabel('missing')).toBe('missing');
  });

  it('measureField exposes format/currency', () => {
    const { measureField } = buildDatasetFieldHelpers(fields, 'deal');
    expect(measureField('amount')?.format).toBe('0,0');
    expect(measureField('amount')?.currency).toBe('USD');
    expect(measureField('nope')).toBeUndefined();
  });
});
