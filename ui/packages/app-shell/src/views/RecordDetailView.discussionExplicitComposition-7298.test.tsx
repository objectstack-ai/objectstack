/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A record page shows a discussion panel IF AND ONLY IF it composes one
 * (objectui#7298 half two, maintainer ruling 2026-09-12, decision batch #120
 * item 5)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `RecordDetailView` used to append a discussion panel to any authored record
 * page that omitted `record:discussion` / `record:chatter`, and the only way to
 * decline it was `assignedPage.disableDiscussion = true` — a key `PageSchema`
 * is a `strictObject` about, so authoring it is a hard parse error. The panel
 * the host appended was hard-coded open for writes (comment input, reactions,
 * threading), which is why a deliberately read-only page over a
 * `protection: { lock: 'full' }` platform object could not decline it at all.
 *
 * The ruling removes the append rather than declaring the negative flag: *"a
 * page is what its author composes … nothing is appended by default and then
 * removed by a negative flag."* So:
 *
 *   DECLARED     the page places `record:discussion` (or `record:chatter`, the
 *                same renderer under a Salesforce-familiar alias) → the panel
 *                renders, on the config the author wrote.
 *   NOT DECLARED nothing renders. No panel, no composer, no host fallback.
 *   FEEDS OFF    `enable.feeds: false` is still the OBJECT's switch and it wins
 *                over the page: declared or not, no panel.
 *
 * ## What keeps the negative pin from passing trivially
 *
 * "No panel rendered" is satisfied by any harness in which the panel could
 * never have rendered — a broken feed read, a page that never resolved, a
 * component that throws. Every negative case below is therefore paired with a
 * LIT CONTROL that differs from it in exactly one way (the page declares the
 * node) and asserts the panel IS there, on the same fixture, in the same file:
 *
 *   `no panel without the node`      ⟷ `the declared node renders the panel`
 *   `feeds off suppresses it`        ⟷ `feeds on renders the empty panel`
 *
 * ⚠️ The feeds-off pair cannot be read on feed ROWS: `enable.feeds: false` also
 * skips the `sys_comment` fetch, so both sides would have zero rows for two
 * different reasons. It is read on the panel's own chrome — the "Discussion"
 * heading, its empty state and the composer — which is present whenever the
 * panel mounts, empty feed or not.
 *
 * ## Resolution
 *
 * Nothing here resolves through any `dist/`: `./RecordDetailView` is this
 * package's own source and `@object-ui/plugin-detail` is mapped to its `src` by
 * the root `vitest.config.mts` alias table.
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

// Orthogonal chrome — same posture as the sibling feed tests in this folder, so
// the only asynchrony in this file is the feed read.
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
const COMMENT_MARKER = 'A comment on the record';

/** The panel's own chrome — present whenever it mounts, empty feed or not. */
const PANEL_HEADING = 'Discussion';
const PANEL_EMPTY = 'No comments yet';
/** The composer's textarea (`RichTextCommentInput`, as `RecordActivityTimeline`
 *  mounts it) — the write surface the ruling is about. Read by
 *  PLACEHOLDER, not by the submit button: that button mounts only once the box
 *  has text, so counting it reads zero on a panel that is fully open for
 *  writes. */
const COMPOSER = /Leave a comment/;

const baseObject = {
  name: OBJECT_NAME,
  label: 'Account',
  managedBy: 'platform',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
  },
};

/** `enable.feeds` is opt-OUT: absent = on, only an explicit `false` disables. */
const OBJECTS_FEEDS_ON = [baseObject];
const OBJECTS_FEEDS_OFF = [{ ...baseObject, enable: { feeds: false } }];

function authoredPage(components: any[]) {
  return {
    name: 'account_record_page',
    type: 'record',
    object: OBJECT_NAME,
    regions: [{ name: 'main', components }],
  };
}

const HEADER = { type: 'page:header', title: 'Account' };

/** An authored page that composes NO discussion node — the subject. */
const PAGE_WITHOUT_DISCUSSION = authoredPage([HEADER]);
/** The lit control: the same page, plus the one node the ruling requires. */
const PAGE_WITH_DISCUSSION = authoredPage([HEADER, { type: 'record:discussion' }]);
/** The Salesforce-familiar alias — one renderer under two registered names. */
const PAGE_WITH_CHATTER = authoredPage([HEADER, { type: 'record:chatter' }]);
/** Author-written config on the declared node must be honoured as authored. */
const PAGE_WITH_READONLY_DISCUSSION = authoredPage([
  HEADER,
  { type: 'record:discussion', properties: { feed: { showCommentInput: false } } },
]);

function makeDataSource(comments: Array<Record<string, any>>) {
  const find = vi.fn((objectName: string) => {
    if (objectName === 'sys_comment') return Promise.resolve({ data: comments });
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

const ONE_COMMENT = [
  {
    id: 'c-1',
    thread_id: `${OBJECT_NAME}:${RECORD_ID}`,
    author_name: 'Ada',
    body: COMMENT_MARKER,
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

function makeMetadata(objects: any[], pages: any[]) {
  return {
    objects,
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

function renderDetail(opts: { objects: any[]; pages: any[]; comments?: Array<Record<string, any>> }) {
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={makeMetadata(opts.objects, opts.pages)}>
        <RecordDetailView
          dataSource={makeDataSource(opts.comments ?? [])}
          objects={opts.objects}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const count = (text: string) => screen.queryAllByText(text).length;
const composerCount = () => screen.queryAllByPlaceholderText(COMPOSER).length;

/** Wait until the feed read has settled, so an absent panel is an answer. */
async function settled() {
  await waitFor(() => expect(screen.queryByTestId('activity-loading')).toBeNull());
  // The record itself resolves through `findOne`; the header proves the page
  // rendered at all, which is what makes an absent panel a reading about the
  // panel rather than about a page that never mounted.
  await waitFor(() => expect(count('Account')).toBeGreaterThan(0));
}

beforeEach(() => {
  cleanup();
  // Unrelated chrome on this view reaches for the platform API; in jsdom that
  // is a real socket. Answer it locally so the feed read is the only asynchrony.
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

describe('objectui#7298 — the discussion panel is composed, never appended', () => {
  it('an authored page that does NOT declare the node renders NO panel', async () => {
    renderDetail({ objects: OBJECTS_FEEDS_ON, pages: [PAGE_WITHOUT_DISCUSSION], comments: ONE_COMMENT });
    await settled();

    expect(count(PANEL_HEADING)).toBe(0);
    expect(count(PANEL_EMPTY)).toBe(0);
    expect(count(COMMENT_MARKER)).toBe(0);
    // The write surface the ruling is about: no composer reaches a page that
    // did not ask for one.
    expect(composerCount()).toBe(0);
  });

  it('LIT CONTROL — the same page WITH `record:discussion` renders the panel', async () => {
    renderDetail({ objects: OBJECTS_FEEDS_ON, pages: [PAGE_WITH_DISCUSSION], comments: ONE_COMMENT });
    await settled();

    await waitFor(() => expect(count(COMMENT_MARKER)).toBeGreaterThan(0));
    expect(count(PANEL_HEADING)).toBeGreaterThan(0);
    expect(composerCount()).toBeGreaterThan(0);
  });

  it('the `record:chatter` alias composes the same panel', async () => {
    renderDetail({ objects: OBJECTS_FEEDS_ON, pages: [PAGE_WITH_CHATTER], comments: ONE_COMMENT });
    await settled();

    await waitFor(() => expect(count(COMMENT_MARKER)).toBeGreaterThan(0));
    expect(count(PANEL_HEADING)).toBeGreaterThan(0);
  });

  it("the declared node's own `feed` config is honoured as authored", async () => {
    // The backwards workaround the card measured — "declare the component that
    // opens three write surfaces, in order to close them" — is now just
    // authoring: the node is the only way the panel arrives, and its config
    // decides what it offers.
    renderDetail({
      objects: OBJECTS_FEEDS_ON,
      pages: [PAGE_WITH_READONLY_DISCUSSION],
      comments: ONE_COMMENT,
    });
    await settled();

    await waitFor(() => expect(count(COMMENT_MARKER)).toBeGreaterThan(0));
    expect(count(PANEL_HEADING)).toBeGreaterThan(0);
    expect(composerCount()).toBe(0);
  });

  it('the SYNTHESIZED default page still shows the panel — it declares the node', async () => {
    // No authored page ⇒ `buildDefaultPageSchema`, which composes
    // `record:discussion` itself. The ruling removes the host's append, not the
    // default page's panel, so the out-of-the-box record page is unchanged.
    renderDetail({ objects: OBJECTS_FEEDS_ON, pages: [], comments: ONE_COMMENT });
    await settled();

    await waitFor(() => expect(count(COMMENT_MARKER)).toBeGreaterThan(0));
    expect(count(PANEL_HEADING)).toBeGreaterThan(0);
  });
});

describe('objectui#7298 — `enable.feeds` stays the OBJECT switch and wins over the page', () => {
  it('LIT CONTROL — feeds ON, declared node, empty feed: the panel chrome is there', async () => {
    // Read on chrome, not rows: the feeds-off case has zero rows for a second
    // reason (the `sys_comment` fetch is skipped), so rows cannot discriminate.
    renderDetail({ objects: OBJECTS_FEEDS_ON, pages: [PAGE_WITH_DISCUSSION], comments: [] });
    await settled();

    await waitFor(() => expect(count(PANEL_HEADING)).toBeGreaterThan(0));
    expect(count(PANEL_EMPTY)).toBeGreaterThan(0);
    expect(composerCount()).toBeGreaterThan(0);
  });

  it('feeds OFF suppresses the panel even when the page DECLARES it', async () => {
    renderDetail({ objects: OBJECTS_FEEDS_OFF, pages: [PAGE_WITH_DISCUSSION], comments: ONE_COMMENT });
    await settled();

    expect(count(PANEL_HEADING)).toBe(0);
    expect(count(PANEL_EMPTY)).toBe(0);
    expect(composerCount()).toBe(0);
  });

  it('feeds OFF suppresses the panel on the synthesized default page too', async () => {
    renderDetail({ objects: OBJECTS_FEEDS_OFF, pages: [], comments: ONE_COMMENT });
    await settled();

    expect(count(PANEL_HEADING)).toBe(0);
    expect(count(PANEL_EMPTY)).toBe(0);
    expect(composerCount()).toBe(0);
  });
});
