// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28562 (ADR-0146 D2, D3) — on a read-only base, the Studio
 * surface customizes into the base's paired customization package: the
 * pending count, the changes panel and Publish act on the pair's drafts, the
 * version an override is based on is the one the base's listed manifest
 * declares, and whether the ensure door refuses this caller is read from the
 * posture and the platform-operator flag the server publishes.
 *
 * The REAL `StudioDesignSurface` and the REAL metadata client over a fetch
 * stub that serves the package list, the ensure door (201 when it creates the
 * pair, 200 after), the pair's drafts and the batch publish door. Stubbed:
 * the dashboard canvas (its label and one edit), `DraftChangesPanel` (reduced
 * to the package it reviews and its publish button; the sheet has its own
 * tests) and the session (`useAuth`'s user and served config).
 *
 * Pinned:
 *  - a base with its pair listed: Pending reads the pair's drafts, the panel
 *    reviews the pair, and Publish is enabled and publishes the pair;
 *  - end to end: the first edit asks the door, writes the pair's draft
 *    declaring the override at the listed version, and Pending and Publish
 *    follow the pair the door named;
 *  - a listed manifest that states no version: Customize disabled, saying so;
 *  - a walled admin (a group posture, not the platform operator) sees
 *    Customize disabled, and the platform operator does not;
 *  - CONTROL: a base with no pair keeps the read-only Publish and reviews
 *    the base, as before.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';

const NAV = [{ id: 'nav_pipeline', type: 'dashboard', label: 'Pipeline', dashboardName: 'pipeline' }];
const APP = { name: 'crm_app', label: 'CRM', navigation: NAV };
const PIPELINE = { name: 'pipeline', label: 'Pipeline', widgets: [] };

const srv = vi.hoisted(() => ({
  pairListed: false,
  baseVersion: '4.0.0' as string | undefined,
  pairDrafts: new Map<string, Record<string, unknown>>(),
  reads: [] as string[],
  ensure: [] as number[],
  saves: [] as Array<{ path: string; search: string; body: Record<string, unknown> }>,
  publishes: [] as string[],
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
import { t } from '../metadata-admin/i18n';

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
      manifest: { id: BASE, name: 'HotCRM', namespace: 'hotcrm', ...(srv.baseVersion ? { version: srv.baseVersion } : {}) },
      writable: false,
    },
    ...(srv.pairListed
      ? [{ manifest: { id: PAIR, name: 'HotCRM customizations', namespace: 'hotcrm_custom', version: '0.1.0' }, writable: true }]
      : []),
  ];
}

const draftRows = () =>
  [...srv.pairDrafts.entries()].map(([key, body]) => {
    const [type, name] = key.split('/') as [string, string];
    return { type, name, packageId: PAIR, label: body.label };
  });

beforeAll(() => {
  registerMetadataPreview('dashboard', BoardCanvas as never);
});

beforeEach(() => {
  srv.pairListed = false;
  srv.baseVersion = '4.0.0';
  srv.pairDrafts.clear();
  srv.reads.length = 0;
  srv.ensure.length = 0;
  srv.saves.length = 0;
  srv.publishes.length = 0;
  session.posture = undefined;
  session.user = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      if (method === 'GET') srv.reads.push(`${path}${url.search}`);
      if (path === '/api/v1/packages') return json({ success: true, data: packageRows() });
      if (path === `/api/v1/packages/${BASE}/ensure-customization` && method === 'POST') {
        const created = !srv.pairListed;
        srv.pairListed = true;
        srv.ensure.push(created ? 201 : 200);
        return json(
          {
            success: true,
            data: { basePackageId: BASE, packageId: PAIR, namespace: 'hotcrm_custom', dependencyRange: '^4', created, writable: true },
          },
          created ? 201 : 200,
        );
      }
      const publish = /^\/api\/v1\/packages\/([^/]+)\/publish-drafts$/.exec(path);
      if (publish && method === 'POST') {
        const id = decodeURIComponent(publish[1]!);
        srv.publishes.push(id);
        const published = id === PAIR ? draftRows().map((d) => ({ type: d.type, name: d.name, version: 'sha256:1' })) : [];
        if (id === PAIR) srv.pairDrafts.clear();
        return json({
          success: true,
          data: { success: published.length > 0, outcome: published.length > 0 ? 'published' : 'nothing_to_publish', publishedCount: published.length, failedCount: 0, published, failed: [] },
        });
      }
      if (path === '/api/v1/meta/_drafts') {
        const scope = url.searchParams.get('packageId');
        return json({ drafts: !scope || scope === PAIR ? draftRows() : [] });
      }
      if (path === '/api/v1/meta/app') return json([{ name: 'crm_app', label: 'CRM' }]);
      if (path === '/api/v1/meta/app/crm_app/layers') return json({ code: null, overlay: null, overlayScope: null, effective: APP });
      if (path === '/api/v1/meta/dashboard/pipeline/layers') {
        return json({ code: PIPELINE, overlay: null, overlayScope: null, effective: PIPELINE });
      }
      if (path === '/api/v1/meta/dashboard/pipeline') {
        if (method === 'PUT') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          srv.saves.push({ path, search: url.search, body });
          if (url.searchParams.get('package') !== PAIR) return json({ success: false, error: { message: 'read-only' } }, 403);
          srv.pairDrafts.set('dashboard/pipeline', body);
          return json({ success: true, version: `v${srv.saves.length}`, state: 'draft' });
        }
        const draft = url.searchParams.get('package') === PAIR ? srv.pairDrafts.get('dashboard/pipeline') : undefined;
        return draft ? json({ type: 'dashboard', name: 'pipeline', item: draft, version: 'v1' }) : json({}, 404);
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

function renderWorkbench() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${BASE}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

const publishButton = () => screen.getByRole('button', { name: /^Publish/ });
const panelPackage = () => screen.getByTestId('changes-panel').getAttribute('data-package');
const header = () => screen.getByTestId('if-item-header');

async function openPipeline(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('board-label')).toHaveTextContent(/^Pipeline/), { timeout: 8000 });
}

describe('a read-only base with its pair listed: Pending, the panel and Publish act on the pair (objectstack#28562)', () => {
  it('reads the pair’s drafts, reviews the pair, and publishes the pair', async () => {
    srv.pairListed = true;
    srv.pairDrafts.set('dashboard/pipeline', { ...PIPELINE, label: 'Pipeline (ours)', overrides: { package: BASE, basedOn: '4.0.0' } });
    renderWorkbench();

    await waitFor(() => expect(panelPackage()).toBe(PAIR), { timeout: 8000 });
    await waitFor(() => expect(srv.reads).toContain(`/api/v1/meta/_drafts?packageId=${encodeURIComponent(PAIR)}`));
    await waitFor(() => expect(publishButton()).toBeEnabled(), { timeout: 8000 });
    expect(publishButton().parentElement).not.toHaveAttribute('data-disabled-reason');

    fireEvent.click(screen.getByTestId('publish-all-drafts'));
    await waitFor(() => expect(srv.publishes).toEqual([PAIR]));
  });

  it('CONTROL: a base with no pair keeps the read-only Publish, and the panel reviews the base', async () => {
    renderWorkbench();
    await waitFor(() => expect(publishButton().parentElement).toHaveAttribute('data-disabled-reason'), { timeout: 8000 });
    expect(publishButton()).toBeDisabled();
    expect(panelPackage()).toBe(BASE);
    expect(screen.queryByTestId('publish-all-drafts')).toBeNull();
  });
});

describe('end to end: the first edit makes the pair, and Pending and Publish follow it (objectstack#28562)', () => {
  it('asks the door once, writes the pair’s draft at the listed version, then reviews and publishes the pair', async () => {
    renderWorkbench();
    await openPipeline();
    fireEvent.click(await within(header()).findByTestId('studio-customize', undefined, { timeout: 8000 }));

    fireEvent.click(screen.getByRole('button', { name: 'patch the board' }));
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 8000 });
    expect(srv.ensure).toEqual([201]);
    const [saved] = srv.saves;
    expect(new URLSearchParams(saved!.search).get('package')).toBe(PAIR);
    expect(new URLSearchParams(saved!.search).get('mode')).toBe('draft');
    expect(saved!.body).toStrictEqual({ ...PIPELINE, label: 'Pipeline (ours)', overrides: { package: BASE, basedOn: '4.0.0' } });

    await waitFor(() => expect(panelPackage()).toBe(PAIR), { timeout: 8000 });
    await waitFor(() => expect(publishButton()).toBeEnabled(), { timeout: 8000 });
    fireEvent.click(screen.getByTestId('publish-all-drafts'));
    await waitFor(() => expect(srv.publishes).toEqual([PAIR]));
  });

  it('a listed manifest that states no version: Customize is disabled, saying so, and nothing is asked', async () => {
    srv.baseVersion = undefined;
    renderWorkbench();
    await openPipeline();
    const blocked = await within(header()).findByTestId('studio-customize-blocked', undefined, { timeout: 8000 });
    expect(blocked).toHaveAttribute('data-block', 'noVersion');
    expect(within(blocked).getByTestId('studio-customize')).toBeDisabled();
    expect(srv.ensure).toEqual([]);
  });
});

describe('the wall is read from what the server publishes (objectstack#28562)', () => {
  it('a group posture and an admin who is not the platform operator: Customize disabled, with the reason', async () => {
    session.posture = 'group';
    session.user = { id: 'u1', name: 'Ada', email: 'ada@example.com', isPlatformAdmin: false };
    renderWorkbench();
    await openPipeline();
    await waitFor(
      () => expect(within(header()).getByTestId('studio-customize-blocked')).toHaveAttribute('data-block', 'walled'),
      { timeout: 8000 },
    );
    expect(within(header()).getByTestId('studio-customize-blocked')).toHaveAttribute(
      'title',
      t('engine.studio.customize.walled', 'en'),
    );
  });

  it('CONTROL: the platform operator under the same posture is offered Customize', async () => {
    session.posture = 'group';
    session.user = { id: 'u0', name: 'Op', email: 'op@example.com', isPlatformAdmin: true };
    renderWorkbench();
    await openPipeline();
    const button = await within(header()).findByTestId('studio-customize', undefined, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(button).toBeEnabled();
    expect(within(header()).queryByTestId('studio-customize-blocked')).toBeNull();
  });
});
