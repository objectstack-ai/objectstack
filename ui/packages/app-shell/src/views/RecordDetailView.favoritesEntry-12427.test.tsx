/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36246: the record's favorites control is the star beside its
 * name, as Attio draws it (maintainer: 「以 attio 为准」). It is always drawn,
 * hollow until the record is a favorite and filled once it is, and one press
 * toggles it with no confirm. The header's `⋯` holds no favorites entry, so
 * the page keeps one control. Every face `page:header` draws carries it: the
 * full page's bar, a drawer or pane (`embedded`), and a phone's header.
 *
 * A record is never a navigation entry, so the star toggles the `record:`
 * favorite, which the sidebar draws in its Favorites section at the top; the
 * stored entry is the one the `⋯` entry of objectui#12427 wrote.
 *
 * Updated deliberately by objectstack#36246: this file pinned the opposite
 * (the `⋯` entry as the one control, no header star), objectui#12427's
 * placement, which the maintainer's ruling reverses.
 *
 * Harness: the `RecordDetailView.deleteConfirmDialog-11001` mount (the real
 * record page under a real `I18nProvider` and a metadata context), plus the
 * real `FavoritesProvider`, on the record route so the page knows its app.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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
import { FavoritesProvider, type FavoriteItem } from '../context/FavoritesProvider';

const OBJECT_NAME = 'crm_call';
const RECORD_ID = 'rec-call-1';
const RECORD_PATH = `/apps/crm/${OBJECT_NAME}/record/${RECORD_ID}`;

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Call',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

const METADATA = {
  objects: OBJECTS,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as any;

/** The provider's local key for a signed-out session. */
const STORE_KEY = 'objectui-favorites';
const stored = (): FavoriteItem[] => JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');

async function mountRecordPage(opts: { embedded?: boolean } = {}) {
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Intro call' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={METADATA}>
        <FavoritesProvider>
          <MemoryRouter initialEntries={[RECORD_PATH]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/record/:recordId"
                element={
                  opts.embedded ? (
                    <RecordDetailView
                      dataSource={dataSource}
                      objects={OBJECTS}
                      onEdit={() => {}}
                      objectNameOverride={OBJECT_NAME}
                      recordIdOverride={RECORD_ID}
                      embedded
                    />
                  ) : (
                    <RecordDetailView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />
                  )
                }
              />
            </Routes>
          </MemoryRouter>
        </FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector('[role="toolbar"]')).toBeTruthy());
}

/** The record header's favorite star, by either of its two names. */
function headerStars(): HTMLElement[] {
  return [
    ...screen.queryAllByRole('button', { name: 'Add to favorites' }),
    ...screen.queryAllByRole('button', { name: 'Remove from favorites' }),
  ];
}

/** Whether a star draws filled: the chip fills its icon once the record is a favorite. */
function isFilled(star: HTMLElement): boolean {
  return star.querySelector('svg')?.getAttribute('class')?.split(/\s+/).includes('fill-yellow-400') ?? false;
}

/** Opens the header's overflow and returns its entries' text. */
async function openOverflow(): Promise<string[]> {
  const [trigger] = screen.getAllByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  return screen.getAllByRole('menuitem').map((el) => (el.textContent ?? '').trim());
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

describe('record page: the favorite star beside the record name, none in the ⋯ (objectstack#36246)', () => {
  it('the star sits in the name\'s row, hollow, and the ⋯ holds no favorites entry', async () => {
    await mountRecordPage();
    const star = await waitFor(() => {
      const [only, ...rest] = headerStars();
      expect(rest).toHaveLength(0);
      expect(only).toBeTruthy();
      return only;
    });
    expect([star.getAttribute('aria-label'), star.getAttribute('aria-pressed')]).toEqual(['Add to favorites', 'false']);
    expect(isFilled(star)).toBe(false);
    // Beside the record's name: the chip row that holds the H1.
    const title = screen.getByRole('heading', { level: 1, name: 'Intro call' });
    expect(title.parentElement!.contains(star)).toBe(true);

    const items = await openOverflow();
    // CONTROL: the ⋯ is open and holds the system group.
    expect(items).toContain('Share');
    expect(items.filter((text) => /favorites$/.test(text))).toEqual([]);
  });

  it('one press makes the record a favorite and fills the star; a second press removes it', async () => {
    await mountRecordPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add to favorites' }));

    await waitFor(() => expect(stored()).toHaveLength(1));
    const [favorite] = stored();
    expect([favorite.id, favorite.type, favorite.href]).toEqual([
      `record:${OBJECT_NAME}:${RECORD_ID}`,
      'record',
      RECORD_PATH,
    ]);
    const filled = await screen.findByRole('button', { name: 'Remove from favorites' });
    expect(filled.getAttribute('aria-pressed')).toBe('true');
    expect(isFilled(filled)).toBe(true);
    expect(headerStars()).toHaveLength(1);

    fireEvent.click(filled);
    await waitFor(() => expect(stored()).toHaveLength(0));
    const hollow = await screen.findByRole('button', { name: 'Add to favorites' });
    expect(hollow.getAttribute('aria-pressed')).toBe('false');
    expect(isFilled(hollow)).toBe(false);
  });

  it('a record already a favorite (a reload) opens with the star filled', async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        {
          id: `record:${OBJECT_NAME}:${RECORD_ID}`,
          label: 'Intro call',
          href: RECORD_PATH,
          type: 'record',
          favoritedAt: new Date(0).toISOString(),
        },
      ]),
    );
    await mountRecordPage();
    const star = await screen.findByRole('button', { name: 'Remove from favorites' });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(isFilled(star)).toBe(true);
  });

  it('a drawer or pane (embedded) draws the same star, with the same state', async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        {
          id: `record:${OBJECT_NAME}:${RECORD_ID}`,
          label: 'Intro call',
          href: RECORD_PATH,
          type: 'record',
          favoritedAt: new Date(0).toISOString(),
        },
      ]),
    );
    await mountRecordPage({ embedded: true });
    const star = await waitFor(() => {
      const [only, ...rest] = headerStars();
      expect(rest).toHaveLength(0);
      expect(only).toBeTruthy();
      return only;
    });
    expect([star.getAttribute('aria-label'), star.getAttribute('aria-pressed')]).toEqual(['Remove from favorites', 'true']);
    const title = screen.getByRole('heading', { level: 1, name: 'Intro call' });
    expect(title.parentElement!.contains(star)).toBe(true);

    fireEvent.click(star);
    await waitFor(() => expect(stored()).toHaveLength(0));
    expect((await screen.findByRole('button', { name: 'Add to favorites' })).getAttribute('aria-pressed')).toBe('false');
    const items = await openOverflow();
    expect(items).toContain('Share');
    expect(items.filter((text) => /favorites$/.test(text))).toEqual([]);
  });

  it('a phone draws the star beside the name, and its bottom bar\'s ⋯ holds no favorites entry', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!this.hasAttribute('data-record-page-root')) return measure.call(this);
      return { x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 800, width: 390, height: 800, toJSON: () => ({}) } as DOMRect;
    });
    try {
      await mountRecordPage();
      // CONTROL: the phone face is drawn — its bottom bar holds the actions.
      await waitFor(() => expect(document.querySelector('[data-record-action-bar] [role="toolbar"]')).toBeTruthy());
      const star = await waitFor(() => {
        const [only, ...rest] = headerStars();
        expect(rest).toHaveLength(0);
        expect(only).toBeTruthy();
        return only;
      });
      const title = screen.getByRole('heading', { level: 1, name: 'Intro call' });
      expect(title.parentElement!.contains(star)).toBe(true);
      fireEvent.click(star);
      await waitFor(() => expect(stored()).toHaveLength(1));

      const items = await openOverflow();
      expect(items).toContain('Share');
      expect(items.filter((text) => /favorites$/.test(text))).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
    }
  });
});

/**
 * The overflow's Share inside the ObjectStack mobile shell, when it announces
 * `share` (objectstack-ai/mobile `docs/HYBRID-SHELL.md`, "Files"): the OS share
 * sheet through the shell, with the record's page link and its title. Only
 * that record URL crosses the bridge. The control cases (a plain browser, an
 * older shell without `share`, a shell refusing the call) keep today's
 * path: `navigator.share` when present, else the clipboard copy.
 */
describe('record page: Share through the mobile shell', () => {
  const GLOBAL = 'ObjectStackNative';

  function installShell(opts: { capabilities?: string[]; refuse?: boolean } = {}) {
    const capabilities = opts.capabilities ?? ['share', 'openFile'];
    const share = vi.fn(async (_content: { url?: string; text?: string }) => {
      if (opts.refuse) throw Object.assign(new Error('url must be http(s)'), { code: 'bad_args' });
      return null;
    });
    const host = {
      version: 1,
      platform: 'ios',
      appVersion: '2.2.0',
      capabilities,
      safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
      has: (c: string) => capabilities.includes(c),
      share,
      openFile: vi.fn(async () => null),
      openExternal: vi.fn(async () => null),
      ready: vi.fn(),
      routeChanged: vi.fn(),
    };
    (window as unknown as Record<string, unknown>)[GLOBAL] = host;
    return host;
  }

  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    document.title = 'Intro call · CRM';
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[GLOBAL];
  });

  async function chooseShare() {
    await mountRecordPage();
    await openOverflow();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }));
  }

  it('opens the shell share sheet with the record URL and title, and copies nothing', async () => {
    const host = installShell();
    await chooseShare();
    await waitFor(() => expect(host.share).toHaveBeenCalledTimes(1));
    // Exactly the record's page link and its title: nothing else crosses the bridge.
    expect(host.share).toHaveBeenCalledWith({ url: window.location.href, text: 'Intro call · CRM' });
    expect(host.openFile).not.toHaveBeenCalled();
    expect(host.openExternal).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('a shell refusing the call keeps the browser path', async () => {
    const host = installShell({ refuse: true });
    await chooseShare();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    expect(host.share).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: an older shell without share copies the link as today', async () => {
    const host = installShell({ capabilities: ['openFile'] });
    await chooseShare();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    expect(host.share).not.toHaveBeenCalled();
  });

  it('CONTROL: a plain browser copies the link as today', async () => {
    await chooseShare();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
  });
});
