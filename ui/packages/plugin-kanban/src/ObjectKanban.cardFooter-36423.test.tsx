/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36423 — the view's `kanban.cardFooter`: the counts a card shows
 * at its foot, as `ListView` relays them onto the board node.
 *
 * Rows:
 *   (a) `{ comments: true, attachments: true }` on an object with discussion
 *       and files: each card shows its open comment threads and its
 *       attachments, from ONE grouped read per counted object over the loaded
 *       cards (never one per card); resolved threads and replies are not
 *       counted, and a card with none draws no footer;
 *   (b) without the key, or with both members off, nothing is read and no
 *       footer is drawn;
 *   (c) an object without `enable.files` is never asked its attachments, and
 *       one with `enable.feeds: false` never its comments;
 *   (d) a refused read draws no count, and the board still draws its cards;
 *   (e) a cut answer (`hasMore`, the door's default page size) is asked again
 *       over the cards it did not name, so every card past the cut still
 *       shows its count;
 *   (f) a write to a counted object announced on the data-invalidation bus (a
 *       comment posted in the record drawer) asks the counts again.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ValueDataSource, extractRecords } from '@object-ui/core';
import { SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
import { ObjectKanban } from './ObjectKanban';
// The board renders inside a `React.lazy` boundary; importing the chunk at
// module scope bills the cold transform to the import phase (objectui#3010).
import './KanbanImpl';

const { permsStub } = vi.hoisted(() => ({
  permsStub: {
    isLoaded: false,
    checkField: () => true,
    check: () => ({ allowed: true }),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    userId: null,
    systemPermissions: undefined,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  },
}));
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

type Row = Record<string, unknown>;

const objectSchema = (enable: Record<string, unknown>) => ({
  name: 'foot_deal',
  enable,
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    stage: {
      name: 'stage',
      type: 'select',
      label: 'Stage',
      options: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }],
    },
  },
});

const DEALS = [
  { id: 'd1', name: 'Alpha', stage: 'open' },
  { id: 'd2', name: 'Beta', stage: 'open' },
  { id: 'd3', name: 'Gamma', stage: 'won' },
];

const COMMENTS: Row[] = [
  // d1: two open threads, one resolved thread, and a reply (not a thread).
  { id: 'c1', object_name: 'foot_deal', record_id: 'd1', parent_id: null, is_resolved: false },
  { id: 'c2', object_name: 'foot_deal', record_id: 'd1', parent_id: null, is_resolved: null },
  { id: 'c3', object_name: 'foot_deal', record_id: 'd1', parent_id: null, is_resolved: true },
  { id: 'c4', object_name: 'foot_deal', record_id: 'd1', parent_id: 'c1', is_resolved: false },
  // d3: one open thread. Another object's comment on the same id is not d3's.
  { id: 'c5', object_name: 'foot_deal', record_id: 'd3', parent_id: null, is_resolved: false },
  { id: 'c6', object_name: 'other_object', record_id: 'd3', parent_id: null, is_resolved: false },
];

const ATTACHMENTS: Row[] = [
  { id: 'a1', parent_object: 'foot_deal', parent_id: 'd2' },
  { id: 'a2', parent_object: 'foot_deal', parent_id: 'd2' },
  { id: 'a3', parent_object: 'foot_deal', parent_id: 'd2' },
  { id: 'a4', parent_object: 'other_object', parent_id: 'd1' },
];

/**
 * A grouped count over the rows of `object` as the platform's door answers
 * it: one row per group key, `count` per group, over the rows `where` keeps
 * (evaluated by `ValueDataSource`, as a backend would).
 */
function countDoor(tables: Record<string, Row[]>, refuse: ReadonlySet<string> = new Set(), page?: number) {
  return vi.fn(async (object: string, query: any) => {
    if (refuse.has(object)) throw Object.assign(new Error('forbidden'), { status: 403 });
    const store = new ValueDataSource<Row>({ items: tables[object] ?? [] });
    const kept = extractRecords(
      await store.find(object, { ...(query.where ? { $filter: query.where } : {}), $top: 100000 } as any),
    ) as Row[];
    const key = query.groupBy[0];
    const groups = new Map<unknown, number>();
    for (const row of kept) groups.set(row[key] ?? null, (groups.get(row[key] ?? null) ?? 0) + 1);
    const rows = [...groups].map(([k, count]) => ({ [key]: k, count }));
    // The door's default page size: a grouped read naming no `limit` is cut,
    // and the answer says so ON the array.
    return page !== undefined ? Object.assign(rows.slice(0, page), { hasMore: rows.length > page }) : rows;
  });
}

async function renderBoard(
  extra: Record<string, unknown>,
  enable: Record<string, unknown> = { feeds: true, files: true },
  refuse?: ReadonlySet<string>,
  page?: number,
  tables: Record<string, Row[]> = { sys_comment: COMMENTS, sys_attachment: ATTACHMENTS },
) {
  const queryGroupHeaders = countDoor(tables, refuse, page);
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: DEALS, total: DEALS.length }),
    queryGroupHeaders,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema(enable)),
  } as any;
  const result = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ObjectKanban
        schema={{ type: 'object-kanban', objectName: 'foot_deal', groupBy: 'stage', ...extra } as any}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(result.container.textContent).toContain('Gamma'));
  return { ...result, queryGroupHeaders };
}

const cardOf = (container: HTMLElement, id: string): HTMLElement => {
  const card = container.querySelector<HTMLElement>(`[data-kanban-card="${id}"]`);
  if (!card) throw new Error(`no card ${id}`);
  return card;
};
const countReads = (spy: ReturnType<typeof vi.fn>, object: string) =>
  spy.mock.calls.filter(([o]) => o === object);

afterEach(cleanup);

describe('the card footer counts (objectstack#36423)', () => {
  it('(a) shows each card\'s open threads and attachments from one grouped read per counted object', async () => {
    const { container, queryGroupHeaders } = await renderBoard({ cardFooter: { comments: true, attachments: true } });
    await waitFor(() => expect(cardOf(container, 'd1').querySelector('[data-kanban-card-comments]')).not.toBeNull());
    await waitFor(() => expect(cardOf(container, 'd2').querySelector('[data-kanban-card-attachments]')).not.toBeNull());

    // d1: the two open top-level threads; the resolved one and the reply are not counted.
    expect(cardOf(container, 'd1').querySelector('[data-kanban-card-comments]')).toHaveAttribute('data-kanban-card-comments', '2');
    expect(cardOf(container, 'd1').querySelector('[data-kanban-card-comments]')).toHaveAttribute('title', 'Open comments: 2');
    // Another object's attachment on d1's id is not d1's.
    expect(cardOf(container, 'd1').querySelector('[data-kanban-card-attachments]')).toBeNull();
    expect(cardOf(container, 'd2').querySelector('[data-kanban-card-attachments]')).toHaveAttribute('data-kanban-card-attachments', '3');
    expect(cardOf(container, 'd2').querySelector('[data-kanban-card-comments]')).toBeNull();
    expect(cardOf(container, 'd3').querySelector('[data-kanban-card-comments]')).toHaveAttribute('data-kanban-card-comments', '1');
    expect(cardOf(container, 'd3').querySelector('[data-kanban-card-footer]')).not.toBeNull();

    // ONE read per counted object, over the loaded cards.
    const commentReads = countReads(queryGroupHeaders, 'sys_comment');
    const attachmentReads = countReads(queryGroupHeaders, 'sys_attachment');
    expect(commentReads).toHaveLength(1);
    expect(attachmentReads).toHaveLength(1);
    expect(commentReads[0][1]).toEqual({
      where: { object_name: 'foot_deal', record_id: { $in: ['d1', 'd2', 'd3'] }, parent_id: null, is_resolved: { $ne: true } },
      groupBy: ['record_id'],
      aggregations: [{ function: 'count', alias: 'count' }],
    });
    expect(attachmentReads[0][1]).toEqual({
      where: { parent_object: 'foot_deal', parent_id: { $in: ['d1', 'd2', 'd3'] } },
      groupBy: ['parent_id'],
      aggregations: [{ function: 'count', alias: 'count' }],
    });
  });

  it('(b) reads and draws nothing without the key, or with both members off', async () => {
    for (const extra of [{}, { cardFooter: {} }, { cardFooter: { comments: false, attachments: false } }]) {
      const { container, queryGroupHeaders } = await renderBoard(extra);
      // Give an asked read the time to land.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(countReads(queryGroupHeaders, 'sys_comment')).toHaveLength(0);
      expect(countReads(queryGroupHeaders, 'sys_attachment')).toHaveLength(0);
      expect(container.querySelector('[data-kanban-card-footer]')).toBeNull();
      cleanup();
    }
  });

  it('(c) never asks a count the object does not have', async () => {
    const noFiles = await renderBoard({ cardFooter: { comments: true, attachments: true } }, { feeds: true });
    await waitFor(() => expect(cardOf(noFiles.container, 'd1').querySelector('[data-kanban-card-comments]')).not.toBeNull());
    expect(countReads(noFiles.queryGroupHeaders, 'sys_attachment')).toHaveLength(0);
    expect(noFiles.container.querySelector('[data-kanban-card-attachments]')).toBeNull();
    cleanup();

    const noFeeds = await renderBoard({ cardFooter: { comments: true, attachments: true } }, { feeds: false, files: true });
    await waitFor(() => expect(cardOf(noFeeds.container, 'd2').querySelector('[data-kanban-card-attachments]')).not.toBeNull());
    expect(countReads(noFeeds.queryGroupHeaders, 'sys_comment')).toHaveLength(0);
    expect(noFeeds.container.querySelector('[data-kanban-card-comments]')).toBeNull();
  });

  it('(d) a refused read draws no count, and the other count still draws', async () => {
    const { container, queryGroupHeaders } = await renderBoard(
      { cardFooter: { comments: true, attachments: true } },
      { feeds: true, files: true },
      new Set(['sys_comment']),
    );
    await waitFor(() => expect(cardOf(container, 'd2').querySelector('[data-kanban-card-attachments]')).not.toBeNull());
    expect(countReads(queryGroupHeaders, 'sys_comment')).toHaveLength(1);
    expect(container.querySelector('[data-kanban-card-comments]')).toBeNull();
    expect(container.textContent).toContain('Alpha');
  });

  it('(e) a cut answer is asked again over the cards it did not name', async () => {
    // A page of one group: d1 then d3 have open threads, each answer cut.
    const { container, queryGroupHeaders } = await renderBoard(
      { cardFooter: { comments: true } },
      { feeds: true, files: true },
      undefined,
      1,
    );
    await waitFor(() => expect(cardOf(container, 'd3').querySelector('[data-kanban-card-comments]')).not.toBeNull());
    expect(cardOf(container, 'd1').querySelector('[data-kanban-card-comments]')).toHaveAttribute('data-kanban-card-comments', '2');
    expect(cardOf(container, 'd3').querySelector('[data-kanban-card-comments]')).toHaveAttribute('data-kanban-card-comments', '1');
    const reads = countReads(queryGroupHeaders, 'sys_comment');
    // Each round is one grouped read over the cards not yet named, never one
    // per card; the second answer is whole (one group fits the page).
    expect(reads.map(([, q]) => q.where.record_id.$in)).toEqual([['d1', 'd2', 'd3'], ['d2', 'd3']]);
  });

  it('(f) a comment written elsewhere asks the counts again', async () => {
    const comments: Row[] = [{ id: 'c1', object_name: 'foot_deal', record_id: 'd2', parent_id: null, is_resolved: false }];
    const { container, queryGroupHeaders } = await renderBoard(
      { cardFooter: { comments: true } },
      { feeds: true, files: true },
      undefined,
      undefined,
      { sys_comment: comments, sys_attachment: [] },
    );
    await waitFor(() => expect(cardOf(container, 'd2').querySelector('[data-kanban-card-comments]')).toHaveAttribute('data-kanban-card-comments', '1'));
    expect(cardOf(container, 'd1').querySelector('[data-kanban-card-footer]')).toBeNull();

    // The record drawer posts a thread on d1: the data source's mutation event
    // reaches the bus as a `sys_comment` write.
    comments.push({ id: 'c2', object_name: 'foot_deal', record_id: 'd1', parent_id: null, is_resolved: false });
    act(() => notifyDataChanged({ objectName: 'sys_comment', recordId: 'c2' }));
    await waitFor(() => expect(cardOf(container, 'd1').querySelector('[data-kanban-card-comments]')).toHaveAttribute('data-kanban-card-comments', '1'));
    expect(countReads(queryGroupHeaders, 'sys_comment')).toHaveLength(2);
  });
});
