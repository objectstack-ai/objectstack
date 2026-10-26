/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:chatter.feed` / `record:discussion.feed` — `filterMode` and
 * `enableMentions`, the two members `applyFeedConfig` never reached
 * (objectui#8968)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * objectui#8934 ran the filter PIPELINE on this path, which made `types` /
 * `limit` / `showCompleted` / `unifiedTimeline` live. Its own pin file says in
 * as many words that it did not reach `filterMode` or `enableMentions`, and
 * this file is the other half: the protocol declares
 * `RecordChatterProps.feed: RecordActivityProps.optional()` under BOTH names,
 * so those two are members of the shape an author may write here, and a
 * renderer that reads five of them and drops two has an IMPLEMENTATION GAP
 * rather than a narrower contract.
 *
 * ⛔ The opposite direction — narrowing the ObjectUI type so the declaration
 * stops over-promising — is refused by the maintainer's standing principle,
 * 原文照录: 我们的项目以 objectstack 协议为准,文档应该以实际实现为准。协议不
 * 正确的应该先修改协议。 The card's own first version pointed that way and
 * corrected itself; ⛔ a later edit must not re-derive it.
 *
 * ## The DECISION pinned here, and what would un-pin it
 *
 * `filterMode` and `showFilterToggle` are INDEPENDENT members: one names which
 * slice the feed shows, the other whether the control that changes it is on
 * screen. objectui#8968 left the coupling to the implementer, and this file
 * is where that choice became mechanical rather than remembered — the
 * `showFilterToggle: false` block below asserts the authored slice STILL
 * decides the rows while the dropdown is absent. An edit that makes
 * `filterMode` inert when the toggle is off turns that block red, which is the
 * whole point of pinning it: the reasoning lives in `../record-chatter`'s
 * docblock, and the failure lives here.
 *
 * ## What makes each leg a reading rather than a green over nothing
 *
 *   KEEP-LEG        every filter leg that removes a row is paired with a value
 *                   of the SAME member that keeps it, so "the row is gone" is
 *                   never satisfiable by a panel rendering nothing.
 *   TRIGGER-VALUE   the filter dropdown's own displayed label is asserted
 *                   alongside the rows, so the leg says the authored value
 *                   reached the timeline's CONTROLLED prop — not merely that
 *                   some row set shrank somewhere upstream of it.
 *   AGREEMENT       the same feed and the same authored `filterMode` are
 *                   rendered through `record:activity`, and the two paths must
 *                   produce the same rows. That names WHICH reading runs here:
 *                   a lookalike filter written by hand would disagree with it.
 *   UNDECLARED-KEY  a key the shape does not declare, authored in the same
 *                   position, moves neither member — so the panel is reacting
 *                   to the declared members rather than to the presence of a
 *                   `feed` object.
 *
 * ## `aria` is NOT pinned here, on purpose
 *
 * objectui#8968's table filed `aria` as NOT MEASURED. It was measured for this
 * branch and the answer put `aria` outside this path's remainder: it is unread
 * on `record:activity` too, so it is a `record:*` family gap and not a chatter
 * one, and closing it means first deciding how an authored label composes with
 * the accessible name the timeline already sets on its own section. The reading
 * and that argument are reported on the card. ⚠️ Nothing here re-derives it.
 *
 * ## Resolution
 *
 * Nothing resolves through any `dist/`: `../record-chatter`, `../record-activity`
 * and `../recordActivityFeed` are this package's own source, and
 * `@object-ui/react` is mapped to its `src` by the root `vitest.config.mts`
 * alias table.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityRenderer } from '../record-activity';
import '../../index';

/** Both registered names are the same renderer on the same `CHATTER_INPUTS`. */
const BLOCK_NAMES = ['record:chatter', 'record:discussion'] as const;

/** The composer placeholder in the `en` pack — where `@` autocomplete lives. */
const COMPOSER = /Leave a comment/;
/** The filter dropdown's accessible name — `showFilterToggle`'s observable. */
const FILTER_TRIGGER = 'Filter activity';
/** The `en` labels the dropdown shows for each declared filter mode. */
const MODE_LABEL = {
  all: 'All Activity',
  comments_only: 'Comments Only',
  changes_only: 'Field Changes',
  tasks_only: 'Tasks Only',
} as const;

/** One mentionable entity, supplied by the host the way app-shell does. */
const MENTION = { id: 'u1', label: 'Ada Lovelace' };

/**
 * One row of each kind the filter modes slice on, chronological. Timestamps
 * are fixed and well in the past so every row formats through
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

/**
 * The members this file is NOT about, all stated, so no leg below rides on a
 * default. `showCompleted` stays unstated: its spec default hides the `task`
 * row, which is what makes `tasks_only` a meaningful third mode to assert.
 */
const AFFORDANCES = {
  showFilterToggle: true,
  showCommentInput: true,
  enableReactions: false,
  enableThreading: false,
  showSubscriptionToggle: false,
} as const;

const handlers = {
  onAddComment: vi.fn(),
  onAddReply: vi.fn(),
  onToggleReaction: vi.fn(),
};

/**
 * The renderer the REGISTRY resolves for a block name — not the imported
 * symbol — so a registration that stopped pointing at this renderer fails here.
 */
function rendererFor(blockName: string): React.ComponentType<any> {
  const impl = ComponentRegistry.get(blockName) as React.ComponentType<any> | undefined;
  if (!impl) throw new Error(`no renderer registered for ${blockName}`);
  return impl;
}

/**
 * The element under test. Split out from `mountAs` so a case can RE-RENDER it:
 * every call builds a FRESH `schema` object, which is what makes the "an equal
 * authored value must not clobber the user's choice" leg below a real reading
 * rather than a test of object identity.
 */
function treeFor(
  blockName: string,
  feed: unknown,
  hostExtra: Record<string, unknown> = {},
): React.ReactElement {
  const Renderer = rendererFor(blockName);
  const schema: Record<string, unknown> = { position: 'bottom' };
  if (feed !== undefined) schema.feed = feed;
  return (
    <DiscussionContextProvider items={ITEMS as any} loading={false} {...handlers} {...(hostExtra as any)}>
      <Renderer schema={schema as any} />
    </DiscussionContextProvider>
  );
}

function mountAs(
  blockName: string,
  feed: unknown,
  hostExtra: Record<string, unknown> = {},
) {
  return render(treeFor(blockName, feed, hostExtra));
}

/** Which fixture rows the panel is currently rendering, in fixture order. */
function renderedIds(): string[] {
  return Object.keys(MARKERS).filter((id) => screen.queryAllByText(MARKERS[id]).length > 0);
}

/**
 * Open the filter dropdown and pick one option, driving the Radix Select the
 * way this repo's other suites do — `keyDown` to open, then the option. A leg
 * that only asserts the OPENING slice cannot tell a seed from a freeze, so this
 * is what makes the "the dropdown stays usable" half of the claim measurable
 * instead of merely stated.
 */
async function chooseFilter(optionLabel: string): Promise<void> {
  const trigger = screen.getByRole('combobox', { name: FILTER_TRIGGER });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('option', { name: optionLabel }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: FILTER_TRIGGER }).textContent)
      .toContain(optionLabel),
  );
}

/** Type `@` into the composer; the suggestion list appears only when fed one. */
function typeMentionTrigger(): void {
  fireEvent.change(screen.getByPlaceholderText(COMPOSER), { target: { value: '@' } });
}

beforeEach(() => {
  cleanup();
  handlers.onAddComment.mockClear();
  handlers.onAddReply.mockClear();
  handlers.onToggleReaction.mockClear();
});

describe.each(BLOCK_NAMES)('%s: `feed.filterMode` decides the slice the panel opens on (objectui#8968)', (blockName) => {
  it('`comments_only` keeps the comments and drops the field change', () => {
    mountAs(blockName, { ...AFFORDANCES, filterMode: 'comments_only' });
    expect(renderedIds()).toEqual(['c-1', 'c-2']);
    // TRIGGER-VALUE — the dropdown shows the authored mode, so the value
    // reached the timeline's controlled prop rather than some private filter.
    expect(screen.getByRole('combobox', { name: FILTER_TRIGGER }).textContent)
      .toContain(MODE_LABEL.comments_only);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, filterMode: 'all' });                    // KEEP-LEG
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
    expect(screen.getByRole('combobox', { name: FILTER_TRIGGER }).textContent)
      .toContain(MODE_LABEL.all);
  });

  it('`changes_only` keeps the field change and drops the comments', () => {
    mountAs(blockName, { ...AFFORDANCES, filterMode: 'changes_only' });
    expect(renderedIds()).toEqual(['f-1']);
    expect(screen.getByRole('combobox', { name: FILTER_TRIGGER }).textContent)
      .toContain(MODE_LABEL.changes_only);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, filterMode: 'all' });                    // KEEP-LEG
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
  });

  it('`tasks_only` reads the mode and the pipeline both — the task needs `showCompleted` too', () => {
    // Two declared members compose here rather than one overriding the other:
    // `showCompleted` (the pipeline, objectui#8934) decides whether the
    // completed task survives at all, `filterMode` (this card) then picks the
    // slice. Without `showCompleted` the tasks slice is legitimately empty.
    mountAs(blockName, { ...AFFORDANCES, filterMode: 'tasks_only' });
    expect(renderedIds()).toEqual([]);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, filterMode: 'tasks_only', showCompleted: true });
    expect(renderedIds()).toEqual(['t-1']);                                       // KEEP-LEG
  });

  it('an unrecognised `filterMode` opens on `all`, never on a slice nothing matches', () => {
    // objectui#3151's posture, reached here through the same
    // `normalizeFilterMode` `record:activity` uses: an unknown token is skipped
    // rather than turned into a predicate that can only ever be empty.
    mountAs(blockName, { ...AFFORDANCES, filterMode: 'not_a_mode' });
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
    expect(screen.getByRole('combobox', { name: FILTER_TRIGGER }).textContent)
      .toContain(MODE_LABEL.all);
  });

  it('with no `filterMode` authored the panel opens on `all`', () => {
    mountAs(blockName, { ...AFFORDANCES });
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
    expect(screen.getByRole('combobox', { name: FILTER_TRIGGER }).textContent)
      .toContain(MODE_LABEL.all);
  });
});

describe.each(BLOCK_NAMES)('%s: ⭐ the DECISION — `filterMode` with `showFilterToggle` off (objectui#8968)', (blockName) => {
  it('the authored slice still decides the rows while the dropdown is absent', () => {
    mountAs(blockName, { ...AFFORDANCES, showFilterToggle: false, filterMode: 'comments_only' });
    // The control is genuinely off …
    expect(screen.queryByRole('combobox', { name: FILTER_TRIGGER })).toBeNull();
    // … and the member the author wrote is still honoured.
    expect(renderedIds()).toEqual(['c-1', 'c-2']);
  });

  it('KEEP-LEG — the same toggle-off panel on `all` renders every row', () => {
    // Without this leg "the field change is gone" above is satisfiable by a
    // panel that renders nothing once its dropdown is removed.
    mountAs(blockName, { ...AFFORDANCES, showFilterToggle: false, filterMode: 'all' });
    expect(screen.queryByRole('combobox', { name: FILTER_TRIGGER })).toBeNull();
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);
  });

  it('the toggle is the only thing `showFilterToggle` moves — same rows either way', () => {
    // States the independence as an equality rather than as prose: for one
    // authored mode, turning the dropdown off changes the CONTROL and nothing
    // else. An edit that makes `filterMode` inert without its dropdown breaks
    // this equality, not merely a row count.
    mountAs(blockName, { ...AFFORDANCES, showFilterToggle: true, filterMode: 'changes_only' });
    const withToggle = renderedIds();

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, showFilterToggle: false, filterMode: 'changes_only' });
    expect(renderedIds()).toEqual(withToggle);
    expect(withToggle).toEqual(['f-1']);     // the comparison is not vacuous
  });
});

describe.each(BLOCK_NAMES)('%s: the authored value is a SEED, not a freeze (objectui#8968)', (blockName) => {
  // ⭐ Why this block exists, stated because it is the one thing the other
  // cases here CANNOT catch. Every leg above asserts the slice the panel OPENS
  // on, and all of them stay green against a renderer that hands the authored
  // value down as a constant — `filterMode={defaultFilterMode}` with no
  // `onFilterChange`. That renderer would FREEZE the dropdown: the timeline
  // resolves `controlledFilter ?? internalFilter`, so a controlled prop with no
  // setter pins the value and swallows every user choice. An assertion set that
  // cannot tell working from broken is the shape this card exists to remove, so
  // the "stays usable" half is driven here rather than asserted in prose.

  it('⭐ a later user choice moves the rows — the dropdown is live, not pinned', async () => {
    mountAs(blockName, { ...AFFORDANCES, filterMode: 'comments_only' });
    expect(renderedIds()).toEqual(['c-1', 'c-2']);

    await chooseFilter(MODE_LABEL.changes_only);

    // The rows follow the user, not the author. Against a frozen dropdown this
    // is still ['c-1', 'c-2'].
    expect(renderedIds()).toEqual(['f-1']);
  });

  it('an EQUAL authored value re-rendered as a fresh object does not clobber that choice', async () => {
    // The resync effect runs on `defaultFilterMode`. That is a normalized
    // PRIMITIVE, so a parent re-render carrying a new `feed` object with the
    // same authored value compares equal and the effect does not re-fire.
    // Without this leg, an effect keyed on the config OBJECT would look correct
    // here and would reset the user's choice on every parent render.
    const view = render(treeFor(blockName, { ...AFFORDANCES, filterMode: 'comments_only' }));
    await chooseFilter(MODE_LABEL.changes_only);
    expect(renderedIds()).toEqual(['f-1']);

    view.rerender(treeFor(blockName, { ...AFFORDANCES, filterMode: 'comments_only' }));
    expect(renderedIds()).toEqual(['f-1']);
    expect(screen.getByRole('combobox', { name: FILTER_TRIGGER }).textContent)
      .toContain(MODE_LABEL.changes_only);
  });

  it('a CHANGED authored value DOES re-seed — the effect earns its place', async () => {
    // The other half of the same wire, so "does not clobber" above can never be
    // satisfied by an effect that was simply deleted. Re-authoring the member
    // has to flow through.
    const view = render(treeFor(blockName, { ...AFFORDANCES, filterMode: 'comments_only' }));
    await chooseFilter(MODE_LABEL.changes_only);
    expect(renderedIds()).toEqual(['f-1']);

    view.rerender(treeFor(blockName, { ...AFFORDANCES, filterMode: 'tasks_only', showCompleted: true }));
    expect(renderedIds()).toEqual(['t-1']);
    expect(screen.getByRole('combobox', { name: FILTER_TRIGGER }).textContent)
      .toContain(MODE_LABEL.tasks_only);
  });
});

describe.each(BLOCK_NAMES)('%s: `feed.enableMentions` gates the composer suggestions (objectui#8968)', (blockName) => {
  it('unauthored means ON — the host suggestions reach the composer', () => {
    // The protocol's default is true, so an author who said nothing must keep
    // the affordance. `!== false` rather than truthiness is what makes this so.
    mountAs(blockName, { ...AFFORDANCES }, { mentionSuggestions: [MENTION] });
    typeMentionTrigger();
    expect(screen.getByText(MENTION.label)).toBeTruthy();
  });

  it('`false` withholds them, and the composer itself stays', () => {
    mountAs(blockName, { ...AFFORDANCES, enableMentions: false }, { mentionSuggestions: [MENTION] });
    typeMentionTrigger();
    expect(screen.queryByText(MENTION.label)).toBeNull();
    // CONTROL — "no suggestion" is not "no composer", and not "no panel".
    expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();
    expect(renderedIds()).toEqual(['c-1', 'f-1', 'c-2']);

    cleanup();
    mountAs(blockName, { ...AFFORDANCES, enableMentions: true }, { mentionSuggestions: [MENTION] });
    typeMentionTrigger();
    expect(screen.getByText(MENTION.label)).toBeTruthy();                         // KEEP-LEG
  });
});

describe('the controls that make the legs above readings (objectui#8968)', () => {
  it.each(BLOCK_NAMES)('%s: AGREEMENT — the same authored mode renders the same rows on `record:activity`', (blockName) => {
    const mode = 'comments_only';

    mountAs(blockName, { ...AFFORDANCES, filterMode: mode });
    const chatterRows = renderedIds();

    cleanup();
    // `record:activity` reads the member off the node root; the chatter path
    // reads it off `feed`. Same declared member, one implementation of it.
    render(<RecordActivityRenderer schema={{ ...AFFORDANCES, items: ITEMS, filterMode: mode } as any} />);
    const activityRows = renderedIds();

    expect(activityRows).toEqual(['c-1', 'c-2']);   // the comparison is not vacuous
    expect(chatterRows).toEqual(activityRows);
  });

  it.each(BLOCK_NAMES)('%s: UNDECLARED-KEY — a key the shape does not declare moves neither member', (blockName) => {
    // Without this leg every case above is satisfiable by a panel that reacts
    // to the mere presence of an authored `feed` object.
    mountAs(blockName, { ...AFFORDANCES }, { mentionSuggestions: [MENTION] });
    const baseline = renderedIds();
    typeMentionTrigger();
    expect(screen.getByText(MENTION.label)).toBeTruthy();

    cleanup();
    mountAs(
      blockName,
      { ...AFFORDANCES, notADeclaredMember: 'comments_only', alsoNotDeclared: false },
      { mentionSuggestions: [MENTION] },
    );
    expect(renderedIds()).toEqual(baseline);
    typeMentionTrigger();
    expect(screen.getByText(MENTION.label)).toBeTruthy();
  });

  it('CONTROL — with no host suggestions at all, `enableMentions: true` still offers none', () => {
    // Names where the suggestions come from: the member GATES the host's list,
    // it does not manufacture one. Otherwise the ON legs above would be
    // satisfiable by a composer that invents entries.
    mountAs('record:chatter', { ...AFFORDANCES, enableMentions: true });
    typeMentionTrigger();
    expect(screen.queryByText(MENTION.label)).toBeNull();
    expect(screen.getByPlaceholderText(COMPOSER)).toBeTruthy();
  });
});
