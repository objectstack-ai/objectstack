// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A reaction whose write fails does not stay shown as applied (objectui#10899 —
 * the item the epic release left on the card, the same family as item 2's
 * `commentWriteFailure-10899` pins beside this file).
 *
 * `handleToggleReaction` applies the toggle at once, which is right for a
 * reaction, and stores the row's WHOLE reaction set with one `sys_comment`
 * `update`. That write used to be issued from inside the state updater and to
 * end in a `catch` that discarded the error, so a rejected write left the
 * reaction on screen as applied, with no message, until a reload.
 *
 * Real subjects: `RecordDetailView` rendering a record page that composes
 * `record:discussion`, driven through the real `ReactionPicker` (a chip click,
 * or the emoji picker for a reaction the row does not carry yet), over a fake
 * data source whose `sys_comment` `update` is the varied axis. Each `update`
 * returns a promise the case settles by hand, so the order in which writes
 * settle is chosen rather than raced. `sonner` is the observed channel for the
 * error.
 *
 * The panel is read the way a user reads it: each chip's emoji and count from
 * its text, and whether a reaction is the signed-in user's own from the emoji
 * picker's `aria-selected` (the chip itself marks that only by colour).
 *
 * Since objectui#12078 this is the column store, which the page uses only where
 * the deployment has no `sys_comment_reaction` (the registry below lists none).
 * Where it has one, a click writes the member's own reaction row instead:
 * `RecordDetailView.reactionRecords-12078.test.tsx`.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { DETAIL_DEFAULT_TRANSLATIONS } from '@object-ui/plugin-detail';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
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

const ADD_REACTION = DETAIL_DEFAULT_TRANSLATIONS['detail.addReaction'];
const OBJECT_NAME = 'crm_customer';
const RECORD_ID = 'rec-1';
const COMMENT_ID = 'c1';
const COMMENT_BODY = 'Signed the renewal';
/** The picker's emoji set — the chips below are read against it. */
const EMOJI = ['👍', '❤️', '🎉', '😂', '😮', '😢'];

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

/** A transport refusal, shaped like the 404 the 2026-09-28 E2E recorded. */
const refusal = () => Object.assign(new Error('Object sys_comment not found'), { httpStatus: 404 });

/**
 * One stored comment carrying `reactions` in the stored `{ emoji: userIds[] }`
 * shape. Every `update` is held open and pushed onto `writes`, in call order,
 * for the case to settle.
 */
function makeDataSource(reactions: Record<string, string[]>) {
  const writes: Array<{ resolve: (row?: unknown) => void; reject: (err: unknown) => void }> = [];
  const row = {
    id: COMMENT_ID,
    thread_id: `${OBJECT_NAME}:${RECORD_ID}`,
    author_name: 'Grace',
    body: COMMENT_BODY,
    created_at: '2026-09-28T08:00:00.000Z',
    reactions: JSON.stringify(reactions),
  };
  const dataSource = {
    find: vi.fn((objectName: string) => Promise.resolve({ data: objectName === 'sys_comment' ? [row] : [] })),
    create: vi.fn(async (_o: string, created: unknown) => created),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, name: `Record ${id}` })),
    update: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          writes.push({ resolve, reject });
        }),
    ),
    delete: vi.fn(async () => ({})),
  } as any;
  return { dataSource, writes };
}

function mount(dataSource: any, wrap: (tree: React.ReactElement) => React.ReactElement = (tree) => tree) {
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
    // The registry lists this deployment's objects, and `sys_comment_reaction`
    // is not one of them, so the page keeps reactions in the
    // `sys_comment.reactions` column (objectui#12078).
    getItemsByType: (type: string) => (type === 'page' ? pages : type === 'object' ? OBJECTS : []),
  } as any;
  return render(
    wrap(
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
    ),
  );
}

/** The comment's reaction chips, in order, each as `emoji count`. */
function chips(): string[] {
  return Array.from(document.querySelectorAll('button[aria-label]'))
    .filter((b) => b.children.length === 2 && EMOJI.includes(b.children[0].textContent ?? ''))
    .map((b) => `${b.children[0].textContent} ${b.children[1].textContent}`);
}

function chip(emoji: string): HTMLElement {
  const found = Array.from(document.querySelectorAll('button[aria-label]')).find(
    (b) => b.children.length === 2 && b.children[0].textContent === emoji,
  );
  if (!found) throw new Error(`no ${emoji} chip on the panel (chips: ${chips().join(', ') || 'none'})`);
  return found as HTMLElement;
}

/** Whether the panel shows `emoji` as the signed-in user's own reaction. */
function isOwn(emoji: string, addLabel = ADD_REACTION): boolean {
  const add = screen.getByRole('button', { name: addLabel });
  fireEvent.click(add);
  const option = within(screen.getByRole('listbox')).getByRole('option', { name: emoji });
  const own = option.getAttribute('aria-selected') === 'true';
  fireEvent.click(add);
  return own;
}

/** Toggles `emoji` through the emoji picker (for a reaction with no chip yet). */
function pick(emoji: string, addLabel = ADD_REACTION) {
  fireEvent.click(screen.getByRole('button', { name: addLabel }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: emoji }));
}

/** The reaction set a write stored, parsed from the `update` payload. */
function stored(dataSource: any, call: number): Record<string, string[]> {
  const [objectName, id, patch] = dataSource.update.mock.calls[call];
  expect([objectName, id]).toEqual(['sys_comment', COMMENT_ID]);
  return JSON.parse(patch.reactions);
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

describe('a failed reaction write does not stay shown as applied (objectui#10899)', () => {
  it('a second toggle lands before the first write settles, and both writes are rejected: both toggles come off', async () => {
    const { dataSource, writes } = makeDataSource({ '👍': ['u2'] });
    mount(dataSource);
    await screen.findByText(COMMENT_BODY);

    fireEvent.click(chip('👍'));
    pick('❤️');
    expect(chips()).toEqual(['👍 2', '❤️ 1']);
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(2));

    // Settled in click order — the order a refusing tenant answers them in.
    await act(async () => writes[0].reject(refusal()));
    await act(async () => writes[1].reject(refusal()));

    await waitFor(() => expect(chips()).toEqual(['👍 1']));
    expect(isOwn('👍')).toBe(false);
    expect(isOwn('❤️')).toBe(false);
    // One rollback, so one message — the first refusal took nothing back yet.
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('the earlier write is rejected and the later one is stored: both toggles stay, because the later write stored the whole row', async () => {
    const { dataSource, writes } = makeDataSource({ '👍': ['u2'] });
    mount(dataSource);
    await screen.findByText(COMMENT_BODY);

    fireEvent.click(chip('👍'));
    pick('❤️');
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(2));
    // The later write carries the earlier toggle too.
    expect(stored(dataSource, 1)['👍']).toContain('u1');
    expect(stored(dataSource, 1)['❤️']).toContain('u1');

    await act(async () => writes[0].reject(refusal()));
    await act(async () => writes[1].resolve({}));

    expect(chips()).toEqual(['👍 2', '❤️ 1']);
    expect(isOwn('👍')).toBe(true);
    expect(isOwn('❤️')).toBe(true);
    // Nothing the user did was lost, so nothing is reported as lost.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('CONTROL — a resolved update keeps the toggle and raises no error', async () => {
    const { dataSource, writes } = makeDataSource({ '👍': ['u2'] });
    mount(dataSource);
    await screen.findByText(COMMENT_BODY);

    fireEvent.click(chip('👍'));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    await act(async () => writes[0].resolve({}));

    expect(chips()).toEqual(['👍 2']);
    expect(isOwn('👍')).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('removing your own reaction and failing to store that puts it back, in its place', async () => {
    const { dataSource, writes } = makeDataSource({ '👍': ['u1'], '🎉': ['u2'] });
    mount(dataSource);
    await screen.findByText(COMMENT_BODY);
    expect(chips()).toEqual(['👍 1', '🎉 1']);
    expect(isOwn('👍')).toBe(true);

    fireEvent.click(chip('👍'));
    // The user's own sole reaction: its chip goes away.
    expect(chips()).toEqual(['🎉 1']);
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));

    await act(async () => writes[0].reject(refusal()));

    await waitFor(() => expect(chips()).toEqual(['👍 1', '🎉 1']));
    expect(isOwn('👍')).toBe(true);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('under StrictMode, one click issues exactly one write', async () => {
    const { dataSource } = makeDataSource({ '👍': ['u2'] });
    mount(dataSource, (tree) => <React.StrictMode>{tree}</React.StrictMode>);
    await screen.findByText(COMMENT_BODY);

    fireEvent.click(chip('👍'));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalled());
    // Let anything still queued run before counting.
    await act(async () => {});
    expect(dataSource.update).toHaveBeenCalledTimes(1);
    expect(chips()).toEqual(['👍 2']);
  });

  it('a rejected `sys_comment` update puts the reaction back, count and own-mark, and raises the localized error', async () => {
    // Booted in zh with the zh catalogue resident, so "localized" is measured:
    // the error must be the catalogue's zh entry, not the English default.
    const i18n = createI18n({
      defaultLanguage: 'zh',
      detectBrowserLanguage: false,
      resources: { zh: builtInLocales.zh as unknown as Record<string, unknown> },
    });
    expect(i18n.language).toBe('zh');
    const addLabel = i18n.t('detail.addReaction');
    const { dataSource, writes } = makeDataSource({ '👍': ['u2'] });
    mount(dataSource, (tree) => <I18nProvider instance={i18n}>{tree}</I18nProvider>);
    await screen.findByText(COMMENT_BODY);
    expect(chips()).toEqual(['👍 1']);
    expect(isOwn('👍', addLabel)).toBe(false);

    fireEvent.click(chip('👍'));
    // Optimistic: the toggle shows at once, before the write settles.
    expect(chips()).toEqual(['👍 2']);
    expect(isOwn('👍', addLabel)).toBe(true);
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    expect(stored(dataSource, 0)['👍']).toContain('u1');

    await act(async () => writes[0].reject(refusal()));

    await waitFor(() => expect(chips()).toEqual(['👍 1']));
    expect(isOwn('👍', addLabel)).toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(toast.error).mock.calls[0];
    expect(message).toBe(i18n.t('detail.reactionFailed'));
    expect(message).toBe((builtInLocales.zh as any).detail.reactionFailed);
    expect(message).not.toBe((builtInLocales.en as any).detail.reactionFailed);
  });
});
