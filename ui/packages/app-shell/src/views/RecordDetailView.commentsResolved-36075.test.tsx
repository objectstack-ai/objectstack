// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36075 PR 2 — the comment panel's resolved threads and the
 * moderator's Edit and Delete, pinned through the REAL `RecordDetailView`:
 *
 * - The rows' `is_resolved` / `resolved_by` (#36071) reach the panel: the
 *   icon counts the unresolved threads, a resolved one is hidden until
 *   「显示已解决」 and names its resolver (an author of the discussion here).
 * - ✓ resolves through the resolution door (`PUT /api/v1/comments/:id/resolution`
 *   with `{ resolved }`, objectstack#36186), on every thread, the viewer's
 *   and others'; the thread leaves the list and the count drops.
 * - Without the `sys_comment` delete grant, the viewer's Delete goes through
 *   the own-comment delete door (`DELETE /api/v1/comments/:id`,
 *   objectstack#36191), on their own comments with no reply alone.
 * - A reply into a resolved thread shows it reopened, as the platform stores.
 * - Edit and Delete on another member's comment only on the explain engine's
 *   definite allow of a by-id update of the record; an unanswered verdict
 *   offers them on the viewer's own comments alone.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, within, act, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** The page's authenticated fetch: the comment doors answer through it. */
const doorFetch = vi.hoisted(() => vi.fn());
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u-ada', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => doorFetch,
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
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { toast } from 'sonner';
import { RecordDetailView } from './RecordDetailView';
import { __clearRecordEditableCache } from '../../../plugin-detail/src/useRecordEditable';

const OBJECT_NAME = 'crm_case';
const NO_FEEDS = 'crm_note';
const RECORD_ID = 'case-41';
const THREAD = `${OBJECT_NAME}:${RECORD_ID}`;

const ADA_BODY = 'Ada: customer called back about the outage';
const GRACE_BODY = 'Grace: escalated to tier two';
const REPLY_BODY = 'Grace: tier two confirmed';

const ROWS = [
  {
    id: 'c-ada',
    thread_id: THREAD,
    author_id: 'u-ada',
    author_name: 'Ada',
    body: ADA_BODY,
    created_at: '2026-10-01T08:00:00.000Z',
    is_resolved: false,
    resolved_by: null,
    resolved_at: null,
  },
  {
    id: 'c-grace',
    thread_id: THREAD,
    author_id: 'u-grace',
    author_name: 'Grace',
    body: GRACE_BODY,
    created_at: '2026-10-01T09:00:00.000Z',
    is_resolved: true,
    resolved_by: 'u-linus',
    resolved_at: '2026-10-01T11:00:00.000Z',
  },
  {
    id: 'c-linus',
    thread_id: THREAD,
    parent_id: 'c-grace',
    author_id: 'u-linus',
    author_name: 'Linus',
    body: REPLY_BODY,
    created_at: '2026-10-01T10:00:00.000Z',
    is_resolved: false,
    resolved_by: null,
    resolved_at: null,
  },
];

const FIELDS = { id: { type: 'text', label: 'Id' }, subject: { type: 'text', label: 'Subject' } };
const OBJECTS = [
  { name: OBJECT_NAME, label: 'Case', fields: FIELDS },
  { name: NO_FEEDS, label: 'Note', fields: FIELDS, enable: { feeds: false } },
];

const AUTHORED_PAGE = {
  name: 'case_detail_page',
  type: 'record',
  object: OBJECT_NAME,
  regions: [
    {
      name: 'main',
      components: [{ type: 'page:header', properties: { title: '{subject}' } }, { type: 'record:discussion' }],
    },
  ],
};

function makeDataSource(rows: ReadonlyArray<Record<string, unknown>> = ROWS, users: ReadonlyArray<Record<string, unknown>> = []) {
  return {
    find: vi.fn(async (objectName: string) => {
      if (objectName === 'sys_comment') return { data: rows.map((r) => ({ ...r })) };
      if (objectName === 'sys_user') return { data: users.map((u) => ({ ...u })) };
      return { data: [] };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, subject: `Case ${id}` })),
    create: vi.fn(async (_o: string, data: any) => ({ id: 'c-new', ...data })),
    update: vi.fn(async (_o: string, id: string, patch: any) => ({
      ...ROWS.find((r) => r.id === id),
      ...patch,
      ...(patch.is_resolved === true ? { resolved_by: 'u-ada', resolved_at: '2026-10-02T00:00:00.000Z' } : {}),
      ...(patch.is_resolved === false ? { resolved_by: null, resolved_at: null } : {}),
    })),
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
const PERMS = {
  authenticated: true,
  userId: 'u-ada',
  tenantId: null,
  positions: ['member'],
  hasAnyQueue: false,
  objectsUsingQueues: [],
  permissionSets: ['member'],
  objects: { [OBJECT_NAME]: FULL, [NO_FEEDS]: FULL, sys_comment: FULL },
  fields: {},
} as MePermissionsAuthenticatedResponse;

interface MountOptions {
  perms?: MePermissionsAuthenticatedResponse;
  objectName?: string;
  pages?: unknown[];
  embedded?: boolean;
  rows?: ReadonlyArray<Record<string, unknown>>;
  users?: ReadonlyArray<Record<string, unknown>>;
}

async function mount({ perms = PERMS, objectName = OBJECT_NAME, pages = [], embedded = false, rows, users }: MountOptions = {}) {
  const dataSource = makeDataSource(rows, users);
  const rendered = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={perms}>
        <MemoryRouter initialEntries={[`/app/service/${objectName}/${RECORD_ID}`]}>
          <MetadataCtx.Provider value={metadataFor(pages)}>
            <RecordDetailView
              dataSource={dataSource}
              objects={OBJECTS}
              onEdit={() => {}}
              objectNameOverride={objectName}
              recordIdOverride={RECORD_ID}
              embedded={embedded}
            />
          </MetadataCtx.Provider>
        </MemoryRouter>
      </MePermissionsProvider>
    </I18nProvider>,
  );
  await within(rendered.container).findByText(`Case ${RECORD_ID}`, undefined, { timeout: 4000 }).catch(() => undefined);
  await act(async () => {});
  return { ...rendered, dataSource };
}

const button = (root: HTMLElement) => root.querySelector('[data-comments-button]') as HTMLButtonElement | null;
const panel = (root: HTMLElement) => root.querySelector('[data-comments-panel]') as HTMLElement | null;
const placement = (root: HTMLElement) =>
  root.querySelector('[data-comments-placement]')?.getAttribute('data-comments-placement') ?? null;

/**
 * The explain engine's answer to every `POST /security/explain`: true, false,
 * or none (`null`): `verdict` for the record, `commentVerdict` for a
 * `sys_comment` row (the row floor on a comment the viewer did not write).
 */
function stubExplain(verdict: boolean | null, commentVerdict: boolean | null = verdict) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      let asked: { object?: string; recordId?: string } = {};
      try { asked = JSON.parse(String(init?.body ?? '{}')); } catch { /* not a JSON body */ }
      const answer = asked.object === 'sys_comment' ? commentVerdict : verdict;
      const body =
        String(url).includes('/security/explain') && answer !== null
          ? { allowed: true, record: { recordId: asked.recordId ?? RECORD_ID, visible: answer } }
          : { data: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}
const explainAsked = () =>
  ((globalThis.fetch as any).mock.calls as Array<[unknown, { body?: unknown }?]>)
    .filter(([url]) => String(url).includes('/security/explain'))
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')));

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

/** The doors' answers: the resolution door answers the stored resolution, the delete door `{ id, deleted }`. */
function answerDoors() {
  doorFetch.mockImplementation(async (url: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(url);
    const resolution = path.match(/\/api\/v1\/comments\/([^/]+)\/resolution$/);
    if (resolution && init?.method === 'PUT') {
      const resolved = JSON.parse(String(init.body)).resolved === true;
      const data = {
        id: decodeURIComponent(resolution[1]),
        is_resolved: resolved,
        resolved_by: resolved ? 'u-ada' : null,
        resolved_at: resolved ? '2026-10-02T00:00:00.000Z' : null,
      };
      return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const removal = path.match(/\/api\/v1\/comments\/([^/]+)$/);
    if (removal && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ success: true, data: { id: decodeURIComponent(removal[1]), deleted: true } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}
const doorCalls = (method: string) =>
  (doorFetch.mock.calls as Array<[unknown, { method?: string; body?: unknown }?]>)
    .filter(([url, init]) => init?.method === method && String(url).includes('/api/v1/comments/'))
    .map(([url, init]) => ({ url: String(url), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }));

beforeEach(() => {
  answerDoors();
  window.localStorage.clear();
  setWindowWidth(1440);
  // The explain verdicts live in a module-level cache: each case asks afresh.
  __clearRecordEditableCache();
  stubExplain(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});


const count = (root: HTMLElement) => button(root)?.querySelector('[data-comments-count]')?.textContent ?? null;
const commentIn = (root: HTMLElement, text: string) =>
  Array.from(panel(root)!.querySelectorAll('[data-comment-item]')).find((el) =>
    el.querySelector(':scope > .pl-7 [data-comment-body]')?.textContent?.includes(text),
  ) as HTMLElement | undefined;

/** The reader reaches into the open panel: the pointer enters it. */
const engage = (root: HTMLElement) => fireEvent.pointerEnter(root.querySelector('[data-comments-placement]')!);

async function openPanel() {
  const mounted = await mount();
  await waitFor(() => expect(button(mounted.container)).not.toBeNull());
  fireEvent.click(button(mounted.container)!);
  await within(panel(mounted.container)!).findByText(ADA_BODY);
  engage(mounted.container);
  return mounted;
}

async function showResolved() {
  fireEvent.pointerDown(document.querySelector('[data-comments-filter]')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await within(document.body).findByRole('menuitemcheckbox', { name: 'Show resolved' }));
}

describe('resolved threads in the record comment panel (objectstack#36075)', () => {
  it('the icon counts the unresolved threads, and a resolved one waits behind 「显示已解决」 with its resolver', async () => {
    const { container } = await mount();
    await waitFor(() => expect(count(container)).toBe('1'));
    fireEvent.click(button(container)!);
    const p = within(panel(container)!);
    await p.findByText(ADA_BODY);
    expect(p.queryByText(GRACE_BODY)).toBeNull();
    await showResolved();
    expect(await p.findByText(GRACE_BODY)).toBeInTheDocument();
    expect(p.getByText('Resolved by Linus')).toBeInTheDocument();
  });

  it('a resolver the page cannot name is read by id, once, and named', async () => {
    const rows = ROWS.map((r) => (r.id === 'c-grace' ? { ...r, resolved_by: 'u-zoe' } : r));
    const { container, dataSource } = await mount({ rows, users: [{ id: 'u-zoe', name: 'Zoe' }] });
    await waitFor(() => expect(button(container)).not.toBeNull());
    fireEvent.click(button(container)!);
    await within(panel(container)!).findByText(ADA_BODY);
    await showResolved();
    expect(await within(panel(container)!).findByText('Resolved by Zoe')).toBeInTheDocument();
    const userReads = dataSource.find.mock.calls.filter(([o]: [string]) => o === 'sys_user');
    expect(userReads).toEqual([
      ['sys_user', { $filter: { id: { $in: ['u-zoe'] } }, $top: 1, $select: ['id', 'name'] }],
    ]);
  });

  it('reads no user when every resolver is named on the page', async () => {
    const { container, dataSource } = await openPanel();
    await showResolved();
    expect(await within(panel(container)!).findByText('Resolved by Linus')).toBeInTheDocument();
    expect(dataSource.find.mock.calls.some(([o]: [string]) => o === 'sys_user')).toBe(false);
  });

  it('✓ resolves through the resolution door with { resolved: true } alone; the thread leaves and the count drops', async () => {
    const { container, dataSource } = await openPanel();
    await waitFor(() => expect(count(container)).toBe('1'));
    const ada = commentIn(container, ADA_BODY)!;
    await act(async () => {
      fireEvent.click(ada.querySelector('[data-comment-action="resolve"]')!);
    });
    expect(doorCalls('PUT')).toEqual([{ url: expect.stringMatching(/\/api\/v1\/comments\/c-ada\/resolution$/), body: { resolved: true } }]);
    expect(dataSource.update).not.toHaveBeenCalled();
    await waitFor(() => expect(within(panel(container)!).queryByText(ADA_BODY)).toBeNull());
    // No unresolved thread: the icon draws no number.
    expect(count(container)).toBeNull();
    await showResolved();
    expect(await within(panel(container)!).findByText('Resolved by Ada')).toBeInTheDocument();
  });

  it('a refused ✓ says so and leaves the thread where it was', async () => {
    const { container } = await openPanel();
    doorFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 403 }));
    const ada = commentIn(container, ADA_BODY)!;
    await act(async () => {
      fireEvent.click(ada.querySelector('[data-comment-action="resolve"]')!);
    });
    expect(toast.error).toHaveBeenCalledWith('The thread was not updated. Please try again.');
    expect(within(panel(container)!).getByText(ADA_BODY)).toBeInTheDocument();
    expect(count(container)).toBe('1');
  });

  it('the reopen ✓ sends { resolved: false } and the thread counts again, with no explain answer at all', async () => {
    const { container } = await openPanel();
    await showResolved();
    const grace = await waitFor(() => {
      const el = commentIn(container, GRACE_BODY)!;
      expect(el.querySelector('[data-comment-action="reopen"]')).not.toBeNull();
      return el;
    });
    await act(async () => {
      fireEvent.click(grace.querySelector('[data-comment-action="reopen"]')!);
    });
    expect(doorCalls('PUT')).toEqual([{ url: expect.stringMatching(/\/api\/v1\/comments\/c-grace\/resolution$/), body: { resolved: false } }]);
    await waitFor(() => expect(count(container)).toBe('2'));
  });

  it('a reply into a resolved thread shows it reopened', async () => {
    const { container } = await openPanel();
    await showResolved();
    const thread = (await waitFor(() => commentIn(container, GRACE_BODY)!)).closest('[data-comment-thread]') as HTMLElement;
    expect(thread).toHaveAttribute('data-comment-thread-resolved', 'true');
    fireEvent.click(within(thread).getByRole('button', { name: /1 reply/ }));
    const box = within(thread).getByPlaceholderText('Reply…');
    fireEvent.change(box, { target: { value: 'one more thing' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    });
    await waitFor(() => expect(thread).not.toHaveAttribute('data-comment-thread-resolved'));
    expect(count(container)).toBe('2');
  });
});

describe("Edit and Delete on another member's comment (objectstack#36075 item 6)", () => {
  const moreOn = (root: HTMLElement, text: string) => commentIn(root, text)?.querySelector(':scope > [data-comment-actions] [data-comment-action="more"]') ?? null;

  it('offered where the explain engine admits a by-id update of the record', async () => {
    stubExplain(true);
    const { container, dataSource } = await openPanel();
    await showResolved();
    await waitFor(() => expect(moreOn(container, GRACE_BODY)).not.toBeNull());
    fireEvent.pointerDown(moreOn(container, GRACE_BODY)!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'Delete' }));
    const dialog = await within(document.body).findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    expect(dataSource.delete).toHaveBeenCalledWith('sys_comment', 'c-grace');
  });

  it('not offered where it refuses', async () => {
    stubExplain(false);
    const { container } = await openPanel();
    await showResolved();
    await waitFor(() => expect(commentIn(container, GRACE_BODY)).toBeDefined());
    await act(async () => {});
    expect(moreOn(container, GRACE_BODY)).toBeNull();
    expect(moreOn(container, ADA_BODY)).not.toBeNull();
  });

  it('the resolve control rides its own gate: ✓ on another member\'s thread beside a moderation refusal', async () => {
    stubExplain(false, true);
    const { container } = await openPanel();
    await showResolved();
    await waitFor(() =>
      expect(commentIn(container, GRACE_BODY)!.querySelector('[data-comment-action="reopen"]')).not.toBeNull(),
    );
    expect(moreOn(container, GRACE_BODY)).toBeNull();
  });
});

describe("the row floor on another member's comment (objectstack#36075)", () => {
  const moreOn = (root: HTMLElement, text: string) => commentIn(root, text)?.querySelector(':scope > [data-comment-actions] [data-comment-action="more"]') ?? null;
  const reopenOn = (root: HTMLElement, text: string) => commentIn(root, text)?.querySelector('[data-comment-action="reopen"]') ?? null;

  it('asks ONE explain of a top-level comment the viewer did not write, once the reader reaches into the open panel', async () => {
    stubExplain(true);
    const mounted = await mount();
    await waitFor(() => expect(button(mounted.container)).not.toBeNull());
    expect(explainAsked().filter((q) => q.object === 'sys_comment')).toEqual([]);
    fireEvent.click(button(mounted.container)!);
    await within(panel(mounted.container)!).findByText(ADA_BODY);
    // Opening the panel asks nothing (objectstack#28470).
    await act(async () => {});
    expect(explainAsked().filter((q) => q.object === 'sys_comment')).toEqual([]);
    engage(mounted.container);
    // Twice in, still one question.
    engage(mounted.container);
    await waitFor(() =>
      expect(explainAsked().filter((q) => q.object === 'sys_comment')).toEqual([
        expect.objectContaining({ object: 'sys_comment', operation: 'update', recordId: 'c-grace' }),
      ]),
    );
  });

  it('refused: no Edit on another member\'s rows, Delete still where the viewer moderates, ✓ still (the resolution door), own rows unchanged', async () => {
    stubExplain(true, false);
    const { container } = await openPanel();
    await showResolved();
    await waitFor(() => expect(moreOn(container, GRACE_BODY)).not.toBeNull());
    expect(reopenOn(container, GRACE_BODY)).not.toBeNull();
    fireEvent.pointerDown(moreOn(container, GRACE_BODY)!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    expect(await within(document.body).findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(within(document.body).queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(commentIn(container, ADA_BODY)!.querySelector('[data-comment-action="resolve"]')).not.toBeNull();
  });

  it('admitted: ✓ and Edit on another member\'s rows', async () => {
    stubExplain(true, true);
    const { container } = await openPanel();
    await showResolved();
    await waitFor(() => expect(reopenOn(container, GRACE_BODY)).not.toBeNull());
    fireEvent.pointerDown(moreOn(container, GRACE_BODY)!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    expect(await within(document.body).findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
  });

  it('✓ asks no explain: with no answer it is on the viewer\'s threads and on another member\'s', async () => {
    stubExplain(null);
    const { container } = await openPanel();
    await showResolved();
    await waitFor(() => expect(reopenOn(container, GRACE_BODY)).not.toBeNull());
    expect(commentIn(container, ADA_BODY)!.querySelector('[data-comment-action="resolve"]')).not.toBeNull();
  });

  it('not offered on a guess: an explain answer with no record verdict offers the own comments alone', async () => {
    stubExplain(null);
    const { container } = await openPanel();
    await showResolved();
    await waitFor(() => expect(commentIn(container, GRACE_BODY)).toBeDefined());
    await act(async () => {});
    expect(moreOn(container, GRACE_BODY)).toBeNull();
    expect(moreOn(container, ADA_BODY)).not.toBeNull();
  });
});

describe('a member without the sys_comment delete grant deletes through the own-comment delete door (objectstack#36191)', () => {
  const MEMBER_PERMS = {
    ...PERMS,
    objects: { ...PERMS.objects, sys_comment: { ...FULL, allowDelete: false } },
  } as MePermissionsAuthenticatedResponse;
  const moreOn = (root: HTMLElement, text: string) => commentIn(root, text)?.querySelector(':scope > [data-comment-actions] [data-comment-action="more"]') ?? null;

  async function openAsMember(rows?: ReadonlyArray<Record<string, unknown>>) {
    stubExplain(true, false);
    const mounted = await mount({ perms: MEMBER_PERMS, rows });
    await waitFor(() => expect(button(mounted.container)).not.toBeNull());
    fireEvent.click(button(mounted.container)!);
    await within(panel(mounted.container)!).findByText(ADA_BODY);
    engage(mounted.container);
    return mounted;
  }

  it('Delete on the viewer\'s own comment goes through the door, never the data door, and the row leaves', async () => {
    const { container, dataSource } = await openAsMember();
    fireEvent.pointerDown(moreOn(container, ADA_BODY)!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'Delete' }));
    const dialog = await within(document.body).findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    expect(doorCalls('DELETE')).toEqual([{ url: expect.stringMatching(/\/api\/v1\/comments\/c-ada$/), body: undefined }]);
    expect(dataSource.delete).not.toHaveBeenCalled();
    await waitFor(() => expect(within(panel(container)!).queryByText(ADA_BODY)).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Comment deleted');
  });

  it('no Delete on another member\'s comment even where the viewer may edit the record, and none on their own once someone replied', async () => {
    const withReply = [
      ...ROWS,
      { ...ROWS[2], id: 'c-linus-on-ada', parent_id: 'c-ada', body: 'Linus: on it' },
    ];
    const { container } = await openAsMember(withReply);
    await showResolved();
    await waitFor(() => expect(commentIn(container, GRACE_BODY)).toBeDefined());
    await act(async () => {});
    expect(moreOn(container, GRACE_BODY)).toBeNull();
    fireEvent.pointerDown(moreOn(container, ADA_BODY)!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    expect(await within(document.body).findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(within(document.body).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('a refused door delete says so and keeps the row', async () => {
    const { container } = await openAsMember();
    doorFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 409 }));
    fireEvent.pointerDown(moreOn(container, ADA_BODY)!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await within(document.body).findByRole('menuitem', { name: 'Delete' }));
    const dialog = await within(document.body).findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    expect(toast.error).toHaveBeenCalledWith('The comment was not deleted. Please try again.');
    expect(within(panel(container)!).getByText(ADA_BODY)).toBeInTheDocument();
  });
});
