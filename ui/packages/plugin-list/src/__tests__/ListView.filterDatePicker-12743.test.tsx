/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12743 — the console list toolbar's Filter panel draws the platform
 * date picker on a `date` / `datetime` row.
 *
 * Driven on the real `ListView` toolbar → `FilterBuilder` path, with
 * `@object-ui/fields` registered as the console registers it (the data source
 * is the only fake). `FilterBuilder` lives in `@object-ui/components`, which
 * cannot import `@object-ui/fields`; it resolves the `field:date` /
 * `field:datetime` widget the host registered, so the picker arrives through
 * its own lazy chunk.
 *
 * Pinned:
 * - (a) a date row draws the picker, not `input[type=date]`; in a `zh`
 *   session its placeholder and digit order are `YYYY/MM/DD`;
 * - (b) a typed day + Enter, + blur, and + a press outside the panel (which
 *   closes it) each apply the filter with `YYYY-MM-DD`;
 * - (c) a datetime row writes the zoneless local `YYYY-MM-DDTHH:mm` the
 *   native `datetime-local` input wrote;
 * - (d) CONTROL: a text and a number row draw the inputs they drew before.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ListView } from '../ListView';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  // Radix popover uses pointer capture; the DOM test environment lacks these.
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
  if (!(Element.prototype as any).releasePointerCapture) {
    (Element.prototype as any).releasePointerCapture = () => {};
  }
});

const OBJECT = 'os_task_12743';

const FIELDS: Record<string, Record<string, unknown>> = {
  name: { type: 'text', label: 'Name' },
  amount: { type: 'number', label: 'Amount' },
  due: { type: 'date', label: 'Due' },
  remind_at: { type: 'datetime', label: 'Remind at' },
};

type Row = { id: string; field: string; operator: string; value: unknown };

function mount(conditions: Row[], language?: string) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT, fields: FIELDS }),
  };
  const onFilterChange = vi.fn();
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: Object.entries(FIELDS).map(([field, def]) => ({ field, label: def.label as string })),
    compactToolbar: false,
  } as unknown as ListViewSchema;
  const list = (
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <div>
        <button type="button" data-testid="outside">outside</button>
        <ListView
          schema={schema}
          dataSource={dataSource as unknown as DataSource}
          initialFilters={{ id: 'root', logic: 'and', conditions } as any}
          onFilterChange={onFilterChange}
        />
      </div>
    </SchemaRendererProvider>
  );
  render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        {list}
      </I18nProvider>
    ) : (
      list
    ),
  );
  return { dataSource, onFilterChange };
}

/** Open the toolbar's Filter panel once the definition has loaded. */
async function openFilterPanel(dataSource: { getObjectSchema: ReturnType<typeof vi.fn> }): Promise<HTMLElement> {
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  fireEvent.click(await screen.findByTestId('toolbar-filter-trigger'));
  return screen.findByRole('dialog');
}

/** The lazily loaded picker's text box inside the panel. */
async function findPicker(panel: HTMLElement): Promise<HTMLInputElement> {
  return waitFor(
    () => {
      const input = panel.querySelector('[data-slot="date-picker"] input');
      if (!input) throw new Error('date picker not rendered');
      return input as HTMLInputElement;
    },
    { timeout: 5000 },
  );
}

function typeInto(input: HTMLInputElement, text: string) {
  input.focus();
  fireEvent.change(input, { target: { value: text } });
}

const lastRows = (onFilterChange: ReturnType<typeof vi.fn>) =>
  (onFilterChange.mock.calls.at(-1)?.[0] as { conditions: Row[] }).conditions;

const DUE_ROW: Row = { id: 'c1', field: 'due', operator: 'equals', value: '' };

describe('ListView Filter panel — date / datetime rows draw the platform picker (objectui#12743)', () => {
  it('(a) a date row draws the picker, not input[type=date]', async () => {
    const { dataSource } = mount([{ ...DUE_ROW, value: '2026-10-01' }]);
    const panel = await openFilterPanel(dataSource);
    const input = await findPicker(panel);
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('MM/DD/YYYY');
    expect(input.value).toBe('10/01/2026');
    expect(panel.querySelector('input[type="date"]')).toBeNull();
  });

  it('(a) zh session: placeholder and digit order come from the console locale', async () => {
    const { dataSource } = mount([{ ...DUE_ROW, value: '2026-10-01' }], 'zh');
    const panel = await openFilterPanel(dataSource);
    const input = await findPicker(panel);
    expect(input.placeholder).toBe('YYYY/MM/DD');
    expect(input.value).toBe('2026/10/01');
  });

  it('(b) typed day + Enter applies the filter with YYYY-MM-DD', async () => {
    const { dataSource, onFilterChange } = mount([DUE_ROW]);
    const panel = await openFilterPanel(dataSource);
    const input = await findPicker(panel);
    typeInto(input, '10/20/2026');
    expect(onFilterChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lastRows(onFilterChange)[0].value).toBe('2026-10-20');
  });

  it('(b) typed day + blur applies the filter with YYYY-MM-DD', async () => {
    const { dataSource, onFilterChange } = mount([DUE_ROW]);
    const panel = await openFilterPanel(dataSource);
    const input = await findPicker(panel);
    typeInto(input, '10/20/2026');
    fireEvent.blur(input);
    expect(lastRows(onFilterChange)[0].value).toBe('2026-10-20');
  });

  it('(b) typed day + a press outside the panel: the panel closes and the day is applied', async () => {
    const { dataSource, onFilterChange } = mount([DUE_ROW]);
    const panel = await openFilterPanel(dataSource);
    const input = await findPicker(panel);
    typeInto(input, '10/20/2026');
    // A press outside: Radix's popover dismisses on the click that follows the
    // pointerdown. `fireEvent` moves no focus, so only the editor's capture
    // listener (the pointerdown blur) can have read the typed text.
    const outside = screen.getByTestId('outside');
    fireEvent.pointerDown(outside);
    fireEvent.click(outside);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(lastRows(onFilterChange)[0].value).toBe('2026-10-20');
  });

  it('(c) a datetime row writes the zoneless local YYYY-MM-DDTHH:mm, as datetime-local did', async () => {
    const { dataSource, onFilterChange } = mount([
      { id: 'c1', field: 'remind_at', operator: 'equals', value: '2026-10-01T09:15' },
    ]);
    const panel = await openFilterPanel(dataSource);
    const input = await findPicker(panel);
    expect(input.value).toBe('10/01/2026, 09:15 AM');
    typeInto(input, '10/20/2026 14:30');
    fireEvent.blur(input);
    expect(lastRows(onFilterChange)[0].value).toBe('2026-10-20T14:30');
  });

  it('(d) CONTROL: text and number rows draw the inputs they drew before', async () => {
    const { dataSource } = mount([
      { id: 'c1', field: 'name', operator: 'equals', value: 'acme' },
      { id: 'c2', field: 'amount', operator: 'equals', value: 5 },
    ]);
    const panel = await openFilterPanel(dataSource);
    await waitFor(() => expect(within(panel).getByDisplayValue('acme')).toBeInTheDocument());
    expect(within(panel).getByDisplayValue('acme')).toHaveAttribute('type', 'text');
    expect(within(panel).getByDisplayValue('5')).toHaveAttribute('type', 'number');
    expect(panel.querySelector('[data-slot="date-picker"]')).toBeNull();
  });
});
