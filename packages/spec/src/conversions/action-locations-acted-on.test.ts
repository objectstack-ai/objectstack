// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from './registry.js';
import type { ConversionApplication, ConversionTodoDetail } from './types.js';

/**
 * [#36495] `action-locations-acted-on` — the sites with no lossless rewrite.
 *
 * The fixture pair in `conversions.test.ts` proves before → after over the
 * whole table, and a site left as stored looks the same there as a site the
 * conversion never looked at. What this file pins is that each such site is
 * REPORTED: a TODO at its path, and no rewrite. Without the TODO an author
 * would meet the old word only as a parse refusal, or not at all for data at
 * rest, and the action would be drawn nowhere on a protocol-19 runtime.
 */
describe('action-locations-acted-on (ADR-0087 D3 TODOs)', () => {
  const conversion = ALL_CONVERSIONS.find((c) => c.id === 'action-locations-acted-on')!;

  function run(stack: Record<string, unknown>) {
    const notices: ConversionApplication[] = [];
    const todos: ConversionTodoDetail[] = [];
    const out = conversion.apply(stack, (n) => notices.push(n), { reportTodo: (t) => todos.push(t) });
    return { out: out as { actions: Record<string, unknown>[] }, notices, todos };
  }

  it('is registered for protocol 19 and retired from the authoring load path', () => {
    expect(conversion, 'the conversion is registered').toBeDefined();
    expect(conversion.toMajor).toBe(19);
    expect(conversion.retiredFromLoadPath).toBe(true);
  });

  // Until 19 the record page header folded this action into its ⋯ menu (its
  // component) while a `record:quick_actions` bar at `record_header` drew it as
  // a button (it read the location only). At `record_page` the fold is one state
  // for the whole page: no rewrite keeps the bar button.
  it.each([
    [['record_header']],
    [['record_header', 'record_more']],
    [['list_item', 'record_header']],
  ])('leaves %j with an authored action:menu as stored, with a TODO', (locations) => {
    const action = { name: 'print_lead', label: 'Print', type: 'script', component: 'action:menu', locations };
    const { out, notices, todos } = run({ actions: [action] });
    expect(todos.map((t) => t.path)).toEqual(['actions[0].locations']);
    expect(todos[0]!.reason).toContain('record:quick_actions');
    expect(notices).toEqual([]);
    expect(out.actions[0]).toBe(action);
  });

  it('rewrites a record_header action whose component is not action:menu, with no TODO', () => {
    const { out, todos } = run({
      actions: [{ name: 'print_lead', label: 'Print', type: 'script', component: 'action:icon', locations: ['record_header'] }],
    });
    expect(todos).toEqual([]);
    expect(out.actions[0]).toMatchObject({ component: 'action:icon', locations: ['record_page'] });
  });

  it('leaves a ⋯-only action on the list toolbar as stored, with a TODO', () => {
    const action = { name: 'export_one', label: 'Export', type: 'script', locations: ['list_toolbar', 'record_more'] };
    const { out, notices, todos } = run({ actions: [action] });
    expect(todos.map((t) => t.path)).toEqual(['actions[0].locations']);
    expect(notices).toEqual([]);
    expect(out.actions[0]).toBe(action);
  });

  // The list toolbar already folded an `action:menu` action, so the fold on
  // both surfaces is what it drew before.
  it('rewrites a ⋯-only toolbar action that already carries action:menu, with no TODO', () => {
    const { out, todos } = run({
      actions: [{
        name: 'export_all',
        label: 'Export all',
        type: 'script',
        component: 'action:menu',
        locations: ['list_toolbar', 'record_more'],
      }],
    });
    expect(todos).toEqual([]);
    expect(out.actions[0]).toMatchObject({ component: 'action:menu', locations: ['list', 'record_page'] });
  });
});
