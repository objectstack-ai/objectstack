// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import * as datasets from '../src/ui/datasets/index.js';
import { allReports } from '../src/ui/reports/index.js';

/**
 * A report's `description` is the subtitle the console renders under its
 * title; its cells are the measures `values` binds. The two must name the same
 * quantity. The Status × Priority matrix shipped "Task counts cross-tabulated
 * by status and priority." over `values: ['est_hours']` — a `sum` of
 * `estimate_hours` — so a reader trusting the subtitle took a cell reading
 * 60.0 for sixty tasks when it held one task's estimated hours (#23931).
 *
 * Graded against the bound DATASET's own declarations, never against a copy of
 * the subtitle text:
 *
 * - a bound measure is named by its declared `label` — the name the cell's
 *   header shows — and a `count` measure may also be named in count words;
 * - the converse is the defect as shipped: count words in a subtitle whose
 *   bound measures count nothing.
 *
 * Joined reports bind their measures per block and carry no top-level
 * `values`, so their subtitle names no single quantity; they are out of scope
 * by construction, not by a skip.
 */

type Measure = { name: string; label?: unknown; aggregate?: string };

const MEASURES_BY_DATASET = new Map<string, readonly Measure[]>(
  Object.values(datasets).map((d) => [d.name, d.measures as readonly Measure[]]),
);

/** The words a subtitle uses to say its cells are counts. */
const COUNT_WORDS = /\b(counts?|number of)\b/i;

/** The plain-string copy this pin knows how to read; an inline locale map is reported, not guessed. */
function plain(value: unknown, what: string): string {
  expect(typeof value, `${what} must be a plain string for this pin to read it`).toBe('string');
  return value as string;
}

function boundMeasures(report: (typeof allReports)[number]): Measure[] {
  const measures = MEASURES_BY_DATASET.get(report.dataset ?? '');
  expect(measures, `${report.name}: dataset '${report.dataset}' is not a showcase dataset`).toBeDefined();
  return (report.values ?? []).map((name) => {
    const measure = measures!.find((m) => m.name === name);
    expect(measure, `${report.name}: measure '${name}' is not declared on '${report.dataset}'`).toBeDefined();
    return measure!;
  });
}

const graded = allReports
  .filter((r) => r.description !== undefined && (r.values?.length ?? 0) > 0)
  .map((r) => [r.name, r] as const);

describe('showcase reports — the subtitle names what the cells hold', () => {
  it('grades the Status × Priority matrix, among the measure-bound reports', () => {
    expect(graded.map(([name]) => name)).toContain('showcase_status_priority_matrix');
  });

  it.each(graded)('%s: the description names a bound measure', (name, report) => {
    const description = plain(report.description, `${name}.description`).toLowerCase();
    const named = boundMeasures(report).filter((m) => {
      const label = plain(m.label, `measure ${m.name}.label`).toLowerCase();
      return description.includes(label) || (m.aggregate === 'count' && COUNT_WORDS.test(description));
    });
    expect(
      named.map((m) => m.name),
      `${name}: "${report.description}" names none of its bound measures ${JSON.stringify(report.values)}`,
    ).not.toEqual([]);
  });

  it.each(graded)('%s: the description claims no count its cells do not hold', (name, report) => {
    const description = plain(report.description, `${name}.description`);
    const bindsACount = boundMeasures(report).some((m) => m.aggregate === 'count');
    const countWord = description.match(COUNT_WORDS)?.[0];
    expect(
      countWord === undefined || bindsACount,
      `${name}: "${description}" says "${countWord}", but ${JSON.stringify(report.values)} aggregate no count`,
    ).toBe(true);
  });
});
