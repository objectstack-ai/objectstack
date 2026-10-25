/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * BOTH composition routes to the chatter panel render the SAME feed
 * (objectui#8983, re-aimed by objectui#7298)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A record page shows its discussion because the page composes a
 * `record:discussion` / `record:chatter` node, and there are two ways that node
 * gets into the tree:
 *
 *   SYNTHESIZED BLOCK   no authored record page ⇒ `buildDefaultPageSchema`
 *                       composes `record:discussion` itself.
 *   AUTHORED BLOCK      an authored page places the node in its own region,
 *                       beside whatever else it composes.
 *
 * Both resolve through `ComponentRegistry` to ONE `RecordChatterRenderer`, so
 * both must render one feed. objectui#8934 taught that renderer to run
 * `applyFeedConfig`, making the protocol's `feed` members and its DEFAULTS live
 * — and this file is what turns red if a future edit gives either route its own
 * items/config path instead.
 *
 * ⚠️ WHAT CHANGED UNDER THIS FILE. The second surface used to be the HOST
 * FALLBACK: an authored page that omitted the block got a panel auto-appended
 * by `RecordDetailView`, and for one round that fallback handed its rows to
 * `RecordChatterPanel` raw while the block ran the pipeline — a completed
 * activity showed on one and not the other, and a feed past twenty rows
 * rendered whole on one and paged on the other. objectui#8983 closed that by
 * BINDING rather than copying (the fallback started mounting the renderer with
 * no schema). objectui#7298 then retired the fallback outright — the maintainer
 * ruling of 2026-09-12: a page shows a discussion panel if and only if it
 * composes one. So the divergence this file was written about can no longer
 * arise from THAT pair; the pair it guards now is the two ways the node is
 * composed, and the pre-fix control below still measures what an UNBOUND
 * surface would have rendered.
 *
 * ## What makes the equality below a reading rather than a tautology
 *
 * "The two surfaces agree" is satisfied by a harness in which they could never
 * have disagreed — and it was satisfied by this repository's tree before
 * objectui#8934 too, when neither surface ran the pipeline. Three legs answer
 * that, and all three have to hold together:
 *
 *   PRE-FIX CONTROL   `PreFixFallbackShape` below is the retired host
 *                     fallback's JSX as it was written before objectui#8983 —
 *                     the same panel, the same hard-coded three affordances,
 *                     raw `items`. It is rendered on the SAME feed and asserted
 *                     to produce a DIFFERENT row set. So the fixture provably
 *                     discriminates: a surface that stops running the pipeline
 *                     fails the equality.
 *   AGREEMENT FIXTURE the shared row set is asserted by VALUE, and the value is
 *                     the pipeline's answer (completed row hidden, a 20-row
 *                     page window) rather than the raw feed. Both surfaces
 *                     rendering nothing, or both rendering everything, is red.
 *   NEUTRAL FIXTURE   the card's own control row — three comments and no
 *                     completed activity — on which all THREE shapes agree.
 *                     Without it, the two cases above could be reporting a
 *                     harness that can only ever produce disagreement.
 *
 * ⚠️ `Load more` is asserted as a COUNT and then clicked. `hasMore` without
 * `onLoadMore` renders a button that does nothing, which reads as "paging
 * works" to every assertion that only counts it.
 *
 * ## Resolution
 *
 * Nothing here resolves through any `dist/`: `./RecordDetailView` is this
 * package's own source and `@object-ui/plugin-detail` is mapped to its `src` by
 * the root `vitest.config.mts` alias table.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { RecordChatterPanel, activityRowToFeedItem } from '@object-ui/plugin-detail';
import type { FeedItem } from '@object-ui/types';

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

// Orthogonal chrome — same posture as `RecordDetailView.feedLoading.test.tsx`,
// so the only asynchrony in this file is the two feed reads.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'crm_account';
const RECORD_ID = 'rec-alpha';
const LOAD_MORE = 'Load more';
/** The completed activity's summary — the row `showCompleted: false` hides. */
const TASK_MARKER = 'Completed task row';

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

/**
 * An AUTHORED record page that composes the discussion node itself — the second
 * of the two routes. Since objectui#7298 an authored page that OMITS the node
 * renders no panel at all, which is pinned in
 * `RecordDetailView.discussionExplicitComposition-7298`.
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

/** Zero-padded so no marker is a substring of another (`Comment 1` vs `10`). */
const commentMarker = (n: number) => `Comment ${String(n).padStart(2, '0')}`;

interface Fixture {
  /** How many `sys_comment` rows the record has, oldest first. */
  comments: number;
  /** Whether a COMPLETED `sys_activity` row rides along, newest of all. */
  withCompletedActivity: boolean;
}

function commentRows(fixture: Fixture) {
  return Array.from({ length: fixture.comments }, (_, i) => ({
    id: `c-${i + 1}`,
    thread_id: `${OBJECT_NAME}:${RECORD_ID}`,
    author_name: 'Ada',
    body: commentMarker(i + 1),
    created_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));
}

function activityRows(fixture: Fixture) {
  if (!fixture.withCompletedActivity) return [];
  return [
    {
      id: 'a-1',
      // `completed` is the only `sys_activity.type` that maps to feed type
      // `task`, which is the type `showCompleted` (spec default false) hides.
      type: 'completed',
      summary: TASK_MARKER,
      actor_name: 'Ada',
      timestamp: '2026-02-01T00:00:00.000Z',
    },
  ];
}

/**
 * The feed as `RecordDetailView` builds it, derived from the SAME source rows
 * the data source below answers with — the activity row through the exported
 * `activityRowToFeedItem`, which is the reading the view itself uses.
 *
 * This is what the pre-fix fallback was handed. Deriving it rather than writing
 * a second literal is what keeps the control an honest transcription: if the
 * view's construction changes, this moves with it.
 */
function feedAsTheViewBuildsIt(fixture: Fixture): FeedItem[] {
  const comments: FeedItem[] = commentRows(fixture).map((c) => ({
    id: c.id,
    type: 'comment' as const,
    actor: c.author_name,
    body: c.body,
    createdAt: c.created_at,
  }));
  const activities = activityRows(fixture)
    .map((row) => activityRowToFeedItem(row, 'System'))
    .filter((i): i is FeedItem => Boolean(i));
  return [...comments, ...activities];
}

function makeDataSource(fixture: Fixture) {
  const find = vi.fn((objectName: string) => {
    if (objectName === 'sys_comment') return Promise.resolve({ data: commentRows(fixture) });
    if (objectName === 'sys_activity') return Promise.resolve({ data: activityRows(fixture) });
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

function renderDetail(fixture: Fixture, pages: any[]) {
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={makeMetadata(pages)}>
        <RecordDetailView
          dataSource={makeDataSource(fixture)}
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

/**
 * The retired host fallback's JSX EXACTLY as it was written before
 * objectui#8983 — `RecordChatterPanel` mounted directly, the three affordances
 * hard-coded, raw `items`, no `hasMore` / `onLoadMore`.
 *
 * ⛔ Not production code, and since objectui#7298 not any code: it is the
 * control that makes the equality assertions readings. Every case that asserts
 * the two routes agree also asserts that THIS shape does not, on the same feed
 * — so a route that stopped running the pipeline could not pass by rendering
 * whatever the other one happens to render.
 */
const PreFixFallbackShape: React.FC<{ items: FeedItem[] }> = ({ items }) => (
  <div className="mt-6">
    <RecordChatterPanel
      config={{
        position: 'bottom',
        collapsible: false,
        feed: {
          enableReactions: true,
          enableThreading: true,
          showCommentInput: true,
        },
      }}
      items={items}
    />
  </div>
);

/** Which fixture rows are on screen right now, in fixture order. */
function renderedRows(fixture: Fixture): string[] {
  const markers = [
    ...Array.from({ length: fixture.comments }, (_, i) => commentMarker(i + 1)),
    ...(fixture.withCompletedActivity ? [TASK_MARKER] : []),
  ];
  return markers.filter((m) => screen.queryAllByText(m).length > 0);
}

const loadMoreCount = () => screen.queryAllByRole('button', { name: LOAD_MORE }).length;

/** Wait until BOTH feed reads have settled, so an absent row is an answer. */
async function settled() {
  await waitFor(() => expect(screen.queryByTestId('activity-loading')).toBeNull());
}

/** Drive one surface of `RecordDetailView` and read back what it rendered. */
async function readSurface(fixture: Fixture, pages: any[]) {
  renderDetail(fixture, pages);
  await settled();
  await waitFor(() => expect(renderedRows(fixture).length).toBeGreaterThan(0));
  return { rows: renderedRows(fixture), loadMore: loadMoreCount() };
}

const viaAuthoredBlock = (fixture: Fixture) => readSurface(fixture, [AUTHORED_PAGE_WITH_DISCUSSION]);
/** No authored page ⇒ the synthesized default, which composes the block. */
const viaSynthesizedBlock = (fixture: Fixture) => readSurface(fixture, []);

function readPreFixShape(fixture: Fixture) {
  render(<PreFixFallbackShape items={feedAsTheViewBuildsIt(fixture)} />);
  return { rows: renderedRows(fixture), loadMore: loadMoreCount() };
}

beforeEach(() => {
  cleanup();
  // Unrelated chrome on this view reaches for the platform API; in jsdom that
  // is a real socket. Answer it locally so the feed reads are the only
  // asynchrony under test.
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

describe('both composition routes render the same feed (objectui#8983)', () => {
  it('a COMPLETED activity is hidden on both — and the pre-fix fallback shape shows it', async () => {
    // The card's first probe row. `showCompleted` defaults false in the spec,
    // so the pipeline drops the `task`; an unbound surface renders it.
    const fixture: Fixture = { comments: 3, withCompletedActivity: true };
    const expected = ['Comment 01', 'Comment 02', 'Comment 03'];

    const authored = await viaAuthoredBlock(fixture);
    expect(authored.rows).toEqual(expected);

    cleanup();
    const synthesized = await viaSynthesizedBlock(fixture);
    expect(synthesized.rows).toEqual(expected);
    expect(authored.rows).toEqual(synthesized.rows);

    // PRE-FIX CONTROL — the same feed, the shape the retired fallback had.
    cleanup();
    const preFix = readPreFixShape(fixture);
    expect(preFix.rows).toEqual([...expected, TASK_MARKER]);
    expect(preFix.rows).not.toEqual(authored.rows);
  });

  it('a feed past the page window pages on both — and the pre-fix fallback shape renders it whole', async () => {
    // The card's second probe row. An unauthored `limit` is
    // `DEFAULT_ACTIVITY_LIMIT` (20) and it is a PAGE SIZE, so twenty-five rows
    // render as the newest twenty plus one "Load more".
    const fixture: Fixture = { comments: 25, withCompletedActivity: false };
    const expected = Array.from({ length: 20 }, (_, i) => commentMarker(i + 6));

    const authored = await viaAuthoredBlock(fixture);
    expect(authored.rows).toEqual(expected);
    expect(authored.loadMore).toBe(1);

    cleanup();
    const synthesized = await viaSynthesizedBlock(fixture);
    expect(synthesized.rows).toEqual(expected);
    expect(synthesized.loadMore).toBe(1);
    expect(authored.rows).toEqual(synthesized.rows);

    // PRE-FIX CONTROL — no pipeline, so no window and no paging affordance.
    cleanup();
    const preFix = readPreFixShape(fixture);
    expect(preFix.rows).toHaveLength(25);
    expect(preFix.loadMore).toBe(0);
    expect(preFix.rows).not.toEqual(authored.rows);
  });

  it('NEUTRAL FIXTURE — on a feed with nothing to filter, all three shapes agree', async () => {
    // The card's own CONTROL row, and the leg that keeps the two cases above
    // from being a harness in which agreement was impossible: three comments,
    // no completed activity, under the page window. The pipeline changes
    // nothing here, so binding it changes nothing here either.
    const fixture: Fixture = { comments: 3, withCompletedActivity: false };
    const expected = ['Comment 01', 'Comment 02', 'Comment 03'];

    const authored = await viaAuthoredBlock(fixture);
    expect(authored.rows).toEqual(expected);
    expect(authored.loadMore).toBe(0);

    cleanup();
    const synthesized = await viaSynthesizedBlock(fixture);
    expect(synthesized.rows).toEqual(expected);

    cleanup();
    const preFix = readPreFixShape(fixture);
    expect(preFix.rows).toEqual(expected);
    expect(preFix.loadMore).toBe(0);
  });
});

describe('the authored block got the paging PAIR, not just the affordance (objectui#8983)', () => {
  it('"Load more" on an authored `record:discussion` grows the window by one page', async () => {
    // `hasMore` without `onLoadMore` renders a button that does nothing — which
    // satisfies every assertion that only counts buttons. Clicking it is what
    // separates "the page window is wired" from "a dead affordance rendered".
    const fixture: Fixture = { comments: 25, withCompletedActivity: false };

    renderDetail(fixture, [AUTHORED_PAGE_WITH_DISCUSSION]);
    await settled();
    await waitFor(() => expect(renderedRows(fixture).length).toBe(20));

    fireEvent.click(screen.getByRole('button', { name: LOAD_MORE }));

    // One more page of 20 covers the remaining five, so the whole feed is on
    // screen and the affordance retires.
    await waitFor(() => expect(renderedRows(fixture).length).toBe(25));
    expect(loadMoreCount()).toBe(0);
  });
});
