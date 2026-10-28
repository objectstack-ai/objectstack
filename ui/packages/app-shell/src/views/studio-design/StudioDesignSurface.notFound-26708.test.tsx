// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26708 — the builder's two not-found states.
 *
 * `/studio/<id>` for an id the package list does not hold rendered the full
 * writable builder (New object, Create app, Publish) for a package that does
 * not exist, and every save there went to a phantom package. It now renders
 * "package not found", with no pillars and no package actions, and a way back
 * to the Studio landing. And `/studio/<pkg>/<segment>` for a segment no pillar
 * has fell through to the Interfaces pillar with nothing highlighted; it now
 * renders a not-found state, the real pillars still linked above it.
 *
 * Read from the package list Studio already loads (`GET /api/v1/packages`,
 * one request): a kernel package the switcher hides is installed, so it is
 * never "not found". A list that failed to load leaves the builder as it was —
 * the server's gate stays the authority. A listed package is the control.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.r34d';
const KERNEL_ID = 'com.objectstack.platform';
const PHANTOM = 'com.example.nosuch';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (_t: string, name: string) => ({ effective: { name } })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { t, tFormat } from '../metadata-admin/i18n';

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** The package list as the server serves it: one app package and one kernel package. */
function servePackages(opts: { fail?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input) !== '/api/v1/packages') return answer([]);
    if (opts.fail) return { ok: false, status: 502, json: async () => null };
    return answer({
      success: true,
      data: {
        packages: [
          { manifest: { id: PACKAGE_ID, name: 'Field Ops' }, writable: true },
          { manifest: { id: KERNEL_ID, name: 'Platform', scope: 'system' }, writable: false },
        ],
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studio" element={<div data-testid="studio-landing" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

const packageListReads = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([input]) => String(input) === '/api/v1/packages').length;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Studio: a package id no package has renders "package not found" (objectstack#26708)', () => {
  it.each(['data', 'automations', 'interfaces', 'access'])('%s: not found, no pillars, no package actions', async (pillar) => {
    const fetchMock = servePackages();
    renderAt(`/studio/${PHANTOM}/${pillar}`);

    const notFound = await screen.findByTestId('studio-package-not-found');
    expect(notFound).toHaveTextContent(tFormat('engine.studio.notFound.package', 'en', { id: PHANTOM }));
    const header = screen.getByTestId('studio-shell-header');
    expect(within(screen.getByTestId('studio-pillar-nav')).queryAllByRole('link')).toHaveLength(0);
    expect(within(header).queryByRole('button', { name: new RegExp(t('engine.studio.publish', 'en')) })).toBeNull();
    expect(within(header).queryByRole('button', { name: new RegExp(t('engine.studio.changes', 'en')) })).toBeNull();
    expect(within(header).queryByTitle(t('engine.studio.app.noneTitle', 'en'))).toBeNull();
    // The one list read the builder already makes — no second request.
    expect(packageListReads(fetchMock)).toBe(1);
  });

  it('its one action walks back to the Studio landing', async () => {
    servePackages();
    renderAt(`/studio/${PHANTOM}/data`);
    const notFound = await screen.findByTestId('studio-package-not-found');
    within(notFound).getByRole('button', { name: t('engine.studio.landingHome', 'en') }).click();
    expect(await screen.findByTestId('studio-landing')).toBeInTheDocument();
  });

  it('CONTROL — a listed package renders its builder', async () => {
    servePackages();
    renderAt(`/studio/${PACKAGE_ID}/data`);
    const header = screen.getByTestId('studio-shell-header');
    await waitFor(() =>
      expect(within(header).getByTestId('studio-pkg-chip')).toHaveAttribute('data-pkg-list-state', 'loaded'),
    );
    expect(screen.queryByTestId('studio-package-not-found')).toBeNull();
    expect(within(screen.getByTestId('studio-pillar-nav')).getAllByRole('link')).toHaveLength(4);
  });

  it('CONTROL — a kernel package the switcher hides is installed, never "not found"', async () => {
    servePackages();
    renderAt(`/studio/${KERNEL_ID}/data`);
    const header = screen.getByTestId('studio-shell-header');
    await waitFor(() =>
      expect(within(header).getByTestId('studio-pkg-chip')).toHaveAttribute('data-pkg-list-state', 'loaded'),
    );
    expect(screen.queryByTestId('studio-package-not-found')).toBeNull();
  });

  it('CONTROL — a package list that failed to load leaves the builder as it was', async () => {
    const fetchMock = servePackages({ fail: true });
    renderAt(`/studio/${PHANTOM}/data`);
    await waitFor(() => expect(packageListReads(fetchMock)).toBeGreaterThan(0));
    await waitFor(() =>
      expect(within(screen.getByTestId('studio-shell-header')).getByTestId('studio-pkg-chip'))
        .toHaveAttribute('data-pkg-list-state', 'failed'),
    );
    expect(screen.queryByTestId('studio-package-not-found')).toBeNull();
    expect(within(screen.getByTestId('studio-pillar-nav')).getAllByRole('link')).toHaveLength(4);
  });
});

describe('Studio: a pillar segment no pillar has renders a not-found state (objectstack#26708)', () => {
  it('names the segment, keeps the real pillars linked, and does not mount Interfaces', async () => {
    servePackages();
    renderAt(`/studio/${PACKAGE_ID}/bogus_pillar`);

    const notFound = await screen.findByTestId('studio-pillar-not-found');
    expect(notFound).toHaveTextContent(tFormat('engine.studio.notFound.pillar', 'en', { pillar: 'bogus_pillar' }));
    const links = within(screen.getByTestId('studio-pillar-nav')).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/studio/${PACKAGE_ID}/data`,
      `/studio/${PACKAGE_ID}/automations`,
      `/studio/${PACKAGE_ID}/interfaces`,
      `/studio/${PACKAGE_ID}/access`,
    ]);
    for (const link of links) expect(link).not.toHaveAttribute('aria-current');
  });

  it('CONTROL — the interfaces segment still opens the Interfaces pillar', async () => {
    servePackages();
    renderAt(`/studio/${PACKAGE_ID}/interfaces`);
    const current = await waitFor(() =>
      within(screen.getByTestId('studio-pillar-nav')).getByRole('link', { current: 'page' }),
    );
    expect(current).toHaveAttribute('href', `/studio/${PACKAGE_ID}/interfaces`);
    expect(screen.queryByTestId('studio-pillar-not-found')).toBeNull();
  });
});
