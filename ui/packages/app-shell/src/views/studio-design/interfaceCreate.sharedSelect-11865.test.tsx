// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Interfaces pillar's create form picks with the shared `Select`
 * (objectui#11865).
 *
 * *New page* asked for the page's source kind, and *New report* for its
 * dataset and one of that dataset's measures, with browser-native selects,
 * beside the shared Radix `Select` the rest of Studio picks with. The card asks
 * for one control for one kind of choice, surface by surface; this suite
 * covers the create form's three pickers (`PageCreateFields`,
 * `ReportCreateFields`).
 *
 * What is pinned:
 *   - each picker IS the primitive (a Radix combobox trigger), shows the
 *     form's value, and no native select is left;
 *   - each picker keeps the name its wrapping label gave the native control;
 *   - every option of every picker writes the `onChange` value the native
 *     control wrote, compared as JSON text, the "Choose a dataset…" and
 *     "Choose a measure…" options included (each writes its key as `''`);
 *   - re-picking the current option writes nothing;
 *   - a value no option carries is what the trigger shows;
 *   - the keyboard alone opens a picker and selects.
 *
 * Read-only: the form has no such state. A read-only package offers no create
 * entry, so the dialog never opens there; the pillar suites pin that ("a
 * read-only package shows no create entry", "a read-only package shows no New
 * menu").
 *
 * DIRECTION, observed against the native control: every pin here but the
 * name pin is red there, because each one reads the pickers as the
 * primitive's triggers. The name pin is green there too: it pins what the
 * conversion kept. What makes the write pins guards of "the conversion
 * changed nothing the form writes" is the literal each compares against: a
 * `change` event on the pre-conversion form's native control wrote that same
 * JSON, read once on that component with these fixtures. The names were read
 * there the same way. That probe's `change` event fired for the current
 * option too, which a browser's native select does not do, so the re-pick
 * rows pin the primitive.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CAP_REACT_PAGES, disableCapability, enableCapability } from '@object-ui/core';

let datasets: Array<Record<string, unknown>>;
const mockClient = {
  list: vi.fn(async () => datasets),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { PageCreateFields, ReportCreateFields, type PageSourceKind, type ReportBinding } from './interfaceCreate';
import { t } from '../metadata-admin/i18n';

const en = (key: string) => t(key, 'en-US');

beforeEach(() => {
  datasets = [
    {
      name: 'orders_ds',
      label: 'Orders',
      measures: [{ name: 'revenue', label: 'Revenue' }, { name: 'order_count' }],
      dimensions: [{ name: 'region' }],
    },
    {
      name: 'tickets_ds',
      label: 'Tickets',
      description: 'Support tickets',
      measures: [{ name: 'ticket_count' }],
      dimensions: [],
    },
  ];
});
afterEach(() => {
  cleanup();
  enableCapability(CAP_REACT_PAGES);
});

const DATASET_PLACEHOLDER = en('engine.studio.interfaces.create.datasetPlaceholder');
const MEASURE_PLACEHOLDER = en('engine.studio.interfaces.create.measurePlaceholder');
const HTML = en('engine.studio.interfaces.create.pageKindHtml');
const REACT = en('engine.studio.interfaces.create.pageKindReact');

function renderPage(value: PageSourceKind = 'html') {
  const onChange = vi.fn();
  const utils = render(<PageCreateFields value={value} onChange={onChange} locale="en-US" />);
  return { ...utils, onChange };
}

async function renderReport(value: ReportBinding) {
  const onChange = vi.fn();
  const utils = render(<ReportCreateFields value={value} onChange={onChange} locale="en-US" />);
  await screen.findByTestId('create-report-dataset');
  if (value.dataset !== '' && datasets.some((d) => d.name === value.dataset)) {
    await screen.findByTestId('create-report-measure');
  }
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

describe('the create form pickers are the shared Select (objectui#11865)', () => {
  it('renders each picker as the Radix combobox trigger, showing the form’s value', async () => {
    const page = renderPage();
    expect(page.container.querySelector('select')).toBeNull();
    const kind = screen.getByTestId('create-page-kind');
    expect(kind.tagName).toBe('BUTTON');
    expect(kind).toHaveAttribute('role', 'combobox');
    expect(kind).toHaveTextContent(HTML);
    cleanup();

    const report = await renderReport({ dataset: 'orders_ds', measure: '' });
    expect(report.container.querySelector('select')).toBeNull();
    const shown: Record<string, string> = {};
    for (const id of ['create-report-dataset', 'create-report-measure']) {
      const trigger = screen.getByTestId(id);
      expect(trigger.tagName, id).toBe('BUTTON');
      expect(trigger, id).toHaveAttribute('role', 'combobox');
      shown[id] = trigger.textContent ?? '';
    }
    expect(shown).toEqual({
      'create-report-dataset': 'Orders (orders_ds)',
      'create-report-measure': MEASURE_PLACEHOLDER,
    });
  });

  it('a report form opens on "Choose a dataset…", with no measure picker yet', async () => {
    await renderReport({ dataset: '', measure: '' });
    expect(screen.getByTestId('create-report-dataset').textContent).toBe(DATASET_PLACEHOLDER);
    expect(screen.queryByTestId('create-report-measure')).toBeNull();
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('each picker keeps the name its label gave the native control', async () => {
    renderPage();
    expect(screen.getByRole('combobox', { name: en('engine.studio.interfaces.create.pageKind') })).toBe(
      screen.getByTestId('create-page-kind'),
    );
    cleanup();

    await renderReport({ dataset: 'orders_ds', measure: '' });
    expect(screen.getByRole('combobox', { name: en('engine.studio.interfaces.create.dataset') })).toBe(
      screen.getByTestId('create-report-dataset'),
    );
    expect(screen.getByRole('combobox', { name: en('engine.studio.interfaces.create.measure') })).toBe(
      screen.getByTestId('create-report-measure'),
    );
  });
});

/**
 * [the value the form holds, option label, the JSON text of the value
 * `onChange` received]. `null`: nothing is written — the option is the
 * current one.
 */
const PAGE_WRITES: ReadonlyArray<readonly [PageSourceKind, string, string | null]> = [
  ['html', HTML, null],
  ['html', REACT, '"react"'],
  ['react', HTML, '"html"'],
  ['react', REACT, null],
];

const DATASET_WRITES: ReadonlyArray<readonly [ReportBinding, string, string | null]> = [
  [{ dataset: '', measure: '' }, DATASET_PLACEHOLDER, null],
  [{ dataset: '', measure: '' }, 'Orders (orders_ds)', '{"dataset":"orders_ds","measure":""}'],
  [{ dataset: '', measure: '' }, 'Tickets (tickets_ds) — Support tickets', '{"dataset":"tickets_ds","measure":""}'],
  [{ dataset: 'orders_ds', measure: 'revenue' }, DATASET_PLACEHOLDER, '{"dataset":"","measure":""}'],
  [{ dataset: 'orders_ds', measure: 'revenue' }, 'Orders (orders_ds)', null],
  [
    { dataset: 'orders_ds', measure: 'revenue' },
    'Tickets (tickets_ds) — Support tickets',
    '{"dataset":"tickets_ds","measure":""}',
  ],
];

const MEASURE_WRITES: ReadonlyArray<readonly [ReportBinding, string, string | null]> = [
  [{ dataset: 'orders_ds', measure: '' }, MEASURE_PLACEHOLDER, null],
  [{ dataset: 'orders_ds', measure: '' }, 'Revenue (revenue)', '{"dataset":"orders_ds","measure":"revenue"}'],
  [{ dataset: 'orders_ds', measure: '' }, 'order_count', '{"dataset":"orders_ds","measure":"order_count"}'],
  [{ dataset: 'orders_ds', measure: 'revenue' }, MEASURE_PLACEHOLDER, '{"dataset":"orders_ds","measure":""}'],
  [{ dataset: 'orders_ds', measure: 'revenue' }, 'Revenue (revenue)', null],
  [{ dataset: 'orders_ds', measure: 'revenue' }, 'order_count', '{"dataset":"orders_ds","measure":"order_count"}'],
];

function expectWrote(onChange: ReturnType<typeof vi.fn>, json: string | null): void {
  if (json === null) {
    expect(onChange).not.toHaveBeenCalled();
    return;
  }
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(onChange.mock.calls[0][0])).toBe(json);
}

describe('every option writes what the native control wrote', () => {
  it('each picker lists its options in the order the native control did', async () => {
    renderPage();
    expect((await openPicker('create-page-kind')).map((o) => o.textContent)).toEqual([HTML, REACT]);
    cleanup();

    await renderReport({ dataset: 'orders_ds', measure: '' });
    expect((await openPicker('create-report-dataset')).map((o) => o.textContent)).toEqual([
      DATASET_PLACEHOLDER,
      'Orders (orders_ds)',
      'Tickets (tickets_ds) — Support tickets',
    ]);
    cleanup();

    await renderReport({ dataset: 'orders_ds', measure: '' });
    expect((await openPicker('create-report-measure')).map((o) => o.textContent)).toEqual([
      MEASURE_PLACEHOLDER,
      'Revenue (revenue)',
      'order_count',
    ]);
  });

  it('the page kind offers html alone where react pages are turned off', async () => {
    disableCapability(CAP_REACT_PAGES);
    renderPage();
    expect((await openPicker('create-page-kind')).map((o) => o.textContent)).toEqual([HTML]);
  });

  it.each(PAGE_WRITES.map((row) => [`page kind ${row[0]} → ${row[1]}`, ...row] as const))(
    '%s',
    async (_name, value, label, json) => {
      const { onChange } = renderPage(value);
      await pick('create-page-kind', label);
      expectWrote(onChange, json);
    },
  );

  it.each(DATASET_WRITES.map((row) => [`dataset ${JSON.stringify(row[0])} → ${row[1]}`, ...row] as const))(
    '%s',
    async (_name, value, label, json) => {
      const { onChange } = await renderReport(value);
      await pick('create-report-dataset', label);
      expectWrote(onChange, json);
    },
  );

  it.each(MEASURE_WRITES.map((row) => [`measure ${JSON.stringify(row[0])} → ${row[1]}`, ...row] as const))(
    '%s',
    async (_name, value, label, json) => {
      const { onChange } = await renderReport(value);
      await pick('create-report-measure', label);
      expectWrote(onChange, json);
    },
  );
});

describe('a value no option carries is what the trigger shows', () => {
  it('a dataset the catalog does not list: shown and listed first, and re-picking it writes nothing', async () => {
    const { onChange } = await renderReport({ dataset: 'ghost_ds', measure: '' });
    // The native control showed "Choose a dataset…" here, as if no dataset were chosen.
    expect(screen.getByTestId('create-report-dataset').textContent).toBe('ghost_ds');
    const listed = (await openPicker('create-report-dataset')).map((o) => o.textContent);
    expect(listed).toEqual([
      'ghost_ds',
      DATASET_PLACEHOLDER,
      'Orders (orders_ds)',
      'Tickets (tickets_ds) — Support tickets',
    ]);
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a measure the dataset does not have is shown, not "Choose a measure…"', async () => {
    await renderReport({ dataset: 'orders_ds', measure: 'ghost_measure' });
    expect(screen.getByTestId('create-report-measure').textContent).toBe('ghost_measure');
  });

  it('a react page kind where react pages are turned off is shown, not "HTML"', () => {
    disableCapability(CAP_REACT_PAGES);
    renderPage('react');
    expect(screen.getByTestId('create-page-kind').textContent).toBe('react');
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens a picker and Enter on an option selects it', async () => {
    const { onChange } = await renderReport({ dataset: 'orders_ds', measure: '' });
    fireEvent.keyDown(screen.getByTestId('create-report-measure'), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Revenue (revenue)' }), { key: 'Enter' });
    expectWrote(onChange, '{"dataset":"orders_ds","measure":"revenue"}');
  });
});
