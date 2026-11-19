// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35061 (item 3) — the Data pillar's Records tab under a narrow
 * content column, on the REAL records grid (plugin-view's ObjectView,
 * plugin-list's ListView, the components data table):
 *
 * - the grid's scrollbar is drawn at rest on the Records body;
 * - a long text column stops at the grid's 400 px ceiling;
 * - a column selected by its header is scrolled into view, clear of the frozen
 *   name column ({@link revealColumn}, also pinned on a bare table below).
 *
 * The name column's freeze is objectstack#34794's pin
 * (`DataPillar.recordsTab-34794.test.tsx`). jsdom lays nothing out: boxes are
 * stubbed where the reveal reads them, and the rest pins the classes and
 * styles the browser reads; it is no screenshot.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope: the cold transform is paid during collection, which no test or
// hook timeout clocks (ui/AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { render, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RECORDS_SCROLLBAR_VISIBLE, revealColumn } from './recordsGridChrome';

const OBJECT = 'showcase_meeting';
const LONG = 'Agenda: '.padEnd(300, 'x');

const AUTHORED = {
  name: OBJECT,
  label: 'Meeting',
  fields: {
    title: { type: 'text', label: 'Meeting name' },
    place: { type: 'text', label: 'Place' },
    notes: { type: 'textarea', label: 'Notes' },
    held_on: { type: 'date', label: 'Held on' },
  },
};

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'object' ? [{ name: OBJECT, label: 'Meeting' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: AUTHORED, code: AUTHORED })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
};

const ROWS = [{ id: 'm1', title: 'All hands', place: 'Room A', notes: LONG, held_on: '2026-11-20' }];

function createDataSource() {
  return {
    find: vi.fn(async () => ROWS),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => AUTHORED),
  };
}
let dataSource = createDataSource();

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

// The source under test reaches a dynamic import of `@objectstack/lint`: its first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import { DataPillar } from './StudioDesignSurface';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { ObjectFieldInspector } from '../metadata-admin/inspectors/ObjectFieldInspector';

registerMetadataInspector('object', ObjectFieldInspector);

beforeEach(() => {
  dataSource = createDataSource();
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** A box with a layout: the rect jsdom does not compute. */
function place(el: Element, left: number, width: number) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left, right: left + width, width, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON() {} }),
  });
}

/** A scroll box whose `scrollLeft` keeps what is written, and moves its cells with it. */
function scrollBox(el: HTMLElement, clientWidth: number) {
  let left = 0;
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (v: number) => {
      left = v;
    },
  });
  place(el, 0, clientWidth);
}

describe('revealColumn (objectstack#35061)', () => {
  function table(cells: Array<{ key: string; left: number; width: number; sticky?: boolean }>, clientWidth = 600) {
    const box = document.createElement('div');
    box.setAttribute('data-table-scroll-box', '');
    const tr = document.createElement('tr');
    for (const c of cells) {
      const th = document.createElement('th');
      th.setAttribute('data-column-key', c.key);
      if (c.sticky) th.style.position = 'sticky';
      place(th, c.left, c.width);
      tr.appendChild(th);
    }
    box.appendChild(tr);
    document.body.appendChild(box);
    scrollBox(box, clientWidth);
    return { box, th: (k: string) => tr.querySelector(`[data-column-key="${k}"]`)! };
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('scrolls a column past the right edge in, the least that shows it whole', () => {
    const { box, th } = table([
      { key: 'name', left: 0, width: 200, sticky: true },
      { key: 'a', left: 200, width: 300 },
      { key: 'b', left: 500, width: 250 },
    ]);
    expect(revealColumn(th('b'))).toBe(150);
    expect(box.scrollLeft).toBe(150);
  });

  it('scrolls a column hidden under the frozen name column back out from under it', () => {
    const { box, th } = table([
      { key: 'name', left: 0, width: 200, sticky: true },
      { key: 'a', left: 120, width: 300 },
    ]);
    box.scrollLeft = 400;
    expect(revealColumn(th('a'))).toBe(320);
  });

  it('keeps clear of a right-pinned column after it (the row actions)', () => {
    const { th } = table([
      { key: 'name', left: 0, width: 200, sticky: true },
      { key: 'a', left: 380, width: 200 },
      { key: '_actions', left: 540, width: 60, sticky: true },
    ]);
    expect(revealColumn(th('a'))).toBe(40);
  });

  it('leaves a column already in view, and a frozen one, where it is', () => {
    const { box, th } = table([
      { key: 'name', left: 0, width: 200, sticky: true },
      { key: 'a', left: 200, width: 300 },
    ]);
    expect(revealColumn(th('a'))).toBeNull();
    expect(revealColumn(th('name'))).toBeNull();
    expect(box.scrollLeft).toBe(0);
  });

  it('a column wider than the free part starts at its left edge', () => {
    const { th } = table([
      { key: 'name', left: 0, width: 200, sticky: true },
      { key: 'a', left: 450, width: 500 },
    ]);
    expect(revealColumn(th('a'))).toBe(250);
  });
});

async function renderGrid() {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.querySelector('thead th[data-column-key="title"]')).not.toBeNull(), {
    timeout: 8000,
  });
  await waitFor(() => expect(document.querySelector('tbody')?.textContent).toContain('All hands'), { timeout: 8000 });
}

const header = (key: string) => document.querySelector(`thead th[data-column-key="${key}"]`) as HTMLElement;

describe('the Records tab under a narrow column (objectstack#35061)', () => {
  it("the Records body draws the grid's scrollbar at rest, over the grid's own scroll box", async () => {
    await renderGrid();
    const body = document.querySelector('[data-testid="data-records-body"]') as HTMLElement;
    for (const c of RECORDS_SCROLLBAR_VISIBLE.split(' ')) expect(body.className.split(/\s+/)).toContain(c);
    expect(RECORDS_SCROLLBAR_VISIBLE).toContain('[data-table-scroll-box]');
    expect(body.querySelector('[data-table-scroll-box]')).toContainElement(header('notes'));
  });

  it('a long text column stops at 400 px; its width is its floor, so a narrow pane scrolls rather than squeezes it', async () => {
    await renderGrid();
    const notes = header('notes');
    expect(notes.style.width).toBe('400px');
    expect(notes.style.minWidth).toBe('400px');
  });

  it('a header click on a column past the right edge scrolls it into view, clear of the frozen name column', async () => {
    await renderGrid();
    const box = header('title').closest('[data-table-scroll-box]') as HTMLElement;
    scrollBox(box, 600);
    // The browser's layout: the name column pinned at the left, Notes cut at the right.
    header('title').style.position = 'sticky';
    place(header('title'), 0, 200);
    place(header('place'), 200, 120);
    place(header('notes'), 320, 400);
    await userEvent.click(within(header('notes')).getByText('Notes'));
    await waitFor(() => expect(box.scrollLeft).toBe(120));
  });
});
