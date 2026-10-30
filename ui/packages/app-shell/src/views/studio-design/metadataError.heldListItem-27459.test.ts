// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27459 — which dashboards the Interfaces pillar's leaf autosave
 * HOLDS for an unfinished item of one of the dashboard's own list properties.
 *
 * The card: Properties → Global Filters → "Add item" autosaved
 * `globalFilters[N] = {}`, the draft door answered 422 on
 * `globalFilters.N.field`, and every later save (a Label edit) carried the same
 * item and was refused too, so the edit was lost. The header's Actions → "Add
 * item" did the same on `header.actions.0.label` / `actionUrl`.
 *
 * Every "held" case is paired with the spec's own `DashboardSchema` verdict on
 * the same dashboard (it refuses it, at exactly the unset inputs), and every
 * "not held" control with a dashboard that judge accepts, or refuses for a
 * value the author wrote: the hold is never stricter than the contract, and
 * never hides a finished but wrong item. The pillar that acts on it is pinned
 * in `InterfacesPillar.heldListItem-27459.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { DashboardSchema } from '@objectstack/spec/ui';
import { dashboardHeldEdit, listItemHeldInput } from './metadataError';
import { t, tFormat } from '../metadata-admin/i18n';

/** The issue paths the spec's dashboard parse refuses `dashboard` at, as the door reports them. */
function dashboardRefusals(dashboard: Record<string, unknown>): string[] {
  const result = DashboardSchema.safeParse(dashboard);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

const BOUND = { id: 'pipeline', type: 'metric', title: 'Pipeline', dataset: 'sales_ds', values: ['revenue'] };
const STAGE_FILTER = { field: 'stage', label: 'Stage' };

const dash = (extra: Record<string, unknown>) => ({ name: 'sales_dash', label: 'Sales', widgets: [BOUND], ...extra });

/** An item as the properties panel's repeater "Add item" builds it: every row input present and unset. */
function blank(...inputs: string[]): Record<string, unknown> {
  return Object.fromEntries(inputs.map((input) => [input, undefined]));
}
const FILTER_INPUTS = ['name', 'field', 'object', 'label', 'type', 'options', 'optionsFrom', 'defaultValue', 'scope', 'targetWidgets'];
const ACTION_INPUTS = ['label', 'actionUrl', 'actionType', 'icon'];

const clause = (input: string, n: number, list: string, locale = 'en') =>
  tFormat('engine.studio.held.listItemNeedsInput', locale, { input, n, list });

describe('the Interfaces pillar holds a dashboard list item the spec refuses only for unset inputs (objectstack#27459)', () => {
  it('Global Filters → Add item: held for its Field, as the door refuses it, placed on the dashboard properties', () => {
    const body = dash({ globalFilters: [STAGE_FILTER, blank(...FILTER_INPUTS)] });
    expect(dashboardRefusals(body)).toEqual(['globalFilters.1.field']);
    expect(dashboardHeldEdit(body, 'en')).toEqual({
      clause: clause('Field', 2, 'Global Filters'),
      target: null,
      input: 'Global Filters',
    });
  });

  it('the stored `{}` the card saw is held the same way', () => {
    const body = dash({ globalFilters: [{}] });
    expect(dashboardRefusals(body)).toEqual(['globalFilters.0.field']);
    expect(dashboardHeldEdit(body, 'en')?.clause).toBe(clause('Field', 1, 'Global Filters'));
  });

  // CONTROL: the hold is never stricter than the contract.
  it('a Field cleared to blank is one the spec takes: not held', () => {
    const body = dash({ globalFilters: [{ ...blank(...FILTER_INPUTS), field: '' }] });
    expect(dashboardRefusals(body)).toEqual([]);
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
  });

  it('an Action URL cleared to blank is unset: held like an absent one', () => {
    const body = dash({ header: { actions: [{ ...blank(...ACTION_INPUTS), label: 'Open', actionUrl: '' }] } });
    expect(dashboardRefusals(body)).toEqual(['header.actions.0.actionUrl']);
    expect(dashboardHeldEdit(body, 'en')?.clause).toBe(clause('Action URL', 1, 'Actions'));
  });

  it('a Field filled: not held, and the spec accepts it', () => {
    const body = dash({ globalFilters: [{ ...blank(...FILTER_INPUTS), field: 'stage' }] });
    expect(dashboardRefusals(body)).toEqual([]);
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
  });

  it('header Actions → Add item: held for the first input it needs, nested list named by its own label', () => {
    const body = dash({ header: { actions: [blank(...ACTION_INPUTS)] } });
    expect(dashboardRefusals(body)).toEqual(['header.actions.0.label', 'header.actions.0.actionUrl']);
    expect(dashboardHeldEdit(body, 'en')).toEqual({
      clause: clause('Label', 1, 'Actions'),
      target: null,
      input: 'Actions',
    });
    const labelled = dash({ header: { actions: [{ ...blank(...ACTION_INPUTS), label: 'Open' }] } });
    expect(dashboardRefusals(labelled)).toEqual(['header.actions.0.actionUrl']);
    expect(dashboardHeldEdit(labelled, 'en')?.clause).toBe(clause('Action URL', 1, 'Actions'));
  });

  it('names the list and the item in the designer locale the panel shows them in', () => {
    const body = dash({ globalFilters: [{}] });
    expect(dashboardHeldEdit(body, 'zh-CN')).toEqual({
      clause: clause('Field', 1, '全局筛选', 'zh-CN'),
      target: null,
      input: '全局筛选',
    });
  });

  it('a widget waiting for its binding is named first: the widget rule keeps its own hold', () => {
    const body = dash({ widgets: [BOUND, { id: 'widget_1', type: 'metric', title: 'New metric' }], globalFilters: [{}] });
    expect(dashboardHeldEdit(body, 'en')?.target).toEqual({ kind: 'widget', id: 'widget_1' });
  });

  // CONTROL: errors stay for finished work.
  it('an item refused for a value it holds is finished but wrong: not held, so its refusal shows', () => {
    const body = dash({ header: { actions: [{ label: 'Open', actionUrl: 'javascript:alert(1)' }] } });
    expect(dashboardRefusals(body)).toEqual(['header.actions.0.actionUrl']);
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
  });

  it('a wrong value the spec does not judge yet is judged once the item is filled in', () => {
    // The spec judges the URL only once the item has its label, so it names the label alone: held for it.
    const unlabelled = dash({ header: { actions: [{ actionUrl: 'javascript:alert(1)' }] } });
    expect(dashboardRefusals(unlabelled)).toEqual(['header.actions.0.label']);
    expect(dashboardHeldEdit(unlabelled, 'en')?.clause).toBe(clause('Label', 1, 'Actions'));
    // Labelled, the URL is refused for the value it holds: sent, and its refusal shows.
    const labelled = dash({ header: { actions: [{ label: 'Open', actionUrl: 'javascript:alert(1)' }] } });
    expect(dashboardRefusals(labelled)).toEqual(['header.actions.0.actionUrl']);
    expect(dashboardHeldEdit(labelled, 'en')).toBeNull();
  });

  it('an item with an unset input and a wrong value the spec names both of is not held', () => {
    const body = dash({ globalFilters: [{ type: 'radio' }] });
    expect(dashboardRefusals(body)).toEqual(['globalFilters.0.field', 'globalFilters.0.type']);
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
  });

  it('a list holding something other than an item (a refused value on the list itself) is not held', () => {
    const body = dash({ globalFilters: ['stage'] });
    expect(dashboardRefusals(body)).toEqual(['globalFilters.0']);
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
  });

  it('a dashboard the spec accepts holds nothing', () => {
    const body = dash({ globalFilters: [STAGE_FILTER], header: { actions: [{ label: 'Open', actionUrl: '/x' }] } });
    expect(dashboardRefusals(body)).toEqual([]);
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
    expect(listItemHeldInput(body, DashboardSchema)).toBeNull();
  });

  it('`listItemHeldInput` places the item: the list path, the index and the input', () => {
    expect(listItemHeldInput(dash({ header: { actions: [{ label: 'A', actionUrl: '/a' }, {}] } }), DashboardSchema)).toEqual({
      list: ['header', 'actions'],
      index: 1,
      input: 'label',
    });
  });
});

// Keeps `t` honest: the clause key exists in both catalogs.
it('the held clause key is catalogued in en and zh', () => {
  expect(t('engine.studio.held.listItemNeedsInput', 'en')).not.toBe('engine.studio.held.listItemNeedsInput');
  expect(t('engine.studio.held.listItemNeedsInput', 'zh-CN')).not.toBe('engine.studio.held.listItemNeedsInput');
});
