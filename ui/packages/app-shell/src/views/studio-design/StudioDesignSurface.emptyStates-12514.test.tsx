// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12514 — the Automations and Access pillars of a package that holds
 * no flow, or no permission set, show one centered block in the content
 * column: the pillar's icon, one sentence, and a primary button that opens the
 * create dialog the rail's "+" opens, through the same handler.
 *
 *  - Automations: no aside while there is nothing to select, and the rail's
 *    empty sentence names the "+" it points at.
 *  - Access: the rail's empty sentence names the "+" too.
 *  - Read-only: the block's sentence stands alone — no button, no "+", and no
 *    rail sentence pointing at a control that is not there.
 *
 * The REAL `AutomationsPillar` and `AccessPillar`, over a client that lists
 * nothing.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { AccessPillar, AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { t } from '../metadata-admin/i18n';

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

function renderAutomations(readOnly = false) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

function renderAccess(readOnly = false) {
  render(
    <MemoryRouter>
      <AccessPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

describe('objectui#12514 — Automations with no flow', () => {
  it('one block in the content column, no aside, and a rail sentence that names its "+"', async () => {
    renderAutomations();
    const block = await screen.findByTestId('auto-empty', undefined, { timeout: 8000 });
    expect(block).toHaveTextContent(t('engine.studio.auto.emptyMain', 'en'));
    expect(within(block).getByTestId('auto-empty-new')).toHaveTextContent(t('engine.studio.auto.newTitle', 'en'));
    expect(screen.queryByTestId('auto-config-aside')).toBeNull();
    expect(screen.queryByText(t('engine.studio.auto.emptyLine1', 'en'))).toBeNull();
    const rail = screen.getByTestId('studio-rail-automations');
    expect(within(rail).getByText(t('engine.studio.auto.none', 'en'))).toBeInTheDocument();
    expect(t('engine.studio.auto.none', 'en')).toContain('“+”');
  });

  it('the button opens the dialog the rail’s "+" opens', async () => {
    renderAutomations();
    fireEvent.click(await screen.findByTestId('auto-empty-new', undefined, { timeout: 8000 }));
    const fromEmpty = await screen.findByRole('dialog', { name: t('engine.studio.auto.newTitle', 'en') });
    const presets = within(fromEmpty)
      .getAllByTestId(/^create-flow-preset-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(presets.length).toBeGreaterThan(0);
    fireEvent.keyDown(fromEmpty, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('studio-rail-add'));
    const fromRail = await screen.findByRole('dialog', { name: t('engine.studio.auto.newTitle', 'en') });
    expect(within(fromRail).getAllByTestId(/^create-flow-preset-/).map((el) => el.getAttribute('data-testid'))).toEqual(presets);
  });

  it('read-only: the sentence alone — no button, no "+", no rail pointer', async () => {
    renderAutomations(true);
    const block = await screen.findByTestId('auto-empty', undefined, { timeout: 8000 });
    expect(block).toHaveTextContent(t('engine.studio.auto.emptyMain', 'en'));
    expect(screen.queryByTestId('auto-empty-new')).toBeNull();
    expect(screen.queryByTestId('studio-rail-add')).toBeNull();
    expect(screen.queryByText(t('engine.studio.auto.none', 'en'))).toBeNull();
  });
});

describe('objectui#12514 — Access with no permission set', () => {
  it('one block in the content column, and a rail sentence that names its "+"', async () => {
    renderAccess();
    const block = await screen.findByTestId('access-empty', undefined, { timeout: 8000 });
    expect(block).toHaveTextContent(t('engine.studio.access.emptyMain', 'en'));
    expect(within(block).getByTestId('access-empty-new')).toHaveTextContent(t('engine.studio.access.new', 'en'));
    const rail = screen.getByTestId('studio-rail-access');
    expect(within(rail).getByText(t('engine.studio.access.none', 'en'))).toBeInTheDocument();
    expect(t('engine.studio.access.none', 'en')).toContain('“+”');
  });

  it('the button opens the dialog the rail’s "+" opens', async () => {
    renderAccess();
    fireEvent.click(await screen.findByTestId('access-empty-new', undefined, { timeout: 8000 }));
    const fromEmpty = await screen.findByRole('dialog', { name: t('engine.studio.access.new', 'en') });
    fireEvent.keyDown(fromEmpty, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('studio-rail-add'));
    expect(await screen.findByRole('dialog', { name: t('engine.studio.access.new', 'en') })).toBeInTheDocument();
  });

  it('read-only: the sentence alone — no button, no "+", no rail pointer', async () => {
    renderAccess(true);
    const block = await screen.findByTestId('access-empty', undefined, { timeout: 8000 });
    expect(block).toHaveTextContent(t('engine.studio.access.emptyMain', 'en'));
    expect(screen.queryByTestId('access-empty-new')).toBeNull();
    expect(screen.queryByTestId('studio-rail-add')).toBeNull();
    expect(screen.queryByText(t('engine.studio.access.none', 'en'))).toBeNull();
  });
});
