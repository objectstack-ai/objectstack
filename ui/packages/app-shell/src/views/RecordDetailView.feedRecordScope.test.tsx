/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * RecordDetailView — the discussion feed belongs to ONE record (objectui#3268).
 *
 * `RecordDetailView` is not remounted when the user moves from record A to
 * record B: no mount site passes a `key=` (`console/AppContent.tsx`, and the
 * `ObjectView` / `ObjectDataPage` / `InterfaceListPage` drawers just swap
 * `recordIdOverride`) — deliberately, per #2269 "refresh data, don't rebuild
 * UI". The feed state therefore SURVIVES the navigation, and until this fix it
 * was a single flat `FeedItem[]` that both reads merged into by row id. A's
 * comments and activity stayed on B's discussion panel with B's own rows merged
 * in alongside; different ids, so the merge could not dedupe them away. That is
 * cross-record data display, not a cosmetic glitch.
 *
 * It also SUPPRESSED #3209's loading signal on exactly this path: `feedLoading`
 * does flip true when the key changes, but `RecordActivityTimeline`'s branch is
 * `loading && filtered.length === 0` (#3205 — a refresh must not turn an
 * on-screen feed into a spinner), and the leftover rows kept `filtered`
 * non-empty. So the user saw the PREVIOUS record's content where a loading
 * state belonged. Both are asserted here, on the rendered outcome.
 *
 * The subtle half is the rows the user just POSTED — a comment written on this
 * visit that the feed re-read has not returned yet. (Since objectui#10899 such
 * a row lands only once its write resolves; a failed write is never a row.) "Empty for a new record" must fall out
 * of reading the current record's slice, never from a clearing `setState` that
 * would race the post. The round-trip test at the bottom pins that: post on A,
 * go to B (it must not follow), come back to A (it must still be there, exactly
 * once even after the re-read returns the persisted copy).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
// The panel's own English fallbacks — the copy actually rendered when no
// I18nProvider is mounted. Selecting through them keeps this file pinned to
// the composer/empty-state semantics rather than to a literal string.
import { DETAIL_DEFAULT_TRANSLATIONS } from '@object-ui/plugin-detail';

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

// Orthogonal chrome — stubbed so the only asynchrony in this file is the feed.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const EMPTY_COMMENTS = DETAIL_DEFAULT_TRANSLATIONS['detail.noCommentsYet'];
const COMMENT_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.leaveCommentPlaceholder'];
const SUBMIT_COMMENT = DETAIL_DEFAULT_TRANSLATIONS['detail.submitComment'];
const OBJECT_NAME = 'crm_account';
const REC_A = 'rec-A';
const REC_B = 'rec-B';

/** The body text each record's seeded comment carries — deliberately names the
 *  record it belongs to, so a leak is legible in the failure message. */
const commentFor = (recordId: string) => `comment for ${OBJECT_NAME}:${recordId}`;
const activityFor = (recordId: string) => `activity for ${OBJECT_NAME}:${recordId}`;

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

/** A promise that never settles — "the fetch for this record is still in flight". */
const pending = () => new Promise(() => {});

interface Seed {
  /** Records whose feed reads never settle, i.e. still loading. */
  pendingRecords?: string[];
  /** recordId → seeded sys_comment rows (bodies only need `body` + `created_at`). */
  comments?: Record<string, Array<Record<string, any>>>;
  /** recordId → seeded sys_activity rows. */
  activities?: Record<string, Array<Record<string, any>>>;
}

/**
 * A per-record fake backend. `sys_comment` is filtered by `thread_id`
 * (`${objectName}:${recordId}`) and `sys_activity` by `record_id`, exactly as
 * the view queries them — so a read can only ever return the rows of the
 * record it asked about. Everything the view writes through `create` lands in
 * the same store, which is what lets the round-trip test observe a posted
 * comment coming BACK from the server on the return visit.
 */
function makeDataSource(seed: Seed = {}) {
  const commentsByThread = new Map<string, Array<Record<string, any>>>();
  for (const [recordId, rows] of Object.entries(seed.comments ?? {})) {
    commentsByThread.set(`${OBJECT_NAME}:${recordId}`, [...rows]);
  }
  const activitiesByRecord = new Map<string, Array<Record<string, any>>>();
  for (const [recordId, rows] of Object.entries(seed.activities ?? {})) {
    activitiesByRecord.set(recordId, [...rows]);
  }
  const isPending = (recordId: unknown) =>
    !!recordId && (seed.pendingRecords ?? []).includes(String(recordId));

  const find = vi.fn((objectName: string, query?: any) => {
    if (objectName === 'sys_comment') {
      const threadId = String(query?.$filter?.thread_id ?? '');
      const recordId = threadId.slice(threadId.indexOf(':') + 1);
      if (isPending(recordId)) return pending();
      return Promise.resolve({ data: commentsByThread.get(threadId) ?? [] });
    }
    if (objectName === 'sys_activity') {
      const recordId = query?.$filter?.record_id;
      if (isPending(recordId)) return pending();
      return Promise.resolve({ data: activitiesByRecord.get(String(recordId)) ?? [] });
    }
    // Mention directory, related lists… answer empty immediately.
    return Promise.resolve({ data: [] });
  });

  const create = vi.fn(async (objectName: string, row: any) => {
    if (objectName === 'sys_comment') {
      const list = commentsByThread.get(row.thread_id) ?? [];
      list.push(row);
      commentsByThread.set(row.thread_id, list);
    }
    return row;
  });

  return {
    find,
    create,
    findOne: vi.fn(async (_objectName: string, recordId: string) => ({
      id: recordId,
      name: `Record ${recordId}`,
    })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/**
 * An AUTHORED record page that composes the discussion node — the panel that
 * carries the comment composer (`showCommentInput` defaults true on the
 * renderer's own config). The optimistic round-trip test needs a real composer
 * to post through, rather than reaching for the callback prop.
 *
 * ⚠️ This used to be a page with NO discussion slot, driving the host's bottom
 * auto-append. objectui#7298 removed that append — a record page shows a panel
 * if and only if it composes one — so the composer now has to be authored, and
 * what this file pins (which record an optimistic comment belongs to) is
 * unchanged by where the panel came from.
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

/**
 * The tree, parameterised by record id ONLY. Element type and position are
 * identical across calls, so `rerender` reconciles onto the SAME
 * `RecordDetailView` instance — i.e. it reproduces the real navigation, where
 * nothing remounts and the feed state survives. Re-rendering a fresh `render()`
 * instead would remount and hide the bug entirely.
 */
function tree(dataSource: any, recordId: string, pages: any[] = []) {
  return (
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${recordId}`]}>
      <MetadataCtx.Provider value={makeMetadata(pages)}>
        <RecordDetailView
          dataSource={dataSource}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={recordId}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  cleanup();
  // Unrelated chrome (approvals, favourites…) reaches for the platform API; in
  // jsdom that is a real socket. Answer it locally.
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

describe('RecordDetailView — the feed does not follow the user to the next record (#3268)', () => {
  it('drops record A’s comment when the view navigates to record B', async () => {
    // The defect, verbatim from the issue: A’s comment stayed on B’s panel.
    const dataSource = makeDataSource({
      comments: {
        [REC_A]: [{ id: 'c-a', author_name: 'Grace', body: commentFor(REC_A), created_at: '2026-01-02T00:00:00.000Z' }],
        [REC_B]: [{ id: 'c-b', author_name: 'Grace', body: commentFor(REC_B), created_at: '2026-01-03T00:00:00.000Z' }],
      },
    });

    const { rerender } = render(tree(dataSource, REC_A));
    expect(await screen.findByText(commentFor(REC_A))).toBeTruthy();

    rerender(tree(dataSource, REC_B));

    expect(await screen.findByText(commentFor(REC_B))).toBeTruthy();
    expect(screen.queryByText(commentFor(REC_A))).toBeNull();
  });

  it('drops record A’s ACTIVITY rows too, not just its comments', async () => {
    // The two reads merge into the feed independently; scoping one and not the
    // other would still leak half the previous record onto the panel.
    const dataSource = makeDataSource({
      activities: {
        [REC_A]: [{ id: 'a-a', type: 'updated', actor_name: 'Grace', summary: activityFor(REC_A), timestamp: '2026-01-02T00:00:00.000Z' }],
        [REC_B]: [{ id: 'a-b', type: 'updated', actor_name: 'Grace', summary: activityFor(REC_B), timestamp: '2026-01-03T00:00:00.000Z' }],
      },
    });

    const { rerender } = render(tree(dataSource, REC_A));
    expect(await screen.findByText(activityFor(REC_A))).toBeTruthy();

    rerender(tree(dataSource, REC_B));

    expect(await screen.findByText(activityFor(REC_B))).toBeTruthy();
    expect(screen.queryByText(activityFor(REC_A))).toBeNull();
  });

  it('shows the LOADING state on record→record navigation, not the previous record (#3209 reaches this path)', async () => {
    // #3209 made `feedLoading` flip true here already, but the timeline’s
    // branch is `loading && filtered.length === 0` (#3205, deliberate), so the
    // leftover rows kept `filtered` non-empty and the spinner never rendered —
    // the user was shown A’s content while B was being fetched. This is the
    // assertion that the two fixes only add up together.
    const dataSource = makeDataSource({
      comments: {
        [REC_A]: [{ id: 'c-a', author_name: 'Grace', body: commentFor(REC_A), created_at: '2026-01-02T00:00:00.000Z' }],
      },
      pendingRecords: [REC_B],
    });

    const { rerender } = render(tree(dataSource, REC_A));
    expect(await screen.findByText(commentFor(REC_A))).toBeTruthy();
    expect(screen.queryByTestId('activity-loading')).toBeNull();

    rerender(tree(dataSource, REC_B));

    expect(await screen.findByTestId('activity-loading')).toBeTruthy();
    expect(screen.queryByText(commentFor(REC_A))).toBeNull();
    // …and it is not claiming B has no comments while it is still asking.
    expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
  });

  it('settles record B onto its own empty state when B genuinely has no feed', async () => {
    // The other half of "empty for a new record": it must be reached by
    // READING B’s (absent) slice, and it must still settle — not spin forever.
    const dataSource = makeDataSource({
      comments: {
        [REC_A]: [{ id: 'c-a', author_name: 'Grace', body: commentFor(REC_A), created_at: '2026-01-02T00:00:00.000Z' }],
      },
    });

    const { rerender } = render(tree(dataSource, REC_A));
    expect(await screen.findByText(commentFor(REC_A))).toBeTruthy();

    rerender(tree(dataSource, REC_B));

    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByText(commentFor(REC_A))).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('activity-loading')).toBeNull());
  });

  it('does not let a SLOW response for the record just left overwrite the record now on screen', async () => {
    // The response is written under the key its effect closed over, so a read
    // for A that lands after the user moved to B updates A’s slice — never
    // the panel showing B. Same guarantee `settledFeedKey` gives the loading
    // flag; one idiom, not two.
    let releaseA: (value: any) => void = () => {};
    const slowA = new Promise((resolve) => { releaseA = resolve; });
    const base = makeDataSource({
      comments: {
        [REC_B]: [{ id: 'c-b', author_name: 'Grace', body: commentFor(REC_B), created_at: '2026-01-03T00:00:00.000Z' }],
      },
    });
    const inner = base.find;
    base.find = vi.fn((objectName: string, query?: any) => {
      if (objectName === 'sys_comment' && String(query?.$filter?.thread_id ?? '').endsWith(REC_A)) {
        return slowA;
      }
      return inner(objectName, query);
    });

    const { rerender } = render(tree(base, REC_A));
    await screen.findByTestId('activity-loading');

    rerender(tree(base, REC_B));
    expect(await screen.findByText(commentFor(REC_B))).toBeTruthy();

    // A finally answers — long after the user left it.
    releaseA({
      data: [{ id: 'c-a', author_name: 'Grace', body: commentFor(REC_A), created_at: '2026-01-02T00:00:00.000Z' }],
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText(commentFor(REC_A))).toBeNull();
    expect(screen.getByText(commentFor(REC_B))).toBeTruthy();
  });
});

describe('RecordDetailView — optimistic comments ride with their own record (#3268)', () => {
  /** Post a comment through the real composer on the authored panel. */
  async function postComment(text: string) {
    const box = await screen.findByPlaceholderText(COMMENT_PLACEHOLDER);
    fireEvent.change(box, { target: { value: text } });
    fireEvent.click(screen.getByTitle(SUBMIT_COMMENT));
  }

  it('keeps a just-posted comment on its own record across a navigation round-trip', async () => {
    // The one genuinely subtle requirement: "empty for a new record" must be a
    // consequence of reading the current record’s slice, so a comment that has
    // been posted but not yet come back from the server cannot be collateral.
    const dataSource = makeDataSource({});

    const { rerender } = render(tree(dataSource, REC_A, [AUTHORED_PAGE_WITH_DISCUSSION]));
    await screen.findByText(EMPTY_COMMENTS);

    await postComment('optimistic on A');
    expect(await screen.findByText('optimistic on A')).toBeTruthy();

    // …it must not follow the user to B…
    rerender(tree(dataSource, REC_B, [AUTHORED_PAGE_WITH_DISCUSSION]));
    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByText('optimistic on A')).toBeNull();

    // …and it must still be on A when the user comes back, exactly once: the
    // re-read now returns the persisted copy under the SAME id the optimistic
    // row was created with, so the union-by-id merge folds them together.
    rerender(tree(dataSource, REC_A, [AUTHORED_PAGE_WITH_DISCUSSION]));
    await waitFor(() => expect(screen.getAllByText('optimistic on A')).toHaveLength(1));
  });

  it('never files a comment whose write did not land — on this record or any other', async () => {
    // Same round-trip with a `create` that rejects (offline, 403, 404 on a
    // tenant with no `sys_comment`…). This case used to pin the OPPOSITE: the
    // view swallowed the failure and kept the local row as if it had been
    // posted, which is the "shown as sent, gone after reload" defect the
    // maintainer ruled out on cloud#2431 (objectui#10899). The failed comment
    // is never on the panel; the composer keeps it as a draft instead
    // (`RecordDetailView.commentWriteFailure-10899.test.tsx` pins that half).
    const dataSource = makeDataSource({});
    dataSource.create = vi.fn(async () => { throw new Error('503 offline'); });

    const { rerender } = render(tree(dataSource, REC_A, [AUTHORED_PAGE_WITH_DISCUSSION]));
    await screen.findByText(EMPTY_COMMENTS);

    await postComment('never persisted');
    await waitFor(() => expect(dataSource.create).toHaveBeenCalled());
    expect(screen.getByText(EMPTY_COMMENTS)).toBeTruthy();

    rerender(tree(dataSource, REC_B, [AUTHORED_PAGE_WITH_DISCUSSION]));
    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();

    rerender(tree(dataSource, REC_A, [AUTHORED_PAGE_WITH_DISCUSSION]));
    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    // Only the composer's draft may still carry the text — never a feed row.
    expect(screen.queryByText('never persisted', { selector: ':not(textarea)' })).toBeNull();
  });

  it('files the optimistic comment under the record it was written on, not the one visited next', async () => {
    // Posting on A then on B must give each panel exactly its own row.
    const dataSource = makeDataSource({});

    const { rerender } = render(tree(dataSource, REC_A, [AUTHORED_PAGE_WITH_DISCUSSION]));
    await screen.findByText(EMPTY_COMMENTS);
    await postComment('written on A');
    await screen.findByText('written on A');

    rerender(tree(dataSource, REC_B, [AUTHORED_PAGE_WITH_DISCUSSION]));
    await screen.findByText(EMPTY_COMMENTS);
    await postComment('written on B');
    await screen.findByText('written on B');

    expect(screen.queryByText('written on A')).toBeNull();
    expect(dataSource.create).toHaveBeenCalledWith(
      'sys_comment',
      expect.objectContaining({ thread_id: `${OBJECT_NAME}:${REC_B}`, body: 'written on B' }),
    );

    rerender(tree(dataSource, REC_A, [AUTHORED_PAGE_WITH_DISCUSSION]));
    await waitFor(() => expect(screen.getAllByText('written on A')).toHaveLength(1));
    expect(screen.queryByText('written on B')).toBeNull();
  });
});
