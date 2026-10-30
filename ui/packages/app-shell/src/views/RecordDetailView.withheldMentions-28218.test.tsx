// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The comment author is told, in one sentence, who a mention will not reach
 * (objectstack#28218, ruling A on objectstack#27703).
 *
 * The server withholds the notification of a mentioned user the mention gate
 * refuses, and answers their ids to the author's own write as
 * `withheldMentions`. The record page's three comment writes (a comment, a
 * reply, an edit) hear that member through the data source's per-call
 * `onMentionsWithheld` listener, map the ids to names through the mention
 * picker's suggestions (the `sys_user` read the composer offers), and raise one
 * warning naming them, with no reason given. A write that withheld nobody says
 * nothing.
 *
 * Real subjects: `RecordDetailView` on an authored page composing
 * `record:discussion`, driven through its real composer, reply input and edit
 * form, under a real `I18nProvider` with the `en` pack read by key. The data
 * source double answers the listener the way `ObjectStackAdapter` does.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { builtInLocales } from '@object-ui/i18n/locales';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u-ada', name: 'Ada', image: null }, activeOrganization: null }),
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

import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

type Pack = {
  detail: {
    mentionsWithheld: string;
    leaveCommentPlaceholder: string;
    submitComment: string;
    replyPlaceholder: string;
    editComment: string;
    save: string;
  };
  validation: { formInvalidJoiner: string };
};
/** The pack, read by key: the pin is which copy shows and whom it names. */
const EN = builtInLocales.en as unknown as Pack;
const withheldSentence = (...names: string[]) =>
  EN.detail.mentionsWithheld.replace('{{names}}', names.join(EN.validation.formInvalidJoiner));

const COMMENT = 'sys_comment';
const OBJECT_NAME = 'crm_case';
const RECORD_ID = 'case-7';
const THREAD = `${OBJECT_NAME}:${RECORD_ID}`;

/** The picker's roster: the `sys_user` read the page offers as suggestions. */
const USERS = [
  { id: 'u-ada', name: 'Ada' },
  { id: 'u-grace', name: 'Grace Hopper' },
  { id: 'u-linus', name: 'Linus' },
];

const ADA_ROW = {
  id: 'c-ada',
  thread_id: THREAD,
  author_id: 'u-ada',
  author_name: 'Ada',
  body: 'Customer called back about the outage',
  is_edited: false,
  created_at: '2026-10-01T08:00:00.000Z',
};

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Case',
    managedBy: 'platform',
    fields: { id: { type: 'text', label: 'Id' }, subject: { type: 'text', label: 'Subject' } },
  },
];

const PAGE = {
  name: 'case_record_page',
  type: 'record',
  object: OBJECT_NAME,
  regions: [
    { name: 'main', components: [{ type: 'page:header', properties: { title: '{subject}' } }, { type: 'record:discussion' }] },
  ],
};

type WriteOpts = { onMentionsWithheld?: (ids: string[]) => void } | undefined;

/**
 * `withheld` is what the server's mention gate refuses: a write that mentions
 * any of those ids answers them to the listener, as `ObjectStackAdapter` hands
 * the answer's `withheldMentions` on.
 */
function makeDataSource(withheld: string[]) {
  const answer = (mentions: unknown, opts: WriteOpts) => {
    const named: string[] = JSON.parse(String(mentions ?? '[]'));
    const ids = named.filter((id) => withheld.includes(id));
    if (ids.length > 0) opts?.onMentionsWithheld?.(ids);
  };
  return {
    find: vi.fn(async (objectName: string) => {
      if (objectName === COMMENT) return { data: [{ ...ADA_ROW }] };
      if (objectName === 'sys_user') return { data: USERS.map((u) => ({ ...u })) };
      return { data: [] };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, subject: `Case ${id}` })),
    create: vi.fn(async (_o: string, data: any, opts?: WriteOpts) => {
      answer(data.mentions, opts);
      return { ...data };
    }),
    update: vi.fn(async (_o: string, id: string, patch: any, opts?: WriteOpts) => {
      answer(patch.mentions, opts);
      return { ...ADA_ROW, id, ...patch, is_edited: true };
    }),
    delete: vi.fn(async () => true),
  } as any;
}

async function mount(dataSource: ReturnType<typeof makeDataSource>) {
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
    getItemsByType: (type: string) => (type === 'page' ? pages : type === 'object' ? OBJECTS : []),
    getTypeStatus: () => 'ready',
  } as any;
  const rendered = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/app/service/${OBJECT_NAME}/${RECORD_ID}`]}>
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
      </MemoryRouter>
    </I18nProvider>,
  );
  const view = within(rendered.container);
  await view.findByText(ADA_ROW.body);
  // The picker's roster has been read: the suggestions the writes map through.
  await waitFor(() => expect(dataSource.find).toHaveBeenCalledWith('sys_user', expect.anything()));
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof mount>>;

async function postComment(view: View, text: string) {
  const box = await view.findByPlaceholderText(EN.detail.leaveCommentPlaceholder);
  fireEvent.change(box, { target: { value: text } });
  await act(async () => {
    fireEvent.click(view.getByTitle(EN.detail.submitComment));
  });
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

describe('the comment author is told who a mention will not reach (objectstack#28218)', () => {
  it('a comment: one warning names the withheld users by their picker names, and the comment is posted', async () => {
    const dataSource = makeDataSource(['u-grace', 'u-linus']);
    const view = await mount(dataSource);

    await postComment(view, 'Please check @Grace Hopper and @Linus before Friday');

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(toast.warning).toHaveBeenCalledWith(withheldSentence('Grace Hopper', 'Linus'));
    // The write sent every mention; the server decides who is told.
    const [, row] = dataSource.create.mock.calls[0];
    expect(JSON.parse(row.mentions)).toEqual(['u-grace', 'u-linus']);
    expect(
      await view.findByText('Please check @Grace Hopper and @Linus before Friday', { selector: ':not(textarea):not(input)' }),
    ).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('only the withheld users are named: a mention the server will deliver is not in the sentence', async () => {
    const dataSource = makeDataSource(['u-linus']);
    const view = await mount(dataSource);

    await postComment(view, '@Grace Hopper and @Linus, see above');

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(toast.warning).toHaveBeenCalledWith(withheldSentence('Linus'));
  });

  it('control: a comment whose mentions all reach their users says nothing', async () => {
    const dataSource = makeDataSource([]);
    const view = await mount(dataSource);

    await postComment(view, 'Thanks @Grace Hopper');

    expect(
      await view.findByText('Thanks @Grace Hopper', { selector: ':not(textarea):not(input)' }),
    ).toBeInTheDocument();
    expect(dataSource.create).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('a reply names the withheld users the same way', async () => {
    const dataSource = makeDataSource(['u-grace']);
    const view = await mount(dataSource);

    const input = await view.findByPlaceholderText(EN.detail.replyPlaceholder);
    fireEvent.change(input, { target: { value: '@Grace Hopper can you confirm?' } });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Send reply' }));
    });

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(toast.warning).toHaveBeenCalledWith(withheldSentence('Grace Hopper'));
    expect(dataSource.create).toHaveBeenCalledWith(
      COMMENT,
      expect.objectContaining({ parent_id: 'c-ada', mentions: JSON.stringify(['u-grace']) }),
      { onMentionsWithheld: expect.any(Function) },
    );
  });

  it('an edit that adds a mention names the withheld user the same way', async () => {
    const dataSource = makeDataSource(['u-linus']);
    const view = await mount(dataSource);

    fireEvent.click(view.getByRole('button', { name: EN.detail.editComment }));
    fireEvent.change(view.getByRole('textbox', { name: EN.detail.editComment }), {
      target: { value: 'Customer called back about the outage, @Linus FYI' },
    });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: EN.detail.save }));
    });

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(toast.warning).toHaveBeenCalledWith(withheldSentence('Linus'));
    expect(dataSource.update).toHaveBeenCalledWith(
      COMMENT,
      'c-ada',
      { body: 'Customer called back about the outage, @Linus FYI', mentions: JSON.stringify(['u-linus']) },
      { onMentionsWithheld: expect.any(Function) },
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
