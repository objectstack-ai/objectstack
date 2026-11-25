// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37053 — the value-format carrier is written in two places, and
 * this pin keeps them in step.
 *
 * The report chart (`DatasetReportRenderer`) and the dashboard widget
 * (`plugin-dashboard`'s `DatasetWidget`) each build a chart series'
 * `measureFormat` from the measure's result field with `measureFormatCarrier`.
 * Its shared home would be `@object-ui/core`, beside `buildChartSeries`' own
 * `aggregate` copy, which the change that wrote it could not edit, so each
 * producer carries a copy. Two copies that drift would draw one measure's axis
 * two ways on two surfaces.
 *
 * Two halves:
 *  - the TEXT: the dashboard's copy is byte-identical to this package's, read
 *    from source (this package does not depend on `plugin-dashboard`, so it
 *    cannot import it);
 *  - the BEHAVIOUR: this package's copy, over the field shapes the producers
 *    meet, answers the carrier the chart reads. With the text equal, the
 *    dashboard's copy answers the same carrier for the same field.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { measureFormatCarrier } from '../DatasetReportRenderer';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_SOURCE = resolve(HERE, '../DatasetReportRenderer.tsx');
const DASHBOARD_SOURCE = resolve(HERE, '../../../plugin-dashboard/src/DatasetWidget.tsx');

/** The `measureFormatCarrier` declaration in one source file, signature to closing brace. */
function carrierSource(path: string): string {
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf('export function measureFormatCarrier(');
  expect(start, `${path} declares no exported measureFormatCarrier`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n}\n', start);
  expect(end, `${path}: measureFormatCarrier has no closing brace at column 0`).toBeGreaterThan(start);
  return text.slice(start, end + 2);
}

describe('objectstack#37053 — the report and dashboard carriers stay in step', () => {
  it('the dashboard widget’s copy is byte-identical to the report’s', () => {
    const report = carrierSource(REPORT_SOURCE);
    // A floor, so a slice that caught nothing cannot pass by comparing two empties.
    expect(report).toContain('measureCellCurrency(field)');
    expect(carrierSource(DASHBOARD_SOURCE)).toBe(report);
  });

  it.each([
    ['a whole-scale percent', { name: 'm', type: 'number', format: '0.0%', percentScale: 'whole' }, { format: '0.0%', percentScale: 'whole' }],
    ['a fraction-scale percent', { name: 'm', type: 'number', format: '0.0%', percentScale: 'fraction' }, { format: '0.0%', percentScale: 'fraction' }],
    ['a fixed currency', { name: 'm', type: 'number', format: '0,0.00', currency: 'CNY' }, { format: '0,0.00', currency: 'CNY' }],
    ['a per-row currency: no single currency', { name: 'm', type: 'number', format: '0,0.00', currency: 'CNY', currencyField: 'code' }, { format: '0,0.00' }],
    ['an empty pattern is no pattern', { name: 'm', type: 'number', format: '', currency: 'USD' }, { currency: 'USD' }],
    ['no facts at all', { name: 'm', type: 'number' }, undefined],
  ])('%s → the carrier the chart reads', (_what, field, carrier) => {
    expect(measureFormatCarrier(field as never)).toEqual(carrier);
  });

  it('no field, no carrier', () => {
    expect(measureFormatCarrier(undefined)).toBeUndefined();
  });
});
