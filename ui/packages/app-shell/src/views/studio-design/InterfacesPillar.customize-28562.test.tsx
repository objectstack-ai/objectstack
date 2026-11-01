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
  'dashboard/pipeline': { name: 'pipeline', label: 'Pipeline', widgets: [], _packageId: BASE },
  'dashboard/forecast': { name: 'forecast', label: 'Forecast', widgets: [], _packageId: BASE },
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
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'crm_app', label: 'CRM' }];
    if (type === 'object') return [{ name: 'opportunity', label: 'Opportunity' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async (type: string) => (type === 'object' ? OBJECT_DEF : undefined)),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: APP };
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
  ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
});

beforeEach(() => {
  srv.base.clear();
  for (const [key, row] of Object.entries(BASE_ROWS)) srv.base.set(key, clone(row));
  srv.pairActive.clear();
  srv.pairDrafts.clear();
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

/** What the Studio surface hands the pillar on a read-only base: the pair's id comes from the door's answer. */
function Host({
  readOnly = true,
  walled = false,
  basedOn = '4.0.0',
  listedPair = null,
}: {
  readOnly?: boolean;
  walled?: boolean;
  basedOn?: string | null;
  listedPair?: string | null;
}) {
  const [pairId, setPairId] = React.useState<string | null>(listedPair);
  const ensure = React.useCallback(async () => {
    const answer = await ensureCustomizationPackage(BASE);
    setPairId(answer.packageId);
    return answer.packageId;
  }, []);
  const customization = React.useMemo<StudioBaseCustomization | null>(
    () => (readOnly ? { base: BASE, baseLabel: 'HotCRM', basedOn, walled, pairId, ensure } : null),
    [readOnly, basedOn, walled, pairId, ensure],
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

async function restore(): Promise<void> {
  fireEvent.pointerDown(await screen.findByTestId('if-item-more', undefined, { timeout: 8000 }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByTestId('studio-restore-original'));
  const dialog = await screen.findByTestId('studio-restore-original-dialog');
  fireEvent.click(within(dialog).getByTestId('studio-restore-original-confirm'));
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
    expect(chip).toHaveTextContent(tFormat('engine.studio.customize.overrides', 'en', { base: 'HotCRM' }));
    expect(chip).toHaveAttribute('title', tFormat('engine.studio.customize.overridesTitle', 'en', { base: 'HotCRM', basedOn: '4.0.0' }));

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
    await within(header()).findByTestId('studio-override-chip', undefined, { timeout: 8000 });
    fireEvent.pointerDown(screen.getByTestId('if-item-more'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId('studio-restore-original'));
    fireEvent.click(within(await screen.findByTestId('studio-restore-original-dialog')).getByTestId('studio-restore-original-cancel'));
    await sleep(300);
    expect(srv.resets).toEqual([]);
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

const canvasSchema = () => JSON.parse(screen.getByTestId('object-view-schema').textContent ?? '{}') as Record<string, unknown>;

describe('Customize an object leaf’s list view into the pair (objectstack#28562)', () => {
  it('the panel is read-only until Customize; the first edit writes the view’s draft into the pair, declaring the override', async () => {
    mount();
    await openOpportunities();
    expect(setting('startDateField')).toBeDisabled();
    // A new view would be a new item of the base: not offered.
    expect(screen.getByRole('button', { name: t('engine.studio.inspector.listView.addView', 'en') })).toBeDisabled();

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
    expect(screen.getByRole('button', { name: t('engine.studio.inspector.listView.addView', 'en') })).toBeDisabled();
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
