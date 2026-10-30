// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27785 — the Interfaces pillar holds a report unsent while an item
 * just added to one of its list properties, or a chart whose type was picked
 * before its axes, is unfinished, instead of autosaving it for the draft door
 * to refuse.
 *
 * The card: Order → "Add item" sent `order: [{}]` (422 `order.0.by`), a joined
 * report's Blocks → "Add item" sent `blocks: [{}]` (422), and a chart type
 * picked first sent `chart: { type }` (422 `chart.xAxis` / `chart.yAxis`).
 * Every later save carried the same body and was refused too. The pillar now
 * holds the report as it holds the dashboard's list items (objectstack#27459):
 * nothing is sent, a neutral line names the input with a "Show me", and
 * filling it in lets the next autosave send every edit kept meanwhile.
 *
 * Mounted with a metadata client double that records every save, a stub
 * canvas and the real `ReportDefaultInspector` (its spec-driven form and its
 * own chart panel).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportSchema } from '@objectstack/spec/ui';

const NAV = [{ id: 'nav_rep', type: 'report', label: 'Sales report', reportName: 'sales_report' }];

const SUMMARY_REPORT = {
  name: 'sales_report',
  label: 'Sales report',
  type: 'summary',
  dataset: 'sales_ds',
  rows: ['stage'],
  values: ['revenue'],
};

const JOINED_REPORT = {
  name: 'sales_report',
  label: 'Sales report',
  type: 'joined',
  blocks: [{ name: 'won', dataset: 'sales_ds' }],
};

const DATASETS = [
  {
    name: 'sales_ds',
    label: 'Sales',
    object: 'opportunity',
    dimensions: [{ name: 'stage', label: 'Stage' }],
    measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum' }],
  },
];

/** The report the pillar opens, as served: it parses with the spec. */
let stored: Record<string, unknown> = SUMMARY_REPORT;

const mockClient = {
  withPreviewDrafts: vi.fn((): unknown => mockClient),
  save: vi.fn(async (_type: string, _name: string, _body: Record<string, unknown>) => ({
    success: true,
    version: 'v1',
    state: 'draft',
  })),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'dataset') return DATASETS;
    if (type === 'report') return [stored];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', active: true, navigation: NAV } };
    if (type === 'report') return { effective: JSON.parse(JSON.stringify(stored)) };
    return { code: null, overlay: null, overlayScope: null, effective: null };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async (type: string, name: string) =>
    type === 'dataset' ? DATASETS.find((d) => d.name === name) : undefined,
  ),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { ReportDefaultInspector } from '../metadata-admin/inspectors/ReportDefaultInspector';
import { t, tFormat } from '../metadata-admin/i18n';

// A stub canvas: the leaf needs a registered preview to be draft-editable,
// and the canvas's own drawing is not what this file pins.
registerMetadataPreview('report', () => null);
registerMetadataDefaultInspector('report', ReportDefaultInspector);

beforeEach(() => {
  stored = SUMMARY_REPORT;
  for (const fn of Object.values(mockClient)) fn.mockClear();
});
afterEach(cleanup);

const L = (key: string) => t(key, 'en');

function mountPillar(onHeldEditChange?: (clause: string | null) => void) {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" onHeldEditChange={onHeldEditChange} />
    </MemoryRouter>,
  );
}

function reportSaves(): Array<Record<string, unknown>> {
  return mockClient.save.mock.calls.filter((c) => c[0] === 'report').map((c) => c[2]);
}

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

/** The report's properties are open, with the list property labelled `list` drawn. */
async function ready(list: string): Promise<HTMLElement> {
  const inspector = await screen.findByTestId('if-inspector', undefined, { timeout: 8000 });
  await within(inspector).findByText(list, { selector: 'label' }, { timeout: 8000 });
  return inspector;
}

/** The form row of the list property labelled `label`: its label and its repeater. */
function listRow(inspector: HTMLElement, label: string): HTMLElement {
  const row = within(inspector).getByText(label, { selector: 'label' }).parentElement?.parentElement;
  if (!row) throw new Error(`no form row for ${label}`);
  return row;
}

/** The report's own Label input. */
function editLabel(inspector: HTMLElement, value: string): void {
  const input = within(inspector).getByLabelText(L('engine.inspector.report.label'));
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

/** Picks `option` in the inspector select labelled `label`. */
async function pick(inspector: HTMLElement, label: string, option: string | RegExp): Promise<void> {
  fireEvent.keyDown(within(inspector).getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

const orderClause = tFormat('engine.studio.held.listItemNeedsInput', 'en', { input: 'Order By', n: 1, list: 'Order' });
const heldLine = (clause: string) => tFormat('engine.studio.held.line', 'en', { clause });

describe('an item just added to a report list property is held until it is filled in (objectstack#27785)', () => {
  it('Order → Add item, then a Label edit: nothing is sent, no red strip, the line names the Order By', async () => {
    const report = vi.fn();
    mountPillar(report);
    const inspector = await ready('Order');
    fireEvent.click(within(listRow(inspector, 'Order')).getByRole('button', { name: L('engine.form.addItem') }));
    editLabel(inspector, 'Sales v2');
    await outlastDebounce();

    expect(reportSaves(), 'the unfinished item is not sent, nor the Label edit with it').toEqual([]);
    expect(screen.queryByTestId('studio-refusal'), 'no red strip on the normal path').toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(heldLine(orderClause));
    // Publish's half: the surface is told what is held.
    expect(report).toHaveBeenLastCalledWith(orderClause);
  });

  it('"Show me" focuses the list in the report properties', async () => {
    mountPillar();
    const inspector = await ready('Order');
    const row = listRow(inspector, 'Order');
    fireEvent.click(within(row).getByRole('button', { name: L('engine.form.addItem') }));
    const show = await within(await screen.findByTestId('studio-held')).findByRole('button', {
      name: L('engine.studio.refusal.show'),
    });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(show);
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
  });

  it('filling the Order By in sends one save carrying the item and the Label edit kept meanwhile', async () => {
    const report = vi.fn();
    mountPillar(report);
    const inspector = await ready('Order');
    const row = listRow(inspector, 'Order');
    fireEvent.click(within(row).getByRole('button', { name: L('engine.form.addItem') }));
    editLabel(inspector, 'Sales v2');
    await outlastDebounce();
    expect(reportSaves()).toEqual([]);

    const by = within(row).getByLabelText('Order By');
    fireEvent.change(by, { target: { value: 'stage' } });
    fireEvent.blur(by);
    await waitFor(() => expect(reportSaves()).toHaveLength(1), { timeout: 4000 });
    const [sent] = reportSaves();
    expect(sent.label).toBe('Sales v2');
    expect(sent.order).toEqual([expect.objectContaining({ by: 'stage' })]);
    expect(
      ReportSchema.safeParse(JSON.parse(JSON.stringify(sent))).success,
      'the body sent is one the door accepts',
    ).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(report).toHaveBeenLastCalledWith(null);
  });

  it('a joined report’s Blocks → Add item: nothing is sent, the line names the block’s Name', async () => {
    stored = JOINED_REPORT;
    const report = vi.fn();
    mountPillar(report);
    const inspector = await ready('Blocks');
    fireEvent.click(within(listRow(inspector, 'Blocks')).getByRole('button', { name: L('engine.form.addItem') }));
    await outlastDebounce();

    const clause = tFormat('engine.studio.held.listItemNeedsInput', 'en', { input: 'Name', n: 2, list: 'Blocks' });
    expect(reportSaves()).toEqual([]);
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(heldLine(clause));
    expect(report).toHaveBeenLastCalledWith(clause);
  });

  // CONTROL: an edit to a report with nothing unfinished saves at once.
  it('a Label edit alone saves at once, with no line', async () => {
    mountPillar();
    const inspector = await ready('Order');
    editLabel(inspector, 'Sales v2');
    await waitFor(() => expect(reportSaves()).toHaveLength(1), { timeout: 4000 });
    expect(reportSaves()[0].label).toBe('Sales v2');
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });
});

describe('a chart type picked before its axes is held until both axes are picked (objectstack#27785)', () => {
  const x = L('engine.inspector.report.chartX');
  const y = L('engine.inspector.report.chartY');

  it('nothing is sent while an axis is unset; the line names it, and "Show me" focuses its picker', async () => {
    const report = vi.fn();
    mountPillar(report);
    const inspector = await ready('Order');
    await pick(inspector, L('engine.inspector.report.chartType'), 'bar');
    await outlastDebounce();

    const clauseX = tFormat('engine.studio.held.reportChartNeedsInput', 'en', { input: x });
    expect(reportSaves(), 'the chart without axes is not sent').toEqual([]);
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(heldLine(clauseX));
    expect(report).toHaveBeenLastCalledWith(clauseX);

    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(within(screen.getByTestId('studio-held')).getByRole('button', { name: L('engine.studio.refusal.show') }));
    await waitFor(() => expect(document.activeElement).toBe(within(inspector).getByRole('combobox', { name: x })));

    await pick(inspector, x, 'Stage (stage)');
    await outlastDebounce();
    expect(reportSaves(), 'one axis is not enough').toEqual([]);
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(
      heldLine(tFormat('engine.studio.held.reportChartNeedsInput', 'en', { input: y })),
    );
  });

  it('both axes picked: one save carrying the whole chart, and the line clears', async () => {
    const report = vi.fn();
    mountPillar(report);
    const inspector = await ready('Order');
    await pick(inspector, L('engine.inspector.report.chartType'), 'bar');
    await pick(inspector, x, 'Stage (stage)');
    await pick(inspector, y, /^Revenue/);
    await waitFor(() => expect(reportSaves()).toHaveLength(1), { timeout: 4000 });
    const [sent] = reportSaves();
    expect(sent.chart).toEqual(expect.objectContaining({ type: 'bar', xAxis: 'stage', yAxis: 'revenue' }));
    expect(ReportSchema.safeParse(JSON.parse(JSON.stringify(sent))).success).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(report).toHaveBeenLastCalledWith(null);
  });
});
