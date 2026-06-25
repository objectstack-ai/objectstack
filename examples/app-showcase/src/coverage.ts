// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Coverage manifest — the soul of the showcase.
 *
 * This module declares *what the showcase is supposed to cover* and provides
 * the helpers the coverage test uses to prove it. The test (see
 * `test/coverage.test.ts`) introspects the protocol's own Zod enums
 * (`FieldTypeSchema`, `ChartTypeSchema`, `ReportType`, `ActionType`,
 * `ACTION_LOCATIONS`) and asserts every member appears at least once across
 * the registered metadata. Because the expected sets come from the *spec*,
 * the test fails automatically when the platform gains a new field type,
 * chart type, or report type that the showcase has not yet demonstrated —
 * keeping this example a living conformance fixture, not a static snapshot.
 */

/** List-view visualisation types (ListViewSchema `type`). */
export const LIST_VIEW_TYPES = [
  'grid',
  'kanban',
  'gallery',
  'calendar',
  'timeline',
  'gantt',
  'map',
  'chart',
] as const;

/** Form-view layout types (FormViewSchema `type`). */
export const FORM_VIEW_TYPES = ['simple', 'tabbed', 'wizard', 'split', 'drawer'] as const;

/**
 * Human/CI-readable map of each coverage dimension to where it is exercised.
 * Useful as documentation and as a checklist when extending the showcase.
 */
export const COVERAGE = {
  fieldTypes: {
    source: 'FieldTypeSchema',
    coveredBy: 'objects/field-zoo.object.ts (+ relationship/date/select fields on the backbone objects)',
  },
  relationships: {
    coveredBy: [
      'lookup → project.account, category.parent (self-referencing tree)',
      'master_detail → task.project, project_membership.{team,project}',
      'many-to-many → showcase_project_membership junction',
    ],
  },
  listViewTypes: {
    expected: LIST_VIEW_TYPES,
    coveredBy: 'views/task.view.ts (all 8) + views/project.view.ts',
  },
  formViewTypes: {
    expected: FORM_VIEW_TYPES,
    coveredBy: 'views/task.view.ts formViews (simple/tabbed/wizard/split/drawer)',
  },
  chartTypes: {
    source: 'ChartTypeSchema',
    coveredBy: 'dashboards/chart-gallery.dashboard.ts (one widget per chart family)',
  },
  reportTypes: {
    source: 'ReportType',
    coveredBy: 'reports/index.ts (tabular/summary/matrix/joined)',
  },
  actionTypesAndLocations: {
    source: 'ActionType + ACTION_LOCATIONS',
    coveredBy: 'actions/index.ts (script/url/flow/modal/api/form across all locations)',
  },
  capabilityChains: {
    security: 'security/index.ts — roles + permission set (CRUD + FLS + RLS) + sharing + policy',
    automation: 'flows/index.ts (incl. approval nodes) + webhooks/index.ts + jobs/index.ts + emails/index.ts',
  },
  i18nThemingPortals: {
    coveredBy: 'translations/index.ts (en + zh-CN), themes/index.ts (light + dark), portals/index.ts',
  },
  docs: {
    source: 'ADR-0046 (doc metadata)',
    coveredBy: 'src/docs/*.md — flat Markdown compiled to `doc` items: frontmatter title + first-heading title, cross-references with anchors, namespace-prefixed names',
  },
} as const;

/** Collect every field `type` used across a set of object definitions. */
export function collectFieldTypes(objects: Array<{ fields?: Record<string, { type?: string }> }>): Set<string> {
  const used = new Set<string>();
  for (const obj of objects) {
    for (const field of Object.values(obj.fields ?? {})) {
      if (field?.type) used.add(field.type);
    }
  }
  return used;
}

/** Collect every list-view `type` from a set of `defineView` results. */
export function collectListViewTypes(views: Array<{ list?: { type?: string }; listViews?: Record<string, { type?: string }> }>): Set<string> {
  const used = new Set<string>();
  for (const view of views) {
    if (view.list?.type) used.add(view.list.type);
    for (const lv of Object.values(view.listViews ?? {})) {
      if (lv?.type) used.add(lv.type);
    }
  }
  return used;
}

/** Collect every form-view `type` from a set of `defineView` results. */
export function collectFormViewTypes(views: Array<{ formViews?: Record<string, { type?: string }> }>): Set<string> {
  const used = new Set<string>();
  for (const view of views) {
    for (const fv of Object.values(view.formViews ?? {})) {
      if (fv?.type) used.add(fv.type);
    }
  }
  return used;
}
