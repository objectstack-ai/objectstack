/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `record:chatter` / `record:discussion` — Salesforce-style social feed for
 * the current record. The renderer is a thin wrapper around
 * `RecordChatterPanel`; it pulls feed items + mutation handlers from the
 * surrounding `DiscussionContext` (mounted by `RecordDetailView` or any
 * other host shell that owns the feed). When no DiscussionContext is
 * present the panel renders an empty feed so the page still composes
 * correctly in standalone previews.
 *
 * ## `feed` is the full `record:activity` shape, and it is applied HERE
 *
 * `@objectstack/spec` declares `RecordChatterProps.feed:
 * RecordActivityProps.optional()` (`ui/component.zod.ts`, the member commented
 * `Feed configuration (delegates to RecordActivityProps)`), bound to BOTH names
 * — `ComponentPropsMap` wires `'record:chatter'` and `'record:discussion'` to
 * that one `RecordChatterProps` row, and the pair-identity pin in
 * `component-record-blocks.test.ts` holds them together. And
 * `RecordActivityProps` carries the filter members `types` / `limit` /
 * `showCompleted` / `unifiedTimeline`. This renderer used to hand
 * `discussion.items` to the panel raw, so those four were accepted by the spec,
 * declared in the registration, and then discarded in silence — an
 * IMPLEMENTATION GAP, not a narrower contract (objectui#8934).
 *
 * The pipeline below is `record-activity.tsx`'s, not a second convention: the
 * same `applyFeedConfig(sourceItems, { types, showCompleted, unifiedTimeline },
 * pageSize, block)` call (only the block name differs), and the same reading of `limit` as a PAGE SIZE that
 * "Load more" grows by, rather than a hard cap.
 *
 * ⚠️ Consequences an author sees, because the spec's DEFAULTS now apply here
 * too: `showCompleted` defaults false, so completed activities (feed type
 * `task`) are hidden unless asked for, a logged call, meeting or email
 * excepted (objectui#12228, `isLoggedInteraction` in `recordActivityFeed.ts`);
 * and an unauthored `limit` is
 * `DEFAULT_ACTIVITY_LIMIT` (20), so a longer feed pages instead of rendering
 * whole. Both are `record:activity`'s behaviour, which is what the protocol
 * says this key is.
 *
 * ## `filterMode` and `enableMentions` — the remainder, closed here (objectui#8968)
 *
 * `applyFeedConfig` is the filter PIPELINE, so it reaches the four members it
 * takes and no others. Two more members of the same declared shape sit outside
 * it, and both were still unread on this path after objectui#8934:
 *
 *   `filterMode`      `RecordActivityTimeline` takes it as a component PROP
 *                     (destructured `filterMode: controlledFilter`, resolved as
 *                     `controlledFilter ?? internalFilter`), never off `config`
 *                     — and this renderer passed none, so an authored
 *                     `feed.filterMode` reached nothing under either name.
 *                     `RecordChatterPanel` already declares and forwards the
 *                     prop; the chatter renderer was the missing end.
 *   `enableMentions`  the composer's @-autocomplete is fed by
 *                     `mentionSuggestions`, which this renderer passed on
 *                     UNCONDITIONALLY — so the affordance existed here and the
 *                     member the protocol says gates it did not. Off now
 *                     withholds the suggestions, which is the behaviour the
 *                     `record:activity` registration publishes for this key.
 *
 * Both are wired with `record:activity`'s own reading rather than a local one,
 * for the reason objectui#8934 gives: one declared shape, one implementation of
 * it, not two copies kept in agreement by hand.
 *
 * ### ⭐ The DECISION this card left to the implementer — `filterMode` on a
 * panel whose dropdown is gated off by `showFilterToggle`
 *
 * `filterMode` and `showFilterToggle` are INDEPENDENT. One names WHICH SLICE
 * the feed shows; the other names WHETHER THE CONTROL that changes it is on
 * screen. With the toggle off an authored `filterMode` is therefore not inert —
 * it stops being the slice the user OPENS on and becomes the slice the author
 * PINNED. Three reasons that is the reading, rather than "no dropdown, no
 * meaning":
 *
 *   1. the protocol's own wording splits them exactly that way — `filterMode`
 *      is described as the "Default activity filter" and `showFilterToggle` as
 *      "Show filter dropdown in panel header". Neither member's description
 *      mentions the other, so neither is declared to gate the other.
 *   2. `RecordActivityTimeline` already resolves `activeFilter` before, and
 *      independently of, its `showFilter` flag, and the item filter runs on
 *      `activeFilter` whether or not the dropdown renders. Coupling the two
 *      HERE would put a second convention on one declared shape — the defect
 *      class objectui#8934 closed, re-opened one key along.
 *   3. the alternative silently discards a value the author wrote and the spec
 *      accepts, which is the exact shape this card exists to remove.
 *
 * Pinned by `__tests__/recordChatterFilterModeMentions-8968.test.tsx`, both
 * legs: the pinned slice renders, and the dropdown does not.
 *
 * ⚠️ `aria` — the third row of objectui#8968's table, which the card filed as
 * NOT MEASURED — was measured on that card and left out of this path's
 * remainder, as a gap over the whole `record:*` block family. Both halves are
 * read now, and neither is read in this file's pipeline:
 *
 *   `aria`        the block's own bag, read below through `useRecordAriaProps`
 *                 onto this renderer's container (objectui#9556);
 *   `feed.aria`   the feed's bag, read by `RecordChatterPanel` through the same
 *                 hook onto a `div` around the embedded timeline, the way
 *                 `record-activity.tsx` puts its own bag on the `div` around
 *                 its timeline (objectui#11083). The timeline's own name, its
 *                 heading, is untouched; an authored feed name names the region
 *                 around it.
 *
 * Pinned by `__tests__/recordChatterFeedAria-11083.test.tsx`.
 */

import React from 'react';
import { useRecordContext, useDiscussionContext } from '@object-ui/react';
import type { FeedItem, RecordActivityComponentProps, RecordChatterComponentProps } from '@object-ui/types';
import { RecordChatterPanel } from '../RecordChatterPanel';
import type { FeedFilterMode } from '../RecordActivityTimeline';
import { applyFeedConfig, describeRefusedFeedLimit, normalizeFilterMode, normalizeLimit } from './recordActivityFeed';
import { useRecordAriaProps } from './recordComponentAria';

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

export interface RecordChatterRendererProps {
  schema?: RecordChatterComponentProps & Record<string, any>;
  className?: string;
  [k: string]: any;
}

export const RecordChatterRenderer: React.FC<RecordChatterRendererProps> = ({
  schema = {} as any,
  className,
  ...props
}) => {
  useRecordContext();
  const discussion = useDiscussionContext();
  const { designer } = splitDesigner(props);
  /**
   * The block's authored `aria` bag, honoured through the family's ONE read
   * point (objectui#9556). Called here, with the other hooks, because every
   * renderer below it has early returns.
   *
   * ⛔ No `defaultRole`: with nothing authored this container stays the bare
   * `div` it has always been, so a page that never wrote `aria` renders
   * byte-identical DOM. An author who does write one gets a `region` to carry
   * it — see `recordComponentAria.ts` for why the attribute alone would reach
   * nobody.
   */
  const ariaProps = useRecordAriaProps(schema.aria);

  // Merge schema-supplied config (position, feed sub-config) with the three
  // AFFORDANCE defaults a host fallback wants when no author supplied any.
  //
  // ⭐ These defaults are the WHOLE of what the host's auto-appended discussion
  // is, because since objectui#8983 that fallback mounts THIS renderer with no
  // schema (`@object-ui/app-shell` `RecordDetailView.tsx`, the
  // `showAutoDiscussion` branch) instead of reaching past it to
  // `RecordChatterPanel` with raw rows. So the two chatter surfaces on a record
  // page render the same feed again, and they do it by running one pipeline
  // rather than by keeping two copies of it in agreement.
  //
  // ⚠️ The history is worth keeping because it is the failure this file is one
  // half of. This comment once said an author-placed `record:discussion` "looks
  // identical to the fallback the host injects when no component is present".
  // objectui#8934 made that false by adding `applyFeedConfig` here only:
  // measured on the same feed, three comments plus one `task` row rendered four
  // rows through the fallback and three here, and twenty-five comments rendered
  // twenty-five there and twenty plus a "Load more" here. objectui#8983 closed
  // it at the BINDING, not by teaching the fallback its own copy of the filter
  // logic. ⛔ A future edit that gives the fallback its own items/config path
  // re-opens the divergence — `RecordDetailView.discussionFallbackPipeline-8983`
  // in `@object-ui/app-shell` is the pin that turns red when it does.
  const config = {
    position: 'bottom',
    collapsible: false,
    feed: {
      enableReactions: true,
      enableThreading: true,
      showCommentInput: true,
    },
    ...(schema as any),
  } as any;

  // The nested `feed` IS `RecordActivityProps` (the spec member commented
  // `Feed configuration (delegates to RecordActivityProps)`), so its filter
  // members are applied on this path with the same pipeline and the same
  // `applyFeedConfig` call shape `record:activity` uses.
  const feed = config.feed as RecordActivityComponentProps | undefined;

  // Page window. Starts at `limit` and grows by `limit` per "Load more", so the
  // authored `limit` is a page size (the spec's wording) rather than a hard cap
  // — the same reading, and the same `extraPages`-is-the-state shape, as
  // `record-activity.tsx` (where the comment reads "The extra PAGES are the
  // state, not the resulting size").
  const [extraPages, setExtraPages] = React.useState(0);
  const limit = normalizeLimit(feed?.limit);
  // The block this renderer is mounted as — `record:chatter` or
  // `record:discussion`, both registered to this one component — so every
  // author diagnostic below is addressed to the block that was authored.
  // `record:chatter` only when no `type` arrived at all: the host's
  // auto-appended discussion mounts this renderer with no schema, and then the
  // `feed` is the three affordance defaults above, which no diagnostic reads.
  const blockName = typeof schema.type === 'string' && schema.type ? schema.type : 'record:chatter';
  // [objectui#10145] Same refusal, same channel as `record:activity`, named for
  // the block that was authored (`record:chatter` or `record:discussion`).
  const refusedLimitMessage = describeRefusedFeedLimit(`${blockName} feed`, feed?.limit);
  React.useEffect(() => {
    if (refusedLimitMessage) console.warn(refusedLimitMessage);
  }, [refusedLimitMessage]);
  const pageSize = limit * (extraPages + 1);

  // `filterMode` — the authored slice, normalized by the SAME function
  // `record:activity` uses, so an unrecognised value falls back to `all` rather
  // than freezing the dropdown blank on a value with no matching item.
  // Its diagnostic (and the `types` ones `applyFeedConfig` raises) is prefixed
  // with `blockName` and deduped per (block, value), so a bad `filterMode`
  // authored on both a `record:activity` and a `record:chatter` block on one
  // page warns once under EACH name (objectui#9557; it used to warn once, under
  // the activity name only).
  //
  // It seeds STATE rather than being handed to the panel directly: the timeline
  // treats `filterMode` as a CONTROLLED prop, so passing the authored value
  // straight through would pin the dropdown open on it and swallow every user
  // choice. Same shape as `record:activity`, deliberately — one reading of one
  // declared member.
  //
  // ⛔ Do not "simplify" these three lines into `filterMode={defaultFilterMode}`:
  // that is the freeze, and it is invisible to any assertion that only reads the
  // slice the panel OPENS on. The seed-not-freeze block in
  // `__tests__/recordChatterFilterModeMentions-8968.test.tsx` drives the dropdown
  // after mount and turns red when it is done.
  //
  // ⭐ Independent of `showFilterToggle` on purpose; the docblock above carries
  // the decision and its three reasons.
  const defaultFilterMode = normalizeFilterMode(feed?.filterMode, blockName);
  const [filterMode, setFilterMode] = React.useState<FeedFilterMode>(defaultFilterMode);
  React.useEffect(() => { setFilterMode(defaultFilterMode); }, [defaultFilterMode]);

  const discussionItems = discussion?.items as FeedItem[] | undefined;
  const applied = React.useMemo(
    () =>
      applyFeedConfig(
        discussionItems ?? [],
        {
          types: feed?.types,
          showCompleted: feed?.showCompleted,
          unifiedTimeline: feed?.unifiedTimeline,
        },
        pageSize,
        blockName,
      ),
    [discussionItems, feed?.types, feed?.showCompleted, feed?.unifiedTimeline, pageSize, blockName],
  );

  // `record-activity.tsx` writes its own `handleLoadMore` with an empty
  // dependency list. The setter is named here instead — it is stable, so the
  // two are equivalent at runtime — because with `[]` the React Compiler cannot preserve the manual
  // memoization (it infers `setExtraPages`) and reports `Compilation Skipped`
  // on this component. One deviation, in a dependency array, to keep this
  // component compiled; the pipeline call shape below is copied unchanged.
  const handleLoadMore = React.useCallback(() => {
    setExtraPages((n) => n + 1);
  }, [setExtraPages]);

  // `enableMentions` — withholding the suggestion list is what turns the
  // composer's @-autocomplete off, which is what the registration publishes for
  // this key ("Off withholds the suggestions"). `!== false` rather than a
  // truthiness test, because the protocol's default is ON and an unauthored
  // member must not read as "off".
  const mentionsEnabled = feed?.enableMentions !== false;

  return (
    <div className={className} {...designer} {...ariaProps}>
      <RecordChatterPanel
        items={applied.items}
        config={config}
        // "Load more" grows the window by `limit`. Without this pair an
        // authored `limit` would be a silent truncation of the feed instead of
        // the page size the spec says it is.
        hasMore={applied.hasMore}
        onLoadMore={handleLoadMore}
        // The host that owns the fetch produces this (app-shell
        // `RecordDetailView`); without it a hand-placed `record:chatter` /
        // `record:discussion` spends the whole fetch claiming the record has
        // no comments (objectui#3209 — #3205 added the render branch, this
        // is the signal that reaches it). `record:activity` reads the same
        // field off the same context; no second idiom.
        loading={discussion?.loading}
        // The two members `applyFeedConfig` does not reach (objectui#8968).
        // `RecordChatterPanel` already forwards both to the timeline, so the
        // renderer was the only missing end of the wire.
        filterMode={filterMode}
        onFilterChange={setFilterMode}
        onAddComment={discussion?.onAddComment as any}
        onAddReply={discussion?.onAddReply as any}
        onToggleReaction={discussion?.onToggleReaction as any}
        // objectui#12268: same two handlers `record:activity` forwards, off the
        // same context; the host decides who may be offered them.
        onEditComment={discussion?.onEditComment}
        onDeleteComment={discussion?.onDeleteComment}
        mentionSuggestions={mentionsEnabled ? (discussion?.mentionSuggestions as any) : undefined}
        onUploadAttachments={discussion?.onUploadAttachments as any}
        // objectui#11195: which of the host's two feed reads the server
        // REFUSED. The host that owns the fetch decides it, the same way it
        // decides `loading` above; the panel only renders it.
        activityDenied={discussion?.activityDenied}
        commentsDenied={discussion?.commentsDenied}
      />
    </div>
  );
};

export default RecordChatterRenderer;
