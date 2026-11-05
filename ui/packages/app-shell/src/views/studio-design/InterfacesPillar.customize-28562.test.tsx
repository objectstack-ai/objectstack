// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28562 (ADR-0146 D2, D3) — on a read-only base, the Interfaces
 * pillar customizes a view, dashboard or report (and an `object` leaf's list
 * view) into the base's paired customization package.
 *
 * Through the mounted pillar, its real autosaves, the real header controls
 * and the real ensure-door client (`ensureCustomizationPackage`) over a fetch
 * stub that answers 201 when it creates the pair and 200 after. The metadata
 * client is a server double holding the base's rows, the pair's rows and the
 * pair's drafts, and recording every write. The pillar is handed what the
 * Studio surface hands it (`StudioBaseCustomization`) by a host that, like
 * the surface, takes the pair's id from the door's answer.
 *
 * Pinned:
 *  - Customize is offered on the base's item and writes nothing; the first
 *    saved edit asks the door once and writes the draft into the pair, with
 *    the override declared at the base's version and no `_` key, the base
 *    untouched; the badge then reads the served declaration;
 *  - a second item asks the door again and is answered 200;
 *  - a walled caller sees Customize disabled, and nothing is asked or sent;
 *  - Restore deletes the pair's draft and row of the item, and the base's
 *    item reads back, on a dashboard and on a list view;
 *  - the read-only mark does not link these types to Setup's overlay page;
 *  - CONTROL: a writable package edits and saves in place, with no door and
 *    no declaration.
 *
 * objectstack#30059 — and the app's navigation, through the rail's own nav
 * editor: the first saved edit copies the whole app into the pair, declaring
 * the override; the pickers offer the pair's items; the rail marks the
 * override and counts it under "only customizations"; Restore deletes it.
 *
 * objectstack#30063 — and a page, through its designer as a dashboard is:
 * the first saved edit copies the whole page into the pair, declaring the
 * override; Restore deletes it; the rail marks the page and counts it under
 * "only customizations"; on a writable package the page saves in place.
 *
 * objectstack#30089 — and a list view's selection actions: the first field
 * update added in the list-view panel is written into the pair's copy of the
 * view, declaring the override, the base untouched.
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

const OBJECT_DEF = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    stage: { name: 'stage', label: 'Stage', type: 'text' },
    amount: { name: 'amount', label: 'Amount', type: 'currency' },
    close_date: { name: 'close_date', label: 'Close date', type: 'date' },
    start_date: { name: 'start_date', label: 'Start date', type: 'date' },
  },
};

const NAV = [
  { id: 'nav_pipeline', type: 'dashboard', label: 'Pipeline', dashboardName: 'pipeline' },
  { id: 'nav_forecast', type: 'dashboard', label: 'Forecast', dashboardName: 'forecast' },
  { id: 'nav_opps', type: 'object', label: 'Opportunities', objectName: 'opportunity' },
];
const APP = { name: 'crm_app', label: 'CRM', navigation: NAV };

/** The base's rows as its read serves them: the protection envelope rides along. */
const BASE_ROWS: Record<string, Record<string, unknown>> = {
  'app/crm_app': { ...APP, _packageId: BASE },
  'dashboard/pipeline': { name: 'pipeline', label: 'Pipeline', widgets: [], _packageId: BASE },
  'dashboard/forecast': { name: 'forecast', label: 'Forecast', widgets: [], _packageId: BASE },
  // objectstack#30063 — a page no navigation entry opens: the rail lists it under its type.
  'page/crm_welcome': {
    name: 'crm_welcome',
    label: 'Welcome',
    type: 'home',
    kind: 'full',
    regions: [{ name: 'main', components: [{ type: 'element:text', properties: { content: 'Shipped text' } }] }],
    _packageId: BASE,
  },
  'view/opportunity.default': {
    name: 'opportunity.default',
    object: 'opportunity',
    viewKind: 'list',
    label: 'Close dates',
    isDefault: true,
    config: {
      type: 'calendar',
      data: { provider: 'object', object: 'opportunity' },
      columns: ['name', 'stage'],
      calendar: { startDateField: 'close_date', titleField: 'name' },
    },
  },
};

const srv = vi.hoisted(() => ({
  base: new Map<string, Record<string, unknown>>(),
  pairActive: new Map<string, Record<string, unknown>>(),
  pairDrafts: new Map<string, Record<string, unknown>>(),
  /** objectstack#30059 — what the pair's list read serves, by type. */
  pairListed: new Map<string, Array<Record<string, unknown>>>(),
  pairExists: false,
  ensure: [] as number[],
  ensureRefusal: null as null | { status: number; message: string },
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> }>,
  resets: [] as Array<{ type: string; name: string; opts: Record<string, unknown> }>,
  version: 0,
}));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const k = (type: string, name: string) => `${type}/${name}`;

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string, opts: { packageId?: string } = {}) => {
    if (opts.packageId === PAIR) return clone(srv.pairListed.get(type) ?? []);
    if (type === 'app') return [{ name: 'crm_app', label: 'CRM' }];
    if (type === 'object') return [{ name: 'opportunity', label: 'Opportunity' }];
    if (type === 'page') return [{ name: 'crm_welcome', label: 'Welcome', _packageId: BASE }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async (type: string) => (type === 'object' ? OBJECT_DEF : undefined)),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'object') return { effective: OBJECT_DEF, code: OBJECT_DEF };
    // N-10: the pair's row is served over the base's item.
    const overlay = srv.pairActive.get(k(type, name)) ?? null;
    const code = srv.base.get(k(type, name)) ?? null;
    return {
      code: code ? clone(code) : null,
      overlay: overlay ? clone(overlay) : null,
      overlayScope: overlay ? 'env' : null,
      effective: clone(overlay ?? code),
    };
  }),
  getDraft: vi.fn(async (type: string, name: string, opts: { packageId?: string } = {}) => {
    const draft = opts.packageId === PAIR ? srv.pairDrafts.get(k(type, name)) : undefined;
    return draft ? { type, name, item: clone(draft), version: `v${srv.version}` } : null;
  }),
  save: vi.fn(async (type: string, name: string, item: unknown, opts: Record<string, unknown> = {}) => {
    srv.saves.push({ type, name, body: clone(item) as Record<string, unknown>, opts: clone(opts) });
    if (opts.packageId !== PAIR) {
      throw Object.assign(new Error(`Package '${String(opts.packageId)}' is read-only.`), { status: 403 });
    }
    srv.pairDrafts.set(k(type, name), clone(item) as Record<string, unknown>);
    srv.version += 1;
    return { success: true, version: `v${srv.version}`, state: 'draft' };
  }),
  reset: vi.fn(async (type: string, name: string, opts: Record<string, unknown> = {}) => {
    srv.resets.push({ type, name, opts: clone(opts) });
    if (opts.state === 'draft') srv.pairDrafts.delete(k(type, name));
    else srv.pairActive.delete(k(type, name));
    return { success: true };
  }),
  withPreviewDrafts() {
    return this;
  },
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    // Both take environment overlays, so the read-only mark would link them to Setup.
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        { type: 'dashboard', allowEnvironmentOverlay: true },
        { type: 'view', allowEnvironmentOverlay: true },
      ],
    }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { InterfacesPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { ensureCustomizationPackage } from './packages-io';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { t, tFormat } from '../metadata-admin/i18n';
import type { PackageCustomizationsState } from './CustomizationMark';
import { indexCustomizations } from './customizationMarks';

/** The dashboard canvas, reduced to its label and one in-place edit. */
function BoardCanvas({ draft, onPatch }: { draft: Record<string, unknown>; onPatch?: (patch: Record<string, unknown>) => void }) {
  return (
    <div>
      <p data-testid="board-label">{String(draft?.label ?? '')}</p>
      <button type="button" onClick={() => onPatch?.({ label: `${String(draft?.label ?? '')} (ours)` })}>
        patch the board
      </button>
    </div>
  );
}

/** objectstack#30063 — the page designer, reduced to its first text block and one in-place edit of it. */
function PageCanvas({ draft, onPatch }: { draft: Record<string, unknown>; onPatch?: (patch: Record<string, unknown>) => void }) {
  const regions = (draft?.regions ?? []) as Array<{ name: string; components: Array<{ type: string; properties: { content: string } }> }>;
  const content = regions[0]?.components[0]?.properties.content ?? '';
  return (
    <div>
      <p data-testid="page-text">{content}</p>
      <button
        type="button"
        onClick={() =>
          onPatch?.({
            regions: [{ ...regions[0], components: [{ type: 'element:text', properties: { content: `${content} (ours)` } }] }],
          })
        }
      >
        patch the page
      </button>
    </div>
  );
}

/** Stands in for `plugin-view`'s `object-view`, recording the schema the canvas hands it. */
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
  registerMetadataPreview('dashboard', BoardCanvas as never);
  registerMetadataPreview('page', PageCanvas as never);
  ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
});

beforeEach(() => {
  srv.base.clear();
  for (const [key, row] of Object.entries(BASE_ROWS)) srv.base.set(key, clone(row));
  srv.pairActive.clear();
  srv.pairDrafts.clear();
  srv.pairListed.clear();
  srv.pairExists = false;
  srv.ensure.length = 0;
  srv.ensureRefusal = null;
  srv.saves.length = 0;
  srv.resets.length = 0;
  srv.version = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear?: () => void }).mockClear?.();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === `/api/v1/packages/${BASE}/ensure-customization` && init?.method === 'POST') {
        if (srv.ensureRefusal) {
          srv.ensure.push(srv.ensureRefusal.status);
          return json({ success: false, error: { code: 'FORBIDDEN', message: srv.ensureRefusal.message } }, srv.ensureRefusal.status);
        }
        const created = !srv.pairExists;
        srv.pairExists = true;
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

/** What the Studio surface hands the pillar on a read-only base: the pair's id comes from the door's answer. */
function Host({
  readOnly = true,
  walled = false,
  basedOn = '4.0.0',
  listedPair = null,
  marks = MARKS_OFF,
}: {
  readOnly?: boolean;
  walled?: boolean;
  basedOn?: string | null;
  listedPair?: string | null;
  marks?: PackageCustomizationsState;
}) {
  const [pairId, setPairId] = React.useState<string | null>(listedPair);
  const ensurePackage = React.useCallback(async () => {
    const answer = await ensureCustomizationPackage(BASE);
    setPairId(answer.packageId);
    return answer;
  }, []);
  const ensure = React.useCallback(async () => (await ensurePackage()).packageId, [ensurePackage]);
  const customization = React.useMemo<StudioBaseCustomization | null>(
    () =>
      readOnly
        ? { base: BASE, baseLabel: 'HotCRM', basedOn, walled, pairId, ensure, ensurePackage, marks }
        : null,
    [readOnly, basedOn, walled, pairId, ensure, ensurePackage, marks],
  );
  return <InterfacesPillar packageId={BASE} readOnly={readOnly} customization={customization} />;
}

function mount(props: React.ComponentProps<typeof Host> = {}) {
  return render(
    <MemoryRouter initialEntries={[`/studio/${BASE}/interfaces`]}>
      <MetadataCtx.Provider value={METADATA}>
        <Host {...props} />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const header = () => screen.getByTestId('if-item-header');
const patchBoard = () => fireEvent.click(screen.getByRole('button', { name: 'patch the board' }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Pipeline dashboard open, as the pillar opens the first leaf. */
async function openPipeline(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('board-label')).toHaveTextContent(/^Pipeline/), { timeout: 8000 });
}

async function openForecast(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Forecast/ }));
  await waitFor(() => expect(screen.getByTestId('board-label')).toHaveTextContent(/^Forecast/), { timeout: 8000 });
}

async function customize(): Promise<void> {
  fireEvent.click(await within(header()).findByTestId('studio-customize', undefined, { timeout: 8000 }));
  await waitFor(() => expect(within(header()).queryByTestId('studio-customize')).toBeNull());
}

/**
 * objectstack#29692 — Restore is asked from the override mark's popover, and
 * confirmed in the same dialog the item menu opened before.
 */
async function openRestoreDialog(): Promise<HTMLElement> {
  fireEvent.click(await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 }));
  const popover = await screen.findByTestId('studio-override-popover');
  await waitFor(() => expect(within(popover).getByTestId('studio-override-restore')).toBeEnabled(), { timeout: 8000 });
  fireEvent.click(within(popover).getByTestId('studio-override-restore'));
  return screen.findByTestId('studio-restore-original-dialog');
}

async function restore(): Promise<void> {
  fireEvent.click(within(await openRestoreDialog()).getByTestId('studio-restore-original-confirm'));
}

describe('Customize a read-only base’s dashboard into its pair (objectstack#28562)', () => {
  it('Customize is offered and writes nothing; until it is pressed the canvas edits nothing', async () => {
    mount();
    await openPipeline();
    expect(within(header()).getByTestId('studio-customize')).toBeEnabled();

    patchBoard();
    expect(screen.getByTestId('board-label')).toHaveTextContent(/^Pipeline$/);

    await customize();
    await sleep(2000);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
    expect(within(header()).queryByTestId('studio-override-chip')).toBeNull();
  });

  it('the first saved edit asks the door once and writes the pair’s draft, declaring the override; the base is untouched', async () => {
    mount();
    await openPipeline();
    await customize();

    patchBoard();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    const [saved] = srv.saves;
    expect(saved).toMatchObject({ type: 'dashboard', name: 'pipeline', opts: { mode: 'draft', packageId: PAIR } });
    expect(saved!.body).toStrictEqual({
      name: 'pipeline',
      label: 'Pipeline (ours)',
      widgets: [],
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    expect(srv.base.get('dashboard/pipeline')).toStrictEqual(BASE_ROWS['dashboard/pipeline']);

    // The badge reads the declaration the pair's draft now serves.
    const chip = await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });
    expect(chip).toHaveTextContent(tFormat('engine.studio.customize.overrides', 'en', { package: 'HotCRM' }));
    // objectstack#29692 — pressed, the mark says the version it was taken from.
    fireEvent.click(chip);
    expect(await screen.findByTestId('studio-override-popover-facts')).toHaveTextContent(
      tFormat('engine.studio.customize.overridesTitle', 'en', { package: 'HotCRM', basedOn: '4.0.0' }),
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('studio-override-popover')).toBeNull());

    // A later edit of the same item asks the door no more.
    patchBoard();
    await waitFor(() => expect(srv.saves).toHaveLength(2), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    expect(srv.saves[1]!.opts.packageId).toBe(PAIR);
  });

  it('the first save into the pair is pinned to "no draft there", the next to the version it was answered', async () => {
    mount();
    await openPipeline();
    await customize();

    patchBoard();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.saves[0]!.opts).toMatchObject({ packageId: PAIR, ifNoneMatch: '*' });
    expect(srv.saves[0]!.opts).not.toHaveProperty('ifMatch');

    patchBoard();
    await waitFor(() => expect(srv.saves).toHaveLength(2), { timeout: 8000 });
    expect(srv.saves[1]!.opts).toMatchObject({ packageId: PAIR, ifMatch: 'v1' });
    expect(srv.saves[1]!.opts).not.toHaveProperty('ifNoneMatch');
  });

  it('a second item asks the door again and is answered 200; it is written into the same pair', async () => {
    mount();
    await openPipeline();
    await customize();
    patchBoard();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });

    await openForecast();
    await customize();
    patchBoard();
    await waitFor(() => expect(srv.saves).toHaveLength(2), { timeout: 8000 });
    expect(srv.ensure).toEqual([201, 200]);
    expect(srv.saves[1]).toMatchObject({ type: 'dashboard', name: 'forecast', opts: { packageId: PAIR } });
    expect(srv.saves[1]!.body.overrides).toEqual({ package: BASE, basedOn: '4.0.0' });
  });

  it('a refused door is shown as the server sent it, and nothing is saved', async () => {
    const sentence = 'Only the platform operator may create a customization package under the group posture.';
    srv.ensureRefusal = { status: 403, message: sentence };
    mount();
    await openPipeline();
    await customize();

    patchBoard();
    await waitFor(() => expect(srv.ensure).toEqual([403]), { timeout: 8000 });
    // The envelope's sentence and code, as every package read here shows a refusal.
    expect(await screen.findByTestId('studio-refusal-message', undefined, { timeout: 8000 })).toHaveTextContent(
      `${sentence} (FORBIDDEN)`,
    );
    expect(srv.saves).toEqual([]);
  });

  it('a walled caller sees Customize disabled, with the reason; nothing is asked or sent', async () => {
    mount({ walled: true });
    await openPipeline();
    const button = within(header()).getByTestId('studio-customize');
    expect(button).toBeDisabled();
    expect(within(header()).getByTestId('studio-customize-blocked')).toHaveAttribute(
      'title',
      t('engine.studio.customize.walled', 'en'),
    );

    fireEvent.click(button);
    patchBoard();
    await sleep(2000);
    expect(screen.getByTestId('board-label')).toHaveTextContent(/^Pipeline$/);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
  });

  it('a base whose listed manifest states no version: Customize is disabled, saying so', async () => {
    mount({ basedOn: null });
    await openPipeline();
    expect(within(header()).getByTestId('studio-customize')).toBeDisabled();
    expect(within(header()).getByTestId('studio-customize-blocked')).toHaveAttribute('data-block', 'noVersion');
  });

  it('the read-only mark does not link a dashboard to Setup’s overlay page', async () => {
    mount();
    await openPipeline();
    const mark = within(header()).getByTestId('studio-readonly-link');
    expect(mark.tagName).toBe('SPAN');
    expect(mark).toHaveTextContent(t('engine.studio.pkg.readonly', 'en'));
  });
});

describe('Restore package original (objectstack#28562)', () => {
  it('on a customized dashboard: the pair’s draft and row are deleted at the pair, and the base reads back', async () => {
    srv.pairExists = true;
    srv.pairActive.set('dashboard/pipeline', {
      name: 'pipeline',
      label: 'Pipeline (ours)',
      widgets: [],
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    mount({ listedPair: PAIR });
    await waitFor(() => expect(screen.getByTestId('board-label')).toHaveTextContent('Pipeline (ours)'), { timeout: 8000 });
    // Served as an override: badged, editable, and no Customize to press.
    await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });
    expect(within(header()).queryByTestId('studio-customize')).toBeNull();
    expect(within(header()).queryByTestId('studio-readonly-link')).toBeNull();

    await restore();
    await waitFor(() => expect(srv.resets).toHaveLength(2), { timeout: 8000 });
    expect(srv.resets).toEqual([
      { type: 'dashboard', name: 'pipeline', opts: { state: 'draft', packageId: PAIR } },
      { type: 'dashboard', name: 'pipeline', opts: { packageId: PAIR } },
    ]);
    await waitFor(() => expect(screen.getByTestId('board-label')).toHaveTextContent(/^Pipeline$/), { timeout: 8000 });
    await waitFor(() => expect(within(header()).queryByTestId('studio-override-chip')).toBeNull());
    expect(within(header()).getByTestId('studio-customize')).toBeInTheDocument();
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
  });

  it('Cancel deletes nothing', async () => {
    srv.pairExists = true;
    srv.pairActive.set('dashboard/pipeline', {
      name: 'pipeline',
      label: 'Pipeline (ours)',
      widgets: [],
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    mount({ listedPair: PAIR });
    fireEvent.click(within(await openRestoreDialog()).getByTestId('studio-restore-original-cancel'));
    await sleep(300);
    expect(srv.resets).toEqual([]);
  });

  it('objectstack#29692 — one door: the item’s ⋯ menu offers no Restore, and the dialog names the item as its rail row does', async () => {
    srv.pairExists = true;
    srv.pairActive.set('dashboard/pipeline', {
      name: 'pipeline',
      label: 'Pipeline (ours)',
      widgets: [],
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    mount({ listedPair: PAIR });
    await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });
    fireEvent.pointerDown(screen.getByTestId('if-item-more'), { button: 0, ctrlKey: false });
    await screen.findByTestId('if-item-view-definition');
    expect(screen.queryByTestId('studio-restore-original')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('if-item-view-definition'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('if-item-view-definition')).toBeNull());

    const railRow = within(screen.getByTestId('studio-rail-interfaces')).getByRole('button', { name: /Pipeline/ });
    // The row's label, without the kind word the row prints after it.
    const railText = railRow.querySelector('.flex-1')?.textContent?.trim() ?? '';
    expect(railText).toBe('Pipeline');
    const dialog = await openRestoreDialog();
    expect(within(dialog).getByRole('heading')).toHaveTextContent(
      tFormat('engine.studio.customize.restoreConfirm', 'en', { package: 'HotCRM', item: railText }),
    );
    fireEvent.click(within(dialog).getByTestId('studio-restore-original-cancel'));
  });
});

/** The calendar setting `key` of the list-view panel. */
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

async function openOpportunities(): Promise<void> {
  await openPipeline();
  fireEvent.click(screen.getByRole('button', { name: /Opportunities/ }));
  await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
  await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Close date'), { timeout: 8000 });
}

/** Whether the header's view switcher (the title's ▾) offers New view; closes it again. */
async function newViewOffered(): Promise<boolean> {
  fireEvent.click(within(header()).getByTestId('list-view-switcher'));
  const menu = await screen.findByTestId('list-view-switcher-menu');
  const offered = within(menu).queryByTestId('list-view-switcher-new') !== null;
  fireEvent.keyDown(menu, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('list-view-switcher-menu')).toBeNull());
  return offered;
}

const canvasSchema = () => JSON.parse(screen.getByTestId('object-view-schema').textContent ?? '{}') as Record<string, unknown>;

describe('Customize an object leaf’s list view into the pair (objectstack#28562)', () => {
  it('the panel is read-only until Customize; the first edit writes the view’s draft into the pair, declaring the override', async () => {
    mount();
    await openOpportunities();
    expect(setting('startDateField')).toBeDisabled();
    // A new view would be a new item of the base: the header's view switcher offers none.
    expect(await newViewOffered()).toBe(false);

    await customize();
    expect(srv.ensure).toEqual([]);
    await pick('startDateField', 'Start date');
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    const [saved] = srv.saves;
    expect(saved).toMatchObject({ type: 'view', name: 'opportunity.default', opts: { mode: 'draft', packageId: PAIR } });
    expect((saved!.body.config as Record<string, unknown>).calendar).toEqual({ startDateField: 'start_date', titleField: 'name' });
    expect(saved!.body.overrides).toEqual({ package: BASE, basedOn: '4.0.0' });
    // Read at the base before the pair was there: pinned to "no draft in the pair".
    expect(saved!.opts).toMatchObject({ ifNoneMatch: '*' });
    expect(srv.base.get('view/opportunity.default')).toStrictEqual(BASE_ROWS['view/opportunity.default']);
    await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });
    expect(await newViewOffered()).toBe(false);
  });

  it('Restore brings back the base’s columns', async () => {
    const base = BASE_ROWS['view/opportunity.default']!;
    srv.pairExists = true;
    srv.pairActive.set('view/opportunity.default', {
      ...clone(base),
      config: { ...(clone(base.config) as Record<string, unknown>), columns: ['name', 'amount', 'stage'] },
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    mount({ listedPair: PAIR });
    await openPipeline();
    fireEvent.click(screen.getByRole('button', { name: /Opportunities/ }));
    await waitFor(() => expect(JSON.stringify(canvasSchema())).toContain('amount'), { timeout: 8000 });
    await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });

    await restore();
    await waitFor(() => expect(srv.resets).toHaveLength(2), { timeout: 8000 });
    expect(srv.resets.map((r) => [r.type, r.name, r.opts])).toEqual([
      ['view', 'opportunity.default', { state: 'draft', packageId: PAIR }],
      ['view', 'opportunity.default', { packageId: PAIR }],
    ]);
    await waitFor(() => expect(JSON.stringify(canvasSchema())).not.toContain('amount'), { timeout: 8000 });
    await waitFor(() => expect(within(header()).queryByTestId('studio-override-chip')).toBeNull());
  });
});

describe('Customize a list view’s selection actions into the pair (objectstack#30089)', () => {
  it('the first field update added on a read-only base is written into the pair’s copy, declaring the override', async () => {
    const base = BASE_ROWS['view/opportunity.default']!;
    const grid = { ...clone(base), config: { type: 'grid', data: { provider: 'object', object: 'opportunity' }, columns: ['name', 'stage'] } };
    srv.base.set('view/opportunity.default', grid);
    mount();
    await openPipeline();
    fireEvent.click(screen.getByRole('button', { name: /Opportunities/ }));
    const section = await screen.findByTestId('list-view-bulk', undefined, { timeout: 8000 });
    // Read-only until Customize: nothing to pick, nothing to add.
    expect(within(section).queryByTestId('list-view-bulk-add-def')).toBeNull();

    await customize();
    fireEvent.click(await within(screen.getByTestId('list-view-bulk')).findByTestId('list-view-bulk-add-def', undefined, { timeout: 8000 }));
    const form = await screen.findByTestId('list-view-bulk-new-def');
    fireEvent.change(within(form).getByTestId('list-view-bulk-new-def-label'), { target: { value: 'Change stage' } });
    const fieldPick = document.getElementById('studio-list-view-bulk-new-def-field')!;
    await waitFor(() => expect(fieldPick).toBeEnabled(), { timeout: 8000 });
    fireEvent.keyDown(fieldPick, { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getAllByRole('option').find((o) => o.querySelector('code')?.textContent === 'stage')!);
    fireEvent.click(within(form).getByTestId('list-view-bulk-new-def-add'));

    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    const [saved] = srv.saves;
    expect(saved).toMatchObject({ type: 'view', name: 'opportunity.default', opts: { mode: 'draft', packageId: PAIR } });
    expect((saved!.body.config as Record<string, unknown>).bulkActionDefs).toEqual([
      {
        name: 'update_stage',
        label: 'Change stage',
        operation: 'update',
        params: [{ name: 'stage', label: 'Stage', type: 'text', required: true }],
      },
    ]);
    expect(saved!.body.overrides).toEqual({ package: BASE, basedOn: '4.0.0' });
    expect(saved!.opts).toMatchObject({ ifNoneMatch: '*' });
    expect(srv.base.get('view/opportunity.default')).toStrictEqual(grid);
  });
});

describe('CONTROL: a writable package is edited in place (objectstack#28562)', () => {
  it('no Customize and no badge; an edit saves at the package with no declaration, and no door is asked', async () => {
    srv.base.set('dashboard/pipeline', { name: 'pipeline', label: 'Pipeline', widgets: [] });
    mockClient.save.mockImplementationOnce(async (type: string, name: string, item: unknown, opts: Record<string, unknown> = {}) => {
      srv.saves.push({ type, name, body: clone(item) as Record<string, unknown>, opts: clone(opts) });
      return { success: true, version: 'v1', state: 'draft' };
    });
    mount({ readOnly: false });
    await openPipeline();
    expect(within(header()).queryByTestId('studio-customize')).toBeNull();
    expect(within(header()).queryByTestId('studio-readonly-link')).toBeNull();

    patchBoard();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.saves[0]).toMatchObject({ type: 'dashboard', name: 'pipeline', opts: { packageId: BASE } });
    expect(srv.saves[0]!.body).toStrictEqual({ name: 'pipeline', label: 'Pipeline (ours)', widgets: [] });
    expect(srv.ensure).toEqual([]);
    expect(within(header()).queryByTestId('studio-override-chip')).toBeNull();
  });
});

/* ───────────── objectstack#30059 — the app's navigation ───────────── */

/** The served app override of the base's app: the pair's whole copy, one entry added. */
const CONTRACTS_ENTRY = { id: 'nav_contracts', type: 'object', label: 'Contracts', objectName: 'contract' };
const APP_OVERRIDE = { ...APP, navigation: [...NAV, CONTRACTS_ENTRY], overrides: { package: BASE, basedOn: '4.0.0' } };

/** The base's customization read listing the app's override (what the server serves once it is published). */
function marksListingTheApp(): PackageCustomizationsState {
  const read = {
    packageId: BASE,
    overrides: [{ type: 'app', name: 'crm_app', basedOn: '4.0.0' }],
    extensions: [],
    switchedOff: [],
    contributions: [],
    counts: { overrides: 1, extensions: 0, switchedOff: 0 },
  } as never;
  return { status: 'read', read, index: indexCustomizations(BASE, read)!, baseName: 'HotCRM', contributorNames: new Map() };
}

const rail = () => screen.getByTestId('studio-rail-interfaces');

/** The "+" menu's item `testId`, the menu opened first. */
async function addFromMenu(testId: string): Promise<void> {
  fireEvent.pointerDown(await within(rail()).findByTestId('if-create-menu', undefined, { timeout: 8000 }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByTestId(testId));
}

/** Open the picker named `name` and return its listbox. */
async function openPicker(name: string): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'ArrowDown' });
  return screen.findByRole('listbox');
}

async function openNavRestoreDialog(): Promise<HTMLElement> {
  fireEvent.click(await within(rail()).findByTestId('if-nav-override-mark', undefined, { timeout: 8000 }));
  const popover = await screen.findByTestId('if-nav-override-popover');
  await waitFor(() => expect(within(popover).getByTestId('if-nav-override-restore')).toBeEnabled(), { timeout: 8000 });
  fireEvent.click(within(popover).getByTestId('if-nav-override-restore'));
  return screen.findByTestId('studio-restore-original-dialog');
}

describe('Customize a read-only base’s navigation into its pair (objectstack#30059)', () => {
  it('Edit is offered and writes nothing; the first saved edit copies the whole app into the pair, declaring the override; the base is untouched', async () => {
    mount();
    await openPipeline();
    fireEvent.click(await within(rail()).findByTestId('if-edit-nav', undefined, { timeout: 8000 }));
    expect(await within(rail()).findByTestId('if-nav-saved-to')).toBeInTheDocument();
    // objectstack#30436 — and the sheet's second sentence, naming the pair.
    expect(within(rail()).getByTestId('if-nav-saved-to-environment')).toHaveTextContent(
      'These changes are kept in this environment’s database as items of com.example.hotcrm.custom, not in your project’s source. They reach another environment only through os package export.',
    );
    await sleep(1500);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
    fireEvent.click(within(rail()).getByTestId('if-edit-nav'));
    await waitFor(() => expect(within(rail()).queryByTestId('if-nav-saved-to')).toBeNull());

    // The "+" adds a navigation entry on the read-only base, as on a writable one.
    await addFromMenu('if-add-nav-separator');
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    const [saved] = srv.saves;
    // Read at the base before the pair was there: pinned to "no draft in the pair".
    expect(saved).toMatchObject({ type: 'app', name: 'crm_app', opts: { mode: 'draft', packageId: PAIR, ifNoneMatch: '*' } });
    // The whole app, without the base's `_` keys, declaring the override at the base's version.
    expect(saved!.body).toStrictEqual({
      name: 'crm_app',
      label: 'CRM',
      navigation: [...NAV, { id: 'nav_item_4', type: 'separator' }],
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    expect(srv.base.get('app/crm_app')).toStrictEqual(BASE_ROWS['app/crm_app']);

    // The rail marks the override the pair's draft now serves.
    fireEvent.click(await within(rail()).findByTestId('if-nav-override-mark', undefined, { timeout: 8000 }));
    expect(await screen.findByTestId('if-nav-override-facts')).toHaveTextContent(
      tFormat('engine.studio.customize.overridesTitle', 'en', { package: 'HotCRM', basedOn: '4.0.0' }),
    );
  });

  it('the pickers offer the pair’s items after the base’s; an entry bound to the pair’s object is saved into the pair gated on it', async () => {
    srv.pairExists = true;
    srv.pairListed.set('object', [{ name: 'contract', label: 'Contract' }]);
    srv.pairListed.set('dashboard', [{ name: 'renewals', label: 'Renewals' }]);
    mount({ listedPair: PAIR });
    await openPipeline();
    await addFromMenu('if-add-nav-object');

    let listbox = await openPicker(t('engine.studio.nav.linkObject', 'en'));
    await within(listbox).findByRole('option', { name: 'Contract (contract)' }, { timeout: 8000 });
    expect(within(listbox).getByRole('option', { name: 'Opportunity (opportunity)' })).toBeInTheDocument();
    fireEvent.click(within(listbox).getByRole('option', { name: 'Contract (contract)' }));
    await waitFor(() => expect(srv.saves.length).toBeGreaterThan(0), { timeout: 8000 });
    await waitFor(
      () =>
        expect(JSON.parse(JSON.stringify((srv.saves.at(-1)!.body.navigation as unknown[]).at(-1)))).toStrictEqual({
          id: 'nav_item_4',
          type: 'object',
          objectName: 'contract',
          // The pair's object can be removed while the copy still names it: the entry gates on it.
          requiresObject: 'contract',
        }),
      { timeout: 8000 },
    );
    expect(srv.saves.every((save) => save.opts.packageId === PAIR)).toBe(true);
    expect(srv.saves.at(-1)!.body.overrides).toEqual({ package: BASE, basedOn: '4.0.0' });

    // Rebound to an object the base ships, the entry carries no gate.
    const saved = srv.saves.length;
    listbox = await openPicker(t('engine.studio.nav.linkObject', 'en'));
    fireEvent.click(within(listbox).getByRole('option', { name: 'Opportunity (opportunity)' }));
    await waitFor(() => expect(srv.saves.length).toBeGreaterThan(saved), { timeout: 8000 });
    await waitFor(
      () =>
        expect(JSON.parse(JSON.stringify((srv.saves.at(-1)!.body.navigation as unknown[]).at(-1)))).toStrictEqual({
          id: 'nav_item_4',
          type: 'object',
          objectName: 'opportunity',
        }),
      { timeout: 8000 },
    );

    // A dashboard entry's picker offers the pair's dashboard.
    const dashboardChoice = screen.getAllByRole('radio').find((r) => (r as HTMLInputElement).value === 'dashboard')!;
    fireEvent.click(dashboardChoice);
    listbox = await openPicker(t('engine.inspector.appNav.type.dashboard', 'en'));
    expect(await within(listbox).findByRole('option', { name: /renewals/ }, { timeout: 8000 })).toBeInTheDocument();
  });

  it('the rail marks a served override and counts it under "only customizations", which keeps the navigation', async () => {
    srv.pairExists = true;
    srv.pairActive.set('app/crm_app', clone(APP_OVERRIDE));
    mount({ listedPair: PAIR, marks: marksListingTheApp() });
    await openPipeline();
    const mark = await within(rail()).findByTestId('if-nav-override-mark', undefined, { timeout: 8000 });
    expect(within(mark).getByTestId('customization-mark')).toHaveAttribute('data-kind', 'customized');
    const only = await within(rail()).findByTestId('studio-rail-customizations-only', undefined, { timeout: 8000 });
    expect(only).toHaveTextContent(tFormat('engine.list.customizations.only', 'en', { marked: 1 }));

    fireEvent.click(only);
    expect(only).toHaveAttribute('aria-pressed', 'true');
    expect(within(rail()).getByRole('button', { name: /Contracts/ })).toBeInTheDocument();
    expect(within(rail()).getByRole('button', { name: /Pipeline/ })).toBeInTheDocument();
  });

  it('Restore deletes the pair’s draft and row of the app after a confirmation, and the base’s navigation reads back', async () => {
    srv.pairExists = true;
    srv.pairActive.set('app/crm_app', clone(APP_OVERRIDE));
    mount({ listedPair: PAIR });
    await openPipeline();
    await within(rail()).findByRole('button', { name: /Contracts/ }, { timeout: 8000 });

    // Cancel deletes nothing.
    fireEvent.click(within(await openNavRestoreDialog()).getByTestId('studio-restore-original-cancel'));
    await sleep(300);
    expect(srv.resets).toEqual([]);

    const dialog = await openNavRestoreDialog();
    expect(within(dialog).getByRole('heading')).toHaveTextContent(
      tFormat('engine.studio.customize.restoreConfirm', 'en', { package: 'HotCRM', item: 'CRM' }),
    );
    fireEvent.click(within(dialog).getByTestId('studio-restore-original-confirm'));
    await waitFor(() => expect(srv.resets).toHaveLength(2), { timeout: 8000 });
    expect(srv.resets).toEqual([
      { type: 'app', name: 'crm_app', opts: { state: 'draft', packageId: PAIR } },
      { type: 'app', name: 'crm_app', opts: { packageId: PAIR } },
    ]);
    await waitFor(() => expect(within(rail()).queryByRole('button', { name: /Contracts/ })).toBeNull(), { timeout: 8000 });
    await waitFor(() => expect(within(rail()).queryByTestId('if-nav-override-mark')).toBeNull());
    expect(within(rail()).getByTestId('if-edit-nav')).toBeInTheDocument();
    expect(srv.base.get('app/crm_app')).toStrictEqual(BASE_ROWS['app/crm_app']);
    expect(srv.saves).toEqual([]);
  });

  it('a walled caller is offered neither the navigation edit nor the "+"', async () => {
    mount({ walled: true });
    await openPipeline();
    await sleep(500);
    expect(within(rail()).queryByTestId('if-edit-nav')).toBeNull();
    expect(within(rail()).queryByTestId('if-create-menu')).toBeNull();
    expect(srv.ensure).toEqual([]);
  });

  it('CONTROL: on a writable package the navigation saves at the package, with no door and no declaration', async () => {
    srv.base.set('app/crm_app', clone(APP));
    mockClient.save.mockImplementationOnce(async (type: string, name: string, item: unknown, opts: Record<string, unknown> = {}) => {
      srv.saves.push({ type, name, body: clone(item) as Record<string, unknown>, opts: clone(opts) });
      return { success: true, version: 'v1', state: 'draft' };
    });
    mount({ readOnly: false });
    await openPipeline();
    await addFromMenu('if-add-nav-separator');
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.saves[0]).toMatchObject({ type: 'app', name: 'crm_app', opts: { packageId: BASE } });
    expect(srv.saves[0]!.body).toStrictEqual({ ...APP, navigation: [...NAV, { id: 'nav_item_4', type: 'separator' }] });
    expect(srv.ensure).toEqual([]);
    expect(within(rail()).queryByTestId('if-nav-override-mark')).toBeNull();
    expect(within(rail()).queryByTestId('if-nav-saved-to')).toBeNull();
  });
});

/* ───────────── objectstack#30063 — a page ───────────── */

const SHIPPED_REGIONS = BASE_ROWS['page/crm_welcome']!.regions;
const OURS_REGIONS = [{ name: 'main', components: [{ type: 'element:text', properties: { content: 'Shipped text (ours)' } }] }];
/** The served page override: the pair's whole copy, its text changed. */
const PAGE_OVERRIDE = {
  name: 'crm_welcome',
  label: 'Welcome',
  type: 'home',
  kind: 'full',
  regions: OURS_REGIONS,
  overrides: { package: BASE, basedOn: '4.0.0' },
};
const patchPage = () => fireEvent.click(screen.getByRole('button', { name: 'patch the page' }));

/** The Welcome page open from its rail row, past the first leaf the pillar opens. */
async function openWelcome(text: RegExp = /^Shipped text$/): Promise<void> {
  await openPipeline();
  fireEvent.click(await within(rail()).findByRole('button', { name: /Welcome/ }, { timeout: 8000 }));
  await waitFor(() => expect(screen.getByTestId('page-text')).toHaveTextContent(text), { timeout: 8000 });
}

/** The base's customization read listing the page's override. */
function marksListingThePage(): PackageCustomizationsState {
  const read = {
    packageId: BASE,
    overrides: [{ type: 'page', name: 'crm_welcome', basedOn: '4.0.0' }],
    extensions: [],
    switchedOff: [],
    contributions: [],
    counts: { overrides: 1, extensions: 0, switchedOff: 0 },
  } as never;
  return { status: 'read', read, index: indexCustomizations(BASE, read)!, baseName: 'HotCRM', contributorNames: new Map() };
}

describe('Customize a read-only base’s page into its pair (objectstack#30063)', () => {
  it('Customize is offered and writes nothing; the first designer edit copies the whole page into the pair, declaring the override; the base is untouched', async () => {
    mount();
    await openWelcome();
    expect(within(header()).getByTestId('studio-customize')).toBeEnabled();
    // Until it is pressed the designer edits nothing.
    patchPage();
    expect(screen.getByTestId('page-text')).toHaveTextContent(/^Shipped text$/);

    await customize();
    await sleep(1500);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);

    patchPage();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    const [saved] = srv.saves;
    // Read at the base before the pair was there: pinned to "no draft in the pair".
    expect(saved).toMatchObject({ type: 'page', name: 'crm_welcome', opts: { mode: 'draft', packageId: PAIR, ifNoneMatch: '*' } });
    // The whole page, without the base's `_` keys, declaring the override at the base's version.
    expect(saved!.body).toStrictEqual({
      name: 'crm_welcome',
      label: 'Welcome',
      type: 'home',
      kind: 'full',
      regions: OURS_REGIONS,
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    expect(srv.base.get('page/crm_welcome')).toStrictEqual(BASE_ROWS['page/crm_welcome']);
    await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });

    // The next designer edit saves into the pair's copy, at the version it was answered.
    patchPage();
    await waitFor(() => expect(srv.saves).toHaveLength(2), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    expect(srv.saves[1]!.opts).toMatchObject({ packageId: PAIR, ifMatch: 'v1' });
    expect(srv.saves[1]!.body.overrides).toEqual({ package: BASE, basedOn: '4.0.0' });
  });

  it('a served override opens in the designer as the pair’s copy, editable, with no Customize to press', async () => {
    srv.pairExists = true;
    srv.pairActive.set('page/crm_welcome', clone(PAGE_OVERRIDE));
    mount({ listedPair: PAIR });
    await openWelcome(/^Shipped text \(ours\)$/);
    await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });
    expect(within(header()).queryByTestId('studio-customize')).toBeNull();

    patchPage();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.saves[0]).toMatchObject({ type: 'page', name: 'crm_welcome', opts: { packageId: PAIR } });
    expect(srv.saves[0]!.body.overrides).toEqual({ package: BASE, basedOn: '4.0.0' });
  });

  it('Restore deletes the pair’s draft and row of the page, and the shipped page reads back', async () => {
    srv.pairExists = true;
    srv.pairActive.set('page/crm_welcome', clone(PAGE_OVERRIDE));
    mount({ listedPair: PAIR });
    await openWelcome(/^Shipped text \(ours\)$/);
    await restore();
    await waitFor(() => expect(srv.resets).toHaveLength(2), { timeout: 8000 });
    expect(srv.resets).toEqual([
      { type: 'page', name: 'crm_welcome', opts: { state: 'draft', packageId: PAIR } },
      { type: 'page', name: 'crm_welcome', opts: { packageId: PAIR } },
    ]);
    await waitFor(() => expect(screen.getByTestId('page-text')).toHaveTextContent(/^Shipped text$/), { timeout: 8000 });
    await waitFor(() => expect(within(header()).queryByTestId('studio-override-chip')).toBeNull());
    expect(within(header()).getByTestId('studio-customize')).toBeInTheDocument();
    expect(srv.base.get('page/crm_welcome')!.regions).toStrictEqual(SHIPPED_REGIONS);
    expect(srv.saves).toEqual([]);
  });

  it('the rail marks a customized page and counts it under "only customizations", which lists it', async () => {
    srv.pairExists = true;
    srv.pairActive.set('page/crm_welcome', clone(PAGE_OVERRIDE));
    mount({ listedPair: PAIR, marks: marksListingThePage() });
    await openPipeline();
    const row = await within(rail()).findByRole('button', { name: /Welcome/ }, { timeout: 8000 });
    await waitFor(() => expect(within(row).getByTestId('customization-mark')).toHaveAttribute('data-kind', 'customized'), {
      timeout: 8000,
    });
    const only = await within(rail()).findByTestId('studio-rail-customizations-only', undefined, { timeout: 8000 });
    expect(only).toHaveTextContent(tFormat('engine.list.customizations.only', 'en', { marked: 1 }));

    fireEvent.click(only);
    expect(only).toHaveAttribute('aria-pressed', 'true');
    expect(within(rail()).getByRole('button', { name: /Welcome/ })).toBeInTheDocument();
    expect(within(rail()).queryByRole('button', { name: /Forecast/ })).toBeNull();
  });

  it('CONTROL: on a writable package a page edit saves at the package, with no door and no declaration', async () => {
    mockClient.save.mockImplementationOnce(async (type: string, name: string, item: unknown, opts: Record<string, unknown> = {}) => {
      srv.saves.push({ type, name, body: clone(item) as Record<string, unknown>, opts: clone(opts) });
      return { success: true, version: 'v1', state: 'draft' };
    });
    mount({ readOnly: false });
    await openWelcome();
    expect(within(header()).queryByTestId('studio-customize')).toBeNull();
    patchPage();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.saves[0]).toMatchObject({ type: 'page', name: 'crm_welcome', opts: { packageId: BASE } });
    expect(srv.saves[0]!.body).not.toHaveProperty('overrides');
    expect(srv.saves[0]!.body.regions).toStrictEqual(OURS_REGIONS);
    expect(srv.ensure).toEqual([]);
  });
});
