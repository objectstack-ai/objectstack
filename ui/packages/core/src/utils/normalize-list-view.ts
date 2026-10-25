/**
 * ObjectUI — list-view vocabulary canonicalization
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ViewType } from '@object-ui/types';
import type { RowHeight } from '@objectstack/spec/ui';

import { normalizeColumnIdentities } from './column-identity.js';

/** ListView's toolbar density vocabulary — three steps, not the spec's five. */
export type DensityMode = 'compact' | 'comfortable' | 'spacious';

/**
 * The spec's `RowHeightSchema` vocabulary — **re-exported, not re-declared**.
 *
 * The hand-written union that used to sit here already advertised itself as
 * "the spec's `RowHeightSchema` vocabulary" in its doc comment, which is the
 * failure class objectstack#4115 is about: the claim was true when written and
 * nothing would have caught the day it stopped being true. The maps below are
 * `Record<RowHeight, …>`, so a spec-side addition now fails the build here
 * instead of silently leaving a row height with no density mapping.
 */
export type { RowHeight };

/**
 * `densityMode` → `rowHeight`. The two vocabularies are not the same size: the
 * spec has five row heights, ListView's toolbar offers three. Widening maps
 * each density onto the spec value the renderer already resolves it back to
 * (see {@link ROW_HEIGHT_TO_DENSITY_MODE}), so a fold followed by a read is a
 * round trip — `spacious` → `tall` → `spacious`.
 */
export const DENSITY_MODE_TO_ROW_HEIGHT: Record<DensityMode, RowHeight> = {
  compact: 'compact',
  comfortable: 'medium',
  spacious: 'tall',
};

/**
 * `rowHeight` → `densityMode`, the read direction. Narrowing five values onto
 * three is lossy by construction: `short` collapses into `compact` and
 * `extra_tall` into `spacious`. Exported so the renderer and the persistence
 * layer agree on the collapse instead of each hard-coding its own table.
 */
export const ROW_HEIGHT_TO_DENSITY_MODE: Record<RowHeight, DensityMode> = {
  compact: 'compact',
  short: 'compact',
  medium: 'comfortable',
  tall: 'spacious',
  extra_tall: 'spacious',
};

/**
 * Runtime reader for {@link ROW_HEIGHT_TO_DENSITY_MODE}: the spec's five row
 * heights narrowed onto the renderer's three densities, and **nothing else**.
 *
 * The parameter stays `unknown` because this is the boundary user-authored view
 * metadata actually crosses — `ListViewSchema.rowHeight` is statically a
 * `RowHeight`, but the value arrives from stored view definitions TypeScript
 * never saw (`ObjectView`: `viewDef.rowHeight ?? listSchema.rowHeight`). The
 * type-level half of the guarantee is the `Record<RowHeight, …>` on the table
 * above, which fails the build when the spec grows a row height.
 *
 * An off-spec value gets NO density (objectui#4440). It used to be coerced to
 * `comfortable`, which is the opposite of what `@object-ui/react`'s spec bridge
 * answers for the same string after objectui#4352 — one metadata-driven system
 * holding two answers for one input. AGENTS.md #0.1 decides which one survives:
 * a renderer-side rehabilitation of off-spec metadata is a second de-facto
 * contract, and one strict contract beats N. The producer is where a bad
 * `rowHeight` gets fixed.
 *
 * Callers apply their own "nothing was said" default to `undefined`, so an
 * off-spec row height now renders exactly like an absent one — `'compact'` in
 * both `ListView` and `ObjectGrid`.
 *
 * `hasOwnProperty`, not `in`: `in` walks the prototype chain, so `'toString'`
 * used to come back as `Object.prototype.toString` — a FUNCTION returned from
 * something typed `DensityMode`.
 */
export function rowHeightToDensityMode(rowHeight: unknown): DensityMode | undefined {
  if (typeof rowHeight !== 'string') return undefined;
  if (!Object.prototype.hasOwnProperty.call(ROW_HEIGHT_TO_DENSITY_MODE, rowHeight)) {
    return undefined;
  }
  return ROW_HEIGHT_TO_DENSITY_MODE[rowHeight as RowHeight];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Legacy toolbar-visibility flags → their `userActions` key (#2890 scope A
 * step 3). The spec documents `userActions` as "which interactive actions are
 * available to users in the view toolbar", and already carries `rowHeight` —
 * objectui's `showDensity` under its spec name. `group` / `hideFields` /
 * `rowColor` are the same kind of toggle and are named after the config key
 * they gate (`grouping`, `hiddenFields`, `rowColor`).
 *
 * That promotion has LANDED (objectui#5435, ruled Option A 2026-08-22):
 * `UserActionsConfigSchema` declares all three from `@objectstack/spec@17.3.0`,
 * and the spec's declaring docblock names this card. Every key this table emits
 * is therefore authorable, which
 * `__tests__/normalize-list-view.foldOutputAuthorable-5435.test.ts` pins with a
 * firing control. ⛔ Do not read the three as legacy-only spellings awaiting
 * retirement — the protocol declares them, so removing them here would leave
 * objectui narrower than the protocol.
 *
 * ⛔ `inlineEdit` → `editInline` is NOT a row here, although it lands in the same
 * block (objectui#5144). Every row of this table is deleted after it folds;
 * `inlineEdit` must survive its fold, because it is also the MODE `ListView`
 * opens the grid in. See {@link foldsInlineEditIntoEditInline}.
 */
const SHOW_FLAG_TO_USER_ACTION: Record<string, string> = {
  showSearch: 'search',
  showSort: 'sort',
  showFilters: 'filter',
  showDensity: 'rowHeight',
  showGroup: 'group',
  showHideFields: 'hideFields',
  showColor: 'rowColor',
};

/**
 * Whether a view's `inlineEdit` folds into `userActions.editInline`
 * (objectui#5144, the maintainer's B-fold).
 *
 * The spec declares `userActions.editInline` with `.default(true)` since the
 * maintainer's v18 ruling (objectstack#22605): a list is editable in place by
 * default, and `editInline: false` is the opt-out. It declares the view's
 * `inlineEdit` as the same kind of permission ("allow inline editing"). Stored
 * views carry `inlineEdit`, not `editInline`: authored views declare it, and
 * the console's list toolbar used to write it. Folding it here puts both keys
 * on one vocabulary, so `ListView` can read `editInline` with the spec default
 * and a view's own `inlineEdit` still decides it when `editInline` is absent.
 *
 * The console's toolbar no longer writes `inlineEdit` (objectui#5144, ruling
 * E). It persisted a user's edit mode into this permission key, so switching
 * the toggle off stored `inlineEdit: false` and the fold then read the view as
 * not offering inline editing. The toggle is session state now.
 *
 * Two rules, each the same as a fold above:
 *  - The value carries over: `inlineEdit: true` folds to `editInline: true`,
 *    and `inlineEdit: false` to `editInline: false`.
 *  - An explicit `userActions.editInline` wins. It is the spec key, so a
 *    stored `inlineEdit` only fills the gap.
 *
 * One departure, the `data` → `objectName` one: `inlineEdit` is KEPT. The other
 * folds delete because the legacy key has one meaning and one home.
 * `inlineEdit` has a second use. It is the spec's own `ListView.inlineEdit`,
 * and `ListView` seeds the grid's edit MODE from it on each load. The toolbar
 * toggle then flips that mode for the session. `editInline` decides whether
 * the toggle is offered at all. Deleting `inlineEdit` would open every such
 * view out of edit mode.
 */
function foldsInlineEditIntoEditInline(s: Record<string, unknown>): boolean {
  if (typeof s.inlineEdit !== 'boolean') return false;
  return !(isRecord(s.userActions) && typeof s.userActions.editInline === 'boolean');
}

/**
 * Legacy `sharing.visibility` → the spec's `ViewSharing.type`. The spec models
 * two ownership kinds; objectui's four-value audience enum collapses onto them:
 * only `private` is personal, everything wider is collaborative.
 */
const VISIBILITY_TO_SHARING_TYPE: Record<string, 'personal' | 'collaborative'> = {
  private: 'personal',
  team: 'collaborative',
  organization: 'collaborative',
  public: 'collaborative',
};

/** Legacy ARIA spellings → the spec's `AriaProps` keys. */
const ARIA_KEY_ALIASES: Record<string, string> = {
  label: 'ariaLabel',
  describedBy: 'ariaDescribedBy',
};

/**
 * A visualization `ListView` actually draws — one member per `case` in its
 * `viewComponentSchema` switch (`packages/plugin-list/src/ListView.tsx`).
 *
 * DERIVED from {@link ViewType} (`ca3942729`), which is itself derived from
 * `@objectstack/spec/ui` `ListView['type']`. Spelled as an `Exclude` of the
 * members this renderer does not draw rather than as the spec's own
 * `VisualizationType`, deliberately: `Exclude` leaves the SPEC's list as the
 * thing being subtracted from, so ANY member the spec adds — visualization or
 * not — lands here as a required key and fails the build, which is what the
 * promise below actually says. Keying on `VisualizationType` instead would let
 * a future non-visualization list type (another `page`) pass this site in
 * silence, which is the exact failure being fixed.
 *
 * ⭐ What it subtracts is {@link UndrawableViewKind} — the keys of
 * {@link UNDRAWABLE_VIEW_KINDS} the current `ViewType` still carries — and
 * never a literal list of kinds (objectui#9880). A literal list is a second
 * hand-written copy of the vocabulary, the failure class `ca3942729` removed
 * from `ViewType` itself, and it rots in the direction the spec actually moved:
 * `Exclude<ViewType, 'list' | 'detail' | 'page'>` kept subtracting `'page'`
 * after objectstack RETIRED it, where `Exclude` of a non-member is a silent
 * no-op no compiler reads. The sibling record's excess `page:` key is what went
 * red; this line stayed green while saying something that had stopped being
 * true.
 *
 * It happens to equal `@objectstack/spec/ui`'s `VisualizationType` today. That
 * is a fact about the resolved spec, not the definition.
 */
export type ListViewVisualization = Exclude<ViewType, UndrawableViewKind>;

/**
 * The view kinds `ListView` actually draws.
 *
 * A total `Record<…, true>` over {@link ListViewVisualization}, for the same
 * reason the density maps above are `Record<RowHeight, …>`: a kind added to the
 * union fails the build HERE instead of silently staying unreadable authored
 * input.
 *
 * ⚠️ That promise was FALSE between `@objectstack/spec@17.3.0` and `ca3942729`.
 * `ViewType` was a hand-written copy of the spec's list, so this map was total
 * over the copy and compiled green while the spec's `page` had nowhere to land.
 * Both faces are derived now, and the two totality structures below close the
 * other half of the union, so every member of the spec's list is accounted for
 * by a structure that fails the build rather than by a reader's memory.
 *
 * `hasOwnProperty`, not `in` — same trap as {@link rowHeightToDensityMode}:
 * `in` walks the prototype chain, so `'toString'` would read as a view kind.
 */
const LIST_VIEW_KINDS: Record<ListViewVisualization, true> = {
  grid: true,
  kanban: true,
  gallery: true,
  calendar: true,
  timeline: true,
  gantt: true,
  map: true,
  chart: true,
  tree: true,
};

/**
 * Every member of {@link ViewType} that {@link LIST_VIEW_KINDS} does NOT carry,
 * with the reason — and, where the answer is "the author authored something
 * valid and will get a grid", the sentence to say out loud.
 *
 * The two tables together still partition the derived union — a member the spec
 * ADDS must be classed as drawable or explained HERE, and until it is the build
 * is red — but the red lands on {@link LIST_VIEW_KINDS} alone, because a kind
 * neither table classes is not extracted into {@link UndrawableViewKind} and so
 * stays inside {@link ListViewVisualization}, whose record is total. A key
 * MISSPELLED here fails the same way, for the same reason: the kind it was
 * meant to class is not extracted either. Both directions are pinned in
 * `__tests__/normalize-list-view.undrawableBothLegs-9880.test.ts` rather than
 * asserted in this sentence.
 *
 * ⛔ NOT annotated `Record<Exclude<ViewType, ListViewVisualization>, …>`, and
 * the `satisfies` is not a style choice (objectui#9880). An annotation makes
 * the literal EXACT in BOTH directions: a kind the spec adds is a missing key
 * (wanted) and a kind the spec RETIRES is an EXCESS PROPERTY — a TS2353 that
 * demands a deletion this repository cannot make while it resolves a published
 * spec which still carries the kind (as it did with `page` through 17.4.0).
 * `satisfies` keeps the value constraint
 * (every reason is a `string` or `null`) and drops the exactness, which is what
 * lets one spelling compile against both the pinned published spec and one
 * built from objectstack `main`.
 *
 * `null` means silence is correct — these are objectui view CATEGORIES, never
 * authored as a list-view kind:
 *  - `list` is the view CATEGORY, not a kind — it already folds to `grid`.
 *  - `detail` is a different renderer (`plugin-detail`), never a ListView case.
 *
 * `page` had a row here until objectui#11073. objectstack#17063 removed
 * `type: 'page'` from the list-view enum, and the row answered for it while this
 * repository still resolved a spec that published the kind. `@objectstack/spec`
 * 17.5.0 carries the removal: both published `@object-ui/types` faces refuse
 * `page`, `Extract` no longer extracted the row, and the residual pins that held
 * it (`normalize-list-view.pageResidual-8429.test.ts`) were converted, so it was
 * deleted as it said it would be. A stored `page` view now degrades like any
 * kind outside the vocabulary.
 */
const UNDRAWABLE_VIEW_KINDS = {
  list: null,
  detail: null,
} satisfies Record<string, string | null>;

/**
 * The members of the current {@link ViewType} that {@link UNDRAWABLE_VIEW_KINDS}
 * classes — the other half of the partition, derived rather than written out.
 *
 * `Extract` over the table's keys, not the table's raw `keyof`, is the load-
 * bearing operator (objectui#9880): the table may carry a row for a kind the
 * spec has since RETIRED, and `Extract` drops that row from the TYPE without
 * the table having to lose it at runtime. That is what made one spelling
 * correct against both the published spec (which published `page` through
 * 17.4.0) and a spec built from objectstack `main` (which retired it), and what
 * made the row's deletion at 17.5.0 a plain deletion (objectui#11073).
 */
type UndrawableViewKind = Extract<ViewType, keyof typeof UNDRAWABLE_VIEW_KINDS>;

/** One warning per undrawable kind per process — see {@link warnUndrawableViewKind}. */
const warnedUndrawableKinds = new Set<string>();

/**
 * Fail-open is **loud**, not silent — the convention this repo already applies
 * to unevaluable predicates (`../evaluator/fieldRules.ts`, objectstack#5149).
 *
 * The bug `ca3942729` records is not only that `type: 'page'` degrades to a
 * grid; it is that it degrades IDENTICALLY to a typo. Measured on `5505aec`,
 * `specType: 'page'` and `specType: 'nonsense'` both left `viewType: 'grid'`
 * with no error, no warning and no console line — and `@object-ui/types`'
 * published validator ACCEPTS `viewType: 'page'` while refusing the typo. An
 * author who writes a spec-valid view and is silently handed a different one
 * has no way to tell that from a working grid, so the degrade says so once.
 *
 * Once per kind per process, and never for the two objectui categories: this
 * runs inside a normalizer that a render can call on every keystroke, and the
 * point is one line, not a scrolling wall.
 */
function warnUndrawableViewKind(kind: string): void {
  const reason = Object.prototype.hasOwnProperty.call(UNDRAWABLE_VIEW_KINDS, kind)
    ? UNDRAWABLE_VIEW_KINDS[kind as keyof typeof UNDRAWABLE_VIEW_KINDS]
    : null;
  if (reason === null || warnedUndrawableKinds.has(kind)) return;
  warnedUndrawableKinds.add(kind);
  console.warn(
    `[object-ui] This build accepts a ${JSON.stringify(kind)} list view but cannot draw one: ` +
      `${reason}. The view falls back to a grid. ` +
      'Author a visualization this renderer draws, or render the page through the surface that owns it.',
  );
}

/**
 * Whether `value` names a visualization `ListView` draws.
 *
 * Exported so a read site cannot restate the membership question as its own
 * literal array: the gate and the seam must answer one question, which is the
 * rule this file's own `availableViews` notes already argue for (objectui#5042,
 * objectui#7544, and now `ca3942729`).
 */
export function isListViewVisualization(value: unknown): value is ListViewVisualization {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIST_VIEW_KINDS, value);
}

/**
 * The author's view kind, or `undefined` when the value names no kind ListView
 * draws. An unrecognized kind is deliberately left unresolved rather than
 * written through to `viewType`: the caller's own `'grid'` default is a more
 * honest answer than a `viewType` no branch matches (the same call
 * `normalizeChartSchema` makes for a chart family it cannot draw).
 *
 * A kind the SPEC allows but this renderer cannot draw takes the same fallback
 * and additionally warns — see {@link warnUndrawableViewKind}.
 */
function readListViewKind(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (isListViewVisualization(value)) return value;
  warnUndrawableViewKind(value);
  return undefined;
}

/**
 * ObjectUI's `list-view` node historically used a different vocabulary from
 * `@objectstack/spec` for the same concepts (`fields` where the spec says
 * `columns`, `viewType` where it says `type`, …). Issue #2231 closed the
 * type-level fork; #2890 closes the vocabulary fork.
 *
 * Stored view metadata in user databases still carries the legacy keys, so the
 * renderer cannot simply stop accepting them. Per AGENTS.md Commandment #0.1 the
 * answer is NOT a per-read-site `??` fallback — those fossilize a second de-facto
 * contract and drift apart (they already had: `ObjectGrid` preferred `columns`
 * in one branch and `fields` in another). Instead legacy acceptance lives HERE,
 * in one documented normalizer at the component boundary, mirroring
 * `normalizeSchemaReferenceKeys` (object schemas) and the spec's own
 * `normalizeVisibleWhen` / `normalizeFilterOperator` migration bridges.
 *
 * Note this cannot be a `z.preprocess` on `ListViewSchema`: nothing on the
 * render path parses view metadata through zod (the zod schemas are used by the
 * CLI validator, the VS Code extension and tests only), so a schema-level fold
 * would never run. The guarantee comes from the call site instead — `ListView`
 * normalizes before it reads anything.
 *
 * The fold is deliberately one-directional: the canonical key wins when both are
 * present, and the legacy key is REMOVED from the result so a read-site that was
 * missed fails loudly instead of quietly taking the legacy path. Like a spec
 * migration bridge, this is expected to be dropped in a future major once stored
 * metadata has been migrated.
 *
 * Non-mutating and allocation-frugal: returns the input by reference when there
 * is nothing to fold, so `ListView`'s downstream `useMemo`s keep a stable
 * dependency identity on the common (already-canonical) path.
 *
 * Currently folded:
 *  - `fields` → `columns` (#2890 scope A step 1)
 *  - `densityMode` → `rowHeight` (#2890 scope A step 2)
 *  - the `show*` toolbar flags → `userActions` (#2890 scope A step 3), and
 *    `showDescription` → `appearance.showDescription`. The canonical key wins
 *    per-flag, so a view may carry `userActions` for some toggles and a legacy
 *    flag for others. NOTE the fold does not apply any default: an absent flag
 *    stays absent, because the defaults are per-toggle (search/sort/filter/
 *    rowHeight/group default ON, hideFields/rowColor default OFF) and belong to
 *    the renderer, not to the vocabulary bridge.
 *  - the view's `inlineEdit` → `userActions.editInline` (objectui#5144), with
 *    the value carried over and an explicit `editInline` winning. `inlineEdit`
 *    stays on the result, because `ListView` seeds the grid's edit mode from
 *    it. See {@link foldsInlineEditIntoEditInline}. An absent pair stays
 *    absent here as well; `ListView` reads that as on, the spec's default
 *    (objectstack#22605).
 *  - `aria: { label, describedBy }` → the spec's `AriaProps`
 *    (`{ ariaLabel, ariaDescribedBy }`), and `sharing: { visibility, enabled }`
 *    → the spec's `ViewSharing` (`{ type }`) — #2890 scope A step 5. `aria.live`
 *    survives untouched: it has no spec counterpart.
 *  - `filters` → `filter` (#2890 scope A step 4). A key rename only: BOTH keys
 *    carry an ObjectQL FilterNode array (`[['stage','=','won']]`) everywhere in
 *    objectui — every consumer passes the value straight to `$filter`. The spec
 *    types `filter` as `ViewFilterRule[]` (`{field, operator, value}` objects),
 *    so objectui's field is typed from the spec but used as something else.
 *    That mismatch is real and out of scope here; converting formats inside a
 *    vocabulary fold would change what reaches the data source.
 *  - `data: { provider: 'object', object }` → `objectName` (#7477, step 6 of
 *    #2890). This is the spelling the published `react-blocks` contract
 *    recommends and the one `@objectstack/spec`'s `ViewDataSchema` declares;
 *    ListView read it at ZERO sites, so a page bound that way validated green
 *    upstream and rendered an empty list here with no diagnostic. The `object`
 *    provider is a `strictObject` carrying exactly `{ provider, object }`, so
 *    `objectName` captures all of it. Two deliberate departures from the folds
 *    above, both narrowing:
 *      · an already-present `objectName` WINS — this fold only fills a gap, it
 *        never re-points a binding that already resolves;
 *      · `data` is NOT deleted. Every other fold deletes because the legacy key
 *        has one meaning and one home; `data` has more providers than
 *        `object`, `value` is read live in `ListView`, and the whole block is FORWARDED to child
 *        views (the gantt branch), whose own `getDataConfig` reads `data` before
 *        `objectName`. Deleting it for one provider would rewrite what a child
 *        resolves. Nothing in `ListView` reads `data.provider === 'object'`, so
 *        keeping it cannot create a second de-facto contract inside the renderer.
 *  - `viewType`: a missing kind, or the view CATEGORY `'list'` that AI-authored
 *    metadata stores and hosts forward verbatim, becomes the renderable `'grid'`
 *    — otherwise it reaches the renderer's typeless default branch and shows as
 *    a red "Unknown component type" box. Before that default applies, the
 *    AUTHOR's kind is read (#7477): `specType` — the slot
 *    `components/renderers/layout/react-page.tsx` parks a react-tier `type` in
 *    when the SDUI envelope claims the `type` key (ADR-0078) — and then a bare
 *    `type` when it names a kind ListView draws, which the component
 *    discriminator (`'list-view'`) never does. Same two legs, same order, as
 *    `normalizeChartSchema`'s chart-family read. An explicit `viewType` still
 *    wins: this leg only fills the gap that used to resolve to `'grid'`.
 *  - each `columns` entry's IDENTITY — `name` / `fieldName` → the spec's `field`
 *    (#3104). This one MIRRORS instead of deleting, for the reason given on
 *    {@link normalizeColumnIdentities}: `columns` entries cross the package
 *    boundary into host renderers, so dropping `name` from under them is a
 *    breaking change with no inventory. Runs AFTER the `fields` → `columns` fold
 *    above, so a view that spells its column list the legacy way still gets its
 *    entries canonicalized.
 *
 * No longer folded: the four PER-VIEW-TYPE config aliases phase 3 carried over
 * (`kanban.groupField` → `groupByField`, `kanban.cardFields` → `columns`,
 * `gallery.imageField` → `coverField`, `timeline.dateField` →
 * `startDateField`). objectui#6152 round 14 retired that fold with every
 * renderer-side reader of the four: each list-view door refuses them by name
 * (rounds 11 and 12), and a stored block that still carries one passes through
 * here untouched and binds nothing downstream.
 */
export function normalizeListViewSchema<T>(schema: T): T {
  if (!schema || typeof schema !== 'object') return schema;
  const s = schema as Record<string, unknown>;

  const legacyFields = s.fields;
  const foldColumns = Array.isArray(legacyFields);
  const legacyDensity = s.densityMode;
  // `hasOwnProperty`, not `in` — same trap as {@link rowHeightToDensityMode},
  // in the fold direction: `in` walks the prototype chain, so `'toString'` used
  // to fold into `rowHeight` as `Object.prototype.toString`, a FUNCTION, and
  // drop the key (objectui#10868). An inherited key is an unrecognized density.
  const foldRowHeight =
    typeof legacyDensity === 'string' &&
    Object.prototype.hasOwnProperty.call(DENSITY_MODE_TO_ROW_HEIGHT, legacyDensity);
  const legacyFilters = s.filters;
  const foldFilter = Array.isArray(legacyFilters);
  const legacyFlags = Object.keys(SHOW_FLAG_TO_USER_ACTION).filter((k) => typeof s[k] === 'boolean');
  const foldInlineEdit = foldsInlineEditIntoEditInline(s);
  const foldDescription = typeof s.showDescription === 'boolean';
  const aria = isRecord(s.aria) ? s.aria : undefined;
  const foldAria = !!aria && Object.keys(ARIA_KEY_ALIASES).some((k) => aria[k] !== undefined);
  const sharing = isRecord(s.sharing) ? s.sharing : undefined;
  const foldSharing = !!sharing && (sharing.visibility !== undefined || sharing.enabled !== undefined);
  // `data: { provider: 'object', object }` → `objectName` (#7477). Gap-fill
  // only: a non-empty `objectName` already on the schema wins, so this can
  // never re-point a binding that resolves today.
  const dataConfig = isRecord(s.data) ? s.data : undefined;
  const dataObjectName =
    dataConfig?.provider === 'object' && typeof dataConfig.object === 'string' && dataConfig.object
      ? dataConfig.object
      : undefined;
  const foldObjectName =
    dataObjectName !== undefined && !(typeof s.objectName === 'string' && s.objectName);
  const viewType = s.viewType;
  // The author's kind, read before the `'grid'` default applies (#7477).
  const authoredViewKind = readListViewKind(s.specType) ?? readListViewKind(s.type);
  const defaultViewKind = !viewType || viewType === 'list';
  // The columns array the identity fold will see — mirroring the `foldColumns`
  // precedence below (canonical `columns` wins; otherwise the legacy `fields`
  // that is about to become it). `normalizeColumnIdentities` returns its input
  // by reference when every entry is already canonical, so this comparison is
  // also the "is there anything to do" test.
  const columnsSource = Array.isArray(s.columns)
    ? s.columns
    : foldColumns
      ? (legacyFields as unknown[])
      : undefined;
  const foldedColumns = normalizeColumnIdentities(columnsSource);
  const foldColumnIdentity = foldedColumns !== columnsSource;
  if (
    !foldColumns && !foldRowHeight && !foldFilter && !legacyFlags.length && !foldInlineEdit &&
    !foldDescription && !foldAria && !foldSharing && !defaultViewKind &&
    !foldColumnIdentity && !foldObjectName
  ) {
    return schema;
  }

  const next: Record<string, unknown> = { ...s };
  if (foldColumns) {
    if (!Array.isArray(next.columns)) next.columns = legacyFields;
    delete next.fields;
  }
  // After the `fields` → `columns` rename, so a legacy-spelled column LIST gets
  // its per-entry identities canonicalized in the same pass.
  if (foldColumnIdentity) next.columns = foldedColumns;
  if (foldRowHeight) {
    if (typeof next.rowHeight !== 'string') {
      next.rowHeight = DENSITY_MODE_TO_ROW_HEIGHT[legacyDensity as DensityMode];
    }
    delete next.densityMode;
  }
  if (foldFilter) {
    if (!Array.isArray(next.filter)) next.filter = legacyFilters;
    delete next.filters;
  }
  if (legacyFlags.length || foldInlineEdit) {
    const ua: Record<string, unknown> = { ...(isRecord(next.userActions) ? next.userActions : {}) };
    for (const flag of legacyFlags) {
      const key = SHOW_FLAG_TO_USER_ACTION[flag];
      if (typeof ua[key] !== 'boolean') ua[key] = s[flag];
      delete next[flag];
    }
    // objectui#5144. Gap-fill only, and `inlineEdit` is not deleted: see
    // `foldsInlineEditIntoEditInline`.
    if (foldInlineEdit) ua.editInline = s.inlineEdit;
    next.userActions = ua;
  }
  if (foldDescription) {
    const appearance: Record<string, unknown> = {
      ...(isRecord(next.appearance) ? next.appearance : {}),
    };
    if (typeof appearance.showDescription !== 'boolean') {
      appearance.showDescription = s.showDescription;
    }
    delete next.showDescription;
    next.appearance = appearance;
  }
  if (foldAria && aria) {
    const nextAria: Record<string, unknown> = { ...aria };
    for (const [legacy, canonical] of Object.entries(ARIA_KEY_ALIASES)) {
      if (nextAria[canonical] === undefined && aria[legacy] !== undefined) {
        nextAria[canonical] = aria[legacy];
      }
      delete nextAria[legacy];
    }
    next.aria = nextAria;
  }
  if (foldSharing && sharing) {
    const nextSharing: Record<string, unknown> = { ...sharing };
    if (nextSharing.type === undefined) {
      const visibility = typeof sharing.visibility === 'string' ? sharing.visibility : undefined;
      // `enabled: true` with no audience is under-specified legacy input. It
      // used to render the share badge titled "private", so it maps to
      // `personal` — preserving what the user saw rather than adopting the
      // spec's `collaborative` default and silently relabeling the badge.
      const resolved = visibility
        ? VISIBILITY_TO_SHARING_TYPE[visibility]
        : sharing.enabled === true
          ? 'personal'
          : undefined;
      if (resolved) nextSharing.type = resolved;
    }
    delete nextSharing.visibility;
    delete nextSharing.enabled;
    next.sharing = nextSharing;
  }
  if (foldObjectName) next.objectName = dataObjectName;
  if (defaultViewKind) next.viewType = authoredViewKind ?? 'grid';
  return next as T;
}
