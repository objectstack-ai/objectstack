/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { ComponentRegistry, elementDataSourceBlock, type ComponentInput } from '@object-ui/core';
import {
  ElementDataSourceGate,
  noDataSourceMessage,
  useResolvedDataSource,
} from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { DetailView } from './DetailView';
import { DetailSection } from './DetailSection';
import { DetailSectionNode } from './DetailSectionNode';
import { headerColorVocabulary } from './headerColor';
import { DetailTabs } from './DetailTabs';
import { RelatedList } from './RelatedList';
import { RecordDetailsRenderer } from './renderers/record-details';
import { RecordRelatedListRenderer } from './renderers/record-related-list';
import { RecordHighlightsRenderer } from './renderers/record-highlights';
import { RecordActivityRenderer } from './renderers/record-activity';
import { RecordChatterRenderer } from './renderers/record-chatter';
import { RecordPathRenderer } from './renderers/record-path';
import { RecordQuickActionsRenderer } from './renderers/record-quick-actions';
import { RecordHistoryRenderer } from './renderers/record-history';
import { RecordReferenceRailRenderer } from './renderers/record-reference-rail';
import { RecordAlertRenderer } from './renderers/record-alert';
import type { DataSource, DetailViewSchema } from '@object-ui/types';
import { ACTION_LOCATIONS } from '@object-ui/types';

export { DetailView, DetailSection, DetailTabs, RelatedList };
export {
  RecordDetailsRenderer,
  RecordRelatedListRenderer,
  RecordHighlightsRenderer,
  RecordActivityRenderer,
  RecordChatterRenderer,
  RecordPathRenderer,
  RecordQuickActionsRenderer,
  RecordHistoryRenderer,
  RecordReferenceRailRenderer,
  RecordAlertRenderer,
};
/**
 * The `sys_activity.type` -> `FeedItem.type` reading, made importable
 * (objectui#5878).
 *
 * It was already exported from `renderers/recordActivityFeed`, but not from
 * this barrel — so `app-shell`'s `RecordDetailView`, which merges the SAME
 * `sys_activity` rows into the console record page's feed, carried a
 * hand-written copy of the table instead. Nothing failed when the two
 * disagreed, and objectui#5840 made them disagree: `scheduled` -> `event`
 * landed here and not there, so one row rendered on a hand-authored record
 * page and vanished on the console one.
 *
 * Publishing it is what lets there be ONE reading. Adding a member is now a
 * single edit at `ACTIVITY_TYPE_TO_FEED_TYPE`; re-forking it is caught by
 * `RecordDetailView.activityMapIdentity-5878.test.tsx`, which spies on THIS
 * object rather than comparing values (a member-identical private copy passes
 * a value check, which is the whole failure mode being closed).
 *
 * No new module enters the eager closure: `renderers/record-activity`, already
 * imported above, pulls `recordActivityFeed` in.
 *
 * ## The CONSTRUCTOR joins the table here (objectui#5896)
 *
 * Publishing the table alone left the mirror one level up: `RecordDetailView`
 * read this object and then built the `FeedItem` around it with its own inline
 * loop, and the two constructions had already drifted three ways — the console
 * copy dropped an unmapped type SILENTLY where {@link activityRowToFeedItem}
 * renders it through {@link UNMAPPED_ACTIVITY_FEED_TYPE} and says so once
 * (objectstack `88b9d749a`, direction 4, ruled 2026-08-24), and its timestamp
 * fallback could leave `createdAt` `undefined` where the helper yields `''`.
 *
 * So the exported surface is the whole reading — table, fallback, and the
 * constructor that applies both — not the lookup table on its own. A consumer
 * that needs a `FeedItem` from a `sys_activity` row calls
 * `activityRowToFeedItem`; there is no supported way to assemble one from the
 * table by hand, because that is precisely what drifted.
 *
 * `resetUnknownActivityTypeWarnings` comes with it: the warn-once bucket is
 * module state, so any surface that ASSERTS the diagnostic needs the same test
 * seam the block's own tests use.
 */
export {
  ACTIVITY_TYPE_TO_FEED_TYPE,
  UNMAPPED_ACTIVITY_FEED_TYPE,
  activityRowToFeedItem,
  resetUnknownActivityTypeWarnings,
  // objectui#11195: the refused-read verdict joins the reading for the same
  // reason. `RecordDetailView` reads the same two tables, and a refusal it
  // judged differently would show "no permission" on one surface and "no
  // activity" on the other.
  isRefusedFeedRead,
} from './renderers/recordActivityFeed';
export type { SysActivityRow } from './renderers/recordActivityFeed';

export { RecordDetailDrawer, deriveRecordPageHref } from './RecordDetailDrawer';
export type { RecordDetailDrawerProps } from './RecordDetailDrawer';
/**
 * The record overlay PAYLOAD, with no shell of its own (objectui#9299).
 *
 * `ObjectGrid`, `ObjectTree`, `ObjectGantt`, `ObjectKanban` and
 * `ObjectCalendar` mount this through `NavigationOverlay` so the authored
 * `navigation.mode` is honoured on every view type. `RecordDetailDrawer` is
 * the same payload in the drawer shell.
 */
export {
  RecordDetailPanel,
  buildRecordDetailFields,
  DEFAULT_SYSTEM_FIELDS,
  RECORD_OVERLAY_DEFAULT_WIDTH,
} from './RecordDetailPanel';
export type { RecordDetailPanelProps } from './RecordDetailPanel';
export {
  ConcurrentUpdateDialog,
  isConcurrentUpdateError,
} from './ConcurrentUpdateDialog';
export type {
  ConcurrentUpdateConflict,
  ConcurrentUpdateDialogProps,
} from './ConcurrentUpdateDialog';
// `__clearRecordEditableCache` is test-only and stays off the barrel
// (objectui#13453); tests import it from `useRecordEditable` directly.
export { useRecordEditable } from './useRecordEditable';
export type { RecordOperation } from './useRecordEditable';
export { SectionGroup } from './SectionGroup';
export { HeaderHighlight } from './HeaderHighlight';
export { InlineFieldInput, extractLookupId, TEXTUAL_REF_FALLBACK_TYPES } from './InlineFieldInput';
export type { InlineFieldInputProps } from './InlineFieldInput';
export { InlineEditSaveBar } from './InlineEditSaveBar';
export type { InlineEditSaveBarProps } from './InlineEditSaveBar';
export { inferDetailColumns, isWideFieldType, applyAutoSpan, applyDetailAutoLayout } from './autoLayout';
export { useDetailTranslation, DETAIL_DEFAULT_TRANSLATIONS, createSafeTranslationHook } from './useDetailTranslation';
export { RecordComments } from './RecordComments';
export { ActivityTimeline } from './ActivityTimeline';
export { HistoryTimeline } from './HistoryTimeline';
export { RichTextCommentInput } from './RichTextCommentInput';
export { CommentAttachment } from './CommentAttachment';
export { RecordActivityTimeline } from './RecordActivityTimeline';
export { RecordChatterPanel } from './RecordChatterPanel';
export { FieldChangeItem } from './FieldChangeItem';
export { SubscriptionToggle } from './SubscriptionToggle';
export { ReactionPicker } from './ReactionPicker';
export { ThreadedReplies } from './ThreadedReplies';
export { RecordMetaFooter } from './RecordMetaFooter';
export type { RecordMetaFooterProps } from './RecordMetaFooter';
export type { DetailViewProps } from './DetailView';
export type { DetailSectionProps, VirtualScrollOptions } from './DetailSection';
export type { DetailTabsProps } from './DetailTabs';
export type { RelatedListProps } from './RelatedList';
export type { SectionGroupProps } from './SectionGroup';
export type { HeaderHighlightProps } from './HeaderHighlight';
export type { RecordCommentsProps } from './RecordComments';
export type { ActivityTimelineProps, ActivityFilterType } from './ActivityTimeline';
export type { HistoryTimelineProps, HistoryEntry } from './HistoryTimeline';
export type { RichTextCommentInputProps, MentionSuggestion } from './RichTextCommentInput';
export { extractMentions } from './extractMentions';
export type { MentionTarget } from './extractMentions';
export type { CommentAttachmentProps, Attachment } from './CommentAttachment';
export type { RecordActivityTimelineProps, FeedFilterMode } from './RecordActivityTimeline';
export type { RecordChatterPanelProps } from './RecordChatterPanel';
export type { FieldChangeItemProps } from './FieldChangeItem';
export type { SubscriptionToggleProps } from './SubscriptionToggle';
export type { ReactionPickerProps } from './ReactionPicker';
export type { ThreadedRepliesProps } from './ThreadedReplies';

// Track 3 (convergence): pure-function synthesizers for the default
// detail page. Phase G slice 1 — not yet wired into RecordDetailView.
export {
  buildDefaultPageSchema,
  buildDefaultHeader,
  buildDefaultActions,
  buildDefaultHighlights,
  buildDefaultDetails,
  buildDefaultTabs,
  buildDefaultDiscussion,
  detectStatusField,
  deriveStages,
  deriveHighlightFields,
  deriveFieldGroupDetailSections,
  resolveDetailSections,
  resolveTitleField,
} from './synth/buildDefaultPageSchema';
export type {
  ObjectDefLike,
  ObjectDefFieldLike,
  BuildPageOptions,
} from './synth/buildDefaultPageSchema';

/**
 * The registry face of `detail-view` — objectui#5378 item 1.
 *
 * ## What was wrong
 *
 * `detail-view` was registered as the RAW `DetailView` component, which reads
 * its adapter from its own React `dataSource` PROP. Its two siblings in the
 * family are registered through wrappers that read the adapter from
 * `SchemaRendererContext` (`ObjectGridRenderer`, `ObjectFormRenderer`), and
 * `SchemaRenderer` itself reads only context — an explicit `dataSource` PROP
 * arrives through `...props` and never becomes context for anything below.
 *
 * So the two wirings were mutually exclusive, and a page could satisfy only one
 * of them. Measured on the published getting-started guide's own snippets,
 * keys held correct in every cell:
 *
 * | wiring                                    | `object-grid` | `detail-view` |
 * |-------------------------------------------|---------------|---------------|
 * | `SchemaRendererProvider dataSource={…}`    | `find` 1      | `findOne` 0   |
 * | `SchemaRenderer dataSource={…}` (prop)     | `find` 0      | `findOne` 1   |
 *
 * Neither cell reported anything: one half of the page fetched, the other half
 * rendered an empty shell in silence. The registry gave the author no signal
 * about which wiring they were holding.
 *
 * ## What this is
 *
 * The same context-reading wrapper the siblings have, so every block in the
 * family resolves the adapter the same way — maintainer ruling of 2026-08-20 on
 * objectui#5378, item 1 (「其他接受你的建议。」), which also settled the
 * compatibility question: this is ADDITIVE. The `dataSource`-PROP form stays
 * accepted, and no prop is removed this pass.
 *
 * ## Precedence, when both are present
 *
 * The explicit prop WINS. It is the more specific signal — written on this one
 * placement, by someone who can see it — while the context adapter is ambient
 * and applies to every descendant of the provider. That is also the only
 * precedence under which the ruling's \"stays accepted\" is true of the case that
 * matters: a prop-form caller mounted somewhere inside an app that has a
 * provider would otherwise have had its explicit choice silently overruled by
 * an ancestor it never wrote.
 *
 * Measured caller population behind that judgement (objectui#5378's stated
 * confidence gap): in this repo, every `dataSource`-prop consumer of
 * `DetailView` — `renderers/record-details.tsx`, `RecordDetailDrawer.tsx`, and
 * the published README's documented usage — renders the COMPONENT directly and
 * never passes through the registry, so this wrapper does not sit between any
 * of them and `DetailView`. Registry-routed `detail-view` nodes carrying a
 * `dataSource` prop: zero, the getting-started guide being the one that tried.
 * The additive shape therefore changes no measured caller's behaviour, and the
 * precedence above is pinned by test rather than left to be discovered.
 */
export const DetailViewRenderer: React.FC<{
  schema: any;
  dataSource?: unknown;
  [key: string]: any;
}> = elementDataSourceBlock(({ schema, dataSource: dataSourceProp, ...props }) => {
  // The family's ONE resolution rule (`@object-ui/react`): explicit adapter
  // first, `SchemaRendererProvider` context second, and the spec BINDING never
  // mistaken for an adapter. Sharing the hook is what keeps the three blocks
  // from drifting back apart — the drift IS the defect this card closes.
  const dataSource = useResolvedDataSource<DataSource>(dataSourceProp);
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ElementDataSourceGate
      schema={schema}
      // `object` → `objectName` is the whole mapping: a detail view shows ONE
      // record, so it has no collection query for the binding's `filter` /
      // `sort` / `limit` to narrow and no field projection for its `columns`.
      // Mapping them anywhere would write keys this block does not read, which
      // is the defect the gate exists to remove.
      dataSource={dataSource}
      testId="detail-view"
      errorTitle={t('element.detailView.sourceUnresolved', {
        defaultValue: 'This detail view’s data source could not be resolved',
      })}
      // `DetailView` returns early on inline `schema.data` and fetches over
      // `schema.api` without an adapter; either one is a legitimate placement
      // with nothing to resolve. Everything else reaches the branch that needs
      // `dataSource && objectName && resourceId` and, without it, renders
      // nothing at all — the silence objectui#5378 item 2 ends.
      requiresDataSource={
        schema?.data == null
        && schema?.api == null
        && typeof schema?.objectName === 'string'
        && schema.objectName.length > 0
      }
      noDataSourceMessage={noDataSourceMessage('detail-view', schema?.objectName)}
    >
      {(bound) => <DetailView schema={bound as DetailViewSchema} dataSource={dataSource} {...props} />}
    </ElementDataSourceGate>
  );
});

// Register detail-view through the wrapper above, NOT the raw component: the
// registry entry is what a `SchemaRenderer` reaches, and the wrapper is what
// makes context wiring work there. `DetailView` stays exported unchanged for
// the direct React callers (`record-details`, `RecordDetailDrawer`, the README).
ComponentRegistry.register('detail-view', DetailViewRenderer, {
  namespace: 'plugin-detail',
  label: 'Detail View',
  category: 'Views',
  icon: 'FileText',
  inputs: [
    { name: 'title', type: 'string' },
    { name: 'objectName', type: 'string' },
    { name: 'resourceId', type: 'string' },
    { name: 'api', type: 'string' },
    { name: 'data', type: 'object' },
    { name: 'layout', type: 'enum', enum: ['vertical', 'horizontal', 'grid'] },
    { name: 'columns', type: 'number' },
    { name: 'sections', type: 'array' },
    { name: 'fields', type: 'array' },
    { name: 'tabs', type: 'array' },
    { name: 'actions', type: 'array' },
    { name: 'showBack', type: 'boolean' },
    { name: 'backUrl', type: 'string' },
    { name: 'showEdit', type: 'boolean' },
    { name: 'editUrl', type: 'string' },
    { name: 'showDelete', type: 'boolean' },
    { name: 'deleteConfirmation', type: 'string' },
    { name: 'loading', type: 'boolean' },
    { name: 'header', type: 'object' },
    { name: 'footer', type: 'object' },
  ],
  defaultProps: {
    title: 'Detail View',
    showBack: true,
    showEdit: false,
    showDelete: false,
    sections: [],
    fields: [],
    tabs: [],
  }
});

// Register DetailSection component.
//
// ⚠️ Against `DetailSectionNode`, NOT `DetailSection` — and that is what makes
// the `inputs` below true (objectui#8626). `SchemaRenderer` spreads a node's
// non-metadata keys as React props, so an authored node arrives as `title` /
// `fields` / … while `DetailSection` reads a single `section` OBJECT prop. Bound
// directly, `section` arrived `undefined` and the very first
// `section.defaultCollapsed` read THREW — measured end to end, the author's page
// showed `SchemaErrorBoundary`'s orange "failed to render" banner in place of the
// block. `DetailSectionNode` folds the declared inputs into the `section`
// object the component reads; see that file for why the fold sits at this seam
// rather than in `DetailSection` (which every in-repo caller uses directly), and
// why re-declaring these as a nested `section` input was the repair NOT
// taken.
ComponentRegistry.register('detail-section', DetailSectionNode, {
  namespace: 'plugin-detail',
  label: 'Detail Section',
  category: 'Detail Components',
  inputs: [
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    {
      name: 'icon',
      type: 'string',
      description: 'Section header icon, drawn before the title: a Lucide icon name such as `map-pin`.',
    },
    { name: 'fields', type: 'array', required: true },
    { name: 'collapsible', type: 'boolean' },
    { name: 'defaultCollapsed', type: 'boolean' },
    { name: 'columns', type: 'number' },
    { name: 'showBorder', type: 'boolean' },
    {
      name: 'headerColor',
      /**
       * A CLOSED six-token vocabulary, not free text (objectui#6955).
       *
       * The values are `Object.keys(headerColorVocabulary)` rather than a
       * fourth hand-written copy of the six. `./headerColor` is the renderer's
       * resolver map, and `headerColor.contractPin-6594.test.ts` already pins
       * it one-to-one against `DetailViewSection.headerColor` and its
       * `@object-ui/types/zod` mirror in BOTH directions — so this surface
       * inherits that pin instead of adding a copy that can drift out of it.
       *
       * ONE arm, and deliberately no `'string'` beside it. `['enum','string']`
       * would clear every value again (any arm accepting a value clears the
       * prop) and hand the authoring surface its free-text box back — and in
       * doing so it would DECLARE the resolver's verbatim `bg-*` pass-through,
       * which maintainer ruling A (2026-08-26, objectstack#12126) refused to
       * declare because whether such a class renders depends on the host app's
       * Tailwind build. The pass-through stays an UNDECLARED affordance:
       * `headerColorClass` still hands a `bg-*` value through untouched, and
       * this input still refuses it. Pinned as that asymmetry in
       * `detailSectionHeaderColorEnum-6955.test.ts`.
       */
      type: 'enum',
      enum: Object.keys(headerColorVocabulary),
      description:
        'Header tint, from the design system\'s closed palette: one of `muted`, `muted/50`, `accent`, `primary/10`, `secondary/10`, `destructive/10`. Any other value is refused — `@object-ui/types` parses this key as that same six-member enum (objectui#6594), matching @objectstack/spec\'s strict `record:details` section schema. Omit the key for no tint.',
    },
    {
      /**
       * objectui#10485 — declared because `DetailSection` already honours it
       * (`section.hideEmpty === true`), the objectui#9529 ruling applied to a
       * second key on this node.
       *
       * The description states THIS node's omitted default, and it is one
       * value: nothing on the node's path resolves a default, and
       * `DetailSection` tests `=== true`, so an omitted key keeps the
       * all-empty section. That matches `detail-view`, which hands its
       * sections on unchanged; `record:details` resolves `?? true` on its OWN
       * authored sections, which never pass through this node. `true` and
       * `false` mean the same on all three. No `defaultValue`: no other input
       * of this node carries one.
       */
      name: 'hideEmpty',
      type: 'boolean',
      description:
        'When every field in the section is empty, `true` hides the whole section (no heading, no skeleton). Omitted or `false`, an all-empty section is kept: in read-only mode it draws its heading plus one row that counts the empty fields and reveals them on request; in edit mode every field is an editable row. Empty fields in a section that still has a filled one are not governed by this key.',
    },
  ],
});

/**
 * ⛔ The `related-list` node type key is RETIRED (objectui#10859 batch 8,
 * phase 2b, the seat's ruling on that card, by the objectui#10393 /
 * objectui#8760 route). The related-list block authors write is the armed
 * `record:related_list` (registered below as `related_list`, namespace
 * `record`). `RelatedList` itself stays a named export of this package, and
 * `RecordRelatedListRenderer` renders through it directly.
 *
 * ## What was here, and why it went
 *
 * `ComponentRegistry.register('related-list', RelatedList, { namespace:
 * 'plugin-detail', ... })` — the raw component published as a node key, storing
 * `plugin-detail:related-list` and the bare `related-list` fallback. No
 * `@object-ui/types` arm claims it, so `objectui validate` refused a node
 * authored `type: 'related-list'` at `type` while the registry mounted it. Its
 * declared `type` input (`list` / `grid` / `table`) also collided with the
 * node discriminator: a node could not carry both.
 *
 * ## Why unregistering is the whole retirement
 *
 * Nothing wrote the node: 0 producers in source, docs, examples, the catalog
 * or objectstack, and 0 runtime emission, re-measured for phase 2b.
 */

// Alias for generic view
ComponentRegistry.register('detail', DetailView, {
  namespace: 'view',
  category: 'view',
  label: 'Detail',
  icon: 'FileText',
  inputs: [
    { name: 'objectName', type: 'string', required: true },
    { name: 'recordId', type: 'string' },
    { name: 'fields', type: 'array' },
  ]
});

// ---------------------------------------------------------------------------
// record:* namespace — Salesforce Lightning-style record page components.
// These renderers consume RecordContext (provided by app-shell's
// RecordDetailView) and adapt the spec's `RecordXxxComponentProps` onto the
// legacy plugin-detail components above.
//
// Pass the BARE name and let `namespace` do the prefixing — `register('details',
// …, { namespace: 'record' })`, not `register('record:details', …)`. The
// registry prepends the namespace itself, so a pre-prefixed name is prefixed
// again and lands under `record:record:details`; the key that actually worked
// was the un-namespaced fallback, which happened to spell `record:details`.
//
// `skipFallback: true` is what keeps that fallback from claiming the bare name
// globally: without it these would register `details`, `path`, `history`,
// `alert` … as top-level tags, colliding with the `ui:` primitives that own
// them. Every block here is reachable as `record:<name>` and only that.
// ---------------------------------------------------------------------------

/**
 * `emptyState` on the three BOUND record blocks — `record:details`,
 * `record:highlights` and `record:quick_actions`, the set `recordBindingBlock`
 * wraps (objectui#12932). The spec declares it on each of their rows
 * (objectstack#24266), the list view's own `EmptyStateSchema` by reference, so
 * the one input is published on all three. `BoundRecordEmptyState`
 * (`renderers/recordBinding.tsx`) draws it, pinned by
 * `renderers/__tests__/recordBinding.emptyState-12932.test.tsx`.
 */
const BOUND_RECORD_EMPTY_STATE_INPUT: ComponentInput = {
  name: 'emptyState',
  type: 'object',
  description: 'What this block draws in its place when its `dataSource` binding answers no row, `{ title, message, icon, link }` — the list view\'s own empty-state shape: a Lucide `icon` name, a `title` (default: "Record not found"), a `message` (default: none) and one `link: { label, url }` the user follows (default: none), opened as a `url` action opens it. `title`, `message` and the link\'s `label` each accept a plain string or an inline per-locale map, resolved against the display locale. Drawn then and only then — never on a block with no `dataSource` (it reads the record page\'s record instead), never while the bound read is loading, and never in place of the error a failed read shows; a read the server refuses as forbidden reads as no row, so it is drawn for that too. Leave it out and a binding with no row keeps the block\'s own placeholder.',
};

ComponentRegistry.register('details', RecordDetailsRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Record Details',
  icon: 'FileText',
  // Designer inputs mirror @objectstack/spec RecordDetailsProps (component.zod).
  //
  // `sections` publishes its ENTRY shape in prose, derived from the spec's own
  // `.describe()` on each member key. `ComponentInput.of` now carries the
  // member KIND (`of: 'object'` below, objectui#8067) and the repo-wide parity
  // gate compares it against the contract, so "these are objects" is no longer
  // prose-only — but `of` stops at the kind and names no member KEYS, so the
  // entry's own fields stay described here (same as `record:highlights.fields`,
  // `record:path.stages`, `record:alert.action`). It says "object, not string"
  // out loud because the string spelling is exactly what this text used to
  // teach: until 17.x the spec declared `sections: z.array(z.string())` and
  // this description read "Section IDs to show". objectstack#5611 deleted that
  // arm rather than unioning it in (no producer, no consumer — one shape, not
  // two de-facto contracts), and nothing in the four layers between the
  // manifest and the screen reports a leftover ID list: the manifest gate
  // checks top-level prop names and coarse types only (`['a','b']` is a valid
  // `array`), `validateComponentProps` upstream is advisory, and
  // `RecordDetailsRenderer` maps every entry as an object (`s.name` /
  // `s.label` / `s.fields`), so a string entry contributes no fields at all.
  // Once `sections` is authored at all it is the ONLY source of the body, so
  // the author who trusted the old text got a blank detail page. objectui#3807.
  //
  // There is deliberately NO `layout` input. `record:details` published one
  // (`enum ['auto','custom']`, `defaultValue: 'auto'`) until objectui#3818;
  // @objectstack/spec 17.0.0 removed the key outright (objectstack#6946,
  // ADR-0087 D2) because those semantics were never implemented — the
  // renderer's only read tested `inline` | `compact`, values the schema never
  // permitted, so `auto` and `custom` took the same branch and the key
  // selected nothing. Re-adding it here would republish a key the spec now
  // rejects on parse; the body-source contract is `sections`-presence, stated
  // in the `sections` description below.
  //
  // The never-teach set is `title` — which `RecordDetailsRenderer` honoured as
  // an ALIAS of `label` until objectui#6190 converged the heading on the one
  // declared slot. It stays named here because this set is about what the
  // description may SAY, not about what the renderer happens to read: the spec
  // refuses `title` whether or not anything still reads it. Undeclared
  // upstream, and the spec's section object REFUSES such a key on parse rather
  // than stripping it — `RecordDetailsProps.safeParse` on a section carrying
  // one returns `success: false` with `unrecognized_keys` naming it, against a
  // control (`columns: 2`) that parses and whose value survives. So publishing
  // it here would advertise a key that makes the whole document fail to
  // validate, not one the contract quietly throws away — the same trap as
  // declaring a top-level `readonly` on `record:highlights` below. The
  // renderer tolerating it is not a licence to teach it. (This said "STRIPS"
  // until objectui#7127: that was the pre-objectstack-ai/objectstack#4001-batch-A behaviour the spec's
  // own refusal message still recounts, and the `layout` paragraph above
  // already said `rejects`.)
  //
  // `hideEmpty` LEFT this set under objectui#8603 (director seat batch #137
  // item 3, maintainer 2026-09-15) and the `sections` description below now
  // teaches it. It was named here while objectui#7129 held — the key was
  // retired on the premise the spec refused it, which the 17.3.0 pin move made
  // false. The spec declares it on the section entry and this renderer reads
  // it again, so the membership criterion no longer selects it; the set is
  // derived against the installed spec at runtime by
  // `__tests__/recordDetailsInputs.spec-parity.test.ts`, which is what keeps a
  // stale prohibition from pinning itself. ⚠️ Still NOT this key:
  // `record:reference_rail`'s own component-level `hideEmpty` input below.
  inputs: [
    { name: 'columns', type: 'enum', enum: ['1', '2', '3', '4'], description: 'Number of columns for field layout (1-4)' },
    { name: 'sections', type: 'array', of: 'object', description: 'Field groups rendered as the detail body, in order. Every entry is an OBJECT — `{ name?, label?, columns?, fields }` — a bare section-id string is NOT accepted (the spec retired that spelling in objectstack#5611, and the renderer reads name/label/fields off each entry, so a string entry renders no fields at all). `fields` are the field names shown in this section, in order — required unless `group` supplies the members instead (the spec refuses a section carrying neither, and refuses one carrying both). `label` is the section heading; omit it for an untitled, borderless section. `name` is a stable snake_case identifier and the i18n anchor — the heading resolves through objects.<object>._sections.<name>.label, so a section without a name shows its authored label in every locale. `columns` (1-4) is THIS section\'s field-grid width; omit it and the renderer derives the width. Authoring `sections` at all makes it the only source of the detail body; omit it and the body falls back to the object\'s highlightFields. @objectstack/spec 17.3.0 declares eight more member keys on an entry, and this renderer honours all eight: `icon` (a Lucide name on the section header), `description` (sub-heading copy under the heading), `collapsible` and `defaultCollapsed` (a foldable section and its initial state), `showBorder` (force the Card wrapper on or off, overriding the heading-derived default) and `headerColor` (a header tint from the shared palette) through DetailSection, plus `group` — the ADR-0085 §5 REFERENCE form, the alternative to enumerating `fields`. `{ group: \'contact_info\' }` inherits the object\'s `fieldGroups` entry with that key: its members (every visible field pointing at it, in declaration order), its presentation (label, icon, description, collapse) and its `visibleWhen` all come from the group, so the section restates none of it — the predicate is evaluated against the bound record exactly as the entry form evaluates it, and a group it hides renders nothing (a `visibleWhen` written on a section itself is refused by the spec and not read: gate the group and reference it) and the spec refuses those keys beside `group`; `columns`, `showBorder` and `headerColor` stay yours because they are how THIS page lays the section out. A `group` naming no declared group renders nothing and is reported to the console (`@objectstack/lint` flags it as `page-section-group-unknown`). `hideEmpty` is the eighth, and it decides whether an ALL-empty section exists: it defaults to on, so a section whose fields are every one of them empty renders nothing at all — no heading, no skeleton — and `hideEmpty: false` is the spelling that keeps the section on a brand-new record: in read-only mode as its heading plus one fold row that counts the empty fields and reveals them on request (the same fold a partly-filled section uses, objectui#13386), in edit mode as every field an editable row. It decides ONLY the all-empty case; the empty rows of a section that still has a filled one belong to DetailSection\'s auto-hide heuristic plus the reader\'s show-empty toggle, which no authored value overrides in either polarity (objectui#7129 Q2-C), and inline-edit mode renders the section either way so its fields stay reachable. Restored under objectui#8603 (maintainer 2026-09-15) after objectui#7129 retired it on the premise, since falsified upstream, that the spec refused the key. None of the eight has a designer control yet; they are authorable in source mode only, tracked as a deferred feature. @objectstack/spec 18 declares a ninth, `count` (`{ field }`): the renderer fills the heading\'s `{{ count }}` hole with how many values that multi-value field holds on the current record — `{ name: \'tagging\', label: \'{{ count }} tags\', count: { field: \'tags\' }, fields: [\'tags\'] }` reads `3 tags` when three are selected. An absent or empty value counts 0; `count` changes only the heading, never whether the section renders, so with `hideEmpty` on an all-empty section is still absent. The hole is filled after the heading is translated, so each locale of an inline label map and a translated objects.<object>._sections.<name>.label write the same `{{ count }}`. The spec refuses `count` beside `group`, on a section with no `label`, and on a label with no hole; a heading on a section without `count` prints as written. Like the eight, `count` has no designer control yet.' },
    { name: 'fields', type: 'array', of: 'string', description: 'Explicit field list (overrides highlightFields)' },
    // `hideFields` is DECLARED, not merely honoured (objectui#3808). The spec
    // declares it (objectstack#5611) and `RecordDetailsRenderer` has read it
    // since the highlight-dedup phase (its `hideFields` read in
    // `renderers/record-details.tsx`), but
    // it was missing here — so an author reading the manifest could not
    // discover it, and every layer that reads the manifest said the opposite:
    // `sdui.manifest.json` / `sdui-intrinsics.d.ts` omitted it and
    // `sdui-parser`'s prop walk reported `unknown-prop` on a key the renderer
    // then honoured. Same failure as `readonly` in objectui#3407.
    //
    // Bare field NAMES only. The renderer also tolerates `{name}` / `{field}`
    // entries (`typeof n === 'string' ? n : fieldName(n)` at the read site), but
    // `hideFields` is `z.array(z.string())` in the spec and rejects those values
    // on parse — teaching them here would publish a second dialect the contract
    // refuses, the same fence `fields` above is held to.
    //
    // The "hiding every field drops the section" sentence is read off
    // `DetailSection.tsx` (`visibleFields.length === 0 &&
    // emptyCount === section.fields.length` returns null), not assumed.
    { name: 'hideFields', type: 'array', of: 'string', description: 'Field names to omit from the body — applied to the top-level `fields` list AND to every section\'s `fields`. Bare field names only. Authors rarely need it: the synth pipeline fills it with the fields already shown in `record:highlights`, and hand-authored pages get the same dedup live from HighlightFieldsContext, so its purpose is suppressing a field you do not want repeated (the page H1 title field is dropped for you too). Hiding every field of a section leaves that section out entirely.' },
    // `inlineEdit` and `showHeader` are DECLARED, not merely honoured
    // (objectui#4668) — the same reverse-direction defect `hideFields` above
    // records, on the two keys @objectstack/spec 17.0.0 GA added to this block.
    // `RecordDetailsRenderer` has read both all along (`renderers/
    // record-details.tsx`: `(schema.inlineEdit ?? true) && objectInlineEditable`,
    // and `showHeader: schema.showHeader ?? false` on the synthesized
    // `detail-view`), while `inputs` omitted them — so `sdui.manifest.json` and
    // `sdui-intrinsics.d.ts` never mentioned them, `sdui-parser`'s prop walk
    // raised `unknown-prop` on an author who wrote one, and the renderer
    // honoured it regardless.
    //
    // Both are plain booleans on the installed pin — measured against
    // `ComponentPropsMap['record:details']`, `z.boolean().optional()` each, so a
    // single arm and no union (objectui#3832): `1` / `'true'` / `null` are
    // rejected by value.
    //
    // `inlineEdit` is documented as an opt-OUT because that is the only
    // direction it can decide. The value is AND-ed with the object's own
    // resolved editability (`isObjectInlineEditable`, ADR-0103) and with the
    // server's effective API operation set (objectstack#3546), so `true` cannot
    // open editing the platform refuses; only `false` is unconditional. Saying
    // "enables inline editing" would advertise an authority this key does not
    // have.
    { name: 'inlineEdit', type: 'boolean', description: 'Offer the per-field double-click / pencil inline-edit affordances in the detail body. On by default, and an OPT-OUT only: the value is combined with the object\'s own editability (system, engine-owned, append-only and better-auth objects are not user-editable unless they opened userActions.edit) and with the server\'s effective API operation set for the object, so `false` always wins while `true` cannot open editing the platform refuses. The edit session and the atomic Save bar are hosted by the page, so one draft spans the highlights strip and this body.' },
    { name: 'showHeader', type: 'boolean', description: 'Render the detail body\'s own title / follow-star / copy-id chip above the fields. Off by default because this block is normally composed under a `page:header` that already draws that chrome, and turning it on there shows the record title twice. Set it true only when this block is the whole page.' },
    // The field-security triple — `enforceFieldSecurity`, `redactFields`,
    // `requiredPermissions` — is DECLARED here by objectui#8649, the reverse
    // direction `hideFields` above records (objectui#3808), on the three keys
    // `@objectstack/spec` 17.5.0 declared on `record:details`,
    // `record:highlights` and `record:related_list` (objectstack#18159).
    // `RecordDetailsRenderer` honoured all three before either declaration,
    // through a cast: through 17.4.0 an author who wrote one was refused at
    // parse and honoured by the renderer, and after the 17.5.0 bump the parse
    // accepted it while this manifest still said nothing. Publishing them moves
    // what the manifest advertises, and no rendering, gating or masking
    // behaviour.
    //
    // Types and descriptions are the CONTRACT's, verbatim: `boolean` for
    // `z.boolean()`, `array` of `string` for `z.array(z.string())`, and each
    // description is this block's own `.describe()` text. The describe is the
    // text of record, and `__tests__/recordDetailsInputs.spec-parity.test.ts`
    // re-reads it off the installed spec every run, so a spec that rewords one
    // turns that file red here rather than leaving the manifest to drift.
    { name: 'enforceFieldSecurity', type: 'boolean', description: 'Fold this block\'s field list through the caller\'s FIELD-read permissions before rendering, so a field the permission set denies leaves no empty row behind (renderer default: off). Presentation only: it re-applies the same field-read answer the server already enforced (ADR-0066 D3) and never widens access — with it off a denied field still arrives masked or stripped, and with it on the server still decides every value.' },
    { name: 'redactFields', type: 'array', of: 'string', description: 'Field names this block never renders, whatever the permission answer (renderer default: render everything authored). Presentation only, evaluated in the browser after the record is fetched — the values are still in the page, so this is NOT a data-access control and NOT the object\'s `publicSharing.redactFields`, which removes them server-side. To keep a value from the caller, gate the field itself (`requiredPermissions` / `maskingRule`, ADR-0066 D3) or the permission set. Neighbours `hideFields`, which is the dedupe channel the renderer also writes to.' },
    { name: 'requiredPermissions', type: 'array', of: 'string', description: '[ADR-0066] Capabilities the user must ALL hold — names that permission sets grant through `systemPermissions`, not object actions: `read` or `update` here is an ordinary capability name, not the object\'s read or edit permission. When the client has resolved the user\'s capabilities and any of these is missing, this block does not render its content; wherever it would otherwise render, an insufficient-permissions notice takes its place. Presentation only: it authorises nothing, and the data API still serves the same data to the same user. A client that cannot resolve the user\'s capabilities (no permission provider, or one that does not report `systemPermissions`) renders this block as if they were held — it fails open.' },
    BOUND_RECORD_EMPTY_STATE_INPUT,
  ],
});

ComponentRegistry.register('related_list', RecordRelatedListRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Related List',
  icon: 'List',
  // Mirrors @objectstack/spec RecordRelatedListProps.
  //
  // `relationshipValueField` and `add` are DECLARED, not merely honoured
  // (objectui#3808). Both are spec keys this renderer has read all along — in
  // `renderers/record-related-list.tsx`, the `schema.relationshipValueField ||
  // 'id'` read and the `schema.add` forward to `RelatedList` — while `inputs` omitted
  // them, so the published surface and the runtime disagreed in the direction
  // nothing reports: `sdui.manifest.json` / `sdui-intrinsics.d.ts` never
  // mentioned them, `sdui-parser`'s prop walk raised `unknown-prop` on an
  // author who wrote one anyway, and the renderer honoured it regardless. `add`
  // in particular is not cosmetic — without it declared, the ONLY published way
  // to build a junction-assignment list was to write an undiscoverable key.
  inputs: [
    { name: 'objectName', type: 'string', required: true, description: 'Related object name (e.g. "task")' },
    { name: 'relationshipField', type: 'string', required: true, description: 'Field on the related object pointing back to this record' },
    { name: 'relationshipValueField', type: 'string', description: 'Which field OF THIS PARENT record `relationshipField` stores. Defaults to "id"; set it to the field a name-keyed junction points at (e.g. "name" when the junction column holds the machine name of the parent record). The resolved value drives three things at once — the list filter, the Add-picker link value, and the pre-filled create form — so they cannot drift apart. While the parent record is still loading, a non-"id" field resolves to null and the list holds its fetch rather than querying on an empty value.' },
    // `parentDataSource` — the spec row's PARENT binding (objectui#12294, ruling
    // B on objectui#12296), read by `ParentRecordBinding` in
    // `renderers/recordBinding.tsx`. Hand-declared here, unlike the node-level
    // `dataSource` the `elementDataSourceBlock` seam injects: it is a member of
    // this block's own row, and the html tier judges a prop against `inputs`.
    // The description is the renderer's behaviour, not the spec describe
    // verbatim, whose `[PLANNED — not yet rendered]` marker this read retires.
    {
      name: 'parentDataSource',
      type: 'object',
      description:
        'The PARENT record this related list hangs off, bound by a query of its own: an object binding `{ object, view?, filter?, sort?, limit? }`, the shape `dataSource` takes. The FIRST row of the bound set by its `sort` is the parent (declare `limit: 1`; `objectui validate` warns without it), and `relationshipValueField` is read on that row. When no row answers, the list draws a notice saying so in its place, never an empty list. Without this key, the parent is the record page\'s record. The node-level `dataSource` on this block is the CHILD rows the list draws, and it is never read as the parent.',
    },
    // `columns` is NOT required (objectui#11613). The spec row leaves it
    // optional, and the registration may not be stricter than the row it
    // publishes: the page compile reads `required` here, and with it set a node
    // the row and the renderer accept was refused at the save gate. Both
    // columns-less nodes draw a list: a `dataSource` binding that names a view
    // lands the view's columns (`RECORD_RELATED_LIST_DATA_SOURCE` maps
    // `columns: true`), and with neither `RelatedList` reads the unauthored list
    // as "nothing authored" and derives the columns from the related object.
    // Pinned by `RecordRelatedListRenderer.columnsOptional-11613.test.tsx`
    // (what draws) and the console's `related-list-columns-optional-11613.test.ts`
    // (what compiles).
    { name: 'columns', type: 'array', of: 'string', description: 'Fields to display in the related list. Optional: without it, a `dataSource` binding that names a view supplies that view\'s columns, and with neither the list derives its columns from the related object (its `highlightFields`, otherwise its listable fields). Authored columns win over both.' },
    { name: 'sort', type: 'array' },
    { name: 'limit', type: 'number', description: 'Records to display initially' },
    // `type: 'array'` matches the spec (`RecordRelatedListProps.filter` is
    // `z.array(ViewFilterRuleSchema)`), and the description now names the MEMBER
    // shape for the reason `add`'s does: `ComponentInput` is flat, so an array
    // input can document its element vocabulary nowhere else — and this key is
    // one an AI author reaches for often. It also states the combining rule,
    // which is the part a wrong guess makes dangerous rather than merely broken:
    // an author who reads "filter" as "the list's whole filter" would expect it
    // to be able to widen past the parent record, and it cannot (objectstack#7118).
    { name: 'filter', type: 'array', of: 'object', description: 'Additional filter criteria, as spec `ViewFilterRule` entries (`[{ field, operator, value }]`). AND-combined with the parent relationship condition, never a replacement for it: it can only narrow this record\'s children. Also the key a per-element `dataSource` binding\'s composed filter lands on.' },
    // `title` is an `I18nLabel` in the spec row (`ComponentPropsMap
    // ['record:related_list']`), and `RecordRelatedListRenderer` resolves it with
    // `pickLocalized` against the active UI language before it falls back to the
    // related object's label. So both arms are declared, as `ComponentInput.type`
    // prescribes for a key whose render site resolves the map: a `'string'`-only
    // declaration made the manifest gate report `type-mismatch` on a legal map
    // (objectui#10993). The render is pinned by
    // `record-related-list.titleI18nLabel-10993.test.tsx`, the manifest by the
    // console's `i18nLabelInputsManifest-10993.test.ts`.
    {
      name: 'title',
      type: ['string', 'object'],
      description:
        'Heading of the list. Defaults to the related object\'s label (its translation when one is loaded, otherwise the humanized object name). Accepts either a plain string or an inline per-locale map (`{ en: "Open tasks", "zh-CN": "未完成任务" }`) — the `I18nLabel` union the contract admits on this key — and the list resolves the map against the active UI language, falling back through base language, a region-qualified sibling, `default`, then `en`, and finally to any remaining entry.',
    },
    { name: 'showViewAll', type: 'boolean' },
    { name: 'actions', type: 'array', of: 'string', description: 'Action IDs available for related records' },
    // `add` publishes its MEMBER shape in prose for the reason the sibling
    // array-of-objects inputs do (`record:details.sections`,
    // `record:highlights.fields`, `record:path.stages`): `ComponentInput.of`
    // carries a member KIND and nothing finer (objectui#8067), and this key has
    // no uniform member kind to carry — its contract is a named-shape
    // `z.object({ … })`, not a map — so its members can only be documented
    // here.
    //
    // Documented members are exactly the spec's — `picker.object`,
    // `picker.valueField`, `picker.labelField`, `linkField`, `label` — with each
    // default taken from the RENDERER, which is where an author's expectation
    // gets settled: `RelatedList.tsx` defaults `picker.valueField` to `id`
    // (`add.picker.valueField || 'id'`, matching the spec's own default) but
    // defaults `picker.labelField` to `name` (`add?.picker?.labelField ||
    // 'name'`), NOT to the object's title field as the spec's `.describe()`
    // says. Publishing the spec's wording there would have been a description
    // the platform does not honour.
    //
    // `picker.filter` IS documented as working since #3831 wired it: it reaches
    // `RecordPickerDialog`'s `baseFilter` verbatim (`RelatedList.tsx`, at the
    // dialog mount), which is the un-editable slot — not `lookupFilters`, whose
    // entries become filter-bar rows the user can widen back out. It carried a
    // KNOWN GAP sentence here until then, on the
    // `record:activity.showSubscriptionToggle` precedent; the sentence went away
    // with the gap, not before it.
    { name: 'add', type: 'object', description: 'Adds an "Add" button that assigns EXISTING records instead of creating one — the m2m/junction case. Shape: `{ picker: { object, valueField?, labelField?, filter? }, linkField?, label? }`. `picker.object` (required) is the object whose records the dialog offers. `picker.valueField` is the field of the picked record used as the link value (default "id"); `picker.labelField` is the column shown in the picker rows (default "name", and the other columns are derived from that object\'s schema). With `linkField` set, selecting records CREATES rows in this list\'s own object as `{ [relationshipField]: parentValue, [linkField]: pickedId }` — the junction case; omit `linkField` and the picked child is RE-PARENTED instead, by setting its own `relationshipField` to this parent. `label` is the button text (default "Add", localizable inline). Setting `add` also enables generic link removal on rows when no host delete handler is wired. `picker.filter` restricts which records the dialog offers — a list of `{ field, operator, value }` rules in the same vocabulary as this list\'s own `filter`, applied as a hard constraint the user cannot widen (it never appears as an editable filter row).' },
    // The field-security triple, DECLARED by objectui#8649 on the contract's
    // 17.5.0 declaration — types and descriptions verbatim from this block's
    // spec row. The reasoning is written once, on `record:details` above;
    // `__tests__/recordRelatedListInputs.spec-parity.test.ts` re-reads each description off the installed spec.
    { name: 'enforceFieldSecurity', type: 'boolean', description: 'Fold this list\'s `columns` through the caller\'s FIELD-read permissions on the RELATED object before rendering (renderer default: off). Presentation only: it re-applies the same field-read answer the server already enforced (ADR-0066 D3) and never widens access — the rows are fetched either way and the server still decides every value.' },
    { name: 'redactFields', type: 'array', of: 'string', description: 'Field names this list never renders, whatever the permission answer (renderer default: render every column authored or derived). Applies to the authored `columns` AND to the columns the list derives for itself when none are authored. Presentation only, evaluated in the browser after the rows are fetched — the values are still in the page, so this is NOT a data-access control and NOT the object\'s `publicSharing.redactFields`, which removes them server-side. To keep a value from the caller, gate the field itself (`requiredPermissions` / `maskingRule`, ADR-0066 D3) or the permission set.' },
    { name: 'requiredPermissions', type: 'array', of: 'string', description: '[ADR-0066] Capabilities the user must ALL hold — names that permission sets grant through `systemPermissions`, not object actions: `read` or `update` here is an ordinary capability name, not the object\'s read or edit permission. When the client has resolved the user\'s capabilities and any of these is missing, this block does not render its content; wherever it would otherwise render, an insufficient-permissions notice takes its place. Presentation only: it authorises nothing, and the data API still serves the same data to the same user. A client that cannot resolve the user\'s capabilities (no permission provider, or one that does not report `systemPermissions`) renders this block as if they were held — it fails open.' },
  ],
});

ComponentRegistry.register('highlights', RecordHighlightsRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Highlights Panel',
  icon: 'Star',
  // Mirrors @objectstack/spec RecordHighlightsProps.
  //
  // `readonly` is documented INSIDE the `fields` description, not declared as
  // an input of its own, because that is where the contract puts it: the spec's
  // `RecordHighlightsField` carries `readonly` on each ENTRY, while
  // `RecordHighlightsProps` declares no top-level `readonly` (its top-level
  // keys are read off the installed spec by
  // `__tests__/recordHighlightsInputs.spec-parity.test.ts`, not listed here).
  // A top-level `{ name: 'readonly', type: 'boolean' }` here would look
  // like the fix for "the manifest never mentions readonly" and would instead
  // publish a key the platform does not accept: the generated
  // `sdui.manifest.json` and `sdui-intrinsics.d.ts` would advertise
  // `<RecordHighlights readonly>`, the manifest gate validates top-level props
  // only and would raise no diagnostic, the spec REFUSES the unknown key on
  // parse rather than stripping it — `RecordHighlightsProps.safeParse` returns
  // `success: false` with `unrecognized_keys: ['readonly']` (measured on the
  // installed pin, 17.2.0, against a control — `layout: 'vertical'` — that
  // parses and whose value survives) — and the renderer, which reads
  // `field.readonly` per entry, would never see it either. An author who
  // trusted that surface would be left with the machine-owned column still
  // hand-editable and their page refused by the contract wherever it is
  // parsed. (This said "strips the unknown key on parse without error" until
  // objectui#7127: the pre-objectstack-ai/objectstack#4001-batch-A behaviour, the same stale claim the
  // `record:details` block above carried.) `ComponentInput.of` carries a member
  // KIND and nothing finer (objectui#8067), so an array input publishes its
  // member KEYS in prose, the same way `record:path.stages` and
  // `record:alert.action` do — and this key does not declare `of` at all,
  // because its member contract accepts a bare field NAME or an inline field
  // object and picking one arm of that union is the narrowing this repo leaves
  // un-gated (pinned as `MULTI_KIND_MEMBER_CONTRACTS` in the repo-wide parity
  // gate). objectui#3407 / objectstack#5176.
  inputs: [
    { name: 'fields', type: 'array', required: true, description: 'Key fields to highlight (1-7), bare names or {name,label?,type?,readonly?}. Set readonly: true on an entry to render that chip read-only — it suppresses the inline-edit affordance and the HeaderHighlight editability gate enforces it. Use it for hook/automation-maintained columns that must not be hand-edited from the record header; marking the OBJECT field readonly instead would also strip the hook\'s own write-back.' },
    { name: 'layout', type: 'enum', enum: ['horizontal', 'vertical'], description: 'Layout orientation for highlight fields' },
    // The field-security triple, DECLARED by objectui#8649 on the contract's
    // 17.5.0 declaration — types and descriptions verbatim from this block's
    // spec row. The reasoning is written once, on `record:details` above;
    // `__tests__/recordHighlightsInputs.spec-parity.test.ts` re-reads each description off the installed spec.
    { name: 'enforceFieldSecurity', type: 'boolean', description: 'Fold this block\'s highlight chips through the caller\'s FIELD-read permissions before rendering, so a field the permission set denies leaves no empty chip behind (renderer default: off). Presentation only: it re-applies the same field-read answer the server already enforced (ADR-0066 D3) and never widens access — the record is fetched either way and the server still decides every value.' },
    { name: 'redactFields', type: 'array', of: 'string', description: 'Field names this block never renders as a chip, whatever the permission answer (renderer default: render every field authored). Presentation only, evaluated in the browser after the record is fetched — the values are still in the page, so this is NOT a data-access control and NOT the object\'s `publicSharing.redactFields`, which removes them server-side. To keep a value from the caller, gate the field itself (`requiredPermissions` / `maskingRule`, ADR-0066 D3) or the permission set.' },
    { name: 'requiredPermissions', type: 'array', of: 'string', description: '[ADR-0066] Capabilities the user must ALL hold — names that permission sets grant through `systemPermissions`, not object actions: `read` or `update` here is an ordinary capability name, not the object\'s read or edit permission. When the client has resolved the user\'s capabilities and any of these is missing, this block does not render its content; wherever it would otherwise render, an insufficient-permissions notice takes its place. Presentation only: it authorises nothing, and the data API still serves the same data to the same user. A client that cannot resolve the user\'s capabilities (no permission provider, or one that does not report `systemPermissions`) renders this block as if they were held — it fails open.' },
    BOUND_RECORD_EMPTY_STATE_INPUT,
  ],
});

// `inputs` on the blocks below describe what an AUTHOR writes, which is a
// subset of what the renderer reads. `entries`, `loading` and resolved
// `actions` are injected by the host shell (RecordDetailView and friends) off
// RecordContext — declaring those would invite a model to hand-write data the
// page is supposed to fetch. `aria` is omitted for the same reason it is
// omitted on `record:details` above: it is an accessibility escape hatch, not
// a layout choice.

ComponentRegistry.register('activity', RecordActivityRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Activity Timeline',
  icon: 'Activity',
  // Mirrors RecordActivityComponentProps (@object-ui/types), itself aligned
  // with @objectstack/spec RecordActivityProps.
  //
  // Every description below says what the input DOES and, where it depends on
  // something the block does not own, what it needs — because this text is
  // what ships to `sdui.manifest.json` and is therefore what an AI author
  // reads before writing the block. objectui#3165: all eleven of these used to
  // be filters and affordances over a feed the renderer hard-coded to `[]`, so
  // they read as configurable and did nothing. The read-side six are live on
  // every path now; the write-side four are live wherever a host mounts a
  // DiscussionContext (record detail pages do); `showSubscriptionToggle` is a
  // declared-but-inert GAP and says so here rather than looking configurable.
  inputs: [
    { name: 'types', type: 'array', of: 'string', description: 'Allow-list of feed item types to show (comment, field_change, task, event, email, call, note, file, record_create, record_delete, approval, sharing, system). Omit for all; unrecognised entries are ignored.' },
    {
      name: 'filterMode',
      type: 'enum',
      enum: ['all', 'comments_only', 'changes_only', 'tasks_only'],
      description: 'Filter the timeline dropdown starts on. The user can still change it; an unrecognised value falls back to "all".',
    },
    { name: 'showFilterToggle', type: 'boolean', description: 'Expose the activity-type filter dropdown in the panel header' },
    { name: 'limit', type: 'number', description: 'Items per page. Also caps the scoped sys_activity read; "Load more" grows the window by this much.' },
    { name: 'showCompleted', type: 'boolean', description: 'Include completed activities (sys_activity type "completed", which surfaces as a task item). Off by default. A milestone row (metadata.kind "milestone") is not a completed activity and shows either way. A logged interaction, a task item that points at its source record through source_object / source_id (a logged call, meeting or email), also shows either way.' },
    { name: 'unifiedTimeline', type: 'boolean', description: 'Mix field changes and comments in one timeline (Airtable style). Off keeps the panel a discussion stream — field changes stay in record:history.' },
    { name: 'showCommentInput', type: 'boolean', description: 'Show the composer. Requires a host discussion context to persist the comment (record detail pages provide one); without it the feed is read-only.' },
    { name: 'enableMentions', type: 'boolean', description: 'Offer @-mention autocomplete in the composer, from the host discussion context\'s user list. Off withholds the suggestions.' },
    { name: 'enableReactions', type: 'boolean', description: 'Show emoji reactions on feed items. Toggling one requires a host discussion context; without it existing reactions still render, read-only.' },
    { name: 'enableThreading', type: 'boolean', description: 'Group replies under their parent comment. Posting a reply requires a host discussion context.' },
    {
      name: 'showSubscriptionToggle',
      type: 'boolean',
      // No default is advertised: the spec defaults it true and this renderer
      // treats it as false, and naming either value in `description` would
      // advertise a default for something that has no behaviour to default to.
      // (`ComponentInput.defaultValue` itself is retired — objectui#7493.)
      // KNOWN GAP (objectui#3165). Declared because @objectstack/spec declares
      // it, and left visible rather than quietly dropped so the two
      // declarations stay in parity — but it renders nothing: the bell needs a
      // RecordSubscription plus a persist handler, and the platform has no
      // record-subscription object to read or write one. Saying so here is the
      // difference between a documented gap and objectstack#4413's shape.
      description: 'NOT IMPLEMENTED — no record-subscription backend exists yet, so this renders nothing whatever it is set to. Declared for spec parity only (objectui#3165).',
    },
  ],
});

// `record:chatter` and `record:discussion` are the same renderer under two
// names. The spec prefers `discussion` for new Lightning-style record pages;
// `chatter` stays for Salesforce-familiar authors and for schemas already in
// the wild. Both carry the same inputs — an author who reaches for either gets
// the same configuration surface.
const CHATTER_INPUTS: ComponentInput[] = [
  { name: 'position', type: 'enum', enum: ['bottom', 'right', 'left'], description: 'Where the panel docks relative to the record body' },
  { name: 'width', type: 'string', description: 'Panel width as a CSS value (side positions only)' },
  { name: 'collapsible', type: 'boolean' },
  { name: 'defaultCollapsed', type: 'boolean' },
  // `feed` delegates its whole member list to `record:activity`, and that is
  // the SPEC's statement rather than this file's: `@objectstack/spec` declares
  // `RecordChatterProps.feed: RecordActivityProps.optional()`
  // (`component.zod.ts`), bound to both names (the `record:chatter` and
  // `record:discussion` entries of `ComponentPropsMap`). So the
  // description names the declaration it delegates to instead of re-listing
  // its members, which would then be free to drift from it. (Re-listing would
  // also have to decide what to do with `aria`, which the spec shape carries
  // and `record:activity`'s own registration does not — one more reason the
  // delegation is the honest statement.)
  //
  // objectui#8934: the four FILTER members of that shape (`types` / `limit` /
  // `showCompleted` / `unifiedTimeline`) used to be discarded on this path
  // because `record-chatter.tsx` handed `discussion.items` to the panel raw.
  // That was an IMPLEMENTATION GAP against a wider protocol, not a narrower
  // contract, so it was closed in the renderer — see `renderers/record-chatter.tsx`,
  // which now runs `applyFeedConfig` with the call shape `record-activity.tsx`
  // uses (`applyFeedConfig(sourceItems, { types, showCompleted, unifiedTimeline }, …)`).
  // ⛔ Do not narrow this declaration to match an implementation: the protocol
  // is the contract, and a protocol that is wrong is changed in
  // `@objectstack/spec` first.
  { name: 'feed', type: 'object', description: 'Activity-feed configuration nested inside the panel — the same shape as record:activity. The spec declares this key as RecordActivityProps (RecordChatterProps.feed), so its members are the inputs record:activity declares; see that block for what each one does.' },
];

ComponentRegistry.register('chatter', RecordChatterRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Chatter Feed',
  icon: 'MessageSquare',
  // Mirrors RecordChatterComponentProps (@object-ui/types).
  inputs: CHATTER_INPUTS,
});

ComponentRegistry.register('discussion', RecordChatterRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Discussion',
  icon: 'MessageSquare',
  inputs: CHATTER_INPUTS,
});

ComponentRegistry.register('path', RecordPathRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Path / Stepper',
  icon: 'GitBranch',
  // Mirrors @objectstack/spec RecordPathProps.
  inputs: [
    { name: 'statusField', type: 'string', required: true, description: 'Field representing the current status/stage' },
    { name: 'stages', type: 'array', of: 'object', description: 'Explicit stage definitions [{ value, label }] (else derived from field metadata)' },
  ],
});

ComponentRegistry.register('quick_actions', RecordQuickActionsRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Quick Actions',
  icon: 'Zap',
  inputs: [
    // Describes what the renderer does, not what it might do (objectui#4663).
    // This sentence used to end "(else every action declared for the object at
    // this location)" — a fallback that exists on no path: with no names and no
    // host-supplied `actions`, `needsLookup` is false, the object metadata is
    // never queried, and the bar renders its placeholder. The registry `inputs`
    // are the published surface (`gen-manifest.ts` serializes them into
    // `sdui.manifest.json` and the JSX authoring types), so the promise was
    // taught to authors and to tooling — objectstack#8744 quoted it verbatim.
    // Implementing the fallback would be a behaviour expansion and needs its own
    // card; pinned by `recordQuickActionsInputs.actionNamesFallback.test.tsx`.
    { name: 'actionNames', type: 'array', of: 'string', description: 'Action names to expose, in order — resolved from the actions declared on the object. With no names (and no host-supplied actions) nothing is looked up: the bar renders its empty placeholder on a design / preview surface and nothing at runtime' },
    // The contract's shared record-block describe, verbatim (objectstack#18159):
    // `record:quick_actions` carries the one text `record:details`,
    // `record:highlights` and `record:related_list` share, and objectui#8649
    // already publishes it on those three. This input used to read
    // "Hide the whole bar unless the user holds these permissions", which is not
    // what the renderer does: the gate reads the CAPABILITY set
    // (`perms.hasCapabilities`, objectui#10058), puts a `role="status"`
    // insufficient-permissions notice where the bar would be, and fails open when
    // capabilities are unreported (objectui#10224). Each clause is pinned on this
    // block by `record-quick-actions.requiredPermissions-gate.test.tsx`, which
    // also re-reads the installed describe every run, so a spec that rewords it
    // turns that file red rather than leaving this text to drift.
    { name: 'requiredPermissions', type: 'array', of: 'string', description: '[ADR-0066] Capabilities the user must ALL hold — names that permission sets grant through `systemPermissions`, not object actions: `read` or `update` here is an ordinary capability name, not the object\'s read or edit permission. When the client has resolved the user\'s capabilities and any of these is missing, this block does not render its content; wherever it would otherwise render, an insufficient-permissions notice takes its place. Presentation only: it authorises nothing, and the data API still serves the same data to the same user. A client that cannot resolve the user\'s capabilities (no permission provider, or one that does not report `systemPermissions`) renders this block as if they were held — it fails open.' },
    // Derived from the spec's own vocabulary rather than restated — #3019.
    { name: 'location', type: 'enum', enum: [...ACTION_LOCATIONS], description: 'Which declared action location this bar renders' },
    { name: 'align', type: 'enum', enum: ['start', 'center', 'end'] },
    { name: 'inline', type: 'boolean', description: 'Render in the flow instead of folding into the record header' },
    { name: 'variant', type: 'string', description: 'Passed to the Button primitive; a per-action variant overrides it' },
    { name: 'size', type: 'string', description: 'Passed to the Button primitive; a per-action size overrides it' },
    BOUND_RECORD_EMPTY_STATE_INPUT,
  ],
});

ComponentRegistry.register('history', RecordHistoryRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'History Timeline',
  icon: 'Clock',
  inputs: [
    { name: 'limit', type: 'number', description: 'Maximum history entries to display' },
    { name: 'emptyText', type: 'string', description: 'Copy shown when the record has no history' },
    { name: 'unknownUserText', type: 'string', description: 'Copy substituted when an entry has no resolvable actor' },
  ],
});

ComponentRegistry.register('reference_rail', RecordReferenceRailRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Reference Rail',
  icon: 'PanelRight',
  inputs: [
    { name: 'hideEmpty', type: 'boolean', description: 'Drop the rail entirely when no entries resolve' },
  ],
});

ComponentRegistry.register('alert', RecordAlertRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Alert Banner',
  icon: 'triangle-alert',
  inputs: [
    { name: 'severity', type: 'enum', enum: ['info', 'warning', 'error', 'success'] },
    // Two arms each (objectui#3832). When these were declared, `ComponentPropsMap`
    // carried no `record:alert` entry to measure against, so the second arm was
    // justified by the RENDERER: `renderers/record-alert.tsx` resolves both
    // through `pickLocalized`, which is exactly what these descriptions teach.
    // Declaring the map arm therefore adds no shape the block does not already
    // honour; it stops the manifest gate warning `type-mismatch` on the
    // recommended write. (The row DOES exist as of the installed 18.1.0 — read
    // for `visible` below, objectui#9100 — so the "no entry" reading is stale;
    // these two arms are unaffected either way.)
    { name: 'title', type: ['string', 'object'], description: 'Accepts an inline translation map ({ en, "zh-CN", … })' },
    { name: 'body', type: ['string', 'object'], description: 'Accepts an inline translation map ({ en, "zh-CN", … })' },
    // objectui#9100 — the spec accepts three arms here and the renderer now
    // resolves all three, so a single `'string'` was the declaration-narrower-
    // than-the-contract family of objectui#4581, one layer up. Measured on the
    // INSTALLED `@objectstack/spec` 18.1.0 (`dist/ui/index.d.ts`, the
    // `ComponentPropsMap['record:alert']` row): `visible` is
    // `boolean | string | { dialect: 'cel'|'cron'|'template', source?, … }`,
    // and `renderers/record-alert.tsx` hands whichever arrives to
    // `toPredicateInput`, which takes a boolean as a short-circuit, a bare
    // string as the legacy spelling, and a `cel` envelope as the canonical
    // one. The envelope arm only became reachable through `SchemaRenderer`
    // with this card's fix, which is the order `ComponentInput.type`
    // prescribes: teach the render site, then declare the arm.
    {
      name: 'visible',
      type: ['boolean', 'string', 'object'],
      description:
        'Gates the banner against the current record: `true`/`false`, a bare CEL expression, or the `{ dialect: \'cel\', source }` envelope',
    },
    { name: 'icon', type: 'string', description: 'Lucide icon name; defaults to the severity icon' },
    { name: 'action', type: 'object', description: '{ actionName, label?, variant? } — the action the banner offers' },
    { name: 'dismissible', type: 'boolean' },
    { name: 'dismissKey', type: 'string', description: 'Stable key the dismissal is remembered under' },
  ],
});

