/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28737 — the record page draws the 动态 stream's count the server
 * counted, and asks only the activity rows the 动态 panel draws.
 *
 * Before: the page asked the activity window (`activity: { top: 200 }`) on
 * every open, because the panel's count chip and the 动态 tab's count were
 * the size of the merged rows it held — so a busy record carried 200 rows for
 * a panel that draws five, and the count stopped at the window.
 *
 * Pinned here, through the real adapter under StrictMode: the page asks the
 * panel's rows and the `timeline` count; a record with more than 200 merged
 * entries names the served total on the chip and reads the window only when
 * the 动态 tab opens; a record with none names 0 and reads nothing more; a
 * page opening on the 动态 tab asks the window itself and reads nothing more.
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
// The `record:attachments` block the synthesized page places for `enable.files`
// (registered by the package entry, which this file does not import).
import './record-attachments-renderer';

const BASE = 'http://test.local';
const OBJECT = 'os_28737_contact';
const CHILD = 'os_28737_task';

const contactDef = {
  name: OBJECT,
  label: 'Contact',
  enable: { files: true },
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    account: { label: 'Account', type: 'lookup', reference: 'os_28737_account' },
  },
};
const accountDef = { name: 'os_28737_account', label: 'Account', fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Name', type: 'text' } } };
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
  /** The discussion's comments (default: one). */
  comments?: unknown[];
  /** The timeline part's answer (default: none). */
  timeline?: unknown;
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
      ...(body.discussion ? { discussion: { comments: answers.comments ?? [COMMENT], reactions: { records: [] } } } : {}),
      ...(body.activity ? { activity: answers.activity ?? { total: 1, records: [ACTIVITY] } } : {}),
      ...(body.attachments ? { attachments: { total: 3, records: [ATTACHMENT] } } : {}),
      ...(body.timeline && answers.timeline !== undefined ? { timeline: answers.timeline } : {}),
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

beforeEach(() => {
  cleanup();
  __clearRecordEditableCache();
  __resetRecordApprovalsStore();
  RelatedCountStore._reset();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function boot(answers: Answers = {}, entry = `/apps/demo/${OBJECT}/record/c1`, objects: readonly unknown[] = ALL) {
  const { fetch, held } = heldTransport(answers);
  vi.stubGlobal('fetch', fetch);
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  const metadata = {
    objects, pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  const open = () => render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDetailView dataSource={ds as never} objects={objects as never} onEdit={() => {}} objectNameOverride={OBJECT} recordIdOverride="c1" />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </React.StrictMode>,
  );
  return { held, open, ds };
}


const ROWS = (n: number) => Array.from({ length: n }, (_, i) => ({
  ...ACTIVITY,
  id: `ac${i}`,
  type: 'system',
  summary: `step ${i}`,
  timestamp: new Date(Date.UTC(2026, 8, 30, 10, 59 - i)).toISOString(),
}));
const activityReads = (held: Held[]) => readsOf(held, 'sys_activity');
const chipOf = (container: HTMLElement) =>
  container.querySelector('[data-record-timeline-panel] [data-record-timeline-count]')?.textContent ?? null;

describe('objectstack#28737 — the 动态 count is the server\'s, and the page asks only the panel\'s rows', () => {
  it('a record with more than 200 merged entries shows the served total, and the request asks only the panel\'s rows', async () => {
    const { held, open } = await boot({ activity: { total: 330, records: ROWS(5) }, timeline: { total: 341 } });
    const view = open();
    await settle(held);

    const [page] = held.filter(isPage);
    expect(page.body.activity).toEqual({ top: 5 });
    expect(page.body.timeline).toEqual({ discussion: true, activity: true, fieldChanges: false });
    expect(chipOf(view.container)).toBe('341');
    expect(activityReads(held)).toEqual([]);

    // The 动态 tab draws the whole stream: it reads the window once, and the
    // count stays the served one.
    const openTab = view.container.querySelector('[data-record-timeline-panel-open]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(openTab); });
    await settle(held);
    expect(activityReads(held)).toHaveLength(1);
    expect(activityReads(held)[0].path).toMatch(/[?&]\$?top=200\b/);
    expect(view.container.textContent).toContain('341');
  });

  it('a record with none shows 0 and makes no fallback read, the 动态 tab opened included', async () => {
    const { held, open } = await boot({ activity: { total: 0, records: [] }, comments: [], timeline: { total: 0 } });
    const view = open();
    await settle(held);
    expect(chipOf(view.container)).toBe('0');
    const openTab = view.container.querySelector('[data-record-timeline-panel-open]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(openTab); });
    await settle(held);
    expect(held.filter((h) => !isMeta(h)).map((h) => `${h.method} ${h.path}`)).toEqual([`POST /api/v1/data/${OBJECT}/c1/page`]);
  });

  it('a page opening on the 动态 tab asks the whole window and the count, and reads nothing more', async () => {
    const { held, open } = await boot(
      { activity: { total: 330, records: ROWS(200) }, timeline: { total: 341 } },
      `/apps/demo/${OBJECT}/record/c1?related=timeline`,
    );
    open();
    await settle(held);
    const [page] = held.filter(isPage);
    expect(page.body.activity).toEqual({ top: 200 });
    expect(page.body.timeline).toEqual({ discussion: true, activity: true, fieldChanges: false });
    expect(activityReads(held)).toEqual([]);
  });

  it('ablation — a payload without the count leaves the chip on the rows the page holds', async () => {
    const { held, open } = await boot({ activity: { total: 330, records: ROWS(5) } });
    const view = open();
    await settle(held);
    // One comment + five activity rows: what the page holds, not the record's stream.
    expect(chipOf(view.container)).toBe('6');
  });
});

/**
 * objectstack#29878 — the page's `timeline` ask counts the field changes when
 * the record's object declares `enable.trackHistory` and the objects the view
 * is handed hold `sys_audit_log` (the record route asks it by name for such an
 * object: `appObjectScope.ts`). Without the audit object in hand it asks none.
 */
describe('objectstack#29878 — the timeline ask counts the field changes of a tracked object', () => {
  const tracked = { ...contactDef, enable: { ...contactDef.enable, trackHistory: true } };
  const auditDef = { name: 'sys_audit_log', label: 'Audit Log', fields: { id: { label: 'Id', type: 'text' } } };

  it('with sys_audit_log in the objects, the page asks fieldChanges: true', async () => {
    const { held, open } = await boot({ timeline: { total: 3 } }, undefined, [tracked, accountDef, childDef, auditDef]);
    open();
    await settle(held);
    const [page] = held.filter(isPage);
    expect(page.body.timeline).toEqual({ discussion: true, activity: true, fieldChanges: true });
  });

  it('CONTROL: without sys_audit_log in the objects, it asks fieldChanges: false', async () => {
    const { held, open } = await boot({ timeline: { total: 3 } }, undefined, [tracked, accountDef, childDef]);
    open();
    await settle(held);
    const [page] = held.filter(isPage);
    expect(page.body.timeline).toEqual({ discussion: true, activity: true, fieldChanges: false });
  });
});
