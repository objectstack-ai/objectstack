// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { inferFormulaReturn } from '@objectstack/formula';

import { Account, ExpenseReport, Project } from '../src/data/objects/index.js';
import { ShowcaseProjectDataset } from '../src/ui/datasets/index.js';
import { CommandCenterPage } from '../src/ui/pages/index.js';
import { OpsDashboard } from '../src/ui/dashboards/index.js';

/**
 * The showcase writes money one way.
 *
 * Every declaration this pins is display metadata the renderer already reads,
 * so leaving one out raises nothing at `os validate` or at boot: the column
 * just reads differently from the one beside it. The four readings it guards
 * against:
 *
 *  - the expense report roll-ups summed at their natural precision, so one
 *    column read `225.75`, `917` and `1,500.5` — they declare `scale: 2`;
 *  - `showcase_project.budget` had no currency and read `200,000.00` beside
 *    Accounts' `US$12,000,000.00` — it declares the same fixed currency;
 *  - `budget_remaining`, a formula over two amounts, read as a plain number
 *    (`200,000`) — it declares a currency result;
 *  - the Command Center KPI wrote the total budget as `109万` and Delivery
 *    Operations wrote the same sum as `1,090,000` — both write it with one
 *    pattern and one currency.
 */

type AnyRec = Record<string, unknown>;
const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

const fields = (o: unknown): Record<string, AnyRec> => (o as { fields: Record<string, AnyRec> }).fields;

const USD_FIXED = { currencyMode: 'fixed', defaultCurrency: 'USD' };

/** The node with this `id`, at any depth. */
function nodeById(root: unknown, id: string): AnyRec | undefined {
  let found: AnyRec | undefined;
  const visit = (v: unknown): void => {
    if (found) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (!isRec(v)) return;
    if (v.id === id) {
      found = v;
      return;
    }
    for (const child of Object.values(v)) visit(child);
  };
  visit(root);
  return found;
}

describe('showcase money declarations', () => {
  it('the expense report money roll-ups declare two decimals', () => {
    const f = fields(ExpenseReport);
    for (const name of ['total_amount', 'approved_amount', 'reimbursable_amount']) {
      expect(f[name]?.type, name).toBe('summary');
      expect(f[name]?.scale, `${name}.scale`).toBe(2);
    }
  });

  it('project budget and spent carry the fixed currency Accounts uses', () => {
    const revenue = fields(Account).annual_revenue?.currencyConfig;
    expect(revenue).toEqual(USD_FIXED);
    const f = fields(Project);
    expect(f.budget?.currencyConfig).toEqual(revenue);
    expect(f.spent?.currencyConfig).toEqual(revenue);
  });

  it('budget_remaining declares a currency result, rounded to cents', () => {
    const remaining = fields(Project).budget_remaining;
    expect(remaining?.type).toBe('formula');
    expect(remaining?.returnType).toBe('currency');
    expect(remaining?.currencyConfig).toEqual(USD_FIXED);
    expect(remaining?.scale).toBe(2);
  });

  it('the currency result is the one authoring would stamp for its expression', () => {
    const f = fields(Project);
    const remaining = f.budget_remaining!;
    expect(inferFormulaReturn(remaining.expression as never, f as never)).toEqual({
      returnType: remaining.returnType,
      currencyConfig: remaining.currencyConfig,
    });
  });

  it('both dashboards write the total budget with one format and one currency', () => {
    const tile = nodeById(CommandCenterPage.regions, 'cc_k6');
    const props = (tile?.properties ?? {}) as AnyRec;
    expect(tile?.type).toBe('object-metric');
    expect(props.aggregate).toEqual({ field: 'budget', function: 'sum' });

    const widget = (OpsDashboard.widgets as AnyRec[]).find((w) => w.id === 'kpi_total_budget');
    expect(widget?.values).toEqual(['budget_sum']);
    const measure = ShowcaseProjectDataset.measures.find((m) => m.name === 'budget_sum');
    expect(measure).toMatchObject({ aggregate: 'sum', field: 'budget' });

    // The dataset-bound tile takes its currency from the measure, else from
    // the aggregated field's fixed currency; the object-metric tile from its
    // own `currency` only.
    const datasetCurrency = measure?.currency ?? (fields(Project).budget?.currencyConfig as AnyRec | undefined)?.defaultCurrency;

    expect(props.format).toBeDefined();
    expect(props.format).toBe(measure?.format);
    expect(props.currency).toBeDefined();
    expect(props.currency).toBe(datasetCurrency);
  });
});
