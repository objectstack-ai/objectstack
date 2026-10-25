/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard designer's widget property panel picks with the shared
 * `Select` (objectui#11865).
 *
 * `DashboardEditor` picked a widget's Type and its Color Variant with
 * browser-native selects, beside the shared Radix `Select` the rest of the
 * console picks with. The card asks for one control for one kind of choice,
 * surface by surface; this suite covers the panel's two pickers
 * (`WidgetPropPicker`).
 *
 * What is pinned:
 *   - each picker IS the primitive (a Radix combobox trigger), shows the
 *     widget's value, and no native select is left;
 *   - each picker keeps the name its `<label htmlFor>` gave the native control;
 *   - every option of both pickers writes the `onChange` schema the native
 *     control wrote, compared as JSON text, on a one-measure and a two-measure
 *     widget, where the two types the widget door refuses two measures under
 *     are disabled and write nothing;
 *   - re-picking the current option writes nothing;
 *   - read-only disables both triggers in the primitive's own disabled look;
 *   - a value no option carries is what the trigger shows;
 *   - the keyboard alone opens a picker and selects.
 *
 * DIRECTION, observed against the native control: every pin here but two is
 * red there, because each one reads the pickers as the primitive's triggers.
 * The name pin and the read-only CONTROL (a writable panel's triggers are
 * enabled) are green there too: they pin what the conversion kept. What makes
 * the write pins guards of "the conversion changed nothing the panel writes"
 * is the literal each compares against: a `change` event on the
 * pre-conversion panel's native control wrote that same JSON, read once on
 * that component with these fixtures, and the names were read there the same
 * way. That probe's `change` event fired for the current option too, which a
 * browser's native select does not do, so the re-pick rows pin the primitive.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DashboardComponentSchema, DashboardWidgetSchema } from '@object-ui/types';
import { DashboardEditor } from '../DashboardEditor';

type Entry = DashboardComponentSchema['widgets'][number];

const ONE: DashboardWidgetSchema = {
  id: 'w1',
  type: 'bar',
  title: 'w1',
  dataset: 'sales_pipeline',
  dimensions: ['stage'],
  values: ['revenue'],
};
const TWO: DashboardWidgetSchema = { ...ONE, values: ['revenue', 'deal_count'] };

afterEach(cleanup);

function open(widget: Entry, readOnly = false) {
  const onChange = vi.fn();
  const utils = render(
    <DashboardEditor schema={{ type: 'dashboard', name: 'sales', widgets: [widget] }} onChange={onChange} readOnly={readOnly} />,
  );
  fireEvent.click(screen.getByTestId(`dashboard-widget-${widget.id}`));
  return { ...utils, onChange };
}

/** Open a picker from the keyboard and return the options it lists, in order. */
async function openPicker(testId: string): Promise<HTMLElement[]> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(testId: string, label: string): Promise<void> {
  const options = await openPicker(testId);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`${testId} lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

function expectWrote(onChange: ReturnType<typeof vi.fn>, json: string | null): void {
  if (json === null) {
    expect(onChange).not.toHaveBeenCalled();
    return;
  }
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(onChange.mock.calls[0][0])).toBe(json);
}

/** The schema text `onChange` received, for `widget` written as `json` (one widget, in the dashboard the suite opens). */
const schema = (widget: string) => `{"type":"dashboard","name":"sales","widgets":[${widget}]}`;
const ONE_AS = (type: string) =>
  schema(`{"id":"w1","type":"${type}","title":"w1","dataset":"sales_pipeline","dimensions":["stage"],"values":["revenue"]}`);
const TWO_AS = (type: string) =>
  schema(
    `{"id":"w1","type":"${type}","title":"w1","dataset":"sales_pipeline","dimensions":["stage"],"values":["revenue","deal_count"]}`,
  );
const ONE_COLORED = (colorVariant: string) =>
  schema(
    `{"id":"w1","type":"bar","title":"w1","dataset":"sales_pipeline","dimensions":["stage"],"values":["revenue"],"colorVariant":"${colorVariant}"}`,
  );

const TYPE_LABELS = ['KPI Metric', 'Bar Chart', 'Line Chart', 'Pie Chart', 'Table'];
const COLOR_LABELS = ['Default', 'Blue', 'Teal', 'Orange', 'Purple', 'Success', 'Warning', 'Danger'];

describe('the widget property panel pickers are the shared Select (objectui#11865)', () => {
  it('renders each picker as the Radix combobox trigger, showing the widget’s value', () => {
    const { container } = open(ONE);
    expect(container.querySelector('select')).toBeNull();
    const shown: Record<string, string> = {};
    for (const id of ['widget-prop-type', 'widget-prop-color']) {
      const trigger = screen.getByTestId(id);
      expect(trigger.tagName, id).toBe('BUTTON');
      expect(trigger, id).toHaveAttribute('role', 'combobox');
      shown[id] = trigger.textContent ?? '';
    }
    expect(shown).toEqual({ 'widget-prop-type': 'Bar Chart', 'widget-prop-color': 'Default' });
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('each picker keeps the name its label gave the native control', () => {
    open(ONE);
    expect(screen.getByRole('combobox', { name: 'Type' })).toBe(screen.getByTestId('widget-prop-type'));
    expect(screen.getByRole('combobox', { name: 'Color Variant' })).toBe(screen.getByTestId('widget-prop-color'));
  });

  it('each picker lists its options in the order the native control did', async () => {
    open(ONE);
    expect((await openPicker('widget-prop-type')).map((o) => o.textContent)).toEqual(TYPE_LABELS);
    cleanup();
    open(ONE);
    expect((await openPicker('widget-prop-color')).map((o) => o.textContent)).toEqual(COLOR_LABELS);
  });

  it('on a two-measure widget the types the door refuses are disabled items, as they were disabled options', async () => {
    open(TWO);
    const disabled = (await openPicker('widget-prop-type'))
      .filter((o) => o.getAttribute('aria-disabled') === 'true')
      .map((o) => o.textContent);
    expect(disabled).toEqual(['KPI Metric', 'Pie Chart']);
  });
});

/**
 * [the widget the panel opens on, option label, the JSON text of the schema
 * `onChange` received]. `null`: nothing is written — the option is the
 * current one, or one the widget door refuses (a disabled item).
 */
const TYPE_WRITES: ReadonlyArray<readonly [string, DashboardWidgetSchema, string, string | null]> = [
  ['one measure', ONE, 'KPI Metric', ONE_AS('metric')],
  ['one measure', ONE, 'Bar Chart', null],
  ['one measure', ONE, 'Line Chart', ONE_AS('line')],
  ['one measure', ONE, 'Pie Chart', ONE_AS('pie')],
  ['one measure', ONE, 'Table', ONE_AS('table')],
  ['two measures', TWO, 'KPI Metric', null],
  ['two measures', TWO, 'Bar Chart', null],
  ['two measures', TWO, 'Line Chart', TWO_AS('line')],
  ['two measures', TWO, 'Pie Chart', null],
  ['two measures', TWO, 'Table', TWO_AS('table')],
];

const COLOR_WRITES: ReadonlyArray<readonly [string, DashboardWidgetSchema, string, string | null]> = [
  ['none set', ONE, 'Default', null],
  ['none set', ONE, 'Blue', ONE_COLORED('blue')],
  ['none set', ONE, 'Teal', ONE_COLORED('teal')],
  ['none set', ONE, 'Orange', ONE_COLORED('orange')],
  ['none set', ONE, 'Purple', ONE_COLORED('purple')],
  ['none set', ONE, 'Success', ONE_COLORED('success')],
  ['none set', ONE, 'Warning', ONE_COLORED('warning')],
  ['none set', ONE, 'Danger', ONE_COLORED('danger')],
  ['teal', { ...ONE, colorVariant: 'teal' }, 'Default', ONE_COLORED('default')],
  ['teal', { ...ONE, colorVariant: 'teal' }, 'Blue', ONE_COLORED('blue')],
  ['teal', { ...ONE, colorVariant: 'teal' }, 'Teal', null],
];

describe('every option writes what the native control wrote', () => {
  it.each(TYPE_WRITES.map((row) => [`type, ${row[0]} → ${row[2]}`, ...row] as const))(
    '%s',
    async (_name, _label, widget, option, json) => {
      const { onChange } = open(widget);
      await pick('widget-prop-type', option);
      expectWrote(onChange, json);
    },
  );

  it.each(COLOR_WRITES.map((row) => [`color variant, ${row[0]} → ${row[2]}`, ...row] as const))(
    '%s',
    async (_name, _label, widget, option, json) => {
      const { onChange } = open(widget);
      await pick('widget-prop-color', option);
      expectWrote(onChange, json);
    },
  );
});

describe('read-only follows the primitive (objectui#11781)', () => {
  it('both triggers are disabled, wear the primitive’s disabled look, and do not open', () => {
    const { onChange } = open(ONE, true);
    for (const id of ['widget-prop-type', 'widget-prop-color']) {
      const trigger = screen.getByTestId(id);
      expect(trigger, id).toBeDisabled();
      expect(trigger.className, id).toContain('disabled:cursor-not-allowed');
      expect(trigger.className, id).toContain('disabled:opacity-50');
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(screen.queryByRole('listbox'), id).toBeNull();
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('CONTROL: a writable panel’s triggers are enabled', () => {
    open(ONE);
    expect(screen.getByTestId('widget-prop-type')).toBeEnabled();
    expect(screen.getByTestId('widget-prop-color')).toBeEnabled();
  });
});

describe('a value no option carries is what the trigger shows', () => {
  it('a stored type the palette does not offer: shown and listed first, and re-picking it writes nothing', async () => {
    const { onChange } = open({ ...ONE, type: 'area' });
    // The native control showed "KPI Metric" here, as if the widget were a metric.
    expect(screen.getByTestId('widget-prop-type').textContent).toBe('area');
    const listed = await openPicker('widget-prop-type');
    expect(listed.map((o) => o.textContent)).toEqual(['area', ...TYPE_LABELS]);
    fireEvent.click(listed[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a `metric-card` entry shows its own type, not "KPI Metric"', () => {
    open({ id: 'c1', type: 'metric-card', title: 'Revenue', value: '$24k' });
    expect(screen.getByTestId('widget-prop-type').textContent).toBe('metric-card');
  });

  it('a stored color variant the list does not offer is shown, not "Default"', () => {
    open({ ...ONE, colorVariant: 'crimson' as unknown as DashboardWidgetSchema['colorVariant'] });
    expect(screen.getByTestId('widget-prop-color').textContent).toBe('crimson');
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens a picker and Enter on an option selects it', async () => {
    const { onChange } = open(ONE);
    fireEvent.keyDown(screen.getByTestId('widget-prop-type'), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Line Chart' }), { key: 'Enter' });
    expectWrote(onChange, ONE_AS('line'));
  });
});
