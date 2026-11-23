// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36374 — the two small rules around the report builder's doors:
 * the one-time landing that opens a report's builder on arrival, and the
 * identifier a new report is saved under.
 */

import { describe, expect, it } from 'vitest';
import {
  readReportBuilderArrival,
  reportBuilderArrival,
  withoutReportBuilderArrival,
} from './reportBuilderArrival';
import { newReportName } from './ReportNewPage';

describe('the report builder landing (objectstack#36374)', () => {
  it('opens only the report it names, and is cleared once read', () => {
    const state = { ...reportBuilderArrival('deals_by_stage'), from: 'menu' };
    expect(readReportBuilderArrival(state, 'deals_by_stage')).toBe(true);
    expect(readReportBuilderArrival(state, 'other_report')).toBe(false);
    expect(readReportBuilderArrival(null, 'deals_by_stage')).toBe(false);
    expect(withoutReportBuilderArrival(state)).toEqual({ from: 'menu' });
    expect(withoutReportBuilderArrival(reportBuilderArrival('deals_by_stage'))).toBeNull();
  });
});

describe('a new report\'s identifier (objectstack#36374, newReportName)', () => {
  it('is the name as an identifier, never one a known report holds', () => {
    expect(newReportName('Deals by Stage', new Set())).toBe('deals_by_stage');
    expect(newReportName('Deals by Stage', new Set(['deals_by_stage']))).toBe('deals_by_stage_2');
    expect(newReportName('Deals by Stage', new Set(['deals_by_stage', 'deals_by_stage_2']))).toBe('deals_by_stage_3');
    // A name that gives no identifier still gets one.
    expect(newReportName('', new Set())).toBe('report');
  });
});
