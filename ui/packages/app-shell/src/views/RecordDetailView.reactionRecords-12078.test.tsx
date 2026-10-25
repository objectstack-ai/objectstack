// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A comment's reactions are each member's own `sys_comment_reaction` records
 * (objectui#12078; ruling A amended on objectstack-ai/objectstack#22505, the
 * object landed by objectstack-ai/objectstack#22566).
 *
 * A reaction click used to write the comment's WHOLE `sys_comment.reactions`
 * set back through one `update`, so two members reacting at the same moment
 * left only the later write stored. Now, where the deployment has the object,
 * the chatter reads every comment's reaction rows in one batched `comment_id`
 * `$in` read, groups them into the shape the panel already renders, and a click
 * creates or deletes the clicker's own row. Where the deployment has no such
 * object (a framework that predates it), the column path stays, unchanged: the
 * `objectui#11019` / `objectui#10899` / `objectui#11035` pins beside this file
 * run on that path.
 *
 * Real subjects: `RecordDetailView` rendering a record page that composes
 * `record:discussion`, driven through the real `ReactionPicker`. The data
 * source is a fake SERVER shared by every mounted view: each view's adapter is
 * bound to its signed-in member, and the server keeps the object's declared
 * rules: `user_id` stamped from that member, one row per (comment, emoji,
 * user), and a member deletes only their own row. Which store the page uses is
 * read from the object registry the page's metadata context serves.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { DETAIL_DEFAULT_TRANSLATIONS } from '@object-ui/plugin-detail';
import { toast } from 'sonner';

/** The signed-in member is read from a context, so two views can be two members at once. */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown as React.Context<string> }));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const ReactModule = await import('react');
  signedIn.ctx = ReactModule.createContext('u1');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => {
      const id = ReactModule.useContext(signedIn.ctx);
      return { user: { id, name: id, image: null }, activeOrganization: null };
    },
    createAuthenticatedFetch: () => vi.fn(),
  };
});

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

const REACTION = 'sys_comment_reaction';
const ADD_REACTION = DETAIL_DEFAULT_TRANSLATIONS['detail.addReaction'];
const OBJECT_NAME = 'crm_customer';
const RECORD_ID = 'rec-1';
const THREAD = `${OBJECT_NAME}:${RECORD_ID}`;
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

/** The object registry each case serves: with the reaction object, without it, or listing nothing. */
const REGISTRY = {
  present: [...OBJECTS, { name: REACTION, label: 'Comment Reaction' }],
  absent: OBJECTS,
  empty: [] as unknown[],
};

interface ReactionRow {
  id: string;
  comment_id: string;
  emoji: string;
  user_id: string;
  created_at: string;
}

interface CommentRow {
  id: string;
  thread_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  reactions?: string;
}

const refusal = (status: number, code: string) =>
  Object.assign(new Error(code), { httpStatus: status, status, code });

/**
 * One server shared by every view a case mounts. `as(member)` is that member's
 * adapter: what they create is stamped as theirs, and they delete only rows
 * that are theirs.
 */
function makeServer(init: { comments?: CommentRow[]; reactions?: Omit<ReactionRow, 'id' | 'created_at'>[] } = {}) {
  const comments: CommentRow[] = init.comments ?? [
    {
      id: COMMENT_ID,
      thread_id: THREAD,
      author_id: 'u3',
      author_name: 'u3',
      body: COMMENT_BODY,
      created_at: '2026-10-10T08:00:00.000Z',
    },
  ];
  let seq = 0;
  const reactions: ReactionRow[] = [];
  const insert = (row: Omit<ReactionRow, 'id' | 'created_at'>) => {
    seq += 1;
    const stored = { ...row, id: `r${seq}`, created_at: new Date(Date.UTC(2026, 9, 10, 9, 0, seq)).toISOString() };
    reactions.push(stored);
    return stored;
  };
  for (const row of init.reactions ?? []) insert(row);

  const as = (member: string) => ({
    find: vi.fn(async (objectName: string, params?: any) => {
      if (objectName === 'sys_comment') return { data: comments.map((c) => ({ ...c })) };
      if (objectName === REACTION) {
        const ids: string[] = params?.$filter?.comment_id?.$in ?? [];
        return { data: reactions.filter((r) => ids.includes(r.comment_id)).map((r) => ({ ...r })) };
      }
      return { data: [] };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, name: `Record ${id}` })),
    create: vi.fn(async (objectName: string, data: any) => {
      if (objectName !== REACTION) return data;
      // The declared unique index, (comment_id, emoji, user_id).
      if (reactions.some((r) => r.comment_id === data.comment_id && r.emoji === data.emoji && r.user_id === member)) {
        throw refusal(409, 'UNIQUE_VIOLATION');
      }
      // `user_id` is stamped from the session; a client value never wins.
      return { ...insert({ comment_id: data.comment_id, emoji: data.emoji, user_id: member }) };
    }),
    update: vi.fn(async (objectName: string, id: string, patch: any) => {
      const comment = objectName === 'sys_comment' ? comments.find((c) => c.id === id) : undefined;
      if (comment) Object.assign(comment, patch);
      return { ...comment };
    }),
    delete: vi.fn(async (objectName: string, id: string) => {
      if (objectName !== REACTION) return true;
      const at = reactions.findIndex((r) => r.id === id);
      if (at < 0) throw refusal(404, 'RECORD_NOT_FOUND');
      // The platform's own-record delete floor.
      if (reactions[at].user_id !== member) throw refusal(403, 'PERMISSION_DENIED');
      reactions.splice(at, 1);
      return true;
    }),
  });

  return { comments, reactions, as };
}

function metadataFor(objects: unknown[], status: 'loading' | 'ready' = 'ready') {
  const pages = [PAGE];
  return {
    objects,
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'page' ? pages : type === 'object' ? objects : []),
    getTypeStatus: () => status,
  } as any;
}

function tree(member: string, dataSource: any, metadata: any) {
  return (
    <signedIn.ctx.Provider value={member}>
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
      </MemoryRouter>
    </signedIn.ctx.Provider>
  );
}

/** Mounts the record page as `member` and waits for the comment to show. */
async function mountAs(member: string, dataSource: any, objects: unknown[] = REGISTRY.present) {
  const view = render(tree(member, dataSource, metadataFor(objects)));
  await within(view.container).findByText(COMMENT_BODY);
  // Let the reaction read that follows the comment read land.
  await act(async () => {});
  return within(view.container);
}

type View = ReturnType<typeof within>;

/** The view's reaction chips: a labelled button holding an emoji and a count. */
function chipButtons(view: View): HTMLElement[] {
  return (view.queryAllByRole('button') as HTMLElement[]).filter(
    (b) => !!b.getAttribute('aria-label') && b.children.length === 2 && EMOJI.includes(b.children[0].textContent ?? ''),
  );
}

/** The comment's reaction chips, in order, each as `emoji count`. */
function chips(view: View): string[] {
  return chipButtons(view).map((b) => `${b.children[0].textContent} ${b.children[1].textContent}`);
}

function chip(view: View, emoji: string): HTMLElement {
  const found = chipButtons(view).find((b) => b.children[0].textContent === emoji);
  if (!found) throw new Error(`no ${emoji} chip on the panel (chips: ${chips(view).join(', ') || 'none'})`);
  return found;
}

/** Whether the panel shows `emoji` as the signed-in member's own reaction. */
function isOwn(view: View, emoji: string): boolean {
  const add = view.getByRole('button', { name: ADD_REACTION });
  fireEvent.click(add);
  const option = within(screen.getByRole('listbox')).getByRole('option', { name: emoji });
  const own = option.getAttribute('aria-selected') === 'true';
  fireEvent.click(add);
  return own;
}

/** Toggles `emoji` through the emoji picker (for a reaction with no chip yet). */
function pick(view: View, emoji: string) {
  fireEvent.click(view.getByRole('button', { name: ADD_REACTION }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: emoji }));
}

/** Runs a click, then lets the writes it queued answer before going on. */
async function click(run: () => void) {
  run();
  await act(async () => {});
}

/** Every `sys_comment_reaction` read a data source was asked, as its `$in` id lists. */
function reactionReads(dataSource: any): string[][] {
  return dataSource.find.mock.calls
    .filter(([objectName]: [string]) => objectName === REACTION)
    .map(([, params]: [string, any]) => params.$filter.comment_id.$in);
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

describe("a comment's reactions are each member's own sys_comment_reaction records (objectui#12078)", () => {
  it("a member's click on another member's comment creates their own reaction record, and the feed renders it grouped", async () => {
    // The comment is u3's; u2 has already reacted.
    const server = makeServer({ reactions: [{ comment_id: COMMENT_ID, emoji: '👍', user_id: 'u2' }] });
    const u1 = server.as('u1');
    const view = await mountAs('u1', u1);
    expect(chips(view)).toEqual(['👍 1']);
    expect(isOwn(view, '👍')).toBe(false);

    await click(() => fireEvent.click(chip(view, '👍')));
    // u1's own row, and nothing else: no user id from the client, no comment write.
    expect(u1.create.mock.calls).toEqual([[REACTION, { comment_id: COMMENT_ID, emoji: '👍' }]]);
    expect(u1.update).not.toHaveBeenCalled();
    expect(server.reactions.map((r) => [r.emoji, r.user_id])).toEqual([
      ['👍', 'u2'],
      ['👍', 'u1'],
    ]);
    expect(chips(view)).toEqual(['👍 2']);
    expect(isOwn(view, '👍')).toBe(true);

    // A fresh read groups the two rows into one chip, the clicker's marked own.
    cleanup();
    const again = await mountAs('u1', server.as('u1'));
    expect(chips(again)).toEqual(['👍 2']);
    expect(isOwn(again, '👍')).toBe(true);
  });

  it('a second click removes it: the clicker deletes their own row, by the id the create returned and by the id the read returned', async () => {
    const server = makeServer({ reactions: [{ comment_id: COMMENT_ID, emoji: '👍', user_id: 'u2' }] });
    const u1 = server.as('u1');
    const view = await mountAs('u1', u1);

    await click(() => pick(view, '🎉'));
    const [created] = server.reactions.filter((r) => r.user_id === 'u1');
    expect(chips(view)).toEqual(['👍 1', '🎉 1']);

    await click(() => fireEvent.click(chip(view, '🎉')));
    expect(u1.delete.mock.calls).toEqual([[REACTION, created.id]]);
    expect(server.reactions.map((r) => [r.emoji, r.user_id])).toEqual([['👍', 'u2']]);
    expect(chips(view)).toEqual(['👍 1']);

    // A row the read found: its id is the one the take-back deletes.
    cleanup();
    const before = makeServer({
      reactions: [
        { comment_id: COMMENT_ID, emoji: '👍', user_id: 'u2' },
        { comment_id: COMMENT_ID, emoji: '👍', user_id: 'u1' },
      ],
    });
    const mine = before.reactions.find((r) => r.user_id === 'u1')!;
    const reader = before.as('u1');
    const read = await mountAs('u1', reader);
    expect(chips(read)).toEqual(['👍 2']);
    await click(() => fireEvent.click(chip(read, '👍')));
    expect(reader.delete.mock.calls).toEqual([[REACTION, mine.id]]);
    expect(before.reactions.map((r) => r.user_id)).toEqual(['u2']);
    expect(chips(read)).toEqual(['👍 1']);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('two members reacting at once both show', async () => {
    const server = makeServer();
    const u1 = server.as('u1');
    const u2 = server.as('u2');
    // Both members have the comment open, and both read it with no reactions.
    const first = await mountAs('u1', u1);
    const second = await mountAs('u2', u2);
    expect(chips(first)).toEqual([]);
    expect(chips(second)).toEqual([]);

    // Both react before either write has answered.
    pick(first, '👍');
    pick(second, '👍');
    await act(async () => {});

    // The comment's author reads it afterwards and sees both reactions.
    const author = await mountAs('u3', server.as('u3'));
    expect(chips(author)).toEqual(['👍 2']);
    expect(isOwn(author, '👍')).toBe(false);
  });

  it('the feed reads every comment’s reactions in one batched read, and pages it only past 100 comment ids', async () => {
    const thread = (n: number): CommentRow[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `c${i + 1}`,
        thread_id: THREAD,
        author_id: 'u3',
        author_name: 'u3',
        body: i === 0 ? COMMENT_BODY : `Comment ${i + 1}`,
        created_at: new Date(Date.UTC(2026, 9, 10, 8, 0, i)).toISOString(),
      }));

    const three = makeServer({ comments: thread(3), reactions: [{ comment_id: 'c3', emoji: '🎉', user_id: 'u2' }] });
    const small = three.as('u1');
    const view = await mountAs('u1', small);
    expect(reactionReads(small)).toEqual([['c1', 'c2', 'c3']]);
    // Grouped onto the comment it is on, and only that one.
    expect(chips(view)).toEqual(['🎉 1']);

    cleanup();
    const busy = makeServer({ comments: thread(250) });
    const large = busy.as('u1');
    render(tree('u1', large, metadataFor(REGISTRY.present)));
    await waitFor(() => expect(reactionReads(large)).toHaveLength(3));
    const pages = reactionReads(large);
    expect(pages.map((ids) => ids.length)).toEqual([100, 100, 50]);
    expect(pages.flat()).toEqual(thread(250).map((c) => c.id));
  });

  it('a reaction stored only in the retired sys_comment.reactions column is not shown on the records path', async () => {
    // The maintainer ruled no migration of the column's reactions
    // (objectstack-ai/objectstack#22505); this is what a member sees.
    const server = makeServer({
      comments: [
        {
          id: COMMENT_ID,
          thread_id: THREAD,
          author_id: 'u3',
          author_name: 'u3',
          body: COMMENT_BODY,
          created_at: '2026-10-10T08:00:00.000Z',
          reactions: JSON.stringify({ '👍': ['u2'] }),
        },
      ],
    });
    const view = await mountAs('u1', server.as('u1'));
    expect(chips(view)).toEqual([]);
  });

  it('a refused create puts the reaction back and raises the error once; nothing stored is lost', async () => {
    const server = makeServer({ reactions: [{ comment_id: COMMENT_ID, emoji: '👍', user_id: 'u2' }] });
    const u1 = server.as('u1');
    u1.create.mockImplementationOnce(async () => {
      throw refusal(403, 'PERMISSION_DENIED');
    });
    const view = await mountAs('u1', u1);

    fireEvent.click(chip(view, '👍'));
    expect(chips(view)).toEqual(['👍 2']);
    await act(async () => {});

    await waitFor(() => expect(chips(view)).toEqual(['👍 1']));
    expect(isOwn(view, '👍')).toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(server.reactions.map((r) => r.user_id)).toEqual(['u2']);
  });

  it('a take-back clicked before the create answers deletes the row that create made', async () => {
    const server = makeServer();
    const u1 = server.as('u1');
    let answer!: () => void;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const create = u1.create.getMockImplementation()!;
    u1.create.mockImplementationOnce(async (...args: [string, any]) => {
      await held;
      return create(...args);
    });
    const view = await mountAs('u1', u1);

    pick(view, '👍');
    fireEvent.click(chip(view, '👍'));
    expect(chips(view)).toEqual([]);
    await act(async () => {});
    // The take-back waits for the row it takes back.
    expect(u1.delete).not.toHaveBeenCalled();

    await act(async () => answer());
    await waitFor(() => expect(u1.delete).toHaveBeenCalledTimes(1));
    expect(u1.delete.mock.calls[0]).toEqual([REACTION, 'r1']);
    expect(server.reactions).toEqual([]);
    expect(chips(view)).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('which store the chatter uses is read from the object registry (objectui#12078)', () => {
  it('a deployment without sys_comment_reaction keeps the column path: no reaction read, and the click writes sys_comment.reactions', async () => {
    const server = makeServer({
      comments: [
        {
          id: COMMENT_ID,
          thread_id: THREAD,
          author_id: 'u3',
          author_name: 'u3',
          body: COMMENT_BODY,
          created_at: '2026-10-10T08:00:00.000Z',
          reactions: JSON.stringify({ '👍': ['u2'] }),
        },
      ],
    });
    const u1 = server.as('u1');
    const view = await mountAs('u1', u1, REGISTRY.absent);
    expect(chips(view)).toEqual(['👍 1']);
    expect(reactionReads(u1)).toEqual([]);

    await click(() => fireEvent.click(chip(view, '👍')));
    expect(u1.create).not.toHaveBeenCalled();
    expect(u1.update).toHaveBeenCalledTimes(1);
    const [objectName, id, patch] = u1.update.mock.calls[0];
    expect([objectName, id]).toEqual(['sys_comment', COMMENT_ID]);
    expect(JSON.parse(patch.reactions)).toEqual({ '👍': ['u2', 'u1'] });
    expect(chips(view)).toEqual(['👍 2']);
  });

  it('a registry that lists no objects is not evidence of absence: the records path', async () => {
    const server = makeServer({ reactions: [{ comment_id: COMMENT_ID, emoji: '👍', user_id: 'u2' }] });
    const u1 = server.as('u1');
    const view = await mountAs('u1', u1, REGISTRY.empty);
    expect(reactionReads(u1)).toEqual([[COMMENT_ID]]);
    expect(chips(view)).toEqual(['👍 1']);
  });

  it('the comment read waits until the registry has answered', async () => {
    const server = makeServer({ reactions: [{ comment_id: COMMENT_ID, emoji: '👍', user_id: 'u2' }] });
    const u1 = server.as('u1');
    const view = render(tree('u1', u1, metadataFor(REGISTRY.present, 'loading')));
    await act(async () => {});
    expect(u1.find.mock.calls.filter((call) => call[0] === 'sys_comment')).toEqual([]);

    view.rerender(tree('u1', u1, metadataFor(REGISTRY.present, 'ready')));
    await within(view.container).findByText(COMMENT_BODY);
    await act(async () => {});
    expect(reactionReads(u1)).toEqual([[COMMENT_ID]]);
    expect(chips(within(view.container))).toEqual(['👍 1']);
  });
});
