// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26733 — a Studio rail search that matches nothing says so.
 *
 * Before: the Data and Access rails went blank under a query that matched no
 * row, so a mistyped search read as a list that failed to load; the
 * Automations rail printed its own sentence and offered no way back but the
 * keyboard. Now the shared `StudioRail` draws one state for all three, from the
 * match count each pillar hands it: a sentence naming the query, and a "Clear
 * search" action that empties the box and puts every row back.
 *
 * Per rail (the REAL pillars over a mocked metadata client):
 *  - a query that matches nothing shows the state, naming the query;
 *  - "Clear search" restores the list and empties (and focuses) the box;
 *  - a query that matches shows no state;
 *  - an empty package keeps its own empty sentence, with no no-matches line,
 *    whether or not a query is typed.
 * And the state reads in zh.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

const PKG = 'com.acme.app';

/** What `client.list(type)` answers in the current test, per metadata type. */
const listed = vi.hoisted(() => ({ rows: {} as Record<string, Array<Record<string, unknown>>> }));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => listed.rows[type] ?? []),
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

import { AccessPillar, AutomationsPillar, DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { t, tFormat } from '../metadata-admin/i18n';

// The "Clear search" row lives in `@object-ui/i18n`'s `studio` namespace, whose
// `zh` catalogue is fetched on demand (objectstack#25922). Resident before any
// case, so the zh case reads it synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

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

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const EDGES = [{ id: 'e1', source: 'start', target: 'end' }];

const ROWS: Record<string, Array<Record<string, unknown>>> = {
  object: [
    { name: 'crm_account', label: 'Account' },
    { name: 'crm_contact', label: 'Contact' },
  ],
  flow: [
    { name: 'nightly_digest', label: 'Nightly digest', type: 'autolaunched', nodes: NODES, edges: EDGES },
    { name: 'approve_order', label: 'Approve order', type: 'autolaunched', nodes: NODES, edges: EDGES },
  ],
  permission: [
    { name: 'sales_rep', label: 'Sales rep' },
    { name: 'support_agent', label: 'Support agent' },
  ],
};

beforeEach(() => {
  listed.rows = ROWS;
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

interface RailCase {
  name: string;
  railTestId: string;
  placeholderKey: string;
  /** The labels the rail lists for `ROWS`, and a query that matches only the first. */
  labels: [string, string];
  match: string;
  /** The sentence the rail shows for an empty package. */
  emptyKey: string;
  pillar: () => React.ReactElement;
}

const CASES: RailCase[] = [
  {
    name: 'Data',
    railTestId: 'studio-rail-data',
    placeholderKey: 'engine.studio.data.searchObjects',
    labels: ['Account', 'Contact'],
    match: 'acc',
    emptyKey: 'engine.studio.data.noObjects',
    pillar: () => <DataPillar packageId={PKG} />,
  },
  {
    name: 'Automations',
    railTestId: 'studio-rail-automations',
    placeholderKey: 'engine.studio.designer.search',
    labels: ['Nightly digest', 'Approve order'],
    match: 'digest',
    emptyKey: 'engine.studio.auto.none',
    pillar: () => <AutomationsPillar packageId={PKG} />,
  },
  {
    name: 'Access',
    railTestId: 'studio-rail-access',
    placeholderKey: 'engine.studio.access.search',
    labels: ['Sales rep', 'Support agent'],
    match: 'sales',
    emptyKey: 'engine.studio.access.none',
    pillar: () => <AccessPillar packageId={PKG} />,
  },
];

function renderRail(c: RailCase, language: 'en' | 'zh' = 'en') {
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/studio/${PKG}`]}>{c.pillar()}</MemoryRouter>
    </I18nProvider>,
  );
}

/** The rail once its rows have rendered, and its search box. */
async function loadedRail(c: RailCase, locale: 'en' | 'zh-CN' = 'en') {
  const rail = await screen.findByTestId(c.railTestId, undefined, { timeout: 8000 });
  await waitFor(() => expect(within(rail).getByText(c.labels[0])).toBeInTheDocument(), { timeout: 8000 });
  const search = within(rail).getByPlaceholderText(t(c.placeholderKey, locale)) as HTMLInputElement;
  return { rail, search };
}

describe.each(CASES)('the $name rail: a search that matches nothing (objectstack#26733)', (c) => {
  it('names the query, and lists no row', async () => {
    renderRail(c);
    const { rail, search } = await loadedRail(c);
    fireEvent.change(search, { target: { value: '  zzzz  ' } });

    const state = within(rail).getByTestId('studio-rail-no-matches');
    expect(state).toHaveTextContent(tFormat('engine.list.emptyQuery', 'en', { query: 'zzzz' }));
    expect(within(state).getByRole('button', { name: t('engine.studio.rail.clearSearch', 'en') })).toBeInTheDocument();
    for (const label of c.labels) expect(within(rail).queryByText(label)).toBeNull();
    // Not the empty-package sentence: the package HAS rows.
    expect(within(rail).queryByText(t(c.emptyKey, 'en'))).toBeNull();
  });

  it('"Clear search" empties the box and puts every row back', async () => {
    renderRail(c);
    const { rail, search } = await loadedRail(c);
    fireEvent.change(search, { target: { value: 'zzzz' } });
    fireEvent.click(within(rail).getByTestId('studio-rail-clear-search'));

    expect(search.value).toBe('');
    expect(search).toHaveFocus();
    expect(within(rail).queryByTestId('studio-rail-no-matches')).toBeNull();
    for (const label of c.labels) expect(within(rail).getByText(label)).toBeInTheDocument();
  });

  it('control: a query that matches shows its row and no state', async () => {
    renderRail(c);
    const { rail, search } = await loadedRail(c);
    fireEvent.change(search, { target: { value: c.match } });

    expect(within(rail).getByText(c.labels[0])).toBeInTheDocument();
    expect(within(rail).queryByText(c.labels[1])).toBeNull();
    expect(within(rail).queryByTestId('studio-rail-no-matches')).toBeNull();
  });

  it('an empty package keeps its own sentence, and no no-matches line even under a query', async () => {
    listed.rows = {};
    renderRail(c);
    const rail = await screen.findByTestId(c.railTestId, undefined, { timeout: 8000 });
    await waitFor(() => expect(within(rail).getByText(t(c.emptyKey, 'en'))).toBeInTheDocument(), { timeout: 8000 });
    expect(within(rail).queryByTestId('studio-rail-no-matches')).toBeNull();

    fireEvent.change(within(rail).getByPlaceholderText(t(c.placeholderKey, 'en')), { target: { value: 'zzzz' } });
    expect(within(rail).queryByTestId('studio-rail-no-matches')).toBeNull();
  });
});

describe('the no-matches state in zh (objectstack#26733)', () => {
  it('names the query and labels its action in Chinese', async () => {
    const c = CASES[0];
    renderRail(c, 'zh');
    const { rail, search } = await loadedRail(c, 'zh-CN');
    fireEvent.change(search, { target: { value: 'zzzz' } });

    const state = within(rail).getByTestId('studio-rail-no-matches');
    expect(state).toHaveTextContent(tFormat('engine.list.emptyQuery', 'zh-CN', { query: 'zzzz' }));
    expect(within(state).getByRole('button')).toHaveTextContent('清除搜索');
    expect(t('engine.studio.rail.clearSearch', 'zh-CN')).toBe('清除搜索');
  });
});
