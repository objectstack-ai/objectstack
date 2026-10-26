/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * RecordDetailView: a REFUSED feed read is not an empty feed (objectui#11195).
 *
 * The record page owns the two reads behind its discussion panel,
 * `sys_activity` and `sys_comment`. Each used to end in `.catch(() => {})`, so
 * a 403 settled exactly like a 200 with zero rows: an invited member of a
 * hosted AI-built app opened a record, the server refused the activity read,
 * and the panel said "No comments yet" with nothing to tell a permission wall
 * from an empty record (objectstack-ai/cloud#2485).
 *
 * What is pinned, each on the rendered panel:
 *   1. a refused `sys_activity` read (403 envelope, and 401) shows the
 *      no-permission state, and the read is not retried;
 *   2. the control: a 200 with zero rows shows the empty state, unchanged;
 *   3. a 404 is not a refusal, so the empty state stays;
 *   4. a 500 is not a refusal either, so the panel never says "no permission"
 *      for it;
 *   5. a refused `sys_comment` read beside an answered `sys_activity` read
 *      keeps the activity rows and says the comments are withheld.
 *
 * The harness is `RecordDetailView.feedLoading.test.tsx`'s: the synthesized
 * record page composes `record:discussion`, so the panel arrives through the
 * host's `DiscussionContextProvider` and the `record:chatter` renderer.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
const ACTIVITY_DENIED = "You don't have permission to view activity on this record.";
const COMMENTS_DENIED = "You don't have permission to view comments on this record.";
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

/**
 * A rejected read in the shape the ObjectStack client throws it: the HTTP
 * status on `httpStatus` and the ADR-0112 code on `code`.
 */
const rejection = (httpStatus: number, code: string) =>
  Object.assign(new Error(`${httpStatus} ${code}`), { httpStatus, code });

interface FeedResponses {
  sys_comment: () => Promise<any>;
  sys_activity: () => Promise<any>;
}

function makeDataSource(feed: FeedResponses) {
  const find = vi.fn((objectName: string) => {
    if (objectName === 'sys_comment') return feed.sys_comment();
    if (objectName === 'sys_activity') return feed.sys_activity();
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

function makeMetadata() {
  return {
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
}

function renderDetail(dataSource: any) {
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={makeMetadata()}>
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

const readsOf = (dataSource: any, objectName: string) =>
  dataSource.find.mock.calls.filter((call: unknown[]) => call[0] === objectName).length;

/** Let every settled read's follow-up render land before counting reads. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  cleanup();
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

describe('RecordDetailView: a refused sys_activity read shows the no-permission state (objectui#11195)', () => {
  it('a 403 PERMISSION_DENIED envelope shows the no-permission state, not the empty state', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.reject(rejection(403, 'PERMISSION_DENIED')),
    });

    renderDetail(dataSource);

    const notice = await screen.findByTestId('activity-access-denied');
    expect(notice.textContent).toContain(ACTIVITY_DENIED);
    expect(notice.querySelector('[data-denied-source="activity"]')).not.toBeNull();
    expect(notice.querySelector('[data-denied-source="comments"]')).toBeNull();
    // Visually distinct from the empty state, which is not rendered at all.
    expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
    expect(screen.queryByTestId('activity-loading')).toBeNull();
    // The message never names the object's internal name, or the table.
    expect(notice.textContent).not.toContain(OBJECT_NAME);
    expect(notice.textContent).not.toContain('sys_activity');
  });

  it('does not retry a refused read', async () => {
    // The baseline is the SAME page answered with zero rows: the refusal may
    // issue the read no more often than an answered read is issued.
    const answered = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.resolve({ data: [] }),
    });
    renderDetail(answered);
    await screen.findByText(EMPTY_COMMENTS);
    await settle();
    const answeredReads = readsOf(answered, 'sys_activity');
    expect(answeredReads).toBeGreaterThan(0);
    cleanup();

    const refused = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.reject(rejection(403, 'PERMISSION_DENIED')),
    });
    renderDetail(refused);
    await screen.findByTestId('activity-access-denied');
    await settle();

    expect(readsOf(refused, 'sys_activity')).toBe(answeredReads);
  });

  it('a 401 is a refused read too', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.reject(rejection(401, 'UNAUTHORIZED')),
    });

    renderDetail(dataSource);

    const notice = await screen.findByTestId('activity-access-denied');
    expect(notice.textContent).toContain(ACTIVITY_DENIED);
    expect(screen.queryByText(EMPTY_COMMENTS)).toBeNull();
  });

  it('control: a 200 with zero rows shows the empty state, unchanged', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.resolve({ data: [] }),
    });

    renderDetail(dataSource);

    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-access-denied')).toBeNull();
    expect(screen.queryByText(ACTIVITY_DENIED)).toBeNull();
  });

  it('a 404 is not a refusal: the empty state stays', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.reject(rejection(404, 'OBJECT_NOT_FOUND')),
    });

    renderDetail(dataSource);

    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-access-denied')).toBeNull();
  });

  it('a 500 is not "no permission"', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.resolve({ data: [] }),
      sys_activity: () => Promise.reject(rejection(500, 'INTERNAL_ERROR')),
    });

    renderDetail(dataSource);

    // The panel has no error state of its own, so a failure that is not a
    // refusal still settles on the empty state.
    expect(await screen.findByText(EMPTY_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-access-denied')).toBeNull();
    expect(screen.queryByText(ACTIVITY_DENIED)).toBeNull();
  });
});

describe('RecordDetailView: a refused sys_comment read beside an answered sys_activity read (objectui#11195)', () => {
  it('keeps the activity rows and says the comments are withheld', async () => {
    const dataSource = makeDataSource({
      sys_comment: () => Promise.reject(rejection(403, 'PERMISSION_DENIED')),
      sys_activity: () =>
        Promise.resolve({
          data: [
            {
              id: 'act-1',
              type: 'updated',
              summary: 'Stage moved to qualified',
              timestamp: '2026-01-02T00:00:00.000Z',
              actor_name: 'Grace',
            },
          ],
        }),
    });

    renderDetail(dataSource);

    expect(await screen.findByText('Stage moved to qualified')).toBeTruthy();
    const notice = await screen.findByTestId('activity-access-denied');
    expect(notice.textContent).toContain(COMMENTS_DENIED);
    expect(notice.textContent).not.toContain(ACTIVITY_DENIED);
    expect(notice.querySelector('[data-denied-source="comments"]')).not.toBeNull();
    expect(notice.querySelector('[data-denied-source="activity"]')).toBeNull();
  });
});
