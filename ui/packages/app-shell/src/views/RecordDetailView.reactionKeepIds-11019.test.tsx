// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A reaction click keeps every other user's stored reaction ids
 * (objectui#11019).
 *
 * `sys_comment.reactions` stores `{ emoji: userIds[] }`. A reaction click
 * writes the row's whole reaction set back through one `sys_comment` `update`,
 * and that write used to rebuild each emoji's list from its count: the clicker's
 * id when they had reacted, padded with a literal `'__other__'` up to the count.
 * So the first click by anyone replaced every other user's id on every emoji of
 * the comment, and those users' own reactions stopped reading as theirs.
 *
 * Real subjects: `RecordDetailView` rendering a record page that composes
 * `record:discussion`, driven through the real `ReactionPicker` (a chip click,
 * or the emoji picker for a reaction the row does not carry yet), over a fake
 * data source whose `sys_comment` `update` payload is the observed channel. The
 * signed-in user is the varied axis, so one case can hand the row a first user
 * stored and read it back as a second user.
 *
 * Since objectui#12078 this is the column store, which the page uses only where
 * the deployment has no `sys_comment_reaction` (the registry below lists none).
 * Where it has one, a click writes the member's own reaction row instead:
 * `RecordDetailView.reactionRecords-12078.test.tsx`.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { DETAIL_DEFAULT_TRANSLATIONS } from '@object-ui/plugin-detail';

const session = vi.hoisted(() => ({ userId: 'u1' }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: session.userId, name: session.userId, image: null }, activeOrganization: null }),
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
/** The picker's emoji set; the chips below are read against it. */
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

/**
 * One stored comment carrying `reactions` in the stored `{ emoji: userIds[] }`
 * shape. Every `update` is stored at once.
 */
function makeDataSource(reactions: Record<string, string[]>) {
  const row = {
    id: COMMENT_ID,
    thread_id: `${OBJECT_NAME}:${RECORD_ID}`,
    author_name: 'Grace',
    body: COMMENT_BODY,
    created_at: '2026-09-28T08:00:00.000Z',
    reactions: JSON.stringify(reactions),
  };
  return {
    find: vi.fn((objectName: string) => Promise.resolve({ data: objectName === 'sys_comment' ? [row] : [] })),
    create: vi.fn(async (_o: string, created: unknown) => created),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, name: `Record ${id}` })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** Mounts the record page signed in as `userId`, over `dataSource`. */
async function mountAs(userId: string, dataSource: any) {
  session.userId = userId;
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
  render(
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
  await screen.findByText(COMMENT_BODY);
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
function isOwn(emoji: string): boolean {
  const add = screen.getByRole('button', { name: ADD_REACTION });
  fireEvent.click(add);
  const option = within(screen.getByRole('listbox')).getByRole('option', { name: emoji });
  const own = option.getAttribute('aria-selected') === 'true';
  fireEvent.click(add);
  return own;
}

/** Toggles `emoji` through the emoji picker (for a reaction with no chip yet). */
function pick(emoji: string) {
  fireEvent.click(screen.getByRole('button', { name: ADD_REACTION }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: emoji }));
}

/** Runs a click, then lets the write it issued settle before going on. */
async function click(run: () => void) {
  run();
  await act(async () => {});
}

/** The reaction set write number `call` stored, parsed from the `update` payload. */
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
  session.userId = 'u1';
});

describe("a reaction click keeps every other user's stored reaction ids (objectui#11019)", () => {
  it('u1 adds a new emoji and then joins one: u2 and u3 stay stored, and u2 then takes back only u2', async () => {
    const first = makeDataSource({ '👍': ['u2', 'u3'] });
    await mountAs('u1', first);
    expect(chips()).toEqual(['👍 2']);
    expect(isOwn('👍')).toBe(false);

    await click(() => pick('❤️'));
    expect(stored(first, 0)).toEqual({ '👍': ['u2', 'u3'], '❤️': ['u1'] });

    await click(() => fireEvent.click(chip('👍')));
    expect(stored(first, 1)).toEqual({ '👍': ['u2', 'u3', 'u1'], '❤️': ['u1'] });
    expect(chips()).toEqual(['👍 3', '❤️ 1']);
    expect(first.update).toHaveBeenCalledTimes(2);

    // The row as u1's last write stored it, read by u2.
    cleanup();
    const second = makeDataSource(stored(first, 1));
    await mountAs('u2', second);
    expect(chips()).toEqual(['👍 3', '❤️ 1']);
    // u2's reaction still reads as u2's own ...
    expect(isOwn('👍')).toBe(true);
    expect(isOwn('❤️')).toBe(false);

    // ... so u2's click takes it back rather than adding a second one.
    await click(() => fireEvent.click(chip('👍')));
    expect(stored(second, 0)).toEqual({ '👍': ['u3', 'u1'], '❤️': ['u1'] });
    expect(chips()).toEqual(['👍 2', '❤️ 1']);
    expect(isOwn('👍')).toBe(false);
  });

  it("a stored '__other__' entry is kept as stored and never counted as the clicker", async () => {
    // A row an earlier build wrote with its padding marker.
    const dataSource = makeDataSource({ '👍': ['__other__', '__other__'], '🎉': ['u1', '__other__'] });
    await mountAs('u1', dataSource);
    // The read counts each marker as one reaction by someone else.
    expect(chips()).toEqual(['👍 2', '🎉 2']);
    expect(isOwn('👍')).toBe(false);
    expect(isOwn('🎉')).toBe(true);

    await click(() => fireEvent.click(chip('👍')));
    expect(stored(dataSource, 0)).toEqual({ '👍': ['__other__', '__other__', 'u1'], '🎉': ['u1', '__other__'] });

    await click(() => fireEvent.click(chip('🎉')));
    expect(stored(dataSource, 1)).toEqual({ '👍': ['__other__', '__other__', 'u1'], '🎉': ['__other__'] });
    expect(chips()).toEqual(['👍 3', '🎉 1']);
  });

  it('taking back the last id of an emoji drops that emoji from the write and keeps the rest', async () => {
    const dataSource = makeDataSource({ '👍': ['u1'], '🎉': ['u2', 'u3'] });
    await mountAs('u1', dataSource);
    expect(chips()).toEqual(['👍 1', '🎉 2']);

    await click(() => fireEvent.click(chip('👍')));
    expect(stored(dataSource, 0)).toEqual({ '🎉': ['u2', 'u3'] });
    expect(chips()).toEqual(['🎉 2']);
  });
});
