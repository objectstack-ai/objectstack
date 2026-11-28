// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29674 (ADR-0146 D3, D4) — a "New similar" copy of a read-only
 * base's permission set lands in the base's pair `<base>.custom`, holding the
 * base set's grants on the BASE's objects. Opened in Studio Access, the copy's
 * matrix was scoped to the pair's own objects, which the pair never declares:
 * it read "0 objects granted · 0 field overrides" and listed nothing, though
 * the server holds 8 objects and 3 field overrides.
 *
 * objectstack#36905 — each set opens at its own metadata address, the copy at
 * its pair's (`/studio/<pair>/metadata/permission/<copy>`, as the base's list
 * links it), in the full-screen page (`StudioPermissionSetPage`). The retired
 * pillar opened the copy on the BASE's address,
 * `/studio/<base>/access?surface=permission:<copy>`: that old bookmark
 * redirects to the pair's address, where the copy opens writable, and the
 * base's own set's old address stays on the base (CONTROL). The address's
 * other parameters ride along through the real surface.
 *
 * The REAL `StudioDesignSurface` (its area), `StudioPermissionSetPage` and
 * `PermissionMatrixEditPage` over the REAL metadata client and a fetch stub serving the package list (the
 * base read-only, its pair writable), the base's customization read, the
 * base's objects and sets, and the copy, published in the pair.
 *
 * Pinned:
 *  - the copy lists the base's objects with their grants and counts what the
 *    server holds (8 objects, 3 field overrides), and its note names the base
 *    instead of claiming "this package's objects" only;
 *  - an edit to a base object's grant saves the copy's draft at the pair,
 *    keeping every grant it holds; no write names the base;
 *  - CONTROL: the base's own (read-only) set lists the base's objects and
 *    reads no pair list for them;
 *  - objectstack#29809: the header's provenance chip reads Custom for a set
 *    the pair holds (copied or created there), Package for the base's own
 *    set. Only the header's half is pinned here: the rail that drew the
 *    matching mark beside it went with the Access pillar (objectstack#36905).
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches these through dynamic imports: their first load is paid at collection.
import '@objectstack/lint';
// objectstack#36900 — the surface mounts the command palette, which reaches the
// record preview's `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const COPY = 'my_contributor';

/** The base's eight objects. The pair declares none of them. */
const BASE_OBJECTS = [
  'sc_account',
  'sc_contact',
  'sc_deal',
  'sc_invoice',
  'sc_note',
  'sc_project',
  'sc_task',
  'sc_ticket',
].map((name) => ({ name, label: name.replace('sc_', 'Showcase '), _packageId: BASE }));

const GRANTS = Object.fromEntries(BASE_OBJECTS.map((o) => [o.name, { allowRead: true, allowCreate: true }]));
const FIELDS = {
  'sc_account.name': { readable: true, editable: true },
  'sc_deal.amount': { readable: true, editable: false },
  'sc_ticket.subject': { readable: true, editable: true },
};

/** The base set the copy was made from, and the copy the clone door saved in the pair. */
const BASE_SET = { name: 'showcase_contributor', label: 'Contributor', objects: GRANTS, fields: FIELDS };
const COPY_SET = { name: COPY, label: 'My contributor', objects: GRANTS, fields: FIELDS };

const srv = vi.hoisted(() => ({
  reads: [] as string[],
  saves: [] as Array<{ path: string; search: string; body: Record<string, unknown> }>,
  pairDrafts: new Map<string, Record<string, unknown>>(),
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
vi.mock('../metadata-admin/AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { pressStudioSave } from './__tests__/studioSaveHarness';
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PACKAGES = [
  { manifest: { id: BASE, name: 'Showcase', namespace: 'showcase', version: '1.0.0' }, writable: false },
  { manifest: { id: PAIR, name: 'Showcase customizations', namespace: 'showcase_custom', version: '0.1.0' }, writable: true },
];
const READ = {
  packageId: BASE,
  overrides: [],
  extensions: [],
  switchedOff: [],
  arrangements: [],
  contributions: [],
  counts: { overrides: 0, extensions: 0, switchedOff: 0, arrangements: 0, contributions: 0 },
};

/** Each package's list, by type: the base ships its objects and its set; the pair holds only the copy. */
const LISTS: Record<string, Record<string, Array<Record<string, unknown>>>> = {
  [BASE]: { object: BASE_OBJECTS, permission: [{ ...BASE_SET, _packageId: BASE }] },
  [PAIR]: { permission: [{ ...COPY_SET, _packageId: PAIR }] },
};

/** The published body at `pkg`, by type and name. */
function held(pkg: string | null, type: string, name: string): Record<string, unknown> | undefined {
  if (type === 'object') return BASE_OBJECTS.find((o) => o.name === name);
  if (type !== 'permission') return undefined;
  if (pkg === PAIR && name === COPY) return COPY_SET;
  if (pkg !== PAIR && name === BASE_SET.name) return BASE_SET;
  return undefined;
}

beforeEach(() => {
  srv.reads.length = 0;
  srv.saves.length = 0;
  srv.pairDrafts.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      const pkg = url.searchParams.get('package') ?? url.searchParams.get('packageId');
      if (method === 'GET') srv.reads.push(`${path}${url.search}`);
      if (path === '/api/v1/packages') return json({ success: true, data: PACKAGES });
      if (path === `/api/v1/packages/${BASE}/customizations`) return json({ success: true, data: READ });
      // The type registry: a permission set is written at runtime (the matrix's type gate).
      if (path === '/api/v1/meta') return json([{ type: 'permission', allowRuntimeCreate: true }, { type: 'object' }]);
      if (path === '/api/v1/meta/_drafts') {
        const drafts =
          pkg === PAIR
            ? [...srv.pairDrafts.keys()].map((key) => {
                const [type, name] = key.split('/') as [string, string];
                return { type, name, packageId: PAIR };
              })
            : [];
        return json({ drafts });
      }
      const list = /^\/api\/v1\/meta\/([^/]+)$/.exec(path);
      if (list && method === 'GET') {
        const type = decodeURIComponent(list[1]!);
        return json(pkg ? (LISTS[pkg]?.[type] ?? []) : [...(LISTS[BASE]![type] ?? []), ...(LISTS[PAIR]![type] ?? [])]);
      }
      const layers = /^\/api\/v1\/meta\/([^/]+)\/([^/]+)\/layers$/.exec(path);
      if (layers) {
        const doc = held(pkg, decodeURIComponent(layers[1]!), decodeURIComponent(layers[2]!)) ?? null;
        return json({ code: doc, overlay: null, overlayScope: null, effective: doc });
      }
      const one = /^\/api\/v1\/meta\/([^/]+)\/([^/]+)$/.exec(path);
      if (one) {
        const [type, name] = [decodeURIComponent(one[1]!), decodeURIComponent(one[2]!)];
        if (method === 'PUT') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          srv.saves.push({ path, search: url.search, body });
          if (pkg !== PAIR) return json({ success: false, error: { message: 'read-only' } }, 403);
          srv.pairDrafts.set(`${type}/${name}`, body);
          return json({ success: true, version: `v${srv.saves.length}`, state: 'draft' });
        }
        const draft = pkg === PAIR ? srv.pairDrafts.get(`${type}/${name}`) : undefined;
        if (draft) return json({ type, name, item: draft, version: 'v1' });
        if (type === 'object') {
          const obj = held(pkg, type, name);
          return obj ? json({ type, name, item: obj }) : json({}, 404);
        }
        return json({}, 404);
      }
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A set at its metadata address: the copy and a set created there at the pair's, the base's own at the base's. */
function renderAccess(set: string) {
  const pkg = set === BASE_SET.name ? BASE : PAIR;
  return render(
    <MemoryRouter initialEntries={[`/studio/${pkg}/metadata/permission/${set}?package=${pkg}`]}>
      <Routes>
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Where the router stands. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

/** The retired pillar's address of `set`, on the base, with `extra` beside its `?surface=`. */
function renderPillarAddress(set: string, extra = '') {
  return render(
    <MemoryRouter initialEntries={[`/studio/${BASE}/access?surface=${encodeURIComponent(`permission:${set}`)}${extra}`]}>
      <Routes>
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface /></StudioPillarRedirect>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const header = () => screen.getByTestId('permission-detail-header');
const matrix = () => screen.getByTestId('perm-studio-matrix');
const countsText = (objects: number, fields: number) =>
  `${tFormat('engine.studio.access.grantedOther', 'en', { count: objects })} · ${tFormat(
    'engine.studio.access.overridesOther',
    'en',
    { count: fields },
  )}`;
/** The object list reads, by the package each names. */
const objectListReads = () =>
  srv.reads
    .filter((r) => r.startsWith('/api/v1/meta/object?'))
    .map((r) => new URL(r, 'http://localhost').searchParams.get('package'));

async function copyOpen(): Promise<void> {
  await waitFor(() => expect(within(header()).getByText(/(^|· )My contributor$/)).toBeInTheDocument(), { timeout: 8000 });
  await waitFor(() => expect(within(matrix()).getByText('Showcase account')).toBeInTheDocument(), { timeout: 8000 });
}

describe('a "New similar" copy in the pair shows the grants it holds on the base’s objects (objectstack#29674)', () => {
  it('lists the base’s objects and counts what the server holds: 8 objects, 3 field overrides', async () => {
    renderAccess(COPY);
    await copyOpen();
    for (const o of BASE_OBJECTS) {
      expect(within(matrix()).getByText(o.label)).toBeInTheDocument();
      expect(within(matrix()).getByLabelText(`${o.name} ${t('perm.action.read', 'en')}`)).toBeChecked();
    }
    expect(within(matrix()).queryByText(t('perm.filter.empty', 'en'))).toBeNull();
    await waitFor(() => expect(header()).toHaveTextContent(countsText(8, 3)));
    // The objects were listed at the pair and at its base, nowhere else.
    expect(new Set(objectListReads())).toEqual(new Set([PAIR, BASE]));
  });

  it('names the base in the note, instead of claiming this package’s objects only', async () => {
    renderAccess(COPY);
    await copyOpen();
    expect(header()).toHaveTextContent(tFormat('engine.studio.access.bannerPair', 'en', { package: 'Showcase' }));
    expect(header()).not.toHaveTextContent(t('engine.studio.access.banner', 'en'));
  });

  it('an edit to a base object’s grant saves the copy’s draft at the pair, keeping every grant; nothing is written to the base', async () => {
    renderAccess(COPY);
    await copyOpen();
    fireEvent.click(within(matrix()).getByLabelText(`sc_note ${t('perm.action.edit', 'en')}`));
    // objectstack#36511 — sent by the top bar's Save.
    await pressStudioSave();

    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    const [saved] = srv.saves;
    expect(saved!.path).toBe(`/api/v1/meta/permission/${COPY}`);
    expect(new URLSearchParams(saved!.search).get('package')).toBe(PAIR);
    expect(saved!.body.objects).toStrictEqual({ ...GRANTS, sc_note: { allowRead: true, allowCreate: true, allowEdit: true } });
    expect(saved!.body.fields).toStrictEqual(FIELDS);
    expect(srv.saves.filter((s) => new URLSearchParams(s.search).get('package') !== PAIR)).toEqual([]);
    // Saved, the copy still counts everything it holds.
    await waitFor(() => expect(header()).toHaveTextContent(countsText(8, 3)));
  });
});

describe('CONTROL: the base’s own set (objectstack#29674)', () => {
  it('lists the base’s objects, reads no pair object list, and keeps the base’s note', async () => {
    renderAccess(BASE_SET.name);
    await waitFor(() => expect(within(header()).getByText(/(^|· )Contributor$/)).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(within(matrix()).getByText('Showcase account')).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(header()).toHaveTextContent(countsText(8, 3)));
    expect(objectListReads().filter((p) => p === PAIR)).toEqual([]);
    expect(header()).not.toHaveTextContent(tFormat('engine.studio.access.bannerPair', 'en', { package: 'Showcase' }));
  });
});

/**
 * objectstack#29809 (ADR-0146 D3) — the header's provenance chip: a set the
 * pair holds reads Custom, and the base's own set still reads Package. Same
 * harness: the real surface, area and page. The header alone is read here;
 * no list is drawn beside the page.
 */
describe('the header’s provenance chip: Custom in the pair, Package on the base (objectstack#29809)', () => {
  /** A set created in the pair: its draft, never published. */
  const CREATED = 'pair_auditor';
  const chip = () => within(header()).getByTestId('perm-provenance-badge');

  it('a New similar copy in the pair: Custom in the header', async () => {
    renderAccess(COPY);
    await copyOpen();
    expect(chip()).toHaveTextContent(t('perm.badge.custom', 'en'));
    expect(chip()).not.toHaveTextContent(t('engine.studio.access.origin.app', 'en'));
  });

  it('a set created in the pair: Custom in the header', async () => {
    srv.pairDrafts.set(`permission/${CREATED}`, { name: CREATED, label: 'Pair auditor', objects: {}, fields: {} });
    renderAccess(CREATED);
    await waitFor(() => expect(within(header()).getAllByTitle(CREATED).length).toBeGreaterThan(0), { timeout: 8000 });
    await waitFor(() => expect(chip()).toHaveTextContent(t('perm.badge.custom', 'en')), { timeout: 8000 });
  });

  it('CONTROL: the base’s own set reads Package', async () => {
    renderAccess(BASE_SET.name);
    await waitFor(() => expect(within(header()).getByText(/(^|· )Contributor$/)).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(chip()).toHaveTextContent(t('engine.studio.access.origin.app', 'en')), { timeout: 8000 });
  });
});

/**
 * objectstack#36905 — the retired pillar's address of a set. On a read-only
 * base it listed the sets the pair adds and opened them at the pair, writable,
 * while the address named the base; the redirect sends such a set to the
 * pair's address, not to the base's stack, which does not hold it.
 */
describe('the retired pillar’s address of a set the pair adds opens it at the pair (objectstack#36905)', () => {
  const location = () => screen.getByTestId('location').textContent;

  it('`/studio/<base>/access?surface=permission:<copy>` lands on the pair’s address, and the copy opens writable there', async () => {
    renderPillarAddress(COPY);
    await waitFor(() => expect(location()).toBe(`/studio/${PAIR}/metadata/permission/${COPY}?package=${PAIR}`), {
      timeout: 8000,
    });
    await copyOpen();
    await waitFor(() => expect(header()).toHaveTextContent(countsText(8, 3)));
    expect(within(header()).getByTestId('perm-provenance-badge')).toHaveTextContent(t('perm.badge.custom', 'en'));
    // Writable: an edit saves the copy's draft at the pair.
    fireEvent.click(within(matrix()).getByLabelText(`sc_note ${t('perm.action.edit', 'en')}`));
    await pressStudioSave();
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(new URLSearchParams(srv.saves[0]!.search).get('package')).toBe(PAIR);
  });

  it('a set created in the pair, still a draft, lands on the pair’s address too', async () => {
    const CREATED = 'pair_auditor';
    srv.pairDrafts.set(`permission/${CREATED}`, { name: CREATED, label: 'Pair auditor', objects: {}, fields: {} });
    renderPillarAddress(CREATED);
    await waitFor(() => expect(location()).toBe(`/studio/${PAIR}/metadata/permission/${CREATED}?package=${PAIR}`), {
      timeout: 8000,
    });
  });

  it('the address’s other parameters ride along through the surface', async () => {
    // A parameter no Studio page consumes (`?changes=review` is, by the surface: it opens the drawer).
    renderPillarAddress(COPY, '&ref=bookmark');
    await waitFor(
      () => expect(location()).toBe(`/studio/${PAIR}/metadata/permission/${COPY}?ref=bookmark&package=${PAIR}`),
      { timeout: 8000 },
    );
    await copyOpen();
  });

  it('CONTROL: the base’s own set’s old address stays on the base', async () => {
    renderPillarAddress(BASE_SET.name);
    await waitFor(
      () => expect(location()).toBe(`/studio/${BASE}/metadata/permission/${BASE_SET.name}?package=${BASE}`),
      { timeout: 8000 },
    );
    await waitFor(() => expect(within(header()).getByText(/(^|· )Contributor$/)).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(within(header()).getByTestId('perm-provenance-badge')).toHaveTextContent(
      t('engine.studio.access.origin.app', 'en'),
    ), { timeout: 8000 });
  });
});
