/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28470 — a record open is ONE request: the record's streams and
 * the related rows' names ride in the page payload.
 *
 * Measured on main before this change (the console over `examples/app-crm`,
 * a production build): opening a contact sent the page payload, then the
 * discussion (`sys_comment`), the activity (`sys_activity`), the mention list
 * (`sys_user?top=50`) and one `?top=1` name read per object the related rows
 * point at — the related list's name fallback resolving the payload's bare
 * ids, the parent's own id among them.
 *
 * Pinned here, through the real adapter under StrictMode: one page request and
 * no `sys_comment`, `sys_comment_reaction`, `sys_activity`, `sys_attachment`,
 * `sys_user?top=50` or `?top=1` read; the feed, the attachments and the badge
 * draw the payload's parts; the mention list is read on the composer's first
 * focus; a refused part draws its refusal and is not read again. The ablations
 * show the detectors see each retired read when its part is not taken.
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
const OBJECT = 'os_28470_contact';
const CHILD = 'os_28470_task';

const contactDef = {
  name: OBJECT,
  label: 'Contact',
  enable: { files: true },
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    account: { label: 'Account', type: 'lookup', reference: 'os_28470_account' },
  },
};
const accountDef = { name: 'os_28470_account', label: 'Account', fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Name', type: 'text' } } };
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
}

interface Held { method: string; path: string; body: any; released: boolean; release: () => void }

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function pageAnswer(id: string, body: any, answers: Answers) {
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
      ...(body.discussion ? { discussion: { comments: [COMMENT], reactions: { records: [] } } } : {}),
      ...(body.activity ? { activity: answers.activity ?? { total: 1, records: [ACTIVITY] } } : {}),
      ...(body.attachments ? { attachments: { total: 3, records: [ATTACHMENT] } } : {}),
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
        release: () => { if (h.released) return; h.released = true; resolve(json(answerFor(h, answers))); },
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

const isMeta = (h: Held) => h.path.startsWith('/api/v1/meta/');
const isPage = (h: Held) => h.method === 'POST' && /\/api\/v1\/data\/[^/?]+\/[^/?]+\/page$/.test(h.path);
const readsOf = (held: Held[], object: string) => held.filter((h) => h.method === 'GET' && h.path.startsWith(`/api/v1/data/${object}?`));
/** The retired stream reads, by object. */
const STREAMS = ['sys_comment', 'sys_comment_reaction', 'sys_activity', 'sys_attachment'];
const streamReads = (held: Held[]) => STREAMS.flatMap((o) => readsOf(held, o).map(() => o));
const mentionReads = (held: Held[]) => readsOf(held, 'sys_user').filter((h) => /[?&]\$?top=50\b/.test(h.path));
const nameProbes = (held: Held[]) => held.filter((h) => h.method === 'GET' && /[?&]\$?top=1\b/.test(h.path));
const probedObject = (h: Held) => /\/api\/v1\/data\/([^/?]+)\?/.exec(h.path)![1];

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
  const open = () => render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/record/c1`]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDetailView dataSource={ds as never} objects={ALL as never} onEdit={() => {}} objectNameOverride={OBJECT} recordIdOverride="c1" />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </React.StrictMode>,
  );
  return { held, open, ds };
}

describe('objectstack#28470 — one record open is one request', () => {
  it('sends exactly one page request and no stream, attachment, mention or name read', async () => {
    const { held, open } = await boot();
    const view = open();
    await settle(held);

    const data = held.filter((h) => !isMeta(h));
    expect(data.map((h) => `${h.method} ${h.path}`)).toEqual([`POST /api/v1/data/${OBJECT}/c1/page`]);
    expect(streamReads(held)).toEqual([]);
    expect(mentionReads(held)).toEqual([]);
    expect(nameProbes(held)).toEqual([]);

    // The request names what the page draws: the streams, and each related
    // list's lookups but the parent's.
    const [page] = held.filter(isPage);
    expect(page.body).toMatchObject({ discussion: true, activity: { top: 200 }, attachments: { top: 100 } });
    expect(page.body.related).toEqual([expect.objectContaining({ object: CHILD, field: 'contact', expand: ['owner'] })]);

    // Every part is drawn from the payload: the comment, the attachment row
    // and its badge's count.
    expect(view.container.textContent).toContain('hello from the payload');
    expect(view.container.textContent).toContain('contract.pdf');
    expect(RelatedCountStore.get('sys_attachment', recordAttachmentsCountField(OBJECT), 'c1')).toBe(3);
  });

  it('reads the mention list on the composer\'s first focus, once', async () => {
    const { held, open } = await boot();
    const view = open();
    await settle(held);
    expect(mentionReads(held)).toEqual([]);

    const standIn = view.container.querySelector('[data-record-timeline-composer]') as HTMLElement | null;
    expect(standIn, 'the 动态 panel draws its one-line composer').not.toBeNull();
    await act(async () => { fireEvent.click(standIn!); });
    await settle(held);
    expect(mentionReads(held)).toHaveLength(1);

    const editor = view.container.querySelector('[data-record-timeline-peek] textarea') as HTMLTextAreaElement;
    await act(async () => { fireEvent.blur(editor); fireEvent.focus(editor); });
    await settle(held);
    expect(mentionReads(held)).toHaveLength(1);
  });

  it('a refused activity part draws the refusal, the discussion still draws, and nothing is read again', async () => {
    const { held, open } = await boot({ activity: { error: { code: 'PERMISSION_DENIED', status: 403, message: 'No.' } } });
    const view = open();
    await settle(held);
    expect(view.container.querySelector('[data-denied-source="activity"]')).not.toBeNull();
    expect(view.container.textContent).toContain('hello from the payload');
    expect(streamReads(held)).toEqual([]);
  });

  // ── Ablations: the detectors above see each retired read ──────────────

  it('ablation — an adapter without the payload reads each stream on its own, and the detectors see them', async () => {
    const { held, open, ds } = await boot();
    Object.assign(ds, { getRecordPage: undefined, prefetchRecordPage: undefined });
    open();
    await settle(held);
    expect(held.filter(isPage)).toEqual([]);
    expect([...new Set(streamReads(held))].sort()).toEqual(['sys_activity', 'sys_attachment', 'sys_comment']);
  });

  it('ablation — rows answered with bare ids pay one name read per referenced object, never the parent\'s', async () => {
    const { held, open } = await boot({ ignoreExpand: true });
    open();
    await settle(held);
    expect(held.filter(isPage)).toHaveLength(1);
    expect(nameProbes(held).map(probedObject)).toEqual(['sys_user']);
  });
});
