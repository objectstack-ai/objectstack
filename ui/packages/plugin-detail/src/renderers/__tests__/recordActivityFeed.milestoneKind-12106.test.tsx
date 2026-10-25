/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `completed` row that an object's `activityMilestones` fired is not a
 * completed task (objectui#12106).
 *
 * plugin-audit forwards a milestone's declared `type` into `sys_activity.type`
 * verbatim, so "Case resolved" declared with `type: 'completed'` arrives as a
 * `completed` row. The mapper sent every such row to `task`, and
 * `showCompleted`'s spec default (`false`) hid it from every record page that
 * did not author the flag, including the synthesized default page.
 *
 * Since objectstack#22771 the writer stamps `metadata.kind: 'milestone'` on a
 * fired milestone row (ADR-0052 §5), and the redaction serves it. Triage ruled
 * route B: this reader reads that marker. The unlock added one condition: a
 * row WITHOUT the marker behaves exactly as today, because a runtime from
 * before the writer change (the v17 install face) serves no marker at all. The
 * CONTROL pins below hold that face.
 *
 * The served `metadata` is a JSON STRING: the column is a `textarea` declared
 * "JSON-serialized additional context", and the writer's own test reads the
 * served row with `JSON.parse(r.metadata)`. The fixtures below spell it the
 * same way.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { FeedItemType as SpecFeedItemType } from '@objectstack/spec/data';
import { RecordContextProvider } from '@object-ui/react';
import type { DataSource, FeedItem } from '@object-ui/types';
import {
  MILESTONE_ACTIVITY_FEED_TYPE,
  PRODUCED_FEED_TYPES,
  activityRowToFeedItem,
  applyFeedConfig,
  type SysActivityRow,
} from '../recordActivityFeed';
import { RecordActivityRenderer } from '../record-activity';

/** The served `metadata` of a fired milestone: the change, plus the kind. */
const milestoneMetadata = (from: string, to: string): string =>
  JSON.stringify({ old: { status: from }, new: { status: to }, kind: 'milestone' });

/** "Case resolved", declared on `crm_case` with `type: 'completed'`. */
const CASE_RESOLVED: SysActivityRow = {
  id: 'act-case-resolved',
  type: 'completed',
  summary: 'Case resolved: Printer jam on floor 3',
  timestamp: '2026-10-02T09:00:00.000Z',
  actor_name: 'Grace',
  object_name: 'crm_case',
  record_id: 'case-1',
  metadata: milestoneMetadata('in_progress', 'resolved'),
};

/**
 * A completed activity that is not a milestone, as a runtime serves it with no
 * marker: the CRUD mirror's change without a `kind`. A v17 runtime serves a
 * fired milestone in exactly this shape too.
 */
const COMPLETED_UNMARKED: SysActivityRow = {
  id: 'act-completed-unmarked',
  type: 'completed',
  summary: 'Follow-up call logged',
  timestamp: '2026-10-01T09:00:00.000Z',
  actor_name: 'Ada',
  object_name: 'crm_case',
  record_id: 'case-1',
  metadata: JSON.stringify({ old: { status: 'open' }, new: { status: 'held' } }),
};

/** The showcase task's own milestone, on that task's own record page. */
const TASK_OWN_COMPLETION: SysActivityRow = {
  id: 'act-task-completed',
  type: 'completed',
  summary: '✅ Task completed: Write the launch notes',
  timestamp: '2026-10-03T09:00:00.000Z',
  actor_name: 'Ada',
  object_name: 'showcase_task',
  record_id: 'task-1',
  metadata: milestoneMetadata('in_progress', 'done'),
};

const typeOf = (row: SysActivityRow): FeedItem['type'] | undefined =>
  activityRowToFeedItem(row, 'System')?.type;

const mapAll = (rows: SysActivityRow[]): FeedItem[] =>
  rows.map((row) => activityRowToFeedItem(row, 'System')).filter((i): i is FeedItem => i !== null);

const ids = (items: readonly FeedItem[]) => items.map((i) => String(i.id)).sort();

describe('the mapper reads the milestone marker (objectui#12106)', () => {
  it('maps a marked `completed` row to the milestone feed type, not `task`', () => {
    expect(typeOf(CASE_RESOLVED)).toBe(MILESTONE_ACTIVITY_FEED_TYPE);
    expect(MILESTONE_ACTIVITY_FEED_TYPE).toBe('system');
  });

  it('the milestone feed type is one the spec declares, and the produced set names it', () => {
    expect(SpecFeedItemType.options).toContain(MILESTONE_ACTIVITY_FEED_TYPE);
    expect(PRODUCED_FEED_TYPES.has(MILESTONE_ACTIVITY_FEED_TYPE)).toBe(true);
  });

  it('changes only the type: the rest of the item is built as before', () => {
    const marked = activityRowToFeedItem(CASE_RESOLVED, 'System');
    const unmarked = activityRowToFeedItem({ ...CASE_RESOLVED, metadata: undefined }, 'System');
    expect(unmarked?.type).toBe('task');
    expect(marked).toEqual({ ...unmarked, type: MILESTONE_ACTIVITY_FEED_TYPE });
  });

  it.each([
    ['no `metadata` at all (a row an app inserted)', undefined],
    ['the change without a `kind` (the v17 face)', JSON.stringify({ old: { status: 'open' }, new: { status: 'resolved' } })],
    ['a `kind` an app wrote that is not a milestone', JSON.stringify({ kind: 'email' })],
    ['a string that is not JSON', 'kind=milestone'],
    ['a JSON value that is not an object', JSON.stringify(['milestone'])],
    ['an already-parsed object, which no served row carries', { kind: 'milestone' }],
  ])('CONTROL: a `completed` row with %s still maps to `task`', (_label, metadata) => {
    expect(typeOf({ ...CASE_RESOLVED, metadata })).toBe('task');
  });

  it('CONTROL: the marker moves no row that would not be hidden as completed', () => {
    const marked = { metadata: milestoneMetadata('open', 'qualified') };
    expect(typeOf({ ...CASE_RESOLVED, ...marked, type: 'updated' })).toBe('field_change');
    expect(typeOf({ ...CASE_RESOLVED, ...marked, type: 'scheduled' })).toBe('event');
    expect(typeOf({ ...CASE_RESOLVED, ...marked, type: 'system' })).toBe('system');
  });
});

describe('`showCompleted` keeps its meaning for unmarked rows only (objectui#12106)', () => {
  const feed = mapAll([CASE_RESOLVED, COMPLETED_UNMARKED]);

  it('a milestone row is shown under `showCompleted`\'s default', () => {
    // `record:discussion` is the block the synthesized default page composes.
    const applied = applyFeedConfig(feed, {}, 50, 'record:discussion');
    expect(ids(applied.items)).toContain(String(CASE_RESOLVED.id));
  });

  it('CONTROL: a `completed` row with no marker is hidden by default, as today', () => {
    for (const block of ['record:discussion', 'record:activity']) {
      const applied = applyFeedConfig(feed, {}, 50, block);
      expect(ids(applied.items), block).toEqual([String(CASE_RESOLVED.id)]);
    }
  });

  it('CONTROL: `showCompleted: true` shows both', () => {
    const applied = applyFeedConfig(feed, { showCompleted: true }, 50, 'record:discussion');
    expect(ids(applied.items)).toEqual(ids(feed));
  });

  it('a task\'s own completion milestone, on that task\'s own page, is shown', () => {
    const applied = applyFeedConfig(mapAll([TASK_OWN_COMPLETION]), {}, 50, 'record:discussion');
    expect(ids(applied.items)).toEqual([String(TASK_OWN_COMPLETION.id)]);
  });

  it('`types: [\'task\']` still selects tasks only: a milestone is not one', () => {
    const applied = applyFeedConfig(feed, { types: ['task'], showCompleted: true }, 50, 'record:activity');
    expect(ids(applied.items)).toEqual([String(COMPLETED_UNMARKED.id)]);
  });
});

describe('the `record:activity` self-fetch shows the milestone (objectui#12106)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders "Case resolved" and hides the unmarked completion by default', async () => {
    // A partial double: the self-fetch calls `find` and nothing else.
    const find = vi.fn(async () => ({ data: [CASE_RESOLVED, COMPLETED_UNMARKED], total: 2 }));
    const dataSource = { find } as unknown as DataSource;
    render(
      <RecordContextProvider
        objectName="crm_case"
        recordId="case-1"
        data={{ id: 'case-1', name: 'Printer jam on floor 3' }}
        dataSource={dataSource}
      >
        <RecordActivityRenderer schema={{}} />
      </RecordContextProvider>,
    );
    await waitFor(() => expect(find).toHaveBeenCalled());
    expect(await screen.findByText(String(CASE_RESOLVED.summary))).toBeTruthy();
    expect(screen.queryByText(String(COMPLETED_UNMARKED.summary))).toBeNull();
  });
});
