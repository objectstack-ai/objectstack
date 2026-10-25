/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * LineItemsPanel — the `record:line_items` component. Renders a child "line
 * items" grid bound to an EXISTING parent record (on a record/detail page or
 * a slotted page slot). Loads children by FK, lets the user add/edit/delete
 * rows, and persists the diff on Save. See ADR-0001.
 *
 * Parent id is taken from the component props (`recordId`/`parentId`) or from
 * the surrounding <RecordContextProvider>. dataSource comes from the
 * SchemaRenderer context.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from '@object-ui/components';
import { LineItemsField, useBooleanValueLabel, type GridColumn } from '@object-ui/fields';
import type { GridFieldMetadata } from '@object-ui/types';
import { createSafeTranslation } from '@object-ui/i18n';
import { useSchemaContext, useRecordContext, useFilterScope, useResolvedFilter, useDataInvalidation, usePrintPage, NonGridRowCeilingNote } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { buildMasterDetailEditBatch, sumRows } from './masterDetailTx';
import { applyColumnPermissions } from './fieldWriteGate';
import { hydrateColumns } from './deriveMasterDetail';
import {
  runBatchTransaction,
  mergeFilterNodes,
  filterRefusalSubject,
  toFilterNodeSafely,
  convertSortToQueryParams,
  resolveAffordance,
  type SchemaLike,
} from '@object-ui/core';

// The panel's own chrome. A provider-less host — a standalone embed, this
// package's own tests — must read English rather than the raw key, which is
// what `createSafeTranslation` is for; every row is byte-identical to the `en`
// pack (`pnpm check:i18n-keys`, `defaults-maps-mirror-en-pack`).
//
// - The malformed-filter state (objectui#9050 step 2).
// - The default title and the Save / Saving… button (objectui#11131): English
//   literals until then, so a zh session read `Line Items` and `Save`. The
//   button reuses the shared verbs `MasterDetailForm`'s Save reads; the title
//   is the panel's own key, and an authored `title` still wins. Like
//   `WizardForm`'s, this hook carries its own rows (see `formChrome.ts`).
// - The panel's states and errors (objectui#11145): the loading line (the
//   shared `common.loading`), the no-parent and held-for-another-parent
//   states, the config hint for a panel with no `childObject`, and the
//   fallbacks for a failed load or save. A message the server sent still wins
//   over those fallbacks.
const useLineItemsTranslation = createSafeTranslation(
  {
    'view.malformedFilter': 'This view’s filter is malformed, so no records are shown: the {{subject}} condition cannot be applied.',
    'form.lineItems.title': 'Line Items',
    'common.save': 'Save',
    'detail.saving': 'Saving…',
    'common.loading': 'Loading…',
    'form.lineItems.saveRecordFirst': 'Save the record first to add line items.',
    'form.lineItems.notLoaded': 'This record’s line items have not been loaded.',
    'form.lineItems.loadFailed': 'Failed to load line items',
    'form.lineItems.saveFailed': 'Failed to save line items',
    'form.lineItems.noChildObject':
      'This panel has no child object configured: set {{property}} to the object whose rows it lists.',
  },
  'view.malformedFilter',
);

/**
 * What the panel's error banner shows. A failure the server described is shown
 * in its words (`message`). One it did not describe is shown as the panel's own
 * fallback for the operation that failed (`op`), resolved when the banner
 * renders, so it reads the session locale (objectui#11145).
 */
type PanelError = { message: string } | { op: 'load' | 'save' };

function panelError(e: unknown, op: 'load' | 'save'): PanelError {
  const message = (e as { message?: string } | null | undefined)?.message;
  // Truthiness, as the `||` this replaces: an empty message falls through to
  // the fallback.
  return message ? { message } : { op };
}

export interface LineItemsPanelSchema {
  type?: 'record:line_items';
  childObject: string;
  relationshipField: string;
  columns: GridColumn[];
  parentObject?: string;
  parentId?: string;
  recordId?: string;
  /** Numeric CHILD column summed into the grid's footer total, e.g. `'amount'`. */
  amountField?: string;
  /** PARENT field that receives that sum on save, e.g. `'total_amount'`. */
  totalField?: string;
  title?: string;
  readonly?: boolean;
  minRows?: number;
  maxRows?: number;
  /**
   * *Additional* criteria for the child rows, in any shape `toFilterNode`
   * accepts (spec `ViewFilterRule[]`, ObjectQL AST nodes, or a MongoDB-style
   * object).
   *
   * AND-combined with the parent relationship condition, never substituted for
   * it (objectstack#7137, exactly as `record:related_list` does since
   * objectstack#7118): a line-items panel is always scoped to the record it sits
   * on, so an additional criterion can only narrow this parent's children — it
   * can never surface another parent's rows. When a `dataSource` binding is
   * present, `ElementDataSourceGate` has already AND-combined this key with the
   * view's filter and the binding's own before the schema arrives here.
   */
  filter?: any[] | Record<string, any>;
  /**
   * Load order for the child rows — the spec's `SortConfig[]`. Without one the
   * rows arrive in storage order. The legacy `"line_no desc"` clause is RETIRED
   * (objectui#8221): `convertSortToQueryParams` refuses it out loud.
   */
  sort?: Array<{ field?: string; order?: 'asc' | 'desc' }>;
  /**
   * Row cap for the child fetch; defaults to {@link DEFAULT_LINE_ITEMS_LIMIT}.
   * A line-items grid has no pagination control — every loaded row is editable
   * and saved as one batch — so this is the author's window, not a page size.
   */
  limit?: number;
}

/**
 * Child rows fetched when the author declared no `limit` — the window this panel
 * has always used, now authorable (objectstack#7137).
 */
export const DEFAULT_LINE_ITEMS_LIMIT = 500;

/**
 * What the contract admits as a row cap for this panel.
 *
 * `@objectstack/spec` has already answered what `limit: 0` means: the element
 * data source `limit` that a `dataSource` binding lowers into this key is
 * declared a POSITIVE INTEGER (`z.number().int().positive().optional()`), and
 * so is the `pagination.pageSize` of a named view that fills it. So `0` is not
 * a spelling whose meaning this renderer may choose; it is a value the contract
 * refuses, and a renderer that forwards it to the wire is the only party not
 * saying so.
 */
function isUsableRowLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The ONE resolver for this panel's row cap, for the reason objectui#9853 gave
 * when it landed the same shape on `ObjectGrid` and objectui#9897 repeated on
 * `ListView`: one resolver at every entry is what keeps the answer single.
 *
 * Before objectui#9925 this read was a bare `schema.limit ?? DEFAULT_LINE_ITEMS_LIMIT`,
 * and `??` rejects only `null` and `undefined` — so an authored `limit: 0` was
 * not nullish and survived as a real window. It reached the wire as `$top: 0`,
 * the panel asked the server for nothing, and the empty grid named no cause. A
 * negative goes out the same way. Both ENTRANCES converge on this key: a
 * `dataSource` binding lowers a named view's `pagination.pageSize` into
 * `schema.limit` before this component sees it (`RECORD_LINE_ITEMS_DATA_SOURCE`
 * maps `limit: 'limit'`), and a panel with no binding at all reads the authored
 * `limit` from the same place — so resolving HERE covers both, which a repair at
 * the lowering layer could not.
 *
 * ⚠️ The refusal is FAIL-SOFT on purpose. Throwing would take out the whole
 * panel over one declaration, which is a worse outcome than the defect. The
 * value is dropped, this panel's own default is used, and
 * `describeRefusedRowLimit` states it once through the channel this component
 * already uses for "you declared it, the renderer dropped it" (the same
 * `console.warn` the `childObject` declines below write to). ⛔ Not a silent
 * clamp, and ⛔ not a clamp to 1: the author's number is refused, not repaired.
 */
function resolveRowLimit(authored: unknown, fallback: number): number {
  return isUsableRowLimit(authored) ? authored : fallback;
}

/**
 * The diagnostic half. `null` means "nothing to say" — an absent `limit` is not
 * a mistake, and a usable one is not either, so the message is CONDITIONAL and
 * the silence controls in the pin are what keep it from being an always-on
 * marker that states nothing.
 *
 * ⛔ NOT a second guard: the predicate lives once, in `isUsableRowLimit`, and
 * this reads it. Two predicates would be free to drift, and the drift would be
 * invisible — a value refused by one and admitted by the other.
 */
function describeRefusedRowLimit(authored: unknown, childObject: unknown): string | null {
  if (authored === undefined || authored === null) return null;
  if (isUsableRowLimit(authored)) return null;
  const where =
    typeof childObject === 'string' && childObject
      ? `record:line_items on ${childObject}`
      : 'record:line_items';
  return (
    `[ObjectUI] LineItemsPanel row cap: ${where} declared limit: ${String(authored)}, `
    + 'which is not a positive integer. A row cap must be a positive integer '
    + '(the spec refuses zero and negative values), so it was ignored and this '
    + `panel fell back to its default row cap (${DEFAULT_LINE_ITEMS_LIMIT}).`
  );
}

export const LineItemsPanel: React.FC<{ schema: LineItemsPanelSchema }> = ({ schema }) => {
  const ctx = useSchemaContext() as any;
  const { t } = useLineItemsTranslation();
  // The session's word for a boolean value, which draws a hydrated `boolean` /
  // `toggle` column's two option labels (objectui#12924). The grid memo below
  // is keyed on the two WORDS, not on the function, which is a new one every
  // render.
  const booleanLabel = useBooleanValueLabel();
  const booleanTrueWord = booleanLabel(true);
  const booleanFalseWord = booleanLabel(false);
  const dataSource = ctx?.dataSource;
  // useRecordContext returns null outside a <RecordContextProvider> (e.g. in the
  // Studio designer/palette), so it never throws — call it unconditionally to
  // keep hook order stable across renders. A null record just means "no parent
  // record bound", which the optional chaining below already handles.
  const record = useRecordContext();
  // The caller's field-level grants on the CHILD object. With no provider
  // mounted this is the fail-open answer (`isLoaded` false) and the grid below
  // renders exactly as it did before permissions existed (objectui#10163).
  const perms = usePermissions();

  const parentObject = schema.parentObject || record?.objectName;
  // No assertion: `RecordContextValue.recordId` is the protocol's `string`
  // (narrowed once at the `RecordContextProvider` injection boundary) and
  // `buildMasterDetailEditBatch` takes a `string` parent id, so the two
  // declarations meet on their own. objectui#9304 left a documented assertion
  // here as evidence that they did not; objectui#9333 repaired the declaration
  // and discharged the evidence.
  const parentId = schema.parentId || schema.recordId || record?.recordId;

  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [original, setOriginal] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<PanelError | null>(null);
  // objectui#10682 — the number of the latest `load` run (objectui#10683). Only
  // the current run writes `error`: its commit clears the banner, its failure
  // raises it, and a run a newer one has superseded (another `parentId`, say,
  // while it was in flight) does neither. Held in a ref: nothing renders from it.
  const loadSeqRef = useRef(0);
  // objectui#10740 — the parent the held `rows` / `original` belong to. Written
  // wherever the rows are written: beside a load's commit (that run's parent),
  // and beside an edit made while nothing is held yet (a grid offered with no
  // adapter, so no load has settled: the parent on screen). The CURRENT load
  // that fails while nothing is held adopts its parent too, since the empty
  // rows it leaves on screen are that parent's. A load for ANOTHER parent that
  // fails or declines leaves it where it was, so the rows and this value keep
  // agreeing after `parentId` has moved on. That disagreement is
  // `heldForAnotherParent`: the grid is not drawn from those rows, the Save
  // button is off, and `save` sends nothing. Before this card the failed load
  // left the previous parent's edited lines drawn, editable and saveable, and
  // Save wrote them under the CURRENT `parentId` (an edit batch's child rows
  // carry it directly), moving another record's lines. The guard rather than a
  // clear in the load's `catch`, because a load that DECLINES for the new parent
  // (a refused filter, say) never reaches that `catch` and left the same Save
  // enabled over the same held rows.
  const [rowsHeldFor, setRowsHeldFor] = useState<string | undefined>(undefined);
  const heldForAnotherParent = rowsHeldFor !== undefined && rowsHeldFor !== parentId;

  // objectui#10712 (R3) — the same rule the default form applies to its own
  // background re-read (`ObjectForm.tsx`, `formDirtyRef` / `heldChangeRef`:
  // unsaved input holds the re-read, and one is replayed when the form is
  // pristine again or its save lands). A change to a load input other than the
  // parent (sort, limit, filter) is HELD while this panel holds unsaved edits
  // for the CURRENT parent: `dirty`, the rows held for `parentId`, and the last
  // run's parent, adapter, child object and relationship field equal to the
  // current ones. Before this card the re-read committed over the author's
  // lines with no signal. What `load` reads to decide this lives in refs, so
  // an edit does not move `load` and re-run the fetch effect. `heldEditsRef`
  // mirrors `dirty` / `rowsHeldFor` from an effect declared ahead of `load`;
  // `lastRunRef` is written where a run is numbered; `heldReloadRef` is the
  // pending held change, and `heldReplay` replays it once when a same-parent
  // read that was in flight at the hold commits (the fetch effect is keyed on
  // it, and the panel is clean after that commit, so the replay is not held).
  const heldEditsRef = useRef({ dirty: false, rowsHeldFor: undefined as string | undefined });
  useEffect(() => {
    heldEditsRef.current = { dirty, rowsHeldFor };
  }, [dirty, rowsHeldFor]);
  const lastRunRef = useRef<{
    parentId: string | null | undefined;
    dataSource: unknown;
    childObject: string | undefined;
    relationshipField: string | undefined;
    // objectui#10814 — the rest of the read, so a run can tell a re-read of the
    // rows on screen from a read of other rows (see `rereadsRowsOnScreen`).
    top: number;
    filterKey: string;
    sortKey: string;
  } | null>(null);
  const heldReloadRef = useRef(false);
  const [heldReplay, setHeldReplay] = useState(0);
  // objectui#11958 — on a page that declares `print`, the row cap is not
  // allowed to cut lines off in silence: a printed document that carries part
  // of its lines with nothing on the paper saying so is the failure the
  // printable block subset exists to prevent. The read asks for one PROBE row
  // past the cap and for the count (the `applyNonGridRowCeiling` construction
  // in `@object-ui/core`), and when the probe comes back the panel draws the
  // cap's rows and the shared row-ceiling note under them, on screen and on
  // paper. Off a print page the read and the panel are unchanged.
  const printing = usePrintPage() !== null;
  const [rowCap, setRowCap] = useState<{ shown: number; total?: number } | null>(null);
  // objectui#10814 — an in-place re-read is in flight: the grid stays drawn over
  // the rows it already shows, and takes no input until the answer lands.
  const [refreshing, setRefreshing] = useState(false);

  // Child object schema — used to strip computed / read-only columns from each
  // row before persisting (parity with the parent form's sanitize). Rows are
  // loaded from a full read, so an edit would otherwise round-trip formula /
  // summary columns the server rejects as unknown fields. The grid's untyped
  // columns are hydrated from it too (`gridField` below, objectui#12854).
  const [childSchema, setChildSchema] = useState<{ fields?: Record<string, any> } | null>(null);
  useEffect(() => {
    const ds: any = dataSource;
    if (!ds || typeof ds.getObjectSchema !== 'function') return;
    // Decline to fetch when the child object never resolved (objectui#6188).
    // `childObject` is typed `string` above, but the spec row and this block's
    // registry entry both leave it optional, because the node's `dataSource`
    // binding can supply it (objectui#11569) — so a node with neither reaches
    // this renderer with the key `undefined`, and the fetch below then asked the
    // data layer for an object literally named `undefined`. `RelatedList` already takes the other choice for the same class
    // of missing key ("has no referenceField/parentId — refusing to fetch all
    // rows", RelatedList.tsx), and `MasterDetailForm` declines on this exact key
    // (objectui#5940) with its child-schema cache spelling it `.filter(Boolean)`.
    //
    // Clearing the cache rather than just returning: an unresolvable panel HAS no
    // child schema, and leaving a previous object's schema in place would sanitize
    // the next save against the wrong object's fields. `null` is what the `.catch`
    // below already produces, so the sanitize path needs no new case.
    if (!schema.childObject) {
      setChildSchema(null);
      console.warn(
        `[LineItemsPanel] a line-items panel has no childObject — refusing to fetch its child schema. Set childObject to the child object the panel lists.`,
      );
      return;
    }
    let cancelled = false;
    ds.getObjectSchema(schema.childObject)
      .then((s: any) => { if (!cancelled) setChildSchema(s ?? null); })
      .catch(() => { if (!cancelled) setChildSchema(null); });
    return () => { cancelled = true; };
  }, [dataSource, schema.childObject]);

  // [objectui#9925] The loud half of the row-cap refusal, on the channel this
  // component already uses for "you declared it, the renderer dropped it" (the
  // `childObject` declines above and in `load`). Keyed on the DECLARATION, so
  // it is one warning per declaration rather than one per render — and it fires
  // from an effect, never from render, so a re-render with the same authored
  // value says nothing a second time. (This panel parses no config of its own,
  // so before this card nothing in the renderer looked at `limit` at all.)
  useEffect(() => {
    const message = describeRefusedRowLimit(schema.limit, schema.childObject);
    if (message) console.warn(message);
  }, [schema.limit, schema.childObject]);

  // Content keys, not identities: an inline `filter` / `sort` on a schema node is
  // a new object every render and both are inputs to `load` (which an effect
  // below depends on) — keying on identity would refetch the children on every
  // render. Same reason `RelatedList` keys its own scope filter on content.
  //
  // ⚠️ `toFilterNodeSafely`, not `toFilterNode` — objectui#9050. This is a
  // RENDER-time `useMemo`, so a `FilterOperatorError` from the lowering is a
  // render error with no load `catch` and no `classifyLoadError` above it. The
  // refusal is kept as a VALUE and rendered below; collapsing it to
  // `undefined` would mean "no filter" and load this panel's rows
  // unconstrained, the silent widening objectui#9001 closed.
  //
  // objectui#10666 — the panel's own `filter` is lowered AFTER every context
  // token in it (`{current_user_id}`, `{current_org_id}`, the date macros) is
  // resolved ONCE through `@object-ui/core`'s shared
  // `resolveFilterPlaceholders`, against the session scope the host provides,
  // and HELD by structure (`useResolvedFilter` in `@object-ui/react`). The
  // panel merged the literal token into the parent scope before. The content
  // key is taken over the held value, so a new signed-in user moves it and
  // reloads, and a date macro such as `{now}` does not move it every render.
  const filterScope = useFilterScope();
  const scopeFilter = useResolvedFilter(schema.filter, filterScope);
  const filterKey = JSON.stringify(scopeFilter ?? null);
  const sortKey = JSON.stringify(schema.sort ?? null);
  const listFilterResult = useMemo(
    () => toFilterNodeSafely(scopeFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on CONTENT, see above
    [filterKey],
  );
  const filterRefusal = listFilterResult.ok ? undefined : listFilterResult.refusal;
  const listFilterNode = listFilterResult.ok ? listFilterResult.node : undefined;
  const orderBy = useMemo(
    () => convertSortToQueryParams(schema.sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on CONTENT, see above
    [sortKey],
  );

  // objectui#10814 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10623 way: the nonce moves when a
  // write to the object this panel QUERIES is declared, and the fetch effect
  // below names it, so the lines are re-read. Without it a page action over raw
  // HTTP left a panel with an authored `parentId` / `recordId` (one a stored
  // page holds with no record context) stale unless its host remounted it, and
  // `PageView` is to stop doing that (objectui#10519).
  //
  // The object is the CHILD object: the panel reads `find(childObject)` scoped
  // to one parent. It is object-level, because `dataChangeMatches` scopes a
  // `recordId` to a record OF the object named, and the rows here are many
  // children, not one record. Subscribed only when `load` below can query (an
  // adapter and a parent bound).
  //
  // The re-read goes through `load('inputs')`, so what already holds for an
  // input change holds for it: unsaved edits for the current parent HOLD it
  // (objectui#10712 R3) and the save's reload carries it, and a superseded run
  // commits nothing. A re-read of the rows on screen keeps the grid drawn
  // (`rereadsRowsOnScreen` in `load`).
  const invalidationNonce = useDataInvalidation(dataSource && parentId ? schema.childObject : undefined);

  /**
   * `origin` says who asked for the read: `'inputs'` is the fetch effect (a
   * load input moved, or a held change is replayed), `'save'` the post-save
   * reload. Only an `'inputs'` read can be HELD (objectui#10712 R3, above): the
   * post-save reload reads the panel's current inputs, which is what replays a
   * held change, so it is never held itself.
   */
  const load = useCallback(async (origin: 'inputs' | 'save' = 'save') => {
    if (origin === 'inputs') {
      const held = heldEditsRef.current;
      const last = lastRunRef.current;
      const editsHeldForCurrentParent =
        held.dirty && held.rowsHeldFor !== undefined && held.rowsHeldFor === parentId;
      const sameRowsAsLastRun =
        last !== null
        && last.parentId === parentId
        && last.dataSource === dataSource
        && last.childObject === schema.childObject
        && last.relationshipField === schema.relationshipField;
      if (editsHeldForCurrentParent && sameRowsAsLastRun) {
        // Held, and NOT numbered: a held change is not a run, so it supersedes
        // nothing. A same-parent read still in flight commits, and its commit
        // replays this change (the panel is clean then).
        heldReloadRef.current = true;
        return;
      }
    }
    // objectui#10814 — this read asks for exactly what the last run asked for,
    // and the rows on screen are this parent's: a re-read of the rows already
    // drawn (a bus event, or a held one replayed). It keeps the grid drawn over
    // those rows instead of blanking it to the loading branch, the way a
    // record form's bus re-read stays mounted (objectui#10572). The grid takes
    // no input while it is in flight, since its commit replaces the rows. Not
    // for the save's reload, which draws the loading branch as it always has.
    const top = resolveRowLimit(schema.limit, DEFAULT_LINE_ITEMS_LIMIT);
    const prev = lastRunRef.current;
    const rereadsRowsOnScreen =
      origin === 'inputs'
      && prev !== null
      && prev.parentId === parentId
      && prev.dataSource === dataSource
      && prev.childObject === schema.childObject
      && prev.relationshipField === schema.relationshipField
      && prev.top === top
      && prev.filterKey === filterKey
      && prev.sortKey === sortKey
      && heldEditsRef.current.rowsHeldFor === parentId;
    // Every run reads the panel's current inputs, so whatever change was held
    // is carried by this one.
    heldReloadRef.current = false;
    // Numbered before any early return, so a run that declines still
    // supersedes one in flight.
    const seq = ++loadSeqRef.current;
    const isCurrent = () => loadSeqRef.current === seq;
    lastRunRef.current = {
      parentId,
      dataSource,
      childObject: schema.childObject,
      relationshipField: schema.relationshipField,
      top,
      filterKey,
      sortKey,
    };
    // A newer run ends any in-place re-read it supersedes, including one that
    // declines below before it reaches the wire.
    setRefreshing(false);
    if (!dataSource || !parentId) {
      setLoading(false);
      return;
    }
    // A refused filter never reaches the wire (objectui#9050). The render below
    // shows the malformed-filter state instead; this guard is what keeps "no
    // filter node" from being read as "no filter" by the query built here.
    if (filterRefusal) {
      setLoading(false);
      return;
    }
    // Decline to fetch when the child object never resolved (objectui#6194) —
    // the SIBLING site of the child-schema decline above (objectui#6188), and
    // the second of this component's two reads of `schema.childObject`. Same
    // reason it is a defect and not a shrug: nothing enforces the key (see the
    // effect above), so an authored node reaches this renderer with it
    // `undefined` and the fetch below then asked the data layer to `find` an
    // object literally named `undefined`, scoped by
    // `{ [relationshipField]: parentId }`.
    //
    // Ordered AFTER the dataSource/parentId guard on purpose, exactly as the
    // child-schema effect orders its own: a designer palette renders this block
    // with no dataSource at all while the author is still configuring it, and
    // warning there would be noise about a panel nobody has finished authoring.
    //
    // `setLoading(false)` because this panel is NOT loading. It can never
    // resolve, and holding `loading` true would only hide a permanent authoring
    // error behind a spinner that never ends — the render below therefore reads
    // `schema.childObject` ahead of `loading` and says what is wrong.
    if (!schema.childObject) {
      setLoading(false);
      console.warn(
        `[LineItemsPanel] a line-items panel has no childObject — refusing to fetch its rows. Set childObject to the child object the panel lists.`,
      );
      return;
    }
    if (rereadsRowsOnScreen) setRefreshing(true);
    else setLoading(true);
    try {
      // Parent relationship AND the panel's own criteria (objectstack#7137).
      // The parent condition is not negotiable — an "additional" criterion may
      // only narrow THIS parent's children — and with nothing authored the query
      // is the untouched MongoDB-style object it has always been rather than a
      // freshly lowered AST meaning the same thing (invisible on screen, visible
      // to every caller pinning the wire). Composed through the repo's single
      // filter sink, the same way `record:related_list` composes its own.
      const parentScope = { [schema.relationshipField]: parentId } as Record<string, any>;
      const res = await dataSource.find(schema.childObject, {
        $filter:
          listFilterNode === undefined
            ? parentScope
            : mergeFilterNodes(parentScope, listFilterNode),
        ...(orderBy ? { $orderby: orderBy } : {}),
        ...(printing ? { $top: top + 1, $count: true } : { $top: top }),
      });
      // objectui#10712 — a run a newer one has superseded (another `parentId`,
      // say, while this read was in flight) commits nothing: not the rows, not
      // their owner, not the banner, and not the end of the loading state the
      // current run is still in (the `finally` below reads the same run
      // number). Before this card the answer landed either way: last, it
      // replaced the current parent's lines (since objectui#10740 the rows it
      // brought were refused as another parent's, the current lines gone all
      // the same); first, it ended the loading state and drew the grid while
      // the current read was pending.
      if (!isCurrent()) return;
      const fetched = (res?.data ?? []) as Record<string, any>[];
      const capped = printing && fetched.length > top;
      const data = capped ? fetched.slice(0, top) : fetched;
      setRowCap(
        capped
          ? { shown: data.length, total: typeof res?.total === 'number' ? res.total : undefined }
          : null,
      );
      setRows(data.map((r) => ({ ...r })));
      setOriginal(data.map((r) => ({ ...r })));
      setDirty(false);
      // The rows just committed are this run's parent's (objectui#10740). Same
      // commit as the rows, so the two never disagree about whose they are.
      setRowsHeldFor(parentId);
      // Once the CURRENT run commits, the rows on screen answer what the panel
      // asks for now, so no earlier failure describes it: not a failed load,
      // and not a failed save, whose edits these rows replace (objectui#10682,
      // the objectui#10578 rule: cleared on a commit, never when a load starts).
      setError(null);
      // A change held while THIS read was in flight is replayed once, now that
      // the panel is clean (objectui#10712 R3): this read was issued before the
      // change, so its answer is for the inputs it was issued with.
      if (heldReloadRef.current) {
        heldReloadRef.current = false;
        setHeldReplay((n) => n + 1);
      }
    } catch (e: any) {
      if (isCurrent()) {
        setError(panelError(e, 'load'));
        // Nothing held yet: the empty rows on screen are this parent's from
        // here on, so a line added under this failure is saved to it and to no
        // parent the panel moves to later (objectui#10740). Rows already held
        // for another parent stay that parent's: this failure adopts nothing.
        setRowsHeldFor((held) => held ?? parentId);
      }
    } finally {
      // Only the current run ends the loading state (objectui#10712): a
      // superseded run's release would draw the grid over the empty rows while
      // the current read is still pending. Every decline above releases it
      // before any await, so a run that returns early is never superseded here.
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [
    dataSource,
    parentId,
    schema.childObject,
    schema.relationshipField,
    schema.limit,
    filterRefusal,
    listFilterNode,
    orderBy,
    filterKey,
    sortKey,
    printing,
  ]);

  // objectui#10712 — the panel's latest `load` and the parent it reads, for the
  // save's continuation. `save` closes over the render it was clicked in, and
  // its batch lands after any number of renders. The reload that follows is the
  // PANEL's read, not the click's: it reads the inputs on screen then (sort,
  // limit, filter), and it does not run at all once the panel has moved to
  // another parent. Written from an effect, never during render.
  const latestLoadRef = useRef({ load, parentId });
  useEffect(() => {
    latestLoadRef.current = { load, parentId };
  }, [load, parentId]);

  // A load input moved, a held change is replayed (`heldReplay`), or the bus
  // reported a write to the child object (`invalidationNonce`, objectui#10814):
  // the read the panel's inputs ask for, which `load` may hold (objectui#10712 R3).
  useEffect(() => {
    void load('inputs');
  }, [load, heldReplay, invalidationNonce]);

  const onChange = useCallback((next: Record<string, any>[]) => {
    setRows(next);
    setDirty(true);
    // An edit made while nothing is held yet gives the rows their owner, the
    // parent on screen (objectui#10740). The grid this was found on is the one
    // drawn when the load declined for want of an adapter; a line typed into it
    // stayed ownerless, and the first parent whose load later failed adopted it
    // and could save it as its own. Written in the same
    // handler as the rows rather than in that decline, so that no other way of
    // offering the grid before a settle (a superseded run releasing `loading`,
    // objectui#10712's surface) can leave an edited row without an owner. Rows
    // already held keep their parent. `parentId` is narrowed to a string before
    // the updater closes over it: the setter's state is `string | undefined`,
    // and `parentId` is `string | null | undefined` here (there is no `load`
    // guard above this handler to narrow it), so a bare `held ?? parentId`
    // would widen the updater's result to include `null`. A grid is only
    // offered with a parent bound anyway (the `!parentId` branch draws no grid).
    if (parentId) {
      const owner = parentId;
      setRowsHeldFor((held) => held ?? owner);
    }
  }, [parentId]);

  const save = useCallback(async () => {
    // `childObject` joins this guard for the same reason both reads decline
    // (objectui#6194): every child op below carries `object: schema.childObject`,
    // so an unresolvable panel would WRITE rows into an object literally named
    // `undefined` — strictly worse than the read this card was filed for.
    // Measured on the pre-fix component, which is why this is not a guess: one
    // keystroke in the grid's always-present ghost row materialised a non-blank
    // row, that enabled Save, and Save reached
    // `batchTransaction([{ object: undefined, action: 'create', … }])`.
    // The render branch below closes that route by not offering the grid, but a
    // write contract is not the render tree's to keep: this is the same one-line
    // guard `load` takes, on the component's other data-layer entry point.
    if (!dataSource || !parentId || !schema.childObject) return;
    // The held rows are another parent's (objectui#10740): the batch below
    // would carry them under THIS `parentId` and move that parent's lines here.
    // The Save button is off in this state; this is the write contract's own
    // guard, on the function every caller of it reaches.
    if (heldForAnotherParent) return;
    // objectui#10712 — the parent this save is for. Its batch may land after
    // the host has moved the panel to another parent, whose own load has by
    // then committed (or failed) over these rows. The save's reload and its
    // failure belong to the parent it saved. While that parent is still on
    // screen, the reload is the panel's current read (`latestLoadRef`), not
    // the `load` captured at the click, which would re-read with that render's
    // inputs. Once it is not, the save commits nothing: no re-read of the old
    // parent into the new parent's panel, and no banner about lines that are
    // no longer on screen. Before this card the captured `load` ran as a new
    // run numbered latest, so it committed the OLD parent's lines into the new
    // parent's panel (refused there as another parent's since objectui#10740,
    // its commit clearing the new parent's own failure all the same), and the
    // save's failure was written wherever the panel had moved.
    const savedParent = parentId;
    const parentStillShown = () => latestLoadRef.current.parentId === savedParent;
    setSaving(true);
    setError(null);
    try {
      // Only roll the line total up onto the parent when we know the parent
      // object AND a target field — same gate as before. When we do, the parent
      // update rides in the SAME batch as the child writes, so the rollup is now
      // atomic with them (on an adapter that supports it) instead of a separate
      // trailing update.
      const canRollup = !!(parentObject && schema.totalField);
      const parentPatch = canRollup
        ? { [schema.totalField!]: sumRows(rows, schema.amountField || 'amount') }
        : {};
      let ops = buildMasterDetailEditBatch(parentObject ?? '', parentId, parentPatch, [
        {
          childObject: schema.childObject,
          relationshipField: schema.relationshipField,
          rows,
          original,
          // Strip computed / read-only columns from each child row payload.
          childSchema,
        },
      ]);
      // With no parent object / rollup to write, there is nothing to update on
      // the parent — drop op 0. Safe: edit-batch children carry the parentId
      // directly (no $ref), so slicing off the parent op shifts no references.
      if (!canRollup) ops = ops.slice(1);
      if (ops.length) await runBatchTransaction(dataSource, ops);
      if (parentStillShown()) await latestLoadRef.current.load('save');
    } catch (e: any) {
      if (parentStillShown()) setError(panelError(e, 'save'));
    } finally {
      setSaving(false);
    }
  }, [dataSource, parentId, heldForAnotherParent, rows, original, schema, parentObject, childSchema]);

  // objectui#12082 — adding and removing a line are rows of the
  // affordance-to-grant map (`resolveAffordance` in `@object-ui/core`), asked
  // of the CHILD object: a new line is a child created under this parent
  // (`relatedNew`), a removed line a child deleted on Save (`relatedRowDelete`)
  // — the same two rows a related list reads for the same two writes. Each is
  // the child's policy, its effective operation set and the caller's grant on
  // it. They used to read `schema.readonly` alone, so a caller who may not
  // create or delete the child was offered both and Save sent a batch the
  // server refused. The policy half reads the child's own schema — the one
  // this panel already loads for the save's sanitize (`childSchema` above) —
  // as `RelatedRecordActionsBridge` hands a related list's child schema to the
  // same two rows; until it arrives it reads the default bucket. With no
  // permission provider mounted the grant and the operation set read open, as
  // before.
  const lineAddGranted = useMemo(
    () => resolveAffordance('relatedNew', { objectSchema: childSchema as SchemaLike | null, objectName: schema.childObject, perms }).allowed,
    [childSchema, schema.childObject, perms],
  );
  const lineRemoveGranted = useMemo(
    () => resolveAffordance('relatedRowDelete', { objectSchema: childSchema as SchemaLike | null, objectName: schema.childObject, perms }).allowed,
    [childSchema, schema.childObject, perms],
  );

  const gridField = useMemo(
    () =>
      ({
        // FLS gate, through the ONE render pass the record-form containers
        // share: a column the caller may not read is omitted, and one they may
        // read but not edit renders its cells locked — on the same page where
        // the surrounding form already disables that field (objectui#10163).
        // Adding and removing lines are the map rows above, on top of
        // `schema.readonly` below.
        //
        // Before that pass, a column the author left untyped (`{ name }`, or
        // `{ name, label }`) takes its `label`, `type` and `options` from the
        // child object's field, through the same `hydrateColumns` the
        // master-detail carriers call (objectui#12854). The child schema is
        // the one loaded above; the object-metadata endpoint serves it
        // translated into the session locale, so an identity-only column's
        // heading reads the child field's translated label, as a
        // master-detail grid's does. An authored `label` or `type` still wins,
        // and a column whose field the child does not declare is kept as
        // written. Until the schema arrives the columns render as authored.
        columns: applyColumnPermissions(hydrateColumns(schema.columns, childSchema ?? undefined, { booleanLabel }), {
          perms,
          objectName: schema.childObject,
        }),
        // The grid's `totalField` is the CHILD column summed (this block's
        // `amountField`), shown whenever one is named, exactly as
        // `MasterDetailForm` maps it. This block's own `totalField` is only
        // the PARENT field the sum is written to on save, so the two
        // same-named keys carry different values (objectui#11070 round 8).
        totalField: schema.amountField || (schema.totalField ? 'amount' : undefined),
        minRows: schema.minRows,
        maxRows: schema.maxRows,
        allowAdd: !schema.readonly && lineAddGranted,
        allowDelete: !schema.readonly && lineRemoveGranted,
        // Checked against the grid's published type (objectui#11610), so a key
        // the grid does not declare, or one of its retired snake_case
        // spellings, fails to compile here.
      } satisfies Partial<GridFieldMetadata>) as GridFieldMetadata,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `booleanLabel` keyed on its WORDS, see above
    [schema, childSchema, perms, lineAddGranted, lineRemoveGranted, booleanTrueWord, booleanFalseWord],
  );

  // The config hint names the property to set as code, and the property name
  // is never translated: the pack sentence carries a `{{property}}` hole, and
  // the hint renders the text on either side of it around the `<code>`.
  const [noChildObjectBefore, noChildObjectAfter] = t('form.lineItems.noChildObject', {
    property: '{{property}}',
  }).split('{{property}}');

  return (
    <Card className={cn('shadow-none')}>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium">{schema.title || t('form.lineItems.title')}</CardTitle>
        {!schema.readonly && (
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={saving || loading || !dirty || !parentId || heldForAnotherParent}
          >
            {saving ? t('detail.saving') : t('common.save')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {error && (
          <p className="mb-2 text-sm text-destructive">
            {'message' in error
              ? error.message
              : t(error.op === 'load' ? 'form.lineItems.loadFailed' : 'form.lineItems.saveFailed')}
          </p>
        )}
        {/* An unresolvable panel gets its OWN branch, ahead of `loading`
            (objectui#6194) — following objectui#5940's config-hint precedent for
            this exact key, and `AdvancedChartImpl`'s refusal placeholders
            ("This chart cannot plot its category axis: no row has a `x` field").
            Two things it must not do. It must not fall through to the grid: an
            empty EDITABLE grid with an Add button, over an object that does not
            exist, is a worse outcome than the unguarded fetch this card removes,
            and it is exactly what made the save path reachable. And it must not
            sit on `loading`, which would hide a permanent authoring error behind
            a spinner that can never end. Checked BEFORE `loading` because
            nothing here is pending — the schema itself already says this panel
            can never resolve, so there is no first paint where "Loading…" is
            true. */}
        {/* objectui#9050 step 2 — the authored `filter` did not lower, so this
            panel has no query it is allowed to send. Ahead of every branch
            below for the same reason the `childObject` branch is ahead of
            `loading`: nothing is pending, and falling through to an editable
            grid over rows that were never scoped is the worse outcome. It NAMES
            the operator, which is what separates this from the generic
            "Component failed to render" banner a `SchemaErrorBoundary` shows —
            and this panel can be mounted with no such boundary above it at
            all. */}
        {filterRefusal ? (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
            data-testid="line-items-malformed-filter"
          >
            {/* Separately addressable: this is the half that has to NAME the
                operator, and the technical line below repeats the token
                incidentally. */}
            <p className="font-medium" data-testid="line-items-malformed-filter-subject">
              {t('view.malformedFilter', { subject: filterRefusalSubject(filterRefusal) ?? '' })}
            </p>
            <p className="mt-1 text-xs opacity-80">{filterRefusal.message}</p>
          </div>
        ) : !schema.childObject ? (
          <p
            className="py-6 text-center text-sm text-muted-foreground"
            data-testid="line-items-no-child-object"
          >
            {noChildObjectBefore}
            <code className="font-mono">childObject</code>
            {noChildObjectAfter}
          </p>
        ) : loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : !parentId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('form.lineItems.saveRecordFirst')}
          </p>
        ) : heldForAnotherParent ? (
          /* The held rows were loaded for, or edited under, another parent
             (objectui#10740): this parent's load failed or declined. They are
             not drawn as this record's lines, editable or otherwise, and Save
             is off above. The banner above this branch carries the failure;
             a load for this parent that commits takes the grid back. */
          <p
            className="py-6 text-center text-sm text-muted-foreground"
            data-testid="line-items-held-for-another-parent"
          >
            {t('form.lineItems.notLoaded')}
          </p>
        ) : (
          <>
            <LineItemsField
              value={rows}
              onChange={onChange}
              field={gridField}
              readonly={schema.readonly}
              // No input while the save is in flight (objectui#10631): `save`
              // reloads the rows once the batch lands, so a line edited in the
              // meantime was overwritten by that reload and the panel read clean.
              // The same holds while an in-place re-read is in flight
              // (objectui#10814): its commit replaces the rows drawn here.
              disabled={saving || refreshing}
            />
            {rowCap && (
              <NonGridRowCeilingNote
                result={{ rows: Array.from({ length: rowCap.shown }), total: rowCap.total, truncated: true }}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
