// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25514, #32929 — `widget-dataset-unknown` resolves a widget's `dataset`
 * against the artifact's `packages[]` the way the runtime resolves it: the
 * judged package's own datasets, then the packages its manifest DECLARES in
 * `dependencies` (transitively), ADR-0150 D3.
 *
 * The CLI's per-package pass (`runPerPackageAuthoringRules`) hands each rule
 * one package body re-read as a stack, with the artifact's `packages[]` as
 * resolution context (`packageBodyAsStack`). #25514 made every body of the
 * artifact context, so HotCRM's app-package dashboard bound to the revenue
 * module's `product_metrics` passed `os validate` — and, once installed,
 * answered `409 RESOURCE_CONFLICT` (outside-closure) on the dataset door
 * (#32929). The maintainer ruled option two on #32929: the rule stays the
 * declared closure (N1, 6729820123; ADR-0150 D3 (c): the artifact is the
 * co-ownership boundary, not a resolution scope), and authoring refuses what
 * the runtime refuses. Where the holder already depends on the reader, the fix
 * the refusal names is the move, never the dependency (a cycle).
 *
 * BASE (main 2c98485d, before this change): the HotCRM-shaped binding below
 * produced no finding.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from '@objectstack/spec';
import { runAuthoringRules } from './authoring-rules.js';
import { validateWidgetBindings, WIDGET_DATASET_UNKNOWN, WIDGET_MEASURE_UNKNOWN } from './validate-widget-bindings.js';

const APP = 'app.objectstack.hotcrm';
const REVENUE = 'app.objectstack.hotcrm.revenue';

/** HotCRM's module: it depends on the app package, as every module of a suite does. */
const revenueBody: Record<string, unknown> & { datasets: Array<Record<string, unknown>> } = {
  id: REVENUE,
  name: 'revenue',
  dependencies: { [APP]: '^1.0.0' },
  objects: [{ name: 'crm_product', fields: { name: { type: 'text' }, price: { type: 'currency' } } }],
  datasets: [{
    name: 'product_metrics',
    label: 'Product metrics',
    object: 'crm_product',
    measures: [{ name: 'product_count', label: 'Products', aggregate: 'count' }],
    dimensions: [{ name: 'name', field: 'name' }],
  }],
};

const appBody = (dataset: string, values: string[] = ['product_count'], extra: Record<string, unknown> = {}) => ({
  id: APP,
  name: 'hotcrm',
  ...extra,
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

/** A package the app declares, holding a dataset of its own: the closure's control. */
const libraryBody = {
  id: 'com.example.library',
  name: 'library',
  objects: [{ name: 'lib_book', fields: { name: { type: 'text' } } }],
  datasets: [{
    name: 'book_metrics',
    label: 'Book metrics',
    object: 'lib_book',
    measures: [{ name: 'book_count', label: 'Books', aggregate: 'count' }],
    dimensions: [{ name: 'name', field: 'name' }],
  }],
};
const appOnLibrary = (dataset: string, values: string[]) =>
  appBody(dataset, values, { dependencies: { 'com.example.library': '^1.0.0' } });

describe('widget-dataset-unknown — a sibling package’s dataset resolves through the declared closure (#32929)', () => {
  it('REFUSES the app widget bound to the dataset its module holds, naming the move (the module depends on the app)', () => {
    const findings = datasetUnknown(asPackageStack(appBody('product_metrics'), [revenueBody]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      where: 'dashboard "crm_overview_dashboard" › widget "top_products"',
    });
    expect(findings[0].message).toContain('outside the declared dependency closure');
    expect(findings[0].message).toContain(`"${REVENUE}"`);
    expect(findings[0].message).toContain(`"${APP}"`);
    // The arm: the holder already depends on the reader, so the fix is a move, never the dependency.
    expect(findings[0].hint).toContain('dependency cycle');
    expect(findings[0].hint).not.toContain('Declare');
  });

  it('names the dependency when the holder does not depend on the reader', () => {
    const unrelated = { ...revenueBody, dependencies: undefined };
    const [finding] = datasetUnknown(asPackageStack(appBody('product_metrics'), [unrelated]));
    expect(finding.message).toContain('outside the declared dependency closure');
    expect(finding.hint).toContain(`add "${REVENUE}" to the \`dependencies\` of package "${APP}"`);
    expect(finding.hint).not.toContain('cycle');
  });

  it('two holders outside the closure: both named, and the dependency asked for is ONE of them', () => {
    const second = { ...libraryBody, id: 'com.example.second', datasets: [{ ...revenueBody.datasets[0] }] };
    const unrelated = { ...revenueBody, dependencies: undefined };
    const [finding] = datasetUnknown(asPackageStack(appBody('product_metrics'), [unrelated, second]));
    expect(finding.message).toContain(`"${REVENUE}", "com.example.second"`);
    expect(finding.hint).toContain('the one package');
    expect(finding.hint).toContain('more than one leaves the name ambiguous');
  });

  it('REFUSES a name two packages of the closure hold, naming both: nothing picks one (red line 2)', () => {
    const second = { ...libraryBody, id: 'com.example.second', datasets: [{ ...libraryBody.datasets[0] }] };
    const app = appBody('book_metrics', ['book_count'], {
      dependencies: { 'com.example.library': '^1.0.0', 'com.example.second': '^1.0.0' },
    });
    const findings = datasetUnknown(asPackageStack(app, [libraryBody, second]));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('in the declared dependency closure');
    expect(findings[0].message).toContain('"com.example.library", "com.example.second"');
  });

  it('the judged package’s own dataset wins a name a package of its closure also holds (ADR-0150 D3 step 1)', () => {
    const app = { ...appOnLibrary('book_metrics', ['book_count']), objects: libraryBody.objects, datasets: libraryBody.datasets };
    expect(datasetUnknown(asPackageStack(app, [libraryBody]))).toEqual([]);
  });

  it('CONTROL: the same dashboard in the module resolves the module’s own dataset', () => {
    const moduleDashboard = { ...revenueBody, dashboards: appBody('product_metrics').dashboards };
    const app = { id: APP, name: 'hotcrm' };
    expect(datasetUnknown(asPackageStack(moduleDashboard, [app]))).toEqual([]);
  });

  it('CONTROL: a module widget resolves the app’s dataset, which it depends on', () => {
    const app = { ...appBody('product_metrics'), dashboards: undefined, objects: revenueBody.objects, datasets: revenueBody.datasets };
    const module = { id: REVENUE, name: 'revenue', dependencies: { [APP]: '^1.0.0' }, dashboards: appBody('product_metrics').dashboards };
    expect(datasetUnknown(asPackageStack(module, [app]))).toEqual([]);
  });

  it('ACCEPTS an app widget bound to a dataset of a package the app declares', () => {
    expect(datasetUnknown(asPackageStack(appOnLibrary('book_metrics', ['book_count']), [libraryBody]))).toEqual([]);
  });

  it('REPORTS, not refuses, when the reader declares a dependency the artifact does not carry (S1)', () => {
    const app = appBody('product_metrics', ['product_count'], { dependencies: { 'com.example.elsewhere': '^1.0.0' } });
    const findings = datasetUnknown(asPackageStack(app, [revenueBody]));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('not judged: it may come from "com.example.elsewhere", a dependency this artifact does not carry');
    // Nothing is said about what the installed read answers: the outside package may serve it.
    expect(findings[0].message).not.toContain('409');
    expect(findings[0].hint).toContain('If that package holds "product_metrics", nothing is wrong. Otherwise:');
    expect(findings[0].hint).toContain('dependency cycle');
    // The suppression a warning takes is open to the author once the outside package is confirmed.
    const suppressed = appBody('product_metrics', ['product_count'], { dependencies: { 'com.example.elsewhere': '^1.0.0' } });
    (suppressed.dashboards[0].widgets[0] as Record<string, unknown>).suppressWarnings = [WIDGET_DATASET_UNKNOWN];
    expect(datasetUnknown(asPackageStack(suppressed, [revenueBody]))).toEqual([]);
  });

  it('an outside dependency never softens an ambiguity: two holders inside the closure stay refused (S1)', () => {
    const second = { ...libraryBody, id: 'com.example.second', datasets: [{ ...libraryBody.datasets[0] }] };
    const app = appBody('book_metrics', ['book_count'], {
      dependencies: { 'com.example.library': '^1.0.0', 'com.example.second': '^1.0.0', 'com.example.elsewhere': '^1.0.0' },
    });
    const findings = datasetUnknown(asPackageStack(app, [libraryBody, second]));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('in the declared dependency closure');
  });

  it('still REFUSES a dataset NO package of the artifact declares, as before', () => {
    const findings = datasetUnknown(asPackageStack(appBody('product_nowhere'), [revenueBody]));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('dataset "product_nowhere" does not resolve to a declared dataset.');
  });

  it('REFUSES the sibling dataset when judged WITHOUT the artifact — the unchanged single-package answer', () => {
    expect(datasetUnknown(appBody('product_metrics'))).toHaveLength(1);
  });

  it('judges a resolved dependency’s dataset measures like a local one', () => {
    const findings = validateWidgetBindings(asPackageStack(appOnLibrary('book_metrics', ['book_sum']), [libraryBody]));
    expect(findings.map((f) => f.rule)).toContain(WIDGET_MEASURE_UNKNOWN);
  });

  it('does not judge a dependency’s dataset-level conditions on this package’s pass', () => {
    const incoherent = {
      ...libraryBody,
      objects: [{ name: 'lib_book', fields: { name: { type: 'text' }, rate: { type: 'percent' } } }],
      datasets: [{
        ...libraryBody.datasets[0],
        measures: [{ name: 'rate_total', label: 'Total', aggregate: 'sum', field: 'rate' }],
      }],
    };
    const findings = validateWidgetBindings(asPackageStack(appOnLibrary('book_metrics', ['rate_total']), [incoherent]));
    expect(findings.filter((f) => f.path.startsWith('datasets['))).toEqual([]);
  });

  it('the union run of a `manifest: \'preserve\'` composition with a residual top-level dataset reads every body, as before (M2)', () => {
    // The shape the doors hand the rule (review 6857932402 M2): the composition
    // keeps the LAST input's manifest, whose id names the app's body, and a
    // top-level `datasets` (the residual ADR-0130 D4 registers under that id)
    // stops the union fold from folding the bodies' datasets. The module's
    // dashboard on the module's OWN dataset, the module depending on the app,
    // must stay accepted: the runtime serves it.
    const module = defineStack({
      manifest: { id: REVENUE, namespace: 'crm', name: 'revenue', version: '1.0.0', type: 'module', dependencies: { [APP]: '^1.0.0' } },
      objects: revenueBody.objects,
      datasets: revenueBody.datasets,
      dashboards: appBody('product_metrics').dashboards,
    } as never);
    const app = defineStack({
      manifest: { id: APP, namespace: 'crm', name: 'hotcrm', version: '1.0.0', type: 'app' },
      objects: [{ name: 'crm_account', fields: { name: { type: 'text' } } }],
    } as never);
    const composed = composeStacks([module, app], { manifest: 'preserve' }) as unknown as Record<string, unknown> & {
      manifest: { id: string };
      packages: Array<{ manifest: Record<string, unknown> }>;
    };
    expect(composed.manifest.id).toBe(APP);
    const residual = {
      name: 'account_metrics', object: 'crm_account',
      measures: [{ name: 'account_count', label: 'Accounts', aggregate: 'count' }],
      dimensions: [{ name: 'name', field: 'name' }],
    };
    // `authoringRuleUnionStack` (cli): a top-level key already present is kept, an absent one is folded from the bodies.
    const union = {
      ...composed,
      datasets: [residual],
      dashboards: composed.packages.flatMap((p) => (p.manifest.dashboards as unknown[] | undefined) ?? []),
    };
    expect(union.dashboards).toHaveLength(1);
    expect(datasetUnknown(union)).toEqual([]);
    // CONTROL: the same manifest handed as the app's body itself IS the per-package pass, and refuses nothing here either.
    const appEntry = composed.packages.find((p) => p.manifest.id === APP)!.manifest;
    expect(datasetUnknown({ ...appEntry, manifest: appEntry, packages: composed.packages })).toEqual([]);
  });

  it('reaches the rule table the per-package pass runs', () => {
    const stack = asPackageStack(appBody('product_metrics'), [revenueBody]);
    const findings = runAuthoringRules('validate', { normalized: stack, parsed: stack });
    expect(findings.filter((f) => f.rule === WIDGET_DATASET_UNKNOWN)).toHaveLength(1);
    const declared = asPackageStack(appOnLibrary('book_metrics', ['book_count']), [libraryBody]);
    expect(
      runAuthoringRules('validate', { normalized: declared, parsed: declared }).filter((f) => f.rule === WIDGET_DATASET_UNKNOWN),
    ).toEqual([]);
  });
});
