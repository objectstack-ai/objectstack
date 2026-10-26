/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12104 — an explicit `groupByField` draws one group per key, and the
 * key is the field's DISPLAY value.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * Two defects on the same path, both read off HotCRM (objectstack-ai/hotcrm#2058):
 *
 * 1. The group key was the RAW `item[groupByField]`, stringified. The
 *    timeline's own fetch expands every declared relation
 *    (`buildExpandFields(objectDef?.fields)`), so a lookup arrives as
 *    `{ id, name }` and every row keyed on `String(value)`, which is
 *    "[object Object]": `owner_id` and `crm_account` timelines drew one group.
 *    The title and the description already resolve through `@object-ui/core`'s
 *    `recordDisplayValueAt` (objectui#10530); the group key now does too.
 * 2. Rows are sorted by start date, and the vertical renderer merged only
 *    ADJACENT equal keys. That is right for date buckets, which are contiguous
 *    in date order by construction, and wrong for a field whose values
 *    interleave in date order: a `channel` timeline drew DIGITAL, EMAIL,
 *    DIGITAL, … as separate groups.
 *
 * ── The order this file pins ────────────────────────────────────────────────
 * Groups appear in the order of each key's EARLIEST entry, and entries keep
 * their date order inside a group. That is the order the renderer already drew
 * whenever a key's rows happened to be contiguous, so a timeline that rendered
 * correctly before renders the same now. The arms are built so that this
 * order differs from the alphabetical order and from the input order.
 *
 * ── The controls ────────────────────────────────────────────────────────────
 * The date buckets (no `groupByField`), an unexpanded lookup id (the
 * resolver's own answer: the id itself, no name is invented for it, AGENTS.md
 * #0.1), a multi-valued field (its key is left as it was), and the horizontal
 * rail, which draws no groups and keeps its date order. Each was right before the fix and must stay right after it. The
 * horizontal arm is also why the bucketing lives in the renderer's vertical
 * branch and not in the composer: both branches draw the same item array.
 *
 * `./renderer` is deliberately NOT mocked: the groups are read off the real
 * `TimelineRenderer` output. Harness as in
 * `ObjectTimeline.lookupDisplay-10530.test.tsx` (the fetch path) and
 * `ObjectTimeline.pastBucket-11676.test.tsx` (the frozen clock).
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ObjectTimeline } from '../ObjectTimeline';

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const OBJECT = 'crm_task';

/** `owner_id` is the lookup under test, `channel` a text field, `stage` a select. */
const FIELDS = {
  subject: { type: 'text' },
  due: { type: 'date' },
  owner_id: { type: 'lookup', reference: 'sys_user' },
  channel: { type: 'text' },
  stage: {
    type: 'select',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'won', label: 'Won' },
    ],
  },
};

/** Expanded lookups, as a server `$expand` returns the related record. */
const ALICE = { id: 'u1', name: 'Alice' };
const BOB = { id: 'u2', name: 'Bob' };

type Row = Record<string, unknown> & { id: string; subject: string; due: string | null };

/**
 * Four rows whose keys INTERLEAVE in date order (First, Second, Third, Fourth),
 * handed over out of date order so the rail's own sort is what orders them.
 * The earliest row is Alice's / SMS / `open`, and the input starts with a Bob /
 * EMAIL / `won` row, so neither the input order nor the alphabetical order
 * gives the pinned group order.
 */
const INTERLEAVED: Row[] = [
  { id: 't2', subject: 'Second', due: '2026-03-02', owner_id: BOB, channel: 'EMAIL', stage: 'won' },
  { id: 't3', subject: 'Third', due: '2026-03-03', owner_id: ALICE, channel: 'SMS', stage: 'open' },
  { id: 't1', subject: 'First', due: '2026-03-01', owner_id: ALICE, channel: 'SMS', stage: 'open' },
  { id: 't4', subject: 'Fourth', due: '2026-03-04', owner_id: BOB, channel: 'EMAIL', stage: 'won' },
];

const block = (extra: Record<string, unknown> = {}) => ({
  type: 'object-timeline',
  objectName: OBJECT,
  timeline: { startDateField: 'due', titleField: 'subject', ...extra },
});

/**
 * A server double that expands `owner_id` only when the query asks for it, and
 * otherwise answers the bare foreign key. So a name can reach the rail only
 * through the component's own `$expand`.
 */
function makeDataSource(rows: Row[]) {
  return {
    find: vi.fn(async (_object: string, params?: { $expand?: string[] }) => {
      const expand = params?.$expand ?? [];
      return {
        data: rows.map((r) => {
          const owner = r.owner_id as { id?: unknown } | undefined;
          return expand.includes('owner_id') || owner == null || typeof owner !== 'object'
            ? r
            : { ...r, owner_id: owner.id };
        }),
      };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS })),
  };
}

/** Every group as `Header: title, title`, in render order. */
function feed(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="timeline-canvas"] section')).map((section) => {
    const header = section.querySelector('header > span:first-child')?.textContent ?? '';
    const titles = Array.from(section.querySelectorAll('h3')).map((h3) => h3.textContent);
    return `${header}: ${titles.join(', ')}`;
  });
}

/** The title lines, in rail order, whether or not the rail draws groups. */
function titles(): Array<string | null> {
  return Array.from(document.querySelectorAll('[data-testid="timeline-canvas"] h3')).map((el) => el.textContent);
}

/** Mount over the component's own object fetch, and wait for every row. */
async function mountFetched(extra: Record<string, unknown>, rows: Row[] = INTERLEAVED) {
  const dataSource = makeDataSource(rows);
  const props = { schema: block(extra), dataSource } as unknown as React.ComponentProps<typeof ObjectTimeline>;
  render(<ObjectTimeline {...props} />);
  await waitFor(() => expect(titles()).toHaveLength(rows.length));
  return dataSource;
}

/** Mount over inline rows, which never fetch. */
function mountInline(schema: Record<string, unknown>, rows: Row[]) {
  // `data` is an undeclared passthrough prop on ObjectTimelineProps (the
  // component reads it off the rest args, which is how ListView feeds it).
  const props = { schema, data: rows } as unknown as React.ComponentProps<typeof ObjectTimeline>;
  render(<ObjectTimeline {...props} />);
  screen.getByText(rows[0].subject);
}

/** The `$expand` the settled query asked the server for. */
function lastExpand(dataSource: ReturnType<typeof makeDataSource>): string[] {
  const calls = dataSource.find.mock.calls;
  return calls[calls.length - 1]?.[1]?.$expand ?? [];
}

describe('an explicit groupByField draws one group per display value (objectui#12104)', () => {
  // ── THE CARD'S DEFECTS ────────────────────────────────────────────────────
  it("the reach path: a lookup groups by the referenced record's name over the timeline's own expanded fetch", async () => {
    const dataSource = await mountFetched({ groupByField: 'owner_id' });

    expect(lastExpand(dataSource)).toContain('owner_id');
    expect(feed()).toEqual(['Alice: First, Third', 'Bob: Second, Fourth']);
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('a text key whose rows interleave in date order is bucketed: one group per key, dates ordered within each', () => {
    mountInline(block({ groupByField: 'channel' }), INTERLEAVED);

    expect(feed()).toEqual(['SMS: First, Third', 'EMAIL: Second, Fourth']);
  });

  it('empty values share ONE "Unassigned" group, placed by its earliest entry like any other key', () => {
    mountInline(block({ groupByField: 'channel' }), [
      { id: 't1', subject: 'First', due: '2026-03-01', channel: 'SMS' },
      { id: 't2', subject: 'Second', due: '2026-03-02', channel: '' },
      { id: 't3', subject: 'Third', due: '2026-03-03', channel: 'SMS' },
      { id: 't4', subject: 'Fourth', due: '2026-03-04', channel: null },
    ]);

    expect(feed()).toEqual(['SMS: First, Third', 'Unassigned: Second, Fourth']);
  });

  it("a select key is still its option's label, and its options are bucketed the same way", async () => {
    await mountFetched({ groupByField: 'stage' });

    expect(feed()).toEqual(['Open: First, Third', 'Won: Second, Fourth']);
  });

  // ── THE KEY'S EMPTINESS IS THE RESOLVER'S ─────────────────────────────────
  // When no row has a display value the feed falls back to date buckets (one
  // "Unassigned" lane would be useless). "No display value" is the resolver's
  // definition: a whitespace-only string and an expanded record with no name
  // are empty, like `null` and `''`.
  it('when no row has a display value for the key, the feed falls back to its date buckets', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0));
    mountInline(block({ groupByField: 'owner_id' }), [
      { id: 't1', subject: 'First', due: '2026-10-01', owner_id: null },
      { id: 't2', subject: 'Second', due: '2026-10-06', owner_id: '   ' },
      { id: 't3', subject: 'Third', due: '2026-12-01', owner_id: { id: 'u9' } },
    ]);

    expect(feed()).toEqual(['Earlier: First', 'Today: Second', 'Later: Third']);
  });

  // ── THE CONTROLS ──────────────────────────────────────────────────────────
  it('CONTROL: an unexpanded lookup id groups under the id itself, the resolver\'s answer; no name is invented for it', () => {
    mountInline(block({ groupByField: 'owner_id' }), [
      { id: 't1', subject: 'First', due: '2026-03-01', owner_id: 'u1' },
      { id: 't2', subject: 'Second', due: '2026-03-02', owner_id: 'u1' },
      { id: 't3', subject: 'Third', due: '2026-03-03', owner_id: 'u2' },
    ]);

    expect(feed()).toEqual(['u1: First, Second', 'u2: Third']);
  });

  // An array has no display value under the resolver, so a multi-valued field
  // keeps the key it had (its stringified value) rather than moving every row
  // under "Unassigned". How a multi-valued row should group is not decided here.
  it('CONTROL: a multi-valued field keeps the group key it had', () => {
    mountInline(block({ groupByField: 'tags' }), [
      { id: 't1', subject: 'First', due: '2026-03-01', tags: ['urgent', 'vip'] },
      { id: 't2', subject: 'Second', due: '2026-03-02', tags: ['urgent', 'vip'] },
      { id: 't3', subject: 'Third', due: '2026-03-03', tags: ['vip'] },
    ]);

    expect(feed()).toEqual(['urgent,vip: First, Second', 'vip: Third']);
  });

  it('CONTROL: a timeline with no groupByField draws its date buckets, in date order, exactly as before', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Tuesday 2026-10-06, noon, local time; every value is date-only, which
    // `toDisplayDate` reads as local midnight of that day (objectui#10866).
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0));
    mountInline(block(), [
      { id: '5', subject: 'Next month', due: '2026-11-20' },
      { id: '7', subject: 'Undated', due: null },
      { id: '2', subject: 'Now', due: '2026-10-06' },
      { id: '1', subject: 'Yesterday', due: '2026-10-05' },
      { id: '4', subject: 'Next Tuesday', due: '2026-10-13' },
      { id: '3', subject: 'Next day', due: '2026-10-07' },
      { id: '0', subject: 'Last month', due: '2026-09-02' },
    ]);

    expect(feed()).toEqual([
      'Earlier: Last month, Yesterday',
      'Today: Now',
      'Tomorrow: Next day',
      'Next week: Next Tuesday',
      'Later: Next month',
      'No date: Undated',
    ]);
  });

  it('CONTROL: the horizontal rail draws no groups and keeps its date order with a groupByField set', () => {
    mountInline({ ...block({ groupByField: 'channel' }), variant: 'horizontal' }, INTERLEAVED);

    expect(feed()).toEqual([]);
    expect(titles()).toEqual(['First', 'Second', 'Third', 'Fourth']);
  });
});
