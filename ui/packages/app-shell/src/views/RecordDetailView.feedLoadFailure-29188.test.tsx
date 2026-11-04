/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29188 — a FAILED feed read is not an empty feed.
 *
 * Measured on main before this change (this rig, the real adapter): a 500 on
 * the comments read, whether the page payload's `discussion` part or a direct
 * `sys_comment` GET, settled the 动态 panel on "No activity recorded" and the
 * 动态 tab's badge on 0. On staging that hid a `DATABASE_ERROR` on every
 * hosted environment (cloud#3485), so comments users wrote looked lost.
 *
 * Pinned here, on the rendered page:
 *   1. a 500 on the comments read (payload part, and direct GET) shows the
 *      load-failure notice with a Retry, never the empty state, and the 动态
 *      tab names no count;
 *   2. the same for the activity read;
 *   3. Retry re-reads only the failed source, directly, and the comments
 *      replace the notice once the server answers;
 *   4. control: an empty 200 still shows the empty state, with no notice;
 *   5. a refusal (403) keeps its no-permission state and offers no Retry;
 *   6. attachments: a 500 on the payload's attachments part shows the panel's
 *      own load-failure state with a Retry and leaves the badge's count
 *      unknown (main already did; pinned, no attachments code changed).
 *
 * The rig is `RecordDetailView.recordOpenOneRequest-28470.test.tsx`'s.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

import { MetadataCtx } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { __clearRecordEditableCache } from '../../../plugin-detail/src/useRecordEditable';
import { __resetRecordApprovalsStore } from '../hooks/useRecordApprovals';
import { RecordDetailView } from './RecordDetailView';
import { recordAttachmentsCountField } from './recordPagePayload';
// The `record:attachments` block the synthesized page places for `enable.files`
// (registered by the package entry, which this file does not import).
import './record-attachments-renderer';

const BASE = 'http://test.local';
const OBJECT = 'os_29188_contact';
const CHILD = 'os_29188_task';

const contactDef = {
  name: OBJECT,
  label: 'Contact',
  enable: { files: true },
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    account: { label: 'Account', type: 'lookup', reference: 'os_29188_account' },
  },
};
const accountDef = { name: 'os_29188_account', label: 'Account', fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Name', type: 'text' } } };
const childDef = {
  name: CHILD,
  label: 'Task',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    contact: { label: 'Contact', type: 'lookup', reference: OBJECT },
    owner: { label: 'Owner', type: 'lookup', reference: 'sys_user' },
  },
};
const ALL = [contactDef, accountDef, childDef];

const COMMENT = { id: 'cm1', thread_id: `${OBJECT}:c1`, author_id: 'u2', author_name: 'Grace', body: 'hello from the payload', created_at: '2026-10-01T10:00:00.000Z' };
const ACTIVITY = { id: 'ac1', type: 'created', object_name: OBJECT, record_id: 'c1', actor_name: 'Grace', summary: 'created the contact', timestamp: '2026-09-30T10:00:00.000Z' };
const ATTACHMENT = { id: 'f1', parent_object: OBJECT, parent_id: 'c1', file_id: 'file-1', file_name: 'contract.pdf', created_at: '2026-10-02T10:00:00.000Z' };

interface Answers {
  /** Answer the related rows' owner as a bare id even when the request expands it. */
  ignoreExpand?: boolean;
  activity?: unknown;
  discussion?: unknown;
  attachments?: unknown;
  /** Objects whose direct GET answers 500; `object@record` limits it to that record's thread. */
  failGet?: string[];
  /** Answers for one record's page read, over the rest (objectstack#30145). */
  byRecord?: Record<string, Pick<Answers, 'activity' | 'discussion' | 'attachments'>>;
}

interface Held { method: string; path: string; body: any; released: boolean; release: () => void }

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function pageAnswer(id: string, body: any, all: Answers) {
  const answers: Answers = { ...all, ...all.byRecord?.[id] };
  return {
    success: true,
    data: {
      object: OBJECT,
      id,
      record: { id, name: `Contact ${id}`, account: 'a1' },
      related: (body.related ?? []).map((r: any) => ({
        object: r.object,
        field: r.field,
        total: 2,
        records: [0, 1].slice(0, r.top).map((i) => ({
          id: `t${i}`,
          name: `Task ${i}`,
          contact: id,
          owner: !answers.ignoreExpand && r.expand?.includes('owner') ? { id: 'u9', name: 'Una Owner' } : 'u9',
        })),
      })),
      ...(body.fieldAccess ? { fieldAccess: { object: OBJECT, recordId: id, readable: ['name', 'account'], editable: ['name'], writable: true } } : {}),
      ...(body.explain ? { explain: Object.fromEntries(body.explain.map((op: string) => [op, { allowed: true, record: { recordId: id, visible: true } }])) } : {}),
      ...(body.approvals ? { approvals: { requests: [], lock: { locked: false } } } : {}),
      ...(body.discussion ? { discussion: answers.discussion ?? { comments: [COMMENT], reactions: { records: [] } } } : {}),
      ...(body.activity ? { activity: answers.activity ?? { total: 1, records: [ACTIVITY] } } : {}),
      ...(body.attachments ? { attachments: answers.attachments ?? { total: 3, records: [ATTACHMENT] } } : {}),
    },
  };
}

function answerFor(h: Held, answers: Answers): unknown {
  const meta = /\/api\/v1\/meta\/object\/([^/?]+)/.exec(h.path);
  if (meta) return { success: true, data: ALL.find((o) => o.name === meta[1]) ?? null };
  const page = /\/api\/v1\/data\/[^/?]+\/([^/?]+)\/page$/.exec(h.path);
  if (page) return pageAnswer(page[1], h.body, answers);
  const one = new RegExp(`/api/v1/data/${OBJECT}\\?.*\\["id","=","([^"]+)"\\]`).exec(h.path);
  if (one) return { success: true, data: { records: [{ id: one[1], name: `Contact ${one[1]}`, account: 'a1' }], total: 1 } };
  if (h.path.startsWith('/api/v1/data/sys_user?')) return { success: true, data: { records: [{ id: 'u9', name: 'Una Owner' }], total: 1 } };
  return { success: true, data: { records: [], total: 0 } };
}

function heldTransport(answers: Answers) {
  const held: Held[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = decodeURIComponent(url.replace(BASE, ''));
    if (path.endsWith('/api/v1/discovery')) return Promise.resolve(json({ success: true, data: { capabilities: {}, routes: {} } }));
    return new Promise<Response>((resolve) => {
      const h: Held = {
        method, path,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        released: false,
        release: () => { if (h.released) return; h.released = true; const fail = (answers.failGet ?? []).some((spec) => { const [o, rec] = spec.split('@'); return method === 'GET' && path.startsWith(`/api/v1/data/${o}?`) && (!rec || path.includes(`${OBJECT}:${rec}`)); }); resolve(fail ? new Response(JSON.stringify({ success: false, error: { code: 'DATABASE_ERROR', message: 'db down' } }), { status: 500, headers: { 'content-type': 'application/json' } }) : json(answerFor(h, answers))); },
      };
      held.push(h);
    });
  });
  return { fetch, held };
}

async function idle() {
  await act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
}
async function settle(held: Held[]) {
  await idle();
  for (let round = 0; round < 12; round++) {
    const pending = held.filter((h) => !h.released);
    if (pending.length === 0) return;
    await act(async () => { for (const h of pending) h.release(); await new Promise((r) => setTimeout(r, 0)); });
    await idle();
  }
}

const readsOf = (held: Held[], object: string) => held.filter((h) => h.method === 'GET' && h.path.startsWith(`/api/v1/data/${object}?`));
/** The retired stream reads, by object. */
const STREAMS = ['sys_comment', 'sys_comment_reaction', 'sys_activity', 'sys_attachment'];
const streamReads = (held: Held[]) => STREAMS.flatMap((o) => readsOf(held, o).map(() => o));

beforeEach(() => {
  cleanup();
  __clearRecordEditableCache();
  __resetRecordApprovalsStore();
  RelatedCountStore._reset();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function boot(answers: Answers = {}) {
  const { fetch, held } = heldTransport(answers);
  vi.stubGlobal('fetch', fetch);
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  const metadata = {
    objects: ALL, pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  const page = (id: string) => (
    <React.StrictMode>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/record/c1`]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDetailView dataSource={ds as never} objects={ALL as never} onEdit={() => {}} objectNameOverride={OBJECT} recordIdOverride={id} />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </React.StrictMode>
  );
  const open = () => render(page('c1'));
  /** Swap the record on the mounted view, as the drawers and the Console do. */
  const navigate = (view: ReturnType<typeof render>, id: string) => view.rerender(page(id));
  return { held, open, navigate, ds };
}

const FAIL = { error: { code: 'DATABASE_ERROR', status: 500, message: 'db down' } };
const EMPTY_ACTIVITY = 'No activity recorded';
const COMMENTS_FAILED = "We couldn't load the comments for this record.";
const ACTIVITY_FAILED = "We couldn't load the activity for this record.";
const NO_COMMENTS = { comments: [], reactions: { records: [] } };
const NO_ACTIVITY = { total: 0, records: [] };

const peekOf = (c: HTMLElement) => c.querySelector('[data-record-timeline-peek]') as HTMLElement;
const failedSources = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[data-failed-source]')).map((e) => e.getAttribute('data-failed-source'));
const retryButton = (c: HTMLElement) => c.querySelector('[data-feed-retry]') as HTMLButtonElement | null;
/** The 动态 tab's label, badge included. */
const timelineTab = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[role="tab"]')).find((t) => /^Activity/.test(t.textContent ?? ''))?.textContent;
/** Open the record over an adapter that reads every stream on its own. */
async function bootDirect(answers: Answers) {
  const booted = await boot(answers);
  Object.assign(booted.ds, { getRecordPage: undefined, prefetchRecordPage: undefined });
  return booted;
}

describe('objectstack#29188 — a failed comments read shows the load-failure notice', () => {
  it('a 500 discussion part shows the notice with a Retry, not the empty state, and no count', async () => {
    const { held, open } = await boot({ discussion: FAIL, activity: NO_ACTIVITY, attachments: { total: 0, records: [] } });
    const view = open();
    await settle(held);
    const peek = peekOf(view.container);
    expect(failedSources(peek)).toEqual(['comments']);
    expect(peek.textContent).toContain(COMMENTS_FAILED);
    expect(peek.textContent).not.toContain(EMPTY_ACTIVITY);
    expect(retryButton(peek)).not.toBeNull();
    // Only the sentence: no status code, no server text, no table name.
    expect(peek.textContent).not.toMatch(/500|DATABASE_ERROR|db down|sys_comment/);
    // The stream's count is unknown, not 0.
    expect(timelineTab(view.container)).toBe('Activity');
  });

  it('a 500 on a direct sys_comment read shows the same notice', async () => {
    const { held, open } = await bootDirect({ failGet: ['sys_comment'] });
    const view = open();
    await settle(held);
    const peek = peekOf(view.container);
    expect(failedSources(peek)).toEqual(['comments']);
    expect(peek.textContent).not.toContain(EMPTY_ACTIVITY);
    expect(timelineTab(view.container)).toBe('Activity');
  });

  it('Retry re-reads only the failed comments, directly, and draws them once the server answers', async () => {
    const answers: Answers = { discussion: FAIL, activity: NO_ACTIVITY };
    const { held, open } = await boot(answers);
    const view = open();
    await settle(held);
    expect(streamReads(held)).toEqual([]);
    expect(retryButton(peekOf(view.container))).not.toBeNull();

    await act(async () => { fireEvent.click(retryButton(peekOf(view.container))!); });
    await settle(held);

    // One direct comment read (and its reactions), never the activity again.
    expect(readsOf(held, 'sys_comment')).toHaveLength(1);
    expect(readsOf(held, 'sys_activity')).toHaveLength(0);
    // The direct read answers an empty thread in this rig: the notice goes and
    // the empty state may speak now.
    const peek = peekOf(view.container);
    expect(failedSources(peek)).toEqual([]);
    expect(retryButton(peek)).toBeNull();
    expect(peek.textContent).toContain(EMPTY_ACTIVITY);
  });

  it('a retry that fails again keeps the notice', async () => {
    const { held, open } = await bootDirect({ failGet: ['sys_comment'] });
    const view = open();
    await settle(held);
    await act(async () => { fireEvent.click(retryButton(peekOf(view.container))!); });
    await settle(held);
    expect(readsOf(held, 'sys_comment').length).toBeGreaterThanOrEqual(2);
    expect(failedSources(peekOf(view.container))).toEqual(['comments']);
    expect(peekOf(view.container).textContent).not.toContain(EMPTY_ACTIVITY);
  });
});

describe('objectstack#29188 — a failed activity read shows the load-failure notice', () => {
  it('a 500 activity part shows the notice beside the comments that answered', async () => {
    const { held, open } = await boot({ activity: FAIL });
    const view = open();
    await settle(held);
    const peek = peekOf(view.container);
    expect(failedSources(peek)).toEqual(['activity']);
    expect(peek.textContent).toContain(ACTIVITY_FAILED);
    // The comment the discussion part carried still draws.
    expect(peek.textContent).toContain('hello from the payload');
  });

  it('a 500 on a direct sys_activity read shows the notice', async () => {
    const { held, open } = await bootDirect({ failGet: ['sys_activity'] });
    const view = open();
    await settle(held);
    expect(failedSources(peekOf(view.container))).toEqual(['activity']);
    expect(peekOf(view.container).textContent).not.toContain(EMPTY_ACTIVITY);
  });
});

describe('objectstack#29188 — controls', () => {
  it('an empty 200 payload still shows the empty state, with no notice', async () => {
    const { held, open } = await boot({ discussion: NO_COMMENTS, activity: NO_ACTIVITY });
    const view = open();
    await settle(held);
    const peek = peekOf(view.container);
    expect(peek.textContent).toContain(EMPTY_ACTIVITY);
    expect(failedSources(peek)).toEqual([]);
    expect(retryButton(peek)).toBeNull();
  });

  it('an empty 200 on direct reads still shows the empty state, with no notice', async () => {
    const { held, open } = await bootDirect({});
    const view = open();
    await settle(held);
    expect(peekOf(view.container).textContent).toContain(EMPTY_ACTIVITY);
    expect(failedSources(peekOf(view.container))).toEqual([]);
  });

  it('a refused (403) discussion part keeps the no-permission state and offers no Retry', async () => {
    const { held, open } = await boot({
      discussion: { error: { code: 'PERMISSION_DENIED', status: 403, message: 'No.' } },
      activity: NO_ACTIVITY,
    });
    const view = open();
    await settle(held);
    const peek = peekOf(view.container);
    expect(peek.querySelector('[data-denied-source="comments"]')).not.toBeNull();
    expect(failedSources(peek)).toEqual([]);
    expect(retryButton(peek)).toBeNull();
  });
});

describe('objectstack#29188 — attachments (pin: main already shows the failure)', () => {
  it('a 500 attachments part shows the panel\'s load-failure state with a Retry, and no count', async () => {
    const { held, open } = await boot({ attachments: FAIL });
    const view = open();
    await settle(held);
    expect(view.container.querySelector('[data-testid="record-attachments-unavailable"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain('No attachments yet');
    expect(RelatedCountStore.get('sys_attachment', recordAttachmentsCountField(OBJECT), 'c1')).toBeUndefined();
  });
});

describe('objectstack#30145 — navigating away from a failed feed read does not carry it over', () => {
  const pageReadOf = (held: Held[], id: string) =>
    held.filter((h) => h.method === 'POST' && h.path.endsWith(`/${id}/page`));
  const release = async (h: Held[]) => { await act(async () => { for (const x of h) x.release(); await new Promise((r) => setTimeout(r, 0)); }); await idle(); };

  it('record A settled on a failure; record B, answered empty, shows the empty state and no notice', async () => {
    const { held, open, navigate } = await boot({
      byRecord: { c1: { discussion: FAIL, activity: NO_ACTIVITY }, c2: { discussion: NO_COMMENTS, activity: NO_ACTIVITY } },
    });
    const view = open();
    await settle(held);
    expect(failedSources(peekOf(view.container))).toEqual(['comments']);

    await act(async () => { navigate(view, 'c2'); });
    await settle(held);
    const peek = peekOf(view.container);
    expect(failedSources(peek)).toEqual([]);
    expect(retryButton(peek)).toBeNull();
    expect(peek.textContent).not.toContain(COMMENTS_FAILED);
    expect(peek.textContent).toContain(EMPTY_ACTIVITY);
  });

  it('record A settled on a failure; record B, answered with rows, draws its rows and no notice', async () => {
    const { held, open, navigate } = await boot({
      byRecord: { c1: { discussion: FAIL, activity: FAIL }, c2: {} },
    });
    const view = open();
    await settle(held);
    expect(failedSources(peekOf(view.container)).sort()).toEqual(['activity', 'comments']);

    await act(async () => { navigate(view, 'c2'); });
    await settle(held);
    const peek = peekOf(view.container);
    expect(failedSources(peek)).toEqual([]);
    expect(peek.textContent).not.toMatch(/couldn't load/);
    expect(peek.textContent).toContain('hello from the payload');
  });

  it('A\'s read is still outstanding when B is opened: B shows its own state, and A\'s failure settling late stays off B', async () => {
    const { held, open, navigate } = await boot({
      byRecord: { c1: { discussion: FAIL, activity: FAIL }, c2: { discussion: NO_COMMENTS, activity: NO_ACTIVITY } },
    });
    const view = open();
    await idle();
    const aReads = pageReadOf(held, 'c1').filter((h) => !h.released);
    expect(aReads.length).toBeGreaterThan(0);

    await act(async () => { navigate(view, 'c2'); });
    await idle();
    // Answer everything but A's page read: B settles while A is still pending.
    for (let round = 0; round < 12; round++) {
      const pending = held.filter((h) => !h.released && !aReads.includes(h));
      if (pending.length === 0) break;
      await release(pending);
    }
    expect(failedSources(peekOf(view.container))).toEqual([]);
    expect(peekOf(view.container).textContent).toContain(EMPTY_ACTIVITY);

    // A's failure lands after the navigation: B must not show it.
    await release(aReads);
    await settle(held);
    const peek = peekOf(view.container);
    expect(failedSources(peek)).toEqual([]);
    expect(retryButton(peek)).toBeNull();
    expect(peek.textContent).not.toMatch(/couldn't load/);
    expect(peek.textContent).toContain(EMPTY_ACTIVITY);
  });

  it('direct reads: A\'s sys_comment 500 settles after navigating to B, which stays clean', async () => {
    const { held, open, navigate } = await bootDirect({ failGet: ['sys_comment@c1'] });
    const view = open();
    await idle();
    const aComment = readsOf(held, 'sys_comment').filter((h) => !h.released);
    expect(aComment.length).toBeGreaterThan(0);

    await act(async () => { navigate(view, 'c2'); });
    await idle();
    for (let round = 0; round < 12; round++) {
      const pending = held.filter((h) => !h.released && !aComment.includes(h));
      if (pending.length === 0) break;
      await release(pending);
    }
    expect(failedSources(peekOf(view.container))).toEqual([]);

    await release(aComment);
    await settle(held);
    const peek = peekOf(view.container);
    expect(failedSources(peek)).toEqual([]);
    expect(retryButton(peek)).toBeNull();
    expect(peek.textContent).toContain(EMPTY_ACTIVITY);
  });
});
