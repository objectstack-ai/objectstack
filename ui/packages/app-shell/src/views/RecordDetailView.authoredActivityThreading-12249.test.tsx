// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An AUTHORED record page whose `record:activity` declares
 * `enableThreading: true` shows a stored reply under its parent and offers the
 * reply input on a comment (objectui#12249).
 *
 * The card's shape is HotCRM's `case_detail_page`: no `record:discussion` node
 * anywhere on the page, and the record's comments reach the user only through a
 * `record:activity` block on an Activity tab, authored with
 * `enableThreading: true` in its `properties` bag. That block takes the feed and
 * its write handlers off the host's `DiscussionContext`, the same standing
 * `record:discussion` has; `onAddReply` is handed over only under the caller's
 * create grant on `sys_comment`.
 *
 * objectui#12144's pins measure the reply path through the SYNTHESIZED default
 * page, whose `record:discussion` renders through `record-chatter.tsx`. None of
 * them mounts `record:activity`, so the block's own reads of `enableThreading`
 * and of the host's `onAddReply` are pinned here, through the host.
 *
 * Real subjects: `RecordDetailView` rendering an authored page, the real
 * `page:tabs` opened on its Activity tab through `?tab=`, the real
 * `record:activity` renderer and timeline, over a fake data source answering
 * the `sys_comment` and `sys_activity` reads. The grant cases run under the
 * REAL `MePermissionsProvider`.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
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

vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const COMMENT = 'sys_comment';
const ACTIVITY = 'sys_activity';
const REPLY_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.replyPlaceholder'];
const OBJECT_NAME = 'crm_case';
const RECORD_ID = 'case-41';
const THREAD = `${OBJECT_NAME}:${RECORD_ID}`;

const PARENT_BODY = 'Customer called back about the outage';
const CHILD_BODY = 'Stored reply: escalated to tier two';
const LONE_BODY = 'A comment nobody answered yet';
const ACTIVITY_BODY = 'Status changed to Escalated';
const NEW_REPLY = 'First reply typed on the Activity tab';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Case',
    managedBy: 'platform',
    fields: { id: { type: 'text', label: 'Id' }, subject: { type: 'text', label: 'Subject' } },
  },
];

/**
 * HotCRM `case_detail_page`'s Activity block, its `properties` bag as authored
 * there, with `enableThreading` taken as a parameter so the control can turn it
 * off and change nothing else.
 */
function activityBlock(enableThreading: boolean) {
  return {
    type: 'record:activity',
    id: 'case_activity',
    properties: {
      filterMode: 'all',
      showFilterToggle: true,
      limit: 25,
      unifiedTimeline: true,
      showCommentInput: true,
      enableMentions: true,
      enableReactions: true,
      enableThreading,
      showCompleted: true,
    },
  };
}

/**
 * The card's page shape: a header, then a `page:tabs` whose Activity tab holds
 * the only feed block on the page. No `record:discussion` node.
 */
function authoredPage(enableThreading: boolean) {
  return {
    name: 'case_detail_page',
    type: 'record',
    object: OBJECT_NAME,
    regions: [
      { name: 'header', components: [{ type: 'page:header', properties: { title: '{subject}' } }] },
      {
        name: 'main',
        components: [
          {
            type: 'page:tabs',
            id: 'case_main_tabs',
            properties: {
              tabStyle: 'line',
              items: [
                { value: 'details', label: 'Details', children: [{ type: 'record:details', properties: { columns: '2' } }] },
                { value: 'activity', label: 'Activity', children: [activityBlock(enableThreading)] },
              ],
            },
          },
        ],
      },
    ],
  };
}

const PARENT = { id: 'c-parent', thread_id: THREAD, author_name: 'Ada', body: PARENT_BODY, created_at: '2026-10-01T08:00:00.000Z' };
const CHILD = { id: 'c-child', thread_id: THREAD, author_name: 'Grace', body: CHILD_BODY, parent_id: 'c-parent', created_at: '2026-10-01T09:00:00.000Z' };
const LONE = { id: 'c-lone', thread_id: THREAD, author_name: 'Ada', body: LONE_BODY, created_at: '2026-10-01T10:00:00.000Z' };
/** A field change from `sys_activity`: a feed row that is not a comment. */
const UPDATED = { id: 'a-1', type: 'updated', summary: ACTIVITY_BODY, actor_name: 'Ada', timestamp: '2026-10-01T11:00:00.000Z' };

function makeDataSource(comments: Record<string, unknown>[], activities: Record<string, unknown>[] = []) {
  return {
    find: vi.fn(async (objectName: string) => {
      if (objectName === COMMENT) return { data: comments.map((c) => ({ ...c })) };
      if (objectName === ACTIVITY) return { data: activities.map((a) => ({ ...a })) };
      return { data: [] };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, subject: `Case ${id}` })),
    create: vi.fn(async (_o: string, data: any) => ({ ...data })),
    update: vi.fn(async (_o: string, id: string, patch: any) => ({ id, ...patch })),
    delete: vi.fn(async () => true),
  } as any;
}

function metadataFor(pages: unknown[]) {
  return {
    objects: OBJECTS,
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'page' ? pages : type === 'object' ? OBJECTS : []),
    getTypeStatus: () => 'ready',
  } as any;
}

const FULL = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const CREATE_ONLY = { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false };
const READ_ONLY = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };

/** The caller's `/me/permissions` answer: full on the record's object, `bits` on `sys_comment`. */
function answer(bits: Record<string, unknown>): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: ['member'],
    permissionSets: ['member'],
    objects: { [OBJECT_NAME]: FULL, [COMMENT]: bits },
    fields: {},
  } as MePermissionsResponse;
}

interface MountOptions {
  activities?: Record<string, unknown>[];
  perms: MePermissionsResponse;
  /** The authored block's `enableThreading`; the card's shape declares `true`. */
  enableThreading?: boolean;
}

/** Mounts the authored record page on its Activity tab and waits until the first comment shows. */
async function mount(comments: Record<string, unknown>[], options: MountOptions) {
  const dataSource = makeDataSource(comments, options.activities);
  const rendered = render(
    <MePermissionsProvider initialPermissions={options.perms}>
      <MemoryRouter initialEntries={[`/app/service/${OBJECT_NAME}/${RECORD_ID}?tab=activity`]}>
        <MetadataCtx.Provider value={metadataFor([authoredPage(options.enableThreading ?? true)])}>
          <RecordDetailView
            dataSource={dataSource}
            objects={OBJECTS}
            onEdit={() => {}}
            objectNameOverride={OBJECT_NAME}
            recordIdOverride={RECORD_ID}
            embedded
          />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </MePermissionsProvider>,
  );
  const view = within(rendered.container);
  await view.findByText(String(comments[0].body));
  await waitFor(() => expect(view.queryByTestId('activity-loading')).toBeNull());
  await act(async () => {});
  return { view, dataSource };
}

type View = Awaited<ReturnType<typeof mount>>['view'];

const replyInputs = (view: View) => view.queryAllByPlaceholderText(REPLY_PLACEHOLDER);
/** The reply-count toggle `ThreadedReplies` draws above a comment's replies. */
const replyToggles = (view: View) => view.queryAllByRole('button', { name: /\d+ repl/ });

/**
 * The feed row a body sits in: the element the timeline keys per root item,
 * which holds the item's own row and, after it, its `ThreadedReplies`.
 */
function rootRowOf(view: View, body: string): HTMLElement {
  const rows = view.getByText(body).closest('.space-y-4')!.children;
  const row = Array.from(rows).find((r) => r.textContent?.includes(body));
  if (!row) throw new Error(`no feed row holds ${JSON.stringify(body)}`);
  return row as HTMLElement;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('an authored record:activity with enableThreading shows a stored reply under its parent (objectui#12249)', () => {
  it('the page carries no record:discussion, and the comments reach the user through the Activity block', async () => {
    const { view } = await mount([PARENT, CHILD, LONE], { perms: answer(CREATE_ONLY) });
    // The one feed on the page is the authored block's: the Activity tab is the
    // open one, and each comment body is on screen exactly once.
    expect(view.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
    expect(view.getAllByText(PARENT_BODY)).toHaveLength(1);
    expect(view.getAllByText(LONE_BODY)).toHaveLength(1);
  });

  it('a read with a parent and one child shows the child under the parent, not as a row of its own', async () => {
    const { view } = await mount([PARENT, CHILD, LONE], { perms: answer(CREATE_ONLY) });
    const parentRow = rootRowOf(view, PARENT_BODY);
    expect(view.queryByText(CHILD_BODY)).toBeNull();
    fireEvent.click(within(parentRow).getByRole('button', { name: /1 reply/ }));
    expect(within(parentRow).getByText(CHILD_BODY)).toBeInTheDocument();
    expect(replyToggles(view)).toHaveLength(1);
  });
});

describe('an authored record:activity with enableThreading offers the reply input where the caller may post one (objectui#12249)', () => {
  it('under a create grant on sys_comment every comment row offers it, a comment with no replies included', async () => {
    const { view } = await mount([PARENT, CHILD, LONE], { perms: answer(CREATE_ONLY) });
    expect(within(rootRowOf(view, LONE_BODY)).queryByPlaceholderText(REPLY_PLACEHOLDER)).not.toBeNull();
    expect(within(rootRowOf(view, PARENT_BODY)).queryByPlaceholderText(REPLY_PLACEHOLDER)).not.toBeNull();
    expect(replyInputs(view)).toHaveLength(2);
  });

  it('a row that is not a comment offers none: a reply is stored as a sys_comment under a comment', async () => {
    const { view } = await mount([LONE], { perms: answer(CREATE_ONLY), activities: [UPDATED] });
    await view.findByText(ACTIVITY_BODY);
    expect(within(rootRowOf(view, ACTIVITY_BODY)).queryByPlaceholderText(REPLY_PLACEHOLDER)).toBeNull();
    expect(replyInputs(view)).toHaveLength(1);
  });

  it('the first reply on a comment posts from the Activity tab, under that comment, and then shows there', async () => {
    const { view, dataSource } = await mount([LONE], { perms: answer(CREATE_ONLY) });
    const loneRow = rootRowOf(view, LONE_BODY);
    fireEvent.change(within(loneRow).getByPlaceholderText(REPLY_PLACEHOLDER), { target: { value: NEW_REPLY } });
    await act(async () => {
      fireEvent.click(within(loneRow).getByRole('button', { name: 'Send reply' }));
    });
    expect(dataSource.create).toHaveBeenCalledTimes(1);
    expect(dataSource.create.mock.calls[0][0]).toBe(COMMENT);
    expect(dataSource.create.mock.calls[0][1]).toMatchObject({ thread_id: THREAD, parent_id: 'c-lone', body: NEW_REPLY });
    fireEvent.click(within(loneRow).getByRole('button', { name: /1 reply/ }));
    expect(within(loneRow).getByText(NEW_REPLY)).toBeInTheDocument();
  });

  it('without the create grant no row offers it, and a stored reply still shows under its parent', async () => {
    const { view } = await mount([PARENT, CHILD, LONE], { perms: answer(READ_ONLY) });
    expect(replyInputs(view)).toHaveLength(0);
    const parentRow = rootRowOf(view, PARENT_BODY);
    fireEvent.click(within(parentRow).getByRole('button', { name: /1 reply/ }));
    expect(within(parentRow).getByText(CHILD_BODY)).toBeInTheDocument();
  });
});

describe('CONTROL: the same authored block with enableThreading false (objectui#12249)', () => {
  it('a reply is a row of its own in read order, with no reply toggle and no reply input, under the same create grant', async () => {
    const { view } = await mount([PARENT, CHILD, LONE], { perms: answer(CREATE_ONLY), enableThreading: false });
    const list = view.getByText(PARENT_BODY).closest('.space-y-4')!;
    const rows = Array.from(list.children).map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(PARENT_BODY);
    expect(rows[1]).toContain(CHILD_BODY);
    expect(rows[2]).toContain(LONE_BODY);
    expect(replyToggles(view)).toHaveLength(0);
    expect(replyInputs(view)).toHaveLength(0);
  });
});
