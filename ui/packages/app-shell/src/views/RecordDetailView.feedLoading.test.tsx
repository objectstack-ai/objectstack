/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * RecordDetailView — the discussion feed's LOADING SIGNAL (objectui#3209).
 *
 * This view owns the two `find`s (`sys_comment` + `sys_activity`) that fill
 * the discussion feed, so it is the only place that can tell the panel
 * "still fetching". Until #3209 it never did: `feedItems` started `[]` and
 * both fetches filled it asynchronously with no loading state anywhere, so
 * `DiscussionContextProvider` and the panel it feeds both went out without
 * `loading`. The user-visible result was the panel
 * asserting "No comments yet" — a factual claim about the record — for the
 * whole first leg of every record page, then contradicting itself when the
 * rows arrived.
 *
 * #3205 fixed the RENDER BRANCH (the timeline reads `loading` at all); this
 * file pins the SIGNAL that reaches it. Both are needed, so the assertions
 * are on the rendered outcome — the loading row vs. the empty copy — never
 * on "a prop was passed".
 *
 * TWO composition routes reach a user, and this file exercises both:
 *   • the SYNTHESIZED page (no authored record page) composes a
 *     `record:discussion` node itself, so the panel arrives through
 *     `DiscussionContextProvider` → `record:chatter` renderer;
 *   • an AUTHORED page that composes the node explicitly — the same renderer,
 *     reached through the author's own tree and its `page:header` sibling.
 *
 * ⚠️ This file used to drive the second route through the host's bottom
 * AUTO-APPEND, on an authored page that omitted the node. objectui#7298 (the
 * maintainer ruling of 2026-09-12) removed that append: a record page shows a
 * discussion panel if and only if it composes one, so an authored page without
 * the node now has no panel and no loading signal to pin. The route that
 * survives is the authored NODE, which is what the fixture below declares.
 *
 * The three cases that matter, and why:
 *   1. during the fetch → loading row, no empty copy;
 *   2. after BOTH parallel reads settle with nothing → empty copy, no
 *      spinner (one settled read is not an answer);
 *   3. after a read REJECTS → still the empty copy. A rejected fetch is an
 *      answer too; the alternative is a panel that spins forever, which is
 *      strictly worse than the bug being fixed.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
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

// The dialogs / flow runner are orthogonal chrome; stubbing them keeps this
// file about the feed signal (same posture as useConsoleActionRuntime.test).
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const EMPTY_COMMENTS = 'No comments yet';
const OBJECT_NAME = 'crm_account';
const RECORD_ID = 'rec-alpha';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Account',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

/** A promise that never settles — "the fetch is still in flight". */
const pending = () => new Promise(() => {});

interface FeedResponses {
  sys_comment: () => Promise<any>;
  sys_activity: () => Promise<any>;
}

function makeDataSource(feed: FeedResponses) {
  const find = vi.fn((objectName: string) => {
    if (objectName === 'sys_comment') return feed.sys_comment();
    if (objectName === 'sys_activity') return feed.sys_activity();
    // Everything else this view probes (mention directory, related lists…)
    // answers empty immediately so only the feed reads are in flight.
    return Promise.resolve({ data: [] });
  });
  return {
    find,
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Alpha' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/**
 * An AUTHORED record page that composes the discussion node explicitly — the
 * second of the two routes, and since objectui#7298 the only way a panel
 * reaches an authored page at all.
 */
const AUTHORED_PAGE_WITH_DISCUSSION = {
  name: 'account_record_page',
  type: 'record',
  object: OBJECT_NAME,
  regions: [
    {
      name: 'main',
      components: [{ type: 'page:header', title: 'Account' }, { type: 'record:discussion' }],
    },
  ],
};

function makeMetadata(pages: any[]) {
  return {
    objects: OBJECTS,
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'page' ? pages : []),
  } as any;
}

function renderDetail(dataSource: any, pages: any[] = []) {
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={makeMetadata(pages)}>
        <RecordDetailView
          dataSource={dataSource}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  // Unrelated chrome on this view (approvals, favourites, …) reaches for the
  // platform API. In jsdom that is a real socket to :3000 — noisy, slow and
  // machine-dependent. Answering it locally keeps the only asynchrony in this
  // file the two feed reads under test.
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

describe('RecordDetailView — the feed fetch produces a loading signal (#3209)', () => {
  it('renders the discussion through the context path when the page is synthesized', async () => {
    // Pins WHICH route the cases below exercise: with no authored page the
    // synthesizer composes `record:discussion` itself, so the panel arrives
    // through DiscussionContext. If this ever flips, the AUTHORED-node case
    // (further down) would be the one under test twice and the synthesized
    // route would go uncovered without any test turning red.
    const dataSource = makeDataSource({ sys_comment: pending, sys_activity: pending });

    renderDetail(dataSource);

    await screen.findByTestId('activity-loading');
    expect(screen.getAllByTestId('activity-loading')).toHaveLength(1);
  });

  it('shows the loading row instead of "No comments yet" while both feed reads are in flight', async () => {
    const dataSource = makeDataSource({
      sys_comment: pending,
      sys_activity: pending,
    });

    renderDetail(dataSource);

    // The panel is on screen and the feed reads have started…
    const loadingRow = await screen.findByTestId('activity-loading');
    expect(loadingRow).toBeTruthy();
    expect(dataSource.find).toHaveBeenCalledWith('sys_comment', expect.anything());
    expect(dataSource.find).toHaveBeenCalledWith('sys_activity', expect.anything());
    // …and the record is NOT being told it has no comments while we are
    // still asking whether it does.
    expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
  });

  it('keeps the loading row while only ONE of the two parallel reads has settled', async () => {
    // The two reads are independent promises. "Comments answered" is not
    // "the feed answered" — leaving the loading state on the first settle
    // would flash the empty copy right before the activity rows land.
    const dataSource = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: pending,
    });

    renderDetail(dataSource);

    await screen.findByTestId('activity-loading');
    // Give the settled read several microtask/macrotask turns to (wrongly)
    // clear the flag before asserting it is still set.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('activity-loading')).toBeTruthy();
    expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
  });

  it('settles onto the empty copy once BOTH reads answer with nothing', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.resolve({ data: [] }),
    });

    renderDetail(dataSource);

    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });

  it('renders the fetched comment once it lands, with no loading row left behind', async () => {
    const dataSource = makeDataSource({
      sys_comment: () =>
        Promise.resolve({
          data: [
            {
              id: 'c-1',
              author_name: 'Grace',
              body: 'First comment on the record',
              created_at: '2026-01-02T00:00:00.000Z',
            },
          ],
        }),
      sys_activity: () => Promise.resolve({ data: [] }),
    });

    renderDetail(dataSource);

    expect(await screen.findByText('First comment on the record')).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
    expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
  });

  // ── A rejected read is an ANSWER, not a permanent spinner ───────────────
  it('leaves the loading state when a feed read REJECTS (both rejecting)', async () => {
    // `sys_activity` 404s on any deployment without the audit plugin, and the
    // view has always swallowed that with `.catch(() => {})`. The loading flag
    // must be closed over the SETTLED set, not the fulfilled set — otherwise
    // this fix would trade "wrongly says empty" for "spins forever", which is
    // the worse bug.
    const dataSource = makeDataSource({
      sys_comment: () => Promise.reject(new Error('403 FEEDS_DISABLED')),
      sys_activity: () => Promise.reject(new Error('404 sys_activity')),
    });

    renderDetail(dataSource);

    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });

  it('leaves the loading state when only one read rejects and the other resolves empty', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.reject(new Error('404 sys_activity')),
    });

    renderDetail(dataSource);

    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });

  it('still renders the comments that DID arrive when the other read rejects', async () => {
    const dataSource = makeDataSource({
      sys_comment: () =>
        Promise.resolve({
          data: [
            {
              id: 'c-1',
              author_name: 'Grace',
              body: 'Survived the failed activity read',
              created_at: '2026-01-02T00:00:00.000Z',
            },
          ],
        }),
      sys_activity: () => Promise.reject(new Error('404 sys_activity')),
    });

    renderDetail(dataSource);

    expect(await screen.findByText('Survived the failed activity read')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('activity-loading')).toBeNull());
  });
});

describe('RecordDetailView — an AUTHORED discussion node is on the same chain (#3209)', () => {
  // The author's own `record:discussion` reaches the same renderer through the
  // author's tree rather than the synthesizer's. Both routes read `loading` off
  // the one `DiscussionContextProvider`, and this half is what would leave an
  // authored record page showing "No comments yet" mid-fetch while the
  // synthesized path stayed green.
  it('shows the loading row on an authored page that composes the discussion node', async () => {
    const dataSource = makeDataSource({ sys_comment: pending, sys_activity: pending });

    renderDetail(dataSource, [AUTHORED_PAGE_WITH_DISCUSSION]);

    expect(await screen.findByTestId('activity-loading')).toBeTruthy();
    expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
  });

  it('settles onto the empty copy once both reads answer', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.resolve({ data: [] }),
    });

    renderDetail(dataSource, [AUTHORED_PAGE_WITH_DISCUSSION]);

    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });

  it('leaves the loading state when both reads reject', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.reject(new Error('403 FEEDS_DISABLED')),
      sys_activity: () => Promise.reject(new Error('404 sys_activity')),
    });

    renderDetail(dataSource, [AUTHORED_PAGE_WITH_DISCUSSION]);

    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
  });
});
