/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13010 — the record page's open waves.
 *
 * Measured on a HotCRM opportunity open (list → record, ~350 ms round trip):
 * the related reference cards read `top=3` in a wave of their own, and then
 * the tab strip's badge read each related list's count AGAIN with `top=1` in a
 * further wave, although the card's own read had already answered `total` for
 * the same question.
 *
 * So this file mounts the REAL page over the REAL adapter on an authored page
 * shaped like HotCRM's opportunity page — a `page:tabs` strip whose Related tab
 * holds `record:related_list` nodes, and a `record:reference_rail` aside with
 * one card per related list — under StrictMode, and logs every request with
 * the WAVE it went out in. A wave is one round of the held transport: every
 * request the page has issued is answered together, then the page is allowed
 * to settle, and whatever it asks for next is the next wave.
 *
 * Since objectstack#27627 the page asks all of it in ONE record page payload
 * (`POST /data/OBJ/ID/page`): the record, each related list's count and first
 * rows, and the access verdicts. The pins below read that request's body for
 * the questions the separate reads used to ask.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent } from '@testing-library/react';
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
// Registers `record:attachments`, which the package entry registers in the console.
import './record-attachments-renderer';

const BASE = 'http://test.local';
const OBJECT = 'os_13010_deal';
const QUOTE = 'os_13010_quote';
const LINE = 'os_13010_line';
const TASK = 'os_13010_task';
const REC = 'rec-13010';

const objectDef = {
  name: OBJECT,
  label: 'Deal',
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    stage: { label: 'Stage', type: 'text' },
  },
};
const child = (name: string, label: string, fk: string) => ({
  name,
  label,
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    status: { label: 'Status', type: 'text' },
    [fk]: { label: 'Deal', type: 'lookup', reference: OBJECT },
  },
});
const quoteDef = child(QUOTE, 'Quote', 'deal');
const lineDef = child(LINE, 'Line', 'deal');
const taskDef = child(TASK, 'Task', 'related_deal');

const RECORD = { id: REC, name: 'Lattice renewal', stage: 'prospecting' };

/** The declared scope the Open Tasks list carries — the rail card does not. */
const OPEN_TASKS = [{ field: 'status', operator: 'not_equals', value: 'completed' }];

/** Server-side totals per child read, larger than any `top` the page sends. */
const TOTALS: Record<string, number> = { [QUOTE]: 6, [LINE]: 7, [TASK]: 4 };

const relatedList = (id: string, objectName: string, relationshipField: string, extra: Record<string, unknown> = {}) => ({
  type: 'record:related_list',
  id,
  properties: { objectName, relationshipField, columns: ['name', 'status'], limit: 10, ...extra },
});

/** HotCRM's opportunity page, reduced to the blocks this card is about. */
const RECORD_PAGE = {
  name: 'os_13010_deal_detail',
  label: 'Deal',
  type: 'record',
  object: OBJECT,
  kind: 'full',
  template: 'default',
  isDefault: true,
  regions: [
    {
      name: 'main',
      width: 'large',
      components: [
        {
          type: 'page:tabs',
          id: 'deal_tabs',
          properties: {
            items: [
              { value: 'details', label: 'Details', children: [{ type: 'record:details', properties: { sections: [{ name: 'o', label: 'Overview', fields: ['stage'] }] } }] },
              {
                value: 'related',
                label: 'Related',
                children: [
                  relatedList('deal_quotes', QUOTE, 'deal'),
                  relatedList('deal_lines', LINE, 'deal'),
                  relatedList('deal_tasks', TASK, 'related_deal', { filter: OPEN_TASKS }),
                ],
              },
            ],
          },
        },
      ],
    },
    {
      name: 'aside',
      width: 'small',
      components: [
        {
          type: 'record:reference_rail',
          id: 'deal_rail',
          properties: {
            entries: [
              { objectName: QUOTE, relationshipField: 'deal', limit: 3 },
              { objectName: LINE, relationshipField: 'deal', limit: 3 },
              { objectName: TASK, relationshipField: 'related_deal', limit: 3 },
            ],
          },
        },
      ],
    },
  ],
};

interface Held {
  seq: number;
  wave: number;
  method: string;
  path: string;
  body: string;
  released: boolean;
  release: () => void;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const childRows = (object: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${object}-${i}`, name: `${object} row ${i}`, status: 'open' }));

/** The rows the four panel reads answer (objectui#13010 part 2). */
const FEED_ROWS: Record<string, Array<Record<string, unknown>>> = {
  sys_activity: [
    { id: 'act-1', object_name: OBJECT, record_id: REC, type: 'updated', summary: 'Stage moved to proposal', actor_name: 'Ada', timestamp: '2026-01-02T00:00:00Z' },
  ],
  sys_comment: [
    { id: 'cmt-1', thread_id: `${OBJECT}:${REC}`, body: 'Ping the buyer on Friday', author_name: 'Ada', author_id: 'u1', created_at: '2026-01-03T00:00:00Z' },
  ],
  sys_user: [{ id: 'u2', name: 'Grace', email: 'grace@test.local', image: null }],
  sys_attachment: [
    { id: 'att-1', file_id: 'file-1', file_name: 'signed-contract.pdf', size: 2048, created_at: '2026-01-04T00:00:00Z' },
  ],
};

/** The rows the History tab's audit read answers (objectui#13010 part 5). */
const AUDIT_ROWS: Record<string, Array<Record<string, unknown>>> = {
  sys_audit_log: [
    {
      id: 'aud-1',
      created_at: '2026-01-05T00:00:00Z',
      action: 'update',
      user_id: 'u2',
      old_value: JSON.stringify({ stage: 'prospecting' }),
      new_value: JSON.stringify({ stage: 'negotiation' }),
    },
  ],
};

/** The `top` a data read asked for, or undefined. */
const topOf = (h: Held): number | undefined => {
  const q = new URLSearchParams(h.path.slice(h.path.indexOf('?') + 1));
  const top = q.get('top') ?? q.get('$top');
  return top === null ? undefined : Number(top);
};
const objectOf = (h: Held): string | undefined => /\/api\/v1\/data\/([^/?]+)/.exec(h.path)?.[1];
const PAGE = `/api/v1/data/${OBJECT}/${REC}/page`;
const isPageRead = (h: Held) => h.method === 'POST' && h.path === PAGE;
/** The record read: the page payload carries it (objectstack#27627). */
const isRecordRead = (h: Held) => isPageRead(h) || (h.method === 'GET' && objectOf(h) === OBJECT);
interface PageList { object: string; field: string; filter?: unknown; top: number }
const pageBody = (h: Held) => JSON.parse(h.body || '{}') as { related?: PageList[]; explain?: string[] };
/** The related lists the open's page payload asked for. */
const pageLists = (held: Held[]): PageList[] => held.filter(isPageRead).flatMap((h) => pageBody(h).related ?? []);
const isChildRead = (h: Held) => h.method === 'GET' && [QUOTE, LINE, TASK].includes(objectOf(h) ?? '');
const isExplain = (h: Held) => h.path.endsWith('/security/explain');

function answerFor(h: Held): unknown {
  if (isPageRead(h)) {
    const body = pageBody(h);
    return {
      success: true,
      data: {
        object: OBJECT,
        id: REC,
        record: RECORD,
        related: (body.related ?? []).map((list) => {
          const total = TOTALS[list.object] ?? 0;
          return { object: list.object, field: list.field, total, records: childRows(list.object, Math.min(list.top, total)) };
        }),
        explain: Object.fromEntries((body.explain ?? []).map((op) => [op, { allowed: true, record: { recordId: REC, visible: true } }])),
        approvals: { requests: [], lock: null },
      },
    };
  }
  if (isExplain(h)) return { allowed: true, record: { recordId: REC, visible: true } };
  if (h.path.startsWith(`/api/v1/data/${OBJECT}/${REC}`)) return { success: true, data: { object: OBJECT, id: REC, record: RECORD } };
  const object = objectOf(h);
  if (object && object in TOTALS) {
    const total = TOTALS[object];
    const top = topOf(h) ?? total;
    return { success: true, data: { records: childRows(object, Math.min(top, total)), total } };
  }
  if (object && object in AUDIT_ROWS) {
    const rows = AUDIT_ROWS[object];
    return { success: true, data: { records: rows, total: rows.length } };
  }
  if (object && object in FEED_ROWS) {
    const rows = FEED_ROWS[object];
    return { success: true, data: { records: rows, total: rows.length } };
  }
  if (h.path.startsWith('/api/v1/data/')) return { success: true, data: { records: [], total: 0 } };
  return { success: true, data: [] };
}

function heldTransport() {
  const held: Held[] = [];
  const state = { wave: 1 };
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const path = decodeURIComponent(url.replace(BASE, ''));
    if (path.endsWith('/api/v1/discovery')) {
      return Promise.resolve(json({ success: true, data: { capabilities: {}, routes: {} } }));
    }
    return new Promise<Response>((resolve) => {
      const h: Held = {
        seq: held.length,
        wave: state.wave,
        method,
        path,
        body: typeof init?.body === 'string' ? init.body : '',
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
  return { fetch, held, state };
}

async function idle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * Answer the page wave by wave: everything it has asked for so far is answered
 * together, the page settles, and what it asks for next belongs to the next
 * wave. Returns once a wave asks for nothing.
 */
async function runWaves(held: Held[], state: { wave: number }) {
  await idle();
  for (let round = 0; round < 12; round++) {
    const pending = held.filter((h) => !h.released);
    if (pending.length === 0) return;
    state.wave += 1;
    await act(async () => {
      for (const h of pending) h.release();
      await new Promise((r) => setTimeout(r, 0));
    });
    await idle();
  }
  expect(held.filter((h) => !h.released)).toEqual([]);
}

/** A readable wave table for the failure message and the PR's before/after. */
const waveTable = (held: Held[]) =>
  held
    .map((h) => `w${h.wave} ${h.method} ${h.path.replace(/\?.*$/, '')}${topOf(h) !== undefined ? ` top=${topOf(h)}` : ''}${h.body ? ` ${h.body}` : ''}`)
    .join('\n');

/**
 * The rail is on screen, as HotCRM's aside is at a desktop width: every
 * observed element reports intersecting on the next tick.
 */
class VisibleObserver {
  constructor(private readonly cb: (entries: Array<{ isIntersecting: boolean }>) => void) {}
  observe() {
    queueMicrotask(() => this.cb([{ isIntersecting: true }]));
  }
  unobserve() {}
  disconnect() {}
}

interface OpenOptions {
  /** The record page; HotCRM's shape above by default. */
  page?: unknown;
  /** The record's object definition; `objectDef` above by default. */
  object?: Record<string, unknown>;
  /** The route's query string, e.g. `?tab=activity`. */
  search?: string;
  /** The IntersectionObserver the page sees; every element on screen by default. */
  observer?: unknown;
  /** Objects registered beside the record's own and its children. */
  extraObjects?: Array<Record<string, unknown>>;
}

async function openRecordPage(options: OpenOptions = {}) {
  const { fetch, held, state } = heldTransport();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('IntersectionObserver', options.observer ?? VisibleObserver);
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  const allObjects = [options.object ?? objectDef, quoteDef, lineDef, taskDef, ...(options.extraObjects ?? [])];
  (ds as unknown as { getObjectSchema: (n: string) => Promise<unknown> }).getObjectSchema = async (n: string) =>
    allObjects.find((o) => o.name === n) ?? null;

  const objects: unknown[] = allObjects;
  const pages = [options.page ?? RECORD_PAGE];
  const metadata = {
    objects, pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null,
    getItemsByType: () => pages,
  } as never;
  render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/record/${REC}${options.search ?? ''}`]}>
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
    </React.StrictMode>,
  );
  await runWaves(held, state);
  return { held, state };
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

describe('the record page open waves (objectui#13010)', () => {
  // Wave table measured on this file. Before this card: the record read, both
  // explain questions (one `update`, one `delete` — two different bodies, not
  // one question sent twice) and the rail's three `top=3` card reads in wave
  // 1; the tab strip's three `top=1` badge probes in wave 2, because the probe
  // keyed on the record BODY's id. After it: all thirteen in wave 1. Since
  // objectstack#27627 all of them are ONE page payload request.
  it('the related cards and the tab badge probes go out in the first wave, beside the record read', async () => {
    const { held } = await openRecordPage();
    const table = waveTable(held);
    expect(held.filter(isRecordRead).map((h) => h.wave), table).toEqual([1]);

    // Neither a card read nor a badge probe goes out on its own.
    expect(held.filter(isChildRead), table).toEqual([]);
    // The payload asks every card's rows: three each.
    const cards = pageLists(held).filter((l) => l.filter === undefined);
    expect(cards.map((l) => l.object).sort(), table).toEqual([LINE, QUOTE, TASK].sort());
    expect(cards.every((l) => l.top === 3), table).toBe(true);

    // One wave in all: nothing waits on the record body any more.
    expect(Math.max(...held.map((h) => h.wave)), table).toBe(1);
  });

  // objectui#13010 part 4 — the rail claims its rows while it renders, before
  // the tab strip's probe effect runs, so the badge's read asks for the card's
  // three rows with the count and the card takes them: one read per unfiltered
  // relation, whichever side the timing lets ask first. Wave table measured on
  // this file. Before part 4: 13 requests in wave 1, with quote and line each
  // read twice (a `top=1` badge probe and a `top=3` card read). After it: 11
  // requests in wave 1, quote and line each read once with `top=3`; the task
  // card and its filtered badge probe stay two different questions.
  it('each unfiltered relation the rail and the tab badge both show is ONE read, and both are drawn', async () => {
    const { held } = await openRecordPage();
    const table = waveTable(held);
    for (const object of [QUOTE, LINE]) {
      expect(held.filter((h) => objectOf(h) === object), `${object}\n${table}`).toEqual([]);
      const asked = pageLists(held).filter((l) => l.object === object);
      expect(asked.map((l) => l.top), `${object}\n${table}`).toEqual([3]);
    }
    // The badge total is drawn from that read: quote 6 + line 7 + the
    // filtered task probe's own 4.
    const relatedTab = screen.getByRole('tab', { name: /Related/ });
    expect(relatedTab.textContent, table).toContain('17');
    // The card rows are drawn from the same read: three rows each, and the
    // card's own total.
    for (const object of [QUOTE, LINE]) {
      for (let i = 0; i < 3; i++) expect(screen.getAllByText(`${object} row ${i}`).length, table).toBeGreaterThan(0);
      expect(screen.queryByText(`${object} row 3`), table).toBeNull();
    }
    expect(screen.getAllByText(String(TOTALS[QUOTE])).length, table).toBeGreaterThan(0);
    expect(screen.getAllByText(String(TOTALS[LINE])).length, table).toBeGreaterThan(0);
  });

  it('CONTROL: a badge whose declared filter differs from its card still probes, with its own filter', async () => {
    const { held } = await openRecordPage();
    const table = waveTable(held);
    const tasks = pageLists(held).filter((l) => l.object === TASK);
    expect(tasks, table).toHaveLength(2);
    const taskProbe = tasks.filter((l) => l.filter !== undefined);
    expect(taskProbe, table).toHaveLength(1);
    expect(JSON.stringify(taskProbe[0].filter), table).toContain('not_equals');
    // The card's list carries no declared scope, so its total answers a
    // different question and never stands in for the badge's.
    expect(tasks.filter((l) => l.filter === undefined), table).toHaveLength(1);
  });

  it('two explain questions on a record open, two different bodies', async () => {
    const { held } = await openRecordPage();
    const asked = [
      ...held.filter(isExplain).map((h) => JSON.parse(h.body).operation as string),
      ...held.filter(isPageRead).flatMap((h) => pageBody(h).explain ?? []),
    ];
    expect(asked.sort(), waveTable(held)).toEqual(['delete', 'update']);
  });
});

// ── objectui#13010 part 2: the panel reads wait for their panel ────────────

/** HotCRM's opportunity page with its Activity tab, and an Attachments tab. */
const tabsPage = (items: unknown[]) => ({
  ...RECORD_PAGE,
  regions: [
    {
      name: 'main',
      width: 'large',
      components: [{ type: 'page:tabs', id: 'deal_tabs', properties: { items } }],
    },
    RECORD_PAGE.regions[1],
  ],
});
const [DETAILS_TAB, RELATED_TAB] = (RECORD_PAGE.regions[0].components[0] as { properties: { items: unknown[] } }).properties.items;
const ACTIVITY_TAB = { value: 'activity', label: 'Activity', children: [{ type: 'record:activity', id: 'deal_activity' }] };
const ATTACHMENTS_TAB = { value: 'attachments', label: 'Attachments', children: [{ type: 'record:attachments', id: 'deal_files' }] };
/** HotCRM's own shape: Details first, the timeline in the Activity tab, and no Attachments node. */
const ACTIVITY_PAGE = tabsPage([DETAILS_TAB, RELATED_TAB, ACTIVITY_TAB]);
const FILES_TAB_PAGE = tabsPage([DETAILS_TAB, RELATED_TAB, ATTACHMENTS_TAB, ACTIVITY_TAB]);
/** HotCRM's opportunity declares `enable.files`, so a page without the node gets the host's own panel. */
const filesObject = { ...objectDef, enable: { files: true } };

const isPanelRead = (object: string) => (h: Held) => h.method === 'GET' && objectOf(h) === object;
const isActivityRead = isPanelRead('sys_activity');
const isCommentRead = isPanelRead('sys_comment');
const isUserListRead = (h: Held) => isPanelRead('sys_user')(h) && topOf(h) === 50;
const isAttachmentListRead = (h: Held) => isPanelRead('sys_attachment')(h) && topOf(h) === 100;
/** The `record:activity` block's node, as `SchemaRenderer` marks it in the DOM. */
const ACTIVITY_MOUNT = '[data-obj-id="deal_activity"]';
const FOUR_READS = [isActivityRead, isCommentRead, isUserListRead, isAttachmentListRead];

/**
 * Every element is on screen except the host's foot-of-page Attachments panel,
 * which is below the record's content until `scrollFallbackIntoView` says it
 * scrolled in.
 */
const offscreen: Array<{ cb: (entries: Array<{ isIntersecting: boolean }>) => void; live: boolean }> = [];
class FoldObserver {
  private readonly entries: Array<{ cb: FoldObserver['cb']; live: boolean }> = [];
  constructor(private readonly cb: (entries: Array<{ isIntersecting: boolean }>) => void) {}
  observe(el: Element) {
    if (el.hasAttribute('data-record-attachments-fallback')) {
      const entry = { cb: this.cb, live: true };
      this.entries.push(entry);
      offscreen.push(entry);
      return;
    }
    queueMicrotask(() => this.cb([{ isIntersecting: true }]));
  }
  unobserve() {}
  disconnect() {
    for (const entry of this.entries) entry.live = false;
  }
}
async function scrollFallbackIntoView() {
  await act(async () => {
    for (const entry of offscreen) if (entry.live) entry.cb([{ isIntersecting: true }]);
  });
}

/** Open a tab the way a user does: Radix activates a trigger on mouse down. */
async function openTab(name: string) {
  const trigger = screen.getByRole('tab', { name: new RegExp(`^${name}`) });
  await act(async () => {
    fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false });
  });
}

describe('the timeline, comments, attachments and user list wait for their panel (objectui#13010 part 2)', () => {
  beforeEach(() => {
    offscreen.length = 0;
  });

  // Wave table measured on this file, ACTIVITY_PAGE over `filesObject`. Before
  // this part: `sys_user top=50`, `sys_comment`, `sys_activity top=200` and the
  // foot panel's `sys_attachment top=100` all in wave 1 beside the record read.
  // After it: none of the four until the tab opens or the panel scrolls in.
  it('a record whose default tab draws none of them issues none of the four reads at open', async () => {
    const { held } = await openRecordPage({ page: ACTIVITY_PAGE, object: filesObject, observer: FoldObserver });
    const table = waveTable(held);
    expect(held.filter(isRecordRead).map((h) => h.wave), table).toEqual([1]);
    for (const isRead of FOUR_READS) expect(held.filter(isRead), table).toEqual([]);
    // The foot panel is mounted and shows its loading state, not "no attachments".
    const fallback = document.querySelector('[data-record-attachments-fallback]');
    expect(fallback, table).not.toBeNull();
    expect(fallback?.textContent ?? '', table).not.toContain('signed-contract.pdf');
  });

  it('opening the Activity tab reads the timeline, the comments and the user list once each, and draws their rows', async () => {
    const { held, state } = await openRecordPage({ page: ACTIVITY_PAGE, object: filesObject, observer: FoldObserver });
    // Everything the open asked for is answered; the tab's reads come after.
    const openedWith = held.length;
    await openTab('Activity');
    await runWaves(held, state);
    const table = waveTable(held);
    for (const isRead of [isActivityRead, isCommentRead, isUserListRead]) {
      const reads = held.filter(isRead);
      expect(reads, table).toHaveLength(1);
      expect(reads[0].seq, table).toBeGreaterThanOrEqual(openedWith);
    }
    expect(held.filter(isActivityRead)[0].path, table).toContain('top=200');
    expect(screen.getByText('Stage moved to proposal')).toBeTruthy();
    expect(screen.getByText('Ping the buyer on Friday')).toBeTruthy();
    // The attachments list is not the Activity tab's: still unread.
    expect(held.filter(isAttachmentListRead), table).toEqual([]);
  });

  // Drift pin: "not read" holds only because the block is not MOUNTED. A tab
  // strip that began mounting a non-first tab unprompted would draw the block
  // over a feed nobody reads; this turns red on that, not just on a read.
  it('a page whose feed tab is not first, opened with no ?tab=, neither reads the feed nor mounts its block', async () => {
    const { held } = await openRecordPage({ page: ACTIVITY_PAGE, object: filesObject, observer: FoldObserver });
    const table = waveTable(held);
    for (const isRead of [isActivityRead, isCommentRead, isUserListRead]) expect(held.filter(isRead), table).toEqual([]);
    expect(document.querySelector(ACTIVITY_MOUNT), table).toBeNull();
    // Nor any feed panel at all: a mounted one over an unread feed shows its loading state.
    expect(screen.queryByTestId('activity-loading'), table).toBeNull();
  });

  // An authored `properties.defaultTab` beats `?tab=` in the renderer (the
  // `properties` hoist runs after `withPageTabsUrlSync` writes `?tab=`), so the
  // view may not judge such a strip by `?tab=`: it reads the feed at open.
  it('a strip whose properties.defaultTab names the Activity tab still reads the feed when ?tab= names another tab', async () => {
    const page = {
      ...ACTIVITY_PAGE,
      regions: [
        { name: 'main', width: 'large', components: [{ type: 'page:tabs', id: 'deal_tabs', properties: { items: [DETAILS_TAB, ACTIVITY_TAB], defaultTab: 'activity' } }] },
        RECORD_PAGE.regions[1],
      ],
    };
    const { held } = await openRecordPage({ page, object: filesObject, observer: FoldObserver, search: '?tab=details' });
    const table = waveTable(held);
    for (const isRead of [isActivityRead, isCommentRead, isUserListRead]) expect(held.filter(isRead), table).toHaveLength(1);
    expect(document.querySelector(ACTIVITY_MOUNT), table).not.toBeNull();
    expect(screen.getByText('Stage moved to proposal')).toBeTruthy();
    expect(screen.getByText('Ping the buyer on Friday')).toBeTruthy();
  });

  it('the foot-of-page Attachments panel reads once it scrolls into view, and draws its rows', async () => {
    const { held, state } = await openRecordPage({ page: ACTIVITY_PAGE, object: filesObject, observer: FoldObserver });
    expect(held.filter(isAttachmentListRead), waveTable(held)).toEqual([]);
    await scrollFallbackIntoView();
    await runWaves(held, state);
    const table = waveTable(held);
    expect(held.filter(isAttachmentListRead), table).toHaveLength(1);
    expect(screen.getByText('signed-contract.pdf')).toBeTruthy();
  });

  it('CONTROL: a record opened on its Activity tab reads all three at open, and draws the same rows', async () => {
    const { held } = await openRecordPage({ page: ACTIVITY_PAGE, object: filesObject, observer: FoldObserver, search: '?tab=activity' });
    const table = waveTable(held);
    // The mount marker the drift pin below reads is real: present when the tab is.
    expect(document.querySelector(ACTIVITY_MOUNT), table).not.toBeNull();
    for (const isRead of [isActivityRead, isCommentRead, isUserListRead]) {
      expect(held.filter(isRead).map((h) => h.wave), table).toEqual([1]);
    }
    expect(screen.getByText('Stage moved to proposal')).toBeTruthy();
    expect(screen.getByText('Ping the buyer on Friday')).toBeTruthy();
  });

  it('CONTROL: a record opened on its Attachments tab reads the list at open; the tab badge probe goes out either way', async () => {
    const closed = await openRecordPage({ page: FILES_TAB_PAGE, object: filesObject, observer: FoldObserver });
    const closedTable = waveTable(closed.held);
    expect(closed.held.filter(isAttachmentListRead), closedTable).toEqual([]);
    const closedProbes = closed.held.filter((h) => isPanelRead('sys_attachment')(h) && topOf(h) === 1);
    expect(closedProbes.map((h) => h.wave), closedTable).toEqual([1]);

    cleanup();
    RelatedCountStore._reset();
    __clearRecordEditableCache();
    __resetRecordApprovalsStore();

    const open = await openRecordPage({ page: FILES_TAB_PAGE, object: filesObject, observer: FoldObserver, search: '?tab=attachments' });
    const openTable = waveTable(open.held);
    expect(open.held.filter(isAttachmentListRead).map((h) => h.wave), openTable).toEqual([1]);
    expect(open.held.filter((h) => isPanelRead('sys_attachment')(h) && topOf(h) === 1).map((h) => h.wave), openTable).toEqual([1]);
    expect(screen.getByText('signed-contract.pdf')).toBeTruthy();
  });

  // The synthesized page has no discussion footer any more (#27055), and no
  // tab strip at any width since objectstack#27524: its one stream is the 动态
  // panel, the first panel of the right column — on screen at open in every
  // tier, so the feed is read at open, like an authored page opened on its
  // Activity tab. A page with tabs still waits for its tab (above).
  it('the synthesized page reads the feed and the user list at open: its 动态 panel is on screen', async () => {
    const { held } = await openRecordPage({ page: { ...RECORD_PAGE, isDefault: false, object: 'os_13010_other' }, observer: FoldObserver });
    const table = waveTable(held);
    expect(screen.queryByRole('tab', { name: /^Timeline/ }), table).toBeNull();
    expect(document.querySelector('[data-record-timeline-panel]'), table).not.toBeNull();
    for (const isRead of [isActivityRead, isCommentRead, isUserListRead]) {
      expect(held.filter(isRead).map((h) => h.wave), table).toEqual([1]);
    }
  });

  it('CONTROL: the synthesized page opened on its 动态 tab (?related=timeline) reads the feed and the user list at open', async () => {
    const { held } = await openRecordPage({ page: { ...RECORD_PAGE, isDefault: false, object: 'os_13010_other' }, observer: FoldObserver, search: '?related=timeline' });
    const table = waveTable(held);
    for (const isRead of [isActivityRead, isCommentRead, isUserListRead]) {
      expect(held.filter(isRead).map((h) => h.wave), table).toEqual([1]);
    }
  });
});

// ── objectui#13010 part 5: the audit read goes out with its stream (#27055 merged History into it; #27524 made the stream a panel) ──

/** Registered, so the view merges field changes into the timeline of a `trackHistory` object. */
const auditLogDef = {
  name: 'sys_audit_log',
  label: 'Audit Log',
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    created_at: { label: 'Created', type: 'datetime' },
    action: { label: 'Action', type: 'text' },
    user_id: { label: 'User', type: 'text' },
    old_value: { label: 'Old', type: 'textarea' },
    new_value: { label: 'New', type: 'textarea' },
  },
};
const historyObject = { ...objectDef, enable: { trackHistory: true } };
/** No record page is assigned to the object, so the view synthesizes its default page. */
const SYNTH = { ...RECORD_PAGE, isDefault: false, object: 'os_13010_other' };
const isAuditRead = isPanelRead('sys_audit_log');
/** The audit timeline's actor-name lookup: `sys_user` by the row's `user_id`, not the 50-row mention list. */
const isAuditUserLookup = (h: Held) => isPanelRead('sys_user')(h) && h.path.includes('u2') && topOf(h) === 1;
const openHistory = (options: OpenOptions = {}) =>
  openRecordPage({ page: SYNTH, object: historyObject, extraObjects: [auditLogDef], observer: FoldObserver, ...options });

describe('the 动态 stream reads the audit log when it is shown (objectui#13010 part 5)', () => {
  beforeEach(() => {
    offscreen.length = 0;
  });

  // Wave table measured on this file, the synthesized page of a `trackHistory`
  // object. Before this part: `sys_audit_log top=50` in wave 1 beside the
  // record read and its `sys_user` name lookup in wave 2, with the History tab
  // closed. After it: neither until the tab opens. Since #27055 the audit rows
  // are the field changes of the one stream, so the stream gates them; since
  // objectstack#27524 that stream is the 动态 panel, on screen at open, so
  // they are read at open — once, and not again when its tab opens.
  it('a trackHistory record reads the audit log at open and its user names next: the 动态 panel shows the change', async () => {
    const { held } = await openHistory();
    const table = waveTable(held);
    expect(held.filter(isRecordRead).map((h) => h.wave), table).toEqual([1]);
    expect(screen.queryByRole('tab', { name: /^(Timeline|History)/ }), table).toBeNull();
    expect(held.filter(isAuditRead).map((h) => h.wave), table).toEqual([1]);
    expect(held.filter(isAuditUserLookup).map((h) => h.wave), table).toEqual([2]);
    const panel = document.querySelector('[data-record-timeline-panel]') as HTMLElement;
    expect(panel.textContent, table).toMatch(/negotiation/);
  });

  it('opening the 动态 tab from its panel reads nothing again, and draws the rows with their actor', async () => {
    const { held, state } = await openHistory();
    const audit = () => held.filter(isAuditRead);
    expect(audit(), waveTable(held)).toHaveLength(1);
    await act(async () => {
      fireEvent.click(document.querySelector('[data-record-timeline-panel-open]') as HTMLElement);
    });
    await runWaves(held, state);
    const table = waveTable(held);
    expect(document.querySelector('[data-related-enlarged="timeline"]'), table).not.toBeNull();
    expect(audit(), table).toHaveLength(1);
    expect(topOf(audit()[0]), table).toBe(50);
    expect(held.filter(isAuditUserLookup), table).toHaveLength(1);
    expect(screen.getByText('Grace')).toBeTruthy();
    expect(screen.getByText(/negotiation/)).toBeTruthy();
  });

  it('CONTROL: a trackHistory record opened with ?related=timeline reads the audit log at open and draws the rows', async () => {
    const { held } = await openHistory({ search: '?related=timeline' });
    const table = waveTable(held);
    expect(held.filter(isAuditRead).map((h) => h.wave), table).toEqual([1]);
    expect(held.filter(isAuditUserLookup).map((h) => h.wave), table).toEqual([2]);
    expect(screen.getByText('Grace')).toBeTruthy();
    expect(screen.getByText(/negotiation/)).toBeTruthy();
  });

  // Only the synthesized page hands the view's audit rows to a block; an
  // assigned page's `record:history` reads its own source. So an assigned page
  // never shows what this read fetches.
  it('an assigned page of a trackHistory object never reads the audit log', async () => {
    const { held } = await openHistory({ page: ACTIVITY_PAGE, search: '?tab=activity' });
    const table = waveTable(held);
    expect(held.filter(isActivityRead), table).toHaveLength(1);
    expect(held.filter(isAuditRead), table).toEqual([]);
    expect(held.filter(isAuditUserLookup), table).toEqual([]);
  });
});
