/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `buildDefaultPageSchema` — Pure function that synthesizes a canonical
 * Lightning-style Page schema from an object definition (and optional
 * record data + overrides).
 *
 * This is the foundation of Track 3 "convergence": once
 * `RecordDetailView` synthesizes a Page schema for the no-assignedPage
 * branch and renders via `<SchemaRenderer>`, the default and custom
 * detail paths share a single rendering pipeline. All Phase D/E/F
 * polish (record-aware header chip, chevron path, flush accordion,
 * discussion slot) then applies to every object's default detail page
 * automatically.
 *
 * Phase G slice 1: pure synthesis only. No runtime wiring yet —
 * `RecordDetailView` is not yet calling this. That comes in Phase H
 * once the synthesizer covers enough surface area to reach parity with
 * the existing DetailView output.
 */

import { deriveFieldGroupLayout } from '@objectstack/spec/data';
import type { SelectOptionKind, ServiceObject } from '@objectstack/spec/data';
import { detectStatusField } from '@object-ui/types';
// The retirement gate (objectui#4914, ruling B). `@object-ui/fields`
// re-exports the same function; this module reads it from `@object-ui/core`
// because that is the dependency this package's synth layer already carries
// at this depth, and both spellings resolve to one table and one dedupe set.
import { isRetiredFieldType, reportRetiredFieldType, resolveNameField } from '@object-ui/core';
import { inferDetailColumns } from '../autoLayout';

/** Minimal shape of an object definition we read here. We deliberately
 *  duck-type so this helper has zero hard dependency on a specific
 *  object-schema shape. */
export interface ObjectDefLike {
  name?: string;
  label?: string;
  fields?: Record<string, ObjectDefFieldLike>;
  /** Semantic role (ADR-0085): the linear-lifecycle field driving the
   *  `record:path` stepper. `false` = the status-shaped field is NOT a
   *  linear flow — suppress stage detection entirely (#2065). */
  stageField?: string | false;
  stages?: Array<{ value: any; label: string }>;
  /** Semantic role (ADR-0085): the object's most important fields —
   *  drives the highlight strip (first 4). */
  highlightFields?: string[];
  /**
   * ACCEPTED BUT NEVER READ — do not "tidy" this away (objectui#7287).
   *
   * `primaryField` is a `DetailViewSchema` key (`@object-ui/types` `views.ts`),
   * and reading it off an OBJECT def is the defect objectui#7287 removed:
   * `resolveTitleField` now delegates to `@object-ui/core`'s `resolveNameField`
   * and no code in this module consults this member. No producer can populate
   * it either — `@objectstack/spec`'s object schema is a `strictObject` that
   * answers `unrecognized_keys: ['primaryField']`.
   *
   * It stays declared because this interface is REACHABLE, which is a
   * different question from what it describes: `ObjectDefLike` is re-exported
   * from this package's index and `@object-ui/plugin-detail` is published, so
   * the member is part of a shipped `.d.ts`. Deleting it narrows a published
   * type — an external `const d: ObjectDefLike = { primaryField: 'x' }`
   * compiles today and would stop compiling — and that is a contract change
   * owed its own card, not a rider on a behaviour fix. Retiring it is a
   * deliberate act for someone to take on purpose.
   */
  primaryField?: string;
  /** Optional section grouping for the details region. The heading rides
   *  `label` — the one slot `@object-ui/types` declares (objectui#6190). */
  sections?: Array<{ label?: string; columns?: number; fields?: any[] }>;
  /**
   * Declared field groups from the object designer. Fields opt in via
   * `field.group === group.key`; the detail synthesizer derives sections
   * from them when no explicit sections are provided.
   *
   * DERIVED from the spec's own authorable group, not restated. This key is a
   * pass-through: nothing here reads a member of it, `deriveFieldGroupLayout`
   * (`@objectstack/spec/data`) does — so the set of members this type should
   * admit is by definition the set the spec declares, and hand-listing them
   * could only ever drift from it. It had: the hand-written list this replaces
   * carried `key`/`label`/`collapse` and the deprecated `collapsible`/`collapsed`
   * pair, but not `icon`, `description` or `defaultExpanded`. Two of those three
   * are read by this very file — `deriveFieldGroupDetailSections` passes
   * `s.icon`/`s.description` through to the section descriptors under a comment
   * citing #2548 ("Dropping them here made the spec keys silently inert on
   * detail pages") — so an author declaring the icon the synthesizer honours was
   * rejected by the type of the function that honours it.
   *
   * `Partial` is the one shape difference and it is deliberate: the spec makes
   * `key`/`label` required and `collapse` defaulted, but this is the duck type
   * for a raw object definition that has NOT been through a spec parse (the
   * whole reason it exists — see the interface header), so every member has to
   * be admissible as absent. Nothing here requires a group member to be present.
   */
  fieldGroups?: Array<Partial<NonNullable<ServiceObject['fieldGroups']>[number]>>;
  /**
   * Spec `enable` capability toggles. Only `files` is read here:
   * `enable.files === true` (opt-in, objectstack-ai/objectstack#2727) makes the synthesizer emit an
   * Attachments tab beside Details/Related (objectstack#4358).
   */
  enable?: { files?: boolean; [key: string]: any };
  // NOTE: the per-surface `detail` hints block was REMOVED from the spec by
  // ADR-0085 — presentation intent is declared via the top-level semantic
  // roles above (stageField / highlightFields / fieldGroups). Per-page
  // customization goes through an assigned Page schema.
}

/**
 * The field keys this synthesizer reads off an {@link ObjectDefLike}.
 *
 * Renamed off the spec's `ObjectFieldLike` (objectui#3161, objectstack#4115
 * ledger batch 7). Same two words, different subsystem: the spec's
 * `ObjectFieldLike` (`@objectstack/spec/system`) is the duck type
 * `translateObject` reads — `name`/`label`/`help`/`description`/`options`, i.e.
 * exactly the TRANSLATABLE keys — and it ends in `[key: string]: any`, so
 * deriving from it would trade this precise list for a bag that accepts
 * anything (the objectstack#4075 mechanism, on the spec's side this time).
 * This one is the LAYOUT input: `type` picks the widget, `group` matches a
 * `fieldGroups[].key`, `hidden` drops the field — three keys the spec's
 * declaration does not model and cannot report a typo in.
 * Pinned by `__tests__/spec-symbol-batch7.test.ts`.
 */
export interface ObjectDefFieldLike {
  name?: string;
  label?: string;
  type?: string;
  /**
   * The picklist. `kind` is the option's declared lifecycle category
   * (`SelectOption.kind` in `@objectstack/spec/data`, objectstack#23809):
   * {@link deriveStages} carries a `won` / `lost` kind onto the derived stage
   * as its `terminal`, and `record:path` lets any declared kind (`open`
   * included) win over its spelling heuristic (objectui#12907).
   */
  options?: Array<{ value: any; label: string; kind?: SelectOptionKind }>;
  /** Declared group membership — matches a `fieldGroups[].key`. */
  group?: string;
  /** Hidden fields never surface in derived sections. */
  hidden?: boolean;
}

export interface BuildPageOptions {
  /** Override the auto-derived highlight field list. */
  highlightFields?: string[];
  /** Override the auto-derived statusField / stages. */
  statusField?: string;
  stages?: Array<{ value: any; label: string }>;
  /** Override the auto-derived section grouping. The heading rides `label` —
   *  the one slot `@object-ui/types` declares (objectui#6190). */
  sections?: Array<{ label?: string; columns?: number; fields?: any[] }>;
  /** Suppress the auto-appended `record:discussion` slot. */
  hideDiscussion?: boolean;
  /** Suppress the auto-emitted Attachments tab (`enable.files`, objectstack#4358). */
  hideAttachments?: boolean;
  /** Suppress the auto-prepended `record:highlights` strip. */
  hideHighlights?: boolean;
  /** Suppress the auto-prepended `record:path` stepper. */
  hidePath?: boolean;
  /**
   * Opt in to the Reference Rail (aside region with
   * `record:reference_rail`). The rail is OFF by default — it fans out a
   * collection query per related list, which is wasteful on records the
   * author never intended to summarize. Set `showReferenceRail: true` on
   * this options object to surface it — that is the only route: ADR-0085
   * removed the per-object `detail` hints block, so no object definition
   * can switch the rail on, and a per-page rail is an authored
   * `record:reference_rail` node in an assigned Page schema. It then
   * emits only when `related` has at least 2 entries.
   * Pinned by `__tests__/referenceRailRoute-9816.test.ts`.
   */
  showReferenceRail?: boolean;
  /**
   * Force-suppress the Reference Rail even when `showReferenceRail` is on.
   * Retained for callers that toggle the rail off contextually.
   */
  hideReferenceRail?: boolean;
  /**
   * Suppress the auto-emitted `Related` tab in `buildDefaultTabs`.
   * Auto-set to `true` by `buildDefaultPageSchema` when the Reference
   * Rail is being emitted, to avoid showing the same related-list data
   * in two places (the rail and the tab). Authors can override.
   */
  hideRelatedTab?: boolean;
  /** Pass-through to `page:header.recordChrome`. Defaults to true. */
  recordChrome?: boolean;
  /**
   * Action definitions to surface in the header. When provided and
   * non-empty, the synthesizer emits a `record:quick_actions` node
   * immediately after `page:header`. Use ActionDef shape from the spec
   * (must include `locations: ['record_header']` to render).
   */
  headerActions?: any[];
  /**
   * Related child objects. When non-empty, the synthesizer adds a
   * "Related" tab containing one `record:related_list` per entry.
   *
   * - `objectName` and `relationshipField` are required.
   * - `title` overrides the default child-object label.
   * - `columns` / `limit` / `icon` / `sort` are forwarded to the renderer.
   */
  related?: Array<{
    title?: string;
    objectName: string;
    relationshipField: string;
    columns?: any[];
    limit?: number;
    icon?: string;
    /**
     * Row order for this list — the spec `record:related_list.sort` union,
     * forwarded verbatim onto the synthesized node.
     *
     * The host supplies it; this synthesizer neither derives nor overrides it.
     * `RecordDetailView` fills it from the child object's DEFAULT LIST VIEW
     * sort (objectui#5795 — ruled direction 1 on objectstack#11345,
     * maintainer 2026-08-23: inherit the child list view's sort, NO new spec
     * key), already lowered to the array arm. Omitted → the node carries no
     * `sort` and the related list falls back to the server's PK order, exactly
     * as before this key had a producer.
     */
    sort?: string | Array<{ field: string; order: 'asc' | 'desc' }>;
    /**
     * This list's own declared SCOPE — forwarded verbatim onto the synthesized
     * node's `filter`, the key `record:related_list` has read since
     * objectstack#7118 (`RelatedList` ANDs it with `{ [relationshipField]:
     * parentId }`, never substituting for it).
     *
     * The host supplies it; this synthesizer neither derives nor merges it.
     * `RecordDetailView` fills it from the FK field's `relatedListFilter`
     * (objectui#4664 — the spec key from objectstack#8704 / PR objectstack-ai/objectstack#8955), already
     * in the canonical Query-DSL `FilterCondition` shape that key declares. The
     * component-level authored `filter` and this derived one are therefore the
     * same vocabulary arriving at the same prop, which is the point: one read
     * site, one lowering, no per-producer dialect.
     *
     * Omitted → the node carries no `filter` and the list sends the parent
     * scope alone, exactly as before this key had a producer.
     */
    filter?: Record<string, any> | any[];
    /**
     * `relatedList: 'primary'` — a CORE relationship. Under the default
     * layout this list is promoted to its OWN tab; non-primary lists collapse
     * into a single "Related" tab. Ignored when `relatedLayout` forces a
     * uniform layout.
     */
    isPrimary?: boolean;
  }>;
  /**
   * How the related child lists are laid out under the tab strip.
   *
   * - **default (unset)** — the ADR-0085 prominence rule: lists flagged
   *   `relatedList: 'primary'` (`isPrimary`) each get their OWN tab; every
   *   other related list collapses into a single stacked `Related` tab. With
   *   no primary lists this is identical to the legacy stacked behavior, so
   *   the change is opt-in per relationship — never a surprise.
   * - `'stack'` — app-level override: ALL related lists stack vertically
   *   inside one `Related` tab, ignoring `isPrimary`.
   * - `'tabs'` — app-level override: EVERY related child gets its own peer
   *   tab (label = the child's `title`, falling back to `objectName`),
   *   ignoring `isPrimary`.
   *
   * Precise per-tab ordering / filtered splits / non-relationship tabs are a
   * custom Page concern (Tier 2) — this synthesizer only covers the derived
   * default. Ignored when the `Related` tab is suppressed (`hideRelatedTab`).
   */
  relatedLayout?: 'stack' | 'tabs';
  /**
   * When true, emit an Activity tab that renders `record:activity`.
   * The activity renderer fetches its own data via RecordContext.
   */
  showActivity?: boolean;
  /**
   * When provided, emit a History tab containing a `record:history`
   * renderer. The host supplies the audit-log `entries` and `loading`
   * flag because the data fetch logic lives in RecordDetailView.
   */
  history?: { entries: any[]; loading?: boolean; emptyText?: string; unknownUserText?: string };
  /**
   * When provided, emit an Approvals tab containing a `record:approvals`
   * renderer (objectui#3461). `node` is spread verbatim onto the node — the
   * host threads its LIVE approvals read (the same one driving the header's
   * decision buttons) through it so the tab and the header can never
   * disagree; the renderer self-fetches only when an authored page places
   * the node without this payload. `count` badges the tab (number of
   * approval requests on the record), same affordance as the auto-derived
   * related-list counts.
   */
  approvals?: { count?: number; node?: Record<string, any> };
  /**
   * Slot override map. When a slot is provided, the synthesizer emits
   * the override verbatim at the slot's position instead of computing
   * the default. Each slot accepts a single SchemaNode or an array
   * (arrays are flattened in place).
   *
   * Slot menu (v1):
   * - `header` — replaces `page:header`.
   * - `actions` — replaces `record:quick_actions`. The override fires
   *   even when `headerActions` is empty (i.e. the override lets you
   *   add a header bar where the synthesizer would have skipped one).
   * - `highlights` — replaces the highlight strip (chips + chevron
   *   path). The override fires even when neither auto-emission
   *   condition is met.
   * - `details` — replaces the Details tab body (the `record:details`
   *   node). Other tabs (Related / Activity / History) are unaffected.
   * - `tabs` — replaces the entire `page:tabs` node. Wins over
   *   `details` when both are provided. Use this to add or reorder
   *   tabs.
   * - `discussion` — replaces `record:discussion`. Fires even when
   *   `hideDiscussion` is true (the override is explicit intent to
   *   surface a custom footer).
   * - `rightRail` — additional component(s) to drop into the
   *   right-side `aside` region (the same region that hosts the
   *   auto-emitted `record:reference_rail`). When provided, the
   *   `aside` region is always rendered — even when no reference
   *   rail would otherwise be emitted — so plugins can contribute
   *   contextual side panels (activity feed, related summary,
   *   workflow status, presence list, etc.) without depending on
   *   the related-list heuristic.
   */
  slots?: {
    header?: any | any[];
    actions?: any | any[];
    alerts?: any | any[];
    highlights?: any | any[];
    details?: any | any[];
    tabs?: any | any[];
    discussion?: any | any[];
    rightRail?: any | any[];
  };
}

/** Flatten a slot value (single node or array) into a node array. */
function toNodeArray(slot: any | any[] | undefined): any[] {
  if (slot == null) return [];
  return Array.isArray(slot) ? slot.filter((n) => n != null) : [slot];
}

/**
 * Build ONE page component node — the single place this synthesizer decides
 * where a component's props live (objectui#4232).
 *
 * A page component's own shape is CLOSED. `PageComponentSchema` declares
 * `type` / `id` / `label` / `properties` / `events` / `style` / `className` /
 * `responsiveStyles` / `visibleWhen` / `visibility` / `dataSource` /
 * `responsive` / `aria` and nothing else, and ADR-0089 D3a flipped it to
 * `.strict()` — so a widget prop written at the TOP level of the node is not
 * dropped, it is a parse error:
 *
 * ```
 * unrecognized_keys | regions.0.components.0 |
 *   Unrecognized key(s) on this view/page schema: `recordChrome`, `actions`.
 *   Before ADR-0089 D3a these were dropped silently, shipping inert metadata;
 *   a mis-layered or stale key is now a loud parse error.
 * ```
 *
 * That error is what made Studio's page-create never complete: the create path
 * seeds `regions` from `buildDefaultPageSchema(objectDef)`
 * (`app-shell/views/metadata-admin/anchors.ts` → `createSeed`), the console
 * PUT carried the flat props, the server refused the body, and no page row was
 * ever stored.
 *
 * The canonical carrier is the node's `properties` bag — which is exactly
 * where the spec declares these props (`ComponentPropsMap`:
 * `PageHeaderProps.recordChrome`, `PageTabsProps.items`, …), and what
 * `SchemaRenderer` hoists back onto the node before dispatching to a renderer
 * (`packages/react/src/SchemaRenderer.tsx`, "COMPAT: Hoist 'properties' up to
 * schema level"). So the semantics are unchanged in both directions: the same
 * props reach the same renderers, and the body now parses.
 *
 * `undefined` values are dropped rather than written as present-but-undefined
 * keys, and a component with no props at all emits no `properties` key —
 * `PageComponentSchema.properties` is `.optional().default({})`, so `{ type }`
 * is complete.
 */
function componentNode(type: string, props: Record<string, unknown> = {}): any {
  const properties: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (props[key] !== undefined) properties[key] = props[key];
  }
  return Object.keys(properties).length > 0 ? { type, properties } : { type };
}

/**
 * Detect the canonical "status" / "stage" field on an object definition.
 *
 * The implementation moved to `@object-ui/types` (`detectStatusField`) so
 * non-detail consumers of the `stageField` role — kanban default lanes in
 * app-shell/plugin-list — share the exact semantics (incl. the strict
 * `stageField: false` suppression). Re-exported here unchanged for the
 * long-standing plugin-detail import path.
 */
export { detectStatusField };

/**
 * The `record:path` terminal a declared option `kind` stands for: `won` and
 * `lost` are the spec's `stages[].terminal` values verbatim (the vocabulary
 * objectstack#23809 chose to match), and `open` is no terminal.
 */
export function stageTerminalOfKind(kind: SelectOptionKind | undefined): 'won' | 'lost' | undefined {
  return kind === 'won' || kind === 'lost' ? kind : undefined;
}

/**
 * Derive stage values from an object field's `options` (picklist).
 *
 * A stage carries `terminal` from its option's declared `kind`
 * ({@link stageTerminalOfKind}, objectui#12907), so a `won` option is the
 * path's forward terminus and a `lost` one sits in the separated group
 * whatever it is called. An option that declares no kind, or `open`, gets no
 * `terminal` key: the stage shape is the spec's strict `stages[]` row, which
 * has no way to say "declared open" — `record:path` reads that off the field
 * itself ({@link declaredStageKinds}).
 */
export function deriveStages(
  def: ObjectDefLike | undefined,
  statusField: string | null,
): Array<{ value: any; label: string; terminal?: 'won' | 'lost' }> | null {
  if (!def || !statusField) return null;
  const field = def.fields?.[statusField];
  const options = field?.options;
  if (!Array.isArray(options) || options.length === 0) return null;
  return options.map((o) => {
    const terminal = stageTerminalOfKind(o.kind);
    return terminal ? { value: o.value, label: o.label, terminal } : { value: o.value, label: o.label };
  });
}

/**
 * The lifecycle `kind` each option of `statusField` declares, keyed by option
 * value — only the options that declare one (objectui#12907).
 *
 * ⚠️ Package-internal: exported for `renderers/record-path.tsx`, NOT
 * re-exported from the package entry. `record:path` consults it after a
 * stage's explicit `terminal` and before its spelling heuristic, because the
 * spec's strict `stages[]` row can carry `won` / `lost` but not `open`: a
 * declared `open` on a value spelled `closed_won` has to beat the heuristic
 * from here. Returns `null` when there is nothing to consult.
 */
export function declaredStageKinds(
  def: ObjectDefLike | undefined,
  statusField: string | null,
): Map<unknown, SelectOptionKind> | null {
  if (!def || !statusField) return null;
  const options = def.fields?.[statusField]?.options;
  if (!Array.isArray(options)) return null;
  const kinds = new Map<unknown, SelectOptionKind>();
  for (const o of options) {
    if (o?.kind !== undefined) kinds.set(o.value, o.kind);
  }
  return kinds.size > 0 ? kinds : null;
}

/**
 * WHICH FIELD titles this record — the field whose value the page renders as
 * its H1, in NAME space.
 *
 * DELEGATES to `@object-ui/core`'s `resolveNameField`: the ONE shared ADR-0079
 * ladder (`nameField` -> deprecated `displayNameField` / `NAME_FIELD_KEY` ->
 * type-aware derivation), the same spelling `getRecordDisplayName` reads to
 * produce the H1's VALUE and `leadWithNameField` reads to lead a list. It does
 * not re-implement that ladder. ADR-0079 collapsed ~6 divergent title
 * resolvers and this module grew one back (objectui#7287); a second ladder
 * that agrees today diverges again on the next change, which is the whole
 * history of this defect.
 *
 * Two rungs went away with the delegation:
 *
 *  - `def.primaryField` — a `DetailViewSchema` key (`@object-ui/types`
 *    `views.ts`), read here off an OBJECT def and ranked ABOVE the canonical
 *    `nameField` ADR-0079 Phase 2 made the pointer. No producer can put it
 *    there: `@objectstack/spec`'s object schema is a `strictObject` that
 *    answers `unrecognized_keys: ['primaryField']`, and `ObjectSchema.create()`
 *    throws — which is why objectstack#6326 deleted the identical read from
 *    two lint rules. A census across both repos found zero object payloads
 *    carrying it. Same shape as the undeclared `objectDef.titleField` read
 *    objectui#6531 measured and #6557 removed.
 *  - the literal `['name','full_name','title','subject','display_name']` walk
 *    — a NAME match with no type check. `deriveTitleField` ranks those same
 *    name-ish names first AND rejects non-title types, so a `select` named
 *    `title` stops being named as the H1 field that the H1 never shows.
 *
 * Returns `null` rather than `undefined` for this module's `!== titleField`
 * filters and app-shell's `?? 'name'` call site.
 */
export function resolveTitleField(def: ObjectDefLike | undefined): string | null {
  return resolveNameField(def) ?? null;
}

/**
 * The members of every field group whose ADR-0089 `visibleWhen` the details
 * body evaluates per record (objectui#12720).
 *
 * Read through {@link deriveFieldGroupDetailEntries}, the derivation the
 * body's own group gate (`resolveSectionGroup` in `record-details.tsx`)
 * resolves `{ group }` references against, and with that gate's own test,
 * `entry.visibleWhen != null`. So the members named here are exactly the
 * fields the body hides with their group when the predicate is FALSE, and the
 * strip cannot hold a different idea of which fields are gated.
 *
 * ⛔ The predicate is not evaluated here. The derivation runs from object
 * metadata with no record in hand, so it can only ask WHETHER a member's
 * group is gated, never what the gate answers. The strip therefore declines
 * every such member, on every record: a chip that comes and goes per record
 * is not an at-a-glance fact, and the one evaluator stays the body's
 * (`resolveFieldRuleState`, the form's). Where the group is shown, its members
 * are still drawn once, in the body: a field this derivation declines is not
 * in the strip's list, so it is not in the body's `hideFields` either.
 *
 * Only the DERIVED strip consults this. A declared `highlightFields` entry
 * inside a gated group is left as the author wrote it.
 */
function membersOfGatedFieldGroups(def: ObjectDefLike): Set<string> {
  const out = new Set<string>();
  for (const entry of deriveFieldGroupDetailEntries(def) ?? []) {
    if (entry.key === undefined || entry.visibleWhen == null) continue;
    for (const field of entry.section.fields as Array<{ name: string }>) out.add(field.name);
  }
  return out;
}

/**
 * Pick up to N "highlight" fields by name. Skips the status field
 * (already shown in `record:path`) and obvious junk like id / created_at.
 * Members of a group gated by `visibleWhen` are never picked
 * ({@link membersOfGatedFieldGroups}, objectui#12720).
 */
export function deriveHighlightFields(
  def: ObjectDefLike | undefined,
  statusField: string | null,
  max = 4,
): string[] {
  if (!def) return [];
  // Semantic role first (ADR-0085): top-level `highlightFields`. (The
  // deprecated `compactLayout` fallback was retired with the alias —
  // framework#2536.)
  const declared = Array.isArray(def.highlightFields) && def.highlightFields.length > 0
    ? def.highlightFields
    : null;
  if (declared) {
    // Drop the title field from a DECLARED list too: it is already the page
    // H1, and repeating it as the first chip duplicated the record name —
    // truncated — directly under the identical heading. The heuristic branch
    // below always skipped it; both branches now agree (#2548 follow-up).
    // Filtering before the slice means the title never wastes a strip slot.
    const titleField = resolveTitleField(def);
    return declared
      .filter((n): n is string => typeof n === 'string' && n.length > 0 && n !== titleField)
      .slice(0, max);
  }
  // System fields and tenancy metadata never make useful highlights —
  // they either have no friendly label (organization_id renders as the
  // workspace name with no field name beside it) or are mostly noise
  // (audit IDs). Filter them up-front so the fallback walk below doesn't
  // pick them when a richer field isn't available.
  const skip = new Set<string>([
    'id', '_id',
    'created_at', 'updated_at', 'deleted_at',
    'created_by', 'updated_by', 'deleted_by',
    'organization_id', 'workspace_id', 'tenant_id',
    'org_id',
  ]);
  if (statusField) skip.add(statusField);
  // (The title field joins `skip` below, AFTER the retirement gate is defined
  // — see the block above the selection loops for why the order matters.)
  for (const candidate of ['name', 'full_name', 'title', 'subject', 'display_name']) {
    if (candidate in (def.fields || {})) skip.add(candidate);
  }
  const preferred = [
    'owner', 'owner_id', 'amount', 'rating', 'source',
    'priority', 'industry', 'phone', 'email',
    'close_date', 'due_date', 'start_date', 'expected_close_date',
    'account', 'account_id', 'contact', 'contact_id',
  ];
  // Field types that render well as compact highlight pills.
  // Long-form / structural types (textarea, markdown, json, grid) and
  // booleans don't carry enough at-a-glance information here — they're
  // either too wide or visually noisy.
  //
  // `owner` left this set with objectui#4914 — a RETIRED spelling, refused by
  // the gate below before this membership test runs. The deletion is lockstep
  // hygiene; the gate is the behavioural half. Note the `preferred` list above
  // still names `owner`: that is a field NAME, and the surviving idiom is
  // exactly `{ type: 'user', name: 'owner' }`, so it must stay.
  const HIGHLIGHT_FRIENDLY_TYPES = new Set<string>([
    'currency', 'number', 'integer', 'decimal', 'percent',
    'date', 'datetime', 'time',
    'reference', 'lookup', 'user',
    'select', 'enum', 'multiselect', 'status',
    'email', 'phone', 'url',
    'text', 'string',
  ]);
  const out: string[] = [];
  const fields = def.fields || {};
  /**
   * THE GATE (objectui#4914, ruling B), ahead of BOTH selection loops.
   *
   * A retired spelling is refused a highlight slot and the author is told once.
   * Before the ruling `owner` was highlight-friendly, so the synthesized page
   * put a pill on the strip for a field whose own editor answers with a
   * tombstone — one page, two verdicts on one field.
   *
   * It has to run on the `preferred` pass too, and that pass is why: it selects
   * by NAME and never looks at the type, and the FIRST name it prefers is
   * `owner`. Gating only the type-driven loop below would have left the one
   * shape this whole card is about — a field named `owner` still TYPED `owner`
   * — sailing into the strip through the other door, with the fix reading as
   * complete.
   */
  const refusedAsRetired = (name: string): boolean => {
    const ftype = (fields as any)[name]?.type;
    if (typeof ftype !== 'string' || !isRetiredFieldType(ftype)) return false;
    reportRetiredFieldType(ftype);
    return true;
  };
  // The record's title field is already shown as the page H1 — surfacing it
  // again in the highlight strip duplicates content and wastes a slot (e.g.
  // Task pages would show 主题 twice). ONE resolver decides WHICH field that
  // is, the same one the DECLARED branch above uses, so "what the strip
  // skips" and "what the H1 shows" cannot disagree (objectui#7287).
  //
  // ⚠️ This REPLACES three separate reads (`primaryField` / `nameField` /
  // `displayNameField`, each adding whatever it found) and it is a deliberate
  // BEHAVIOUR CHANGE, not a rewrite of them. `primaryField` is simply gone —
  // a `DetailViewSchema` key no object payload can carry (see
  // {@link resolveTitleField}). The other two are rungs of the shared ladder,
  // but the ladder PICKS one rung where the old set added EVERY declared one,
  // so old and new disagree on exactly one input: an object declaring
  // `nameField` AND the deprecated `displayNameField` alias to DIFFERENT
  // fields. The old set skipped both; this skips only the winner.
  //
  // Skipping only the winner is the intended behaviour. The loser is not the
  // H1 — `getRecordDisplayName` reads this same `declaredNameField` ladder
  // and renders the WINNER's value — so hiding the loser removed an ordinary
  // field and spent a strip slot on a field the heading never shows, which is
  // the class of bug this card is about. It also makes this heuristic branch
  // agree with the DECLARED branch above, which has only ever filtered a
  // single `titleField`: the "#2548 follow-up" note up there claims both
  // branches agree, and until now that was true only for objects declaring
  // one alias.
  //
  // Pinned by "skips only the winner when nameField and displayNameField
  // disagree" in `resolveTitleField.sharedLadder-7287.test.ts`.
  //
  // ⚠️ Ask THE GATE first, then skip. A field skipped as the H1 never reaches
  // the selection loops, so skipping it silently would take the objectui#4914
  // report with it — the author of an object whose only retired-typed field
  // happens to title the record would stop being told, while the strip looked
  // correct. That is the same "one door left open" the gate's own docstring
  // above is about. Hence this sits below `refusedAsRetired`, not up in the
  // skip set.
  const h1Field = resolveTitleField(def);
  if (h1Field) {
    refusedAsRetired(h1Field);
    skip.add(h1Field);
  }
  // Members of a field group the details body gates per record are never
  // picked (objectui#12720). See {@link membersOfGatedFieldGroups} for why the
  // strip declines them rather than evaluating the predicate itself. Asked
  // AFTER THE GATE in both loops, so the objectui#4914 report fires exactly
  // when it did before this card.
  const gated = membersOfGatedFieldGroups(def);
  for (const name of preferred) {
    if (name in fields && !skip.has(name) && !refusedAsRetired(name) && !gated.has(name)) out.push(name);
    if (out.length >= max) return out;
  }
  for (const name of Object.keys(fields)) {
    if (out.includes(name) || skip.has(name)) continue;
    if (refusedAsRetired(name)) continue;
    if (gated.has(name)) continue;
    const fieldDef = (fields as any)[name];
    const ftype = fieldDef?.type;
    // When a type is declared, require it to be highlight-friendly.
    // Untyped fields (legacy schemas) fall through to keep prior
    // behaviour.
    if (ftype && !HIGHLIGHT_FRIENDLY_TYPES.has(ftype)) continue;
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Sub-builder: the canonical `page:header` node.
 *
 * Exported so authors of slotted pages can compose
 * `[buildDefaultHeader(def), customNode]` without copying the
 * synthesizer's internals.
 */
export function buildDefaultHeader(
  _def: ObjectDefLike | undefined,
  options: Pick<BuildPageOptions, 'recordChrome'> & { actions?: any[] } = {},
): any {
  return componentNode('page:header', {
    recordChrome: options.recordChrome !== false,
    ...(Array.isArray(options.actions) && options.actions.length > 0
      ? { actions: options.actions }
      : {}),
  });
}

/**
 * Sub-builder: the `record:quick_actions` action bar.
 *
 * Returns `null` when `headerActions` is empty/missing so callers can
 * spread the result conditionally.
 */
export function buildDefaultActions(
  _def: ObjectDefLike | undefined,
  headerActions: any[] | undefined,
): any | null {
  if (!Array.isArray(headerActions) || headerActions.length === 0) return null;
  return componentNode('record:quick_actions', {
    actions: headerActions,
    location: 'record_header',
  });
}

/**
 * Sub-builder: the highlight strip — `record:highlights` chips plus
 * `record:path` chevron (when a status field is configured).
 *
 * Returns an array because the strip is conceptually one region with
 * two adjacent nodes.
 */
export function buildDefaultHighlights(
  def: ObjectDefLike | undefined,
  options: Pick<BuildPageOptions,
    'highlightFields' | 'statusField' | 'stages' | 'hideHighlights' | 'hidePath'
  > = {},
): any[] {
  const statusField = options.statusField ?? detectStatusField(def);
  const stages = options.stages ?? (statusField ? deriveStages(def, statusField) : null);
  const highlightFields =
    options.highlightFields ?? deriveHighlightFields(def, statusField);
  const out: any[] = [];
  if (!options.hideHighlights && highlightFields.length > 0) {
    out.push(componentNode('record:highlights', { fields: highlightFields }));
  }
  if (!options.hidePath && statusField && stages && stages.length > 0) {
    out.push(componentNode('record:path', { statusField, stages }));
  }
  return out;
}

/**
 * One field group, resolved — the section a `record:details` `{ group }`
 * reference stands for — plus the group's own ADR-0089 `visibleWhen`
 * (objectui#11630).
 *
 * ⚠️ Package-internal. It is exported from this module for
 * `renderers/record-details.tsx` and is NOT re-exported from the package entry.
 * The predicate travels BESIDE the section, never on it: `section` is exactly
 * what the public {@link deriveFieldGroupDetailSections} returns, so no caller
 * of the public function can copy a `visibleWhen` onto an enumerated
 * `record:details` section. `@objectstack/spec`'s `RecordDetailsProps.sections[]`
 * is strict and refuses that key on parse; the spec's way to gate a section is
 * to reference the gated group with `{ group }`, which inherits its predicate.
 */
export interface FieldGroupDetailEntry {
  /** The group key. Absent on the trailing ungrouped bucket. */
  key?: string;
  /**
   * The group's `visibleWhen`, verbatim and unevaluated — a bare CEL string or
   * an Expression envelope, as `deriveFieldGroupLayout` passes it through.
   * Never present on the ungrouped bucket.
   */
  visibleWhen?: unknown;
  /** The resolved section, in DetailSection's shape. */
  section: Record<string, any>;
}

/**
 * The derivation behind both {@link deriveFieldGroupDetailSections} and the
 * `{ group }` references {@link resolveDetailSections} emits — one code path,
 * so a reference and the section it resolves to cannot disagree.
 *
 * Package-internal; see {@link FieldGroupDetailEntry}.
 */
export function deriveFieldGroupDetailEntries(
  def: ObjectDefLike | undefined,
): FieldGroupDetailEntry[] | null {
  if (!def) return null;
  const derived = deriveFieldGroupLayout(def);
  if (!derived) return null;

  const fields = def.fields || {};
  const toField = (name: string) => {
    const f = fields[name] || {};
    return {
      name,
      label: f.label || name,
      type: f.type || 'text',
      ...(f.options ? { options: f.options } : {}),
      // objectui#6837 half 2 narrowed the READ to `reference` (the only
      // spelling the protocol declares — `FieldSchema` refuses `reference_to`
      // by name), and objectui#11070 round 4 moved the EMITTED key with it:
      // the target contract here, the DetailSection field bag
      // (`DetailViewField`), declares `reference`.
      ...((f as any).reference ? { reference: (f as any).reference } : {}),
      ...((f as any).reference_field ? { reference_field: (f as any).reference_field } : {}),
      ...((f as any).currency ? { currency: (f as any).currency } : {}),
      // Spec channel for per-field currency — renderers resolve
      // currency → currencyConfig.defaultCurrency → tenant default (#2548).
      ...((f as any).currencyConfig ? { currencyConfig: (f as any).currencyConfig } : {}),
    };
  };

  // Column count is derived ONCE from the object's TOTAL detail-field count and
  // applied to every section — mirroring the entry form (plugin-form's
  // `derivedSections` uses `inferColumns(totalFieldCount)` uniformly), so a
  // record reads at the same width in view and edit (objectui#2578). Without
  // this each section re-inferred from its OWN field count, so a 15-field group
  // showed 3 columns in detail while the form showed 4. The grid's CSS
  // breakpoints still clamp to the real rendered width.
  const totalFields = derived.reduce((n, s) => n + s.fields.length, 0);
  const columns = inferDetailColumns(totalFields);

  // Untitled trailing bucket: omitting `name`/`label` keeps the section flat
  // (record-details defaults showBorder to false for untitled sections)
  // instead of surfacing an internal key as a header.
  //
  // The heading rides `label`, the slot `@object-ui/types` and the authoring
  // inspector already declare (objectui#6190). This function's output is
  // public API, so the emitted key is part of the contract: it used to be
  // `title`, a second spelling of one slot that `record:details` read with
  // strict priority over `label`. One slot, one spelling.
  return derived.map((s) => ({
    ...(s.key !== undefined ? { key: s.key } : {}),
    // The group's ADR-0089 predicate (objectui#11630), carried BESIDE the
    // section for `record:details` to evaluate per record — grouping is
    // static layout, visibility is per-record state.
    ...(s.visibleWhen !== undefined ? { visibleWhen: s.visibleWhen } : {}),
    section: {
      ...(s.key !== undefined ? { name: s.key, label: s.label ?? s.key } : {}),
      // Group header chrome (ADR-0085 §5): the shared derivation passes the
      // declared icon/description through; DetailSection renders them under
      // the section title. Dropping them here made the spec keys silently
      // inert on detail pages (#2548 follow-up).
      ...(s.icon ? { icon: s.icon } : {}),
      ...(s.description ? { description: s.description } : {}),
      ...(s.collapse !== 'none' ? { collapsible: true } : {}),
      ...(s.collapse === 'collapsed' ? { defaultCollapsed: true } : {}),
      columns,
      fields: s.fields.map(toField),
    },
  }));
}

/**
 * Derive detail sections from the object's declared `fieldGroups` plus each
 * field's `group` membership. The grouping SEMANTICS (declared order, empty
 * groups dropped, trailing untitled bucket, audit-field handling, collapse
 * behaviour incl. legacy alias handling) are single-sourced in
 * `@objectstack/spec` (`deriveFieldGroupLayout`, ADR-0085 §5); this adapter
 * only maps the shared result onto DetailSection's shape.
 *
 * Returns `null` when grouping does not apply — no declared groups, or no
 * visible field references one — so callers fall back to their existing
 * layout (flat or auto-split).
 *
 * Section fields are emitted as rich descriptors (`{ name, label, type,
 * options }`) so DetailSection renders typed values without re-resolving
 * the object definition.
 *
 * ⚠️ This is the RESOLVED form of a group — what `record:details` renders for
 * a `{ group }` reference — and not a page section to write into a
 * `record:details` node: the rich `fields` descriptors are refused by
 * `@objectstack/spec`'s `RecordDetailsProps.sections[].fields` (bare names), and
 * a group's `visibleWhen` is deliberately not on it. A page references the group
 * instead, which is what {@link resolveDetailSections} emits (objectui#11630).
 */
export function deriveFieldGroupDetailSections(
  def: ObjectDefLike | undefined,
): Array<Record<string, any>> | null {
  return deriveFieldGroupDetailEntries(def)?.map((entry) => entry.section) ?? null;
}

/**
 * The `record:details` sections a page writes for the object's field groups —
 * spec-legal, so a Studio seed parses (objectui#11630).
 *
 * Each declared group is emitted as the spec's own reference form,
 * `{ group: KEY, columns }` (`RecordDetailsProps.sections[].group`,
 * ADR-0085 §5): `record:details` resolves it against the object's
 * `fieldGroups`, inheriting the group's members, label, icon, description,
 * collapse AND its `visibleWhen`, which it evaluates per record. `columns` is
 * the one-object-wide width (objectui#2578) and is a key the spec permits
 * beside `group`. The trailing ungrouped bucket has no group to reference, so
 * it stays an enumerated, untitled section listing bare field NAMES — the
 * only `fields` spelling the spec declares.
 */
function fieldGroupSectionReferences(
  def: ObjectDefLike | undefined,
): Array<Record<string, any>> | null {
  const entries = deriveFieldGroupDetailEntries(def);
  if (!entries) return null;
  return entries.map(({ key, section }) =>
    key !== undefined
      ? { group: key, columns: section.columns }
      : { columns: section.columns, fields: section.fields.map((f: { name: string }) => f.name) },
  );
}

/**
 * Resolve the sections for the Details tab body:
 *   1) explicit `options.sections` from the caller (programmatic API —
 *      Studio preview / metadata-admin anchors);
 *   2) else the object's `fieldGroups` semantic role, as `{ group }`
 *      references plus the ungrouped bucket's field names
 *      (`fieldGroupSectionReferences`, objectui#11630);
 *   3) else `undefined` — a bare `record:details`, which draws the object's
 *      `highlightFields` (the spec's declared fallback for a node with
 *      neither `sections` nor `fields`, objectui#12433), and an empty body
 *      when the object declares none. It does NOT draw every field: a caller
 *      that wants the running app's default body passes that body's sections
 *      in (1) — app-shell's `RecordDetailView`, and Studio's page-create seed
 *      and slotted preview, take them from one derivation (objectui#12442).
 */
export function resolveDetailSections(
  def: ObjectDefLike | undefined,
  sections?: BuildPageOptions['sections'],
): BuildPageOptions['sections'] | undefined {
  if (Array.isArray(sections) && sections.length > 0) return sections;
  return fieldGroupSectionReferences(def) ?? undefined;
}

/**
 * Sub-builder: the Details tab body — a single `record:details` node.
 */
export function buildDefaultDetails(
  def: ObjectDefLike | undefined,
  sections?: BuildPageOptions['sections'],
  hideFields?: string[],
): any {
  return componentNode('record:details', {
    sections: resolveDetailSections(def, sections),
    ...(hideFields && hideFields.length > 0 ? { hideFields } : {}),
  });
}

/**
 * Sub-builder: the `page:tabs` node. Emits Details / Related /
 * Activity / History tabs in stable order based on the options.
 *
 * Useful for slotted authors who want to add a custom tab — they can
 * call `buildDefaultTabs(def, opts)` and splice their tab into
 * `.items[]`.
 */
export function buildDefaultTabs(
  def: ObjectDefLike | undefined,
  options: Pick<BuildPageOptions,
    'sections' | 'related' | 'showActivity' | 'history' | 'highlightFields' | 'statusField' | 'hideRelatedTab' | 'relatedLayout' | 'hideAttachments' | 'approvals'
  > = {},
): any {
  const statusField = options.statusField ?? detectStatusField(def);
  const highlightFields =
    options.highlightFields ?? deriveHighlightFields(def, statusField);
  // Every tab carries a STABLE, semantic `value` (objectui#2257): the active
  // tab is URL-addressable (`?tab=<value>`, ADR-0054 C3), so values must
  // survive related lists being added/removed — an index-derived value
  // (`tab-2`) would silently point at a different tab after a schema change.
  const items: any[] = [
    { label: 'Details', value: 'details', children: [buildDefaultDetails(def, options.sections, highlightFields)] },
  ];
  if (
    !options.hideRelatedTab &&
    Array.isArray(options.related) &&
    options.related.length > 0
  ) {
    const relatedNode = (rel: NonNullable<BuildPageOptions['related']>[number]) =>
      componentNode('record:related_list', {
        title: rel.title,
        objectName: rel.objectName,
        relationshipField: rel.relationshipField,
        ...(rel.columns ? { columns: rel.columns } : {}),
        ...(rel.limit ? { limit: rel.limit } : {}),
        ...(rel.icon ? { icon: rel.icon } : {}),
        // objectui#5795. Emitted only when the host actually supplied one, for
        // the reason every sibling key here is: a `sort: undefined` written
        // onto the node is a different fact from "the author said nothing",
        // and it is the one a later liveness audit would read.
        ...(rel.sort ? { sort: rel.sort } : {}),
        // objectui#4664 — same emit-only-when-supplied rule as `sort` above,
        // and for the same reason. The tab strip's count probe reads this key
        // off the node it is badging, so emitting it is also what keeps the
        // badge and the rows asking one question.
        ...(rel.filter ? { filter: rel.filter } : {}),
      });
    const asOwnTab = (rel: NonNullable<BuildPageOptions['related']>[number]) => ({
      label: rel.title || rel.objectName,
      value: `related:${rel.objectName}`,
      ...(rel.icon ? { icon: rel.icon } : {}),
      children: [relatedNode(rel)],
    });
    if (options.relatedLayout === 'tabs') {
      // App-level override: one peer tab per related child.
      for (const rel of options.related) items.push(asOwnTab(rel));
    } else if (options.relatedLayout === 'stack') {
      // App-level override: all related lists share one stacked `Related` tab.
      items.push({ label: 'Related', value: 'related', children: options.related.map(relatedNode) });
    } else {
      // DEFAULT (rule Z, ADR-0085 prominence): `isPrimary` lists become their
      // own tab; the rest collapse into one `Related` tab. Owned-before-lookup
      // order is preserved by deriveRelatedLists upstream. With no primary
      // lists this is identical to the legacy stacked default (opt-in per
      // relationship, never a surprise).
      const primary = options.related.filter((r) => r.isPrimary);
      const rest = options.related.filter((r) => !r.isPrimary);
      for (const rel of primary) items.push(asOwnTab(rel));
      if (rest.length > 0) {
        items.push({ label: 'Related', value: 'related', children: rest.map(relatedNode) });
      }
    }
  }
  // Approvals tab (objectui#3461) — emitted only when the host reports the
  // record actually HAS approval requests, so approval-free records carry no
  // dead tab. A peer of Details/Related for the same reason as Attachments
  // below: footer placement buried the one thing a submitter opens the
  // record to learn ("who is this waiting on"). The English label localizes
  // in the tab strip, which reads the pack key for a well-known token
  // (`detail.approvalsPanelTitle` → 审批 / 承認 / Aprobaciones …). That claim
  // used to name `KNOWN_LABEL_DICT`, which shipped zh arms only and so was
  // true for Chinese and silently false everywhere else — objectui#4645.
  if (options.approvals) {
    items.push({
      label: 'Approvals',
      value: 'approvals',
      ...(options.approvals.count != null ? { count: options.approvals.count } : {}),
      children: [componentNode('record:approvals', { ...(options.approvals.node || {}) })],
    });
  }
  // Attachments tab (objectstack#4358) — emitted for `enable.files: true`
  // objects so the panel is a peer of Details/Related instead of a footer
  // widget buried under the discussion feed. `PageTabsRenderer` derives the
  // count badge from the `record:attachments` node the same way it counts
  // `record:related_list` tabs. The English label goes through the tab
  // strip's pack lookup (`detail.attachments` → 附件 / 添付ファイル /
  // Adjuntos …), matching its sibling tabs — see the Approvals tab above for
  // why this no longer names `KNOWN_LABEL_DICT` (objectui#4645).
  if (def?.enable?.files === true && !options.hideAttachments) {
    items.push({ label: 'Attachments', value: 'attachments', children: [buildDefaultAttachments()] });
  }
  if (options.showActivity) {
    items.push({ label: 'Activity', value: 'activity', children: [componentNode('record:activity')] });
  }
  if (options.history) {
    items.push({
      label: 'History',
      value: 'history',
      children: [
        componentNode('record:history', {
          entries: options.history.entries,
          loading: options.history.loading,
          emptyText: options.history.emptyText,
          unknownUserText: options.history.unknownUserText,
        }),
      ],
    });
  }
  return componentNode('page:tabs', { items });
}

/**
 * Sub-builder: the inline `record:discussion` footer slot.
 */
export function buildDefaultDiscussion(): any {
  return componentNode('record:discussion');
}

/**
 * Sub-builder: the `record:attachments` panel (objectstack-ai/objectstack#2727). Emitted only when the
 * object opts in via `enable.files: true` — the same gate the server enforces
 * on `sys_attachment` rows (403 FILES_DISABLED otherwise).
 */
export function buildDefaultAttachments(): any {
  return componentNode('record:attachments');
}

/**
 * Synthesize the canonical Page schema for an object's default detail
 * page.
 *
 * Shape:
 *   { type:'record', template:'default', regions:[ { name:'main',
 *     components: [page:header, record:highlights?, record:path?,
 *     page:tabs, record:discussion?] } ] }
 *   For `enable.files: true` objects the tabs node carries a peer
 *   Attachments tab (`record:attachments` — objectstack#4358).
 *
 * Notes:
 *   - The `record:details` tab content is registered separately and
 *     internally still defers to DetailView for actual field
 *     rendering (see record-details.tsx). When Phase G fully extracts
 *     DetailSection into a `record:section` renderer, this synthesis
 *     output won't need to change — only the inner record:details
 *     implementation will swap.
 *   - We DO NOT emit `record:related_list` here because related list
 *     metadata is not on `objectDef`; that wiring lives in the related
 *     adapter and remains the author's job until a follow-up phase
 *     exposes it through the synthesizer.
 */
export function buildDefaultPageSchema(
  def: ObjectDefLike | undefined,
  options: BuildPageOptions = {},
): any {
  const slots = options.slots || {};
  const components: any[] = [];

  // 1) Header slot. When no header override is set, fold any
  //    `headerActions` into the header itself so PageHeaderRenderer
  //    renders custom + system actions side-by-side in a single row
  //    (avoids the floating `record:quick_actions` overlay colliding
  //    with the system Edit/Share/Delete cluster).
  if ('header' in slots && slots.header !== undefined) {
    components.push(...toNodeArray(slots.header));
  } else {
    components.push(
      buildDefaultHeader(def, {
        recordChrome: options.recordChrome,
        actions: options.headerActions,
      }),
    );
  }

  // 2) Header action bar — only emitted as a separate node when an
  //    explicit `actions` slot override is provided. Otherwise actions
  //    are merged into the header above.
  if ('actions' in slots && slots.actions !== undefined) {
    components.push(...toNodeArray(slots.actions));
  }

  // 2.5) Alerts slot — rendered between the header/actions row and the
  //      highlights strip. No default emission; only renders when the
  //      page explicitly provides alerts (e.g. unverified-email banner,
  //      "record is locked" notice). The `record:alert` renderer handles
  //      its own visibility predicate and dismiss persistence.
  if ('alerts' in slots && slots.alerts !== undefined) {
    components.push(...toNodeArray(slots.alerts));
  }

  // 3) Highlight strip (chips + chevron path).
  if ('highlights' in slots && slots.highlights !== undefined) {
    components.push(...toNodeArray(slots.highlights));
  } else {
    components.push(...buildDefaultHighlights(def, {
      highlightFields: options.highlightFields,
      statusField: options.statusField,
      stages: options.stages,
      hideHighlights: options.hideHighlights,
      hidePath: options.hidePath,
    }));
  }

  // Decide whether to emit the Reference Rail. When emitted, suppress
  // the duplicate Related tab to avoid showing the same data twice
  // (HubSpot/Dynamics convention). Authors can opt out of either via
  // `hideReferenceRail` / `hideRelatedTab`.
  const willEmitRail =
    options.showReferenceRail === true &&
    !options.hideReferenceRail &&
    Array.isArray(options.related) &&
    options.related.length >= 2;
  const hideRelatedTab =
    options.hideRelatedTab ?? willEmitRail;

  // 4) Tabs — `tabs` slot wins over `details` slot when both are
  //    provided (broader override). When only `details` is provided,
  //    splice it into the Details tab body and keep Related/Activity/
  //    History tabs synthesized.
  if ('tabs' in slots && slots.tabs !== undefined) {
    components.push(...toNodeArray(slots.tabs));
  } else if ('details' in slots && slots.details !== undefined) {
    const detailsBody = toNodeArray(slots.details);
    const tabsNode = buildDefaultTabs(def, {
      sections: options.sections,
      related: options.related,
      showActivity: options.showActivity,
      history: options.history,
      approvals: options.approvals,
      highlightFields: options.highlightFields,
      statusField: options.statusField,
      hideRelatedTab,
      relatedLayout: options.relatedLayout,
      hideAttachments: options.hideAttachments,
    });
    // Replace the first tab's children (Details) with the override. The items
    // live in the node's `properties` bag — the canonical carrier per
    // ADR-0089 D3a (see `componentNode`).
    const tabItems = tabsNode.properties?.items;
    if (Array.isArray(tabItems) && tabItems.length > 0) {
      tabItems[0] = { ...tabItems[0], children: detailsBody };
    }
    components.push(tabsNode);
  } else {
    components.push(buildDefaultTabs(def, {
      sections: options.sections,
      related: options.related,
      showActivity: options.showActivity,
      history: options.history,
      approvals: options.approvals,
      highlightFields: options.highlightFields,
      statusField: options.statusField,
      hideRelatedTab,
      relatedLayout: options.relatedLayout,
      hideAttachments: options.hideAttachments,
    }));
  }

  // 5) Discussion footer. (Attachments are NOT part of this footer: for
  //    `enable.files` objects buildDefaultTabs emits a peer Attachments tab
  //    instead — objectstack#4358.)
  if ('discussion' in slots && slots.discussion !== undefined) {
    components.push(...toNodeArray(slots.discussion));
  } else if (!options.hideDiscussion) {
    components.push(buildDefaultDiscussion());
  }

  // 6) Reference Rail — Salesforce/HubSpot-style aside summary of
  //    related collections. Auto-emit only when the record has at
  //    least 2 related lists; otherwise the rail is mostly noise.
  //    Hidden on screens below `xl` so the main column owns full width
  //    at common laptop widths.
  const regions: any[] = [
    {
      name: 'main',
      width: 'full',
      components,
    },
  ];

  const rightRailExtras = toNodeArray(slots.rightRail);
  const willEmitAside = willEmitRail || rightRailExtras.length > 0;

  if (willEmitAside) {
    const asideComponents: any[] = [];
    if (willEmitRail) {
      // No `icon` on rail entries: `ReferenceRailEntrySchema` is `$strict`
      // without it, so emitting `rel.icon` here wrote a key the spec refuses
      // at save — and no render path ever read it (objectui#5494).
      asideComponents.push(componentNode('record:reference_rail', {
        entries: (options.related as any[]).map((rel) => ({
          objectName: rel.objectName,
          relationshipField: rel.relationshipField,
          title: rel.title,
          displayField: rel.displayField,
          limit: 3,
        })),
      }));
    }
    // Author-contributed right-rail nodes follow the reference rail so the
    // canonical "related" summary stays anchored at the top.
    if (rightRailExtras.length > 0) {
      asideComponents.push(...rightRailExtras);
    }
    regions.push({
      name: 'aside',
      width: 'small',
      className: 'hidden xl:flex flex-col gap-4',
      components: asideComponents,
    });
  }

  return {
    type: 'record',
    pageType: 'record',
    object: def?.name,
    // `default`, not `full-width`: the spec's `PageSchema.template` names four
    // layouts and retires `full-width` by name (its replacement is `default`),
    // so a Studio seed carrying it is refused at save. Both names were drawn
    // by the same renderer component, which `default` still names, so the
    // seed lays out unchanged (objectui#12476 dropped `full-width`).
    template: 'default',
    regions,
  };
}
