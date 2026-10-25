/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8894 — `WidgetConfigPanel`'s measure picker never builds what the
 * widget door refuses.
 *
 * `@objectstack/spec` 17.5.0 refuses a second measure on a metric-family
 * widget (ruling D on the card), and objectui's `DashboardWidgetSchema`
 * re-attaches that check. The picker used to offer a second, third, … measure
 * on a `metric` with no signal, and the author met the refusal at publish.
 * Now it asks the same door (`measureRefusal`):
 *
 *   - one more measure would be refused → the add control is not offered;
 *   - the measures already on the widget are refused (a stored document) →
 *     the door's own message is shown under them at once.
 *
 * ## The family is the SPEC'S, derived at run time — never a list written here
 *
 * As in `packages/types/src/__tests__/dashboard-widget-metric-measure-door-8894.test.ts`:
 * every member of the spec's `ChartTypeSchema` is put through the spec's own
 * `DashboardWidgetSchema` with two measures, and the types refused with a
 * `custom` issue at `values` ARE the family. The rows below move with the spec.
 *
 * A refusal shown in the panel is asserted to EQUAL the spec's message for the
 * same document, read off the spec's own parse: equal text proves the panel
 * surfaces the door's verdict rather than a restatement of it.
 *
 * ## The chart families: objectui#11334
 *
 * The spec's chart measure-arity check (`checkDashboardWidgetChartMeasureArity`,
 * `@objectstack/spec` 17.7.0) puts more types into FAMILY than the metric
 * family: two measures with no `dimensions` on `pie`, `funnel` and the rest.
 * objectui#11717 chained it on objectui's door, and the panel asks that door,
 * so it refuses them with no edit of its own. Until then those types were booked
 * in an `OWED_TO_OBJECTUI_11334` ledger; the ledger is struck, its rows now
 * assert the refusal, and the cap row requires the set the panel fails to
 * refuse to be EMPTY.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import {
  ChartTypeSchema as SpecChartTypeSchema,
  DashboardWidgetSchema as SpecDashboardWidgetSchema,
  checkDashboardWidgetChartMeasureArity,
} from '@objectstack/spec/ui';
import { WidgetConfigPanel } from '../WidgetConfigPanel';
import type { WidgetDatasetCatalogEntry } from '../dataset-catalog';

afterEach(cleanup);

type Issue = { code: string; path: PropertyKey[]; message: string };

const catalog: WidgetDatasetCatalogEntry[] = [
  {
    name: 'sales_pipeline',
    label: 'Sales Pipeline',
    dimensions: [{ name: 'stage' }],
    measures: [
      { name: 'revenue', aggregate: 'sum' },
      { name: 'deal_count', aggregate: 'count' },
      { name: 'margin', aggregate: 'sum' },
    ],
  },
];

const ONE = ['revenue'];
const TWO = ['revenue', 'deal_count'];

/** The spec's arity issue for a widget, read off the spec's own parse, or `undefined`. */
const specArityIssue = (type: string | undefined, values: string[], id = 'sales_tile'): Issue | undefined => {
  const doc = { id, dataset: 'sales_pipeline', ...(type === undefined ? {} : { type }), values };
  const r = SpecDashboardWidgetSchema.safeParse(doc);
  if (r.success) return undefined;
  return (r.error.issues as Issue[]).find((i) => i.code === 'custom' && i.path.map(String).join('.') === 'values');
};

const SPEC_TYPES: readonly string[] = SpecChartTypeSchema.options;
/** The metric family, as the spec's rule draws it. */
const FAMILY = SPEC_TYPES.filter((t) => specArityIssue(t, TWO) !== undefined);
/** Every other spec widget type. */
const OTHERS = SPEC_TYPES.filter((t) => !FAMILY.includes(t));

/**
 * The FAMILY types the spec's chart measure-arity check refuses with no
 * dimension (its dimensionless arm), read by calling the exported check with a
 * collecting context — the types the struck `OWED_TO_OBJECTUI_11334` ledger held.
 */
const DIMENSIONLESS_ARM = FAMILY.filter((type) => {
  const issues: unknown[] = [];
  checkDashboardWidgetChartMeasureArity(
    { id: 'sales_tile', type, values: TWO },
    { addIssue: (issue: unknown) => issues.push(issue) } as unknown as Parameters<typeof checkDashboardWidgetChartMeasureArity>[1],
  );
  return issues.length === 1;
});

const renderPanel = (config: Record<string, unknown>, datasets: WidgetDatasetCatalogEntry[] | undefined = catalog) =>
  render(<WidgetConfigPanel open onClose={vi.fn()} config={config} onSave={vi.fn()} datasets={datasets} />);

const valuesField = () => within(screen.getByTestId('config-field-values'));
/** The add control: the catalog combobox, or the free-text input without a catalog. */
const addControl = () => valuesField().queryByRole('combobox') ?? valuesField().queryByRole('textbox');

describe('objectui#8894 — the family is read off the spec\'s rule, and it is not vacuous', () => {
  it('the spec refuses a second measure on some types and not on others', () => {
    // An empty family would make every `it.each` below run zero rows and pass.
    expect(FAMILY.length).toBeGreaterThan(0);
    expect(OTHERS.length).toBeGreaterThan(0);
    // Triage named this one when it set the picker's pin on the card.
    expect(FAMILY).toContain('kpi');
  });
});

describe('objectui#8894 — no second measure is offered on a metric-family widget', () => {
  it.each(FAMILY)('SUBJECT: `%s` with one measure chosen offers no add control (catalog)', (type) => {
    renderPanel({ id: 'rev_tile', type, dataset: 'sales_pipeline', values: ONE });
    expect(valuesField().getByTestId('dataset-name-chip-revenue')).toBeInTheDocument();
    expect(addControl()).toBeNull();
    // Nothing is refused yet — one measure is the legal tile.
    expect(valuesField().queryByTestId('dataset-names-refusal')).toBeNull();
  });

  it.each(FAMILY)('SUBJECT: `%s` with one measure chosen offers no add control (free text, no catalog)', (type) => {
    renderPanel({ id: 'rev_tile', type, dataset: 'sales_pipeline', values: ONE }, undefined);
    expect(addControl()).toBeNull();
  });

  it.each(FAMILY)('CONTROL: `%s` with NO measure yet still offers the add control — the first one is legal', (type) => {
    renderPanel({ id: 'rev_tile', type, dataset: 'sales_pipeline', values: [] });
    expect(addControl()).not.toBeNull();
  });

  it.each(OTHERS)('CONTROL: `%s` with one measure keeps offering another', (type) => {
    renderPanel({ id: 'rev_tile', type, dataset: 'sales_pipeline', values: ONE });
    expect(addControl()).not.toBeNull();
    expect(valuesField().queryByTestId('dataset-names-refusal')).toBeNull();
  });
});

describe('objectui#8894 — measures the door refuses are reported at once, in the door\'s words', () => {
  it.each(FAMILY)('SUBJECT: a stored `%s` with two measures shows the spec\'s own refusal under them', (type) => {
    renderPanel({ id: 'sales_tile', type, dataset: 'sales_pipeline', values: TWO });
    const shown = valuesField().getByTestId('dataset-names-refusal');
    expect(shown).toHaveAttribute('role', 'alert');
    expect(shown.textContent).toBe(specArityIssue(type, TWO)!.message);
    // Both measures stay on screen — the picker reports, it never drops one
    // for the author — and a third is not offered.
    expect(valuesField().getByTestId('dataset-name-chip-revenue')).toBeInTheDocument();
    expect(valuesField().getByTestId('dataset-name-chip-deal_count')).toBeInTheDocument();
    expect(addControl()).toBeNull();
  });

  it('SUBJECT: a widget with NO type and two measures is refused too — the spec resolves it to its default', () => {
    renderPanel({ id: 'sales_tile', dataset: 'sales_pipeline', values: TWO });
    expect(valuesField().getByTestId('dataset-names-refusal').textContent).toBe(specArityIssue(undefined, TWO)!.message);
  });

  it.each(OTHERS)('CONTROL: `%s` with two measures is not refused, and offers a third', (type) => {
    renderPanel({ id: 'sales_tile', type, dataset: 'sales_pipeline', dimensions: ['stage'], values: TWO });
    expect(valuesField().queryByTestId('dataset-names-refusal')).toBeNull();
    expect(addControl()).not.toBeNull();
  });
});

describe('objectui#11334 — the dimensionless arm: the panel refuses what the door refuses', () => {
  // Formerly the OWED TO objectui#11334 rows, which asserted what the panel did
  // while the door accepted these widgets (the add control offered, no refusal
  // shown). The door refuses them now, so each row asserts the refusal.
  it('the arm is read off the spec\'s check and is not vacuous: it holds `pie`, and not the metric family\'s `kpi`', () => {
    expect(DIMENSIONLESS_ARM).toContain('pie');
    expect(DIMENSIONLESS_ARM).not.toContain('kpi');
  });

  it.each(DIMENSIONLESS_ARM)('`%s` with one measure chosen and no dimension offers no add control (catalog)', (type) => {
    renderPanel({ id: 'rev_tile', type, dataset: 'sales_pipeline', values: ONE });
    expect(valuesField().getByTestId('dataset-name-chip-revenue')).toBeInTheDocument();
    expect(addControl()).toBeNull();
    expect(valuesField().queryByTestId('dataset-names-refusal')).toBeNull();
  });

  it.each(DIMENSIONLESS_ARM)('`%s` with one measure chosen and no dimension offers no add control (free text, no catalog)', (type) => {
    renderPanel({ id: 'rev_tile', type, dataset: 'sales_pipeline', values: ONE }, undefined);
    expect(addControl()).toBeNull();
  });

  it.each(DIMENSIONLESS_ARM)('a stored `%s` with two measures and no dimension shows the spec\'s own refusal under them', (type) => {
    renderPanel({ id: 'sales_tile', type, dataset: 'sales_pipeline', values: TWO });
    const shown = valuesField().getByTestId('dataset-names-refusal');
    expect(shown).toHaveAttribute('role', 'alert');
    expect(shown.textContent).toBe(specArityIssue(type, TWO)!.message);
    expect(valuesField().getByTestId('dataset-name-chip-revenue')).toBeInTheDocument();
    expect(valuesField().getByTestId('dataset-name-chip-deal_count')).toBeInTheDocument();
    expect(addControl()).toBeNull();
  });
});

describe('objectui#11334 — the cap: the panel fails to refuse NO FAMILY type (the struck ledger stays empty)', () => {
  it('every FAMILY type\'s stored two-measure widget shows the spec\'s own refusal', () => {
    const unrefused = FAMILY.filter((type) => {
      const { unmount } = renderPanel({ id: 'sales_tile', type, dataset: 'sales_pipeline', values: TWO });
      const shown = valuesField().queryByTestId('dataset-names-refusal');
      const refused = shown !== null && shown.textContent === specArityIssue(type, TWO)?.message;
      unmount();
      return !refused;
    });
    expect(unrefused).toEqual([]);
  });

  it('the metric family is still judged beside the chart arm: `kpi` is in FAMILY', () => {
    expect(FAMILY).toContain('kpi');
  });
});
