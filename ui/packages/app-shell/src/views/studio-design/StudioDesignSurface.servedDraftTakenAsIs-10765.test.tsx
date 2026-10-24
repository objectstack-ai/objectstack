// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10765 — the Studio design surface takes a served draft AS-IS at
 * every one of its load sites. It never rebuilds a draft as the served draft
 * spread over `layered.effective`.
 *
 * `effective` is the PUBLISHED layer and a spread cannot express deletion: a
 * key the author deleted in the draft came back into the design surface from
 * the published layer on every open, invisibly, and the next draft save sent
 * it again. The metadata-admin editor's three sites are pinned in
 * `ResourceEditPage.servedDraftTakenAsIs-10765.test.tsx`; this file pins the
 * design surface's FOUR — the app the Interfaces pillar opens, the surface
 * leaf it opens under that app, the object the Data pillar opens, and the flow
 * the Automations pillar opens. One red-on-base assertion per site, each on a
 * key the served draft lacks and the published row carries. ⛔ No per-type
 * exception (triage `5853761414`).
 *
 * The client is a server double: `effective` is the active row, `getDraft`
 * serves the stored draft row raw, `save` records the wire body. The canvas
 * for `page` and `flow` is a stub that prints the draft it received — the
 * value under test — so nothing in the pillars themselves is stubbed.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { t } from '../metadata-admin/i18n';

const PKG = 'com.acme.app';

const NAV = [{ id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' }];

/** The published app carries a `label`; its pending draft deleted it. */
const PUBLISHED_APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const DRAFT_APP_WITHOUT_LABEL = { name: 'acme_app', navigation: NAV };

/** The published page carries a `description`; its pending draft deleted it. */
const PUBLISHED_PAGE = { name: 'home', label: 'Home', kind: 'blocks', blocks: [], description: 'published description' };
const DRAFT_PAGE_WITHOUT_DESCRIPTION = { name: 'home', label: 'Home (draft)', kind: 'blocks', blocks: [] };

/** The published object has an OWD model set; its pending draft set it back to unset (the key is gone). */
const FIELDS = [{ name: 'title', label: 'Title', type: 'text' }];
const PUBLISHED_OBJECT = { name: 'crm_contact', label: 'Contact', sharingModel: 'private', fields: FIELDS };
const DRAFT_OBJECT_WITHOUT_OWD = { name: 'crm_contact', label: 'Contact', fields: FIELDS };

/** The published flow carries a `description`; its pending draft deleted it. */
const PUBLISHED_FLOW = { name: 'notify_owner', label: 'Notify owner', status: 'active', description: 'published description', nodes: [] };
const DRAFT_FLOW_WITHOUT_DESCRIPTION = { name: 'notify_owner', label: 'Notify owner', status: 'active', nodes: [] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> | undefined }>,
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  const toWire = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  return {
    /** The published items of a type — what the rails list. */
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    /** `GET …/layers`: `effective` is the ACTIVE row only — a draft never feeds it. */
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    /** `GET …?state=draft`: the stored draft row raw (decorated like the real read), else `NO_DRAFT`. */
    getDraft: vi.fn(async (type: string, name: string) => {
      const row = server.drafts.get(k(type, name));
      if (!row) throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
      return { type, name, item: { ...row, _diagnostics: { valid: true, errors: [] } } };
    }),
    /** `PUT …?mode=draft`: the body lands raw in the draft slot. */
    save: vi.fn(async (type: string, name: string, item: unknown, opts?: Record<string, unknown>) => {
      const body = toWire(item);
      server.saves.push({ type, name, body, opts });
      if (opts?.mode === 'draft') server.drafts.set(k(type, name), body);
      else server.active.set(k(type, name), body);
      return { type, name, item: body };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InterfacesPillar, DataPillar, AutomationsPillar } from './StudioDesignSurface';
import { SurfaceDeepLinkProvider } from './surfaceDeepLinkChannel';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview, getMetadataPreview } from '../metadata-admin/preview-registry';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// The Automations pillar probes `GET /api/v1/automation/_status` through the
// global `fetch` (no client seam). One double at MODULE scope, never torn down
// — the shape `vitest.setup.network-escape-guard.ts` prescribes, because the
// probe is fire-and-forget and can land after a test body returns.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

/** Canvas stand-in: prints the draft the pillar handed it — the value under test. */
function StubCanvas({ draft }: { draft: Record<string, unknown> }) {
  return <pre data-testid="surface-draft">{JSON.stringify(draft)}</pre>;
}

const realPreviews = { page: getMetadataPreview('page'), flow: getMetadataPreview('flow') };

const key = (type: string, name: string) => `${type}/${name}`;
const wire = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
const surfaceDraft = () => JSON.parse(screen.getByTestId('surface-draft').textContent ?? '{}') as Record<string, unknown>;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('page', StubCanvas as never);
  registerMetadataPreview('flow', StubCanvas as never);
});

afterEach(() => {
  cleanup();
  if (realPreviews.page) registerMetadataPreview('page', realPreviews.page);
  if (realPreviews.flow) registerMetadataPreview('flow', realPreviews.flow);
});

describe('StudioDesignSurface — every load site takes the served draft as-is, never spread over `effective` (objectui#10765)', () => {
  it('Interfaces pillar: the APP draft and the SURFACE draft it opens are the served drafts, not the published rows underneath them', async () => {
    server.active.set(key('app', 'acme_app'), wire(PUBLISHED_APP));
    server.drafts.set(key('app', 'acme_app'), wire(DRAFT_APP_WITHOUT_LABEL));
    server.active.set(key('page', 'home'), wire(PUBLISHED_PAGE));
    server.drafts.set(key('page', 'home'), wire(DRAFT_PAGE_WITHOUT_DESCRIPTION));

    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>,
    );

    // APP SITE — red on base: the spread kept the published `label`, so the
    // heading read "Acme · Navigation". The draft deleted `label`, and the
    // pillar falls back to the app's `name`.
    await screen.findByText('acme_app · Navigation', undefined, { timeout: 8000 });
    expect(screen.queryByText('Acme · Navigation')).toBeNull();

    // SURFACE SITE — red on base: the spread put the published `description`
    // back under the draft's own `label`.
    await waitFor(() => expect(surfaceDraft().label).toBe('Home (draft)'), { timeout: 8000 });
    expect(surfaceDraft()).not.toHaveProperty('description');
    expect(surfaceDraft()).toStrictEqual(wire(DRAFT_PAGE_WITHOUT_DESCRIPTION));
  });

  it('Interfaces pillar, CONTROL: with no pending draft the surface shows the published baseline unchanged', async () => {
    server.active.set(key('app', 'acme_app'), wire(PUBLISHED_APP));
    server.active.set(key('page', 'home'), wire(PUBLISHED_PAGE));

    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>,
    );

    await screen.findByText('Acme · Navigation', undefined, { timeout: 8000 });
    await waitFor(() => expect(surfaceDraft().label).toBe('Home'), { timeout: 8000 });
    expect(surfaceDraft()).toStrictEqual(wire(PUBLISHED_PAGE));
  });

  it('Data pillar: an OWD model the object draft set back to unset reads as unset, not as the published value', async () => {
    server.active.set(key('object', 'crm_contact'), wire(PUBLISHED_OBJECT));
    server.drafts.set(key('object', 'crm_contact'), wire(DRAFT_OBJECT_WITHOUT_OWD));

    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
        <SurfaceDeepLinkProvider>
          <DataPillar packageId={PKG} />
        </SurfaceDeepLinkProvider>
      </MemoryRouter>,
    );

    // The first object auto-opens; the Settings panel lives under "Advanced".
    const advanced = await screen.findByTestId('data-tabs-advanced', undefined, { timeout: 8000 });
    await userEvent.click(advanced);
    // A radio item since objectui#11794: the menu checks the open panel.
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Settings' }));

    // The dial is the shared Select's trigger (objectui#11865), so what it shows
    // is its text: a button's `value` is '' whatever the dial holds.
    const internal = await screen.findByTestId('owd-internal-select', undefined, { timeout: 8000 });
    // Red on base: the spread over `effective` showed `private` from the published row.
    expect(internal).toHaveTextContent(t('engine.studio.settings.sharingUnset', 'en-US'));
    expect(internal).not.toHaveTextContent(t('engine.studio.settings.sharingPrivate', 'en-US'));
  });

  it('Automations pillar: the flow draft is the served draft, and the enable switch saves exactly that draft — no published key comes back', async () => {
    server.active.set(key('flow', 'notify_owner'), wire(PUBLISHED_FLOW));
    server.drafts.set(key('flow', 'notify_owner'), wire(DRAFT_FLOW_WITHOUT_DESCRIPTION));

    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );

    // LOAD SITE — red on base: the spread put the published `description` back.
    await waitFor(() => expect(surfaceDraft().name).toBe('notify_owner'), { timeout: 8000 });
    expect(surfaceDraft()).not.toHaveProperty('description');
    expect(surfaceDraft()).toStrictEqual(wire(DRAFT_FLOW_WITHOUT_DESCRIPTION));

    // The next save is what the defect made carry the key: flip the switch,
    // which saves `{ ...draft, status }` at once.
    const toggle = await screen.findByRole('switch', undefined, { timeout: 8000 });
    await waitFor(() => expect(toggle).toBeEnabled(), { timeout: 8000 });
    fireEvent.click(toggle);
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    const { type, name, body, opts } = server.saves[0]!;
    expect([type, name]).toEqual(['flow', 'notify_owner']);
    expect(opts).toMatchObject({ mode: 'draft', packageId: PKG });
    expect(body.status).toBe('obsolete');
    expect(body).not.toHaveProperty('description');
  });
});
