/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:chatter.feed` / `record:discussion.feed` — the FILTER members are
 * live on this path, and the AFFORDANCE members still are (objectui#8934)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `@objectstack/spec` declares `RecordChatterProps.feed:
 * RecordActivityProps.optional()` (`component.zod.ts:1366`), bound to both
 * `record:chatter` (`:2948`) and `record:discussion` (`:2962`). So `feed` IS
 * the `record:activity` shape, filter members included, and a renderer that
 * dropped them had an IMPLEMENTATION GAP rather than a narrower contract.
 * `renderers/record-chatter.tsx` now runs `applyFeedConfig` with the same call
 * shape `record-activity.tsx:219` uses, and this file pins that.
 *
 * ⚠️ AN EARLIER SHAPE OF THIS FILE PINNED THE OPPOSITE, and that is the reason
 * it is worth stating here rather than in a card. It asserted that a filter
 * member authored inside `feed` changed nothing — true of the implementation at
 * the time, and therefore a LOCK on ever closing the gap: wiring the pipeline in
 * turned exactly those cases red. A pin whose subject is "the implementation
 * disagrees with the protocol" freezes the disagreement. The direction the
 * maintainer ruled is the opposite one: the protocol is the contract, docs
 * follow the implementation, and a protocol that is wrong is changed in
 * `@objectstack/spec` first.
 *
 * ## What a control has to do here, now that `applyFeedConfig` is the SUBJECT
 *
 * In the earlier shape `applyFeedConfig` was the firing control: running the
 * fixture through it proved the values were effective, so a zero on the panel
 * was a reading about the path. It cannot play that part any more — it is the
 * pipeline under test. Three controls replace it, and each answers a different
 * way this pin could be green over nothing:
 *
 *   AGREEMENT       the rows the panel renders are exactly the ids
 *                   `applyFeedConfig` returns for the same authored config, so
 *                   the pin says WHICH pipeline ran, not merely that something
 *                   moved.
 *   KEEP-LEG        every filter that removes a row is paired with a value of
 *                   the SAME member that keeps it, so "the row is gone" is
 *                   never satisfiable by a panel that renders nothing.
 *   UNDECLARED-KEY  a key the shape does not declare, authored in the same
 *                   position, moves nothing — so the panel is reacting to the
 *                   declared members and not to the mere presence of a `feed`.
 *
 * ## The five affordances are unchanged by the route, and still pinned
 *
 * `config.feed` still reaches `RecordActivityTimeline`, which reads the five
 * affordance members at `:213-217`. `showSubscriptionToggle` is pinned on that
 * component directly: it is read, but the bell is gated at `:326` behind
 * `showSubscription && subscription` and `RecordChatterRenderer` passes no
 * `subscription`, so the component is where its live subject is.
 *
 * ⚠️ NOT covered here, and still not claimed here: `filterMode` and
 * `enableMentions` are also members of the declared shape, and `applyFeedConfig`
 * covers the four filter members only — so this file asserts nothing about
 * either of them, in either direction.
 *
 * ⭐ What this paragraph used to add, and no longer may: that the two are
 * "still unread on this path". They are read now. objectui#8968 wired both into
 * `renderers/record-chatter.tsx` and pinned them in
 * `recordChatterFilterModeMentions-8968.test.tsx`. The SCOPE sentence above
 * survives that card; the claim about the implementation did not, and is
 * corrected rather than deleted so the next reader can see which half moved.
 *
 * ## Resolution
 *
 * Nothing resolves through any `dist/`: `../record-chatter`,
 * `../recordActivityFeed` and `../../RecordActivityTimeline` are this package's
 * own source, and `@object-ui/react` is mapped to its `src` by the root
 * `vitest.config.mts` alias table.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import type { ComponentInput, FeedItem, RecordActivityComponentProps, RecordSubscription } from '@object-ui/types';
import { RecordChatterRenderer } from '../record-chatter';
import { applyFeedConfig, DEFAULT_ACTIVITY_LIMIT } from '../recordActivityFeed';
import { RecordActivityTimeline } from '../../RecordActivityTimeline';
import '../../index';

/** Both registered names are the same renderer on the same `CHATTER_INPUTS`. */
const BLOCK_NAMES = ['record:chatter', 'record:discussion'] as const;

/** The composer placeholder in the `en` pack — `showCommentInput`'s observable. */
const COMPOSER = /Leave a comment/;
/** The filter dropdown's accessible name — `showFilterToggle`'s observable. */
const FILTER_TRIGGER = 'Filter activity';
/** The empty-state reaction button — `enableReactions`'s observable. */
const ADD_REACTION = 'Add reaction';
/** The bell's accessible name when not subscribed — `showSubscriptionToggle`'s. */
const SUBSCRIBE = 'Subscribe to notifications';
/** The paging affordance `limit` turns on once it trims the window. */
const LOAD_MORE = 'Load more';

/**
 * One item of each kind the four filter members act on, chronological.
 *   `types`            selects by kind
 *   `unifiedTimeline`  set false drops `field_change`
 *   `showCompleted`    set true keeps `task`, which is hidden by default
 *   `limit`            is the page window, newest-last
 * Timestamps are fixed and well in the past so every row formats through
 * `toLocaleDateString()` and two renders are comparable.
 */
const ITEMS: FeedItem[] = [
  { id: 'c-1', type: 'comment', actor: 'Ada', body: 'Root comment', createdAt: '2026-01-02T00:00:00.000Z' },
  {
    id: 'f-1',
    type: 'field_change',
    actor: 'Grace',
    createdAt: '2026-01-03T00:00:00.000Z',
    fieldChanges: [{ field: 'stage', fieldLabel: 'Stage', oldValue: 'New', newValue: 'Won' }],
  },
  { id: 't-1', type: 'task', actor: 'Ada', body: 'Follow up call', createdAt: '2026-01-04T00:00:00.000Z' },
  { id: 'c-2', type: 'comment', actor: 'Grace', body: 'Later comment', createdAt: '2026-01-05T00:00:00.000Z' },
];

/** One text marker per fixture row, so a render reads back as an id list. */
const MARKERS: Record<string, RegExp> = {
  'c-1': /Root comment/,
  'f-1': /Stage/,
  't-1': /Follow up call/,
  'c-2': /Later comment/,
};

/** The affordance members, all stated, so no filter leg rides on a default. */
const AFFORDANCES = {
  showFilterToggle: true,
  showCommentInput: true,
  enableReactions: true,
  enableThreading: false,
  showSubscriptionToggle: true,
} as const;

const handlers = {
  onAddComment: vi.fn(),
  onAddReply: vi.fn(),
  onToggleReaction: vi.fn(),
};

/**
 * The renderer the REGISTRY resolves for a block name — not the imported
 * symbol.
 *
 * Every `.each(BLOCK_NAMES)` case below therefore really runs under both names:
 * an earlier shape of this file took the name only as a test label while always
 * rendering the imported `RecordChatterRenderer`, so "run against both names"
 * was decoration. Resolving through `ComponentRegistry` makes a registration
 * that stopped pointing at this renderer a failure here.
 */
function rendererFor(blockName: string): React.ComponentType<any> {
  const impl = ComponentRegistry.get(blockName) as React.ComponentType<any> | undefined;
  if (!impl) throw new Error(`no renderer registered for ${blockName}`);
  return impl;
}

function mountAs(blockName: string, feed: unknown, items: FeedItem[] = ITEMS) {
  const Renderer = rendererFor(blockName);
  const schema: Record<string, unknown> = { position: 'bottom' };
  if (feed !== undefined) schema.feed = feed;
  return render(
    <DiscussionContextProvider items={items as any} loading={false} {...handlers}>
      <Renderer schema={schema as any} />
    </DiscussionContextProvider>,
  );
}

/** Which fixture rows the panel is currently rendering, in fixture order. */
function renderedIds(): string[] {
  return Object.keys(MARKERS).filter((id) => screen.queryAllByText(MARKERS[id]).length > 0);
}

/** What the declared pipeline says those rows should be, for the same config. */
function pipelineIds(config: Record<string, unknown>, pageSize = DEFAULT_ACTIVITY_LIMIT): string[] {
  // The block name only addresses the pipeline's diagnostics (objectui#9557);
  // the rows it keeps are the same under either registered name.
  return applyFeedConfig(ITEMS, config, pageSize, 'record:chatter').items.map((i) => String(i.id));
}

beforeEach(() => {
  cleanup();
  handlers.onAddComment.mockClear();
  handlers.onAddReply.mockClear();
  handlers.onToggleReaction.mockClear();
});

describe.each(BLOCK_NAMES)('%s: the FILTER members move the panel (objectui#8934)', (blockName) => {
  it('`showCompleted` decides whether the completed activity is rendered', () => {
    // The spec default is false, so the task is hidden without being asked for
    // — this is `record:activity`'s behaviour, which is what the protocol says
    // this key is. Both directions, so "hidden" is never "never renderable".
    mountAs(blockName, { ...AFFORDANCES });
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, showCompleted: true });          // KEEP-LEG
    expect(renderedIds()).toEqual(['c-1', 'f-1', 't-1', 'c-2']);
  });

  it('`types` narrows the timeline to the kinds it names', () => {
    mountAs(blockName, { ...AFFORDANCES, types: ['comment'] });
    expect(renderedIds()).toEqual(['c-1', 'c-2']);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, types: ['comment', 'field_change'] });   // KEEP-LEG
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
  });

  it('`unifiedTimeline: false` un-mixes the field change out of the stream', () => {
    mountAs(blockName, { ...AFFORDANCES, unifiedTimeline: false });
    expect(renderedIds()).toEqual(['c-1', 'c-2']);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, unifiedTimeline: true });                // KEEP-LEG
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
  });

  it('`limit` is a PAGE SIZE, not a cap: it trims the window and offers Load more', () => {
    mountAs(blockName, { ...AFFORDANCES, limit: 1 });
    // Newest-last paging, so a window of one is the newest row.
    expect(renderedIds()).toEqual(['c-2']);
    expect(screen.getByRole('button', { name: LOAD_MORE })).toBeTruthy();

    // Growing the window by `limit` is what makes it a page size rather than a
    // truncation — the half that would be missing if only `pageSize` were wired.
    fireEvent.click(screen.getByRole('button', { name: LOAD_MORE }));
    expect(renderedIds()).toEqual(['f-1', 'c-2']);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, limit: 20 });                            // KEEP-LEG
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
    expect(screen.queryByRole('button', { name: LOAD_MORE })).toBeNull();
  });
});

describe('the controls that make the legs above readings (objectui#8934)', () => {
  it.each(BLOCK_NAMES)('%s: AGREEMENT — the panel renders exactly what `applyFeedConfig` returns', (blockName) => {
    // Names WHICH pipeline ran rather than only that something moved: the
    // expectation is computed from `applyFeedConfig` here, so a lookalike
    // filter written by hand in the renderer would disagree with it.
    const authored = { types: ['comment', 'task'], showCompleted: true, unifiedTimeline: false, limit: 2 };
    mountAs(blockName, { ...AFFORDANCES, ...authored });
    const expected = pipelineIds(authored, authored.limit);
    expect(expected).toEqual(['t-1', 'c-2']);   // the pipeline is not vacuous here
    expect(renderedIds()).toEqual(expected);
  });

  it.each(BLOCK_NAMES)('%s: UNDECLARED-KEY — a key the shape does not declare moves nothing', (blockName) => {
    // Without this leg every case above is satisfiable by a panel that reacts
    // to the mere presence of an authored `feed` object.
    mountAs(blockName, { ...AFFORDANCES });
    const baseline = renderedIds();

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, notADeclaredMember: ['comment'] });
    expect(renderedIds()).toEqual(baseline);
  });

  it('CONTROL — with no `feed` authored at all, the renderer defaults still render a feed', () => {
    // The `record:activity` defaults reach this path now, so "no config" is a
    // real reading and not an empty panel: everything but the completed task.
    // Rendered through the IMPORTED symbol, so the registry lookup used
    // everywhere else has a same-file control that it resolves to this module.
    render(
      <DiscussionContextProvider items={ITEMS as any} loading={false} {...handlers}>
        <RecordChatterRenderer schema={{ position: 'bottom' } as any} />
      </DiscussionContextProvider>,
    );
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
    expect(renderedIds()).toEqual(pipelineIds({}));

    cleanup();
    mountAs('record:chatter', undefined);
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
  });
});

describe.each(BLOCK_NAMES)('%s: the five AFFORDANCE members still move the timeline', (blockName) => {
  it('`showFilterToggle` decides whether the filter dropdown is rendered', () => {
    mountAs(blockName, { ...AFFORDANCES, showFilterToggle: true });
    expect(screen.getByRole('combobox', { name: FILTER_TRIGGER })).toBeTruthy();

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, showFilterToggle: false });
    expect(screen.queryByRole('combobox', { name: FILTER_TRIGGER })).toBeNull();
    // CONTROL — the panel still rendered, so "no dropdown" is not "no panel".
    expect(screen.getByText('Root comment')).toBeTruthy();
  });

  it('`showCommentInput` decides whether the composer is rendered', () => {
    mountAs(blockName, { ...AFFORDANCES, showCommentInput: true });
    expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, showCommentInput: false });
    expect(screen.queryByPlaceholderText(COMPOSER)).toBeNull();
    expect(screen.getByText('Root comment')).toBeTruthy();
  });

  it('`enableReactions` decides whether the reaction affordance is rendered', () => {
    mountAs(blockName, { ...AFFORDANCES, enableReactions: true });
    expect(screen.getAllByRole('button', { name: ADD_REACTION }).length).toBeGreaterThan(0);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, enableReactions: false });
    expect(screen.queryAllByRole('button', { name: ADD_REACTION })).toHaveLength(0);
    expect(screen.getByText('Root comment')).toBeTruthy();
  });

  it('`enableThreading` decides whether a reply is pulled out of the root list', () => {
    const withReply = [
      ...ITEMS,
      { id: 'c-3', type: 'comment', actor: 'Grace', body: 'A threaded reply', parentId: 'c-1', createdAt: '2026-01-06T00:00:00.000Z' } as FeedItem,
    ];
    const rootBodies = () => screen.queryAllByText(/Root comment|A threaded reply/).map((el) => el.textContent);
    mountAs(blockName, { ...AFFORDANCES, enableThreading: true }, withReply);
    expect(rootBodies()).toEqual(['Root comment']);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, enableThreading: false }, withReply);
    expect(rootBodies()).toEqual(['Root comment', 'A threaded reply']);
  });
});

describe('`showSubscriptionToggle` moves `RecordActivityTimeline`, the component `feed` is handed to', () => {
  const subscription: RecordSubscription = { recordId: 'r-1', subscribed: false };
  const SUBSCRIPTION_ON: RecordActivityComponentProps = { showSubscriptionToggle: true };
  const SUBSCRIPTION_OFF: RecordActivityComponentProps = { showSubscriptionToggle: false };

  it('renders the bell when the member is on AND the host supplies a subscription', () => {
    render(<RecordActivityTimeline items={ITEMS} config={SUBSCRIPTION_ON} subscription={subscription} />);
    expect(screen.getByRole('button', { name: SUBSCRIBE })).toBeTruthy();

    cleanup();
    render(<RecordActivityTimeline items={ITEMS} config={SUBSCRIPTION_OFF} subscription={subscription} />);
    expect(screen.queryByRole('button', { name: SUBSCRIBE })).toBeNull();
    // CONTROL — the timeline still rendered, so "no bell" is not "no timeline".
    expect(screen.getByText('Root comment')).toBeTruthy();
  });

  it('CONTROL — the same member with NO subscription renders no bell, which is why the chatter path shows none', () => {
    // `RecordChatterRenderer` passes no `subscription`, so this is the leg that
    // explains the gap without pinning the member as dead: the member is live
    // (case above), the HOST input is what is missing here.
    render(<RecordActivityTimeline items={ITEMS} config={SUBSCRIPTION_ON} />);
    expect(screen.queryByRole('button', { name: SUBSCRIBE })).toBeNull();
    expect(screen.getByText('Root comment')).toBeTruthy();
  });
});

describe('the declaration stays as wide as the protocol (objectui#8934)', () => {
  it('both names share ONE `inputs` array, so `feed` is described once', () => {
    const chatter = ComponentRegistry.getConfig('record:chatter');
    const discussion = ComponentRegistry.getConfig('record:discussion');
    expect(chatter?.inputs).toBeTruthy();
    // Same ARRAY, not merely equal contents: duplicating it to describe the two
    // names differently is what this pin exists to catch.
    expect(discussion?.inputs).toBe(chatter?.inputs);
  });

  it('`feed` is still a bare `type: object` — it was NOT narrowed to the implementation', () => {
    // The spec declares this key as `RecordActivityProps` (`component.zod.ts:1366`).
    // Narrowing the declaration locally to whatever the renderer happened to
    // read is the direction the maintainer refused; this leg holds it open.
    const feed = ComponentRegistry.getConfig('record:chatter')?.inputs?.find((i: ComponentInput) => i.name === 'feed');
    expect(feed).toBeTruthy();
    expect(feed?.type).toBe('object');
    expect(feed?.of).toBeUndefined();
    // CONTROL — the instrument reads `of` where a sibling registration declares
    // one, so `undefined` above is a reading rather than a blind lookup.
    const activityTypes = ComponentRegistry.getConfig('record:activity')?.inputs?.find((i: ComponentInput) => i.name === 'types');
    expect(activityTypes?.of).toBe('string');
  });
});
