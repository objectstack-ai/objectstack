/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The view-settings popover's "Color by field" picks with the shared `Select`
 * (objectui#11865).
 *
 * The control was a browser-native select beside the shared Radix `Select`
 * the rest of the console picks with. The card asks for one control for one
 * kind of choice, surface by surface.
 *
 * What is pinned:
 *   - it IS the primitive (a Radix combobox trigger, still found by its test
 *     id), shows the configured field and lists the native control's options
 *     in its order;
 *   - every option writes what the native control wrote, compared as JSON
 *     text, over four row-colour configs: none, a field with colours, a field
 *     with no colours, and a field none of the options carries; "None" (the
 *     option whose value is `''`) clears the config as before; re-picking the
 *     current option writes nothing;
 *   - a field none of the options carries is what the trigger shows;
 *   - the keyboard alone opens the picker and selects.
 *
 * The picker has no name: the native control had none either (its label has
 * no `htmlFor`, and it had no `aria-label`), so there is no name to keep. The
 * popover has no read-only state.
 *
 * DIRECTION, observed against the native control: every pin here reads the
 * control as the primitive's trigger, so each is red there. What makes the
 * write rows guards of "the conversion changed nothing the view writes" is
 * the literal each compares against: a `change` event on the pre-conversion
 * native control wrote that same JSON, read once on this component with these
 * fixtures. That probe's `change` event fired for the current option too,
 * which a browser's native select does not do, so the re-pick rows pin the
 * primitive.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ViewSettingsPopover } from '../components/ViewSettingsPopover';

afterEach(() => cleanup());

const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;

const FIELDS = [{ name: 'status', label: 'Status' }, { name: 'owner' }];

type RowColor = { field: string; colors?: Record<string, string> } | undefined;

const CONFIGS: Record<string, RowColor> = {
  none: undefined,
  status: { field: 'status', colors: { high: 'red' } },
  owner: { field: 'owner' },
  ghost: { field: 'ghost', colors: { x: 'blue' } },
};

function renderPopover(config: RowColor) {
  const setRowColorConfig = vi.fn();
  render(
    <ViewSettingsPopover
      t={t}
      allFields={FIELDS}
      showColor
      rowColorConfig={config}
      setRowColorConfig={setRowColorConfig}
    />,
  );
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  // With no config the section starts collapsed, as it did with the native control.
  if (!config) fireEvent.click(screen.getByRole('button', { name: 'Row Color' }));
  return { setRowColorConfig, trigger: screen.getByTestId('color-field-select') };
}

async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const options = await openPicker(trigger);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`the picker lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

/** What one call wrote, as JSON text; `undefined` (the config cleared) is spelled out. */
const written = (calls: unknown[][]) => calls.map((c) => (c[0] === undefined ? 'UNDEFINED' : JSON.stringify(c[0])));

/**
 * [config, option label, what the native control wrote]. `null` marks the
 * current option: re-picking it writes nothing.
 */
const WRITES: ReadonlyArray<readonly [string, string, string | null]> = [
  ['none', 'None', null],
  ['none', 'Status', '{"field":"status","colors":{}}'],
  ['none', 'owner', '{"field":"owner","colors":{}}'],
  ['status', 'None', 'UNDEFINED'],
  ['status', 'Status', null],
  ['status', 'owner', '{"field":"owner","colors":{"high":"red"}}'],
  ['owner', 'None', 'UNDEFINED'],
  ['owner', 'Status', '{"field":"status","colors":{}}'],
  ['owner', 'owner', null],
  ['ghost', 'None', 'UNDEFINED'],
  ['ghost', 'Status', '{"field":"status","colors":{"x":"blue"}}'],
  ['ghost', 'owner', '{"field":"owner","colors":{"x":"blue"}}'],
];

describe('ViewSettingsPopover — "Color by field" is the shared Select (objectui#11865)', () => {
  it('is the primitive, shows the configured field, and lists the native options in order', async () => {
    const { trigger } = renderPopover(CONFIGS.status);
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger.textContent).toBe('Status');
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['None', 'Status', 'owner']);
  });

  it.each([
    ['none', 'None'],
    ['owner', 'owner'],
  ] as const)('with config "%s" the trigger shows "%s"', (config, shown) => {
    expect(renderPopover(CONFIGS[config]).trigger.textContent).toBe(shown);
  });

  it.each(WRITES)('config "%s", picking "%s" writes what the native control wrote', async (config, label, json) => {
    const { setRowColorConfig, trigger } = renderPopover(CONFIGS[config]);
    await pick(trigger, label);
    expect(written(setRowColorConfig.mock.calls)).toEqual(json === null ? [] : [json]);
  });

  it('a field none of the options carries is what the trigger shows, and re-picking it writes nothing', async () => {
    const { setRowColorConfig, trigger } = renderPopover(CONFIGS.ghost);
    // The native control showed "None" here.
    expect(trigger.textContent).toBe('ghost');
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['ghost', 'None', 'Status', 'owner']);
    fireEvent.click(options[0]);
    expect(setRowColorConfig).not.toHaveBeenCalled();
  });

  it('Enter opens the picker and Enter on a field selects it', async () => {
    const { setRowColorConfig, trigger } = renderPopover(CONFIGS.none);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Status' }), { key: 'Enter' });
    expect(written(setRowColorConfig.mock.calls)).toEqual(['{"field":"status","colors":{}}']);
  });
});
