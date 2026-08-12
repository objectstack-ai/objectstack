// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import stack from '../objectstack.config.js';

/**
 * Dashboard global filters must be ANSWERABLE on every widget they reach
 * (objectstack#7568).
 *
 * A dashboard-level filter is broadcast into EVERY widget's analytics query
 * (framework#2501). A widget that declares no `filterBindings` inherits it on
 * its own object's like-named field — the engine doing exactly what the
 * metadata says. The authoring trap is that field EXISTENCE and field
 * VOCABULARY are different facts, and only the first one was ever checked:
 * `packages/lint`'s `dashboard-filter-field-unknown` rule fires when the
 * effective field is missing from the bound object, which is the loud failure
 * (`no such column`). When the column exists but carries a DIFFERENT set of
 * values, nothing fires at all — the query is valid, the backend answers
 * `200 OK`, and the widget renders a zero.
 *
 * That is what #7568 was: Delivery Operations declared a `status` filter with
 * the `showcase_task` vocabulary (backlog / todo / in_progress / in_review /
 * done), and `showcase_project.status` carries a disjoint one (planned /
 * active / on_hold / completed / cancelled). Four KPI tiles and a chart — plus
 * a table nobody counted — emitted `WHERE status = 'in_review'` against
 * `showcase_project` and read 0 for every selection, while the filter bar
 * looked like it was working.
 *
 * These two tests pin the CONSEQUENCE, not the presence of a key:
 *
 *  1. every value a filter offers must be a value its effective field can
 *     actually hold on each widget it reaches — otherwise that selection is
 *     empty by construction;
 *  2. a filter must still reach at least one widget — otherwise the repair for
 *     (1) is "opt everybody out", which leaves an inert control on the header
 *     bar (Prime Directive #10, declared ≠ enforced).
 *
 * The check is generic over every showcase dashboard, so a widget added to the
 * project side of Delivery Operations tomorrow is judged the same way rather
 * than quietly re-introducing the defect.
 */

type AnyRec = Record<string, unknown>;

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Reserved filter name for the dashboard's built-in date range (#2501). */
const DATE_RANGE_FILTER_NAME = 'dateRange';

interface FilterDef {
  name: string;
  field: string;
  targetWidgets?: string[];
  /** Static option VALUES, when the filter declares them. */
  optionValues?: string[];
}

/**
 * The dashboard's declared filters, keyed by the name widgets bind against.
 * Mirrors `dashboardFilterDefs` in `packages/lint/src/validate-widget-bindings.ts`,
 * which in turn mirrors objectui's `resolveDashboardFilterDefs`.
 *
 * The built-in `dateRange` is deliberately NOT included: it carries no option
 * vocabulary to compare, and its field-existence half is already the lint
 * rule's job.
 */
function filterDefs(dash: AnyRec): FilterDef[] {
  const byName = new Map<string, FilterDef>();
  for (const f of asArray(dash.globalFilters)) {
    const field = str(f.field);
    if (!field) continue;
    const name = str(f.name) ?? field;
    if (name === DATE_RANGE_FILTER_NAME) continue;
    const options = asArray(f.options)
      .map((o) => o.value)
      .filter((v): v is string => typeof v === 'string');
    byName.set(name, {
      name,
      field,
      targetWidgets: Array.isArray(f.targetWidgets)
        ? (f.targetWidgets as unknown[]).filter((w): w is string => typeof w === 'string')
        : undefined,
      optionValues: options.length > 0 ? options : undefined,
    });
  }
  return [...byName.values()];
}

/**
 * Which field of `widget` this filter binds to, or `undefined` when the widget
 * is not bound. Precedence mirrors objectui's `resolveBoundField` (and
 * `effectiveFilterField` in `packages/lint`): an explicit `filterBindings`
 * entry wins (a string re-targets, `false` opts out), then the `targetWidgets`
 * allow-list, then the filter's own `field`.
 */
function boundField(widget: AnyRec, def: FilterDef): string | undefined {
  const bindings = widget.filterBindings;
  const binding = bindings && typeof bindings === 'object'
    ? (bindings as AnyRec)[def.name]
    : undefined;
  if (binding === false) return undefined;
  const retarget = str(binding);
  if (retarget) return retarget;
  if (def.targetWidgets && def.targetWidgets.length > 0) {
    const id = str(widget.id);
    if (!id || !def.targetWidgets.includes(id)) return undefined;
  }
  return def.field;
}

const dashboards = asArray((stack as AnyRec).dashboards);

const datasetObject = new Map<string, string>();
for (const ds of asArray((stack as AnyRec).datasets)) {
  const name = str(ds.name);
  const object = str(ds.object);
  if (name && object) datasetObject.set(name, object);
}

/** `object name → field name → declared select option values`. */
const selectVocabulary = new Map<string, Map<string, string[]>>();
for (const o of asArray((stack as AnyRec).objects)) {
  const name = str(o.name);
  if (!name) continue;
  const byField = new Map<string, string[]>();
  for (const f of asArray(o.fields)) {
    const fname = str(f.name);
    if (!fname || f.type !== 'select') continue;
    const values = asArray(f.options)
      .map((opt) => opt.value)
      .filter((v): v is string => typeof v === 'string');
    if (values.length > 0) byField.set(fname, values);
  }
  selectVocabulary.set(name, byField);
}

describe('showcase dashboards — global filters are answerable where they land', () => {
  it('every value a global filter offers is a value its effective field can hold', () => {
    const unsatisfiable: string[] = [];

    for (const dash of dashboards) {
      const dashName = str(dash.name) ?? '(unnamed dashboard)';
      const defs = filterDefs(dash);
      if (defs.length === 0) continue;

      for (const w of asArray(dash.widgets)) {
        const widgetId = str(w.id) ?? '(unnamed widget)';
        const object = datasetObject.get(str(w.dataset) ?? '');
        const vocabulary = object ? selectVocabulary.get(object) : undefined;
        if (!vocabulary) continue; // unbound / unknowable object — not ours to judge

        for (const def of defs) {
          if (!def.optionValues) continue; // no declared vocabulary to compare
          const field = boundField(w, def);
          if (!field) continue; // opted out / not targeted — the filter never applies
          const allowed = vocabulary.get(field);
          if (!allowed) continue; // not a select field: free text/number/date, unjudgeable here

          const missing = def.optionValues.filter((v) => !allowed.includes(v));
          if (missing.length === 0) continue;
          unsatisfiable.push(
            `${dashName} › ${widgetId}: filter "${def.name}" binds to ` +
            `${object}.${field}, whose values are [${allowed.join(', ')}] — ` +
            `selecting [${missing.join(', ')}] can only ever return zero rows. ` +
            `Re-target it (filterBindings: { ${def.name}: '<field>' }) or opt out ` +
            `(filterBindings: { ${def.name}: false }).`,
          );
        }
      }
    }

    expect(unsatisfiable).toEqual([]);
  });

  it('every global filter still reaches at least one widget', () => {
    const inert: string[] = [];

    for (const dash of dashboards) {
      const dashName = str(dash.name) ?? '(unnamed dashboard)';
      const widgets = asArray(dash.widgets);
      for (const def of filterDefs(dash)) {
        const reached = widgets.filter((w) => boundField(w, def) !== undefined);
        if (reached.length === 0) {
          inert.push(
            `${dashName}: filter "${def.name}" is bound by no widget — it renders on ` +
            `the header bar and changes nothing. Bind it to a widget or remove it.`,
          );
        }
      }
    }

    expect(inert).toEqual([]);
  });

  /**
   * The #7568 case itself, stated in the terms a reader of the dashboard cares
   * about: the Task Status control governs the task side and nothing else. The
   * generic tests above would also catch a regression here, but only as a
   * vocabulary mismatch — this one names the intent, so a future author who
   * re-targets a project widget onto some other project column sees which
   * decision they are overturning.
   */
  it('Delivery Operations: task_status governs the task widgets and no project widget', () => {
    const ops = dashboards.find((d) => str(d.name) === 'showcase_ops_dashboard');
    expect(ops, 'showcase_ops_dashboard is registered').toBeDefined();

    const def = filterDefs(ops as AnyRec).find((d) => d.name === 'task_status');
    expect(def, 'the Task Status filter is named task_status').toBeDefined();

    const reach: Record<string, string> = {};
    for (const w of asArray((ops as AnyRec).widgets)) {
      const id = str(w.id) ?? '(unnamed widget)';
      const object = datasetObject.get(str(w.dataset) ?? '') ?? '(unknown object)';
      const field = boundField(w, def as FilterDef);
      reach[id] = field ? `${object}.${field}` : 'opted out';
    }

    expect(reach).toEqual({
      kpi_active_projects: 'opted out',
      kpi_at_risk: 'opted out',
      kpi_awaiting_review: 'showcase_task.status',
      kpi_total_budget: 'opted out',
      col_health: 'opted out',
      bar_status: 'showcase_task.status',
      donut_priority: 'showcase_task.status',
      line_created: 'showcase_task.status',
      table_spend: 'opted out',
    });
  });
});
