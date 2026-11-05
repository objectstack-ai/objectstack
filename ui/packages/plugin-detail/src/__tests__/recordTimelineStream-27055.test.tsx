/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27055, Target 3 — the timeline is ONE stream: discussion
 * (`sys_comment`), activity (`sys_activity`) and field changes
 * (`sys_audit_log`) merged newest first, filtered by the chips 全部 / 活动 /
 * 讨论 / 变更, system entries drawn as one compact muted line, and paged at
 * the foot (objectstack#27524: in full it is the 动态 tab; its panel's
 * 「查看全部 N 条 →」 is pinned in `RecordTimelinePanel-27524.test.tsx`).
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import {
  auditEntriesToFeedItems,
  filterTimelineStream,
  mergeTimelineStream,
  RecordFieldChangesContext,
  RecordFieldHistoryContext,
  TIMELINE_PAIR_WINDOW_MS,
  fieldHistoryOf,
} from '../recordTimelineStream';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import { RecordActivityRenderer } from '../renderers/record-activity';
import { DefaultRecordPageContext } from '../defaultRecordPage';

afterEach(cleanup);

const comment: FeedItem = { id: 'c1', type: 'comment', actor: 'Ada', body: 'Budget is set', createdAt: '2026-10-23T10:00:00Z' };
const call: FeedItem = { id: 'a1', type: 'task', actor: 'Dev', body: 'Logged a call', createdAt: '2026-10-28T10:20:00Z' };
const updated = { id: 'a2', type: 'field_change', actor: 'Dev', body: 'updated', createdAt: '2026-10-27T16:05:00Z', activityType: 'updated' } as FeedItem;
const created = { id: 'a3', type: 'field_change', actor: 'Dev', body: 'Created the lead', createdAt: '2026-10-16T09:00:00Z', activityType: 'created' } as FeedItem;
const audit = auditEntriesToFeedItems(
  [
    { id: 1, created_at: '2026-10-27T16:05:00Z', user_name: 'Dev', changes: [{ field: 'status', label: 'Status', from: 'New', to: 'Contacted' }] },
    { id: 2, created_at: '2026-10-16T09:00:00Z', user_name: 'Dev', action: 'create' },
  ],
  { unknownUser: 'Unknown' },
);

describe('the stream, pure (objectstack#27055)', () => {
  it('turns audit entries that changed a field into field_change items, and only those', () => {
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ type: 'field_change', actor: 'Dev', id: 'audit:1' });
    expect(audit[0].fieldChanges?.[0]).toMatchObject({ field: 'status', fieldLabel: 'Status', oldDisplayValue: 'New', newDisplayValue: 'Contacted' });
  });

  it('merges newest first, and counts an update once when the audit has it', () => {
    const stream = mergeTimelineStream([comment, call, updated, created], audit);
    expect(stream.map((i) => i.id)).toEqual(['a1', 'audit:1', 'c1', 'a3']);
    // Without field changes the activity's own update stays.
    expect(mergeTimelineStream([comment, updated], null).map((i) => i.id)).toEqual(['a2', 'c1']);
  });

  it("the four chips: 变更 holds the audit's field changes, the activity's `created` row is 活动 (objectstack#30074, ruling C)", () => {
    const stream = mergeTimelineStream([comment, call, created], audit);
    expect(filterTimelineStream(stream, 'all')).toHaveLength(4);
    expect(filterTimelineStream(stream, 'discussion').map((i) => i.id)).toEqual(['c1']);
    // Judged by source, not by the shared `field_change` presentation: the
    // `created` row (a3) is an event, so it is not a change.
    expect(filterTimelineStream(stream, 'changes').map((i) => i.id)).toEqual(['audit:1']);
    expect(filterTimelineStream(stream, 'activity').map((i) => i.id)).toEqual(['a1', 'a3']);
    // Every entry sits under exactly one of 活动 / 讨论 / 变更.
    const sliced = (['activity', 'discussion', 'changes'] as const).flatMap((chip) => filterTimelineStream(stream, chip));
    expect(sliced.map((i) => i.id).sort()).toEqual(stream.map((i) => i.id).sort());
  });
});

describe('RecordActivityTimeline — the stream face', () => {
  const items = mergeTimelineStream([comment, call, created], audit);

  it('draws chips instead of the dropdown, and system entries as compact lines', () => {
    const { container } = render(<RecordActivityTimeline items={items} variant="stream" titleLabel="Timeline" />);
    expect(container.querySelectorAll('[data-stream-filter]')).toHaveLength(4);
    expect(screen.queryByRole('combobox')).toBeNull();
    const lines = Array.from(container.querySelectorAll('[data-stream-system-row]')).map((l) => l.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Status New → Contacted');
    // A comment keeps its full row.
    expect(screen.getByText('Budget is set')).toBeTruthy();
  });

  it('CONTROL — the panel face keeps its dropdown and no compact lines', () => {
    const { container } = render(<RecordActivityTimeline items={items} />);
    expect(container.querySelector('[data-stream-filter]')).toBeNull();
    expect(container.querySelector('[data-stream-system-row]')).toBeNull();
  });
});

describe('record:activity on the default record page is the stream', () => {
  const many: FeedItem[] = Array.from({ length: 25 }, (_, i) => ({
    id: `c${i}`,
    type: 'comment',
    actor: 'Ada',
    body: `Note ${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  }));

  const mount = (onDefaultPage: boolean) =>
    render(
      <DefaultRecordPageContext.Provider value={onDefaultPage}>
        <DiscussionContextProvider items={[call, ...many] as any[]} loading={false}>
          <RecordFieldChangesContext.Provider value={audit}>
            <RecordActivityRenderer schema={{ type: 'record:activity', showCompleted: true } as any} />
          </RecordFieldChangesContext.Provider>
        </DiscussionContextProvider>
      </DefaultRecordPageContext.Provider>,
    );

  it('merges the field changes in, pages at 20, and the foot draws the next page (objectstack#27524)', () => {
    const { container } = mount(true);
    expect(container.querySelector('[data-stream-filters]')).toBeTruthy();
    // 25 notes + the call + the audit change: 27, twenty a page.
    const more = container.querySelector('[data-stream-load-more]') as HTMLButtonElement;
    expect(more).toBeTruthy();
    // The page is the NEWEST twenty (newest first): the call, the change, Note 24 … Note 7.
    expect(screen.getByText('Note 24')).toBeTruthy();
    expect(screen.getByText('Note 7')).toBeTruthy();
    expect(screen.queryByText('Note 6')).toBeNull();
    expect(screen.queryByText('Note 0')).toBeNull();
    fireEvent.click(more);
    // The next page: the seven left, and no more to load.
    expect(screen.getByText('Note 0')).toBeTruthy();
    expect(container.querySelector('[data-stream-load-more]')).toBeNull();
  });

  it('a chip filters the whole stream, not the first page', () => {
    const { container } = mount(true);
    fireEvent.click(container.querySelector('[data-stream-filter="changes"]')!);
    expect(container.querySelectorAll('[data-stream-system-row]')).toHaveLength(1);
    fireEvent.click(container.querySelector('[data-stream-filter="activity"]')!);
    expect(screen.getByText('Logged a call')).toBeTruthy();
  });

  it('CONTROL — elsewhere the block keeps its panel face and ignores the field changes', () => {
    const { container } = mount(false);
    expect(container.querySelector('[data-stream-filters]')).toBeNull();
    expect(container.querySelector('[data-stream-system-row]')).toBeNull();
  });
});

describe('the 变更 chip is offered only while the record shows its field history (objectstack#30074)', () => {
  const chips = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-stream-filter]')).map((chip) => chip.getAttribute('data-stream-filter'));
  const page = (fieldHistory: boolean | undefined) => {
    const block = (
      <DiscussionContextProvider items={[call, comment, created] as any[]} loading={false}>
        <RecordFieldChangesContext.Provider value={fieldHistory === false ? null : audit}>
          <RecordActivityRenderer schema={{ type: 'record:activity', showCompleted: true } as any} />
        </RecordFieldChangesContext.Provider>
      </DiscussionContextProvider>
    );
    return (
      <DefaultRecordPageContext.Provider value>
        {fieldHistory === undefined ? block : <RecordFieldHistoryContext.Provider value={fieldHistory}>{block}</RecordFieldHistoryContext.Provider>}
      </DefaultRecordPageContext.Provider>
    );
  };

  it('history shown: the four chips', () => {
    const { container } = render(page(true));
    expect(chips(container)).toEqual(['all', 'activity', 'discussion', 'changes']);
  });

  it('history not shown: no 变更 chip, and 全部 still draws every entry', () => {
    const { container } = render(page(false));
    expect(chips(container)).toEqual(['all', 'activity', 'discussion']);
    expect(container.querySelector('[data-stream-filter="all"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Logged a call')).toBeTruthy();
    expect(screen.getByText('Budget is set')).toBeTruthy();
  });

  it('CONTROL: no host saying, every chip draws, as before', () => {
    const { container } = render(page(undefined));
    expect(chips(container)).toEqual(['all', 'activity', 'discussion', 'changes']);
  });

  it('a 变更 chip taken away while chosen leaves the stream on 全部', () => {
    const { container, rerender } = render(page(true));
    fireEvent.click(container.querySelector('[data-stream-filter="changes"]')!);
    expect(screen.queryByText('Logged a call')).toBeNull();
    rerender(page(false));
    expect(container.querySelector('[data-stream-filter="all"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Logged a call')).toBeTruthy();
  });
});

describe("the panel's `changes_only` is offered by the same rule as the 变更 chip (objectstack#30344)", () => {
  const panel = (fieldHistory: boolean | undefined, filterMode?: 'all' | 'changes_only') => {
    const timeline = <RecordActivityTimeline items={[call, comment, ...audit]} filterMode={filterMode} />;
    return fieldHistory === undefined ? (
      timeline
    ) : (
      <RecordFieldHistoryContext.Provider value={fieldHistory}>{timeline}</RecordFieldHistoryContext.Provider>
    );
  };
  /** The dropdown's options, in order, read off the opened list. */
  const options = async () => {
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    return within(listbox).getAllByRole('option').map((option) => option.textContent);
  };

  it('history shown: all four options, Field Changes among them', async () => {
    render(panel(true));
    expect(await options()).toEqual(['All Activity', 'Comments Only', 'Field Changes', 'Tasks Only']);
  });

  it('history not shown (history off, or a reader whose audit read did not answer): no `changes_only`', async () => {
    render(panel(false));
    expect(await options()).toEqual(['All Activity', 'Comments Only', 'Tasks Only']);
  });

  it('CONTROL: no host saying, every option draws, as before', async () => {
    render(panel(undefined));
    expect(await options()).toEqual(['All Activity', 'Comments Only', 'Field Changes', 'Tasks Only']);
  });

  it('a `changes_only` the dropdown does not offer reads as 全部: every entry draws', () => {
    render(panel(false, 'changes_only'));
    expect(screen.getByRole('combobox').textContent).toContain('All Activity');
    expect(screen.getByText('Logged a call')).toBeTruthy();
    expect(screen.getByText('Budget is set')).toBeTruthy();
  });

  it('CONTROL: with history shown, the same `changes_only` holds the field change only', () => {
    render(panel(true, 'changes_only'));
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.queryByText('Logged a call')).toBeNull();
    expect(screen.queryByText('Budget is set')).toBeNull();
  });
});

describe('an activity row sits under 活动 whatever the history flag; 变更 holds the audit only (objectstack#30074, ruling C)', () => {
  // The five activity types that share the `field_change` presentation.
  const events = (['created', 'updated', 'deleted', 'assigned', 'shared'] as const).map(
    (activityType, i) =>
      ({
        id: `ev-${activityType}`,
        type: 'field_change',
        actor: 'Dev',
        body: `Event ${activityType}`,
        createdAt: new Date(Date.UTC(2026, 9, 10, 0, i)).toISOString(),
        activityType,
      }) as FeedItem,
  );
  const page = (fieldHistory: boolean) => (
    <DefaultRecordPageContext.Provider value>
      <RecordFieldHistoryContext.Provider value={fieldHistory}>
        <DiscussionContextProvider items={[call, ...events] as any[]} loading={false}>
          <RecordFieldChangesContext.Provider value={fieldHistory ? audit : null}>
            <RecordActivityRenderer schema={{ type: 'record:activity', showCompleted: true } as any} />
          </RecordFieldChangesContext.Provider>
        </DiscussionContextProvider>
      </RecordFieldHistoryContext.Provider>
    </DefaultRecordPageContext.Provider>
  );
  const choose = (container: HTMLElement, chip: string) =>
    fireEvent.click(container.querySelector(`[data-stream-filter="${chip}"]`)!);

  for (const fieldHistory of [true, false]) {
    it(`history ${fieldHistory ? 'on' : 'off'}: 活动 lists every activity event, and no audit change`, () => {
      const { container } = render(page(fieldHistory));
      choose(container, 'activity');
      // With history on the audit says the update with its values, so the
      // activity's own `updated` row steps aside (mergeTimelineStream).
      const shown = events.filter((e) => !(fieldHistory && e.activityType === 'updated'));
      for (const event of shown) expect(screen.getByText(`Event ${event.activityType}`)).toBeTruthy();
      expect(screen.getByText('Logged a call')).toBeTruthy();
      expect(screen.queryByText(/New → Contacted/)).toBeNull();
    });
  }

  it('CONTROL, history on: 变更 holds the field change with its old and new values, and no activity event', () => {
    const { container } = render(page(true));
    choose(container, 'changes');
    expect(screen.getByText(/Status New → Contacted/)).toBeTruthy();
    for (const event of events) expect(screen.queryByText(`Event ${event.activityType}`)).toBeNull();
  });

  it("the panel's `changes_only` keeps the same rule as the stream", () => {
    render(<RecordActivityTimeline items={[call, created, ...audit]} filterMode="changes_only" />);
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.queryByText('Created the lead')).toBeNull();
    expect(screen.queryByText('Logged a call')).toBeNull();
  });
});

describe('one action, one row: an activity row carries its audit entry (objectstack#30122)', () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 1, 9, 0, 0) + ms).toISOString();
  const activityRow = (id: string, activityType: string, ms: number, actorId: string | null = 'u1', actor = 'Dev Admin') =>
    ({ id, type: 'field_change', actor, body: `Activity ${id}`, createdAt: at(ms), activityType, actorId }) as FeedItem;
  const auditOf = (id: number, action: string, ms: number, user_id: string | null = 'u1', user_name = 'Dev Admin') =>
    auditEntriesToFeedItems(
      [{ id, action, created_at: at(ms), user_id, user_name, changes: [{ field: 'company', label: 'Company', from: 'Old Co', to: `New Co ${id}` }] }],
      { unknownUser: 'Unknown' },
    );

  it('a create: the activity `created` row and the audit `create` entry are one row, the diff on it', () => {
    const stream = mergeTimelineStream([activityRow('a1', 'created', 0)], auditOf(1, 'create', 200));
    expect(stream.map((i) => i.id)).toEqual(['a1']);
    expect(fieldHistoryOf(stream[0])?.id).toBe('audit:1');
    // Ruling C: 变更 still shows the audit entry on its own; 活动 the activity row.
    expect(filterTimelineStream(stream, 'changes').map((i) => i.id)).toEqual(['audit:1']);
    expect(filterTimelineStream(stream, 'activity').map((i) => i.id)).toEqual(['a1']);
  });

  it('an update: the activity `updated` row and the audit `update` entry are one row', () => {
    const stream = mergeTimelineStream([activityRow('a2', 'updated', 1000)], auditOf(2, 'update', 1000));
    expect(stream.map((i) => i.id)).toEqual(['a2']);
    expect(fieldHistoryOf(stream[0])?.fieldChanges?.[0]).toMatchObject({ field: 'company', newDisplayValue: 'New Co 2' });
  });

  it('unpaired rows draw as before: an audit entry with no activity row, an activity row with no audit entry', () => {
    const stream = mergeTimelineStream([activityRow('a3', 'created', 0)], auditOf(3, 'update', 60_000));
    expect(stream.map((i) => i.id)).toEqual(['audit:3', 'a3']);
    expect(stream.every((i) => fieldHistoryOf(i) === undefined)).toBe(true);
  });

  it('different actors do not pair', () => {
    const stream = mergeTimelineStream([activityRow('a4', 'created', 0, 'u1')], auditOf(4, 'create', 100, 'u2', 'Other'));
    expect(stream.map((i) => i.id).sort()).toEqual(['a4', 'audit:4']);
  });

  it(`outside the ${TIMELINE_PAIR_WINDOW_MS} ms window does not pair; at its edge it does`, () => {
    const outside = mergeTimelineStream([activityRow('a5', 'created', 0)], auditOf(5, 'create', TIMELINE_PAIR_WINDOW_MS + 1));
    expect(outside.map((i) => i.id).sort()).toEqual(['a5', 'audit:5']);
    const edge = mergeTimelineStream([activityRow('a6', 'created', 0)], auditOf(6, 'create', TIMELINE_PAIR_WINDOW_MS));
    expect(edge.map((i) => i.id)).toEqual(['a6']);
  });

  it('a different action kind does not pair, and a row pairs once (nearest in time)', () => {
    const kinds = mergeTimelineStream([activityRow('a7', 'created', 0)], auditOf(7, 'delete', 0));
    expect(kinds.map((i) => i.id).sort()).toEqual(['a7', 'audit:7']);
    const twice = mergeTimelineStream(
      [activityRow('a8', 'created', 0)],
      [...auditOf(8, 'create', 1500), ...auditOf(9, 'create', 300)],
    );
    expect(twice.map((i) => i.id).sort()).toEqual(['a8', 'audit:8']);
    expect(fieldHistoryOf(twice.find((i) => i.id === 'a8')!)?.id).toBe('audit:9');
  });

  it('the system on both sides (no user id) pairs by name', () => {
    const stream = mergeTimelineStream([activityRow('a10', 'updated', 0, null, 'System')], auditOf(10, 'update', 50, null, 'System'));
    expect(stream.map((i) => i.id)).toEqual(['a10']);
  });

  const page = (fieldChanges: FeedItem[] | null) => (
    <DefaultRecordPageContext.Provider value>
      <DiscussionContextProvider items={[activityRow('r1', 'created', 0)] as any[]} loading={false}>
        <RecordFieldChangesContext.Provider value={fieldChanges}>
          <RecordActivityRenderer schema={{ type: 'record:activity', showCompleted: true } as any} />
        </RecordFieldChangesContext.Provider>
      </DiscussionContextProvider>
    </DefaultRecordPageContext.Provider>
  );

  it('an audit reader sees ONE row: the summary, who, and the diff on it', () => {
    const { container } = render(page(auditOf(11, 'create', 100)));
    const rows = container.querySelectorAll('[data-stream-system-row]');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('[data-stream-change]')?.textContent).toBe('Activity r1');
    expect(rows[0].textContent).toContain('Dev Admin');
    expect(rows[0].querySelector('[data-stream-change-diff]')?.textContent).toBe('Company Old Co → New Co 11');
  });

  it('a reader without the audit log sees the same ONE row, without a diff', () => {
    const { container } = render(page(null));
    const rows = container.querySelectorAll('[data-stream-system-row]');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('[data-stream-change]')?.textContent).toBe('Activity r1');
    expect(rows[0].querySelector('[data-stream-change-diff]')).toBeNull();
  });

  it('变更 shows the audit diff on its own row (ruling C)', () => {
    const { container } = render(page(auditOf(12, 'create', 100)));
    fireEvent.click(container.querySelector('[data-stream-filter="changes"]')!);
    const rows = container.querySelectorAll('[data-stream-system-row]');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('[data-stream-change]')?.textContent).toBe('Company Old Co → New Co 12');
    expect(rows[0].querySelector('[data-stream-change-diff]')).toBeNull();
  });

  it('every peek row says who', () => {
    const { container } = render(
      <RecordActivityTimeline items={[comment, activityRow('p1', 'created', 0)]} variant="peek" />,
    );
    const actors = Array.from(container.querySelectorAll('[data-record-timeline-peek-actor]')).map((e) => e.textContent);
    expect(actors).toEqual(expect.arrayContaining(['Ada', 'Dev Admin']));
    expect(container.querySelectorAll('[data-record-timeline-peek-row]')).toHaveLength(2);
  });
});
