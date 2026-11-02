// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29148 — the Studio design surface takes a pending draft the
 * server refuses to read (`403 PERMISSION_DENIED`: its audience gate,
 * `requiredPermissions`, names a capability the author does not hold) for
 * what it is, never for "no draft", at the three loads #29015 left: the APP
 * the Interfaces pillar opens (its navigation), the OBJECT the Data pillar
 * opens, and the FLOW the Automations pillar opens. (The surface leaf under
 * the app is #29015's, pinned in `StudioDesignSurface.draftUnreadable-29015`;
 * the object's extension at a base's pair is pinned in
 * `DataPillar.draftUnreadable-29148`.)
 *
 * At each, no buffer is installed over the refused draft: the published body
 * is not shown to edit, the strip says why with the server's sentence behind
 * Details, and no save is sent, so the draft keeps its keys and its gate.
 *
 * The client is a server double: `layered` serves the published row,
 * `getDraft` serves the stored draft row raw, resolves `null` for none (the
 * client's reading of a 404), or refuses it as the read gate does (an `Error`
 * carrying `status` and `code`, the shape the metadata client throws). The
 * canvas for `page` and `flow` is a stub that prints the draft it received, so
 * nothing in the pillars themselves is stubbed.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { t } from '../metadata-admin/i18n';

const PKG = 'com.acme.app';

const NAV = [{ id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' }];
const PUBLISHED_APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const PUBLISHED_PAGE = { name: 'home', label: 'Home', kind: 'blocks', blocks: [] };
const FIELDS = [{ name: 'title', label: 'Title', type: 'text' }];
const PUBLISHED_OBJECT = { name: 'crm_contact', label: 'Contact', sharingModel: 'private', fields: FIELDS };
const PUBLISHED_FLOW = { name: 'notify_owner', label: 'Notify owner', status: 'active', nodes: [] };

/** A pending draft: the published body plus an audience gate the author does not hold. */
const gated = (row: Record<string, unknown>) => ({ ...row, requiredPermissions: ['acme.export_data'] });
const GATE_REFUSAL = 'You do not have permission to read this pending draft.';

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Draft rows whose read is refused as the audience gate refuses it. */
  gated: new Set<string>(),
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> | undefined }>,
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  const toWire = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      if (server.gated.has(k(type, name))) {
        throw Object.assign(new Error(GATE_REFUSAL), {
          status: 403,
          code: 'PERMISSION_DENIED',
          body: { success: false, error: { code: 'PERMISSION_DENIED', message: GATE_REFUSAL } },
        });
      }
      const row = server.drafts.get(k(type, name));
      return row ? { type, name, version: 'v1', item: { ...row } } : null;
    }),
    save: vi.fn(async (type: string, name: string, item: unknown, opts?: Record<string, unknown>) => {
      const body = toWire(item);
      server.saves.push({ type, name, body, opts });
      if (opts?.mode === 'draft') server.drafts.set(k(type, name), body);
      else server.active.set(k(type, name), body);
      return { success: true, version: 'v2', state: 'draft' };
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
// (`vitest.setup.network-escape-guard.ts`): the probe is fire-and-forget.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

/** Canvas stand-in: prints the draft the pillar handed it. */
function StubCanvas({ draft }: { draft: Record<string, unknown> }) {
  return <pre data-testid="surface-draft">{JSON.stringify(draft)}</pre>;
}

const realPreviews = { page: getMetadataPreview('page'), flow: getMetadataPreview('flow') };
const key = (type: string, name: string) => `${type}/${name}`;
const wire = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;

/** Longer than the autosave's debounce, so a save that was going to leave has left. */
async function pastTheAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });
}

/** Red on base at each site: the refusal was read as "no draft", so no strip. */
async function expectRefusalStrip() {
  const message = await screen.findByText(t('engine.studio.refusal.draftUnreadable', 'en-US'), undefined, { timeout: 8000 });
  expect(message).toHaveAttribute('data-testid', 'studio-refusal-message');
  // The server's own sentence stays reachable, behind Details.
  expect(screen.getByTestId('studio-refusal-detail')).toHaveTextContent(GATE_REFUSAL);
}

/** Seeds a refused draft over a published row and returns its stored body. */
function seedRefused(type: string, name: string, published: Record<string, unknown>) {
  server.active.set(key(type, name), wire(published));
  server.drafts.set(key(type, name), wire(gated(published)));
  server.gated.add(key(type, name));
  return wire(gated(published));
}

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.gated.clear();
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

function renderInterfaces() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

function renderData() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <SurfaceDeepLinkProvider>
        <DataPillar packageId={PKG} />
      </SurfaceDeepLinkProvider>
    </MemoryRouter>,
  );
}

/** The Data pillar's Settings panel lives under "Advanced". */
async function openSettings() {
  await userEvent.click(await screen.findByTestId('data-tabs-advanced', undefined, { timeout: 8000 }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Settings' }));
}

function renderAutomations() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

describe('StudioDesignSurface — a draft the server refuses to read is not "no draft" (objectstack#29148)', () => {
  it('Interfaces pillar, APP: no nav buffer over the refused app draft; the strip says why, the nav is not offered to edit, and no save is sent', async () => {
    const stored = seedRefused('app', 'acme_app', PUBLISHED_APP);
    server.active.set(key('page', 'home'), wire(PUBLISHED_PAGE));
    renderInterfaces();

    await waitFor(() => expect(mockClient.getDraft).toHaveBeenCalledWith('app', 'acme_app', { packageId: PKG }), {
      timeout: 8000,
    });
    await expectRefusalStrip();
    // The published navigation is not installed: no leaf opens under it, and
    // no Edit offers it.
    expect(screen.queryByTestId('surface-draft')).toBeNull();
    expect(screen.queryByTitle(t('engine.studio.if.editNavTitle', 'en-US'))).toBeNull();

    await pastTheAutosave();
    expect(server.saves).toEqual([]);
    expect(server.drafts.get(key('app', 'acme_app'))).toStrictEqual(stored);
  });

  it('Interfaces pillar, APP, CONTROL: with no pending app draft the published nav opens its leaf, and Edit offers it', async () => {
    server.active.set(key('app', 'acme_app'), wire(PUBLISHED_APP));
    server.active.set(key('page', 'home'), wire(PUBLISHED_PAGE));
    renderInterfaces();

    await screen.findByTestId('surface-draft', undefined, { timeout: 8000 });
    expect(await screen.findByTitle(t('engine.studio.if.editNavTitle', 'en-US'))).toBeInTheDocument();
    expect(screen.queryByText(t('engine.studio.refusal.draftUnreadable', 'en-US'))).toBeNull();
  });

  it('Data pillar, OBJECT: no buffer over the refused object draft; the strip says why, and no save is sent', async () => {
    const stored = seedRefused('object', 'crm_contact', PUBLISHED_OBJECT);
    renderData();

    await waitFor(
      () => expect(mockClient.getDraft).toHaveBeenCalledWith('object', 'crm_contact', { packageId: PKG }),
      { timeout: 8000 },
    );
    await expectRefusalStrip();
    // The published object is not opened to edit: its Settings panel draws no
    // dial (the published `private` model is not offered to change).
    await openSettings();
    expect(screen.queryByTestId('owd-internal-select')).toBeNull();

    await pastTheAutosave();
    expect(server.saves).toEqual([]);
    expect(server.drafts.get(key('object', 'crm_contact'))).toStrictEqual(stored);
  });

  it('Data pillar, OBJECT, CONTROL: with no pending draft the published object opens', async () => {
    server.active.set(key('object', 'crm_contact'), wire(PUBLISHED_OBJECT));
    renderData();

    await openSettings();
    expect(await screen.findByTestId('owd-internal-select', undefined, { timeout: 8000 })).toHaveTextContent(
      t('engine.studio.settings.sharingPrivate', 'en-US'),
    );
    expect(screen.queryByText(t('engine.studio.refusal.draftUnreadable', 'en-US'))).toBeNull();
  });

  it('Automations pillar, FLOW: no buffer over the refused flow draft; the strip says why, nothing is offered to edit, and no save is sent', async () => {
    const stored = seedRefused('flow', 'notify_owner', PUBLISHED_FLOW);
    renderAutomations();

    await waitFor(
      () => expect(mockClient.getDraft).toHaveBeenCalledWith('flow', 'notify_owner', { packageId: PKG }),
      { timeout: 8000 },
    );
    await expectRefusalStrip();
    expect(screen.queryByTestId('surface-draft')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();

    await pastTheAutosave();
    expect(server.saves).toEqual([]);
    expect(server.drafts.get(key('flow', 'notify_owner'))).toStrictEqual(stored);
  });

  it('Automations pillar, FLOW, CONTROL: with no pending draft the published flow opens', async () => {
    server.active.set(key('flow', 'notify_owner'), wire(PUBLISHED_FLOW));
    renderAutomations();

    await waitFor(() => expect(JSON.parse(screen.getByTestId('surface-draft').textContent ?? '{}')).toStrictEqual(wire(PUBLISHED_FLOW)), {
      timeout: 8000,
    });
    expect(screen.queryByText(t('engine.studio.refusal.draftUnreadable', 'en-US'))).toBeNull();
  });
});
