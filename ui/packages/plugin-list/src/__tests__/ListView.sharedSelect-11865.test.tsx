/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ListView's "Color by field" and its rows-per-page fallback selector pick
 * with the shared `Select` (objectui#11865).
 *
 * Both were browser-native selects beside the shared Radix `Select` the rest
 * of the console picks with. The card asks for one control for one kind of
 * choice, surface by surface.
 *
 * What is pinned, for each:
 *   - it IS the primitive (a Radix combobox trigger, still found by its test
 *     id), shows the value in force and lists the native control's options in
 *     their order;
 *   - every option writes what the native control wrote, compared as JSON
 *     text: the row-colour config the view hands its grid, over four configs
 *     (none, a field with colours, a field with no colours, a field none of
 *     the options carries); the page size handed to `onPageSizeChange` and
 *     fetched as `$top`, over three paginations. "None" (the option whose
 *     value is `''`) clears the config as before. Re-picking the current
 *     option writes nothing;
 *   - a value none of the options carries is what the trigger shows;
 *   - the keyboard alone opens the picker and selects.
 *
 * "Color by field" is the twin of `ViewSettingsPopover`'s `ColorFieldPicker`
 * (its own pin is `ViewSettingsPopover.sharedSelect-11865.test.tsx`): the two
 * draw an outside value and "None" the same way. That a rule on a field the
 * caller may not read never reaches the outside item is pinned with the
 * field-read pin, `ListView.fieldListRead-11984.test.tsx`.
 *
 * Neither picker has a name: neither native control had one (the colour
 * label has no `htmlFor`, the "Rows per page" text is a `span`, and neither
 * had an `aria-label`), so there is no name to keep. Neither surface has a
 * read-only state.
 *
 * DIRECTION, observed against the native controls: every pin here reads the
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
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

afterEach(() => cleanup());

/** The row-colour config the view last handed its grid. */
let gridRowColor: unknown;
ComponentRegistry.register(
  'object-grid',
  (props: { schema?: { rowColor?: unknown } }) => {
    gridRowColor = props.schema?.rowColor;
    return <div data-testid="grid-spy" />;
  },
  { namespace: 'test', label: 'Grid spy', category: 'view' },
);

const OBJECT = 'pin_ticket';
const FIELDS: Record<string, Record<string, unknown>> = {
  title: { type: 'text', label: 'Title' },
  status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
  priority: { type: 'number', label: 'Priority' },
};
const COLUMNS = Object.entries(FIELDS).map(([field, def]) => ({ field, label: def.label as string }));

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', title: 'a', name: 'Alice' }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT, fields: FIELDS }),
  };
}

function mount(schemaExtra: Record<string, unknown>, props: Record<string, unknown> = {}) {
  const dataSource = makeDataSource();
  const schema = { type: 'list-view', objectName: OBJECT, ...schemaExtra } as unknown as ListViewSchema;
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema }} dataSource={dataSource as unknown as DataSource} {...props} />
    </SchemaRendererProvider>,
  );
  return dataSource;
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

// ---------------------------------------------------------------------------
// "Color by field"
// ---------------------------------------------------------------------------

type RowColor = { field: string; colors?: Record<string, string> } | undefined;

const CONFIGS: Record<string, RowColor> = {
  none: undefined,
  status: { field: 'status', colors: { open: 'red' } },
  priority: { field: 'priority' },
  ghost: { field: 'ghost', colors: { x: 'blue' } },
};

/** Mount a grid list holding `config`, open the Color popover, return its picker. */
async function colorPicker(config: RowColor): Promise<HTMLElement> {
  mount({ viewType: 'grid', columns: COLUMNS, userActions: { rowColor: true }, ...(config ? { rowColor: config } : {}) });
  await screen.findByTestId('grid-spy');
  fireEvent.click(screen.getByRole('button', { name: /^color/i }));
  return screen.findByTestId('color-field-select');
}

/**
 * [config, option label, what the native control wrote]. `null` marks the
 * current option: re-picking it writes nothing. `UNDEFINED` is the config
 * cleared.
 */
const COLOR_WRITES: ReadonlyArray<readonly [string, string, string | null]> = [
  ['none', 'None', null],
  ['none', 'Title', '{"field":"title","colors":{}}'],
  ['none', 'Status', '{"field":"status","colors":{}}'],
  ['none', 'Priority', '{"field":"priority","colors":{}}'],
  ['status', 'None', 'UNDEFINED'],
  ['status', 'Title', '{"field":"title","colors":{"open":"red"}}'],
  ['status', 'Status', null],
  ['status', 'Priority', '{"field":"priority","colors":{"open":"red"}}'],
  ['priority', 'None', 'UNDEFINED'],
  ['priority', 'Title', '{"field":"title","colors":{}}'],
  ['priority', 'Status', '{"field":"status","colors":{}}'],
  ['priority', 'Priority', null],
  ['ghost', 'None', 'UNDEFINED'],
  ['ghost', 'Title', '{"field":"title","colors":{"x":"blue"}}'],
  ['ghost', 'Status', '{"field":"status","colors":{"x":"blue"}}'],
  ['ghost', 'Priority', '{"field":"priority","colors":{"x":"blue"}}'],
];

describe('ListView — "Color by field" is the shared Select (objectui#11865)', () => {
  it('is the primitive, shows the configured field, and lists the native options in order', async () => {
    const trigger = await colorPicker(CONFIGS.status);
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger.textContent).toBe('Status');
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['None', 'Title', 'Status', 'Priority']);
  });

  it.each([
    ['none', 'None'],
    ['priority', 'Priority'],
  ] as const)('with config "%s" the trigger shows "%s"', async (config, shown) => {
    expect((await colorPicker(CONFIGS[config])).textContent).toBe(shown);
  });

  it.each(COLOR_WRITES)('config "%s", picking "%s" writes what the native control wrote', async (config, label, json) => {
    const trigger = await colorPicker(CONFIGS[config]);
    const before = gridRowColor;
    await pick(trigger, label);
    if (json === null) {
      // Nothing was written: the grid still holds the very config it mounted with.
      expect(gridRowColor).toBe(before);
    } else {
      expect(gridRowColor === undefined ? 'UNDEFINED' : JSON.stringify(gridRowColor)).toBe(json);
    }
  });

  it('a field none of the options carries is what the trigger shows, and re-picking it writes nothing', async () => {
    const trigger = await colorPicker(CONFIGS.ghost);
    // The native control showed "None" here.
    expect(trigger.textContent).toBe('ghost');
    const before = gridRowColor;
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['ghost', 'None', 'Title', 'Status', 'Priority']);
    fireEvent.click(options[0]);
    expect(gridRowColor).toBe(before);
  });

  it('Enter opens the picker and Enter on a field selects it', async () => {
    const trigger = await colorPicker(CONFIGS.none);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Status' }), { key: 'Enter' });
    expect(JSON.stringify(gridRowColor)).toBe('{"field":"status","colors":{}}');
  });
});

// ---------------------------------------------------------------------------
// The rows-per-page fallback selector
// ---------------------------------------------------------------------------

const PAGINATIONS: Record<string, Record<string, unknown>> = {
  declared25: { pageSize: 25, pageSizeOptions: [10, 25, 50, 100] },
  // No declared size: an unpaged view fetches its default batch (100), which
  // is not one of the options.
  undeclared: { pageSizeOptions: [10, 25, 50] },
  declared7: { pageSize: 7, pageSizeOptions: [10, 25] },
};

/** Mount a gallery list (no DataTable pager) with `pagination`, return its selector. */
async function sizePicker(pagination: Record<string, unknown>) {
  const onPageSizeChange = vi.fn();
  const dataSource = mount({ viewType: 'gallery', fields: ['name'], pagination }, { onPageSizeChange });
  const trigger = await screen.findByTestId('page-size-selector');
  return { trigger, onPageSizeChange, dataSource };
}

const lastTop = (dataSource: ReturnType<typeof makeDataSource>) => dataSource.find.mock.calls.at(-1)?.[1]?.$top;

/**
 * [pagination, option label, what the native control handed `onPageSizeChange`].
 * `null` marks the size in force: re-picking it writes nothing.
 */
const SIZE_WRITES: ReadonlyArray<readonly [string, string, string | null]> = [
  ['declared25', '10', '[[10]]'],
  ['declared25', '25', null],
  ['declared25', '50', '[[50]]'],
  ['declared25', '100', '[[100]]'],
  ['undeclared', '10', '[[10]]'],
  ['undeclared', '25', '[[25]]'],
  ['undeclared', '50', '[[50]]'],
  ['declared7', '10', '[[10]]'],
  ['declared7', '25', '[[25]]'],
];

describe('ListView — the rows-per-page selector is the shared Select (objectui#11865)', () => {
  it('is the primitive, shows the size in force, and lists the native options in order', async () => {
    const { trigger } = await sizePicker(PAGINATIONS.declared25);
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger.textContent).toBe('25');
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['10', '25', '50', '100']);
  });

  it.each(SIZE_WRITES)('pagination "%s", picking "%s" writes what the native control wrote', async (pagination, label, json) => {
    const { trigger, onPageSizeChange, dataSource } = await sizePicker(PAGINATIONS[pagination]);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const fetches = dataSource.find.mock.calls.length;
    await pick(trigger, label);
    if (json === null) {
      expect(onPageSizeChange).not.toHaveBeenCalled();
      expect(dataSource.find.mock.calls.length).toBe(fetches);
    } else {
      expect(JSON.stringify(onPageSizeChange.mock.calls)).toBe(json);
      // The list refetches at the picked size, as before.
      await waitFor(() => expect(lastTop(dataSource)).toBe(Number(label)));
    }
  });

  it.each([
    ['undeclared', '100', ['100', '10', '25', '50']],
    ['declared7', '7', ['7', '10', '25']],
  ] as const)('pagination "%s": the size in force, %s, is what the trigger shows, and re-picking it writes nothing', async (pagination, inForce, listed) => {
    const { trigger, onPageSizeChange, dataSource } = await sizePicker(PAGINATIONS[pagination]);
    // The native control showed its first option, "10", here.
    expect(trigger.textContent).toBe(inForce);
    await waitFor(() => expect(lastTop(dataSource)).toBe(Number(inForce)));
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(listed);
    fireEvent.click(options[0]);
    expect(onPageSizeChange).not.toHaveBeenCalled();
  });

  it('Enter opens the selector and Enter on a size selects it', async () => {
    const { trigger, onPageSizeChange } = await sizePicker(PAGINATIONS.declared25);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: '50' }), { key: 'Enter' });
    expect(onPageSizeChange.mock.calls).toEqual([[50]]);
  });
});
