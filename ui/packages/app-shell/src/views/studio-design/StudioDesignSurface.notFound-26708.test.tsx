// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26708 — the builder's two not-found states.
 *
 * `/studio/<id>` for an id the package list does not hold rendered the full
 * writable builder (New object, Create app, Publish) for a package that does
 * not exist, and every save there went to a phantom package. It now renders
 * "package not found", with no menu and no package actions, and a way back
 * to the Studio landing. And `/studio/<pkg>/<segment>` for a segment no pillar
 * has fell through to the Interfaces pillar with nothing highlighted; it now
 * renders a not-found state, the left menu (objectstack#36899, which replaced
 * the pillars above it) still beside it, nothing in it current. (The
 * Interfaces pillar itself retired with objectstack#36502: its old segment is
 * not "not found" but lands on the Data pillar, pinned last in this file.)
 *
 * Read from the package list Studio already loads (`GET /api/v1/packages`,
 * one request): a kernel package the switcher hides is installed, so it is
 * never "not found". A list that failed to load leaves the builder as it was —
 * the server's gate stays the authority. A listed package is the control.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches `import('@objectstack/lint')`: paid here, at collection, never inside a test's clock.
import '@objectstack/lint';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
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
    // objectstack#36899 — the registry serves the designer types the left menu lists.
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        { type: 'object', domain: 'data' },
        { type: 'flow', domain: 'automation' },
        { type: 'permission', domain: 'security' },
      ],
    }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
// A body to find: the right slot keeps its copilot mounted whatever its mode.
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => <div data-testid="studio-chat-dock" /> }));
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

function renderAt(path: string, surface: React.ReactElement = <StudioDesignSurface />) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studio" element={<div data-testid="studio-landing" />} />
        {/* objectstack#36903 — the retired Automations pillar redirects into the area. */}
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={surface} />
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

/**
 * The package list has answered and the surface has read it: the list read
 * was made, and its answer has had a turn to land. (The package switcher's
 * `data-pkg-list-state` said this until the switcher was removed,
 * objectstack#36501.)
 */
async function listAnswered(fetchMock: ReturnType<typeof servePackages>): Promise<void> {
  await waitFor(() => expect(packageListReads(fetchMock)).toBeGreaterThan(0), { timeout: 8000 });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

const menu = () => screen.getByTestId('studio-menu');
const menuLinks = () => within(menu()).getAllByRole('link');

describe('Studio: a package id no package has renders "package not found" (objectstack#26708)', () => {
  it.each(['data', 'automations', 'interfaces', 'access'])('%s: not found, no menu, no package actions', async (pillar) => {
    const fetchMock = servePackages();
    renderAt(`/studio/${PHANTOM}/${pillar}`);

    const notFound = await screen.findByTestId('studio-package-not-found');
    expect(notFound).toHaveTextContent(tFormat('engine.studio.notFound.package', 'en', { id: PHANTOM }));
    const header = screen.getByTestId('studio-shell-header');
    expect(screen.queryByTestId('studio-menu')).toBeNull();
    expect(within(header).queryByTestId('studio-menu-toggle')).toBeNull();
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
    const fetchMock = servePackages();
    renderAt(`/studio/${PACKAGE_ID}/data`);
    await listAnswered(fetchMock);
    expect(screen.queryByTestId('studio-package-not-found')).toBeNull();
    // objectstack#36899 — the left menu, its six groups drawn.
    for (const group of ['data', 'ui', 'automation', 'system', 'security', 'ai']) {
      expect(within(menu()).getByTestId(`studio-menu-group-${group}`)).toBeInTheDocument();
    }
  });

  it('CONTROL — a kernel package the Studio landing hides is installed, never "not found"', async () => {
    const fetchMock = servePackages();
    renderAt(`/studio/${KERNEL_ID}/data`);
    await listAnswered(fetchMock);
    expect(screen.queryByTestId('studio-package-not-found')).toBeNull();
  });

  it('CONTROL — a package list that failed to load leaves the builder as it was', async () => {
    const fetchMock = servePackages({ fail: true });
    renderAt(`/studio/${PHANTOM}/data`);
    await listAnswered(fetchMock);
    expect(screen.queryByTestId('studio-package-not-found')).toBeNull();
    expect(menuLinks().length).toBeGreaterThan(0);
  });
});

describe('Studio: a pillar segment no pillar has renders a not-found state (objectstack#26708)', () => {
  it('names the segment, keeps the menu beside it with nothing current, and mounts no pillar', async () => {
    servePackages();
    renderAt(`/studio/${PACKAGE_ID}/bogus_pillar`);

    const notFound = await screen.findByTestId('studio-pillar-not-found');
    expect(notFound).toHaveTextContent(tFormat('engine.studio.notFound.pillar', 'en', { pillar: 'bogus_pillar' }));
    const links = menuLinks();
    expect(links.map((a) => a.getAttribute('href'))).toContain(`/studio/${PACKAGE_ID}/metadata/object?package=${PACKAGE_ID}`);
    for (const link of links) expect(link).not.toHaveAttribute('aria-current');
  });

  it('CONTROL — the retired interfaces segment is not "not found": it lands on the Data pillar (objectstack#36502)', async () => {
    servePackages();
    renderAt(`/studio/${PACKAGE_ID}/interfaces`);
    // The Data pillar's entry in the menu is its type's, Objects.
    const current = await waitFor(() => within(menu()).getByRole('link', { current: 'page' }));
    expect(current).toHaveAttribute('data-testid', 'studio-menu-entry-type:object');
    expect(screen.queryByTestId('studio-pillar-not-found')).toBeNull();
    expect(screen.getByTestId('studio-interfaces-retired')).toBeInTheDocument();
  });
});

describe('Studio: no copilot beside a package that is not there (objectstack#32615)', () => {
  it('the built-in copilot slot is not mounted on the not-found state', async () => {
    servePackages();
    renderAt(`/studio/${PHANTOM}/data`);
    await screen.findByTestId('studio-package-not-found');
    expect(screen.queryByTestId('studio-chat-dock')).toBeNull();
    expect(screen.queryByTestId('studio-right-slot')).toBeNull();
  });

  it('CONTROL — a listed package keeps its copilot', async () => {
    const fetchMock = servePackages();
    renderAt(`/studio/${PACKAGE_ID}/data`);
    await listAnswered(fetchMock);
    expect(screen.queryByTestId('studio-package-not-found')).toBeNull();
    expect(screen.getByTestId('studio-chat-dock')).toBeInTheDocument();
  });

  it('an injected copilot (the cloud `aiSlot`) is not drawn on the not-found state; CONTROL — it is on a listed package', async () => {
    servePackages();
    renderAt(`/studio/${PHANTOM}/data`, <StudioDesignSurface aiSlot={<div data-testid="injected-copilot" />} />);
    await screen.findByTestId('studio-package-not-found');
    expect(screen.queryByTestId('injected-copilot')).toBeNull();
    cleanup();

    const listedFetch = servePackages();
    renderAt(`/studio/${PACKAGE_ID}/data`, <StudioDesignSurface aiSlot={<div data-testid="injected-copilot" />} />);
    await listAnswered(listedFetch);
    expect(screen.getByTestId('injected-copilot')).toBeInTheDocument();
  });
});
