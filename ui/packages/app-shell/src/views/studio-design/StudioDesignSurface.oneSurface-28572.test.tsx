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
 *  - the Data rail lists the pair's added object, marked, and opening it names
 *    the pair;
 *  - a pillar URL of the pair lands on the base, its query kept; the pair's
 *    "All metadata" URL is NOT sent to the base (no loop);
 *  - the rails ask no list of a third package: what it contributes comes from
 *    the base's one customization read (objectstack#29786, below);
 *  - CONTROL: a base with no pair reads no pair list, and draws no mark and
 *    no filter.
 *
 * The Interfaces rail's pins (one list of the base's and the pair's
 * dashboards, "only customizations", New into the pair, contributed nav
 * entries and a contributor-only package's text) retired with that pillar,
 * objectstack#36502.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  /** objectstack#29786 — the read serves {@link CONTRIBUTIONS}, and the app and object hold what they target. */
  contributed: false,
  /** objectstack#29851 — the base's `/meta/app` row serves the folded navigation ({@link SERVED_APP}). */
  servedFold: false,
  /** objectstack#29851 — the add-on is a contributor with no app of its own (see {@link addonRow}). */
  addonContributes: false,
  /** objectstack#29851 — the add-on's listed row says it is disabled; the server then lists none of its entries. */
  addonDisabled: false,
  /** objectstack#29851 — how `GET /meta/app/crm_app` answers. */
  targetApp: 'served' as 'served' | 'missing' | 'fails',
  /** objectstack#29851 — the base's customization read fails. */
  ownerReadFails: false,
  /** objectstack#29851 — the add-on declares its entries for this app. */
  declaredApp: 'crm_app',
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

// The console's preview and authoring code loads `@objectstack/lint` lazily;
// warmed here so its first load is paid at import, not inside a test's clock.
import '@objectstack/lint';
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
    addonRow(),
  ];
}

/**
 * objectstack#29851 — the add-on's listed row. As a contributor it declares
 * navigation for the base's app: the declaration is an address only, so the
 * stub's served reads decide what Studio says.
 */
function addonRow() {
  const manifest: Record<string, unknown> = { id: ADDON, name: 'Acme add-on', namespace: 'acme', version: '1.0.0' };
  if (srv.addonContributes) {
    manifest.navigationContributions = [
      { app: srv.declaredApp, group: 'service_group', items: [{ id: 'nav_cases', type: 'url', url: '/cases' }] },
    ];
  }
  return { manifest, writable: false, ...(srv.addonDisabled ? { enabled: false } : {}) };
}

/** The base's read: its `pipeline` dashboard overridden, and a field its pair adds to `crm_account`. */
const READ = {
  packageId: BASE,
  overrides: [{ type: 'dashboard', name: 'pipeline', basedOn: '4.0.0' }],
  extensions: [{ object: 'crm_account', kind: 'field', name: 'tier__c' }],
  switchedOff: [],
  arrangements: [],
  contributions: [],
  counts: { overrides: 1, extensions: 1, switchedOff: 0, arrangements: 0, contributions: 0 },
};
/**
 * objectstack#29786 — what the third package contributes to the base: a nav
 * entry into a group the app declares, one into a group it does not declare,
 * one for another app, a field and a flow on `crm_account`, and a flow on
 * `crm_deal`, which holds no flow of the base's.
 */
const CONTRIBUTIONS = [
  { kind: 'field', object: 'crm_account', name: 'acme_score', packageId: ADDON },
  { kind: 'flow', object: 'crm_account', name: 'acme_sync', packageId: ADDON },
  { kind: 'flow', object: 'crm_deal', name: 'acme_deal_watch', packageId: ADDON },
  { kind: 'nav', app: 'crm_app', group: 'service_group', name: 'nav_cases', packageId: ADDON },
  { kind: 'nav', app: 'crm_app', group: 'ghost_group', name: 'nav_knowledge', packageId: ADDON },
  { kind: 'nav', app: 'other_app', name: 'nav_elsewhere', packageId: ADDON },
];
/** The app with a declared group of its own that holds nothing. */
const APP_WITH_GROUP = {
  ...APP,
  navigation: [...NAV, { id: 'service_group', type: 'group', label: 'Service', children: [] }],
};
/** `crm_account` as served: the third package's extension field merged in, as the engine merges it. */
const ACCOUNT_SERVED = {
  name: 'crm_account',
  label: 'Account',
  fields: {
    name: { type: 'text', label: 'Account Name' },
    acme_score: { type: 'number', label: 'Acme score' },
  },
};
const readWith = (read: typeof READ) => {
  if (!srv.contributed) return read;
  // A disabled package's contributions are not listed (the server's fold drops them).
  const served = srv.addonDisabled ? CONTRIBUTIONS.filter((c) => c.packageId !== ADDON) : CONTRIBUTIONS;
  return { ...read, contributions: served, counts: { ...read.counts, contributions: served.length } };
};
/**
 * objectstack#29851 — the base's app as `/meta/app?package=` serves it: the
 * fold has added the add-on's entries to it. `nav_cases` once, under the
 * group it names; `nav_knowledge` twice (two contributions share the id), so
 * no label can be told for it.
 */
const SERVED_APP = {
  name: 'crm_app',
  label: 'CRM',
  navigation: [
    ...NAV,
    { id: 'service_group', type: 'group', label: 'Service', children: [{ id: 'nav_cases', type: 'url', label: 'Cases', url: '/cases' }] },
    { id: 'nav_knowledge', type: 'url', label: 'Knowledge', url: '/kb' },
    { id: 'nav_knowledge', type: 'url', label: 'Knowledge base', url: '/kb2' },
  ],
};
const EMPTY_READ = { packageId: BASE, overrides: [], extensions: [], switchedOff: [], arrangements: [], contributions: [], counts: { overrides: 0, extensions: 0, switchedOff: 0, arrangements: 0, contributions: 0 } };

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
  srv.contributed = false;
  srv.servedFold = false;
  srv.addonContributes = false;
  srv.addonDisabled = false;
  srv.targetApp = 'served';
  srv.ownerReadFails = false;
  srv.declaredApp = 'crm_app';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      if (method === 'GET') srv.reads.push(`${path}${url.search}`);
      if (path === '/api/v1/packages') return json({ success: true, data: packageRows() });
      if (path === `/api/v1/packages/${BASE}/customizations`) {
        if (srv.ownerReadFails) return json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'down' } }, 500);
        return json({ success: true, data: readWith(srv.pairListed ? READ : EMPTY_READ) });
      }
      if (path === `/api/v1/packages/${ADDON}/customizations`) {
        return json({ success: true, data: { ...EMPTY_READ, packageId: ADDON } });
      }
      if (path === '/api/v1/meta/app/crm_app') {
        if (srv.targetApp === 'fails') return json({ success: false, error: { message: 'down' } }, 500);
        if (srv.targetApp === 'missing') return json({}, 404);
        return json({ type: 'app', name: 'crm_app', item: { ...SERVED_APP, _packageId: BASE } });
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
        return json({ drafts: draftRows(url.searchParams.get('package'), url.searchParams.get('type')) });
      }
      if (path === '/api/v1/meta/app') {
        const pkg = url.searchParams.get('package');
        if (pkg === PAIR || (pkg === ADDON && srv.addonContributes)) return json([]);
        return json([srv.servedFold ? SERVED_APP : { name: 'crm_app', label: 'CRM' }]);
      }
      if (path === '/api/v1/meta/app/crm_app/layers') {
        return json({ code: null, overlay: null, overlayScope: null, effective: srv.contributed ? APP_WITH_GROUP : APP });
      }
      if (srv.contributed && path === '/api/v1/meta/object/crm_account/layers') {
        return json({ code: ACCOUNT_SERVED, overlay: null, overlayScope: null, effective: ACCOUNT_SERVED });
      }
      const list = /^\/api\/v1\/meta\/([^/]+)$/.exec(path);
      if (list && method === 'GET') {
        const type = decodeURIComponent(list[1]!);
        const pkg = url.searchParams.get('package');
        if (pkg === PAIR) return json(srv.pairListed ? pairList(type) : []);
        if (pkg === BASE) return json(BASE_LISTS[type] ?? []);
        if (pkg === ADDON && srv.addonContributes) return json([]);
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


// objectstack#36904 — the object designer has no rail: the base's object list
// marks the pair's rows (`ResourceListPage`), and a pair's object opens at the
// pair's own address.
describe('the pair’s URLs (objectstack#28572)', () => {
  // The package switcher's case (the pair has no row, named under its base)
  // left with the switcher, objectstack#36501; the Studio landing's cards
  // fold the pair the same way (`foldCustomizationPairs`).
  // objectstack#36904 — the pair's old object address opens the object's
  // designer on the pair's own address (`dataPillarRedirect`), read at the
  // pair, its owner (objectstack#28584).
  it('the pair’s old object address opens the object at the pair', async () => {
    renderAt(`/studio/${encodeURIComponent(PAIR)}/data?surface=object:hotcrm_custom_survey`);
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toMatch(
        new RegExp(`^/studio/${encodeURIComponent(PAIR)}/metadata/object/hotcrm_custom_survey`),
      ),
    );
    await screen.findByTestId('data-object-header', undefined, { timeout: 8000 });
    const layers = () => srv.reads.filter((r) => r.startsWith('/api/v1/meta/object/hotcrm_custom_survey/layers'));
    await waitFor(() => expect(layers()).not.toEqual([]), { timeout: 8000 });
    for (const read of layers()) expect(new URL(read, 'http://localhost').searchParams.get('package')).toBe(PAIR);
  });

  it('the pair’s "All metadata" URL stays on the pair: it is not sent to the base, so nothing loops', async () => {
    renderAt(`/studio/${encodeURIComponent(PAIR)}/metadata`);
    const area = await screen.findByTestId('metadata-area', undefined, { timeout: 8000 });
    expect(area).toHaveAttribute('data-package', PAIR);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${encodeURIComponent(PAIR)}/metadata`);
  });
});

/**
 * objectstack#29786 — what a third package contributes to the base, drawn on
 * each pillar from the base's one customization read: greyed, named by the
 * contributing package ("from Acme add-on"), and opening that package.
 */
describe('items another package contributes are drawn greyed, with the package (objectstack#29786)', () => {
  const FROM_ACME = tFormat('engine.studio.contributed.from', 'en', { package: 'Acme add-on' });
  const contributed = (root: HTMLElement, kind: string, name: string) =>
    root.querySelector<HTMLElement>(`[data-contributed="${kind}"][data-testid="contributed-${kind}-${name}"]`);

  it('Data: the contributed field is marked in the Form layout, once, and its properties are read-only while the base’s are not', async () => {
    srv.contributed = true;
    renderAt(`/studio/${BASE}/metadata/object/crm_account`);
    fireEvent.click(await screen.findByText(t('engine.studio.data.tab.form', 'en'), undefined, { timeout: 8000 }));

    const card = await waitFor(
      () => {
        const el = document.querySelector<HTMLElement>('[data-contributed="field"]');
        expect(el).not.toBeNull();
        return el!;
      },
      { timeout: 8000 },
    );
    expect(card).toHaveTextContent('Acme score');
    // objectstack#36505: arranged in the pair's layout like any field, and a
    // card a click selects: not announced as disabled.
    expect(card).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(card).getByTestId('contribution-mark')).toHaveTextContent(FROM_ACME);
    expect(card.getAttribute('title')).toBe(
      tFormat('engine.studio.contributed.fieldTitle', 'en', { name: 'acme_score', package: 'Acme add-on' }),
    );
    // Marked where it is drawn: no second copy of it.
    expect(screen.getAllByText('Acme score')).toHaveLength(1);
    expect(document.querySelectorAll('[data-contributed="field"]')).toHaveLength(1);

    fireEvent.click(card);
    const rail = await screen.findByTestId('data-field-inspector', undefined, { timeout: 8000 });
    await waitFor(() => expect(rail.querySelector('[data-disabled-reason]')).not.toBeNull());
    expect(rail).toHaveTextContent(
      tFormat('engine.studio.contributed.fieldTitle', 'en', { name: 'acme_score', package: 'Acme add-on' }),
    );

    // CONTROL: the base's own field opens in the pair's display-property mode, not read-only.
    // objectstack#36505: its card is arranged in the pair, so it reads as draggable.
    fireEvent.click(screen.getByLabelText(tFormat('engine.studio.designer.fieldAria', 'en', { label: 'Account Name' })));
    await waitFor(() => expect(screen.getByTestId('data-field-inspector').querySelector('[data-disabled-reason]')).toBeNull());
  });

  it('Automations: a contributed flow draws in its object’s group, an object with no flow of the base’s gets one, and a row opens the contributor', async () => {
    srv.contributed = true;
    renderAt(`/studio/${BASE}/automations`);
    const autoRail = await screen.findByTestId('studio-rail-automations', undefined, { timeout: 8000 });
    await waitFor(() => expect(contributed(autoRail, 'flow', 'acme_sync')).not.toBeNull(), { timeout: 8000 });

    const accountGroup = within(autoRail).getByTestId('auto-rail-group-crm_account');
    const sync = contributed(autoRail, 'flow', 'acme_sync')!;
    expect(accountGroup).toContainElement(sync);
    expect(within(sync).getByTestId('contribution-mark')).toHaveTextContent(FROM_ACME);
    expect(within(autoRail).getByTestId('auto-rail-group-crm_deal')).toContainElement(
      contributed(autoRail, 'flow', 'acme_deal_watch'),
    );
    // The base ships no flow: the rail does not say "no flows".
    expect(within(autoRail).queryByText(t('engine.studio.auto.none', 'en'))).toBeNull();

    fireEvent.click(sync);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${encodeURIComponent(ADDON)}/automations?surface=`),
    );
    expect(screen.getByTestId('location').textContent).toContain('acme_sync');
  });

  it('one reader: no request beyond the base’s customization read names the contributing package', async () => {
    srv.contributed = true;
    renderAt(`/studio/${BASE}/automations`);
    const autoRail = await screen.findByTestId('studio-rail-automations', undefined, { timeout: 8000 });
    await waitFor(() => expect(contributed(autoRail, 'flow', 'acme_sync')).not.toBeNull(), { timeout: 8000 });
    expect(srv.reads.filter((r) => r.includes(encodeURIComponent(ADDON)) || r.includes(`package=${ADDON}`))).toEqual([]);
    expect(srv.reads.filter((r) => r.startsWith(`/api/v1/packages/${BASE}/customizations`)).length).toBeGreaterThan(0);
  });
});

/**
 * objectstack#29851 — a contributed nav row reads the label the live app
 * shows, looked up by `(app, id)` in the served app row the pillar already
 * reads; a package that only contributes says what it adds, as the owner's
 * served read lists it.
 */
