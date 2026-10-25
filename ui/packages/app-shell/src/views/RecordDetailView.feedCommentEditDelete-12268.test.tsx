// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * On a record page, the author of a comment can edit and delete it from the
 * record feed, and nobody else is offered either (objectui#12268).
 *
 * `sys_comment` is `managedBy: 'platform'`, whose declared affordances are
 * the generic New / Import / Edit / Delete, and the platform's comment access
 * hooks let an author update and delete their own comment. The record feed
 * offered neither: a comment row carried reaction and reply controls only.
 *
 * What is pinned, through the REAL `RecordDetailView`:
 *
 * - Whose comment it is comes from ONE rule. The page asks
 *   `@object-ui/collaboration`'s `isCommentAuthor` (the predicate
 *   `CommentThread` gates its own Edit and Delete on) for each row it reads,
 *   and the feed shows the controls on the rows it marked. The collaboration
 *   double below wraps the real predicate, so the page is pinned on the call.
 * - The author edits: the write is a `sys_comment` update of the text and
 *   carries neither `is_edited` nor `edited_at` (objectui#12314): the platform
 *   stamps both when the body changes and refuses them from a client (ruling
 *   A on objectstack-ai/objectstack#23124). The row then shows the new text
 *   and reads as edited from the record the server answers with, so a server
 *   that stamps nothing shows no mark. A comment stored as edited reads as
 *   edited from the read.
 * - The author deletes: the page asks through its own `ActionConfirmDialog`
 *   (the real one, not a double), painted destructive; Cancel sends nothing;
 *   Delete deletes the row from `sys_comment` and from the feed.
 * - A delete hides nobody else's words: another member's reply to the deleted
 *   comment stays on the page as a row of its own, at once and after the feed
 *   is read again from rows that still hold it. The client cascades nothing;
 *   the fake server, like the real one, keeps the reply.
 * - The server's rule stays the authority: a refused edit or delete raises an
 *   error toast and the row keeps its text, or stays.
 * - Another member sees neither control on that comment, and sees them on
 *   their own: the same rows read as Grace instead of Ada.
 * - Each control is handed over under its own grant on `sys_comment`
 *   (`feedCommentEdit`, `feedCommentDelete` in the affordance-to-grant map).
 *
 * Both feed blocks are measured: the card's reach is HotCRM's case page, whose
 * only feed is an authored `record:activity`, and the default record page's
 * feed is `record:discussion` (the chatter panel). Strings are read from the
 * `en` pack by key, under a real `I18nProvider`.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { builtInLocales } from '@object-ui/i18n/locales';

const auth = vi.hoisted(() => ({ user: { id: 'u-ada', name: 'Ada', image: null as string | null } }));
const authorship = vi.hoisted(() => ({ calls: [] as Array<[unknown, unknown]> }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: auth.user, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/collaboration')>();
  return {
    ...actual,
    useRecordPresence: () => [],
    PresenceAvatars: () => null,
    // The real rule, recorded: the page must ask THIS predicate, not a copy.
    isCommentAuthor: (authorId: string | null | undefined, viewerId: string | null | undefined) => {
      authorship.calls.push([authorId, viewerId]);
      return actual.isCommentAuthor(authorId, viewerId);
    },
  };
});

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

// Orthogonal chrome. `ActionConfirmDialog` is deliberately NOT doubled: the
// delete's confirm is part of the subject.
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { RecordDetailView } from './RecordDetailView';

type Pack = {
  detail: {
    editComment: string;
    deleteComment: string;
    deleteCommentConfirm: string;
    commentEditFailed: string;
    commentDeleteFailed: string;
    edited: string;
    save: string;
    cancel: string;
  };
  objectActions: { deleteConfirmButton: string };
  actionConfirm: { cancel: string };
};
/** The pack, read by key: the pin is which copy shows, not what it says today. */
const EN = builtInLocales.en as unknown as Pack;

const COMMENT = 'sys_comment';
const ACTIVITY = 'sys_activity';
const OBJECT_NAME = 'crm_case';
const RECORD_ID = 'case-41';
const THREAD = `${OBJECT_NAME}:${RECORD_ID}`;

const ADA_BODY = 'Ada: customer called back about the outage';
const GRACE_BODY = 'Grace: escalated to tier two';
const GRACE_EDITED_BODY = 'Grace: corrected the ticket number';
const NEW_TEXT = 'Ada: customer called back twice about the outage';

const ADA_ROW = { id: 'c-ada', thread_id: THREAD, author_id: 'u-ada', author_name: 'Ada', body: ADA_BODY, is_edited: false, created_at: '2026-10-01T08:00:00.000Z' };
const GRACE_ROW = { id: 'c-grace', thread_id: THREAD, author_id: 'u-grace', author_name: 'Grace', body: GRACE_BODY, is_edited: false, created_at: '2026-10-01T09:00:00.000Z' };
const GRACE_EDITED_ROW = {
  id: 'c-grace-edited',
  thread_id: THREAD,
  author_id: 'u-grace',
  author_name: 'Grace',
  body: GRACE_EDITED_BODY,
  is_edited: true,
  edited_at: '2026-10-01T10:30:00.000Z',
  created_at: '2026-10-01T10:00:00.000Z',
};
const ROWS = [ADA_ROW, GRACE_ROW, GRACE_EDITED_ROW];

/** Grace's reply to Ada's comment: the row a delete of Ada's comment must not hide. */
const GRACE_REPLY_BODY = 'Grace: tier two confirmed the outage window';
const GRACE_REPLY_ROW = {
  id: 'c-grace-reply',
  thread_id: THREAD,
  parent_id: 'c-ada',
  author_id: 'u-grace',
  author_name: 'Grace',
  body: GRACE_REPLY_BODY,
  is_edited: false,
  created_at: '2026-10-01T11:00:00.000Z',
};

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Case',
    managedBy: 'platform',
    fields: { id: { type: 'text', label: 'Id' }, subject: { type: 'text', label: 'Subject' } },
  },
];

type Block = 'record:activity' | 'record:discussion';

/** HotCRM `case_detail_page`'s Activity block as authored there. */
const ACTIVITY_BLOCK = {
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
    enableThreading: true,
    showCompleted: true,
  },
};

function authoredPage(block: Block) {
  return {
    name: 'case_detail_page',
    type: 'record',
    object: OBJECT_NAME,
    regions: [
      {
        name: 'main',
        components: [
          { type: 'page:header', properties: { title: '{subject}' } },
          block === 'record:activity' ? ACTIVITY_BLOCK : { type: 'record:discussion' },
        ],
      },
    ],
  };
}

/**
 * The server's `sys_comment` rows for the record. A delete removes the row from
 * them and nothing else (the server keeps a deleted comment's replies), so a
 * later read answers what the server would. An update answers with the stored
 * record, stamped the way the platform's `beforeUpdate` hook stamps a change
 * of the body (`is_edited`, `edited_at`; objectstack-ai/objectstack#23124).
 */
function makeDataSource(rows: Array<Record<string, unknown>> = ROWS) {
  let stored = rows.map((c) => ({ ...c }));
  return {
    find: vi.fn(async (objectName: string) => {
      if (objectName === COMMENT) return { data: stored.map((c) => ({ ...c })) };
      if (objectName === ACTIVITY) return { data: [] };
      return { data: [] };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, subject: `Case ${id}` })),
    create: vi.fn(async (_o: string, data: any) => ({ ...data })),
    update: vi.fn(async (objectName: string, id: string, patch: any) => {
      const row = stored.find((c) => c.id === id) ?? { id };
      const next: Record<string, unknown> = { ...row, ...patch };
      if (objectName === COMMENT && 'body' in patch && patch.body !== row.body) {
        next.is_edited = true;
        next.edited_at = '2026-10-14T12:00:00.000Z';
      }
      stored = stored.map((c) => (c.id === id ? next : c));
      return { ...next };
    }),
    delete: vi.fn(async (objectName: string, id: string) => {
      if (objectName === COMMENT) stored = stored.filter((c) => c.id !== id);
      return true;
    }),
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

/** The caller's `/me/permissions` answer: full on the record's object, `bits` on `sys_comment`. */
function answer(bits: Record<string, unknown> = FULL): MePermissionsResponse {
  return {
    authenticated: true,
    userId: auth.user.id,
    tenantId: null,
    roles: ['member'],
    permissionSets: ['member'],
    objects: { [OBJECT_NAME]: FULL, [COMMENT]: bits },
    fields: {},
  } as MePermissionsResponse;
}

interface MountOptions {
  /** The data source to read through; a second mount over the same one is a fresh read. */
  dataSource?: ReturnType<typeof makeDataSource>;
  /** The body the mount waits for before it returns. */
  firstBody?: string;
}

async function mount(block: Block, perms: MePermissionsResponse = answer(), options: MountOptions = {}) {
  const dataSource = options.dataSource ?? makeDataSource();
  const rendered = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={perms}>
        <MemoryRouter initialEntries={[`/app/service/${OBJECT_NAME}/${RECORD_ID}`]}>
          <MetadataCtx.Provider value={metadataFor([authoredPage(block)])}>
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
      </MePermissionsProvider>
    </I18nProvider>,
  );
  const view = within(rendered.container);
  await view.findByText(options.firstBody ?? ADA_BODY);
  await waitFor(() => expect(view.queryByTestId('activity-loading')).toBeNull());
  await act(async () => {});
  return { view, dataSource };
}

type View = Awaited<ReturnType<typeof mount>>['view'];

/** The feed row a body sits in: the keyed root element holding the row and its replies. */
function rowOf(view: View, body: string): HTMLElement {
  const rows = view.getByText(body).closest('.space-y-4')!.children;
  const row = Array.from(rows).find((r) => r.textContent?.includes(body));
  if (!row) throw new Error(`no feed row holds ${JSON.stringify(body)}`);
  return row as HTMLElement;
}

const editIn = (row: HTMLElement) => within(row).queryByRole('button', { name: EN.detail.editComment });
const deleteIn = (row: HTMLElement) => within(row).queryByRole('button', { name: EN.detail.deleteComment });

beforeEach(() => {
  auth.user = { id: 'u-ada', name: 'Ada', image: null };
  authorship.calls.length = 0;
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

describe.each<Block>(['record:activity', 'record:discussion'])(
  "the author's Edit and Delete on their own comment, through %s (objectui#12268)",
  (block) => {
    it("the author sees both on their own comment, and neither on another member's", async () => {
      const { view } = await mount(block);
      const ada = rowOf(view, ADA_BODY);
      expect(editIn(ada)).not.toBeNull();
      expect(deleteIn(ada)).not.toBeNull();
      for (const body of [GRACE_BODY, GRACE_EDITED_BODY]) {
        expect(editIn(rowOf(view, body))).toBeNull();
        expect(deleteIn(rowOf(view, body))).toBeNull();
      }
      expect(view.getAllByRole('button', { name: EN.detail.editComment })).toHaveLength(1);
    });

    it('whose comment it is, the page asks the one rule, @object-ui/collaboration\'s isCommentAuthor, per row', async () => {
      await mount(block);
      expect(authorship.calls).toContainEqual(['u-ada', 'u-ada']);
      expect(authorship.calls).toContainEqual(['u-grace', 'u-ada']);
    });

    it('another member sees the controls on their own comments and not on the author\'s', async () => {
      auth.user = { id: 'u-grace', name: 'Grace', image: null };
      const { view } = await mount(block);
      expect(editIn(rowOf(view, ADA_BODY))).toBeNull();
      expect(deleteIn(rowOf(view, ADA_BODY))).toBeNull();
      expect(editIn(rowOf(view, GRACE_BODY))).not.toBeNull();
      expect(deleteIn(rowOf(view, GRACE_EDITED_BODY))).not.toBeNull();
    });

    it('a comment stored as edited reads as edited, and one that is not does not', async () => {
      const { view } = await mount(block);
      expect(within(rowOf(view, GRACE_EDITED_BODY)).getByText(EN.detail.edited)).toBeInTheDocument();
      expect(within(rowOf(view, GRACE_BODY)).queryByText(EN.detail.edited)).toBeNull();
      expect(within(rowOf(view, ADA_BODY)).queryByText(EN.detail.edited)).toBeNull();
    });

    it('the author edits: the write sends the text and no edit mark, and the row then shows it and reads as edited from the server\'s answer', async () => {
      const { view, dataSource } = await mount(block);
      fireEvent.click(editIn(rowOf(view, ADA_BODY))!);
      fireEvent.change(view.getByRole('textbox', { name: EN.detail.editComment }), { target: { value: NEW_TEXT } });
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: EN.detail.save }));
      });
      expect(dataSource.update).toHaveBeenCalledTimes(1);
      const [objectName, id, patch] = dataSource.update.mock.calls[0];
      expect(objectName).toBe(COMMENT);
      expect(id).toBe('c-ada');
      expect(patch).toEqual({ body: NEW_TEXT, mentions: '[]' });
      expect(patch).not.toHaveProperty('is_edited');
      expect(patch).not.toHaveProperty('edited_at');
      expect(view.queryByText(ADA_BODY)).toBeNull();
      const row = rowOf(view, NEW_TEXT);
      expect(within(row).getByText(EN.detail.edited)).toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('the mark is the server\'s: an answer that is not stamped edited leaves the row unmarked', async () => {
      const { view, dataSource } = await mount(block);
      dataSource.update.mockImplementationOnce(async (_o: string, id: string, patch: Record<string, unknown>) => ({
        ...ADA_ROW,
        id,
        ...patch,
        is_edited: false,
      }));
      fireEvent.click(editIn(rowOf(view, ADA_BODY))!);
      fireEvent.change(view.getByRole('textbox', { name: EN.detail.editComment }), { target: { value: NEW_TEXT } });
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: EN.detail.save }));
      });
      expect(dataSource.update).toHaveBeenCalledTimes(1);
      const row = rowOf(view, NEW_TEXT);
      expect(within(row).queryByText(EN.detail.edited)).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('a refused edit raises the error, and the row keeps its old text with the draft still open', async () => {
      const { view, dataSource } = await mount(block);
      dataSource.update.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
      fireEvent.click(editIn(rowOf(view, ADA_BODY))!);
      fireEvent.change(view.getByRole('textbox', { name: EN.detail.editComment }), { target: { value: NEW_TEXT } });
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: EN.detail.save }));
      });
      expect(toast.error).toHaveBeenCalledWith(EN.detail.commentEditFailed);
      expect(view.getByRole('textbox', { name: EN.detail.editComment })).toHaveValue(NEW_TEXT);
      // Behind the editor the row is unchanged: closing it shows the old text,
      // still unmarked.
      fireEvent.click(view.getByRole('button', { name: EN.detail.cancel }));
      const row = rowOf(view, ADA_BODY);
      expect(within(row).queryByText(EN.detail.edited)).toBeNull();
      expect(view.queryByText(NEW_TEXT)).toBeNull();
    });

    it('the author deletes through the page\'s confirm: Cancel sends nothing; Delete deletes the row', async () => {
      const { view, dataSource } = await mount(block);
      fireEvent.click(deleteIn(rowOf(view, ADA_BODY))!);
      let dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText(EN.detail.deleteCommentConfirm)).toBeInTheDocument();
      expect(within(dialog).getByRole('heading')).toHaveTextContent(EN.detail.deleteComment);
      fireEvent.click(within(dialog).getByRole('button', { name: EN.actionConfirm.cancel }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(dataSource.delete).not.toHaveBeenCalled();
      expect(view.getByText(ADA_BODY)).toBeInTheDocument();

      fireEvent.click(deleteIn(rowOf(view, ADA_BODY))!);
      dialog = await screen.findByRole('alertdialog');
      const confirm = within(dialog).getByRole('button', { name: EN.objectActions.deleteConfirmButton });
      await act(async () => {
        fireEvent.click(confirm);
      });
      await waitFor(() => expect(dataSource.delete).toHaveBeenCalledTimes(1));
      expect(dataSource.delete).toHaveBeenCalledWith(COMMENT, 'c-ada');
      await waitFor(() => expect(view.queryByText(ADA_BODY)).toBeNull());
      expect(view.getByText(GRACE_BODY)).toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("deleting the author's comment keeps another member's reply to it on the page, at once and after the feed is read again", async () => {
      const dataSource = makeDataSource([ADA_ROW, GRACE_ROW, GRACE_REPLY_ROW]);
      const { view } = await mount(block, answer(), { dataSource });
      // Before: Grace's reply nests under Ada's comment, behind its toggle.
      expect(view.queryByText(GRACE_REPLY_BODY)).toBeNull();
      fireEvent.click(within(rowOf(view, ADA_BODY)).getByRole('button', { name: /1 reply/ }));
      expect(within(rowOf(view, ADA_BODY)).getByText(GRACE_REPLY_BODY)).toBeInTheDocument();

      fireEvent.click(deleteIn(rowOf(view, ADA_BODY))!);
      const dialog = await screen.findByRole('alertdialog');
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: EN.objectActions.deleteConfirmButton }));
      });
      await waitFor(() => expect(view.queryByText(ADA_BODY)).toBeNull());
      expect(dataSource.delete).toHaveBeenCalledTimes(1);
      expect(dataSource.delete).toHaveBeenCalledWith(COMMENT, 'c-ada');
      // At once: the reply is a row of its own, in the feed's list, open with
      // no toggle to press, and it is still Grace's (no controls for Ada).
      const reply = rowOf(view, GRACE_REPLY_BODY);
      expect(within(reply).getByText(GRACE_REPLY_BODY)).toBeInTheDocument();
      expect(within(reply).queryByRole('button', { name: /1 reply/ })).toBeNull();
      expect(editIn(reply)).toBeNull();
      expect(deleteIn(reply)).toBeNull();
      expect(view.getByText(GRACE_BODY)).toBeInTheDocument();
      cleanup();

      // Read again: a fresh page reads the server's rows, the reply among them
      // with a parent that no longer exists. It still shows.
      const readsBefore = dataSource.find.mock.calls.filter((c: unknown[]) => c[0] === COMMENT).length;
      const again = await mount(block, answer(), { dataSource, firstBody: GRACE_REPLY_BODY });
      expect(dataSource.find.mock.calls.filter((c: unknown[]) => c[0] === COMMENT).length).toBe(readsBefore + 1);
      expect(again.view.queryByText(ADA_BODY)).toBeNull();
      expect(rowOf(again.view, GRACE_REPLY_BODY)).toBeInTheDocument();
      expect(again.view.getByText(GRACE_BODY)).toBeInTheDocument();
    });

    it('a refused delete raises the error and the row stays', async () => {
      const { view, dataSource } = await mount(block);
      dataSource.delete.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
      fireEvent.click(deleteIn(rowOf(view, ADA_BODY))!);
      const dialog = await screen.findByRole('alertdialog');
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: EN.objectActions.deleteConfirmButton }));
      });
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(EN.detail.commentDeleteFailed));
      expect(view.getByText(ADA_BODY)).toBeInTheDocument();
    });
  },
);

describe('each control is handed over under its own grant on sys_comment (objectui#12268)', () => {
  it('without the update grant there is no Edit, and Delete stays', async () => {
    const { view } = await mount('record:activity', answer({ ...FULL, allowEdit: false }));
    expect(editIn(rowOf(view, ADA_BODY))).toBeNull();
    expect(deleteIn(rowOf(view, ADA_BODY))).not.toBeNull();
  });

  it('without the delete grant there is no Delete, and Edit stays', async () => {
    const { view } = await mount('record:activity', answer({ ...FULL, allowDelete: false }));
    expect(editIn(rowOf(view, ADA_BODY))).not.toBeNull();
    expect(deleteIn(rowOf(view, ADA_BODY))).toBeNull();
  });

  it('CONTROL: under a read-only grant the author is offered neither', async () => {
    const { view } = await mount('record:activity', answer({ allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false }));
    expect(view.queryAllByRole('button', { name: EN.detail.editComment })).toHaveLength(0);
    expect(view.queryAllByRole('button', { name: EN.detail.deleteComment })).toHaveLength(0);
  });
});
