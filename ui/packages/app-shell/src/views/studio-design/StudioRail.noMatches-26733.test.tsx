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
import { StudioRail, StudioRailRow } from './StudioRail';
import { railAbbreviation } from './railAbbreviation';
import {
  STUDIO_PILLARS_HOST,
  STUDIO_RAIL_FLOATING,
  STUDIO_RAIL_NARROW_CONTENT_WIDTH,
  STUDIO_RAIL_NARROW_WIDTH,
  STUDIO_RAIL_ROW_ABBR,
  STUDIO_RAIL_WIDTH,
} from './studio-tokens';
import * as studioTokens from './studio-tokens';
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

// objectstack#35061 item 1 — the narrow form every rail shares while the right
// slot squeezes the pillars. jsdom evaluates no container query: these pins
// hold the DOM both forms share and the class strings that switch between them.
describe('the rails\' narrow form (objectstack#35061)', () => {
  it('abbreviates a name to its first character, upper-cased, a grapheme kept whole', () => {
    expect(railAbbreviation('客户', 'zh-CN')).toBe('客');
    expect(railAbbreviation('  account', 'en')).toBe('A');
    expect(railAbbreviation('éclair', 'en')).toBe('É');
    expect(railAbbreviation('👩‍💻 team', 'en')).toBe('👩‍💻');
    // The display locale's case rules: Turkish dotted capital I.
    expect(railAbbreviation('istanbul', 'tr')).toBe('İ');
    expect(railAbbreviation('   ', 'en')).toBe('');
    expect(railAbbreviation(undefined, 'en')).toBe('');
  });

  it('every narrow-form class reads the pillars host at 900 px of content beside the 240 px rail', () => {
    expect(STUDIO_RAIL_WIDTH).toBe('w-60');
    expect(STUDIO_RAIL_NARROW_CONTENT_WIDTH).toBe(900);
    expect(STUDIO_PILLARS_HOST).toBe('group/studio-pillars @container/studio-pillars');
    const narrow = Object.entries(studioTokens).filter(
      ([name, value]) => name.startsWith('STUDIO_RAIL_') && typeof value === 'string' && value.includes('studio-pillars'),
    );
    expect(narrow.length).toBeGreaterThanOrEqual(9);
    for (const [, value] of narrow) {
      for (const cls of (value as string).split(/\s+/).filter((c) => c.includes('studio-pillars'))) {
        expect(cls).toContain('group-data-[studio-slot=open]/studio-pillars:');
        expect(cls).toContain(`@max-[${STUDIO_RAIL_NARROW_CONTENT_WIDTH + 240}px]/studio-pillars:`);
      }
    }
  });

  describe.each(CASES)('the $name rail', (c) => {
    it('keeps its 240 px width class, and narrows by the host alone; each row carries its character and its whole name', async () => {
      renderRail(c);
      const { rail } = await loadedRail(c);
      expect(rail).toHaveClass(STUDIO_RAIL_WIDTH, ...STUDIO_RAIL_NARROW_WIDTH.split(' '));
      expect(rail).toHaveAttribute('data-rail-peek', 'off');
      for (const label of c.labels) {
        // The label stays the row's text and its accessible name; the character is generated content.
        const row = within(rail).getByRole('button', { name: label });
        expect(row).toHaveAttribute('data-studio-rail-item');
        expect(row).toHaveAttribute('data-abbr', railAbbreviation(label, 'en'));
        expect(row).toHaveClass(...STUDIO_RAIL_ROW_ABBR.split(' '));
        expect(row.textContent?.startsWith(label)).toBe(true);
        expect(row.getAttribute('title')).toContain(label);
      }
    });

    it('「»」 floats the full rail over the content; Escape puts it back and returns focus; so does a picked row', async () => {
      renderRail(c);
      const { rail } = await loadedRail(c);
      const toggle = within(rail).getByTestId('studio-rail-float');
      expect(toggle).toHaveAccessibleName(t('engine.studio.rail.expand', 'en'));
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(toggle);
      expect(rail).toHaveAttribute('data-rail-peek', 'on');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAccessibleName(t('engine.studio.rail.collapse', 'en'));
      expect(toggle.parentElement?.parentElement).toHaveClass(...STUDIO_RAIL_FLOATING.split(' '));

      const row = within(rail).getByRole('button', { name: c.labels[1] });
      row.focus();
      fireEvent.keyDown(row, { key: 'Escape' });
      expect(rail).toHaveAttribute('data-rail-peek', 'off');
      expect(toggle).toHaveFocus();

      fireEvent.click(toggle);
      fireEvent.click(within(rail).getByRole('button', { name: c.labels[1] }));
      expect(rail).toHaveAttribute('data-rail-peek', 'off');
    });
  });

  it('a click outside puts the floating rail back; a click inside that picks nothing keeps it', () => {
    render(
      <div>
        <button type="button">outside</button>
        <StudioRail heading="Objects" testId="rail" search={{ value: '', onChange: () => {}, placeholder: 'Search' }}>
          <StudioRailRow>Account</StudioRailRow>
        </StudioRail>
      </div>,
    );
    const rail = screen.getByTestId('rail');
    fireEvent.click(within(rail).getByTestId('studio-rail-float'));
    fireEvent.pointerDown(within(rail).getByPlaceholderText('Search'));
    expect(rail).toHaveAttribute('data-rail-peek', 'on');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(rail).toHaveAttribute('data-rail-peek', 'off');
  });

  it('a row with no string name keeps its icon in the narrow form; under the mobile breakpoint there is no 「»」', () => {
    render(
      <StudioRail heading="Sets" testId="rail" isMobile open>
        <StudioRailRow icon={<svg data-testid="glyph" />}>
          <span>Sales rep</span>
        </StudioRailRow>
        <StudioRailRow name="Support agent">
          <span>Support agent</span>
        </StudioRailRow>
      </StudioRail>,
    );
    const rail = screen.getByTestId('rail');
    expect(within(rail).queryByTestId('studio-rail-float')).toBeNull();
    expect(rail).not.toHaveClass(...STUDIO_RAIL_NARROW_WIDTH.split(' '));
    const [first, second] = within(rail).getAllByRole('button');
    expect(first).not.toHaveAttribute('data-abbr');
    expect(first).not.toHaveClass(...STUDIO_RAIL_ROW_ABBR.split(' '));
    expect(within(first).getByTestId('glyph').parentElement?.className).toBe('contents');
    expect(second).toHaveAttribute('data-abbr', 'S');
    expect(second).toHaveAttribute('title', 'Support agent');
    expect(second).toHaveTextContent(/^Support agent$/);
  });

  it('reads 「»」 in zh', async () => {
    renderRail(CASES[0], 'zh');
    const rail = await screen.findByTestId(CASES[0].railTestId, undefined, { timeout: 8000 });
    expect(within(rail).getByTestId('studio-rail-float')).toHaveAccessibleName('展开完整列表');
    expect(t('engine.studio.rail.collapse', 'zh-CN')).toBe('收回窄栏');
  });
});
