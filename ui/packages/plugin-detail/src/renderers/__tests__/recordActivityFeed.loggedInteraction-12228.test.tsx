/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A call, meeting or email logged on a record is not a finished task
 * (objectui#12228).
 *
 * The three actions that log one (HotCRM's `log_call` / `log_meeting` from its
 * activity-action factory, and `send_email`) each write the rich record first
 * and then ONE `sys_activity` row of `type: 'completed'` that points at it
 * through the ADR-0052 pair `source_object` / `source_id`. The mapper sends
 * every `completed` row to a `task` item, and `showCompleted`'s spec default
 * (`false`) hid them all, so on an object with no authored record page (the
 * synthesized default page, whose `record:discussion` carries no `feed`) a
 * logged call never appeared.
 *
 * Triage ruled the filter tells the two apart by the row's own fields, and
 * that the synthesizer's default is NOT flipped. The field is the pointer:
 * `isLoggedInteraction` in `recordActivityFeed.ts` says why, and why not
 * `metadata.kind` and not a different feed type.
 *
 * The fixtures below are the shapes those producers write, read at
 * objectstack-ai/hotcrm `0f84c9c` (a dated reading; nothing here re-reads it).
 * The served `metadata` is a JSON string, as in the objectui#12106 pins.
 *
 * Resolution: every import is this package's own source by relative path, and
 * `@object-ui/react` / `@object-ui/core` are mapped to their `src` by the root
 * `vitest.config.mts` alias table, so nothing here reads a `dist/`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { DiscussionContextProvider, RecordContextProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import type { DataSource, FeedItem } from '@object-ui/types';
import {
  activityRowToFeedItem,
  applyFeedConfig,
  type SysActivityRow,
} from '../recordActivityFeed';
import { RecordActivityRenderer } from '../record-activity';
import { buildDefaultPageSchema, type ObjectDefLike } from '../../synth/buildDefaultPageSchema';
import '../../index';

/** `log_call` on a contact: a held `crm_event`, then the timeline pointer. */
const LOGGED_CALL: SysActivityRow = {
  id: 'act-call',
  type: 'completed',
  summary: 'Discovery call with Ada (20 min)',
  timestamp: '2026-10-01T09:00:00.000Z',
  actor_name: 'Grace',
  object_name: 'crm_contact',
  record_id: 'contact-1',
  record_label: 'Ada Lovelace',
  source_object: 'crm_event',
  source_id: 'evt-call-1',
  metadata: JSON.stringify({ kind: 'call', duration_minutes: 20, notes: '', attendee_count: 2 }),
};

/** `log_meeting`: the same factory, a `Meeting: ` summary prefix. */
const LOGGED_MEETING: SysActivityRow = {
  id: 'act-meeting',
  type: 'completed',
  summary: 'Meeting: Quarterly review (45 min)',
  timestamp: '2026-10-02T09:00:00.000Z',
  actor_name: 'Grace',
  object_name: 'crm_contact',
  record_id: 'contact-1',
  record_label: 'Ada Lovelace',
  source_object: 'crm_event',
  source_id: 'evt-meeting-1',
  metadata: JSON.stringify({ kind: 'meeting', duration_minutes: 45, notes: '', attendee_count: 3 }),
};

/** `send_email`: a `sys_email` row, then the pointer to it. */
const SENT_EMAIL: SysActivityRow = {
  id: 'act-email',
  type: 'completed',
  summary: 'Email: Proposal follow-up',
  timestamp: '2026-10-03T09:00:00.000Z',
  actor_name: 'Grace',
  object_name: 'crm_contact',
  record_id: 'contact-1',
  record_label: 'Ada Lovelace',
  source_object: 'sys_email',
  source_id: 'email-1',
  metadata: JSON.stringify({ kind: 'email', to: 'ada@example.test', subject: 'Proposal follow-up' }),
};

/** A completed activity with no pointer: a finished task, hidden by default. */
const FINISHED_TASK: SysActivityRow = {
  id: 'act-task',
  type: 'completed',
  summary: 'Send the signed contract',
  timestamp: '2026-10-04T09:00:00.000Z',
  actor_name: 'Ada',
  object_name: 'crm_contact',
  record_id: 'contact-1',
};

const LOGGED = [LOGGED_CALL, LOGGED_MEETING, SENT_EMAIL];
const ALL_ROWS = [...LOGGED, FINISHED_TASK];

const mapAll = (rows: SysActivityRow[]): FeedItem[] =>
  rows.map((row) => activityRowToFeedItem(row, 'System')).filter((i): i is FeedItem => i !== null);

const ids = (items: readonly FeedItem[]) => items.map((i) => String(i.id)).sort();
const idsOf = (rows: readonly SysActivityRow[]) => rows.map((r) => String(r.id)).sort();

/** The two block names whose feed the default page and authored pages run. */
const BLOCKS = ['record:discussion', 'record:activity'] as const;

describe('a logged interaction stays a `task` item (objectui#12228)', () => {
  it('the mapper is unchanged: each logged row maps to `task`, carrying its pointer', () => {
    for (const row of LOGGED) {
      const item = activityRowToFeedItem(row, 'System');
      expect(item?.type, String(row.id)).toBe('task');
      expect(item?.sourceObject, String(row.id)).toBe(row.source_object);
      expect(item?.sourceId, String(row.id)).toBe(row.source_id);
    }
  });
});

describe('`showCompleted` governs finished tasks only (objectui#12228)', () => {
  const feed = mapAll(ALL_ROWS);

  it.each(BLOCKS)('%s: a logged call, meeting and email show under `showCompleted`\'s default', (block) => {
    expect(ids(applyFeedConfig(feed, {}, 50, block).items)).toEqual(idsOf(LOGGED));
  });

  it.each(BLOCKS)('%s: a finished task stays hidden while `showCompleted` is false', (block) => {
    for (const config of [{}, { showCompleted: false }]) {
      const kept = ids(applyFeedConfig(feed, config, 50, block).items);
      expect(kept, JSON.stringify(config)).not.toContain(String(FINISHED_TASK.id));
    }
  });

  it('KEEP-LEG: `showCompleted: true` shows the finished task too', () => {
    expect(ids(applyFeedConfig(feed, { showCompleted: true }, 50, 'record:discussion').items))
      .toEqual(idsOf(ALL_ROWS));
  });

  it('`types` still decides: a logged interaction is selected as a task, and only as one', () => {
    expect(ids(applyFeedConfig(feed, { types: ['task'] }, 50, 'record:activity').items))
      .toEqual(idsOf(LOGGED));
    expect(applyFeedConfig(feed, { types: ['comment'] }, 50, 'record:activity').items).toEqual([]);
  });

  it('`unifiedTimeline: false` keeps it: a logged interaction is not a field change', () => {
    expect(ids(applyFeedConfig(feed, { unifiedTimeline: false }, 50, 'record:activity').items))
      .toEqual(idsOf(LOGGED));
  });

  it.each([
    ['no pointer, only the call\'s `metadata.kind` (the rule reads the pointer, not the kind)', { source_object: undefined, source_id: undefined }],
    ['`source_object` without `source_id`', { source_id: undefined }],
    ['`source_id` without `source_object`', { source_object: undefined }],
    ['an empty `source_object`', { source_object: '' }],
    ['a null `source_id`', { source_id: null }],
  ])('CONTROL: a `completed` row with %s is hidden by default', (_label, over) => {
    const row = { ...LOGGED_CALL, ...over } as SysActivityRow;
    const items = mapAll([row]);
    expect(items.map((i) => i.type)).toEqual(['task']);
    expect(applyFeedConfig(items, {}, 50, 'record:discussion').items).toEqual([]);
    expect(applyFeedConfig(items, { showCompleted: true }, 50, 'record:discussion').items).toHaveLength(1);
  });
});

/**
 * "An authored page with `showCompleted: true` is unchanged." With the flag on,
 * the `showCompleted` step filters nothing, before and after this change. The
 * configs below are the two authored shapes HotCRM ships for these rows (the
 * lead page's `record:activity` and the case page's), so the pin reads the
 * pages that already set the flag.
 */
describe('an authored page with `showCompleted: true` is unchanged (objectui#12228)', () => {
  const feed = mapAll(ALL_ROWS);

  it('the lead page shape (`types: [\'task\']`, `showCompleted: true`) lists every completed row', () => {
    const applied = applyFeedConfig(feed, { types: ['task'], limit: 20, showCompleted: true }, 20, 'record:activity');
    expect(ids(applied.items)).toEqual(idsOf(ALL_ROWS));
    expect(applied.items.every((i) => i.type === 'task')).toBe(true);
  });

  it('the case page shape (`unifiedTimeline: true`, `showCompleted: true`) lists every completed row', () => {
    const applied = applyFeedConfig(feed, { unifiedTimeline: true, showCompleted: true }, 25, 'record:activity');
    expect(ids(applied.items)).toEqual(idsOf(ALL_ROWS));
  });
});

/**
 * The default record page. The synthesizer is NOT changed: its
 * `record:discussion` node still carries no `feed`, so the block runs the
 * pipeline on spec defaults. The console page feeds that block through the
 * discussion context with rows it maps through `activityRowToFeedItem`, which
 * is what this mount does.
 */
describe('the synthesized default record page shows a logged call (objectui#12228)', () => {
  beforeEach(() => {
    cleanup();
  });

  const contactDef: ObjectDefLike = {
    name: 'crm_contact',
    label: 'Contact',
    fields: {
      full_name: { name: 'full_name', label: 'Full Name', type: 'text' },
      email: { name: 'email', label: 'Email', type: 'email' },
    },
  };

  it('renders the logged call, meeting and email, and not the finished task', () => {
    const page = buildDefaultPageSchema(contactDef);
    const discussion = page.regions[0].components.find((c: { type: string }) => c.type === 'record:discussion');
    // The synthesizer's node is the bare block: no `feed`, no properties.
    expect(discussion).toEqual({ type: 'record:discussion' });

    const Renderer = ComponentRegistry.get('record:discussion') as
      | React.ComponentType<{ schema: Record<string, unknown> }>
      | undefined;
    if (!Renderer) throw new Error('no renderer registered for record:discussion');
    // The discussion context keys its items on a string id.
    const items = mapAll(ALL_ROWS).map((i) => ({ ...i, id: String(i.id) }));
    render(
      <DiscussionContextProvider items={items} loading={false}>
        <Renderer schema={discussion} />
      </DiscussionContextProvider>,
    );

    for (const row of LOGGED) {
      expect(screen.queryAllByText(String(row.summary)).length, String(row.id)).toBeGreaterThan(0);
    }
    expect(screen.queryByText(String(FINISHED_TASK.summary))).toBeNull();
  });
});

describe('the `record:activity` self-fetch shows a logged call (objectui#12228)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the logged call and hides the finished task by default', async () => {
    // A partial double: the self-fetch calls `find` and nothing else.
    const find = vi.fn(async () => ({ data: [LOGGED_CALL, FINISHED_TASK], total: 2 }));
    const dataSource = { find } as unknown as DataSource;
    render(
      <RecordContextProvider
        objectName="crm_contact"
        recordId="contact-1"
        data={{ id: 'contact-1', full_name: 'Ada Lovelace' }}
        dataSource={dataSource}
      >
        <RecordActivityRenderer schema={{}} />
      </RecordContextProvider>,
    );
    await waitFor(() => expect(find).toHaveBeenCalled());
    expect(await screen.findByText(String(LOGGED_CALL.summary))).toBeTruthy();
    expect(screen.queryByText(String(FINISHED_TASK.summary))).toBeNull();
  });
});
