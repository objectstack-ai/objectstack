/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Record Component Schemas
 *
 * Type definitions for record:* page components.
 * Aligned with @objectstack/spec RecordDetailsProps, RecordRelatedListProps,
 * RecordHighlightsProps, RecordActivityProps, RecordChatterProps, RecordPathProps.
 *
 * @module record-components
 * @packageDocumentation
 */

import type { ElementDataSource, EmptyState, I18nLabel, ViewFilterRule } from '@objectstack/spec/ui';

/**
 * ARIA props shared across all record components.
 * Aligned with @objectstack/spec `AriaPropsSchema`.
 *
 * Every `record:*` block below carries this bag under its own `aria` key,
 * because the protocol's own props schema for that block does
 * (`RecordDetailsProps`, `RecordHighlightsProps`, `RecordRelatedListProps`,
 * `RecordActivityProps`, `RecordChatterProps`, `RecordPathProps` — each one
 * declares `aria`). ⛔ Nothing here writes that list down: which blocks declare
 * it, and which member spellings the shared shape accepts, are re-derived from
 * the INSTALLED artifact on every run by the pin that consumes this bag —
 * `@object-ui/plugin-detail`'s
 * `src/renderers/__tests__/recordComponentAria-9556.test.tsx` — which reads them
 * off `@objectstack/spec/ui` rather than restating them (AGENTS.md #9). The
 * package is named because the instrument is NOT in this one: this docblock
 * ships in this package's `dist/index.d.ts`, so a consumer following it needs
 * to know where to look.
 *
 * ## `ariaLabel` is the INLINE locale vocabulary, not a plain string
 *
 * This member restated the contract's key as a bare `string` until
 * objectui#9556. `AriaPropsSchema.ariaLabel` is
 * `z.union([z.string(), InlineLocaleMapSchema])` — a plain string **or** an
 * inline per-locale map like `{ en: 'Deal stages', 'zh-CN': '阶段' }` — so the
 * restatement was a NARROWING: a map-valued name parsed green at publish and
 * `tsc` refused it here. That is precisely Group A of objectui#7759, which
 * objectui#9092 repaired at three sites (`AppComponentSchema.label`,
 * `ObjectGridSchema.label`/`.description`, `PageNodeSchema.aria.ariaLabel`);
 * this bag is the fourth site of the same group, missed there because it is
 * reached through a shared interface rather than restated inline.
 *
 * ⚠️ Read it with the INLINE resolver — the spec's own
 * `resolveI18nLabel(label, locale)`. The FLAT `BaseSchema.ariaLabel` one
 * level up is objectui's OTHER vocabulary (the KEYED
 * `{ key, defaultValue?, params? }` reference, resolved by
 * `resolveKeyedI18nLabel` in `SchemaRenderer`), and neither resolver accepts
 * the other's shape. objectui#9092's changeset records why a wrong slot costs
 * a wrong ANSWER rather than a refusal, which is the harder failure to see.
 *
 * ## `label` is NOT a member of this bag, and must not be added
 *
 * `label` is the shared ARIA shape's ALIAS ENTRY — a rename prescription
 * pointing at `ariaLabel`, which exists to produce a better rejection message
 * and is never accepted. Declaring it here would declare a spelling the
 * contract refuses on parse. ⛔ No renderer reads it as a name. `record:path`
 * and `record:quick_actions` used to fold it in behind the canonical spelling,
 * as back-compat for documents written before the shape closed; objectui#9945
 * retired that fold. Those two blocks now REPORT a served `label` and announce
 * their default name. See `@object-ui/plugin-detail`'s
 * `renderers/recordComponentAria.ts`, whose own pin asserts the refusal on
 * every block, so this paragraph is checked rather than merely written.
 */
export interface RecordComponentAriaProps {
  /**
   * Accessible name for the block's own container. Plain string, or the spec's
   * inline per-locale map — resolve with `resolveI18nLabel`, ⛔ never by
   * assigning it into a string position (an unresolved map reaches the DOM as
   * `[object Object]`, and an `aria-label` position is one of the sinks a
   * compiler does flag — the untyped ones are not).
   */
  ariaLabel?: string | I18nLabel;
  /** `id` of the element that describes this block, for `aria-describedby`. */
  ariaDescribedBy?: string;
  /**
   * ARIA role for the block's own container, overriding the role the block
   * renders by default.
   */
  role?: string;
}

// ============================================================================
// record:details — Record Detail Panel
// ============================================================================

/**
 * Props for the record:details page component.
 * Displays a record's fields in a structured detail layout.
 * Aligned with @objectstack/spec RecordDetailsProps.
 */
export interface RecordDetailsComponentProps {
  /**
   * Field-grid width for the WHOLE body, as the STRING the contract declares
   * (`@objectstack/spec` `RecordDetailsProps.columns` is
   * `z.enum(['1','2','3','4'])`, schema default `'2'`).
   *
   * It was `number` here until objectui#8604, which is the wrong PRIMITIVE
   * TYPE, not merely a wider range: `{ columns: 2 }` compiled locally and the
   * contract refused it at publish with `invalid_value` at `columns` (measured
   * on the installed pin, 18.1.0, against a control — `columns: '2'` — that
   * parses green on the same instrument). Contract-first (Commandment #0.1):
   * the code moves to the contract's spelling, and today's `columns: 2`
   * authors are the defect surfacing rather than collateral damage.
   *
   * WARNING — this is NOT the spelling `sections[].columns` uses one level
   * down. That key is `z.number().int().min(1).max(4)`, so a section takes the
   * NUMBER `2` and refuses the string, exactly inverting this key. The same
   * word names two different types one level apart; copying either declaration
   * onto the other is refused at publish. See the `columns` member on the
   * `sections[]` entry below, and
   * `__tests__/record-details-columns-8604.test.ts`, which pins both directions
   * against the installed spec.
   */
  columns?: '1' | '2' | '3' | '4';
  /** Sections to organize fields */
  sections?: Array<{
    /** Stable identifier for i18n key resolution (e.g. 'info', 'forecast'). */
    name?: string;
    /**
     * Section heading — the spec's `I18nLabel`
     * (`RecordDetailsProps.sections[].label`): a plain string or an inline
     * per-locale map such as `{ en: 'Overview', 'zh-CN': '概览' }`.
     * `RecordDetailsRenderer` resolves a map with `pickLocalized` against the
     * UI language; a named section's bundle key
     * (`objects.OBJECT._sections.NAME.label`) still outranks the authored text.
     *
     * Typed `string` until objectui#10993 (batch 4), a NARROWING: the contract
     * and the renderer both took the map while `tsc` refused it here. This
     * file's four `I18nLabel` members widened together (this one,
     * `RecordRelatedListComponentProps.title` and `.add.label`,
     * `RecordPathComponentProps.stages[].label`), and
     * `__tests__/record-components-i18n-label-members-10993.test.ts` holds all
     * four to the spec's type.
     */
    label?: I18nLabel;
    /**
     * Field names shown in this section, in order.
     *
     * OPTIONAL since objectui#8497, and optional ONLY in the sense that
     * `group` below is the other way to declare the same fact —
     * `@objectstack/spec` refuses a section carrying neither (and refuses one
     * carrying both). It was required here while `RecordDetailsRenderer` read
     * `group` nowhere, so this type refused the exact shape the spec declares
     * and a TypeScript author could not write the group-reference form at all.
     */
    fields?: string[];
    /**
     * Reference a declared field GROUP instead of enumerating members
     * (`@objectstack/spec` 17.3.0, objectstack#13855, ADR-0085 §5).
     *
     * `{ group: 'contact_info' }` inherits the object's `fieldGroups` entry
     * with that key — its members and its presentation (label, icon,
     * description, collapse) both. Mutually exclusive with `fields` and with
     * every key the group itself declares; a page keeps only `columns`,
     * `showBorder` and `headerColor`, which describe how THIS page lays the
     * section out.
     */
    group?: string;
    /**
     * Field-grid columns for THIS section, an integer 1-4
     * (`@objectstack/spec` `RecordDetailsProps.sections[].columns`). Omit it
     * and `DetailSection` derives the width from the field count. Permitted
     * beside `group`: it describes how this page lays the section out, not
     * anything the group itself declares.
     *
     * WARNING — `number` is correct HERE and only here (objectui#8604): the
     * per-section key is `z.number().int().min(1).max(4)`, while the body-wide
     * `columns` at the top of this interface is a string enum. A section
     * carrying `columns: '2'` is refused with `invalid_type` at
     * `sections.N.columns`; the top-level key refuses `2`. Two types, one word,
     * one level apart.
     */
    columns?: number;
    /**
     * Heading icon, a lucide name (`sections[].icon`). `DetailSection` draws it
     * wherever the heading renders: a titled section, or any collapsible one.
     * Refused beside `group` — the group's own `icon` applies there.
     */
    icon?: string;
    /**
     * Sub-heading text under the section heading (`sections[].description`).
     * `DetailSection` renders it as-is, with no translation lookup, unlike
     * `label`; a collapsible section hides it while collapsed. Refused beside
     * `group`.
     */
    description?: string;
    /**
     * Draw the section's Card chrome (`sections[].showBorder`). Unauthored,
     * `RecordDetailsRenderer` derives it — on for a titled section, off for an
     * untitled one; an authored value wins. Permitted beside `group`.
     */
    showBorder?: boolean;
    /**
     * Start a `collapsible: true` section collapsed
     * (`sections[].defaultCollapsed`). `DetailSection` reads it once, as the
     * initial open state; a non-collapsible section never reads it. Refused
     * beside `group`.
     */
    defaultCollapsed?: boolean;
    /**
     * Section-header background tint (`sections[].headerColor`): the closed
     * six-token vocabulary `DetailSection` resolves through `headerColorClass`.
     * The contract refuses any other value at authoring time rather than
     * silently not painting. Permitted beside `group`.
     */
    headerColor?:
      | 'muted'
      | 'muted/50'
      | 'accent'
      | 'primary/10'
      | 'secondary/10'
      | 'destructive/10';
    /**
     * Hide this section's empty fields (`sections[].hideEmpty`, `z.boolean()`
     * on the spec row since 17.3.0). Unauthored, `RecordDetailsRenderer` reads
     * it as on (`s.hideEmpty ?? true`), and a section whose fields are ALL
     * empty then renders nothing; `false` keeps the empty rows and the
     * section's heading skeleton. Permitted beside `group`.
     *
     * Missing here until objectui#12348: the spec declared it and the renderer
     * honoured it, so this published face was the one layer that gave a
     * spec-valid section TS2353. objectui#7129's refusal premise was superseded
     * by the objectui#8603 ruling — objectui follows the protocol.
     */
    hideEmpty?: boolean;
    collapsible?: boolean;
    /**
     * Show how many values a multi-value field holds in this section's heading
     * (`@objectstack/spec` 18 `RecordDetailsProps.sections[].count`,
     * objectui#12192). `field` names the field by its machine name, and
     * `label` writes the `{{ count }}` hole where the number goes:
     * `{ label: '{{ count }} tags', count: { field: 'tags' }, fields: ['tags'] }`.
     * `RecordDetailsRenderer` fills the hole after the heading is translated;
     * an absent or empty value counts 0. The spec refuses `count` beside
     * `group`, without a `label`, and on a label with no hole.
     */
    count?: { field: string };
  }>;
  /** Specific fields to display (overrides auto-detection from object) */
  fields?: string[];
  /**
   * Field names to OMIT from the body — applied to `fields` above and to every
   * section's `fields` (`@objectstack/spec` `RecordDetailsProps.hideFields`,
   * `z.array(z.string())`). It is how a page stops repeating the fields already
   * shown in `record:highlights` or as the page title.
   *
   * Bare field NAMES only, deliberately. `RecordDetailsRenderer` also tolerates
   * `{name}` / `{field}` entries at its read site, but the contract declares
   * `z.array(z.string())` and refuses those values on parse — declaring them
   * here would publish a second dialect the contract rejects (Commandment
   * #0.1). The registry manifest holds the same fence.
   *
   * Declared here since objectui#9040. Every other layer already declared it —
   * the spec, `RecordDetailsRenderer` (`renderers/record-details.tsx`, in the
   * highlight-dedup path) and `@object-ui/plugin-detail`'s registry manifest
   * (objectui#3808) — so this published TypeScript face was the one layer that
   * gave a spec-valid, renderer-honoured, registry-published document `TS2353`.
   */
  hideFields?: string[];
  /**
   * Allow inline field editing in the detail body
   * (`@objectstack/spec` `RecordDetailsProps.inlineEdit`, `z.boolean()`).
   *
   * There is no schema default: the RENDERER's default is on, ANDed with the
   * object's own editability and with the server's effective `apiOperations`,
   * so `undefined` is not the same fact as `false`. `false` force-disables the
   * affordance whatever the object permits (`schema.inlineEdit ?? true` at
   * `renderers/record-details.tsx`).
   *
   * Declared here since objectui#9040, with `showHeader` below — the two keys
   * `@objectstack/spec` 17.0.0 GA added to this block, already declared by the
   * registry manifest under objectui#4668.
   */
  inlineEdit?: boolean;
  /**
   * Render the detail body's OWN heading
   * (`@objectstack/spec` `RecordDetailsProps.showHeader`, `z.boolean()`).
   *
   * Renderer default off (`schema.showHeader ?? false`), because a
   * `record:details` composed under a `page:header` would otherwise draw a
   * second title/star/copy chip beside the page's own.
   *
   * Declared here since objectui#9040 (see `inlineEdit` above).
   */
  showHeader?: boolean;
  /**
   * Fold the body's field list through the viewer's FIELD-read permissions
   * before rendering (`@objectstack/spec` `RecordDetailsProps.enforceFieldSecurity`,
   * `z.boolean()`, optional). Renderer default off: `RecordDetailsRenderer`
   * reads it as `=== true`. Presentation only — it re-applies the field-read
   * answer the server already enforced and never widens access.
   *
   * This key and the two below are the field-security triple, declared here by
   * objectui#8649 once `@objectstack/spec` 17.5.0 declared all three on
   * `record:details`, `record:highlights` and `record:related_list`
   * (objectstack#18159). The renderer honoured them before either declaration,
   * through a cast; this ALIGNS THE MIRROR to the contract and moves no runtime
   * behaviour. `renderers/__tests__/detailRendererUndeclaredKeys-8649.test.ts`
   * in `@object-ui/plugin-detail` re-derives the contract side every run.
   */
  enforceFieldSecurity?: boolean;
  /**
   * Field names this block never renders from its authored `fields` and
   * `sections[].fields`, whatever the permission answer
   * (`@objectstack/spec` `RecordDetailsProps.redactFields`,
   * `z.array(z.string())`, optional). Bare field NAMES only. Presentation only:
   * the values are still fetched into the page, so this is not a data-access
   * control. See `enforceFieldSecurity` above for the declaration's standing.
   */
  redactFields?: string[];
  /**
   * ADR-0066 capability names the viewer must ALL hold, or the block renders an
   * insufficient-permissions notice in place of its content
   * (`@objectstack/spec` `RecordDetailsProps.requiredPermissions`,
   * `z.array(z.string())`, optional — the shape and describe it shares with
   * `record:quick_actions`). Capabilities are what permission sets grant through
   * `systemPermissions`, not object actions. Presentation only, and it fails
   * open where the client cannot resolve the viewer's capabilities. See
   * `enforceFieldSecurity` above for the declaration's standing.
   */
  requiredPermissions?: string[];
  /**
   * What the block draws in its place when its node-level `dataSource`
   * binding answers no row (`@objectstack/spec` `RecordDetailsProps.emptyState`, the list
   * view's own `EmptyStateSchema` by reference — objectstack#24266). Drawn
   * only for a bound block whose read settled with no row; never while the
   * read loads, in place of a failed read's error, or on an unbound block.
   * Omitted, the block keeps its own no-record placeholder (objectui#12932).
   */
  emptyState?: EmptyState;
  /** ARIA accessibility attributes */
  aria?: RecordComponentAriaProps;
}

// ============================================================================
// record:highlights — Key Field Summary
// ============================================================================

/**
 * Props for the record:highlights page component.
 * Shows key fields as a summary/highlights panel (e.g., top of detail page).
 * Aligned with @objectstack/spec RecordHighlightsProps.
 */
export interface RecordHighlightsComponentProps {
  /**
   * Fields to display as highlights — bare names or
   * `{name,label?,type?,readonly?}` for inline overrides, as the CLOSED SET
   * the contract declares.
   *
   * `readonly: true` suppresses the chip's inline-edit affordance
   * (objectstack#5077) without touching the object field, which is what
   * hook-maintained columns need: marking the object field `readonly` would
   * also strip the hook's own write-back.
   *
   * The object arm offered a fifth key, `icon`, until objectui#9280, and the
   * contract never accepted it. `@objectstack/spec`
   * `RecordHighlightsProps.fields[]`'s object arm declares exactly
   * `name`/`label`/`type`/`readonly` and carries a `never` catchall, i.e. it is
   * `$strict`: an unlisted key is REFUSED, not stripped, and the refusal takes
   * the WHOLE document with it. Measured on the installed pin, 18.1.0,
   * `RecordHighlightsProps.safeParse({ fields: [{ name: 'x', icon: 'star' }] })`
   * is RED with `invalid_union` at `fields.0`. So `{ name: 'amount', icon:
   * 'dollar-sign' }` type-checked here and was refused at the door — a green
   * local build and a rejection at the only layer that matters. Three controls
   * on the same instrument fired as they should: a declared key
   * (`{ name, label }`) parses green, so the arm is not refusing everything; an
   * arbitrary key (`zzzNonsense`) is refused with the SAME `invalid_union`
   * code, so `icon` was not special-cased; and the bare-string arm parses
   * green, so only the object arm moved. Contract-first (Commandment #0.1):
   * the declaration moves to the contract, the contract is not widened.
   *
   * ⚠️ Whether a highlight chip SHOULD be able to carry an icon is a separate
   * question this narrowing does not answer. The route for it is an upstream
   * spec widening (an `@objectstack/spec` decision, on its own card), ⛔ never
   * a redeclaration here.
   *
   * ⚠️ Do NOT copy this retirement onto `sections[].icon` one screen up. That
   * is a DIFFERENT key on a different face — `DetailSection` genuinely draws
   * it and the contract declares it — the same word, not the same member.
   * `__tests__/record-highlights-fields-icon-9280.test.ts` pins this arm
   * against the installed spec in both directions.
   */
  fields: Array<
    string | { name: string; label?: string; type?: string; readonly?: boolean }
  >;
  /**
   * Layout mode for the highlights strip, as the CLOSED SET the contract
   * declares (`@objectstack/spec` `RecordHighlightsProps.layout` is
   * `z.enum(['horizontal','vertical'])` behind a `.default('horizontal')`).
   *
   * It offered a third value, `grid`, until objectui#9187, and the contract
   * never accepted it: measured on the installed pin, 18.1.0,
   * `RecordHighlightsProps.safeParse({ fields: ['name'], layout: 'grid' })` is
   * RED with `invalid_value` at `layout`. So `{ layout: 'grid' }` type-checked
   * here and was refused at the door — a green local build and a rejection at
   * the only layer that matters. Two controls on the same instrument fired as
   * they should: an arbitrary value is refused with the SAME code, so `grid`
   * was not special-cased, and omitting the key parses green, so the schema is
   * not refusing everything. Contract-first (Commandment #0.1): the
   * declaration moves to the contract, the contract is not widened.
   *
   * Every other layer already agreed with the contract — `@object-ui/plugin-detail`
   * publishes `enum: ['horizontal', 'vertical']` for this input in its registry
   * manifest, and `RecordHighlightsRenderer` reads no `layout` at all. This
   * declaration was the last live holdout of the spelling.
   *
   * ⚠️ Do NOT copy this set onto the `layout` one interface up. That one is a
   * tombstone the contract refuses BY NAME (objectui#9040, still open) — the
   * same word, a different divergence, a different repair.
   * `__tests__/record-highlights-layout-9187.test.ts` pins this union against
   * the installed spec in both directions.
   */
  layout?: 'horizontal' | 'vertical';
  /**
   * Fold the highlight chips through the viewer's FIELD-read permissions before
   * rendering (`@objectstack/spec` `RecordHighlightsProps.enforceFieldSecurity`,
   * `z.boolean()`, optional). Renderer default off. Presentation only — the
   * server has already applied the same field-read answer. One of the
   * field-security triple objectui#8649 aligned; see
   * `RecordDetailsComponentProps.enforceFieldSecurity` for the declaration's
   * standing.
   */
  enforceFieldSecurity?: boolean;
  /**
   * Field names this strip never renders as a chip, whatever the permission
   * answer (`@objectstack/spec` `RecordHighlightsProps.redactFields`,
   * `z.array(z.string())`, optional). Bare field NAMES only. Presentation only:
   * the values are still fetched into the page.
   */
  redactFields?: string[];
  /**
   * ADR-0066 capability names the viewer must ALL hold, or the strip renders an
   * insufficient-permissions notice in place of its chips
   * (`@objectstack/spec` `RecordHighlightsProps.requiredPermissions`,
   * `z.array(z.string())`, optional). Presentation only, and it fails open
   * where the client cannot resolve the viewer's capabilities.
   */
  requiredPermissions?: string[];
  /**
   * What the block draws in its place when its node-level `dataSource`
   * binding answers no row (`@objectstack/spec` `RecordHighlightsProps.emptyState`, the list
   * view's own `EmptyStateSchema` by reference — objectstack#24266). Drawn
   * only for a bound block whose read settled with no row; never while the
   * read loads, in place of a failed read's error, or on an unbound block.
   * Omitted, the block keeps its own no-record placeholder (objectui#12932).
   */
  emptyState?: EmptyState;
  /** ARIA accessibility attributes */
  aria?: RecordComponentAriaProps;
}

// ============================================================================
// record:related_list — Related Records Table
// ============================================================================

/**
 * Props for the record:related_list page component.
 * Displays a list of related records via a relationship field.
 * Aligned with @objectstack/spec RecordRelatedListProps.
 */
export interface RecordRelatedListComponentProps {
  /** Related object name */
  objectName: string;
  /** Field on the related object that links back to this record */
  relationshipField: string;
  /**
   * Parent-record field whose value `relationshipField` stores — the spec's own
   * wording. Defaults to `'id'`; `'name'` for a name-keyed junction.
   *
   * Declared here by objectui#8649. The contract has always declared it
   * (`@objectstack/spec` `RecordRelatedListProps.relationshipValueField`,
   * `z.string().default('id')`), `RecordRelatedListRenderer` has always read it,
   * and `@object-ui/plugin-detail`'s registry has published it as an input since
   * objectui#3808 — every layer declared it except this published TypeScript
   * face, so a spec-valid, renderer-honoured, registry-published document was
   * refused here with `TS2353`. That is objectui#9040's Direction 1, one
   * interface over. Declaring it ALIGNS THE MIRROR rather than widening it: the
   * accept set of this face moves to the contract's, never past it.
   */
  relationshipValueField?: string;
  /**
   * The PARENT record this list hangs off, bound by a query of its own — the
   * spec's `RecordRelatedListProps.parentDataSource`, the object binding
   * (`ElementDataSourceSchema`) by reference: `{ object, view?, filter?,
   * sort?, limit? }`.
   *
   * Read by the single-record rule (ruling B on objectui#12296): the FIRST row
   * of the bound set by its `sort` is the parent (declare `limit: 1`), and
   * `relationshipValueField` is read on that row. When no row answers, the
   * block draws a loud absence in its place, never an empty list. Absent, the
   * parent is the record page's record context.
   *
   * ⛔ Not the node-level `dataSource`: that binding is the CHILD rows the list
   * draws (objectstack#6953), and it is never read as the parent.
   */
  parentDataSource?: ElementDataSource;
  /** Columns to display in the related list */
  columns?: string[];
  /** Sort configuration — `'field'` / `'-field'` string or explicit array (spec union) */
  sort?: string | Array<{ field: string; order: 'asc' | 'desc' }>;
  /**
   * Number of records to display per page. Spec default: 5 (the renderer
   * applies it when the node didn't pass through a zod parse).
   */
  limit?: number;
  /**
   * The list's own scope: the protocol's rule array
   * (`@objectstack/spec` `RecordRelatedListProps.filter`,
   * `z.array(ViewFilterRuleSchema)`, "Additional filter criteria for related
   * records"), ANDed with the parent relationship and never substituted for it.
   *
   * ## Why this face carries the array and the consumer carries a union
   *
   * `@object-ui/plugin-detail`'s `RelatedList` types the same key
   * `ViewFilterRule[] | FilterNode`, and it keeps that union on purpose
   * (objectui#10199, ruled protocol first). The `FilterNode` half is a RUNTIME
   * value: `ElementDataSourceGate` writes the composed component-AND-view-AND-
   * binding filter onto this key after it resolves a `dataSource` binding, and
   * that write goes through the gate's own untyped schema copy, never through
   * this interface. The composed node is not a shape an author writes, so the
   * authoring face does not publish it. Authoring the AST, a MongoDB-style
   * record or an array of tuples here is refused by `tsc`, as the protocol's
   * parse refuses it: author the rule array; the composed node is runtime-only.
   *
   * This declaration was `any` until objectui#10199, so the face an author (or
   * an AI writing metadata) reads said "anything" for a key the protocol
   * constrains. objectui#9964 moved `add.picker.filter` below for the same
   * reason; there the consumer already agreed with the protocol, here only the
   * authoring half does.
   */
  filter?: ViewFilterRule[];
  /**
   * Section title — the spec's `I18nLabel` (`RecordRelatedListProps.title`), a
   * plain string or an inline per-locale map. `RecordRelatedListRenderer`
   * resolves a map with `pickLocalized` against the UI language, ahead of the
   * related object's label. Typed `string` until objectui#10993 (batch 4); see
   * `RecordDetailsComponentProps.sections[].label` for the four members that
   * widened together.
   */
  title?: I18nLabel;
  /** Show "View All" link */
  showViewAll?: boolean;
  /** Available actions for the related list */
  actions?: string[];
  /**
   * Add-existing-via-picker config (generic m2m/junction assignment). Pick
   * records from `add.picker.object` and create link rows in `objectName`
   * (`{[relationshipField]: parentId, [add.linkField]: pickedId}`), or omit
   * `linkField` to re-parent the picked 1:m child. Mirrors the spec
   * RecordRelatedListProps.add.
   */
  add?: {
    /**
     * `picker.filter` is the protocol's own `z.array(ViewFilterRuleSchema)`
     * ("Restrict which records the picker offers"), and this face mirrors that
     * declaration rather than restating it as `unknown` (objectui#9964).
     *
     * ## Why the mirror moved and the consumer's guard did not
     *
     * The sole consumer — `@object-ui/plugin-detail`'s `RelatedList`, which
     * hands this value to `RecordPickerDialog`'s `baseFilter` VERBATIM — has
     * typed the same key as `ViewFilterRule[]` on purpose since objectui#3831
     * ("a looser type here is where a wrong shape would hide"). So the two
     * declarations of one key disagreed, with the LOOSER one on the authoring
     * face: an author (or an AI writing metadata) read "anything" for a key
     * whose consumer demands a shape. Four `(schema as any).add` reads in that
     * package's `record-related-list` renderer kept any compiler from saying
     * so; objectui#9964 removed them, so this declaration now reaches the read.
     *
     * Tightening here narrows nothing an author could publish: the protocol
     * declares the array form and its `strictObject` refuses every other shape
     * at parse today. This is a narrowing being UNDONE, and it is the
     * contract-first direction AGENTS.md #0.1 requires — the producer moves to
     * the contract, never the renderer to a lenient dialect.
     */
    picker: { object: string; valueField?: string; labelField?: string; filter?: ViewFilterRule[] };
    linkField?: string;
    /**
     * The Add button's text — the spec's `I18nLabel`
     * (`RecordRelatedListProps.add.label`, default "Add"). The renderer resolves
     * a map with `pickLocalized` against the UI language before it hands `add`
     * to `RelatedList`. Typed `string` until objectui#10993 (batch 4); see
     * `RecordDetailsComponentProps.sections[].label`.
     */
    label?: I18nLabel;
  };
  /**
   * Fold this list's authored `columns` through the viewer's FIELD-read
   * permissions on the RELATED object before rendering
   * (`@objectstack/spec` `RecordRelatedListProps.enforceFieldSecurity`,
   * `z.boolean()`, optional). Renderer default off. Presentation only — the
   * rows are fetched either way and the server still decides every value. One
   * of the field-security triple objectui#8649 aligned; see
   * `RecordDetailsComponentProps.enforceFieldSecurity` for the declaration's
   * standing.
   */
  enforceFieldSecurity?: boolean;
  /**
   * Field names this list never renders, whatever the permission answer — the
   * authored `columns` and the columns the list derives for itself when none
   * are authored (`@objectstack/spec` `RecordRelatedListProps.redactFields`,
   * `z.array(z.string())`, optional). Bare field NAMES only. Presentation only:
   * the values are still fetched into the page.
   */
  redactFields?: string[];
  /**
   * ADR-0066 capability names the viewer must ALL hold, or the list renders an
   * insufficient-permissions notice in place of its rows
   * (`@objectstack/spec` `RecordRelatedListProps.requiredPermissions`,
   * `z.array(z.string())`, optional). Presentation only, and it fails open
   * where the client cannot resolve the viewer's capabilities. Separate from
   * the automatic read gate on the related object, which this key neither
   * replaces nor widens.
   */
  requiredPermissions?: string[];
  /** ARIA accessibility attributes */
  aria?: RecordComponentAriaProps;
}

// ============================================================================
// record:activity — Activity Timeline
// ============================================================================

/**
 * Props for the record:activity page component.
 * Displays an activity feed/timeline for a record.
 * Aligned with @objectstack/spec RecordActivityProps.
 */
export interface RecordActivityComponentProps {
  /** Activity types to display */
  types?: string[];
  /** Filter mode for activity types */
  filterMode?: string;
  /** Show filter toggle UI */
  showFilterToggle?: boolean;
  /** Maximum activities to display */
  limit?: number;
  /** Show completed/resolved activities */
  showCompleted?: boolean;
  /** Merge all activity types into a single timeline */
  unifiedTimeline?: boolean;
  /** Show comment input box */
  showCommentInput?: boolean;
  /** Enable @mentions in comments */
  enableMentions?: boolean;
  /** Enable emoji reactions on activities */
  enableReactions?: boolean;
  /** Enable threaded comment replies */
  enableThreading?: boolean;
  /** Show subscribe/unsubscribe toggle */
  showSubscriptionToggle?: boolean;
  /** ARIA accessibility attributes */
  aria?: RecordComponentAriaProps;
}

// ============================================================================
// record:chatter — Comments & Discussion
// ============================================================================

/**
 * Props for the record:chatter page component.
 * Provides a chat/discussion panel for a record.
 * Aligned with @objectstack/spec RecordChatterProps.
 */
export interface RecordChatterComponentProps {
  /** Panel position */
  position?: 'bottom' | 'right' | 'left';
  /** Panel width (CSS value) */
  width?: string;
  /** Whether the chatter panel is collapsible */
  collapsible?: boolean;
  /** Whether the chatter panel starts collapsed */
  defaultCollapsed?: boolean;
  /** Activity feed configuration within chatter */
  feed?: RecordActivityComponentProps;
  /** ARIA accessibility attributes */
  aria?: RecordComponentAriaProps;
}

// ============================================================================
// record:path — Record Path / Progress Indicator
// ============================================================================

/**
 * Props for the record:path page component.
 * Displays a progress/stage indicator for the record (e.g., Lead → Qualified → Won).
 * Aligned with @objectstack/spec RecordPathProps.
 */
export interface RecordPathComponentProps {
  /** Field that holds the current status/stage value */
  statusField: string;
  /** Ordered list of stages */
  stages: Array<{
    /** Stage value (matches statusField values) */
    value: string;
    /**
     * Display label for the stage — the spec's `I18nLabel`
     * (`RecordPathProps.stages[].label`), a plain string or an inline
     * per-locale map. `RecordPathRenderer` resolves a map against the UI
     * language before the picklist translation, the won/lost classification
     * and both rails read it. Typed `string` until objectui#10993 (batch 4);
     * see `RecordDetailsComponentProps.sections[].label`.
     */
    label: I18nLabel;
    /**
     * Terminal classification. Stages marked `'won'` render as the
     * success terminus of the forward path; stages marked `'lost'`
     * render as a visually separated alt-terminus (muted / destructive
     * tint) because they break the chevron flow rather than completing
     * it. When omitted, the renderer falls back to a value/label
     * heuristic (matches common lost-state tokens like `closed_lost`,
     * `lost`, `failed`, `cancelled`, `失败`, `流失`).
     */
    terminal?: 'won' | 'lost';
  }>;
  /** ARIA accessibility attributes */
  aria?: RecordComponentAriaProps;
}
