// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11910 — which dashboards the Interfaces pillar's leaf autosave HOLDS
 * instead of sending.
 *
 * The card: *Add widget* → *Metric* autosaved `{ id, type, title }`, the draft
 * door answered 422 on `widgets.0.dataset` and `widgets.0.values`, and a red
 * "Changes not saved" showed before the author could bind a dataset. A widget
 * cannot be born valid without a dataset the author has not chosen, so the
 * pillar now holds such a dashboard unsent and names what the widget needs,
 * as objectui#11786 does for the Data and Automations pillars.
 *
 * The predicate asks the spec's own widget schema. Every "held" case below is
 * paired with the spec's `DashboardSchema` verdict on the same dashboard (it
 * refuses it, naming exactly the absent inputs), and every "not held" control
 * with a dashboard that judge accepts or refuses for something the author
 * wrote: the hold is never stricter than the contract, and never hides a
 * finished but wrong widget. The pillar that acts on it is pinned in
 * `InterfacesPillar.heldWidget-11910.test.tsx`.
 *
 * objectui#11951 widened "absent" to "unset": a binding input the author
 * emptied (its last measure removed) or cleared is held like an absent one.
 * Its pins are the second `describe`, per binding input and state, each paired
 * with the spec's verdict on the same dashboard; 11910's pin that an empty
 * measure list was sent is replaced there by its opposite.
 */

import { describe, expect, it } from 'vitest';
import { DashboardSchema } from '@objectstack/spec/ui';
import { dashboardHeldEdit, widgetMissingInputs } from './metadataError';
import { t, tFormat } from '../metadata-admin/i18n';
import { WIDGET_TYPE_META } from '../metadata-admin/previews/widget-types';

/** The issue paths the spec's dashboard parse refuses `dashboard` at, as the door reports them. */
function dashboardRefusals(dashboard: Record<string, unknown>): string[] {
  const result = DashboardSchema.safeParse(dashboard);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

const BOUND = { id: 'pipeline', type: 'metric', title: 'Pipeline', dataset: 'sales_ds', values: ['revenue'] };

const dash = (...widgets: Array<Record<string, unknown>>) => ({ name: 'sales_dash', label: 'Sales', widgets });

/** A widget as `DashboardPreview`'s *Add widget* builds it for `type`. */
function added(type: string, id = 'widget_1'): Record<string, unknown> {
  const meta = WIDGET_TYPE_META[type];
  return { id, type, title: `New ${meta.label.toLowerCase()}`, ...(meta.defaults ?? {}) };
}

const clause = (input: string, widget: string, locale = 'en') =>
  tFormat('engine.studio.held.widgetNeedsInput', locale, { input: t(input, locale), widget });

describe('the Interfaces pillar holds a widget the spec refuses only for an absent binding (objectui#11910)', () => {
  it('every type the picker offers: a new widget is held for its dataset, as the door refuses it', () => {
    for (const type of Object.keys(WIDGET_TYPE_META)) {
      const body = dash(BOUND, added(type));
      expect(dashboardRefusals(body), type).toEqual(['widgets.1.dataset', 'widgets.1.values']);
      expect(widgetMissingInputs(added(type)), type).toEqual(['dataset', 'values']);
      expect(dashboardHeldEdit(body, 'en'), type).toEqual({
        clause: clause('engine.inspector.widget.dataset', `New ${WIDGET_TYPE_META[type].label.toLowerCase()}`),
        target: { kind: 'widget', id: 'widget_1' },
      });
    }
  });

  it('a dataset bound, no measure yet: held for its measures', () => {
    const body = dash({ ...added('metric'), dataset: 'sales_ds' });
    expect(dashboardRefusals(body)).toEqual(['widgets.0.values']);
    expect(dashboardHeldEdit(body, 'en')).toEqual({
      clause: clause('engine.inspector.widget.values', 'New metric (kpi)'),
      target: { kind: 'widget', id: 'widget_1' },
    });
  });

  it('a dataset and a measure bound: not held, and the spec accepts it', () => {
    const body = dash({ ...added('metric'), dataset: 'sales_ds', values: ['revenue'] });
    expect(dashboardRefusals(body)).toEqual([]);
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
  });

  it('the first unfinished widget in the dashboard is the one named', () => {
    const body = dash(BOUND, { ...added('bar', 'widget_2'), dataset: 'sales_ds' }, added('pie', 'widget_3'));
    expect(dashboardHeldEdit(body, 'en')?.target).toEqual({ kind: 'widget', id: 'widget_2' });
  });

  it('the title is read in the designer locale, and a widget with none is named by its id', () => {
    const mapTitled = { ...added('metric'), title: { en: 'Revenue', 'zh-CN': '收入' } };
    expect(dashboardHeldEdit(dash(mapTitled), 'zh-CN')?.clause).toBe(
      clause('engine.inspector.widget.dataset', '收入', 'zh-CN'),
    );
    const untitled = added('metric');
    delete untitled.title;
    expect(dashboardHeldEdit(dash(untitled), 'en')?.clause).toBe(clause('engine.inspector.widget.dataset', 'widget_1'));
  });

  // CONTROLS — finished but wrong, or not the inspector's to finish: sent, and
  // the refusal shows.
  it('a finished widget the spec refuses (two measures on a metric) is not held', () => {
    const body = dash({ ...added('metric'), dataset: 'sales_ds', values: ['revenue', 'deal_count'] });
    expect(dashboardRefusals(body)).toEqual(['widgets.0.values']);
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
  });

  it('a dataset the author wrote wrong is not held, though the measures are still absent', () => {
    const body = dash({ ...added('bar'), dataset: 'Sales Pipeline' });
    expect(dashboardRefusals(body)).toContain('widgets.0.dataset');
    expect(widgetMissingInputs(body.widgets[0])).toEqual([]);
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
  });

  it('a type outside the spec\'s, or a missing id, is not the inspector\'s to finish: not held', () => {
    const offType = dash({ id: 'widget_1', type: 'metric-card', title: 'Total' });
    expect(dashboardRefusals(offType)).toContain('widgets.0.type');
    expect(dashboardHeldEdit(offType, 'en')).toBeNull();

    const noId = dash({ type: 'metric', title: 'Total' });
    expect(dashboardRefusals(noId)).toContain('widgets.0.id');
    expect(dashboardHeldEdit(noId, 'en')).toBeNull();
  });

  it('a dashboard with every widget bound, or none, is not held', () => {
    expect(dashboardHeldEdit(dash(BOUND), 'en')).toBeNull();
    expect(dashboardHeldEdit(dash(), 'en')).toBeNull();
    expect(dashboardHeldEdit({ name: 'sales_dash', label: 'Sales' }, 'en')).toBeNull();
  });
});

describe('a binding input the author emptied or cleared is held like an absent one (objectui#11951)', () => {
  /** A bound `type` widget with `patch` applied; a key patched to `undefined` is removed, as the door reads it. */
  function widget(type: string, patch: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = { ...added(type), dataset: 'sales_ds', values: ['revenue'], ...patch };
    for (const key of Object.keys(patch)) if (patch[key] === undefined) delete body[key];
    return body;
  }

  const TWO_MEASURES = ['revenue', 'deal_count'];

  // Per input and state, what the spec does with the dashboard and what the
  // pillar does with it: held where the spec refuses the state, sent where it
  // accepts it. `dataset` is one name, so it is cleared rather than emptied;
  // `dimensions` and `values` are lists, so they are emptied.
  const STATES: Array<{
    input: string;
    state: string;
    body: Record<string, unknown>;
    refusals: string[];
    held: string[];
    title: string;
  }> = [
    { input: 'dataset', state: 'absent', body: widget('metric', { dataset: undefined }), refusals: ['widgets.0.dataset'], held: ['dataset'], title: 'New metric (kpi)' },
    { input: 'dataset', state: 'cleared', body: widget('metric', { dataset: '' }), refusals: ['widgets.0.dataset', 'widgets.0.dataset'], held: ['dataset'], title: 'New metric (kpi)' },
    { input: 'dimensions', state: 'absent, one measure', body: widget('bar', { dimensions: undefined }), refusals: [], held: [], title: 'New bar chart' },
    { input: 'dimensions', state: 'emptied, one measure', body: widget('bar', { dimensions: [] }), refusals: [], held: [], title: 'New bar chart' },
    { input: 'dimensions', state: 'absent, two measures on a scatter', body: widget('scatter', { values: TWO_MEASURES }), refusals: ['widgets.0.values'], held: ['dimensions'], title: 'New scatter plot' },
    { input: 'dimensions', state: 'emptied, two measures on a scatter', body: widget('scatter', { dimensions: [], values: TWO_MEASURES }), refusals: ['widgets.0.values'], held: ['dimensions'], title: 'New scatter plot' },
    { input: 'values', state: 'absent', body: widget('metric', { values: undefined }), refusals: ['widgets.0.values'], held: ['values'], title: 'New metric (kpi)' },
    { input: 'values', state: 'emptied', body: widget('metric', { values: [] }), refusals: ['widgets.0.values'], held: ['values'], title: 'New metric (kpi)' },
    { input: 'values', state: 'emptied, on a chart with a dimension', body: widget('bar', { dimensions: ['stage'], values: [] }), refusals: ['widgets.0.values'], held: ['values'], title: 'New bar chart' },
  ];

  for (const { input, state, body, refusals, held, title } of STATES) {
    it(`${input}, ${state}: ${held.length > 0 ? 'held' : 'sent'}, as the spec ${refusals.length > 0 ? 'refuses' : 'accepts'} it`, () => {
      const dashboard = dash(body);
      expect(dashboardRefusals(dashboard)).toEqual(refusals);
      expect(widgetMissingInputs(body)).toEqual(held);
      expect(dashboardHeldEdit(dashboard, 'en')).toEqual(
        held.length > 0
          ? { clause: clause(`engine.inspector.widget.${held[0]}`, title), target: { kind: 'widget', id: 'widget_1' } }
          : null,
      );
    });
  }

  it('a cleared dataset and an emptied measure list: both held, the dataset named first', () => {
    const body = widget('metric', { dataset: '', values: [] });
    expect(dashboardRefusals(dash(body))).toEqual(['widgets.0.dataset', 'widgets.0.dataset', 'widgets.0.values']);
    expect(widgetMissingInputs(body)).toEqual(['dataset', 'values']);
    expect(dashboardHeldEdit(dash(body), 'en')?.clause).toBe(clause('engine.inspector.widget.dataset', 'New metric (kpi)'));
  });

  // CONTROLS — finished but wrong: an unset input beside it does not hide the
  // refusal, and setting the unset input would not satisfy the spec.
  it('a dataset the author wrote wrong, beside an emptied measure list: not held', () => {
    const body = widget('metric', { dataset: 'Sales Pipeline', values: [] });
    expect(dashboardRefusals(dash(body))).toEqual(['widgets.0.dataset', 'widgets.0.values']);
    expect(widgetMissingInputs(body)).toEqual([]);
    expect(dashboardHeldEdit(dash(body), 'en')).toBeNull();
  });

  it('two measures on a metric or a pie, with the dimensions emptied: not held, since no dimension would do', () => {
    for (const type of ['metric', 'pie']) {
      const body = widget(type, { dimensions: [], values: TWO_MEASURES });
      expect(dashboardRefusals(dash(body)), type).toEqual(['widgets.0.values']);
      expect(widgetMissingInputs(body), type).toEqual([]);
      expect(dashboardHeldEdit(dash(body), 'en'), type).toBeNull();
    }
  });

  it('a dataset name of spaces is a value, not a cleared input: not held', () => {
    const body = widget('metric', { dataset: '  ' });
    expect(dashboardRefusals(dash(body))).toEqual(['widgets.0.dataset']);
    expect(widgetMissingInputs(body)).toEqual([]);
  });
});
