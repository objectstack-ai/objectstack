// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A stored reply shows under its parent, and a comment read from the server
 * offers the reply input (objectui#12144).
 *
 * The record page reads the record's `sys_comment` rows and maps each one to a
 * feed item carrying its `parentId`. With threading on (the default record
 * page's `record:discussion` turns it on), the timeline takes every item with a
 * `parentId` out of the top-level list and draws a comment's replies, and the
 * reply input with them, only under an item whose `replyCount` is above zero.
 * The read set no `replyCount`, so a stored reply was shown nowhere, and no
 * comment read from the server offered a reply input: the first reply on a
 * comment could not be posted from the page.
 *
 * `sys_comment` declares no reply count: the platform's object definition says
 * to count `parent_id` children at read time. So the read counts each comment's
 * children in the rows it read and sets `replyCount` beside `parentId`, and the
 * timeline offers the reply input on every comment row the host hands
 * `onAddReply` for, replies or not. Its reply LIST still shows only under a
 * `replyCount` above zero, the one gate it had.
 *
 * Real subjects: `RecordDetailView` rendering the SYNTHESIZED default record
 * page (no authored page, so `buildDefaultPageSchema` composes
 * `record:discussion`), over a fake data source answering the `sys_comment`
 * read, driven through the real panel. The grant cases run under the REAL
 * `MePermissionsProvider`, the way objectui#12082's pins do.
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
const OBJECT_NAME = 'crm_customer';
const RECORD_ID = 'rec-1';
const THREAD = `${OBJECT_NAME}:${RECORD_ID}`;

const PARENT_BODY = 'Parent comment on the renewal';
const CHILD_BODY = 'Stored reply to the parent';
const LONE_BODY = 'A comment nobody answered';
const ACTIVITY_BODY = 'Stage changed to Negotiation';
const NEW_REPLY = 'First reply typed on the page';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Customer',
    managedBy: 'platform',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  },
];

/** An authored page whose discussion turns threading OFF (the control). */
const PAGE_THREADING_OFF = {
  name: 'customer_record_page',
  type: 'record',
  object: OBJECT_NAME,
  regions: [
    {
      name: 'main',
      components: [
        { type: 'page:header', title: 'Customer' },
        { type: 'record:discussion', feed: { enableThreading: false } },
      ],
    },
  ],
};

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
    findOne: vi.fn(async (_o: string, id: string) => ({ id, name: `Record ${id}` })),
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
  /** `null` mounts no permission provider: every grant reads open. */
  perms?: MePermissionsResponse | null;
  /** No authored page by default: the synthesized default record page. */
  pages?: unknown[];
}

/** Mounts the record page and waits until its first comment shows. */
async function mount(comments: Record<string, unknown>[], options: MountOptions = {}) {
  const dataSource = makeDataSource(comments, options.activities);
  const page = (
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={metadataFor(options.pages ?? [])}>
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
  );
  const perms = options.perms ?? null;
  const rendered = render(perms ? <MePermissionsProvider initialPermissions={perms}>{page}</MePermissionsProvider> : page);
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

describe('a stored reply shows under its parent on the default record page (objectui#12144)', () => {
  it('a read with a parent and one child shows the child under the parent, not as a row of its own', async () => {
    const { view } = await mount([PARENT, CHILD]);
    const parentRow = rootRowOf(view, PARENT_BODY);
    // Collapsed until asked: the reply is not on screen yet, and not as a root row either.
    expect(view.queryByText(CHILD_BODY)).toBeNull();
    const toggle = within(parentRow).getByRole('button', { name: /1 reply/ });
    fireEvent.click(toggle);
    expect(within(parentRow).getByText(CHILD_BODY)).toBeInTheDocument();
    expect(replyToggles(view)).toHaveLength(1);
  });

  it('the count is the children in the read: two stored replies read as two', async () => {
    const second = { ...CHILD, id: 'c-child-2', body: 'Second stored reply', created_at: '2026-10-01T09:30:00.000Z' };
    const { view } = await mount([PARENT, CHILD, second]);
    const parentRow = rootRowOf(view, PARENT_BODY);
    fireEvent.click(within(parentRow).getByRole('button', { name: /2 replies/ }));
    expect(within(parentRow).getByText(CHILD_BODY)).toBeInTheDocument();
    expect(within(parentRow).getByText('Second stored reply')).toBeInTheDocument();
  });
});

describe('a comment read from the server offers the reply input where the caller may post one (objectui#12144)', () => {
  it('under a create grant on sys_comment every comment row offers it, a comment with no replies included', async () => {
    const { view } = await mount([PARENT, CHILD, LONE], { perms: answer(CREATE_ONLY) });
    expect(within(rootRowOf(view, LONE_BODY)).queryByPlaceholderText(REPLY_PLACEHOLDER)).not.toBeNull();
    expect(within(rootRowOf(view, PARENT_BODY)).queryByPlaceholderText(REPLY_PLACEHOLDER)).not.toBeNull();
    expect(replyInputs(view)).toHaveLength(2);
  });

  it('a row that is not a comment offers none: a reply is stored as a sys_comment under a comment', async () => {
    const { view } = await mount([LONE], { activities: [UPDATED] });
    await view.findByText(ACTIVITY_BODY);
    expect(within(rootRowOf(view, ACTIVITY_BODY)).queryByPlaceholderText(REPLY_PLACEHOLDER)).toBeNull();
    expect(replyInputs(view)).toHaveLength(1);
  });

  it('the first reply on a comment posts from the page, under that comment, and then shows there', async () => {
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

describe('CONTROL: with threading off the list is unchanged (objectui#12144)', () => {
  it('a reply is a row of its own in read order, with no reply toggle and no reply input', async () => {
    const { view } = await mount([PARENT, CHILD, LONE], { pages: [PAGE_THREADING_OFF] });
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
