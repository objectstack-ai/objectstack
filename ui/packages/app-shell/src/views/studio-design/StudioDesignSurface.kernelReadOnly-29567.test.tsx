// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29567 — a system-scope package opened in Studio reads as the
 * server judges it: read-only, with Customize into its paired customization
 * package. The switcher's list leaves kernel packages out (which packages it
 * offers), and the surface used to take that absence for "no verdict", so the
 * package opened editable, with no read-only chip and no Customize, and every
 * edit was refused on save.
 *
 * The REAL `StudioDesignSurface` and the REAL metadata client over a fetch
 * stub serving the package list (the system row carries `writable: false`, as
 * the server's write predicate answers for scope `system`), the ensure door
 * and the dashboard's layered read. Stubbed: the dashboard canvas (its label
 * and one edit), `DraftChangesPanel` and the session.
 *
 * Pinned:
 *  - the chip names the package and says it is read-only; the menu still
 *    does not offer it;
 *  - Customize is offered on its dashboard, and the first edit asks the door
 *    and writes the pair's draft declaring the override at the listed version;
 *  - a system package the door refuses (its manifest states no version, so the
 *    pair's dependency range cannot be declared): Customize disabled, saying
 *    so, and the door is never asked;
 *  - CONTROL: an ordinary writable package opens with no chip and no Customize.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/** A system-scope package, as the platform ships its own (manifest scope `system`). */
const BASE = 'com.objectstack.plugin-auth';
const PAIR = 'com.objectstack.plugin-auth.custom';
/** An ordinary writable package, listed beside it. */
const OWN = 'com.example.field_ops';

const NAV = [{ id: 'nav_overview', type: 'dashboard', label: 'System overview', dashboardName: 'system_overview' }];
const APP = { name: 'auth_app', label: 'Auth', navigation: NAV };
const OVERVIEW = { name: 'system_overview', label: 'System overview', widgets: [] };

const srv = vi.hoisted(() => ({
  baseVersion: '3.2.0' as string | undefined,
  ensure: [] as number[],
  saves: [] as Array<{ path: string; search: string; body: Record<string, unknown> }>,
}));

const session = vi.hoisted(() => ({
  posture: undefined as string | undefined,
  user: null as null | { id: string; name: string; email: string; isPlatformAdmin?: boolean },
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  const getAuthConfig = async () => ({ features: session.posture ? { tenancyPosture: session.posture } : {} });
  return {
    ...actual,
    useAuth: () => ({ ...actual.useAuth(), user: session.user, getAuthConfig }),
  };
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
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: ({ packageId, onPublish }: { packageId: string | null; onPublish?: () => void | Promise<void> }) => (
    <div data-testid="changes-panel" data-package={packageId ?? ''}>
      {onPublish && (
        <button type="button" data-testid="publish-all-drafts" onClick={() => void onPublish()}>
          publish
        </button>
      )}
    </div>
  ),
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { tFormat } from '../metadata-admin/i18n';

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
      <button type="button" onClick={() => onPatch?.({ label: `${String(draft?.label ?? '')} (ours)` })}>
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
    {
      manifest: {
        id: BASE,
        name: 'Authentication',
        namespace: 'sys',
        scope: 'system',
        ...(srv.baseVersion ? { version: srv.baseVersion } : {}),
      },
      writable: false,
    },
    { manifest: { id: OWN, name: 'Field Ops', namespace: 'field_ops', version: '0.1.0' }, writable: true },
  ];
}

beforeAll(() => {
  registerMetadataPreview('dashboard', BoardCanvas as never);
});

beforeEach(() => {
  srv.baseVersion = '3.2.0';
  srv.ensure.length = 0;
  srv.saves.length = 0;
  session.posture = undefined;
  session.user = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      if (path === '/api/v1/packages') return json({ success: true, data: packageRows() });
      if (path === `/api/v1/packages/${BASE}/ensure-customization` && method === 'POST') {
        const created = srv.ensure.length === 0;
        srv.ensure.push(created ? 201 : 200);
        return json(
          {
            success: true,
            data: { basePackageId: BASE, packageId: PAIR, namespace: 'sys_custom', dependencyRange: '^3', created, writable: true },
          },
          created ? 201 : 200,
        );
      }
      if (path === '/api/v1/meta/_drafts') return json({ drafts: [] });
      if (path === '/api/v1/meta/app') return json([{ name: 'auth_app', label: 'Auth' }]);
      if (path === '/api/v1/meta/app/auth_app/layers') return json({ code: null, overlay: null, overlayScope: null, effective: APP });
      if (path === '/api/v1/meta/dashboard/system_overview/layers') {
        return json({ code: OVERVIEW, overlay: null, overlayScope: null, effective: OVERVIEW });
      }
      if (path === '/api/v1/meta/dashboard/system_overview' && method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        srv.saves.push({ path, search: url.search, body });
        if (url.searchParams.get('package') !== PAIR) {
          return json({ success: false, error: { code: 'NOT_OVERRIDABLE', message: 'read-only' } }, 403);
        }
        return json({ success: true, version: `v${srv.saves.length}`, state: 'draft' });
      }
      if (path.endsWith('/layers')) return json({ code: null, overlay: null, overlayScope: null, effective: null });
      if (/^\/api\/v1\/meta\/[^/]+\/[^/]+$/.test(path)) return json({}, 404);
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(packageId: string) {
  return render(
    <MemoryRouter initialEntries={[`/studio/${packageId}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

const chip = () => within(screen.getByTestId('studio-shell-header')).getByTestId('studio-pkg-chip');
const header = () => screen.getByTestId('if-item-header');

async function openOverview(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('board-label')).toHaveTextContent(/^System overview/), { timeout: 8000 });
}

describe('a system-scope package opens read-only, as the server judges it (objectstack#29567)', () => {
  it('the chip names the package and says it is read-only; the menu still does not offer it', async () => {
    renderAt(BASE);
    await waitFor(() => expect(within(chip()).getByTestId('studio-pkg-readonly')).toBeInTheDocument(), { timeout: 8000 });
    expect(within(chip()).getByText('Authentication')).toBeInTheDocument();

    fireEvent.click(chip());
    const menu = await screen.findByRole('dialog');
    expect(within(menu).getByText('Field Ops')).toBeInTheDocument();
    expect(within(menu).queryByText('Authentication')).toBeNull();
  });

  it('offers Customize on its dashboard, and the first edit asks the door and writes the pair', async () => {
    renderAt(BASE);
    await openOverview();
    fireEvent.click(await within(header()).findByTestId('studio-customize', undefined, { timeout: 8000 }));

    fireEvent.click(screen.getByRole('button', { name: 'patch the board' }));
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    const [saved] = srv.saves;
    expect(new URLSearchParams(saved!.search).get('package')).toBe(PAIR);
    expect(saved!.body).toStrictEqual({
      ...OVERVIEW,
      label: 'System overview (ours)',
      overrides: { package: BASE, basedOn: '3.2.0' },
    });
  });

  it('a system package the door refuses (no manifest version): Customize disabled, saying so, door never asked', async () => {
    srv.baseVersion = undefined;
    renderAt(BASE);
    await openOverview();
    const blocked = await within(header()).findByTestId('studio-customize-blocked', undefined, { timeout: 8000 });
    expect(blocked).toHaveAttribute('data-block', 'noVersion');
    expect(blocked).toHaveAttribute('title', tFormat('engine.studio.customize.noVersion', 'en', { package: 'Authentication' }));
    expect(within(blocked).getByTestId('studio-customize')).toBeDisabled();
    expect(within(chip()).getByTestId('studio-pkg-readonly')).toBeInTheDocument();
    expect(srv.ensure).toEqual([]);
  });

  it('CONTROL: an ordinary writable package opens with no read-only chip and no Customize', async () => {
    renderAt(OWN);
    await waitFor(() => expect(chip()).toHaveAttribute('data-pkg-list-state', 'loaded'), { timeout: 8000 });
    await waitFor(() => expect(within(chip()).getByText('Field Ops')).toBeInTheDocument());
    expect(within(chip()).queryByTestId('studio-pkg-readonly')).toBeNull();
    expect(screen.queryByTestId('studio-customize')).toBeNull();
    expect(screen.queryByTestId('studio-customize-blocked')).toBeNull();
  });
});
