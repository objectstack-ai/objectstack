/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The ONE-RECORD binding of the record blocks (objectui#12294).
 *
 * `PageComponentSchema.dataSource` is the spec's per-element data binding, and
 * the spec declares it on every page component ("Overrides the page-level
 * object context for this block"). `ElementDataSourceGate` (`@object-ui/react`)
 * honours it for the LIST-shaped blocks by mapping the binding onto keys the
 * block then queries with. The record blocks query nothing: they read the row
 * the record page put in `RecordContextProvider`. So on an `app` page, with no
 * record page around them, `record:details`, `record:highlights` and
 * `record:quick_actions` drew an empty box or "no actions configured" even
 * with a binding that returns one row.
 *
 * This module is the one-record consumer those three share, and
 * {@link recordBindingBlock} is the one way a record block takes it. The gate
 * still resolves the binding (the named view, the AND-combined filter, the
 * sort, and every configuration panel the family draws), so a record block's
 * binding means exactly what it means on a list block. What this adds is the
 * last hop: read the bound set, take its FIRST row, and provide that row
 * through the existing `RecordContextProvider` — so the block bodies are
 * unchanged and there is no second rendering path inside a block.
 *
 * ## Semantics of the bound set (the card's, verbatim in intent)
 *
 *  - 0 rows → the block's authored `emptyState` when it declares one (see
 *    "The authored empty state" below). Without one, the block is mounted under
 *    a record context that names the bound object and NO record, so each block
 *    draws what it draws for a record that is not there: `record:details` its
 *    "record not found" state, `record:highlights` nothing,
 *    `record:quick_actions` its empty bar. A row the caller may not read never
 *    comes back from the server, and a read the server refuses outright
 *    (`classifyLoadError` → `forbidden`) is treated the same, so "absent" and
 *    "not yours to read" are indistinguishable — and the authored empty state
 *    is drawn for both.
 *  - 1 row → that record.
 *  - more than one row → the FIRST by the binding's `sort`. Only one row is
 *    ever asked for (`$top: 1`): the first row of the authored `limit` and the
 *    first row of a one-row read are the same row under the same `sort`.
 *    `objectui validate` warns on a record block whose binding has no
 *    `limit: 1`, so an author says which one they mean.
 *
 * The row is read with the adapter the page already uses, so under the
 * caller's identity: nothing here widens what the server serves.
 *
 * ## The authored empty state (objectui#12932)
 *
 * The spec declares `emptyState` on the three bound record blocks
 * (`RecordDetailsProps`, `RecordHighlightsProps`, `RecordQuickActionsProps`;
 * objectstack#24266), the list view's own `EmptyStateSchema` by reference:
 * `{ title, message, icon, link }`. It is drawn on ONE condition, the spec's:
 * the block carries a `dataSource` binding and the settled read answered no
 * row. {@link BoundRecordEmptyState} draws it IN PLACE of the block body, with
 * the pieces `ObjectGrid` draws its authored empty state with —
 * `DataEmptyState`, `resolveIcon` for the `icon`, the spec's own
 * `resolveI18nLabel` for `title` and `message` against the display locale,
 * and the one shared `EmptyStateLink` for `link` — so one key draws one
 * picture on every surface that takes it.
 *
 * It is NOT drawn while the read is in flight (the loading state), for a read
 * that failed (the error panel stays the error panel), for a bound row that is
 * there but leaves the block nothing to show, or on an unbound block: an
 * unbound block reads the record page's record and never reaches this module's
 * read. A block that declares none keeps its own no-record state above.
 *
 * ## The record page path is untouched
 *
 * {@link BoundRecordScope} renders its children AS THEY ARE when the block
 * carries no binding: no provider, no element, no fetch. A record page's own
 * `RecordContextProvider` therefore still reaches the block, byte-identically.
 * With a binding, the binding wins, as the spec says it does: the bound record
 * shadows the page record for this block only.
 *
 * ## Freshness: the data-invalidation bus (objectstack#4444's bar)
 *
 * A fetching record context that does not listen to the bus shows a STALE
 * record that looks correct after a write elsewhere on the page — harder to
 * notice than an empty one. So the read is keyed on `useDataInvalidation` for
 * the bound OBJECT, the same bus `RecordDetailView` keys its record read on.
 * Object-scoped, not row-scoped, because the binding is a query: a write to any
 * row of the object can change which row is first. A refetch replaces the row
 * in place (no remount), and an equal answer is not republished as a new object
 * (AGENTS.md #10).
 *
 * ## What a bound block does NOT join
 *
 * A bound block sits inside the record page's providers when it is placed on a
 * record page, and two of them are about THAT page's record:
 *
 *  - the page's inline-edit session (`InlineEditProvider`): a bound
 *    `record:details` or `record:highlights` joining it would put the bound
 *    record's fields into the page record's draft, and the page's Save bar
 *    would write them to the page record. The bound scope mounts a read-only
 *    session instead (`canEdit: false`), which is also what an `app` page,
 *    with no session at all, already gives these blocks;
 *  - the page's highlight-field registry (`HighlightFieldsProvider`): a bound
 *    `record:highlights` would otherwise hide fields from the PAGE record's
 *    `record:details`. The bound scope gets its own registry.
 *
 * ## The PARENT binding of `record:related_list` ({@link ParentRecordBinding})
 *
 * `record:related_list` is the one record block with two bindings (ruling B on
 * objectui#12296): its node-level `dataSource` is the CHILD rows the list
 * draws (objectstack#6953), and the spec row's `parentDataSource` is the record
 * the list hangs off. The parent binding is read here, by the same one-record
 * read: the same gate, the same first row by `sort`, the same invalidation bus,
 * provided through the same `RecordContextProvider` the related-list body
 * already reads. It differs from the three blocks above in ONE place, and the
 * spec's describe is why: no row is a LOUD ABSENCE drawn in the block's place,
 * never an empty record context — under one the list would query nothing and
 * draw an empty list, which reads as "this record has no related records", a
 * wrong fact in the silent direction.
 */

import * as React from 'react';
import {
  ElementDataSourceErrorPanel,
  ElementDataSourceGate,
  HighlightFieldsProvider,
  InlineEditProvider,
  RecordContextProvider,
  classifyLoadError,
  noDataSourceMessage,
  useDataInvalidation,
  useFilterScope,
  useResolvedDataSource,
  useResolvedFilter,
  type ElementDataSourceMapping,
} from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { DataEmptyState, EmptyStateLink, Skeleton, resolveIcon } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';
import { resolveI18nLabel as resolveInlineI18nLabel, type EmptyState } from '@objectstack/spec/ui';
import {
  buildExpandFields,
  elementDataSourceBlock,
  isElementDataSourceConfig,
  withoutDeniedFields,
} from '@object-ui/core';
import type { DataSource, QueryParams } from '@object-ui/types';
import { useDetailTranslation } from '../useDetailTranslation';

/**
 * What the gate lands for a record block: the bound object on `objectName`
 * (the gate's default object key), and the composed `filter` and `sort`.
 *
 * Read by {@link BoundRecordScope} only — the block bodies receive the schema
 * as authored, so none of these keys reaches a body that does not read it.
 * `limit` is deliberately unmapped: one row is read whatever the binding caps
 * the set at (see the module doc).
 */
const RECORD_BLOCK_DATA_SOURCE: ElementDataSourceMapping = { filter: true, sort: true };

/** Stable stand-in for a missing `schema`, so the gate keeps one identity. */
const NO_SCHEMA: Record<string, unknown> = {};

/** Does this node carry a binding the gate will resolve? The gate's own predicate. */
function isBound(schema: unknown): boolean {
  return isElementDataSourceConfig((schema as { dataSource?: unknown } | null | undefined)?.dataSource);
}

/**
 * Wrap a record block's body so its `dataSource` binding supplies its record,
 * and declare the key through the seam.
 *
 * The one way a record block takes the binding, so a fourth one cannot take it
 * differently: `ElementDataSourceGate` resolves the binding (and draws the
 * family's panels for an unresolvable view, a refused filter, or no adapter),
 * {@link BoundRecordScope} reads and provides the first row, and
 * `elementDataSourceBlock` makes the registration publish the injected
 * `dataSource` input — from `@object-ui/core`, the import source
 * `check:element-data-source-declaration` holds every call site to.
 *
 * `requiresDataSource` is set for a BOUND block only: a bound block with no
 * adapter has nothing to read its row with, and says so through the family's
 * no-data-source panel. An unbound block is the record page path, left as it was.
 *
 * @param Body     The block's renderer, unchanged: it reads `useRecordContext()`.
 * @param blockKey The registry key (`record:details`, …); the panel test ids are
 *                 derived from it the way `record-related-list` spells its own.
 */
export function recordBindingBlock<RendererProps extends { schema?: unknown }>(
  Body: React.ComponentType<RendererProps>,
  blockKey: string,
): React.FC<RendererProps> {
  const testId = recordBlockTestId(blockKey);
  const Bound: React.FC<RendererProps> = (props) => {
    const bound = isBound(props.schema);
    return (
      <ElementDataSourceGate
        schema={(props.schema ?? NO_SCHEMA) as Record<string, unknown>}
        mapping={RECORD_BLOCK_DATA_SOURCE}
        testId={testId}
        requiresDataSource={bound}
        noDataSourceMessage={
          bound
            ? noDataSourceMessage(blockKey, (props.schema as { dataSource?: { object?: unknown } }).dataSource?.object)
            : undefined
        }
      >
        {(landed) => (
          <BoundRecordScope schema={props.schema} bound={landed} testId={testId}>
            <Body {...props} />
          </BoundRecordScope>
        )}
      </ElementDataSourceGate>
    );
  };
  Bound.displayName = `RecordBinding(${blockKey})`;
  return elementDataSourceBlock(Bound);
}

/** `record:quick_actions` → `record-quick-actions`. */
function recordBlockTestId(blockKey: string): string {
  return blockKey.replace(/[:_]/g, '-');
}

interface BoundRecordScopeProps {
  /** The block's schema as authored; its `dataSource` says whether it is bound. */
  schema: unknown;
  /** The same schema with the gate's {@link RECORD_BLOCK_DATA_SOURCE} landing applied. */
  bound: unknown;
  /** `data-testid` stem for this scope's own states (`<stem>-loading-record`, …). */
  testId: string;
  children: React.ReactNode;
}

/**
 * The block's record context, from its binding when it has one.
 *
 * Unbound → the children as they are (the record page path). Bound → the
 * first row of the bound set, provided through `RecordContextProvider`.
 */
function BoundRecordScope({ schema, bound, testId, children }: BoundRecordScopeProps): React.ReactElement {
  if (!isBound(schema)) return <>{children}</>;
  const landed = (bound ?? NO_SCHEMA) as { objectName?: unknown; filter?: unknown; sort?: unknown };
  // The gate calls its children only once the binding composed, and a composed
  // binding always names its object (`isElementDataSourceConfig`).
  const object = typeof landed.objectName === 'string' ? landed.objectName : '';
  const emptyState = authoredEmptyState(schema);
  return (
    <BoundRecordProvider
      object={object}
      filter={landed.filter}
      sort={landed.sort}
      testId={testId}
      absent={emptyState ? <BoundRecordEmptyState emptyState={emptyState} testId={testId} /> : undefined}
    >
      {children}
    </BoundRecordProvider>
  );
}

/**
 * The block's authored `emptyState`, the spec's `EmptyStateSchema` — the shape
 * the contract validates at publish, so nothing here re-reads its members under
 * another spelling. Anything that is not an object is not an authored empty
 * state, and the block keeps its own no-record state.
 */
function authoredEmptyState(schema: unknown): EmptyState | undefined {
  const value = (schema as { emptyState?: unknown } | null | undefined)?.emptyState;
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as EmptyState) : undefined;
}

interface BoundRecordEmptyStateProps {
  emptyState: EmptyState;
  /** `data-testid` stem; the drawing is `<stem>-empty-state`. */
  testId: string;
}

/**
 * A bound record block's authored empty state, drawn in place of the block
 * when its binding answered no row (see "The authored empty state" above).
 *
 * The drawing is `ObjectGrid`'s for its own authored `emptyState`, member for
 * member: `icon` through `resolveIcon` (a name that resolves to nothing keeps
 * `DataEmptyState`'s own glyph), `title` and `message` resolved against the
 * display locale (a map with no usable entry keeps that member's default),
 * and `link` through the one shared `EmptyStateLink`. The one difference is
 * the default heading: a record block's is the words `record:details` says for
 * a record that is not there, not the table's "No results found".
 */
function BoundRecordEmptyState({ emptyState, testId }: BoundRecordEmptyStateProps): React.ReactElement {
  const displayLocale = useDisplayLocale();
  const { t } = useDetailTranslation();
  const title = resolveInlineI18nLabel(emptyState.title, displayLocale);
  const message = resolveInlineI18nLabel(emptyState.message, displayLocale);
  const Icon = resolveIcon(emptyState.icon);
  return (
    <DataEmptyState
      data-testid={`${testId}-empty-state`}
      // The annotation the other `resolveIcon` seam call sites carry: it returns
      // a STABLE, cached component per icon name; it does not create one during
      // render. The rule cannot see that through a call.
      // eslint-disable-next-line react-hooks/static-components
      icon={Icon ? <Icon className="size-5 text-muted-foreground" /> : undefined}
      title={title || t('detail.recordNotFound')}
      description={message || undefined}
      action={emptyState.link ? <EmptyStateLink link={emptyState.link} displayLocale={displayLocale} /> : undefined}
    />
  );
}

export interface ParentRecordBindingProps {
  /**
   * The PARENT binding as authored — `record:related_list`'s
   * `parentDataSource`, the spec's `ElementDataSourceSchema` by reference.
   * Anything that is not a binding the gate would resolve (absent included)
   * leaves the children exactly as they are.
   */
  binding: unknown;
  /** The block's registry key, named in the no-adapter panel. */
  blockKey: string;
  /** `data-testid` stem for this scope's states (`<stem>-loading-record`, …). */
  testId: string;
  /** Heading of the panels a binding that cannot be read draws. */
  errorTitle?: string;
  /** What the block draws in its own place when no row answers: the loud absence. */
  absent: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The parent record of a block, from a binding of its own (ruling B on
 * objectui#12296, the spec's `RecordRelatedListProps.parentDataSource`).
 *
 * Unbound → the children as they are, so the record page's own context still
 * reaches the block, byte-identically. Bound → the binding is resolved by
 * `ElementDataSourceGate` (a named view, the AND-combined filter, the sort, and
 * the family's panels for a view that does not resolve, a refused filter, or no
 * adapter), its FIRST row is read by {@link BoundRecordProvider} — the one
 * read the three one-record blocks take, keyed on the same invalidation bus —
 * and provided through `RecordContextProvider` as the children's record. No row
 * draws `absent` instead of the children.
 *
 * The gate is handed the parent binding ALONE, as a node's `dataSource`, and
 * never the block's own schema: with the schema, the gate's filter and sort
 * mapping would compose the block's own `filter` and `sort` — the CHILD list's
 * — into the parent's query.
 */
export function ParentRecordBinding({
  binding,
  blockKey,
  testId,
  errorTitle,
  absent,
  children,
}: ParentRecordBindingProps): React.ReactElement {
  // Memoised for cost only (AGENTS.md #10): the gate composes off this node,
  // and every read below keys on the strings it lands, not on this identity.
  const gateSchema = React.useMemo(() => ({ dataSource: binding }), [binding]);
  if (!isElementDataSourceConfig(binding)) return <>{children}</>;
  return (
    <ElementDataSourceGate
      schema={gateSchema}
      mapping={RECORD_BLOCK_DATA_SOURCE}
      testId={testId}
      errorTitle={errorTitle}
      requiresDataSource
      noDataSourceMessage={noDataSourceMessage(blockKey, binding.object)}
    >
      {(landed) => {
        // As in `BoundRecordScope`: a composed binding always names its object.
        const { objectName, filter, sort } = landed as { objectName?: unknown; filter?: unknown; sort?: unknown };
        return (
          <BoundRecordProvider
            object={typeof objectName === 'string' ? objectName : ''}
            filter={filter}
            sort={sort}
            testId={testId}
            absent={absent}
            errorTitle={errorTitle}
          >
            {children}
          </BoundRecordProvider>
        );
      }}
    </ElementDataSourceGate>
  );
}

/** Gated copies of bound rows, keyed on the served row object itself. */
const READABLE_ROWS = new WeakMap<object, { kept: string; row: unknown }>();

/**
 * The served row without the fields the loaded policy denies — the row a record
 * page hands its blocks (`RecordDetailView`'s private `readableRow`, objectui#10499),
 * and the SAME gated object for the same served row and the same kept keys, so a
 * re-render never republishes an equal row as a new object (AGENTS.md #10).
 *
 * ⚠️ A second copy of that helper, written here rather than imported: it is
 * module-private to `@object-ui/app-shell`, which depends on this package, not
 * the other way round. Converging the two hosts' "fetch a record and provide
 * it" onto one internal core is the hygiene objectstack#4444 names; it is not
 * done in this change.
 */
function readableRow<T>(
  record: T,
  perms: Pick<ReturnType<typeof usePermissions>, 'isLoaded' | 'checkField'>,
  objectName: string,
): T {
  const row = withoutDeniedFields(record, perms, objectName);
  if (row === record || !record || typeof record !== 'object') return row;
  const kept = JSON.stringify(Object.keys(row as object));
  const cached = READABLE_ROWS.get(record as object);
  if (cached && cached.kept === kept) return cached.row as T;
  READABLE_ROWS.set(record as object, { kept, row });
  return row;
}

type BoundRow = Record<string, unknown>;

/** One settled read, tagged with the query it answered. */
type BoundRead =
  | { key: string; status: 'loaded'; row: BoundRow | undefined }
  | { key: string; status: 'failed'; error: string };

const firstRow = (result: unknown): BoundRow | undefined => {
  // `data` is the ONE rows member `QueryResult` (`@object-ui/types`) declares;
  // the bare-array arm is the shape fakes at this seam answer with, as
  // `element:number` reads it.
  const rows = (result as { data?: unknown } | null | undefined)?.data ?? result;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row && typeof row === 'object' && !Array.isArray(row) ? (row as BoundRow) : undefined;
};

/** The row's primary key, as `RelatedList` reads a row's id. */
const rowId = (row: BoundRow | undefined): string | number | undefined => {
  const id = row?.id ?? row?._id;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
};

const sameRow = (a: BoundRow | undefined, b: BoundRow | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));

interface BoundRecordProviderProps {
  object: string;
  filter: unknown;
  sort: unknown;
  testId: string;
  /**
   * Drawn INSTEAD of the children when the settled read has no row. Absent, the
   * children are mounted under a record context that names the object and no
   * record — the three one-record blocks' own no-record states. Set by
   * {@link ParentRecordBinding} (its loud absence) and by
   * {@link BoundRecordScope} when the block declares an `emptyState`.
   */
  absent?: React.ReactNode;
  /** Heading of the failed-read panel; the family's default when absent. */
  errorTitle?: string;
  children: React.ReactNode;
}

function BoundRecordProvider({
  object,
  filter,
  sort,
  testId,
  absent,
  errorTitle,
  children,
}: BoundRecordProviderProps): React.ReactElement {
  const dataSource = useResolvedDataSource<DataSource>();
  const perms = usePermissions();
  // Placeholder tokens (`{current_user_id}`, the date macros) resolve the way
  // every bound block resolves them. The scope is read OUTSIDE the bound
  // record, so `{record_id}` is the record page's own record when there is one.
  const queryFilter = useResolvedFilter(filter, useFilterScope());
  const filterKey = queryFilter === undefined ? '' : JSON.stringify(queryFilter);
  const sortKey = sort === undefined ? '' : JSON.stringify(sort);

  // ── The object definition: field types and labels for the blocks, and the
  // reference fields to `$expand`. Best-effort, as `DetailView` reads it.
  const canReadSchema = typeof dataSource?.getObjectSchema === 'function';
  const [schemaRead, setSchemaRead] = React.useState<{ object: string; schema: unknown } | null>(null);
  React.useEffect(() => {
    if (!canReadSchema || !dataSource) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => dataSource.getObjectSchema(object))
      .then(
        (schema) => { if (!cancelled) setSchemaRead({ object, schema }); },
        () => { if (!cancelled) setSchemaRead({ object, schema: undefined }); },
      );
    return () => { cancelled = true; };
  }, [canReadSchema, dataSource, object]);
  const schemaReady = !canReadSchema || schemaRead?.object === object;
  const objectSchema = schemaRead?.object === object ? schemaRead.schema : undefined;

  // Reference fields resolve to their display names, as the record page asks
  // for them — and only the ones the loaded policy lets this caller read
  // (field-level security on `$expand`, the record page's own gate). Held as a
  // string so the read below keys on the list, not on an object (AGENTS.md #10).
  const expandable = buildExpandFields((objectSchema as { fields?: Record<string, unknown> } | undefined)?.fields);
  const expandKey = JSON.stringify(
    perms?.isLoaded ? expandable.filter((f) => perms.checkField(object, f, 'read')) : expandable,
  );

  const readKey = JSON.stringify([object, filterKey, sortKey, expandKey]);
  // The bus: any write to the bound object re-reads in place (see module doc).
  const invalidationNonce = useDataInvalidation(dataSource ? object : undefined);
  const [read, setRead] = React.useState<BoundRead | null>(null);

  React.useEffect(() => {
    if (!dataSource || !schemaReady) return;
    let cancelled = false;
    const expand: string[] = JSON.parse(expandKey);
    const params: QueryParams = { $top: 1 };
    if (filterKey) params.$filter = JSON.parse(filterKey);
    if (sortKey) params.$orderby = JSON.parse(sortKey);
    if (expand.length > 0) params.$expand = expand;
    Promise.resolve()
      .then(() => dataSource.find(object, params))
      .then(
        (result) => {
          if (cancelled) return;
          const row = firstRow(result);
          // An equal answer keeps the row object it replaces (AGENTS.md #10).
          setRead((prev) =>
            prev && prev.key === readKey && prev.status === 'loaded' && sameRow(prev.row, row)
              ? prev
              : { key: readKey, status: 'loaded', row },
          );
        },
        (err: unknown) => {
          if (cancelled) return;
          setRead(
            classifyLoadError(err) === 'forbidden'
              ? { key: readKey, status: 'loaded', row: undefined }
              : { key: readKey, status: 'failed', error: err instanceof Error ? err.message : String(err) },
          );
        },
      );
    return () => { cancelled = true; };
    // Keyed on the query's DATA — the strings above — never on the filter or
    // sort objects they were read from (AGENTS.md #10). `invalidationNonce` is
    // the bus: it moves when the bound object is written.
  }, [dataSource, object, schemaReady, readKey, filterKey, sortKey, expandKey, invalidationNonce]);

  const current = read?.key === readKey ? read : null;
  if (dataSource && !current) {
    return (
      <div data-testid={`${testId}-loading-record`} aria-busy="true" className="space-y-2">
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (current?.status === 'failed') {
    return <ElementDataSourceErrorPanel testId={testId} title={errorTitle} message={current.error} />;
  }
  const row = current?.status === 'loaded' ? current.row : undefined;
  // Settled with no row: none answered, or the server refused the read, which
  // reads the same (see the module doc).
  if (absent !== undefined && row === undefined) return <>{absent}</>;
  return (
    <RecordContextProvider
      objectName={object}
      recordId={rowId(row)}
      data={row === undefined ? undefined : readableRow(row, perms, object)}
      objectSchema={objectSchema}
      dataSource={dataSource}
    >
      <HighlightFieldsProvider>
        <InlineEditProvider canEdit={false}>{children}</InlineEditProvider>
      </HighlightFieldsProvider>
    </RecordContextProvider>
  );
}
