// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 (item 3) — an `object` leaf's list-view properties mark the
 * view settings the AI copilot changed, and the elements it added to an array
 * setting (a kanban card's fields), from the draft read's `draftChanges`
 * (objectstack#24298 / #24395).
 *
 * The REAL hook (`useObjectListViewDraft`) and the REAL panel over a REAL
 * `MetadataClient`, whose transport is an in-memory server answering as the
 * framework does.
 *
 * Pinned:
 *  - a setting whose answering entry is `by: 'copilot'` shows the draft chip;
 *    the elements the copilot added to `kanban.columns` are marked and the
 *    published ones are not, read by comparing the draft's array with the
 *    published one — the ONE layered read this adds beside a draft;
 *  - the source line names the added elements and the minutes since `at`;
 *  - a `studio` entry draws nothing and adds no read;
 *  - CONTROLS: a published view with no draft draws nothing; a draft whose read
 *    recorded no `draftChanges` draws nothing and sends no `/layers`; a draft
 *    created over no published body (`[]`) marks every element without one;
 *  - the panel's save sends `?surface=studio`, once.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.acme.app';
const VIEW = 'acme_loan.default';

const OBJECT_DEF = {
  name: 'acme_loan',
  label: 'Loan',
  fields: {
    book: { name: 'book', label: 'Book', type: 'text' },
    reader: { name: 'reader', label: 'Reader', type: 'text' },
    due_date: { name: 'due_date', label: 'Due date', type: 'date' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

/** The object's default list view as a kanban board, with these card fields. */
const kanbanView = (cardFields: string[], extra: Record<string, unknown> = {}) => ({
  name: VIEW,
  object: 'acme_loan',
  viewKind: 'list',
  isDefault: true,
  config: {
    type: 'kanban',
    data: { provider: 'object', object: 'acme_loan' },
    columns: ['book', 'status'],
    kanban: { groupByField: 'status', columns: cardFields },
    ...extra,
  },
});

const server = {
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, { row: Record<string, unknown>; draftChanges?: unknown[] }>(),
  requests: [] as Array<{ method: string; path: string; search: string }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  server.requests.push({ method, path: url.pathname, search: url.search });
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') {
    return json(200, { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1], packageId: PKG })) });
  }
  if (method === 'PUT') return json(200, { success: true, version: 'v2', state: 'draft' });
  if (seg[0] === 'object' && seg.length === 2) return json(200, { type: 'object', name: seg[1], item: OBJECT_DEF });
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = server.active.get(key);
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  if (seg.length === 2 && url.searchParams.get('state') === 'draft') {
    const draft = server.drafts.get(key);
    if (!draft) return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
    return json(200, {
      type: seg[0],
      name: seg[1],
      item: { ...draft.row, _draft: true },
      version: 'v1',
      ...(draft.draftChanges ? { draftChanges: draft.draftChanges } : {}),
    });
  }
  const row = server.active.get(key);
  return row ? json(200, { type: seg[0], name: seg[1], item: row }) : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client };
});

import { ObjectListViewInspector, useObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';
import { tFormat } from '../metadata-admin/i18n';

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_DEF],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
};

const LEAF: Surface = { type: 'object', name: 'acme_loan', label: 'Loans' };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000 - 5_000).toISOString();

function Host() {
  const listView = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  return (
    <>
      <ObjectListViewInspector listView={listView} readOnly={false} locale="en-US" />
      <button type="button" data-testid="save" onClick={() => void listView.save({ unmoved: () => true })} />
    </>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function openPanel(): Promise<HTMLElement> {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Host />
    </MetadataCtx.Provider>,
  );
  await settle();
  return screen.getByTestId('studio-list-view-inspector');
}

const layersAsked = () => server.requests.filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/view/${VIEW}/layers`).length;
const chipsOf = (panel: HTMLElement) =>
  within(panel).queryAllByTestId('studio-draft-chip').map((c) => c.getAttribute('data-draft-of'));
// objectui#12725 (the remainder) — the element marks moved from a chip list
// under each widget into the widgets' own rows (`copilotAdded`), so an element
// mark is read as the chip in a row, named by the element it marks.
const markedElements = (panel: HTMLElement) =>
  within(panel).queryAllByTestId('studio-draft-element-chip').map((e) => e.getAttribute('data-draft-of'));
/** The row drawing the element stored as `name`, inside the section `testId`. */
const rowIn = (panel: HTMLElement, testId: string, name: string): HTMLElement =>
  within(within(panel).getByTestId(testId)).getByText(name, { selector: 'code' }).closest('div')!;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.requests = [];
});
afterEach(cleanup);

describe('ObjectListViewInspector — the copilot’s draft marks (objectui#12725)', () => {
  it('marks the copilot’s setting and only the card fields it added, with one layered read beside the draft', async () => {
    server.active.set(`view/${VIEW}`, kanbanView(['book']));
    server.drafts.set(`view/${VIEW}`, {
      row: kanbanView(['book', 'reader', 'due_date'], { sort: [{ field: 'due_date', order: 'asc' }] }),
      draftChanges: [
        { path: ['config', 'kanban', 'columns'], by: 'copilot', actor: 'usr_1', at: minutesAgo(2) },
        { path: ['config', 'sort'], by: 'studio', actor: 'usr_1', at: minutesAgo(1) },
      ],
    });
    const panel = await openPanel();

    expect(chipsOf(panel)).toEqual(['kanban.columns']);
    expect(markedElements(panel)).toEqual(['reader', 'due_date']);
    // Each mark sits in its element's row of the card-field widget; the
    // published element's row carries none.
    for (const name of ['reader', 'due_date']) {
      expect(within(rowIn(panel, 'list-view-kanban-fields', name)).getByTestId('studio-draft-element-chip')).toHaveAttribute('data-draft-of', name);
    }
    expect(within(rowIn(panel, 'list-view-kanban-fields', 'book')).queryByTestId('studio-draft-element-chip')).toBeNull();
    expect(within(panel).getByTestId('studio-draft-source')).toHaveTextContent(
      tFormat('engine.studio.draftMark.sourceItems', 'en-US', {
        items: '"Reader", "Due date"',
        count: 2,
        when: tFormat('engine.studio.draftMark.minutesAgo', 'en-US', { n: 2 }),
      }),
    );
    expect(layersAsked()).toBe(1);
  });

  it('a setting the copilot changed outright carries the chip (the kanban title)', async () => {
    server.active.set(`view/${VIEW}`, kanbanView(['book']));
    server.drafts.set(`view/${VIEW}`, {
      row: { ...kanbanView(['book']), config: { ...kanbanView(['book']).config, kanban: { groupByField: 'status', columns: ['book'], titleField: 'reader' } } },
      draftChanges: [{ path: ['config', 'kanban', 'titleField'], by: 'copilot', actor: 'usr_1', at: minutesAgo(5) }],
    });
    const panel = await openPanel();
    expect(chipsOf(panel)).toEqual(['kanban.titleField']);
    expect(markedElements(panel)).toEqual([]);
    expect(within(panel).getByTestId('studio-draft-source')).toHaveTextContent(
      tFormat('engine.studio.draftMark.source', 'en-US', { when: tFormat('engine.studio.draftMark.minutesAgo', 'en-US', { n: 5 }) }),
    );
  });

  it('a `studio` entry draws no copilot mark and adds no read', async () => {
    server.active.set(`view/${VIEW}`, kanbanView(['book']));
    server.drafts.set(`view/${VIEW}`, {
      row: kanbanView(['book', 'reader']),
      draftChanges: [{ path: ['config', 'kanban', 'columns'], by: 'studio', actor: 'usr_1', at: minutesAgo(2) }],
    });
    const panel = await openPanel();
    expect(chipsOf(panel)).toEqual([]);
    expect(markedElements(panel)).toEqual([]);
    expect(within(panel).queryByTestId('studio-draft-source')).toBeNull();
    expect(layersAsked()).toBe(0);
  });

  it('CONTROL: a published view with no pending draft draws no mark', async () => {
    server.active.set(`view/${VIEW}`, kanbanView(['book', 'reader']));
    const panel = await openPanel();
    expect(chipsOf(panel)).toEqual([]);
    expect(markedElements(panel)).toEqual([]);
    expect(layersAsked()).toBe(1);
  });

  it('CONTROL: a draft whose read recorded no `draftChanges` draws no mark and sends no /layers', async () => {
    server.active.set(`view/${VIEW}`, kanbanView(['book']));
    server.drafts.set(`view/${VIEW}`, { row: kanbanView(['book', 'reader']) });
    const panel = await openPanel();
    expect(chipsOf(panel)).toEqual([]);
    expect(markedElements(panel)).toEqual([]);
    expect(layersAsked()).toBe(0);
  });

  it('CONTROL: a draft the copilot created over no published body (`[]`) marks every element, with no /layers', async () => {
    server.drafts.set(`view/${VIEW}`, {
      row: kanbanView(['book', 'reader']),
      draftChanges: [{ path: [], by: 'copilot', actor: 'usr_1', at: minutesAgo(3) }],
    });
    const panel = await openPanel();
    // Re-pointed (objectui#12725, the remainder): the marks are read in the
    // widgets' sections, where their rows now carry them.
    const elementsIn = (testId: string) =>
      within(within(panel).getByTestId(testId)).getAllByTestId('studio-draft-element-chip').map((e) => e.getAttribute('data-draft-of'));
    expect(elementsIn('list-view-kanban-fields')).toEqual(['book', 'reader']);
    expect(elementsIn('list-view-columns')).toEqual(['book', 'status']);
    expect(layersAsked()).toBe(0);
  });

  it('the panel’s save sends `?surface=studio`, once', async () => {
    server.active.set(`view/${VIEW}`, kanbanView(['book']));
    await openPanel();
    fireEvent.click(screen.getByTestId('save'));
    await settle();
    const puts = server.requests.filter((r) => r.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(new URLSearchParams(puts[0]!.search).getAll('surface')).toEqual(['studio']);
  });
});
