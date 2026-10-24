// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25514 — `widget-dataset-unknown` resolves a widget's `dataset` against the
 * ARTIFACT's `packages[]`, not the one package body it judges.
 *
 * The CLI's per-package pass (`runPerPackageAuthoringRules`) hands each rule
 * one package body re-read as a stack, with the artifact's `packages[]` as
 * resolution context (`packageBodyAsStack`). An app-package dashboard binding a
 * dataset a module package owns was refused there — measured on HotCRM's
 * module split as `dataset "product_metrics" does not resolve to a declared
 * dataset.` while the composed artifact carried the dataset.
 *
 * Both directions are pinned: a sibling-provided dataset is accepted (and its
 * dimensions / measures are then judged like a local one), and a name no
 * package provides is refused exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { runAuthoringRules } from './authoring-rules.js';
import { validateWidgetBindings, WIDGET_DATASET_UNKNOWN, WIDGET_MEASURE_UNKNOWN } from './validate-widget-bindings.js';

const revenueBody = {
  id: 'app.objectstack.hotcrm.revenue',
  name: 'revenue',
  objects: [{ name: 'crm_product', fields: { name: { type: 'text' }, price: { type: 'currency' } } }],
  datasets: [{
    name: 'product_metrics',
    label: 'Product metrics',
    object: 'crm_product',
    measures: [{ name: 'product_count', label: 'Products', aggregate: 'count' }],
    dimensions: [{ name: 'name', field: 'name' }],
  }],
};

const appBody = (dataset: string, values: string[] = ['product_count']) => ({
  id: 'app.objectstack.hotcrm',
  name: 'hotcrm',
  dashboards: [{
    name: 'crm_overview_dashboard',
    label: 'CRM Overview',
    widgets: [{
      id: 'top_products',
      type: 'table',
      dataset,
      dimensions: ['name'],
      values,
      layout: { x: 0, y: 0, w: 6, h: 4 },
    }],
  }],
});

/** `packageBodyAsStack`'s shape: the body, its own manifest, the artifact's entries. */
const asPackageStack = (body: Record<string, unknown>, siblings: Record<string, unknown>[]) => ({
  ...body,
  manifest: body,
  packages: [body, ...siblings].map((manifest) => ({ manifest })),
});

const datasetUnknown = (stack: Record<string, unknown>) =>
  validateWidgetBindings(stack).filter((f) => f.rule === WIDGET_DATASET_UNKNOWN);

describe('widget-dataset-unknown — the artifact resolves a sibling package’s dataset', () => {
  it('ACCEPTS an app widget bound to a dataset the module package owns', () => {
    expect(datasetUnknown(asPackageStack(appBody('product_metrics'), [revenueBody]))).toEqual([]);
  });

  it('still REFUSES a dataset NO package of the artifact declares', () => {
    const findings = datasetUnknown(asPackageStack(appBody('product_nowhere'), [revenueBody]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      where: 'dashboard "crm_overview_dashboard" › widget "top_products"',
    });
  });

  it('REFUSES the sibling dataset when judged WITHOUT the artifact — the unchanged single-package answer', () => {
    expect(datasetUnknown(appBody('product_metrics'))).toHaveLength(1);
  });

  it('judges the resolved sibling dataset’s measures like a local one', () => {
    const findings = validateWidgetBindings(asPackageStack(appBody('product_metrics', ['revenue_sum']), [revenueBody]));
    expect(findings.map((f) => f.rule)).toContain(WIDGET_MEASURE_UNKNOWN);
  });

  it('does not judge a sibling’s dataset-level conditions on this package’s pass', () => {
    const incoherent = {
      ...revenueBody,
      datasets: [{
        ...revenueBody.datasets[0],
        measures: [{ name: 'price_total', label: 'Total', aggregate: 'sum', field: 'price' }],
      }],
    };
    const findings = validateWidgetBindings(asPackageStack(appBody('product_metrics', ['price_total']), [incoherent]));
    expect(findings.filter((f) => f.path.startsWith('datasets['))).toEqual([]);
  });

  it('reaches the rule table the per-package pass runs', () => {
    const stack = asPackageStack(appBody('product_metrics'), [revenueBody]);
    const findings = runAuthoringRules('validate', { normalized: stack, parsed: stack });
    expect(findings.filter((f) => f.rule === WIDGET_DATASET_UNKNOWN)).toEqual([]);
    const dangling = asPackageStack(appBody('product_nowhere'), [revenueBody]);
    expect(
      runAuthoringRules('validate', { normalized: dangling, parsed: dangling }).filter((f) => f.rule === WIDGET_DATASET_UNKNOWN),
    ).toHaveLength(1);
  });
});
