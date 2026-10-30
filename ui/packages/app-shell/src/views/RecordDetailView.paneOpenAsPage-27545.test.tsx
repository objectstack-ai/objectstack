/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27545 — the record in a record pane (maintainer rulings of
 * 2026-10-29):
 *
 * - Target 4: the full page opens from the row's ↗ and from the record
 *   header's `⋯`, whose last host item is 「Open as full page」 (the
 *   destructive band stays below it, objectui#12529). The bar's ⤢ maximizes
 *   in place; it routes nowhere. A record that is not in a pane — the page
 *   itself, or an embedded view no pane hosts — draws no such item.
 * - Target 5: stepping never blanks. A step to the next record keeps the
 *   record on screen until the next one arrives; the page route, a real
 *   navigation, still resets (the control).
 *
 * Harness: the `RecordDetailView.headerMenuIcons-12529` mount (the real record
 * view under a real `I18nProvider`, a metadata context and the real
 * `FavoritesProvider`), embedded the way the pane draws it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { RecordPaneContext, type RecordPaneApi } from './recordDrawerContext';
import { FavoritesProvider } from '../context/FavoritesProvider';

const OBJECT_NAME = 'crm_lead';
const NAMES: Record<string, string> = { 'L-1': 'Ada Lovelace', 'L-2': 'Grace Hopper' };

const objects = [
  {
    name: OBJECT_NAME,
    label: 'Lead',
    // The permissive bucket: edit + delete both default open.
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

const metadata = {
  objects,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as any;

/** A data source whose reads for `held` wait until released. */
function dataSourceHolding(held?: string) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const findOne = vi.fn(async (_object: string, id: string) => {
    if (id === held) await gate;
    return { id, name: NAMES[id] };
  });
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne,
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
  return { dataSource, findOne, release: () => release() };
}

function Providers({ children, initial = '/apps/crm/crm_lead' }: { children: React.ReactNode; initial?: string }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata}>
        <FavoritesProvider>
          <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
        </FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>
  );
}

function Embedded({ recordId, dataSource, pane }: { recordId: string; dataSource: unknown; pane: RecordPaneApi | null }) {
  return (
    <RecordPaneContext.Provider value={pane}>
      <RecordDetailView
        dataSource={dataSource as any}
        objects={objects}
        onEdit={() => {}}
        objectNameOverride={OBJECT_NAME}
        recordIdOverride={recordId}
        embedded
      />
    </RecordPaneContext.Provider>
  );
}

const toolbar = () => document.querySelector('[role="toolbar"]');

async function openOverflow(): Promise<HTMLElement> {
  const trigger = screen.getByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  return screen.getByRole('menu');
}

/** The menu's rows and separators, in document order. */
function menuRows(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]')).map((el) =>
    el.getAttribute('role') === 'separator' ? '---' : (el.textContent ?? '').trim(),
  );
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Target 4 — the header ⋯ ends with 「Open as full page」 in a record pane', () => {
  it('is the last host item, above the destructive band, and hands the pane the gesture', async () => {
    const { dataSource } = dataSourceHolding();
    const openAsPage = vi.fn();
    render(
      <Providers>
        <Embedded recordId="L-1" dataSource={dataSource} pane={{ openAsPage }} />
      </Providers>,
    );
    await waitFor(() => expect(toolbar()).toBeTruthy());
    const rows = menuRows(await openOverflow());
    expect(rows.slice(-3)).toEqual(['Open as full page', '---', 'Delete']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open as full page' }));
    expect(openAsPage).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: an embedded record no pane hosts draws no such item', async () => {
    const { dataSource } = dataSourceHolding();
    render(
      <Providers>
        <Embedded recordId="L-1" dataSource={dataSource} pane={null} />
      </Providers>,
    );
    await waitFor(() => expect(toolbar()).toBeTruthy());
    expect(menuRows(await openOverflow())).not.toContain('Open as full page');
  });
});

/**
 * Holds the callbacks the view queues with `queueMicrotask` while `run` runs,
 * so a reset that would flash for one frame stays on screen long enough to be
 * read. React captured its own `queueMicrotask` when it loaded; only call-time
 * lookups — the view's reset among them — are held.
 */
async function holdingMicrotasks(run: () => void | Promise<void>) {
  const held: Array<() => void> = [];
  const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    held.push(callback);
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return async () => {
    await act(async () => {
      held.splice(0).forEach((callback) => callback());
    });
  };
}

describe('Target 5 — a step keeps the record on screen until the next one arrives', () => {
  it('embedded: the previous record stays, never a skeleton, then the next one replaces it', async () => {
    const { dataSource, release } = dataSourceHolding('L-2');
    const view = render(
      <Providers>
        <Embedded recordId="L-1" dataSource={dataSource} pane={{ openAsPage: () => {} }} />
      </Providers>,
    );
    await screen.findAllByText(NAMES['L-1']);
    await waitFor(() => expect(toolbar()).toBeTruthy());

    const flush = await holdingMicrotasks(() => {
      view.rerender(
        <Providers>
          <Embedded recordId="L-2" dataSource={dataSource} pane={{ openAsPage: () => {} }} />
        </Providers>,
      );
    });
    // The next record has not arrived: the one on screen is still drawn.
    expect(toolbar()).toBeTruthy();
    expect(screen.getAllByText(NAMES['L-1']).length).toBeGreaterThan(0);
    await flush();

    await act(async () => {
      release();
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    });
    await screen.findAllByText(NAMES['L-2']);
  });

  it('CONTROL: the record page resets on a route change to another record', async () => {
    const { dataSource } = dataSourceHolding();
    function Nav() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/apps/crm/crm_lead/record/L-2')}>
          go to L-2
        </button>
      );
    }
    render(
      <Providers initial="/apps/crm/crm_lead/record/L-1">
        <Nav />
        <Routes>
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={<RecordDetailView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
          />
        </Routes>
      </Providers>,
    );
    await screen.findAllByText(NAMES['L-1']);
    await waitFor(() => expect(toolbar()).toBeTruthy());
    const flush = await holdingMicrotasks(() => {
      fireEvent.click(screen.getByRole('button', { name: 'go to L-2' }));
    });
    // The page's reset: the skeleton stands in for the record.
    expect(toolbar()).toBeNull();
    await flush();
    await screen.findAllByText(NAMES['L-2']);
  });
});
