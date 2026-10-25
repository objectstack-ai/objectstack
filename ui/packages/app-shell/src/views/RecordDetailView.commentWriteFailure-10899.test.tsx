// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A record comment whose write fails is never rendered as sent (objectui#10899
 * item 2 — the objectui half of cloud#2431, maintainer ruling: 「托管底线加挂
 * audit（推荐）」, so cloud mounts audit on hosted tenants and the console's part
 * is that a failed write never reads as a posted comment).
 *
 * Measured on the 2026-09-28 local E2E: on a tenant with no `sys_comment`,
 * `POST /api/v1/data/sys_comment` answered 404 while the 讨论 panel showed the
 * comment and 「讨论 (1)」, with no error; after a reload it was gone. Both
 * writers appended an optimistic row and swallowed the `create` rejection.
 *
 * Real subjects: `RecordDetailView` rendering an authored record page that
 * composes `record:discussion`, driven through its real composer
 * (`RecordActivityTimeline`), over a fake data source whose `sys_comment`
 * `create` is the varied axis. `sonner` is the observed channel for the error.
 *
 * The reply writer (`handleAddReply`) takes the same shape. Its input is
 * reachable from a loaded feed: the timeline offers it on every comment row the
 * page hands `onAddReply` for, a comment with no replies included
 * (objectui#12144). So its failure path is pinned here too, through the reply
 * input under a comment read from `sys_comment`. The input's own half (a
 * rejection keeps the reply draft) is also pinned in plugin-detail
 * (`composerKeepsDraftOnRejection-10899.test.tsx`).
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { DETAIL_DEFAULT_TRANSLATIONS } from '@object-ui/plugin-detail';
import { toast } from 'sonner';

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

const EMPTY_COMMENTS = DETAIL_DEFAULT_TRANSLATIONS['detail.noCommentsYet'];
const COMMENT_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.leaveCommentPlaceholder'];
const SUBMIT_COMMENT = DETAIL_DEFAULT_TRANSLATIONS['detail.submitComment'];
const REPLY_PLACEHOLDER = DETAIL_DEFAULT_TRANSLATIONS['detail.replyPlaceholder'];
const OBJECT_NAME = 'crm_customer';
const RECORD_ID = 'rec-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Customer',
    managedBy: 'platform',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  },
];

const PAGE = {
  name: 'customer_record_page',
  type: 'record',
  object: OBJECT_NAME,
  regions: [
    { name: 'main', components: [{ type: 'page:header', title: 'Customer' }, { type: 'record:discussion' }] },
  ],
};

/**
 * `sys_comment` reads answer `seeded`; `create` is whatever the case installs.
 * The 404 the E2E recorded is the default refusal.
 */
function makeDataSource(seeded: Array<Record<string, unknown>> = []) {
  return {
    find: vi.fn((objectName: string) =>
      Promise.resolve({ data: objectName === 'sys_comment' ? seeded : [] }),
    ),
    create: vi.fn(async () => {
      throw Object.assign(new Error('Object sys_comment not found'), { httpStatus: 404 });
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, name: `Record ${id}` })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function mount(dataSource: any) {
  const pages = [PAGE];
  const metadata = {
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
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={metadata}>
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

async function postComment(text: string) {
  const box = await screen.findByPlaceholderText(COMMENT_PLACEHOLDER);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByTitle(SUBMIT_COMMENT));
  return box as HTMLTextAreaElement;
}

/** A feed row carrying `text` — the composer's own draft never counts. */
const feedRow = (text: string) => screen.queryByText(text, { selector: ':not(textarea):not(input)' });

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

describe('a failed comment write is never rendered as sent (objectui#10899)', () => {
  it('a rejected `sys_comment` create adds no row, raises a localized error, and keeps the draft', async () => {
    const dataSource = makeDataSource();
    mount(dataSource);
    await screen.findByText(EMPTY_COMMENTS);

    const box = await postComment('Called the customer, follow up Friday');

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(dataSource.create).toHaveBeenCalledWith(
      'sys_comment',
      expect.objectContaining({ thread_id: `${OBJECT_NAME}:${RECORD_ID}`, body: 'Called the customer, follow up Friday' }),
    );
    // The panel still says there is nothing — the comment is not "sent".
    expect(feedRow('Called the customer, follow up Friday')).toBeNull();
    expect(screen.getByText(EMPTY_COMMENTS)).toBeInTheDocument();
    // The error is the localized one, not the transport's text.
    const [message] = vi.mocked(toast.error).mock.calls[0];
    expect(String(message)).not.toContain('sys_comment');
    // The user's text survives for a retry.
    await waitFor(() => expect(box.value).toBe('Called the customer, follow up Friday'));
  });

  it('while the write is in flight, the comment is not on the panel yet; it lands once the write resolves', async () => {
    const dataSource = makeDataSource();
    let resolveWrite: (row: unknown) => void = () => {};
    dataSource.create = vi.fn(() => new Promise((resolve) => { resolveWrite = resolve; }));
    mount(dataSource);
    await screen.findByText(EMPTY_COMMENTS);

    await postComment('pending comment');
    await waitFor(() => expect(dataSource.create).toHaveBeenCalled());
    expect(feedRow('pending comment')).toBeNull();

    resolveWrite({});
    expect(await screen.findByText('pending comment', { selector: ':not(textarea):not(input)' })).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL — a successful write renders the comment and clears the composer', async () => {
    const dataSource = makeDataSource();
    dataSource.create = vi.fn(async (_o: string, row: any) => row);
    mount(dataSource);
    await screen.findByText(EMPTY_COMMENTS);

    const box = await postComment('written for real');

    expect(await screen.findByText('written for real', { selector: ':not(textarea):not(input)' })).toBeInTheDocument();
    await waitFor(() => expect(box.value).toBe(''));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a rejected reply create under a comment read from the server adds no reply, raises a localized error, and keeps the draft (objectui#12144)', async () => {
    const dataSource = makeDataSource([
      {
        id: 'c1',
        thread_id: `${OBJECT_NAME}:${RECORD_ID}`,
        author_name: 'Grace',
        body: 'Signed the renewal',
        created_at: '2026-10-01T08:00:00.000Z',
      },
    ]);
    mount(dataSource);
    await screen.findByText('Signed the renewal');

    // The comment has no replies; its reply input is offered all the same.
    const input = (await screen.findByPlaceholderText(REPLY_PLACEHOLDER)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Countersigned copy attached' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(dataSource.create).toHaveBeenCalledWith(
      'sys_comment',
      expect.objectContaining({
        thread_id: `${OBJECT_NAME}:${RECORD_ID}`,
        parent_id: 'c1',
        body: 'Countersigned copy attached',
      }),
    );
    // The reply is not "sent": no reply row, and the parent shows no reply count.
    expect(feedRow('Countersigned copy attached')).toBeNull();
    expect(screen.queryByRole('button', { name: /\d+ repl/ })).toBeNull();
    // The error is the localized one, not the transport's text.
    const [message] = vi.mocked(toast.error).mock.calls[0];
    expect(String(message)).not.toContain('sys_comment');
    // The user's text survives for a retry.
    await waitFor(() => expect(input.value).toBe('Countersigned copy attached'));
  });
});
