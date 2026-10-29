/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27056 — the record page's related column loads counts first,
 * then the first rows of only the cards in view, and never blocks the details.
 *
 * The REAL page, at a desktop width (the column tiers), over a data source
 * that holds every related read until the test answers it. The record has six
 * related lists. Measured:
 *
 *  - the details draw from the record read alone, while every related read is
 *    still out, and the related column shows one placeholder per card;
 *  - the six counts go out as ONE request set, before any of them answers;
 *  - once they answer, rows are read for the two counted cards in view only,
 *    three rows each — never for a card counted at 0 (in view too), never for
 *    the cards below the fold.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';

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
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
// Orthogonal chrome — stubbed so the only asynchrony here is the page's own.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const PARENT = 'os_27056_account';
const RECORD_ID = 'acc-1';
const CHILDREN = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((n) => `os_27056_${n}`);
const [C1, C2, C3] = CHILDREN;
/** What each child's count answers: the second is empty. */
const TOTALS: Record<string, number> = Object.fromEntries(CHILDREN.map((c, i) => [c, [5, 0, 2, 4, 4, 4][i]]));
/** The cards on screen at open: the first three; the rest are below the fold. */
const IN_VIEW = new Set([C1, C2, C3].map((c) => `${c}.account`));

const OBJECTS = [
  {
    name: PARENT,
    label: 'Account',
    pluralLabel: 'Accounts',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      industry: { type: 'text', label: 'Industry' },
    },
  },
  ...CHILDREN.map((name, i) => ({
    name,
    label: `Child ${i + 1}`,
    pluralLabel: `Children ${i + 1}`,
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
      account: { type: 'lookup', reference: PARENT, label: 'Account' },
    },
  })),
];

interface HeldRead {
  object: string;
  query: Record<string, any>;
  answered: boolean;
  answer: () => void;
}

let reads: HeldRead[] = [];
let dataSource: Record<string, any>;

function makeDataSource() {
  return {
    find: vi.fn((object: string, query: Record<string, any> = {}) => {
      if (!CHILDREN.includes(object)) return Promise.resolve({ data: [], total: 0 });
      return new Promise((resolve) => {
        const read: HeldRead = {
          object,
          query,
          answered: false,
          answer: () => {
            read.answered = true;
            const total = TOTALS[object];
            const top = typeof query.$top === 'number' ? query.$top : total;
            const rows = Array.from({ length: Math.min(top, total) }, (_, i) => ({
              id: `${object}-${i}`,
              name: `${object} row ${i}`,
              status: 'open',
            }));
            resolve({ data: rows, total });
          },
        };
        reads.push(read);
      });
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ id, name: 'Acme', industry: 'Retail' })),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name) ?? null),
    create: vi.fn(async (_o: string, row: unknown) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

/** The viewport: a card's root intersects when its relationship is on screen. */
class ViewportObserver {
  constructor(private readonly cb: (entries: Array<{ isIntersecting: boolean }>) => void) {}
  observe(el: Element) {
    const id = el.getAttribute('data-related-card-id');
    if (id && IN_VIEW.has(id)) queueMicrotask(() => this.cb([{ isIntersecting: true }]));
  }
  unobserve() {}
  disconnect() {}
}

function renderPage() {
  dataSource = makeDataSource();
  const metadata = {
    objects: OBJECTS,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as never;
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${PARENT}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={metadata}>
        <RecordDetailView
          dataSource={dataSource as never}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={PARENT}
          recordIdOverride={RECORD_ID}
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

async function idle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const isCount = (r: HeldRead) => r.query.$count === true && r.query.$skip === undefined;
const isRows = (r: HeldRead) => r.query.$skip !== undefined;
const column = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-record-column="${name}"]`) as HTMLElement | null;

beforeEach(() => {
  cleanup();
  reads = [];
  RelatedCountStore._reset();
  window.localStorage.clear();
  vi.stubGlobal('IntersectionObserver', ViewportObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute('data-record-page-root')) return measure.call(this);
    return { x: 0, y: 0, top: 0, left: 0, right: 1440, bottom: 900, width: 1440, height: 900, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordDetailView — the related column loads counts first (objectstack#27056)', () => {
  it('draws the details before any related read answers, with one placeholder per card', async () => {
    const { container } = renderPage();
    await idle();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => !r.answered)).toBe(true);
    // The record's own values — its name, its highlight, its details — are on
    // screen from the record read alone.
    expect(container.textContent).toContain('Acme');
    expect(container.textContent).toContain('Retail');
    expect(column(container, 'details')?.textContent).toContain(RECORD_ID);
    const related = column(container, 'related')!;
    expect(related.querySelectorAll('[data-related-card-pending]')).toHaveLength(CHILDREN.length);
    expect(related.querySelector('[data-related-card-row]')).toBeNull();
  });

  it('asks the six counts as one request set, then the rows of the two counted cards in view only', async () => {
    const { container } = renderPage();
    await idle();
    // One request set: every list's count, all out before any answered, and
    // nothing else of theirs.
    expect(reads.filter(isCount).map((r) => r.object).sort()).toEqual([...CHILDREN].sort());
    expect(reads.filter(isRows)).toEqual([]);
    expect(reads.filter(isCount).every((r) => r.query.$top === 1)).toBe(true);

    await act(async () => {
      for (const r of reads.filter((read) => !read.answered)) r.answer();
    });
    await idle();
    const rowReads = reads.filter(isRows);
    // The counted cards in view: the first and the third. The second is in
    // view but counted at 0; the last three are below the fold.
    expect(rowReads.map((r) => r.object).sort()).toEqual([C1, C3].sort());
    for (const r of rowReads) {
      expect(r.query.$top).toBe(3);
      expect(r.query.$select).toEqual(['id', 'name', 'status']);
    }
    // Two round trips in all: the counts, then the rows.
    expect(reads).toHaveLength(CHILDREN.length + 2);

    await act(async () => {
      for (const r of reads.filter((read) => !read.answered)) r.answer();
    });
    await idle();
    const related = column(container, 'related')!;
    expect(related.querySelector(`[data-related-card-id="${C1}.account"]`)?.querySelectorAll('[data-related-card-row]')).toHaveLength(3);
    expect(related.querySelector(`[data-related-card-id="${C3}.account"]`)?.querySelectorAll('[data-related-card-row]')).toHaveLength(2);
    expect(related.querySelector('[data-related-card-pending]')).toBeNull();
    // Still nothing for the empty card, nor for the cards out of view.
    expect(reads.filter(isRows).map((r) => r.object).sort()).toEqual([C1, C3].sort());
    expect(reads.some((r) => r.object === C2 && isRows(r))).toBe(false);
  });
});
