// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 — Studio's one right slot holds the open item's properties,
 * never beside a second right-hand panel. A page that claims nothing (the
 * sharing overview) keeps the slot closed, and the pillars' host says so.
 * The selection cases live in `pillarsClaimSlot-12725`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'com.acme.app';
const NAV = [{ id: 'nav_dash', type: 'dashboard', label: 'Overview', dashboardName: 'sales_overview' }];

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'dashboard') return { effective: { name: 'sales_overview', label: 'Sales' } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  references: vi.fn(async () => []),
  withPreviewDrafts() {
    return this;
  },
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
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

// The source loads `@objectstack/lint` lazily; paid here, at collection, not
// inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
// objectstack#36900 — the surface mounts the command palette, which reaches the
// record preview's `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';
import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';

function StubInspector(): React.ReactElement {
  return (
    <div data-testid="stub-inspector">
      <input aria-label="Block title" />
    </div>
  );
}

function StubDashboardPreview(props: Record<string, unknown>): React.ReactElement {
  const onSel = props.onSelectionChange as ((s: unknown) => void) | undefined;
  return (
    <button type="button" data-testid="pick-block" onClick={() => onSel?.({ kind: 'block', id: 'blk_1', label: 'Revenue' })}>
      pick
    </button>
  );
}

registerMetadataPreview('dashboard', StubDashboardPreview as never);
registerMetadataInspector('dashboard', StubInspector as never);

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Acme' }, writable: true }] } })
        : answer([]),
    ),
  );
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

function renderAt(tab: string, props: { aiSlot?: React.ReactNode } = {}) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/${tab}`]}>
      <Routes>
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" {...props} />} />
        <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface {...props} /></StudioPillarRedirect>} />
      </Routes>
    </MemoryRouter>,
  );
}

const slot = () => screen.getByTestId('studio-right-slot');

// objectstack#35061 item 1 — the pillars' host is what every rail's narrow form
// measures, and it says whether the slot squeezes it.
describe('Studio right slot — the rails read whether it squeezes the pillars (objectstack#35061)', () => {
  it('a page with no slot to show (the sharing overview) keeps its host closed', async () => {
    renderAt('owd');
    await screen.findByTestId('owd-item-header');
    await act(async () => {});
    expect(slot()).not.toBeVisible();
    expect(screen.getByTestId('studio-pillars-host')).toHaveAttribute('data-studio-slot', 'closed');
  });
});
