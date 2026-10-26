/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useEffect, useState, useMemo } from 'react';
import type { DataSource, ObjectKanbanSchema, SortConfig } from '@object-ui/types';
import {
  useDataScope,
  useNavigationOverlay,
  useSafeFieldLabel,
  useSafeTranslate,
  extractWriteErrorMessage,
  isPermissionError,
  declaredUserMessage,
  useSettledSchema,
  useDataInvalidation,
  useFilterScope,
  useResolvedFilter,
  usePredicateScope,
} from '@object-ui/react';
import {
  NavigationOverlay,
  legacyRecordDrawerWidthKey,
  recordOverlayWidthStorageKey,
  toast,
  useOverlayAnchor,
} from '@object-ui/components';
import { createSafeTranslation } from '@object-ui/i18n';
import {
  RECORD_OVERLAY_DEFAULT_WIDTH,
  RecordDetailPanel,
  deriveRecordPageHref,
} from '@object-ui/plugin-detail';
import {
  extractRecords,
  buildExpandFields,
  convertSortToQueryParams,
  getRecordDisplayName,
  isEmptyValue,
  resolveNameField,
  resolveAffordance,
  isDeadlineSettled,
  type SchemaLike,
} from '@object-ui/core';
import { getBadgeColorClasses, getBadgeHexAppearance, getCellRenderer, resolveCellRendererType } from '@object-ui/fields';
import { usePermissions } from '@object-ui/permissions';
import { KANBAN_UNCOLUMNED_ID } from './index';
import { KanbanBoardCore } from './KanbanBoardCore';
import type { KanbanBoardProps } from './KanbanImpl';
import {
  collectRequiredWhenPromptFields,
  type RequiredWhenPromptField,
} from './requiredWhenPrompt';
import { RequiredFieldsDialog } from './RequiredFieldsDialog';
import { KanbanRecordsSettledContext } from './KanbanRecordsSettled';
import { KanbanColumnSummaryContext, type KanbanColumnSummary } from './KanbanColumnSummary';
import {
  KANBAN_LANE_PAGE_SIZE,
  KanbanLanePagingContext,
  laneQueryFilter,
  readLanePage,
  uncolumnedQueryFilter,
  type KanbanLanePage,
  type KanbanLanePaging,
  type KanbanLanePagingRequest,
} from './KanbanLanePaging';
import { resolveCardOwner, type KanbanCardOwner } from './KanbanCardOwner';

/**
 * English fallbacks for the record-detail drawer heading this board opens on
 * card click (objectui#3459, following #3426's shape).
 *
 * The two entries are borrowed from the `detail.*` namespace rather than minted
 * as `kanban.recordDetail`: `NavigationOverlay` and `ListView`/`ObjectGrid`
 * already resolve exactly these, and one heading on one control should not get
 * several translations that can drift apart. They must exist HERE too — a
 * provider-less host (a standalone board, this package's own tests) never
 * reaches the locale packs, and `createSafeTranslation`'s fallback interpolates
 * `{{label}}` from this map.
 *
 * `useSafeTranslate` (the `tt` used elsewhere in this file) cannot serve the
 * labelled branch: its `tt(key, fallback)` signature has no options argument,
 * so `{{label}}` would reach the DOM un-interpolated.
 */
const KANBAN_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'detail.recordDetail': 'Record Detail',
  'detail.recordDetailWithLabel': '{{label}} Detail',
};

/**
 * The board's FETCH BATCH: the `$top` of its one query when the author declared
 * no `limit`.
 *
 * A fetch batch, ⛔ not a page size (objectui#9853, ruling 5824040487,
 * structure B): the board has no pager, so this is how many records it asks
 * for at once, and rows past it are not reachable. Its value is kept, and it
 * does not follow the display page size the protocol declares for
 * `pagination.pageSize`, so no board silently loses reachable records when that
 * default moves. Before that ruling it was named `DEFAULT_KANBAN_LIMIT`.
 *
 * The number is the one this board has always intended: until objectui#4025 the
 * fetch passed `{ options: { $top: 100 } }`, and `options` is not a `QueryParams`
 * key — no adapter in this repo reads `params.options` (`convertQueryParams` in
 * `@object-ui/data-objectstack` and `ApiDataSource` both read `params.$top`), so
 * the cap never reached the wire and a board over a large object fetched whatever
 * the server chose to return, then grouped all of it into lanes client-side. The
 * window is now real, and authorable — same shape `object-timeline` took in
 * objectui#4009 for the identical defect.
 */
export const DEFAULT_KANBAN_FETCH_BATCH_SIZE = 100;

/**
 * What the contract admits as this board's `limit`, the fetch batch it asks for.
 *
 * `@objectstack/spec` has already answered what `limit: 0` means. The
 * `object-kanban` props declare the member a POSITIVE INTEGER
 * (`z.number().int().positive().optional()`, described there as the row cap
 * "lowered to the query's top-level `$top`"), and the element data source
 * `limit` that a `dataSource` binding lowers into this SAME key is declared
 * positive as well. So `0` is not a spelling whose meaning this renderer may
 * choose; it is a value the contract refuses, and a renderer that forwards it
 * to the wire is the only party not saying so.
 */
/**
 * What a card move's write answered, in the shape the board's `onCardMove`
 * reads (objectui#13054). Derived from the board's prop rather than restated,
 * so the two cannot drift.
 */
type KanbanCardMoveOutcome = Exclude<
  Awaited<ReturnType<NonNullable<KanbanBoardProps['onCardMove']>>>,
  void
>;
const MOVED: KanbanCardMoveOutcome = { kind: 'moved' };

function isUsableRowLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The ONE resolver for this board's fetch batch, for the reason objectui#9853 gave
 * when it landed the same shape on `ObjectGrid` and objectui#9897 repeated on
 * `ListView`: one resolver at every entry is what keeps the answer single.
 *
 * Before objectui#9925 this read was a bare `schema.limit ?? DEFAULT_KANBAN_LIMIT`
 * (the constant is `DEFAULT_KANBAN_FETCH_BATCH_SIZE` since objectui#9853),
 * and `??` rejects only `null` and `undefined` — so an authored `limit: 0` was
 * not nullish and survived as a real window. It reached the wire as `$top: 0`,
 * the board asked the server for nothing, and the empty board named no cause.
 * A negative goes out the same way. Both ENTRANCES converge on this key: a
 * `dataSource` binding lowers a view's `pagination.pageSize` into `schema.limit`
 * before this component sees it, and a board with no binding at all reads the
 * authored `limit` from the same place — so resolving HERE covers both, which a
 * repair at the lowering layer could not.
 *
 * ⚠️ The refusal is FAIL-SOFT on purpose. Throwing would take out the whole
 * board over one declaration, which is a worse outcome than the defect. The
 * value is dropped, this board's own default is used, and
 * `describeRefusedRowLimit` states it once through the channel this component
 * already uses for "you declared it, the renderer dropped it". ⛔ Not a silent
 * clamp: without the loud half this is a substitution the author cannot see,
 * and ⛔ not a clamp to 1 either — the author's number is not repaired, it is
 * refused, and the board falls back to the window it documents.
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
function describeRefusedRowLimit(authored: unknown, objectName: unknown): string | null {
  if (authored === undefined || authored === null) return null;
  if (isUsableRowLimit(authored)) return null;
  const where =
    typeof objectName === 'string' && objectName
      ? `object-kanban on ${objectName}`
      : 'object-kanban';
  return (
    `[ObjectUI] ObjectKanban fetch batch: ${where} declared limit: ${String(authored)}, `
    + 'which is not a positive integer. A fetch batch must be a positive integer '
    + '(the spec refuses zero and negative values), so it was ignored and this '
    + `board fell back to its default fetch batch (${DEFAULT_KANBAN_FETCH_BATCH_SIZE}).`
  );
}

/**
 * Safe wrapper for useObjectTranslation that falls back to the English defaults
 * above when no `I18nProvider` is mounted (standalone board, tests).
 * Delegates to `@object-ui/i18n`'s `createSafeTranslation`.
 */
const useKanbanTranslation = createSafeTranslation(
  KANBAN_DEFAULT_TRANSLATIONS,
  'detail.recordDetail',
);

/**
 * Minimal shape of the object definition this module reads. `objectDef` is
 * fetched via `dataSource.getObjectSchema` and is otherwise untyped here.
 */
interface CardFieldObjectDef {
  /** ADR-0085 semantic role: the object's curated "most important" fields. */
  highlightFields?: unknown;
  /** Declared fields, keyed by field name. */
  fields?: Record<string, unknown>;
}

/**
 * Resolve which record fields render on each kanban card, in priority order:
 *
 *   1. **View-level `cardFields`** — the fields the author configured for the
 *      view (`kanban.columns`, or the view's own columns), forwarded here as
 *      `schema.cardFields`. An explicit choice always wins.
 *   2. **The object's `highlightFields`** — the ADR-0085 semantic role: the
 *      curated "most important fields" list that Grid, List and Detail already
 *      default to. Used when the view declares no card fields, so a board over
 *      an object with no per-view config still surfaces meaningful fields
 *      instead of the legacy semantic-field guesswork. Filtered to fields the
 *      object actually declares so a stale highlight entry can't reference a
 *      dropped field.
 *   3. **`[]`** — neither is available; the caller falls back to its legacy
 *      semantic-field heuristic.
 *
 * Exported for unit testing; kept pure (no React) for that reason.
 */
export function resolveKanbanCardFields(
  cardFields: unknown,
  objectDef: CardFieldObjectDef | null | undefined,
): string[] {
  if (Array.isArray(cardFields) && cardFields.length > 0) {
    return cardFields as string[];
  }
  const highlight = objectDef?.highlightFields;
  if (Array.isArray(highlight)) {
    return (highlight as string[]).filter((n) => Boolean(objectDef?.fields?.[n]));
  }
  return [];
}

/**
 * The two spellings of the ONE card-title choice, as this board reads them off
 * a node. Structural on purpose: `resolveKanbanTitleField` below is exported
 * and pure so it can be judged against a bare object, and these two keys are
 * the whole of what it reads — it needs no node type to do that.
 *
 * ⛔ Do NOT restate here which published face declares which of the two keys.
 * This docblock did (objectui#8308, 2026-09-10), naming TWO declared arms and
 * an index-signature hop for `cardTitle`, and both halves were false inside
 * eight days: objectui#8802 left ONE arm nine hours later, and objectui#9606
 * declared `cardTitle` on that arm on 2026-09-17. The split is declared on
 * `ObjectKanbanSchema` in `@object-ui/types` and `tsc` already reads it — ask
 * the instrument, ⛔ never this comment (objectui#9726).
 */
interface KanbanTitleFieldSource {
  /** Canonical spelling: the record field rendered as the card title. */
  cardTitle?: string;
  /** Legacy spelling of the same choice, live on the `object-kanban` arm. */
  titleField?: string;
}

/**
 * Resolve WHICH RECORD FIELD titles a card, from the one authoring choice this
 * board spells two ways — `cardTitle` (canonical) and `titleField` (the legacy
 * alias). Returns `undefined` when the author named neither, which is the
 * caller's signal to fall through to the shared record-display resolver
 * (ADR-0079) rather than a field of its own.
 *
 * ## `''` MEANS UNSET (objectui#8308) — the one thing nothing used to say
 *
 * `cardTitle` names a record FIELD, and `''` cannot name any field, so an empty
 * string has no meaningful reading on either key: it can only be the residue of
 * an empty input — an authoring surface that writes a cleared text box back as
 * `''` instead of dropping the key, or a stored view whose kanban block
 * round-trips an unset value the same way. So `''` falls through exactly as an
 * absent key does, and `cardTitle` wins when it is NON-EMPTY. That extends the
 * precedence `index.tsx` already publishes in prose — "`cardTitle` wins when
 * both are authored" — to the single case that prose never covered, and it is
 * the ONLY reading under which the empty string is not silently taken for a
 * field name no record can have.
 *
 * ## Why this is a function and not two operators
 *
 * The two read sites — the card list's `effectiveData` memo and the
 * record-detail drawer's heading — used to spell this same fallback with two
 * DIFFERENT operators, `||` in one and `??` in the other. Those two differ on
 * exactly the falsy-but-present values, and on a string key that value is `''`,
 * so a board authored `{ cardTitle: '', titleField: 'name' }` titled its CARDS
 * from `name` while its DRAWER heading fell through to the `Record #<id>` floor:
 * one authored document, two answers to one question.
 *
 * Making the two operators agree would have repaired those two sites and left
 * the property that produced them — the pair is readable ad hoc, anywhere —
 * fully intact, so a third read site would invent a third precedence. Every
 * read of the pair goes through here instead; the source census in
 * `__tests__/ObjectKanban.titleFieldPrecedence-8308.test.tsx` reddens on a
 * property read of either key outside this function.
 *
 * Exported for unit testing and kept pure (no React), like
 * {@link resolveKanbanCardFields}.
 */
export function resolveKanbanTitleField(
  schema: KanbanTitleFieldSource | null | undefined,
): string | undefined {
  // Non-empty, not merely present — see the `''` ruling above. Deliberately a
  // truthiness test and not a `typeof === 'string'` narrowing: on a string key
  // the two agree, and narrowing here would ALSO start dropping off-contract
  // non-string values that both former operators passed through, which is a
  // change objectui#8308 did not rule on.
  if (schema?.cardTitle) return schema.cardTitle;
  if (schema?.titleField) return schema.titleField;
  return undefined;
}

/**
 * Props of the `ObjectKanban` React component.
 *
 * Renamed off the bare `ObjectKanbanProps` (objectui#4650): from 17.0.0
 * `@objectstack/spec/ui` owns that name, where it is the AUTHORED props
 * document of the `object-kanban` element — `z.input<typeof
 * ObjectKanbanPropsSchema>`, i.e. serialisable authoring keys only. This is the
 * RENDERER's props: a live `dataSource`, records pre-fetched by a parent, and
 * the host callbacks below, none of which can exist in authored metadata. Two
 * layers under one word, resolved the way this repo already resolved it for
 * `PageHeaderProps` -> `PageHeaderComponentProps` (app-shell) and the
 * `Record*ComponentProps` family in `@object-ui/types`.
 *
 * The barrel keeps `ObjectKanbanProps` as a deprecated alias of this type, so
 * no importer breaks. Tripwire: `__tests__/spec-symbol-4650.test.ts`.
 */
export interface ObjectKanbanComponentProps {
  /**
   * The board node — `ObjectKanbanSchema` (`type: 'object-kanban'`), the ONE
   * declared node type this component is now registered for.
   *
   * ## Why it is one arm again
   *
   * objectui#7322 item ② widened this to a two-arm union because `index.tsx`
   * registered ONE renderer under TWO keys with DIFFERENT declared node types,
   * so naming either alone made the prop lie about half the nodes the component
   * served. That note closed with a standing condition: *"⛔ Do not narrow this
   * back to one arm without first removing a registration."*
   *
   * ⇒ The registration WAS removed. objectui#8802 retired the bare `kanban`
   * node type key (maintainer ruling 2026-09-09) and `KanbanSchema` retired
   * with it, so the union's second arm no longer names anything the registry
   * dispatches here. The condition is met, and this is the narrowing it
   * authorised.
   *
   * ## What that costs, measured rather than waved past
   *
   * Nothing, for an `object-kanban` document. Such a node was never judged by
   * the `kanban` arm, so every key this component reads off `schema` that
   * `ObjectKanbanSchema` does not declare reached the renderer through
   * {@link BaseSchema}'s `[key: string]: any` BEFORE the retirement, and did
   * after it. ⇒ No `object-kanban` node changed meaning; what changed is that
   * `kanban` nodes no longer exist. Since objectui#8347 `BaseSchema` carries no
   * index signature, so a read of an undeclared key here no longer compiles;
   * the one key the gate writes that the node does not declare is typed at
   * {@link GateBoundKanbanSchema}.
   *
   * ⛔ WHICH keys those are is deliberately not listed here, and neither is
   * how many there are. This paragraph listed both (objectui#8802,
   * 2026-09-10) and the list was stale in hours: `filter` had been a declared
   * member for a day when the list put it on the index signature
   * (objectui#8174), `columns` joined it six hours after the list was written
   * (objectui#8913), and `cardTitle` a week after that (objectui#9606) —
   * leaving `swimlaneField` and `grouping` as the only two it still fits. A
   * source comment is the surface a changeset sentence gets copied FROM, so an
   * inventory here is a factory for the same rot one step downstream. Read the
   * split off `ObjectKanbanSchema`, which `tsc` already judges
   * (objectui#9726).
   *
   * `__tests__/object-kanban-component-props-7322.test.ts` derives the
   * registered key set from `index.tsx` off disk and goes red if the prop and
   * the registrations ever stop agreeing.
   */
  schema: ObjectKanbanSchema;
  dataSource?: DataSource;
  className?: string; // Allow override
  /** Pre-fetched records passed by a parent (e.g. ListView). When provided, skips internal data fetching. */
  data?: any[];
  /** Loading state propagated from a parent. Respected only when `data` is also provided. */
  loading?: boolean;
  /**
   * TWO parameters since objectui#9357, and the second is not decoration: this
   * prop reaches `useNavigationOverlay` as its `onRowClick`, and `handleClick`
   * invokes it as `onRowClick(record, event)` — the modifier payload a host
   * needs to implement Cmd/Ctrl/middle-click for itself. Declaring one
   * parameter hid the second on the ONE line a host reads. Spelled `any` and
   * not `HandleClickModifiers` for the reason objectui#9341 measured on
   * `ObjectKanbanSchema.onCardClick`: that interface lives in
   * `@object-ui/react`, the published twins in `@object-ui/types` may not name
   * it, and a host that discovered the payload from the implementation
   * annotated it `React.MouseEvent` — which a narrower declaration refuses
   * contravariantly. `BaseSchema`'s own `onClick` / `onChange` / `onSubmit`
   * already use this spelling for exactly this situation.
   */
  onRowClick?: (record: any, event?: any) => void;
  /**
   * ⚠️ TWO parameters, and the second one is not decoration: this prop is the
   * `onCardClick` arm of `externalClick` below, which is handed to
   * `useNavigationOverlay` as its `onRowClick` and invoked as
   * `onRowClick(record, event)` — the modifier payload a host needs for
   * Cmd/Ctrl/middle-click. Spelled `any` because `packages/types` declares the
   * published twin of this key and may not name `HandleClickModifiers` (it lives
   * in `@object-ui/react`, which depends on `@object-ui/types`), and the two
   * faces must not disagree. `KanbanImpl` types the same channel as
   * `React.MouseEvent`, which is what actually arrives.
   */
  onCardClick?: (record: any, event?: any) => void;
  /**
   * The host asks the board to query each LANE itself (objectui#12619): the
   * first {@link KANBAN_LANE_PAGE_SIZE} records of every lane, in the node's
   * `sort`, under the node's `filter`, with the lane's count and a "Load more"
   * at its foot. `ListView` passes it, with its toolbar search and its reload
   * signal, to the board it mounts instead of handing it one page of rows.
   *
   * A HOST channel, never an authoring key: the node's `limit` is the row cap
   * of the board's one query, and a board without this prop keeps that query.
   * A board whose lanes are not known before the query (no declared lanes and
   * no options on the lane field), or that draws swimlanes, keeps it too, with
   * the search and the reload signal applied to it.
   */
  lanePaging?: KanbanLanePagingRequest;
  /**
   * The record field holding the record's owner, when the host's object has
   * one. Each card shows the owner's avatar from the expanded record. The host
   * resolves it from the object's declared ownership (`ListView` reads the
   * spec's `resolveInjectedSystemColumns` and `SystemFieldName.OWNER_ID`), so
   * this board guesses no field name.
   */
  ownerField?: string;
}

/**
 * The board node as this component READS it: {@link ObjectKanbanSchema} plus
 * the two keys a relay writes onto it that the node does not declare — the
 * one `ElementDataSourceGate` writes (objectui#8347), and the one `ListView`'s
 * kanban branch writes (objectui#11629).
 *
 * `sort` is the gate's carrier for the per-element binding's `dataSource.sort`
 * (`OBJECT_KANBAN_DATA_SOURCE` in `./index.tsx` maps it, objectui#10068), and
 * the fetch lowers it onto `$orderby`. It is ⛔ not an authoring key: the
 * spec's `object-kanban` props declare no top-level `sort` and refuse one, so
 * neither `ObjectKanbanSchema` face declares it (objectui#8174, pinned by
 * `_KanbanSortStaysUndeclared` in `@object-ui/types`). While `BaseSchema`
 * carried `[key: string]: any` the read compiled as `any`; this type names it
 * where its only reader lives instead, the way `plugin-timeline`'s
 * `renderHandoff.ts` types the keys its composer writes (objectui#6356).
 *
 * `summarizeField` is the view's own key: `@objectstack/spec` declares it on
 * the view-level `KanbanConfig` ("Field to sum at top of column"), and
 * `ListView`'s kanban branch spreads the rest of that config onto the node it
 * generates, which is how it arrives here. The `object-kanban` props declare
 * no such key, so it is typed here for the same reason as `sort`.
 *
 * ⛔ Deliberately NOT exported, and ⛔ never to be added to
 * `ObjectKanbanComponentProps` or `@object-ui/types`: a public type naming
 * `sort` would invite the spelling the authoring faces refuse.
 */
type GateBoundKanbanSchema = ObjectKanbanSchema & {
  /** The binding's (or its view's) ordering, written by the gate. */
  sort?: SortConfig[];
  /** The view's `KanbanConfig.summarizeField`, relayed by `ListView` (objectui#11629). */
  summarizeField?: string;
};

export const ObjectKanban: React.FC<ObjectKanbanComponentProps> = ({
  schema: boardSchema,
  dataSource,
  className,
  data: externalData,
  loading: externalLoading,
  onRowClick,
  onCardClick,
  lanePaging,
  ownerField,
  ..._props
}) => {
  void _props;
  // Widened, not cast: the gate-written `sort` is optional, so the declared
  // node is assignable to the read type as it stands (see `GateBoundKanbanSchema`).
  const schema: GateBoundKanbanSchema = boardSchema;
  const { translateOptions, fieldLabel } = useSafeFieldLabel();
  const tt = useSafeTranslate();
  // Separate from `tt` because the record-detail heading interpolates a label —
  // see KANBAN_DEFAULT_TRANSLATIONS above.
  const { t } = useKanbanTranslation();
  // When a parent (e.g. ListView) pre-fetches data and passes it via the `data` prop,
  // we must not trigger a second fetch. Detect external data by checking if externalData
  // is an array (undefined when not provided by parent).
  const hasExternalData = Array.isArray(externalData);

  const [fetchedData, setFetchedData] = useState<any[]>([]);
  /**
   * Did the last fetch come back SATURATED — as many rows as the window
   * allowed (`5591f03bd`)?
   *
   * The fetch below is windowed at a real `$top` (objectui#4025). The board
   * then groups WHAT CAME BACK into lanes client-side, so every lane header
   * counts fetched rows that fell into that lane, not the size of the group.
   * Over any object with more rows than the window every one of those numbers
   * is wrong, they sum to the window, and nothing on screen says so — the
   * measured case on this card displayed 77 / 19 / 2 against a true
   * 88 / 46 / 28 / 14 / 9 / 15.
   *
   * This flag is what lets the header say `77+` instead of `77`. It is the
   * only truthful statement available without a second query: a per-lane
   * total needs a server-side group-count aggregate over the whole filtered
   * set (the card's option 1), which this board does not issue.
   *
   * SATURATION, not equality. The card suggests `rows.length === limit`;
   * `>=` is the predicate that cannot be talked into a false claim, because a
   * source that ignores `$top` and over-returns still yields a count that is
   * merely a LOWER BOUND as far as this component can tell. `<` the window is
   * the one case where the client knows the result set was exhausted, and
   * that is the case where the bare number is the truth.
   *
   * Held as STATE captured at fetch time rather than derived from
   * `fetchedData.length` at render: the optimistic move/create/delete paths
   * below rewrite `fetchedData`, and a delete would otherwise drop the array
   * to `window - 1` and silently retract the marker from a board that is
   * still showing a window.
   */
  const [fetchWindowSaturated, setFetchWindowSaturated] = useState(false);
  // The object-definition read and the fact that it has SETTLED are one piece
  // of state, keyed by the object it belongs to (objectui#6271) — now the
  // SHARED hook rather than this component's hand copy of it (objectui#7225,
  // maintainer ruling B, 2026-09-02, which amends #6482's "migrate
  // incidentally" to one convergence PR). `ready` is derived from a single
  // `{ key, def }` state at render time, so "ready for the wrong object" stays
  // unrepresentable; `useSettledSchema`'s own doc comment carries the full
  // argument, including why a bare `objectDef` cannot express "settled with
  // nothing".
  const schemaKey = schema.objectName ?? '';
  /**
   * Has the object definition for THIS object finished resolving? Note what
   * this is NOT: "`objectDef` is truthy". A board whose adapter exposes no
   * `getObjectSchema`, or whose schema read failed, must still get its cards —
   * gating on a truthy definition would leave those boards empty forever.
   */
  const { ready: objectDefReady, def: objectDef } = useSettledSchema<any>(schemaKey, dataSource);
  // loading state
  const [loading, setLoading] = useState(hasExternalData ? (externalLoading ?? false) : false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Resolve bound data if 'bind' property exists
  const boundData = useDataScope(schema.bind);

  // Permissions context, read here rather than inside the fetch effect below:
  // an effect's DEPENDENCY ARRAY is evaluated during render, so `perms` has to
  // be a binding that already exists by the time this component's render
  // reaches that effect (objectui#7429, same structural note PR #7229 /
  // PR #7428 recorded for `ListView`'s memo and `ObjectCalendar`'s effect).
  const perms = usePermissions();

  /**
   * Have the RECORDS this board is about to draw SETTLED? (objectui#8827)
   *
   * The full argument — the measured false "No cards", why a `loading` boolean
   * cannot express this, why the channel is a package-private context, and why
   * the default is `true` — lives on `KanbanRecordsSettledContext`. What lives
   * here is the half that is component-private, exactly as objectui#6482 split
   * `useSettledSchema`: the RESOLUTION shape is shared, deciding WHAT THIS
   * BOARD IS WAITING FOR is not.
   *
   * Shape copied from `useSettledSchema`, deliberately: ONE piece of state
   * carrying the key it settled for, with "settled" DERIVED at render by
   * comparing that key against the one this render is asking about. The
   * alternative — a `settled` boolean latched by the fetch effect — is
   * objectui#6481's defect verbatim: a one-way latch reads as settled for the
   * NEXT object while its query is still in flight. With one keyed value that
   * is unrepresentable, because the comparison flips in the very commit the key
   * changes, before any effect runs.
   *
   * The key is `schemaKey` — the SAME key the definition read is settled
   * against — so "settled for the wrong object" cannot be spelled on either
   * signal. It is deliberately NOT a digest of the whole query (filter, window,
   * `refreshKey`): those re-ASK the same question rather than asking a
   * different one, and a key recomputed from an object that a parent rebuilds
   * each render could churn, which would starve the settle and leave the board
   * empty forever — the one failure mode this must not have. A re-issue of the
   * same question keeps the previous answer on screen, which is the safe
   * direction.
   */
  const [recordsResolution, setRecordsResolution] = useState<{ key: string } | null>(null);

  /**
   * Is this board's OWN query what the records are waiting on?
   *
   * `false` means the records are settled BY CONSTRUCTION and no effect has to
   * remember to say so — which is how exits 3 and 4 of the settle contract are
   * held open structurally rather than by hand:
   *
   *   - external/bound/inline data (`rawData`'s first three sources below)
   *     arrive whole with the render, so they are settled from the first frame;
   *   - no `objectName`, no `dataSource`, or an adapter with no `find` is a
   *     board with NO READABLE SOURCE — settled with nothing, exactly as
   *     `useSettledSchema` settles when there is nothing to read from. Waiting
   *     on a query that will never be issued is the "empty forever" regression.
   *
   * The conditions are the same ones the fetch effect below branches on (its
   * `hasExternalData` guard, its `schema.objectName && !boundData &&
   * !schema.data` test, and `fetchData`'s own source guard). The effect ALSO
   * settles at each of its exits, so the two mechanisms are redundant on
   * purpose and redundant in the safe direction: it takes both of them failing
   * to strand a board.
   */
  const recordsComeFromFetch =
    !hasExternalData &&
    !boundData &&
    !schema.data &&
    !!schema.objectName &&
    !!dataSource &&
    typeof dataSource.find === 'function';

  const recordsSettled =
    !recordsComeFromFetch ||
    (recordsResolution !== null && recordsResolution.key === schemaKey);

  // P2: Auto-subscribe to DataSource mutation events (standalone mode only).
  // When rendered as a child of ListView, data is managed externally and this is skipped.
  useEffect(() => {
    if (hasExternalData) return; // Parent handles refresh
    if (!dataSource?.onMutation || !schema.objectName) return;
    const unsub = dataSource.onMutation((event: any) => {
      if (event.resource === schema.objectName) {
        setRefreshKey(k => k + 1);
      }
    });
    return unsub;
  }, [dataSource, schema.objectName, hasExternalData]);

  // Sync external data changes from parent (e.g. ListView re-fetches after filter change)
  useEffect(() => {
    if (hasExternalData && externalLoading !== undefined) {
      setLoading(externalLoading);
    }
  }, [externalLoading, hasExternalData]);

  // [objectui#9925] The loud half of the row-cap refusal, on the channel this
  // component already uses for "you declared it, the renderer dropped it".
  // Keyed on the DECLARATION, so it is one warning per declaration rather than
  // one per render — and it fires from an effect, never from render, so a
  // re-render with the same authored value says nothing a second time.
  useEffect(() => {
    const message = describeRefusedRowLimit(schema.limit, schema.objectName);
    if (message) console.warn(message);
  }, [schema.limit, schema.objectName]);

  // Content key for the fetch's `$orderby` input (objectui#10068): an inline or
  // gate-rebuilt `sort` array is a new object on every render, so the fetch
  // below re-keys on what it says, never on which array it is.
  const sortKey = JSON.stringify(schema.sort ?? null);

  // objectui#10666 — the node's own `filter`, with every context token
  // (`{current_user_id}`, `{current_org_id}`, the date macros) resolved ONCE
  // through `@object-ui/core`'s shared `resolveFilterPlaceholders`, against the
  // session scope the host provides, and HELD by structure (`useResolvedFilter`
  // in `@object-ui/react`). A directly authored board sent the literal token on
  // `$filter` before. The fetch below and its dependency list read THIS, never
  // the raw `schema.filter`, so a re-render that rebuilds an equal filter does
  // not re-query.
  const filterScope = useFilterScope();
  const queryFilter = useResolvedFilter(schema.filter, filterScope);

  // objectui#10572 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10494 way: the nonce moves when a
  // write to the object this board QUERIES is declared, and the fetch effect
  // below names it, so the cards are re-read in place. The `onMutation`
  // subscription above cannot see a write that bypasses the data source (a
  // page action over raw HTTP); the bus can. Subscribed only when the board
  // fetches for itself — external, bound or inline cards are the host's.
  const invalidationNonce = useDataInvalidation(
    !hasExternalData && !boundData && !schema.data ? schema.objectName || undefined : undefined,
  );

  // objectui#12619 — the host's query inputs (`lanePaging`), keyed on CONTENT:
  // a host rebuilds the request object on every render (AGENTS.md #10). The
  // search pair rides on whichever query this board issues, exactly as the
  // host's own fetch sends it (`$search`, with `$searchFields` only beside a
  // term).
  const lanePagingAsked = lanePaging !== undefined;
  const hostSearchKey = JSON.stringify(
    lanePaging?.search
      ? {
          $search: lanePaging.search,
          ...(lanePaging.searchFields && lanePaging.searchFields.length > 0
            ? { $searchFields: [...lanePaging.searchFields] }
            : {}),
        }
      : {},
  );
  const hostReloadKey = lanePagingAsked ? String(lanePaging?.reloadKey ?? '') : '';

  /**
   * The lanes this board pages, when it pages them (objectui#12619): known
   * BEFORE the query, so each can be asked as one. The declared lanes, else the
   * lane field's options — the two sources `effectiveColumns` draws lanes from
   * first. `null` keeps the board's one query: no host request, no lane field,
   * swimlanes (each lane is cut by a second field), or lanes only the data
   * would name. A string, so the fetch effect re-keys on the lane values and
   * never on an array a parent rebuilds.
   */
  const pagedLaneIdsKey = useMemo((): string | null => {
    if (!lanePagingAsked || !schema.groupBy) return null;
    if (schema.swimlaneField || schema.grouping?.fields?.[0]?.field) return null;
    const usable = (id: unknown) => id !== undefined && id !== null && id !== '';
    const declared =
      Array.isArray(schema.columns) && schema.columns.length > 0 && typeof schema.columns[0] === 'object'
        ? (schema.columns as Array<{ id?: unknown }>).map((col) => col?.id).filter(usable)
        : [];
    const options = objectDef?.fields?.[schema.groupBy]?.options;
    const ids = declared.length > 0
      ? declared
      : Array.isArray(options)
        ? options.map((opt: { value?: unknown }) => opt?.value).filter(usable)
        : [];
    return ids.length > 0 ? JSON.stringify(ids) : null;
  }, [lanePagingAsked, schema.groupBy, schema.swimlaneField, schema.grouping, schema.columns, objectDef]);

  /** Each paged lane's state; `null` on a board that issues one query. */
  const [lanePages, setLanePages] = useState<Record<string, KanbanLanePage> | null>(null);
  // Read by the fetch effect (the depth a refresh asks each lane to) and by
  // "Load more", neither of which may re-run on every page that lands.
  const lanePagesRef = React.useRef(lanePages);
  lanePagesRef.current = lanePages;
  /**
   * The lane queries the cards on screen answer: the question they were asked
   * under, their shared params and each lane's filter. "Load more" asks the
   * next page of the SAME query; a page answering an older one is dropped
   * (`generation`).
   */
  const laneQueryRef = React.useRef<{
    generation: number;
    question: string;
    objectName: string;
    params: Record<string, unknown>;
    filters: Record<string, unknown>;
  } | null>(null);
  const laneGenerationRef = React.useRef(0);
  const queryFilterKey = JSON.stringify(queryFilter ?? null);
  // What the lanes answer. A refresh asks the same question and keeps the depth
  // each lane was loaded to; any other change starts every lane over.
  const laneQuestion = JSON.stringify([schemaKey, schema.groupBy ?? null, pagedLaneIdsKey, queryFilterKey, sortKey, hostSearchKey]);

  useEffect(() => {
    // Skip internal fetch when data is managed by a parent component
    if (hasExternalData) return;

    // ⭐ objectui#6271 — the object definition GATES this query; it does not
    // refine it afterwards. Before this line the effect ran twice on every
    // mount: once with `objectDef` still unresolved (so `buildExpandFields`
    // saw no fields and the query carried NO `$expand` at all), then again
    // once the definition landed. Measured on the standalone board, the first
    // response never even reached the screen in the regimes that matter — the
    // definition settles first, the effect re-runs, its cleanup flips
    // `isMounted` false, and the unexpanded rows are dropped on arrival. So
    // that round trip bought no earlier paint; it was a query whose answer was
    // thrown away.
    //
    // What the gate costs is one schema resolution before the first query, and
    // that is the measurement this was decided on: a metadata read is one small
    // GET behind the same shared discovery call `find` already awaits, and it
    // is served from `MetadataCache` (5-min TTL, concurrent readers coalesced
    // onto one request) for every reader after the first — 0.01ms, no request.
    // Anything hosting this board (ObjectView, ListView) has already read the
    // same definition through the same adapter, so the gate is free there.
    if (!objectDefReady) return;

    let isMounted = true;
    /**
     * objectui#8827 — record the fact that a read for THIS object has SETTLED,
     * whatever it settled to. Idempotent, so the redundant call at the exit
     * below cannot cost a render once the key is already recorded.
     */
    const settleRecords = () => {
        if (!isMounted) return;
        setRecordsResolution((prev) =>
            prev !== null && prev.key === schemaKey ? prev : { key: schemaKey },
        );
    };
    const fetchData = async () => {
        if (!dataSource || typeof dataSource.find !== 'function' || !schema.objectName) {
            // Exit 3 — NO READABLE SOURCE. Already settled structurally by
            // `recordsComeFromFetch` above; settled here too so that a future
            // edit which tightens this guard without touching that predicate
            // cannot silently strand the board (objectui#8827).
            settleRecords();
            return;
        }
        if (isMounted) setLoading(true);
        try {
            // Auto-inject $expand for lookup/master_detail fields. Reached only
            // with the definition resolved (the gate above), so a board whose
            // object declares lookups queries WITH its expansion the first
            // time — `objectDef` here is `null` only when there was nothing to
            // resolve it from.
            //
            // [objectui#7429] FIELD-LEVEL SECURITY ON `$expand` — the same gate
            // objectui#7215 / PR #7229 put on the two projection sites in its
            // scope, and objectui#7230 / PR #7428 applied unchanged at four more.
            // `$select` on a denied lookup asks the server for a bare foreign
            // key; `$expand` asks it to RESOLVE the relation and return the
            // related record, the larger of the two requests.
            //
            // THIS SITE PASSES NO COLUMN LIST, which makes it the sharp one:
            // `buildExpandFields` reads an absent column list as "no column
            // restriction" and falls back to EVERY declared relation on the
            // object, denied ones included. A standalone board therefore asks
            // for the maximum possible set by default, not by configuration.
            //
            // Graded as objectui#7215 graded it, by measurement rather than
            // assumption: against ObjectStack this is defence-in-depth, because
            // `plugin-security`'s `FieldMasker.maskRecord` does
            // `delete result[field]` on every unreadable key and objectql's
            // expand path writes the resolved record back under THAT SAME KEY, so
            // one statement removes the expanded object and the bare id alike;
            // the expansion sub-read itself takes the referenced object's full
            // CRUD + RLS + FLS treatment (objectstack#7626). It is load-bearing
            // for a backend that does not strip.
            //
            // THE GATE IS ON THE HELPER'S OUTPUT, and on this site the
            // alternative is not merely unsound but unreachable: the call passes
            // `undefined`, so there is no input to gate. Gating the output also
            // gives the required ordering structurally: `buildExpandFields`
            // returns a subset of the object's DECLARED reference-bearing fields,
            // so every name judged here is declared by construction and the
            // "`checkField` answers false for an undeclared key" trap cannot be
            // reached. Pinned in `__tests__/ObjectKanban.expandFls-7429.test.tsx`.
            //
            // Deferral matches every other gate on this path: an unanswered
            // policy filters nothing, and `perms` is in this effect's dependency
            // list, so the expansion is rebuilt the moment the answer arrives.
            const expandable = buildExpandFields(objectDef?.fields);
            const expand = !perms?.isLoaded
              ? expandable
              : expandable.filter((f) => perms.checkField(schema.objectName as string, f, 'read'));
            // objectui#12619 — the host's search pair, on whichever query
            // this board issues (`{}` without a host or a term).
            const hostSearch = JSON.parse(hostSearchKey) as Record<string, unknown>;

            // objectui#12619 — LANE PAGING. One query per lane (the node's
            // filter AND the lane value), plus one for the records in no lane,
            // each asking its first page and the lane's count. See
            // `KanbanLanePaging.ts`.
            if (pagedLaneIdsKey !== null && schema.groupBy) {
                const objectName = schema.objectName;
                const groupBy = schema.groupBy;
                const laneIds = JSON.parse(pagedLaneIdsKey) as unknown[];
                const generation = ++laneGenerationRef.current;
                // A refresh of the same question asks each lane to the depth
                // the viewer loaded it to, so "Load more" is not undone by a
                // drag or a toolbar refresh.
                const held = laneQueryRef.current?.question === laneQuestion ? lanePagesRef.current : null;
                const params: Record<string, unknown> = {
                    $orderby: convertSortToQueryParams(schema.sort),
                    ...(expand.length > 0 ? { $expand: expand } : {}),
                    ...hostSearch,
                    // The lane's count is the point of the query, so ask for it.
                    $count: true,
                };
                const lanes = [
                    ...laneIds.map((id) => ({ key: String(id), filter: laneQueryFilter(queryFilter, groupBy, id) })),
                    { key: KANBAN_UNCOLUMNED_ID, filter: uncolumnedQueryFilter(queryFilter, groupBy, laneIds) },
                ];
                const answers = await Promise.all(lanes.map(async (lane) => {
                    const loaded = held?.[lane.key]?.loaded ?? 0;
                    const depth = Math.max(KANBAN_LANE_PAGE_SIZE, Math.ceil(loaded / KANBAN_LANE_PAGE_SIZE) * KANBAN_LANE_PAGE_SIZE);
                    const result = await dataSource.find(objectName, { ...params, $filter: lane.filter, $top: depth } as any);
                    return { lane, ...readLanePage(result, 0, depth) };
                }));
                if (!isMounted || generation !== laneGenerationRef.current) return;
                const seen = new Set<string>();
                const rows: any[] = [];
                const pages: Record<string, KanbanLanePage> = {};
                for (const answer of answers) {
                    pages[answer.lane.key] = answer.page;
                    for (const row of answer.rows) {
                        const id = String(row?.id ?? row?._id);
                        if (seen.has(id)) continue;
                        seen.add(id);
                        rows.push(row);
                    }
                }
                laneQueryRef.current = {
                    generation,
                    question: laneQuestion,
                    objectName,
                    params,
                    filters: Object.fromEntries(lanes.map((lane) => [lane.key, lane.filter])),
                };
                lanePagesRef.current = pages;
                setFetchedData(rows);
                setLanePages(pages);
                // Every lane carries its own count, so no header is a window's.
                setFetchWindowSaturated(false);
                setError(null);
                return;
            }
            laneQueryRef.current = null;
            setLanePages(null);
            // The row cap is a REAL `$top` (objectui#4025). It used to be
            // `{ options: { $top: 100 } }` — `$filter` at the top level where the
            // adapters read it, the cap one level down under a key that is not a
            // `QueryParams` field and that nothing in this repo reads. The number
            // is unchanged; it just reaches the wire now, and `limit` (authored,
            // or a bound view's `pagination.pageSize`) can set it.
            //
            // The query is a NAMED OBJECT rather than an inline literal so that
            // the saturation reading below (`5591f03bd`) compares the row
            // count against `query.$top` — the very number this request
            // carried. One spelling of the window, read back from the request
            // itself: a second `resolveRowLimit(schema.limit, …)` kept in a
            // local for the comparison could drift from the one on the wire,
            // and a marker computed against a window the server was never asked
            // for is exactly the silent wrongness `5591f03bd` fixed. That
            // reasoning is why objectui#9925's refusal was put INSIDE this
            // named object rather than beside it: the resolver runs once, and
            // the saturation reading keeps reading the number that left.
            // Keeping it inline here also keeps this read where objectui#7322
            // pins it off disk (`object-kanban-group-by-limit-7322.test.ts`):
            // that pin reads the `$top` expression out of THIS named object, so
            // the refusal landing inside it moved the SPELLING and not the
            // read. objectui#9925 re-pointed the pin's `READ_TEXT` entry to the
            // expression below; the pinned fact — `schema.limit` lowered into
            // the query's top-level `$top` — is the same one it always held.
            const query = {
                $filter: queryFilter,
                // objectui#10068 — the binding's `dataSource.sort` (or its
                // view's), delivered here by `ElementDataSourceGate`. Lanes
                // bucket records in fetch order, so this is also the in-lane
                // order. Absent → `undefined`, the query is unchanged.
                $orderby: convertSortToQueryParams(schema.sort),
                $top: resolveRowLimit(schema.limit, DEFAULT_KANBAN_FETCH_BATCH_SIZE),
                ...(expand.length > 0 ? { $expand: expand } : {}),
                ...hostSearch,
            };
            const results = await dataSource.find(schema.objectName, query);
            
            // Handle { value: [] } OData shape or { data: [] } shape or direct array
            const data = extractRecords(results);

            if (isMounted) {
                setFetchedData(data);
                // `5591f03bd` — see `fetchWindowSaturated`. Recorded HERE,
                // against the window THIS request carried, because that is the
                // only point where the two numbers are both in hand.
                setFetchWindowSaturated(data.length >= query.$top);
                // objectui#10663 — `error` is an early return in the render, so
                // a report nothing clears kept the board off screen until a
                // remount, and since objectui#10572 one failed data-invalidation
                // re-read was enough to get there. It is cleared HERE, when the
                // current run commits cards: those cards answer the current
                // query, so no earlier failure describes the screen any more
                // (objectui#10578's rule on `ObjectGantt`). `isMounted` is this
                // run's own flag, false once a newer run has started, so a
                // superseded run's clear is discarded with its answer. ⛔ Not
                // when a run starts: until cards land, the report stays.
                setError(null);
            }
        } catch (e) {
            console.error('[ObjectKanban] Fetch error:', e);
            if (isMounted) setError(e as Error);
        } finally {
            if (isMounted) setLoading(false);
            // Exits 1 and 2 — the fetch SUCCEEDING and the fetch THROWING, in
            // one place so neither can be added to without the other
            // (objectui#8827). A read that resolved to nothing is a settled
            // answer; a read that threw is a settled answer too. Only a board
            // still waiting for one is allowed to withhold its empty state.
            settleRecords();
        }
    };

    // Trigger fetch if we have an objectName AND verify no inline/bound data overrides it
    if (schema.objectName && !boundData && !schema.data) {
        fetchData();
    }
    return () => { isMounted = false; };
    // `objectDefReady` is what re-runs this effect once the definition lands;
    // `objectDef` stays listed because the body reads it, and with the gate in
    // place the two flip together in one commit — the pre-resolution run now
    // returns above without querying instead of issuing an unexpanded one.
    // `schema.sort` is tracked by CONTENT (`sortKey`), not identity — the
    // `ObjectTimeline` spelling: an array rebuilt with the same members must not
    // refetch the board.
    // objectui#12619 — `pagedLaneIdsKey`, `laneQuestion`, `hostSearchKey` and
    // `hostReloadKey` are strings: the lanes, what they answer, the host's
    // search pair and the host's refresh signal, each compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `schema.sort` is tracked by CONTENT (sortKey) on purpose; see above
  }, [schema.objectName, schemaKey, dataSource, boundData, schema.data, queryFilter, sortKey, schema.limit, hasExternalData, objectDefReady, objectDef, refreshKey, perms, invalidationNonce, pagedLaneIdsKey, laneQuestion, hostSearchKey, hostReloadKey]);

  /**
   * objectui#12619 — the next page of one lane, under the query the lane's
   * cards answer (`laneQueryRef`). Appended to the cards, never replacing them;
   * a page that lands after the lanes were asked again is dropped.
   */
  const loadMoreLane = React.useCallback((laneId: string) => {
    const held = laneQueryRef.current;
    const page = lanePagesRef.current?.[laneId];
    const filter = held?.filters[laneId];
    if (!held || !page || !page.hasMore || page.loading || filter === undefined) return;
    if (!dataSource || typeof dataSource.find !== 'function') return;
    const { generation } = held;
    const setPage = (next: KanbanLanePage) =>
      setLanePages((prev) => (prev ? { ...prev, [laneId]: next } : prev));
    setPage({ ...page, loading: true });
    dataSource
      .find(held.objectName, { ...held.params, $filter: filter, $top: KANBAN_LANE_PAGE_SIZE, $skip: page.loaded } as any)
      .then((result) => {
        if (laneQueryRef.current?.generation !== generation) return;
        const next = readLanePage(result, page.loaded, KANBAN_LANE_PAGE_SIZE);
        setFetchedData((prev) => {
          const seen = new Set(prev.map((row) => String(row?.id ?? row?._id)));
          return [...prev, ...next.rows.filter((row) => !seen.has(String(row?.id ?? row?._id)))];
        });
        setPage(next.page);
      })
      .catch((err) => {
        if (laneQueryRef.current?.generation !== generation) return;
        console.error('[ObjectKanban] Load more failed:', err);
        // The lane keeps what it holds, and its "Load more" stays to retry.
        setPage({ ...page, loading: false });
      });
  }, [dataSource]);

  const lanePagingChannel = useMemo<KanbanLanePaging | null>(
    () => (lanePages ? { pages: lanePages, loadMore: loadMoreLane } : null),
    [lanePages, loadMoreLane],
  );

  // Determine which data to use: external -> bound -> inline -> fetched
  const rawData = (hasExternalData ? externalData : undefined) || boundData || schema.data || fetchedData;

  /**
   * Are the lane counts about to be drawn counts of a WINDOW (`5591f03bd`)?
   *
   * Only when the rows on screen are the ones this component fetched. External,
   * bound and inline data arrive whole from whoever owns them; this board
   * applied no window to them and has nothing truthful to say about whether
   * someone else did, so those boards keep the bare number. The identity
   * comparison is deliberate — it asks the exact question `rawData`'s own
   * precedence chain just answered, so the two can never disagree.
   */
  const countsAreWindowed = fetchWindowSaturated && rawData === fetchedData;

  /**
   * objectui#12619 — may the viewer read the owner field the host named, and
   * which object is the person on it? A field the policy denies draws no
   * avatar (an unanswered policy defers, as `$expand` does above). The person's
   * object is the field's `reference`, and `sys_user` when it names none: the
   * object the grid's user cell reads a person's fields against.
   */
  const ownerReadable =
    !!ownerField &&
    !(perms?.isLoaded && schema.objectName && !perms.checkField(schema.objectName, ownerField, 'read'));
  const ownerReference = ownerField ? objectDef?.fields?.[ownerField]?.reference : undefined;
  const ownerPersonObject = typeof ownerReference === 'string' && ownerReference ? ownerReference : 'sys_user';

  // Enhance data with title mapping and ensure IDs
  // The host predicate scope a card's declared deadline is judged in
  // (objectui#11815).
  const predicateScope = usePredicateScope();
  const effectiveData = useMemo(() => {
    if (!Array.isArray(rawData)) return [];

    // The author's card-title choice — `cardTitle`, else the legacy
    // `titleField`, and `''` on either counts as unset. Resolved by the shared
    // `resolveKanbanTitleField` so this site and the detail drawer's heading
    // below cannot answer one authored document two ways (objectui#8308).
    const explicitTitleField: string | undefined = resolveKanbanTitleField(schema);

    // Title is resolved per-item below via:
    //   1. the explicit title field (`resolveKanbanTitleField`), if it
    //      yields a non-empty value for the record;
    //   2-4. otherwise the unified `@object-ui/core#getRecordDisplayName`
    //      (ADR-0079): objectDef.titleFormat → objectDef.displayNameField →
    //      type-aware field derivation → `Record #<id>` floor.
    //
    // ListView used to default titleField to the literal "name" for objects
    // that had none, which made the explicit-only path resolve to undefined for
    // every record and bypassed any objectDef-derived inference. The shared
    // resolver removes that footgun.
    // `nameFieldKey` is retained: it still feeds the description-field skip set
    // below so the title field's raw value isn't repeated in the card body.
    //
    // ⭐ It reads the SHARED name-space resolver, not a key of its own
    // (objectui#8400). This line used to be `objectDef?.NAME_FIELD_KEY`, and
    // that key is produced by NOTHING: `@objectstack/spec@17`'s object schema
    // declares `nameField` (canonical, ADR-0079) and `displayNameField` (its
    // deprecated alias), and `NAME_FIELD_KEY` appears nowhere in the framework
    // tree — this repo reads it only as the last rung of `declaredNameField`,
    // for objects old enough to have been written against it. So the read was
    // always `undefined`, the skip set collapsed to the five literals below,
    // and every object whose name field is spelled anything else printed its
    // title twice: once as the card heading, once as the first body row. That
    // spelling is the NORM for AI-built apps (`visit_title`, `owner_name`,
    // `<entity>_name`), which is why the duplicate was invisible on hand-built
    // objects whose name field is literally `name`.
    //
    // `resolveNameField` is the name-space twin of the `getRecordDisplayName`
    // call that resolves the heading a few lines below, so the two now agree
    // about WHICH field titles this object — declared `nameField` /
    // `displayNameField` / `NAME_FIELD_KEY`, else the type-aware derivation.
    //
    // ⚠️ Deliberately ONE rung, unlike the same dedupe in `record-details.tsx`
    // (objectui#8175), which lists `resolveNameField()` AND `deriveTitleField()`
    // so a declared-but-blank pointer still dedupes against the derivation the
    // header fell through to. The surfaces differ in what the skip set is
    // allowed to hide: that one filters a SYNTHESIZED field list, this one
    // filters an AUTHOR-DECLARED `cardFields`. Carrying the derivation
    // alongside a declared pointer would drop a field the author explicitly
    // asked for whenever the two disagree (`nameField: 'code'` titles the card
    // while the derivation answers `owner_name`) — on a four-field card that is
    // a worse failure than a repeated title. Pinned by the over-skip guard in
    // `__tests__/ObjectKanban.nameFieldSkipSet-8400.test.tsx`, which goes RED
    // if the second rung is ever added here.
    const nameFieldKey: string | undefined = resolveNameField(objectDef);

    return rawData.map(item => {
      let resolvedTitle: any = undefined;

      // 1. The explicit title field (`resolveKanbanTitleField`).
      if (explicitTitleField) {
        resolvedTitle = item[explicitTitleField];
        if (typeof resolvedTitle === 'string') resolvedTitle = resolvedTitle.trim();
      }

      // 2-4. Unified object-level resolver (ADR-0079): titleFormat →
      //   objectDef.displayNameField → type-aware field derivation. Replaces the
      //   old per-view chain (template render → NAME_FIELD_KEY → hard-coded
      //   name list) so a board over an object whose name lives in e.g.
      //   `activity_name` shows the real name instead of "Untitled".
      if (!resolvedTitle) {
        const unified = getRecordDisplayName(objectDef, item);
        const id = item.id ?? item._id;
        const isFloor =
          unified === 'Untitled' ||
          (id !== null && id !== undefined && unified === `Record #${id}`);
        if (!isFloor) resolvedTitle = unified;
      }

      // Derive a short description and badges from common semantic fields so
      // mobile cards aren't a wall of bare titles. Only emit when not already
      // set by the schema/source.
      const fmtMoney = (n: number) => {
        if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
        if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
        return `$${n}`;
      };
      // Detect strings that look like opaque foreign-key IDs so we don't dump
      // gibberish into card descriptions when the server didn't expand the lookup.
      //
      // ⭐ WHY THIS IS STILL HERE, given objectui#6271 (read this before
      // deleting it). Part of what this suppression used to hide was THIS
      // component's own fetch ordering: the board issued its first query before
      // the object definition resolved, so that query carried no `$expand` and
      // the first paint was rendered from raw lookup ids. That half is gone —
      // the record query is now gated on the definition (see the fetch effect
      // above), so the board's own rows arrive expanded or not at all.
      //
      // The suppression is NOT thereby redundant, because unexpanded rows still
      // reach this function from sources the gate does not sit in front of:
      //
      //   1. `data` handed down by a parent. Measured, not assumed: ObjectView
      //      hosts the board this way and its own query goes out as
      //      `{ $top: 100 }` — it reads the schema through a ref that is still
      //      empty on the one run it makes, so it never injects `$expand` at
      //      all. Every card in that path is built from raw ids.
      //   2. `bind` / inline `schema.data` — author-supplied rows, expanded by
      //      nobody.
      //   3. An adapter or backend that ignores `$expand`, or a single lookup
      //      it cannot resolve (a dangling reference), which comes back as the
      //      bare id inside an otherwise expanded row.
      //
      // So the coupling the two issues share is real and stays recorded: the
      // display heuristic and the fetch ordering move together. What changed is
      // the JUSTIFICATION, not the code — this predicate is now a guard against
      // genuinely unexpanded DATA, no longer a cover for a query this component
      // issued too early.
      const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{12,32}$/;
      const isOpaqueId = (v: unknown): boolean => {
        if (typeof v !== 'string') return false;
        if (!OPAQUE_ID_RE.test(v)) return false;
        const hasUpper = /[A-Z]/.test(v);
        const hasLower = /[a-z]/.test(v);
        const hasDigitOrSep = /[0-9_-]/.test(v);
        return (hasUpper && hasLower) || (hasUpper && hasDigitOrSep) || (hasLower && hasDigitOrSep);
      };
      // Pull a human-readable display string from a field. Prefers expanded
      // record's `.name`, skips raw FK IDs, and skips lookup-typed fields whose
      // value didn't get expanded (so we never show "8UY9zHWBfjYjYor4").
      const resolveDisplay = (key: string): string | undefined => {
        const raw = (item as any)[key];
        // THE FLOOR by name (objectui#8496). `[]` is a member and used to reach
        // the object branch below, which walked six name-ish keys over zero
        // entries and returned `undefined` anyway — the same answer, spelled
        // twice.
        if (isEmptyValue(raw)) return undefined;
        if (typeof raw === 'object') {
          const obj = raw as Record<string, unknown>;
          const candidates = ['name', 'full_name', 'display_name', 'label', 'title', 'username'];
          for (const c of candidates) {
            const v = obj[c];
            if (typeof v === 'string' && v.trim()) return v.trim();
          }
          return undefined;
        }
        if (typeof raw !== 'string') return String(raw);
        // Suppression here is a rule about the VALUE, not about the field's
        // declared type: an id-shaped string is gibberish in a card
        // description whatever `objectDef` calls the column — and `objectDef`
        // is optional at this read, so a type gate would suppress nothing on
        // exactly the boards whose schema is thin or absent. The same
        // predicate is applied with no type gate to the incoming
        // `description` further down this function.
        //
        // A relation-typed guard stood immediately above this line
        // (`isExpandableFieldType(def) && isOpaqueId(raw)`, over the same
        // `def = objectDef?.fields?.[key]`) and was unreachable: same `raw`,
        // same predicate, and `OPAQUE_ID_RE` carries no `g`/`y` flag, so
        // repeated `.test()` on it is stateless. Whenever it returned, the
        // line below returned too — computed, branched on, discarded
        // (objectui#6063). Removing it also removed this path's read of
        // `@object-ui/core`'s `EXPANDABLE_FIELD_TYPES`; the file's live read
        // of that family is `buildExpandFields` (imported above), which is
        // where objectui#5874's identity pin now sits.
        //
        // Pinned by `__tests__/resolveDisplay.opaqueId-6063.test.tsx`: its
        // first two cases go RED if this is ever re-gated on the field type.
        if (isOpaqueId(raw)) return undefined;
        return raw;
      };

      const descParts: string[] = [];
      // Which fields to render on each card: view-level `cardFields` when the
      // author configured them, otherwise the object's `highlightFields`
      // semantic role (ADR-0085); `[]` drops to the legacy heuristic below.
      // (See `resolveKanbanCardFields` for the full priority contract.)
      const explicitCardFields: string[] = resolveKanbanCardFields(
        schema.cardFields,
        objectDef,
      );
      // The field used as the card title is implicit (resolved above). Don't
      // repeat its raw value in the description if the user already sees it.
      const titleFieldsToSkip = new Set<string>([
        ...(explicitTitleField ? [explicitTitleField] : []),
        ...(nameFieldKey ? [nameFieldKey] : []),
        'name',
        'full_name',
        'title',
        'subject',
        'display_name',
      ]);

      const cardBadges: Array<{
        label: string;
        variant?: any;
        colorClass?: string;
        colorStyle?: React.CSSProperties;
      }> = [];
      const cardFieldCells: Array<{ field: string; label?: string; node: React.ReactNode }> = [];

      if (explicitCardFields.length > 0) {
        // Render the user-specified card fields. Picklists with configured
        // colors become Badges (compact, scannable); everything else flows
        // through the unified `@object-ui/fields` cell-renderer pipeline so
        // lookup / user / email / url / phone / boolean / image / formula /
        // currency / date / number fields keep the same semantic styling
        // as the Grid and Gallery views (links, icons, formatted values).
        for (const f of explicitCardFields) {
          if (titleFieldsToSkip.has(f)) continue;
          const def = objectDef?.fields?.[f];
          const raw = (item as any)[f];
          // THE FLOOR by name (objectui#8496), no extension: a card field with
          // nothing in it is OMITTED, so this asks the floor and nothing more.
          // ⚠️ `[]` is a MEMBER and used to fall through here — into the
          // picklist branch, where it resolved to no label and drew a fully
          // coloured pill with no children in it until objectui#8489 caught it
          // one step later. That guard STAYS: it also answers every non-array
          // value that resolves to nothing, which the floor says nothing about.
          // ⛔ Do NOT trim — `'   '` is deliberately a value on this surface.
          if (isEmptyValue(raw)) continue;
          const isPicklist =
            def?.type === 'picklist' ||
            def?.type === 'multipicklist' ||
            (Array.isArray(def?.options) && def!.options.length > 0);
          if (isPicklist) {
            const opt = def?.options?.find((o: any) =>
              String(o.value).toLowerCase() === String(raw).toLowerCase()
            );
            const rawLabel = opt?.label || String(raw);
            const objectKey = objectDef?.name || schema.objectName;
            const translatedLabel = objectKey
              ? translateOptions(objectKey, f, [{ value: String(opt?.value ?? raw), label: rawLabel }])[0]?.label
                  ?? rawLabel
              : rawLabel;
            // Resolved exactly as the grid cell resolves it
            // (`SelectCellRenderer` in `@object-ui/fields`): a declared hex
            // renders as declared (objectui#5141/#5183), a family name keeps
            // going through `getBadgeColorClasses`. `colorStyle` carries the
            // CSS custom properties the hex className reads and travels with
            // the badge to the renderer — the class alone is not a colour.
            const hexBadge = getBadgeHexAppearance(opt?.color);
            const colorClass = hexBadge
              ? hexBadge.className
              : getBadgeColorClasses(opt?.color, raw);
            // objectui#8489 — decline to draw a badge with no label in it.
            // The loop's own `raw == null || raw === ''` guard lets an empty
            // array through, and this branch never reaches `getCellRenderer`,
            // so objectui#8481's rule for the shared renderers ("an empty
            // array is not a cell value") cannot help it: with nothing to
            // resolve, the label came out as the empty string and the card
            // drew a fully styled, fully coloured pill with no children in it.
            //
            // Deliberately NOT an emptiness judgement about the VALUE — the
            // kanban needs none. By this point the only question left is
            // whether there is a label to draw, and asking exactly that also
            // covers every non-array value resolving to nothing; the empty
            // array is simply the shape that is easy to hit.
            //
            // Compared against the empty string, NOT for falsiness: `'0'` is a
            // legitimately authored option label and has to keep rendering.
            if (translatedLabel === '') continue;
            cardBadges.push({ label: translatedLabel, colorClass, colorStyle: hexBadge?.style });
          } else {
            // Route through the same registry that Grid/Gallery use so
            // every field type renders with its canonical widget.
            const fieldType = resolveCellRendererType(def ?? { type: 'text' });
            const CellRenderer = getCellRenderer(fieldType);
            const fieldForCell: any = def ?? { name: f, type: fieldType };
            const node = (
              <CellRenderer
                value={raw}
                field={fieldForCell}
                deadlineSettled={isDeadlineSettled(def, item, { scope: predicateScope, fields: objectDef?.fields })}
              />
            );
            cardFieldCells.push({
              field: f,
              label: fieldLabel(objectDef?.name || schema.objectName || '', f, def?.label || f),
              node,
            });
          }
        }
      } else {
        // Legacy semantic-field heuristic (no view config provided).
        const moneyField = ['amount', 'value', 'deal_value', 'expected_value', 'opportunity_value']
          .find(k => typeof item[k] === 'number');
        if (moneyField) descParts.push(fmtMoney(item[moneyField] as number));
        const orgKeys = ['company', 'company_name', 'account', 'account_name', 'organization'];
        let orgDisplay: string | undefined;
        for (const k of orgKeys) {
          const d = resolveDisplay(k);
          if (d) { orgDisplay = d; break; }
        }
        if (orgDisplay && (!resolvedTitle || !String(resolvedTitle).includes(orgDisplay))) {
          descParts.push(orgDisplay);
        }
        const ownerKeys = ['owner', 'owner_name', 'assignee', 'assignee_name'];
        let ownerDisplay: string | undefined;
        for (const k of ownerKeys) {
          const d = resolveDisplay(k);
          if (d) { ownerDisplay = d; break; }
        }
        if (ownerDisplay) descParts.push(`@${ownerDisplay}`);

        const badgeFields = ['priority', 'severity', 'industry', 'rating'];
        for (const f of badgeFields) {
          const v = item[f];
          if (v != null && v !== '') {
            const fieldDef = objectDef?.fields?.[f];
            const option = fieldDef?.options?.find((o: any) =>
              String(o.value).toLowerCase() === String(v).toLowerCase()
            );
            const label = option?.label || String(v);
            // Same hex-first resolution as the explicit-card-fields branch
            // above (objectui#5141/#5183); see the comment there for why the
            // style has to travel with the class.
            const hexBadge = getBadgeHexAppearance(option?.color);
            const colorClass = hexBadge
              ? hexBadge.className
              : getBadgeColorClasses(option?.color, v);
            // objectui#8489, on the reasoning spelled out at the explicit
            // branch above: this heuristic resolves its label exactly the same
            // way, so `[]` — or any value stringifying to nothing — reached the
            // push with an empty label and drew the same empty pill. Skipping
            // the push rather than breaking keeps the remaining badge fields
            // eligible: an unlabelled one must not consume a badge slot.
            if (label === '') continue;
            cardBadges.push({ label, colorClass, colorStyle: hexBadge?.style });
            if (cardBadges.length >= 2) break;
          }
        }
      }

      // Treat raw-ID-shaped description as missing so we synthesize a real one
      // from semantic fields below (avoids "8UY9zHWBfjYjYor4" appearing as subtitle).
      const incomingDesc = (item as any).description;
      const descMissing =
        // THE FLOOR by name (objectui#8496) — `[]` is a member, and a card
        // subtitle has no more to draw for it than for `null`.
        isEmptyValue(incomingDesc) ||
        // THE EXTENSION: an id-shaped string is gibberish as a subtitle, the
        // same rule about the VALUE that `resolveDisplay` applies above.
        (typeof incomingDesc === 'string' && isOpaqueId(incomingDesc));

      // P2-4: keep the original record's `description` field intact so the
      // detail drawer / edit form show the real value (or empty placeholder
      // when null). Synthesized text goes to a separate `cardSubtitle`
      // property that KanbanImpl renders in preference to description.
      const synthesizedSubtitle =
        descMissing && descParts.length > 0 ? descParts.join(' · ') : undefined;

      // objectui#12619 — the owner's avatar, off the owner field the host
      // named (`ownerField`), as the viewer may read it.
      const cardOwner: KanbanCardOwner | undefined = ownerReadable && ownerField
        ? resolveCardOwner((item as any)[ownerField], perms, ownerPersonObject)
        : undefined;

      return {
        ...item,
        // Ensure id exists
        id: item.id || item._id,
        // Map title. When neither the explicit field nor the unified resolver
        // produced a name, fall back to the resolver's floor (`Record #<id>`,
        // or 'Untitled' only for a truly id-less record) — ADR-0079.
        title: resolvedTitle || getRecordDisplayName(objectDef, item),
        ...(synthesizedSubtitle ? { cardSubtitle: synthesizedSubtitle } : {}),
        ...(cardFieldCells.length > 0 ? { cardFieldCells } : {}),
        ...(!Array.isArray(item.badges) && cardBadges.length > 0
          ? { badges: cardBadges }
          : {}),
        ...(cardOwner ? { cardOwner } : {}),
      };
    });
  }, [rawData, schema, objectDef, ownerField, ownerReadable, ownerPersonObject, perms, predicateScope]);

  // Generate columns if missing but groupBy is present
  const effectiveColumns = useMemo(() => {
    // Localize the column title against the groupBy picklist's option labels
    // so kanban swim-lanes pick up i18n overrides even when the view config
    // provides explicit `columns: [{ id, title }]` instead of leaving the
    // renderer to materialize them from `field.options`. Without this the
    // title flows straight from server-side picklist labels (English) into
    // the DOM regardless of locale.
    const localizeColumn = (col: { id: any; title: string }) => {
      if (!schema.objectName || !schema.groupBy) return col;
      const localized = translateOptions(schema.objectName, schema.groupBy, [
        { value: String(col.id), label: col.title },
      ])[0];
      return localized?.label ? { ...col, title: localized.label } : col;
    };

    // If columns exist, returns them (normalized)
    if (schema.columns && schema.columns.length > 0) {
        // If columns is array of strings, normalize to objects
        if (typeof schema.columns[0] === 'string') {
             // If grouping is active, assume string columns are meant for data display, not lanes
             if (!schema.groupBy) {
                 return (schema.columns as unknown as string[]).map(val => ({
                     id: val,
                     title: val
                 }));
             }
        } else {
             return (schema.columns as Array<{ id: any; title: string }>).map(localizeColumn);
        }
    }

    // Try to get options from metadata
    if (schema.groupBy && objectDef?.fields?.[schema.groupBy]?.options) {
        const rawOptions = objectDef.fields[schema.groupBy].options.map((opt: any) => ({
            value: opt.value,
            label: opt.label,
        }));
        const localized = schema.objectName
          ? translateOptions(schema.objectName, schema.groupBy, rawOptions)
          : rawOptions;
        return localized.map((opt: any) => ({
            id: opt.value,
            title: opt.label,
        }));
    }

    // If no columns, but we have groupBy and data, generate from data
    if (schema.groupBy && effectiveData.length > 0) {
        const groups = new Set(effectiveData.map(item => item[schema.groupBy!]));
        return Array.from(groups).map(g => ({
            id: String(g),
            title: String(g)
        }));
    }

    return [];
  }, [schema.columns, schema.groupBy, schema.objectName, effectiveData, objectDef, translateOptions]);

  /**
   * objectui#11629 — the lane total each column header paints, from the
   * view's `summarizeField`. `KanbanImpl` sums the field over the lane's cards
   * (`sumLaneField`); this decides only WHETHER there is a total and HOW it is
   * written, because this component holds the object definition.
   *
   * - Written through the field's own cell renderer — the call the card
   *   fields above make — so the total reads the way the cards read that
   *   field. A field the definition does not describe renders as a number.
   * - No total for a field the viewer may not read: the projection never
   *   asked for it, so every card lacks it and the lane would read `0`. Same
   *   `checkField` gate and same deferral as `$expand` above.
   * - No total for a field the loaded definition does not declare, for the
   *   same reason: `ListView`'s projection drops a binding the object lacks.
   *
   * What it covers is what the board drew: the lane's loaded cards. A windowed
   * fetch marks the total as it marks the count (`countsAreWindowed`).
   */
  const summarizeField =
    typeof schema.summarizeField === 'string' && schema.summarizeField !== ''
      ? schema.summarizeField
      : undefined;
  const columnSummary = useMemo<KanbanColumnSummary | null>(() => {
    // Until the definition settles the board does not yet know how the cards
    // format the field, or whether the object has it; it paints no total
    // rather than one it would repaint (a currency total first read as a bare
    // number). A source with no schema read settles with nothing at once.
    if (!summarizeField || !objectDefReady) return null;
    const def = objectDef?.fields?.[summarizeField];
    if (objectDef?.fields && !def) return null;
    if (
      def &&
      perms?.isLoaded &&
      schema.objectName &&
      !perms.checkField(schema.objectName, summarizeField, 'read')
    ) {
      return null;
    }
    const fieldType = resolveCellRendererType(def ?? { type: 'number' });
    const CellRenderer = getCellRenderer(fieldType);
    const fieldForCell = def ?? { name: summarizeField, type: fieldType };
    return {
      field: summarizeField,
      label: fieldLabel(objectDef?.name || schema.objectName || '', summarizeField, def?.label || summarizeField),
      renderTotal: (total: number) => <CellRenderer value={total} field={fieldForCell} />,
    };
  }, [summarizeField, objectDefReady, objectDef, schema.objectName, perms, fieldLabel]);

  // Clone schema to inject data and className
  // Use grouping.fields[0].field as swimlaneField fallback when no explicit swimlaneField
  const effectiveSwimlaneField = schema.swimlaneField
    || (schema.grouping?.fields?.[0]?.field);

  const effectiveSchema = {
      ...schema,
      data: effectiveData,
      columns: effectiveColumns,
      className: className || schema.className,
      ...(effectiveSwimlaneField ? { swimlaneField: effectiveSwimlaneField } : {}),
      // ⛔ No Quick Add pair rides this schema to the board. objectui#8285
      // (ruling B, decision batch #91) retired `quickAdd` here and used to
      // write `quickAdd: undefined` on this line. objectui#11234 retired
      // `onQuickAdd` as well and moved the cut to the board itself: the
      // `KanbanBoardCore` this component renders takes the pair ONLY as
      // explicit props and reads neither key off `schema`, and nothing below
      // passes either prop. So an untyped value that rides the spread above
      // reaches no read. Every `object-kanban` entry point lands here — the
      // registered tag, the `kanbanComponents` map and a host mounting this
      // component. The pair still works on `KanbanRenderer`, which a React
      // host mounts directly.
  };

  // Default to a right-side drawer so clicking a card opens an editable detail
  // panel inline. A schema can override this with its own `navigation` config.
  //
  // No width is spelled here on purpose (objectui#6303, converging kanban on
  // the shape #6305 gave ObjectGantt). `width` is `@deprecated [objectstack-ai/objectstack#2578 -> size]`
  // in the spec that owns this shape, and `resolveOverlayWidth` gives an
  // explicit `width` priority OVER `size` — so spelling it kept the deprecated
  // branch load-bearing on the path most boards take (no declared
  // `navigation`), and made the size buckets unreachable there. Omitting both
  // leaves `resolveOverlayWidth` returning `undefined`, which is what
  // RecordDetailDrawer's own `width` default is for; that default is the
  // identical `min(960px, 60vw)`, so this is a zero-pixel change on every
  // viewport. The absent width is deliberate, not an oversight — do not
  // "restore" it. Pinned by `ObjectKanban.navWidthDefault.test.tsx`, both
  // halves, because the equivalence now depends on the drawer's default too.
  //
  // Deliberately NOT converged on `size: 'lg'` either: that bucket is
  // `min(92vw, 960px)`, which agrees with the above only at viewport >= 1600px
  // and is up to 53% wider below it. That move is a real behaviour change, and
  // it was RULED AGAINST: objectui#6584, 2026-08-27 — stays on the CSS
  // literal; no bucket convergence. All four surfaces (gantt, kanban,
  // calendar, RecordDetailDrawer) keep today's pixels. The question is
  // CLOSED, not open — do not re-open it as a cleanup. If bucket-vocabulary
  // unification ever becomes a product direction that is a fresh ruling,
  // with visual-regression evidence across all four surfaces in one stroke.
  // `navigation` is DECLARED on `ObjectKanbanSchema` since objectui#8652 — the
  // maintainer ruled B there (declare it on the platform element schema first,
  // then mirror), and `@objectstack/spec` 17.5.0's `object-kanban` element
  // entry is that first half. Until then this read rode `BaseSchema`'s
  // `[key: string]: any` on every `object-kanban` document: the only face that
  // had ever declared the key was the retired `kanban` arm's `KanbanSchema`
  // (objectui#7742, gone with objectui#8802), and it only ever judged `kanban`
  // documents. The registration `inputs` publish it too (`OBJECT_KANBAN_INPUTS`,
  // `index.tsx`). The `{ mode: 'drawer' }` fallback is this renderer's own
  // default for an ABSENT key, documented on the declaration rather than
  // declared. The members this read honours are pinned in
  // `__tests__/kanbanNavigationMembers-8652.test.tsx`.
  const navConfig = schema.navigation ?? { mode: 'drawer' };
  // When this kanban is embedded in an ObjectView, the parent provides
  // `onRowClick`/`onCardClick` and owns the unified record-detail overlay.
  // We must always forward to the parent in that case — otherwise we'd open
  // a second, plugin-local drawer alongside the parent's, creating the
  // "two styles of detail view" inconsistency users complained about.
  const externalClick = onRowClick ?? onCardClick;
  const navIsOverlay = !externalClick && (navConfig.mode === 'drawer' || navConfig.mode === 'modal' || navConfig.mode === 'split' || navConfig.mode === 'popover');
  const navigation = useNavigationOverlay({
    navigation: navConfig,
    objectName: schema.objectName,
    onRowClick: externalClick,
  });

  // objectui#9299 item 3 — `popover` anchors to the CARD the user clicked.
  // `SortableCard` already hands its click event down, so this site captures
  // the anchor directly rather than through a container-level listener.
  const { anchorRef, captureAnchor } = useOverlayAnchor();

  // Fallback heading of the record-detail drawer opened on card click, used
  // when the board declares no card-title field (or the record's is empty).
  //
  // Keyed, not string-built (objectui#3459, same shape as #3426). The value is
  // handed to `RecordDetailDrawer`'s required `title` prop, which renders it as
  // the drawer's `SheetTitle`. That heading is `sr-only` — DetailView's own
  // HeaderHighlight draws the visible one — so this string IS the drawer's
  // accessible name to a screen reader, and it was the one English phrase left
  // in an otherwise fully localized zh/ja/de drawer.
  //
  // English output of the first branch is byte-identical (`Tasks Detail`),
  // including with no `I18nProvider` mounted.
  //
  // The second branch is currently UNREACHABLE and deliberately has no test:
  // it fires only when `schema.objectName` is falsy, but the drawer below bails
  // on the very same condition (`if (!objectName || recordId == null) return
  // null`), so nothing renders. It is keyed anyway rather than left as a
  // literal — `'Card Details'` would be an English leak the day that guard
  // relaxes, and reusing `detail.recordDetail` (the key NavigationOverlay
  // itself defaults to) costs nothing and normalizes the stray plural.
  const detailTitle = schema.objectName
    ? t('detail.recordDetailWithLabel', {
        label: schema.objectName.charAt(0).toUpperCase() + schema.objectName.slice(1).replace(/_/g, ' '),
      })
    : t('detail.recordDetail');

  // Persist cross-column drags by writing the new column id back to the
  // record's `groupBy` field. Local state is updated optimistically so the
  // card stays in the target column even after KanbanImpl's reset effect
  // re-syncs from props; the backend update reconciles asynchronously and
  // is reverted with a warning if it fails.
  //
  // `extraValues` carries the fields a `requiredWhen` prompt collected
  // (objectui#4254), so the column value and everything the move makes
  // required go out as ONE PATCH — two writes would leave the record in the
  // state the engine refuses if the second one failed. With no prompt the
  // spread is empty and the body is exactly what it has always been.
  //
  // It reports what the write answered (objectui#13054), so the board can say
  // it to a screen reader once it is known rather than at the drop: `moved`,
  // or `refused` with the very sentence the toast below shows — computed once
  // and used for both, so the two channels cannot say different things.
  const persistCardMove = React.useCallback(
    async (
      cardId: string,
      fromColumnId: string,
      toColumnId: string,
      extraValues?: Record<string, unknown>,
    ): Promise<KanbanCardMoveOutcome> => {
      const groupBy = schema.groupBy;
      const objectName = schema.objectName;
      if (!groupBy) return MOVED;

      // Optimistic local update so the card visibly stays in the new column.
      // Skipped when data is owned by a parent (ListView): `fetchedData` is not
      // what renders on that path (`rawData` prefers `externalData`, :219), and
      // writing it anyway would re-render us and re-bucket from the unchanged
      // `externalData` — snapping the card back before the server has answered.
      // The board's own `boardColumns` already shows the move there. The
      // failure revert below is deliberately NOT gated — see the note on it.
      if (!hasExternalData) {
        setFetchedData((prev) =>
          prev.map((r) =>
            String(r.id ?? r._id) === String(cardId)
              ? { ...r, [groupBy]: toColumnId }
              : r,
          ),
        );
      }

      if (!objectName || !dataSource?.update) return MOVED;
      try {
        await dataSource.update(objectName, String(cardId), {
          [groupBy]: toColumnId,
          ...(extraValues ?? {}),
        });
        // Land the prompt-collected values locally too, so a card that shows
        // one of them as a `cardFields` cell reflects what was just written
        // instead of waiting for a refetch. Only ever runs on the prompt path
        // — a normal move takes no extra keys and so takes no extra state.
        if (extraValues && !hasExternalData) {
          setFetchedData((prev) =>
            prev.map((r) =>
              String(r.id ?? r._id) === String(cardId) ? { ...r, ...extraValues } : r,
            ),
          );
        }
        return MOVED;
      } catch (err) {
        console.warn('[ObjectKanban] Failed to persist card move', err);
        // Surface the failure — never silently snap the card back. A row-level
        // security denial (403) is the common case: the user lacks permission
        // to change this record's status. (cloud#864)
        // …unless the AUTHOR opted in. `userMessage` (objectstack `79c46da90`) is the
        // producer-side marking: a field set at throw time to say "this text is
        // for the end user". It is a SEPARATE field from `message`, so nothing
        // unmarked can reach here — the substitution below still governs every
        // platform diagnostic and objectstack-ai/objectstack#3821 holds by construction rather than by us
        // guessing what a body contains. Status-agnostic on purpose: 403 is
        // where this was reported (objectui#5210/#5902), not a fence the
        // contract draws — a marked 409 or 400 renders identically.
        const refusal =
          declaredUserMessage(err) ??
          (isPermissionError(err)
            ? tt('errors.unauthorized', 'You are not authorized to perform this action.')
            : extractWriteErrorMessage(err) ?? tt('table.saveFailed', 'Save failed'));
        toast.error(refusal);
        // Roll the optimistic move back, on BOTH data ownerships (#4138).
        //
        // The optimistic move is the kanban's own local display state, so
        // un-saying it on rejection is the kanban's job regardless of who owns
        // the records. This used to be gated on `!hasExternalData` in the
        // belief that the parent handles the refresh (:147); a parent does
        // re-render on its own refetch, but a REJECTED move changes nothing
        // server-side, so nothing ever triggers that refetch and the card sat
        // in the target column until a manual reload.
        //
        // ONE unconditional call covers both paths, because the card's
        // on-screen position lives in `KanbanImpl`'s `boardColumns` rather than
        // here: its `handleDragEnd` moves the card there before calling us, and
        // an effect re-syncs `boardColumns` from the `columns` prop whenever
        // that prop's identity changes — which every re-render of this
        // component causes (`KanbanBoardCore` re-buckets into a fresh array).
        //   - internal data: `fetchedData` is the source of truth, so the map
        //     below both corrects the record and re-renders.
        //   - external data: `fetchedData` is unread and normally empty, but
        //     `Array#map` always allocates, so the fresh identity re-renders us
        //     and the board re-buckets from `externalData` — which the server
        //     never changed. That IS the revert: the card returns to
        //     `fromColumnId`, and an accepted move is left alone because this
        //     runs only on the failure branch.
        setFetchedData((prev) =>
          prev.map((r) =>
            String(r.id ?? r._id) === String(cardId)
              ? { ...r, [groupBy]: fromColumnId }
              : r,
          ),
        );
        return { kind: 'refused', message: refusal };
      }
    },
    [schema.groupBy, schema.objectName, dataSource, hasExternalData, tt],
  );

  /**
   * The drop that is waiting on required fields (objectui#4254). Non-null only
   * while the collect dialog is open; the move has NOT been PATCHed yet.
   */
  const [pendingMove, setPendingMove] = useState<{
    cardId: string;
    fromColumnId: string;
    toColumnId: string;
    fields: RequiredWhenPromptField[];
  } | null>(null);
  const [pendingSubmitting, setPendingSubmitting] = useState(false);

  // objectui#12082 — the card move is the `kanbanCardMove` row of the
  // affordance-to-grant map (`resolveAffordance` in `@object-ui/core`): the
  // object's policy, the effective operation set and the caller's update grant.
  // A closed row draws the cards as not movable and hands the board no mover,
  // so no drop can reach `persistCardMove`. It used to read no grant at all: a
  // read-only caller could drag a card, watch it land, and get the server's
  // refusal and a rollback. With no permission provider mounted the grant
  // reads open, as before.
  const cardMoveGranted = resolveAffordance('kanbanCardMove', {
    objectSchema: objectDef as SchemaLike | null,
    objectName: schema.objectName,
    perms,
  }).allowed;

  // Pre-evaluate the target column's `requiredWhen` predicates and collect what
  // the move makes required BEFORE writing anything (objectui#4254). The board
  // used to PATCH the column value alone into a refusal the user could neither
  // read nor act on; with no prompted field this is inert and the move takes
  // the unchanged path below.
  const handleCardMove = React.useCallback(
    async (
      cardId: string,
      fromColumnId: string,
      toColumnId: string,
      _newIndex: number,
    ): Promise<KanbanCardMoveOutcome> => {
      void _newIndex;
      const groupBy = schema.groupBy;
      // The early returns below write nothing and refuse nothing: the board
      // keeps announcing them as moved, as it always did (objectui#13054).
      if (!groupBy || fromColumnId === toColumnId) return MOVED;
      // #2792: the "Uncategorized" lane is a display bucket, not a real option.
      // Dragging a card OUT of it into a real column repairs the record's
      // status (handled below); dropping one IN would write the sentinel id as
      // a bogus status, so refuse to persist that direction.
      if (toColumnId === KANBAN_UNCOLUMNED_ID) return MOVED;

      // The record as stored, not the card-shaped projection: `effectiveData`
      // overlays a derived `title`/`badges`, and the predicates must see the
      // record's own field values.
      const record = (Array.isArray(rawData) ? rawData : []).find(
        (r) => String(r?.id ?? r?._id) === String(cardId),
      );
      const fields = collectRequiredWhenPromptFields(
        objectDef?.fields,
        record,
        groupBy,
        toColumnId,
      );
      if (fields.length > 0) {
        // No optimistic write and no PATCH: the card sits in its source column
        // behind the modal until the user commits, so Cancel needs no rollback
        // and a refusal that never happens cannot need one either.
        setPendingMove({ cardId, fromColumnId, toColumnId, fields });
        // Nothing was written yet: the board announces nothing at settle. The
        // dialog, and the toast of the write it submits, speak for this move.
        return { kind: 'deferred' };
      }

      return persistCardMove(cardId, fromColumnId, toColumnId);
    },
    [schema.groupBy, rawData, objectDef, persistCardMove],
  );

  // Label + localized options for each prompted field, resolved with the same
  // helpers the cards use so the dialog names a field exactly as the board does.
  const pendingFields = useMemo(() => {
    if (!pendingMove) return [];
    const objectKey = objectDef?.name || schema.objectName || '';
    return pendingMove.fields.map((f) => {
      const options = f.def.options;
      const localized =
        objectKey && Array.isArray(options)
          ? translateOptions(objectKey, f.name, options)
          : options;
      const declaredLabel = typeof f.def.label === 'string' ? f.def.label : '';
      return {
        ...f,
        def: { ...f.def, ...(localized ? { options: localized } : {}) },
        label: fieldLabel(objectKey, f.name, declaredLabel || f.name),
      };
    });
  }, [pendingMove, objectDef, schema.objectName, translateOptions, fieldLabel]);

  // Error branch renders only after every hook above has run, so hook order
  // stays stable across renders (no early return before the hooks).
  if (error) {
    return (
      <div className="p-4 border border-destructive/50 rounded bg-destructive/10 text-destructive">
        Error loading kanban data: {error.message}
      </div>
    );
  }

  /**
   * The record overlay — ONE payload in whichever shell the author declared.
   *
   * ⭐ objectui#9299. This used to be `<RecordDetailDrawer>`, which brought its
   * own `Sheet` and had no `mode` parameter, so an authored `modal`, `split` or
   * `popover` silently rendered the drawer (measured on PR objectui#9296). The
   * payload now mounts through the shared `NavigationOverlay` — the same shell
   * `ObjectGrid` and `ObjectTree` use — so the four declared modes mean the
   * same thing on every view type.
   *
   * `mainContent` is what `split` needs: the board itself goes in the left
   * panel beside the record panel (item 2). `popoverAnchorRef` is what
   * `popover` needs: the card the user clicked (item 3).
   */
  const renderRecordOverlay = (mainContent?: React.ReactNode): React.ReactNode => {
    if (!navigation.isOverlay || !navigation.isOpen || !navigation.selectedRecord) return null;
    const objectName = schema.objectName;
    const rec = navigation.selectedRecord as Record<string, any>;
    const recordId = rec.id ?? rec._id;
    if (!objectName || recordId == null) return null;
    // Same resolver as the card list's `explicitTitleField` above — one
    // read of the pair, one precedence (objectui#8308). This site used to
    // spell the fallback `??`, which kept an authored `''` and dropped this
    // heading to the `Record #<id>` floor on a board whose cards were
    // titled from `titleField`.
    const titleField = resolveKanbanTitleField(schema);
    const titleText = titleField && rec[titleField]
      ? String(rec[titleField])
      : detailTitle;
    return (
      <NavigationOverlay
        {...navigation}
        title={titleText}
        mainContent={mainContent}
        popoverAnchorRef={anchorRef}
        // One drag-resize implementation, one key, and a width the user had
        // already chosen under the retired `objectui.drawerWidth.OBJECT`
        // carries over rather than resetting (item 4).
        storageKey={recordOverlayWidthStorageKey(objectName)}
        legacyStorageKey={legacyRecordDrawerWidthKey(objectName)}
        // ⛔ Not `navigation.width` alone: an unauthored width has to land on
        // the ruled default (objectui#6584 / #6303) rather than on the shell's
        // own `42rem` floor, which would narrow this surface.
        width={navigation.width ?? RECORD_OVERLAY_DEFAULT_WIDTH}
      >
        {() => (
          <div className="px-6 pt-6 pb-6">
            <RecordDetailPanel
              record={rec}
              objectName={objectName}
              recordId={recordId}
              dataSource={dataSource}
              objectSchema={objectDef as any}
              onClose={navigation.close}
              fullPageHref={deriveRecordPageHref(objectName, recordId) ?? undefined}
              onFieldSave={async (field, value) => {
                if (!dataSource?.update) return;
                await dataSource.update(objectName, String(recordId), { [field]: value });
                setFetchedData((prev) => prev.map((r) =>
                  String(r.id ?? r._id) === String(recordId)
                    ? { ...r, [field]: value }
                    : r,
                ));
              }}
              onDelete={async () => {
                if (!dataSource?.delete) return;
                await dataSource.delete(objectName, String(recordId));
                setFetchedData((prev) => prev.filter((r) =>
                  String(r.id ?? r._id) !== String(recordId),
                ));
              }}
            />
          </div>
        )}
      </NavigationOverlay>
    );
  };

  const boardView = (
    <>
      {/* objectui#8827 — the settle signal reaches `KanbanImpl` through a
          package-private context rather than a `KanbanRendererProps` member,
          because `KanbanRendererProps` is published and no caller outside this
          package may set this. Context crosses the board's
          `Suspense`/`React.lazy` boundary normally, which is what makes the
          private channel possible at all. Full argument on the context. */}
      <KanbanRecordsSettledContext.Provider value={recordsSettled}>
      {/* objectui#11629 — the lane total rides the same kind of private
          channel, for the same reason. `null` (no `summarizeField`) leaves
          every header exactly as it was. See `KanbanColumnSummary`. */}
      <KanbanColumnSummaryContext.Provider value={columnSummary}>
      {/* objectui#12619 — each paged lane's count and "Load more", on the
          same kind of private channel. `null` (one query) leaves every lane
          as it was. See `KanbanLanePaging.ts`. */}
      <KanbanLanePagingContext.Provider value={lanePagingChannel}>
      {/* objectui#11234 — the internal board, not the exported
          `KanbanRenderer`. It takes the Quick Add pair only as explicit props,
          and this call passes neither, so the object-bound board draws no
          Quick Add control and no read of `onQuickAdd` sits on this path.
          `KanbanRenderer` renders the same board and passes the pair off its
          own `schema`, for a React host. */}
      <KanbanBoardCore
        // Card conditional formatting evaluates against the card record, and
        // this fetch expands relations (`buildExpandFields` above) exactly as
        // the grid's does. Handing the renderer the object's field types is
        // what lets a rule comparing a relation see the stored foreign key
        // instead of the expanded record (objectui#3501).
        //
        // A PROP, not a schema key (objectui#7742, decision batch #70): it is an
        // internal channel from the one caller that fetched the object
        // definition, never an authoring surface. On the schema bag it was
        // reachable by an author through `BaseSchema`'s passthrough.
        objectFields={objectDef?.fields}
        // A PROP, not a schema key (objectui#9342, executing the ruling on PR
        // objectui#9338) — the same remedy `objectFields` above took one card
        // earlier. `handleCardMove` owns the optimistic write, the
        // required-fields dialog and the objectui#4138 rollback, so it is this
        // board's mover and never an authored one. While it rode the `schema`
        // bag below, an authored `onCardMove` was accepted by the passthrough,
        // substituted here, and silently dropped; the arm can only tombstone the
        // key once no renderer reads it off the document.
        //
        // objectui#12082: handed only when `kanbanCardMove` allows the write,
        // and the cards are drawn not movable otherwise (see `cardMoveGranted`).
        onCardMove={cardMoveGranted ? handleCardMove : undefined}
        cardsMovable={cardMoveGranted}
        schema={{
          ...effectiveSchema,
          // `5591f03bd` — the lane headers count rows that came back, so when
          // the fetch saturated its window they must say `77+`, not `77`.
          countsAreWindowed,
          // ⛔ Calls `handleClick` and NOTHING ELSE. An authored `onCardClick`
          // already travels this one line: it is the `onCardClick` arm of
          // `externalClick` above, which is `handleClick`'s `onRowClick`, and
          // that arm has FULL PRIORITY inside the hook — it is called and the
          // hook returns. A second `onCardClick?.(card)` here therefore ran the
          // SAME function again, twice per card click (objectui#9341, measured
          // 2 by objectui#9338's pin before it was relaxed).
          //
          // Of the two calls the DELETED one was the poorer: `handleClick`
          // forwards `onRowClick(record, event)`, so the host can implement
          // Cmd/Ctrl/middle-click, while the second call passed the record
          // only. Dropping it also leaves `onRowClick ?? onCardClick` untouched
          // — a board inside an `ObjectView` still gives the parent's handler
          // priority, and now gives it OUTRIGHT rather than also running the
          // authored one. `ObjectGallery` has written exactly this shape, with
          // no second call, all along.
          onCardClick: (card: any, event?: any) => {
            // Record the clicked card BEFORE opening, so `popover` mode has an
            // anchor by the time it renders (objectui#9299 item 3).
            captureAnchor(event);
            navigation.handleClick(card, event);
          },
        }}
      />
      </KanbanLanePagingContext.Provider>
      </KanbanColumnSummaryContext.Provider>
      </KanbanRecordsSettledContext.Provider>
      {pendingMove && (
        <RequiredFieldsDialog
          open
          fields={pendingFields}
          submitting={pendingSubmitting}
          onCancel={() => setPendingMove(null)}
          onSubmit={async (values) => {
            const move = pendingMove;
            setPendingSubmitting(true);
            try {
              // ONE combined PATCH: the column value and everything the move
              // made required. `persistCardMove` owns the optimistic write,
              // the toast and the #4138 rollback, so a refusal of the combined
              // body behaves exactly like a refusal of a plain move — and the
              // dialog closes rather than looping on an arbitrary server error.
              await persistCardMove(
                move.cardId,
                move.fromColumnId,
                move.toColumnId,
                values,
              );
            } finally {
              setPendingSubmitting(false);
              setPendingMove(null);
            }
          }}
        />
      )}
    </>
  );

  // `split` (item 2): the board IS the main content — it moves into the
  // overlay's left panel with the record panel beside it, rather than being
  // covered by a drawer. Guarded on an OPEN overlay because the split shell
  // renders nothing when closed; with nothing open the board renders alone,
  // exactly as before.
  if (
    navigation.isOverlay
    && navigation.mode === 'split'
    && navigation.isOpen
    && navigation.selectedRecord
  ) {
    const splitOverlay = renderRecordOverlay(boardView);
    // `null` means this record has no overlay at all (no object name / no id)
    // — the board still has to render.
    if (splitOverlay) return <>{splitOverlay}</>;
  }

  return (
    <>
      {boardView}
      {renderRecordOverlay()}
    </>
  );
}
