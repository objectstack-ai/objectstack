// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27459 — the Interfaces pillar holds an item just added to a
 * dashboard's own list property unsent until it is filled in, instead of
 * autosaving it for the draft door to refuse.
 *
 * The card: Properties → Global Filters → "Add item", then a Label edit. The
 * autosave PUT `globalFilters[N] = {}`, the door answered 422 on
 * `globalFilters.N.field`, the Label save carried the same item and was refused
 * too, and the Label edit was gone after a reload. The pillar now holds the
 * dashboard as it holds a widget waiting for its binding (objectui#11910):
 * nothing is sent, a neutral line names the input with a "Show me", and
 * filling the item in lets the next autosave send every edit kept meanwhile.
 *
 * Mounted with a metadata client double that records every save, a stub
 * canvas and the real `DashboardDefaultInspector` (its spec-driven form).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardSchema } from '@objectstack/spec/ui';

const NAV = [{ id: 'nav_sales', type: 'dashboard', label: 'Sales', dashboardName: 'sales_dash' }];

/** One bound widget and no list property yet: the dashboard parses with the spec as served. */
const SALES_DASH = {
  name: 'sales_dash',
  label: 'Sales',
  widgets: [
    {
      id: 'pipeline',
      type: 'metric',
      title: 'Pipeline',
      dataset: 'sales_ds',
      values: ['revenue'],
      layout: { x: 0, y: 0, w: 3, h: 2 },
    },
  ],
};

const mockClient = {
  withPreviewDrafts: vi.fn((): unknown => mockClient),
  save: vi.fn(async (_type: string, _name: string, _body: Record<string, unknown>) => ({
    success: true,
    version: 'v1',
    state: 'draft',
  })),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'dashboard') return [SALES_DASH];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', active: true, navigation: NAV } };
    if (type === 'dashboard') return { effective: JSON.parse(JSON.stringify(SALES_DASH)) };
    return { code: null, overlay: null, overlayScope: null, effective: null };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
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
import { DashboardDefaultInspector } from '../metadata-admin/inspectors/DashboardDefaultInspector';
import { t, tFormat } from '../metadata-admin/i18n';

// A stub canvas: the leaf needs a registered preview to be draft-editable,
// and the canvas's own drawing is not what this file pins.
registerMetadataPreview('dashboard', () => null);
registerMetadataDefaultInspector('dashboard', DashboardDefaultInspector);

beforeEach(() => {
  for (const fn of Object.values(mockClient)) fn.mockClear();
});
afterEach(cleanup);

function mountPillar(onHeldEditChange?: (clause: string | null) => void) {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" onHeldEditChange={onHeldEditChange} />
    </MemoryRouter>,
  );
}

function dashboardSaves(): Array<Record<string, unknown>> {
  return mockClient.save.mock.calls.filter((c) => c[0] === 'dashboard').map((c) => c[2]);
}

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

/** The dashboard's properties are open, with its Filters section expanded: its Global Filters row is drawn. */
async function ready(): Promise<HTMLElement> {
  const inspector = await screen.findByTestId('if-inspector', undefined, { timeout: 8000 });
  fireEvent.click(await within(inspector).findByRole('button', { name: /^Filters/ }, { timeout: 8000 }));
  await within(inspector).findByText('Global Filters', { selector: 'label' }, { timeout: 8000 });
  return inspector;
}

/** The form row of the list property labelled `label`: its label and its repeater. */
function listRow(inspector: HTMLElement, label: string): HTMLElement {
  const row = within(inspector).getByText(label, { selector: 'label' }).parentElement?.parentElement;
  if (!row) throw new Error(`no form row for ${label}`);
  return row;
}

/** The dashboard's own Label input commits on blur. */
function editLabel(inspector: HTMLElement, value: string): void {
  const input = within(inspector).getByDisplayValue('Sales');
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

const clause = tFormat('engine.studio.held.listItemNeedsInput', 'en', { input: 'Field', n: 1, list: 'Global Filters' });

describe('an item just added to a dashboard list property is held until it is filled in (objectstack#27459)', () => {
  it('Global Filters → Add item, then a Label edit: nothing is sent, no red strip, the line names the Field', async () => {
    const report = vi.fn();
    mountPillar(report);
    const inspector = await ready();
    fireEvent.click(within(listRow(inspector, 'Global Filters')).getByRole('button', { name: t('engine.form.addItem', 'en') }));
    editLabel(inspector, 'Sales v2');
    await outlastDebounce();

    expect(dashboardSaves(), 'the unfinished item is not sent, nor the Label edit with it').toEqual([]);
    expect(screen.queryByTestId('studio-refusal'), 'no red strip on the normal path').toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(
      tFormat('engine.studio.held.line', 'en', { clause }),
    );
    // Publish's half: the surface is told what is held.
    expect(report).toHaveBeenLastCalledWith(clause);
  });

  it('"Show me" focuses the list in the dashboard properties', async () => {
    mountPillar();
    const inspector = await ready();
    const row = listRow(inspector, 'Global Filters');
    fireEvent.click(within(row).getByRole('button', { name: t('engine.form.addItem', 'en') }));
    const show = await within(await screen.findByTestId('studio-held')).findByRole('button', {
      name: t('engine.studio.refusal.show', 'en'),
    });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(show);
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
  });

  it('filling the Field in sends one save carrying the item and the Label edit kept meanwhile, and clears the line', async () => {
    const report = vi.fn();
    mountPillar(report);
    const inspector = await ready();
    const row = listRow(inspector, 'Global Filters');
    fireEvent.click(within(row).getByRole('button', { name: t('engine.form.addItem', 'en') }));
    editLabel(inspector, 'Sales v2');
    await outlastDebounce();
    expect(dashboardSaves()).toEqual([]);

    const field = within(row).getByLabelText('Field');
    fireEvent.change(field, { target: { value: 'stage' } });
    fireEvent.blur(field);
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    const [sent] = dashboardSaves();
    expect(sent.label).toBe('Sales v2');
    expect(sent.globalFilters).toEqual([expect.objectContaining({ field: 'stage' })]);
    expect(
      DashboardSchema.safeParse(JSON.parse(JSON.stringify(sent))).success,
      'the body sent is one the door accepts',
    ).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(report).toHaveBeenLastCalledWith(null);
  });

  // CONTROL: an edit to a dashboard with no unfinished item saves at once.
  it('a Label edit alone saves at once, with no line', async () => {
    mountPillar();
    const inspector = await ready();
    editLabel(inspector, 'Sales v2');
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    expect(dashboardSaves()[0].label).toBe('Sales v2');
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });
});
