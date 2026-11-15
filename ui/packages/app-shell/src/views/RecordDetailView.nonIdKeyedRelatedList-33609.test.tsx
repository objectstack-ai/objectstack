/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33609 — one related list keyed by a parent field other than `id`
 * must not blank the whole record page.
 *
 * A `record:related_list` may name the PARENT field its `relationshipField`
 * stores (`relationshipValueField`, spec `RecordRelatedListProps`): the list is
 * `{[relationshipField]: parent[relationshipValueField]}`. A sales order's
 * `selected_plan` (a lookup to a plan), with the plan's lines as the list, is
 * that shape: the line's `allocation_plan` holds the plan's id, not the
 * order's.
 *
 * The one-request record page (`POST /data/{object}/{id}/page`) names a related
 * list by `{ object, field }` only, and its contract is "the child records
 * whose field holds this record's id" (`RecordPageRelatedRequestSchema`, a
 * strict schema): a list keyed by another parent field is not a question that
 * door answers, and the route refuses the WHOLE request with 400
 * `invalid_relationship`. Measured on origin/main: the console folded such a
 * list into the request, and the page drew 「无法加载此记录」.
 *
 * The page now leaves those lists out of the request by the count prefetch's
 * own rule (`relatedCountTargetOf`), and each reads for itself through its
 * block, as it did before the payload. An id-keyed list keeps riding the one
 * request.
 *
 * The transport below answers `/page` the way the route does: a related entry
 * whose child field does not reference the page's object is a 400
 * `VALIDATION_FAILED` / `invalid_relationship` for the whole request. The page
 * record carries `selected_plan` EXPANDED (the page reads every lookup with
 * `$expand`), as the route answers it.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
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
import { recordPageRelatedLists } from './recordPagePayload';

const BASE = 'http://test.local';
const ORDER = 'os_33609_order';
const PLAN = 'os_33609_plan';
const PLAN_LINE = 'os_33609_plan_line';
const TASK = 'os_33609_task';
const REC = 'ord-1';
const PLAN_ID = 'plan-7';

const orderDef = {
  name: ORDER,
  label: 'Order',
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    selected_plan: { label: 'Selected plan', type: 'lookup', reference: PLAN },
  },
};
const planDef = {
  name: PLAN,
  label: 'Plan',
  managedBy: 'platform',
  fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Name', type: 'text' } },
};
const planLineDef = {
  name: PLAN_LINE,
  label: 'Plan line',
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    allocation_plan: { label: 'Plan', type: 'lookup', reference: PLAN },
  },
};
const taskDef = {
  name: TASK,
  label: 'Task',
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    order: { label: 'Order', type: 'lookup', reference: ORDER },
  },
};
const ALL = [orderDef, planDef, planLineDef, taskDef];

/** The order as the page reads it: `selected_plan` expanded when asked. */
const orderRecord = (expand: readonly string[]) => ({
  id: REC,
  name: 'Order one',
  selected_plan: expand.includes('selected_plan') ? { id: PLAN_ID, name: 'Plan seven' } : PLAN_ID,
});

/** The plan's lines; the order's tasks. */
const LINES = [
  { id: 'pl-1', name: 'Plan line alpha', allocation_plan: PLAN_ID },
  { id: 'pl-2', name: 'Plan line beta', allocation_plan: PLAN_ID },
];
const TASKS = [{ id: 't-1', name: 'Order task one', order: REC }];

const relatedList = (id: string, objectName: string, relationshipField: string, extra: Record<string, unknown> = {}) => ({
  type: 'record:related_list',
  id,
  properties: { objectName, relationshipField, columns: ['name'], limit: 10, ...extra },
});

/** The card's page: the plan's lines keyed by the order's `selected_plan`, beside an id-keyed list. */
const ORDER_PAGE = {
  name: 'os_33609_order_detail',
  label: 'Order',
  type: 'record',
  object: ORDER,
  kind: 'full',
  template: 'default',
  isDefault: true,
  regions: [
    {
      name: 'main',
      width: 'large',
      components: [
        relatedList('plan_lines', PLAN_LINE, 'allocation_plan', { relationshipValueField: 'selected_plan', title: 'Plan lines' }),
        relatedList('order_tasks', TASK, 'order', { title: 'Tasks' }),
      ],
    },
  ],
};

interface Held { method: string; path: string; body: any; released: boolean; release: () => void }

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PAGE = `/api/v1/data/${ORDER}/${REC}/page`;
const isPage = (h: Held) => h.method === 'POST' && h.path === PAGE;
const objectOf = (h: Held) => /\/api\/v1\/data\/([^/?]+)/.exec(h.path)?.[1];
const fieldOf = (object: string, field: string): any =>
  (ALL.find((o) => o.name === object)?.fields as Record<string, any> | undefined)?.[field];

/** The `/page` route: a related entry whose field does not reference the page's object refuses the whole request. */
function pageAnswer(body: any): [number, unknown] {
  const related: Array<{ object: string; field: string; top: number }> = body?.related ?? [];
  const malformed = related
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => fieldOf(entry.object, entry.field)?.reference !== ORDER)
    .map(({ entry, index }) => ({
      field: `related.${index}.field`,
      code: 'invalid_relationship',
      message: `'${entry.field}' on '${entry.object}' is not a lookup, master-detail, user or tree field that references '${ORDER}'.`,
    }));
  if (malformed.length > 0) {
    return [400, {
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'Invalid record page request', details: { object: ORDER, fields: malformed } },
    }];
  }
  return [200, {
    success: true,
    data: {
      object: ORDER,
      id: REC,
      record: orderRecord(body?.expand ?? []),
      related: related.map((list) => {
        const rows = list.object === TASK ? TASKS : [];
        return { object: list.object, field: list.field, total: rows.length, records: rows.slice(0, list.top) };
      }),
      ...(body?.explain ? { explain: Object.fromEntries(body.explain.map((op: string) => [op, { allowed: true, record: { recordId: REC, visible: true } }])) } : {}),
      ...(body?.approvals ? { approvals: { requests: [], lock: null } } : {}),
    },
  }];
}

/** A child read: the rows whose `field` holds `value`, read off the query's filter. */
function childAnswer(h: Held, rows: ReadonlyArray<Record<string, unknown>>, field: string) {
  const match = rows.filter((r) => h.path.includes(`"${field}","=","${String(r[field])}"`) || h.path.includes(`filter[${field}]=${String(r[field])}`));
  return { success: true, data: { records: match, total: match.length } };
}

function answerFor(h: Held): [number, unknown] {
  if (isPage(h)) return pageAnswer(h.body);
  const object = objectOf(h);
  if (object === ORDER) return [200, { success: true, data: { records: [orderRecord(['selected_plan'])], total: 1 } }];
  if (object === PLAN_LINE) return [200, childAnswer(h, LINES, 'allocation_plan')];
  if (object === TASK) return [200, childAnswer(h, TASKS, 'order')];
  if (h.path.startsWith('/api/v1/data/')) return [200, { success: true, data: { records: [], total: 0 } }];
  return [200, { success: true, data: [] }];
}

function heldTransport() {
  const held: Held[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = decodeURIComponent(url.replace(BASE, ''));
    if (path.endsWith('/api/v1/discovery')) return Promise.resolve(respond(200, { success: true, data: { capabilities: {}, routes: {} } }));
    return new Promise<Response>((resolve) => {
      const h: Held = {
        method, path,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        released: false,
        release: () => { if (h.released) return; h.released = true; const [status, body] = answerFor(h); resolve(respond(status, body)); },
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

async function openOrderPage() {
  const { fetch, held } = heldTransport();
  vi.stubGlobal('fetch', fetch);
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  (ds as unknown as { getObjectSchema: (n: string) => Promise<unknown> }).getObjectSchema = async (n: string) =>
    ALL.find((o) => o.name === n) ?? null;
  const pages = [ORDER_PAGE];
  const metadata = {
    objects: ALL, pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null, getItemsByType: () => pages,
  } as never;
  render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[`/apps/demo/${ORDER}/record/${REC}`]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDetailView dataSource={ds as never} objects={ALL as never} onEdit={() => {}} objectNameOverride={ORDER} recordIdOverride={REC} />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </React.StrictMode>,
  );
  await settle(held);
  return { held };
}

beforeEach(() => {
  cleanup();
  __clearRecordEditableCache();
  __resetRecordApprovalsStore();
  RelatedCountStore._reset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetRecordApprovalsStore();
  RelatedCountStore._reset();
});

describe('objectstack#33609 — a related list keyed by a parent lookup does not blank the record page', () => {
  it('the page renders, the non-id-keyed list reads for itself and shows its rows, and the id-keyed list rides the one request', async () => {
    const { held } = await openOrderPage();

    // The page drew: no load-failure state, the record's own name on screen.
    expect(screen.queryByTestId('record-load-failed')).toBeNull();
    expect(screen.queryByText('无法加载此记录')).toBeNull();
    expect(screen.getByText('Order one')).toBeInTheDocument();

    // One page request, naming the id-keyed list only.
    const pages = held.filter(isPage);
    expect(pages).toHaveLength(1);
    expect(pages[0].body.related.map((r: any) => [r.object, r.field])).toEqual([[TASK, 'order']]);

    // The id-keyed list draws its rows (its total is the payload's; a full
    // list past the payload's three rows reads its own window, as before).
    expect(await screen.findByText('Order task one', undefined, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('objectstack#33609 — which related lists the page request names', () => {
  const named = (...nodes: unknown[]) =>
    recordPageRelatedLists({ regions: [{ name: 'main', components: nodes }] }).map((l) => `${l.object}.${l.field}`);

  it('leaves out a list keyed by a parent field other than id, and keeps an id-keyed one', () => {
    expect(named(
      relatedList('a', PLAN_LINE, 'allocation_plan', { relationshipValueField: 'selected_plan' }),
      relatedList('b', TASK, 'order'),
      relatedList('c', 'os_33609_note', 'order', { relationshipValueField: 'id' }),
    )).toEqual([`${TASK}.order`, 'os_33609_note.order']);
  });

  it('applies the count prefetch rule whole: a list bound to a data source of its own reads for itself too', () => {
    expect(named(
      relatedList('a', TASK, 'order', { dataSource: { object: TASK } }),
      relatedList('b', TASK, 'order', { parentDataSource: { object: ORDER, limit: 1 } }),
    )).toEqual([]);
  });

  it('keeps an id-keyed list under a visibleWhen gate in the request, as before', () => {
    expect(named({ ...relatedList('a', TASK, 'order'), visibleWhen: "record.name != ''" })).toEqual([`${TASK}.order`]);
  });
});
