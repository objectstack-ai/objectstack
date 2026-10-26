/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12701 — opening a record sends ONE approvals read and ONE record
 * read, however many sections on the page consume them.
 *
 * Measured on a HotCRM lead open in the console (`main.tsx` renders it under
 * `React.StrictMode`): `GET /approvals/requests?object=…&recordId=…` went out
 * three times, and the record twice — the page's `$expand` read, and a second,
 * narrower one from the `record:details` body. Caller stacks named the sources:
 *
 *   - all three approvals reads came from the page's one `useRecordApprovals`:
 *     two from its mount effect (StrictMode replays it), the third from the
 *     page's "skip the first run" invalidation effect, which the replay walked
 *     through;
 *   - the second record read came from `record:details`' `DetailView`, which
 *     read the row itself while the page's read was still on the wire.
 *
 * So this file mounts the REAL page over the REAL adapter and the REAL hook,
 * under StrictMode, on an AUTHORED page that also places `record:approvals`
 * (a second consumer of the approvals read, as an authored page has), and
 * counts requests on the wire. The transport HOLDS every request until the test
 * releases it, the page's side reads first, so every consumer has mounted
 * while the reads it would share are still pending.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
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
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { __clearRecordEditableCache } from '../../../plugin-detail/src/useRecordEditable';
import { __resetRecordApprovalsStore } from '../hooks/useRecordApprovals';
import { RecordDetailView } from './RecordDetailView';

const BASE = 'http://test.local';
const OBJECT = 'os_12701_deal';
const REC = 'rec-12701';
const REQUEST_ID = 'req-12701';

const objectDef = {
  name: OBJECT,
  label: 'Deal',
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    title: { label: 'Title', type: 'text' },
    stage: { label: 'Stage', type: 'text' },
    account: { label: 'Account', type: 'lookup', reference: 'os_12701_account' },
    owner: { label: 'Owner', type: 'lookup', reference: 'sys_user' },
    // Expanded by the page, drawn by no section — HotCRM's audit relations.
    // It is what makes the body's own read a DIFFERENT URL from the page's,
    // as measured; with equal lists the adapter's in-flight sharing would
    // fold the two into one and hide the body's read.
    created_by: { label: 'Created by', type: 'lookup', reference: 'sys_user' },
  },
};

const RECORD = { id: REC, title: 'Lattice renewal', stage: 'prospecting', account: 'a1', owner: 'u1', created_by: 'u1' };

/** One pending, record-locking request, as `listRequests` sends it. */
const PENDING = {
  id: REQUEST_ID,
  process_name: 'flow:deal_approval',
  object_name: OBJECT,
  record_id: REC,
  status: 'pending',
  lock_record: true,
  submitter_id: 'u1',
  submitted_at: '2026-10-16T10:00:00Z',
  process_label: 'Large Deal Approval',
  step_label: 'Manager Review',
  pending_approvers: ['u2'],
};

/**
 * An authored record page: the details body, and `record:approvals` placed by
 * the author — the block reads approvals through its own hook instance, since
 * only a synthesized page threads the host's result into the node.
 */
const RECORD_PAGE = {
  name: 'os_12701_deal_detail',
  label: 'Deal',
  type: 'record',
  object: OBJECT,
  kind: 'full',
  template: 'default',
  isDefault: true,
  regions: [{
    name: 'main',
    width: 'full',
    components: [
      {
        type: 'record:details',
        properties: {
          sections: [{ name: 'overview', label: 'Overview', columns: 2, fields: ['title', 'stage', 'account', 'owner'] }],
        },
      },
      { type: 'record:approvals', properties: {} },
    ],
  }],
};

interface Held {
  method: string;
  path: string;
  released: boolean;
  release: () => void;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const APPROVALS_LIST = `/api/v1/approvals/requests?object=${OBJECT}&recordId=${REC}`;
const APPROVAL_SINGLE = `/api/v1/approvals/requests/${REQUEST_ID}`;
/** Every read of the record: the page's `populate` read, or `GET /data/OBJ/ID`. */
const isRecordRead = (h: Held) => h.method === 'GET' && h.path.startsWith(`/api/v1/data/${OBJECT}`);
const isApprovalsRead = (h: Held) => h.path === APPROVALS_LIST;
const isActivityRead = (h: Held) => h.method === 'GET' && h.path.startsWith('/api/v1/data/sys_activity');
/** The relations a record read asked the server to expand, sorted. */
const expansionOf = (h: Held) =>
  (new URLSearchParams(h.path.slice(h.path.indexOf('?') + 1)).get('populate') ?? '')
    .split(',').filter(Boolean).sort();

function answerFor(h: Held): unknown {
  if (h.path.endsWith('/security/explain')) return { allowed: true, record: { recordId: REC, visible: true } };
  if (h.path === APPROVALS_LIST) return { data: [PENDING] };
  if (h.path === APPROVAL_SINGLE) return { ...PENDING, viewer: { can_act: false, is_submitter: true } };
  if (h.path === `${APPROVAL_SINGLE}/actions`) return { data: [] };
  if (h.path.startsWith(`/api/v1/data/${OBJECT}/${REC}`)) return { success: true, data: { object: OBJECT, id: REC, record: RECORD } };
  if (h.path.startsWith(`/api/v1/data/${OBJECT}?`)) return { success: true, data: { records: [RECORD], total: 1 } };
  if (h.path.startsWith('/api/v1/data/')) return { success: true, data: { records: [], total: 0 } };
  return { success: true, data: [] };
}

function heldTransport() {
  const held: Held[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const path = decodeURIComponent(url.replace(BASE, ''));
    if (path.endsWith('/api/v1/discovery')) {
      return Promise.resolve(json({ success: true, data: { capabilities: {}, routes: {} } }));
    }
    return new Promise<Response>((resolve) => {
      const h: Held = {
        method,
        path,
        released: false,
        release: () => {
          if (h.released) return;
          h.released = true;
          resolve(json(answerFor(h)));
        },
      };
      held.push(h);
    });
  });
  return { fetch, held };
}

async function releaseWhere(held: Held[], pred: (h: Held) => boolean) {
  await act(async () => {
    for (const h of held) if (!h.released && pred(h)) h.release();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function idle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

/** Answer everything, and anything that sets off, until the page asks for nothing more. */
async function drain(held: Held[]) {
  for (let round = 0; round < 10 && held.some((h) => !h.released); round++) {
    await releaseWhere(held, () => true);
    await idle();
  }
  expect(held.filter((h) => !h.released)).toEqual([]);
}

/** Mount the real record page under StrictMode, as the console's `main.tsx` does. */
async function openRecordPage() {
  const { fetch, held } = heldTransport();
  vi.stubGlobal('fetch', fetch);
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  (ds as unknown as { getObjectSchema: () => Promise<unknown> }).getObjectSchema = async () => objectDef;

  let objects: unknown[] = [objectDef];
  const pages = [RECORD_PAGE];
  const tree = () => {
    const metadata = {
      objects, pages, loading: false, error: null,
      refresh: async () => {}, invalidate: () => {},
      ensureType: async () => pages, getItem: async () => null,
      getItemsByType: () => pages,
    } as never;
    return (
      <React.StrictMode>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/record/${REC}`]}>
          <MetadataCtx.Provider value={metadata}>
            <RecordDetailView
              dataSource={ds as never}
              objects={objects as never}
              onEdit={() => {}}
              objectNameOverride={OBJECT}
              recordIdOverride={REC}
            />
          </MetadataCtx.Provider>
        </MemoryRouter>
      </React.StrictMode>
    );
  };
  const { rerender } = render(tree());
  const show = async (next: { objects?: unknown[] }) => {
    if (next.objects) objects = next.objects;
    await act(async () => {
      rerender(tree());
    });
    await drain(held);
  };

  // Every consumer mounts while the reads it would share are on the wire: the
  // page's side reads answer first, re-rendering it, and only then the rest.
  await waitFor(() => expect(held.some(isRecordRead)).toBe(true));
  await idle();
  await releaseWhere(held, (h) => !isRecordRead(h) && !isApprovalsRead(h));
  await idle();
  await drain(held);
  return { held, show };
}

beforeEach(() => {
  cleanup();
  __clearRecordEditableCache();
  __resetRecordApprovalsStore();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetRecordApprovalsStore();
});

describe('a record open sends one approvals read and one record read (objectui#12701)', () => {
  it('counts the requests by URL: approvals 1, record 1, no activity read on a page that draws none', async () => {
    const { held } = await openRecordPage();
    await waitFor(() => expect(screen.getAllByText(RECORD.stage).length).toBeGreaterThan(0));

    expect(held.filter(isApprovalsRead), 'approvals list reads').toHaveLength(1);
    // The pending row's single-read enrichment rides the one list read.
    expect(held.filter((h) => h.path === APPROVAL_SINGLE), 'approvals single reads').toHaveLength(1);

    const recordReads = held.filter(isRecordRead);
    expect(recordReads.map((h) => h.path), 'record reads').toHaveLength(1);
    // The one read carries every relation the page's sections draw, and more.
    expect(expansionOf(recordReads[0])).toEqual(['account', 'created_by', 'owner']);

    // Out of the card's scope: the record's activity read. This page places no
    // block that draws the feed, so it is not read at all (objectui#13010 part
    // 2); that a page which does draw it reads it once is pinned beside the
    // record-open waves (`RecordDetailView.recordOpenWaves-13010.test.tsx`).
    expect(held.filter(isActivityRead), 'activity reads').toHaveLength(0);
  });

  it('CONTROL: every approvals consumer still shows its state', async () => {
    await openRecordPage();

    // The authored `record:approvals` block, from the shared read.
    const panel = await screen.findByTestId('record-approvals-panel');
    expect(panel.textContent).toContain(PENDING.step_label);
    // The page's lock band on the details body, from the page's hook instance.
    expect(screen.getAllByText('Locked for approval').length).toBeGreaterThan(0);
    // The submitter's recall on that band — the server's `viewer` block,
    // which only the single read carries, reached the page's instance too.
    expect(screen.getAllByText('Recall approval').length).toBeGreaterThan(0);
    // And the body drew the record the page read (the title is the name
    // field, which the body leaves to the header).
    expect(screen.getAllByText(RECORD.stage).length).toBeGreaterThan(0);
  });

  it('a section needing a wider expansion triggers exactly one refetch, with the union', async () => {
    const { held, show } = await openRecordPage();
    expect(held.filter(isRecordRead)).toHaveLength(1);

    // The definition gains a relation the page's sections now need.
    await show({
      objects: [{
        ...objectDef,
        fields: { ...objectDef.fields, reviewer: { label: 'Reviewer', type: 'lookup', reference: 'sys_user' } },
      }],
    });

    const recordReads = held.filter(isRecordRead);
    expect(recordReads, 'one refetch, never a second read beside it').toHaveLength(2);
    expect(expansionOf(recordReads[1])).toEqual(['account', 'created_by', 'owner', 'reviewer']);
  });
});
