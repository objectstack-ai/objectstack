// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { ViewFilterRuleSchema } from './view.zod';
import { InlineActionSchema } from './action.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { FeedItemType, FeedFilterMode } from '../data/feed.zod';

// ---------------------------------------------------------------------------
// CLOSED AGAINST UNKNOWN KEYS as of #4001 batch A -- all 31 object sites.
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
// — fell outside it and stayed undeclared. #6276 declared them on the same
// #5611 rule (maintainer ruling 2026-08-08, direction A). The lesson for the
// next divergence sweep: enumerate by the RENDERER'S read pattern, not by the
// key list a previous ruling happened to quote. Retiring the flat family
// wholesale in favour of `dataSource` is the standing alternative, deferred to
// v18 as #6590 — not rejected.
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
 * Empty Properties Schema
 */
import { lazySchema } from '../shared/lazy-schema';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { retiredKey } from '../shared/retired-key';
// `element:record_picker`'s flat `sort` shorthand is the SAME contract as
// `ElementDataSourceSchema.sort` (page.zod.ts) — one shape, imported from the
// shared source rather than re-spelled here (#6276).
import { SortItemSchema } from '../shared/enums.zod';
import { strictObject } from '../shared/strict-object';
import type { KeySetGuidance } from '../shared/suggestions.zod';

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
  'Until #4001 batch A an undeclared prop was dropped in silence: the props schema stripped it '
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
const COMPONENT_LEVEL_GUIDANCE: readonly KeySetGuidance[] = [
  {
    name: 'COMPONENT_NODE_VISIBILITY_KEYS',
    keys: /^(visible|visibility|visibleOn|visibleIf|visibleWhen|hidden|hiddenWhen|conceal|showWhen)$/,
    examples: ['visible', 'visibleWhen', 'visibleIf', 'hiddenWhen', 'visibility'],
    prescription:
      'Visibility is a COMPONENT-level predicate, not a prop: move it up one level to the '
      + 'component node\'s own `visibleWhen` (ADR-0089 canonical spelling), beside `type` and '
      + '`id`. Inside `properties` it is hoisted onto the node by the renderer but evaluated by '
      + 'nothing — the component renders unconditionally, which is a visibility gate that '
      + 'silently does not gate.',
  },
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
  },
];

/**
 * A component that declares no props at all — `app:launcher`, `nav:menu`,
 * `nav:breadcrumb`, `global:search`, `global:notifications`, `user:profile`,
 * `element:divider`.
 *
 * A factory rather than one shared `EmptyProps` const, because the surface name
 * is the whole value of the rejection here: an empty shape has no candidate
 * keys, so the edit-distance fallback can say nothing, and "unrecognized key on
 * this component" would leave the author guessing which of the seven it meant.
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
        + 'The renderers still read `body` as a back-compat fallback for documents stored before '
        + '#5775, but one composition key is the contract (Prime Directive #12).',
    },
  },
  {
    children: z.array(z.unknown()).optional().describe('Child components rendered inside this container, in order'),
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
    '`page:header` property `icon` was removed in @objectstack/spec 17.0.0 (#6946, ADR-0087 D2) — '
    + 'no renderer ever read it: objectui resolves `icon` only per header action (`action.icon`), '
    + 'never off the header\'s own props bag, and the component registry never published it as an '
    + 'input, so an authored value was accepted and dropped. Delete the key. The header\'s own '
    + 'identity is drawn by the record chrome (`recordChrome`, on by default) and each action '
    + 'carries its own `icon`. Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  breadcrumb: z.boolean().default(true).describe('Show breadcrumb'),
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
   * rejection — the #6276 lesson, which is to enumerate by the RENDERER'S read
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
    '`page:tabs` property `type` was removed in @objectstack/spec 17.0.0 (#6776, ADR-0087 D2) — '
    + 'a props key named `type` collides with the page component\'s own dispatch key, so it is '
    + 'unauthorable in the flat and JSX carriers and was never validated in them. Rename the key '
    + 'to `tabStyle`; the value (`line` | `card` | `pill`) is unchanged. '
    + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
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
    icon: z.string().optional(),
    /**
     * Conditional tab (CEL, #2606): when the predicate evaluates FALSE the
     * whole tab — header *and* panel — is omitted from the strip. This is the
     * item-level complement to a child component's own `visibleWhen`, which
     * hides only the panel content and would leave an empty tab header behind.
     * Binds the same environment as page-component `visibleWhen`: `record` +
     * `current_user`, plus page state as `page.<var>` (re-evaluated live).
     * Canonical `*When` name per ADR-0089 — this key is new, so the deprecated
     * `visibility` / `visibleOn` aliases are NOT ACCEPTED on tab items: unlike
     * the view/page surfaces that fold them into `visibleWhen` via
     * `normalizeVisibleWhen`, none of `visible` / `showWhen` / `visibility` /
     * `visibleOn` parses here — all four are rejected. #8382 gave the
     * rejection a pointer at this key for all four spellings (message only:
     * being pointed AT `visibleWhen` is not the same as being accepted).
     */
    visibleWhen: ExpressionInputSchema.optional().describe(
      'Visibility predicate (CEL) — the whole tab (header + panel) is omitted when FALSE; the renderer falls back to the first visible tab when the active one is hidden. Binds `record`, `current_user`, `page.<var>`. ADR-0089 canonical name — `visible`/`showWhen`/`visibility`/`visibleOn` are all rejected here (not folded in), each with a pointer at this key.',
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
    children: z.array(z.unknown()).describe('Child components')
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
    '`page:card` property `actions` was removed in @objectstack/spec 17.0.0 (#6946, ADR-0087 D2) — '
    + 'no renderer ever read it: objectui\'s card renderer builds its `<Card>` from `title`, '
    + '`bordered`, `children` and `footer` only, has no actions area, and the component registry '
    + 'never published it as an input, so an authored value was accepted and dropped. Delete the '
    + 'key and author the buttons as components in the card\'s `children` or `footer` '
    + '(`element:button`, `record:quick_actions`), which is what actually renders. '
    + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
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
  children: z.array(z.unknown()).optional().describe('Card content components, in order (the card body slot)'),
  /**
   * REMOVED (#5775). `body` was the declared spelling of the slot every other
   * container calls `children`; the two are the same slot, and the renderer
   * already reads both. The live mechanism is `children`.
   */
  body: retiredKey(
    '`page:card` property `body` was removed in @objectstack/spec 17.0.0 (#5775, ADR-0087 D2) — '
    + 'it was a second spelling of the composition slot every other container calls `children`, '
    + 'and the renderer reads both. Rename the key to `children`; the value (an array of child '
    + 'components) is unchanged. Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  /** Slot for footer content */
  footer: z.array(z.unknown()).optional().describe('Card footer components (slot)'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

/**
 * ----------------------------------------------------------------------
 * 2. Record Context Components
 * ----------------------------------------------------------------------
 */

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
    '`record:details` property `layout` was removed in @objectstack/spec 17.0.0 (#6946, ADR-0087 D2) — '
    + 'its declared `auto` | `custom` semantics were never implemented: the renderer tests `layout` '
    + 'only against `inline` | `compact`, two values the schema never permitted, so both legal '
    + 'values took the same branch and the key selected nothing. Delete the key — the body is '
    + 'already chosen by what you author: `sections` renders the explicit groups (the old '
    + '`custom`), and omitting it falls back to the object\'s `highlightFields` (the old `auto`). '
    + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
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
    /** Field names shown in this section, in order. */
    fields: z.array(z.string()).describe('Field names rendered in this section, in order'),
  })).optional().describe('Field groups rendered as the detail body, in order. Object form: `{ name?, label?, columns?, fields }`.'),
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
  columns: z.array(z.string()).optional().describe('Fields to display in the related list. Optional: when omitted, columns derive from the related object\'s highlightFields / default list columns (a related list is just another surface that lists that object). Override chain: child highlightFields → field-level relatedListColumns → this inline list.'),
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
  }, {
    name: z.string().describe('Field name on the record'),
    label: z.string().optional().describe('Display label (overrides schema label)'),
    icon: z.string().optional().describe('Icon name (lucide icon key)'),
    type: z.string().optional().describe('Override cell renderer type (rare)'),
    // #5176 — declared because it is already enforced: the renderer's
    // HeaderHighlight gate refuses inline editing on a chip carrying it. Kept
    // as a declared key (ADR-0049 enforce-or-remove, satisfied on arrival)
    // rather than an undeclared key the renderer happens to honour — an
    // undeclared key is silently stripped here, which turns a machine-owned
    // column editable again with no diagnostic anywhere.
    readonly: z.boolean().optional().describe('Render this chip read-only — suppresses inline editing on the highlight card. Use for hook/automation-maintained columns that must not be hand-edited from the record header.'),
  }),
]).describe('Highlight field: bare name, or {name,label?,icon?,type?,readonly?}');
export type RecordHighlightsField = z.input<typeof RecordHighlightsField>;

export const RecordHighlightsProps = strictObject({
  surface: 'this `record:highlights`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  fields: z.array(RecordHighlightsField).min(1).max(7).describe('Key fields to highlight (1-7 fields max, typically displayed as prominent cards). Each item may be a bare field name or {name, label?, icon?, type?, readonly?} for inline overrides.'),
  layout: z.enum(['horizontal', 'vertical']).default('horizontal').describe('Layout orientation for highlight fields'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const RecordActivityProps = strictObject({
  surface: 'this `record:activity`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  /** Activity types to display (unified enum including comment, field_change, etc.) */
  types: z.array(FeedItemType).optional().describe('Feed item types to show (default: all)'),
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

export const RecordChatterProps = strictObject({
  surface: 'this `record:chatter`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  /** Panel position */
  position: z.enum(['sidebar', 'inline', 'drawer']).default('sidebar').describe('Where to render the chatter panel'),
  /** Panel width (for sidebar/drawer) */
  width: z.union([z.string(), z.number()]).optional().describe('Panel width (e.g., "350px", "30%")'),
  /** Collapsible */
  collapsible: z.boolean().default(true).describe('Whether the panel can be collapsed'),
  /** Default collapsed state */
  defaultCollapsed: z.boolean().default(false).describe('Whether the panel starts collapsed'),
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
    icon: z.string().optional(),
    collapsed: z.boolean().default(false),
    children: z.array(z.unknown()).describe('Child components'),
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
  variant: z.enum(['heading', 'subheading', 'body', 'caption'])
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
  filter: FilterConditionSchema.optional().describe('Filter criteria'),
  format: z.enum(['number', 'currency', 'percent']).optional().describe('Number display format'),
  prefix: z.string().optional().describe('Prefix text (e.g. "$")'),
  suffix: z.string().optional().describe('Suffix text (e.g. "%")'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));
export type ElementNumberProps = z.input<typeof ElementNumberPropsSchema>;

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
  icon: z.string().optional().describe('Icon name (Lucide icon)'),
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

export const ElementFilterPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:filter`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  object: z.string().describe('Object to filter'),
  fields: z.array(z.string()).describe('Filterable field names'),
  targetVariable: z.string().optional().describe('Page variable to store filter state'),
  layout: z.enum(['inline', 'dropdown', 'sidebar'])
    .optional().default('inline').describe('Filter display layout'),
  showSearch: z.boolean().optional().default(true).describe('Show search input'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

export const ElementFormPropsSchema = lazySchema(() => strictObject({
  surface: 'this `element:form`',
  history: PROPS_HISTORY,
  guidanceSets: COMPONENT_LEVEL_GUIDANCE,
}, {
  object: z.string().describe('Object for the form'),
  fields: z.array(z.string()).optional().describe('Fields to display (defaults to all editable fields)'),
  mode: z.enum(['create', 'edit']).optional().default('create').describe('Form mode'),
  submitLabel: I18nLabelSchema.optional().describe('Submit button label'),
  onSubmit: ExpressionInputSchema.optional().describe('Action expression on form submit (CEL)'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
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
 * ⚠️ #6276 finished the same inventory one key-pair later, and the finding is
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
 * cross-element decision (`element:form` / `element:filter` carry the same flat
 * `object`), tracked as #6590 for v18, and A does not block it. When B lands
 * these two retire alongside `object` / `filter` under ADR-0087, together.
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
  filter: FilterConditionSchema.optional().describe('Filter criteria for available records'),
  /**
   * Row order (#6276). The flat shorthand for `dataSource.sort`, and the same
   * shape — `SortItemSchema[]`, the pairs the renderer forwards to the query as
   * `$orderby`. `dataSource.sort` wins when both are written
   * (`ds.sort ?? props.sort`).
   */
  sort: z.array(SortItemSchema).optional()
    .describe('Row order — synonym of the component-level `dataSource.sort`, which takes precedence when both are set'),
  /**
   * Row cap (#6276). The flat shorthand for `dataSource.limit`, same shape.
   * `dataSource.limit` wins when both are written, and with neither the
   * renderer queries `$top: 50` (`ds.limit ?? props.limit ?? 50`) — that 50 is
   * the renderer's fallback, not a schema default, so it is documented here
   * rather than declared: declaring it would materialize a `limit: 50` on every
   * parsed picker and turn an unset key into an authored one.
   */
  limit: z.number().int().positive().optional()
    .describe('Max records offered — synonym of the component-level `dataSource.limit`, which takes precedence when both are set (renderer default 50)'),
  targetVariable: z.string().optional().describe('Page variable to bind selected record ID(s)'),
  placeholder: I18nLabelSchema.optional().describe('Placeholder text'),
  /** Shown in place of the row list when the query returns nothing. */
  emptyText: I18nLabelSchema.optional().describe('Text shown when the query returns no records (default "No records")'),
  /**
   * REMOVED (#5775). A synonym of `labelField` — the same concept in two
   * spellings, of which only `labelField` was ever read.
   */
  displayField: retiredKey(
    '`element:record_picker` property `displayField` was removed in @objectstack/spec 17.0.0 '
    + '(#5775, ADR-0087 D2) — it was a required declaration no renderer ever read, while the '
    + 'renderer honoured `labelField` for the same thing and defaulted to `name`. Rename the key '
    + 'to `labelField`; the value (a field name) is unchanged. '
    + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  /**
   * REMOVED (#5775). ADR-0049 enforce-or-remove: the control has no search
   * box, so this narrowed nothing.
   */
  searchFields: retiredKey(
    '`element:record_picker` property `searchFields` was removed in @objectstack/spec 17.0.0 '
    + '(#5775, ADR-0049) — the picker renders a plain single-select with no search input, so no '
    + 'renderer ever read it and it narrowed nothing. Delete the key. To restrict which records '
    + 'the picker offers, use `filter` (or the component-level `dataSource.filter`), which the '
    + 'query path does apply. Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  /**
   * REMOVED (#5775). ADR-0049 enforce-or-remove: the control is a single-select
   * `Select`, and a page variable binds one record id.
   */
  multiple: retiredKey(
    '`element:record_picker` property `multiple` was removed in @objectstack/spec 17.0.0 '
    + '(#5775, ADR-0049) — the picker is a single-select `Select` and the bound page variable '
    + 'holds one record id, so `multiple: true` selected nothing extra and reported success. '
    + 'Delete the key; multi-record selection is not implemented on this element. '
    + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));
export type ElementRecordPickerProps = z.input<typeof ElementRecordPickerPropsSchema>;

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
  targetVariable: z.string().optional()
    .describe('Page variable this input writes to. Declarative hint; the live binding resolves via the variable whose `source` equals this component id (see PageVariableSchema).'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

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
  'record:path': RecordPathProps,

  // Navigation
  'app:launcher': emptyProps('app:launcher'),
  'nav:menu': emptyProps('nav:menu'),
  'nav:breadcrumb': emptyProps('nav:breadcrumb'),

  // Utility
  'global:search': emptyProps('global:search'),
  'global:notifications': emptyProps('global:notifications'),
  'user:profile': emptyProps('user:profile'),
  
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
  'element:filter': ElementFilterPropsSchema,
  'element:form': ElementFormPropsSchema,
  'element:record_picker': ElementRecordPickerPropsSchema,
  'element:text_input': ElementTextInputPropsSchema,
} as const;

/**
 * Type Helper to extract props from map
 */
export type ComponentProps<T extends keyof typeof ComponentPropsMap> = z.infer<typeof ComponentPropsMap[T]>;
export type ComponentPropsInput<T extends keyof typeof ComponentPropsMap> = z.input<typeof ComponentPropsMap[T]>;
