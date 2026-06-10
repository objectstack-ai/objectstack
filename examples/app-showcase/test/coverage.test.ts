// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldType } from '@objectstack/spec/data';
import * as ui from '@objectstack/spec/ui';

import * as objects from '../src/objects/index.js';
import { TaskViews, ProjectViews } from '../src/views/index.js';
import { ChartGalleryDashboard } from '../src/dashboards/index.js';
import { allReports } from '../src/reports/index.js';
import { allActions } from '../src/actions/index.js';
import {
  LIST_VIEW_TYPES,
  FORM_VIEW_TYPES,
  collectFieldTypes,
  collectListViewTypes,
  collectFormViewTypes,
} from '../src/coverage.js';

/** Read the string members of a Zod enum (or a plain array constant). */
function enumValues(schema: unknown): string[] {
  const s = schema as { options?: string[]; _def?: { values?: string[] } };
  if (Array.isArray(schema)) return schema as string[];
  return s?.options ?? s?._def?.values ?? [];
}

/** Assert every member of `expected` appears in `used`, reporting the gap. */
function expectFullCoverage(label: string, expected: string[], used: Set<string>) {
  const missing = expected.filter((v) => !used.has(v));
  expect(missing, `${label}: uncovered → ${missing.join(', ')}`).toEqual([]);
}

const objectList = Object.values(objects);
const views = [TaskViews, ProjectViews];

describe('showcase coverage (introspected against the spec)', () => {
  it('covers every FieldType', () => {
    const expected = enumValues(FieldType);
    expect(expected.length).toBeGreaterThan(40);
    expectFullCoverage('FieldType', expected, collectFieldTypes(objectList as never));
  });

  it('covers every list-view type', () => {
    expectFullCoverage('ListViewType', [...LIST_VIEW_TYPES], collectListViewTypes(views as never));
  });

  it('covers every form-view type', () => {
    expectFullCoverage('FormViewType', [...FORM_VIEW_TYPES], collectFormViewTypes(views as never));
  });

  it('covers every distinctly-renderable ChartType', () => {
    // The fallback-only VARIANTS (grouped/stacked/bi-polar bar, stacked-area,
    // step-line, spline, pyramid, bubble) were removed from `ChartTypeSchema`, so
    // the enum now lists only families that render. The remaining exception is
    // the performance group: `metric` represents the single-value KPI, and
    // `kpi`/`gauge`/`solid-gauge`/`bullet` render the SAME value today (no dial),
    // so the gallery demonstrates `metric` once rather than duplicating them.
    const SAME_AS_METRIC = new Set(['kpi', 'gauge', 'solid-gauge', 'bullet']);
    const expected = enumValues(ui.ChartTypeSchema).filter((t) => !SAME_AS_METRIC.has(t));
    const used = new Set<string>();
    for (const w of ChartGalleryDashboard.widgets ?? []) if (w.type) used.add(w.type);
    expectFullCoverage('ChartType', expected, used);
  });

  it('covers every report type', () => {
    // ADR-0021 single-form: `tabular` (a flat record list) is intentionally NOT
    // demonstrated as a report — a flat list is an object-bound ListView lens
    // (ADR-0017), not an analytics projection, so the former TaskListReport now
    // lives on showcase_task as a `tabular` ListView (see src/reports/index.ts).
    const expected = enumValues((ui as Record<string, unknown>).ReportType ?? (ui as Record<string, unknown>).ReportTypeSchema)
      .filter((t) => t !== 'tabular');
    const used = new Set<string>();
    for (const r of allReports) {
      if (r.type) used.add(r.type);
      for (const b of (r as { blocks?: Array<{ type?: string }> }).blocks ?? []) if (b.type) used.add(b.type);
    }
    expectFullCoverage('ReportType', expected, used);
  });

  it('covers every action type and location', () => {
    const types = enumValues((ui as Record<string, unknown>).ActionType ?? (ui as Record<string, unknown>).ActionTypeSchema);
    const locations = enumValues((ui as Record<string, unknown>).ACTION_LOCATIONS ?? (ui as Record<string, unknown>).ActionLocationSchema);

    const usedTypes = new Set<string>();
    const usedLocations = new Set<string>();
    for (const a of allActions) {
      if (a.type) usedTypes.add(a.type);
      for (const loc of a.locations ?? []) usedLocations.add(loc);
    }
    expectFullCoverage('ActionType', types, usedTypes);
    expectFullCoverage('ActionLocation', locations, usedLocations);
  });
});
