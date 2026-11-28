// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #36835 — the report form's Default Period row (`dateRange.defaultRange`)
 * names every choice. With no options of its own, the select read each stored
 * preset (`this_month`) as the choice's name, in every language.
 *
 *  - The options cover the schema's preset table exactly, in its order, so a
 *    preset added to the table is offered (and named) the day it lands.
 *  - Every option carries a name of its own: non-empty, not the stored value,
 *    and distinct from every other option's.
 *
 * #36949 — the dashboard form's Default Period row had the same defect (its
 * `dateRange` composite declared no children). It now offers the same named
 * options as the report form, from one shared table.
 */

import { describe, it, expect } from 'vitest';

import { reportForm } from './report.metadata-form';
import { dashboardForm } from './dashboard.metadata-form';
import { DATE_RANGE_DEFAULT_RANGES } from './dashboard.zod';

type Option = { label?: unknown; value?: unknown };
type FormField = { field?: string; options?: Option[]; fields?: FormField[] };

function defaultRangeRow(form: { sections?: unknown } = reportForm): FormField {
  for (const section of (form.sections ?? []) as Array<{ fields?: FormField[] }>) {
    for (const f of section.fields ?? []) {
      if (f?.field !== 'dateRange') continue;
      const child = (f.fields ?? []).find((c) => c?.field === 'defaultRange');
      if (child) return child;
    }
  }
  throw new Error('form declares no dateRange.defaultRange row');
}

describe('#36835 — the Default Period row names its choices', () => {
  it('offers exactly the preset table, in its order', () => {
    const values = (defaultRangeRow().options ?? []).map((o) => o.value);
    expect(values).toEqual([...DATE_RANGE_DEFAULT_RANGES]);
  });

  it('every choice carries a name of its own', () => {
    const options = defaultRangeRow().options ?? [];
    expect(options.length).toBeGreaterThan(0);
    for (const { label, value } of options) {
      expect(typeof label, String(value)).toBe('string');
      expect(label as string, String(value)).toMatch(/\S/);
      expect(label, String(value)).not.toBe(value);
    }
    const labels = options.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('#36949 — the dashboard Default Period row names its choices', () => {
  it('declares all three dateRange children, so none drops from the panel', () => {
    const composite = (dashboardForm.sections ?? [])
      .flatMap((s) => (s.fields ?? []) as FormField[])
      .find((f) => f?.field === 'dateRange');
    expect((composite?.fields ?? []).map((c) => c.field)).toEqual(['field', 'defaultRange', 'allowCustomRange']);
  });

  it('offers the report form\'s named options, the preset table in order', () => {
    const options = defaultRangeRow(dashboardForm).options ?? [];
    expect(options.map((o) => o.value)).toEqual([...DATE_RANGE_DEFAULT_RANGES]);
    expect(options).toEqual(defaultRangeRow(reportForm).options);
    for (const { label, value } of options) {
      expect(label as string, String(value)).toMatch(/\S/);
      expect(label, String(value)).not.toBe(value);
    }
  });
});
