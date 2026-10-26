/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Consecutive update entries by one actor fold into one timeline row
 * (objectstack#25959).
 *
 * Seen on HotCRM's demo campaign: thirteen consecutive "System · Updated
 * Campaign …" rows, one per enrolled member, buried the human comments. The
 * fold is rendering only: every entry stays in the feed and the folded row
 * expands to them. Create, delete, comment and milestone rows never fold, and
 * an entry with no summary still counts.
 *
 * Real subjects: `activityRowToFeedItem` (the mapper the record page and the
 * `record:activity` block both use), `foldFeedItems` and
 * `RecordActivityTimeline`. The rows are `sys_activity` rows as the record
 * page reads them, with `actor_id` expanded.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { FeedItem } from '@object-ui/types';
import { RecordContextProvider } from '@object-ui/react';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { activityRowToFeedItem, foldFeedItems, FOLD_WINDOW_MS, type SysActivityRow } from '../renderers/recordActivityFeed';
import { DETAIL_DEFAULT_TRANSLATIONS } from '../useDetailTranslation';

const EXPAND = DETAIL_DEFAULT_TRANSLATIONS['detail.expandFolded'];
const COLLAPSE = DETAIL_DEFAULT_TRANSLATIONS['detail.collapseFolded'];

const T0 = Date.parse('2026-10-25T08:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const ADA = { id: 'u-ada', name: 'Ada Lovelace' };

let seq = 0;
/** One `sys_activity` row. `actor_id: null` is the system (a flow, a rollup, a seed). */
function row(over: Partial<SysActivityRow> & { minute: number }): SysActivityRow {
  const { minute, ...rest } = over;
  seq += 1;
  return {
    id: `a-${seq}`,
    type: 'updated',
    summary: `Updated Campaign "CPG-0001" #${seq}`,
    timestamp: at(minute),
    actor_id: null,
    changed_fields: ['num_sent'],
    ...rest,
  };
}

function mapAll(rows: SysActivityRow[]): FeedItem[] {
  return rows.map((r) => activityRowToFeedItem(r, 'System')).filter((i): i is FeedItem => i !== null);
}

const kinds = (items: FeedItem[]) =>
  foldFeedItems(items).map((e) => (e.kind === 'fold' ? `fold:${e.items.length}` : 'item'));

afterEach(() => {
  cleanup();
});

describe('activityRowToFeedItem carries what the fold keys on (objectstack#25959)', () => {
  it('carries the raw type, the actor id and the changed fields', () => {
    const item = activityRowToFeedItem(
      row({ minute: 0, actor_id: ADA, changed_fields: ['num_sent', 'responses'] }),
      'System',
    );
    expect(item).toMatchObject({
      type: 'field_change',
      activityType: 'updated',
      actorId: 'u-ada',
      changedFields: ['num_sent', 'responses'],
    });
    expect(item?.activityKind).toBeUndefined();
  });

  it('a bare `actor_id` is the id; a row naming no user is `null`', () => {
    expect(activityRowToFeedItem(row({ minute: 0, actor_id: 'u-hidden' }), 'System')?.actorId).toBe('u-hidden');
    expect(activityRowToFeedItem(row({ minute: 0, actor_id: null }), 'System')?.actorId).toBeNull();
    expect(activityRowToFeedItem(row({ minute: 0, actor_id: undefined }), 'System')?.actorId).toBeNull();
  });

  it('an unstamped row (`changed_fields` null) carries no field list, which is not the same as an empty one', () => {
    expect(activityRowToFeedItem(row({ minute: 0, changed_fields: null }), 'System')?.changedFields).toBeUndefined();
    expect(activityRowToFeedItem(row({ minute: 0, changed_fields: [] }), 'System')?.changedFields).toEqual([]);
  });

  it('carries a milestone row\'s kind, from `metadata.kind` only', () => {
    const milestone = row({ minute: 0, metadata: JSON.stringify({ kind: 'milestone', old: { a: 1 }, new: { a: 2 } }) });
    expect(activityRowToFeedItem(milestone, 'System')?.activityKind).toBe('milestone');
  });
});

describe('foldFeedItems (objectstack#25959)', () => {
  it('folds a run of adjacent updates by one actor, keeping every entry in order', () => {
    const items = mapAll([row({ minute: 0 }), row({ minute: 1 }), row({ minute: 2 })]);
    const entries = foldFeedItems(items);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('fold');
    expect(entries[0].kind === 'fold' && entries[0].items).toEqual(items);
  });

  it('a run of one is an ordinary row', () => {
    expect(kinds(mapAll([row({ minute: 0 })]))).toEqual(['item']);
  });

  it('a different actor, or the system next to a person, ends the run', () => {
    expect(kinds(mapAll([
      row({ minute: 0 }),
      row({ minute: 1 }),
      row({ minute: 2, actor_id: ADA }),
      row({ minute: 3, actor_id: ADA }),
      row({ minute: 4, actor_id: { id: 'u-grace', name: 'Grace' } }),
    ]))).toEqual(['fold:2', 'fold:2', 'item']);
  });

  it('two rows naming no user under different names are not one actor', () => {
    expect(kinds(mapAll([
      row({ minute: 0, actor_name: 'Nightly import' }),
      row({ minute: 1, actor_name: 'Rollup' }),
    ]))).toEqual(['item', 'item']);
  });

  it('a gap longer than the window between neighbours starts a new run', () => {
    const window = FOLD_WINDOW_MS / 60_000;
    expect(window).toBe(10);
    expect(kinds(mapAll([
      row({ minute: 0 }),
      row({ minute: window }),
      row({ minute: 2 * window }),
      row({ minute: 3 * window + 1 }),
      row({ minute: 3 * window + 2 }),
    ]))).toEqual(['fold:3', 'fold:2']);
  });

  it('create, delete, assign, share, completed and milestone rows never fold, and each ends a run', () => {
    const neverFold = mapAll([
      row({ minute: 0, type: 'created' }),
      row({ minute: 1, type: 'deleted' }),
      row({ minute: 2, type: 'assigned' }),
      row({ minute: 3, type: 'shared' }),
      row({ minute: 4, type: 'completed' }),
      row({ minute: 5, metadata: JSON.stringify({ kind: 'milestone' }) }),
      row({ minute: 6, metadata: JSON.stringify({ kind: 'milestone' }) }),
    ]);
    expect(kinds(neverFold)).toEqual(['item', 'item', 'item', 'item', 'item', 'item', 'item']);

    expect(kinds(mapAll([
      row({ minute: 0 }),
      row({ minute: 1, type: 'created' }),
      row({ minute: 2 }),
    ]))).toEqual(['item', 'item', 'item']);
  });

  it('a comment between two updates ends the run; a host item without an activity type never folds', () => {
    const [u1, u2] = mapAll([row({ minute: 0 }), row({ minute: 2 })]);
    const comment: FeedItem = { id: 'c1', type: 'comment', actor: 'System', body: 'Looks good', createdAt: at(1) };
    expect(kinds([u1, comment, u2])).toEqual(['item', 'item', 'item']);
    const hostChange: FeedItem = { id: 'h1', type: 'field_change', actor: 'System', createdAt: at(3) };
    expect(kinds([hostChange, { ...hostChange, id: 'h2' }])).toEqual(['item', 'item']);
  });

  it('an entry without a summary still folds and still counts', () => {
    expect(kinds(mapAll([row({ minute: 0, summary: null }), row({ minute: 1, summary: '' }), row({ minute: 2 })])))
      .toEqual(['fold:3']);
  });
});

/** Thirteen system updates, as on the campaign the card was filed from, then a person's comment. */
function campaignFeed(): FeedItem[] {
  const updates = mapAll(
    Array.from({ length: 13 }, (_, i) =>
      row({ minute: i * 0.5, changed_fields: i % 2 ? ['num_sent', 'responses'] : ['num_sent', 'leads'] }),
    ),
  );
  const comment: FeedItem = { id: 'c-1', type: 'comment', actor: 'Grace', body: 'Kick-off went well', createdAt: at(30) };
  return [...updates, comment];
}

const CAMPAIGN_SCHEMA = {
  name: 'crm_campaign',
  fields: {
    num_sent: { type: 'number', label: 'Number Sent' },
    responses: { type: 'number', label: 'Responses' },
    leads: { type: 'number', label: 'Leads' },
  },
};

function mountInRecord(items: FeedItem[]) {
  render(
    <RecordContextProvider objectName="crm_campaign" recordId="cpg-1" objectSchema={CAMPAIGN_SCHEMA}>
      <RecordActivityTimeline items={items} />
    </RecordContextProvider>,
  );
}

describe('RecordActivityTimeline renders a folded run as one row (objectstack#25959)', () => {
  it('thirteen system updates read as one row with the count and the union of field labels', () => {
    mountInRecord(campaignFeed());
    const folds = screen.getAllByTestId('activity-fold');
    expect(folds).toHaveLength(1);
    const fold = folds[0];
    expect(fold.getAttribute('data-fold-count')).toBe('13');
    expect(within(fold).getByTestId('activity-fold-count').textContent).toBe('13 updates');
    expect(within(fold).getByText('Updated Number Sent, Leads, and Responses')).toBeTruthy();
    // The individual summaries are not on screen until the row is expanded,
    // and the person's comment is no longer buried.
    expect(screen.queryByText(/Updated Campaign "CPG-0001"/)).toBeNull();
    expect(screen.getByText('Kick-off went well')).toBeTruthy();
    // The header still counts every entry: nothing was dropped.
    expect(screen.getByRole('heading').textContent).toContain('(14)');
  });

  it('the toggle expands the run to every entry and collapses it again, saying which it does', () => {
    mountInRecord(campaignFeed());
    const toggle = screen.getByRole('button', { name: EXPAND });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const expanded = screen.getByRole('button', { name: COLLAPSE });
    expect(expanded.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText(/Updated Campaign "CPG-0001"/)).toHaveLength(13);
    fireEvent.click(expanded);
    expect(screen.queryByText(/Updated Campaign "CPG-0001"/)).toBeNull();
  });

  it('outside a record page the field list falls back to machine names', () => {
    render(<RecordActivityTimeline items={mapAll([row({ minute: 0 }), row({ minute: 1, changed_fields: ['responses'] })])} />);
    expect(screen.getByText('Updated num_sent and responses')).toBeTruthy();
  });

  it('a long field list names three and counts the rest', () => {
    render(
      <RecordActivityTimeline
        items={mapAll([row({ minute: 0, changed_fields: ['a', 'b', 'c'] }), row({ minute: 1, changed_fields: ['d', 'e'] })])}
      />,
    );
    expect(screen.getByText('Updated a, b, c, and 2 more')).toBeTruthy();
  });

  it('a run whose entries name no fields still reads as updates and still counts', () => {
    render(
      <RecordActivityTimeline
        items={mapAll([row({ minute: 0, changed_fields: null }), row({ minute: 1, changed_fields: [] })])}
      />,
    );
    const fold = screen.getByTestId('activity-fold');
    expect(within(fold).getByText(DETAIL_DEFAULT_TRANSLATIONS['detail.activityUpdated'])).toBeTruthy();
    expect(within(fold).getByTestId('activity-fold-count').textContent).toBe('2 updates');
  });
});
