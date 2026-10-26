/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/core` — ElementDataSource resolution (objectstack#5576).
 *
 * `PageComponentSchema.dataSource` (the spec's `ElementDataSourceSchema`) is the
 * per-element data binding a page component uses to query a different object
 * than the page's own context:
 *
 * ```json
 * { "object": "account", "view": "hot", "filter": [ … ], "sort": [ … ], "limit": 20 }
 * ```
 *
 * This module owns the two pure halves of consuming it — telling the METADATA
 * apart from a runtime data-source adapter, and composing a named saved view
 * with the binding's own keys. Both are needed in two places (the render path in
 * `@object-ui/plugin-list`, and `ViewDataProvider.resolveElementDataSource`), so
 * they live here rather than being written twice.
 *
 * ## Composition semantics
 *
 * The spec's own `describe()` text settles the one case that could go either
 * way. `filter` is documented as "**Additional** filter criteria" — additional
 * to what the named view already restricts — so a view filter and a binding
 * filter COMBINE under `and`; the binding can only narrow the view, never widen
 * it. That is also the safe direction for AI-authored metadata: a typo in a
 * per-element filter cannot silently expose rows the saved view excluded.
 *
 * Nothing else in the binding is described as additional, and the remaining keys
 * are single-valued (one ordering, one cap), so for those the rule is **the view
 * provides the baseline and an explicit key overrides it**:
 *
 * | key        | source                                  | rule                        |
 * |------------|-----------------------------------------|-----------------------------|
 * | `object`   | binding (required)                      | binding wins                |
 * | `columns`  | view only — the binding has no such key | view                        |
 * | `filter`   | view + binding                          | AND-combined ("additional") |
 * | `sort`     | view or binding                         | binding overrides view      |
 * | `limit`    | view (`pagination.pageSize`) or binding | usable binding overrides view |
 * | `viewType` | view only                               | view                        |
 *
 * Both operands of `limit` carry one extra condition the other keys do not: the
 * destination is declared a POSITIVE INTEGER, so a cap the contract refuses is
 * NOT AUTHORED, whichever operand carried it. One chain, one rule for both: a
 * usable binding cap, else a usable view cap, else none (the consumer's own
 * default). See `savedViewLimit` for why the view's refused cap is dropped
 * rather than clamped or thrown, `bindingLimit` for why a refused binding cap
 * yields to the view's (objectui#10016), and `elementDataSourceRefusedLimitMessage`
 * for the half that tells the author, about either operand.
 *
 * A lone `filter` — only the view has one, or only the binding does — is passed
 * through in the shape it was stored in; only the two-source case is lowered to
 * an ObjectQL AST, because that is what combining requires.
 *
 * `viewType` rides along because `list-view` IS the multi-kind view container
 * (its registry `inputs` enumerate grid/kanban/gallery/…): naming a saved kanban
 * view and rendering a grid would be a silently wrong answer.
 */

import type { InjectedComponentInput } from '@object-ui/types';
import { mergeFilterNodes } from '../utils/filter-converter.js';
import { resolveViewId } from '../utils/resolve-view-id.js';

/** Sort entry, as both the spec's `SortItem` and objectui's view configs spell it. */
export interface ElementDataSourceSort {
  field: string;
  order: 'asc' | 'desc';
}

/**
 * Element-level data source — matches `@objectstack/spec` `ElementDataSourceSchema`.
 *
 * `filter` has two populations, and since the upstream convergence they differ:
 *
 * - **What an author may write** is the spec's `ViewFilterRule` array alone —
 *   `[{ field, operator, value }, …]`. The spec's `filter` doors converged on it
 *   (objectui#6206; migration `element-data-source-and-object-block-filter-rule-array`),
 *   and `ElementDataSourceSchema` refuses the other two shapes at the door: the
 *   MongoDB-style record form (`{ status: 'open' }`) by kind, and an ObjectQL
 *   AST tuple array (`[['status', '=', 'open']]`) because each member must be a
 *   rule object.
 * - **What a renderer may still receive** is all three. The D2 conversion that
 *   migration entry records, `page-component-filter-record-to-rule-array`,
 *   rewrites a stored `filter` only where the rule array spells it losslessly —
 *   a flat record, an operator object whose operators the rule vocabulary
 *   spells, several such keys, or a single-level AST tuple array — on every
 *   ObjectStack stored-row read and under `os migrate meta --stored`. It leaves
 *   exactly as stored a filter carrying `$and` / `$or` / `$not`; any filter with
 *   a part that has no lossless rule spelling (a `null` value, an operator such
 *   as `$null` / `$exists` or an AST `like`, an array or object comparand in
 *   equality position, an AST `and` / `or` group); and every filter, the
 *   binding's included, of a component whose rows are inline
 *   (`data: { provider: 'value' }`, a `data` array, or `staticData`). And this
 *   renderer is backend-agnostic: it replays no conversion itself, and only
 *   ObjectStack's own data-at-rest seams do, so a page that reaches it any other
 *   way arrives as it was written. Any of the three shapes may therefore still
 *   arrive here, beside the rule array.
 *
 * `filter` is typed `unknown` rather than the spec's `ViewFilterRule[]` because
 * this interface carries the second population, not the first, and
 * {@link mergeFilterNodes} is the single sink that lowers all three shapes.
 * Narrowing the type here would only move the cast, not remove it, and it would
 * not stop a stored record-form filter from arriving. Refusing the retired
 * shapes is the spec schema's job at the authoring door, not this type's.
 */
export interface ElementDataSourceConfig {
  object: string;
  view?: string;
  filter?: unknown;
  sort?: ElementDataSourceSort[];
  limit?: number;
}

/**
 * The subset of a saved view's config that an `ElementDataSource` `view` name
 * contributes. Deliberately loose: stored view metadata is user data and carries
 * both the spec vocabulary and the legacy objectui spellings that
 * `normalizeListViewSchema` folds at the component boundary.
 */
export type ElementSavedView = Record<string, unknown>;

/** What {@link composeElementDataSource} produces for a renderer to consume. */
export interface ComposedElementDataSource {
  /** Object to query. */
  object: string;
  /** Columns the named view shows; absent when no view was named. */
  columns?: unknown;
  /** View filter AND binding filter, combined; `undefined` when neither. */
  filter?: unknown;
  /** Binding sort if given, else the view's. */
  sort?: unknown;
  /**
   * The binding's limit if it is one the contract admits, else the view's page
   * size under the same condition. A refused cap from either operand is not
   * authored (`bindingLimit` and `savedViewLimit` apply the one rule), and
   * `elementDataSourceRefusedLimitMessage` is what says so.
   */
  limit?: number;
  /** The view's render kind (grid / kanban / …), when the view declares one. */
  viewType?: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Is this value the spec's `dataSource` METADATA, rather than a runtime
 * data-source adapter?
 *
 * This guard exists because the two collide by name and the collision was live:
 * `SchemaRenderer` spreads every non-metadata schema key onto the component as a
 * React prop, so a spec-compliant `dataSource: { object, view }` on a page
 * component landed on `ListView`'s `dataSource` PROP — which is the injected
 * adapter — and shadowed it. The first `dataSource.find(…)` then threw
 * `dataSource.find is not a function`, which the list reported as
 * "Couldn't load records": writing the binding the spec documents BROKE the
 * component (objectstack#5576).
 *
 * The test is positive on the metadata rather than negative on the adapter: a
 * binding is a plain object with a non-empty string `object` and no `find`
 * method. An adapter never has a string `object`; metadata never has `find`.
 */
export function isElementDataSourceConfig(
  value: unknown,
): value is ElementDataSourceConfig {
  if (!isPlainObject(value)) return false;
  if (typeof (value as { find?: unknown }).find === 'function') return false;
  const object = (value as { object?: unknown }).object;
  return typeof object === 'string' && object.length > 0;
}

/**
 * Flatten every place saved views for one object can live into `id → config`.
 *
 * Two sources are real and both are read, in the order app-shell's `ObjectView`
 * reads them: the object definition's embedded `listViews` / `list_views` map
 * (metadata-defined) and the metadata overlay rows an adapter returns from
 * `listViews()` (user-defined). Later sources win, so a saved view shadows a
 * metadata view of the same id — the same precedence `ObjectView` applies when
 * it dedups its tab list.
 *
 * Accepts a record keyed by view id or an array of view configs (overlay rows
 * are an array and carry their identity in `name`, falling back to `id`).
 */
export function collectSavedViews(
  ...sources: unknown[]
): Record<string, ElementSavedView> {
  const out: Record<string, ElementSavedView> = {};
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const entry of source) {
        if (!isPlainObject(entry)) continue;
        const id = entry.name ?? entry.id;
        if (typeof id === 'string' && id) out[id] = entry;
      }
    } else if (isPlainObject(source)) {
      for (const [id, entry] of Object.entries(source)) {
        if (isPlainObject(entry)) out[id] = entry;
      }
    }
  }
  return out;
}

/**
 * Find the saved view a `dataSource.view` name refers to.
 *
 * Name matching is {@link resolveViewId}'s — the same short/qualified tolerance
 * the object page applies to a URL-requested view — so a name that works in one
 * surface works in the other. Returns `undefined` when nothing matches; the
 * caller must REPORT that rather than fall back to the object's default view.
 * Silently widening a named view to "all records" is the failure mode this whole
 * binding exists to remove.
 */
export function resolveSavedView(
  views: Record<string, ElementSavedView>,
  requested: string | undefined | null,
  object: string,
): ElementSavedView | undefined {
  const id = resolveViewId(requested, Object.keys(views), object);
  return id === undefined ? undefined : views[id];
}

/**
 * What the contract admits as a row cap.
 *
 * A deliberate LOCAL RESTATEMENT of the predicate the repaired read points
 * spell as `isUsableRowLimit` / `isUsablePageSize`. It is ⛔ not imported and
 * ⛔ not extracted to a shared helper: this family now spells the same rule at
 * each site that enforces it, and `isUsableRowLimit` / `isUsablePageSize` is
 * what enumerates them. Hoisting it into one module would be a cross-package
 * move nobody has chartered, and it would take the rule out of the file whose
 * reader needs to see it. The cost — one more copy that could drift — is
 * written here rather than hidden.
 *
 * The destination is declared positive at both ends: the spec's element data
 * source declares `limit` a positive integer, and a saved view's pagination
 * declares `pageSize` a positive integer with a default. So `0` is not a
 * spelling whose meaning this layer may choose — it is a value the contract
 * already refuses.
 */
function isUsableRowLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The row cap a saved view CARRIES, before the contract is applied to it —
 * `pagination.pageSize`, or a flat `limit`.
 *
 * Split out from {@link savedViewLimit} so the resolver and the diagnostic read
 * the same carrier by construction. Two readers would be free to drift, and the
 * drift would be invisible: a value one of them reports and the other keeps, or
 * the reverse.
 *
 * ⚠️ Selection is still by `typeof === 'number'`, unchanged: a non-numeric
 * `pagination.pageSize` falls through to the flat `limit` exactly as it did
 * before. Only the POSITIVITY question is new, and it is asked once, by
 * {@link isUsableRowLimit}, on whichever carrier won.
 */
function savedViewRawLimit(view: ElementSavedView | null | undefined): number | undefined {
  if (!view) return undefined;
  const pagination = view.pagination;
  if (isPlainObject(pagination) && typeof pagination.pageSize === 'number') {
    return pagination.pageSize;
  }
  return typeof view.limit === 'number' ? view.limit : undefined;
}

/**
 * Read a saved view's row cap — `pagination.pageSize`, or a flat `limit` —
 * and hand back only a cap the contract admits.
 *
 * ## Why DROP, and not clamp or refuse
 *
 * Before this guard, `typeof … === 'number'` admitted `0`, negatives and
 * fractions, and they lowered unchecked into the composed `limit`. Measured on
 * both consumers of that key rather than inferred, and the two answers differ:
 *
 *  - through a RENDERER, the refused value reached a block that has its own
 *    guard, so the block dropped it and drew its own default — the named view's
 *    cap went missing and the read went WIDER than the view asked for;
 *  - through `ViewDataProvider.resolveElementDataSource`, which forwards this
 *    key to `DataFetcher.fetchRecords` with NO guard of its own, `0`, `-10` and
 *    `25.5` reached the fetcher verbatim.
 *
 * ⛔ CLAMP is refused: this layer has no default to clamp to. Every consuming
 * block owns its own default and `ViewDataProvider` owns none, so a number
 * invented here would override a default the author never asked it to, and
 * quietly substituting a number the author never wrote is the quieter half of
 * this same defect.
 *
 * ⛔ THROWING is refused: this function is pure and sits under every block that
 * can be bound to a view, so a throw would take out the page over one
 * declaration — worse than the defect.
 *
 * ⇒ DROP. An absent `limit` is the honest statement that the view supplied no
 * usable cap, and it is the one thing every consumer already handles.
 *
 * The loud half is {@link elementDataSourceRefusedLimitMessage}; see its doc for
 * why the message is built here and reported by the caller.
 */
function savedViewLimit(view: ElementSavedView | null | undefined): number | undefined {
  const raw = savedViewRawLimit(view);
  return isUsableRowLimit(raw) ? raw : undefined;
}

/**
 * Read the binding's own row cap, and hand back only a cap the contract admits.
 *
 * The other operand of the `limit` chain gets the same positivity check as
 * {@link savedViewLimit}, through the same predicate. Maintainer ruling on
 * objectui#10016 (option A): a binding `limit` the contract refuses (`0`, a
 * negative, a fraction, a value that is not a number at all) is NOT AUTHORED.
 * It yields exactly as an absent one does, to the saved view's usable cap and,
 * when that is absent too, to the consumer's own default.
 *
 * This is objectui#10009's precedent applied as a rule rather than re-decided:
 * there, one layer up, a value the contract refuses was ruled not authored and
 * the other source won. Here the same question is asked of the two operands of
 * one resolver, and it gets the same answer. The repo therefore holds ONE
 * precedence rule for "whose row cap is used", not one per pair of operands.
 *
 * The two answers the ruling refused, and why:
 *
 *  - ⛔ dropping the binding's cap AND skipping the view's: a bad value on the
 *    binding would then discard the view's legitimate cap, which is the least
 *    explicable outcome for an author;
 *  - ⛔ refusing loudly and rendering nothing: a blank region at render time
 *    makes an author's slip expensive without making it any harder to write.
 *    The loud refusal belongs on the WRITE surface, not here.
 *
 * `null` stays what `??` always made it: absent.
 */
function bindingLimit(config: ElementDataSourceConfig): number | undefined {
  return isUsableRowLimit(config.limit) ? config.limit : undefined;
}

/**
 * The binding operand's half of {@link elementDataSourceRefusedLimitMessage}.
 * Module-private: callers reach it through that one exported builder, so there
 * is still exactly one channel for a refused row cap, whichever operand it was.
 *
 * Unlike the view's message it needs no condition on the other operand. A
 * usable binding cap is used whatever the view carries, so a refused one is
 * ALWAYS a cap the consumer did not get, and saying so is always true.
 */
function refusedBindingLimitMessage(
  binding: { limit?: unknown } | null | undefined,
  viewName: string | undefined | null,
  object: string,
): string | null {
  const raw = binding?.limit;
  if (raw === undefined || raw === null) return null;
  if (isUsableRowLimit(raw)) return null;
  const where = viewName
    ? `dataSource binding on ${object} (view "${viewName}")`
    : `dataSource binding on ${object}`;
  // `String('20')` would print a string exactly like the number it is not.
  const shown = typeof raw === 'number' ? String(raw) : String(JSON.stringify(raw));
  return (
    `[ObjectUI] ElementDataSource: the ${where} declares \`limit: ${shown}\`, `
    + 'which is not a positive integer. A row cap must be a positive integer '
    + '(the spec declares this binding’s `limit` positive), so the binding’s cap '
    + 'was treated as not authored and ignored, exactly as if the binding declared '
    + 'no `limit`: the cap comes from the next source that declares a usable one, '
    + 'or else from the consumer’s own default.'
  );
}

/**
 * The diagnostic half of {@link savedViewLimit} and {@link bindingLimit}.
 * `null` means "nothing to say".
 *
 * ## Which operand
 *
 * `operand` picks the refusal to describe; it defaults to `'view'`, the one
 * this builder described before objectui#10016. Each operand gets its own
 * sentence, and each names its operand, so the two refusals stay
 * distinguishable when both fire. They do fire together when the binding AND
 * the view each carry a refused cap: two declarations, one message each.
 *
 * `binding` is the binding as authored. The view's sentence needs it too: it
 * says the consumer falls back to its own default, and that is only true when
 * the binding supplied no usable cap. A usable binding cap is used whatever the
 * view carries, so a refused view cap under one changed nothing and is not
 * reported. That condition lives HERE, once, rather than at each caller,
 * because every caller needs it and two copies could drift.
 *
 * ## Why a BUILDER here, and not a warning from the composer
 *
 * This is the shape {@link elementDataSourceViewNotFoundMessage} already
 * established in this module, for the reason its doc gives: built here so every
 * caller reports the same defect the same way. It is followed rather than
 * re-decided because the alternative is ruled out mechanically —
 * {@link composeElementDataSource} is PURE and the render path calls it from a
 * `useMemo`, so a warning emitted inside it would fire during render and fire
 * again on every re-render. The repaired relay one layer up emits from an
 * effect for exactly that reason; a pure function has no effect to emit from,
 * so it hands the caller the words instead.
 *
 * ## Why the message has to exist at all
 *
 * Dropping alone would be a SILENT change on the renderer path: today the
 * refused value travels as far as a block whose own guard reports it once, and
 * after this repair that block receives nothing and correctly says nothing —
 * an absent key is not a mistake. So the repair would remove the only place the
 * author was being told. The layer that makes the decision is the layer that
 * reports it.
 *
 * ⛔ NOT a second guard: the predicate lives once, in {@link isUsableRowLimit},
 * and the view's carrier is read once, by {@link savedViewRawLimit}; this reads
 * both.
 *
 * ⚠️ It speaks only about a cap THIS layer dropped. A non-numeric
 * `pagination.pageSize` never became a limit here, before or after, so there is
 * nothing for this layer to report about it. A non-numeric binding `limit` is
 * different: `??` used to pass it through, so this layer now drops it and says
 * so.
 */
export function elementDataSourceRefusedLimitMessage(
  view: ElementSavedView | null | undefined,
  viewName: string | undefined | null,
  object: string,
  binding?: { limit?: unknown } | null,
  operand: 'view' | 'binding' = 'view',
): string | null {
  if (operand === 'binding') return refusedBindingLimitMessage(binding, viewName, object);
  if (isUsableRowLimit(binding?.limit)) return null;
  const raw = savedViewRawLimit(view);
  if (raw === undefined) return null;
  if (isUsableRowLimit(raw)) return null;
  const where = viewName ? `saved view "${viewName}" on ${object}` : `saved view on ${object}`;
  return (
    `[ObjectUI] ElementDataSource: ${where} declares a row cap of ${String(raw)}, `
    + 'which is not a positive integer. A row cap must be a positive integer '
    + '(the spec declares this binding’s `limit` positive, and refuses a zero '
    + 'or negative `pagination.pageSize`), so the view’s cap was ignored and no '
    + 'cap was lowered from it — the consuming block uses its own default.'
  );
}

/**
 * Read a saved view's render kind. `type` is the spec's key (and what
 * `ObjectView` reads); `viewType` is objectui's legacy spelling, folded by
 * `normalizeListViewSchema` downstream but accepted here so a view stored either
 * way resolves to the same kind.
 */
function savedViewType(view: ElementSavedView | null | undefined): string | undefined {
  if (!view) return undefined;
  const kind = view.type ?? view.viewType;
  return typeof kind === 'string' && kind ? kind : undefined;
}

/** Read a saved view's column list — canonical `columns`, legacy `fields`. */
function savedViewColumns(view: ElementSavedView | null | undefined): unknown {
  if (!view) return undefined;
  if (Array.isArray(view.columns)) return view.columns;
  if (Array.isArray(view.fields)) return view.fields;
  return undefined;
}

/**
 * Compose an `ElementDataSource` binding with the saved view it names.
 *
 * Pure — the caller resolves the view (see {@link resolveSavedView}) and owns
 * the "named a view that does not exist" decision. Passing `undefined` /`null`
 * for `view` composes a binding with no view, which is exactly the pre-objectstack-ai/objectstack#5576
 * behaviour for the other four keys.
 *
 * See the module doc for the per-key rule table; `filter` is the only key that
 * combines rather than overrides, because the spec describes the binding's
 * filter as *additional*.
 */
export function composeElementDataSource(
  config: ElementDataSourceConfig,
  view?: ElementSavedView | null,
): ComposedElementDataSource {
  const composed: ComposedElementDataSource = { object: config.object };

  const columns = savedViewColumns(view);
  if (columns !== undefined) composed.columns = columns;

  // "Additional filter criteria" (spec) — the view restricts, the binding
  // restricts further, so two filters COMBINE under `and` via the repo's single
  // combiner. A lone source passes through VERBATIM: lowering a stored filter to
  // an ObjectQL AST belongs at the last hop before the wire and nowhere earlier
  // (see `toFilterNode`'s doc on why), and every consumer of this result hands
  // the value to that hop anyway. Combining is the one case that cannot preserve
  // the input shape — putting two sources under one `and` requires AST — and
  // `mergeFilterNodes` is the sanctioned place for it.
  const viewFilter = view?.filter;
  const filter = viewFilter !== undefined && config.filter !== undefined
    ? mergeFilterNodes(viewFilter, config.filter)
    : (config.filter ?? viewFilter);
  if (filter !== undefined) composed.filter = filter;

  const sort = config.sort ?? view?.sort;
  if (sort !== undefined) composed.sort = sort;

  // One rule for both operands (objectui#10016): a refused cap is not
  // authored, so a refused binding `limit` yields to the view's cap exactly as
  // an absent one does.
  const limit = bindingLimit(config) ?? savedViewLimit(view);
  if (limit !== undefined) composed.limit = limit;

  const viewType = savedViewType(view);
  if (viewType !== undefined) composed.viewType = viewType;

  return composed;
}

/**
 * The message shown when `dataSource.view` names a view the object does not
 * have. Built here so the render path and `ViewDataProvider` report the same
 * defect the same way, and so the known-view list (the thing that actually gets
 * an author unstuck) is never omitted by one caller.
 *
 * ## Why the empty case may not say "this object has no saved views"
 *
 * An EMPTY `knownViews` reaches this function from two different worlds, and
 * this function cannot tell them apart:
 *
 *  1. the saved views were read and there are none;
 *  2. the read never successfully happened.
 *
 * World 2 is not hypothetical and not a bug to be fixed upstream: the shipped
 * `ObjectStackAdapter.listViews` contract degrades EVERY failure — refused,
 * offline, malformed — to `[]` on the RESOLVED path (deliberate, and objectui#8151
 * keeps it), so a broken read arrives at `useElementDataSource` as a successful
 * empty answer. The hook's own discrimination catches a REJECTION, which is a
 * shape that contract never produces, so nothing separates the two worlds by the
 * time the count lands here.
 *
 * Framework decision objectstack#13906 decision 1 option A — *a thing that could
 * not be READ is not a thing that is ABSENT* — therefore binds this branch: it
 * may only assert what is true in BOTH worlds. It names the possibilities and
 * commits to neither, because committing is exactly the claim nobody established.
 *
 * ⛔ Do not "restore" the shorter sentence by inferring failure from emptiness in
 * either direction — emptiness is what both worlds produce, so it can never tell
 * them apart. Saying more than this needs the failure FACT plumbed in from the
 * adapter (objectui#8151's surface), not a better guess here.
 */
export function elementDataSourceViewNotFoundMessage(
  object: string,
  view: string,
  knownViews: readonly string[],
): string {
  const known = knownViews.length
    ? `Known views: ${[...knownViews].sort().join(', ')}.`
    : 'No saved views are known for this object. It may have none, or they could not be read.';
  return `dataSource.view "${view}" was not found on object "${object}". ${known}`;
}

/* ------------------------------------------------------------------ *
 * The DECLARATION half — one copy, next to the semantics (objectui#6678)
 * ------------------------------------------------------------------ */

/**
 * The spec key this module resolves, spelled once.
 *
 * Every consumer that needs the NAME (the registry injection, its gates, the
 * pins) reads it from here rather than repeating the literal, so "which key is
 * this?" has exactly one answer in the tree.
 */
export const ELEMENT_DATA_SOURCE_KEY = 'dataSource';

/**
 * The authoring-surface declaration of {@link ELEMENT_DATA_SOURCE_KEY} — the one
 * copy, emitted into every registration that wraps the runtime gate.
 *
 * ## Why it lives here and is injected rather than written per block
 *
 * `PageComponentSchema.dataSource` is READ by `ElementDataSourceGate` in
 * `@object-ui/react` on behalf of every object-bound block that wraps itself in
 * it — nine of them at the time of writing. It was declared by NONE: `validateTree`
 * skips `BASE_PROPS` and otherwise looks a prop up in the component's `inputs`,
 * and `dataSource` was in neither. So the html tier reported the one spelling
 * that resolves a saved view — the only one that works — with the identical
 * `unknown-prop` warning it gives the spellings that do nothing, on the tier
 * meant to accept AI-authored pages, where the diagnostic IS the contract
 * (objectui#6678, the reporter of objectui#6598 gave up on exactly this).
 *
 * The maintainer ruling of 2026-08-29 took option B **in the injection form**:
 * emitted mechanically at the wrapping seam, so a block declares the key from
 * the same place that reads it. Nine hand-kept copies is the shape that ruling
 * refused — they drift, and a tenth block would simply forget. Adding the key to
 * `sdui-parser`'s `BASE_PROPS` (option A) was refused too: that set mirrors
 * `BaseSchema`, and silencing `dataSource` on blocks that do NOT read it
 * (`flex`, `card`) would make the diagnostic lie in the other direction.
 *
 * ## Why `object`, and not a bare `'object'` kind
 *
 * The `binding: 'object'` marker is what tells a consumer this input names an
 * OBJECT — `validateTree` records it as a binding site, and the designer offers
 * an object picker rather than a free-text blob. The `type` stays the coarse
 * `'object'` kind because the value is a record; the two words are unrelated and
 * both are correct here.
 *
 * ## Typed as the framework's injected input (`9e37d9b39`)
 *
 * `binding` is not a `ComponentInput` member. The maintainer ruling of
 * 2026-09-07 answered the card's product question — may an ordinary
 * registration declare a binding input? — with no, so the ONE writer of the
 * key is this constant, typed by `InjectedComponentInput` from
 * `@object-ui/types`: a `ComponentInput` plus the marker. The hand-written
 * inline type literal that used to sit here was the tell that the key had no
 * authored home, and the splice in `Registry.register` reached the `inputs`
 * array through an `as ComponentMeta` cast. Both are gone: the shape is now
 * checked here and at the splice, and a registration that writes `binding`
 * itself is an excess-property `tsc` error.
 */
export const ELEMENT_DATA_SOURCE_INPUT: InjectedComponentInput = {
  name: ELEMENT_DATA_SOURCE_KEY,
  type: 'object',
  binding: 'object',
  description:
    'Per-element data binding: { object, view, filter, sort, limit }. Overrides the ' +
    'page-level object context for this block; `view` names a saved view of `object`, ' +
    'and `filter` is ANDed with the view’s own rather than replacing it.',
};

/**
 * The renderers that wrap the runtime gate.
 *
 * A `WeakSet` rather than a property on the component: marking must not mutate a
 * `React.forwardRef` exotic object or show up when a test snapshots a
 * registration, and an unregistered renderer must stay collectable.
 */
const elementDataSourceBlocks = new WeakSet<object>();

/**
 * Declare that `renderer` wraps `ElementDataSourceGate`, so its registrations
 * publish {@link ELEMENT_DATA_SOURCE_INPUT}.
 *
 * This is the SEAM, and it is deliberately the only way in: `Registry.register`
 * injects the declaration for exactly the renderers marked here, so the key is
 * published by whatever consumes the gate and by nothing else — which is what
 * keeps the `flex` / `card` direction of the ruling true.
 * `scripts/check-element-data-source-declaration.mjs` fails any source that
 * consumes the gate without passing through it, so a new block cannot forget.
 *
 * ## Two import paths, ONE name and ONE function
 *
 * `@object-ui/react` re-exports this beside `ElementDataSourceGate` so the seam is
 * findable next to the thing it is about. That export is for DISCOVERABILITY:
 * every CALL SITE imports from here, and
 * `scripts/check-element-data-source-declaration.mjs` enforces it.
 *
 * The rule is measured, not stylistic. A registration runs at MODULE SCOPE, and
 * `element:record_picker`'s registration in `@object-ui/components` is the
 * worked example. 101 suites in this repo partially
 * mock `@object-ui/react` by hand-listing the exports they return, and a
 * module-scope read of a name those lists do not carry throws at COLLECTION
 * time — the importing test file fails before it runs a single assertion.
 * Measured: 17 files, all four CI shards, zero failed assertions among them.
 * Nothing mocks `@object-ui/core`, and `@object-ui/components` already imports
 * `ComponentRegistry` from it at module scope, so this path adds no coupling
 * that was not already there.
 */
export function elementDataSourceBlock<C>(renderer: C): C {
  if (renderer && (typeof renderer === 'object' || typeof renderer === 'function')) {
    elementDataSourceBlocks.add(renderer as unknown as object);
  }
  return renderer;
}

/** Whether `renderer` was marked by {@link elementDataSourceBlock}. */
export function isElementDataSourceBlock(renderer: unknown): boolean {
  return (
    !!renderer
    && (typeof renderer === 'object' || typeof renderer === 'function')
    && elementDataSourceBlocks.has(renderer as object)
  );
}
