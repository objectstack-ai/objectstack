// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import {
  ViewFilterRuleSchema,
  ViewDataSchema,
  GanttConfigSchema,
  TreeConfigSchema,
  ListMapConfigSchema,
  // [commit e233db9db] The element-level record-click carrier and the timeline config
  // block are taken BY REFERENCE from the view face — one def each, so the
  // standalone element cannot fork the vocabulary a view already declares.
  NavigationConfigSchema,
  TimelineConfigSchema,
  // [#18639] `record:related_list.columns` is the SAME union the saved-view key
  // declares, taken by reference for the same reason: objectui composes a saved
  // view's `columns` onto this block verbatim, so a second spelling of the
  // member schema would be a second thing to drift.
  ListColumnSchema,
  // [#20831] `object-grid.grouping` and `object-kanban.grouping` are the SAME
  // grouping config a list view carries, taken by reference: both renderers
  // read `grouping.fields[i].field` (the kanban only `fields[0]`, as its
  // swimlane fallback), so one declaration judges every door that carries it.
  GroupingConfigSchema,
  // [#20694] `object-grid.emptyState` is the list view's own empty state, taken
  // by reference: the grid draws the same key through the same shared
  // component `ListView` does, so one declaration judges both doors.
  EmptyStateSchema,
} from './view.zod';
import { InlineActionSchema, ActionLocationSchema } from './action.zod';
import { ACTION_TARGET_ALIASES } from './action-target-aliases';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { FeedItemType, FeedFilterMode } from '../data/feed.zod';
import { lazySchema } from '../shared/lazy-schema';
import { EvaluatedExpressionInputSchema } from '../shared/expression.zod';
import { evaluatedExpressionUnionRefusal } from '../shared/evaluated-slot-union';
import { retiredKey } from '../shared/retired-key';
// The retired page-component TYPES' prescriptions — one string per type, three
// doors (#14159): the enum's error map and the `PageComponentSchema.type` check
// in page.zod.ts, and the kept `ComponentPropsMap` rows below.
import { RETIRED_PAGE_COMPONENT_TYPES } from './page.zod';
// `element:record_picker`'s flat `sort` shorthand is the SAME contract as
// `ElementDataSourceSchema.sort` (page.zod.ts) — one shape, imported from the
// shared source rather than re-spelled here (commit 78f0be872).
import { SortItemSchema } from '../shared/enums.zod';
import { strictObject } from '../shared/strict-object';
import { ruleArrayFilterError } from './filter-rule-array';
import type { KeySetGuidance } from '../shared/suggestions.zod';
// [#13855] The section → field-group reference form, shared with
// `FormSectionSchema` (view.zod.ts) so one mixing rule serves both escape hatches.
import { SectionGroupKeySchema, sectionGroupReferenceRefinement } from '../shared/section-group-reference';
// [#20928] `object-master-detail-form`'s `details[].columns` is the SAME inline
// grid column a relationship field's `inlineColumns` and a form view's
// `subforms[].columns` take, referenced rather than copied: all three carriers
// feed one objectui grid.
import { InlineGridColumnSchema } from '../data/field.zod';

// ---------------------------------------------------------------------------
// CLOSED AGAINST UNKNOWN KEYS as of #4001 batch A -- all 31 object sites.
// (#7751 then GREW the map by the `object-*` block family -- six entries,
// strict from birth, key sets derived from objectui's renderer read points;
// see the "Object-bound SDUI blocks" section below. The "31"s in this header
// are batch A's own count, kept as the historical measurement they were.)
//
// SDUI component prop schemas: the declarative shape of every `page:*`,
// `record:*`, `element:*`, `nav:*` and `ai:*` node a page can carry.
//
// ⚠️ READ THE SCOPE BEFORE ACTING ON THIS. Closing these shapes moved the
// rejection into ONE door -- the #5068 authoring gate's `safeParse` half. It
// did NOT close the carrier and it did NOT close storage:
//
//   - `PageComponentSchema.properties` is still `z.record(z.string(),
//     z.unknown())`. Direction B (a discriminated `properties`) stays DECLINED
//     by the maintainer's 2026-08-05 ruling, because `type` is an open union and
//     a discriminated carrier would reject the unregistered types real pages
//     author. An unknown key inside `properties` therefore still survives
//     `PageSchema.parse()` -- pinned, deliberately, in `component.test.ts`.
//   - A `saveMetaItem` / REST `/meta` write still stores an unvalidated props
//     bag (#4463's fourth wall). Recorded, not fixed.
//   - The gate is still WARNING level. Batch A did not upgrade it; what stands
//     between it and `error` is the page rewrites named at the end of this
//     header, not a declaration in this file.
//
// So the honest one-line summary is: an undeclared prop is now rejected BY THE
// PARSE at authoring time, with the surface named and the rename offered,
// instead of being reconstructed by a walker reading a strip-mode object. Same
// rule id, same tier, one fewer moving part -- and a shape that can now carry
// its own `aliases` / `guidance`, which a walker's reconstruction could not.
//
// The 批 17 measurement that produced the earlier `no gate` verdict is kept
// verbatim below. It is why this file took three batches, and every sentence of
// it was true when written; the two flips since (#5068 wired the parse, batch A
// closed the shapes) are recorded at the points where they land.
//
// It was scheduled as the #4001 campaign's largest remaining `ui/` block and
// the measurement came back NEGATIVE: nothing parses these schemas, so
// `.strict()` here would enforce exactly nothing while spending a v17 breaking
// change to produce what #4583 calls "a precisely validated dead slot -- the
// more convincing lie".
//
// `.strict()` is a property of a PARSE. Three independent measurements, each
// with its controls green in the same run (2026-08-04):
//
// 1. THE CARRIER IS AN OPEN BAG. `PageComponentSchema.properties` is
//    `z.record(z.string(), z.unknown())` (`page.zod.ts`). `PageComponentSchema`
//    itself has been `.strict()` since ADR-0089 D3a — but strictness does NOT
//    recurse, so it closes the component node's own keys and leaves everything
//    under `properties` unchecked. Nothing dispatches `ComponentPropsMap` by
//    `type`.
// 2. BFS-UNREACHABLE. From all 24 metadata-type roots plus `defineStack`'s
//    `ObjectStackSchema`, over a 6899-node closure built with `build-schemas.ts`'s
//    own `zodChildSchemas` / `zodShapeOf` (the #4650 walk), all 52 targets here
//    (21 exported schemas + every one of `ComponentPropsMap`'s 31 entries) come
//    back UNREACHABLE — while `PageSchema`, `PageComponentSchema`,
//    `PageRegionSchema`, `ThemeSchema`, `ChartConfigSchema` and
//    `ResponsiveConfigSchema` all resolve `root-graph` in that same run, and 批 13's
//    measured no-door shapes stay unreachable. The walk stops at `properties`.
// 3. NO PRODUCTION PARSE. Across `objectstack`, `objectui` and `cloud`, every
//    `.parse()` / `.safeParse()` on anything in this file is inside this file's
//    own unit tests. `objectui` mirrors the props as hand-written React
//    interfaces and imports only the inferred TYPES; `cloud` references none.
//    `react-blocks.ts` uses `Object.keys(ComponentPropsMap)` for type names only —
//    its `REACT_BLOCKS[].schema` entries all point at view/chart schemas.
//
// The #5056 bridge defect does NOT touch this result. That defect makes the
// derived-clone bridge report dead shapes as REACHABLE (shared `.describe()`
// clones under common leaves like `SnakeCaseIdentifier` / `I18nLabel`), so its
// error direction is the opposite of this verdict -- it could only have hidden a
// no-gate finding, never manufactured one. And nothing here rests on that bridge
// anyway: all six positive controls resolve `root-graph` (their own instances are
// in the closure), and all 52 targets miss BOTH `root-graph` and `derived-clone`.
// The two non-BFS measurements below stand on their own regardless.
//
// Empirically, through the live door (`definePage()` IS `PageSchema.parse()`): on
// the example corpus an undeclared key written inside `components[].properties`
// parses clean and is RETAINED on 10/10 pages, while the same key one level out
// — a sibling of `properties` — is rejected on 10/10. The negative control is
// what makes the first number mean something.
//
// WHY `no gate` AND NOT `no door` (批 13 vs 批 15)
//
// The vocabulary here is ALIVE — this is not dead surface to retire under
// ADR-0049. Authors write these keys on real pages, and objectui's
// `SchemaRenderer` hoists `properties` onto the node and spreads every key that
// is not on its fixed metadata deny-list straight into the React component. So
// a misspelled key is neither rejected nor dropped: it reaches the renderer and
// is ignored there. That is the ADR-0078 failure mode, one layer below where
// this campaign can reach.
//
// The contract-first fix is therefore to WIRE THE PARSE at the carrier's own
// gate, not to close schemas nobody calls — filed as #5068, which also
// records the two constraints that stop it being a drive-by: `type` is an open
// union (unregistered types like `record:line_items` are authored in the wild),
// and real pages already author shapes these schemas do not declare (the record
// picker's `labelField` — see `packages/lint/src/validate-page-field-bindings.ts`,
// which has documented the untyped bag all along). `record:details`
// `sections[]` / `hideFields[]` WAS the largest such divergence and is now
// closed: #5611 re-declared `sections` in the object form every page actually
// authors and declared `hideFields`, so wiring the gate no longer turns three
// showcase pages and the `sys_user` platform page into hard parse errors.
//
// #5775 closed the rest of that inventory in both directions, on the same #5611
// rule (the delivered, authorized shape is the contract): nine keys the
// renderers honour were DECLARED (`element:record_picker` `labelField` /
// `valueField` / `label` / `emptyText`, `record:path` `stages[].terminal`,
// `page:tabs` `items[].value` / `items[].count`, `page:card` `children`, and
// `children` on the three thin containers that were declared `EmptyProps`),
// and four that nothing read were RETIRED with tombstones + ADR-0087 D2
// conversions (`displayField` → `labelField`, `page:card.body` → `children`,
// `searchFields`, `multiple`). What is deliberately NOT closed here is
// `page:card.visible`: a component-level visibility predicate written into
// `properties` and hoisted by `SchemaRenderer`. The canonical spelling is the
// component-level `visibleWhen` (ADR-0089) — that one is a page to rewrite, not
// a key to declare.
//
// "The rest of that inventory" was one pair short, and how the shortfall
// happened is the reusable part: #5775's ruling named its keys individually, so
// the two `element:record_picker` shorthands the renderer reads through the
// SAME `ds.x ?? props.x` line as the keys that were named — `sort` and `limit`
// — fell outside it and stayed undeclared. Commit 78f0be872 declared them on the same
// #5611 rule (maintainer ruling 2026-08-08, direction A). The lesson for the
// next divergence sweep: enumerate by the RENDERER'S read pattern, not by the
// key list a previous ruling happened to quote. Retiring the flat family
// wholesale in favour of `dataSource` is the standing alternative, deferred to
// v18 as #11509 — not rejected.
//
// ── #5068: THE GATE IS WIRED — read the flip precisely ─────────────────────
//
// `packages/lint/src/validate-component-props.ts` dispatches on the component's
// `type` and judges `properties` against the entry below it: undeclared keys
// through the same walker every metadata collection uses
// (`lintUnknownKeysAgainstSchema`), values through `safeParse`. It runs on
// `os validate` / `os build` / `os lint` from the shared authoring registry.
// So these schemas ARE parsed now, and this file is `authorable`.
//
// Three things that flip did NOT do, each of which someone will otherwise
// assume:
//
//  1. **The carrier is unchanged, on purpose.** `PageComponentSchema.properties`
//     is still `z.record(z.string(), z.unknown())`. The maintainer's 2026-08-05
//     ruling took direction A (gate at the authoring door) and DECLINED
//     direction B (a discriminated `properties`) as breaking against an open
//     `type` union. So the three standing assertions in `component.test.ts`
//     stay GREEN — measured, not assumed — and their prose was updated to say
//     which dispatch actually landed.
//  2. **Nothing here became strict** — at #5068. All 31 entries still STRIPPED,
//     and the gate reported an undeclared key because the walker read a
//     strip-mode object. ✅ **#4001 batch A did the conversion this sentence
//     predicted**: every site is a `strictObject` now, so the same report
//     arrives through the gate's `safeParse` half (`unrecognized_keys`, routed
//     to the same rule id). Two things came with it that the walker could not
//     produce, and they are the reason the conversion was not cosmetic:
//     hand-written `aliases`/`guidance` per surface (`key` → `value` on a tab
//     item, `description` → `subtitle` on a header, the wrong-layer
//     component-node family), and a rejection that holds on ANY caller of these
//     schemas rather than only inside the gate that walks them.
//
//     Union arms needed one piece of wiring on the lint side to arrive at all:
//     zod 4 collapses arm failures into a single `invalid_union`, so
//     `validate-component-props.ts` unpacks a lone arm's `unrecognized_keys`
//     back onto the unknown-key rule id (`unrecognizedKeysFromUnionArm`), and
//     deliberately declines to do so when two arms could both have been meant.
//  3. **The storage path is still open.** The gate is an AUTHORING door. A
//     `saveMetaItem` / REST `/meta` write still stores an unvalidated props bag
//     (#4463's fourth wall). That is recorded, not fixed, by #5068.
//
// The gate is WARNING-level in this first step. The live corpus violated these
// declarations in places that were open contract questions rather than
// authoring mistakes, and the inventory is the acceptance baseline for the
// error upgrade. Two of the three entries are now cleared:
//
//  - #5775 declared the keys objectui's renderers honour and tombstoned the
//    four nothing read.
//  - #5728 settled the inline `{ en, 'zh-CN' }` label maps the three published
//    platform pages author: the maintainer ruled (2026-08-06) that the map is a
//    delivered capability, so `I18nLabelSchema` is a union of the plain string
//    and an inline locale map, and `element:text.content` — declared a bare
//    `z.string()` and therefore out of that union's reach — was named in the
//    same ruling and moved onto it. That retired all 42 `component-props-invalid`
//    findings this gate reported on the platform pages (34 label + 8 content).
//
// What remains before the upgrade to error is the page rewrites
// (`page:card.visible` → the component-level `visibleWhen`, #5776's tab `key`
// → `value`), not a declaration in this file.
//
// ⚠️ One inventory item batch A ADDED rather than closed, because measuring the
// renderers turned it up: objectui's Studio block designer publishes inputs that
// no renderer reads — `page:accordion` `title` and its items' `value` (the
// renderer overwrites `value` with `panel-<index>`), and `page:header.icon`,
// which #6946 retired here. Those are producer-side defects in the sibling repo
// (filed as #7973), not keys to declare; the accordion item's
// `value` carries a `guidance` entry so an author who copies the designer's
// output is told what happened rather than merely refused.
//
// The verdict is pinned in `component.test.ts` and in the `ui/` tables of
// `docs/audits/2026-07-unknown-key-strictness-ledger.md` — change all three
// together or none.
// ---------------------------------------------------------------------------


/**
 * What silently happened to an undeclared prop before these shapes were closed
 * — the one sentence every rejection on this file carries.
 *
 * Two layers of silence, not one, which is why the sentence names both: the
 * schema STRIPPED the key (nothing in `ComponentPropsMap` was strict), and the
 * carrier never parsed it anyway (`PageComponent.properties` is
 * `z.record(z.string(), z.unknown())`). #5068 wired the parse; this closes the
 * shapes behind it, so the rejection is now the parse's own rather than a
 * walker's reconstruction of it.
 */
const PROPS_HISTORY =
  'Until this shape was closed, an undeclared prop was dropped in silence: the props schema stripped it '
  + 'and `PageComponent.properties` is an open bag, so the key reached objectui\'s renderer, was '
  + 'not read there, and the author got a success receipt for configuration that did nothing.';

/**
 * The keys that belong on the component NODE, written one level down inside
 * `properties` — the wrong-layer trap this carrier creates by construction.
 *
 * objectui's `SchemaRenderer` HOISTS `properties` onto the node before
 * rendering, which is what makes the confusion durable: for a renderer read
 * the two spellings are interchangeable, so an author who writes
 * `properties.visibleWhen` sees the key "work" in some places. It does not
 * work where it matters — `visibleWhen` is evaluated by the page runtime off
 * the NODE, and `SchemaRenderer` deliberately skips `type` and `id` when
 * hoisting (hoisting `type` would shadow which renderer to dispatch to). So
 * the inner spelling is honoured by nothing that decides anything.
 *
 * A pattern rather than a list for the visibility family, on the #6619
 * precedent: the point is to catch the spellings nobody enumerated
 * (`visibleIf`, `hiddenWhen`, `visibility`), and ADR-0089 made `visibleWhen`
 * canonical on the node, so an author borrowing it here is not making a typo.
 * `page:card.visible` is the live specimen the file header has carried since
 * #5775 — deliberately never declared, because it is a page to rewrite rather
 * than a key to add.
 */
/**
 * The two sets are NAMED individually (#8744) because one row cannot carry the
 * visibility set: `record:alert` DECLARES `visible` — the one record component
 * whose renderer evaluates a props-level predicate — and the #6619 audit
 * rightly refuses a pattern set whose example is a declared key. Every other
 * row keeps taking the pair via `COMPONENT_LEVEL_GUIDANCE` below, unchanged.
 */
const COMPONENT_NODE_VISIBILITY_GUIDANCE: KeySetGuidance =
  {
    name: 'COMPONENT_NODE_VISIBILITY_KEYS',
    keys: /^(visible|visibility|visibleOn|visibleIf|visibleWhen|hidden|hiddenWhen|conceal|showWhen)$/,
    examples: ['visible', 'visibleWhen', 'visibleIf', 'hiddenWhen', 'visibility'],
    prescription:
      'Visibility is a COMPONENT-level predicate, not a prop: move it up one level to the '
      + 'component node\'s own `visibleWhen` (ADR-0089 canonical spelling), beside `type` and '
      + '`id` — one canonical spelling per layer, not because the props-level form is inert. '
      + 'Since the console release of 2026-08-21 (`c86185eb5`) the hoisted form IS evaluated by '
      + 'the node-level gate: the two gates evaluate the same value and compose as an '
      + 'idempotent AND, so leaving it in `properties` duplicates the canonical key rather '
      + 'than silently failing to gate.',
  };

const COMPONENT_NODE_KEYS_GUIDANCE: KeySetGuidance =
  {
    name: 'COMPONENT_NODE_KEYS',
    /**
     * Read off `PageComponentSchema`'s own shape (`page.zod.ts`) and then
     * NARROWED, twice, because a set member the shape declares is a dead entry
     * the `alias-integrity` audit rejects — and it caught both of these:
     *
     * - `type` is out. It really is a prop on `element:metadata_viewer` (the
     *   metadata view kind — `state_machine` | `flow` | `permission`) and a
     *   tombstone on `page:tabs` (#6776), so a blanket "this belongs on the
     *   node" would be a WRONG answer on the two surfaces most likely to see it.
     * - `label`, `aria` and `properties` are out for the same reason: `label`
     *   and `aria` are declared props almost everywhere in this file.
     *
     * What is left is node-only in both directions: nothing in this file
     * declares any of them, and the page runtime reads each off the node.
     */
    keys: ['id', 'events', 'style', 'className', 'responsiveStyles', 'dataSource', 'responsive'],
    prescription:
      'This key belongs on the component NODE, not inside `properties` — write it as a sibling '
      + 'of `type`. `SchemaRenderer` skips `id` when it hoists `properties`, and `dataSource` / '
      + '`responsive` / `events` / `style` / `className` / `responsiveStyles` are read off the '
      + 'node by the page runtime, so the inner spelling is parsed by nothing.',
  };

const COMPONENT_LEVEL_GUIDANCE: readonly KeySetGuidance[] = [
  COMPONENT_NODE_VISIBILITY_GUIDANCE,
  COMPONENT_NODE_KEYS_GUIDANCE,
];

/**
 * Empty Properties Schema
 */

/**
 * A component that declares no props at all — `app:launcher`, `nav:menu`,
 * `nav:breadcrumb`, `global:search`, `global:notifications`,
 * `element:divider`, and the three plugin console widgets
 * `cloud-connection:panel` and `marketplace:installed-list` (#11575) and
 * `mcp:connect-agent` (#12344). `user:profile` left this list at #14159 — it
 * is not author-placeable at all, so its row refuses the whole bag
 * ({@link retiredComponentProps}).
 *
 * A factory rather than one shared `EmptyProps` const, because the surface name
 * is the whole value of the rejection here: an empty shape has no candidate
 * keys, so the edit-distance fallback can say nothing, and "unrecognized key on
 * this component" would leave the author guessing which of the nine it meant.
 * One `strictObject(` call site either way — the ledger counts sites from the
 * AST, and this is one.
 *
 * Closing them is not vacuous even with nothing to declare: `element:divider`
 * carries an authored `{}` on 9 nodes of the example corpus, and the whole
 * point of the class is that these components take no configuration. Before
 * this, `<Divider color="red">` parsed clean and drew a divider with no colour.
 */
const emptyProps = (type: string) =>
  strictObject(
    {
      surface: `this \`${type}\` component`,
      history: `\`${type}\` declares no props at all. ${PROPS_HISTORY}`,
      guidanceSets: COMPONENT_LEVEL_GUIDANCE,
    },
    {},
  );

/**
 * A component RETIRED at element grain whose props bag is refused WHOLE —
 * `user:profile` (#14159). The `retiredKey` channel one grain wider: where a
 * tombstoned KEY accepts absence and refuses any value, a retired ELEMENT has
 * nothing an author may write at all, so the row is `z.never` — `{}` is refused
 * exactly like a populated bag, `expected: 'never'` / `code: 'invalid_type'` is
 * the same issue shape a key tombstone raises, and the message is the element's
 * retirement prescription from `RETIRED_PAGE_COMPONENT_TYPES` (page.zod.ts), so
 * the row and the node-level refusal on `PageComponentSchema.type` cannot drift
 * apart. A type that map does not name has no business here — the throw makes
 * a row without its prescription a module-load error, not a silent `undefined`
 * message.
 *
 * Why not delete the row: `component-type-vocabulary.ts` derives the KNOWN set
 * from the row keys, the #5068 props gate skips a type with no row as an
 * unregistered custom string, and `check-yaml-examples` judges only rowed types
 * — deleting the row would demote a loud retirement to a silent skip on every
 * reader that dispatches on it (the `element:filter` argument, #9220).
 */
const retiredComponentProps = (type: string) => {
  const guidance = RETIRED_PAGE_COMPONENT_TYPES.get(type);
  if (!guidance) {
    throw new Error(`retiredComponentProps: \`${type}\` has no RETIRED_PAGE_COMPONENT_TYPES entry (page.zod.ts)`);
  }
  return z.never({ error: () => guidance }).describe(`[REMOVED] ${guidance}`);
};

/**
 * Component-composition SLOTS — declared here, on the rows, and nowhere else
 * (#20940).
 *
 * A slot is a props key whose value is an ordered list of child page
 * components the renderer draws: a container's `children`, a card's `footer`,
 * a tab or accordion panel's `items[].children`. `properties` is an open bag
 * nothing parses by `type` on the load path, so every pass that has to reach a
 * nested component — the ADR-0087 conversion walker, the exported
 * `walkAddressedPageComponents` (`translatePage`, the CLI extractor, objectui's
 * validator) and `@objectstack/lint`'s `walkPageComponents` — has to be TOLD
 * where the sub-trees hang. Each used to carry its own list, and the three
 * disagreed: lint walked a card's `footer`, the exported walk did not, so a
 * node there was judged by `os lint` and skipped by every consumer of the
 * exported walk.
 *
 * So the row declares the fact and {@link pageComponentSlotPositions} derives
 * the one list from `ComponentPropsMap`: a key is a slot exactly when its row
 * wraps its schema in {@link componentSlot}. The marker adds nothing to the
 * schema — the instance it returns is the one it was handed, so the parse, the
 * JSON Schema and the authorable surface are byte-identical to the unmarked
 * key; it only records the instance in a module-private registry.
 *
 * {@link retiredComponentSlot} marks a TOMBSTONED spelling of a slot:
 * `page:card.body`, retired by #5775 (maintainer ruling 2026-08-06, direction
 * A — one composition key, `children`). It is not an authorable spelling, and
 * the authoring walks do not descend it; the renderers still read it as a
 * back-compat fallback for STORED documents, which is exactly the population
 * the conversion walker normalizes, so that walker keeps descending it.
 */
const COMPONENT_SLOT_DECLARATIONS = new WeakMap<object, { readonly retired: boolean }>();

/**
 * Declare the key whose schema this is as a component-composition slot. Wrap
 * the OUTERMOST schema the shape holds (after `.optional()` / `.describe()`),
 * so the registered instance is the one `shape[key]` returns.
 */
function componentSlot<T extends z.ZodType>(schema: T): T {
  COMPONENT_SLOT_DECLARATIONS.set(schema, { retired: false });
  return schema;
}

/** {@link componentSlot} for a tombstoned spelling of a slot — see the block above. */
function retiredComponentSlot<T extends z.ZodType>(schema: T): T {
  COMPONENT_SLOT_DECLARATIONS.set(schema, { retired: true });
  return schema;
}

/**
 * The composition slot every thin container renders: `page:section`,
 * `page:footer`, `page:sidebar`.
 *
 * All three were declared `EmptyProps` — "this component takes zero props" —
 * while their renderers have always rendered a child list
 * (`renderChildren(schema.children || schema.body)` in objectui's
 * `containers.tsx`, one per registered renderer). Declaring zero props for a
 * container that renders children is the ADR-0078 shape from the schema side:
 * the #5068 gate reports every authored `children` as an unknown key, and a
 * `.strict()` batch would reject the only thing these components are for.
 *
 * `children` is the canonical spelling — it is what `grid`, `flex`,
 * `page:accordion` items and `page:tabs` items already use, and what the
 * renderers read FIRST. `body` is deliberately NOT declared here (#5775): one
 * composition key, not two (Prime Directive #12). The renderers keep reading
 * `body` as a back-compat fallback for stored documents; that fallback is
 * objectui's to retire on its own schedule, and it is not a second authorable
 * spelling.
 *
 * Shared by all three entries rather than copied: they are the same contract,
 * and three identical defs would be three places for it to drift.
 */
export const PageContainerProps = strictObject(
  {
    surface: 'this container component (`page:section` / `page:footer` / `page:sidebar`)',
    history: PROPS_HISTORY,
    guidanceSets: COMPONENT_LEVEL_GUIDANCE,
    guidance: {
      // Not a typo the suggester can reach (`body` → `children` is five edits),
      // and not a second spelling either: the renderers read `body` as a
      // back-compat fallback for STORED documents (`renderChildren(schema.children
      // || schema.body)`), which #5775 settled is objectui's to retire on its own
      // schedule rather than an authorable key. Closing the shape is what makes
      // that distinction reach the author.
      body: '`body` is not an authorable spelling of the composition slot — write `children`. '
        + 'The renderers still read `body` as a back-compat fallback for documents stored under '
        + 'the older spelling, but one composition key is the contract (Prime Directive #12).',
    },
  },
  {
    children: componentSlot(z.array(z.unknown()).optional().describe('Child components rendered inside this container, in order')),
  },
);
export type PageContainerProps = z.input<typeof PageContainerProps>;

/**
 * ----------------------------------------------------------------------
 * 1. Structure Components
 * ----------------------------------------------------------------------
 */

export const PageHeaderProps = strictObject({
  surface: 'this `page:header`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  aliases: {
    /**
     * The ADR-0087 D2 conversion `page-header-subtitle-alias` (#4827,
     * objectui#3226) renames this on load and on stored-row rehydration, so the
     * canonical paths never reach here. What DOES reach here is the source an
     * author is typing right now — and until this shape closed, that was the
     * one path with no diagnostic at all: `conversions/walk.ts` records the
     * hole in as many words, that `description` "is tombstoned nowhere
     * (`description` is a live declared prop on other components), got no
     * diagnostic at a nested site from any layer".
     *
     * An alias rather than a `retiredKey` tombstone precisely because of that
     * parenthesis: `description` is a live prop elsewhere in this file
     * (`element:text_input`), so the answer is a rename on THIS surface, not a
     * removal notice. Grounded in the conversion registry rather than guessed.
     */
    description: 'subtitle',
  },
}, {
  /**
   * Page title (#7702, maintainer ruling 2026-08-11 「接受你的建议,开始加速处理」
   * on the lane's A/B recommendation). OPTIONAL, not required: the platform's
   * own synthesizer (objectui `buildDefaultHeader`) emits every seeded
   * `page:header` with no `title` at all — `PageHeaderRenderer`
   * (`containers.tsx:1013`) reads `schema?.title ?? schema?.properties?.title`
   * and, finding neither, falls through to the record chip's own
   * record-derived heading. A required `title` would reject the platform's
   * own canonical output. Sanctioned spelling: title omitted ⇒ the renderer
   * derives the heading from the record. Authors still set it explicitly for
   * non-record pages (dashboards, landing pages) where there is no record to
   * derive from.
   */
  title: I18nLabelSchema.optional().describe(
    'Page title. Omit to let the renderer derive the heading from the record (the default for record pages) — set explicitly on non-record pages (dashboard, landing) with no record to derive from.',
  ),
  subtitle: I18nLabelSchema.optional().describe('Page subtitle'),
  /**
   * REMOVED (#6946, maintainer ruling 2026-08-09 「全部接受」 on objectui#3829,
   * route (c) — retire upstream).
   *
   * A header icon nothing has ever drawn. `PageHeaderRenderer`
   * (`containers.tsx`) resolves `icon` only per header ACTION (`action.icon`,
   * inside the action pipeline) and never off the header's own props bag;
   * `@object-ui/layout`'s `<PageHeader>` accepts an `icon` REACT prop from a
   * host but — unlike `actions`, whose `schema?.actions ??
   * schema?.properties?.actions` fallback sits four lines away in the same
   * function — gives it no schema fallback, so an authored node cannot reach
   * it. objectui's registration publishes no `icon` input either, which is
   * what put this key in that repo's `UNPUBLISHED_EXEMPTIONS` map as a B-class
   * "spec declares it, NO renderer read point" entry.
   *
   * The live mechanism is the record chrome (`recordChrome`, on by default)
   * for the header's own identity, and each action's own `icon` for the
   * buttons beside it.
   */
  icon: retiredKey(
    '`page:header` property `icon` was removed in @objectstack/spec 17.0.0 (ADR-0087 D2) — '
    + 'no renderer ever read it: objectui resolves `icon` only per header action (`action.icon`), '
    + 'never off the header\'s own props bag, and the component registry never published it as an '
    + 'input, so an authored value was accepted and dropped. Delete the key. The header\'s own '
    + 'identity is drawn by the record chrome (`recordChrome`, on by default) and each action '
    + 'carries its own `icon`. '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  /**
   * REMOVED (#20758, ADR-0049 enforce-or-remove through the ADR-0087 D2 route,
   * the way `icon` above left this row; the spec half of objectui#11166).
   *
   * A trail switch with no trail behind it. `PageHeaderRenderer`
   * (`containers.tsx`) reads the key and, when it is not `false`, draws an
   * EMPTY `div[data-page-breadcrumb-slot]` in both layouts; nothing fills it.
   * The console's navigation trail is drawn once, by the shell (`AppHeader`
   * inside `/apps/:appName/*`), so a page-level renderer would duplicate it
   * rather than supply something missing. The default `true` was never
   * materialized into a built artifact: `PageComponentSchema.properties` is an
   * open bag, and this row is parsed only by the advisory props lint, which
   * writes nothing back — so no retired-default residue stage is owed.
   *
   * Stored and built pages that carry the key (`true` or `false`) are stripped
   * by the D2 conversion `page-header-breadcrumb-removed`, with a notice.
   */
  breadcrumb: retiredKey(
    '`page:header` property `breadcrumb` was removed in @objectstack/spec 17 (ADR-0087 D2) — '
    + 'no renderer ever drew a trail for it: objectui drew an empty slot and nothing filled it, '
    + 'and the navigation trail is drawn once, by the app shell\'s header. Delete the key, whether '
    + 'it was `true` or `false`; the shell\'s trail is unchanged. '
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  actions: z.array(z.string()).optional().describe('Action IDs to show in header'),
  /**
   * Which of the two page-header layouts the renderer builds (#6776).
   *
   * ON (the default) the header carries the **record chrome**: the title
   * renders as a record chip with the follow star and the copy-record-id
   * button beside it. OFF it falls back to a bare heading — one title line and
   * nothing record-shaped — which is what a dashboard or a landing page wants,
   * since there is no record for the chip to describe.
   *
   * Declared here because the renderer has always read it and the schema had
   * not caught up: `containers.tsx:979` resolves
   * `schema?.recordChrome === false || schema?.properties?.recordChrome === false`
   * and `:1453` branches the whole header on it, while objectui's own console
   * preview sample authors `recordChrome: false` on a non-record page. Until
   * this declaration that page was legal per objectui's published manifest and
   * `warning: undeclared` per `validateComponentProps` (#5068) — two platform
   * authorities disagreeing about one key (#5435).
   */
  recordChrome: z.boolean().default(true).describe(
    'Render the record chrome — the title as a record chip with its follow star and copy-id button. Set false on a non-record page (dashboard, landing) to fall back to the bare heading layout.',
  ),
  /**
   * Follow (favourite) star beside the record title — `RecordTitleChip
   * showStar` (#6776). Part of the record chrome, so it has no effect when
   * `recordChrome` is false. Read at `containers.tsx:980`, consumed at `:1531`.
   */
  showStar: z.boolean().default(true).describe(
    'Show the follow (favourite) star beside the record title. Part of the record chrome — no effect when `recordChrome` is false.',
  ),
  /**
   * Copy-record-id button beside the record title — `RecordTitleChip
   * showCopyId` (#6776). Same record-chrome scoping as `showStar`. Read at
   * `containers.tsx:981`, consumed at `:1532`.
   */
  showCopyId: z.boolean().default(true).describe(
    'Show the copy-record-id button beside the record title. Part of the record chrome — no effect when `recordChrome` is false.',
  ),
  /**
   * How many header actions render as inline buttons before the rest fold into
   * the overflow menu — desktop and mobile budgets (#4001 batch A).
   *
   * Declared on the #5611/#5775/#6276 rule, for the same reason and by the same
   * evidence: the renderer has always read them and the schema had not caught
   * up. `containers.tsx:1358` resolves
   * `schema?.maxVisible ?? schema?.properties?.maxVisible` (and the `mobile*`
   * twin), the `?? 3` / `?? 1` are its own fallbacks, and its comment says out
   * loud that both are "overridable on the page:header". Closing this shape
   * without declaring them would turn an invited affordance into a hard
   * rejection — the lesson of commit 78f0be872, which is to enumerate by the RENDERER'S read
   * pattern rather than by the key list a previous ruling happened to quote.
   *
   * Optional with NO schema default, deliberately: 3 and 1 are the renderer's
   * fallbacks, and declaring them here would materialize a `maxVisible` on
   * every parsed header — turning an unset key into an authored one, exactly
   * as the record picker's `limit` docblock records for its own 50.
   */
  maxVisible: z.number().int().positive().optional().describe(
    'How many header actions render as inline buttons before the rest fold into the overflow menu (renderer default 3).',
  ),
  mobileMaxVisible: z.number().int().positive().optional().describe(
    'The `maxVisible` budget on mobile viewports (renderer default 1).',
  ),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const PageTabsProps = strictObject({
  surface: 'this `page:tabs`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  /**
   * Tab-strip visual style. **Renamed from `type` at protocol 17 (#6776,
   * ADR-0087 D2)** — the same concept, the same three values, a spelling an
   * author can actually write.
   *
   * A props key named `type` collides with the component node's own dispatch
   * key, and the collision is structural rather than cosmetic:
   *
   *   - objectui's `SchemaRenderer` hoists `properties` onto the node but
   *     deliberately skips `type` and `id`, or the inner value would shadow
   *     which renderer to dispatch to — its comment names this exact case
   *     ("tab visual style: 'line' | 'card' | 'pill'").
   *   - `sdui-parser`'s `BASE_PROPS` contains `'type'`, so a manifest input by
   *     that name is skipped as a base prop and never validated at all.
   *   - In the flat and JSX carriers a node reads `{ type: 'page:tabs', … }`,
   *     so `type` is the tag name and this prop has no spelling left.
   *
   * `tabStyle` is what objectui's registry publishes and what the renderer
   * reads in every carrier (`containers.tsx:381`), so the contract converges on
   * the spelling that works rather than the one that reads well — the #5775
   * `displayField` → `labelField` shape, and one spelling rather than two
   * (Prime Directive #12).
   */
  tabStyle: z.enum(['line', 'card', 'pill']).default('line')
    .describe("Tab-strip visual style: 'line' underlines the active tab, 'card' frames each tab, 'pill' renders rounded pills"),
  /**
   * REMOVED (#6776). The declared spelling of `tabStyle`, unauthorable in any
   * flat or JSX carrier because a page component's own dispatch key is also
   * called `type`. The live mechanism is `tabStyle`.
   */
  type: retiredKey(
    '`page:tabs` property `type` was removed in @objectstack/spec 17.0.0 (ADR-0087 D2) — '
    + 'a props key named `type` collides with the page component\'s own dispatch key, so it is '
    + 'unauthorable in the flat and JSX carriers and was never validated in them. Rename the key '
    + 'to `tabStyle`; the value (`line` | `card` | `pill`) is unchanged. '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  position: z.enum(['top', 'left']).default('top'),
  /**
   * Keep the tab strip visible when there is only one tab (#4001 batch A).
   *
   * The renderer hides a one-tab strip by default — "a single pill labelled
   * 'Details' is visual clutter rather than an affordance" — and its own
   * comment invites the override: *"Authors who want the strip even at length 1
   * can pass `properties.alwaysShowStrip: true`"* (`containers.tsx:637`, read as
   * `schema?.properties?.alwaysShowStrip === true`). Declared on the same
   * #5611/#5775/#6276 rule as `page:header`'s action budget: the delivered,
   * invited shape is the contract, and a closed schema that rejected it would
   * be the declaration disagreeing with the renderer in the direction that
   * costs the author.
   */
  alwaysShowStrip: z.boolean().optional().describe(
    'Render the tab strip even when only one tab is visible (renderer default: a one-tab strip is hidden).',
  ),
  items: z.array(strictObject({
    surface: 'this `page:tabs` item',
    history: PROPS_HISTORY,
    aliases: {
      /**
       * NOT a typo — `key` → `value` is four edits, so the distance fallback
       * cannot reach it, and this is the alias category the helper's docblock
       * describes: a different WORD for the same intent, correct on a
       * neighbouring surface. Measured producers, both live: objectui's Studio
       * block designer publishes `key` as the tab item's text input
       * (`previews/block-config.ts`, `page:tabs.items.itemFields`), and #5776
       * recorded the showcase authoring the same spelling. The renderer reads
       * neither — `containers.tsx:566` takes `it.value` and falls back to
       * `tab-${idx}` — so an authored `key` silently yields index-derived tab
       * tokens that move the moment the item list changes.
       */
      key: 'value',
      /**
       * Action-side spellings (#8382) — an author who learned `visible` /
       * `showWhen` from `ui/action.zod.ts` and reaches for the same words
       * here. One landing key, no boolean sibling, so per this package's
       * alias/guidance rule (`visible-when-alias-guidance.test.ts` header)
       * this is the simple rename case, not guidance prose.
       */
      visible: 'visibleWhen',
      showWhen: 'visibleWhen',
      /**
       * `visibility` / `visibleOn` (#8382) — the ADR-0089 spellings this
       * surface deliberately does NOT fold in (see the docblock below): they
       * stay rejected, but an author who used them correctly on a page
       * component or view form is reaching for the identical intent here, so
       * the rejection still points at the one key that lands it. A pointer is
       * a message, not acceptance — nothing below changes what parses.
       */
      visibility: 'visibleWhen',
      visibleOn: 'visibleWhen',
    },
  }, {
    label: I18nLabelSchema,
    /**
     * Tab-trigger icon, and the reason this key carries a docblock at all: it
     * presents to a liveness sweep exactly as `page:accordion`'s item `icon`
     * did one component over — declared bare, asserted nowhere — and that
     * absence cost a full dispatch cycle re-deriving the cross-repo read point
     * before the retirement candidate was closed (#9397 closed
     * premise-overtaken; #9881 recorded the accordion's liveness; this is the
     * same record for the tab item, so the sweep cannot re-derive the same
     * false candidate a component over).
     *
     * The key is LIVE at the objectui pin this repo builds against
     * (`.objectui-sha` = `31971ff1e`; re-derived at that pin 2026-10-01 —
     * `containers.tsx` is byte-identical across the hop from `e420df310`
     * (`git diff --quiet`), so both anchors were re-READ in place, each still
     * the read point this record names: `946-952` and `1005`. At `e420df310`
     * (2026-09-30) `containers.tsx` changed again across the hop from
     * `db11afd49` (40
     * insertions, 26 deletions: objectui#11166's `page:header` breadcrumb slot
     * and objectui#11212's fail-closed permission gates), every hunk at `:1286`
     * or below, so both anchors were re-READ in place and NEITHER moved, each
     * byte-identical: `946-952` and `1005`. At `db11afd49` (2026-09-29)
     * `containers.tsx` changed again across the hop from `dd3f7e1be` (46
     * insertions, 6 deletions: objectui `0ecaa7dbb`'s block-level nested `aria`
     * bags and comment re-citations), so both anchors were re-READ rather than
     * carried, and BOTH MOVED by 23 with their text byte-identical, the net +23
     * all landing above them: `923-929` -> `946-952`, `982` -> `1005`. At
     * `dd3f7e1be` (2026-09-28)
     * `containers.tsx` changed across the hop from `f8a9d0fb0` (120
     * insertions, 63 deletions, objectui `3261e6479`, `f5178a272`,
     * `e32dae160` and `1dae95a41`: the shared title interpolator, spec action
     * params and two comment sweeps), so both anchors were re-READ rather than carried, and
     * BOTH MOVED by 70 with their text byte-identical, the net +70 all landing
     * above them: `853-859` -> `923-929`, `912` -> `982`. On the hop onto
     * `f8a9d0fb0` (36 insertions, 7 deletions, objectui `ba0b61a60`: one
     * import line and the `page:header` title) both were re-READ and NEITHER
     * moved: `853-859` and `912` were byte-identical to their `62597c588` and
     * `87af769e9` text. The same held on the hop onto
     * `62597c588` (74 insertions, 16 deletions, objectui `4c6f549ef`). The hop before, off
     * `53ded82bf`, moved the icon block `730-736` -> `853-859` with its seven
     * lines byte-identical and the registration input `789` -> `912` with its
     * LINE rewritten — it declares `of: 'object'` and carries a longer
     * description — while the member list this record cites stayed
     * unchanged): `containers.tsx:946-952`
     * renders
     * `{item.icon && <LazyIcon name={item.icon} …/>}` inside the
     * `TabsTrigger`, left of the label span (`mr-1.5 h-3.5 w-3.5 shrink-0
     * opacity-70`, `aria-hidden`), and the renderer's registration publishes
     * the key to the Studio block designer at `:1005` (the `items` input,
     * documented as `[{ label, value?, icon?, count?, visibleWhen?, children
     * }]`).
     *
     * Vocabulary is Lucide, resolved through objectui's `LazyIcon`
     * (`lib/lazy-icon.tsx` — kebab-case or PascalCase, normalised to
     * kebab-case, with a fallback when the name is not a real Lucide icon), the
     * same slot every other authorable icon on this surface uses. Contrast the
     * item `key` prescribed against above: that spelling reaches no read point
     * at all, and a read point is precisely what separates the two verdicts.
     */
    icon: z.string().optional().describe(
      'Lucide icon name rendered in the tab trigger, left of the label. Read on this component — the renderer draws it via `LazyIcon`; contrast the item `key` beside it, which no read point takes and which the alias table answers with `value`.',
    ),
    /**
     * Conditional tab (CEL, #2606): when the predicate evaluates FALSE the
     * whole tab — header *and* panel — is omitted from the strip. This is the
     * item-level complement to a child component's own `visibleWhen`, which
     * hides only the panel content and would leave an empty tab header behind.
     *
     * **Contract-bound roots**: `record`, `current_user` (ADR-0068 aliases
     * `user` / `ctx.user` — one object, three spellings; see the reasoning on
     * `PageComponentSchema.visibleWhen`), plus page state as `page.<var>`
     * (re-evaluated live).
     *
     * ⚠️ **This surface is NOT the same environment as page-component
     * `visibleWhen`, despite sharing the key name.** It is rendered by its own
     * evaluator, and that evaluator differs on two points — both renderer
     * behaviour, NOT contract-guaranteed:
     *
     *   * **`data` is the record ROW here**, where the component-node evaluator
     *     binds it to the data-source ADAPTER. Same key, two meanings.
     *   * **The row's bare fields are spread flat**, so `status` resolves as
     *     well as `record.status`. The ambient scope is spread AFTER the row,
     *     so an ambient root (`features`, `user`, …) wins over a record
     *     field of the same name.
     *
     * Like the component-node surface it also mounts the ambient
     * `features` / `os.user` roots, which no ADR rules for a UI predicate
     * (ADR-0068's Non-goals: "only the user object is in scope here").
     *
     * Measured at the `.objectui-sha` pin `190fbd01d061`:
     * `components/src/renderers/layout/containers.tsx:450-457`.
     *
     * Canonical `*When` name per ADR-0089 — this key is new, so the deprecated
     * `visibility` / `visibleOn` aliases are NOT ACCEPTED on tab items: unlike
     * the view/page surfaces that fold them into `visibleWhen` via
     * `normalizeVisibleWhen`, none of `visible` / `showWhen` / `visibility` /
     * `visibleOn` parses here — all four are rejected. #8382 gave the
     * rejection a pointer at this key for all four spellings (message only:
     * being pointed AT `visibleWhen` is not the same as being accepted).
     */
    visibleWhen: EvaluatedExpressionInputSchema.optional().describe(
      'Visibility predicate (CEL) — the whole tab (header + panel) is omitted when FALSE; the renderer falls back to the first visible tab when the active one is hidden. Contract-bound roots: `record`, `current_user` (ADR-0068 aliases `user` / `ctx.user`), `page.<var>`. ⚠️ NOT the same environment as page-component `visibleWhen`: this surface\'s own evaluator binds `data` to the record ROW (not the data-source adapter) and also spreads the row\'s bare fields — renderer behaviour, NOT contract-guaranteed. ADR-0089 canonical name — `visible`/`showWhen`/`visibility`/`visibleOn` are all rejected here (not folded in), each with a pointer at this key.',
    ),
    /**
     * Stable URL token for this tab — the value `?tab=` carries and the
     * renderer restores on reload. Omitted, the renderer derives `tab-<index>`,
     * which silently points at a DIFFERENT tab as soon as the item list
     * changes; that is why a durable link needs a semantic value here
     * (`details`, `related:task`, …). Declared for #5776: the showcase authors
     * this slot as `key`, which is neither spelling the renderer reads.
     */
    value: z.string().optional().describe('Stable `?tab=` URL token for this tab (default: index-derived `tab-<i>`, which is not durable across item-list changes)'),
    /**
     * Badge count rendered next to the label. Omitted, the renderer derives it
     * by probing the `record:related_list` descendants of this tab's children,
     * so an explicit value is only needed when the count is not that sum.
     */
    count: z.number().int().min(0).optional().describe('Badge count shown next to the tab label (default: derived from `record:related_list` descendants)'),
    children: componentSlot(z.array(z.unknown()).describe('Child components'))
  })),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const PageCardProps = strictObject({
  surface: 'this `page:card`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  title: I18nLabelSchema.optional(),
  bordered: z.boolean().default(true),
  /**
   * REMOVED (#6946, maintainer ruling 2026-08-09 「全部接受」 on objectui#3829,
   * route (c) — retire upstream).
   *
   * A card action list nothing has ever rendered. `PageCardRenderer`
   * (`containers.tsx`) reads exactly four keys — `title`, `bordered`,
   * `body ?? children`, `footer` — and returns a `<Card>` built from them;
   * there is no actions area in the markup and no `actions` input in the
   * registration, which is what put this key in objectui's
   * `UNPUBLISHED_EXEMPTIONS` map as a B-class "spec declares it, NO renderer
   * read point" entry. The card's sibling `page:header` DOES read `actions`
   * off its bag, so the divergence was invisible to anyone reading the two
   * declarations side by side.
   *
   * The live mechanism is composition: author the buttons as components in
   * `children` or `footer` (`element:button`, `record:quick_actions`).
   */
  actions: retiredKey(
    '`page:card` property `actions` was removed in @objectstack/spec 17.0.0 (ADR-0087 D2) — '
    + 'no renderer ever read it: objectui\'s card renderer builds its `<Card>` from `title`, '
    + '`bordered`, `children` and `footer` only, has no actions area, and the component registry '
    + 'never published it as an input, so an authored value was accepted and dropped. Delete the '
    + 'key and author the buttons as components in the card\'s `children` or `footer` '
    + '(`element:button`, `record:quick_actions`), which is what actually renders. '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  /**
   * Card content, in order — the canonical composition slot, matching every
   * other container (`grid`, `flex`, `page:section`, `page:tabs` items).
   *
   * This spelling was authored by the showcase and rendered by objectui long
   * before it was declared (`schema.body ?? schema.children`, with the
   * renderer's own comment saying authors expect `children` to work here); the
   * declaration was `body` alone. #5775 converges the two on `children` rather
   * than declaring both — one composition key, not two de-facto contracts
   * (Prime Directive #12). `footer` is a genuinely distinct slot and stays.
   */
  children: componentSlot(z.array(z.unknown()).optional().describe('Card content components, in order (the card body slot)')),
  /**
   * REMOVED (#5775). `body` was the declared spelling of the slot every other
   * container calls `children`; the two are the same slot, and the renderer
   * already reads both. The live mechanism is `children`.
   *
   * Marked a RETIRED slot spelling (#20940): the authoring walks do not
   * descend it, the ADR-0087 conversion walker does — see
   * {@link retiredComponentSlot}.
   */
  body: retiredComponentSlot(retiredKey(
    '`page:card` property `body` was removed in @objectstack/spec 17.0.0 (ADR-0087 D2) — '
    + 'it was a second spelling of the composition slot every other container calls `children`, '
    + 'and the renderer reads both. Rename the key to `children`; the value (an array of child '
    + 'components) is unchanged. '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  )),
  /**
   * Slot for footer content — a declared, rendered slot distinct from
   * `children` (objectui's `PageCardRenderer` draws it under the body), so
   * every page walk descends it (#20940).
   */
  footer: componentSlot(z.array(z.unknown()).optional().describe('Card footer components (slot)')),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

/**
 * ----------------------------------------------------------------------
 * 2. Record Context Components
 * ----------------------------------------------------------------------
 */

/**
 * The ONE describe of the block-level `requiredPermissions` gate, carried word
 * for word by `record:details`, `record:highlights`, `record:related_list` and
 * `record:quick_actions` (#18159, seat ruling A on #19186's ruling-B semantics:
 * one word, one meaning, one text). The shape is `z.array(z.string()).optional()`
 * on all four; `component-record-block-field-security.test.ts` holds the four
 * declarations identical.
 *
 * Each clause is read off the objectui pin this repo builds against
 * (`.objectui-sha` = `31971ff1e28f`, re-read there 2026-10-01: across the hop
 * from `e420df310f5b` `record-details.tsx`, `record-highlights.tsx` and the
 * three `permissions` files are byte-identical, so NO anchor in those five
 * moved; `record-related-list.tsx` changed one docblock line above the gate
 * (objectui#11270's `record_related` row actions, +3/-2) and
 * `record-quick-actions.tsx` rewrote its fail-closed docblock to say the bar
 * is replaced by the notice rather than hidden (objectui#10224, +8/-2), so
 * every anchor in those two MOVED with its cited text byte-identical, by 1
 * and by 6. At `e420df310f5b`, 2026-09-30: across the hop
 * from `db11afd4967c` `record-quick-actions.tsx` and `usePermissions.ts` are
 * byte-identical, `MePermissionsProvider.tsx` and `PermissionProvider.tsx` each
 * gained one `effectiveObjects` member below every cited line (objectui#4421),
 * so NO anchor in those four moved, and `record-details.tsx`,
 * `record-highlights.tsx` and `record-related-list.tsx` changed around the gate
 * without touching it — objectui#8649 reads `requiredPermissions` UN-CAST
 * (output-identical), their docblocks now say the notice replaces the content
 * rather than hiding the block, and objectui#11163 placed the related list's
 * authored `actions` above its gate — so every anchor in those three MOVED with
 * its cited text byte-identical, and each is cited below at this pin. At
 * `db11afd4967c`, 2026-09-29: across the hop
 * from `dd3f7e1be356` `record-highlights.tsx`, `record-quick-actions.tsx` and
 * `usePermissions.ts` are byte-identical, and `record-details.tsx`,
 * `record-related-list.tsx`, `MePermissionsProvider.tsx` and
 * `PermissionProvider.tsx` changed only in comment lines that re-qualify an
 * objectstack card number, one line for one and none of them a cited line, so NO
 * anchor below moved. At `dd3f7e1be356`, 2026-09-28, the same files read as
 * follows), under `packages/plugin-detail/src/renderers/`
 * and `packages/permissions/src/`. `record-highlights.tsx`,
 * `record-related-list.tsx` and the three `permissions` files are
 * byte-identical to `f8a9d0fb0596` (`git diff --quiet`); `record-details.tsx`
 * (+70/-17: the title-dedupe ladder, objectui#10360 / objectui#10434, and a
 * re-spelled comment citation) and
 * `record-quick-actions.tsx` (+14/-10: the retired `aria.label` fold,
 * objectui#9945) changed away from the gate, and every anchor in them MOVED
 * with its cited text byte-identical, by 1 and by 4 respectively:
 *
 * 1. CAPABILITIES, NOT OBJECT ACTIONS. Every block gates through
 *    `perms.hasCapabilities(required)` — `record-details.tsx:244`,
 *    `record-highlights.tsx:102`, `record-related-list.tsx:365`,
 *    `record-quick-actions.tsx:273` — and never `perms.can(objectName, …)`;
 *    each renderer's docblock states the capability "is not object-scoped"
 *    (`record-details.tsx:233`, `record-highlights.tsx:81`,
 *    `record-related-list.tsx:352`, `record-quick-actions.tsx:262`). `read`
 *    is looked up in the capability set like any other name.
 * 2. ALL OF THEM. `MePermissionsProvider.tsx:416` is
 *    `required.every((p) => held.has(p))`.
 * 3. THE OUTCOME. Each block returns a `role="status"` "Insufficient
 *    permissions to view …" notice instead of its content —
 *    `record-details.tsx:244-252`, `record-highlights.tsx:160-173`,
 *    `record-related-list.tsx:365-373`, `record-quick-actions.tsx:273-281`.
 *    Checks that already withhold the content run first on two of them (no
 *    record bound, `record-details.tsx:188`; no object,
 *    `record-related-list.tsx:298`; the related object's read gate,
 *    `record-related-list.tsx:316`), which is why the text says "wherever it
 *    would otherwise render" rather than promising the notice unconditionally.
 * 4. PRESENTATION ONLY. The gate is renderer code: nothing in this repo's
 *    server packages reads a page component's `requiredPermissions`. The data
 *    stays in reach — a gated `record:highlights` registers no field names
 *    (`record-highlights.tsx:155-158`), so `record:details` no longer
 *    de-duplicates those fields out of its body. To keep a value from a
 *    user, gate the object, the field or the action.
 * 5. UNRESOLVED CAPABILITIES FAIL OPEN. `hasCapabilities` answers `true` when
 *    `systemPermissions` was never reported (`MePermissionsProvider.tsx:414`),
 *    under the role-based provider (`PermissionProvider.tsx:77`) and with no
 *    provider mounted (`usePermissions.ts:45`); a REPORTED empty array reaches
 *    the `every` at `:416` and gates.
 *
 * Unlike the field's own `requiredPermissions` (ADR-0066 D3, enforced by the
 * server before the payload leaves it), this key authorises
 * nothing.
 */
const RECORD_BLOCK_REQUIRED_PERMISSIONS_DESCRIPTION =
  '[ADR-0066] Capabilities the user must ALL hold — names that permission sets grant through `systemPermissions`, not object actions: `read` or `update` here is an ordinary capability name, not the object\'s read or edit permission. '
  + 'When the client has resolved the user\'s capabilities and any of these is missing, this block does not render its content; wherever it would otherwise render, an insufficient-permissions notice takes its place. '
  + 'Presentation only: it authorises nothing, and the data API still serves the same data to the same user. '
  + 'A client that cannot resolve the user\'s capabilities (no permission provider, or one that does not report `systemPermissions`) renders this block as if they were held — it fails open.';

export const RecordDetailsProps = strictObject({
  surface: 'this `record:details`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  columns: z.enum(['1', '2', '3', '4']).default('2').describe('Number of columns for field layout (1-4)'),
  /**
   * REMOVED (#6946, maintainer ruling 2026-08-09 「全部接受」 on objectui#3818 —
   * the removal direction).
   *
   * The declared `auto` | `custom` semantics were never implemented. objectui's
   * `RecordDetailsRenderer` does read `layout`, but only to test it against
   * `inline` | `compact` — two values this enum never permitted — so BOTH legal
   * values fell to the same `vertical` branch and the key selected nothing.
   * That is why it survived `check:react-declaration-parity`: objectui's
   * registry declared `layout` with the same `auto` | `custom` enum this schema
   * did, and the gate compares two DECLARATIONS, never a declaration against a
   * renderer (AGENTS.md). A third spelling, `stacked` | `inline` | `compact`,
   * sat in `@object-ui/types`' mirror — three declarations of one key, none of
   * them the branch the renderer takes.
   *
   * The live mechanism is what you author: `sections` renders the explicit
   * groups (the old `custom`), and omitting it falls back to the object's
   * `highlightFields` (the old `auto`). objectui#3818 deletes the input and the
   * dead branch on the next pin bump.
   */
  layout: retiredKey(
    '`record:details` property `layout` was removed in @objectstack/spec 17.0.0 (ADR-0087 D2) — '
    + 'its declared `auto` | `custom` semantics were never implemented: the renderer tests `layout` '
    + 'only against `inline` | `compact`, two values the schema never permitted, so both legal '
    + 'values took the same branch and the key selected nothing. Delete the key — the body is '
    + 'already chosen by what you author: `sections` renders the explicit groups (the old '
    + '`custom`), and omitting it falls back to the object\'s `highlightFields` (the old `auto`). '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  /**
   * Field groups rendered as the detail body, IN ORDER.
   *
   * Declared as the object form because that is the only form anything
   * delivers or authors (#5611). Until 17.x this key was `z.array(z.string())`
   * — "section IDs" — which no page in this repo, and no read path in
   * `objectui`, has ever used: `RecordDetailsRenderer` maps every entry as an
   * object (`s.name` / `s.label` / `s.fields`) with no string branch anywhere,
   * `@object-ui/types`' `RecordDetailsComponentProps` mirror declares the
   * object form, and the Studio block designer can only author
   * `{label, columns, fields}`. The ID-list spelling was a declaration with no
   * producer and no consumer, so it is gone rather than unioned in: one shape,
   * not two de-facto contracts (Prime Directive #12).
   */
  sections: z.array(strictObject({
    surface: 'this `record:details` section',
    history: PROPS_HISTORY,
    // Both are the author reaching for the #13855 reference form with the word
    // the neighbouring surface uses: the object declares `fieldGroups`, and the
    // field points back with `group`. Neither is a typo edit distance reaches.
    aliases: {
      fieldGroup: 'group',
      groupKey: 'group',
    },
  }, {
    /**
     * Stable section identifier, snake_case. This is the i18n anchor: the
     * heading resolves through `objects.<object>._sections.<name>.label`, so a
     * section WITHOUT a name renders its authored `label` in every locale.
     * `packages/lint`'s `translation-section-name-missing` rule exists to tell
     * authors to add it, which is why it is declared here — a key one rule
     * demands must not be a key the schema rejects.
     */
    name: z.string().optional().describe('Stable section identifier for i18n lookup (snake_case) — resolves `objects.<object>._sections.<name>.label`; a nameless section renders its authored label in every locale'),
    /** Heading text. Omit for an untitled section, which renders borderless. */
    label: I18nLabelSchema.optional().describe('Section heading (omit for an untitled, borderless section)'),
    /**
     * Field-grid width for THIS section; falls back to the renderer's own
     * derivation when omitted.
     *
     * An int range rather than `z.union([z.literal(1), …])` — same accepted set
     * (1-4), but the docs generator renders numeric literals as QUOTED strings
     * (`'1' | '2'`, see `FormSectionSchema.columns` in `references/ui/view.mdx`),
     * which would tell an author to write `columns: '2'` where this key requires
     * `2`. Shipping a reference that misdocuments the key is the exact harm
     * #5611 is fixing, so the shape that documents itself truthfully wins.
     */
    columns: z.number().int().min(1).max(4).optional().describe('Field-grid columns for this section (1-4). Omitted → the renderer derives the width.'),
    /**
     * [#13855] Reference a declared field GROUP instead of enumerating members
     * — the delta form ruled 2026-08-31 (maintainer: 「直接处理b」).
     *
     * `{ group: 'contact_info' }` inherits the object's `fieldGroups` entry with
     * that key: its members (every visible field whose `Field.group` points at
     * it, in field-declaration order) and its own presentation (label, icon,
     * description, `collapse`, `visibleWhen`, and the drop when the group has no
     * visible members) all come from `deriveFieldGroupLayout` (ADR-0085 §5).
     * The section restates none of it — see
     * {@link sectionGroupReferenceRefinement} for the mixing rule and why the
     * keys the group owns are refused here rather than given a precedence.
     *
     * Existence is NOT a parse question: the key names something on a DIFFERENT
     * schema, so it follows the `UserFilterFieldSchema.field` precedent — parse
     * takes any well-formed key and `page-section-group-unknown` (`@objectstack/lint`)
     * reports one that resolves to no declared group.
     */
    group: SectionGroupKeySchema.optional().describe(
      'Field group key (snake_case) whose members and presentation this section inherits, from the object\'s `fieldGroups` (ADR-0085 §5 `deriveFieldGroupLayout`). Mutually exclusive with `fields`, and with every key the group itself declares (`name`, `label`, `icon`, `description`, `collapsible`, `defaultCollapsed`). Must name a declared group — checked by reference diagnostics.',
    ),
    /**
     * Field names shown in this section, in order.
     *
     * Optional since #13855 — and optional ONLY in the sense that `group` is the
     * other way to declare the same fact. A section carrying neither is refused
     * (see {@link sectionGroupReferenceRefinement}), so no section reaches a
     * renderer without a member source, which is what the previously-required
     * key guaranteed.
     */
    fields: z.array(z.string()).optional().describe('Field names rendered in this section, in order. Omit only when `group` supplies the members instead.'),
    /**
     * The three presentation keys the renderer has honoured all along,
     * declared at last (#11289, maintainer ruling 2026-08-23 — direction 1:
     * declare, defaults matching current renderer behavior; the renderer is
     * unchanged). `RecordDetailsRenderer` spreads every authored section
     * through to `DetailSection`, which reads all three — while this shape
     * rejected them, so `objectstack validate` warned that an authored key
     * "did nothing". For `hideEmpty` that warning hid the one key that decides
     * whether a section EXISTS: the renderer forces `hideEmpty ?? true`, and
     * an all-empty section then returns `null` outright — no heading, no
     * skeleton — with no declarable way to ask for the skeleton back.
     *
     * All three are optional with NO schema default, for the `maxVisible`
     * reason (see `inlineEdit` below): the fallbacks are the RENDERER'S, and
     * a schema default would turn "the author said nothing" into "the author
     * asked for the default". Defaults in the describe() texts are MEASURED
     * at the `.objectui-sha` pin (objectui `plugin-detail/src/renderers/
     * record-details.tsx` + `DetailSection.tsx`), not transcribed from a TS
     * interface.
     */
    hideEmpty: z.boolean().optional().describe('Hide this section\'s empty fields (renderer default: on — and a section whose fields are ALL empty then renders nothing at all: no heading, no skeleton). Set `false` to render empty rows, keeping the section\'s label skeleton on an all-empty record (e.g. a brand-new one).'),
    /** Collapsible card. Initial state is expanded; the toggle is the heading. */
    collapsible: z.boolean().optional().describe('Render this section as a collapsible card — the heading becomes a chevron toggle, initially expanded (renderer default: off).'),
    /** Card chrome; the renderer derives it from the presence of a title. */
    showBorder: z.boolean().optional().describe('Draw this section\'s card chrome (renderer default: derived — on for a titled section, off for an untitled one). Set `false` for a borderless titled section, or `true` for a bordered untitled one.'),
    /**
     * Three more section keys the renderer has honoured all along (#11661 —
     * same defect class as #11289, inheriting its 2026-08-23 ruling WITH its
     * reason: declare what the renderer honours; the renderer is unchanged).
     * Optional with NO schema default, for the same `maxVisible` reason as the
     * #11289 trio above; the defaults in the describe() texts are MEASURED at
     * the `.objectui-sha` pin (`190fbd01`, objectui `plugin-detail/src/
     * renderers/record-details.tsx` + `plugin-detail/src/DetailSection.tsx`).
     *
     * One key the same measurement found is deliberately NOT declared here
     * (#11661 holds its fork):
     * - `title` — the renderer's `s.title ?? s.label` limb is a second
     *   spelling of the heading slot `label` already declares (identical
     *   localization handling, zero producers). Same shape as the `page:card`
     *   `body`-vs-`children` pair, which #5775 CONVERGED rather than declared
     *   — one heading slot, not two de-facto contracts (Prime Directive #12).
     *   Held for the maintainer's declare-vs-converge ruling.
     *
     * `headerColor` used to be withheld alongside it (the renderer's only
     * read was `bg-${headerColor}`, a template-literal Tailwind class that
     * generates no CSS under the v4 source scan — declaring it would have
     * advertised a capability the renderer did not deliver). objectui#6294
     * (merged 2026-08-25) replaced the interpolation with a lookup of
     * complete class literals in `plugin-detail/src/headerColor.ts`, so the
     * renderer now delivers the key because the module declares it; the
     * refusal outlived its recorded reason and #12126 (maintainer ruling A,
     * 2026-08-26) declares the key below as a closed enum.
     */
    defaultCollapsed: z.boolean().optional().describe('Start a `collapsible: true` section collapsed (renderer default: expanded). Consulted only when `collapsible` is on — a non-collapsible section never reads its collapse state.'),
    icon: z.string().optional().describe('Heading icon, as a lucide icon name (kebab-case, e.g. `building-2`). A value that is not an ASCII identifier (emoji, CJK text) renders as literal text beside the heading instead. Shown where the section heading renders: a titled section, or any collapsible section.'),
    description: z.string().optional().describe('Sub-heading text rendered under the section heading (plain string — the renderer applies no translation to it, unlike `label`). Renders on a titled or collapsible section; a collapsible section hides it while collapsed.'),
    /**
     * Section-header background tint (#12126, maintainer ruling A 2026-08-26:
     * declare as a CLOSED enum — declared = enforced). The vocabulary is
     * exactly the six complete class literals objectui's
     * `plugin-detail/src/headerColor.ts` lookup ships (objectui#6294): those
     * literals live in a file every consuming app's Tailwind scan covers, so
     * each enum value is guaranteed to be in the compiled stylesheet. Tints
     * only, by the renderer module's own reasoning: `CardHeader` sets no
     * foreground colour, so a solid `bg-primary` would leave the title
     * unreadable without a paired `text-*-foreground`.
     *
     * Anything outside the enum — including the renderer's `bg-*`
     * pass-through spellings, which render only if the HOST app's Tailwind
     * build happens to generate the class — is refused at authoring time
     * rather than shipping a header that silently does not paint (the
     * objectui#6178 failure mode this key's old refusal existed to prevent).
     * Optional with NO schema default: an omitted key means "no tint", the
     * renderer's own fallback.
     */
    headerColor: z.enum(['muted', 'muted/50', 'accent', 'primary/10', 'secondary/10', 'destructive/10']).optional().describe('Section-header background tint, from the closed six-token vocabulary rendered by objectui\'s `record:details` header (`muted` | `muted/50` | `accent` | `primary/10` | `secondary/10` | `destructive/10`). A value outside the enum is refused at authoring time rather than silently not painting. Omit for an untinted header.'),
  }).superRefine(sectionGroupReferenceRefinement({
    surface: 'this `record:details` section',
    // Exactly the keys `deriveFieldGroupLayout` fills from the group. `name` is
    // in the list because the derived section's `key` IS the group key, and the
    // group key is already this surface's i18n anchor
    // (`objects.<object>._sections.<key>.label`) — a second name would give the
    // same section two lookup identities.
    //
    // NOT in the list, deliberately: `columns`, `hideEmpty`, `showBorder`,
    // `headerColor`. Those are how THIS page lays the section out and the group
    // declares nothing about them, so there is no second source to create.
    derivedKeys: ['name', 'label', 'icon', 'description', 'collapsible', 'defaultCollapsed'],
  }))).optional().describe('Field groups rendered as the detail body, in order. Object form: `{ name?, label?, columns?, fields, hideEmpty?, collapsible?, showBorder?, defaultCollapsed?, icon?, description?, headerColor? }` — or the group-reference form `{ group, columns?, hideEmpty?, showBorder?, headerColor? }`, which inherits members and presentation from the object\'s `fieldGroups` entry (ADR-0085 §5).'),
  fields: z.array(z.string()).optional().describe('Explicit field list to display (optional, overrides highlightFields)'),
  /**
   * Field names to omit from the body, applied to both `fields` and every
   * section's `fields`. Authored by the published `sys_user` platform page and
   * read by `RecordDetailsRenderer`; it was simply never declared, so the
   * (unvalidated) props bag carried it. Declared now so the enforcement to come
   * does not silently strip a live platform page's hidden-field list.
   */
  hideFields: z.array(z.string()).optional().describe('Field names to omit from the body — applied to `fields` and to every section\'s `fields` (used to dedupe fields already shown in `record:highlights` or as the page title)'),
  /**
   * Inline editing on the detail body, and the body's own heading (#4001
   * batch A) — the two remaining `record:details` keys the renderer reads and
   * this schema did not declare.
   *
   * `RecordDetailsRenderer` resolves `schema.inlineEdit ?? true` against the
   * object's own editability and gates the affordance on the result — its
   * comment states the author's half directly (*"Authors can still force-disable
   * with `inlineEdit: false`"*) — and passes `schema.showHeader ?? false`
   * straight through to the body. Both arrive on `schema` because
   * `SchemaRenderer` hoists `properties` onto the node, so `properties.inlineEdit`
   * is exactly how a page authors them.
   *
   * Optional with no schema default, for the `maxVisible` reason: `true` and
   * `false` are the RENDERER'S fallbacks, and a schema default would write them
   * onto every parsed component — turning "the author said nothing" into "the
   * author asked for the default", which is a different fact and the one a
   * later liveness audit would read.
   */
  inlineEdit: z.boolean().optional().describe(
    'Allow inline field editing in the detail body (renderer default: on, where the object itself is editable — set `false` to force it off).',
  ),
  showHeader: z.boolean().optional().describe(
    'Render the detail body\'s own heading (renderer default: off).',
  ),
  /**
   * ── The record-block field-security pair (#18159, spec half of
   * objectui#8649). Declared on `record:details`, `record:highlights` and
   * `record:related_list`; this is the family header the other two point at.
   *
   * WHAT THEY ARE. Two filters over the field list THIS BLOCK draws, applied
   * in the browser after the record has been fetched.
   * `RecordDetailsRenderer` folds both through one `filterList` pass:
   * `enforceFieldSecurity` re-applies the caller's FIELD-read answer — the
   * platform's own `checkField`, resolved server-side and handed down, never a
   * second opinion — and `redactFields` drops the names it lists outright. An
   * entry the fold cannot NAME is dropped too (objectui#9054), so the pair
   * fails closed on input it does not understand.
   *
   * WHAT THEY ARE NOT. A data-access control. The record is fetched whole, so
   * a filtered value is in the page either way and neither key keeps it from a
   * caller who reads the response. The gates that do are the field's own
   * `requiredPermissions` / `maskingRule` (ADR-0066 D3) and the permission
   * set — the server applies those before the payload leaves it. Prime
   * Directive #10 is why each `describe()` below says that in the text an
   * author actually reads, rather than leaving the key names to imply it.
   *
   * ⚠️ `redactFields` NEIGHBOURS `hideFields` on this block and the two are
   * not the same channel: `hideFields` is the DEDUPE list (the renderer merges
   * the live `record:highlights` registrations and the page-title field into
   * it), while `redactFields` is the author's deliberate omission and is the
   * arm that participates in the fail-closed fold above. On a well-formed
   * field list they remove the same rows. Converging them is a contract
   * question this card did not open.
   *
   * ⚠️ The THIRD key objectui reads on these three blocks,
   * `requiredPermissions`, is declared below them — a different mechanism
   * from this pair and from the field's own `requiredPermissions` above. It
   * is the block-level ADR-0066 capability gate, read through the capability
   * set, with the one describe it shares word for word with
   * `record:quick_actions` ({@link RECORD_BLOCK_REQUIRED_PERMISSIONS_DESCRIPTION}
   * carries the renderer read points). Like this pair it is presentation
   * only: it authorises nothing.
   */
  enforceFieldSecurity: z.boolean().optional().describe(
    'Fold this block\'s field list through the caller\'s FIELD-read permissions before rendering, so a field the permission set denies leaves no empty row behind (renderer default: off). Presentation only: it re-applies the same field-read answer the server already enforced (ADR-0066 D3) and never widens access — with it off a denied field still arrives masked or stripped, and with it on the server still decides every value.',
  ),
  redactFields: z.array(z.string()).optional().describe(
    'Field names this block never renders, whatever the permission answer (renderer default: render everything authored). Presentation only, evaluated in the browser after the record is fetched — the values are still in the page, so this is NOT a data-access control and NOT the object\'s `publicSharing.redactFields`, which removes them server-side. To keep a value from the caller, gate the field itself (`requiredPermissions` / `maskingRule`, ADR-0066 D3) or the permission set. Neighbours `hideFields`, which is the dedupe channel the renderer also writes to.',
  ),
  /**
   * Block-level ADR-0066 capability gate (#18159) — same shape and same
   * describe as `record:quick_actions.requiredPermissions`; the read points
   * behind every clause are on {@link RECORD_BLOCK_REQUIRED_PERMISSIONS_DESCRIPTION}.
   */
  requiredPermissions: z.array(z.string()).optional().describe(RECORD_BLOCK_REQUIRED_PERMISSIONS_DESCRIPTION),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const RecordRelatedListProps = strictObject({
  surface: 'this `record:related_list`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  objectName: z.string().describe('Related object name (e.g., "task", "opportunity")'),
  relationshipField: z.string().describe('Field on related object that points to this record (e.g., "account_id")'),
  /**
   * Which field of THIS (parent) record `relationshipField` stores. Default
   * `id` (ordinary FK). Set to another unique field for junctions that key on
   * a machine name — e.g. `sys_user_position.position` stores
   * `sys_position.name`, so the Holders list on a position declares
   * `relationshipValueField: 'name'`. Used both to FILTER the list
   * (`{[relationshipField]: parent[relationshipValueField]}`) and as the
   * parent-side value written by the Add picker.
   */
  relationshipValueField: z.string().default('id').describe("Parent-record field whose value relationshipField stores (default 'id'; e.g. 'name' for name-keyed junctions)."),
  /**
   * [#18639] The SAME union `listViews[].columns` declares (`view.zod.ts`) —
   * not a lookalike: `ListColumnSchema` is imported from the view face, so two
   * published declarations of one key cannot drift apart. The composition that
   * makes them one key is objectui's: `dataSource.view` →
   * `composeElementDataSource` → `savedViewColumns`, copied onto this block
   * VERBATIM, so a decorated saved view arrives here already in the
   * `ListColumn` spelling.
   *
   * ⛔ The two arms are EXCLUSIVE, and the `describe()` below says so because
   * the schema enforces it: `['name', { field: 'amount' }]` matches neither
   * `z.array(z.string())` nor `z.array(ListColumnSchema)` and is refused.
   *
   * ⛔ The sibling `field.relatedListColumns` (`field.zod.ts`) is NOT widened
   * with it — that key is child field-name STRINGS only (#9227), and the
   * `field-column-lists-canonicalized` conversion that folds its object entries
   * back to strings stays as ruled.
   */
  columns: z.union([
    z.array(z.string()),       // field names
    z.array(ListColumnSchema), // the saved view's own per-column decoration
  ]).optional().describe('Fields to display in the related list — either plain field-name strings, or the same per-column entries a saved list view declares (`ListColumn`: `field`, plus `label`, `width`, `align`, `hidden`, `sortable`, `summary`, …). A view-supplied list may arrive in the `ListColumn` spelling: objectui composes a saved view\'s `columns` onto this block verbatim, and this key declares the SAME union as `listViews[].columns`. One spelling per list — the two arms are exclusive, so an array mixing strings and column objects is refused. Optional: when omitted, columns derive from the related object\'s highlightFields / default list columns (a related list is just another surface that lists that object). Override chain: child highlightFields → field-level relatedListColumns (field-name strings only) → this inline list.'),
  sort: z.union([
    z.string(),
    z.array(strictObject({
      surface: 'this `record:related_list` sort entry',
      history: PROPS_HISTORY,
      aliases: {
        /**
         * Both entries are borrowed-from-a-neighbour spellings, not typos, and
         * both are grounded in a spelling this repo really carries:
         *
         * - `direction` — the same alias `view.zod.ts` already ships for its
         *   own sort rows (`:1333`), where the pre-conversion tuple was
         *   `{ field, direction }`. An author moving a sort between the two
         *   surfaces brings it along.
         * - `name` — the field spelling `record:highlights` uses for its own
         *   object form. That divergence is documented from the other side in
         *   `packages/lint/src/validate-page-field-bindings.ts`'s
         *   `fieldRefsFrom`, which exists precisely because "`record:highlights`
         *   keys its object form `name`, while columns/sort/filter key theirs
         *   `field`".
         */
        direction: 'order',
        name: 'field',
      },
    }, {
      field: z.string(),
      order: z.enum(['asc', 'desc'])
    }))
  ]).optional().describe('Sort order for related records'),
  limit: z.number().int().positive().default(5).describe('Number of records to display initially'),
  filter: z.array(ViewFilterRuleSchema).optional().describe('Additional filter criteria for related records'),
  title: I18nLabelSchema.optional().describe('Custom title for the related list'),
  showViewAll: z.boolean().default(true).describe('Show "View All" link to see all related records'),
  actions: z.array(z.string()).optional().describe('Action IDs available for related records'),
  /**
   * Enable an "Add" affordance that links EXISTING records via a picker, rather
   * than only "+ New" (create-and-navigate). Generic over m2m / junction
   * relationships: pick records from `add.picker.object` (the far side) and
   * create a link row in `objectName` with `{[relationshipField]: <parentId>,
   * [add.linkField]: <pickedId>}`. Omit `linkField` for a plain 1:m re-parent
   * (the picked child's `relationshipField` is set to the parent id instead).
   * Server-side rules still apply on insert (e.g. the AI-seat cap), and their
   * errors surface in the dialog. The canonical use is "Assigned Users" on a
   * permission set (objectName=`sys_user_permission_set`,
   * relationshipField=`permission_set_id`, picker.object=`sys_user`,
   * linkField=`user_id`).
   */
  add: strictObject({
    surface: 'this `record:related_list` `add` config',
    history: PROPS_HISTORY,
  }, {
    picker: strictObject({
      surface: 'this `record:related_list` add picker',
      history: PROPS_HISTORY,
      aliases: {
        // `object` is the spelling here and on every element data source; the
        // list's own far-side key one level up is `objectName`, so an author
        // carrying that spelling down into the picker is the near-miss this
        // entry exists for. Distance cannot reach it (`objectName` → `object`
        // is four edits, and both are real keys on the same component).
        objectName: 'object',
      },
    }, {
      object: z.string().describe('Object to pick records from (the far side of an m2m, or the child object for a 1:m re-parent).'),
      valueField: z.string().default('id').describe('Field on the picked record used as the link value (default `id`).'),
      labelField: z.string().optional().describe('Field shown in the picker rows (defaults to the object title field).'),
      filter: z.array(ViewFilterRuleSchema).optional().describe('Restrict which records the picker offers.'),
    }).describe('Where the Add affordance sources records from.'),
    linkField: z.string().optional().describe('Field on `objectName` that stores the picked record id (junction case). Omit for a 1:m re-parent.'),
    label: I18nLabelSchema.optional().describe('Label for the Add button (default "Add").'),
  }).optional().describe('Add-existing-via-picker config (generic m2m/junction assignment).'),
  /**
   * The record-block field-security pair — see the family header on
   * `RecordDetailsProps` for what the two keys are, what they are not, and how
   * they differ from the block-level `requiredPermissions` gate declared below.
   *
   * On THIS block the pair folds `columns` rather than a field list, and
   * `redactFields` is additionally handed down to `RelatedList` itself: the
   * component derives its own columns when none are authored, so filtering the
   * authored array alone let a redacted field return through the derivation
   * (objectui#9053). The fold fails closed on a column it cannot name
   * (objectui#8793) — the table library's own `accessorKey` spelling is not an
   * identity this fold accepts, and an entry it cannot check is one it must
   * not pass.
   */
  enforceFieldSecurity: z.boolean().optional().describe(
    'Fold this list\'s `columns` through the caller\'s FIELD-read permissions on the RELATED object before rendering (renderer default: off). Presentation only: it re-applies the same field-read answer the server already enforced (ADR-0066 D3) and never widens access — the rows are fetched either way and the server still decides every value.',
  ),
  redactFields: z.array(z.string()).optional().describe(
    'Field names this list never renders, whatever the permission answer (renderer default: render every column authored or derived). Applies to the authored `columns` AND to the columns the list derives for itself when none are authored. Presentation only, evaluated in the browser after the rows are fetched — the values are still in the page, so this is NOT a data-access control and NOT the object\'s `publicSharing.redactFields`, which removes them server-side. To keep a value from the caller, gate the field itself (`requiredPermissions` / `maskingRule`, ADR-0066 D3) or the permission set.',
  ),
  /**
   * Block-level ADR-0066 capability gate (#18159) — same shape and same
   * describe as `record:quick_actions.requiredPermissions`; the read points
   * behind every clause are on {@link RECORD_BLOCK_REQUIRED_PERMISSIONS_DESCRIPTION}.
   */
  requiredPermissions: z.array(z.string()).optional().describe(RECORD_BLOCK_REQUIRED_PERMISSIONS_DESCRIPTION),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

/**
 * ⚠️ The object arm is CLOSED, and closing a union arm is a different act from
 * closing a plain shape — worth reading before the next arm is touched.
 *
 * Zod 4 collapses arm failures: the whole union reports as ONE `invalid_union`
 * whose message is the bare string `"Invalid input"`, with each arm's real
 * issues tucked inside `issue.errors`. So the named surface and the rename this
 * `strictObject` produces reach the author only because
 * `packages/lint/src/zod-issue-format.ts` unpacks them — the same wiring
 * #5583 needed when `ChartGroupBySchema`'s object arm was closed, which is the
 * precedent this follows. Deleting that unpacking leaves `packages/spec`'s own
 * tests green and turns the author-facing message back into "Invalid input";
 * `component-props-union-arm.test.ts` pins it from this side.
 */
export const RecordHighlightsField = z.union([
  z.string(),
  strictObject({
    surface: 'this `record:highlights` field',
    history: PROPS_HISTORY,
    aliases: {
      // The sibling spelling, in the direction opposite to the sort entry's:
      // this arm keys its field `name`, while columns/sort/filter key theirs
      // `field` (documented in `validate-page-field-bindings.ts`'s
      // `fieldRefsFrom`, which had to handle both).
      field: 'name',
    },
    guidance: {
      // REMOVED (#10054, ADR-0049 enforce-or-remove; maintainer ruling
      // 2026-08-21): `icon` was declared and advertised on six author-facing
      // surfaces with ZERO read points, measured at the 2026-08-20 census:
      // objectui's renderer normalized the authored object and carried
      // `icon: f?.icon` into `HeaderHighlight`, whose chip has no icon slot
      // (its only `icon` occurrence is a button `size="icon"`), and the key
      // could travel nowhere else — `useRegisterHighlightFields` registers
      // `names: string[]` (structurally unable to carry it) and the Studio
      // block designer publishes the field list as a `string[]` input. So an
      // authored value parsed clean and was drawn by nothing — the #8691
      // reference-rail `icon` shape, on the highlight chip. This arm is
      // `strictObject`, so the route is strict deletion + this `guidance`
      // entry carrying the prescription (the `data/Metric:filters` precedent;
      // no `retiredKey` tombstone — the key is out of the walked shape
      // entirely, and the refusal is the arm's own named `unrecognized_keys`).
      icon:
        '`record:highlights` field `icon` was removed in @objectstack/spec 17 (ADR-0049) — '
        + 'no render path ever read it: the renderer normalized the authored object and passed '
        + '`icon` to a highlight chip with no icon slot, and the key could travel nowhere else '
        + '(`useRegisterHighlightFields` registers field NAMES only; the Studio designer publishes '
        + 'the field list as plain strings), so an authored value was accepted and drawn by '
        + 'nothing. Delete the key — no replacement: the renderer never drew it, and the chip '
        + 'renders label and value only. '
        + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
    },
  }, {
    name: z.string().describe('Field name on the record'),
    label: z.string().optional().describe('Display label (overrides schema label)'),
    // `icon` was REMOVED here (#10054) — see the `guidance` entry above for
    // the full story. There is no replacement mechanism: the highlight chip
    // renders label and value only, so the key never had an effect to lose.
    type: z.string().optional().describe('Override cell renderer type (rare)'),
    // #5176 — declared because it is already enforced: the renderer's
    // HeaderHighlight gate refuses inline editing on a chip carrying it. Kept
    // as a declared key (ADR-0049 enforce-or-remove, satisfied on arrival)
    // rather than an undeclared key the renderer happens to honour — an
    // undeclared key is silently stripped here, which turns a machine-owned
    // column editable again with no diagnostic anywhere.
    readonly: z.boolean().optional().describe('Render this chip read-only — suppresses inline editing on the highlight card. Use for hook/automation-maintained columns that must not be hand-edited from the record header.'),
  }),
]).describe('Highlight field: bare name, or {name,label?,type?,readonly?}');
export type RecordHighlightsField = z.input<typeof RecordHighlightsField>;

export const RecordHighlightsProps = strictObject({
  surface: 'this `record:highlights`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  fields: z.array(RecordHighlightsField).min(1).max(7).describe('Key fields to highlight (1-7 fields max, typically displayed as prominent cards). Each item may be a bare field name or {name, label?, type?, readonly?} for inline overrides.'),
  layout: z.enum(['horizontal', 'vertical']).default('horizontal').describe('Layout orientation for highlight fields'),
  /**
   * The record-block field-security pair — see the family header on
   * `RecordDetailsProps` for what the two keys are, what they are not, and how
   * they differ from the block-level `requiredPermissions` gate declared below.
   *
   * On THIS block the pair folds the normalized `fields` chips. The renderer
   * expresses the fail-closed arm by dropping unnameable entries BEFORE the
   * allow-list rather than inside the filter — the same semantics as
   * `record:details`, not a third policy. A chip dropped here is also dropped
   * from the `HighlightFieldsContext` registration, so `record:details` does
   * not go on hiding a body row for a highlight this block never drew.
   */
  enforceFieldSecurity: z.boolean().optional().describe(
    'Fold this block\'s highlight chips through the caller\'s FIELD-read permissions before rendering, so a field the permission set denies leaves no empty chip behind (renderer default: off). Presentation only: it re-applies the same field-read answer the server already enforced (ADR-0066 D3) and never widens access — the record is fetched either way and the server still decides every value.',
  ),
  redactFields: z.array(z.string()).optional().describe(
    'Field names this block never renders as a chip, whatever the permission answer (renderer default: render every field authored). Presentation only, evaluated in the browser after the record is fetched — the values are still in the page, so this is NOT a data-access control and NOT the object\'s `publicSharing.redactFields`, which removes them server-side. To keep a value from the caller, gate the field itself (`requiredPermissions` / `maskingRule`, ADR-0066 D3) or the permission set.',
  ),
  /**
   * Block-level ADR-0066 capability gate (#18159) — same shape and same
   * describe as `record:quick_actions.requiredPermissions`; the read points
   * behind every clause are on {@link RECORD_BLOCK_REQUIRED_PERMISSIONS_DESCRIPTION}.
   */
  requiredPermissions: z.array(z.string()).optional().describe(RECORD_BLOCK_REQUIRED_PERMISSIONS_DESCRIPTION),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const RecordActivityProps = strictObject({
  surface: 'this `record:activity`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  /**
   * Feed/activity kinds to show — an OPEN vocabulary (commit 1a6a19c31, executing the
   * 2026-08-24 maintainer ruling commit 88b9d749a declared: `sys_activity.type` is
   * author-extensible and "every closed map over this vocabulary is now the
   * bug"). The `FeedItemType` union branch is guidance only — it keeps the
   * built-in kinds visible in editor autocomplete and as an `anyOf` member of
   * the generated JSON Schema — while the open-string branch keeps every
   * author-contributed activity kind nameable (sanctioned authoring channel:
   * `activityMilestones[].type`, ADR-0052 §5b.2; built-in set published as
   * `SYS_ACTIVITY_BUILTIN_TYPES` in `../data/feed.zod.ts`). The union accepts
   * exactly what a bare `z.string().min(1)` accepts — nothing is validated
   * against the built-in set, so a typo'd built-in is no longer rejected by
   * name; the ruling accepted that cost rather than re-close the vocabulary.
   */
  types: z.array(z.union([FeedItemType, z.string().min(1)])).optional().describe(
    'Feed item kinds to show (default: all). Open vocabulary: the FeedItemType members are the platform built-in kinds, and author-contributed activity kinds (open sys_activity.type vocabulary, ADR-0052 §5b.2) are equally legal — entries are never validated against the built-in set.',
  ),
  /** Default filter mode (Airtable-style dropdown) */
  filterMode: FeedFilterMode.default('all').describe('Default activity filter'),
  /** Allow user to switch filter modes */
  showFilterToggle: z.boolean().default(true).describe('Show filter dropdown in panel header'),
  /** Pagination */
  limit: z.number().int().positive().default(20).describe('Number of items to load per page'),
  /** Show completed activities */
  showCompleted: z.boolean().default(false).describe('Include completed activities'),
  /** Merge field_change + comment in a unified timeline */
  unifiedTimeline: z.boolean().default(true).describe('Mix field changes and comments in one timeline (Airtable style)'),
  /** Show the comment input box at the bottom */
  showCommentInput: z.boolean().default(true).describe('Show "Leave a comment" input at the bottom'),
  /** Enable @mentions in comments */
  enableMentions: z.boolean().default(true).describe('Enable @mentions in comments'),
  /** Enable emoji reactions */
  enableReactions: z.boolean().default(false).describe('Enable emoji reactions on feed items'),
  /** Enable threaded replies */
  enableThreading: z.boolean().default(false).describe('Enable threaded replies on comments'),
  /** Show notification subscription toggle (bell icon) */
  showSubscriptionToggle: z.boolean().default(true).describe('Show bell icon for record-level notification subscription'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

// `position` old-spelling prescriptions (#8762). Declared with `//` on purpose —
// the `LIST_VIEW_EXPORT_PDF_RETIRED` placement note applies here too: build-docs
// takes a file's first JSDoc per exported symbol, and these need no doc page.
// This is an enum-VALUE narrowing, so there is no `retiredKey()` tombstone to
// hang the prescription on — the enum's own error map carries it, keyed on
// `issue.input` so only a value which used to be legal gets the "was removed"
// message (the `view.exportOptions` `'pdf'` precedent, #8010).
const CHATTER_POSITION_RETIRED: ReadonlyMap<string, string> = new Map([
  ['sidebar', "'sidebar' was removed from `record:chatter` / `record:discussion` `position` — "
    + 'no renderer branch ever compared the old vocabulary: `RecordChatterPanel` docks on '
    + "'right'/'left' and renders in flow on 'bottom', so a spec-valid 'sidebar' silently fell "
    + "through to the in-flow render. Write 'right' — the docked side panel 'sidebar' meant. "
    + 'Run `os migrate meta` to list the mechanical edits for existing sources '
    + '(registered under protocol major 18); apply them by hand.'],
  ['inline', "'inline' was removed from `record:chatter` / `record:discussion` `position` — "
    + 'no renderer branch ever compared the old vocabulary. Write \'bottom\' — the renderer\'s '
    + "in-flow branch, which is where 'inline' already rendered. Run `os migrate meta` to "
    + 'list the mechanical edits for existing sources (registered under protocol major 18); '
    + 'apply them by hand.'],
  ['drawer', "'drawer' was removed from `record:chatter` / `record:discussion` `position` "
    + 'with no successor: no renderer branch ever implemented an overlay drawer — the value fell '
    + "through to the in-flow render. Write 'right' — the docked side panel is the nearest "
    + 'surviving shape of a side drawer. Run `os migrate meta` to list the mechanical edits '
    + 'for existing sources (registered under protocol major 18); apply them by hand.'],
]);

/**
 * `record:chatter` / `record:discussion` — ONE shared schema object for the
 * pair (#8744; `ComponentPropsMap` wires both names to this row, and the
 * pair-identity pin in `component-record-blocks.test.ts` holds them together).
 *
 * `position` speaks the RENDERER'S vocabulary — `bottom` / `right` / `left` —
 * since #8762 (maintainer ruling 2026-08-15: one vocabulary, no mapping
 * layer). The schema's original `sidebar` / `inline` / `drawer` set was
 * declared-≠-enforced in the worst direction: `RecordChatterPanel`
 * (objectui `plugin-detail/src/RecordChatterPanel.tsx:87-96`, measured at pin
 * `665661ab0932`) branches on exactly `right`/`left` (docked side panel) vs
 * `bottom` (in-flow), the designer registration (`CHATTER_INPUTS`) publishes
 * `['bottom', 'right', 'left']`, and the renderer merge
 * (`renderers/record-chatter.tsx`) falls back to `bottom` — so the schema's
 * own default (`sidebar`) rendered in-flow as a silent no-op while the value
 * that actually docks the panel (`right`) was refused at publish. The three
 * old spellings are rewritten by the ADR-0087 conversion
 * `record-chatter-position-vocabulary` (protocol 18) and refused here with a
 * per-value prescription ({@link CHATTER_POSITION_RETIRED}).
 *
 * All three keys are optional with NO schema default, for the `maxVisible`
 * reason: the renderer's fallbacks (`position: 'bottom'`,
 * `collapsible: false` in the renderer merge — and the auto-appended panel
 * passes the same pair explicitly; `defaultCollapsed ?? false` in the panel)
 * are the RENDERER'S facts, and a schema default would write them onto every
 * parsed component — turning "the author said nothing" into "the author asked
 * for it". `.default('sidebar')` was itself half of the #8762 defect, and the
 * old `collapsible` default (`true`) INVERTED the renderer merge's `false`.
 */
export const RecordChatterProps = strictObject({
  surface: 'this `record:chatter`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  /** Panel position — the renderer's own vocabulary (see the row docblock). */
  position: z.enum(['bottom', 'right', 'left'], {
    error: (issue) =>
      typeof issue.input === 'string' ? CHATTER_POSITION_RETIRED.get(issue.input) : undefined,
  }).optional().describe('Where the panel docks relative to the record body — `right`/`left` dock a side panel, `bottom` renders in flow under the record body (renderer default: `bottom`).'),
  /** Panel width — read by the docked side positions only. */
  width: z.union([z.string(), z.number()]).optional().describe('Panel width (e.g., "350px", "30%") — side positions (`right`/`left`) only.'),
  /** Collapsible */
  collapsible: z.boolean().optional().describe('Whether the panel can be collapsed (renderer default: off).'),
  /** Default collapsed state */
  defaultCollapsed: z.boolean().optional().describe('Whether the panel starts collapsed (renderer default: off; only meaningful with `collapsible`).'),
  /** Feed configuration (delegates to RecordActivityProps) */
  feed: RecordActivityProps.optional().describe('Embedded activity feed configuration'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const RecordPathProps = strictObject({
  surface: 'this `record:path`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  statusField: z.string().describe('Field name representing the current status/stage'),
  stages: z.array(strictObject({
    surface: 'this `record:path` stage',
    history: PROPS_HISTORY,
    aliases: {
      // A stage's key is `value` — the status value it stands for. `name` is
      // the identifier spelling every other authored collection in this file
      // uses (`record:details` sections, `record:highlights` fields), so it is
      // the near-miss an author arrives with rather than a typo distance could
      // reach.
      name: 'value',
    },
  }, {
    value: z.string(),
    label: I18nLabelSchema,
    /**
     * Declare this stage a terminus and say WHICH one. The renderer classifies
     * every stage to decide whether it stays in the forward chevron path (won)
     * or breaks out into the separated alt group (lost); an explicit `terminal`
     * is honoured FIRST, ahead of the token heuristic that guesses from the
     * value/label (`closed_won`, `失败`, …). Authors whose stage names the
     * heuristic cannot read — the showcase's `done` — have no other way to get
     * the right treatment.
     */
    terminal: z.enum(['won', 'lost']).optional().describe('Mark this stage a terminus and its kind — overrides the renderer\'s value/label token heuristic'),
  })).optional().describe('Explicit stage definitions (if not using field metadata)'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});
export type RecordPathProps = z.input<typeof RecordPathProps>;

/**
 * `record:reference_rail` — #8691. The rail had a registered renderer, a
 * `PageComponentType` entry and a place in the console block palette, but no
 * row here — so an authored entry `filter` parsed, typechecked, validated,
 * built, shipped verbatim in the artifact and silently filtered nothing,
 * while the very same build emitted loud diagnostics for `record:related_list`
 * keys in the same file. This row is what makes the #5068 gate's dispatch
 * reach the rail.
 *
 * Key set measured from the renderer's ACTUAL read points at the
 * `.objectui-sha` pin (objectui `plugin-detail/src/renderers/
 * record-reference-rail.tsx`), not transcribed from its TS interface — the
 * two disagree, and the disagreement is load-bearing:
 *
 * - The interface declares an entry `icon` and the page synthesizer
 *   (`buildDefaultPageSchema.ts`) emits it, but NO render path reads it — the
 *   rail card has no icon slot at all. Declaring it here would be the same
 *   defect this row exists to close, one direction over (declared ≠ enforced,
 *   Prime Directive #10). It is a `guidance` entry instead: refused, with the
 *   reason.
 * - `title` is rendered as a raw React child, so it is `z.string()`, NOT
 *   `I18nLabelSchema`: an inline locale map would render `[object Object]`.
 *   Declaring the map spelling would advertise a translation capability the
 *   renderer does not deliver (that capability question is the downstream
 *   card's, pending a maintainer pull ruling — deliberately not decided here).
 * - `limit` / `hideEmpty` are optional with NO schema default (the `maxVisible`
 *   principle at `record:details`): `3` and `true` are the RENDERER'S
 *   fallbacks, and a schema default would turn "the author said nothing" into
 *   "the author asked for the default" — a different fact.
 *
 * Deliberately NOT declared, per the file conventions: `className` on the
 * props bag (a component-NODE key — `COMPONENT_LEVEL_GUIDANCE` carries the
 * wrong-layer pointer; the renderer reads it off the hoisted node).
 */
export const ReferenceRailEntrySchema = strictObject({
  surface: 'this `record:reference_rail` entry',
  history: PROPS_HISTORY,
  aliases: {
    // `object` is the spelling on every element data source
    // (`ElementDataSourceSchema`) and on the related-list add picker; an
    // author carrying it over is not making a typo distance could reach.
    object: 'objectName',
    // `label` is what the neighbouring `record:highlights` field and
    // `record:path` stage call their display override; the rail calls its
    // card-title override `title`.
    label: 'title',
  },
  guidance: {
    /**
     * The card's own planted key (#8691): authored on a real app, it passed
     * tsc, `objectstack validate` and `objectstack build`, shipped verbatim in
     * `dist/objectstack.json`, and the rendered badge kept counting everything.
     */
    filter: 'The rail honours no per-entry `filter`: it issues one fixed query per entry '
      + '(`{ [relationshipField]: parentId }`, `$top` = `limit`) and reads nothing else — before '
      + 'this shape existed the key parsed, shipped, and silently filtered nothing. '
      + '`record:related_list` is the component whose `filter` is real; if the rail is ever '
      + 'granted one, this entry shape is where it gets declared and enforced.',
    icon: '`icon` is read by nothing: the rail renderer declares it in its TS interface and the '
      + 'page synthesizer emits it, but no render path reads it — the card has no icon slot, so '
      + 'a declared icon draws nothing. Remove it; if the rail gains an icon slot, this entry '
      + 'shape is where it gets declared.',
    hideEmpty: '`hideEmpty` is a COMPONENT-level key: write it beside `entries`, not on an '
      + 'entry — the renderer folds empty cards per rail, never per entry.',
  },
}, {
  objectName: z.string().describe('Related object name whose records this card summarizes (e.g. "task", "opportunity_quote")'),
  relationshipField: z.string().describe('Field on the related object that points back to this record (e.g. "account_id")'),
  title: z.string().optional().describe('Literal card title. Rendered as-is in EVERY locale (no inline locale map — the rail renders it as a raw React child); omit to use the related object\'s localized label.'),
  limit: z.number().int().positive().optional().describe('Preview rows per card, and the `$top` of the one query this entry issues (renderer default: 3).'),
  displayField: z.string().optional().describe('Field of the related record rendered in each preview row (renderer fallback when omitted: name / title / subject / label / … / id).'),
});
export type ReferenceRailEntry = z.input<typeof ReferenceRailEntrySchema>;

export const RecordReferenceRailProps = strictObject({
  surface: 'this `record:reference_rail`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  aliases: {
    // `items` is what `page:tabs` / `page:accordion` call their collection;
    // `related` is the page synthesizer's option name for the same data
    // (`buildDefaultPageSchema({ related })`). Both are neighbouring-surface
    // spellings, not typos.
    items: 'entries',
    related: 'entries',
  },
}, {
  entries: z.array(ReferenceRailEntrySchema).min(1).describe('Related collections to summarize — one compact card per entry (icon-less title, total-count badge, top-N preview rows). An empty rail renders nothing, so at least one entry is required.'),
  hideEmpty: z.boolean().optional().describe('Fold entries whose related count is 0 into a single "+ N empty" expander chip (renderer default: on; set `false` to always render every card).'),
});
export type RecordReferenceRailProps = z.input<typeof RecordReferenceRailProps>;

/**
 * `record:alert` / `record:quick_actions` / `record:history` — #8744, the
 * three `record:*` types #8691's fix left in exactly the rail's pre-fix
 * position: a registered objectui renderer, a `PageComponentType` entry, a
 * console palette slot, and no row here — so the #5068 gate's dispatch skipped
 * them as unregistered and a typo'd `severty` (or any other undeclared key)
 * parsed, typechecked, validated, built, shipped, and did nothing.
 *
 * Key sets measured from the renderers' ACTUAL read points at the
 * `.objectui-sha` pin (`record-alert.tsx`, `record-quick-actions.tsx`,
 * `record-history.tsx` + `HistoryTimeline.tsx`), not transcribed from the
 * registrations' declared-input lists — which are wrong in both directions
 * here, exactly as #8691 found with the rail's `icon`:
 *
 * - `record:quick_actions`' registration says an empty bar falls back to
 *   "every action declared for the object at this location"; the renderer
 *   resolves NOTHING when no names are given and renders its empty
 *   placeholder. The declared list also omits `aria`, whose `label` the
 *   renderer DOES read — but under a spelling the shared `AriaPropsSchema`
 *   refuses (see the row's `guidance.aria`).
 * - `record:history`'s renderer reads `entries` / `loading`, which the
 *   registration rightly does not declare: they are the HOST's data channel
 *   (see the row's guidance), not authorable surface.
 * - `record:alert`'s `icon`, unlike the rail's, IS read (`props.icon ||
 *   severity icon`), so it is declared here — same method, opposite verdict,
 *   which is why the method is "name the line that reads it", not "copy the
 *   sibling row".
 */

/**
 * The alert's optional call-to-action. All three keys are read: `actionName`
 * resolves the def from the object's own `actions[]` metadata and executes it
 * through the shared action engine (`useActionEngine` — confirm/param dialogs,
 * toast, reload, exactly as in `record:quick_actions`); `label` is resolved
 * with the same `pickLocalized` chain as `title`/`body`; `variant` is
 * forwarded to the Button primitive.
 */
export const RecordAlertActionSchema = strictObject({
  surface: 'this `record:alert` action',
  history: PROPS_HISTORY,
  aliases: {
    // `name` is how the action itself is keyed in the object's `actions[]`
    // (`ActionSchema.name`) — an author copying the identifier out of the
    // action definition brings that spelling along; it is not a typo distance
    // could reach.
    name: 'actionName',
  },
}, {
  actionName: z.string().describe('Name of an action declared on this object (`actions[]`) — resolved from object metadata and run through the shared action engine, so confirm/param dialogs, toast and reload behave exactly as in `record:quick_actions`.'),
  label: I18nLabelSchema.optional().describe('CTA button label — a string or an inline locale map, resolved with the same pickLocalized chain as `title`/`body` (default: the action\'s own label).'),
  variant: z.enum(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']).optional().describe('Button variant — the Button primitive\'s own vocabulary (renderer default: `destructive` when severity is `error`, else `default`).'),
});
export type RecordAlertAction = z.input<typeof RecordAlertActionSchema>;

/**
 * `record:alert` — #8744. See the family header above.
 *
 * Two deliberate departures from this file's own defaults:
 *
 * - `guidanceSets` carries only `COMPONENT_NODE_KEYS_GUIDANCE`, because this
 *   is the one record component whose PROPS carry a real visibility predicate:
 *   the renderer evaluates `properties.visible` (via `toPredicateInput` +
 *   `useCondition` — the same pipeline as every action button), so `visible`
 *   is a declared key here and the visibility pattern set's "move it up to
 *   the node" prescription would be wrong on this surface. The node-spelling
 *   near-misses become ALIASES onto `visible` instead — the same direction
 *   `ActionSchema` already takes for its own `visible`.
 * - `severity` is a closed enum with NO schema default: the renderer
 *   whitelists the four values and falls back to `info` on anything else —
 *   that fallback is the renderer's fact, and at authoring time an
 *   out-of-vocabulary severity is a mistake to refuse, not to absorb.
 *
 * `title` / `body` are `I18nLabelSchema`, NOT literal strings — the opposite
 * verdict from the rail's `title`, and measured the same way: this renderer
 * resolves both through `pickLocalized(…, language)` before rendering, so the
 * inline `{ en, 'zh-CN', … }` map is a delivered capability (the platform's
 * own `sys_user` page authors it on this very component).
 */
export const RecordAlertProps = strictObject({
  surface: 'this `record:alert`',
  history: PROPS_HISTORY,
  guidanceSets: [COMPONENT_NODE_KEYS_GUIDANCE],
  aliases: {
    // ADR-0089 made `visibleWhen` canonical for the component-NODE predicate,
    // and `visibility` is the pre-ADR-0089 page spelling — an author bringing
    // either down into this props bag is reaching for exactly what `visible`
    // delivers here (same evaluation scope), not making a typo.
    visibleWhen: 'visible',
    visibility: 'visible',
  },
}, {
  severity: z.enum(['info', 'warning', 'error', 'success']).optional().describe('Banner severity — styling, default icon, and the a11y role (`error` renders `role="alert"`/assertive; the rest `role="status"`/polite). Renderer default: `info`.'),
  title: I18nLabelSchema.optional().describe('Banner title — a string or an inline locale map ({ en, "zh-CN", … }), resolved to the current language at render (pickLocalized).'),
  body: I18nLabelSchema.optional().describe('Banner body — a string or an inline locale map, resolved like `title`.'),
  visible: z.union([z.boolean(), EvaluatedExpressionInputSchema], {
    error: (issue) => evaluatedExpressionUnionRefusal(issue.input),
  }).optional().describe('Visibility predicate evaluated against the record page scope (`record`, `user` + `ctx.*` mirror, `objectName`, `features`) — a boolean literal, a CEL string, or a `{ dialect, source }` envelope. Omit for always-visible; the banner is hidden while the record is still loading either way.'),
  icon: z.string().optional().describe('Lucide icon name (renderer default: the severity\'s own icon). Read on this component — contrast the rail\'s refused `icon`, which no render path reads.'),
  action: RecordAlertActionSchema.optional().describe('Optional call-to-action button rendered under the body — `{ actionName, label?, variant? }`, resolved from the object\'s declared actions.'),
  dismissible: z.boolean().optional().describe('Render an X control; dismissal is remembered per object/record in localStorage (renderer default: off).'),
  dismissKey: z.string().optional().describe('Stable key the dismissal is remembered under, so reworded titles do not resurrect a dismissed banner (renderer default: the English resolution of `title`, else the severity).'),
});
export type RecordAlertProps = z.input<typeof RecordAlertProps>;
/**
 * ADR-0122: the parsed state differs from the authored state on exactly one
 * key — `visible`'s bare-string arm normalizes to the canonical
 * `{ dialect: 'cel', source }` envelope (EvaluatedExpressionInputSchema's
 * transform).
 */
export type RecordAlertPropsParsed = z.infer<typeof RecordAlertProps>;

/**
 * `record:quick_actions` — #8744. See the family header above. The bar
 * renders actions DECLARED ON THE OBJECT, referenced by name; the engine
 * location-filters even explicitly named actions (`showcase_task_detail` and
 * the platform's `sys_user` page are the live specimens).
 */
export const RecordQuickActionsProps = strictObject({
  surface: 'this `record:quick_actions`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  guidance: {
    /**
     * Read-but-not-authorable, in two forms: as a string list the renderer
     * treats `actions` identically to `actionNames` (the spelling comes from
     * `record:related_list`, where `actions` IS the declared key); as inline
     * `ActionDef` objects it is the HOST channel — the default-page
     * synthesizer hands RESOLVED defs to the same read at runtime
     * (`buildDefaultActions`). Declaring the inline form would bless pages
     * that carry their own action definitions, bypassing the object's
     * `actions[]` — the single place the engine, the permissions gate and the
     * translation bundles resolve an action from.
     */
    actions: 'Write `actionNames` — this bar renders actions declared on the OBJECT, referenced '
      + 'by name (the `actions` spelling belongs to `record:related_list`). Inline action '
      + 'definitions are the host synthesizer\'s runtime channel, not authorable surface: an '
      + 'action a page defines for itself bypasses the object\'s declared `actions[]`, where '
      + 'the engine, permissions and translations resolve from.',
    /**
     * The #8691 `icon` class, on this card: the renderer reads `aria.label`
     * (`record-quick-actions.tsx`, the toolbar's `aria-label` fallback chain)
     * — but `label` is the one spelling the shared `AriaPropsSchema` refuses
     * (it is that shape's alias FOR `ariaLabel`), while the `ariaLabel` the
     * schema would accept is read by nothing on this renderer. Declaring
     * `aria: AriaPropsSchema` here would mint a declared-but-unenforced key on
     * the very card that abolishes them; declaring a bespoke `{ label }` shape
     * would contradict the platform-wide ARIA contract. Producer-side defect,
     * objectui's to fix (objectui#4663); the row declares `aria` the day the
     * renderer reads the contract spelling.
     */
    aria: 'Not declared on this component: the renderer reads `aria.label`, a spelling the '
      + 'shared ARIA shape refuses (`label` is its alias for `ariaLabel`), and reads nothing '
      + 'else of the bag — declaring either spelling would be declared-but-unenforced surface. '
      + 'The toolbar falls back to its built-in "Quick actions" label; the renderer-side fix is '
      + 'objectui\'s, and this row declares `aria` when the two agree.',
  },
}, {
  actionNames: z.array(z.string()).optional().describe('Names of actions declared on this object (`actions[]`), in display order. The engine still location-filters named actions. Measured: when omitted (and the host supplies nothing) the bar resolves NO actions and renders its empty placeholder — it does not fall back to "every action at this location", whatever the registration\'s input list claims.'),
  requiredPermissions: z.array(z.string()).optional().describe(RECORD_BLOCK_REQUIRED_PERMISSIONS_DESCRIPTION),
  location: ActionLocationSchema.optional().describe('Which declared action location this bar renders (renderer default: `record_header`).'),
  align: z.enum(['start', 'center', 'end']).optional().describe('Horizontal alignment of the button row (renderer default: `end`).'),
  inline: z.boolean().optional().describe('Render in the flow instead of pulling up into the record-header band. The page header sets this itself when it hosts the bar in its own action slot.'),
  variant: z.enum(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']).optional().describe('Button variant for every action — the Button primitive\'s own vocabulary; a per-action `variant` on the resolved def wins (renderer default: `default`).'),
  size: z.enum(['default', 'sm', 'lg', 'icon']).optional().describe('Button size for every action — the Button primitive\'s own vocabulary; a per-action `size` wins (renderer default: `sm`).'),
});
export type RecordQuickActionsProps = z.input<typeof RecordQuickActionsProps>;

/**
 * `record:history` — #8744. See the family header above. Drop-anywhere audit
 * timeline: with no host-supplied rows the renderer SELF-FETCHES the record's
 * own `sys_activity` entries, which is why the authorable surface is three
 * presentation keys and the data channel is guidance, not declaration.
 *
 * `emptyText` / `unknownUserText` are literal strings, NOT `I18nLabelSchema` —
 * the rail's `title` verdict, re-measured here: `HistoryTimeline` renders both
 * as raw React children / bare string fallbacks, so an inline locale map would
 * paint `[object Object]` (or never match). Declaring the map spelling would
 * advertise a translation capability the renderer does not deliver.
 */
export const RecordHistoryProps = strictObject({
  surface: 'this `record:history`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  guidance: {
    entries: '`entries` is the HOST\'s data channel, not authorable surface: RecordDetailView\'s '
      + 'synthesizer passes the rows it fetched through it at runtime '
      + '(`buildDefaultPageSchema({ history })`). Hand-authored rows would ship a static, fake '
      + 'audit trail that never updates. Omit it — with no host entries the block self-fetches '
      + 'the record\'s own `sys_activity` history.',
    loading: '`loading` is the host synthesizer\'s fetch state, not authorable surface: authored '
      + '`true` pins the skeleton on forever. Omit it with `entries` — the self-fetch manages '
      + 'its own loading state.',
  },
}, {
  limit: z.number().int().positive().optional().describe('Maximum history entries displayed, and the `$top` of the self-fetch query (renderer default: 50).'),
  emptyText: z.string().optional().describe('Copy shown when the record has no history. Literal string rendered as-is in EVERY locale (no inline locale map — the timeline renders it as a raw React child; renderer default: "No history yet").'),
  unknownUserText: z.string().optional().describe('Copy substituted when an entry has no resolvable actor. Literal string, every locale (renderer default: "Unknown user").'),
});
export type RecordHistoryProps = z.input<typeof RecordHistoryProps>;

/**
 * [#21142] What the missing row cost: `record:line_items` was the one type on
 * the string-arm registration ledger (`component-type-vocabulary.ts`), so the
 * component-props gate skipped its props bag as unregistered. The showcase
 * project page keyed all five of its grid columns `field` — the spelling the
 * grid retired — and published green, and the grid drew every cell empty.
 */
const RECORD_LINE_ITEMS_HISTORY =
  'Until this type had a row, the component-props gate skipped it as unregistered: a column keyed '
  + '`field` (the spelling the grid retired) or any other key the renderer does not read parsed '
  + 'clean, and the grid drew its cells empty.';

/**
 * `record:line_items` (#21142) — the inline-editable child grid bound to the
 * record the page shows (objectui ADR-0001). Measured by the renderer
 * read-point method at the `.objectui-sha` pin `31971ff1e28f`: objectui
 * registers it in `plugin-form/src/index.tsx:579` and renders it through
 * `LineItemsPanel` (`plugin-form/src/LineItemsPanel.tsx`), and `SchemaRenderer`
 * hoists `properties` onto the schema that component reads. Its fifteen
 * `schema.<key>` reads are the key set, and a key nobody reads is not declared:
 *
 *  - `childObject` `:327`, `:516`, `:673`, `:778`; `relationshipField` `:515`,
 *    `:674`; `columns` `:702`;
 *  - `parentObject` `:221`; `parentId` / `recordId` `:228` (`parentId` wins,
 *    then `recordId`, then the record on the page);
 *  - `amountField` `:669`, `:703`; `totalField` `:667`, `:669`, `:703`;
 *  - `title` `:722`; `readonly` `:706`, `:707`, `:723`, `:810`; `minRows`
 *    `:704`; `maxRows` `:705`;
 *  - `filter` `:366`; `sort` `:368`, `:377`; `limit` `:341`, `:437`.
 *
 * The wrapper adds no key: `ElementDataSourceGate`
 * (`react/src/element-data-source/ElementDataSourceGate.tsx`) reads the
 * node-level `dataSource` and the same `filter` / `sort` / `limit` (`:421`,
 * `:434`, `:445`), and the block's mapping writes the binding's `object` onto
 * `childObject` (`plugin-form/src/index.tsx:556`). The read set is unchanged on
 * objectui `main` at `d59f11c0d3dc`.
 *
 * `filter` declares the one orthography every `filter` door in this map
 * shares, the ViewFilterRule array — the `record:related_list.filter`
 * declaration. The panel's lowering (`toFilterNodeSafely`) also takes the
 * MongoDB-style record and the AST forms; the contract does not.
 *
 * `columns` IS {@link InlineGridColumnSchema} — the same object a relationship
 * field's `inlineColumns`, a form view's `subforms[].columns` and an
 * `object-master-detail-form` detail entry's `columns` take, not a copy: the
 * panel hands its columns to the same objectui grid (`GridField`, whose
 * `GridColumn` declares exactly that schema's twenty keys at the pin and IS
 * the spec's type by reference on objectui `main`). One difference is the
 * carrier's, not the column's, and the `describe()` says it: this panel does
 * NOT hydrate a column from the child object's field — it passes `columns`
 * straight through the field-security pass to the grid (`:702`) — so a
 * column draws exactly what it declares, and an identity-only `{ name }`
 * column is a text cell headed by its name. For the same reason
 * `defineStack`'s identity-only check (`collectHydratedInlineColumnErrors` in
 * `stack.zod.ts`) does not reach this block: there is no hydrated type to
 * judge.
 *
 * The keys this block shares with an `object-master-detail-form` detail entry
 * take that entry's types and alias table, so one concept is spelled one way
 * on every child-collection surface. Three of them differ in presence for a
 * measured reason: `relationshipField` and `columns` are required here because
 * nothing derives them (the entry auto-detects the FK and derives the
 * columns; this panel queries `{ [relationshipField]: parentId }` and draws
 * `columns` as given), and `childObject` is optional because the
 * component-level `dataSource` binding can supply it instead. `title` is a
 * plain string because the panel draws it as a React child.
 */
export const RecordLineItemsProps = lazySchema(() => strictObject({
  surface: 'this `record:line_items`',
  history: RECORD_LINE_ITEMS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  aliases: {
    object: 'childObject', childObjectName: 'childObject', child: 'childObject',
    foreignKey: 'relationshipField', relationField: 'relationshipField', parentField: 'relationshipField',
    fields: 'columns', label: 'title', sumField: 'amountField', rollupField: 'totalField',
    // The plural every `filter` door answers (`FILTERS_TO_FILTER`, declared
    // further down — spelled here because `OS_EAGER_SCHEMAS=1` evaluates this
    // body before that const is initialised).
    filters: 'filter',
  },
  guidance: {
    // The four detail-entry keys this panel does not read — the spellings an
    // author moving a child collection over from `object-master-detail-form`
    // carries along. Measured at the pin: the panel hands the grid no
    // `add_label` / `sort_field` and no `onRowExpand` (`:694-710`, `:806-817`).
    addLabel: '`record:line_items` does not read `addLabel`: its grid draws the built-in, localized '
      + 'Add button. `addLabel` belongs to an `object-master-detail-form` detail entry.',
    sortField: '`record:line_items` does not read `sortField`: its grid stamps no line position, so a '
      + 'drag-reorder is not saved. `sortField` belongs to an `object-master-detail-form` detail entry.',
    formFields: '`record:line_items` draws an editable grid only, with no per-row expand form, so it '
      + 'does not read `formFields`. It belongs to an `object-master-detail-form` detail entry.',
    inlineMode: '`record:line_items` draws an editable grid only, so it does not read `inlineMode`. It '
      + 'belongs to an `object-master-detail-form` detail entry.',
  },
}, {
  childObject: z.string().optional()
    .describe('Child object whose records this grid lists, edits and saves. Optional because the component-level `dataSource` binding can supply the object instead; with neither, the panel shows a configuration hint and fetches nothing'),
  relationshipField: z.string()
    .describe("FK on the child object pointing back to the parent record — the rows are queried as `{ [relationshipField]: parentId }`. Required: this panel does not auto-detect it"),
  columns: z.array(InlineGridColumnSchema).min(1)
    .describe("Editable grid columns, drawn exactly as declared. Each entry is the strict, name-keyed inline grid column a relationship field's `inlineColumns` takes ({ name, label?, type?, options?, … } — objectui GridColumn); unknown keys and the retired `field` spelling are refused. Unlike the master-detail carriers, this block does NOT hydrate a column from the child object's field: declare `label`, `type` and `options` yourself — an identity-only `{ name }` column is a text cell headed by its name. Required, with at least one column: nothing derives them, and an empty list draws a grid with no cells"),
  parentObject: z.string().optional()
    .describe("Parent object the `totalField` rollup is written to (default: the object of the record on the page)"),
  parentId: z.string().optional()
    .describe('Parent record id the rows belong to (default: the record on the page). Wins over `recordId`'),
  recordId: z.string().optional()
    .describe('Alternate spelling of `parentId` the renderer also reads; `parentId` wins when both are set'),
  amountField: z.string().optional()
    .describe("Numeric child column summed for the running total and for the `totalField` rollup (default `amount` when only `totalField` is set)"),
  totalField: z.string().optional()
    .describe('Parent field to receive the rolled-up sum on save'),
  title: z.string().optional()
    .describe('Panel title. A literal string rendered as-is in every locale (no inline locale map — the panel renders it as a React child); renderer default: the localized "Line Items"'),
  readonly: z.boolean().optional()
    .describe('Render the grid read-only: cells locked, no Save button, and no adding or removing lines (renderer default: editable)'),
  minRows: z.number().optional().describe('Minimum number of rows'),
  maxRows: z.number().optional().describe('Maximum number of rows'),
  filter: z.array(ViewFilterRuleSchema).optional()
    .describe('Additional criteria for the child rows — the ViewFilterRule array form `[{ field, operator, value }, ...]`, AND-combined with the parent relationship condition, never substituted for it: it can only narrow this record\'s lines'),
  sort: z.array(SortItemSchema).optional()
    .describe('Load order for the child rows — the SortItem array form `[{ field, order }, ...]` (renderer default: storage order)'),
  limit: z.number().int().positive().optional()
    .describe('Row cap for the child fetch (renderer default: 500). The grid has no pagination, so this is the window of rows that are editable and saved together'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type RecordLineItemsProps = z.input<typeof RecordLineItemsProps>;
/**
 * Post-parse shape of {@link RecordLineItemsProps} (ADR-0122). Differs from the
 * author state because `columns` carries `InlineGridColumnSchema`, whose
 * `readonlyWhen` / `requiredWhen` bare-string predicates normalize to
 * Expression envelopes at parse.
 */
export type RecordLineItemsPropsParsed = z.infer<typeof RecordLineItemsProps>;

export const PageAccordionProps = strictObject({
  surface: 'this `page:accordion`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  items: z.array(strictObject({
    surface: 'this `page:accordion` item',
    history: PROPS_HISTORY,
    guidance: {
      /**
       * ⚠️ NOT declared, deliberately, and the measurement is why: objectui's
       * Studio block designer publishes `value` as an accordion item input
       * (`previews/block-config.ts`, `page:accordion.items.itemFields`), but
       * the renderer OVERWRITES it — `containers.tsx:793` maps every item to
       * `{ ...it, value: \`panel-${idx}\` }` before rendering, so an authored
       * `value` reaches the Radix item as a discarded key.
       *
       * That is the difference between this key and `page:tabs`'s `value`, one
       * component over, where the renderer really does read what is authored
       * (`it.value` with a `tab-${idx}` fallback). Declaring it here on the
       * #5611 rule would be reading the rule backwards: the rule is that the
       * DELIVERED shape is the contract, and what is delivered here is an
       * index-derived panel id. The designer input is objectui's to fix
       * (filed at #7973); until then this prescription is what stops an author
       * being told a dead key is fine.
       */
      value: '`page:accordion` items have no author-settable `value` — the renderer derives '
        + '`panel-<index>` and discards whatever is written here. Remove the key. (A `page:tabs` '
        + 'item DOES take a `value`, which is where this spelling usually comes from.)',
    },
  }, {
    label: I18nLabelSchema,
    /**
     * Panel-trigger icon, and the reason this key carries a docblock at all: a
     * liveness sweep read it as declared-but-unenforced and opened a retirement
     * candidate against it, which cost a full dispatch cycle before the
     * cross-repo read point was found (#9397, closed premise-overtaken; #9881
     * is the rider that records the liveness here so the next sweep cannot
     * re-derive the same false candidate).
     *
     * The key is LIVE at the objectui pin this repo builds against
     * (`.objectui-sha` = `31971ff1e`; re-derived at that pin 2026-10-01 —
     * `containers.tsx` is byte-identical across the hop from `e420df310`
     * (`git diff --quiet`), so both anchors were re-READ in place, each still
     * the read point this record names: `1171-1177` and `1220`. At `e420df310`
     * (2026-09-30) `containers.tsx` changed again across the hop from
     * `db11afd49` (40
     * insertions, 26 deletions: objectui#11166's `page:header` breadcrumb slot
     * and objectui#11212's fail-closed permission gates), every hunk at `:1286`
     * or below, so both anchors were re-READ in place and NEITHER moved, each
     * byte-identical: `1171-1177` and `1220`. At `db11afd49` (2026-09-29)
     * `containers.tsx` changed again across the hop from `dd3f7e1be` (46
     * insertions, 6 deletions: objectui `0ecaa7dbb`'s block-level nested `aria`
     * bags and comment re-citations), so both anchors were re-READ rather than
     * carried, and BOTH MOVED with their text byte-identical, the icon block by
     * 32 and the registration input by 34: `1139-1145` -> `1171-1177`, `1186` ->
     * `1220`. At `dd3f7e1be` (2026-09-28)
     * `containers.tsx` changed across the hop from `f8a9d0fb0` (120
     * insertions, 63 deletions, objectui `3261e6479`, `f5178a272`,
     * `e32dae160` and `1dae95a41`: the shared title interpolator, spec action
     * params and two comment sweeps), so both anchors were re-READ rather than carried, and
     * BOTH MOVED by 70 with their text byte-identical, the net +70 all landing
     * above them: `1069-1075` -> `1139-1145`, `1116` -> `1186`. On the hop
     * onto `f8a9d0fb0` (36 insertions, 7 deletions, objectui `ba0b61a60`: one
     * import line and the `page:header` title) both were re-READ and NEITHER
     * moved: `1069-1075` and `1116` were byte-identical to their `62597c588`
     * and `87af769e9` text. The same held on the hop onto
     * `62597c588` (74 insertions, 16 deletions, objectui `4c6f549ef`). The hop before, off
     * `53ded82bf`, moved the icon block `919-925` -> `1069-1075` with its seven
     * lines byte-identical and the registration input `966` -> `1116` with its
     * LINE rewritten — it declares `of: 'object'` and carries a longer
     * description — while the member list this record cites stayed
     * unchanged): `containers.tsx:1171-1177`
     * renders
     * `{item.icon && <LazyIcon name={item.icon} …/>}` inside the
     * `AccordionTrigger`, grouped with the label in the trigger's one wrapping
     * span, and the renderer's registration publishes the key to the Studio
     * block designer at `:1220` (the `items` input, documented as
     * `[{ label, icon?, collapsed?, children }]`).
     *
     * Vocabulary is Lucide, resolved through objectui's `LazyIcon`
     * (`lib/lazy-icon.tsx` — kebab-case or PascalCase, normalised to
     * kebab-case, with a fallback when the name is not a real Lucide icon), the
     * same slot every other authorable icon on this surface uses. Contrast the
     * item `value` prescribed against above: the same renderer OVERWRITES that
     * one, and a read point is precisely what separates the two verdicts.
     */
    icon: z.string().optional().describe(
      'Lucide icon name rendered in the panel trigger, left of the label. Read on this component — the renderer draws it via `LazyIcon`; contrast the item `value` beside it, which the renderer overwrites with `panel-<index>`.',
    ),
    collapsed: z.boolean().default(false),
    children: componentSlot(z.array(z.unknown()).describe('Child components')),
  })),
  allowMultiple: z.boolean().default(false).describe('Allow multiple panels to be expanded simultaneously'),
  /**
   * Panel framing (#6776). `flush` is the renderer's own default and draws the
   * divider itself (`border-b last:border-b-0` on every panel but the last);
   * `card` hands the border to whatever each panel contains, so a panel holding
   * a `page:card` does not get a second frame around the first.
   *
   * Declared here because the renderer has always read it — `containers.tsx:734`
   * resolves `schema?.variant ?? schema?.properties?.variant ?? 'flush'`, and
   * its own comment invites authors in ("Authors opt in by setting
   * `variant: 'card'`"). The difference is visible on screen, so this was an
   * author-facing option that `PageAccordionProps` simply never declared.
   */
  variant: z.enum(['flush', 'card']).default('flush')
    .describe("Panel framing: 'flush' draws a divider under each panel; 'card' leaves the border to each panel's own content"),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const AIChatWindowProps = strictObject({
  surface: 'this `ai:chat_window`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  mode: z.enum(['float', 'sidebar', 'inline']).default('float').describe('Display mode for the chat window'),
  agentId: z.string().optional().describe('Specific AI agent to use'),
  context: z.record(z.string(), z.unknown()).optional().describe('Contextual data to pass to the AI'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

/**
 * ----------------------------------------------------------------------
 * 3. Content Element Components (Airtable Interface Parity)
 * ----------------------------------------------------------------------
 */

export const ElementTextPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:text`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  /**
   * Text or Markdown body copy.
   *
   * `I18nLabelSchema` rather than a bare `z.string()` (#5728, named explicitly
   * in the maintainer's ruling because the label-wide widening could not reach
   * it): `sys-user.page.ts` authors eight `element:text` nodes whose `content`
   * is an inline `{ en, 'zh-CN', 'ja-JP', 'es-ES' }` map, and objectui resolves
   * them through the same `pickLocalized` every label goes through. The bare
   * string was the declaration disagreeing with the delivered shape, and it was
   * eight of the 42 findings the #5068 gate reported on the platform's own
   * pages.
   */
  content: I18nLabelSchema.describe('Text or Markdown content — a plain string, or an inline locale map'),
  /**
   * Text style variant, declared as the PUBLISHED NINE plus the two spellings
   * this declaration has always accepted.
   *
   * objectui#7450's ruling (director batch #71, 2026-09-07, maintainer
   * verbatim 「其他同意」) converges `element:text` on the nine values
   * `@object-ui/types` publishes for its text node — `h1`-`h6`, `body`,
   * `caption`, `overline` — with `heading` / `subheading` becoming named
   * refusals carrying migration hints. The maintainer then split the landing
   * (2026-09-09, option B): release 1 widens and refuses NOTHING, so
   * out-of-repo authors converge on a released pin before any spelling stops
   * working; release 2 carries the refusals and waits on a value-level
   * retirement mechanism that does not exist yet (`retiredKey()` / ADR-0087 D2
   * retire a KEY, not a VALUE). This entry is release 1. So the accepted set
   * GROWS by seven and loses nothing: `h1`-`h6` and `overline` were refused
   * here with `invalid_value` on the 17.3.0 pin, measured, and `heading` /
   * `subheading` stay accepted.
   *
   * Why the widening is authored HERE rather than in objectui: this
   * declaration is the authoring gate, and it already refused the seven. The
   * accurate statement of the defect the ruling names is 「the renderer
   * swallows what the authoring gate already refuses」 — objectui declaring
   * the nine against a spec that refuses them is the consumer-side widening
   * AGENTS.md #0.1 bans, and objectui's own per-PR registry↔spec parity gate
   * catches it.
   *
   * ⚠️ `.optional().default('body')` is KEPT, deliberately, not inherited.
   * Absence is the one thing a widening must not move: a parsed
   * `element:text` node with no `variant` materialises `variant: 'body'`
   * today, and it still does — identical bytes in, identical bytes out. The
   * `ui:text` side of the platform deliberately does NOT synthesise `body`
   * for an absent `variant` (objectui#6942, protecting unannotated corpus
   * nodes); that asymmetry is pre-existing, is not this card's to resolve,
   * and is left exactly where it was. Removing the default here would refuse
   * nothing and break nothing at the door, but it WOULD change what every
   * downstream reader sees for an absent key — a silent behaviour change
   * wearing an additive changeset, which is what the ruling's split exists to
   * prevent.
   */
  variant: z.enum([
    // The published nine (`@object-ui/types` `TextProps['variant']`).
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'caption', 'overline',
    // Accepted since this shape was declared; release 2 turns these two into
    // named refusals with migration hints, ⛔ not release 1.
    'heading', 'subheading',
  ])
    .optional().default('body').describe('Text style variant'),
  align: z.enum(['left', 'center', 'right'])
    .optional().default('left').describe('Text alignment'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

export const ElementNumberPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:number`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  object: z.string().describe('Source object'),
  field: z.string().optional().describe('Field to aggregate'),
  aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max'])
    .describe('Aggregation function'),
  /**
   * Filter rules narrowing the aggregate — the `ViewFilterRule` ARRAY form,
   * `[{ field, operator, value }, ...]`, the one filter orthography every
   * other `filter` input in this map already declares (`record:related_list`
   * and its Add-affordance picker). Until the ui#6206 ruling (2026-08-25,
   * Option B, verbatim 「同意」: one filter orthography platform-wide) this
   * entry alone said `FilterConditionSchema`, the MongoDB-style record form —
   * so the filter a list view stores and renders was refused by the KPI
   * element beside it. Sequenced consumer-first (the 2026-08-25 Option-A
   * ordering ruling): objectui#6828 made `ObjectStackAdapter.aggregate()`
   * lower a rule array through the same `translateFilterArray` its `find()`
   * path runs, and the pin carrying it (`d8ec8d6d`) was re-measured before
   * this declaration moved — authored array → adapter lowering → filter AST →
   * accepted at the analytics door (which still refuses a RAW rule-object
   * array, by design). The record form is refused at `filter`; the migration
   * prescription is the `element-number-filter-rule-array` semantic entry.
   */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `element:number`',
      migration: 'element-number-filter-rule-array',
    }),
  }).optional()
    .describe('Filter rules narrowing the aggregate — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` input in this map shares. The MongoDB-style record form is refused — see migration `element-number-filter-rule-array`'),
  format: z.enum(['number', 'currency', 'percent']).optional().describe('Number display format'),
  prefix: z.string().optional().describe('Prefix text (e.g. "$")'),
  suffix: z.string().optional().describe('Suffix text (e.g. "%")'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));
export type ElementNumberProps = z.input<typeof ElementNumberPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on exactly one
 * key — `filter` carries `ViewFilterRuleSchema` (the ui#6206 convergence),
 * whose own input ≠ infer (`operator` is normalized on parse, which is why
 * `ViewFilterRuleParsed` exists). So `element:number` leaves the type-alias
 * convention pin's isomorphic family (the Iso818 line deleted with this
 * alias), taking the `ObjectGridPropsParsed` route its comment prescribes.
 */
export type ElementNumberPropsParsed = z.infer<typeof ElementNumberPropsSchema>;

export const ElementImagePropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:image`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  src: z.string().describe('Image URL or attachment field'),
  alt: z.string().optional().describe('Alt text for accessibility'),
  fit: z.enum(['cover', 'contain', 'fill'])
    .optional().default('cover').describe('Image object-fit mode'),
  height: z.number().optional().describe('Fixed height in pixels'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

/**
 * Read-only, synthesized view of a metadata item, embedded inline in content
 * (ADR-0051). This is the *inline form* of ADR-0046 §3.5 ("derived content is
 * rendered, never written") and the component a ` ```metadata ` doc fence
 * compiles to. Because it renders the platform's *own* metadata via the
 * platform's *own* viewer, it carries no expressions or actions — it stays on
 * the data side of the §3.4 trust boundary and is safe to embed in inert docs
 * (`embeddableInDoc`). The view is resolved live at read time, then projected
 * to the reader's permissions automatically (see `detail` for the distinct,
 * author-controlled altitude projection). `object` embeds are deferred
 * (ADR-0051 §5).
 */
export const ElementMetadataViewerPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:metadata_viewer`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  type: z.enum(['state_machine', 'flow', 'permission'])
    .describe('Metadata view kind (ADR-0051): state_machine | flow | permission'),
  name: z.string()
    .describe('Target metadata item name; resolved package-scoped (ADR-0048), then dependencies (ADR-0046 §3.3)'),
  object: z.string().optional()
    .describe('Owning object — required for object-scoped kinds: state_machine is a rule ON an object (ADR-0020), permission renders a matrix FOR one; omit for top-level flow'),
  mode: z.enum(['diagram', 'matrix', 'summary']).optional()
    .describe('Render form; defaults per type (diagram for flow/state_machine, matrix for permission)'),
  detail: z.enum(['business', 'technical']).optional().default('business')
    .describe('Authoring altitude (ADR-0051 §3.4): business collapses technical flow nodes to business steps + approvals. NOT access (cf. book.audience); permission projection is automatic and render-time, never set here'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

/**
 * ----------------------------------------------------------------------
 * 4. Interactive Element Components (Phase B — Element Library)
 * ----------------------------------------------------------------------
 */

export const ElementButtonPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:button`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  label: I18nLabelSchema.describe('Button display label'),
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost', 'link'])
    .optional().default('primary').describe('Button visual variant'),
  size: z.enum(['small', 'medium', 'large'])
    .optional().default('medium').describe('Button size'),
  /**
   * Button icon, and the reason this key carries a docblock at all: its
   * describe used to read `Icon name (Lucide icon)` and nothing more — a
   * sentence equally true of `page:header`'s `icon` above, which is REFUSED
   * precisely because no render path reads it. Vocabulary does not separate
   * the two verdicts; a read point does. That missing separation has already
   * cost a full dispatch cycle re-deriving a cross-repo read point from
   * scratch (#9397, closed premise-overtaken), which is why #9881 and commit 60e0f900a
   * recorded it for the accordion and tab items. This is the same record for
   * the button.
   *
   * The key is LIVE at the objectui pin this repo builds against
   * (`.objectui-sha` = `31971ff1e`; re-derived at that pin 2026-10-01 —
   * `button.tsx`, `lib/lazy-icon.tsx`, `renderers/action/resolve-icon.ts` and the
   * generated `lucide-record-icon-names.ts` are all byte-identical to `e420df310`
   * across the hop onto this pin, so every anchor below holds unmoved and was
   * re-checked in place; they were byte-identical to `db11afd49` across the hop
   * onto `e420df310` (2026-09-30), and byte-identical to `dd3f7e1be` across the hop
   * onto `db11afd49` (2026-09-29) as well. At `dd3f7e1be` (2026-09-28)
   * `button.tsx` and `lib/lazy-icon.tsx` are byte-identical to `f8a9d0fb0`
   * (`git diff --quiet`); `resolve-icon.ts` changed on this hop (+42/-17,
   * objectui `fb336df01`, the lucide-react 1.31.0 -> 1.43.0 bump: the glyph
   * class names and the lazy module's path-data export, neither on the
   * resolution path), so its four anchors were re-READ — the rename map and
   * `toPascalCase` did not move, and `describeIconLookup` `302-305` ->
   * `327-330` and `resolveIcon` `322-328` -> `347-353` MOVED by 25 with their
   * text byte-identical. On the hop onto `f8a9d0fb0`, `resolve-icon.ts` and
   * `lib/lazy-icon.tsx` were byte-identical to `62597c588` and `87af769e9`,
   * and `button.tsx` changed only inside its registration's input list
   * (objectui `5ea623eab`, objectui#9910, below), so the render-path anchors
   * did not move; `button.tsx` too was byte-identical across the hop onto
   * `62597c588`. The hop onto `87af769e9` (re-derived 2026-09-20) is the
   * one that moved both files: `resolve-icon.ts` +203/-7 and
   * `button.tsx` +6/-11 against `53ded82bf`, so NO anchor below was carried
   * there and every one was re-READ. Four moved with their cited text byte-identical
   * (`describeIconLookup`, `toPascalCase`, the rename map, `getLazyIcon`);
   * `resolveIcon` itself was REWRITTEN — its tail no longer indexes
   * `lucide-react` directly — and the registration's two ranges both moved and
   * SHRANK, the input list having lost its per-input `label` and
   * `defaultValue` members. What each anchor asserts is re-stated below from
   * the new tree, never inferred from the old one — the re-READ discipline
   * this block records, and which the later paragraph below still cites by
   * number. ⚠️ That number does NOT resolve: objectstack issue 10274 was probed
   * 2026-09-20 with `scripts/check-issue-citations.mjs --probe-cause` and came
   * back minted, gone from the board and 404 on the web endpoint too — DELETED,
   * not transferred. ⛔ No replacement number is guessed here: the live record
   * of the discipline is THIS BLOCK, together with
   * `check:objectui-pin-citations`, whose header states the same rule and whose
   * refusal text enforces it. The read point
   * first MOVED rather than died on the earlier hop onto `9602dc820`, which is
   * why the anchors span a second
   * file):
   * `components/src/renderers/form/
   * button.tsx:43` resolves `schema.icon` through the shared `resolveIcon`,
   * and `:72` / `:74` render it on either side of the label per
   * `iconPosition` (`mr-2 h-4 w-4` left, `ml-2 h-4 w-4` right), both
   * suppressed while `loading`.
   *
   * ⚠️ The resolution path is NOT `LazyIcon`, the slot the container icons on
   * this surface use — it is the `action:*` resolver, and the two accept
   * different spellings:
   *   - here: `resolveIcon`
   *     (`components/src/renderers/action/resolve-icon.ts:347-353`) delegates
   *     to `describeIconLookup` (`:327-330`), which PascalCases through
   *     `toPascalCase` (`:153-158`) and then applies a one-entry rename map
   *     (`Home` becomes `House`, `:143-145`) before the lookup. ⚠️ That last
   *     step is what the hop onto `87af769e9` rewrote: the resolver no longer indexes
   *     `lucide-react`'s `icons` record itself — it asks `recordIconName` for
   *     the kebab-case name and hands the pair to `lazyIconComponent`, so the
   *     glyph now arrives lazily. The accept/reject behaviour is unchanged.
   *     ⚠️ The tokeniser splits on hyphen, underscore OR
   *     whitespace (`/[-_\s]+/`) as of this pin; this record previously said
   *     "splits on `-` only", which was true when written and is not now — a
   *     re-READ caught it, a line-number refresh would not have. An unknown
   *     name still resolves to `null` and the button renders with NO icon and
   *     no diagnostic anywhere.
   *   - `LazyIcon` / `getLazyIcon` (`components/src/lib/lazy-icon.tsx:98-124`):
   *     normalises to kebab-case, checks the name against Lucide's own name
   *     list, and degrades an unknown name to the `Database` glyph.
   *   So a spelling that draws an icon in a tab trigger can draw nothing here.
   *
   * That the resolver is SHARED is what this record most recently had to be
   * corrected for: until objectui#5993 `button.tsx` carried its own
   * `toPascalCase` + `iconNameMap` + `icons` index — the same algorithm, but
   * not the same function, so a rename added to `resolve-icon.ts` to absorb a
   * lucide retirement (objectui#5586, objectui#5622) reached every `action:*`
   * site and silently missed this one. Removing the duplicate changed where
   * the algorithm lives, not what an author may write: the accept/reject
   * behaviour promised above is the same on both sides of that move.
   *
   * Also measured at the same pin: the renderer's registration publishes no
   * `icon` input (`button.tsx:85-105` lists `label`, `variant`, `size`,
   * `className` and `children`; `:106-110` is `defaultProps`), so the Studio
   * block designer does not offer the key. The inputs GREW on the hop onto
   * `f8a9d0fb0` — `85-97` -> `85-105`, `defaultProps` `98-102` -> `106-110` —
   * because objectui#9910 declared the label slot's rich form as a
   * `{ name: 'children', type: 'slot' }` input; re-read, it is still not an
   * `icon` input, so the absence holds. Both ranges SHRANK on the hop onto `87af769e9` — the inputs went
   * `85-102` -> `85-97` and `defaultProps` `103-107` -> `98-102`, because each
   * input dropped its `label` and `defaultValue` members; the four input names
   * and the absence of an `icon` input are what was re-read, and both hold.
   * They read `70-87` / `88-92` until the
   * `a472b0716` re-measure: wrong since written rather than shifted —
   * `button.tsx` was byte-identical at `00d3f09c5` and `a472b0716`, so only a
   * re-READ could find them and a line-number refresh never would (commit d1ba685ec). Unpublished is not unread — the header `icon`
   * above is refused for the second, not the first, and this docblock exists
   * to hold them apart.
   */
  icon: z.string().optional().describe(
    'Lucide icon name rendered inside the button, left or right of the label per `iconPosition`. Read on this component — the renderer resolves it through `lucide-react`\'s `icons` map via the shared `resolveIcon` helper every `action:*` site uses (a PascalCase normaliser plus a one-entry rename map), NOT the `LazyIcon` slot the container icons use; the two paths accept different spellings, and an unknown name here renders nothing rather than a fallback glyph.',
  ),
  iconPosition: z.enum(['left', 'right'])
    .optional().default('left').describe('Icon position relative to label'),
  disabled: z.boolean().optional().default(false).describe('Disable the button'),
  /**
   * What the button does when clicked. Declared inline — a page button is not a
   * registered object action, so `name` and `label` are optional (the button
   * supplies its own label).
   *
   * Without this the button renders inert, which is why it was being authored
   * regardless: cloud's tenant pages carry five of them across the billing and
   * pricing funnel. Undeclared, it was **silently stripped** from
   * `ElementButtonPropsSchema`'s parse output — harmless only because page block
   * `properties` are still `z.record(z.string(), z.unknown())`, and a loaded gun
   * the moment that is tightened. objectstack-ai/objectui#2997.
   */
  action: InlineActionSchema.optional().describe('Inline action executed on click'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

/**
 * One prescription for every retired `element:filter` key — the retirement is
 * ELEMENT-grain (#9220), so all six keys carry the same story and differ only
 * in the fully-qualified key that heads the string (house style, rule 1).
 */
const elementFilterRetired = (key: string): string =>
  '`element:filter` property `' + key + '` was removed in @objectstack/spec 17 '
  + '(ADR-0049) — the whole `element:filter` element is retired: no renderer for it '
  + 'ever shipped in objectui, framework or cloud (Studio\'s designer palette lists it as a '
  + 'no-renderer exclusion), so every key on this element was a capability claim nothing '
  + 'kept. Delete the `element:filter` component; list surfaces own their filtering — use a '
  + "view's `userFilters` quick-filter bar or the list toolbar's filter builder. "
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

/**
 * RETIRED at element grain (#9220, ADR-0049 enforce-or-remove). `element:filter`
 * never had a renderer anywhere: objectui registers none (its
 * `renderers/basic/elements.tsx` header deferred it to "owning plugins" that
 * never materialized), Studio's designer palette lists it as a no-renderer
 * exclusion ("list surfaces own filtering"), and the 2026-06 page-liveness
 * audit already recorded it rendering "Unknown component type". Every key was
 * therefore a capability claim nothing kept — the same declared-but-unread
 * shape #9198 retired per-key on the two input elements, one grain wider.
 *
 * The schema (and its `ComponentPropsMap` row) stays exported so the #5068
 * props gate keeps DISPATCHING on `type: 'element:filter'` and refusing every
 * authored key with the prescription — deleting the row would demote the type
 * to an unregistered custom string the gate deliberately skips, turning a loud
 * retirement back into a silent no-op. The bare node the migration leaves
 * behind — it strips the keys and nothing else — used to parse clean, because
 * the open `type` union accepts any string and a node-level refusal was not
 * expressible here. It is expressible one level up: `element:filter` is a
 * member of `RETIRED_PAGE_COMPONENT_TYPES` (page.zod.ts), so
 * `PageComponentSchema` now refuses the node by name and hands the author the
 * element-grain tail of these very tombstones.
 */
export const ElementFilterPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:filter`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  object: retiredKey(elementFilterRetired('object')),
  fields: retiredKey(elementFilterRetired('fields')),
  targetVariable: retiredKey(elementFilterRetired('targetVariable')),
  layout: retiredKey(elementFilterRetired('layout')),
  showSearch: retiredKey(elementFilterRetired('showSearch')),
  aria: retiredKey(elementFilterRetired('aria')),
}));

/**
 * One prescription for every retired `element:form` key — the retirement is
 * ELEMENT-grain (#9249), so all six keys carry the same story and differ only
 * in the fully-qualified key that heads the string (house style, rule 1).
 */
const elementFormRetired = (key: string): string =>
  '`element:form` property `' + key + '` was removed in @objectstack/spec 17 '
  + '(ADR-0049) — the whole `element:form` element is retired: no renderer for it '
  + 'ever shipped in objectui, framework or cloud (Studio\'s designer palette lists it as a '
  + 'no-renderer exclusion — "use the object-bound `object-form` block"), so every key on '
  + 'this element was a capability claim nothing kept. Delete the `element:form` component '
  + 'and use the object-bound `object-form` block instead — it is rendered, '
  + 'designer-publishable, and carries the same intent (`objectName`, `fields`, `mode`, '
  + '`submitText`). '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

/**
 * RETIRED at element grain (#9249, ADR-0049 enforce-or-remove). `element:form`
 * never had a renderer anywhere: objectui registers none (its
 * `renderers/basic/elements.tsx` header deferred it to "owning plugins" that
 * never materialized — the same sentence whose `element:filter` half #9220
 * falsified), Studio's designer palette lists it as a no-renderer exclusion
 * naming the live replacement ("no renderer — use the object-bound
 * `object-form` block"), and the 2026-06 page-liveness audit already recorded
 * it rendering "Unknown component type". Every key was therefore a capability
 * claim nothing kept — the #9220 shape, one element over, exactly as the
 * origin card measured it.
 *
 * The schema (and its `ComponentPropsMap` row) stays exported so the #5068
 * props gate keeps DISPATCHING on `type: 'element:form'` and refusing every
 * authored key with the prescription — deleting the row would demote the type
 * to an unregistered custom string the gate deliberately skips, turning a loud
 * retirement back into a silent no-op. The bare node the migration leaves
 * behind — it strips the keys and nothing else — used to parse clean, because
 * the open `type` union accepts any string and a node-level refusal was not
 * expressible here. It is expressible one level up: `element:form` is a
 * member of `RETIRED_PAGE_COMPONENT_TYPES` (page.zod.ts), so
 * `PageComponentSchema` now refuses the node by name and hands the author the
 * element-grain tail of these very tombstones.
 */
export const ElementFormPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:form`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  object: retiredKey(elementFormRetired('object')),
  fields: retiredKey(elementFormRetired('fields')),
  mode: retiredKey(elementFormRetired('mode')),
  submitLabel: retiredKey(elementFormRetired('submitLabel')),
  onSubmit: retiredKey(elementFormRetired('onSubmit')),
  aria: retiredKey(elementFormRetired('aria')),
}));

/**
 * The record picker — a single-select over one object, writing the picked
 * record's id into a page variable.
 *
 * ⚠️ #5775 rewrote this shape end to end, and the reason is worth keeping: the
 * declaration and the renderer had drifted into two different contracts. The
 * schema required `displayField` that no renderer has ever read, and declared
 * `searchFields` / `multiple` that no renderer implements — while the renderer
 * honoured `labelField`, `valueField`, `label` and `emptyText`, none of which
 * were declared. An author following the schema got a picker rendered by
 * `name` with zero diagnostics (ADR-0078), and the #5068 gate reported the
 * showcase's own correct page as broken.
 *
 * The maintainer's ruling (2026-08-06, direction A) is the #5611 rule applied
 * again: the delivered, authorized shape is the contract. `labelField` is the
 * spelling — the renderer reads it, the component registry publishes it as a
 * designer input, and the showcase authors it — so `displayField` retires as
 * its synonym. `searchFields` and `multiple` retire under ADR-0049
 * enforce-or-remove: the control is a single-select `Select` with no search
 * box, so both were capability claims nothing kept (#5021 / #4988 precedent).
 * Either may return the day it is implemented; a declaration is not a roadmap.
 *
 * ⚠️ Commit 78f0be872 finished the same inventory one key-pair later, and the finding is
 * worth stating as a rule rather than as two more keys. The renderer resolves
 * its query from FOUR keys through one identical pattern — `dataSource` first,
 * the flat `properties` shorthand second:
 *
 * ```ts
 * const object = ds.object ?? props.object;
 * const filter = ds.filter ?? props.filter;
 * const sort   = ds.sort   ?? props.sort;
 * const limit  = ds.limit  ?? props.limit ?? 50;
 * ```
 *
 * After #5775 two of those four shorthands were declared (`object`, `filter`)
 * and two were not, so one renderer read half a contract and half a trapdoor:
 * an author who inferred `properties.limit: 20` from the `object`/`filter`
 * spelling got the renderer's default 50 with zero diagnostics — ADR-0078, on
 * the same element that had just been rewritten to remove it. The maintainer's
 * ruling (2026-08-08, direction A) declares the other two, so all four flat
 * shorthands are contract. Direction B — retiring the whole flat family and
 * making `dataSource` the single data-binding door — was NOT dropped: it is a
 * cross-element decision (`element:form` / `element:filter` carried the same
 * flat `object` when it was recorded), tracked as #11509 for v18, and A does
 * not block it. Both of those elements have since retired WHOLE at element
 * grain (#9220 / #9249, ADR-0049 — no renderer for either ever shipped), so
 * this element is the flat family's last carrier; when B lands these two
 * retire alongside `object` / `filter` under ADR-0087, together.
 *
 * Both keys are declared in the shape `ElementDataSourceSchema` already uses
 * for its own `sort` / `limit`, deliberately: they are the SAME contract read
 * through a second spelling, so a divergent shape here would be a third
 * dialect rather than a shorthand.
 */
export const ElementRecordPickerPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:record_picker`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  object: z.string().describe('Object to pick records from'),
  /**
   * Field rendered as each row's text. Defaults to `name`, which is what the
   * renderer falls back to (`props.labelField ?? 'name'`) — so this is
   * optional, not required: omitting it is a working picker, not a broken one.
   */
  labelField: z.string().optional().describe("Field rendered as each row's text (default `name`)"),
  /** Field whose value is written into the bound page variable (default `id`). */
  valueField: z.string().optional().describe('Field whose value is written into the bound page variable (default `id`)'),
  /** Control label rendered above the select. */
  label: I18nLabelSchema.optional().describe('Control label rendered above the select'),
  /**
   * Filter rules narrowing which records the picker offers — the
   * `ViewFilterRule` ARRAY form, `[{ field, operator, value }, ...]`, the one
   * filter orthography the map's array-declared `filter` doors share
   * (`record:related_list`, its nested Add-affordance picker, and — since
   * #12039 Key 2 — `element:number`; and, since #15449, the four `filter`
   * doors of the six-entry `object-*` family — `object-grid`,
   * `object-metric`, `object-kanban` and `object-calendar` — each of which
   * declares this same `z.array(ViewFilterRuleSchema)`, while that family's
   * remaining two entries, `object-form` and `object-master-detail-form`,
   * declare no `filter` key at all). Until #14406
   * this entry alone still said `FilterConditionSchema`, the MongoDB-style
   * record form: the last record-form `filter` in `ComponentPropsMap` after
   * the ui#6206 ruling (2026-08-25, Option B, verbatim 「同意」: one filter
   * orthography platform-wide).
   *
   * Sequenced measurement-first, as the `element:number` convergence had to
   * be (the 2026-08-25 Option-A ordering ruling): the read path was measured
   * at the objectui pin (`00d3f09c`) before this declaration moved. The
   * renderer hands the value to `query.$filter` and calls `adapter.find()`
   * (`components/src/renderers/basic/record-picker.tsx`);
   * `ObjectStackAdapter.convertQueryParams` lowers an ARRAY `$filter` through
   * `translateFilterArray` — `[{ field, operator, value }]` → filter AST
   * tuples (`data-objectstack/src/index.ts`) — the same door every list view's
   * stored rule array already takes, and the engine lowers the tuples before
   * the driver (`objectql/src/engine-filter-array-lowering.test.ts`). Nothing
   * on that path parses `properties` against the installed spec, so no
   * refusal stands between an authored array and the query. The record form
   * is refused at `filter`; the migration prescription is the
   * `element-record-picker-filter-rule-array` semantic entry.
   *
   * The binding-level `dataSource.filter` this shorthand yields to
   * (`ds.filter ?? props.filter`) is `ElementDataSourceSchema`'s key, not this
   * entry's subject.
   */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `element:record_picker`',
      migration: 'element-record-picker-filter-rule-array',
    }),
  }).optional()
    .describe('Filter rules narrowing which records the picker offers — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography the array-declared `filter` doors of this map share. The MongoDB-style record form is refused — see migration `element-record-picker-filter-rule-array`. The binding-level `dataSource.filter` wins outright when both are set'),
  /**
   * Row order (commit 78f0be872). The flat shorthand for `dataSource.sort`, and the same
   * shape — `SortItemSchema[]`, the pairs the renderer forwards to the query as
   * `$orderby`. `dataSource.sort` wins when both are written
   * (`ds.sort ?? props.sort`).
   */
  sort: z.array(SortItemSchema).optional()
    .describe('Row order — synonym of the component-level `dataSource.sort`, which takes precedence when both are set'),
  /**
   * Row cap (commit 78f0be872). The flat shorthand for `dataSource.limit`, same shape.
   * `dataSource.limit` wins when both are written, and with neither the
   * renderer queries `$top: 50` (`ds.limit ?? props.limit ?? 50`) — that 50 is
   * the renderer's fallback, not a schema default, so it is documented here
   * rather than declared: declaring it would materialize a `limit: 50` on every
   * parsed picker and turn an unset key into an authored one.
   */
  limit: z.number().int().positive().optional()
    .describe('Max records offered — synonym of the component-level `dataSource.limit`, which takes precedence when both are set (renderer default 50)'),
  /**
   * REMOVED (#9198). ADR-0049 enforce-or-remove: a declarative hint with zero
   * readers — the live binding runs the other direction, resolved from the
   * page variable whose `source` names this component's `id`
   * ({@link PageVariableSchema}), so authoring only `targetVariable` bound
   * nothing while reporting success.
   */
  targetVariable: retiredKey(
    '`element:record_picker` property `targetVariable` was removed in @objectstack/spec 17 '
    + '(ADR-0049) — it was a declarative hint no renderer ever read: the live binding '
    + "runs the other direction, resolved from the page variable whose `source` names this "
    + "component's `id`, so authoring only `targetVariable` bound nothing while reporting "
    + 'success. Delete the key; to bind the picked record id, declare it on the variable — '
    + "`variables: [{ name: '<var>', type: 'record_id', source: '<this component id>' }]`. "
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  placeholder: I18nLabelSchema.optional().describe('Placeholder text'),
  /** Shown in place of the row list when the query returns nothing. */
  emptyText: I18nLabelSchema.optional().describe('Text shown when the query returns no records (default "No records")'),
  /**
   * REMOVED (#5775). A synonym of `labelField` — the same concept in two
   * spellings, of which only `labelField` was ever read.
   */
  displayField: retiredKey(
    '`element:record_picker` property `displayField` was removed in @objectstack/spec 17.0.0 '
    + '(ADR-0087 D2) — it was a required declaration no renderer ever read, while the '
    + 'renderer honoured `labelField` for the same thing and defaulted to `name`. Rename the key '
    + 'to `labelField`; the value (a field name) is unchanged. '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  /**
   * REMOVED (#5775). ADR-0049 enforce-or-remove: the control has no search
   * box, so this narrowed nothing.
   */
  searchFields: retiredKey(
    '`element:record_picker` property `searchFields` was removed in @objectstack/spec 17.0.0 '
    + '(ADR-0049) — the picker renders a plain single-select with no search input, so no '
    + 'renderer ever read it and it narrowed nothing. Delete the key. To restrict which records '
    + 'the picker offers, use `filter` (or the component-level `dataSource.filter`), which the '
    + 'query path does apply. '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  /**
   * REMOVED (#5775). ADR-0049 enforce-or-remove: the control is a single-select
   * `Select`, and a page variable binds one record id.
   */
  multiple: retiredKey(
    '`element:record_picker` property `multiple` was removed in @objectstack/spec 17.0.0 '
    + '(ADR-0049) — the picker is a single-select `Select` and the bound page variable '
    + 'holds one record id, so `multiple: true` selected nothing extra and reported success. '
    + 'Delete the key; multi-record selection is not implemented on this element. '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));
export type ElementRecordPickerProps = z.input<typeof ElementRecordPickerPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on exactly one
 * key — `filter` carries `ViewFilterRuleSchema` (the ui#6206 convergence,
 * #14406), whose own input ≠ infer (`operator` is normalized on parse, which
 * is why `ViewFilterRuleParsed` exists). So `element:record_picker` leaves
 * the type-alias convention pin's isomorphic family (the Iso819 line deleted
 * with this alias), the route `element:number` took one entry earlier.
 */
export type ElementRecordPickerPropsParsed = z.infer<typeof ElementRecordPickerPropsSchema>;

/**
 * A single-line free-text input — the data-entry half of an SDUI page (Airtable
 * "text"/"number" field parity). The console renderer binds the typed value into
 * a page variable via the {@link PageVariableSchema} `source` convention (the
 * variable whose `source` equals this component's `id`), exposing it to
 * expressions as `page.<var>` and to submit actions as a `{{page.<var>}}` token.
 * A whole free-text family lives under one element: `inputType` selects the
 * native modality (text/email/number/…), keeping genuinely-distinct inputs
 * (textarea, select, checkbox) free to arrive as their own elements later.
 */
export const ElementTextInputPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:text_input`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  inputType: z.enum(['text', 'email', 'number', 'tel', 'url', 'password'])
    .optional().default('text')
    .describe('Native input type — drives keyboard/validation affordance and how the bound value is coerced (number → numeric).'),
  label: I18nLabelSchema.optional().describe('Field label shown above the input'),
  placeholder: I18nLabelSchema.optional().describe('Placeholder text shown when empty'),
  defaultValue: z.union([z.string(), z.number()]).optional()
    .describe('Initial value; seeds the bound page variable on mount'),
  required: z.boolean().optional().default(false).describe('Mark the field as required'),
  disabled: z.boolean().optional().default(false).describe('Disable the input'),
  description: I18nLabelSchema.optional().describe('Helper text shown below the input'),
  /**
   * REMOVED (#9198). ADR-0049 enforce-or-remove: the key's own describe text
   * already called it a "declarative hint" that the live binding does not use
   * — the binding resolves from the page variable whose `source` names this
   * component's `id` ({@link PageVariableSchema}). Zero readers anywhere; an
   * author who wrote only `targetVariable` and no variable `source` got an
   * input that wrote nothing, with a success receipt (the ADR-0078 shape).
   */
  targetVariable: retiredKey(
    '`element:text_input` property `targetVariable` was removed in @objectstack/spec 17 '
    + '(ADR-0049) — it was a declarative hint no renderer ever read: the live binding '
    + "runs the other direction, resolved from the page variable whose `source` names this "
    + "component's `id`, so authoring only `targetVariable` bound nothing while reporting "
    + 'success. Delete the key; to bind the typed value, declare it on the variable — '
    + "`variables: [{ name: '<var>', type: 'string', source: '<this component id>' }]`. "
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

/**
 * ----------------------------------------------------------------------
 * 4b. Curated public blocks that had no row: the `action:*` quartet and the
 *     two `element:*` lists (#20371)
 * ----------------------------------------------------------------------
 *
 * objectui's ADR-0080 curated public vocabulary carries six blocks this map
 * had no row for — `action:button`, `action:group`, `action:menu`,
 * `action:icon`, `element:definition-list`, `element:repeater`
 * (`core/src/registry/public-blocks.ts:117-122` at the pin this repo builds
 * against, `.objectui-sha` = `31971ff1e`; first measured at `.objectui-sha`
 * pin `f8a9d0fb0`, every read point below re-derived at the current pin
 * 2026-10-01: `public-blocks.ts`, `auto-trigger.ts`, `static-params.ts`,
 * `action-group.tsx`, `action-menu.tsx` and `action-icon.tsx` are
 * byte-identical to `e420df310`, so their anchors held unmoved, and
 * `action-button.tsx` changed only inside its registration (+9/-1,
 * objectui#11168 slice 2: the `size` input now publishes the five sizes its
 * row declares, where it published `sm` / `md` / `lg`), so every read point
 * in it held unmoved and the `inputs` range grew `414-551` -> `414-559`. At
 * `e420df310` (2026-09-30): `public-blocks.ts`, `auto-trigger.ts` and `static-params.ts` are
 * byte-identical to `db11afd49`, and all four `action-*.tsx` renderers changed
 * — objectui#11168 slice 1 rewrote every registration's `inputs` to publish
 * the keys the block path honours, objectui#11212 made each `visible` gate
 * fail CLOSED on a faulting predicate, objectui#11182 made `action:group` and
 * `action:menu` consume the host's evaluated `disabled` verdict, and
 * objectui#11073 renamed the renderers' React prop types — so every anchor was
 * re-READ at this pin and the rows below cite it here. Every declared key is
 * still read where its row cites it; what changed is what the registrations
 * publish, one read count on `action:icon`, the fault policy of the `visible`
 * gates, and a host `disabled` verdict the two containers now consume — each
 * said where it is written. At
 * `db11afd49` (2026-09-29) `public-blocks.ts` and `auto-trigger.ts` were
 * byte-identical to `dd3f7e1be`, and the four renderers changed only in comment
 * lines that re-qualify an objectstack card number, none of them a cited line).
 * The missing row failed in two different ways:
 *
 *  - The four `action:*` types sit outside every namespace the
 *    `PageComponentType` enum populates, so the #5068 props gate skipped them
 *    as unregistered custom strings: any key inside `properties` parsed,
 *    stored and rode through to the renderer, read or not.
 *  - The two `element:*` types sit INSIDE a reserved namespace with neither an
 *    enum member nor a row, so `component-type-unknown` refused the whole node
 *    (severity error) although objectui registers, publishes and offers both.
 *
 * A row closes both. `component-type-vocabulary.ts` derives the known set from
 * `Object.keys(ComponentPropsMap)`, so the two `element:*` types join the
 * `element:` vocabulary through their rows — the `element:metadata_viewer`
 * shape, no enum member — and the props gate now dispatches on all six. Their
 * three-part evidence (registration, publication, authorship) is written on
 * the map rows below, as the vocabulary's string-arm ledger asks of every
 * type that enters it without an enum member.
 *
 * KEY SETS ARE MEASURED FROM THE RENDERERS' READ POINTS at that pin — the
 * #7751 / #8691 / #8744 method — never transcribed from objectui's
 * `UIActionSchema`, from the registrations' `inputs`, or from this package's
 * object-metadata `ActionSchema` (a different declaration: a registered action
 * keyed by a required `name`, whose `type` is the executor). Per-key citations
 * are in each schema's docblock; where a declaration disagrees with the read,
 * the read wins and the disagreement is written beside the key.
 *
 * VALUE posture is #7751's. A key the renderer interprets itself gets a value
 * schema from that read (the Button primitive's own vocabulary where it is
 * handed straight to `Button`). A key the renderer only FORWARDS to the action
 * runner (`execute({ ...forwarded, ...localContext })`) gets the scalar the
 * runner's `ActionDef` types it as, and `z.unknown()` where `ActionDef` types
 * it as a spec-derived block (`bodyShape`, `onSuccess`, `resultDialog`, …) —
 * tightening those is a later ratchet with its own inventory.
 *
 * Deliberately NOT declared on the action rows, each with its reason:
 *
 *  - `className` / `style` / `id` — read, but node keys (`COMPONENT_NODE_KEYS`).
 *  - `enabled` — the renderers' legacy fallback beside `disabled`: a
 *    back-compat read for stored documents, not a second authorable spelling
 *    (the #5775 `body` precedent). Refused with a prescription.
 *  - `autoTrigger` — a host transport flag; `auto-trigger.ts:18-19` says it is
 *    "NOT persisted metadata" and "hosts its only producers". Refused with a
 *    prescription.
 *  - `data` / `context` — the host's row and execute-context channels (React
 *    props the renderers take by name), not authorable surface.
 *  - `onClick` — a function; only a code-composed schema can carry one.
 *
 * `objectName` IS declared on `action:button` / `action:icon`: absent at the
 * first measurement, it is forwarded to the runner at the current pin
 * (`action-button.tsx:311`, `action-icon.tsx:208`), and the console resolves
 * its dispatch target as `action.objectName || <page object>`. On
 * `action:group` / `action:menu` the forward is the MEMBER's
 * (`action-group.tsx:378`, `action-menu.tsx:324`), so it rides each member
 * object and the container rows gain no key.
 */

/** What an undeclared key on one of the four `action:*` blocks met before its row. */
const actionBlockHistory = (type: string) =>
  `Until \`${type}\` had a ComponentPropsMap row, the authoring gate skipped it as an unregistered `
  + "type: every key inside `properties` parsed clean, was stored, and reached objectui's renderer, "
  + 'which ignored any key it does not read.';

/** What happened to one of the two `element:*` lists before its row. */
const elementListHistory = (type: string) =>
  `Until \`${type}\` had a ComponentPropsMap row, the whole node was refused as an unknown `
  + '`element:` type although objectui renders it, so no key inside `properties` was ever judged.';

/**
 * The action-level condition shape the renderers evaluate — `visible` on all
 * four, `disabled` on `action:button` / `action:icon`: a boolean literal, a
 * CEL string (normalized to the `{ dialect, source }` envelope on parse), or
 * the envelope itself. Every read goes through `toPredicateInput`, which takes
 * exactly those three arms; it is the same union `ActionSchema`'s own
 * condition keys and `record:alert.visible` declare.
 */
const actionCondition = () =>
  z.union([z.boolean(), EvaluatedExpressionInputSchema], {
    error: (issue) => evaluatedExpressionUnionRefusal(issue.input),
  });

/** objectui's `Button` primitive vocabulary (`ui/button.tsx:19-35` at the pin). */
const BUTTON_PRIMITIVE_VARIANTS = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;
const BUTTON_PRIMITIVE_SIZES = ['default', 'sm', 'lg', 'icon'] as const;

/**
 * The action-row aliases shared by `action:button` and `action:icon`.
 *
 * - `type` → `actionType`: `type` is the SDUI envelope's component
 *   discriminator, and the hoist refuses to copy a `properties.type` onto the
 *   node, so an executor written there is read by nothing. objectui renamed
 *   the input to `actionType` with no alias and no transition window
 *   (objectui#7415); an author copying an
 *   `ActionSchema` entry, whose executor IS `type`, brings that spelling along.
 * - `visibleWhen` / `visibility` → `visible`: the `record:alert` pair. The
 *   renderer evaluates `visible` itself, so an author bringing the node
 *   spelling down into this bag is reaching for exactly that key.
 * - `url` / `endpoint` / `path` / `href` → `target`: `ActionSchema`'s own
 *   rename for the executor target, read from the one table both files share
 *   (`ACTION_TARGET_ALIASES`, `action-target-aliases.ts`) so the rows and the
 *   action print the same prescription. `endpoint` was a declared key of both
 *   rows until #21005 — forwarded by the renderers, read by no console `api`
 *   handler (those read `target` only), so an `endpoint` the rows accepted
 *   called nothing. A stored one is rewritten to `target` by the D2
 *   conversion `action-block-endpoint-to-target`. Without the table the rows
 *   answered `path` with the edit-distance guess `patch`, which parses.
 */
const ACTION_NODE_ALIASES = {
  type: 'actionType',
  visibleWhen: 'visible',
  visibility: 'visible',
  ...ACTION_TARGET_ALIASES,
} as const;

/**
 * Read-but-not-authorable keys shared by `action:button` and `action:icon`,
 * each read by the renderer and each refused here with what to write instead.
 */
const ACTION_NODE_GUIDANCE = {
  enabled: '`enabled` is the renderer\'s legacy fallback for stored documents, not an authorable '
    + 'key: write `disabled` instead, with the condition inverted — `disabled` is the predicate '
    + 'that greys the action out when it evaluates TRUE.',
  autoTrigger: '`autoTrigger` is a host transport flag, not metadata: a host sets it on a schema it '
    + 'composes at runtime to run the action once on mount (a deep link that asks for it). '
    + 'Authored into a page, it would run the action on every page load. Remove it.',
} as const;

/**
 * `action:button` — a button that runs one action through objectui's action
 * runner (`components/src/renderers/action/action-button.tsx` at the pin).
 * Read points, per key:
 *
 * - `name` — `:123` (the visibility-diagnostic label, `schema.name ??
 *   schema.label`) and `:216` (forwarded). OPTIONAL, as it is read: an inline
 *   page button is not a registered object action, and the runner takes a
 *   nameless action on its `type` leg. `UIActionSchema` declares it required;
 *   the read does not.
 * - `label` — `:387`, placed as a React child (so a literal string: an inline
 *   locale map is not resolved on this path; the translation bundle's
 *   `components.<id>.label` is the localization channel); also `:123`, `:220`.
 * - `icon` — `:138`, through the shared `resolveIcon`.
 * - `actionType` — `:215`, forwarded as the runner's `type`.
 * - `variant` / `size` — `:141` / `:142`: `primary` → the primitive's
 *   `default` and `md` → `default`, everything else handed to `Button` as-is.
 * - `visible` / `disabled` — `:121` + `:339` / `:134` + `:375`, evaluated
 *   against the row the host binds (`usePredicateRecordContext`).
 * - `params` — `:180-183`. An array is the input list, forwarded as
 *   `actionParams`; the static values are read off `properties.params`
 *   itself (`readStaticParamValues`, `static-params.ts:91-101`). On a page
 *   node the two are one key: this row IS `properties`, and `SchemaRenderer`'s
 *   hoist makes `schema.params` the same object, so an array here is the input
 *   list and an object is the static values. (A node-level object `params`
 *   outside `properties` is ignored with a development warning.)
 * - Forwarded to the runner (`:215-311`): `description`, `target`, `openIn`,
 *   `method`, `bodyExtra`, `bodyShape`, `operation`, `patch`,
 *   `confirmText`, `successMessage`, `errorMessage`, `refreshAfter`,
 *   `undoable`, `recordIdField`, `locations`, `toast`, `resultDialog`,
 *   `onSuccess`, `objectName`.
 *
 * NOT declared, though forwarded: `endpoint`. Both console runtimes register
 * their own `api` handler, which reads `action.target || action.name` and
 * never `endpoint`, so an `endpoint` written here reached the runner and
 * called nothing. Refused since #21005 with `ActionSchema`'s rename onto
 * `target` (`ACTION_NODE_ALIASES` above) — one concept, one spelling, one
 * verdict on the action and on the block that runs it.
 *
 * The registration's `inputs` (`:414-559`) publish twenty-seven of the
 * twenty-nine keys the renderer forwards or reads since objectui#11168 slice 1
 * (at `db11afd49` they published seven, `:395-416`), and since slice 2 the
 * `size` input publishes the same five values this row declares (`default`,
 * `sm`, `md`, `lg`, `icon`); the two left unpublished are `endpoint` (refused
 * here, above) and `undoable`, each still forwarded (`:215-311`), on
 * objectui's measurement that the console's own `api` handler reads `target`
 * and never `endpoint`, and that the runner offers Undo only with a host row
 * stash this block never writes. It also publishes `className`, which is read
 * but is a node key.
 */
export const ActionButtonPropsSchema = lazySchema(() => strictObject({
  surface: 'this `action:button`',
  history: actionBlockHistory('action:button'),
  guidanceSets: [COMPONENT_NODE_KEYS_GUIDANCE],
  aliases: ACTION_NODE_ALIASES,
  guidance: ACTION_NODE_GUIDANCE,
}, {
  name: z.string().optional()
    .describe('Action name, forwarded to the action runner. Optional: an inline page button is not a registered object action, and without a name the runner dispatches on `actionType` alone'),
  label: z.string().optional()
    .describe('Button text. A literal string, placed as-is — localize through the translation bundle entry for this component id, not an inline locale map'),
  icon: z.string().optional()
    .describe('Lucide icon name drawn left of the label, resolved through the shared action-icon resolver (an unknown name draws no icon)'),
  actionType: z.string().optional()
    .describe('Executor the action runner dispatches to — built in: `script`, `url`, `modal`, `flow`, `api`, `form`; a handler registered under another name is dispatched too. Write it here, not as `type`: on a page component `type` is the component itself'),
  variant: z.enum([...BUTTON_PRIMITIVE_VARIANTS, 'primary']).optional()
    .describe('Button variant — the Button primitive\'s vocabulary, plus `primary`, which renders as `default` (renderer default: `default`)'),
  size: z.enum([...BUTTON_PRIMITIVE_SIZES, 'md']).optional()
    .describe('Button size — the Button primitive\'s vocabulary, plus `md`, which renders as `default` (renderer default: `default`)'),
  visible: actionCondition().optional()
    .describe('Visibility predicate — a boolean, a CEL string, or a `{ dialect, source }` envelope, evaluated against the row the host binds; the button is not rendered when it is FALSE, and a predicate that fails to evaluate hides it. Omit for always-visible'),
  disabled: actionCondition().optional()
    .describe('Disabled predicate — a boolean, a CEL string, or a `{ dialect, source }` envelope; the button is shown but cannot be pressed while it is TRUE. Omit for never-disabled'),
  params: z.unknown().optional()
    .describe('Action parameters, forwarded to the runner: an array is the list of inputs to collect from the user before the action runs; an object is forwarded as the static parameter values'),
  description: z.string().optional()
    .describe('Action description, forwarded to the runner — the parameter dialog shows it under its title'),
  target: z.string().optional()
    .describe('Executor target, forwarded to the runner: the URL, script name, flow name or API endpoint, per `actionType`'),
  openIn: z.enum(['self', 'new-tab']).optional()
    .describe('For a `url` action: `self` navigates in place, `new-tab` opens a new browser tab'),
  method: z.string().optional().describe('HTTP method for an `api` action, forwarded to the runner'),
  bodyExtra: z.unknown().optional().describe('Static request-body fields for an `api` action, forwarded to the runner'),
  bodyShape: z.unknown().optional().describe('How an `api` action shapes its request body, forwarded to the runner'),
  operation: z.unknown().optional().describe('Declarative single-record write, forwarded to the runner together with `patch`'),
  patch: z.unknown().optional().describe('Field values the declarative `operation` writes, forwarded to the runner'),
  confirmText: z.string().optional().describe('Confirmation question asked before the action runs'),
  successMessage: z.string().optional().describe('Toast shown when the action succeeds'),
  errorMessage: z.string().optional().describe('Toast shown when the action fails, in place of the raw error'),
  refreshAfter: z.boolean().optional().describe('Refresh the surrounding data after the action runs'),
  undoable: z.boolean().optional().describe('Offer an Undo affordance after an update action'),
  recordIdField: z.string().optional().describe('Row field whose value identifies the record the action acts on'),
  locations: z.array(ActionLocationSchema).optional()
    .describe('Action locations, forwarded to the runner — the console uses them to tell a record-scoped action from an object-level one'),
  toast: z.unknown().optional().describe('Toast behaviour, forwarded to the runner'),
  resultDialog: z.unknown().optional().describe('One-shot result dialog for a value the response shows exactly once, forwarded to the runner'),
  onSuccess: z.unknown().optional().describe('Declared post-success navigation, forwarded to the runner'),
  objectName: z.string().optional()
    .describe('Object the action acts on, forwarded to the runner — the console dispatches to it instead of the page\'s object. Omit to act on the page\'s object'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ActionButtonProps = z.input<typeof ActionButtonPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on `visible` and `disabled` — the
 * bare-string arm of the condition union normalizes to the canonical
 * `{ dialect, source }` envelope (`EvaluatedExpressionInputSchema`'s transform).
 */
export type ActionButtonPropsParsed = z.infer<typeof ActionButtonPropsSchema>;

/**
 * `action:icon` — an icon-only action button with a tooltip
 * (`components/src/renderers/action/action-icon.tsx` at the pin). The same
 * runner path as `action:button`, measured separately because the two differ:
 *
 * - `size` is NOT read — `:120` pins the primitive's `icon` size — so it is
 *   not declared (the registration does not publish it either).
 * - `undoable` and `recordIdField` are NOT forwarded (`:147-209` lists the
 *   rest of `action:button`'s forward and not these two), so not declared.
 * - `label` is read five times at this pin (four at `db11afd49`):
 *   `:109` (the visibility-diagnostic label, `schema.name ?? schema.label`,
 *   new with objectui#11212's fail-closed `visible`), `:165` (forwarded),
 *   `:278` (`aria-label`, falling back to `name`), `:287` (its first letter
 *   when no icon resolves) and `:293` / `:299` (the tooltip). `description`
 *   is the tooltip's fallback (`:299`) as well as forwarded (`:166`).
 * - `visible` / `disabled` — `:107` + `:242` / `:115` + `:271`; `visible`
 *   fails CLOSED on a faulting predicate since objectui#11212, as on
 *   `action:button`. `variant` — `:119`, `primary` mapped to `default`,
 *   renderer default `ghost`.
 * - `params` — `:143-146`, routed exactly as on `action:button`.
 * - Forwarded (`:160-208`): `actionType`, `name`, `target`, `openIn`,
 *   `method`, `bodyExtra`, `bodyShape`, `operation`, `patch`,
 *   `confirmText`, `successMessage`, `errorMessage`, `refreshAfter`,
 *   `locations`, `toast`, `resultDialog`, `onSuccess`, `objectName`.
 * - `endpoint` is forwarded too and NOT declared, for `action:button`'s
 *   reason: no console `api` handler reads it. Refused with `ActionSchema`'s
 *   rename onto `target`, through the same `ACTION_NODE_ALIASES` (#21005).
 */
export const ActionIconPropsSchema = lazySchema(() => strictObject({
  surface: 'this `action:icon`',
  history: actionBlockHistory('action:icon'),
  guidanceSets: [COMPONENT_NODE_KEYS_GUIDANCE],
  aliases: ACTION_NODE_ALIASES,
  guidance: {
    ...ACTION_NODE_GUIDANCE,
    size: '`action:icon` is always icon-sized — the renderer fixes the Button primitive\'s `icon` '
      + 'size and reads no `size`. Remove the key, or use `action:button` for a sized button.',
  },
}, {
  name: z.string().optional()
    .describe('Action name, forwarded to the action runner; also the `aria-label` when there is no `label`. Optional, as for `action:button`'),
  label: z.string().optional()
    .describe('Accessible label and tooltip text (and its first letter stands in when no icon resolves). A literal string — localize through the translation bundle entry for this component id'),
  icon: z.string().optional()
    .describe('Lucide icon name, resolved through the shared action-icon resolver (renderer registration default `play`)'),
  actionType: z.string().optional()
    .describe('Executor the action runner dispatches to — built in: `script`, `url`, `modal`, `flow`, `api`, `form`; a handler registered under another name is dispatched too. Write it here, not as `type`'),
  variant: z.enum([...BUTTON_PRIMITIVE_VARIANTS, 'primary']).optional()
    .describe('Button variant — the Button primitive\'s vocabulary, plus `primary`, which renders as `default` (renderer default: `ghost`)'),
  visible: actionCondition().optional()
    .describe('Visibility predicate — a boolean, a CEL string, or a `{ dialect, source }` envelope, evaluated against the row the host binds; the icon is not rendered when it is FALSE. Omit for always-visible'),
  disabled: actionCondition().optional()
    .describe('Disabled predicate — a boolean, a CEL string, or a `{ dialect, source }` envelope; the icon is shown but cannot be pressed while it is TRUE. Omit for never-disabled'),
  description: z.string().optional()
    .describe('Action description — the tooltip text when there is no `label`, and forwarded to the runner for the parameter dialog'),
  params: z.unknown().optional()
    .describe('Action parameters, forwarded to the runner: an array is the list of inputs to collect from the user; an object is forwarded as the static parameter values'),
  target: z.string().optional()
    .describe('Executor target, forwarded to the runner: the URL, script name, flow name or API endpoint, per `actionType`'),
  openIn: z.enum(['self', 'new-tab']).optional()
    .describe('For a `url` action: `self` navigates in place, `new-tab` opens a new browser tab'),
  method: z.string().optional().describe('HTTP method for an `api` action, forwarded to the runner'),
  bodyExtra: z.unknown().optional().describe('Static request-body fields for an `api` action, forwarded to the runner'),
  bodyShape: z.unknown().optional().describe('How an `api` action shapes its request body, forwarded to the runner'),
  operation: z.unknown().optional().describe('Declarative single-record write, forwarded to the runner together with `patch`'),
  patch: z.unknown().optional().describe('Field values the declarative `operation` writes, forwarded to the runner'),
  confirmText: z.string().optional().describe('Confirmation question asked before the action runs'),
  successMessage: z.string().optional().describe('Toast shown when the action succeeds'),
  errorMessage: z.string().optional().describe('Toast shown when the action fails, in place of the raw error'),
  refreshAfter: z.boolean().optional().describe('Refresh the surrounding data after the action runs'),
  locations: z.array(ActionLocationSchema).optional()
    .describe('Action locations, forwarded to the runner — the console uses them to tell a record-scoped action from an object-level one'),
  toast: z.unknown().optional().describe('Toast behaviour, forwarded to the runner'),
  resultDialog: z.unknown().optional().describe('One-shot result dialog for a value the response shows exactly once, forwarded to the runner'),
  onSuccess: z.unknown().optional().describe('Declared post-success navigation, forwarded to the runner'),
  objectName: z.string().optional()
    .describe('Object the action acts on, forwarded to the runner — the console dispatches to it instead of the page\'s object. Omit to act on the page\'s object'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ActionIconProps = z.input<typeof ActionIconPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on `visible` and `disabled` — the
 * bare-string arm of the condition union normalizes to the canonical
 * `{ dialect, source }` envelope (`EvaluatedExpressionInputSchema`'s transform).
 */
export type ActionIconPropsParsed = z.infer<typeof ActionIconPropsSchema>;

/**
 * The member list `action:group` and `action:menu` both read — a LIST, as the
 * renderers read it (`schema.actions || []`, then `.filter` / `.map`). Both
 * registrations published the input as `type: 'object'` through `db11afd49`;
 * since objectui#11168 slice 1 both publish `type: 'array', of: 'object'`, the
 * shape declared here.
 *
 * Each member is an action object the container draws and runs ITSELF, never
 * through `SchemaRenderer`, so a member is not a page component and this row
 * does not judge its keys: the members' value contract is the runner's. What
 * the containers read off a member, at the pin: `visible` / `disabled` /
 * `enabled`, `icon`, `variant`, `className`, `label` (falling back to `name`),
 * `tags` (a `separator-before` tag draws a divider), `name` (the React key) and
 * the runner forward — which hands the runner the member's own `type`, not
 * `actionType` (a member is an action entry, and an action entry's executor is
 * `type`), its `objectName`, and its static values off the member's OWN
 * `properties.params`, evaluated by the container
 * (`readMemberStaticParamValues`, `static-params.ts:142-148`). A bare string
 * is refused here: an action NAME list is `record:quick_actions`'
 * `actionNames`, and a string member would render as an unlabeled button that
 * runs nothing.
 */
const actionMemberList = () => z.array(z.record(z.string(), z.unknown()));

/**
 * `action:group` — a row or dropdown of actions
 * (`components/src/renderers/action/action-group.tsx` at the pin). Read
 * points, per key:
 *
 * - `actions` — `:303`, then filtered by `location` through `actionRendersAt`
 *   (`:304`); members are read at `:114-171` (inline), `:205-243` (dropdown),
 *   both through the shared `useMemberVisible` for `visible` (`:81-86`), and
 *   forwarded at `:329-379` (static values `:329-335`, `objectName`
 *   `:378`).
 * - `display` — `:401`, `inline` unless it is `dropdown`.
 * - `label` / `icon` — `:421` / `:405`: the DROPDOWN trigger's text (default
 *   `Actions`) and icon. Inline mode renders neither.
 * - `variant` — `:411` (dropdown trigger) and `:453` (each inline member's
 *   fallback); no `primary` mapping at group level, so the primitive's six.
 * - `size` — `:412` maps `md` → `default` for the dropdown trigger, but `:454`
 *   hands the group size to each inline member raw, and `:124` maps only a
 *   member's OWN `md`. So `md` renders only in dropdown mode, and in the
 *   default inline mode reaches the Button primitive, which has no `md`.
 *   Declared: the primitive's four sizes. (Since objectui#11168 the
 *   registration publishes those same four, `:484-525`; through `db11afd49`
 *   it published `sm` / `md` / `lg`. A stored `md` is still mapped in
 *   dropdown mode only, which objectui records as a back-compat read.)
 * - `visible` — `:290` + `:398`; `:290` fails CLOSED on a faulting predicate
 *   since objectui#11212. `:398` tests the raw value's truthiness, so a
 *   literal `false` is honoured by `SchemaRenderer`'s node gate, which also
 *   evaluates the hoisted value, rather than by this check.
 *
 * ⚠️ New at this pin, and NOT a key of this row: objectui#11182 has the group
 * consume the host's EVALUATED `disabled` verdict by name (`:274`), the one
 * `SchemaRenderer`'s generic enablement gate computes from a hoisted
 * `disabled` on any node, and apply it to every inline member (`:159`) or to
 * the dropdown trigger (`:415`). So a `properties.disabled` on this block now
 * greys it out at render while this strict row refuses the key at save. The
 * row stays as measured from the block's own reads: declaring the key is a
 * contract decision, not a pin re-measure.
 *
 * NOT read: the group's own `name`. The renderer never reads `schema.name`,
 * and inline mode only spreads it onto the wrapping `<div>` as a DOM
 * attribute. The registration published it through `db11afd49` (`:415`
 * there); objectui#11168 stopped publishing it because nothing reads it and
 * this row refuses it (`action-group.tsx:40-42`). Refused with a
 * prescription, the `page:accordion` item `value` precedent: an author
 * copying an older designer's output is told what happened rather than
 * merely refused.
 */
export const ActionGroupPropsSchema = lazySchema(() => strictObject({
  surface: 'this `action:group`',
  history: actionBlockHistory('action:group'),
  guidanceSets: [COMPONENT_NODE_KEYS_GUIDANCE],
  aliases: { visibleWhen: 'visible', visibility: 'visible' },
  guidance: {
    name: '`action:group` reads no group-level `name` — nothing renders, forwards or keys on it. '
      + 'Each member action\'s own `name` is what identifies it. Remove the key.',
  },
}, {
  actions: actionMemberList().optional()
    .describe('The actions in this group, in order — each an action object the group draws and runs itself (`name`, `label`, `icon`, `type`, `target`, `visible`, `disabled`, …); a member\'s executor is its `type`'),
  display: z.enum(['inline', 'dropdown']).optional()
    .describe('Display mode: `inline` renders every action as a button row; `dropdown` renders one trigger button and lists the actions in its menu (renderer default: `inline`)'),
  location: ActionLocationSchema.optional()
    .describe('Render only the members whose `locations` include this location. Omit to render every member'),
  label: z.string().optional()
    .describe('Dropdown trigger text (renderer default: `Actions`). Inline mode renders no group label. A literal string — localize through the translation bundle entry for this component id'),
  icon: z.string().optional()
    .describe('Lucide icon name on the dropdown trigger. Inline mode renders no group icon'),
  variant: z.enum(BUTTON_PRIMITIVE_VARIANTS).optional()
    .describe('Button variant for the dropdown trigger and for every inline member that sets none — the Button primitive\'s vocabulary (renderer default: `outline`)'),
  size: z.enum(BUTTON_PRIMITIVE_SIZES).optional()
    .describe('Button size for the dropdown trigger and for every inline member that sets none — the Button primitive\'s vocabulary'),
  visible: actionCondition().optional()
    .describe('Visibility predicate for the whole group — a boolean, a CEL string, or a `{ dialect, source }` envelope, evaluated against the row the host binds. Omit for always-visible'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ActionGroupProps = z.input<typeof ActionGroupPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on `visible` — the
 * bare-string arm of the condition union normalizes to the canonical
 * `{ dialect, source }` envelope (`EvaluatedExpressionInputSchema`'s transform).
 */
export type ActionGroupPropsParsed = z.infer<typeof ActionGroupPropsSchema>;

/**
 * `action:menu` — a dropdown ("more") menu of actions
 * (`components/src/renderers/action/action-menu.tsx` at the pin). Read
 * points, per key:
 *
 * - `actions` — `:339`; members are read at `:80`, `:108-147` and `:405`, run
 *   through `ActionAutoTrigger` (`:360-367`), and forwarded at `:264-325`
 *   (static values `:264-270`, `objectName` `:324`).
 * - `label` — `:386` (`aria-label`, default: the translated "More actions")
 *   and `:395-396` (trigger text; icon-only when omitted).
 * - `icon` — `:240`, default the `MoreHorizontal` glyph.
 * - `variant` / `size` — `:241` / `:242`, handed to the Button primitive
 *   unmapped (defaults `ghost` / `icon`): no `primary`, no `md` here.
 * - `visible` — `:235` + `:333`, fail-closed; the same truthiness note as
 *   `action:group`'s applies to a literal `false`.
 *
 * The registration's `inputs` (`:432-460`) publish `label`, `icon`,
 * `actions`, `variant`, `size`, `visible` and `className` since objectui#11168
 * slice 1, every key this row declares; through `db11afd49` (`:410-419`
 * there) `size` and `visible` were read and unpublished. ⚠️ As on
 * `action:group`, objectui#11182 has the trigger consume the host's evaluated
 * `disabled` verdict (`:219`, `:385`) — at `db11afd49` it already reached the
 * trigger through the `...rest` spread — so a `properties.disabled` here greys
 * the trigger out while this row refuses it; recorded, not declared.
 */
export const ActionMenuPropsSchema = lazySchema(() => strictObject({
  surface: 'this `action:menu`',
  history: actionBlockHistory('action:menu'),
  guidanceSets: [COMPONENT_NODE_KEYS_GUIDANCE],
  aliases: { visibleWhen: 'visible', visibility: 'visible' },
}, {
  actions: actionMemberList().optional()
    .describe('The menu\'s actions, in order — each an action object the menu draws and runs itself (`name`, `label`, `icon`, `type`, `target`, `visible`, `disabled`, `tags`, …); a member\'s executor is its `type`'),
  label: z.string().optional()
    .describe('Trigger text and accessible label; omit for an icon-only trigger labelled "More actions". A literal string — localize through the translation bundle entry for this component id'),
  icon: z.string().optional()
    .describe('Lucide icon name on the trigger (renderer default: the horizontal ellipsis)'),
  variant: z.enum(BUTTON_PRIMITIVE_VARIANTS).optional()
    .describe('Trigger button variant — the Button primitive\'s vocabulary (renderer default: `ghost`)'),
  size: z.enum(BUTTON_PRIMITIVE_SIZES).optional()
    .describe('Trigger button size — the Button primitive\'s vocabulary (renderer default: `icon`)'),
  visible: actionCondition().optional()
    .describe('Visibility predicate for the whole menu — a boolean, a CEL string, or a `{ dialect, source }` envelope, evaluated against the row the host binds; a predicate that fails to evaluate hides it. Omit for always-visible'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ActionMenuProps = z.input<typeof ActionMenuPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on `visible` — the
 * bare-string arm of the condition union normalizes to the canonical
 * `{ dialect, source }` envelope (`EvaluatedExpressionInputSchema`'s transform).
 */
export type ActionMenuPropsParsed = z.infer<typeof ActionMenuPropsSchema>;

/**
 * `element:definition-list` — a compact key/value `<dl>`
 * (`components/src/renderers/basic/data-list.tsx` at the pin). Props are read
 * through `readProps` (`:42-47`, `properties` first). Read points: `items`
 * (`:48`), `columns` (`:49`), `inline` (`:63`), and per item `term` (`:66`) and
 * `description` (`:68`).
 *
 * - `columns` is compared as the NUMBER `2` (`props.columns === 2`); any other
 *   value renders one column. Declared as the literal pair `1 | 2`, which is
 *   what the Studio designer writes (a `number` control,
 *   `previews/block-config.ts:307`). The registration's enum publishes the
 *   STRINGS `'1'` / `'2'` (`:82`), and the string `'2'` renders one column —
 *   the read wins.
 * - `items` is optional, as it is read: absent and empty both render the
 *   renderer's own "No details" state (`:51-53`). The registration marks it
 *   required.
 * - An item is strict. `term` is required — it is the row's only label, placed
 *   as a React child, so a literal string — and `description` takes any value
 *   (`toText` prints objects as JSON and an absent one as an em dash). The
 *   designer wrote `label` / `value` items until objectui#8279 and every row
 *   rendered blank; that is the mistake an item that refuses unknown keys
 *   stops at authoring time.
 */
export const ElementDefinitionListPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:definition-list`',
  history: elementListHistory('element:definition-list'),
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  items: z.array(strictObject({
    surface: 'this `element:definition-list` item',
    history: elementListHistory('element:definition-list'),
    // The objectui#8279 pair: the designer wrote `label` / `value` items, and
    // every row rendered a blank term and an em dash.
    aliases: { label: 'term', value: 'description' },
  }, {
    term: z.string().describe('The term — rendered as the row\'s label, as-is'),
    description: z.unknown().optional()
      .describe('The value shown under (or beside) the term — a string or number as-is, an object as JSON; omitted renders an em dash'),
  })).optional()
    .describe('Term/description pairs, in order. Omitted or empty renders the "No details" empty state'),
  columns: z.literal([1, 2], {
    // The registration's own enum spells these as strings, so the string is
    // the likeliest wrong value — and the one the renderer silently collapses
    // to a single column.
    error: (issue) => (issue.input === '1' || issue.input === '2'
      ? `\`columns\` on this \`element:definition-list\` takes the NUMBER \`${String(issue.input)}\`, not `
        + `the string '${String(issue.input)}' — the renderer compares it to the number 2, so the string `
        + `renders a single column. Write \`columns: ${String(issue.input)}\`.`
      : undefined),
  }).optional()
    .describe('Grid columns from the small breakpoint up — the NUMBER `1` or `2` (renderer default: 1)'),
  inline: z.boolean().optional()
    .describe('Put each term and its description on one baseline-aligned row instead of stacking them'),
}));
/**
 * Author state (ADR-0122). No `XParsed`: the tree carries no default, transform,
 * catch or pipe, so the two shapes coincide and the schema is pinned isomorphic in
 * `type-alias-convention.pin.test.ts` instead.
 */
export type ElementDefinitionListProps = z.input<typeof ElementDefinitionListPropsSchema>;

/**
 * `element:repeater` — a data-bound, chrome-free list: one line per record
 * (`components/src/renderers/basic/data-list.tsx` at the pin, props through
 * `readProps`, `:97-107`). Read points: `object` (`:143`, `:155`), `filter`
 * (`:120`, `:152` → `$filter`), `sort` (`:153` → `$orderby`), `limit` (`:154` →
 * `$top`), `emptyText` (`:181`), `divided` (`:186`), `titleField`
 * (`:191-192`) and `fields` (`:128`, `:194-196`).
 *
 * - `object` is REQUIRED, as `element:number`'s is: without it the renderer
 *   never queries and shows its "No records" state (`:143-146`, `:181`) —
 *   indistinguishable from an object that really has no rows. The
 *   registration marks it required too.
 * - `filter` / `sort` are the family's one orthography from birth —
 *   `ViewFilterRule[]` and `SortItem[]` — and both are delivered:
 *   `ObjectStackAdapter.find` lowers a `{ field, operator, value }` array
 *   through `translateFilterArray` and serializes `{ field, order }` items
 *   through `serializeOrderBy` (`data-objectstack/src/index.ts:4782-4793`,
 *   `:760-786`). Before the query the renderer resolves the rules' context
 *   tokens (`{current_user_id}`, the date macros) through `useResolvedFilter`
 *   (`data-list.tsx:119-120`), so a rule's string `value` may be one. The
 *   rule-array door here is the bare one `record:related_list` declares, not a
 *   `ruleArrayFilterError` door: that prescription speaks to a door that used
 *   to take the record form, and a door wired to it joins the stored-row
 *   conversion's reach (`conversions/registry.ts`), which is not this row's to
 *   change.
 * - `fields` takes a bare field name or `{ field }`. The renderer reads only
 *   `field` off the object form (`:196`) — the `label` its TS type and its
 *   registration's description both advertise is never rendered (the list has
 *   no header row), so it is refused with that reason.
 *
 * NOT read at the pin, whatever a sibling might suggest: the node-level
 * `dataSource` binding. This renderer is not wrapped in objectui's
 * element-data-source gate, so the query keys above are the only way to aim it.
 */
export const ElementRepeaterPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:repeater`',
  history: elementListHistory('element:repeater'),
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  // The same four query keys the element data-source binding declares, with
  // its spellings for them (`ElementDataSourceSchema`, page.zod.ts), plus the
  // `object-*` family's `objectName`.
  aliases: {
    objectName: 'object', filters: 'filter', where: 'filter',
    orderBy: 'sort', sortBy: 'sort', top: 'limit', pageSize: 'limit',
  },
}, {
  object: z.string()
    .describe('Object whose records the list repeats over — required: without it the list never queries'),
  titleField: z.string().optional()
    .describe('Field shown first on each line, emphasized'),
  fields: z.array(z.union([
    z.string(),
    strictObject({
      surface: 'this `element:repeater` field',
      history: elementListHistory('element:repeater'),
      guidance: {
        label: '`label` is not rendered — the repeater has no header row and prints only each '
          + 'field\'s value. Remove it, or write the bare field name.',
      },
    }, {
      field: z.string().describe('Field name'),
    }),
  ])).optional()
    .describe('Fields shown after the title on each line, in order — a bare field name, or `{ field }`'),
  filter: z.array(ViewFilterRuleSchema).optional()
    .describe('Filter rules narrowing the records — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` in this map shares'),
  sort: z.array(SortItemSchema).optional()
    .describe('Sort order — `[{ field, order }]`'),
  limit: z.number().int().positive().optional()
    .describe('Maximum records fetched and shown'),
  emptyText: z.string().optional()
    .describe('Copy shown when the query returns no records (renderer default: "No records"). A literal string — localize through the translation bundle entry for this component id'),
  divided: z.boolean().optional()
    .describe('Draw a separator between lines (renderer default: true)'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ElementRepeaterProps = z.input<typeof ElementRepeaterPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on exactly one
 * key — `filter` carries `ViewFilterRuleSchema`, whose `operator` is
 * normalized on parse (why `ViewFilterRuleParsed` exists), the route
 * `element:number` and `element:record_picker` took.
 */
export type ElementRepeaterPropsParsed = z.infer<typeof ElementRepeaterPropsSchema>;

/**
 * ----------------------------------------------------------------------
 * 5. Object-bound SDUI blocks (#7751, maintainer ruling 2026-08-12: direction A)
 * ----------------------------------------------------------------------
 *
 * The `object-*` family — the platform's data-bound authoring surface — was
 * absent from this map, so the #5068 authoring gate had no schema to dispatch
 * and SKIPPED every node (the silent skip is a required semantic, not
 * leniency — `packages/lint/src/validate-component-props.ts`, module header).
 * The live cost was #7750: `object-grid` authored `filters:` (plural) where
 * the renderer reads `filter`, the wire carried no `$filter`, and a personal
 * work queue listed every row with a success receipt.
 *
 * KEY SETS ARE DERIVED FROM THE RENDERERS' OWN READ POINTS — measured against
 * an objectui checkout at `eb7f586b`, per-block citations below — never from
 * the designer palette or the registry `inputs` alone. Both of those have
 * published keys with zero read points (`object-grid` `striped`/`bordered`,
 * `object-kanban` `groupField` — the objectui#3829 / #7973 class), and
 * re-declaring one here would recreate the declared-but-inert trap this
 * section exists to close. The registry-declared `inputs` of each block are a
 * strict SUBSET of its declared set here, so `check:react-declaration-parity`
 * reports zero `registry-only` drift on these blocks; the surplus is
 * `spec-only`, the soft signal ADR-0082 §2 expects (the palette is a curated
 * subset). That existing gate — not a new one — carries the spec↔objectui
 * parity burden going forward (the ruling's third point).
 *
 * VALUE posture, first step: the #7750 class is a KEY typo, so keys are the
 * contract here. Value schemas are deliberately conservative — scalars and
 * enums only where renderer, registry and designer agree; `z.unknown()` where
 * the value contract still lives in objectui (filter shapes, column defs,
 * grouping configs). Tightening values is a later ratchet with its own
 * inventory, exactly like the #5068 → #4001-batch-A sequence above.
 *
 * The warning→error upgrade is untouched by this section: findings on these
 * entries are advisory, still gated on the #5068 inventory (the ruling:
 * 「warning 层先行,error 升级仍以 inventory 为闸,本裁定不改那个闸」).
 *
 * Deliberately NOT declared, each with its reason:
 *
 *  - `object-chart` gets NO entry yet. Its authored vocabulary is two-layered
 *    (`chartType` on the SDUI node vs `type` in `ChartConfigSchema`; corpus
 *    pages author `dataset`/`dimensions`/`values` that `ObjectChart.tsx` reads
 *    while the rest of the bag spreads into the generic chart component), so
 *    its key set is not derivable with the confidence the rest of this section
 *    meets. A partial entry would warn on working keys — worse than the
 *    status-quo skip. It stays silently skipped, like every other unregistered
 *    type.
 *  - `bind` (read by grid/kanban/chart via objectui's `useDataScope`) is an
 *    objectui data-scope key, not spec page vocabulary — the spec's binding is
 *    the component-level `dataSource` (ADR-0089 / #6953). Declaring it here
 *    would fossilize a non-spec spelling into the contract.
 *  - Callbacks (`onNavigate`, `onSuccess`, `onCardMove`, `submitHandler`, …)
 *    and host-injected props (`objectFields`, adapter-shaped `dataSource`) are
 *    not authorable metadata.
 */

/**
 * What silently happened to a typo'd key on an `object-*` block before #7751 —
 * the history line each of this section's rejections carries. Distinct from
 * {@link PROPS_HISTORY}: these types were not merely strip-mode, they were
 * absent from the map entirely, so even the #5068 gate said nothing.
 */
const objectBlockHistory = (type: string) =>
  `Until this type was added to ComponentPropsMap, \`${type}\` had no entry there at all, so `
  + 'the authoring gate skipped it: a misspelled key inside `properties` parsed clean, was '
  + "stored, reached objectui's renderer and was ignored there (`filters` for `filter` silently "
  + 'unfiltered a personal work queue, with a success receipt).';

/**
 * The plural `filters` never had a read point on any `object-*` renderer —
 * `ObjectNavItem.filters` and the react-tier `ListView.filters` declare the
 * plural, so an author moving between tiers switches spelling with no signal
 * (#7750's actual mechanism). Shared by every block that reads `filter`, so
 * the alias cannot drift per block. objectui#4041 retired the plural from the
 * `object-grid` registry declaration; this is the spec-side half.
 */
const FILTERS_TO_FILTER = { filters: 'filter' } as const;

/**
 * A page size — a positive integer, and nothing else.
 *
 * ONE spelling for a rule the rest of this package already carries, so the
 * component arm cannot drift from it again: `PaginationConfigSchema`
 * (`view.zod.ts`) declares `pageSize: z.number().int().positive()` and
 * `pageSizeOptions: z.array(z.number().int().positive())`; `MetadataQuery`
 * (`kernel/metadata-plugin.zod.ts`) and the two marketplace request schemas
 * (`marketplace/marketplace.zod.ts`) say `z.number().int().min(1)`. Each of
 * those pins its own refusal of `0` by name. Until #19046 the `object-grid`
 * door below said `z.number()` and `z.unknown()`, and was the only
 * page-size declaration in the package that accepted `0`.
 */
const GridPageSizeSchema = z.number().int().positive();

/**
 * `object-grid` (objectui `plugin-grid/src/ObjectGrid.tsx` @ `eb7f586b`).
 * Read points per key: `objectName` (throughout), `columns`/`fields` (:714-715),
 * `filter` (:739, lowered via `toFilterNode` to `$filter`), `defaultFilters`
 * (:922 — the LEGACY fallback read only when `filter` is absent; it is read,
 * so it stays declared — only the plural `filters` has zero read points),
 * `sort` (:741) / `defaultSort` (:943 — RETIRED #11805, tombstoned below;
 * objectui#5861 retires the read), `pagination`/`pageSize`/`showPagination`
 * (:567, :752, :2475-2480), `searchableFields`/`showSearch` (:959, :2484-2486),
 * `rowHeight` (:549), `grouping`/`aggregations` (:1076, :1136), `rowColor`
 * (:1052), `conditionalFormatting` (:884, :1061), `selection`/`selectable`
 * (:2186-2190), `rowActions` (:1927), `batchActions`/`bulkActions` (:2150),
 * `bulkActionDefs` (:2165), `navigation` (:1032), `editable`/`singleClickEdit`
 * (:2597, :2632), `resizable`/`resizableColumns` (:2598), `reorderableColumns`
 * (:2599), `frozenColumns` (:2135), `showColumnTypeIcons` (:1296 …),
 * `exportOptions`/`operations` (:1697-1721), `label`/`title` (:1732, :2557),
 * `data`/`staticData` (:372, :386).
 *
 * [#20694] Three keys measured later, at the `.objectui-sha` pin
 * `db11afd4967c` (objectui#11130's merge commit), in the same file:
 * `description` (:5677, `resolveInlineI18nLabel(schema.description,
 * displayLocale)`, drawn above the rows at :5784 / :6303 / :6342) and
 * `emptyState` (:6225, drawn through `DataEmptyState` at :6233). The third,
 * `keyboardNavigation`, has NO read point at that pin — zero hits under
 * objectui `packages/` and `apps/` outside tests, CHANGELOGs, READMEs and
 * `packages/types` (its type declaration and zod twin), against 3 hits for the
 * control `schema.editable` in `ObjectGrid.tsx`. It is declared ahead of its
 * reader on purpose (the BUILD objectui#11068 chose), and its describe carries
 * the `[EXPERIMENTAL — not enforced]` marker that says so; see the member.
 */
export const ObjectGridPropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-grid`',
  history: objectBlockHistory('object-grid'),
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  aliases: FILTERS_TO_FILTER,
}, {
  objectName: z.string().optional()
    .describe('Object this grid binds to. Optional because the component-level `dataSource` binding can supply the object instead'),
  label: I18nLabelSchema.optional().describe('Grid label — used as the table caption and export file title'),
  title: I18nLabelSchema.optional().describe('Fallback for `label` (the renderer reads `label || title`)'),
  /**
   * [#20694] One line of help text above the grid's rows, in the treatment
   * `ListView` gives a view's description. Read at the pin `db11afd4967c`
   * (`ObjectGrid.tsx:5677`) through `resolveInlineI18nLabel` against the
   * display locale, exactly as `label` is, so both `I18nLabel` forms draw; a
   * locale map with no usable entry draws no strip. Drawn by every branch that
   * draws rows — the card view, the split pane and the table.
   */
  description: I18nLabelSchema.optional()
    .describe('One line of help text drawn above the grid\'s rows — a string, or an inline locale map resolved against the display locale'),
  /**
   * [#20694] What the grid draws INSTEAD of an empty table — the list view's
   * own {@link EmptyStateSchema}, by reference (triage's direction: ⛔ not a
   * second shape). Read at the pin `db11afd4967c` (`ObjectGrid.tsx:6225`),
   * drawn through the shared `DataEmptyState` and `resolveIcon` that `ListView`
   * draws a list's empty state with, and only when the grid holds no row to
   * draw (no group, when grouped), nothing is loading, and the grid's own
   * search box is not what emptied it. A member left out keeps the grid's
   * default: the shared glyph, the table's "No results found" heading, no
   * message line.
   *
   * ⚠️ Measured at that pin: `title` and `message` reach `DataEmptyState` as
   * they are (`:6241-6242`), with no locale-map resolution, unlike
   * `description` above. So of the two `I18nLabel` forms this shared shape
   * declares, the grid draws the plain string only — an inline locale map is
   * handed to React as a child, which throws (measured on react 19.2.8:
   * "Objects are not valid as a React child"). That is a renderer gap on the
   * objectui side, not a second shape here: the list view door declares the
   * same members, and objectui's grid follows this declaration.
   */
  emptyState: EmptyStateSchema.optional()
    .describe('What the grid draws instead of an empty table: `{ title, message, icon }` — the list view\'s own empty-state shape'),
  columns: z.array(z.unknown()).optional()
    .describe('Columns: field names or column definition objects'),
  fields: z.array(z.unknown()).optional()
    .describe('Field list fallback used when `columns` is absent'),
  /**
   * Base query filter — the `ViewFilterRule` ARRAY form,
   * `[{ field, operator, value }, ...]`, the one filter orthography every
   * `filter` door in this map shares (ui#6206-B; reached the four `object-*`
   * doors and the binding-level `dataSource.filter` on #15442 / #15449,
   * decision batch #55, verbatim 「同意」, option A: family-wide). The
   * `z.unknown()` this door carried was a read-point record written twelve
   * days before that ruling (#7751), not an exception to it: it accepted the
   * MongoDB-style record, the AST tuple array and the rule array alike, so
   * an author following the showcase and an author following the manifest
   * each got a silent success receipt for a different shape. Measured at the
   * objectui pin `53ded82b` before the declaration moved: `ObjectGrid.tsx`
   * lowers `schema.filter` through `toFilterNode`, whose rule-array arm maps
   * each rule to an AST node before `$filter` — the door every saved view's
   * stored rules already take. The record and tuple forms are refused at
   * `filter`; the migration prescription is the
   * `element-data-source-and-object-block-filter-rule-array` semantic entry.
   */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `object-grid`',
      migration: 'element-data-source-and-object-block-filter-rule-array',
    }),
  }).optional()
    .describe('Base query filter — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` door in this map shares; lowered to the wire `$filter`. THE key, singular — not the plural misspelling. The MongoDB-style record form is refused — see migration `element-data-source-and-object-block-filter-rule-array`'),
  /**
   * [#19514] The legacy base-filter fallback — the SAME value in the SAME role
   * as `filter` above, so it carries the same declaration.
   *
   * Its own description has said "read only when `filter` is absent" since the
   * key entered this map (#7751), which is a statement that the two keys hold
   * one kind of value: objectui's `ObjectGrid` reads this one through the same
   * lowering sink it reads `filter` through, so every refusal that sink can
   * give is reachable from a document that passed the protocol. While `filter`
   * was narrowed to the rule array and this stayed `z.unknown()`, the block had
   * a declared door and an undeclared one onto the same seam — a bare string, a
   * number, a MongoDB-style record and an ObjectQL AST tuple array all parsed
   * here, and the author's receipt said nothing about what the grid would do
   * with them. At the objectui `.objectui-sha` pin `87af769e9a`
   * (`ObjectGrid.tsx` → `toFilterNode`) that depends on the shape: the record
   * form and the tuple array are lowered and APPLIED as declared; a bare string
   * or a number is DROPPED, so the grid sends no filter and lists its rows
   * unfiltered; and a list of malformed rules is REFUSED — on the wire with
   * 400 `INVALID_FILTER`, or by the client before any request for the value
   * shapes it judges itself.
   *
   * ⛔ **Narrowed, NOT retired.** Refusing the key outright is the other arm this
   * could have taken and it is a REMOVAL of an accepted shape, which needs its
   * own ruling. The deprecation stated in the description stands
   * exactly where it stood — prefer `filter` — and is unchanged by this.
   *
   * The `{ error }` map is `filter`'s, deliberately: an author who wrote the
   * record form here needs the same conversion table, computed from their own
   * keys, and a second hand-written sentence at this door is the drift
   * `ruleArrayFilterError` exists to prevent. Its `surface` names which key was
   * written, because the message's own subject is `filter`.
   */
  defaultFilters: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `object-grid` (you wrote it on the `defaultFilters` fallback, which takes the same form)',
      migration: 'object-grid-default-filters-rule-array',
    }),
  }).optional()
    .describe('Legacy base-filter fallback, read only when `filter` is absent — the SAME ViewFilterRule array form `[{ field, operator, value }, ...]` as `filter`, lowered through the same sink. Prefer `filter`. The MongoDB-style record form, a bare string and an ObjectQL AST tuple array are refused — see migration `object-grid-default-filters-rule-array`'),
  /**
   * Initial row order — the `SortItem` ARRAY form, `[{ field, order }, ...]`,
   * the one sort orthography every DECLARED `sort` door on this platform
   * carries: `ElementDataSourceSchema.sort` and `ListPageSchema.sort`
   * (page.zod.ts) and `element:record_picker`'s flat shorthand above. One
   * shared schema rather than a third copy — all of them are
   * `SortItemSchema`, already imported at the top of this file for the picker.
   *
   * objectui#8221, decision batch #77, 2026-09-07, maintainer verbatim
   * 「其他同意」, option B: one `sort` spelling, the array; the legacy string
   * clause is retired from `@object-ui/core`. Item 4 of that ruling is this
   * declaration and `object-calendar`'s below — 「`ComponentPropsMap` for
   * `object-calendar` and `object-grid` constrains the `sort` value to the
   * array shape (today it accepts anything), so the spec, the registrations
   * and the helper agree; that is a pull-back to the declared contract,
   * ordinary tier」.
   *
   * The `z.unknown()` this door carried was a read-point record (#7751), the
   * same vintage as its `filter` neighbour above and not an exception to the
   * ruling: it receipted an array, a string and a bare NUMBER alike with
   * `success: true`, while `plugin-grid/src/index.tsx:222` has published
   * `type: 'array'` all along — so the html tier answered `type-mismatch` on a
   * value this schema had just accepted.
   *
   * Sequenced measurement-first, as this family has to be. Measured at the
   * objectui pin `53ded82b`: `ObjectGrid.tsx:1457` reads `schema.sort` and the
   * fetch path at `:1844-1851` carries an explicit `typeof === 'string'` arm
   * putting the clause on `$orderby` verbatim, beside the array arm that folds
   * `[{ field, order }]` onto the same parameter. ⚠️ At THIS pin the string is
   * therefore still lowered, and this door refuses a spelling the pinned
   * renderer honours — the ruled sequence, not an oversight: objectui#8221's
   * PR objectui#8758 (merged 2026-09-09, after this pin) drops the string arm from
   * `convertSortToQueryParams`, and the next pin bump carries it in. The array
   * is the spelling both ends already agree on today; the header-arrow read at
   * `:3998` hands `schemaSort` to `parseSchemaSort` as `TableSortItem[]`, the
   * array shape and not the string.
   */
  sort: z.array(SortItemSchema).optional()
    .describe('Initial row order — the SortItem array form `[{ field, order }, ...]`, the one sort orthography every declared `sort` door on this platform shares; lowered to the wire `$orderby`. The legacy string clause (`name desc`) is refused — see migration `object-block-sort-item-array`'),
  /**
   * REMOVED (#11805, maintainer ruling 2026-08-25, decision-inbox batch 4:
   * 「#11805 退役 defaultSort,不需要major」 — the ADR-0049 enforce-or-remove
   * half of the objectui#4869 「接受所有」 direction; objectui#5861 is the
   * consumer half).
   *
   * The legacy second spelling of `sort`: a SINGLE `{ field, order }` pair the
   * renderer read only when `sort` was absent — measured at the `.objectui-sha`
   * pin (`190fbd01d`), `plugin-grid/src/ObjectGrid.tsx:1244-1246` (fetch path,
   * `$orderby` fallback) and `:2847` (header arrows, where it is wrapped
   * `[schema.defaultSort]` — the exact array shape `sort` carries). One intent,
   * two spellings; only this repo's strictObject can refuse it (objectui's
   * mirror schema is parity-test-only and parses nothing at runtime), so the
   * retirement lands here and objectui#5861 retires the reads on its own
   * schedule, exactly as `page:card.body` left the renderer's `body ??`
   * fallback behind.
   *
   * The live mechanism is `sort` — the same pair, wrapped in an array. The
   * protocol-18 conversion `object-grid-default-sort-removed` carries the
   * mechanical rewrite (wrap-and-rename when `sort` is absent; a pure lossless
   * delete when `sort` is present, since the fallback was never read then).
   */
  defaultSort: retiredKey(
    '`object-grid` property `defaultSort` was removed in @objectstack/spec 17 (ADR-0049) — '
    + 'it was the legacy second spelling of `sort`: a single `{ field, order }` pair read only when '
    + '`sort` was absent, so one intent had two spellings and a grid authoring both silently ignored '
    + 'this one. Rename the key to `sort` and wrap the value in an array (`defaultSort: { field, order }` '
    + 'becomes `sort: [{ field, order }]`); the pair itself is unchanged. '
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  /**
   * Pagination config — the two members whose value is a PAGE SIZE bounded to
   * {@link GridPageSizeSchema}, the accept set the view arm has ruled all
   * along, and the bag itself left OPEN.
   *
   * The `z.unknown()` this door carried until #19046 was a read-point record
   * of the same #7751 vintage as its `filter` and `sort` neighbours above, and
   * it made the SAME authored member carry two accept sets, of which renderers
   * read the looser: `PaginationConfigSchema` refuses `pageSize: 0` and pins
   * that refusal by name ('should reject zero pageSize' / 'should reject zero
   * values in pageSizeOptions', `view.test.ts`), while this door receipted it
   * `success: true`. Measured at objectui#9853: an authored
   * `pagination.pageSize: 0` reached `ObjectGrid`, went out on the wire as
   * `$top: 0` and rendered ZERO ROWS, with no grouping needed to trigger it,
   * and it reached the renderer through THIS arm — the view arm would have
   * refused it. objectui#9896 repaired the consumer half (a resolver at every
   * read point); this is the declaration half.
   *
   * **`z.looseObject`, not `strictObject` — the bag stays open, deliberately.**
   * `PaginationConfigSchema` is itself closed, but reusing it here would
   * refuse every sibling key this door has accepted since it was written — the
   * `…` in its own describe says authors pass them — which is a wider
   * narrowing than the defect measured above and a different decision. So what
   * narrows is the accept set of a page size; what does NOT narrow is which
   * keys the bag may carry. `BuildProgressFrameSchema`
   * (`ai/build-progress.zod.ts`) is the house precedent for a floor-not-ceiling
   * shape, and `DashboardWidgetConfigSchema` for an open bag with declared
   * members.
   *
   * Read points measured at objectui `d18322415`: `ObjectGrid.tsx:1209` and
   * `:1628` read `(schema.pagination as any)?.pageSize ?? schema.pageSize`,
   * `:4179` reads `schema.pagination?.pageSize` and `:4359`
   * `schema.pagination?.pageSizeOptions` — those two are the only members any
   * read point on this door names, and the objectui registry has published
   * this input as `type: 'object'` all along (`plugin-grid/src/index.tsx:223`),
   * so a non-object value here was already answered `type-mismatch` one tier
   * down while this schema accepted it. `:4175` reads presence only
   * (`schema.pagination !== undefined ? true : …`), which is why an authored
   * `pagination: false` used to mean paging ON.
   */
  pagination: z.looseObject({
    pageSize: GridPageSizeSchema.optional(),
    pageSizeOptions: z.array(GridPageSizeSchema).optional(),
  }).optional()
    .describe('Pagination config ({ pageSize, pageSizeOptions, … }); its presence enables paging. `pageSize` and every `pageSizeOptions` entry is a positive integer — the accept set the view arm\'s `PaginationConfigSchema` already rules; the bag stays open, so other keys pass through unvalidated'),
  pageSize: GridPageSizeSchema.optional()
    .describe('Flat page-size shorthand, a positive integer; `pagination.pageSize` wins when both are set'),
  showPagination: z.boolean().optional().describe('Show the pager (read only when `pagination` is absent)'),
  searchableFields: z.array(z.string()).optional()
    .describe('Fields the toolbar search queries; a non-empty list enables search'),
  showSearch: z.boolean().optional().describe('Show the search box (read only when `searchableFields` is absent)'),
  rowHeight: z.unknown().optional().describe('Row density mode (e.g. compact / comfortable)'),
  /**
   * [#20831] The list view's own `GroupingConfigSchema`, by reference — ⛔ not
   * a copy of its shape. objectui types this key as the spec's
   * `GroupingConfig` and reads exactly its members: `grouping.fields[i].field`
   * (the group header query's `groupBy` column and the row projection),
   * `.order` and `.collapsed` (`useGroupedData`). Until #20831 it was
   * `z.unknown()`, so a padded field name — refused on `list-view` since
   * #17360 — or a value of the wrong shape validated green here and grouped
   * every row into one empty group. Judged the same way on every door now.
   */
  grouping: GroupingConfigSchema.optional().describe('Row grouping config'),
  aggregations: z.unknown().optional().describe('Group aggregation config (sum/avg/… per column)'),
  conditionalFormatting: z.unknown().optional().describe('Conditional row/cell formatting rules'),
  rowColor: z.unknown().optional().describe('Row color rules'),
  selection: z.unknown().optional().describe('Selection config ({ type: none | single | multiple })'),
  selectable: z.unknown().optional().describe('Legacy selection shorthand, read only when `selection` is absent. Prefer `selection`'),
  rowActions: z.array(z.unknown()).optional().describe('Per-row action names'),
  bulkActions: z.array(z.unknown()).optional().describe('Bulk action names shown on selection'),
  batchActions: z.array(z.unknown()).optional().describe('Alternate spelling the renderer reads FIRST (`batchActions ?? bulkActions`)'),
  bulkActionDefs: z.array(z.unknown()).optional().describe('Inline bulk-action definitions (full defs, not names)'),
  navigation: z.unknown().optional().describe('Row-click navigation config ({ mode: page | drawer | modal | split | popover | new_window | none }) — all seven `NavigationModeSchema` values, since the shared `useNavigationOverlay` hook types its own mode union as that schema'),
  editable: z.boolean().optional().describe('Enable inline cell editing'),
  singleClickEdit: z.boolean().optional().describe('Enter cell edit on single click (default true when editable)'),
  /**
   * [#20694] Declared AHEAD of its reader, deliberately: objectui#11068 chose
   * to BUILD arrow-key cell navigation for the grid, and this row is the spec
   * half triage folded in. At the pin `db11afd4967c` nothing reads it (see the
   * block docblock above for the measurement), so an authored value changes
   * nothing yet. The `[EXPERIMENTAL — not enforced]` marker in the describe is
   * the liveness ledger's own spelling for a declared-but-not-enforced key;
   * the `page/regions` container that holds page components is undrilled in
   * the ledger (`undrilled-containers.baseline.json`), so no ledger row exists
   * for any `ComponentPropsMap` key and the marker is the record. When the
   * BUILD lands and the grid reads it, drop the marker in the same change.
   */
  keyboardNavigation: z.boolean().optional()
    .describe('[EXPERIMENTAL — not enforced] Arrow-key cell navigation on the WAI-ARIA grid pattern. Defaults to on when `editable` is set; a read-only grid keeps its Tab behaviour unless this is `true`. No renderer reads it yet: it is declared ahead of the grid\'s keyboard-navigation build, so authoring it changes nothing today'),
  resizable: z.boolean().optional().describe('Allow column resize (read before `resizableColumns`)'),
  resizableColumns: z.boolean().optional().describe('Alternate spelling of `resizable` (the renderer reads `resizable ?? resizableColumns`)'),
  reorderableColumns: z.boolean().optional().describe('Allow column drag-reorder'),
  frozenColumns: z.number().optional().describe('How many leading columns stay frozen (default 1)'),
  showColumnTypeIcons: z.boolean().optional().describe('Show field-type icons in column headers'),
  exportOptions: z.unknown().optional()
    .describe('Export config ({ formats, maxRecords, includeHeaders, fileNamePrefix, streaming }). Unvalidated here (`z.unknown()`), so this list is the whole account of the shape; `ListViewSchema.exportOptions` declares the same five members with their per-member contract'),
  operations: z.unknown().optional().describe('Operation toggles ({ export: false, … })'),
  /**
   * Data source binding — `ViewDataSchema`, the #5090-pinned authority the
   * objectui registry declares against (`plugin-grid/src/index.tsx:225`
   * `type: 'object'`, held by `gridDataInputContract.test.ts`). Until the
   * ui#6207 ruling (2026-08-25, Option A: 「同意」) this entry said
   * `z.array(z.unknown())` — the bare-array spelling of the deprecated
   * `staticData` shortcut — so the two spec authorities refused each other's
   * legal values: this entry accepted `data: [{…}]` and refused
   * `{ provider: 'value', items: [] }`, while `ViewDataSchema` (what
   * `ObjectGridSchema.data` resolves to, and what the designer publishes)
   * ruled the opposite. Static inline rows live at
   * `{ provider: 'value', items: [...] }`; the migration prescription is the
   * `object-grid-data-view-data-converged` semantic entry.
   */
  data: ViewDataSchema.optional()
    .describe("Data source binding (ViewDataSchema — discriminated on `provider`: object | api | value | schema). Static inline rows live at `{ provider: 'value', items: [...] }`; the bare-array shortcut is refused — see migration `object-grid-data-view-data-converged`"),
  staticData: z.array(z.unknown()).optional().describe("Deprecated bare-array static-rows shortcut the renderer still reads. Prefer `data: { provider: 'value', items: [...] }`"),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectGridProps = z.input<typeof ObjectGridPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on exactly one
 * key — `data` carries `ViewDataSchema` (the ui#6207 convergence), whose own
 * input ≠ infer. So `object-grid` leaves the type-alias convention pin's
 * default-free family (the Iso839 line deleted with this alias), taking the
 * `RecordAlertPropsParsed` route its comment prescribes.
 */
export type ObjectGridPropsParsed = z.infer<typeof ObjectGridPropsSchema>;

/**
 * `object-metric` (objectui `plugin-dashboard/src/ObjectMetricWidget.tsx` @
 * `eb7f586b`). The widget destructures every prop it reads
 * (`ObjectMetricWidgetProps`, :40-110 — the complete read set), and the
 * registry shell forwards the authored bag onto it. `columns`/`sort`/`limit`
 * are deliberately absent — a metric is one aggregated number; the registry's
 * own `ElementDataSourceMapping` comment records that they have no read site.
 */
export const ObjectMetricPropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-metric`',
  history: objectBlockHistory('object-metric'),
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  aliases: FILTERS_TO_FILTER,
}, {
  objectName: z.string().optional()
    .describe('Object this metric aggregates. Optional because the component-level `dataSource` binding can supply the object instead'),
  label: I18nLabelSchema.optional().describe('Metric label'),
  description: I18nLabelSchema.optional().describe('Helper text under the value'),
  title: I18nLabelSchema.optional().describe('Drill-down panel title; defaults to the metric label'),
  /**
   * Metric tile icon, and the reason this key carries a docblock at all: its
   * describe used to read `Icon name (Lucide)` and nothing more — a sentence
   * equally true of `page:header`'s `icon`, which is REFUSED precisely because
   * no render path reads it. Vocabulary does not separate the two verdicts; a
   * read point does (#9397 closed premise-overtaken re-deriving one from
   * scratch; #9881/#9972 recorded the accordion and tab items). This is the
   * same record for the metric tile.
   *
   * The key is LIVE at the objectui pin this repo builds against
   * (`.objectui-sha` = `31971ff1e`; re-derived at that pin 2026-10-01 —
   * `plugin-dashboard/src/index.tsx`, `ObjectMetricWidget.tsx`,
   * `MetricWidget.tsx`, `MetricCard.tsx` and `lazy-icon.tsx` are all
   * byte-identical to `e420df310`, so every anchor below holds unmoved and was
   * re-read in place; they were byte-identical to `db11afd49` across the hop
   * onto `e420df310` (2026-09-30) as well. At `db11afd49` (2026-09-29)
   * `MetricWidget.tsx` and `lazy-icon.tsx` are byte-identical to `dd3f7e1be`;
   * `ObjectMetricWidget.tsx` changed in one comment line (`:321`), so `:230` and
   * `:595` did not move; `plugin-dashboard/src/index.tsx` gained the
   * per-locale-map `label` / `description` / `title` input declarations
   * (objectui#10993), all below the registration's start and above the icon
   * input, so the registration start `:227` did not move and the icon input MOVED
   * `:237` -> `:252` with its text byte-identical, still `{ name: 'icon', type:
   * 'string' }`. At `dd3f7e1be` (2026-09-28)
   * `MetricWidget.tsx` and `lazy-icon.tsx` are byte-identical to `f8a9d0fb0`
   * (`git diff --quiet`); `plugin-dashboard/src/index.tsx` changed (+2/-2: a
   * comment and the `drillDown` input's description, objectui `526fc1125`),
   * neither near the icon, so `:227` and `:237` did not move and were re-read
   * in place; `ObjectMetricWidget.tsx` changed (+84/-17: the currency count
   * tile, objectui `6dc82a381`, the invalidation bus, objectui#10572, and the
   * `drillDown` refusal, objectui `526fc1125`), and both its anchors MOVED
   * with their cited text byte-identical: the destructure `181` -> `230`, the
   * forward `528` -> `595`. On the hop onto `f8a9d0fb0`, `index.tsx`,
   * `MetricWidget.tsx` and `lazy-icon.tsx` were byte-identical to `62597c588`
   * and `87af769e9`, and `ObjectMetricWidget.tsx` changed (objectui
   * `0651e7ab4`, the currency tile's decimals, objectui#10221), its two
   * anchors MOVING with their cited text byte-identical: the destructure `174`
   * -> `181`, the forward `483` -> `528`. On the hop onto
   * `87af769e9` (re-derived 2026-09-20) EVERY file in the chain moved, so no
   * anchor was carried there and each was re-READ: the `object-metric`
   * registration now begins at `:227`
   * and its icon input lands on `:237`. ⚠️ One thing the numbers do not
   * carry: that input's `label: 'Icon (Lucide name)'` member is GONE — the
   * whole registration dropped its per-input labels — so the key is still
   * PUBLISHED to the designer, now as a bare
   * `{ name: 'icon', type: 'string' }`. The four render-path anchors moved
   * with their cited text byte-identical), and the chain
   * runs three files:
   * `plugin-dashboard/src/index.tsx:252` publishes it as a designer input
   * on the registered `object-metric` block;
   * `ObjectMetricWidget.tsx:230` destructures it and forwards it at `:595` to
   * `MetricWidget`; `MetricWidget.tsx:351-360` resolves it via
   * `getLazyIcon(icon)` — guarded on `typeof icon === 'string'`, because the
   * React prop also accepts a ready-made node — and `:412-421` draws it in the
   * tinted square whose colour comes from `colorVariant`.
   *
   * ⚠️ Do not re-anchor this to `MetricCard.tsx`. That sibling calls
   * `getLazyIcon` on line 83 and reads like the same read point, but nothing
   * on this key's path renders it (its heading key is `title`, this path's is
   * `label`), so a line cited from it describes a component this key never
   * reaches.
   *
   * Vocabulary is Lucide via the `LazyIcon` module
   * (`components/src/lib/lazy-icon.tsx:98-112`): kebab-case or PascalCase,
   * normalised to kebab-case, degrading to the `Database` glyph when the name
   * is not a real Lucide icon — the same slot the container icons use, and the
   * opposite failure mode from `element:button`'s `icon`, which takes the older
   * `icons`-map path and renders nothing at all on an unknown name.
   */
  icon: z.string().optional().describe(
    'Lucide icon name drawn in the metric tile header, inside the `colorVariant`-tinted square. Read on this component — `ObjectMetricWidget` forwards it to `MetricWidget`, which resolves it with `getLazyIcon` (the `LazyIcon` module: kebab-case or PascalCase, degrading to the `Database` glyph on an unknown name).',
  ),
  colorVariant: z.enum(['default', 'blue', 'teal', 'orange', 'purple', 'success', 'warning', 'danger'])
    .optional().describe('Icon container color variant'),
  aggregate: z.unknown().optional()
    .describe('Aggregation config ({ field, function, groupBy? }) run against the object'),
  /**
   * Filter the aggregation is scoped by — the `ViewFilterRule` ARRAY form,
   * the one filter orthography every `filter` door in this map shares (#15449,
   * the family entry above on `object-grid` carries the ruling). This door was
   * the one the family had to be sequenced behind: with `aggregate` the widget
   * posts the filter as the `where` of `POST /analytics/query`, whose request
   * schema takes only a `FilterCondition`, and at the pin `a472b07` the adapter
   * posted an array verbatim — a 400 on every array form (#15828). At the pin
   * this repo builds against (`53ded82b`, objectui#7754) the adapter lowers an
   * authored array through `translateFilterArray` and the spec's own
   * `parseFilterAST` sink before the wire (`lowerAnalyticsFilterForWire`), so
   * the rule array reaches the analytics door as the condition it declares;
   * `resolveFilterPlaceholders` walks arrays and objects alike, so the date
   * macros and `{current_user_id}` still resolve. The record form is refused
   * at `filter`; see migration
   * `element-data-source-and-object-block-filter-rule-array`.
   */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `object-metric`',
      migration: 'element-data-source-and-object-block-filter-rule-array',
    }),
  }).optional()
    .describe('Filter the aggregation is scoped by — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` door in this map shares. The MongoDB-style record form is refused — see migration `element-data-source-and-object-block-filter-rule-array`'),
  format: z.string().optional().describe("Number format pattern (e.g. '0,0', '$0,0', '0%')"),
  currency: z.string().optional().describe("ISO currency code (e.g. 'USD') — enables currency formatting"),
  prefix: z.string().optional().describe('Static prefix before the formatted value'),
  suffix: z.string().optional().describe('Static suffix after the formatted value'),
  invert: z.boolean().optional().describe('Display `1 - value` for opposite-signal gauges (compliance/uptime)'),
  variant: z.enum(['card', 'bare']).optional().describe('Layout variant'),
  fallbackValue: z.union([z.string(), z.number()]).optional()
    .describe('Static value shown when no data source is available'),
  trend: z.unknown().optional().describe('Static trend info ({ value, label, direction })'),
  drillDown: z.unknown().optional().describe('Click-through drill config — opens the underlying records'),
  compareTo: z.unknown().optional().describe("Period-over-period comparison ({ kind: 'previousPeriod' | 'previousYear' })"),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectMetricProps = z.input<typeof ObjectMetricPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on exactly one
 * key — `filter` carries `z.array(ViewFilterRuleSchema)` (the ui#6206-B family
 * convergence, #15449), whose own input ≠ infer (`operator` is normalized on
 * parse). So `object-metric` leaves the type-alias convention pin's default-free
 * family the way `object-grid` did, taking the `ObjectGridPropsParsed` route.
 */
export type ObjectMetricPropsParsed = z.infer<typeof ObjectMetricPropsSchema>;

/**
 * `object-kanban` (objectui `plugin-kanban/src/ObjectKanban.tsx` +
 * `KanbanRenderer` in `plugin-kanban/src/index.tsx` @ `eb7f586b` — the board
 * forwards the authored bag on). Read points: `objectName`/`groupBy`
 * (throughout), `columns` (:474 — SWIMLANES, `{ id, title }` per `groupBy`
 * value or bare strings, NOT a field projection), `filter` (:198, the
 * `$filter` handoff), `data` (:217-224), `cardTitle`/`titleField` (:233),
 * `cardFields` (:322), `swimlaneField`/`grouping` (:518-519), and via the
 * forwarded schema `coverImageField`/`conditionalFormatting` (`KanbanRenderer`,
 * index.tsx — `ObjectKanban.tsx:1563` spreads the authored bag into it).
 * `quickAdd` sat on that forwarded list and is RETIRED (#17260, tombstoned
 * below): the sentence was true about the FORWARD and false about the READ,
 * which is how the key kept re-authorizing itself. `groupField` is the
 * DESIGNER's spelling with
 * zero read points (#7973 class) — aliased to the `groupBy` the board reads.
 * `limit` (#16503) was measured later, at the pin this repo builds against
 * (`.objectui-sha` = `31971ff1e`; re-measured there 2026-10-01 —
 * `ObjectKanban.tsx` changed on this hop only in the comment above its
 * `navigation` read (+12/-14, objectui#8652: the key is now declared on
 * `ObjectKanbanSchema`), far below the anchor, which did not move and was
 * re-read in place. At `e420df310` (2026-09-30)
 * `ObjectKanban.tsx` changed on this hop, +40/-13: objectui#9853 renamed the
 * default `DEFAULT_KANBAN_LIMIT` to `DEFAULT_KANBAN_FETCH_BATCH_SIZE`, still
 * 100, on the anchor line itself, and objectui#11234 mounts an internal
 * `KanbanBoardCore` board. So the anchor was re-READ and MOVED `712` -> `722`,
 * now `$top: resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE)`:
 * the same lowering under a renamed default. At `db11afd49` (2026-09-29)
 * `ObjectKanban.tsx` changed in one comment line only (`:1367`), so the anchor
 * did not move and was re-read in place. At `dd3f7e1be` (2026-09-28)
 * `ObjectKanban.tsx` changed on this hop, +44/-8 (objectui#10572's
 * invalidation bus, objectui#10663's error reset, objectui#10666, which
 * resolves the filter's context tokens before `$filter` — the member one line
 * above this anchor — and a line-neutral comment sweep, objectui
 * `1dae95a41`), so the anchor was re-READ and MOVED `687` -> `712` with
 * its text byte-identical. On the hop onto `f8a9d0fb0` the file changed
 * +16/-1 (objectui#10068 added the binding's `sort` as the query's
 * `$orderby`) and the anchor MOVED `676` -> `687` with its text
 * byte-identical; the file was
 * byte-identical across the hop onto `62597c588`, and was re-READ at
 * `87af769e9` 2026-09-20: it moved hard on that hop, +708/-79 against `53ded82bf`,
 * and this anchor is one the
 * numbers alone would have mis-carried: the read was a bare
 * `$top: schema.limit ?? DEFAULT_KANBAN_LIMIT` at `:264` and is now
 * `$top: resolveRowLimit(schema.limit, DEFAULT_KANBAN_LIMIT)`, objectui#9925
 * having put a refusal in front of it — a contract-refused row cap is dropped
 * and reported at `:554` instead of being sent. The pinned fact is unchanged:
 * `schema.limit` still lowers into the query's top-level `$top`):
 * `ObjectKanban.tsx:722`, the `$top` of the
 * board's one query — its docblock below carries the four-face record.
 */
export const ObjectKanbanPropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-kanban`',
  history: objectBlockHistory('object-kanban'),
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  aliases: {
    ...FILTERS_TO_FILTER,
    // The Studio designer's published spelling; no renderer read point —
    // the board reads `groupBy` (objectui#3829 / #7973 class).
    groupField: 'groupBy',
  },
}, {
  objectName: z.string().optional()
    .describe('Object this board binds to. Optional because the component-level `dataSource` binding can supply the object instead'),
  groupBy: z.string().optional().describe('Field whose values become the board columns'),
  columns: z.array(z.unknown()).optional()
    .describe('Swimlane definitions ({ id, title } per `groupBy` value, or bare value strings) — NOT a field projection'),
  /**
   * Base query filter — the `ViewFilterRule` ARRAY form, the one filter
   * orthography every `filter` door in this map shares (#15449; the family
   * entry on `object-grid` carries the ruling). Measured at the objectui pin
   * `53ded82b` before the declaration moved: `ObjectKanban.tsx` hands
   * `schema.filter` verbatim to `$filter`, and `ObjectStackAdapter.convertQueryParams`
   * lowers a rule array through `translateFilterArray` — the same door every
   * list view's stored rule array takes. The record form is refused at
   * `filter`; see migration
   * `element-data-source-and-object-block-filter-rule-array`.
   */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `object-kanban`',
      migration: 'element-data-source-and-object-block-filter-rule-array',
    }),
  }).optional()
    .describe('Base query filter, handed to the wire `$filter` — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` door in this map shares. The MongoDB-style record form is refused — see migration `element-data-source-and-object-block-filter-rule-array`'),
  /**
   * Row cap (#16503 — the spec half of objectui#8172; decision batch #68,
   * 2026-09-07, option A: the contract declares the capability that already
   * ships, is documented and is in use). Measured at the objectui pin this
   * repo builds against (`.objectui-sha` = `31971ff1e`; re-measured there
   * 2026-10-01 — `plugin-kanban/src/types.ts` (still no row-cap member) and
   * `ElementDataSourceGate.tsx` are byte-identical to `e420df310`, so
   * `:218-220` and `:437-456` did not move; `ObjectKanban.tsx` changed only in
   * the comment above its `navigation` read (objectui#8652), below every
   * anchor here, so the query `715-725`, the default `:97`, the `queryFilter`
   * resolution `:584-585` and the import `:10` did not move;
   * `plugin-kanban/src/index.tsx` changed below the mapping (objectui#8652's
   * `navigation` input), which did not move from `487-491`;
   * `element-data-source.ts` changed above `savedViewRawLimit` (+33/-6,
   * objectui#8945's re-stated `dataSource.filter` note), which MOVED byte-identical `241-245` -> `268-272`;
   * `objectql.ts` MOVED the member `4430` -> `4588` byte-identical, still
   * inside `ObjectKanbanSchema`; and `plugin-kanban.mdx` gained a `navigation`
   * Properties row below the `limit` row, which, with the `limit: 250`
   * snippet, did not change. At `e420df310`, re-measured there
   * 2026-09-30 — `plugin-kanban/src/types.ts` (still no row-cap member),
   * `ElementDataSourceGate.tsx` and `element-data-source.ts` are
   * byte-identical to `db11afd49`, so `:218-220`, `:437-456` and `:241-245` did
   * not move; `ObjectKanban.tsx` changed (+40/-13) and its query CHANGED ONE
   * MEMBER: objectui#9853 renamed the default `DEFAULT_KANBAN_LIMIT` to
   * `DEFAULT_KANBAN_FETCH_BATCH_SIZE` (still `100`, now documented as the
   * board's fetch batch, not a page size), so `$top` reads
   * `resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE)`, and the
   * query MOVED `705-715` -> `715-725`, the default `:88` -> `:97` and the
   * `queryFilter` resolution `:574-575` -> `:584-585`, while the import at
   * `:10` did not move; `plugin-kanban/src/index.tsx` lost the Quick Add
   * plumbing above the mapping (objectui#8285, objectui#11234), which MOVED
   * byte-identical `506-510` -> `487-491`; `objectql.ts` MOVED the member
   * `4302` -> `4430` byte-identical, still inside `ObjectKanbanSchema`; and
   * `plugin-kanban.mdx` changed around, not in, the `limit: 250` snippet and
   * its Properties row. At `db11afd49`, re-measured there 2026-09-29 —
   * `plugin-kanban.mdx`, `plugin-kanban/src/types.ts` and
   * `ElementDataSourceGate.tsx` are byte-identical to `dd3f7e1be`,
   * `plugin-kanban/src/index.tsx` too, `ObjectKanban.tsx` and
   * `element-data-source.ts` changed in comment lines only and none of their
   * cited lines, so those anchors did not move; `packages/types/src/objectql.ts`
   * gained declarations above the member, which is still inside
   * `ObjectKanbanSchema`, and MOVED `4139` -> `4302` with its text
   * byte-identical. At `dd3f7e1be`, re-measured there
   * 2026-09-28 — `plugin-kanban.mdx` is byte-identical to `f8a9d0fb0`; every
   * other file this block cites changed on this hop, and each anchor was
   * re-READ. Two changed CONTENT and say so where they are cited: the board's
   * query now sends `$filter: queryFilter`, the node's `filter` with its
   * context tokens resolved (objectui#10666), and the gate's limit branch now
   * asks whether the binding's cap is USABLE rather than present
   * (objectui#10016). `plugin-kanban/src/types.ts` changed only to stop
   * re-exporting `ColumnWidthConfig` (objectui#10582) and still declares no
   * row-cap member. Every other anchor MOVED with its cited text
   * byte-identical — the query `680-690` -> `705-715` apart from that one
   * member, `:85` -> `:88`, `index.tsx:507-511` -> `:506-510`,
   * `objectql.ts:3832` -> `:4139`, `ElementDataSourceGate.tsx:200-202` ->
   * `:218-220`, `element-data-source.ts:237-241` -> `:241-245` — and
   * `ObjectKanban.tsx:10` did not move. On the hop onto `f8a9d0fb0`,
   * `element-data-source.ts`, `plugin-kanban/src/types.ts` and
   * `plugin-kanban.mdx` were byte-identical to `62597c588`; every other file
   * this block cites changed on that hop, and each anchor was re-READ: the
   * board's query GAINED a member (objectui#10068's `$orderby` from the
   * binding's `sort`, between `$filter` and `$top`, `674-679` -> `680-690`)
   * and the data-source mapping gained `sort: true` (`447-450` -> `507-511`);
   * every other anchor MOVED with its cited text byte-identical — `:84` ->
   * `:85`, `:553` -> `:554`, `:559` -> `:565`, `:676` -> `:687`,
   * `objectql.ts:3735` -> `:3832`, `ElementDataSourceGate.tsx:316-331` ->
   * `:373-388` and `:192-194` -> `:200-202`, `ListView.tsx:2979` -> `:3067` and
   * `:2952` -> `:3040`, `ObjectView.tsx:1638` -> `:1666` and `:1579` ->
   * `:1607` — and `ObjectKanban.tsx:10` did not move. (`:554`, `:565`, `:687`
   * and the `ListView.tsx` / `ObjectView.tsx` pairs are that re-read's record
   * only: they anchored the view-face `kanban.limit` spread, a key #19228
   * retired before any release carried it, so this block no longer cites
   * them.) Every file here was
   * byte-identical across the hop onto `62597c588`. All four
   * anchors were re-READ at `87af769e9` 2026-09-20 — the hop that moved every
   * one of them, and RENAMED one face rather than shifting it), four
   * faces agree
   * while this map refused the key by name: the board's one query is
   * `dataSource.find(objectName, { $filter: queryFilter, $orderby: …, $top:
   * resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE) })`
   * (`plugin-kanban/src/ObjectKanban.tsx:715-725`, where `queryFilter` is
   * `schema.filter` with its context tokens resolved at `:584-585` —
   * objectui#10666; at `f8a9d0fb0` the member read `schema.filter` verbatim —
   * the default `100` at `:97`, named `DEFAULT_KANBAN_LIMIT` until
   * objectui#9853 — a REAL top-level `$top` since objectui#4025;
   * before that the cap sat under a `options` key no adapter read, and the
   * bare `??` became `resolveRowLimit` in objectui#9925, which drops and
   * reports a cap the contract refuses instead of sending it),
   * `OBJECT_KANBAN_DATA_SOURCE` maps `limit: 'limit'`
   * (`plugin-kanban/src/index.tsx:487-491`), the type the board reads `schema`
   * through is `ObjectKanbanSchema` — ⚠️ `KanbanSchema` was RETIRED on this hop
   * (maintainer ruling 2026-09-09) and `plugin-kanban/src/types.ts` no longer
   * declares the member at all — imported at `ObjectKanban.tsx:10` and
   * declaring `limit?: number` at `packages/types/src/objectql.ts:4588`,
   * and `content/docs/plugins/plugin-kanban.mdx`
   * teaches it with a typed snippet (`limit: 250`) plus a Properties row. So
   * an author following the published docs wrote a node the save gate
   * refused, with the same `unrecognized_keys` verdict a typo gets.
   *
   * Why the carrier is `limit` and not the bound view's `pagination.pageSize`
   * (the alternative the card opened): precedence is the `ElementDataSourceGate`
   * table, not this key's. The component-level `dataSource.limit` overrides
   * this key unconditionally; a bound named view's `pagination.pageSize` is
   * LOWERED INTO it through the `limit: 'limit'` mapping only when this key is
   * unset (`react/src/element-data-source/ElementDataSourceGate.tsx:437-456`,
   * `readLimit`/`writeLimit` keyed by `ElementDataSourceLimitKey`; the branch
   * gained objectui#9899's presence-is-not-authorship test and a
   * `describeDisplacedRowLimit` report on the hop onto `f8a9d0fb0`). ⚠️ At
   * this pin the branch's `fromView` is
   * `!isUsableRowLimit(binding.config?.limit)` rather than
   * `binding.config?.limit === undefined` (objectui#10016): a binding cap the
   * contract REFUSES is not authored and yields to the view's cap. Every cap
   * the spec's `dataSource.limit` accepts (`z.number().int().positive()`) is
   * usable, so for a node the save gate admits the override stated above is
   * unchanged.
   *
   * ⚠️ 「only when UNSET」 reads narrower than the guard and is nonetheless
   * EXACTLY right on this face — a correction to a correction, measured
   * 2026-09-21T10:20Z. The branch is
   * `if (!fromView || !isUsableRowLimit(authored))`, and
   * `isUsableRowLimit` is `typeof v === 'number' && Number.isInteger(v) && v > 0`
   * (`ElementDataSourceGate.tsx:218-220`), and this key's accept set
   * (`z.number().int().positive()`) is a SUBSET of it — ⛔ not the same set,
   * and the difference is reachable: `2^53 + 2` is refused here (zod 4's
   * `.int()` is safe-integer, `too_big`) and `Number.isInteger` calls it
   * usable. Subset is the direction that matters, and it is the whole
   * argument: for every node this schema ACCEPTS, `authored` is either absent
   * (not usable ⇒ the view's cap lands) or a cap the gate already treats as
   * authored (⇒ it does not). So unset is the only reachable arm.
   * The extra arm — a cap displaced and reported because it is `0`, negative
   * or fractional — is reachable ONLY for a node this contract refuses, so
   * ⛔ it does not belong in an author-facing describe. Pinned structurally
   * beside the parse pins in `component.test.ts` rather than as prose.
   *
   * ⚠️ And the view half is `pagination.pageSize` ALONE on this face.
   * `savedViewLimit` does fall back to a flat `view.limit`
   * (`core/src/data-scope/element-data-source.ts:268-272`), but that names a
   * THIRD face — a saved-view RECORD as the adapter's `listViews()` returns it
   * — not an authored view document. Measured on this tree: `ListViewSchema`
   * REFUSES a flat `limit` with `unrecognized_keys: ["limit"]`, the same
   * verdict a bogus key gets, while the same minimal document parses with
   * `pagination.pageSize: 50`. There is
   * no flat `limit` member on any view document and no `retiredKey()`
   * tombstone for one. ⛔ So naming that arm here would put a runtime-record
   * shape on the author face with no qualifier — the face-merge this card has
   * now failed on three times.
   * ⛔ This note reports the guard; it picks no precedence.
   *
   * ⭐ The arm is REACHABLE: its guard reads THIS key on the node as AUTHORED, and this
   * declaration is `.optional()` with no applied default, so an author's
   * silence is still silence at parse time. ⛔ Do not add
   * a `.default()` here: that — and only that — is what would make it dead.
   * The board
   * has no `pagination` read point, so declaring that spelling here would name
   * a key the renderer ignores — the accepted-and-dropped defect this section
   * exists to remove. Same shape as the `element:record_picker` and
   * `record:related_list` row caps (one `$top` contract, not a third dialect),
   * and like them the renderer's 100 is documented rather than declared:
   * a schema default would materialize `limit: 100` on every parsed board.
   */
  limit: z.number().int().positive().optional()
    .describe("Maximum number of records loaded onto the board (row cap); lowered to the query's top-level `$top` (renderer default 100). The component-level `dataSource.limit` wins when both are set; a bound view's `pagination.pageSize` fills this key only when it is unset — and on this face unset is the whole rule, because every cap this key accepts is one the binding gate already treats as authored"),
  data: z.array(z.unknown()).optional().describe('Static inline cards — bypasses the object query'),
  cardTitle: z.string().optional().describe('Field rendered as each card title'),
  titleField: z.string().optional().describe('Legacy fallback for `cardTitle` (the board reads `cardTitle || titleField`). Prefer `cardTitle`'),
  cardFields: z.array(z.string()).optional().describe('Fields rendered on each card'),
  swimlaneField: z.string().optional().describe('Field for horizontal swimlanes (in addition to columns)'),
  /**
   * [#20831] The list view's own `GroupingConfigSchema`, by reference — ⛔ not
   * a copy of its shape. The board reads ONE position of it:
   * `effectiveSwimlaneField = swimlaneField || grouping.fields[0].field`
   * (`ObjectKanban.tsx`), and looks that raw name up on every card. Until
   * #20831 it was `z.unknown()`, so a padded name (`'  business_unit  '`,
   * refused on `list-view` since #17360) or a wrong-shaped value validated
   * green here and collapsed every card into one lane with no error. Kept,
   * not retired: it is a live reader of the view's grouping config, and an
   * explicit `swimlaneField` still wins.
   */
  grouping: GroupingConfigSchema.optional().describe('View grouping config; its first field is the swimlane fallback'),
  /**
   * RETIRED (#17260, ADR-0049 enforce-or-remove — the spec half of the
   * objectui#8285 director-seat ruling, decision batch #91, 2026-09-08:
   * option B, `quickAdd` leaves `object-kanban`. The ruling named the
   * React-host `kanban-ui` block as where the control stays; objectui has
   * since retired that block (objectui#8257), so `object-kanban` offers no
   * quick-add control and no block a document can name offers one either).
   *
   * Measured at the objectui pin this repo builds against
   * (`.objectui-sha` = `31971ff1e`; re-measured there 2026-10-01 —
   * `KanbanImpl.tsx` and `KanbanBoardCore.tsx` are byte-identical to
   * `e420df310`, so `:621`, `:634` and `:78` did not move and were re-read in
   * place; `ObjectKanban.tsx` changed only in the comment above its
   * `navigation` read (objectui#8652), above the spread, which MOVED `1641` ->
   * `1639` with its line byte-identical; and `plugin-kanban/src/index.tsx`
   * changed below the exported `KanbanRenderer` (objectui#8652's `navigation`
   * input), whose pass-through did not move from `345-346`. At `e420df310`
   * (2026-09-30) `KanbanImpl.tsx` was byte-identical to `db11afd49`, so `:621` and `:634` did
   * not move and were re-read in place. objectui's own half of this retirement
   * landed on this hop and changed the PATH, not the verdict: objectui#8285
   * stopped forwarding `quickAdd`, and objectui#11234 retired
   * `ObjectKanbanSchema.onQuickAdd` and has `ObjectKanban` render an internal
   * `KanbanBoardCore` that reads neither key off `schema`
   * (`KanbanBoardCore.tsx:78`). So the spread MOVED `1614` -> `1641` with its
   * line byte-identical but now feeds `KanbanBoardCore`, and the pass-through
   * below sits only in the exported `KanbanRenderer`, MOVED `357-358` ->
   * `345-346`, which `ObjectKanban` no longer mounts. At `db11afd49`
   * (2026-09-29) `KanbanImpl.tsx` and `plugin-kanban/src/index.tsx` are
   * byte-identical to
   * `dd3f7e1be` and `ObjectKanban.tsx` changed in one comment line (`:1367`), so
   * `:1614`, `:357-358`, `:621` and `:634` did not move and were re-read in
   * place. At `dd3f7e1be` (2026-09-28)
   * `KanbanImpl.tsx` changed only in three comment lines (+3/-3, objectui
   * `1dae95a41` re-spelling an issue citation as a commit), so `:621` and
   * `:634` did not move and were re-read in place; `ObjectKanban.tsx`
   * (+44/-8: objectui#10572's invalidation bus, objectui#10663,
   * objectui#10666's resolved filter, that comment sweep) and `index.tsx`
   * (+45/-46: the retired column-width hook and `ColumnWidthConfig`,
   * objectui#8522 / objectui#10582, the deleted `KanbanEnhanced`,
   * objectui#8932, that comment sweep) changed, and both of their anchors
   * MOVED with the cited text byte-identical: `1578` -> `1614`, `363` -> `357`. On the hop onto `f8a9d0fb0`,
   * `KanbanImpl.tsx` was byte-identical to `62597c588`, while
   * `ObjectKanban.tsx` (objectui#10068's `$orderby`) and `index.tsx`
   * (objectui#10069's lane matching, the `sort` mapping) changed, and both
   * anchors MOVED with the cited text byte-identical: `1563` -> `1578`,
   * `313` -> `363`. All
   * three files were byte-identical across the hop onto `62597c588`, and all
   * four anchors were re-READ at `87af769e9` 2026-09-20, where each MOVED with
   * its cited text byte-identical): through `db11afd49` the board
   * forwarded the key —
   * `ObjectKanban.tsx:1614` there spread the authored bag into `KanbanRenderer`,
   * which passes
   * `quickAdd={schema.quickAdd}` and `onQuickAdd={schema.onQuickAdd}`
   * (`plugin-kanban/src/index.tsx:357-358` there, `:345-346` at this pin) — but the affordance is gated on
   * BOTH (`KanbanImpl.tsx:621` and `:634`), and `onQuickAdd` is a
   * host-supplied FUNCTION that JSON cannot carry and no producer puts on an
   * `object-kanban` node. `ObjectKanban.tsx` names neither half of the pair
   * in code (0 occurrences each, against 11 for the sibling `onCardClick` in the same
   * file — re-counted at `db11afd49`, at `f8a9d0fb0` and at `62597c588`; at
   * `e420df310` and again at this pin 2 each, all four inside the two
   * objectui#11234 comments that record the cut, and still 11 for
   * `onCardClick`; this record said 6, which the identical
   * file at `87af769e9` does not reproduce either, so the control was
   * miscounted rather than moved, and the verdict rests on the 0). So the gate was permanently false and authoring the key was a
   * parse-clean no-op — the accepted-and-dropped class.
   *
   * ⛔ Not a silent one, which is why the retirement is worth more than a
   * tidy-up: objectui's registry↔spec ledger records the key verbatim as
   * `ESCALATED (object-kanban.quickAdd — measured NOT honoured)` and its html
   * tier reported it as `unknown-prop` — the SAME diagnostic a typo gets. An
   * author following this published contract met a tool that contradicted it
   * and could not tell which side was wrong. The tombstone collapses both
   * halves onto one answer.
   *
   * The control is not withdrawn from objectui's React layer, but no metadata
   * node reaches it. The ruling kept it on `kanban-ui`, the block a React host
   * renders directly and can hand the runtime function to. ⚠️ Re-read at
   * `e420df310`: objectui retired the schema-only `kanban-ui` registration
   * long before this pin (objectui#8257; 0 registrations at `dd3f7e1be`,
   * `db11afd49`, `e420df310` and this pin), and the pair now lives on the
   * exported `KanbanRenderer` React component a host mounts directly
   * (`plugin-kanban/src/index.tsx:345-346`), not on any block a document can
   * name. ⛔ So the tombstone below prescribes "delete the key" and names no
   * block: this spec declares no `kanban-ui` component type, so a node an
   * author wrote there would save clean (the type is an unregistered custom
   * string) and resolve no renderer, which is the dead metadata this
   * retirement exists to remove. Sources are stripped by the D2 conversion
   * `object-kanban-quick-add-removed` (a pure lossless delete — the key never
   * had an effect to preserve).
   */
  quickAdd: retiredKey(
    '`object-kanban` property `quickAdd` was removed in @objectstack/spec 17 (ADR-0049) — '
    + 'the board forwarded it, but the per-column affordance is gated on both `quickAdd` and '
    + '`onQuickAdd`, and `onQuickAdd` is a host-supplied function JSON cannot carry and no '
    + 'producer ever put on an `object-kanban` node, so authoring it was a parse-clean no-op. '
    + 'Delete the key; `object-kanban` offers no quick-add control. '
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
  ),
  coverImageField: z.string().optional().describe('Image field rendered as the card cover'),
  conditionalFormatting: z.unknown().optional().describe('Card conditional formatting rules'),
  /**
   * Card-click navigation (commit e233db9db — the spec half of the objectui#8652
   * maintainer ruling, verbatim `B`: declare `navigation` on the platform
   * element schemas).
   *
   * Measured at the pin this repo builds against (`.objectui-sha` =
   * `31971ff1e`; re-measured there 2026-10-01 — `ObjectKanban.tsx` changed on
   * this hop in one place, the comment above the `navigation` read (+12/-14,
   * objectui#8652, the objectui half of the same ruling: the key is now
   * declared on `ObjectKanbanSchema`), so the read itself did not change and
   * every anchor MOVED up by 2 with its cited text byte-identical: the read
   * `1282` -> `1280`, the hand-off `1290-1291` -> `1288-1289`, the overlay
   * render `1540` -> `1538` and its `NavigationOverlay` `1556-1569` ->
   * `1554-1567`, and the card click `1665` -> `1663`. At `e420df310`
   * (2026-09-30) `ObjectKanban.tsx` changed on
   * this hop, +40/-13: objectui#9853's renamed fetch-batch default, and
   * objectui#11234's internal `KanbanBoardCore` with the comments that record
   * the Quick Add cut, all of it re-mapped through the diff. Every anchor MOVED
   * with its cited text byte-identical and none of the edits touches the
   * `navigation` read or where it lands: the read `1261` -> `1282`, the
   * hand-off `1269-1270` -> `1290-1291`, the overlay render `1519` -> `1540`
   * and its `NavigationOverlay` `1535-1548` -> `1556-1569` by 21, and the card
   * click `1638` -> `1665` by 27, the six extra lines being the
   * `KanbanBoardCore` comment above the board it now clicks through. At
   * `db11afd49` (2026-09-29) `ObjectKanban.tsx` changed in one
   * comment line only (`:1367`, a line-neutral comment re-spelling that no anchor
   * below cites), so every anchor below held unmoved and was re-read in place. At
   * `dd3f7e1be` (2026-09-28) `ObjectKanban.tsx` changed on
   * this hop, +44/-8 (objectui#10572's invalidation bus, objectui#10663,
   * objectui#10666's resolved filter, and objectui `1dae95a41`'s comment
   * sweep), every line it added or removed above these anchors — the one
   * comment it re-spelled below them, at `:1615`, is line-neutral — so each
   * MOVED by 36 with its cited text byte-identical and is cited below at its
   * new number. On the hop onto `f8a9d0fb0` the file changed +16/-1
   * (objectui#10068's `$orderby`), also all above them, and each MOVED by 15
   * with its text byte-identical; the file was byte-identical across the hop
   * onto `62597c588`. They were
   * re-READ at `87af769e9` 2026-09-22 — every anchor re-derived from that
   * tree rather than carried, none of them at its `53ded82bf` number and one
   * of them no longer spelled the way this record quoted it):
   * `ObjectKanban.tsx:1280`
   * reads `schema.navigation ?? { mode: 'drawer' }` and hands it to
   * `useNavigationOverlay` (`:1288-1289`), whose result drives the card click
   * (`:1663`) and the detail overlay (`:1538`, whose `NavigationOverlay` is
   * `:1554-1567`) — on a STANDALONE board, with no enclosing view to resolve
   * a mode from. ⚠️ The `(schema as any)` cast this record used to quote is
   * GONE at this pin: the read is spelled `schema.navigation`, and it now
   * compiles through a DECLARED `ObjectKanbanSchema.navigation` member
   * (objectui#8652, the mirror of this row), where through `e420df310` it
   * compiled through `BaseSchema`'s index signature, as the comment above it
   * then recorded (objectui#9726). The READ is unchanged — only its spelling is —
   * so nothing this record says about the key moves. Until this key the same
   * document ran correctly in the renderer and was refused BY NAME at the
   * authoring door, through the generic `unrecognized_keys` rule a typo gets.
   *
   * The value is {@link NavigationConfigSchema} BY REFERENCE — the one def
   * `ListViewSchema.navigation` declares — because the ruling's point is that
   * the element carrier must not fork the vocabulary: a second shape here
   * would be a second dialect for one gesture, and the `view` tombstone
   * (#16885) would have to be maintained twice. The view-level key is
   * untouched: this is an ADDITIONAL carrier for the standalone placement, not
   * a replacement.
   */
  navigation: NavigationConfigSchema.optional()
    .describe("Card-click navigation config — the same block `ListViewSchema.navigation` declares ({ mode, size, openNewTab, preventNavigation }). The renderer's own default is `{ mode: 'drawer' }` when the key is absent; it is documented rather than declared, so a parsed board carries the key only when the author wrote it"),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectKanbanProps = z.input<typeof ObjectKanbanPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on TWO keys.
 * `filter` carries `z.array(ViewFilterRuleSchema)` (the ui#6206-B family
 * convergence, #15449), whose own input ≠ infer (`operator` is normalized on
 * parse); `navigation` carries {@link NavigationConfigSchema} (commit e233db9db), whose
 * four defaulted members (`mode`, `preventNavigation`, `openNewTab`, `size`)
 * materialize on parse — but only on a document that AUTHORED the key, since
 * the door itself is `.optional()` with no default of its own. So
 * `object-kanban` leaves the type-alias convention pin's default-free
 * family the way `object-grid` did, taking the `ObjectGridPropsParsed` route.
 */
export type ObjectKanbanPropsParsed = z.infer<typeof ObjectKanbanPropsSchema>;

/**
 * The flat per-field spellings `ObjectCalendar` keeps reading as a
 * backward-compat fallback (`getCalendarConfig`, ObjectCalendar.tsx:150-158)
 * and that `ObjectView`/`ListView` emit on their runtime handoff. Read, but
 * NOT authorable — one composition key per concept (Prime Directive #12, the
 * `body` → `children` precedent on {@link PageContainerProps}): the authored
 * spelling is the `calendar` object.
 */
const OBJECT_CALENDAR_FLAT_FIELD_GUIDANCE: readonly KeySetGuidance[] = [
  ...COMPONENT_LEVEL_GUIDANCE,
  {
    name: 'OBJECT_CALENDAR_FLAT_FIELD_KEYS',
    keys: ['startDateField', 'dateField', 'endDateField', 'endField', 'titleField', 'colorField', 'allDayField'],
    examples: ['startDateField', 'titleField'],
    prescription:
      'Write this as a key of the `calendar` config object instead — `calendar: { startDateField, '
      + 'endDateField, titleField, colorField, allDayField }`. The flat spelling is the runtime handoff '
      + '`ObjectView`/`ListView` emit and a stored-document fallback the renderer keeps reading; it is '
      + 'not a second authorable spelling (one key per concept, Prime Directive #12).',
  },
];

/**
 * `object-calendar` (objectui `plugin-calendar/src/ObjectCalendar.tsx` +
 * registry shell in `plugin-calendar/src/index.tsx` @ `eb7f586b`). Read
 * points: `objectName` (throughout), `calendar` (:145 — the canonical config
 * object), `defaultView` (:188), `filter`/`sort` (fetch params), `data`/
 * `staticData` (external rows), and via the registry shell's declared host
 * hatches `locale` and `loading`.
 */
export const ObjectCalendarPropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-calendar`',
  history: objectBlockHistory('object-calendar'),
  guidanceSets: OBJECT_CALENDAR_FLAT_FIELD_GUIDANCE,
  aliases: FILTERS_TO_FILTER,
}, {
  objectName: z.string().optional()
    .describe('Object this calendar binds to. Optional because the component-level `dataSource` binding can supply the object instead'),
  calendar: z.unknown().optional()
    .describe('Calendar field config: { startDateField, endDateField?, titleField?, colorField?, allDayField? }'),
  defaultView: z.enum(['month', 'week', 'day']).optional().describe('Initial view mode'),
  /**
   * Base query filter — the `ViewFilterRule` ARRAY form, the one filter
   * orthography every `filter` door in this map shares (#15449; the family
   * entry on `object-grid` carries the ruling). Measured at the objectui pin
   * `53ded82b` before the declaration moved: `ObjectCalendar.tsx` hands
   * `schema.filter` verbatim to `$filter` and the adapter lowers a rule array
   * exactly as it does for the kanban. The record form is refused at
   * `filter`; see migration
   * `element-data-source-and-object-block-filter-rule-array`.
   */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `object-calendar`',
      migration: 'element-data-source-and-object-block-filter-rule-array',
    }),
  }).optional()
    .describe('Base query filter — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` door in this map shares. The MongoDB-style record form is refused — see migration `element-data-source-and-object-block-filter-rule-array`'),
  /**
   * Row order for the fetched events — the same `SortItem` ARRAY form
   * `object-grid` declares above, and for the same ruling (objectui#8221,
   * decision batch #77, option B; the `object-grid` entry carries the verbatim
   * text). One sort orthography, one shared `SortItemSchema`.
   *
   * Measured at the objectui pin `53ded82b`: `ObjectCalendar.tsx:431` hands
   * `schema.sort` to the shared sink `convertSortToQueryParams`
   * (`core/src/utils/sort-query.ts`) as the fetch's `$orderby`. ⚠️ That sink
   * still honours the legacy string clause at this pin — `sort-query.ts:66-70`
   * — so, exactly as on `object-grid`, this declaration lands ahead of the
   * consumer-side retirement (objectui#8221's PR objectui#8758, merged 2026-09-09) and
   * refuses a spelling the pinned helper still lowers. The array arm is
   * unaffected: the sink folds `[{ field, order }]` into the field-direction
   * map either way. Unlike the grid, `plugin-calendar/src/index.tsx` declares
   * no `sort` input at all, so nothing on the registry side moves.
   */
  sort: z.array(SortItemSchema).optional()
    .describe('Row order for the fetched events — the SortItem array form `[{ field, order }, ...]`, the one sort orthography every declared `sort` door on this platform shares; lowered to the wire `$orderby`. The legacy string clause (`name desc`) is refused — see migration `object-block-sort-item-array`'),
  data: z.array(z.unknown()).optional().describe('Pre-fetched records — skips the internal fetch'),
  staticData: z.array(z.unknown()).optional().describe('Static inline records'),
  locale: z.string().optional().describe('Locale override for the calendar chrome'),
  loading: z.boolean().optional().describe('External loading state (honoured only alongside `data`)'),
  /**
   * Event-click navigation (commit e233db9db — the spec half of the objectui#8652
   * maintainer ruling, verbatim `B`), the same carrier and the same def as
   * `object-kanban`'s above.
   *
   * Measured at the pin this repo builds against (`.objectui-sha` =
   * `31971ff1e`; re-measured there 2026-10-01 — `ObjectCalendar.tsx` changed
   * across the hop from `e420df310` in one place (+11/-19, objectui#8652, the
   * objectui half of the same ruling): `navigation` is now DECLARED on
   * `ObjectCalendarSchema`, so the ledger comment `1008-1025` that recorded
   * the one cast objectui#8651 left standing is replaced by the declaration
   * note `1008-1017`, and the read `1026` -> `1018` CHANGED CONTENT, toward
   * this row: it is spelled `schema.navigation ?? { mode: 'drawer' }`, with no
   * cast. Every anchor after it MOVED up by 8 with its cited text
   * byte-identical — the hand-off `1028-1029` -> `1020-1021`, the event click
   * `1421` -> `1413`, the overlay render `1341` -> `1333`, its
   * `NavigationOverlay` `1354-1367` -> `1346-1359`. At `e420df310`
   * (2026-09-30) `ObjectCalendar.tsx` changed
   * across the hop from `db11afd49` in comments only (+6/-3, objectui#11073),
   * two of them inside the ledger comment, which now says `@objectstack/spec`
   * 17.5.0 ships the `navigation` declaration that card waited on and that
   * mirroring it is that card's next step, so the ledger grew `1008-1022` ->
   * `1008-1025` and every anchor after it MOVED by 3 with its cited text
   * byte-identical — the read `1023` -> `1026`, still spelled with the cast,
   * the hand-off `1025-1026` -> `1028-1029`, the event click `1418` -> `1421`,
   * the overlay render `1338` -> `1341`, its `NavigationOverlay` `1351-1364` ->
   * `1354-1367`. At `db11afd49` (2026-09-29) `ObjectCalendar.tsx` changed
   * again across the hop from `dd3f7e1be` (+18/-11: objectui#11005's DST
   * wall-clock moves in `toStoredDateValue` and the month-grid handlers, and
   * comment re-citations, two of them inside the ledger comment, which now says
   * the card waits on an objectstack commit where it said `pm:blocked`), so every
   * anchor was re-mapped through the diff and re-READ, and each MOVED with its
   * cited text byte-identical — the ledger `1005-1019` -> `1008-1022`, the read
   * `1020` -> `1023`, the hand-off `1022-1023` -> `1025-1026`, the event click
   * `1411` -> `1418`, the overlay render `1331` -> `1338`, its
   * `NavigationOverlay` `1344-1357` -> `1351-1364`. At `dd3f7e1be` (2026-09-28),
   * `ObjectCalendar.tsx` changed
   * across the hop from `f8a9d0fb0` (+128/-38: objectui#10572's invalidation
   * bus, objectui#10663, objectui#10666's resolved filter, objectui#10668's
   * display locale, objectui#10866's date-only days and the core row
   * ceiling), so every anchor was re-mapped through the diff and re-READ
   * rather than carried, and each MOVED with its cited text byte-identical —
   * the ledger `921-935` -> `1005-1019`, the read `936` -> `1020`, the
   * hand-off `938-939` -> `1022-1023`, the event click `1317` -> `1411`, the
   * overlay render `1237` -> `1331`, its `NavigationOverlay` `1250-1263` ->
   * `1344-1357`. At `f8a9d0fb0` the file was byte-identical to `62597c588`
   * (`git diff --quiet`), so every anchor held unmoved from the re-READ taken
   * at `62597c588` 2026-09-23. That file
   * changed across the hop from `87af769e9` (objectui `afb228418`, the calendar's
   * copy routed through the locale packs, +43/-17), so every anchor was
   * re-derived rather than carried: `:921-935`, `:936` and `:938-939` did not
   * move, and the three after the change MOVED with their cited text
   * byte-identical — the event click `1293` -> `1317`, the overlay render
   * `1218` -> `1237`, its `NavigationOverlay` `1228-1241` -> `1250-1263`. At
   * `87af769e9` (2026-09-22) none was at its `53ded82bf` number. Through
   * `e420df310` the cast was still spelled here, unlike its `object-kanban`
   * twin; at this pin it is gone on both): `ObjectCalendar.tsx:1018`
   * reads `schema.navigation ?? { mode: 'drawer' }`, `:1020-1021` hands
   * it to `useNavigationOverlay`, `:1413` fires it on an event click and
   * `:1333` renders the overlay (its `NavigationOverlay` is `:1346-1359`) —
   * standalone, with no enclosing view.
   */
  navigation: NavigationConfigSchema.optional()
    .describe("Event-click navigation config — the same block `ListViewSchema.navigation` declares ({ mode, size, openNewTab, preventNavigation }). The renderer's own default is `{ mode: 'drawer' }` when the key is absent; it is documented rather than declared, so a parsed calendar carries the key only when the author wrote it"),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectCalendarProps = z.input<typeof ObjectCalendarPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on TWO keys.
 * `filter` carries `z.array(ViewFilterRuleSchema)` (the ui#6206-B family
 * convergence, #15449), whose own input ≠ infer (`operator` is normalized on
 * parse); `navigation` carries {@link NavigationConfigSchema} (commit e233db9db), whose
 * four defaulted members (`mode`, `preventNavigation`, `openNewTab`, `size`)
 * materialize on parse — but only on a document that AUTHORED the key, since
 * the door itself is `.optional()` with no default of its own. So
 * `object-calendar` leaves the type-alias convention pin's default-free
 * family the way `object-grid` did, taking the `ObjectGridPropsParsed` route.
 */
export type ObjectCalendarPropsParsed = z.infer<typeof ObjectCalendarPropsSchema>;

// `object-form` `layout` retired-value prescriptions (#20221, ADR-0049
// enforce-or-remove). Declared with `//` on purpose — the
// `LIST_VIEW_EXPORT_PDF_RETIRED` placement note applies here too: build-docs
// takes a file's first JSDoc per exported symbol, and these need no doc page.
// This is an enum-VALUE narrowing, so there is no `retiredKey()` tombstone to
// hang the prescription on — the enum's own error map carries it, keyed on
// `issue.input` so only a value which used to be legal gets the "was removed"
// message (the `record:chatter` `position` precedent, #8762).
//
// Measured at the `.objectui-sha` pin `f8a9d0fb0`: neither value ever had a
// behaviour of its own. The simple arm folds both to 'vertical'
// (`ObjectForm.tsx:1406-1410`, under the comment "Map 'grid' and 'inline' to
// 'vertical' as fallback"); the drawer and modal arms (`ObjectForm.tsx:463`,
// `:499`) and `DrawerForm.tsx:575` / `ModalForm.tsx:597` pass only 'vertical'
// and 'horizontal' through; `TabbedForm.tsx:556`, `SplitForm.tsx:445` and
// `WizardForm.tsx:1075` hard-code 'vertical'. Multi-column — what 'grid' would
// mean — is `columns`, which the renderer honours under every arm; 'inline' is
// a toolbar / filter-row pattern, not a record-form layout. The ADR-0087
// conversion `form-layout-inline-grid-to-vertical` rewrites both values to
// 'vertical' (behaviour-preserving, `columns` untouched) for stored rows and
// `os migrate meta`. `FormViewSchema.layout` (view.zod.ts) carries the same
// narrowing under its own surface name.
const OBJECT_FORM_LAYOUT_RETIRED: ReadonlyMap<string, string> = new Map([
  ['grid', "'grid' was removed from the `object-form` `layout` enum in @objectstack/spec 17.5.0 "
    + '(ADR-0049 enforce-or-remove) — no renderer ever gave it a behaviour of its own: every '
    + "`object-form` presentation folds it to 'vertical'. Write 'vertical', or omit `layout` "
    + "('vertical' is the renderer default); for a multi-column form set `columns` (e.g. "
    + '`columns: 2`), which the renderer honours under either layout. '
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.'],
  ['inline', "'inline' was removed from the `object-form` `layout` enum in @objectstack/spec 17.5.0 "
    + '(ADR-0049 enforce-or-remove) — no renderer ever gave it a behaviour of its own: every '
    + "`object-form` presentation folds it to 'vertical', and a row of inline inputs is a "
    + "toolbar / filter-row pattern, not a record-form layout. Write 'vertical', or omit "
    + "`layout` ('vertical' is the renderer default). "
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.'],
]);

/**
 * `object-form` (objectui `plugin-form/src/ObjectForm.tsx` @ `eb7f586b`, plus
 * the sub-forms it forwards the whole bag into: `TabbedForm`, `WizardForm`,
 * `SplitForm`, `DrawerForm`, `ModalForm` — the declared set is the UNION of
 * their `schema.*` reads, which is how `description` earns its place: the
 * top-level key is read by the drawer/modal presentations, not by the simple
 * form). Enum values are declared only where renderer, registry `inputs` and
 * designer palette agree. Callbacks (`onSuccess`, `submitHandler`, …) and the
 * controlled `open` state are React-tier props, not authorable metadata — the
 * react tier publishes those separately (`react-blocks.ts`).
 *
 * `layout` is the one enum that entered through two declarations and not a
 * read: at `eb7f586b` the registry `inputs` and the designer palette offered
 * `inline` and `grid`, but the renderer leg never agreed — `ObjectForm.tsx`
 * already folded both to `vertical`. Both are retired (ADR-0049 enforce-or-
 * remove, #20221); the `OBJECT_FORM_LAYOUT_RETIRED` comment block above
 * carries the measurement and the prescription each one gets.
 */
export const ObjectFormPropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-form`',
  history: objectBlockHistory('object-form'),
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  objectName: z.string().optional()
    .describe('Object this form creates/edits. Optional because the component-level `dataSource` binding can supply the object instead'),
  recordId: z.union([z.string(), z.number()]).optional().describe('Record to load (edit/view modes)'),
  mode: z.enum(['create', 'edit', 'view']).optional().describe('Form mode'),
  formType: z.enum(['simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal']).optional()
    .describe('Form presentation'),
  layout: z.enum(['vertical', 'horizontal'], {
    error: (issue) =>
      typeof issue.input === 'string' ? OBJECT_FORM_LAYOUT_RETIRED.get(issue.input) : undefined,
  }).optional()
    .describe("Field layout — 'vertical' (the renderer default) or 'horizontal'. Multi-column is not a layout value: set `columns`"),
  columns: z.number().optional().describe('Number of field columns (multi-column forms), honoured under either `layout`'),
  fields: z.array(z.unknown()).optional().describe('Limit/order the fields shown'),
  customFields: z.unknown().optional().describe('Custom field definitions merged into the generated set'),
  sections: z.array(z.unknown()).optional()
    .describe('Form sections ({ label, description?, fields } — wizard steps / tab panes)'),
  title: I18nLabelSchema.optional().describe('Form title'),
  description: I18nLabelSchema.optional().describe('Form description (rendered by the drawer/modal presentations)'),
  defaultTab: z.string().optional().describe('Initially active tab (tabbed)'),
  tabPosition: z.enum(['top', 'bottom', 'left', 'right']).optional().describe('Tab strip position (tabbed)'),
  allowSkip: z.boolean().optional().describe('Allow skipping steps (wizard)'),
  showStepIndicator: z.boolean().optional().describe('Show the step indicator (wizard)'),
  splitDirection: z.enum(['horizontal', 'vertical']).optional().describe('Split direction (split)'),
  splitSize: z.number().optional().describe('Split panel size in percent (split)'),
  splitResizable: z.boolean().optional().describe('Allow resizing the split (split)'),
  drawerSide: z.enum(['top', 'bottom', 'left', 'right']).optional().describe('Drawer side (drawer)'),
  drawerWidth: z.union([z.string(), z.number()]).optional().describe('Drawer width (drawer)'),
  modalSize: z.enum(['sm', 'default', 'lg', 'xl', 'full']).optional().describe('Modal size (modal)'),
  modalCloseButton: z.boolean().optional().describe('Show the modal close button (modal)'),
  contentLayout: z.unknown().optional().describe('Modal content layout config (modal)'),
  confirmOnDiscard: z.boolean().optional().describe('Confirm before discarding edits (drawer/modal)'),
  submitText: I18nLabelSchema.optional().describe('Submit button label'),
  cancelText: I18nLabelSchema.optional().describe('Cancel button label'),
  nextText: I18nLabelSchema.optional().describe('Next-step button label (wizard)'),
  prevText: I18nLabelSchema.optional().describe('Previous-step button label (wizard)'),
  showSubmit: z.boolean().optional().describe('Show the submit button'),
  showCancel: z.boolean().optional().describe('Show the cancel button'),
  showReset: z.boolean().optional().describe('Show the reset button'),
  submitBehavior: z.unknown().optional()
    .describe("What happens after a successful submit ({ kind: 'thank-you' | …, title?, message? })"),
  successMessage: I18nLabelSchema.optional().describe('Toast message on successful submit'),
  resetOnSuccess: z.boolean().optional().describe('Reset the form after a successful submit'),
  navigateOnSuccess: z.unknown().optional().describe('Navigate after a successful submit'),
  readOnly: z.boolean().optional().describe('Render every field read-only'),
  initialValues: z.record(z.string(), z.unknown()).optional().describe('Prefill values (create mode)'),
  initialData: z.record(z.string(), z.unknown()).optional().describe('Alternate spelling of `initialValues` the renderer also reads'),
  mobile: z.unknown().optional().describe('Mobile presentation overrides'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectFormProps = z.input<typeof ObjectFormPropsSchema>;

// `formType` old-vocabulary prescriptions (#11873; the objectui#5939
// measurement). Declared with `//` on purpose — the `LIST_VIEW_EXPORT_PDF_RETIRED`
// placement note applies here too: build-docs takes a file's first JSDoc per
// exported symbol, and these need no doc page. This is an enum-VALUE
// narrowing, so there is no `retiredKey()` tombstone to hang the prescription
// on — the enum's own error map carries it, keyed on `issue.input` so only
// the four sibling-block spellings an author would plausibly carry over from
// `object-form` get a prescription (the `record:chatter` `position`
// precedent, #8762). A never-vocabulary string (`'wizzard'`) gets zod's own
// enum refusal — which is the fix's whole point: under the old `z.string()`
// it parsed clean, matched no renderer branch, and rendered a silently
// sectionless parent form. No ADR-0087 conversion is registered here: unlike
// #8762 (whose old set was the schema's own declared vocabulary and default),
// these four names were never this block's declared vocabulary — the key was
// a bare `z.string()` — and the authored-value census on both repos (this
// repo + objectui#5939's) found zero occurrences to rewrite.
const MASTER_DETAIL_FORM_TYPE_RETIRED: ReadonlyMap<string, string> = new Map([
  ['wizard', "'wizard' is not part of `object-master-detail-form` `formType` — the renderer "
    + 'was measured on both repos: only the current wizard step\'s fields mount and the block\'s single '
    + "Save bar acts as the wizard's Next, so parent + details never save through the atomic batch "
    + "(ADR-0001, the block's whole contract). Write 'simple' (sections render stacked) or 'tabbed'; "
    + "for a wizard without inline details author an `object-form`, where 'wizard' is honoured."],
  ['split', "'split' is not part of `object-master-detail-form` `formType` — the renderer "
    + 'was measured on both repos: the parent half renders inline but persists via `dataSource.create`, '
    + "bypassing the atomic parent+details batch (ADR-0001, the block's whole contract). Write "
    + "'simple' or 'tabbed'; for a split presentation without inline details author an "
    + "`object-form`, where 'split' is honoured."],
  ['drawer', "'drawer' is not part of `object-master-detail-form` `formType` — the renderer "
    + 'was measured on both repos: the parent half renders in a portal dialog outside the master-detail '
    + "container, so the block's Save bar has no form to submit. Write 'simple' or 'tabbed'; for a "
    + "drawer overlay without inline details author an `object-form`, where 'drawer' is honoured."],
  ['modal', "'modal' is not part of `object-master-detail-form` `formType` — the renderer "
    + 'was measured on both repos: the parent half renders in a portal dialog outside the master-detail '
    + "container (the same portal shape as 'drawer'), so the block's Save bar has no form to "
    + "submit. Write 'simple' or 'tabbed'; for a modal overlay without inline details author an "
    + "`object-form`, where 'modal' is honoured."],
]);

/**
 * [#20928] What `details: z.array(z.unknown())` cost: the block's detail entries
 * were the third carrier of the inline grid column, beside a relationship
 * field's `inlineColumns` and a form view's `subforms[].columns`, and the only
 * one nothing judged. An entry key the renderer does not read, a grid column
 * key the grid does not read, and `scale` on a `currency` column — refused on
 * both other carriers under ruling B on #19629 (5791803339) and remedy 乙 on
 * #19910 (5805782503) — all published green here.
 */
const MASTER_DETAIL_DETAIL_HISTORY =
  'Until this shape was closed a detail entry parsed as `z.unknown()` — a key the renderer does '
  + 'not read published clean and was ignored in silence.';

/**
 * One `object-master-detail-form` detail collection (#20928) — STRICT, and
 * exactly the twelve keys objectui's `MasterDetailForm` reads off an entry
 * (`packages/plugin-form/src/MasterDetailForm.tsx`, its
 * `MasterDetailDetailConfig` and every `d.<key>` read in the file, read at the
 * `.objectui-sha` pin `31971ff1e28f`). A key nobody reads is not declared.
 *
 * `columns` IS {@link InlineGridColumnSchema}, the same object a relationship
 * field's `inlineColumns` and a form view's `subforms[].columns` take: the
 * renderer hydrates an authored list with the same `hydrateColumns` and draws
 * it in the same grid, so every rule the column carries holds here too, with
 * its own prescription. A column that declares no `type` takes it from the
 * child field when the grid hydrates it, which this schema cannot see;
 * `defineStack`'s cross-reference check judges that resolved type
 * (`collectHydratedInlineColumnErrors` in `stack.zod.ts`).
 *
 * The keys the entry shares with a form view's `subforms[]` entry take that
 * entry's types and alias table, so one concept is spelled one way on both
 * child-collection surfaces. The three it adds are the renderer's own:
 * `formFields` (the per-row expand form), `inlineMode` (the two form factors
 * a relationship field's `inlineEdit` names; absence takes the relationship's
 * own resolution) and `sortField` (the line-position field the grid stamps on
 * drag-reorder). `title` and `addLabel` are plain strings because the
 * renderer draws them as a React child and a button label without resolving a
 * locale map.
 *
 * A factory called inside {@link ObjectMasterDetailFormPropsSchema}'s own lazy
 * body, the way a form view's `subforms[]` entry is built inline in its
 * parent's: a standalone `lazySchema` here would be a function-typed proxy that
 * nothing exports, which the schema-graph walks (`alias-integrity.test.ts`)
 * never descend into, so its alias table would go unjudged.
 */
function masterDetailDetailEntry() {
  return strictObject({
    surface: 'this `object-master-detail-form` detail entry',
    history: MASTER_DETAIL_DETAIL_HISTORY,
    aliases: {
      object: 'childObject', childObjectName: 'childObject', child: 'childObject',
      foreignKey: 'relationshipField', relationField: 'relationshipField', parentField: 'relationshipField',
      fields: 'columns', label: 'title', sumField: 'amountField', rollupField: 'totalField',
    },
  }, {
    childObject: z.string().describe('Child object whose records are entered inline'),
    relationshipField: z.string().optional().describe('FK on the child pointing back to the parent (auto-detected from the child\'s master_detail/lookup field when omitted)'),
    columns: z.array(InlineGridColumnSchema).optional().describe("Editable grid columns (derived from the child object when omitted). Each entry is the strict, name-keyed inline grid column a relationship field's `inlineColumns` takes ({ name, label?, type?, … } — objectui GridColumn); identity-only entries ({ name }) hydrate everything else from the child object's fields. Unknown keys and the retired `field` spelling are refused at parse."),
    formFields: z.array(z.string()).optional().describe("Child field names for the per-row expand form (derived from the child object's editable fields when omitted)"),
    inlineMode: z.enum(['grid', 'form']).optional().describe("Inline-edit form factor: 'grid' = editable cells; 'form' = read-only list + per-row full form. Resolved from the relationship field's `inlineEdit` when omitted"),
    amountField: z.string().optional().describe('Numeric child column summed for the running total'),
    sortField: z.string().optional().describe('Child field holding the line sort position, stamped on drag-reorder (derived from a `position` / `sort_order` / … field when omitted)'),
    totalField: z.string().optional().describe('Parent field to receive the rolled-up sum'),
    title: z.string().optional().describe('Section title'),
    minRows: z.number().optional().describe('Minimum number of rows'),
    maxRows: z.number().optional().describe('Maximum number of rows'),
    addLabel: z.string().optional().describe('Add-row button label'),
  });
}

/**
 * `object-master-detail-form` (objectui `plugin-form/src/MasterDetailForm.tsx`
 * @ `eb7f586b`). Parent + child line items entered together (ADR-0001). The
 * child collections come from `details` — the FK and editable-grid columns
 * are auto-derived from the child object's metadata (`deriveMasterDetail.ts`),
 * so `details[].columns` is an override, not a requirement. Each entry is the
 * strict {@link masterDetailDetailEntry} since #20928.
 *
 * `formType` speaks the MEASURED vocabulary — `simple` / `tabbed` — since
 * #11873 (the spec half of objectui#5939, which tightened the objectui
 * registry declaration to the same pair on the same measurement, corroborated
 * by objectui's own two declarations: `MasterDetailFormSchema.formType?:
 * 'simple' | 'tabbed'` and the `formType === 'tabbed' ? 'tabbed' : 'simple'`
 * coercion). The key was a bare `z.string()`, so a value outside the
 * renderer's vocabulary (`'wizzard'`) parsed clean, matched no branch, and
 * the parent half fell through to a flat field list — authored sections
 * silently disappeared with no diagnostic (the objectui#3840 probe read GREEN
 * through a real crash this way). The four `object-form` spellings that do
 * name renderer branches (`wizard`/`split`/`drawer`/`modal`) each break the
 * block's atomic parent+details contract and refuse with a per-value
 * prescription ({@link MASTER_DETAIL_FORM_TYPE_RETIRED}). objectui#6176
 * (`tabbed` presentationally honoured but escaping the atomic batch) is a
 * renderer defect tracked there — it does not change this vocabulary.
 */
export const ObjectMasterDetailFormPropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-master-detail-form`',
  history: objectBlockHistory('object-master-detail-form'),
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  objectName: z.string().optional()
    .describe('PARENT object. Optional because the component-level `dataSource` binding can supply the object instead'),
  recordId: z.union([z.string(), z.number()]).optional().describe('Parent record to load (edit mode)'),
  mode: z.enum(['create', 'edit']).optional().describe('Form mode'),
  formType: z.enum(['simple', 'tabbed'], {
    error: (issue) =>
      typeof issue.input === 'string' ? MASTER_DETAIL_FORM_TYPE_RETIRED.get(issue.input) : undefined,
  }).optional().describe("Parent form presentation — the two variants the renderer honours for the parent half"),
  sections: z.array(z.unknown()).optional().describe('Parent form sections'),
  fields: z.array(z.unknown()).optional().describe('Parent fields shown'),
  details: z.array(masterDetailDetailEntry()).optional()
    .describe('Detail collections — each a strict entry ({ childObject, title?, addLabel?, columns?, relationshipField?, … }) whose `columns` are the inline grid columns a relationship field\'s `inlineColumns` takes; the FK and columns auto-derive from child metadata when omitted'),
  title: I18nLabelSchema.optional().describe('Form title'),
  submitText: I18nLabelSchema.optional().describe('Submit button label'),
  cancelText: I18nLabelSchema.optional().describe('Cancel button label'),
  showSubmit: z.boolean().optional().describe('Show the submit button'),
  initialValues: z.record(z.string(), z.unknown()).optional().describe('Prefill values for the parent (create mode)'),
  initialData: z.record(z.string(), z.unknown()).optional().describe('Alternate spelling of `initialValues` the renderer also reads'),
  taxRateField: z.string().optional().describe('Child field holding the per-line tax rate (line-items totals)'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectMasterDetailFormProps = z.input<typeof ObjectMasterDetailFormPropsSchema>;
/**
 * Post-parse shape of {@link ObjectMasterDetailFormProps} — defaults applied,
 * transforms run (ADR-0122). #20928 — `details[].columns` now carries
 * `InlineGridColumnSchema`, whose own input ≠ infer (its `readonlyWhen` /
 * `requiredWhen` bare-string predicates normalize to Expression envelopes,
 * which is why `InlineGridColumnParsed` exists). So the block leaves the
 * type-alias convention pin's isomorphic family (its Iso line deleted with
 * this alias), taking the `ObjectGridPropsParsed` route its comment prescribes.
 */
export type ObjectMasterDetailFormPropsParsed = z.infer<typeof ObjectMasterDetailFormPropsSchema>;

/**
 * The flat per-field spellings `ObjectMap` reads as the ObjectView / ListView
 * flatten product (`getMapConfig` branch 2, `ObjectMap.tsx:382-396`) and that
 * both view layers EMIT (`plugin-view/src/ObjectView.tsx` and
 * `plugin-list/src/ListView.tsx`, `case 'map'`, which spread `options.map`'s
 * CONTENTS at the top level and carry no `map` key at all). Read, but NOT
 * authorable: the maintainer ruled that shape an internal transport form rather
 * than a second authoring surface (objectui#5018, 2026-08-17), and the renderer
 * says so itself — when a `map` block is present it wins outright and every flat
 * key beside it is named as IGNORED in a dev warning
 * (`warnOnShadowedFlatMapKeys`). One composition key per concept (Prime
 * Directive #12), the same channel {@link ObjectCalendarPropsSchema} uses above.
 *
 * The member list is objectui's own `FLAT_MAP_CONFIG_KEYS` — `ObjectMapConfig`'s
 * keys minus `style` — and `component.test.ts` holds it equal to the spec's own
 * {@link ListMapConfigSchema} shape minus that same `style`, so a key added to
 * the config block on either face cannot leave this prescription behind.
 * `style` is subtracted on BOTH sides for one reason: flattened to the top level
 * it collides with `BaseSchema.style`, the node's inline CSS record — which is
 * why the renderer stopped reading a top-level `style` as a map style at all
 * (objectui#5017) and why the prescription below routes it to `mapStyle`.
 */
const OBJECT_MAP_FLAT_CONFIG_GUIDANCE: readonly KeySetGuidance[] = [
  ...COMPONENT_LEVEL_GUIDANCE,
  {
    name: 'OBJECT_MAP_FLAT_CONFIG_KEYS',
    keys: ['latitudeField', 'longitudeField', 'locationField', 'titleField', 'descriptionField', 'zoom', 'center'],
    examples: ['latitudeField', 'titleField'],
    prescription:
      'Write this as a key of the `map` config object instead — `map: { latitudeField, longitudeField, '
      + 'locationField, titleField, descriptionField, zoom, center }`. The flat spelling is the internal '
      + 'form `ObjectView`/`ListView` produce when they flatten `options.map`, not a second authoring '
      + 'spelling: whenever a `map` block is present the renderer takes it whole and names every flat key '
      + 'beside it as ignored. The map STYLE is the top-level `mapStyle` (or `map.style`) — never `style`, '
      + "which is the component node's inline CSS record.",
  },
];

/**
 * `object-map` (objectui `plugin-map/src/ObjectMap.tsx` plus the registry shell
 * `plugin-map/src/index.tsx`, read at the pin this repo builds against —
 * `.objectui-sha` = `31971ff1e`, re-measured there 2026-10-01: `ObjectMap.tsx`
 * and `core/src/utils/record-source.ts` are byte-identical to `e420df310`, so
 * every anchor in them holds unmoved and was re-read in place; `index.tsx`
 * changed (+7/-3, objectui#10859 batch 5: the comment above the registration
 * and the `objectName` input's description now count the node's
 * `dataSource` binding), the `map` input MOVING `:97` -> `:101`
 * byte-identical. At `e420df310` (2026-09-30) all three files
 * changed across the hop from `db11afd49`, so every anchor was re-mapped
 * through the diff and re-READ. `ObjectMap.tsx` (+16/-17, objectui#8348)
 * changed only in the record-source docblock above `getDataConfig`, one line
 * shorter, so every anchor from `:186` on MOVED up one line with its cited
 * text byte-identical and `:155-162` did not move; `index.tsx` (+10/-0,
 * objectui#8220) gained a comment above the registration and `filter` /
 * `sort` inputs after `map`, whose own input MOVED `:89` -> `:97`
 * byte-identical; `record-source.ts` (+38/-27,
 * objectui#8348 moving the tree tags to `view-data`) MOVED the three rungs
 * by 8, byte-identical. ⚠️ One CONTENT change, and it corrects this record:
 * the carrier paragraph `:173-181` is rewritten (`:174-180` now), and says
 * what objectui#9571 had already made true before `db11afd49` — the
 * `SchemaRenderer` spread that carried an authored `data` array to this
 * renderer as a React prop was stopped for object-arm blocks, so an authored
 * array no longer draws through `SchemaRenderer` at all; only a HOST's own
 * `data` prop does. The `data` entry below says so. At `db11afd49`
 * (2026-09-29) `ObjectMap.tsx`,
 * `index.tsx` and `core/src/utils/record-source.ts` were all byte-identical to
 * `dd3f7e1be`, so every anchor held unmoved and was re-checked in place.
 * At `dd3f7e1be` (2026-09-28) all three of
 * `ObjectMap.tsx` (+193/-72), `index.tsx` (+62/-10) and
 * `core/src/utils/record-source.ts` (+27/-20) changed across the hop from
 * `f8a9d0fb0`, so every anchor was re-mapped through the diff and re-READ.
 * Most MOVED with their cited text byte-identical — by 5 lines through
 * `:409` in `ObjectMap.tsx` and by 117 to 122 after it, by 7 in
 * `record-source.ts`, whose changes are docblocks and the retired bare `map`
 * arm. THREE changed CONTENT and say so where they are cited: the `filter`
 * handoff (objectui#10666), one `objectName` dependency key that left with
 * the metadata effect it belonged to (objectui#10664), and the second
 * registration's `map` input, which left with the bare `map` node type
 * (objectui#10393). At `f8a9d0fb0` all three files were byte-identical to
 * `62597c588` (`git diff --quiet`), so every anchor held unmoved from the
 * re-READ taken there 2026-09-23. `ObjectMap.tsx`
 * changed across the hop from `87af769e9` only in `warnOnTopLevelStyleUrl`'s
 * docblock and dev-warning text (objectui `2252653d0`, +27/-8, which names
 * the flat `mapStyle` spelling the flatten really carries), so no read point
 * changed and every anchor from `:289` on MOVED 16-19 lines with its cited
 * text byte-identical; those above it and `index.tsx` did not move. ⛔ No
 * anchor below is carried: each was re-mapped through the diff and re-read.
 * At `87af769e9` (2026-09-22) none was carried from `53ded82bf` either, and
 * one of them is a read that no longer exists rather than a number that
 * moved.)
 * Read points per key: `data` (`:186-187` — `getDataConfig` is now that one
 * `resolveRecordSourceConfig(schema, 'view-data')` call, rung 1 of the ruled
 * record-source ladder, `core/src/utils/record-source.ts:307`. ⚠️ The
 * array-shorthand head this record used to cite beside it is GONE, deleted on
 * objectui#8348 — `:155-162` records the deletion and `:174-180` records the
 * carrier that used to survive it and no longer does: objectui#9571 stopped
 * `SchemaRenderer` spreading an authored `data` array onto object-arm blocks
 * as a React prop, so an authored array reaches this renderer neither through
 * the ladder nor through the props channel; only a host's own `data` prop
 * does. Until `db11afd49` this record said the props channel still carried
 * it, reading an objectui docblock that was itself stale),
 * `staticData` (rung 2,
 * `record-source.ts:311`), `objectName` (rung 3, `record-source.ts:318`; also
 * here at `:1183`, the `useNavigationOverlay` binding, and as a cache key at
 * `:240`, `:243`, `:318` and `:364`. ⚠️ The dependency-key read this record
 * cited at `:965` is GONE at this pin: objectui#10664 replaced the metadata
 * effect whose dependency list it was with `useSettledSchema` (`:795-798`),
 * keyed on the ladder's `recordSourceObjectName` (`:769`), so the object is
 * still read there, only no longer through that list),
 * `filter` (`:857`, read once through `useResolvedFilter`, which resolves its
 * context tokens — objectui#10666 — and holds the result, which `:951` and
 * `:1030` hand to `$filter` on the inline and the object fetch respectively;
 * at `f8a9d0fb0` both handed `schema.filter` verbatim),
 * `sort` (`:952` and `:1031`, through the shared `convertSortToQueryParams` sink
 * to `$orderby`), `map` (`:405` — `getMapConfig` branch 1, the author face and
 * the registration's declared `{ name: 'map', type: 'object' }` input,
 * `plugin-map/src/index.tsx:101`; the second copy this record cited at `:78`
 * belonged to the bare `map` registration, retired on objectui#10393, so
 * `object-map` is now the one registration declaring it), `mapStyle`
 * (`:400`, `schema.mapStyle || schema.map?.style`), `navigation` (`:1182`) and
 * `enableClustering` (`:1198`).
 *
 * Measured and deliberately NOT declared:
 *
 *  - the flat `map`-config spellings — the ObjectView/ListView flatten product,
 *    ruled an internal transport form (objectui#5018). They get
 *    {@link OBJECT_MAP_FLAT_CONFIG_GUIDANCE}'s wrong-layer prescription.
 *  - `style`. `ObjectMap.tsx:315`, inside `warnOnTopLevelStyleUrl` (`:309`),
 *    reads it only to say it is NOT consumed as a map style (objectui#5017):
 *    it is `BaseSchema.style`, the node's inline CSS
 *    record, and `COMPONENT_NODE_KEYS` above already sends it back to the node.
 *  - `clusterRadius`, `data` as an ARRAY, `onMarkerClick` / `onRowClick` /
 *    `onEdit` / `onDelete`, `className` and `dataSource` — React props of
 *    `ObjectMapProps`, host-injected, never authored metadata.
 *
 * VALUE posture for `map`: {@link ListMapConfigSchema}, this repo's own block —
 * the later value ratchet the previous posture here deferred, taken now that the
 * one-key gap is closed. `:408` validates the authored block against objectui's
 * `ObjectMapConfigSchema` and this block declares the same eight keys, `style`
 * included; until that declaration landed the door had to stay `z.unknown()`,
 * because pointing it at a schema missing `style` would have refused a value
 * `getMapConfig` honours at `:400` (`schema.mapStyle || schema.map?.style`).
 * `mapStyle` above is unaffected: it stays the component-level spelling read
 * FIRST, and is not a member of the config block.
 */
export const ObjectMapPropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-map`',
  history: objectBlockHistory('object-map'),
  guidanceSets: OBJECT_MAP_FLAT_CONFIG_GUIDANCE,
  aliases: FILTERS_TO_FILTER,
}, {
  objectName: z.string().optional()
    .describe('Object this map binds to — the THIRD record source `getDataConfig` resolves, after `data` and `staticData`. Optional because the component-level `dataSource` binding can supply the object instead'),
  /**
   * Data source binding — `ViewDataSchema`, the same object arm `object-grid`
   * declares above. Derived from the read point, not from objectui's mirror:
   * rung 1 of `resolveRecordSourceConfig` returns `schema.data` VERBATIM as the
   * record-source config, and `ViewData` is what every consumer of that return
   * value is typed against. (`ObjectMapSchema.data` on `@object-ui/types`
   * happens to spell it the same way — read after the derivation, as a check on
   * it, never as the source of it.)
   *
   * The bare-array shorthand is NOT declared: `ViewData` is a discriminated
   * union over OBJECT variants, so an array under `data` cannot be published,
   * and `staticData` below is this block's declared door for inline rows — the
   * renderer's own comment says so. ⚠️ At `87af769e9` the renderer no longer
   * normalizes it either: the head this record used to cite at
   * `ObjectMap.tsx:169-172` was deleted on objectui#8348, and `:168-176` is
   * now the note that an authored array reaches the component on the React
   * props channel alone.
   */
  data: ViewDataSchema.optional()
    .describe("Data source binding (ViewDataSchema — discriminated on `provider`: object | api | value | schema), read FIRST by `getDataConfig`. Static inline rows live at `{ provider: 'value', items: [...] }` or at `staticData`; the bare-array shortcut is refused"),
  staticData: z.array(z.unknown()).optional()
    .describe("Inline records — read SECOND by `getDataConfig`, wrapped into a `{ provider: 'value' }` config"),
  /**
   * Base query filter — the `ViewFilterRule` ARRAY form, the one filter
   * orthography every `filter` door in this map shares (ui#6206-B reaching the
   * `object-*` family: #15449, decision batch #55, option A). Measured at the
   * pin this repo builds against (`.objectui-sha` = `31971ff1e`, re-READ there
   * 2026-10-01: `ObjectMap.tsx` is byte-identical to `e420df310`, so all three
   * anchors held unmoved, and `plugin-map/src/index.tsx` changed above its
   * inputs (objectui#10859 batch 5), the `filter` input MOVING `:100` ->
   * `:104` byte-identical. At `e420df310`, re-READ there
   * 2026-09-30: `ObjectMap.tsx` changed only in the record-source docblock
   * above both anchors, one line shorter (objectui#8348), so each MOVED up one
   * line with its text byte-identical, `:858` -> `:857`, `:952` -> `:951` and
   * `:1031` -> `:1030`; and objectui#8220 now publishes a `filter` input on the
   * `object-map` registration in this same rule-array form, `type: 'array'`
   * (`plugin-map/src/index.tsx:100`). At `db11afd49`, re-READ there
   * 2026-09-29: `ObjectMap.tsx` is byte-identical to `dd3f7e1be`, so both anchors
   * held unmoved; at `dd3f7e1be`, re-READ there
   * 2026-09-28 — `ObjectMap.tsx` changed on this hop, and so did the CONTENT
   * of both anchors: objectui#10666 put a resolution step in front of them, so
   * `schema.filter` is now read once, through `useResolvedFilter`, which
   * resolves its context tokens (`{current_user_id}`, the date macros) and
   * holds the result, and both fetches send that held value instead of
   * `schema.filter` verbatim. At `f8a9d0fb0`, byte-identical to `62597c588`
   * and re-READ there 2026-09-23, both anchors had MOVED 19 lines from
   * `:814` / `:895` with their text byte-identical, that hop changing only a
   * docblock and a dev warning above them): `ObjectMap.tsx:857` reads
   * `schema.filter`, and `:951` and `:1030` hand it, tokens resolved, to
   * `$filter` on the inline and the object fetch, where the adapter lowers a
   * rule array exactly as it does for the kanban and the calendar. The record
   * form is refused at `filter`.
   */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `object-map`',
      migration: 'element-data-source-and-object-block-filter-rule-array',
    }),
  }).optional()
    .describe('Base query filter — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` door in this map shares; lowered to the wire `$filter`. The MongoDB-style record form is refused — see migration `element-data-source-and-object-block-filter-rule-array`'),
  /**
   * Marker order — the `SortItem` ARRAY form, the one sort orthography every
   * DECLARED `sort` door on this platform carries (objectui#8221, decision batch
   * #77, option B). Measured at the pin this repo builds against
   * (`.objectui-sha` = `31971ff1e`, re-READ there 2026-10-01 — `ObjectMap.tsx`
   * is byte-identical to `e420df310`, so both anchors held unmoved, and
   * `plugin-map/src/index.tsx` changed above its inputs (objectui#10859 batch
   * 5), the `sort` input MOVING `:101` -> `:105` byte-identical. At
   * `e420df310`, re-READ there 2026-09-30 — `ObjectMap.tsx`
   * changed only in the record-source docblock above both anchors, one line
   * shorter (objectui#8348), so both MOVED up one line with their text
   * byte-identical, `:953` -> `:952` and `:1032` -> `:1031`; and
   * `plugin-map/src/index.tsx` CHANGED what this record says about it:
   * objectui#8220 declared a `sort` input on the `object-map` registration,
   * `type: 'array'` in this same `[{ field, order }]` form (`:101`). At
   * `db11afd49`, re-READ there 2026-09-29 — `ObjectMap.tsx`
   * and `plugin-map/src/index.tsx` are byte-identical to `dd3f7e1be`, so both
   * anchors held unmoved; at `dd3f7e1be`, 2026-09-28, `ObjectMap.tsx`
   * and `plugin-map/src/index.tsx` both changed on this hop; both anchors
   * MOVED with their text byte-identical, `:834` -> `:953` and `:915` ->
   * `:1032`, and the `object-map` registration, which gained `data` and
   * `staticData` inputs (objectui#10394) while its bare `map` twin was
   * retired (objectui#10393), still declares no `sort`. At `f8a9d0fb0` both files were byte-identical
   * to `62597c588`, re-READ there 2026-09-23 — both anchors had MOVED 19
   * lines from `:815` / `:896` with their text byte-identical):
   * `ObjectMap.tsx:952` and `:1031`
   * hand `schema.sort` to the shared `convertSortToQueryParams` sink as the
   * fetch's `$orderby` — the same sink `object-grid` and `object-calendar`
   * declare against, so the legacy string clause is refused here for the same
   * ruling. Through `db11afd49` `plugin-map/src/index.tsx` declared no `sort`
   * input at all; since objectui#8220 it declares one in this array form
   * (`:105`), so the registry and this door agree.
   */
  sort: z.array(SortItemSchema).optional()
    .describe('Marker order for the fetched records — the SortItem array form `[{ field, order }, ...]`, the one sort orthography every declared `sort` door on this platform shares; lowered to the wire `$orderby`. The legacy string clause (`name desc`) is refused — see migration `object-block-sort-item-array`'),
  map: ListMapConfigSchema.optional()
    .describe('Map field config, the author face — the same block `ListViewSchema.map` declares, and the one the renderer validates this node against. Taken WHOLE when present: the flat top-level spelling beside it is ignored'),
  mapStyle: z.string().optional()
    .describe('MapLibre style URL or spec, overriding the public demo tiles. Read before `map.style`; NOT the base node `style`, which is an inline CSS record'),
  navigation: z.unknown().optional()
    .describe('Marker-click navigation config ({ mode: page | drawer | modal | split | popover | new_window | none }) — all seven `NavigationModeSchema` values, since the shared `useNavigationOverlay` hook types its own mode union as that schema'),
  enableClustering: z.boolean().optional()
    .describe('Group nearby markers into clusters. Absent, the renderer clusters only above 100 markers'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectMapProps = z.input<typeof ObjectMapPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state — `filter` carries
 * `z.array(ViewFilterRuleSchema)` (`operator` normalizes on parse) and `data`
 * carries `ViewDataSchema`, so this block leaves the type-alias convention pin's
 * default-free family the way `object-grid` did.
 */
export type ObjectMapPropsParsed = z.infer<typeof ObjectMapPropsSchema>;

/**
 * The flat `GanttConfig` spellings `getGanttConfig`'s branch 2 reads
 * (`ObjectGantt.tsx:513-543`) and that `ObjectView` / `ListView` EMIT when they
 * flatten `options.gantt` — objectui's own `FLAT_GANTT_CONFIG_KEYS`. Read, but
 * NOT authorable, for the reason the map's twin set above records: objectui#6469
 * inherited the objectui#5018 ruling for this block, so the `gantt` block is the
 * authoring shape, it is taken WHOLE when present, and every flat key beside it
 * is named as ignored in a dev warning.
 *
 * The flat branch is the HOT path for this block — a hand-authored `gantt` block
 * reaching the renderer through either view layer has already been flattened —
 * which is exactly why the prescription matters here: an author who learned the
 * flat spelling from a view config (or from `@object-ui/types`'
 * `ObjectGanttSchema`, which declares the whole flat face) writes it on an SDUI
 * node next, where nothing flattens anything.
 *
 * Membership is `GanttConfigSchema`'s own shape plus the legacy singular
 * `dependencyField` alias the flat branch still reads beside `dependenciesField`
 * — the same two halves objectui derives its list from. Spelled out rather than
 * read off `GanttConfigSchema.shape` here because that schema is a
 * {@link lazySchema} proxy and forcing it at module load would build `view.zod`
 * mid-initialisation (the import-cycle footgun `ruleArrayFilterError` defers
 * around); `component.test.ts` holds the list equal to the shape instead.
 */
const OBJECT_GANTT_FLAT_CONFIG_GUIDANCE: readonly KeySetGuidance[] = [
  ...COMPONENT_LEVEL_GUIDANCE,
  {
    name: 'OBJECT_GANTT_FLAT_CONFIG_KEYS',
    keys: [
      'assigneeField', 'autoZoomToFilter', 'baselineEndField', 'baselineStartField', 'borderColorField',
      'capacity', 'colorField', 'defaultCollapsedDepth', 'dependenciesField', 'dependencyField',
      'dependencyTypes', 'effortField', 'endDateField', 'exportFileName', 'groupByField', 'interactions',
      'lockField', 'objectField', 'parentField', 'progressField', 'quickFilters', 'resourceView',
      'startDateField', 'summaryExtent', 'timeSegments', 'timeZone', 'titleField', 'tooltipFields',
      'typeField', 'viewMode',
    ],
    examples: ['startDateField', 'endDateField', 'viewMode'],
    prescription:
      'Write this as a key of the `gantt` config object instead — `gantt: { startDateField, endDateField, '
      + 'titleField, ... }`. The flat top-level spelling is the internal form `ObjectView`/`ListView` '
      + 'produce when they flatten `options.gantt`, not a second authoring spelling: whenever a `gantt` '
      + 'block is present the renderer takes it WHOLE and names every flat key beside it as ignored. The '
      + 'legacy singular `dependencyField` is `dependenciesField` inside that block.',
  },
];

/**
 * `object-gantt` (objectui `plugin-gantt/src/ObjectGantt.tsx` plus the registry
 * shell `plugin-gantt/src/index.tsx`, read at the pin this repo builds against
 * — `.objectui-sha` = `31971ff1e`, re-measured there 2026-10-01:
 * `ObjectGantt.tsx` and `record-source.ts` are byte-identical to `e420df310`,
 * so every anchor in them holds unmoved and was re-read in place;
 * `plugin-gantt/src/index.tsx` changed (+3/-2, objectui#11117: the
 * `objectName` input's description and the comment above the registration
 * now count a `dataSource.object` binding), the `gantt` input MOVING `:145`
 * -> `:146` byte-identical. At `e420df310` (2026-09-30) all three
 * files changed across the hop from `db11afd49`, and every anchor was
 * re-mapped through the diff and re-READ; NONE changed content. `ObjectGantt.tsx`
 * +85/-26 (objectui#11141's inclusive date-only end, objectui#8348's
 * record-source ladder, objectui#11070's `reference` spelling), every anchor
 * MOVING with its cited text byte-identical — by 47 through `getGanttConfig`,
 * by 49 through the reload, by 51 through the layout key and by 59 after it;
 * `plugin-gantt/src/index.tsx` +10/-0 (objectui#8220: a comment and `filter` /
 * `sort` inputs, in the array forms this row declares), the `gantt` input
 * MOVING `:137` -> `:145`; `record-source.ts` +38/-27, the three rungs MOVING
 * by 8. At `db11afd49` (2026-09-29)
 * `plugin-gantt/src/index.tsx` and `record-source.ts` were byte-identical to
 * `dd3f7e1be`, and `ObjectGantt.tsx` changed (+14/-10: objectui#10866's
 * zoned-chart DST day read and write through `invertTo` / `invertFrom`, and
 * comment re-citations), the first insertion at `:391` and every later anchor
 * MOVED by 4 with its cited text byte-identical, none of the cited lines changing
 * content. At `dd3f7e1be` (2026-09-28) all three
 * files changed across the hop from `f8a9d0fb0` — `ObjectGantt.tsx` +285/-56
 * (in-place refresh on the invalidation bus, objectui#10035 / objectui#7237,
 * the core row ceiling, objectui#7508, objectui#10666's resolved filter,
 * objectui#10866's date-only days), `plugin-gantt/src/index.tsx` +19/-1
 * (`objectName` no longer a required input, objectui#7470) and
 * `record-source.ts` (docblocks and the retired bare `map` arm) — so every
 * anchor was re-mapped through the diff and re-READ. Two changed CONTENT and
 * say so where they are cited, the `filter` handoff and the row ceiling;
 * every other one MOVED (by 56 to 232 lines in `ObjectGantt.tsx`, `121` ->
 * `137` in `index.tsx`, by 7 in `record-source.ts`) with its cited text
 * byte-identical, and the retired `:1849` reading is a blank line at its new
 * `:2103` too. On the hop onto `f8a9d0fb0`, `plugin-gantt/src/index.tsx` and
 * `record-source.ts` were byte-identical to `62597c588` and `ObjectGantt.tsx`
 * changed (+29/-2, objectui#10250: the toolbar Search term, below) — those
 * above the insertion (`:501-503`, `:613`) did not move, and every later one
 * MOVED 21 or 29 lines with its cited text byte-identical (the retired `:1849`
 * reading was a blank line at `:1878`). All three files were
 * byte-identical across the hop onto `62597c588`. At `87af769e9`
 * (re-READ 2026-09-22) not one anchor below was carried from `53ded82bf`;
 * every number was re-derived from that tree, and the `label` one moved far
 * enough that the retired reading now lands in an unrelated callback.)
 * Read points per key: `data` (`resolveRecordSourceConfig` at
 * `:722` — rung 1, `core/src/utils/record-source.ts:307`), `staticData` (rung 2,
 * `record-source.ts:311`), `objectName` (rung 3; also `:1787` and `:1990` here),
 * `filter` (`:918`, read once through `useResolvedFilter`, which resolves its
 * context tokens — objectui#10666 — and `:1063` sends the held result to
 * `$filter`; at `f8a9d0fb0` it was sent verbatim), `sort` (`:1064`, through
 * `convertSortToQueryParams` to `$orderby`), `gantt` (`:610-612` —
 * `getGanttConfig` branch 1, the author face and the registration's declared
 * `{ name: 'gantt', type: 'object' }` input (`plugin-gantt/src/index.tsx:146`),
 * validated there against this
 * repo's own {@link GanttConfigSchema}), `navigation` (`:1923`), `label`
 * (`:2505`, resolved through `resolveInlineI18nLabel` for the export file
 * name — this record said `resolveI18nLabel`, which the line did not read at
 * `f8a9d0fb0` either —
 * ⚠️ the retired reading `:1849` was the comment ABOVE that chain and at this
 * pin `87af769e9` was a BLANK line (nothing cites `:1849` now), two above a dependency-delete callback's own comment,
 * so it is re-READ here, not re-pointed),
 * `skipWeekends` (`:1633`), `holidays` (`:1634`), `persistLayout` (`:1785`),
 * `viewName` (`:1787`), `markers` (`:2460`), `criticalPath` (`:2463`),
 * `showBaselines` (`:2466`), `readOnly` (`:2302` and `:2467`) and
 * `mobileReadOnly` (`:2468`).
 *
 * Measured and deliberately NOT declared: the flat `GanttConfig` spellings (the
 * flatten product — {@link OBJECT_GANTT_FLAT_CONFIG_GUIDANCE}); `title`, which
 * this renderer never reads (the export-name chain is `gantt.exportFileName` →
 * `label` → the OBJECT's label → `objectName`, `:2503-2509`); a row cap — the
 * reload's `$top` is the platform ceiling, spread in as core's
 * `nonGridRowCeilingQuery()` (`:1074`: one probe row past the ceiling, which
 * `applyNonGridRowCeiling` slices back off; at `f8a9d0fb0` a bare
 * `$top: NON_GRID_ROW_CEILING_TOP`, until objectui#7508 homed the ceiling in
 * core) and the renderer's own comment marks it "⛔ Not authorable" (`:1072`); and
 * the `onTaskClick` / `onRowClick` / `onBeforeTaskUpdate` callbacks, which are
 * host props. ⚠️ New at `f8a9d0fb0` and recorded, not ruled: objectui#10250
 * gave the renderer two more reads, `search` and `searchableFields`
 * (`:885-888`, sent as `$search` / `$searchFields` at `:1078-1083`), which
 * `ListView.tsx` writes onto the node it generates from its toolbar Search
 * box — a host-generated key pair in the same position as the flatten
 * product, and not declared here.
 *
 * VALUE posture: `gantt` is the one config block in this family whose value
 * contract is already the SPEC's — `ObjectGantt.tsx:612` validates it against
 * `GanttConfigSchema` imported from `@objectstack/spec/ui` — so the read point
 * names the schema and this door takes it rather than `z.unknown()`. The
 * scalars below are read as their coercions say: `!!schema.readOnly`,
 * `schema.showBaselines !== false`, `schema.persistLayout === false`,
 * `new Set(schema.holidays)`. `markers` stays `z.array(z.unknown())` — its
 * element contract is `GanttView`'s `GanttMarker`, still objectui's.
 */
export const ObjectGanttPropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-gantt`',
  history: objectBlockHistory('object-gantt'),
  guidanceSets: OBJECT_GANTT_FLAT_CONFIG_GUIDANCE,
  aliases: FILTERS_TO_FILTER,
}, {
  objectName: z.string().optional()
    .describe('Object this gantt binds to — the THIRD record source `resolveRecordSourceConfig` resolves, after `data` and `staticData`. Optional because the component-level `dataSource` binding can supply the object instead'),
  /**
   * Data source binding — `ViewDataSchema`, spelled exactly as `object-map`'s
   * and `object-grid`'s. Derived from the read point: rung 1 of
   * `resolveRecordSourceConfig` returns `schema.data` VERBATIM as the
   * record-source config the fetch resolves through `resolveDataSource`.
   */
  data: ViewDataSchema.optional()
    .describe("Data source binding (ViewDataSchema — discriminated on `provider`: object | api | value | schema), read FIRST by `resolveRecordSourceConfig`. Static inline rows live at `{ provider: 'value', items: [...] }` or at `staticData`; the bare-array shortcut is refused"),
  staticData: z.array(z.unknown()).optional()
    .describe("Inline records — read SECOND by `resolveRecordSourceConfig`, wrapped into a `{ provider: 'value' }` config"),
  /** Base query filter — the family's one `ViewFilterRule` array orthography (#15449). */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `object-gantt`',
      migration: 'element-data-source-and-object-block-filter-rule-array',
    }),
  }).optional()
    .describe('Base query filter — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` door in this map shares; lowered to the wire `$filter`. The MongoDB-style record form is refused — see migration `element-data-source-and-object-block-filter-rule-array`'),
  /** Task order — the platform's one `SortItem` array orthography (objectui#8221 option B). */
  sort: z.array(SortItemSchema).optional()
    .describe('Task order for the fetched bars — the SortItem array form `[{ field, order }, ...]`, the one sort orthography every declared `sort` door on this platform shares; lowered to the wire `$orderby`. The legacy string clause (`name desc`) is refused — see migration `object-block-sort-item-array`'),
  gantt: GanttConfigSchema.optional()
    .describe('Gantt-timeline configuration, the author face — the same block `ListViewSchema.gantt` declares, and the one the renderer validates this node against. Taken WHOLE when present: the flat top-level spelling beside it is ignored'),
  navigation: z.unknown().optional()
    .describe('Task-click navigation config ({ mode: page | drawer | modal | split | popover | new_window | none }) — all seven `NavigationModeSchema` values, since the shared `useNavigationOverlay` hook types its own mode union as that schema; renderer default `drawer`'),
  label: I18nLabelSchema.optional()
    .describe('Gantt label — the second link of the exported PNG/PDF file-name chain, after `gantt.exportFileName` and before the bound object\'s own label'),
  skipWeekends: z.boolean().optional()
    .describe('Measure duration and auto-schedule math in WORKING days, skipping Saturdays and Sundays'),
  holidays: z.array(z.string()).optional()
    .describe("Additional non-working dates for the working calendar, ISO `yyyy-mm-dd` strings; folded into a Set for the duration math"),
  persistLayout: z.boolean().optional()
    .describe('Opt OUT of layout and filter-chip persistence — only an explicit `false` disables it; the storage key is `objectName:viewName`'),
  viewName: z.string().optional()
    .describe("Layout-persistence scope, the second half of the `objectName:viewName` storage key (renderer default `'default'`)"),
  markers: z.array(z.unknown()).optional()
    .describe('Extra vertical reference lines drawn like the Today marker ({ date, label?, color? })'),
  criticalPath: z.boolean().optional()
    .describe('Seed the critical-path highlight ON; the toolbar toggle stays available either way'),
  showBaselines: z.boolean().optional()
    .describe('Render the planned-vs-actual baseline bars — ON unless an explicit `false` disables it'),
  readOnly: z.boolean().optional()
    .describe('Disable every write path on this gantt and lock the record drawer'),
  mobileReadOnly: z.boolean().optional()
    .describe('Auto read-only on narrow viewports — ON unless an explicit `false` disables it'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectGanttProps = z.input<typeof ObjectGanttPropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state — `filter` carries
 * `z.array(ViewFilterRuleSchema)` (`operator` normalizes on parse) and `data`
 * carries `ViewDataSchema`, so this block leaves the type-alias convention pin's
 * default-free family the way `object-grid` did.
 */
export type ObjectGanttPropsParsed = z.infer<typeof ObjectGanttPropsSchema>;

/**
 * The flat `TreeConfig` spellings `getTreeConfig` reads ahead of the `tree`
 * block (`ObjectTree.tsx:281-294`) and that `ObjectView` / `ListView` EMIT when
 * they flatten `options.tree` (`ListView.tsx:3756-3775`, `case 'tree'`: the
 * product carries these keys, the EFFECTIVE `filter` objectui#10250 added, and
 * NO `tree` key). Both halves re-READ at the
 * pin this repo builds against (`.objectui-sha` = `31971ff1e`) on 2026-10-01 —
 * `ObjectTree.tsx` is byte-identical to `e420df310`, so `281-294` and
 * `233-254` did not move; `ListView.tsx` changed above its `case 'tree'` arm
 * (+35/-1, objectui#10689's re-read on a harvested query input), which MOVED
 * byte-identical `3722-3741` -> `3756-3775`, so the flat key set each reads or
 * emits did not move. At `e420df310`, 2026-09-30 —
 * `ObjectTree.tsx` changed (+29/-26, objectui#8348's record-source arm and the
 * host-data read below it), none of it inside `281-294` or `233-254`, which did
 * not move; `ListView.tsx` changed above its `case 'tree'` arm (objectui#11021
 * among others), which MOVED byte-identical `3668-3687` -> `3722-3741`, so the
 * flat key set each reads or emits did not move. At `db11afd49`, 2026-09-29 —
 * `ObjectTree.tsx` changed in one comment line (`:1054`) and `ListView.tsx` in
 * comment citations and its region-aria read, none of it inside these ranges, so
 * `281-294` and `3668-3687` did not move; measured at `dd3f7e1be` on
 * 2026-09-28 — both files changed on this hop (`ObjectTree.tsx` +136/-30,
 * `ListView.tsx` +434/-85), neither inside these ranges: both MOVED with
 * their text byte-identical, `246-259` -> `281-294` and `3366-3385` ->
 * `3668-3687`, so the flat key set each reads or emits did not move. On the
 * hop onto `f8a9d0fb0` both files changed too (`getTreeConfig` lost its
 * `filter.tree` arm, objectui#9549; the flatten gained `filter`), and the
 * flat key set did not move then either. At `62597c588` both were
 * byte-identical to `87af769e9`, where both were re-READ 2026-09-22 (this record carried no pin
 * at all before that, so nothing re-checked it when the pin moved). Read, but NOT authorable —
 * one composition key per concept (Prime Directive #12), the ruling the map and
 * the gantt carry from objectui#5018 / #6469 and the channel `object-calendar`
 * uses above. The registration agrees: `plugin-tree/src/index.tsx` declares
 * `{ name: 'tree', type: 'object' }` and no flat input.
 *
 * `titleField` is in the set although no `tree` block key is spelled that way:
 * `ListView`'s flatten resolves `treeCfg.titleField` into `labelField` before
 * emitting (`ListView.tsx:3770`, `labelField: treeCfg.labelField ||
 * treeCfg.titleField || 'name'`), so the author's intent is always the block's
 * `labelField`, and the prescription below says so.
 *
 * ⚠️ The renderer's own half of that sentence is GONE, and it is a DELETED
 * read rather than a moved one: `getTreeConfig`'s `?? schema.titleField` rung
 * — the `:117` this record used to cite — was removed on objectui#8841
 * because it read the FLATTENED NODE and never the block, and the docblock at
 * `ObjectTree.tsx:233-254` records the three measurements that retired it.
 * The flatten half above is what keeps the key in this set; ⛔ do not restore
 * the renderer half from this record's history.
 */
const OBJECT_TREE_FLAT_CONFIG_GUIDANCE: readonly KeySetGuidance[] = [
  ...COMPONENT_LEVEL_GUIDANCE,
  {
    name: 'OBJECT_TREE_FLAT_CONFIG_KEYS',
    keys: ['parentField', 'labelField', 'titleField', 'fields', 'defaultExpandedDepth'],
    examples: ['parentField', 'labelField'],
    prescription:
      'Write this as a key of the `tree` config object instead — `tree: { parentField, labelField, fields, '
      + 'defaultExpandedDepth }`. The flat top-level spelling is the internal form `ObjectView`/`ListView` '
      + 'produce when they flatten `options.tree`, not a second authoring spelling. A `titleField` is the '
      + "block's `labelField`: it is only ever read as that key's last fallback.",
  },
];

/**
 * `object-tree` (objectui `plugin-tree/src/ObjectTree.tsx` plus the registry
 * shell `plugin-tree/src/index.tsx`, read at the pin this repo builds against
 * — `.objectui-sha` = `31971ff1e`, re-measured there 2026-10-01:
 * `plugin-tree/src/index.tsx`, `ObjectTree.tsx` and
 * `core/src/utils/record-source.ts` are byte-identical to `e420df310`
 * (`git diff --quiet`), so every anchor below holds unmoved and was re-read in
 * place. At `e420df310` (2026-09-30)
 * `plugin-tree/src/index.tsx` was byte-identical to `db11afd49`;
 * `core/src/utils/record-source.ts` changed (+38/-27) and its three rungs MOVED
 * by 8 with their text byte-identical; `ObjectTree.tsx` changed (+29/-26,
 * objectui#8348), and TWO anchors changed CONTENT, both toward this row, and
 * say so where they are cited: the rung-1 call now passes `'view-data'`, and
 * the host-data read no longer reads the authored `schema.data`; every other
 * anchor MOVED by 2 or 3 with its cited text byte-identical. At `db11afd49`
 * (2026-09-29) `plugin-tree/src/index.tsx` and
 * `core/src/utils/record-source.ts` were byte-identical to `dd3f7e1be` and
 * `ObjectTree.tsx` changed in one comment line (`:1054`), so every anchor held
 * unmoved and was re-read in place. At
 * `dd3f7e1be` (2026-09-28):
 * `plugin-tree/src/index.tsx` is byte-identical to `f8a9d0fb0` (`git diff
 * --quiet`); `core/src/utils/record-source.ts` changed only in docblocks and
 * the retired bare `map` arm, so its three rungs MOVED by 7 with their text
 * byte-identical; `ObjectTree.tsx` changed (+136/-30: objectui#10666
 * resolves the filter's context tokens before either query sends it,
 * objectui#7508 homed the row ceiling in core, and the invalidation bus and
 * in-place re-read, objectui#10778 / objectui#10816), so every anchor in it
 * was re-READ: the two `$filter` sends and the two ceilings changed CONTENT
 * and say so where they are cited, and every other one MOVED with its cited
 * text byte-identical. On the hop onto `f8a9d0fb0`,
 * `plugin-tree/src/index.tsx` and `record-source.ts` were byte-identical to
 * `62597c588`, and `ObjectTree.tsx` changed (+69/-3: objectui#9549 deleted
 * `getTreeConfig`'s `filter.tree` arm, and objectui#9136 routed the inline
 * `value` provider through a `ValueDataSource` query that honours `filter`
 * and the row ceiling): two anchors changed CONTENT then, and every other one
 * MOVED with its cited text byte-identical.
 * All three files were byte-identical across the hop onto `62597c588`. At `87af769e9`
 * (re-READ 2026-09-22) no anchor below was carried from `53ded82bf`; every
 * one was re-derived from that tree, and the ladder call changed in CONTENT
 * as well as position.)
 * Read points per key: `data` (`resolveRecordSourceConfig` at
 * `:634` — rung 1, `core/src/utils/record-source.ts:307`, which returns the
 * authored value VERBATIM once it is on the arm; that ONE site is the whole
 * support for the arm this row declares. ⚠️ At this pin the ARM this renderer
 * passes is `'view-data'`, the one its siblings pass (objectui#8348), so a
 * bare array under `data` is not a record source there and the ladder falls
 * through to `staticData`, then `objectName`: renderer and row now draw the
 * same line. Through `db11afd49` it passed `'undeclared'`, which honoured any
 * truthy value — WIDER than this row, the harmless direction),
 * `staticData` (rung 2,
 * `record-source.ts:311`), `objectName` (rung 3; also `:1026`, `:1077` and
 * `:1149` here, each behind `resolveRecordSourceObjectName`, plus the
 * parent-field detection at `:958-959`),
 * `filter` (`:739`, read once through `useResolvedFilter`, which resolves its
 * context tokens — objectui#10666 — and holds the result: `:831` sends it to
 * `$filter` on the object fetch and `:916` on the inline `value` provider's
 * `ValueDataSource` query, objectui#9136's; at `f8a9d0fb0` both sent
 * `schema.filter` verbatim, at `:753` and `:837`), `tree` (`:282`, the
 * nested config block `getTreeConfig` (`:281-294`) reads, and the
 * registration's declared `{ name: 'tree', type: 'object' }` input
 * (`plugin-tree/src/index.tsx:27-31`)) and `navigation` (`:1063`, handed to
 * `useNavigationOverlay` at `:1046`).
 *
 * ⚠️ `data` IS declared here, and that is the measurement, not a family
 * symmetry. objectui#9234 left this block's rung-1 read marked `undeclared`
 * because neither published face carried the key: `ObjectTreeSchema` on
 * `@object-ui/types` declared no `data`, no `staticData`, no `filter` and no
 * `navigation` at all, and requires `objectName` (⚠️ at this pin it declares
 * `filter`, in the `QueryParams['$filter']` shape, objectui#9549; the other
 * three are still absent). The renderer reads all four
 * — so the protocol row follows the READ POINTS, which is what 「以协议为准」
 * resolving for this block means, and the mirror is the face that has to
 * follow.
 *
 * ⛔ `:865` is NOT a second site for the object arm, and at this pin it is not
 * a read of the authored key at all: it is `(rest as any).data`, gated by
 * `Array.isArray(passed)` on the next line — the rows a HOST hands down as the
 * `data` React prop. objectui#8348 dropped the `?? schema.data` fallback that
 * line carried through `db11afd49` (`:862` there), the one reader that let an
 * authored bare array draw rows whatever the ladder said, and objectui#9571
 * had already stopped `SchemaRenderer` delivering the authored key as that
 * prop. One ladder site is sufficient, and `:634` is it.
 *
 * Measured and deliberately NOT declared: the flat `TreeConfig` spellings
 * ({@link OBJECT_TREE_FLAT_CONFIG_GUIDANCE}); the bare-array `data` shorthand,
 * which `ViewData` cannot publish (a discriminated union over OBJECT variants),
 * for which `staticData` is this block's declared door, and which the renderer
 * itself no longer accepts from an authored node at this pin (see `:865`
 * above; `:862-863` accepted it through `db11afd49`); `sort` — this renderer's fetch
 * (`:830-842`) carries `$filter`, `$top` and `$expand` and NO `$orderby`, the
 * inline query (`:915-924`) carries `$filter` and `$top` only, and
 * nothing else reads an order, so declaring one would publish a key with no read
 * site; a row cap, for the same reason `object-gantt` declares none (the `$top`
 * is the platform ceiling, spread in as core's `nonGridRowCeilingQuery()` at
 * `:840` and again at `:923` — a bare `$top: NON_GRID_ROW_CEILING_TOP` at
 * `f8a9d0fb0`, until objectui#7508 — marked "⛔ Not
 * authorable" at `:839`); and `filter.tree`, the legacy stash — ⚠️ no longer
 * read since `f8a9d0fb0`: objectui#9549 deleted that arm, so `getTreeConfig`
 * (`:282`) takes the block from `tree` alone — which was a shape to stop
 * writing and is not a key to declare.
 *
 * This was also the one block of the three whose type was absent from the
 * tracked `sdui.manifest.json`, so `check:react-declaration-parity` reported
 * it as missing from the registry rather than comparing it. ⚠️ Re-read at
 * `31971ff1e`: the manifest regenerated at this pin carries an `object-tree`
 * entry, as the ones at `db11afd49` and `e420df310` already did. The derivation above is from
 * the renderer's sources at the pin either way, which is what #7751's method
 * asks for.
 *
 * VALUE posture for `tree`: {@link TreeConfigSchema}, this repo's own block —
 * #15469 closed it against unknown keys on exactly this measurement
 * (`getTreeConfig` reads precisely those four keys from the block; the
 * undeclared read set was EMPTY), re-measured at `87af769e9`; unchanged since
 * `53ded82b`.
 */
export const ObjectTreePropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-tree`',
  history: objectBlockHistory('object-tree'),
  guidanceSets: OBJECT_TREE_FLAT_CONFIG_GUIDANCE,
  aliases: FILTERS_TO_FILTER,
}, {
  /**
   * ⚠️ Optional for a DIFFERENT reason than its siblings, and the reason is
   * measured rather than inherited. `object-grid` / `object-kanban` /
   * `object-calendar` / `object-map` / `object-gantt` all say "the
   * component-level `dataSource` binding can supply the object instead"; that
   * holds for them because each registers through `ElementDataSourceGate`,
   * which lowers the spec binding onto `objectName` before the renderer sees
   * the node. `plugin-tree/src/index.tsx` does NOT: at the pin this repo
   * builds against (`.objectui-sha` = `31971ff1e`, re-COUNTED there 2026-10-01 by
   * the same method — 0 for the tree, whose shell is byte-identical, and 3 each
   * for `plugin-grid` (byte-identical), `plugin-gantt` and `plugin-calendar`
   * (both changed on the hop: objectui#11117 in each, and objectui#8652's
   * `navigation` input in the calendar's), but 4 for `plugin-map`: objectui#10859 batch 5 added a
   * comment that names the gate, while its wiring is the same three lines;
   * re-COUNTED at `e420df310` 2026-09-30 by
   * the same method — 3 each again and 0 for the tree; `plugin-map` and
   * `plugin-gantt`'s `src/index.tsx` changed on the hop (objectui#8220's
   * `filter` / `sort` inputs) and still read 3, the tree's is byte-identical;
   * re-COUNTED at `db11afd49` 2026-09-29 by
   * the same method — 3 each again and 0 for the tree;
   * `plugin-grid/src/index.tsx` changed on the hop and still reads 3; re-COUNTED
   * at `dd3f7e1be`
   * 2026-09-28) its registry shell has ZERO hits for that wiring, against 3
   * each in `plugin-gantt`, `plugin-grid` and `plugin-calendar` and 4 in
   * `plugin-map` (three of them the wiring, one the comment above it) — four
   * controls, so the zero discriminates. ⚠️ Re-counted at every end
   * with ONE method (occurrences of that identifier in each `src/index.tsx`):
   * `f8a9d0fb0`, `62597c588`, `87af769e9` and `53ded82bf` all read 3 each and 0 for the tree as well —
   * `plugin-grid/src/index.tsx` changed on the hop onto `62597c588` and still reads 3, and
   * all four control shells changed across the hop from `f8a9d0fb0` (the
   * tree's is byte-identical) and still read 3 each — so
   * nothing about this reading moved. The `7 each` this record used to carry is
   * reproducible at neither pin by that method, nor by a whole-package count
   * (7 / 5 / 11 / 5, not 7 each). ⛔ A count is a reading only with its METHOD
   * written beside it — without one, re-stating the carried number is exactly
   * what survives a re-measure. Its shell pulls a `dataSource`
   * off the schema context and hands it down as the data ADAPTER; nothing on
   * that path writes an object name.
   *
   * What really makes it optional is the record-source ladder's first two
   * rungs (objectui#6939): `data` can name the object itself, and `staticData`
   * needs no object at all, so a tree authored on either never reads this key.
   */
  objectName: z.string().optional()
    .describe("Object this tree binds to — the THIRD record source `resolveRecordSourceConfig` resolves, after `data` and `staticData`. Optional because either of the first two rungs resolves the source without it: `data` can name the object itself (`{ provider: 'object', object }`) and `staticData` needs none. ⚠️ NOT supplied by the component-level `dataSource` binding the sibling blocks name — this renderer registers no such gate"),
  /**
   * Data source binding — `ViewDataSchema`, the object arm rung 1 returns
   * verbatim. Declared from the READ POINT (`:359`), not from objectui's
   * mirror, which carries no `data` on either face at this pin.
   */
  data: ViewDataSchema.optional()
    .describe("Data source binding (ViewDataSchema — discriminated on `provider`: object | api | value | schema), read FIRST by `resolveRecordSourceConfig`. Static inline rows live at `{ provider: 'value', items: [...] }` or at `staticData`; the bare-array shortcut is refused"),
  staticData: z.array(z.unknown()).optional()
    .describe("Inline records — read SECOND by `resolveRecordSourceConfig`, wrapped into a `{ provider: 'value' }` config"),
  /** Base query filter — the family's one `ViewFilterRule` array orthography (#15449). */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `object-tree`',
      migration: 'element-data-source-and-object-block-filter-rule-array',
    }),
  }).optional()
    .describe('Base query filter — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` door in this map shares; lowered to the wire `$filter`. The MongoDB-style record form is refused — see migration `element-data-source-and-object-block-filter-rule-array`'),
  tree: TreeConfigSchema.optional()
    .describe('Tree/hierarchy configuration, the author face — the same block `ListViewSchema.tree` declares: { parentField?, labelField?, fields?, defaultExpandedDepth? }. `parentField` auto-detects from the object schema when omitted'),
  navigation: z.unknown().optional()
    .describe('Row-click navigation config ({ mode: page | drawer | modal | split | popover | new_window | none }) — all seven `NavigationModeSchema` values, since the shared `useNavigationOverlay` hook types its own mode union as that schema'),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectTreeProps = z.input<typeof ObjectTreePropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state — `filter` carries
 * `z.array(ViewFilterRuleSchema)` (`operator` normalizes on parse) and `data`
 * carries `ViewDataSchema`, so this block leaves the type-alias convention pin's
 * default-free family the way `object-grid` did.
 */
export type ObjectTreePropsParsed = z.infer<typeof ObjectTreePropsSchema>;

/**
 * The flat `TimelineConfig` spellings `ObjectTimeline` keeps reading as a
 * backward-compat fallback (`ObjectTimeline.tsx:263-293`) and that `ListView`
 * EMITS on its runtime handoff (`plugin-list/src/ListView.tsx:2489-2525`,
 * `case 'timeline'`: the product carries `startDateField` / `titleField` /
 * `endDateField` / `groupByField` / `colorField` / `scale` beside the
 * nested `timeline` block it writes in the same object). Read, but NOT
 * authorable — one composition key per concept (Prime Directive #12), the same
 * channel `object-calendar`, `object-gantt` and `object-tree` use above.
 *
 * `dateField` is in the set although {@link TimelineConfigSchema} declares no
 * key of that name: it is the pre-#2231 alias of `startDateField`, read at the
 * flat rung (`:288`). So the prescription names the block key it RESOLVES TO
 * and never the alias — a prescription naming a key the target schema refuses
 * is the #17054 trap this file has already paid for once
 * (`calendar-config-allday-prescription-17054.test.ts`).
 */
const OBJECT_TIMELINE_FLAT_CONFIG_GUIDANCE: readonly KeySetGuidance[] = [
  ...COMPONENT_LEVEL_GUIDANCE,
  {
    name: 'OBJECT_TIMELINE_FLAT_CONFIG_KEYS',
    keys: ['titleField', 'startDateField', 'dateField', 'endDateField', 'groupByField', 'colorField', 'scale'],
    examples: ['startDateField', 'titleField'],
    prescription:
      'Write this as a key of the `timeline` config object instead — `timeline: { startDateField, endDateField, titleField, groupByField, colorField, scale }`. The flat top-level spelling '
      + 'is the runtime handoff `ListView` emits for a timeline view and a stored-document '
      + 'fallback the renderer keeps reading; it is not a second authoring spelling (one key per '
      + 'concept). A `dateField` is the block\'s `startDateField` — it is only '
      + 'ever read as that key\'s alias.',
  },
];

/**
 * `object-timeline` (objectui `plugin-timeline/src/ObjectTimeline.tsx`, the
 * presentational `plugin-timeline/src/renderer.tsx` it composes into, and the
 * registry shell `plugin-timeline/src/index.tsx` — all read at the pin this
 * repo builds against (`.objectui-sha` = `31971ff1e`), re-measured there
 * 2026-10-01: `renderer.tsx` is byte-identical to `e420df310`, so its three
 * anchors hold unmoved; `ObjectTimeline.tsx` changed (+42/-2, objectui#8654:
 * a typed `navigation` member on the component's props, and the navigation
 * read without its cast), every anchor below line 173 MOVING by 35 (by 40
 * past the navigation read) with its cited text byte-identical, and ONE
 * changing CONTENT, toward this row: the navigation binding `:753-756` ->
 * `:793-796` now reads `schema.navigation` where it read
 * `(schema as any).navigation`; `index.tsx` changed (+21/-0, objectui#8654: a
 * `navigation` input on both registrations, with its shared description), the
 * `variant` input MOVING `374-375` -> `393-394` byte-identical and `:333` not
 * moving. The `schema.*` read set of all three is unchanged — `navigation`
 * was read before, through the cast. At `e420df310` (2026-09-30)
 * `ObjectTimeline.tsx` was byte-identical to `db11afd49`, so every
 * anchor in it held unmoved and was re-read in place; `index.tsx` changed
 * (+17/-0, objectui#8220: `filter` / `sort` inputs on both registrations, in
 * the array forms this row declares, and their shared descriptions above the
 * first), the `variant` input MOVING `361-362` -> `374-375` byte-identical and
 * `:333` not moving; and `renderer.tsx` changed (+83/-8, objectui#11141's
 * inclusive date-only end), its three anchors MOVING with their cited text
 * byte-identical, `1497` -> `1569`, `1794` -> `1869`, `1722-1737` ->
 * `1794-1809`; its schema-key read set (`schema.*`) is unchanged. At
 * `db11afd49` (2026-09-29) `ObjectTimeline.tsx` and `index.tsx` were
 * byte-identical to
 * `dd3f7e1be`, and `renderer.tsx` changed hard (+387/-177: objectui#11079's
 * continuous gantt axis and objectui `9e6619ffa`'s date-only day in every zone),
 * its three anchors MOVING with their cited text byte-identical, `1295` ->
 * `1497`, `1586` -> `1794`, `1523-1538` -> `1722-1737`; its schema-key read set
 * (`schema.*`) is unchanged. Re-measured at `dd3f7e1be`
 * 2026-09-28: `index.tsx` is byte-identical to `f8a9d0fb0` (`git diff
 * --quiet`); `ObjectTimeline.tsx` changed (+129/-26 across nine commits:
 * objectui#10666 resolves the filter's context tokens before `$filter`,
 * objectui#10623's invalidation bus hoisted the fetch gate out of the
 * effect, objectui#10530 derives the entry title and description as display
 * strings, objectui#6356 typed the renderer handoff, objectui#10866 reads a
 * date-only start as that day in the bucket and the sort, among others) and
 * `renderer.tsx` changed (+86/-31: objectui#6356, objectui#10841, and
 * objectui#10866 in `formatDate`), so every anchor in both was re-mapped
 * through the diff and re-READ. The `filter` reads and the fetch gate
 * changed CONTENT and say so where they are cited; every other anchor MOVED
 * (or held) with its cited text byte-identical — the three in `renderer.tsx`
 * by 55, `1240` -> `1295`, `1531` -> `1586`, `1468-1483` -> `1523-1538`. At `f8a9d0fb0`, `ObjectTimeline.tsx` and
 * `index.tsx` were byte-identical to `62597c588`, and `renderer.tsx` had
 * changed (+46/-20, objectui `0b6b295a1`: a gantt row that is not an object
 * is refused), its three anchors MOVING with their cited text byte-identical,
 * `1215` -> `1240`, `1505` -> `1531`, `1442-1457` ->
 * `1468-1483`. All three files were byte-identical to `87af769e9` at
 * `62597c588`, and were re-READ there 2026-09-22.
 *
 * ⛔ This record used to be MIXED, and the historical spelling is what let it
 * be: its `limit` clause was re-read at this pin on 2026-09-21 while every
 * other anchor beside it was still a `53ded82bf` reading, in the same file,
 * with nothing to tell the two apart. Every anchor below is now at this pin.)
 *
 * Commit e233db9db executes the objectui#8652 maintainer ruling (verbatim `B`). The
 * ruling's carrier is `navigation`, declared below beside its `object-kanban`
 * and `object-calendar` twins; the ROW is the other half of the same card.
 * `object-timeline` is a registered renderer reachable only through the type
 * union's open string arm, and with no row here the #5068 props gate skipped
 * it, so every authored key rode through in silence — the #8691 / #8744 /
 * #11575 mechanism, one instance further on. It was unjudged in BOTH
 * directions: nothing accepted a real key and nothing refused a typo.
 *
 * Read points per key, in `ObjectTimeline.tsx` unless named otherwise:
 * `objectName` (`:291` the fetch gate, `:371-374` the object-def load through
 * `useSettledSchema`, `:409` the `fetchesForItself` gate — the check that
 * sat inside the fetch effect at `:420` is hoisted to render scope at this
 * pin, where `:410` also subscribes the invalidation bus on it
 * (objectui#10623) and the effect reads it at `:514` — `:416` / `:474`
 * inside the fetch effect,
 * `:785` the pull-to-refresh gate, `:596` the entry composition and `:795`
 * the navigation binding), `timeline` (`:308`,
 * the canonical nested config every field resolution prefers), `filter`
 * (`:396`, read once through `useResolvedFilter`, which resolves its context
 * tokens — objectui#10666 — and holds the result; `:397` keys the fetch on
 * it and `:475` sends it to `$filter`, where `f8a9d0fb0` sent `schema.filter`
 * verbatim at `:341` / `:405`), `sort` (`:399`, `:476` — through
 * the shared `convertSortToQueryParams` sink, as `object-calendar`'s does),
 * `limit` (`:477`, the fetch's one top-level `$top`, through
 * `resolveRowLimit(schema.limit, DEFAULT_TIMELINE_LIMIT)` with the default
 * `100` at `:29` and the refused-cap diagnostic at `:325`), `items` (`:289`, `:409`, `:581`,
 * `:811` — the authored pass-through that short-circuits the object query),
 * `data` (`:290`, `:409`, `:536`, `:538` — the pre-fetched record source,
 * read off REACT PROPS rather than `schema`; the door's own docblock carries
 * how an authored key reaches that channel and why a `schema.*` sweep alone
 * publishes a false refusal),
 * `descriptionField` (`:572`), `mapping` (`:545`, `:570`, `:572`, `:573`),
 * `variant` (`:849`) and `navigation` (`:793-796` → `:928` → `:983-984`).
 * Four more are read by the presentational renderer off the schema this
 * component spreads into it (`effectiveSchema`, `:912-931`): `dateFormat`
 * (`plugin-timeline/src/renderer.tsx:1569`, every variant — its number was the
 * same at `53ded82bf` and `87af769e9`, as `plugin-timeline/src/index.tsx:333`'s
 * also was, which is why the number alone is never the reading) and the gantt
 * trio `rowLabel` (`plugin-timeline/src/renderer.tsx:1869`), `minDate` /
 * `maxDate` (`plugin-timeline/src/renderer.tsx:1794-1809`). ⚠️ All three name their
 * package because objectui has a second `renderer.tsx` (in `plugin-chatbot`):
 * a suffix that matches two files names neither, and the gate drops it from
 * the population rather than guessing.
 *
 * Measured and deliberately NOT declared, each with its reason:
 *  - the flat field spellings and `scale`
 *    ({@link OBJECT_TIMELINE_FLAT_CONFIG_GUIDANCE}) — the runtime handoff
 *    `ListView` emits, not a second authoring spelling;
 *  - `bind` — the objectui data-scope key the section header above rules out
 *    for every block in this family (`:329` here);
 *  - `className` (`:915`) — a node-level key on `PageComponentSchema`, not a
 *    per-block prop;
 *  - `onItemClick` / `onRowClick` — host callbacks JSON cannot carry.
 *
 * VALUE posture: `timeline` takes {@link TimelineConfigSchema}, the block
 * `ListViewSchema.timeline` already declares — one vocabulary, taken by
 * reference, so this element face cannot fork from the view face.
 * `mapping` stays `z.unknown()`: its contract
 * (`TimelineMappingSchema`) still lives in objectui, which is the
 * `object-calendar.calendar` posture this section's header prescribes for
 * exactly that case. `navigation` takes {@link NavigationConfigSchema}, by
 * reference, for the reason the ruling gives.
 *
 * ⚠️ `variant: 'gantt'` is declared because the registration declares it
 * (`plugin-timeline/src/index.tsx:393-394`) and the renderer reads it — but the
 * OBJECT-BOUND composed path REFUSES it loudly (objectui#6655,
 * `ObjectTimeline.tsx:849-851`:
 * `:849` gates on `!hasAuthoredItems && schema.variant === 'gantt'` and `:851`
 * renders `timeline-unsupported-variant`. ⚠️ The `:518` this clause carried is
 * that gate at the RETIRED `53ded82bf` and a comment line at this pin. It sat on
 * a line the 2026-09-22 conversion never touched — and so did eight other
 * anchors of this record, so the untouched line is not what singles it out.
 * RE-READING all nine at this pin does: the other eight say here what this
 * record claims they say, and this one alone did not), so on this block it is
 * usable only together with authored `items`.
 * Declared-and-refused-with-a-diagnostic is not the accepted-and-dropped class
 * this section exists to close: the author is told, in the renderer, by name.
 */
export const ObjectTimelinePropsSchema = lazySchema(() => strictObject({
  surface: 'this `object-timeline`',
  history: objectBlockHistory('object-timeline'),
  guidanceSets: OBJECT_TIMELINE_FLAT_CONFIG_GUIDANCE,
  aliases: FILTERS_TO_FILTER,
}, {
  objectName: z.string().optional()
    .describe('Object this timeline binds to. Optional because the component-level `dataSource` binding can supply the object instead — this block registers through `ElementDataSourceGate`, which lowers the binding onto this key before the renderer sees the node'),
  timeline: TimelineConfigSchema.optional()
    .describe('Timeline configuration, the author face — the same block `ListViewSchema.timeline` declares: { startDateField, endDateField, titleField, groupByField, colorField, scale }. The flat top-level spellings beside it are the runtime handoff, not a second authoring spelling'),
  /** Base query filter — the family's one `ViewFilterRule` array orthography (#15449). */
  filter: z.array(ViewFilterRuleSchema, {
    error: ruleArrayFilterError({
      surface: 'this `object-timeline`',
      migration: 'element-data-source-and-object-block-filter-rule-array',
    }),
  }).optional()
    .describe('Base query filter — the ViewFilterRule array form `[{ field, operator, value }, ...]`, the one filter orthography every `filter` door in this map shares; lowered to the wire `$filter`. The MongoDB-style record form is refused — see migration `element-data-source-and-object-block-filter-rule-array`'),
  /** Row order — the platform's one `SortItem` array orthography (objectui#8221 option B). */
  sort: z.array(SortItemSchema).optional()
    .describe('Row order for the fetched entries — the SortItem array form `[{ field, order }, ...]`, the one sort orthography every declared `sort` door on this platform shares; lowered to the wire `$orderby`. The legacy string clause (`name desc`) is refused — see migration `object-block-sort-item-array`'),
  limit: z.number().int().positive().optional()
    .describe("Maximum number of records loaded onto the rail (row cap); lowered to the query's top-level `$top` (renderer default 100). A timeline renders one rail with no pagination control, so this is the author's window rather than a page size"),
  /**
   * Pre-fetched RECORDS — the same door `object-kanban` and `object-calendar`
   * declare, with the same shape, so the third object-bound face does not fork
   * a vocabulary its siblings already have.
   *
   * ⚠️ This key is read off REACT PROPS, not off `schema` — which is why a
   * sweep of `schema.*` read points missed it, and the reason is worth keeping
   * next to the door rather than in a commit message. An authored
   * `properties.data` reaches the component anyway: `SchemaRenderer` hoists
   * every `properties.*` key except `type`/`id` onto the node, `data` is not
   * on its strip list (`dataSource` / `visibleWhen` / `responsiveStyles` and
   * the visibility flags are), and `createElement` spreads every remaining
   * non-metadata node key as a prop — which `ObjectTimelineRenderer` forwards
   * whole into this component. ⭐ So on this family a read point is
   * `schema.<key>` OR `props.<key>`, and a measurement that greps only the
   * first publishes a refusal for a key the renderer honours.
   *
   * Read points at the pin this repo builds against (`.objectui-sha` =
   * `31971ff1e`, re-READ there 2026-10-01 — the file changed across the hop
   * from `e420df310` (+42/-2, objectui#8654's typed `navigation` member and
   * cast-free navigation read), all of it above or away from these reads, so
   * every anchor MOVED by 35 with its cited read byte-identical: `:255` ->
   * `:290`, `:374` -> `:409`, `:479` -> `:514`, `:501` -> `:536`, `:503` ->
   * `:538`, `:653` -> `:688`. One was re-pointed rather than moved: the
   * start/end bindings this record carried as `621-622` began one line early,
   * on the `rawData.map` head, at `e420df310` too, where the two bindings are
   * `622-623`; they are `657-658` here. `SchemaRenderer.tsx` and
   * `record-source.ts` are byte-identical, so the prop channel above still
   * carries the key. At `e420df310`, 2026-09-30, the file was byte-identical to
   * `db11afd49`, so every anchor held unmoved; and the prop channel above
   * still carries the key here: `SchemaRenderer` strips an authored `data`
   * prop only on the types `core`'s `RECORD_SOURCE_DATA_ARM_BY_TYPE` puts on
   * the `view-data` arm (objectui#9571), and `object-timeline` is not listed,
   * so it stays `undeclared` and keeps the seat. At `db11afd49`, 2026-09-29,
   * the file was byte-identical to
   * `dd3f7e1be`, so every anchor held unmoved; at `dd3f7e1be`, 2026-09-28, the
   * file changed across the hop
   * from `f8a9d0fb0` (+129/-26), so every anchor was re-mapped through the
   * diff: `:255` did not move, and the dependency list `442` -> `501` (it
   * gained the invalidation nonce), the row source `444` -> `503` and the
   * start/end bindings `555-556` -> `621-622` MOVED with the cited reads
   * byte-identical. Two changed CONTENT: the skip is no longer spelled
   * inside the fetch effect but hoisted to `fetchesForItself` at `:374`
   * (objectui#10623), and the title binding now reads through
   * `recordDisplayValueAt` (`:653`, objectui#10530), not `item[titleField]`.
   * At `f8a9d0fb0` the file was byte-identical to `62597c588` and
   * `87af769e9`, where they were re-READ 2026-09-22), all in
   * `ObjectTimeline.tsx`: `:290` seeds the loading state off it, `:409`
   * SKIPS the object query when it is present (the gate the effect reads at
   * `:514`), `:536` tracks it, and `:538`
   * is the row source itself — `(props as any).data || boundData ||
   * fetchedData`, so it wins over both the data-scope binding and the fetch.
   * Unlike `items` one line down, these rows are RECORDS: they go through the
   * same `timeline` field bindings a fetched row takes (`:657-658`, `:688`).
   */
  data: z.array(z.unknown()).optional()
    .describe("Pre-fetched records — read FIRST as the rail's row source, ahead of the data-scope binding and the fetch, and composed into entries through the same `timeline` field bindings a fetched row takes; authoring it suppresses the object query entirely. Distinct from `items`, which is the already-composed entry shape and wins over this key when both are written"),
  items: z.array(z.unknown()).optional()
    .describe("Static inline entries — read ahead of every record source, `data` above included, and bypasses the object query entirely (the renderer becomes a pass-through). Each element is objectui's declared timeline element, `@object-ui/types`'s `TimelineFeedItem` (`variant` absent / `vertical` / `horizontal`) or `TimelineGanttItem` (`variant: 'gantt'`), the arm this node's `variant` selects"),
  variant: z.enum(['vertical', 'horizontal', 'gantt']).optional()
    .describe("Rail layout (renderer default `vertical`). ⚠️ `gantt` needs authored `items`: the object-bound path composes flat feed entries, which the gantt branch cannot draw, and refuses that combination with a named diagnostic instead of drawing an empty chart"),
  dateFormat: z.enum(['short', 'long', 'iso']).optional()
    .describe("How each entry's date is rendered (renderer default `short`): `short` / `long` are locale-formatted, `iso` is the locale-free machine form"),
  rowLabel: z.string().optional()
    .describe('Header label for the gantt row column — read by the gantt branch only, which on this block needs authored `items`'),
  minDate: z.string().optional()
    .describe('Pin the gantt axis start (ISO `yyyy-mm-dd`) instead of deriving it from the rows; only a non-empty value is honoured'),
  maxDate: z.string().optional()
    .describe('Pin the gantt axis end (ISO `yyyy-mm-dd`) instead of deriving it from the rows; only a non-empty value is honoured'),
  descriptionField: z.string().optional()
    .describe("Field rendered as each entry's description (renderer default `description`). Declared FLAT because the `timeline` block has no member for it — it is the only spelling this binding has"),
  mapping: z.unknown().optional()
    .describe("Record-to-entry field mapping ({ title, date, description, variant }) — the objectui-side binding record read BETWEEN the `timeline` block and the flat fallbacks. Its `variant` member (the field whose value picks each marker colour, renderer default `variant`) is the only spelling that binding has"),
  /**
   * Entry-click navigation (commit e233db9db — the spec half of the objectui#8652
   * maintainer ruling, verbatim `B`), the same carrier and the same def as
   * `object-kanban`'s and `object-calendar`'s above. Measured at the pin:
   * `ObjectTimeline.tsx:462-466` hands `(schema as any).navigation` to
   * `useNavigationOverlay`, `:597` fires it on an entry click and `:652`
   * renders the overlay — standalone, with no enclosing view.
   */
  navigation: NavigationConfigSchema.optional()
    .describe("Entry-click navigation config — the same block `ListViewSchema.navigation` declares ({ mode, size, openNewTab, preventNavigation })"),
}));
/** Author state (ADR-0122: the bare name is the author state). */
export type ObjectTimelineProps = z.input<typeof ObjectTimelinePropsSchema>;
/**
 * ADR-0122: the parsed state differs from the authored state on two keys.
 * `filter` carries `z.array(ViewFilterRuleSchema)` (`operator` normalizes on
 * parse) and `navigation` carries {@link NavigationConfigSchema}, whose
 * defaulted members materialize on a document that authored the key — plus
 * `timeline`, whose `scale` defaults inside {@link TimelineConfigSchema}.
 * So this block joins the `ObjectGridPropsParsed` route rather than the type-alias
 * convention pin's default-free family.
 */
export type ObjectTimelinePropsParsed = z.infer<typeof ObjectTimelinePropsSchema>;

/**
 * ----------------------------------------------------------------------
 * Component Props Map
 * Maps Component Type to its Property Schema
 * ----------------------------------------------------------------------
 */
export const ComponentPropsMap = {
  // Structure
  'page:header': PageHeaderProps,
  'page:tabs': PageTabsProps,
  'page:card': PageCardProps,
  // The three thin containers: one shared `children` contract (#5775). They
  // were `EmptyProps` while their renderers rendered a child list.
  'page:footer': PageContainerProps,
  'page:sidebar': PageContainerProps,
  'page:accordion': PageAccordionProps,
  'page:section': PageContainerProps,

  // Record
  'record:details': RecordDetailsProps,
  'record:related_list': RecordRelatedListProps,
  'record:highlights': RecordHighlightsProps,
  'record:activity': RecordActivityProps,
  'record:chatter': RecordChatterProps,
  // #8744 — `record:discussion` is the same renderer under the
  // registration-preferred name (one `RecordChatterRenderer`, one shared
  // `CHATTER_INPUTS` list, registered under both; the default-page synthesizer
  // emits `record:discussion`, and `RecordDetailView` treats the pair as
  // duplicates). Deliberately the SAME schema object, not a copy: two rows
  // would give one renderer two accept faces to drift apart. Until this row a
  // `record:discussion` node was the fifth silent-no-op surface — its props
  // bag was skipped as unregistered while `record:chatter` beside it was
  // judged. ⚠️ The shared row itself has a measured value-level divergence
  // from the renderer (`position` vocabulary, `collapsible` default) — #8762,
  // deliberately not fixed here: the pair measurement is #8744's scope, the
  // repair is its own accept-face change, and landing it once on this shared
  // const fixes both names.
  'record:discussion': RecordChatterProps,
  'record:path': RecordPathProps,
  // #8691 — the rail had a renderer, a `PageComponentType` entry and a palette
  // slot, but no row here, so an entry `filter` shipped as a silent no-op while
  // sibling components in the same file got loud diagnostics. Key set measured
  // from the renderer's read points at the `.objectui-sha` pin — see the
  // schema's own header for the two places that measurement diverges from the
  // renderer's TS interface (`icon`, `title`).
  'record:reference_rail': RecordReferenceRailProps,
  // #8744 — the same mechanism as #8691 one row up, for the three types that
  // fix left behind: registered renderers, `PageComponentType` entries,
  // palette slots, no rows — so the #5068 gate's dispatch skipped all three
  // and every authored key rode through in silence. Key sets measured from
  // the renderers' read points at the `.objectui-sha` pin; see the schemas'
  // own headers for where the measurement diverges from the registrations'
  // declared-input claims (`aria` and the empty-bar fallback on
  // quick_actions; the host-channel `entries`/`loading` on history; the
  // read-and-declared `icon` on alert, the rail's opposite).
  'record:alert': RecordAlertProps,
  'record:quick_actions': RecordQuickActionsProps,
  'record:history': RecordHistoryProps,
  // #21142 — the last registered `record:*` renderer without a row: it sat on
  // the string-arm registration ledger instead (`component-type-vocabulary.ts`),
  // so the gate skipped its props and a column keyed `field` published green.
  // Not a `PageComponentType` member: it reaches the type union through the
  // open string arm, as `element:metadata_viewer` does, and the row is what
  // makes it known. Key set measured at the `.objectui-sha` pin; see the
  // schema's own header.
  'record:line_items': RecordLineItemsProps,

  // Navigation
  'app:launcher': emptyProps('app:launcher'),
  'nav:menu': emptyProps('nav:menu'),
  'nav:breadcrumb': emptyProps('nav:breadcrumb'),

  // Utility
  'global:search': emptyProps('global:search'),
  'global:notifications': emptyProps('global:notifications'),
  // RETIRED at element grain (#14159, ruling B: not author-placeable) — the
  // row STAYS, as for `element:filter` / `element:form` below, so every reader
  // that dispatches on the row (the #5068 props gate, `check-yaml-examples`,
  // the vocabulary's known set) keeps recognising the name and refuses it with
  // the prescription instead of skipping it as an unregistered custom string.
  // All three names are refused at the node by `PageComponentSchema.type`; the
  // rows differ only in what they have to say about a bag that door no longer
  // lets through. This type never had an authorable key, so the WHOLE bag is
  // refused — `{}` included. The two elements below carry six tombstoned keys
  // each, where a per-key prescription says more than one whole-bag refusal
  // could.
  'user:profile': retiredComponentProps('user:profile'),

  // Plugin console widgets — #11575, the #8691/#8744 mechanism two instances
  // over, on `@objectstack/cloud-connection`'s published Setup pages: both
  // types are console-registered renderers reachable only through the type
  // union's open string arm, and with no row here the #5068 gate's dispatch
  // skipped them as unregistered — any authored key would have ridden through
  // in silence (nothing authors one today: both shipped pages carry `{}`).
  // Key sets measured from the renderers' ACTUAL read points at the
  // `.objectui-sha` pin (app-shell `console/cloud-connection/
  // CloudConnectionPanel.tsx`, `console/marketplace/InstalledListWidget.tsx`):
  // both registrations discard the schema node entirely (`() => <Widget />`)
  // and neither component function takes a prop, so the accepted key set is
  // EMPTY — strict, refuses every key. The registrations' declared
  // `inputs: []` happen to agree here, but the row is the measurement, not
  // the claim (#8691/#8744 record where those diverge).
  'cloud-connection:panel': emptyProps('cloud-connection:panel'),
  'marketplace:installed-list': emptyProps('marketplace:installed-list'),
  // #12344 — the same mechanism a third instance over, on `@objectstack/mcp`'s
  // plugin-shipped Setup page (`CONNECT_AGENT_PAGE`, `connect-ui.ts`): a
  // console-registered widget reachable only through the type union's open
  // string arm, no row here, so the #5068 gate's dispatch skipped it and door 3
  // of the mcp canonical-envelope gate (#12269) had to carry a standing
  // exemption for it. Key set measured from the renderer's ACTUAL read points
  // at the `.objectui-sha` pin (app-shell `console/connect/
  // ConnectAgentWidget.tsx`): the registration discards the schema node
  // entirely (`() => <ConnectAgent />`) and the component function takes no
  // parameters — every value it renders comes from `/discovery`, i18n and its
  // own state, never from the authored bag — so the accepted key set is EMPTY:
  // strict, refuses every key. The registration's declared `inputs: []`
  // happens to agree, but the row is the measurement, not the claim
  // (#8691/#8744 record where those diverge). The shipped page authors `{}`.
  'mcp:connect-agent': emptyProps('mcp:connect-agent'),

  // AI
  'ai:chat_window': AIChatWindowProps,
  'ai:suggestion': strictObject({
    surface: 'this `ai:suggestion`',
    history: PROPS_HISTORY,
    guidanceSets: COMPONENT_LEVEL_GUIDANCE,
  }, { context: z.string().optional() }),

  // Content Elements
  'element:text': ElementTextPropsSchema,
  'element:number': ElementNumberPropsSchema,
  'element:image': ElementImagePropsSchema,
  'element:metadata_viewer': ElementMetadataViewerPropsSchema, // ADR-0051: inline read-only metadata view (embeddableInDoc)
  'element:divider': emptyProps('element:divider'),

  // Interactive Elements
  'element:button': ElementButtonPropsSchema,
  // RETIRED at element grain (#9220) — the row STAYS so the #5068 props gate
  // keeps dispatching on the type and refusing every authored key with the
  // prescription; deleting it would demote `element:filter` to an unregistered
  // custom string the gate deliberately skips. See the schema's own header.
  'element:filter': ElementFilterPropsSchema,
  // RETIRED at element grain (#9249) — the row STAYS for the same reason as
  // `element:filter` above: the #5068 props gate must keep dispatching on the
  // type and refusing every authored key with the prescription (which names
  // the live replacement, the object-bound `object-form` block below).
  'element:form': ElementFormPropsSchema,
  'element:record_picker': ElementRecordPickerPropsSchema,
  'element:text_input': ElementTextInputPropsSchema,
  // #20371 — the two `element:*` lists in objectui's curated public
  // vocabulary. Until these rows the pair sat inside the reserved `element:`
  // namespace with no enum member and no row, so `component-type-unknown`
  // refused both nodes outright. The rows are what admit them to the
  // `element:` vocabulary (`component-type-vocabulary.ts` derives the known
  // set from this map's keys), on the three-part evidence that vocabulary's
  // string-arm ledger asks of a type admitted without an enum member — all
  // measured at the pin this repo builds against (`.objectui-sha` =
  // `31971ff1e`; re-measured there 2026-10-01: `public-blocks.ts` and
  // `block-types.ts` byte-identical to `e420df310`; `data-list.tsx` changed
  // (+48/-6, objectui#11168 slice 2: both registrations publish their
  // spec-declared inputs), the `definition-list` registration not moving and
  // the `repeater` one MOVING `205` -> `233`, each still in the `element`
  // namespace; `block-config.ts` changed (+17/-4) above the two inspectors,
  // which MOVED `283-317` -> `296-330` byte-identical. At `e420df310`,
  // 2026-09-30: `data-list.tsx`,
  // `public-blocks.ts` and `block-types.ts` byte-identical to `db11afd49`, and
  // `block-config.ts` changed (+12/-3) outside the two inspectors — two
  // line-neutral one-line edits above them and an insertion below — so every
  // anchor below held unmoved; at `db11afd49`, 2026-09-29, all four files were
  // byte-identical to `dd3f7e1be`):
  //  - registration: `@object-ui/components` registers both in the `element`
  //    namespace (`components/src/renderers/basic/data-list.tsx:75`, `:233`);
  //  - publication: both are `PUBLIC_BLOCKS` members
  //    (`core/src/registry/public-blocks.ts:117-118`), which is how the
  //    tracked `sdui.manifest.json` carries both;
  //  - authorship: the Studio page designer's palette offers both
  //    (`app-shell/src/views/metadata-admin/previews/block-types.ts:136-137`),
  //    each with its own inspector (`previews/block-config.ts:296-330`), so
  //    stored pages hold them.
  'element:definition-list': ElementDefinitionListPropsSchema,
  'element:repeater': ElementRepeaterPropsSchema,

  // Actions — #20371. The same curated vocabulary's four `action:*` blocks
  // (`core/src/registry/public-blocks.ts:119-122` at the pin), registered by
  // `@object-ui/components` in the `action` namespace
  // (`components/src/renderers/action/`) and taught by objectui's own
  // AGENTS.md as the node that runs an action. `action:` is not a namespace
  // the enum populates, so these rows add no vocabulary claim; what they add
  // is the props gate's dispatch, which skipped all four until now. Key sets
  // measured from the renderers' read points — see section 4b above.
  'action:button': ActionButtonPropsSchema,
  'action:group': ActionGroupPropsSchema,
  'action:menu': ActionMenuPropsSchema,
  'action:icon': ActionIconPropsSchema,

  // Object-bound SDUI blocks (#7751, maintainer ruling 2026-08-12 direction A).
  // Key sets derived from the objectui renderers' own read points — see the
  // section header above. `object-chart` is deliberately absent (ditto).
  'object-grid': ObjectGridPropsSchema,
  'object-metric': ObjectMetricPropsSchema,
  'object-kanban': ObjectKanbanPropsSchema,
  'object-calendar': ObjectCalendarPropsSchema,
  'object-form': ObjectFormPropsSchema,
  'object-master-detail-form': ObjectMasterDetailFormPropsSchema,
  // #18305, executing the objectui#8348 ruling 「8348 以协议为准」 (batch #83)
  // and batch #136 item 3 (Q1-C). The three blocks this section enumerated
  // past: they were not ruled out, they were simply never measured, so the
  // #5068 gate skipped them and objectui's OWN mirror stood in as the
  // authority for map and gantt while tree's rung-1 `data` read stayed
  // undeclared on every face. Key sets measured from the renderers' read
  // points at the pin this repo builds against (`.objectui-sha` =
  // `31971ff1e`), all three re-measured there 2026-10-01 (`ObjectMap.tsx`,
  // `ObjectGantt.tsx` and `ObjectTree.tsx` are byte-identical to `e420df310`,
  // so no declared key set moved and no read point died. At `e420df310`,
  // 2026-09-30, all three renderers
  // changed and were re-READ: `ObjectMap.tsx` in one docblock, `ObjectGantt.tsx`
  // in objectui#11141's inclusive date-only end, and `ObjectTree.tsx`, whose
  // rung-1 call now passes the `view-data` arm this row declares and whose
  // host-data read stopped reading the authored `schema.data`, objectui#8348;
  // the `schema.*` read set of each is unchanged, so no declared key set moved
  // and no read point died. At `db11afd49`, 2026-09-29: `ObjectMap.tsx`
  // byte-identical to `dd3f7e1be`, `ObjectTree.tsx` changed in one comment line,
  // `ObjectGantt.tsx` in its date-only DST handling and citations; the `schema.*`
  // read set of each is unchanged, so no declared key set moved and no read point
  // died. At `dd3f7e1be`, 2026-09-28, all three renderers
  // changed and were re-READ — no declared key set moved and no read point
  // died; each block's `filter` is now resolved for context tokens before it
  // reaches `$filter`, objectui#10666, and the bare `map` registration is
  // retired, objectui#10393. At `f8a9d0fb0` the map was byte-identical to
  // `62597c588`; the gantt and tree renderers changed and were re-READ — no
  // declared key set moved, the gantt's new `search` / `searchableFields`
  // reads are recorded in its header as host-generated and undeclared, and
  // the tree lost its `filter.tree` stash read; at `62597c588` gantt and
  // tree were byte-identical to `87af769e9`, where all three were
  // re-READ 2026-09-22) — per-block citations in
  // each schema's header, including what each block reads and deliberately
  // does NOT declare, and what the hop from `53ded82bf` deleted rather than
  // moved.
  'object-map': ObjectMapPropsSchema,
  'object-gantt': ObjectGanttPropsSchema,
  'object-tree': ObjectTreePropsSchema,
  // Commit e233db9db, the row half of the objectui#8652 ruling (verbatim `B`). Same
  // mechanism as the three rows above, on the LAST object-bound block that had
  // none: registered in objectui (`plugin-timeline`), reachable through the
  // type union's open string arm, and with no row here the #5068 gate skipped
  // it — so `object-timeline` was unjudged in both directions, a real key and
  // a typo riding through alike. Key set measured from the renderer's read
  // points at the pin this repo builds against (`.objectui-sha` =
  // `31971ff1e`), re-measured there 2026-10-01 (`renderer.tsx` byte-identical
  // to `e420df310`; `ObjectTimeline.tsx` and `index.tsx` changed for
  // objectui#8654 — a typed `navigation` member read without its cast, and a
  // `navigation` input on both registrations — both re-READ, the `schema.*`
  // read set unchanged, since `navigation` was already read and is declared
  // on this row, and every anchor moved with its text byte-identical but the
  // one navigation read. At `e420df310`, 2026-09-30: `ObjectTimeline.tsx`
  // byte-identical to `db11afd49`; `index.tsx` gained `filter` / `sort` inputs,
  // objectui#8220, and `renderer.tsx` changed, objectui#11141, both re-READ,
  // the `schema.*` read set unchanged and every anchor moved with its text
  // byte-identical. At `db11afd49`, 2026-09-29: `ObjectTimeline.tsx` and
  // `index.tsx` byte-identical to `dd3f7e1be`; `renderer.tsx` changed and was
  // re-READ, its `schema.*` read set unchanged and its three anchors moved with
  // their text byte-identical. At `dd3f7e1be`, 2026-09-28, `index.tsx`
  // byte-identical to
  // `f8a9d0fb0`; `ObjectTimeline.tsx` and `renderer.tsx` changed and were
  // re-READ — no declared key set moved and no read point died, the `filter`
  // now resolved for context tokens before `$filter`, objectui#10666. At
  // `f8a9d0fb0`, `ObjectTimeline.tsx` and `index.tsx` were byte-identical to
  // `62597c588` and `87af769e9`, where it was re-READ 2026-09-22, and
  // `renderer.tsx`'s three anchors moved with their text
  // byte-identical); the schema's own header
  // carries the per-key citations and what it deliberately does NOT declare.
  'object-timeline': ObjectTimelinePropsSchema,
} as const;

/**
 * Type Helper to extract props from map
 */
export type ComponentProps<T extends keyof typeof ComponentPropsMap> = z.infer<typeof ComponentPropsMap[T]>;
export type ComponentPropsInput<T extends keyof typeof ComponentPropsMap> = z.input<typeof ComponentPropsMap[T]>;

/**
 * One position where a page component nests child page components inside its
 * `properties` bag — an entry of {@link pageComponentSlotPositions} (#20940).
 */
export interface PageComponentSlotPosition {
  /**
   * The `properties` key the position hangs off: the child-component list
   * itself (`children`, `footer`), or — on a PANEL position — the list of
   * panels (`items`).
   */
  readonly key: string;
  /**
   * Set on a panel position only: each object entry of `properties[key]` holds
   * its child components under this key (`page:tabs` / `page:accordion` →
   * `items[].children`). The panel object itself is not a component, and an
   * entry that is not an object carrying this array is not a panel.
   */
  readonly panelKey?: string;
  /**
   * `true` for a TOMBSTONED spelling of a slot (`page:card.body`, #5775). The
   * renderers still read it for stored documents, so the ADR-0087 conversion
   * walker descends it; it is not an authorable spelling, so the authoring
   * walks (`walkAddressedPageComponents`, lint's `walkPageComponents`) skip it.
   */
  readonly retired: boolean;
}

/**
 * THE list of page-component slot positions — derived from the
 * `ComponentPropsMap` rows that declare a slot, and the one list every page
 * walk reads (#20940): the ADR-0087 conversion walker
 * (`conversions/walk.ts`, every entry), the exported
 * `walkAddressedPageComponents` (`system/i18n-resolver.ts`, non-retired
 * entries) and `@objectstack/lint`'s `walkPageComponents` (non-retired
 * entries). A walk that needs to know where sub-trees hang reads this; ⛔ it
 * never keeps a list of its own, which is how the three came to disagree about
 * `page:card.footer`.
 *
 * A key is a slot exactly when its row wraps the key's schema in
 * `componentSlot` / `retiredComponentSlot` (module-private, top of this file);
 * a key of a panel list's element object (`items: z.array(z.object({ children
 * }))`) so marked yields a panel position. The walks match a position by SHAPE
 * on every component, not by the type whose row declared it: `properties` is an
 * open bag and custom types compose the same vocabulary.
 *
 * Order is the walks' visit order: direct slots in the order the rows first
 * declare them, then panel positions — so `children` is still walked before
 * `items[].children`, the order `walkAddressedPageComponents` has arbitrated
 * nested-id collisions in since #16772.
 *
 * Derived on FIRST CALL and memoized, never at import: reading every row's
 * shape constructs the `lazySchema` rows, which import must not pay for
 * (measured once on the dev box: ~18 ms and under 1 MB of heap, once per
 * process). Two rows declaring one position with contradicting retirement, or
 * one key declared both as a slot and as a panel list, throw — a walk has no
 * way to honour both.
 */
export function pageComponentSlotPositions(): readonly PageComponentSlotPosition[] {
  // Memoized on the function object rather than a module-level `let`: the
  // same hoisting reasoning as `closedObjectConstructor` (strict-object.ts) —
  // a caller reaching this during module evaluation meets a function, never a
  // binding in its temporal dead zone.
  const self = pageComponentSlotPositions as unknown as { derived?: readonly PageComponentSlotPosition[] };
  return (self.derived ??= deriveComponentSlotPositions());
}

/** The slice of a zod schema's `_zod.def` the derivation below reads. */
interface SlotDerivationDef {
  type?: string;
  innerType?: unknown;
  element?: unknown;
}

const slotDerivationDef = (schema: unknown): SlotDerivationDef | undefined =>
  (schema as { _zod?: { def?: SlotDerivationDef } } | undefined)?._zod?.def;

/**
 * The slot declaration on `schema`, looking through the wrapper types
 * (`optional`, `default`, `nullable`, …) that carry an `innerType`, so a
 * marker applied under a later `.optional()` is still found.
 */
function componentSlotDeclarationOf(schema: unknown): { readonly retired: boolean } | undefined {
  let current: unknown = schema;
  while (current !== null && (typeof current === 'object' || typeof current === 'function')) {
    const declared = COMPONENT_SLOT_DECLARATIONS.get(current);
    if (declared) return declared;
    current = slotDerivationDef(current)?.innerType;
  }
  return undefined;
}

/** The element schema of an array schema (through its wrappers), or `undefined`. */
function componentSlotArrayElementOf(schema: unknown): unknown {
  let current: unknown = schema;
  while (current !== null && (typeof current === 'object' || typeof current === 'function')) {
    const def = slotDerivationDef(current);
    if (def?.type === 'array') return def.element;
    current = def?.innerType;
  }
  return undefined;
}

/** An object schema's shape — read through a `lazySchema` proxy too — or `undefined`. */
function componentSlotShapeOf(schema: unknown): Record<string, unknown> | undefined {
  if (schema === null || (typeof schema !== 'object' && typeof schema !== 'function')) return undefined;
  const shape = (schema as { shape?: unknown }).shape;
  return shape !== null && typeof shape === 'object' ? (shape as Record<string, unknown>) : undefined;
}

function deriveComponentSlotPositions(): readonly PageComponentSlotPosition[] {
  const direct = new Map<string, PageComponentSlotPosition>();
  const panels = new Map<string, PageComponentSlotPosition>();
  const declaredBy = new Map<string, string>();

  const record = (into: Map<string, PageComponentSlotPosition>, id: string, position: PageComponentSlotPosition, type: string) => {
    const seen = into.get(id);
    if (seen === undefined) {
      into.set(id, Object.freeze(position));
      declaredBy.set(id, type);
      return;
    }
    if (seen.retired !== position.retired) {
      throw new Error(
        `pageComponentSlotPositions: \`${type}\` declares the slot position \`${id}\` `
        + `${position.retired ? 'retired' : 'authorable'} while \`${declaredBy.get(id)}\` declares it `
        + `${seen.retired ? 'retired' : 'authorable'} — the walks match positions by shape on every component, `
        + 'so one position cannot be both (component.zod.ts).',
      );
    }
  };

  for (const [type, row] of Object.entries(ComponentPropsMap)) {
    const shape = componentSlotShapeOf(row);
    if (!shape) continue;
    for (const [key, schema] of Object.entries(shape)) {
      const declared = componentSlotDeclarationOf(schema);
      if (declared) {
        record(direct, key, { key, retired: declared.retired }, type);
        continue;
      }
      const panelShape = componentSlotShapeOf(componentSlotArrayElementOf(schema));
      if (!panelShape) continue;
      for (const [panelKey, panelSchema] of Object.entries(panelShape)) {
        const inPanel = componentSlotDeclarationOf(panelSchema);
        if (inPanel) record(panels, `${key}[].${panelKey}`, { key, panelKey, retired: inPanel.retired }, type);
      }
    }
  }

  for (const panel of panels.values()) {
    if (direct.has(panel.key)) {
      throw new Error(
        `pageComponentSlotPositions: \`${panel.key}\` is declared both as a slot (by \`${declaredBy.get(panel.key)}\`) `
        + `and as a panel list (\`${panel.key}[].${panel.panelKey}\`) — a walk cannot read one key both ways (component.zod.ts).`,
      );
    }
  }

  return Object.freeze([...direct.values(), ...panels.values()]);
}
