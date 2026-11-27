// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12514 — a pillar with nothing to list showed one centered block in
 * its content column. Both halves went with their pillars: the Automations
 * rail (objectstack#36903) and the Access pillar (objectstack#36905). An empty
 * package's flows and permission sets are now their type's empty list. What
 * the flow designer still owes is its own empty state, an address naming a
 * flow that is not here, pinned below.
 *
 * The REAL `AutomationsPillar`, over a client that lists nothing.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches a dynamic `import('@objectstack/lint')`; its first load is paid
// here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
// objectstack#36900 — the surface mounts the command palette, which reaches the
// record preview's `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [] as Array<Record<string, unknown>>),
  listDrafts: vi.fn(async () => [] as Array<Record<string, unknown>>),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => {
    throw new Error('this suite saves nothing');
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
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
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// jsdom has no matchMedia — useIsMobile (rail overlay) needs a stub.
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** objectstack#36903 — the flow designer on an address naming a flow the package does not hold. */
function renderMissingFlow() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/metadata/flow/gone_flow`]}>
      <AutomationsPillar packageId={PKG} flowName="gone_flow" />
    </MemoryRouter>,
  );
}

/**
 * objectstack#36903 — a package with no flow is the flow list's empty state
 * now (the list's 「新建」 creates the first); the designer has no list and no
 * New of its own. What it owes is the address naming a flow that is not there:
 * one block saying so, no aside, nothing else opened in its place.
 */
describe('objectstack#36903 — the flow designer over a flow the package does not hold', () => {
  it('one block naming the flow, no aside, no New', async () => {
    renderMissingFlow();
    const block = await screen.findByTestId('auto-flow-missing', undefined, { timeout: 8000 });
    expect(block).toHaveTextContent(tFormat('engine.studio.auto.deepLinkMissing', 'en', { name: 'gone_flow' }));
    expect(screen.queryByTestId('auto-config-aside')).toBeNull();
    expect(screen.queryByTitle(t('engine.studio.auto.newTitle', 'en'))).toBeNull();
    expect(screen.queryByTestId('auto-tab-canvas')).toBeNull();
  });
});
