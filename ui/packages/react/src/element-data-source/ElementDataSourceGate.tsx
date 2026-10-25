/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Mapping half of consuming `PageComponentSchema.dataSource` — the spec's
 * `ElementDataSourceSchema` per-element data binding (objectstack#5576 landed
 * the resolution; objectstack#6953 wires it to the remaining blocks).
 *
 * `@object-ui/core` owns the pure half (telling the binding apart from a runtime
 * adapter, matching a view name, composing the view with the binding's own
 * keys). {@link useElementDataSource} owns the fetch half. This module owns the
 * LAST hop: writing the composed result onto the schema keys a given block
 * actually reads, and rendering the two non-final states.
 *
 * It exists because that hop was the part every block would otherwise copy.
 * `dataSource` is declared on EVERY page component, so eight blocks need the
 * same precedence table (below) with only the KEY NAMES differing — which is a
 * mapping description, not eight algorithms. A per-block copy is how the two
 * halves drift: one block ANDs the filters and the next replaces them, and the
 * spec's "additional filter criteria" quietly becomes two dialects.
 *
 * `plugin-list`'s `ListViewBlock` carried the ORIGINAL copy of the table
 * (objectstack#5576, which predates this module) and was collapsed onto this one
 * by objectui#4038 — on the acceptance criterion that objectstack#5576's whole
 * suite passes against this implementation untouched, which it does. Every
 * object-bound block now reads the rules below from here, so this is the one
 * place a change to them belongs.
 *
 * ## Precedence — one table, applied everywhere
 *
 * Three kinds of value arrive and they do not have the same standing:
 *
 *  - **`dataSource.*` keys are authoritative.** The author wrote them on THIS
 *    placement and the spec says the binding "overrides page-level object
 *    context", so they beat the component's own same-named key.
 *  - **View-sourced values are a baseline.** A `view` is a *reference*; a key
 *    written on the component itself is more specific than the view it points
 *    at, so the component's key wins over one the view supplied.
 *  - **`filter` never overrides — it combines.** The spec describes the
 *    binding's filter as "*Additional* filter criteria", so component filter,
 *    view filter and binding filter all AND together through
 *    {@link mergeFilterNodes}. A binding can only narrow what the view already
 *    restricts, never widen it: a mistyped per-element filter cannot expose rows
 *    the saved view excluded.
 *
 * An authored-but-EMPTY `columns` counts as "not authored": `[]` is what the
 * designer emits for an unconfigured column list, and supplying the columns is
 * exactly why a view was named.
 *
 * The row cap answers "did the component author one?" the same way, and for the
 * same reason (objectui#9899). A cap the contract REFUSES — `pageSize: 0`,
 * a negative, a fraction — is not a cap this relay may treat as the author's
 * intent, so it does not suppress the one the bound view supplies. Deciding
 * that question by PRESENCE is how a view's legitimate cap was dropped in
 * favour of the consuming renderer's own default: measured end to end on
 * `list-view` before the repair, a component carrying `pagination.pageSize: 0`
 * under a view supplying `7` put `$top: 100` on the wire — the view's cap never
 * reached it, so the read was WIDER than the view asked for.
 *
 * The VIEW's own cap can be refused too, and `@object-ui/core` drops it before
 * it reaches this relay (objectui#9928). The drop is right, but it left the
 * consuming renderer nothing to refuse, so it went silent — and this relay
 * reports the view's refusal instead (objectui#10015). See
 * {@link describeRefusedViewRowLimit} for when that message applies.
 *
 * The BINDING's own cap follows the same rule (objectui#10016): a `limit` the
 * contract refuses is not authored, so `@object-ui/core` lets the view's cap
 * through in its place, and that cap is a baseline here like any other
 * view-sourced value. See {@link describeRefusedBindingRowLimit}.
 *
 * ## What a mapping may NOT do
 *
 * {@link ElementDataSourceMapping} names only keys the target block genuinely
 * reads. Writing a composed key onto a schema key the block ignores would
 * reproduce the very defect this wiring removes — a value accepted and dropped —
 * one layer further in, where it is even harder to see. A block with no row cap
 * therefore leaves `limit` unmapped rather than parking it somewhere plausible,
 * and the gap is recorded at the call site instead of being papered over here.
 *
 * ## A block with no ADAPTER fails loudly too (objectui#5378)
 *
 * The section below is about an unresolvable view NAME. The coarser failure —
 * no runtime adapter reached the block at all — used to render an empty shell
 * in exactly the same silence, and that is what `requiresDataSource` +
 * {@link NoDataSourcePanel} now report. Measured on the published
 * getting-started guide: all five of its blocks resolved no adapter, fetched
 * nothing, and said nothing. The two panels are deliberately the same shape;
 * they answer "which view?" and "which data source?", and an author who sees
 * either one is being told where to look.
 *
 * ## An unresolvable `view` fails loudly
 *
 * When the named view does not exist the gate renders a configuration error
 * instead of letting the block fall back to the object's default scope. Silently
 * widening a named view to "all records" is the failure class the binding exists
 * to remove, and it is the one an AI-authored page hides best: the page looks
 * like it works.
 */

import * as React from 'react';
import {
  elementDataSourceRefusedLimitMessage,
  filterRefusalSubject,
  isElementDataSourceConfig,
  mergeFilterNodes,
  toFilterNodeSafely,
  type ElementDataSourceConfig,
  type ElementSavedView,
  type FilterOperatorError,
} from '@object-ui/core';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  useElementDataSource,
  type ElementDataSourceStatus,
} from '../hooks/useElementDataSource.js';
import { SchemaRendererContext } from '../context/SchemaRendererContext.js';

/**
 * Where a block's row cap lives. Three spellings are real in this repo and each
 * is the ONLY one its block reads: `list-view`/`object-grid` read
 * `pagination.pageSize` (falling back to a flat `pageSize`), and
 * `record:related_list` reads the spec's flat `limit`.
 */
export type ElementDataSourceLimitKey = 'limit' | 'pageSize' | 'pagination.pageSize';

/**
 * Which schema keys a block reads, so the composed binding lands on those and
 * nothing else.
 *
 * Every field is opt-IN. The default mapping writes only the object name,
 * because that is the one key every object-bound block in this repo reads; a
 * block that also reads a filter, a sort, a column list or a row cap says so
 * here, naming the key it reads.
 */
export interface ElementDataSourceMapping {
  /**
   * Schema key the binding's `object` lands on — `'objectName'` for every
   * object-bound block in this repo, which is the default. `false` maps nothing
   * (for a block that reads the composed object itself, like
   * `element:record_picker`, whose object lives under `properties`).
   */
  object?: string | false;
  /**
   * Set when the block renders a FIELD column list a saved view can supply.
   * Leave unset for a block whose `columns` mean something else — an
   * `object-kanban`'s `columns` are its swimlane groups, not fields, and a
   * view's field list written there would render a broken board.
   */
  columns?: boolean;
  /** Set when the block reads `schema.filter` as its query filter. */
  filter?: boolean;
  /** Set when the block reads `schema.sort` as its query ordering. */
  sort?: boolean;
  /** The key a row cap lands on; omit for a block that enforces no cap. */
  limit?: ElementDataSourceLimitKey;
  /**
   * Set when the block renders several view kinds off `schema.viewType`
   * (`list-view` is the only such container: its registry `inputs` enumerate
   * grid/kanban/gallery/…, so naming a saved kanban view and rendering a grid
   * would be a silently wrong answer).
   */
  viewType?: boolean;
}

export interface UseElementDataSourceSchemaResult<S> {
  /** Resolution state; see {@link ElementDataSourceStatus}. */
  status: ElementDataSourceStatus;
  /**
   * The schema with the composed binding applied. Returned by REFERENCE when
   * there is nothing to apply, so a block that carries no binding never sees a
   * new schema identity (which would remount it and refetch on every render).
   */
  schema: S;
  /** The binding as authored, or `undefined` when the node carries none. */
  config?: ElementDataSourceConfig;
  /** Author-facing explanation, set only for `missing`. */
  error?: string;
  /**
   * The refused filter that stopped the binding from applying — set only with
   * `missing`, and `error` then carries its message (objectui#10789). Either
   * merge can refuse: the view's filter with the binding's own
   * ({@link useElementDataSource}), or the component's filter with that result
   * (this hook). {@link ElementDataSourceGate} draws the malformed-filter
   * notice from it.
   */
  filterRefusal?: FilterOperatorError;
}

/**
 * What the contract admits as a row cap (objectui#9899).
 *
 * `@objectstack/spec` has already answered what `0` means for the keys this
 * branch writes. Its view pagination config declares `pageSize` a positive
 * integer with a default; every component row cap its component props map
 * declares is `z.number().int().positive()`; and that flat `limit` is the key a
 * view's `pagination.pageSize` is LOWERED INTO for the blocks that read it. So
 * `0`, a negative and a fraction are not spellings this relay may assign a
 * meaning to — they are values the contract refuses.
 *
 * ⚠️ Said precisely, because it is easy to overstate: the `object-grid` props
 * face declares its OWN `pagination` key `z.unknown()`, so a save gate does not
 * refuse a component-level `pagination.pageSize: 0` on that face, and the flat
 * `pageSize` shorthand beside it is a bare `z.number()`. The refusal rests on
 * the pagination CONFIG contract and on the `limit` the value is lowered into —
 * the same ground objectui#9853, objectui#9897 and objectui#9925 already stood
 * on at the renderer sites.
 *
 * ⛔ Deliberately a LOCAL restatement of the predicate objectui#9925 landed at
 * the renderer sites, not an import and not a shared helper: hoisting it would
 * be a cross-package extraction this card may not make. The cost is stated
 * rather than hidden — one rule now has a spelling at every site that enforces
 * it, and `git grep 'isUsableRowLimit\|isUsablePageSize'` is what enumerates
 * them; the day one is meant to change, all of them are.
 */
function isUsableRowLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The loud half, and the reason a RELAY owes one at all.
 *
 * A relay that merely declines to treat a value as authored could reasonably
 * say nothing — the renderer it forwards to has its own refusal and its own
 * message. Measured rather than assumed: BEFORE this repair, a `list-view`
 * carrying `pagination.pageSize: 0` under a bound view was told about it, once,
 * by `ListView`'s own diagnostic. AFTER it, the gate writes the view's usable
 * cap, that renderer sees a value it accepts, and its message correctly goes
 * silent — so the repair REMOVES the only place the author was being told.
 * This restores that one message at the layer that now makes the decision.
 *
 * ⛔ NOT a second guard: the predicate lives once, in {@link isUsableRowLimit},
 * and this reads it. `null` means "nothing to say" — an absent cap is not a
 * mistake and a usable one is not either, which is what keeps this from
 * becoming an always-on marker that states nothing.
 */
const describeDisplacedRowLimit = (
  authored: unknown,
  key: ElementDataSourceLimitKey,
  used: number,
  componentType: unknown,
  objectName: unknown,
): string | null => {
  if (authored === undefined || authored === null) return null;
  if (isUsableRowLimit(authored)) return null;
  const type = typeof componentType === 'string' && componentType ? componentType : 'component';
  const where = typeof objectName === 'string' && objectName ? `${type} on ${objectName}` : type;
  return (
    `[ObjectUI] ElementDataSourceGate row cap: ${where} declared ${key}: ${String(authored)}, `
    + 'which is not a positive integer. A row cap must be a positive integer '
    + '(the spec refuses zero and negative values), so it was ignored and the cap '
    + `from this component's bound data source (${used}) was used instead.`
  );
};

/**
 * The loud half for a cap the SAVED VIEW declared and the contract refuses
 * (objectui#10015).
 *
 * `@object-ui/core` drops such a cap while composing, so `composed.limit`
 * never carries it and the renderer below never sees it. Its own diagnostic
 * treats an absent key as "not a mistake", so after that drop nothing said
 * anything. The wording is the core builder's, not this file's: it is the one
 * sentence both consumers of the composed binding use, and `ViewDataProvider`
 * already reports it on the path with no renderer. The builder is pure because
 * the composer runs inside a `useMemo`; this relay reports its result from an
 * effect, the same way it reports {@link describeDisplacedRowLimit}.
 *
 * It speaks only when the refusal CHANGED what this block receives — when a
 * usable view cap would have been written here:
 *
 *  - the binding declared no usable `limit` of its own (if it did, the
 *    binding's cap is what the block gets whatever the view carries). The
 *    builder applies this condition itself, because `ViewDataProvider` needs
 *    it too (objectui#10016), so this relay hands it the binding; and
 *  - the component's own cap is not a usable one (a usable one wins over any
 *    view cap).
 *
 * In both of those excluded cases the builder's sentence — the block falls
 * back to its own default — would not be true, so silence is the honest
 * answer, not a gap. The caller adds the third condition: the block reads a
 * row cap at all.
 *
 * ## Never together with {@link describeDisplacedRowLimit}
 *
 * That message needs a usable cap to have been WRITTEN. With a refused view
 * cap, the only usable cap left is a binding's usable `limit`, and that is
 * excluded above. So the two are exclusive by construction. When the component
 * AND the view both carry a refused cap, this message names the view and the
 * renderer names the component: two declarations, one message each.
 */
const describeRefusedViewRowLimit = (
  view: ElementSavedView | undefined,
  config: ElementDataSourceConfig | undefined,
  authored: unknown,
): string | null => {
  if (!config) return null;
  if (isUsableRowLimit(authored)) return null;
  return elementDataSourceRefusedLimitMessage(view, config.view, config.object, config);
};

/**
 * The loud half for a cap the BINDING declared and the contract refuses
 * (objectui#10016), in the core builder's words for that operand.
 *
 * `@object-ui/core` treats such a cap as not authored: it lets the view's
 * usable cap through in its place, or none. Nothing downstream can see the
 * refused value any more, so this relay reports it, from an effect, the same
 * way it reports the view's refusal.
 *
 * It needs no condition beyond the caller's (the block reads a row cap at
 * all). A usable binding cap is written whatever the component or the view
 * carries, so a refused one is always a cap this block did not get.
 *
 * It can fire beside the other two, and that is one message per declaration,
 * not two per mistake: beside {@link describeRefusedViewRowLimit} when the view
 * ALSO carries a refused cap, and beside {@link describeDisplacedRowLimit} when
 * the component ALSO carries a refused cap and the view's usable one displaced
 * it.
 */
const describeRefusedBindingRowLimit = (
  view: ElementSavedView | undefined,
  config: ElementDataSourceConfig | undefined,
): string | null => {
  if (!config) return null;
  return elementDataSourceRefusedLimitMessage(view, config.view, config.object, config, 'binding');
};

const readLimit = (base: Record<string, any>, key: ElementDataSourceLimitKey): unknown => {
  if (key === 'pagination.pageSize') return base.pagination?.pageSize;
  return base[key];
};

const writeLimit = (
  next: Record<string, any>,
  base: Record<string, any>,
  key: ElementDataSourceLimitKey,
  limit: number,
): void => {
  if (key === 'pagination.pageSize') {
    next.pagination = { ...(base.pagination ?? {}), pageSize: limit };
    return;
  }
  next[key] = limit;
};

/**
 * Resolve a block's `dataSource` binding and apply it to the block's own schema
 * keys, per {@link ElementDataSourceMapping}.
 *
 * @param schema     The block's schema node (its `dataSource` is read).
 * @param mapping    Which schema keys this block reads.
 * @param dataSource Explicit adapter; falls back to `SchemaRendererContext`.
 *
 * @example
 * ```tsx
 * const bound = useElementDataSourceSchema(schema, { filter: true, sort: true });
 * if (bound.status === 'missing') return <ElementDataSourceErrorPanel message={bound.error} />;
 * return <ObjectCalendar schema={bound.schema} />;
 * ```
 */
export function useElementDataSourceSchema<S>(
  schema: S,
  mapping: ElementDataSourceMapping = {},
  dataSource?: unknown,
): UseElementDataSourceSchemaResult<S> {
  // Defence in depth for the collision the binding and the adapter share by
  // NAME: even though `SchemaRenderer` no longer spreads `schema.dataSource` as
  // a prop, a host (or an older cached bundle) handing us the spec BINDING under
  // this argument must never be mistaken for an adapter — that is how a
  // spec-compliant page reported "this data source cannot list the saved views".
  // Same guard `ListViewBlock` carries, applied for every block at once.
  const adapter = isElementDataSourceConfig(dataSource) ? undefined : dataSource;
  const binding = useElementDataSource(schema, adapter);
  const { object: objectKey = 'objectName', columns, filter, sort, limit, viewType } = mapping;

  const mapped = React.useMemo((): {
    schema: S;
    capMessage: string | null;
    viewCapMessage: string | null;
    bindingCapMessage: string | null;
    filterRefusal?: FilterOperatorError;
  } => {
    const composed = binding.composed;
    // BY REFERENCE when there is nothing to apply — a fresh object every render
    // would remount the block and refetch. The wrapper is memoised alongside it,
    // so the identity this carries is the one the caller sees.
    if (!composed) return { schema, capMessage: null, viewCapMessage: null, bindingCapMessage: null };

    const base = (schema ?? {}) as Record<string, any>;
    const next: Record<string, any> = { ...base };
    let capMessage: string | null = null;
    let viewCapMessage: string | null = null;
    let bindingCapMessage: string | null = null;

    if (objectKey !== false) next[objectKey] = composed.object;

    if (columns) {
      // `[]` is the designer's "not configured yet", and supplying the columns
      // is the reason a view was named — so an empty authored list yields.
      const authored = Array.isArray(base.columns) && base.columns.length > 0;
      if (!authored && composed.columns !== undefined) next.columns = composed.columns;
    }

    if (filter) {
      // Component filter AND (view filter AND binding filter). `composed.filter`
      // already carries the latter pair; a single surviving source comes back
      // unwrapped, so the common "only the view filters" case stays flat.
      //
      // ⚠️ Each source is lowered through `toFilterNodeSafely` first, the way
      // `RelatedList` and `LineItemsPanel` lower their own filter before they
      // merge it — objectui#10789. This is a RENDER-time `useMemo`, and the
      // lowering refuses malformed authored shapes with a `FilterOperatorError`:
      // uncaught, that was a render error, thrown BEFORE the wrapped block
      // reached its own safe lowering and its malformed-filter state. The
      // refusal is returned as a VALUE and the block is not rendered at all —
      // never merged as "no filter", which would run it unconstrained. The
      // merge below then only re-reads nodes the lowering already produced.
      const own = toFilterNodeSafely(base.filter);
      if (!own.ok) return { schema, capMessage: null, viewCapMessage: null, bindingCapMessage: null, filterRefusal: own.refusal };
      const bound = toFilterNodeSafely(composed.filter);
      if (!bound.ok) return { schema, capMessage: null, viewCapMessage: null, bindingCapMessage: null, filterRefusal: bound.refusal };
      const merged = mergeFilterNodes(own.node, bound.node);
      if (merged !== undefined) next.filter = merged;
      else delete next.filter;
    }

    // `composed.sort`/`composed.limit` are the BINDING's when it declared one,
    // else the view's — so the component's own key may only win over the latter.
    if (sort && composed.sort !== undefined) {
      const fromView = binding.config?.sort === undefined;
      if (!fromView || base.sort === undefined) next.sort = composed.sort;
    }

    if (limit && composed.limit !== undefined) {
      // For the row cap, "declared one" means a cap the contract admits
      // (objectui#10016): a refused binding `limit` is not authored, so the
      // composer let the view's cap through in its place, and that cap is a
      // baseline the component's usable cap still wins over.
      const fromView = !isUsableRowLimit(binding.config?.limit);
      // PRESENCE is not authorship (objectui#9899) — the same question the
      // `columns` branch above answers by CONTENT, answered the same way here.
      const authored = readLimit(base, limit);
      if (!fromView || !isUsableRowLimit(authored)) {
        writeLimit(next, base, limit, composed.limit);
        capMessage = describeDisplacedRowLimit(
          authored,
          limit,
          composed.limit,
          base.type,
          composed.object,
        );
      }
    }

    // Outside the branch above on purpose: a refused cap never reaches
    // `composed.limit`, so that branch does not run for it (objectui#10015,
    // and objectui#10016 for the binding's).
    if (limit) {
      viewCapMessage = describeRefusedViewRowLimit(binding.view, binding.config, readLimit(base, limit));
      bindingCapMessage = describeRefusedBindingRowLimit(binding.view, binding.config);
    }

    if (viewType && composed.viewType !== undefined && base.viewType === undefined) {
      next.viewType = composed.viewType;
    }

    return { schema: next as S, capMessage, viewCapMessage, bindingCapMessage };
  }, [schema, binding.composed, binding.config, binding.view, objectKey, columns, filter, sort, limit, viewType]);

  // Keyed on the MESSAGE, so it is one warning per declaration rather than one
  // per render — and it fires from an effect, never from render, which is the
  // same shape the renderer sites use for "you declared it, we dropped it".
  // One effect per message, so a change to one never re-emits another.
  const { schema: boundSchema, capMessage, viewCapMessage, bindingCapMessage, filterRefusal: mergeRefusal } = mapped;
  React.useEffect(() => {
    if (capMessage) console.warn(capMessage);
  }, [capMessage]);
  React.useEffect(() => {
    if (viewCapMessage) console.warn(viewCapMessage);
  }, [viewCapMessage]);
  React.useEffect(() => {
    if (bindingCapMessage) console.warn(bindingCapMessage);
  }, [bindingCapMessage]);

  // A refused filter — from either merge — is `missing`, the one state every
  // caller already answers by withholding the block (objectui#10789).
  const filterRefusal = binding.filterRefusal ?? mergeRefusal;
  return React.useMemo(
    () =>
      filterRefusal
        ? {
            status: 'missing' as const,
            schema: boundSchema,
            config: binding.config,
            error: filterRefusal.message,
            filterRefusal,
          }
        : {
            status: binding.status,
            schema: boundSchema,
            config: binding.config,
            error: binding.error,
          },
    [binding.status, binding.config, binding.error, boundSchema, filterRefusal],
  );
}

export interface ElementDataSourceStatusPanelProps {
  /**
   * `data-testid` stem, normally the block's registry key — the panels append
   * `-datasource-error` / `-resolving-view`, so a test names the block it is
   * asserting about rather than a shared anonymous id.
   */
  testId: string;
  /**
   * Panel heading; defaults to a block-neutral sentence read from the bundle
   * (objectui#12920). A passed `title`, an empty string included, wins.
   */
  title?: string;
  /** The author-facing explanation from {@link useElementDataSourceSchema}. */
  message?: string;
}

/**
 * The "named view does not resolve" panel. Same posture (and shape) as
 * `SchemaRenderer`'s "Unknown component type": authored metadata pointing at
 * something that is not there, reported where the author can see it.
 */
export function ElementDataSourceErrorPanel({
  testId,
  title,
  message,
}: ElementDataSourceStatusPanelProps): React.ReactElement {
  // objectui#12920 — the default reads the bundle; it was an English literal.
  // Only an ABSENT `title` takes it, as the parameter default did. The hook
  // runs on this error path only, for the reason
  // {@link ElementDataSourceMalformedFilterPanel} gives, and the inline
  // `defaultValue` is the `en` pack's value (`pnpm check:i18n-keys`).
  const { t } = useObjectTranslation();
  const heading =
    title === undefined
      ? t('element.component.sourceUnresolved', {
          defaultValue: 'This component’s data source could not be resolved',
        })
      : title;
  return (
    <div
      className="p-4 border border-red-500 rounded text-red-500 bg-red-50 my-2"
      role="alert"
      data-testid={`${testId}-datasource-error`}
    >
      <p className="font-medium">{heading}</p>
      {message ? <p className="text-sm mt-1">{message}</p> : null}
    </div>
  );
}

/**
 * The malformed-filter notice, drawn IN PLACE OF the block when a filter the
 * gate had to merge is refused (objectui#10789).
 *
 * It is the notice the wrapped blocks draw themselves (objectui#9050 step 2 —
 * `record:related_list`, the line-items panel, `object-grid`): the same
 * sentence (`view.malformedFilter`), naming the refused operator or field in a
 * separately addressable headline, with the refusal's own message beneath it.
 * The gate draws it because its merge refuses FIRST — before the block's own
 * safe lowering ever runs — so without it the author would get the error
 * boundary's "failed to render" instead of the sentence those blocks give.
 *
 * ⚠️ A separate component, so `useObjectTranslation` runs only on this path:
 * the gate wraps every object-bound block, and a translation hook in the
 * gate's own body would run for all of them, including under the many suites
 * that mock `@object-ui/i18n` by hand.
 *
 * The provider-less default is the sentence itself, written the way the
 * sibling blocks carry it: a LITERAL copy of the `en` pack's value, never a
 * read of the pack object. The siblings keep theirs in a module-scope
 * `createSafeTranslation` table, which this module cannot have: it is
 * re-exported from the package entry, so a factory call at module scope would
 * run on import for every consumer (`NonGridRowCeilingNote` records that
 * hazard). So the copy sits in the call's inline `defaultValue`, where
 * `pnpm check:i18n-keys` holds it byte-identical to the pack, as the siblings'
 * tables are held. With an `I18nProvider` the pack's value wins, and without
 * one this literal is interpolated (objectui#6219).
 */
function ElementDataSourceMalformedFilterPanel({
  testId,
  refusal,
}: {
  testId: string;
  refusal: FilterOperatorError;
}): React.ReactElement {
  const { t } = useObjectTranslation();
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-300 bg-amber-50 p-3 my-2 text-sm text-amber-800"
      data-testid={`${testId}-malformed-filter`}
    >
      {/* The headline is the half that has to NAME the operator; the technical
          line below repeats it incidentally. */}
      <p className="font-medium" data-testid={`${testId}-malformed-filter-subject`}>
        {t('view.malformedFilter', {
          subject: filterRefusalSubject(refusal) ?? '',
          defaultValue: 'This view’s filter is malformed, so no records are shown: the {{subject}} condition cannot be applied.',
        })}
      </p>
      <p className="mt-1 text-xs opacity-80">{refusal.message}</p>
    </div>
  );
}

/**
 * The "no object named" hint, drawn IN PLACE OF the block when a placement
 * that opted in with `requiresObject` names its object in neither place: not
 * on the block's own object key, and not through `dataSource.object`
 * (objectui#11605).
 *
 * Why it exists: the object-bound registrations no longer declare their object
 * key `required`, because the binding can supply it and the manifest has no
 * "this key or that binding" form. So the page compile accepts a node that
 * names no object at all, and this hint is the one signal left for it. Before
 * it, those blocks drew an empty board, a field-less form, a dash or a "no
 * data yet" state, which reads as an empty query rather than a missing object.
 *
 * The wording is `element:number`'s own no-object notice (objectui#10951) with
 * the property as a hole, so the two blocks that answer this question say it
 * the same way. The property name is interpolated, never translated.
 *
 * A separate component for the reason {@link ElementDataSourceMalformedFilterPanel}
 * gives: `useObjectTranslation` runs only on this path, and the provider-less
 * default is a literal copy of the `en` pack's value, held byte-identical to it
 * by `pnpm check:i18n-keys`.
 */
function ElementDataSourceNoObjectPanel({
  testId,
  property,
}: {
  testId: string;
  property: string;
}): React.ReactElement {
  const { t } = useObjectTranslation();
  return (
    <div className="p-4 text-sm text-muted-foreground my-2" data-testid={`${testId}-no-object`}>
      {t('view.noObject', {
        property,
        defaultValue: 'No object named: set {{property}} or dataSource.object.',
      })}
    </div>
  );
}

/**
 * Does the bound schema name an object on `key`? A blank string names nothing,
 * the same reading `noDataSourceMessage` gives an object name.
 */
const namesObject = (schema: unknown, key: string): boolean => {
  const value = (schema as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' && value.trim().length > 0;
};

/**
 * The "saved views are still being fetched" placeholder. Distinct from the error
 * panel because a component that treated "not resolved yet" as "does not exist"
 * would flash a configuration error on every mount.
 *
 * Its copy reads `common.loading` (objectui#12889), the key the rest of the
 * tree reads for a bare "Loading…": it printed an English "Loading view…" on
 * every locale before. `useObjectTranslation` runs only while a view resolves,
 * for the reason {@link ElementDataSourceMalformedFilterPanel} gives, and the
 * inline `defaultValue` is the `en` pack's value, held byte-identical to it by
 * `pnpm check:i18n-keys`.
 */
export function ElementDataSourceLoadingPanel({
  testId,
}: Pick<ElementDataSourceStatusPanelProps, 'testId'>): React.ReactElement {
  const { t } = useObjectTranslation();
  return (
    <div
      className="p-2 text-sm text-muted-foreground animate-pulse"
      role="status"
      aria-live="polite"
      data-testid={`${testId}-resolving-view`}
    >
      {t('common.loading', { defaultValue: 'Loading…' })}
    </div>
  );
}

/**
 * The adapter this block would use, resolved the one way every block in the
 * family resolves it: an explicit value first, the `SchemaRendererProvider`
 * context second.
 *
 * The `isElementDataSourceConfig` guard is the same one
 * {@link useElementDataSourceSchema} applies — a host handing us the spec
 * BINDING under this name is handing us metadata, not an adapter, and counting
 * it as one is how "no data source" reads as "resolved".
 *
 * `T` is what the CALLER expects to have been injected, and the assertion is
 * the caller's, not this hook's: an adapter arrives here as a `dataSource` prop
 * or a context value that nothing in this package can narrow, so the type has
 * to be declared by whoever knows which interface their block consumes. Leave
 * it off and you get `unknown`, which is the honest default.
 */
export function useResolvedDataSource<T = unknown>(explicit?: unknown): T | undefined {
  // Read AS DECLARED (objectui#7209): the only cast in this hook is the
  // caller's `T` on the way out, never one erasing the context on the way in.
  // Pinned by `useResolvedDataSource.schemaRendererContextRead-7209.test.ts`.
  const context = React.useContext(SchemaRendererContext);
  const named = isElementDataSourceConfig(explicit) ? undefined : explicit;
  return (named ?? context?.dataSource ?? undefined) as T | undefined;
}

/**
 * The author-facing sentence a block with no adapter says out loud.
 *
 * One wording for the whole object-bound family, because the reader's mistake
 * is the same one every time and the fix is the same one every time: the
 * adapter is injected by an ANCESTOR (`SchemaRendererProvider`), so nothing
 * written on the block itself can supply it. Naming the block and the object
 * it was about to read is what turns "nothing happened" into an address.
 */
export function noDataSourceMessage(blockKey: string, objectName?: unknown): string {
  const target =
    typeof objectName === 'string' && objectName.trim().length > 0
      ? `“${objectName}”`
      : 'its object';
  return (
    `“${blockKey}” has no data source, so it cannot read ${target}. ` +
    `Inject one from an ancestor — <SchemaRendererProvider dataSource={…}> from ` +
    `@object-ui/react — or hand this block a dataSource of its own.`
  );
}

/**
 * The "this block resolved no adapter" panel — objectui#5378 item 2, and the
 * #5349 shape it belongs to.
 *
 * Until this existed, a block that resolved no adapter rendered an EMPTY SHELL:
 * `object-grid` painted a header-only table, `object-form` a field-less card,
 * `detail-view` nothing at all — no error, no warning, no empty state that
 * explained itself. Measured on the published getting-started guide
 * (`content/docs/guide/building-crud-app.md`), every one of its five blocks was
 * in that state and the page reported success while fetching nothing.
 *
 * The empty shell is the defect, not a side effect of it: it is indistinguishable
 * from "the query ran and matched no rows", which is the reading an author (very
 * often an AI author) takes, and it points at the DATA when the fault is in the
 * WIRING one level up. Same posture as {@link ElementDataSourceErrorPanel}: the
 * metadata is answerable, so the answer is rendered where the author can see it.
 */
export function NoDataSourcePanel({
  testId,
  title,
  message,
}: ElementDataSourceStatusPanelProps): React.ReactElement {
  // objectui#12920 — same reading as {@link ElementDataSourceErrorPanel}: an
  // absent `title` reads the bundle, a passed one wins.
  const { t } = useObjectTranslation();
  const heading =
    title === undefined
      ? t('element.component.noDataSource', { defaultValue: 'No data source resolved' })
      : title;
  return (
    <div
      className="p-4 border border-red-500 rounded text-red-500 bg-red-50 my-2"
      role="alert"
      data-testid={`${testId}-no-data-source`}
    >
      <p className="font-medium">{heading}</p>
      {message ? <p className="text-sm mt-1">{message}</p> : null}
    </div>
  );
}

/**
 * The wrapping seam — mark `renderer` as one that wraps {@link
 * ElementDataSourceGate}, so its registrations DECLARE the `dataSource` key this
 * gate READS (objectui#6678).
 *
 * ```tsx
 * export const ObjectMapRenderer = elementDataSourceBlock<React.FC<any>>(({ schema }) => (
 *   <ElementDataSourceGate schema={schema} testId="object-map" …>
 *     {(bound) => <ObjectMap schema={bound} />}
 *   </ElementDataSourceGate>
 * ));
 * ```
 *
 * ## What this closes
 *
 * `PageComponentSchema.dataSource` is the one spelling that resolves a saved
 * view for an object-bound block. It works — and because no registration
 * declared it, `sdui-parser`'s `validateTree` reported it with the SAME
 * `unknown-prop` warning it gives the spellings that do nothing. On the tier
 * built to accept AI-authored pages the diagnostic IS the contract, so the
 * tier's only signal pointed away from the one key that works.
 *
 * ## Why a seam and not nine declarations
 *
 * Maintainer ruling, 2026-08-29: option B **in the injection form**. Nine
 * hand-written copies across nine packages is the shape that ruling refused —
 * they drift, and the tenth block forgets. Passing through here is the only
 * thing a block does; `Registry.register` emits the declaration
 * (`withElementDataSourceInput`), and `ELEMENT_DATA_SOURCE_INPUT` in
 * `@object-ui/core` is its single copy, beside the binding's own semantics.
 *
 * ## And it cannot be forgotten
 *
 * `scripts/check-element-data-source-declaration.mjs` fails any source that
 * renders `ElementDataSourceGate` for a registration without passing that
 * registration's renderer through this function. That is the mechanical half of
 * "a tenth block gets it automatically"; this function is the seam it enforces.
 *
 * Returns the renderer UNCHANGED (the mark is held in a `WeakSet`), so it is safe
 * over a `React.forwardRef` object, over `React.memo`, and over a component that
 * something else already re-exports by reference.
 *
 * ⚠️ Re-exported from `@object-ui/core` — where the marker and the declaration
 * live — rather than wrapped here: ONE function under ONE name. This export
 * exists for DISCOVERABILITY, so the seam is findable beside the gate it is
 * about; **call sites must import it from `@object-ui/core`**, and
 * `check:element-data-source-declaration` enforces that.
 *
 * The rule is measured, not stylistic. A registration runs at MODULE SCOPE, 101
 * suites in this repo partially mock `@object-ui/react` by hand-listing the
 * exports they return, and a module-scope read of a name absent from such a list
 * throws at COLLECTION time — the importing test file dies before running one
 * assertion. Taking the seam from here reddened 17 files across all four CI
 * shards with zero failed assertions among them. Nothing mocks `@object-ui/core`,
 * and every registration module already imports `ComponentRegistry` from it.
 */
export { elementDataSourceBlock } from '@object-ui/core';

export interface ElementDataSourceGateProps<S> {
  /** The block's schema node. */
  schema: S;
  /** Which schema keys this block reads; see {@link ElementDataSourceMapping}. */
  mapping?: ElementDataSourceMapping;
  /** Explicit adapter; falls back to `SchemaRendererContext`. */
  dataSource?: unknown;
  /** `data-testid` stem for the two status panels — the block's registry key. */
  testId: string;
  /** Heading for the unresolvable-view panel. */
  errorTitle?: string;
  /**
   * Whether THIS placement cannot do its job without a runtime adapter — when
   * true and none resolves, the gate renders {@link NoDataSourcePanel} instead
   * of the block (objectui#5378 item 2).
   *
   * The gate cannot compute this and does not try. "Needs an adapter" is a
   * statement about the block's own fallbacks, and every block in the family
   * has different ones: an `object-grid` carrying inline `data` rows needs no
   * adapter, an `object-form` with inline `customFields` needs none, a
   * `detail-view` handed a `data` record needs none. A predicate guessed HERE
   * would paint a configuration error over a block that is working, which is a
   * worse failure than the silence this replaces — so the call site, which
   * knows its own fallbacks, states it.
   */
  requiresDataSource?: boolean;
  /** Explanation for the no-adapter panel; see {@link noDataSourceMessage}. */
  noDataSourceMessage?: string;
  /**
   * Whether THIS placement has nothing to show unless it names an object — when
   * true and the bound schema names none on the mapping's object key (neither
   * the node's own key nor `dataSource.object` landing on it), the gate renders
   * the "no object named" hint instead of the block (objectui#11605).
   *
   * Read AFTER the binding is applied, so a node bound by `dataSource.object`
   * is never told it names no object; and AFTER the view states, so a binding
   * that is still resolving or failed to resolve keeps its own panel.
   *
   * The call site states it, for the reason {@link requiresDataSource} gives:
   * the other record sources a block can draw from (inline `data`, inline
   * `customFields`, a `dataset`, a `bind` path) are each block's own, and a
   * predicate guessed here would paint a configuration hint over a block that
   * is working. A mapping whose `object` is `false` lands no object key, so
   * this prop does nothing there.
   */
  requiresObject?: boolean;
  /**
   * Renders the block with the bound schema. Called during the gate's own
   * render, so it must RETURN AN ELEMENT and never call hooks itself — the
   * block's hooks belong to the block.
   */
  children: (schema: S) => React.ReactElement | null;
}

/**
 * Wrap an object-bound block so its `dataSource` binding reaches the keys it
 * reads, and so the two non-final resolution states render once, the same way,
 * for every block.
 *
 * The block itself is not mounted while a named view is unresolved: rendering it
 * against a half-resolved query is how a page shows a wider answer than the one
 * that was authored.
 */
export function ElementDataSourceGate<S>({
  schema,
  mapping,
  dataSource,
  testId,
  errorTitle,
  requiresDataSource,
  noDataSourceMessage: noDataSourceText,
  requiresObject,
  children,
}: ElementDataSourceGateProps<S>): React.ReactElement | null {
  const bound = useElementDataSourceSchema(schema, mapping, dataSource);
  const adapter = useResolvedDataSource(dataSource);

  // Reported BEFORE the view state, because with no adapter every downstream
  // answer is a symptom of this one: `useElementDataSource` cannot list the
  // object's saved views either, so a block carrying a `view` would otherwise
  // report "this data source cannot list the saved views" — true, and pointing
  // at the view name instead of at the missing injection.
  if (requiresDataSource && adapter == null) {
    return <NoDataSourcePanel testId={testId} message={noDataSourceText} />;
  }

  // A refused filter is `missing` too, but it gets the malformed-filter notice
  // rather than the "could not be resolved" panel: the binding resolved, and
  // what the author has to fix is a filter condition (objectui#10789).
  if (bound.filterRefusal) {
    return <ElementDataSourceMalformedFilterPanel testId={testId} refusal={bound.filterRefusal} />;
  }
  if (bound.status === 'missing') {
    return <ElementDataSourceErrorPanel testId={testId} title={errorTitle} message={bound.error} />;
  }
  if (bound.status === 'loading') {
    return <ElementDataSourceLoadingPanel testId={testId} />;
  }
  // Named in neither place: not on the block's own key, and not by a binding
  // (whose `object` the hook above has already landed on that key). See
  // `requiresObject` for why the call site, not this gate, decides it applies.
  const objectKey = mapping?.object ?? 'objectName';
  if (requiresObject && objectKey !== false && !namesObject(bound.schema, objectKey)) {
    return <ElementDataSourceNoObjectPanel testId={testId} property={objectKey} />;
  }
  return children(bound.schema);
}
