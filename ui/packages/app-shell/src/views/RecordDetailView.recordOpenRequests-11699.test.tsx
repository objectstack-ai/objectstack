/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11699 — opening a record page reads the record once and asks each
 * explain question once, with concurrent callers sharing the request.
 *
 * Measured first, against a real ObjectStack showcase backend and a production
 * console build, by request events on a full reload of a task record page:
 * `GET /api/v1/data/OBJ/ID` went out twice at once and
 * `POST /api/v1/security/explain` four times — the `update` and the `delete`
 * question, each asked twice. Caller stacks named the sources:
 *
 *   - both record GETs come from `record:details`' `DetailView`, whose load
 *     effect re-runs (its `schema.sections` is rebuilt on every render of the
 *     block) while its first read is still on the wire;
 *   - each question is asked by the page header (`RecordDetailView`) and by
 *     that `DetailView`, which mounts while the header's answer is pending.
 *
 * ⚠️ objectui#12701 later removed the body's record read altogether: the
 * `record:details` body now waits for the page's record, so the count below
 * reads 0 body GETs. The explain sharing is unchanged.
 *
 * Neither host is changed for those. The two sources share an in-flight
 * request — `ObjectStackAdapter.findOne` the way `find` already did, and the
 * explain probe in `useRecordEditable` beside its finished-answer memo — so
 * this file mounts the REAL page over the REAL adapter and the REAL hook and
 * counts requests on the wire.
 *
 * The transport HOLDS every request until the test releases it, in the order
 * the measurement saw: the page's side reads answer first, re-rendering the
 * page while the record reads are still pending, and only then the record
 * reads. That ordering is what produced the duplicates; a transport that
 * answered at once would let every read settle before the next caller asked,
 * and pass on the defect.
 *
 * ## The page's own `$expand` read (`GET /api/v1/data/OBJ?populate=…`)
 *
 * Measured the same way, it went out twice IN SEQUENCE, the second after the
 * first had settled, so no in-flight sharing can absorb it. Instrumented, the
 * record-load effect's second run had changed exactly one dependency:
 * `objectDef`, handed down again as a new object by a host re-render — JSON-
 * equal, with the very same `fields` object. Nothing the read sends had
 * changed. The effect now keys on what the read sends (the gated `$expand`
 * list and whether there is a page), so the cases below each deliver one of
 * the identity changes the old dependency list re-read on, and count that read:
 *
 *   - an equal definition as a new object (the measured trigger), and as a new
 *     object all the way down (what a byte-identical refetch hands over);
 *   - an assigned page landing after the record was read against a synthesized
 *     one (`effectivePage` changes, the read does not);
 *   - a permission answer arriving after the read that leaves the expansion as
 *     it was;
 *   - a DISCARDED `useMemo` cache (AGENTS.md #10). The synthesized page is a
 *     memo over `objectDef`, and React does not discard on its own in this
 *     tree, so the discard is forced — the same marker-scoped proxy as
 *     `plugin-list`'s `ListView.discardedExpandFieldsMemo.test.tsx`.
 *
 * Two live controls keep the key from being merely sticky: a definition whose
 * relations change, and a permission answer that denies one (objectui#7230),
 * each read the record again with the new expansion.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The discard proxy: a `useMemo` whose dependency list names one of `markers`
 * recomputes when `discardNow()` bumps the epoch. Inert while `markers` is
 * empty, which it is for every case but the discard one.
 */
const memoProxy = vi.hoisted(() => ({ markers: [] as unknown[], epoch: 0 }));

type UseMemo = (factory: () => unknown, deps?: unknown[]) => unknown;
type ReactModule = Record<string, unknown> & { useMemo: UseMemo; default?: Record<string, unknown> };

vi.mock('react', async (importOriginal) => {
  // Typed loosely on purpose: React's own `useMemo` type takes a
  // `DependencyList`, which the patched signature below cannot satisfy.
  const actual = await importOriginal<ReactModule>();
  const realUseMemo = actual.useMemo;
  const patched = (factory: () => unknown, deps?: unknown[]) =>
    Array.isArray(deps) && deps.some((d) => memoProxy.markers.includes(d))
      ? realUseMemo(factory, [...deps, memoProxy.epoch])
      : realUseMemo(factory, deps);
  return { ...actual, useMemo: patched, default: { ...(actual.default ?? actual), useMemo: patched } };
});

/** The permission answer the page reads; `null` leaves the real hook's answer. */
const permsState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => {
      const real = actual.usePermissions();
      return (permsState.current ?? real) as typeof real;
    },
  };
});

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
import { RecordDetailView } from './RecordDetailView';

const BASE = 'http://test.local';
const OBJECT = 'os_11699_task';
const REC = 'rec-11699';

const objectDef = {
  name: OBJECT,
  label: 'Task',
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    title: { label: 'Title', type: 'text' },
    status: { label: 'Status', type: 'text' },
    priority: { label: 'Priority', type: 'text' },
    project: { label: 'Project', type: 'lookup', reference: 'os_11699_project' },
    assignee: { label: 'Assignee', type: 'lookup', reference: 'sys_user' },
  },
};

const RECORD = { id: REC, title: 'Ship the record page', status: 'todo', priority: 'high', project: 'p1', assignee: 'u1' };

/**
 * The showcase task page's shape: a highlights strip, then the details body.
 * The strip's fields are de-duplicated out of the body, so the body's own read
 * has nothing to expand and goes to `GET /data/OBJ/ID` — the measured URL.
 */
const RECORD_PAGE = {
  name: 'os_11699_task_detail',
  label: 'Task',
  type: 'record',
  object: OBJECT,
  kind: 'full',
  template: 'default',
  isDefault: true,
  regions: [{
    name: 'main',
    width: 'full',
    components: [
      { type: 'record:highlights', properties: { fields: ['project', 'assignee', 'priority'] } },
      {
        type: 'record:details',
        properties: {
          sections: [{ name: 'overview', label: 'Overview', columns: 2, fields: ['title', 'project', 'assignee', 'status', 'priority'] }],
        },
      },
    ],
  }],
};

interface Held {
  method: string;
  path: string;
  body?: string;
  released: boolean;
  release: () => void;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const RECORD_GET = `/api/v1/data/${OBJECT}/${REC}`;
const isRecordRead = (h: Held) => h.method === 'GET' && h.path.startsWith(`/api/v1/data/${OBJECT}`);
/** The page's own read: `findOne` with `$expand` goes out as a one-row `populate` list read. */
const isPageRecordRead = (h: Held) =>
  h.method === 'GET' && h.path.startsWith(`/api/v1/data/${OBJECT}?`) && h.path.includes('populate=');
/** The relations a page read asked the server to expand, sorted. */
const expansionOf = (h: Held) =>
  (new URLSearchParams(h.path.slice(h.path.indexOf('?') + 1)).get('populate') ?? '')
    .split(',').filter(Boolean).sort();
const pageReads = (held: Held[]) => held.filter(isPageRecordRead);

/** Answer a held request the way the platform would. */
function answerFor(h: Held): unknown {
  if (h.path.endsWith('/security/explain')) return { allowed: true, record: { recordId: REC, visible: true } };
  if (h.path === RECORD_GET) return { success: true, data: { object: OBJECT, id: REC, record: RECORD } };
  if (h.path.startsWith(`/api/v1/data/${OBJECT}?`)) return { success: true, data: { records: [RECORD], total: 1 } };
  if (h.path.startsWith('/api/v1/data/')) return { success: true, data: { records: [], total: 0 } };
  return { success: true, data: [] };
}

function heldTransport() {
  const held: Held[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const path = url.replace(BASE, '');
    if (path.endsWith('/api/v1/discovery')) {
      return Promise.resolve(json({ success: true, data: { capabilities: {}, routes: {} } }));
    }
    return new Promise<Response>((resolve) => {
      const h: Held = {
        method,
        path,
        body: typeof init?.body === 'string' ? init.body : undefined,
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

/** A permission answer, in the shape `usePermissions()` hands back. */
function policy(isLoaded: boolean, deniedReads: string[] = []) {
  return {
    isLoaded,
    checkField: (_object: string, field: string, action: 'read' | 'write') =>
      !(action === 'read' && deniedReads.includes(field)),
    check: () => ({ allowed: true }),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [] as string[],
    userId: null,
    systemPermissions: undefined,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
}

/**
 * Mount the real record page over the real adapter, the way the console host
 * does: the object list arrives as a prop AND through the metadata context.
 * `show` re-renders it the way a host re-render does — a NEW metadata context
 * value every time, with whatever object list and pages it is handed.
 */
async function openRecordPage(initial: { objects?: unknown[]; pages?: unknown[] } = {}) {
  const { fetch, held } = heldTransport();
  // The explain probe rides the global fetch when no host apiFetch is
  // provided; the adapter rides the same transport.
  vi.stubGlobal('fetch', fetch);
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  // Object metadata is the metadata service's, not this count's.
  (ds as unknown as { getObjectSchema: () => Promise<unknown> }).getObjectSchema = async () => objectDef;

  let objects = initial.objects ?? [objectDef];
  let pages = initial.pages ?? [RECORD_PAGE];
  const tree = () => {
    const metadata = {
      objects, pages, loading: false, error: null,
      refresh: async () => {}, invalidate: () => {},
      ensureType: async () => pages, getItem: async () => null,
      getItemsByType: () => pages,
    } as never;
    return (
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
    );
  };
  const { rerender } = render(tree());
  const show = async (next: { objects?: unknown[]; pages?: unknown[] } = {}) => {
    if (next.objects) objects = next.objects;
    if (next.pages) pages = next.pages;
    await act(async () => {
      rerender(tree());
    });
    await drain(held);
  };
  return { held, show };
}

/** Open, and answer the page's side reads before its record reads, as measured. */
async function openAndSettle(initial: { objects?: unknown[]; pages?: unknown[] } = {}) {
  const opened = await openRecordPage(initial);
  const { held } = opened;
  await waitFor(() => expect(pageReads(held).length).toBeGreaterThan(0));
  await idle();
  await releaseWhere(held, (h) => !isRecordRead(h));
  await idle();
  await releaseWhere(held, (h) => !isRecordRead(h));
  await idle();
  await drain(held);
  expect(pageReads(held), 'the record open itself reads the page record once').toHaveLength(1);
  return opened;
}

beforeEach(() => {
  cleanup();
  __clearRecordEditableCache();
  permsState.current = null;
  memoProxy.markers = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  permsState.current = null;
  memoProxy.markers = [];
});

describe('record page open: one record GET and one explain per distinct question (objectui#11699)', () => {
  it('counts the requests a record open puts on the wire', async () => {
    const { held } = await openRecordPage();

    // The page's read is on the wire. The body sends none of its own: it
    // waits for the page's record (objectui#12701).
    await waitFor(() => expect(pageReads(held).length).toBeGreaterThan(0));
    await idle();

    // The page's side reads answer first — every one of them re-renders the
    // page while the record reads are still pending.
    await releaseWhere(held, (h) => !isRecordRead(h));
    await idle();
    await releaseWhere(held, (h) => !isRecordRead(h));
    await idle();

    // Then the record reads, and anything they set off, until the page asks
    // for nothing more.
    await drain(held);
    // The page really opened the record: the strip shows its values.
    await waitFor(() => expect(screen.getAllByText(RECORD.priority).length).toBeGreaterThan(0));

    // objectui#12701 — the body's `GET /data/OBJ/ID` used to go out once
    // here (twice before this card's fix); the body now reads the page's
    // record and sends none.
    const recordGets = held.filter((h) => h.method === 'GET' && h.path === RECORD_GET);
    expect(recordGets).toHaveLength(0);

    // The page's own `$expand` read, once, with both relations.
    expect(pageReads(held)).toHaveLength(1);
    expect(expansionOf(pageReads(held)[0])).toEqual(['assignee', 'project']);

    const explains = held.filter((h) => h.method === 'POST' && h.path.endsWith('/security/explain'));
    const perQuestion = new Map<string, number>();
    for (const h of explains) {
      const q = JSON.parse(h.body ?? '{}');
      const k = `${q.object}/${q.recordId}/${q.operation}`;
      perQuestion.set(k, (perQuestion.get(k) ?? 0) + 1);
    }
    expect(Object.fromEntries(perQuestion)).toEqual({
      [`${OBJECT}/${REC}/update`]: 1,
      [`${OBJECT}/${REC}/delete`]: 1,
    });
  });
});

describe('the page reads its record once, whatever identity its inputs arrive with (objectui#11699)', () => {
  it('a host re-render handing the same definition down as a new object reads nothing again', async () => {
    const { held, show } = await openAndSettle();

    // The measured trigger: the stored definition re-wrapped, `fields` shared.
    await show({ objects: [{ ...objectDef, listViews: {} }] });
    // What a byte-identical refetch hands over: new objects all the way down.
    await show({ objects: [structuredClone(objectDef)] });

    expect(pageReads(held)).toHaveLength(1);
  });

  it('LIVE CONTROL: a definition whose relations change reads the record again, with the new expansion', async () => {
    const { held, show } = await openAndSettle();

    await show({
      objects: [{
        ...objectDef,
        fields: { ...objectDef.fields, reviewer: { label: 'Reviewer', type: 'lookup', reference: 'sys_user' } },
      }],
    });

    expect(pageReads(held)).toHaveLength(2);
    expect(expansionOf(pageReads(held)[1])).toEqual(['assignee', 'project', 'reviewer']);
  });

  it('an assigned page landing after the record was read against a synthesized one reads nothing again', async () => {
    const { held, show } = await openAndSettle({ pages: [] });

    await show({ pages: [RECORD_PAGE] });

    expect(pageReads(held)).toHaveLength(1);
  });

  it('a discarded memo cache (AGENTS.md #10) reads nothing again', async () => {
    // Armed before mount, so no memo's dependency count changes mid-life. A
    // synthesized page: that is the memo over `objectDef` the old dependency
    // list reached through `effectivePage`.
    memoProxy.markers = [objectDef];
    const { held, show } = await openAndSettle({ pages: [] });

    memoProxy.epoch += 1;
    await show();
    memoProxy.epoch += 1;
    await show();

    expect(pageReads(held)).toHaveLength(1);
  });
});

describe('a permission answer that arrives after the read (objectui#11699, objectui#7230)', () => {
  it('leaving the expansion as it was, it reads nothing again', async () => {
    permsState.current = policy(false);
    const { held, show } = await openAndSettle();
    expect(expansionOf(pageReads(held)[0])).toEqual(['assignee', 'project']);

    permsState.current = policy(true);
    await show();

    expect(pageReads(held)).toHaveLength(1);
  });

  it('LIVE CONTROL: denying a relation, it reads the record again without it', async () => {
    permsState.current = policy(false);
    const { held, show } = await openAndSettle();
    expect(expansionOf(pageReads(held)[0])).toEqual(['assignee', 'project']);

    permsState.current = policy(true, ['assignee']);
    await show();

    expect(pageReads(held)).toHaveLength(2);
    expect(expansionOf(pageReads(held)[1])).toEqual(['project']);
  });
});
