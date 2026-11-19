// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35600 (ADR-0146 D2, D11) — on a read-only base, an `object`
 * leaf's page lists every list view of the object, and Customize declares an
 * override of the BASE's view. The server refuses that declaration for a view
 * the base does not ship (`NOT_OVERRIDABLE`, 403). So Customize is offered
 * only on a view the base ships, read from the layered read at the base (its
 * code layer):
 *
 *  - a view created in the app (a package-less row: no code layer, an
 *    environment row) offers no Customize, sends nothing, and the panel says
 *    it is edited in the app;
 *  - a view nothing at the base serves (a view the pair adds) offers no
 *    Customize and sends nothing either;
 *  - CONTROL: the base's own view is still customized into the pair,
 *    declaring the override.
 *
 * Through the mounted pillar, the real header controls and the real
 * ensure-door client over a fetch stub. The metadata client is a server
 * double whose layered read answers as the server does for each kind of row,
 * and whose draft door refuses an override of a view the base does not ship
 * as the server does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';

const calendarConfig = (startDateField: string) => ({
  type: 'calendar',
  data: { provider: 'object', object: 'opportunity' },
  columns: ['name', 'stage'],
  calendar: { startDateField, titleField: 'name' },
});

/** The base's view: its layered read at the base serves a code layer. */
const BASE_VIEW = {
  name: 'opportunity.default',
  object: 'opportunity',
  viewKind: 'list',
  label: 'Close dates',
  isDefault: true,
  config: calendarConfig('close_date'),
};
/** A view created in the app (the console's New view): bound to no package, so no code layer and an environment row. */
const ENV_VIEW = {
  name: 'opportunity.console_made',
  object: 'opportunity',
  viewKind: 'list',
  label: 'Console made',
  config: calendarConfig('close_date'),
};
/** A view the pair adds: the layered read at the base answers 404, which the client reads as all layers empty. */
const PAIR_VIEW = {
  name: 'opportunity.pair_added',
  object: 'opportunity',
  viewKind: 'list',
  label: 'Pair added',
  config: calendarConfig('close_date'),
};

/** The object as the shell's metadata serves it, its views merged in (`mergeViewsIntoObjects`). */
const flat = (v: typeof BASE_VIEW | typeof ENV_VIEW) => ({
  ...v.config,
  name: v.name,
  label: v.label,
  isDefault: 'isDefault' in v ? v.isDefault : false,
});
const OBJECT_DEF = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    stage: { name: 'stage', label: 'Stage', type: 'text' },
    close_date: { name: 'close_date', label: 'Close date', type: 'date' },
    start_date: { name: 'start_date', label: 'Start date', type: 'date' },
  },
  listViews: {
    [BASE_VIEW.name]: flat(BASE_VIEW),
    [ENV_VIEW.name]: flat(ENV_VIEW),
    [PAIR_VIEW.name]: flat(PAIR_VIEW),
  },
};

const APP = { name: 'crm_app', label: 'CRM', navigation: [{ id: 'nav_opps', type: 'object', label: 'Opportunities', objectName: 'opportunity' }] };

const srv = vi.hoisted(() => ({
  ensure: [] as number[],
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> }>,
  refused: [] as Array<{ name: string; code: string; status: number }>,
}));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'crm_app', label: 'CRM' }];
    if (type === 'object') return [{ name: 'opportunity', label: 'Opportunity' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => undefined),
  references: vi.fn(async () => []),
  layered: vi.fn(),
  getDraft: vi.fn(async () => null),
  save: vi.fn(),
  reset: vi.fn(async () => ({ success: true })),
  withPreviewDrafts() {
    return this;
  },
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [{ type: 'view', allowEnvironmentOverlay: true }] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { InterfacesPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { ensureCustomizationPackage } from './packages-io';
import { tFormat } from '../metadata-admin/i18n';
import type { PackageCustomizationsState } from './CustomizationMark';

/** Stands in for `plugin-view`'s `object-view`. */
function ObjectViewRecorder({ schema }: { schema: Record<string, unknown> }) {
  return <pre data-testid="object-view-schema">{JSON.stringify(schema)}</pre>;
}

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_DEF],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
});

beforeEach(() => {
  srv.ensure.length = 0;
  srv.saves.length = 0;
  srv.refused.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear?: () => void }).mockClear?.();
  // The layered read at the base, as the server answers it for each kind of row (measured on a running server).
  mockClient.layered.mockImplementation(async (type: string, name: string) => {
    if (type === 'app') return { code: APP, overlay: null, overlayScope: null, effective: APP };
    if (type === 'object') return { code: OBJECT_DEF, overlay: null, overlayScope: null, effective: OBJECT_DEF };
    if (name === BASE_VIEW.name) return { code: clone(BASE_VIEW), overlay: null, overlayScope: null, effective: clone(BASE_VIEW) };
    if (name === ENV_VIEW.name) return { code: null, overlay: clone(ENV_VIEW), overlayScope: 'env', effective: clone(ENV_VIEW) };
    return { code: null, overlay: null, overlayScope: null, effective: null };
  });
  // The draft door: an override of a view the base does not ship is refused as the server refuses it.
  mockClient.save.mockImplementation(async (type: string, name: string, item: unknown, opts: Record<string, unknown> = {}) => {
    const body = clone(item) as Record<string, unknown>;
    srv.saves.push({ type, name, body, opts: clone(opts) });
    if (body.overrides && name !== BASE_VIEW.name) {
      srv.refused.push({ name, code: 'NOT_OVERRIDABLE', status: 403 });
      throw Object.assign(new Error(`'view/${name}' declares an override of '${BASE}', which ships no view named '${name}'.`), {
        status: 403,
        code: 'NOT_OVERRIDABLE',
      });
    }
    return { success: true, version: `v${srv.saves.length}`, state: 'draft' };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === `/api/v1/packages/${BASE}/ensure-customization` && init?.method === 'POST') {
        const created = srv.ensure.length === 0;
        srv.ensure.push(created ? 201 : 200);
        return json(
          {
            success: true,
            data: { basePackageId: BASE, packageId: PAIR, namespace: 'hotcrm_custom', dependencyRange: '^4', created, writable: true },
          },
          created ? 201 : 200,
        );
      }
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MARKS_OFF: PackageCustomizationsState = { status: 'off' };

/** What the Studio surface hands the pillar on a read-only base. */
function Host() {
  const [pairId, setPairId] = React.useState<string | null>(null);
  const ensurePackage = React.useCallback(async () => {
    const answer = await ensureCustomizationPackage(BASE);
    setPairId(answer.packageId);
    return answer;
  }, []);
  const ensure = React.useCallback(async () => (await ensurePackage()).packageId, [ensurePackage]);
  const customization = React.useMemo<StudioBaseCustomization>(
    () => ({ base: BASE, baseLabel: 'HotCRM', basedOn: '4.0.0', walled: false, pairId, ensure, ensurePackage, marks: MARKS_OFF }),
    [pairId, ensure, ensurePackage],
  );
  return <InterfacesPillar packageId={BASE} readOnly customization={customization} />;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${BASE}/interfaces`]}>
      <MetadataCtx.Provider value={METADATA}>
        <Host />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const header = () => screen.getByTestId('if-item-header');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setting(key: string): HTMLElement {
  const control = document.getElementById(`mdf-studio-list-view-calendar.${key}`);
  if (!control) throw new Error(`no calendar.${key} setting`);
  return control;
}

async function pick(key: string, text: string) {
  await waitFor(() => expect(setting(key)).toBeEnabled(), { timeout: 8000 });
  fireEvent.keyDown(setting(key), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const hit = within(listbox)
    .getAllByRole('option')
    .find((o) => (o.querySelector('code')?.previousElementSibling?.textContent ?? o.textContent) === text);
  if (!hit) throw new Error(`calendar.${key} lists no "${text}"`);
  fireEvent.click(hit);
}

/** The Opportunities page open on its entry's view (the base's default). */
async function openOpportunities(): Promise<void> {
  await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
  await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Close date'), { timeout: 8000 });
}

/** Pick the view labelled `label` in the header's view switcher. */
async function pickView(label: string, viewId: string): Promise<void> {
  fireEvent.click(within(header()).getByTestId('list-view-switcher'));
  const menu = await screen.findByTestId('list-view-switcher-menu');
  const hit = Array.from(menu.querySelectorAll<HTMLElement>('[data-testid^="view-switcher-row-"]'))
    .map((row) => within(row).getAllByRole('button')[0]!)
    .find((b) => b.textContent === label);
  if (!hit) throw new Error(`the view switcher lists no "${label}"`);
  fireEvent.click(hit);
  await waitFor(
    () => expect(screen.getByTestId('studio-list-view-inspector')).toHaveAttribute('data-view-id', viewId),
    { timeout: 8000 },
  );
}

describe('Customize is offered only on a list view the read-only base ships (objectstack#35600)', () => {
  it('a view created in the app: no Customize, nothing sent, and the panel says where it is edited', async () => {
    mount();
    await openOpportunities();
    await pickView('Console made', ENV_VIEW.name);

    const note = await screen.findByTestId('list-view-read-only');
    await waitFor(() => expect(note).toHaveAttribute('data-reason', 'environment'), { timeout: 8000 });
    expect(note).toHaveTextContent(tFormat('engine.studio.inspector.listView.environmentView', 'en', { package: 'HotCRM' }));
    expect(within(header()).queryByTestId('studio-customize')).toBeNull();
    expect(setting('startDateField')).toBeDisabled();

    await sleep(1500);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
    expect(srv.refused).toEqual([]);
  });

  it('a view nothing at the base serves (one the pair adds): no Customize, nothing sent', async () => {
    mount();
    await openOpportunities();
    await pickView('Pair added', PAIR_VIEW.name);

    const note = await screen.findByTestId('list-view-read-only');
    await waitFor(() => expect(note).toHaveAttribute('data-reason', 'none'), { timeout: 8000 });
    expect(note).toHaveTextContent(tFormat('engine.studio.inspector.listView.notShipped', 'en', { package: 'HotCRM' }));
    expect(within(header()).queryByTestId('studio-customize')).toBeNull();

    await sleep(1500);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
  });

  it('CONTROL: the base’s own view is customized into the pair, declaring the override, and the save is not refused', async () => {
    mount();
    await openOpportunities();
    expect(screen.getByTestId('list-view-read-only')).not.toHaveAttribute('data-reason');

    fireEvent.click(await within(header()).findByTestId('studio-customize', undefined, { timeout: 8000 }));
    await pick('startDateField', 'Start date');
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    const [saved] = srv.saves;
    expect(saved).toMatchObject({ type: 'view', name: BASE_VIEW.name, opts: { mode: 'draft', packageId: PAIR } });
    expect(saved!.body.overrides).toEqual({ package: BASE, basedOn: '4.0.0' });
    expect(srv.refused).toEqual([]);
  });
});
