// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28572 (ADR-0146 D3, "On top, one surface") — Studio shows a
 * read-only base and its paired `<base>.custom` package as ONE surface.
 *
 * The REAL `StudioDesignSurface` and the REAL metadata client over a fetch
 * stub that serves the package list (the base read-only, its pair writable,
 * and a third package), the base's customization read (N-15), the ensure
 * door, and the base's and the pair's item lists. Stubbed: the dashboard
 * canvas (its label and one edit), the "All metadata" area (the package it
 * holds), `DraftChangesPanel`, and the session.
 *
 * Pinned:
 *  - the Interfaces rail lists the base's items and the pair's added item as
 *    one list: the override the read lists is marked "customized", the
 *    pair's own item "added", every other row nothing;
 *  - "only customizations" lists exactly those two;
 *  - the package switcher gives the pair no row, and names it under the base;
 *  - a pillar URL of the pair lands on the base, its query kept; the pair's
 *    "All metadata" URL is NOT sent to the base (no loop);
 *  - New on the read-only base asks the ensure door, writes the item into the
 *    pair the door named, links no nav entry, and opens it naming the pair;
 *  - an added item opens writable: its edit saves at the pair, declaring no
 *    override, with no Customize and no read-only link;
 *  - the Data rail lists the pair's added object, marked, opening it names
 *    the pair;
 *  - nothing a third package contributes is drawn: no read names it
 *    (objectstack#28722), and the rail asks none;
 *  - CONTROL: a base with no pair reads no pair list, and draws no mark and
 *    no filter.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';
const ADDON = 'com.acme.addon';

const NAV = [{ id: 'nav_pipeline', type: 'dashboard', label: 'Pipeline', dashboardName: 'pipeline' }];
const APP = { name: 'crm_app', label: 'CRM', navigation: NAV };

const srv = vi.hoisted(() => ({
  pairListed: true,
  /** Items of the pair by `type/name`: published rows and drafts the stub keeps. */
  pairItems: new Map<string, Record<string, unknown>>(),
  pairDrafts: new Map<string, Record<string, unknown>>(),
  reads: [] as string[],
  ensure: [] as number[],
  saves: [] as Array<{ path: string; search: string; body: Record<string, unknown> }>,
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  return { ...actual, useAuth: () => ({ ...actual.useAuth(), user: null, getAuthConfig: async () => ({ features: {} }) }) };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});
vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));
vi.mock('./StudioMetadataArea', () => ({
  StudioMetadataArea: ({ packageId }: { packageId: string | null }) => (
    <div data-testid="metadata-area" data-package={packageId ?? ''} />
  ),
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { t, tFormat } from '../metadata-admin/i18n';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

function BoardCanvas({ draft, onPatch }: { draft: Record<string, unknown>; onPatch?: (patch: Record<string, unknown>) => void }) {
  return (
    <div>
      <p data-testid="board-label">{String(draft?.label ?? '')}</p>
      <button type="button" disabled={!onPatch} onClick={() => onPatch?.({ label: `${String(draft?.label ?? '')} (ours)` })}>
        patch the board
      </button>
    </div>
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function packageRows() {
  return [
    { manifest: { id: BASE, name: 'HotCRM', namespace: 'hotcrm', version: '4.0.0' }, writable: false },
    ...(srv.pairListed
      ? [{ manifest: { id: PAIR, name: 'HotCRM customizations', namespace: 'hotcrm_custom', version: '0.1.0' }, writable: true }]
      : []),
    { manifest: { id: ADDON, name: 'Acme add-on', namespace: 'acme', version: '1.0.0' }, writable: false },
  ];
}

/** The base's read: its `pipeline` dashboard overridden, and a field its pair adds to `crm_account`. */
const READ = {
  packageId: BASE,
  overrides: [{ type: 'dashboard', name: 'pipeline', basedOn: '4.0.0' }],
  extensions: [{ object: 'crm_account', kind: 'field', name: 'tier__c' }],
  switchedOff: [],
  contributions: [],
  counts: { overrides: 1, extensions: 1, switchedOff: 0, contributions: 0 },
};
const EMPTY_READ = { packageId: BASE, overrides: [], extensions: [], switchedOff: [], contributions: [], counts: { overrides: 0, extensions: 0, switchedOff: 0, contributions: 0 } };

/** The base's own lists, by type. The override is served under the base's name (ADR-0146 D8 item 2). */
const BASE_LISTS: Record<string, Array<Record<string, unknown>>> = {
  dashboard: [
    { name: 'pipeline', label: 'Pipeline (ours)', _packageId: BASE },
    { name: 'forecast', label: 'Forecast', _packageId: BASE },
  ],
  object: [
    { name: 'crm_account', label: 'Account', _packageId: BASE },
    { name: 'crm_deal', label: 'Deal', _packageId: BASE },
  ],
};

function pairList(type: string) {
  return [...srv.pairItems.entries()]
    .filter(([key]) => key.startsWith(`${type}/`))
    .map(([, body]) => ({ ...body, _packageId: PAIR }));
}

const draftRows = (scope: string | null, type: string | null) =>
  scope === PAIR
    ? [...srv.pairDrafts.entries()]
        .map(([key, body]) => {
          const [ty, name] = key.split('/') as [string, string];
          return { type: ty, name, packageId: PAIR, label: body.label };
        })
        .filter((d) => !type || d.type === type)
    : [];

function item(type: string, name: string, search: URLSearchParams): Record<string, unknown> | undefined {
  const pkg = search.get('package');
  if (pkg === PAIR) return srv.pairDrafts.get(`${type}/${name}`) ?? srv.pairItems.get(`${type}/${name}`);
  return undefined;
}

beforeAll(() => {
  registerMetadataPreview('dashboard', BoardCanvas as never);
});

beforeEach(() => {
  srv.pairListed = true;
  srv.pairItems.clear();
  srv.pairDrafts.clear();
  srv.pairItems.set('dashboard/pipeline', { name: 'pipeline', label: 'Pipeline (ours)', widgets: [], overrides: { package: BASE, basedOn: '4.0.0' } });
  srv.pairItems.set('dashboard/wins', { name: 'wins', label: 'Wins', widgets: [] });
  srv.pairItems.set('object/hotcrm_custom_survey', { name: 'hotcrm_custom_survey', label: 'Survey' });
  srv.reads.length = 0;
  srv.ensure.length = 0;
  srv.saves.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      if (method === 'GET') srv.reads.push(`${path}${url.search}`);
      if (path === '/api/v1/packages') return json({ success: true, data: packageRows() });
      if (path === `/api/v1/packages/${BASE}/customizations`) {
        return json({ success: true, data: srv.pairListed ? READ : EMPTY_READ });
      }
      if (path === `/api/v1/packages/${BASE}/ensure-customization` && method === 'POST') {
        const created = !srv.pairListed;
        srv.pairListed = true;
        srv.ensure.push(created ? 201 : 200);
        return json(
          { success: true, data: { basePackageId: BASE, packageId: PAIR, namespace: 'hotcrm_custom', dependencyRange: '^4', created, writable: true } },
          created ? 201 : 200,
        );
      }
      if (path === '/api/v1/meta/_drafts') {
        return json({ drafts: draftRows(url.searchParams.get('packageId'), url.searchParams.get('type')) });
      }
      if (path === '/api/v1/meta/app') {
        return json(url.searchParams.get('package') === PAIR ? [] : [{ name: 'crm_app', label: 'CRM' }]);
      }
      if (path === '/api/v1/meta/app/crm_app/layers') return json({ code: null, overlay: null, overlayScope: null, effective: APP });
      const list = /^\/api\/v1\/meta\/([^/]+)$/.exec(path);
      if (list && method === 'GET') {
        const type = decodeURIComponent(list[1]!);
        const pkg = url.searchParams.get('package');
        if (pkg === PAIR) return json(srv.pairListed ? pairList(type) : []);
        if (pkg === BASE) return json(BASE_LISTS[type] ?? []);
        return json([...(BASE_LISTS[type] ?? []), ...pairList(type)]);
      }
      const one = /^\/api\/v1\/meta\/([^/]+)\/([^/]+)$/.exec(path);
      if (one) {
        const [type, name] = [decodeURIComponent(one[1]!), decodeURIComponent(one[2]!)];
        if (method === 'PUT') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          srv.saves.push({ path, search: url.search, body });
          if (url.searchParams.get('package') !== PAIR) return json({ success: false, error: { message: 'read-only' } }, 403);
          srv.pairDrafts.set(`${type}/${name}`, body);
          return json({ success: true, version: `v${srv.saves.length}`, state: 'draft' });
        }
        const held = item(type, name, url.searchParams);
        return held ? json({ type, name, item: held, version: 'v1' }) : json({}, 404);
      }
      if (path.endsWith('/layers')) {
        const m = /^\/api\/v1\/meta\/([^/]+)\/([^/]+)\/layers$/.exec(path);
        const base = m ? BASE_LISTS[decodeURIComponent(m[1]!)]?.find((r) => r.name === decodeURIComponent(m[2]!)) : undefined;
        const held = m ? srv.pairItems.get(`${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}`) : undefined;
        const doc = base ?? held ?? null;
        return json({ code: doc, overlay: null, overlayScope: null, effective: doc });
      }
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const ifRail = () => screen.getByTestId('studio-rail-interfaces');
const dataRail = () => screen.getByTestId('studio-rail-data');
/** The rail row that opens `type:name` (its tooltip is `type · name`). */
const rowOf = (rail: HTMLElement, type: string, name: string) => within(rail).queryByTitle(`${type} · ${name}`);
const markOf = (row: HTMLElement | null) => row?.querySelector('[data-testid="customization-mark"]')?.getAttribute('data-kind') ?? null;

async function interfacesReady(): Promise<void> {
  await waitFor(() => expect(rowOf(ifRail(), 'dashboard', 'wins')).not.toBeNull(), { timeout: 8000 });
  await waitFor(() => expect(markOf(rowOf(ifRail(), 'dashboard', 'wins'))).toBe('added'), { timeout: 8000 });
}

describe('the Interfaces rail lists a base and its pair as one list (objectstack#28572)', () => {
  it('marks the served override "customized" and the pair’s own item "added", and nothing else', async () => {
    renderAt(`/studio/${BASE}/interfaces`);
    await interfacesReady();
    // The nav entry opens the overridden dashboard: marked from the read.
    expect(markOf(rowOf(ifRail(), 'dashboard', 'pipeline'))).toBe('customized');
    // The base's own dashboard, which the read does not list.
    expect(rowOf(ifRail(), 'dashboard', 'forecast')).not.toBeNull();
    expect(markOf(rowOf(ifRail(), 'dashboard', 'forecast'))).toBeNull();
    // Listed once each: the pair's copy of the override is the base's row.
    expect(within(ifRail()).getAllByTitle('dashboard · pipeline')).toHaveLength(1);
  });

  it('"only customizations" lists exactly the customized and the added item', async () => {
    renderAt(`/studio/${BASE}/interfaces`);
    await interfacesReady();
    const only = within(ifRail()).getByTestId('studio-rail-customizations-only');
    expect(only).toHaveTextContent(tFormat('engine.list.customizations.only', 'en', { marked: 2 }));
    expect(only).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(only);
    expect(only).toHaveAttribute('aria-pressed', 'true');
    const rows = within(ifRail())
      .getAllByRole('button')
      .map((b) => b.getAttribute('title'))
      .filter((title): title is string => !!title && title.includes(' · '));
    expect(rows.sort()).toEqual(['dashboard · pipeline', 'dashboard · wins']);

    fireEvent.click(only);
    await waitFor(() => expect(rowOf(ifRail(), 'dashboard', 'forecast')).not.toBeNull());
  });

  it('an added item opens writable: its edit saves at the pair, declaring no override', async () => {
    renderAt(`/studio/${BASE}/interfaces`);
    await interfacesReady();
    fireEvent.click(rowOf(ifRail(), 'dashboard', 'wins')!);
    await waitFor(() => expect(screen.getByTestId('board-label')).toHaveTextContent('Wins'), { timeout: 8000 });
    const header = screen.getByTestId('if-item-header');
    expect(within(header).getByTestId('studio-pair-item-chip')).toHaveTextContent(
      tFormat('engine.studio.customize.addedIn', 'en', { pair: PAIR }),
    );
    expect(within(header).queryByTestId('studio-customize')).toBeNull();
    expect(within(header).queryByTestId('studio-readonly-link')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'patch the board' }));
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    const [saved] = srv.saves;
    expect(saved!.path).toBe('/api/v1/meta/dashboard/wins');
    expect(new URLSearchParams(saved!.search).get('package')).toBe(PAIR);
    expect(saved!.body).toStrictEqual({ name: 'wins', label: 'Wins (ours)', widgets: [] });
    // An added item is the pair's already: the door is not asked.
    expect(srv.ensure).toEqual([]);
  });

  it('New on the read-only base asks the ensure door, writes into the pair it names, and links no nav entry', async () => {
    renderAt(`/studio/${BASE}/interfaces`);
    await interfacesReady();
    await userEvent.click(await within(ifRail()).findByTestId('if-create-menu'));
    // Only the kinds that create an item: a nav entry of the base takes no edit.
    expect(screen.queryByTestId('if-add-nav-url')).toBeNull();
    await userEvent.click(await screen.findByTestId('if-create-dashboard'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(tFormat('engine.studio.interfaces.create.descriptionInPair', 'en', { baseName: 'HotCRM' }));
    fireEvent.change(within(dialog).getByPlaceholderText(t('engine.studio.interfaces.create.dashboardNamePlaceholder', 'en')), {
      target: { value: 'Churn watch' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: t('engine.studio.createDraft', 'en') }));

    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([200]);
    const [saved] = srv.saves;
    expect(saved!.path).toBe('/api/v1/meta/dashboard/churn_watch');
    expect(new URLSearchParams(saved!.search).get('package')).toBe(PAIR);
    // No app save: the base's navigation stays as installed.
    expect(srv.saves.some((s) => s.path.startsWith('/api/v1/meta/app/'))).toBe(false);

    // It opens at once, naming the pair, and the rail lists it as added.
    await waitFor(() => expect(within(screen.getByTestId('if-item-header')).getByTestId('studio-pair-item-chip')).toBeInTheDocument(), {
      timeout: 8000,
    });
    await waitFor(() => expect(markOf(rowOf(ifRail(), 'dashboard', 'churn_watch'))).toBe('added'), { timeout: 8000 });
  });
});

describe('the Data rail lists the pair’s objects with the base’s (objectstack#28572)', () => {
  it('marks the pair’s object "added"; the base’s objects carry no mark; opening it names the pair', async () => {
    renderAt(`/studio/${BASE}/data`);
    await waitFor(() => expect(within(dataRail()).getByText('Survey')).toBeInTheDocument(), { timeout: 8000 });
    const survey = within(dataRail()).getByText('Survey').closest('button');
    await waitFor(() => expect(markOf(survey)).toBe('added'), { timeout: 8000 });
    // The extension the pair adds to `crm_account` is no override and no
    // added item: the object is the base's, unmarked.
    expect(markOf(within(dataRail()).getByText('Account').closest('button'))).toBeNull();
    expect(markOf(within(dataRail()).getByText('Deal').closest('button'))).toBeNull();

    fireEvent.click(survey!);
    await waitFor(
      () => expect(within(screen.getByTestId('data-object-header')).getByTestId('studio-pair-item-chip')).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });
});

describe('the package switcher and the pair’s URLs (objectstack#28572)', () => {
  it('the switcher gives the pair no row, and names it under its base', async () => {
    renderAt(`/studio/${BASE}/interfaces`);
    await waitFor(() => expect(document.querySelector('[data-slot="pkg-name"]')).toHaveTextContent('HotCRM'), { timeout: 8000 });
    fireEvent.click(document.querySelector('[data-slot="pkg-name"]')!.closest('button')!);
    await waitFor(() => expect(screen.getAllByTestId('studio-switcher-row').length).toBeGreaterThan(0), { timeout: 8000 });
    const rows = screen.getAllByTestId('studio-switcher-row');
    expect(rows.map((r) => r.getAttribute('data-package'))).toEqual([BASE, ADDON]);
    expect(within(rows[0]!).getByTestId('studio-switcher-pair')).toHaveTextContent(
      tFormat('engine.studio.pkg.withPair', 'en', { pair: PAIR }),
    );
  });

  it('a pillar URL of the pair lands on the base’s surface, its query kept', async () => {
    renderAt(`/studio/${encodeURIComponent(PAIR)}/interfaces?surface=dashboard:wins`);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(new RegExp(`^/studio/${BASE}/interfaces\\?`)));
    // The item the pair adds opens once the pair is known, at the pair.
    await waitFor(() => expect(screen.getByTestId('board-label')).toHaveTextContent('Wins'), { timeout: 8000 });
    expect(within(screen.getByTestId('if-item-header')).getByTestId('studio-pair-item-chip')).toBeInTheDocument();
  });

  it('the pair’s "All metadata" URL stays on the pair: it is not sent to the base, so nothing loops', async () => {
    renderAt(`/studio/${encodeURIComponent(PAIR)}/metadata`);
    const area = await screen.findByTestId('metadata-area', undefined, { timeout: 8000 });
    expect(area).toHaveAttribute('data-package', PAIR);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${encodeURIComponent(PAIR)}/metadata`);
  });
});

describe('nothing a third package contributes is drawn (objectstack#28722)', () => {
  it('the rails ask no list of another package, and no row names one', async () => {
    renderAt(`/studio/${BASE}/interfaces`);
    await interfacesReady();
    expect(srv.reads.filter((r) => r.includes(encodeURIComponent(ADDON)) || r.includes(`package=${ADDON}`))).toEqual([]);
    expect(within(ifRail()).queryByText(/acme/i)).toBeNull();
  });
});

describe('CONTROL: a base with no pair is unchanged (objectstack#28572)', () => {
  it('reads no pair list, and draws no mark and no filter', async () => {
    srv.pairListed = false;
    renderAt(`/studio/${BASE}/interfaces`);
    await waitFor(() => expect(rowOf(ifRail(), 'dashboard', 'forecast')).not.toBeNull(), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(srv.reads.filter((r) => r.includes(`package=${encodeURIComponent(PAIR)}`))).toEqual([]);
    expect(within(ifRail()).queryByTestId('customization-mark')).toBeNull();
    expect(within(ifRail()).queryByTestId('studio-rail-customizations-only')).toBeNull();
    expect(rowOf(ifRail(), 'dashboard', 'wins')).toBeNull();
  });
});
