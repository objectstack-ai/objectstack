/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:chatter.feed` / `record:discussion.feed` — the nested config's
 * MEMBER shape, and the fact that authoring it REPLACES (objectui#8071)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The per-block member pin objectui#8068 asks for on these two keys. They are
 * ONE key on ONE renderer: `record:chatter` and `record:discussion` are the
 * same `RecordChatterRenderer` registered under two names against the same
 * `CHATTER_INPUTS`, so one file pins both — the shape
 * `record-picker-label-placeholder-i18n.test.tsx` already set for a pair of
 * keys covered by a single mechanism (objectui#8071 slice 3).
 *
 * `feed` is declared a bare `type: 'object'` in the registration, and its
 * member list is the SPEC's: `@objectstack/spec` declares
 * `RecordChatterProps.feed: RecordActivityProps.optional()`
 * (`component.zod.ts:1366`), bound to both names. The only prior coverage,
 * `record-chatter.loading.test.tsx` (read end to end before this file was
 * written), is about the host's `loading` signal reaching the panel and never
 * authors `feed` at all.
 *
 * ## The member fact that matters most: authoring `feed` REPLACES it
 *
 * `record-chatter.tsx` composes its config as
 *
 *     { position, collapsible, feed: {DEFAULTS}, ...(schema) }
 *
 * — a SHALLOW spread. So an authored `feed` does not merge with the renderer's
 * three defaults (`enableReactions` / `enableThreading` / `showCommentInput`,
 * all true), it displaces them wholesale, and every member the author did not
 * restate falls back to `RecordActivityTimeline`'s own `?? false`. An author
 * who writes `feed: { showCommentInput: true }` meaning "and keep the rest"
 * turns reactions and threading OFF. That is the whole reason this key needs a
 * member pin rather than a presence check, and it is asserted below in both
 * directions rather than described here.
 *
 * ## WHICH members of `feed` are live on this path
 *
 * `config.feed` reaches `RecordActivityTimeline`, which reads the five
 * AFFORDANCE members (`showFilterToggle`, `showCommentInput`,
 * `enableReactions`, `enableThreading`, `showSubscriptionToggle`) at
 * `:213-217`. The four FILTER members (`types` / `limit` / `showCompleted` /
 * `unifiedTimeline`) are applied by `applyFeedConfig`, which
 * `renderers/record-chatter.tsx` now runs before handing items to the panel,
 * with `record-activity.tsx:219`'s call shape — so they are live here too
 * (objectui#8934). Their behaviour is pinned next door in
 * `recordChatterFeedMembersLive-8934.test.tsx`; this file stays on the
 * displacement fact above.
 *
 * ⚠️ RE-POINTED TWICE, and the second time reversed the first — worth stating
 * because the two versions read the same evidence and disagreed. This section
 * once recorded the filter members as inert on this path and treated that as
 * the key's shape; objectui#8934 first proposed narrowing the registration to
 * match, and that route was overturned on a maintainer principle: the protocol
 * is the contract, documentation follows the implementation, and a protocol
 * that is wrong is changed in `@objectstack/spec` first. Since the spec
 * declares the whole `RecordActivityProps` shape here, the inertness was an
 * IMPLEMENTATION GAP, and it was closed in the renderer rather than written
 * into the contract.
 *
 * ⚠️ Two members of the declared shape are NOT closed by that pipeline, and
 * ⛔ neither is pinned here, in either direction: `filterMode` (which the
 * timeline takes as a component PROP — it destructures `filterMode:
 * controlledFilter` and resolves `controlledFilter ?? internalFilter`, never
 * reading it off `config`) and `enableMentions`.
 *
 * ⭐ Both were UNREAD on this path when that sentence was first written, and
 * that half is no longer true: objectui#8968 wired them into
 * `renderers/record-chatter.tsx`, with its own pin in
 * `recordChatterFilterModeMentions-8968.test.tsx`. The correction is left in
 * place of the old claim rather than removed, because this docblock is the
 * record of what each pin does and does not cover.
 *
 * ## Resolution
 *
 * Nothing resolves through any `dist/`: `../record-chatter` is this package's
 * own source and `@object-ui/react` is mapped to its `src` by the root
 * `vitest.config.mts` alias table, so an ablation of `record-chatter.tsx` is
 * visible here without a rebuild.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordChatterRenderer } from '../record-chatter';

/** The composer's placeholder in the `en` pack — `showCommentInput`'s observable. */
const COMPOSER = /Leave a comment/;
/** The empty-state reaction button's accessible name — `enableReactions`'s observable. */
const ADD_REACTION = 'Add reaction';

/** A root comment plus a REPLY to it: `enableThreading`'s observable is whether
 *  the reply is pulled out of the root list and under its parent. */
const ITEMS: FeedItem[] = [
  { id: 'c-1', type: 'comment', actor: 'Ada', body: 'Root comment', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'c-2', type: 'comment', actor: 'Grace', body: 'A threaded reply', parentId: 'c-1', createdAt: '2026-01-03T00:00:00.000Z' },
];

const handlers = {
  onAddComment: vi.fn(),
  onAddReply: vi.fn(),
  onToggleReaction: vi.fn(),
};

/** Both registered names resolve to this one renderer — every case runs on both. */
const BLOCK_NAMES = ['record:chatter', 'record:discussion'] as const;

function mount(feed: unknown, opts: { authored?: boolean } = {}) {
  const schema: Record<string, unknown> = { position: 'bottom' };
  if (opts.authored !== false) schema.feed = feed;
  return render(
    <DiscussionContextProvider items={ITEMS as any} loading={false} {...handlers}>
      <RecordChatterRenderer schema={schema as any} />
    </DiscussionContextProvider>,
  );
}

/** Root-level feed rows, i.e. bodies rendered outside a threaded reply block. */
const rootBodies = () => screen.queryAllByText(/Root comment|A threaded reply/).map((el) => el.textContent);

beforeEach(() => {
  cleanup();
  handlers.onAddComment.mockClear();
  handlers.onAddReply.mockClear();
  handlers.onToggleReaction.mockClear();
});

describe.each(BLOCK_NAMES)('%s `feed` members reach the timeline (objectui#8071)', (blockName) => {
  it(`${blockName}: with NO \`feed\` authored, the renderer's three defaults are in force`, () => {
    // The baseline the displacement case below is measured against: reactions
    // and the composer are ON without the author writing anything.
    mount(undefined, { authored: false });
    expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: ADD_REACTION }).length).toBeGreaterThan(0);
  });

  it(`${blockName}: \`showCommentInput: false\` withholds the composer`, () => {
    mount({ showCommentInput: false, enableReactions: true, enableThreading: false });
    expect(screen.queryByPlaceholderText(COMPOSER)).toBeNull();
    // CONTROL — the panel still rendered, so "no composer" is not "no panel".
    expect(screen.getByText('Root comment')).toBeTruthy();
  });

  it(`${blockName}: \`enableReactions: false\` withholds the reaction affordance`, () => {
    mount({ showCommentInput: true, enableReactions: false, enableThreading: false });
    expect(screen.queryAllByRole('button', { name: ADD_REACTION })).toHaveLength(0);
    expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();
  });

  it(`${blockName}: \`enableThreading\` decides whether a reply is a ROOT row`, () => {
    // The member with a structural effect rather than an affordance one: with
    // threading ON the reply is grouped under its parent and leaves the root
    // list; with it OFF the same item is rendered as another top-level row.
    mount({ showCommentInput: false, enableReactions: false, enableThreading: true });
    expect(rootBodies()).toEqual(['Root comment']);

    cleanup();
    mount({ showCommentInput: false, enableReactions: false, enableThreading: false });
    expect(rootBodies()).toEqual(['Root comment', 'A threaded reply']);
  });
});

describe('an authored `feed` REPLACES the defaults rather than merging (objectui#8071)', () => {
  // The shallow-spread consequence, and the reason this key earns a member pin.
  it.each(BLOCK_NAMES)('%s: restating ONE member drops the other two defaults', (_blockName) => {
    mount({ showCommentInput: true });
    // The member the author restated is honoured…
    expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();
    // …and the two they did not are NOT inherited from the renderer's default
    // `feed`, because the whole object was displaced.
    expect(screen.queryAllByRole('button', { name: ADD_REACTION })).toHaveLength(0);
    expect(rootBodies()).toEqual(['Root comment', 'A threaded reply']);
  });

  it.each(BLOCK_NAMES)('%s: CONTROL — the SAME three affordances are on when `feed` is absent', (_blockName) => {
    // Without this control the case above is satisfiable by a renderer in which
    // reactions and threading are simply never on in this harness.
    mount(undefined, { authored: false });
    expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: ADD_REACTION }).length).toBeGreaterThan(0);
    expect(rootBodies()).toEqual(['Root comment']);
  });

  it.each(BLOCK_NAMES)('%s: an EMPTY `feed` displaces all three, and they land DIFFERENTLY', (_blockName) => {
    // `feed: {}` is an authored object, so the spread replaces the renderer's
    // defaults with nothing. What each member then falls back to is
    // `RecordActivityTimeline`'s OWN default, and those are not uniform:
    //
    //   showCommentInput  `config?.showCommentInput !== false`  -> ON when absent
    //   enableReactions   `config?.enableReactions ?? false`     -> OFF when absent
    //   enableThreading   `config?.enableThreading ?? false`     -> OFF when absent
    //
    // So displacing the default `feed` silently turns reactions and threading
    // off while leaving the composer up. Measured, not assumed: the first shape
    // of this case asserted all three went off and went red on the composer.
    // Pinned per member so the asymmetry cannot drift unnoticed in either
    // direction — a future uniform `?? false` would take the composer down, and
    // a future deep merge would bring all three back.
    mount({});
    expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: ADD_REACTION })).toHaveLength(0);
    expect(rootBodies()).toEqual(['Root comment', 'A threaded reply']);
  });

  it.each(BLOCK_NAMES)('%s: only an EXPLICIT `false` withholds the composer', (_blockName) => {
    // The other side of that asymmetry, and the control that stops the case
    // above from reading as "the composer ignores `feed` entirely".
    mount({ showCommentInput: false });
    expect(screen.queryByPlaceholderText(COMPOSER)).toBeNull();
  });
});
