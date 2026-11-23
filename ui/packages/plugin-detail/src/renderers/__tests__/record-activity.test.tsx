/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:activity` — the feed has a source, and the bound record decides it
 * (objectui#3165).
 *
 * Before #3165 the renderer called `useRecordContext()`, threw the result away
 * and rendered `<RecordActivityTimeline items={[]}>` with the empty array
 * hard-coded — so every one of its eleven declared inputs was a filter or an
 * affordance over a feed that was structurally empty. `apps/console`'s
 * record-reach probe caught that behaviourally (two different records,
 * byte-identical DOM, zero data calls) and ledgered it; this suite is the
 * unit-level statement of the same property, plus the precedence rules the fix
 * introduced.
 *
 * What is asserted, in the order it matters:
 *   1. with nothing but a record context, the block FETCHES, scoped to that
 *      record — the property whose absence was the bug;
 *   2. the declared read-side inputs change what is rendered;
 *   3. a host that owns the feed (`items`, or a mounted DiscussionContext)
 *      wins, and the block does not fetch a second copy;
 *   4. the write-path switches are wired to that host's handlers, so
 *      `showCommentInput` / `enableMentions` are real switches rather than
 *      decoration;
 *   5. `showSubscriptionToggle` is pinned as the ONE documented gap — asserted
 *      inert on purpose, so the day a subscription backend exists this test
 *      fails and the "NOT IMPLEMENTED" note at the registration site has to be
 *      deleted with it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { RecordContextProvider, DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityRenderer } from '../record-activity';
import { activityRowToFeedItem, resetWithheldCommentComposerWarnings } from '../recordActivityFeed';
import { RecordActivityTimeline } from '../../RecordActivityTimeline';

const COMPOSER_PLACEHOLDER = 'Leave a comment… (Ctrl+Enter to submit)';
const EMPTY_FEED = 'No activity recorded';

/** Rows as `sys_activity` returns them for one record. */
const ROWS = [
  {
    id: 'act-1',
    type: 'updated',
    summary: 'Stage: draft to qualified',
    timestamp: '2026-01-02T00:00:00.000Z',
    actor_name: 'Grace',
  },
  {
    id: 'act-2',
    type: 'commented',
    summary: 'lives in sys_comment, not here',
    timestamp: '2026-01-03T00:00:00.000Z',
    actor_name: 'Ada',
  },
  {
    id: 'act-3',
    type: 'completed',
    summary: 'Follow-up call closed',
    timestamp: '2026-01-04T00:00:00.000Z',
    actor_name: 'Ada',
  },
  {
    id: 'act-4',
    type: 'system',
    summary: 'Assignment rule ran',
    timestamp: '2026-01-05T00:00:00.000Z',
  },
];

const makeDataSource = (rows: unknown[] = ROWS) =>
  ({ find: vi.fn().mockResolvedValue({ data: rows }) }) as any;

const mountBound = (
  schema: Record<string, unknown>,
  dataSource: any,
  wrap: (node: React.ReactNode) => React.ReactNode = (n) => n,
  recordId = 'rec-alpha',
) =>
  render(
    <RecordContextProvider
      objectName="crm_account"
      recordId={recordId}
      data={{ id: recordId, name: 'Alpha' }}
      dataSource={dataSource}
    >
      {wrap(<RecordActivityRenderer schema={schema as any} />)}
    </RecordContextProvider>,
  );

beforeEach(() => {
  cleanup();
});

describe('record:activity — self-fetch scoped to the bound record', () => {
  it('reads sys_activity for THIS record when no host owns the feed', async () => {
    const dataSource = makeDataSource();
    mountBound({}, dataSource);

    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const [object, query] = dataSource.find.mock.calls[0];
    expect(object).toBe('sys_activity');
    expect(query.$filter).toEqual({ object_name: 'crm_account', record_id: 'rec-alpha' });
    // Newest first, one row past the window so "Load more" can be honest.
    expect(query.$orderby).toEqual({ timestamp: 'desc' });
    expect(query.$top).toBe(21); // spec default limit 20, +1

    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.getByText('Assignment rule ran')).toBeTruthy();
  });

  it('re-scopes the fetch when the bound record changes', async () => {
    const dataSource = makeDataSource();
    const view = mountBound({}, dataSource);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][1].$filter.record_id).toBe('rec-alpha');

    view.rerender(
      <RecordContextProvider
        objectName="crm_account"
        recordId="rec-bravo"
        data={{ id: 'rec-bravo', name: 'Bravo' }}
        dataSource={dataSource}
      >
        <RecordActivityRenderer schema={{} as any} />
      </RecordContextProvider>,
    );

    await waitFor(() =>
      expect(
        dataSource.find.mock.calls.some((c: any[]) => c[1]?.$filter?.record_id === 'rec-bravo'),
      ).toBe(true),
    );
  });

  it('skips the comment/mention rows — their content lives in sys_comment', async () => {
    mountBound({ showCompleted: true }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByText('lives in sys_comment, not here')).toBeNull();
  });

  it('fetches nothing and renders an empty feed with no record bound', async () => {
    render(<RecordActivityRenderer schema={{} as any} />);
    await waitFor(() => expect(screen.getByText(EMPTY_FEED)).toBeTruthy());
  });

  it('treats a missing sys_activity table as "no activity", not an error', async () => {
    const dataSource = { find: vi.fn().mockRejectedValue(new Error('404 not provisioned')) } as any;
    mountBound({}, dataSource);
    expect(await screen.findByText(EMPTY_FEED)).toBeTruthy();
  });
});

describe('record:activity — the declared read-side inputs change what is rendered', () => {
  it('hides completed activities by default and shows them on request', async () => {
    const view = mountBound({}, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByText('Follow-up call closed')).toBeNull();
    view.unmount();

    mountBound({ showCompleted: true }, makeDataSource());
    expect(await screen.findByText('Follow-up call closed')).toBeTruthy();
  });

  it('types narrows the feed to the listed feed item types', async () => {
    mountBound({ types: ['system'] }, makeDataSource());
    expect(await screen.findByText('Assignment rule ran')).toBeTruthy();
    expect(screen.queryByText('Stage: draft to qualified')).toBeNull();
  });

  it('unifiedTimeline:false un-mixes field changes out of the stream', async () => {
    mountBound({ unifiedTimeline: false }, makeDataSource());
    expect(await screen.findByText('Assignment rule ran')).toBeTruthy();
    expect(screen.queryByText('Stage: draft to qualified')).toBeNull();
  });

  it('limit caps the scoped read and the rendered page, and offers to grow it', async () => {
    const dataSource = makeDataSource();
    mountBound({ limit: 1, showCompleted: true }, dataSource);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(dataSource.find.mock.calls[0][1].$top).toBe(2); // limit + 1

    // Only the newest surviving item is on the first page.
    expect(await screen.findByText('Assignment rule ran')).toBeTruthy();
    expect(screen.queryByText('Follow-up call closed')).toBeNull();

    // "Load more" grows the window by `limit` — and re-asks for a window that
    // size, rather than paging client-side over rows it never fetched.
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Follow-up call closed')).toBeTruthy();
    await waitFor(() =>
      expect(dataSource.find.mock.calls.some((c: any[]) => c[1]?.$top === 3)).toBe(true),
    );
  });

  it('filterMode seeds which slice of the feed the panel opens on', async () => {
    mountBound({ filterMode: 'tasks_only', showCompleted: true }, makeDataSource());
    expect(await screen.findByText('Follow-up call closed')).toBeTruthy();
    expect(screen.queryByText('Stage: draft to qualified')).toBeNull();
    expect(screen.queryByText('Assignment rule ran')).toBeNull();
  });

  it('`changes_only` holds no activity event: the `updated` row is not a field change (objectstack#30074, ruling C)', async () => {
    const dataSource = makeDataSource();
    mountBound({ filterMode: 'changes_only', showCompleted: true }, dataSource);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(await screen.findByText(EMPTY_FEED)).toBeTruthy();
    expect(screen.queryByText('Stage: draft to qualified')).toBeNull();
  });

  it('an unrecognised filterMode falls back to "all" rather than a filter nothing matches', async () => {
    // objectui#3151's posture: an unknown filter token is skipped, never turned
    // into a predicate that can only ever be empty.
    mountBound({ filterMode: 'not_a_mode' }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.getByText('Assignment rule ran')).toBeTruthy();
  });

  it('showFilterToggle:false removes the filter dropdown', async () => {
    const view = mountBound({}, makeDataSource());
    expect(await screen.findByLabelText('Filter activity')).toBeTruthy();
    view.unmount();

    mountBound({ showFilterToggle: false }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByLabelText('Filter activity')).toBeNull();
  });
});

const HOST_ITEMS: FeedItem[] = [
  {
    id: 'h1',
    type: 'comment',
    actor: 'Ada',
    body: 'host supplied',
    createdAt: '2026-02-01T00:00:00.000Z',
  },
];

describe('record:activity — a host that owns the feed wins', () => {
  it('presents `items` from the node and does not fetch', async () => {
    const dataSource = makeDataSource();
    mountBound({ items: HOST_ITEMS }, dataSource);
    expect(await screen.findByText('host supplied')).toBeTruthy();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('reads `properties.items` too — the spec bridge preserves the raw bag', async () => {
    const dataSource = makeDataSource();
    mountBound({ properties: { items: HOST_ITEMS } }, dataSource);
    expect(await screen.findByText('host supplied')).toBeTruthy();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('presents a mounted DiscussionContext feed and does not fetch a second copy', async () => {
    const dataSource = makeDataSource();
    mountBound({}, dataSource, (node) => (
      <DiscussionContextProvider items={HOST_ITEMS as any}>{node}</DiscussionContextProvider>
    ));
    expect(await screen.findByText('host supplied')).toBeTruthy();
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('still applies the declared filters to a host feed', async () => {
    mountBound({ types: ['task'] }, makeDataSource(), (node) => (
      <DiscussionContextProvider items={HOST_ITEMS as any}>{node}</DiscussionContextProvider>
    ));
    await waitFor(() => expect(screen.getByText(EMPTY_FEED)).toBeTruthy());
  });
});

describe('record:activity — the write-path switches are wired to the host handlers', () => {
  const withHost =
    (extra: Record<string, unknown> = {}) =>
    (node: React.ReactNode) => (
      <DiscussionContextProvider items={HOST_ITEMS as any} onAddComment={vi.fn()} {...(extra as any)}>
        {node}
      </DiscussionContextProvider>
    );

  it('showCommentInput renders the composer once a host supplies onAddComment', async () => {
    mountBound({}, makeDataSource(), withHost());
    expect(await screen.findByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeTruthy();
  });

  it('showCommentInput:false hides it even when the host CAN persist a comment', async () => {
    mountBound({ showCommentInput: false }, makeDataSource(), withHost());
    expect(await screen.findByText('host supplied')).toBeTruthy();
    expect(screen.queryByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeNull();
  });

  it('with no host handler the feed stays read-only — no composer to mislead the author', async () => {
    mountBound({ showCommentInput: true }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.queryByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeNull();
  });

  it('enableMentions passes the host suggestions through, and false withholds them', async () => {
    const mentionSuggestions = [{ id: 'u1', label: 'Ada Lovelace' }];

    const on = mountBound({}, makeDataSource(), withHost({ mentionSuggestions }));
    const composerOn = await screen.findByPlaceholderText(COMPOSER_PLACEHOLDER);
    fireEvent.change(composerOn, { target: { value: '@' } });
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    on.unmount();

    mountBound({ enableMentions: false }, makeDataSource(), withHost({ mentionSuggestions }));
    const composerOff = await screen.findByPlaceholderText(COMPOSER_PLACEHOLDER);
    fireEvent.change(composerOff, { target: { value: '@' } });
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });
});

describe('record:activity — showSubscriptionToggle is the one documented gap', () => {
  it('renders nothing whatever it is set to, because no subscription backend exists', async () => {
    mountBound({ showSubscriptionToggle: true }, makeDataSource());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    // The bell would carry one of these aria-labels. Neither can appear: the
    // timeline needs a RecordSubscription value AND a persist handler, and the
    // platform has no object to read or write one from. Pinned so that the day
    // that backend lands, this test fails and the "NOT IMPLEMENTED" note on the
    // input declaration must be deleted with it (objectui#3165).
    expect(screen.queryByLabelText('Subscribe to notifications')).toBeNull();
    expect(screen.queryByLabelText('Unsubscribe from notifications')).toBeNull();
  });
});

/**
 * objectstack#34371 — a `types` allow-list that leaves out `comment` filters
 * every comment out of the block, the ones posted on it included, so the block
 * offers no composer and no Comments-only filter, and says why once in
 * development. HotCRM's `lead_detail` page authors exactly that shape
 * (`types: ['task']`, `showCompleted: true`); the controls are the same block
 * with `comment` admitted, and with no `types` at all.
 */
describe('record:activity — a types list without comment offers no comment composer (objectstack#34371)', () => {
  const FILTER_TRIGGER = 'Filter activity';
  const COMMENTS_ONLY = 'Comments Only';
  const FEED: FeedItem[] = [
    { id: 'c1', type: 'comment', actor: 'Ada', body: 'a posted comment', createdAt: '2026-11-16T09:47:37.000Z' },
    { id: 't1', type: 'task', actor: 'Ada', body: 'Meeting held', createdAt: '2026-11-16T09:30:00.000Z' },
  ];
  const HOTCRM_LEAD_ACTIVITY = { types: ['task'], limit: 20, showCompleted: true };
  const withHost = (node: React.ReactNode) => (
    <DiscussionContextProvider items={FEED as any} onAddComment={vi.fn()}>
      {node}
    </DiscussionContextProvider>
  );
  const mountBlock = (properties: Record<string, unknown>) =>
    mountBound({ type: 'record:activity', id: 'lead_activity', properties }, makeDataSource(), withHost);

  /** The dropdown's option labels, read by opening the Radix Select. */
  async function filterOptionLabels(): Promise<string[]> {
    fireEvent.keyDown(screen.getByRole('combobox', { name: FILTER_TRIGGER }), { key: 'ArrowDown' });
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
    return screen.getAllByRole('option').map((o) => o.textContent ?? '');
  }

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetWithheldCommentComposerWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const withheldWarnings = () =>
    (warn.mock.calls as unknown[][])
      .map((c: unknown[]) => String(c[0]))
      .filter((m: string) => m.includes('offers no comment composer'));

  it('the HotCRM shape (types: [task]) draws no composer and no Comments-only option', async () => {
    mountBlock(HOTCRM_LEAD_ACTIVITY);
    expect(await screen.findByText('Meeting held')).toBeTruthy();
    expect(screen.queryByText('a posted comment')).toBeNull();
    expect(screen.queryByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeNull();
    const options = await filterOptionLabels();
    expect(options).toContain('All Activity');
    expect(options).not.toContain(COMMENTS_ONLY);
  });

  it('CONTROL: types that admits comment keeps the composer and the option, and the comment shows', async () => {
    mountBlock({ ...HOTCRM_LEAD_ACTIVITY, types: ['task', 'comment'] });
    expect(await screen.findByText('a posted comment')).toBeTruthy();
    expect(screen.getByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeTruthy();
    expect(await filterOptionLabels()).toContain(COMMENTS_ONLY);
    expect(withheldWarnings()).toHaveLength(0);
  });

  it('CONTROL: no types keeps the composer and the option, and the comment shows', async () => {
    mountBlock({ limit: 20, showCompleted: true });
    expect(await screen.findByText('a posted comment')).toBeTruthy();
    expect(screen.getByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeTruthy();
    expect(await filterOptionLabels()).toContain(COMMENTS_ONLY);
    expect(withheldWarnings()).toHaveLength(0);
  });

  it('warns once, naming the block, its types and both fixes, however often it renders', async () => {
    const first = mountBlock(HOTCRM_LEAD_ACTIVITY);
    expect(await screen.findByText('Meeting held')).toBeTruthy();
    first.rerender(
      <RecordContextProvider objectName="crm_account" recordId="rec-alpha" data={{ id: 'rec-alpha', name: 'Alpha' }} dataSource={makeDataSource()}>
        {withHost(<RecordActivityRenderer schema={{ type: 'record:activity', id: 'lead_activity', properties: { ...HOTCRM_LEAD_ACTIVITY } } as any} />)}
      </RecordContextProvider>,
    );
    first.unmount();
    mountBlock(HOTCRM_LEAD_ACTIVITY);
    expect(await screen.findByText('Meeting held')).toBeTruthy();
    const said = withheldWarnings();
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('record:activity "lead_activity"');
    expect(said[0]).toContain('["task"]');
    expect(said[0]).toContain('add "comment" to `types`');
    expect(said[0]).toContain('`showCommentInput: false`');
  });

  it('an author who switched the composer off is not told anything', async () => {
    mountBlock({ ...HOTCRM_LEAD_ACTIVITY, showCommentInput: false });
    expect(await screen.findByText('Meeting held')).toBeTruthy();
    expect(withheldWarnings()).toHaveLength(0);
  });
});

describe('record:activity — one line per changed field, old → new (objectstack#36290)', () => {
  /** An `updated` row as plugin-audit serves it: the summary, and the field-change code narrowed to this reader. */
  const updatedRow = (
    id: string,
    changes: Array<{ field: string; from: Record<string, unknown>; to: Record<string, unknown> }>,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    type: 'updated',
    summary: 'stored summary',
    timestamp: '2026-11-20T09:00:00.000Z',
    actor_name: 'Grace',
    metadata: JSON.stringify({ summary_message: { key: 'fieldChanges', object: 'crm_account', changes } }),
    ...extra,
  });
  const SCHEMA = {
    name: 'crm_account',
    fields: {
      notes: { type: 'textarea', label: 'Customer notes' },
      phone: { type: 'phone', label: 'Phone' },
      email: { type: 'email', label: 'Email' },
      stage: {
        type: 'select',
        label: 'Stage',
        options: [
          { value: 'prospect', label: 'Prospect' },
          { value: 'won', label: 'Closed won' },
        ],
      },
      parent_id: { type: 'lookup', label: 'Parent account' },
      owner_id: { type: 'user', label: 'Owner' },
      vip: { type: 'boolean', label: 'VIP' },
    },
  };
  const mount = (rows: unknown[]) =>
    render(
      <RecordContextProvider
        objectName="crm_account"
        recordId="rec-alpha"
        data={{ id: 'rec-alpha', name: 'Alpha' }}
        objectSchema={SCHEMA as any}
        dataSource={makeDataSource(rows)}
      >
        <RecordActivityRenderer schema={{ type: 'record:activity' } as any} />
      </RecordContextProvider>,
    );
  const linesOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-stream-field-change] [data-field-change]')).map((line) => ({
      field: line.getAttribute('data-field-change'),
      label: line.querySelector('[data-field-change-label]')?.textContent,
      old: line.querySelector('[data-field-change-side="old"]')?.textContent,
      new: line.querySelector('[data-field-change-side="new"]')?.textContent,
      text: line.textContent,
    }));

  it('a save that changed one field: the entry, and under it `Label: old → new`', async () => {
    const { container } = mount([
      updatedRow('a1', [{ field: 'notes', from: { text: 'Old words' }, to: { text: 'New words' } }]),
    ]);
    await waitFor(() => expect(container.querySelector('[data-stream-field-change]')).not.toBeNull());
    expect(container.querySelectorAll('[data-stream-system-row]')).toHaveLength(1);
    expect(linesOf(container)).toEqual([
      { field: 'notes', label: 'Customer notes:', old: 'Old words', new: 'New words', text: 'Customer notes: Old words → New words' },
    ]);
  });

  it('one save that changed the phone and the email: ONE entry, two lines under it', async () => {
    const { container } = mount([
      updatedRow('a2', [
        { field: 'phone', from: { text: '111' }, to: { text: '222' } },
        { field: 'email', from: { text: 'a@x.io' }, to: { text: 'b@x.io' } },
      ]),
    ]);
    await waitFor(() => expect(container.querySelectorAll('[data-stream-field-change]')).toHaveLength(2));
    const entries = container.querySelectorAll('[data-stream-system-row]');
    expect(entries).toHaveLength(1);
    // The entry is ONE row: its line and the field lines under it.
    expect(container.querySelectorAll('[data-stream-row]')).toHaveLength(1);
    expect(entries[0].hasAttribute('data-stream-row')).toBe(true);
    expect(entries[0].querySelectorAll('[data-stream-field-change]')).toHaveLength(2);
    expect(entries[0].querySelector('[data-stream-change]')?.textContent).toBe('Updated Phone, Email');
    expect(linesOf(container).map((l) => [l.field, l.old, l.new])).toEqual([
      ['phone', '111', '222'],
      ['email', 'a@x.io', 'b@x.io'],
    ]);
  });

  it('an empty side reads as the word for empty, never the writer\'s `∅`', async () => {
    const { container } = mount([updatedRow('a3', [{ field: 'phone', from: { text: '∅' }, to: { text: '222' } }])]);
    await waitFor(() => expect(container.querySelector('[data-field-change]')).not.toBeNull());
    const old = container.querySelector('[data-field-change-side="old"]')!;
    expect(old.textContent).toBe('Empty');
    expect(old.hasAttribute('data-field-change-empty')).toBe(true);
    expect(container.textContent).not.toContain('∅');
  });

  it('an option, a lookup and a user read as the option label and the record names, never the stored ids', async () => {
    const { container } = mount([
      updatedRow('a4', [
        { field: 'stage', from: { text: 'Prospect', option: 'prospect' }, to: { text: 'Won', option: 'won' } },
        { field: 'parent_id', from: { text: '∅' }, to: { text: 'Acme Corp' } },
        { field: 'owner_id', from: { text: 'Ada Lovelace' }, to: { text: 'Grace Hopper' } },
        { field: 'vip', from: { text: 'No', boolean: false }, to: { text: 'Yes', boolean: true } },
      ]),
    ]);
    await waitFor(() => expect(container.querySelectorAll('[data-field-change]')).toHaveLength(4));
    expect(linesOf(container).map((l) => [l.label, l.old, l.new])).toEqual([
      // The field's option label as the page reads it, not the label the writer stored.
      ['Stage:', 'Prospect', 'Closed won'],
      ['Parent account:', 'Empty', 'Acme Corp'],
      ['Owner:', 'Ada Lovelace', 'Grace Hopper'],
      ['VIP:', 'No', 'Yes'],
    ]);
    expect(container.textContent).not.toMatch(/\bwon\b|prospect/);
  });

  it('draws only the changes the server served: a field the reader may not read has no line', async () => {
    // The row's stored change touched `phone` and `salary`; the reader is not
    // served `salary`, so plugin-audit's redaction left its change out of the code.
    const { container } = mount([
      updatedRow('a5', [{ field: 'phone', from: { text: '111' }, to: { text: '222' } }], { changed_fields: ['phone'] }),
    ]);
    await waitFor(() => expect(container.querySelector('[data-field-change]')).not.toBeNull());
    expect(linesOf(container).map((l) => l.field)).toEqual(['phone']);
    expect(container.querySelector('[data-field-change="salary"]')).toBeNull();
  });

  it('a long value is cut to its line, with a control that shows it in full and clamps it again', async () => {
    const long = 'A long note that runs well past one line of the activity column, and then some more.';
    const { container } = mount([updatedRow('a6', [{ field: 'notes', from: { text: 'Short' }, to: { text: long } }])]);
    await waitFor(() => expect(container.querySelector('[data-field-change]')).not.toBeNull());
    const line = container.querySelector('[data-field-change="notes"]')!;
    const side = line.querySelector('[data-field-change-side="new"]')!;
    expect(side.className).toContain('truncate');
    const toggle = line.querySelector('[data-field-change-toggle]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('Show all');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Show less');
    expect(side.className).toContain('whitespace-pre-wrap');
    expect(side.className).not.toContain('truncate');
    expect(side.textContent).toBe(long);
  });

  it('the 动态 stream: two saves by one person on one day fold, and each save opens to its own lines', () => {
    const at = (minute: number) => {
      const d = new Date();
      d.setHours(9, minute, 0, 0);
      return d.toISOString();
    };
    const items = [
      updatedRow('s1', [{ field: 'phone', from: { text: '111' }, to: { text: '222' } }], { timestamp: at(5) }),
      updatedRow('s2', [
        { field: 'notes', from: { text: '∅' }, to: { text: 'First note' } },
        { field: 'email', from: { text: 'a@x.io' }, to: { text: 'b@x.io' } },
      ], { timestamp: at(4) }),
    ].map((row) => activityRowToFeedItem(row, 'System')!);
    const { container } = render(<RecordActivityTimeline items={items} variant="stream" titleLabel="Timeline" />);
    const fold = container.querySelector('[data-testid="activity-fold"]')!;
    expect(fold.getAttribute('data-fold-count')).toBe('2');
    fireEvent.click(fold.querySelector('button[aria-expanded]')!);
    const rows = Array.from(container.querySelectorAll('[data-testid="activity-fold-entries"] [data-stream-row]'));
    expect(rows.map((row) => row.querySelectorAll('[data-stream-field-change]').length)).toEqual([1, 2]);
    expect(rows[1].querySelector('[data-field-change="notes"]')?.textContent).toBe('notes: Empty → First note');
  });

  it('CONTROL — a short value offers no control, and a row with no served code draws its summary as before', async () => {
    const { container } = mount([
      updatedRow('a7', [{ field: 'phone', from: { text: '111' }, to: { text: '222' } }]),
      { id: 'a8', type: 'updated', summary: 'Stage: draft to qualified', timestamp: '2026-11-19T09:00:00.000Z', actor_name: 'Ada' },
    ]);
    await waitFor(() => expect(container.querySelector('[data-field-change]')).not.toBeNull());
    expect(container.querySelector('[data-field-change-toggle]')).toBeNull();
    expect(screen.getByText('Stage: draft to qualified')).toBeTruthy();
    expect(container.querySelectorAll('[data-stream-field-change]')).toHaveLength(1);
  });
});
