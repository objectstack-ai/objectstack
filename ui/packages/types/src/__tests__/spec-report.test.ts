/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Tests for the Spec Report bridge (spec 9.0, dataset-bound — ADR-0021):
 * - Re-exports compile and match the spec shape.
 * - Aggregate mapping handles the `unique → count_distinct` translation.
 * - The presentation adapter maps the dataset `rows` / `values` names through.
 */

import { describe, it, expect } from 'vitest';
import {
  SpecReport,
  SpecReportSchema,
  mapAggregateToQL,
  specReportToPresentation,
  isSpecReport,
} from '../spec-report';
import type { SpecReportInput } from '../spec-report';

describe('SpecReport bridge', () => {
  describe('mapAggregateToQL', () => {
    it('translates unique to count_distinct', () => {
      expect(mapAggregateToQL('unique')).toBe('count_distinct');
    });

    it('passes through standard aggregates', () => {
      expect(mapAggregateToQL('sum')).toBe('sum');
      expect(mapAggregateToQL('avg')).toBe('avg');
      expect(mapAggregateToQL('min')).toBe('min');
      expect(mapAggregateToQL('max')).toBe('max');
      expect(mapAggregateToQL('count')).toBe('count');
    });
  });

  describe('SpecReportSchema parsing', () => {
    it('accepts a minimal tabular report (dataset + values)', () => {
      const input: SpecReportInput = {
        name: 'sales_dump',
        label: 'Sales Dump',
        dataset: 'opportunity_ds',
        values: ['name', 'amount'],
      };
      const parsed = SpecReport.create(input);
      expect(parsed.name).toBe('sales_dump');
      expect(parsed.type).toBe('tabular'); // default
      expect(parsed.values).toHaveLength(2);
    });

    it('accepts a summary report with rows (dimensions) + values (measures)', () => {
      const input: SpecReportInput = {
        name: 'sales_by_owner',
        label: 'Sales by Owner',
        dataset: 'opportunity_ds',
        type: 'summary',
        rows: ['owner_id'],
        values: ['amount_sum', 'account_count'],
      };
      const parsed = SpecReportSchema.parse(input);
      expect(parsed.type).toBe('summary');
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.values).toEqual(['amount_sum', 'account_count']);
    });
  });

  describe('specReportToPresentation adapter', () => {
    it('extracts the report-level label/description and maps value names to fields', () => {
      const report = SpecReport.create({
        name: 'demo',
        label: 'Demo Report',
        description: 'A short description',
        dataset: 'lead_ds',
        values: ['email'],
      });
      const legacy = specReportToPresentation(report);
      expect(legacy.type).toBe('report');
      expect(legacy.title).toBe('Demo Report');
      expect(legacy.description).toBe('A short description');
      expect(legacy.fields?.[0].name).toBe('email');
    });

    it('writes no `reportType` — the key is retired and nothing read it (objectui#6152)', () => {
      // The adapter used to write the spec `type` as `reportType` (collapsing `joined`
      // to `tabular`). No reader existed, so the key was retired on both faces of
      // `ReportComponentSchema` and this write was removed with it.
      const report = SpecReport.create({
        name: 'joined_demo',
        label: 'Joined',
        type: 'joined',
        blocks: [{ name: 'b1', label: 'Block 1', dataset: 'account_ds', values: ['name'] }],
      } as never);
      const legacy = specReportToPresentation(report);
      expect('reportType' in legacy).toBe(false);
      // Lit control: the same conversion still writes the keys the viewer reads.
      expect(legacy.title).toBe('Joined');
    });

    it('maps a matrix report\'s rows to groupBy', () => {
      const report = SpecReport.create({
        name: 'matrix_demo',
        label: 'Matrix',
        dataset: 'opportunity_ds',
        type: 'matrix',
        rows: ['region'],
        values: ['amount_sum'],
      });
      const legacy = specReportToPresentation(report);
      expect('reportType' in legacy).toBe(false);
      expect(legacy.groupBy?.[0].field).toBe('region');
    });

    it('omits groupBy when no rows present', () => {
      const report = SpecReport.create({
        name: 'plain',
        label: 'Plain',
        dataset: 'account_ds',
        values: ['name'],
      });
      const legacy = specReportToPresentation(report);
      expect(legacy.groupBy).toBeUndefined();
    });
  });

  describe('isSpecReport type guard', () => {
    it('recognises a dataset-bound spec report', () => {
      const report = SpecReport.create({
        name: 'r1',
        label: 'Report A',
        dataset: 'account_ds',
        values: ['name'],
      });
      expect(isSpecReport(report)).toBe(true);
    });

    it('rejects a legacy presentation report', () => {
      const legacy = {
        type: 'report',
        title: 'Old',
        fields: [{ name: 'x' }],
      };
      expect(isSpecReport(legacy)).toBe(false);
    });

    it('rejects random objects', () => {
      expect(isSpecReport(null)).toBe(false);
      expect(isSpecReport(undefined)).toBe(false);
      expect(isSpecReport({})).toBe(false);
      expect(isSpecReport('string')).toBe(false);
    });
  });
});
