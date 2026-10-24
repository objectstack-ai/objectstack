/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - View Component Zod Validators
 * 
 * Zod validation schemas for view components.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/views
 * @packageDocumentation
 */

import { z } from 'zod';
import { BaseSchema, SchemaNodeSchema } from './base.zod.js';
import { handlerKeyRefusal, neitherContentChannelGuidance, retirementTombstone } from './tombstone.zod.js';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { SelectOptionSchema as SpecSelectOptionSchema } from '@objectstack/spec/data';
import { stripImportedDefaults } from './imported-defaults.js';

/**
 * The spec's own list-view type vocabulary, unwrapped from its `.default('grid')`.
 *
 * ⭐ NOT a crossing of the objectui#8317 import boundary. (This file's one
 * crossing is `DetailViewFieldSchema.options` below, wrapped in
 * `stripImportedDefaults` at the site.) A vocabulary is a set of VALUES, not a subschema:
 * `.removeDefault()` here reaches the spec's enum and nothing that could write a
 * key into a parsed document ever flows from it. The declared-exception list in
 * `../__tests__/imported-defaults-8317.test.ts` names this site and its twin.
 *
 * Deliberately NOT exported: `__tests__/zod-mirror-parity.test.ts` runs a
 * population census over every `export const` in this directory, and this is a
 * derivation helper rather than a mirror anyone should reach for. The same
 * unwrap is spelled once more, privately, in `./objectql.zod.ts` (`ViewKindEnum`,
 * which types the renamed `viewType` key) — two derivations of one spec object
 * cannot drift from each other, whereas two copies of its member list can, and
 * did.
 */
const SpecListViewTypeEnum = SpecListViewSchema.shape.type.removeDefault();

/**
 * View Type Schema — the zod face of {@link ViewType} (`../views.ts`).
 *
 * DERIVED from `@objectstack/spec/ui` `ListViewSchema.type` (`ca3942729`), so
 * the two faces cannot drift from the spec or from each other. Both were
 * hand-written eleven-arm copies of the spec's 17.2.0 list; `@objectstack/spec@17.3.0`
 * added `page` and neither followed, while `ViewKindEnum` in `./objectql.zod.ts`
 * — already derived — accepted `viewType: 'page'` the day the pin landed. That
 * is `declared !== enforced` on a published surface: the validator said yes and
 * the renderer silently drew a grid.
 *
 * `'list'` and `'detail'` are appended because they are objectui view
 * CATEGORIES with no spec counterpart; see `../views.ts` for why they are not
 * pushed upstream.
 */
export const ViewTypeSchema = z.enum([...SpecListViewTypeEnum.options, 'list', 'detail']).describe('View type');

/**
 * Detail View Field Schema
 */
export const DetailViewFieldSchema = z.object({
  name: z.string().describe('Field name/path'),
  label: z.string().optional().describe('Display label'),
  type: z.enum([
    'text', 'number', 'currency', 'percent', 'boolean', 'select', 'lookup', 'master_detail',
    'email', 'url', 'phone', 'user',
    'image', 'link', 'badge', 'date', 'datetime', 'json', 'html', 'markdown', 'custom',
  ]).optional().describe('Field type for rendering'),
  format: z.string().optional().describe('Format string (e.g., date format)'),
  render: SchemaNodeSchema.optional().describe('Custom renderer'),
  value: z.any().optional().describe('Field value'),
  readonly: z.boolean().optional().describe('Whether field is read-only'),
  visible: z.union([z.boolean(), z.string()]).optional().describe('Field visibility condition'),
  span: z.number().optional().describe('Span across columns (for grid layout)'),
  /**
   * The spec's AUTHORING option schema, by reference (objectui#10296, ruling F1
   * on objectui#7759) — ⛔ never the declaration's element type
   * `SelectOptionMetadata`, which is the runtime READ model and admits keys the
   * spec refuses by name (`disabled`, `icon`). The two faces are therefore
   * EXPECTED to differ on this key: the ledger records that divergence rather
   * than repairing it. Re-derived by `__tests__/detail-view-field-options-10296.test.ts`.
   */
  options: z.array(stripImportedDefaults(SpecSelectOptionSchema)).optional()
    .describe('Options for select/lookup fields'),
  reference: z.string().optional().describe('Referenced object name for lookup/master_detail fields'),
  reference_field: z.string().optional().describe('Display field on the referenced object'),
  currency: z.string().optional().describe('Currency code for currency fields (e.g. USD, EUR)'),
  // `dueLike` retired from the authored view entry (objectui#11815): the
  // deadline is the object field's declaration, read through enrichment.
});

/**
 * Detail View Section Schema
 */
export const DetailViewSectionSchema = z.object({
  name: z.string().optional().describe('Stable identifier for i18n key resolution'),
  title: z.string().optional().describe('Section title'),
  description: z.string().optional().describe('Section description'),
  icon: z.string().optional().describe('Section icon'),
  fields: z.array(DetailViewFieldSchema).describe('Fields in this section'),
  collapsible: z.boolean().optional().describe('Collapsible section'),
  defaultCollapsed: z.boolean().optional().describe('Default collapsed state'),
  columns: z.number().optional().describe('Grid columns for field layout'),
  visible: z.union([z.boolean(), z.string()]).optional().describe('Section visibility condition'),
  showBorder: z.boolean().optional().describe('Show border around section'),
  // Mirrors `DetailViewSection.hideEmpty`, restored under objectui#8603
  // (director seat batch #137 item 3, maintainer 2026-09-15) after
  // objectui#7129 retired it on a premise `@objectstack/spec` had already
  // reversed upstream. The key decides the ALL-EMPTY section only; empty rows
  // inside a partly-filled section stay `DetailSection`'s heuristic (#7129
  // Q2-C, untouched). The declaration's own docblock carries the full contract.
  hideEmpty: z
    .boolean()
    .optional()
    .describe('Hide an all-empty section entirely; `false` keeps its heading and label skeleton'),
  // Closed vocabulary — the six design-system tint tokens
  // `@object-ui/plugin-detail`'s `HEADER_COLOR_CLASSES` resolves, and the six
  // `@objectstack/spec` declares on its strict `record:details` section schema
  // (maintainer ruling A, 2026-08-26, objectstack#12126). Pinned one-to-one
  // against that renderer module by
  // `packages/plugin-detail/src/__tests__/headerColor.contractPin-6594.test.ts`,
  // which fails in BOTH directions — a token added to either side alone is red.
  // The renderer's verbatim `bg-*` pass-through stays an UNDECLARED affordance:
  // the ruling rejected declaring it, since it only renders where the host
  // app's Tailwind build happens to emit that class.
  headerColor: z
    .enum(['muted', 'muted/50', 'accent', 'primary/10', 'secondary/10', 'destructive/10'])
    .optional()
    .describe('Header background tint (one of six design-system tokens)'),
});

/**
 * Detail View Tab Schema
 */
export const DetailViewTabSchema = z.object({
  key: z.string().describe('Tab key/identifier'),
  label: z.string().describe('Tab label'),
  icon: z.string().optional().describe('Tab icon'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).describe('Tab content'),
  visible: z.union([z.boolean(), z.string()]).optional().describe('Tab visibility condition'),
  badge: z.union([z.string(), z.number()]).optional().describe('Badge count'),
});

/**
 * The prescription an author gets when a record id arrives as a number.
 *
 * ⚠️ Declared file-locally in each of the three mirrors that carry a record id
 * rather than shared from one module, and PINNED BY CONTENT — not by line — in
 * `../__tests__/authorable-record-id-string-9511.test.ts`, which asserts that
 * every one of the three refusals names the quoted form. So this text drifting
 * out of one mirror turns that pin red instead of going quiet.
 */
const RECORD_ID_IS_A_STRING_GUIDANCE =
  "A record id is a string on every boundary (objectui#9511): write it quoted \u2014 42 becomes '42'. "
  + 'A backend whose primary keys are numeric converts at its OWN adapter boundary, in one typed '
  + 'place, so every author, every caller and every adapter sees one shape.';

/** objectui#9256 (E3 residual): ONE refusal string for both content channels of `DetailViewSchema`. */
const DETAIL_VIEW_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'detail-view',
  'its `any`-typed registration hands the node to `DetailView`, which reads it as `DetailViewSchema`',
  'one record of `objectName` through `fields` / `sections` / `tabs`; its own node slots are `header`, `footer` and each tab\u2019s `content`',
);

/**
 * Detail View Schema
 */
/**
 * objectui#6152 round 3 — one entry of `DetailViewSchema.sectionGroups`, restated
 * member for member from the interface's `SectionGroup`. Module-private: a nested
 * shape of the `detail-view` arm, not a registered pair.
 *
 * ⚠️ One stated exception: `sections` is `z.array(z.any())` where the twin says
 * `DetailViewSection[]`. Binding `DetailViewSectionSchema` here would import that
 * pair's own `KnownDrift` rows into this arm as a NEW drifted key, and growing
 * `KnownDrift` is never the remedy; the same exception objectui#6152 round 1 took for
 * `ObjectFormSchema.sections[].fields`. So a section inside a group is not judged on
 * this key.
 */
const DetailViewSectionGroupSchema = z.object({
  title: z.string().describe('Group title'),
  description: z.string().optional().describe('Group description'),
  icon: z.string().optional().describe('Group icon'),
  collapsible: z.boolean().optional().describe('Whether the group is collapsible (default true)'),
  defaultCollapsed: z.boolean().optional().describe('Whether the group starts collapsed'),
  sections: z.array(z.any()).describe('Sections in this group (not judged on this key; see the docblock)'),
});

/**
 * objectui#6152 round 3 — one entry of `DetailViewSchema.highlightFields`, restated
 * member for member from the interface's `HighlightField`; `type` is the field
 * mirror's own member, as the twin's `DetailViewField['type']` is. Module-private.
 */
const DetailViewHighlightFieldSchema = z.object({
  name: z.string().describe('Field name from the record data'),
  label: z.string().describe('Display label'),
  type: DetailViewFieldSchema.shape.type,
  icon: z.string().optional().describe('Optional icon'),
  readonly: z.boolean().optional().describe('Read-only chip: never offers inline edit'),
});

export const DetailViewSchema = BaseSchema.extend({
  type: z.literal('detail-view'),
  title: z.string().optional().describe('Detail title'),
  api: z.string().optional().describe('API endpoint to fetch detail data'),
  resourceId: z
    .string({ error: (issue) => (issue.code === 'invalid_type' ? RECORD_ID_IS_A_STRING_GUIDANCE : undefined) })
    .optional()
    .describe('Resource ID to display \u2014 a string, never a number (objectui#9511)'),
  objectName: z.string().optional().describe('Object name (for ObjectQL integration)'),
  data: z.any().optional().describe('Data to display (if not fetching from API)'),
  layout: z.enum(['vertical', 'horizontal', 'grid']).optional().describe('Layout mode'),
  columns: z.number().optional().describe('Grid columns (for grid layout)'),
  sections: z.array(DetailViewSectionSchema).optional().describe('Field sections for organized display'),
  fields: z.array(DetailViewFieldSchema).optional().describe('Direct fields (without sections)'),
  actions: z.array(z.any()).optional().describe('Actions available in detail view'),
  tabs: z.array(DetailViewTabSchema).optional().describe('Tabs for additional content'),
  // objectui#11355 — declared on both faces. Its producer is `record:details`,
  // which carries its own spec-declared `showHeader` onto the node it builds,
  // so the TS twin takes that row's type by reference. Until then
  // `.passthrough()` kept an authored value unjudged.
  showHeader: z.boolean().optional().describe('Draw the view\'s own heading (title, follow-star, copy-id chip); drawn unless false. record:details sets it from its own showHeader'),
  showBack: z.boolean().optional().describe('Show back button'),
  backUrl: z.string().optional().describe('Back button URL'),
  // RUNTIME SLOT (objectui#7344, the objectui#6182 ruling in the objectui#6124
  // shape): `detail-view` spreads the node's keys onto `DetailView`, whose
  // `handleBack` CALLS `onBack()` — a host-supplied function, never the string
  // this mirror used to accept (which threw `onBack is not a function` at click).
  onBack: handlerKeyRefusal('onBack', 'runtime-slot', 'Custom back action'),
  /**
   * RUNTIME SLOT (objectui#9447, the objectui#6124 shape) — DECLARED on this
   * arm for the first time. The `detail` twin refused this key by name with
   * `7ca6ddd4b`; this arm did not, so `BaseSchemaCore`'s `.passthrough()`
   * KEPT an authored value instead of refusing it and handed it to a call site
   * expecting a function — the same two keys with two different fates decided
   * only by which `type` literal an author wrote.
   *
   * ## The read path, re-derived — there IS a wrapper, and it changes nothing
   *
   * Unlike `'detail'`, which registers `DetailView` RAW, the registration here
   * is `ComponentRegistry.register('detail-view', DetailViewRenderer)`, which
   * interposes a data-source gate. That gate does NOT strip the key:
   * `useElementDataSourceSchema` returns the node UNCHANGED when there is no
   * composed binding, and otherwise returns `{ ...base }` — a shallow spread
   * whose only overwrites are the binding keys (`objectName`, `columns`,
   * `filter`, `sort`, `limit`, `viewType`). `onNavigate` survives BOTH
   * branches, so the authored value reaches `DetailView`'s `schema.onNavigate`
   * BY IDENTITY exactly as under the raw registration, and `handleBack`,
   * `handleEdit` and the post-delete redirect CALL it. Driven end to end
   * through the real `SchemaRenderer` in
   * `detail-view-handler-slots-9447.test.tsx`.
   *
   * ⚠️ `check-handler-key-read-sites.mjs` was GREEN on this key for a reason
   * that said nothing about it, and objectui#9700 ended that. Its walk stopped
   * at the data-source gate — the render-prop child is handed `bound as
   * DetailViewSchema`, and a type-only cast on that attribute closed the hop —
   * so the read site it derives for the `'detail'` registration had no
   * counterpart here and this key was never among its findings, its census or
   * its ledger. It is now: the cast is peeled, `DetailView`'s reads are scored
   * under this arm too, and this declaration is what the gate reads as
   * satisfying them. ⛔ The history still matters when reading an OLD green:
   * before objectui#9700 the gate was not an instrument for this arm at all, and
   * the probe named above is what measured the channel.
   *
   * ⚠️ NOT the nested `recordNavigation.onNavigate`, which is a DIFFERENT key
   * at a different path with a different signature — `(recordId) => void`, the
   * prev/next result-set walker. This refusal is about the MEMBER; the nested
   * one is untouched on both faces. It was never authorable where it lives: its
   * value is a REQUIRED function, which no JSON document can supply, so
   * objectui#6152 round 4 filed `recordNavigation` as a runtime slot by name
   * (`RuntimeOnlyNamedAllowList` in `../__tests__/zod-mirror-parity.test.ts`).
   */
  onNavigate: handlerKeyRefusal('onNavigate', 'runtime-slot', 'SPA navigation callback'),
  /**
   * RUNTIME SLOT (objectui#9447), and a DIFFERENT channel from `onNavigate`
   * above — which is why the disposition is read per key rather than per
   * prefix, the same reading the ruling behind `7ca6ddd4b` demanded on the twin.
   *
   * `DetailView` never calls this one. It FORWARDS it as a React prop into the
   * `<RecordComments>` it renders, whose submit handler awaits it; the forward
   * is itself gated by `schema.comments`, an undeclared key the same
   * passthrough keeps alive. Both legs — the forward and the call at the far
   * end — are driven in the probe named above.
   *
   * ⚠️ `comments` is deliberately NOT declared here, for the reason its twin
   * records: it is not a handler key, declaring it is an accept-set decision of
   * its own, and this card's rows are the handler keys. objectui#6152 round 4
   * made that decision: `comments` (with `activities` and `history`) is runtime
   * data a host fetches, filed by name as runtime-only, so it stays unmirrored.
   */
  onAddComment: handlerKeyRefusal('onAddComment', 'runtime-slot', 'New comment callback'),
  showEdit: z.boolean().optional().describe('Show edit button'),
  editUrl: z.string().optional().describe('Edit button URL'),
  showDelete: z.boolean().optional().describe('Show delete button'),
  deleteConfirmation: z.string().optional().describe('Delete confirmation message'),
  loading: z.boolean().optional().describe('Whether to show loading state'),
  header: SchemaNodeSchema.optional().describe('Custom header content'),
  footer: SchemaNodeSchema.optional().describe('Custom footer content'),
  // objectui#6152 round 3 — six configuration members the interface declared and
  // this mirror had never heard of, each READ by `DetailView` (a type-checker census
  // over every package's sources, not a grep; `defaultTab` through the renderer's own
  // `(schema as any)` cast at its one read site). Restated as the twin declares them.
  primaryField: z.string().optional()
    .describe('Field whose value is the record title in the header; falls back to title'),
  summaryFields: z.array(z.string()).optional()
    .describe('Field names rendered as summary badges next to the header title'),
  autoTabs: z.boolean().optional()
    .describe('Generate Details / Related / Activity tabs when no explicit tabs are configured'),
  defaultTab: z.string().optional()
    .describe('Initially active autoTabs tab (details, related, activity, discussion, history); ignored when that tab does not render'),
  sectionGroups: z.array(DetailViewSectionGroupSchema).optional()
    .describe('Groups of sections, each rendered under a collapsible header'),
  highlightFields: z.array(DetailViewHighlightFieldSchema).optional()
    .describe('Key fields shown prominently in a highlight banner below the header'),
  // objectui#6152 round 4 — declared on the interface and read by NOTHING (a
  // type-checker census over every package's sources, no untyped read, no authored
  // document, no in-code producer). Retired on both faces under ADR-0049
  // enforce-or-remove; a tombstone rather than a deletion because `BaseSchema` is
  // `.passthrough()`, so a deleted arm would KEEP an authored value in silence.
  autoDiscoverRelated: retirementTombstone(
    'RETIRED (objectui#6152, ADR-0049) — nothing ever read `autoDiscoverRelated`: `detail-view` does not '
    + 'discover related lists from reference fields. Delete the key, and author a `record:related_list` '
    + 'block for each related list the record page should show.',
  ),
  /**
   * The DETAIL-VIEW RELATED-LIST REFUSAL (objectui#7997) — `related` retires
   * from `DetailViewSchema` on BOTH faces under ADR-0049 enforce-or-remove
   * (maintainer ruling 2026-09-10; the direction is not re-opened by a later
   * card).
   *
   * ## Why a REFUSAL and not a deletion
   *
   * `BaseSchemaCore` ends `.passthrough()` (and the TypeScript `BaseSchema`
   * closed with an any-valued index signature until objectui#8347), so a
   * dropped MEMBER key is KEPT, not refused, on this face — deleting this declaration would have left the silent
   * accept exactly as it was and thrown the diagnostic away with it.
   * `retirementTombstone` keeps the key DECLARED and unwritable, which is what
   * makes the refusal loud. Same mechanism and same reasoning as the
   * alert-dialog footer refusals (`./overlay.zod.ts`, objectui#7963) and the
   * `PageNodeSchema` arms (`./layout.zod.ts`, `12b599219` / objectui#8871).
   *
   * ## What was measured — the frame is BASE `efead6c60`, stated out loud
   *
   * ZERO PULL, which is the axis that carried the ruling. No application code
   * authored this member. Both internal producers of a `detail-view` node —
   * `RecordDetailDrawer` and `renderers/record-details.tsx` in
   * `@object-ui/plugin-detail` — synthesize the node WITHOUT `related`. The
   * only in-tree authorings carrying real columns were `packages/plugin-detail`'s
   * README and `content/docs/api/schema-reference.md`, both rewritten by the
   * same change to teach `record:related_list`.
   *
   * ⛔ The bare word `related` is worthless as a probe here and fails towards
   * "live": `relatedListColumns`, `autoDiscoverRelated`, `RelatedList`,
   * `record:related_list` and `RelatedRecordActionsContext` are all live and
   * all untouched. The reading is a MEMBER-ACCESS one, and it is the two
   * producers above that make the zero a measurement rather than a miss.
   *
   * ## What did NOT retire
   *
   * The capability. `record:related_list` is the protocol-governed entry
   * (`@objectstack/spec` `RecordRelatedListProps`), it always rendered through
   * the SAME `RelatedList` component this member fed, and it is unchanged here.
   *
   * ⚠️ It is the only DECLARED / protocol-governed entry, ⛔ not the only entry
   * full stop: `plugin-detail/src/index.tsx` still registers a bare
   * `related-list` node against the same component, with untyped `columns`.
   * That registration is out of this card's scope and is untouched.
   */
  related: retirementTombstone(
    '`related` is RETIRED on `detail-view` (objectui#7997, ADR-0049 '
    + 'enforce-or-remove). It was a second, unmirrored entry to a capability the '
    + 'protocol already governs: @objectstack/spec declares no DetailView schema, '
    + 'so this array mirrored nothing and drifted — it declared `columns` as '
    + 'TableColumn objects while the renderer it fed also took bare field names. '
    + 'Author a `record:related_list` block instead: it is the protocol-governed '
    + 'entry (RecordRelatedListProps), its `columns` is an array of field-name '
    + 'strings, and it renders through the same component, so nothing about the '
    + 'result is lost — only the second door.',
  ),
  // objectui#9256 (E3 residual, ruling Q2 A on objectui#8284): the renderer reads NEITHER content
  // channel, so both are refused by name here as on the TypeScript twin, each kept a MEMBER.
  body: retirementTombstone(DETAIL_VIEW_NEITHER_CHANNEL),
  children: retirementTombstone(DETAIL_VIEW_NEITHER_CHANNEL),
});

/**
 * View Switcher Schema
 */
export const ViewSwitcherSchema = BaseSchema.extend({
  type: z.literal('view-switcher'),
  views: z.array(z.object({
    type: ViewTypeSchema.describe('View type'),
    label: z.string().optional().describe('View label'),
    icon: z.string().optional().describe('View icon'),
    schema: SchemaNodeSchema.optional().describe('View schema'),
  })).describe('Available view types'),
  defaultView: ViewTypeSchema.optional().describe('Default/active view'),
  activeView: ViewTypeSchema.optional().describe('Current active view'),
  variant: z.enum(['tabs', 'buttons', 'dropdown']).optional().describe('Switcher variant'),
  position: z.enum(['top', 'bottom', 'left', 'right']).optional().describe('Switcher position'),
  onViewChange: z.string().optional()
    .describe('Event name dispatched on window when the view changes (detail: { view }) — an event NAME, not a callback or a handler expression'),
  persistPreference: z.boolean().optional().describe('Persist view preference'),
  storageKey: z.string().optional().describe('Storage key for persisting view'),
  allowCreateView: z.boolean().optional().describe('Show "+" button to add/create a new view'),
  viewActions: z.array(z.object({
    type: z.enum(['share', 'settings', 'duplicate', 'delete']).describe('Action type'),
    icon: z.string().optional().describe('Action icon'),
  })).optional().describe('Per-view action icons'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `view-switcher` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `activeView`, `allowCreateView`, `defaultView`, `id`, `onViewChange`, '
    + '`persistPreference`, `position`, `storageKey`, `variant`, `viewActions`, `views`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `view-switcher` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `activeView`, `allowCreateView`, `defaultView`, `id`, `onViewChange`, '
    + '`persistPreference`, `position`, `storageKey`, `variant`, `viewActions`, `views`.',
  ),
});

/**
 * Filter UI Schema
 */
export const FilterUISchema = BaseSchema.extend({
  type: z.literal('filter-ui'),
  filters: z.array(z.object({
    field: z.string().describe('Filter field'),
    label: z.string().optional().describe('Filter label'),
    type: z.enum(['text', 'number', 'select', 'multi-select', 'date', 'date-range', 'boolean']).describe('Filter type'),
    operator: retirementTombstone(
      'RETIRED (objectui#10611, ADR-0049) — `filter-ui` never reads a per-filter `operator`: the renderer '
      + 'picks the control from `type` and emits `{ values }` only, a field → value record with no operator '
      + 'in it, and does no matching of its own. An authored value changed nothing the component rendered '
      + 'or emitted. Nothing in this component implements operators, so remove the key; how each value is '
      + 'matched is up to the host that consumes the change.',
    ),
    options: z.array(z.object({ label: z.string(), value: z.any() })).optional().describe('Options for select filter'),
    placeholder: z.string().optional().describe('Placeholder'),
  })).describe('Available filters'),
  values: z.record(z.string(), z.any()).optional().describe('Current filter values'),
  onChange: z.string().optional()
    .describe('Event name dispatched on window when the filters change (detail: { values }) — an event NAME, not a callback or a handler expression'),
  showClear: z.boolean().optional().describe('Show clear button'),
  showApply: z.boolean().optional().describe('Show apply button'),
  layout: z.enum(['inline', 'popover', 'drawer']).optional().describe('Filter layout'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `filter-ui` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `filters`, `layout`, `onChange`, `showApply`, `showClear`, `values`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `filter-ui` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `filters`, `layout`, `onChange`, `showApply`, `showClear`, `values`.',
  ),
});

/**
 * Sort UI Schema
 */
export const SortUISchema = BaseSchema.extend({
  type: z.literal('sort-ui'),
  fields: z.array(z.object({
    field: z.string().describe('Field name'),
    label: z.string().optional().describe('Field label'),
  })).describe('Sortable fields'),
  sort: z.array(z.object({
    field: z.string().describe('Field to sort by'),
    direction: z.enum(['asc', 'desc']).describe('Sort direction'),
  })).optional().describe('Current sort configuration'),
  onChange: z.string().optional()
    .describe('Event name dispatched on window when the sort changes (detail: { sort }) — an event NAME, not a callback or a handler expression'),
  multiple: z.boolean().optional().describe('Allow multiple sort fields'),
  variant: z.enum(['dropdown', 'buttons']).optional().describe('UI variant'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `sort-ui` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `fields`, `multiple`, `onChange`, `sort`, `variant`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `sort-ui` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `fields`, `multiple`, `onChange`, `sort`, `variant`.',
  ),
});

/** objectui#11440 / objectui#9256: ONE refusal string for both content channels of `DetailSectionNodeSchema`. */
const DETAIL_SECTION_NEITHER_CHANNEL =
  'REFUSED (objectui#9256, ADR-0049) — `detail-section` reads NEITHER content channel: its registration hands the '
  + 'node to `DetailSectionNode`, which folds the declared inputs into the one `section` object `DetailSection` '
  + 'draws, and neither reads `children` or `body`; `SchemaRenderer` strips both out of the props bag it spreads. '
  + 'An authored value would render NOTHING — no render-time error or warning and no element; only the parser '
  + 'tier\'s `not-a-container` warning (objectui#9910) noticed it (the registration declares no `children` input). '
  + 'What it renders instead: a titled section of `fields`, laid out in '
  + '`columns`.';

/**
 * `detail-section` — one field section as a node (objectui#11440, under the
 * seat ruling `5945530142` on objectui#10859: "taught by the plugin-detail
 * README, refused at `tabs.0.content` today").
 *
 * ## The defect this closes
 *
 * `@object-ui/plugin-detail` registers `detail-section` (`DetailSectionNode`),
 * and its README teaches the node inside a `detail-view` tab's `content`. No
 * arm claimed the literal, so `safeValidateSchema` refused that document at
 * `tabs.0.content` with `invalid_union` at the nested `type`.
 *
 * ## Why a node of its own, and not `record:details` sections
 *
 * The card allowed folding it into `record:details`'s `properties.sections`
 * "if measurement shows that is the same shape". It does not: the spec's
 * `record:details` section (`ComponentPropsMap['record:details']`) names its
 * heading `label`, takes `fields` as bare field NAMES and carries `name` /
 * `group`, while this node names its heading `title` and takes `fields` as
 * `DetailViewField` objects (`{ name, label, … }`). Measured: the spec's row
 * refuses the README's section with `unrecognized_keys` on `title` and
 * `invalid_type` on each field object.
 *
 * ## The members
 *
 * Exactly the registration's `inputs` — the ten names `DetailSectionNode`
 * folds (`DETAIL_SECTION_NODE_INPUTS`): {@link DetailViewSectionSchema}'s own
 * members, by reference, flat on the node as the registration publishes them.
 * `fields` is required there, so it is required here. `name` and `visible` are
 * not section members on this node (`DetailSection` reads neither), so they
 * keep `BaseSchema`'s node-level meaning. Neither content channel is read, so
 * both are refused by name (objectui#9256).
 */
export const DetailSectionNodeSchema = BaseSchema.extend({
  type: z.literal('detail-section'),
  ...DetailViewSectionSchema.pick({
    title: true,
    description: true,
    icon: true,
    fields: true,
    collapsible: true,
    defaultCollapsed: true,
    columns: true,
    showBorder: true,
    headerColor: true,
    hideEmpty: true,
  }).shape,
  body: retirementTombstone(DETAIL_SECTION_NEITHER_CHANNEL),
  children: retirementTombstone(DETAIL_SECTION_NEITHER_CHANNEL),
});

/**
 * Union of all view schemas
 */
const ViewComponentSchemaInferred = z.discriminatedUnion('type', [
  DetailViewSchema,
  ViewSwitcherSchema,
  FilterUISchema,
  SortUISchema,
  // objectui#11440 — one field section as a node.
  DetailSectionNodeSchema,
]);

/**
 * The TYPE of {@link ViewComponentSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface ViewComponentZodType extends ViewComponentSchemaInferredType {
  options: ViewComponentSchemaInferredType['options'];
}
type ViewComponentSchemaInferredType = typeof ViewComponentSchemaInferred;

/** The union above, typed by its named {@link ViewComponentZodType}. */
export const ViewComponentSchema: ViewComponentZodType = ViewComponentSchemaInferred;

/**
 * Export type inference helpers
 */
export type ViewTypeSchemaType = z.infer<typeof ViewTypeSchema>;
export type DetailViewFieldSchemaType = z.infer<typeof DetailViewFieldSchema>;
export type DetailViewSectionSchemaType = z.infer<typeof DetailViewSectionSchema>;
export type DetailViewTabSchemaType = z.infer<typeof DetailViewTabSchema>;
export type DetailViewSchemaType = z.infer<typeof DetailViewSchema>;
export type ViewSwitcherSchemaType = z.infer<typeof ViewSwitcherSchema>;
export type FilterUISchemaType = z.infer<typeof FilterUISchema>;
export type SortUISchemaType = z.infer<typeof SortUISchema>;
