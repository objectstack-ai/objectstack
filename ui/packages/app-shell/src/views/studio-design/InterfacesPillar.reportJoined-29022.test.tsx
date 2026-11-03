// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29022 — the Interfaces pillar holds a report switched to Joined
 * in its Properties until its first block is added, instead of autosaving a
 * body the draft door refuses.
 *
 * The card: Report type = Joined sent `type: 'joined'` with the dataset and
 * measures cleared and no `blocks` (422 at `blocks`); a Description edit then
 * sent the same body plus the edit (422 again), and a reload dropped both with
 * no prompt. Now nothing is sent, a neutral line names the Blocks list with a
 * "Show me", and the surface is told what is held (its leave guard and Publish
 * read that).
 *
 * Mounted as `InterfacesPillar.reportHeld-27785.test.tsx` mounts it: a metadata
 * client double that records every save, a stub canvas and the real
 * `ReportDefaultInspector` with its type picker.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const NAV = [{ id: 'nav_rep', type: 'report', label: 'Sales report', reportName: 'sales_report' }];

const SUMMARY_REPORT = {
  name: 'sales_report',
  label: 'Sales report',
  type: 'summary',
  dataset: 'sales_ds',
  rows: ['stage'],
  values: ['revenue'],
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

const heldLine = (clause: string) => tFormat('engine.studio.held.line', 'en', { clause });
const joinedClause = tFormat('engine.studio.held.reportJoinedNeedsBlock', 'en', { list: 'Blocks' });

describe('a report switched to Joined is held until its first block is added (objectstack#29022)', () => {
  it('Report type = Joined, then a Label edit: nothing is sent, no red strip, the line names Blocks', async () => {
    const report = vi.fn();
    mountPillar(report);
    const inspector = await ready('Order');
    await pick(inspector, L('engine.inspector.report.type'), L('engine.inspector.report.type.joined'));
    editLabel(inspector, 'Sales v2');
    await outlastDebounce();

    expect(reportSaves(), 'the joined report without blocks is not sent, nor the Label edit with it').toEqual([]);
    expect(screen.queryByTestId('studio-refusal'), 'no red strip on the normal path').toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(heldLine(joinedClause));
    // The surface's half: its leave guard and Publish read the held clause.
    expect(report).toHaveBeenLastCalledWith(joinedClause);
  });

  it('"Show me" focuses the Blocks list in the report properties', async () => {
    mountPillar();
    const inspector = await ready('Order');
    await pick(inspector, L('engine.inspector.report.type'), L('engine.inspector.report.type.joined'));
    await within(inspector).findByText('Blocks', { selector: 'label' });
    const row = listRow(inspector, 'Blocks');
    const show = await within(await screen.findByTestId('studio-held')).findByRole('button', {
      name: L('engine.studio.refusal.show'),
    });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(show);
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
  });

  it('Blocks → Add item hands the hold to the new block, still unsent', async () => {
    const report = vi.fn();
    mountPillar(report);
    const inspector = await ready('Order');
    await pick(inspector, L('engine.inspector.report.type'), L('engine.inspector.report.type.joined'));
    await within(inspector).findByText('Blocks', { selector: 'label' });
    fireEvent.click(within(listRow(inspector, 'Blocks')).getByRole('button', { name: L('engine.form.addItem') }));
    await outlastDebounce();

    const clause = tFormat('engine.studio.held.listItemNeedsInput', 'en', { input: 'Name', n: 1, list: 'Blocks' });
    expect(reportSaves()).toEqual([]);
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(heldLine(clause));
    expect(report).toHaveBeenLastCalledWith(clause);
  });

  // CONTROL: a type switch the door accepts saves at once.
  it('Report type = Tabular saves at once, with no line', async () => {
    mountPillar();
    const inspector = await ready('Order');
    await pick(inspector, L('engine.inspector.report.type'), L('engine.inspector.report.type.tabular'));
    await waitFor(() => expect(reportSaves()).toHaveLength(1), { timeout: 4000 });
    expect(reportSaves()[0].type).toBe('tabular');
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });
});
