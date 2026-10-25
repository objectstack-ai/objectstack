/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8894 — `DashboardEditor`'s type picker never turns a widget into a
 * shape the widget door refuses.
 *
 * `@objectstack/spec` 17.5.0 refuses a second measure on a metric-family
 * widget (ruling D on the card). This editor authors no measures itself, but a
 * dashboard it opens carries them (`DashboardDesignPage` loads stored
 * dashboards), and its type picker could turn a `bar` over two measures into a
 * `metric` the door then refuses at publish — where `DashboardDesignPage`'s
 * save swallows the error. Now the picker asks the door (`measureRefusal`):
 *
 *   - a type the door refuses this widget's measures under is a DISABLED
 *     option, and a pick of it writes nothing;
 *   - a stored widget the door already refuses shows the door's message.
 *
 * ## Which options must be disabled is read off the SPEC, per option
 *
 * Every option the editor renders is judged by the spec's own
 * `DashboardWidgetSchema` with the widget's measures: refused at `values` ⇒ the
 * option must be disabled, accepted ⇒ enabled. No type list is written here, so
 * the rows move with the spec and with the editor's palette.
 *
 * The picker is the shared `Select` (objectui#11865), so the options are read
 * off its opened list: each item carries its type as `data-option-value` and a
 * disabled item says so with `aria-disabled`, as a native `<option>` did with
 * `disabled`.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DashboardWidgetSchema as SpecDashboardWidgetSchema } from '@objectstack/spec/ui';
import type { DashboardComponentSchema, DashboardWidgetSchema } from '@object-ui/types';
import { DashboardEditor } from '../DashboardEditor';

type Issue = { code: string; path: PropertyKey[]; message: string };

function bound(id: string, extra: Partial<DashboardWidgetSchema> = {}): DashboardWidgetSchema {
  return {
    id,
    type: 'bar',
    title: id,
    dataset: 'sales_pipeline',
    dimensions: ['stage'],
    values: ['revenue'],
    ...extra,
  };
}

function openPanelFor(widget: DashboardWidgetSchema) {
  const onChange = vi.fn();
  const schema: DashboardComponentSchema = { type: 'dashboard', name: 'sales', widgets: [widget] };
  render(<DashboardEditor schema={schema} onChange={onChange} />);
  fireEvent.click(screen.getByTestId(`dashboard-widget-${widget.id}`));
  return onChange;
}

/** The spec's arity issue for `widget` under `type`, read off the spec's own parse, or `undefined`. */
function specArityIssue(widget: DashboardWidgetSchema, type: string): Issue | undefined {
  const r = SpecDashboardWidgetSchema.safeParse({ ...widget, type });
  if (r.success) return undefined;
  return (r.error.issues as Issue[]).find((i) => i.code === 'custom' && i.path.map(String).join('.') === 'values');
}

/** The type picker's options, read off its opened list, in order. */
async function typeOptions(): Promise<Array<{ value: string; disabled: boolean; element: HTMLElement }>> {
  fireEvent.keyDown(screen.getByTestId('widget-prop-type'), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option').map((element) => {
    const value = element.getAttribute('data-option-value');
    if (!value) throw new Error(`option "${element.textContent}" carries no data-option-value`);
    return { value, disabled: element.getAttribute('aria-disabled') === 'true', element };
  });
}

describe('objectui#8894 — the type picker offers only what the door accepts', () => {
  it('SUBJECT: a two-measure bar cannot be turned into a type the spec refuses two measures on', async () => {
    const widget = bound('w1', { values: ['revenue', 'deal_count'] });
    openPanelFor(widget);
    const options = await typeOptions();
    const refused = options.filter((o) => specArityIssue(widget, o.value) !== undefined);
    // Not vacuous: the editor's palette offers at least one metric-family type.
    expect(refused.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(o.disabled, `option ${o.value}`).toBe(specArityIssue(widget, o.value) !== undefined);
    }
    // Nothing is refused as stored, so there is nothing to report.
    expect(screen.queryByTestId('widget-prop-measure-refusal')).toBeNull();
  });

  it('SUBJECT: a pick of a refused type writes nothing', async () => {
    const widget = bound('w1', { values: ['revenue', 'deal_count'] });
    const onChange = openPanelFor(widget);
    const refused = (await typeOptions()).find((o) => specArityIssue(widget, o.value) !== undefined)!;
    fireEvent.click(refused.element);
    fireEvent.keyDown(refused.element, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('CONTROL: a pick of an accepted type is written as before', async () => {
    const widget = bound('w1', { values: ['revenue', 'deal_count'] });
    const onChange = openPanelFor(widget);
    fireEvent.click((await typeOptions()).find((o) => o.value === 'line')!.element);
    const schema = onChange.mock.calls[onChange.mock.calls.length - 1][0] as DashboardComponentSchema;
    expect((schema.widgets as DashboardWidgetSchema[])[0].type).toBe('line');
  });

  it('CONTROL: a one-measure widget is offered every type', async () => {
    openPanelFor(bound('w1'));
    expect((await typeOptions()).filter((o) => o.disabled)).toEqual([]);
  });

  it('SUBJECT: a stored widget the door already refuses shows the door\'s own message, and stays what it is', async () => {
    const widget = bound('w1', { type: 'metric', dimensions: undefined, values: ['revenue', 'deal_count'] });
    openPanelFor(widget);
    const shown = screen.getByTestId('widget-prop-measure-refusal');
    expect(shown).toHaveAttribute('role', 'alert');
    expect(shown.textContent).toBe(specArityIssue(widget, 'metric')!.message);
    // Its own type stays selected and selectable — the editor reports, it does
    // not rewrite the stored widget.
    const metric = (await typeOptions()).find((o) => o.value === 'metric')!;
    expect(metric.element).toHaveAttribute('data-state', 'checked');
    expect(metric.disabled).toBe(false);
  });
});
