// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29006 — a dashboard list item the author has begun to fill in,
 * whose unset input sits INSIDE one it has given a value, is held as the empty
 * item is (objectstack#27459), instead of autosaved for the door to refuse.
 *
 * The card: Global Filters → Add item → Field, Input Type `select`, then
 * Options From → Object. The autosave PUT `optionsFrom: { object }`, the draft
 * door answered 422 on `globalFilters.N.optionsFrom.valueField` and
 * `…labelField`, and every later save (Description, Label) carried the same
 * item and was refused too, so those edits were gone after a reload. The
 * held rule asked only for an unset input DIRECTLY below the item, and
 * `optionsFrom` holds `{ object }`, so the item read as finished but wrong.
 *
 * Every "held" case is paired with the spec's own `DashboardSchema` verdict on
 * the same body, and every "not held" control with one it refuses for a value
 * the author wrote: the hold never hides a finished but wrong item. The last
 * block mounts the Interfaces pillar on the real autosave path.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardSchema } from '@objectstack/spec/ui';

const BOUND = {
  id: 'pipeline',
  type: 'metric',
  title: 'Pipeline',
  dataset: 'sales_ds',
  values: ['revenue'],
  layout: { x: 0, y: 0, w: 3, h: 2 },
};
const SALES_DASH = { name: 'sales_dash', label: 'Sales', widgets: [BOUND] };
const NAV = [{ id: 'nav_sales', type: 'dashboard', label: 'Sales', dashboardName: 'sales_dash' }];

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
    if (type === 'dashboard') return { effective: JSON.parse(JSON.stringify(currentDashboard)) };
    return { code: null, overlay: null, overlayScope: null, effective: null };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
};

/** The dashboard the pillar loads; a case sets it before mounting. */
let currentDashboard: Record<string, unknown> = SALES_DASH;

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

import { dashboardHeldEdit, listItemHeldInput } from './metadataError';
import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { DashboardDefaultInspector } from '../metadata-admin/inspectors/DashboardDefaultInspector';
import { tFormat } from '../metadata-admin/i18n';

/** The issue paths the spec's dashboard parse refuses `dashboard` at, as the door reports them. */
function refusals(schema: typeof DashboardSchema, body: Record<string, unknown>): string[] {
  const result = schema.safeParse(body);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

const dash = (extra: Record<string, unknown>) => ({ ...SALES_DASH, widgets: [BOUND], ...extra });

/** The card's filter after step 4: Field and Input Type given, Options From begun with its Object only. */
const PARTLY = { field: 'region', type: 'select', optionsFrom: { object: 'r3_ticket' } };

const clause = (input: string, n: number, list: string, locale = 'en') =>
  tFormat('engine.studio.held.listItemNeedsInput', locale, { input, n, list });

describe('a list item held for an input left unset inside one it has begun to fill (objectstack#29006)', () => {
  it('Options From given its Object only: held for Options From, the row its form shows', () => {
    const body = dash({ globalFilters: [PARTLY] });
    expect(refusals(DashboardSchema, body)).toEqual([
      'globalFilters.0.optionsFrom.valueField',
      'globalFilters.0.optionsFrom.labelField',
    ]);
    expect(listItemHeldInput(body, DashboardSchema, new Set(['widgets']))).toEqual({
      list: ['globalFilters'],
      index: 0,
      input: 'optionsFrom',
    });
    expect(dashboardHeldEdit(body, 'en')).toEqual({
      clause: clause('Options From', 1, 'Global Filters'),
      target: null,
      input: 'Global Filters',
    });
  });

  it('Options From missing only its Label Field: held; a Label Field cleared to blank is one the spec takes', () => {
    const body = dash({ globalFilters: [{ ...PARTLY, optionsFrom: { object: 'r3_ticket', valueField: 'id', labelField: '' } }] });
    // The spec takes a blank text, so only an absent nested input is refused: the blank one is not this case's.
    const absent = dash({ globalFilters: [{ ...PARTLY, optionsFrom: { object: 'r3_ticket', valueField: 'id' } }] });
    expect(refusals(DashboardSchema, absent)).toEqual(['globalFilters.0.optionsFrom.labelField']);
    expect(listItemHeldInput(absent, DashboardSchema)?.input).toBe('optionsFrom');
    expect(refusals(DashboardSchema, body)).toEqual([]);
    expect(listItemHeldInput(body, DashboardSchema)).toBeNull();
  });

  it('a direct unset input is held as before (objectstack#27459)', () => {
    const body = dash({ globalFilters: [{ type: 'select' }] });
    expect(refusals(DashboardSchema, body)).toEqual(['globalFilters.0.field']);
    expect(listItemHeldInput(body, DashboardSchema)).toEqual({ list: ['globalFilters'], index: 0, input: 'field' });
  });

  // CONTROLS: errors stay for finished work.
  it('a nested value the author gave that the spec refuses: finished but wrong, not held', () => {
    const body = dash({
      globalFilters: [{ ...PARTLY, optionsFrom: { object: 'r3_ticket', valueField: 'id', labelField: 42 } }],
    });
    expect(refusals(DashboardSchema, body)).toEqual(['globalFilters.0.optionsFrom.labelField']);
    expect(listItemHeldInput(body, DashboardSchema)).toBeNull();
    expect(dashboardHeldEdit(body, 'en')).toBeNull();
  });

  it('an unset nested input beside a wrong nested value the spec names both of: not held', () => {
    const body = dash({ globalFilters: [{ ...PARTLY, optionsFrom: { object: 7 } }] });
    expect(refusals(DashboardSchema, body)).toEqual([
      'globalFilters.0.optionsFrom.object',
      'globalFilters.0.optionsFrom.valueField',
      'globalFilters.0.optionsFrom.labelField',
    ]);
    expect(listItemHeldInput(body, DashboardSchema)).toBeNull();
  });

  it('an input given a text where the spec wants an object: the path steps through a set value, not held', () => {
    const body = dash({ globalFilters: [{ ...PARTLY, optionsFrom: 'r3_ticket' }] });
    expect(refusals(DashboardSchema, body)).toEqual(['globalFilters.0.optionsFrom']);
    expect(listItemHeldInput(body, DashboardSchema)).toBeNull();
  });

  it('a finished Options From is accepted and holds nothing', () => {
    const body = dash({
      globalFilters: [{ ...PARTLY, optionsFrom: { object: 'r3_ticket', valueField: 'id', labelField: 'name' } }],
    });
    expect(refusals(DashboardSchema, body)).toEqual([]);
    expect(listItemHeldInput(body, DashboardSchema)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The surface: the Interfaces pillar on its real autosave path.
// ---------------------------------------------------------------------------

registerMetadataPreview('dashboard', () => null);
registerMetadataDefaultInspector('dashboard', DashboardDefaultInspector);

beforeEach(() => {
  for (const fn of Object.values(mockClient)) fn.mockClear();
  currentDashboard = SALES_DASH;
});
afterEach(cleanup);

function dashboardSaves(): Array<Record<string, unknown>> {
  return mockClient.save.mock.calls.filter((c) => c[0] === 'dashboard').map((c) => c[2]);
}

async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

/** Type into a form input and commit it as Tab does. */
function commit(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no input #${id}`);
  return el;
}

describe('the Interfaces pillar holds the partly filled filter and keeps the later edits (objectstack#29006)', () => {
  it('Options From → Object, then a Label edit: nothing is refused; finishing Options From sends both', async () => {
    // The card's step 3 is saved: a select filter on `region`, which the spec accepts as it stands.
    currentDashboard = { ...SALES_DASH, globalFilters: [{ field: 'region', type: 'select' }] };
    expect(refusals(DashboardSchema, currentDashboard)).toEqual([]);
    const report = vi.fn();
    render(
      <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
        <InterfacesPillar packageId="com.acme.app" onHeldEditChange={report} />
      </MemoryRouter>,
    );
    const inspector = await screen.findByTestId('if-inspector', undefined, { timeout: 8000 });
    fireEvent.click(await within(inspector).findByRole('button', { name: /^Filters/ }, { timeout: 8000 }));
    fireEvent.click(await within(inspector).findByRole('button', { name: '#1 — region' }, { timeout: 8000 }));

    // Step 4: Options From → Object only. Step 5: the dashboard's Label.
    commit(byId('mdf-globalFilters.0.optionsFrom.object'), 'r3_ticket');
    commit(within(inspector).getByDisplayValue('Sales'), 'Sales v2');
    await outlastDebounce();

    const held = clause('Options From', 1, 'Global Filters');
    expect(dashboardSaves(), 'the begun item is not sent, so no save is refused for it').toEqual([]);
    expect(screen.queryByTestId('studio-refusal'), 'no red strip').toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(
      tFormat('engine.studio.held.line', 'en', { clause: held }),
    );
    expect(report).toHaveBeenLastCalledWith(held);

    // Finishing Options From lets the next autosave send the item and the Label edit kept meanwhile.
    commit(byId('mdf-globalFilters.0.optionsFrom.valueField'), 'id');
    commit(byId('mdf-globalFilters.0.optionsFrom.labelField'), 'name');
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    const [sent] = dashboardSaves();
    expect(sent.label).toBe('Sales v2');
    expect(sent.globalFilters).toEqual([
      expect.objectContaining({
        field: 'region',
        type: 'select',
        optionsFrom: expect.objectContaining({ object: 'r3_ticket', valueField: 'id', labelField: 'name' }),
      }),
    ]);
    expect(refusals(DashboardSchema, JSON.parse(JSON.stringify(sent))), 'the body sent is one the door accepts').toEqual([]);
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(report).toHaveBeenLastCalledWith(null);
  });
});
