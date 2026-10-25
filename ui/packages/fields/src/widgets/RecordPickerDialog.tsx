import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DIALOG_VIEWPORT_GUTTER,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Skeleton,
} from '@object-ui/components';
import {
  Search,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { DataSource, LookupColumnDef, LookupFilterDef } from '@object-ui/types';
// The repo's single filter sink (`packages/core/src/utils/filter-converter.ts`)
// — shared with plugin-list's `buildEffectiveFilter` and plugin-view's
// ObjectView, so a spec `ViewFilterRule[]` lowers in exactly one place.
import { buildExpandFields, mergeFilterNodes, toFilterNodeSafely, toPredicateRecord, withoutDeniedFields, type FilterNodeResult } from '@object-ui/core';
import { useSafeFieldLabel, useDisplayLocale } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { RelatedRecordActionsProvider, useRelatedRecordActions } from '@object-ui/react';
import { useFieldTranslation } from './useFieldTranslation.js';
import { useRecordQuery } from './useRecordQuery.js';
import { objectResolvesSearch } from './searchOffer.js';
// The one place a lookup column's display value is decided — shared with the
// inline dropdown in LookupField so a single `lookupColumns` declaration
// cannot render two different ways (objectui#5492).
import {
  normalizeColumn,
  fieldToLabel,
  resolveSchemaOptions,
  buildLookupColumnDescriptors,
  renderLookupColumnValue,
  type LookupCellRendererResolver,
} from './lookupColumnDisplay.js';

/** Default page size for the Record Picker dialog */
const DEFAULT_PAGE_SIZE = 10;

/** Minimum column width when resizing (px) */
const MIN_COL_WIDTH = 60;

/** Number of skeleton rows displayed during initial loading */
const SKELETON_ROW_COUNT = 5;

/**
 * objectui#11903 — the dialog's width follows the number of columns it draws.
 *
 * It used to be one fixed `lg:max-w-5xl` whatever the column count, so a
 * three-column picker (a related list's *Add*: name, email, email verified)
 * stretched to about a thousand pixels. Each rung is the `sm:` (and, for the
 * widest, `lg:`) max width for that many drawn columns; past the last rung the
 * old fixed width stays as the ceiling. Below `sm` the dialog is `95vw`, as it
 * always was. The selection column `multiple` adds is narrow and not counted.
 *
 * In `multiple` mode the footer bar also carries the selected count, Cancel
 * and Confirm beside the page controls, which the one- and two-column rungs
 * cannot hold on one line (measured in the console preview gallery: at the
 * one-column rung the bar wrapped to two lines), so that mode starts at the
 * three-column rung. The bar still wraps rather than overflow where a longer
 * locale or a phone needs it.
 */
const WIDTH_BY_COLUMN_COUNT: readonly string[] = [
  'sm:max-w-xl', // 1 column
  'sm:max-w-xl', // 2
  'sm:max-w-2xl', // 3
  'sm:max-w-3xl', // 4
  'sm:max-w-3xl lg:max-w-4xl', // 5
];
const WIDTH_CEILING = 'sm:max-w-3xl lg:max-w-5xl';

/** The smallest rung a `multiple` picker uses — the three-column one. */
const MULTIPLE_MIN_COLUMN_RUNG = 3;

function dialogWidthClass(columnCount: number, multiple: boolean): string {
  const rung = multiple ? Math.max(columnCount, MULTIPLE_MIN_COLUMN_RUNG) : columnCount;
  return WIDTH_BY_COLUMN_COUNT[rung - 1] ?? WIDTH_CEILING;
}

/**
 * objectui#11903 — inside the picker a cell never renders as a navigational
 * link: the row is the only click target, and a link in it is a second one
 * competing with selection (a `mailto:` opening the mail client instead of
 * ticking the row).
 *
 * These cell renderer keys draw their value as their OWN anchor without asking
 * the host — `mailto:`, a URL, `tel:`, and the file family's download link —
 * so the picker draws them with the `text` face instead: the address, the URL,
 * the number, the file's name. The reference family draws its anchor only when
 * the host's `recordHref` answers, so the built-in table renders its rows under
 * the same host with no record destination (see the table below).
 *
 * The idea is objectui#11817's `linkCellRenderer` in `@object-ui/plugin-grid`,
 * re-stated here because that module is internal to that package. Whether a
 * registered type draws an anchor is measured, not recalled: the census in
 * `RecordPickerDialog.layout-11903.test.tsx` draws every type
 * `listCellRendererTypes()` reports through this table.
 */
const SELF_LINKING_CELL_TYPES: ReadonlySet<string> = new Set([
  'email',
  'url',
  'phone',
  'file',
  'video',
  'audio',
]);

/** The cell renderer key a self-linking value is drawn with in the picker. */
const PICKER_TEXT_FACE = 'text';

/**
 * Cell renderer function signature — matches getCellRenderer from @object-ui/fields.
 * Accepts a field type and returns a React component that renders a formatted cell.
 */
export type CellRendererResolver = LookupCellRendererResolver;

/**
 * Filter column definition used by the inline filter bar.
 * A subset of LookupColumnDef enriched with filter-specific metadata.
 * Compatible with FilterUISchema.filters entries for easy bridging.
 */
export interface RecordPickerFilterColumn {
  field: string;
  label?: string;
  type: 'text' | 'number' | 'select' | 'date' | 'boolean';
  options?: Array<{ label: string; value: any }>;
}

/**
 * Props passed to the custom filter bar renderer (renderFilterBar slot).
 * Allows plugging in FilterUI or any custom component.
 */
export interface RecordPickerFilterBarProps {
  /** Filter column definitions describing each filterable field */
  filterColumns: RecordPickerFilterColumn[];
  /** Current filter values keyed by field name */
  values: Record<string, any>;
  /** Called when a single filter value changes */
  onChange: (field: string, value: any) => void;
  /** Clear all filter values */
  onClear: () => void;
  /** Number of actively applied filters */
  activeCount: number;
}

/**
 * Props passed to the custom grid renderer (renderGrid slot).
 * Allows plugging in ObjectGrid or any compatible table component.
 */
export interface RecordPickerGridSlotProps {
  /**
   * Resolved column definitions, less the ones field-level security denies
   * once the permission policy has loaded, the display column included — the
   * columns the built-in table draws (objectui#10373). When none survives,
   * this is the id column alone.
   */
  columns: LookupColumnDef[];
  /** Current page of records */
  records: any[];
  /** Whether data is loading */
  loading: boolean;
  /** Total record count across all pages */
  totalCount: number;
  /** Current page number (1-based) */
  currentPage: number;
  /** Records per page */
  pageSize: number;
  /** Current sort field, null if unsorted */
  sortField: string | null;
  /** Current sort direction */
  sortDirection: 'asc' | 'desc';
  /** Called when a column header is clicked to sort */
  onSort: (field: string) => void;
  /** Called when page changes */
  onPageChange: (page: number) => void;
  /** Called when a row is clicked */
  onRowClick: (record: any) => void;
  /** Check if a record is selected */
  isSelected: (record: any) => boolean;
  /** Whether multiple selection is enabled */
  multiple: boolean;
  /** Record ID field name */
  idField: string;
  /** Cell renderer resolver */
  cellRenderer?: CellRendererResolver;
}

/**
 * Convert LookupFilterDef[] to a Record<string, any> compatible with
 * QueryParams.$filter.  Supports operator mapping for eq/ne/gt/lt/gte/lte/
 * contains/in/notIn.
 */
export function lookupFiltersToRecord(
  filters: LookupFilterDef[],
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const f of filters) {
    switch (f.operator) {
      case 'eq':
        result[f.field] = f.value;
        break;
      case 'ne':
        result[f.field] = { $ne: f.value };
        break;
      case 'gt':
        result[f.field] = { $gt: f.value };
        break;
      case 'lt':
        result[f.field] = { $lt: f.value };
        break;
      case 'gte':
        result[f.field] = { $gte: f.value };
        break;
      case 'lte':
        result[f.field] = { $lte: f.value };
        break;
      case 'contains':
        result[f.field] = { $contains: f.value };
        break;
      case 'in':
        result[f.field] = { $in: f.value };
        break;
      case 'notIn':
        result[f.field] = { $nin: f.value };
        break;
    }
  }
  return result;
}

/**
 * Option-value round-trip helpers for the filter panel's `select` input
 * (#3422).
 *
 * Radix `Select` speaks strings only: an option renders as
 * `value={String(opt.value)}` and `onValueChange` hands that same string back.
 * A filter option's value, however, is whatever the metadata author wrote —
 * `lookupFilters: [{ field: 'level', operator: 'in', value: [1, 2, 3] }]`
 * derives options with NUMBER values (`LookupFilterDef.value` is `unknown`) —
 * so writing the control's string straight into `$filter` queried
 * `{ level: "1" }` against records storing `level: 1`, and the panel returned
 * nothing for an option that plainly has records.
 *
 * The remap therefore happens at the CONTROL boundary, not in
 * `filterValuesToRecord`: the control speaks string, the payload keeps the
 * authored type. Coercing downstream would mean guessing whether `"1"` meant
 * `1` or `"1"` — a guess the option list already answers exactly.
 *
 * Replicated from `matchOptionValue` / `toControlValue` in
 * `packages/components/src/renderers/form/option-value.ts` (#3090), which
 * solved the identical morph for the standalone form's select. Those two are
 * module-private to `@object-ui/components` (its public barrel does not export
 * them and the package publishes no deep subpath), so `@object-ui/fields`
 * keeps its own copy of the four lines rather than widening another package's
 * API to share them.
 */

/**
 * Stringify a value for a string-speaking control, preserving null/undefined
 * (an absent value must stay absent, not become `"undefined"`).
 */
function toControlValue(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

/**
 * Map a control's string back to the authored option value, so a numeric /
 * boolean / object option round-trips with its type intact. Falls back to the
 * raw string when nothing matches (a stale value, or a column that declares no
 * options) — the pre-#3422 behaviour, so unmatched paths change nothing.
 *
 * When two options share a `String()` form — `1` and `'1'`, or two object
 * values that both print `[object Object]` — the FIRST match wins. Such a list
 * is already unrenderable as a dropdown (Radix would receive two `SelectItem`s
 * with the same `value`, and React two children with the same key), so this
 * tie-break exists to be deterministic, not to make an ambiguous option list
 * work.
 */
function matchOptionValue(
  options: ReadonlyArray<{ value: unknown }> | undefined,
  raw: string,
): unknown {
  const hit = options?.find(o => String(o.value) === raw);
  return hit ? hit.value : raw;
}

/**
 * Convert user-entered filter bar values into a $filter Record.
 * Each key is a field name, each value the user-entered value.
 * Empty/null values are ignored.
 *
 * Note the empty string is the "no filter on this field" sentinel here (and
 * the `select` control's "nothing picked" value), so an option whose authored
 * value is `''` cannot be expressed as an active filter. That predates #3422
 * and is unchanged by it — the round-trip above restores an option's TYPE, it
 * does not redefine what counts as an empty selection.
 */
function filterValuesToRecord(
  values: Record<string, any>,
  filterColumns: RecordPickerFilterColumn[],
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const col of filterColumns) {
    const v = values[col.field];
    if (v === undefined || v === null || v === '') continue;
    if (col.type === 'boolean') {
      result[col.field] = Boolean(v);
    } else if (col.type === 'text') {
      result[col.field] = { $contains: v };
    } else {
      result[col.field] = v;
    }
  }
  return result;
}

export interface RecordPickerDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when the dialog should close */
  onOpenChange: (open: boolean) => void;

  /** Dialog title */
  title?: string;
  /** Allow multiple selection */
  multiple?: boolean;

  /** DataSource to fetch records from */
  dataSource: DataSource;
  /** Object name to query (e.g. 'customers') */
  objectName: string;

  /** Columns to display. Defaults to [displayField, descriptionField]. */
  columns?: Array<string | LookupColumnDef>;
  /**
   * The display field as the lookup DECLARES it. The display column is keyed on
   * it, or on `'name'` when it is omitted. With `objectSchema` given, a declared
   * value is also the first rung of the column's title (the resolver's
   * `titleField`); the `'name'` default never is, because it is a guess and a
   * guess never outranks the referenced object's own declarations. So pass
   * `undefined` when the field declares none, never a pre-filled `'name'`.
   */
  displayField?: string;
  /**
   * The referenced object's schema (objectui#10486). When given, the display
   * column renders each record's title through `@object-ui/core`'s
   * `getRecordDisplayName`, the call LookupField's dropdown option label and
   * the read cell make: the declared `displayField`, then the object's
   * `nameField`, then its deprecated `titleFormat` template, then type-aware
   * derivation (ADR-0079). The title reads the row with its relations
   * collapsed to ids and the fields the loaded policy denies removed, exactly
   * as the dropdown's option label does.
   *
   * Replaces the retired `titleFormat` prop: a bare template cut out of the
   * schema ranked above the `nameField` beside it, so the picker and the
   * dropdown labelled one record two ways.
   */
  objectSchema?: Record<string, unknown> | null;
  /** Record id field (default: 'id') */
  idField?: string;

  /** Page size (default: 10) */
  pageSize?: number;

  /** Currently selected value(s) */
  value?: any;
  /** Called when selection changes */
  onSelect: (value: any) => void;

  /**
   * Called with the full record objects corresponding to the selected value(s).
   * Useful for parent components (e.g. LookupField) that need display data
   * (labels, descriptions) for the selected records beyond just their IDs.
   */
  onSelectRecords?: (records: any[]) => void;

  /**
   * Base filters applied to every query.
   * Converted from LookupFieldMetadata.lookupFilters.
   * Restricts which records are selectable (e.g. only active records).
   */
  lookupFilters?: LookupFilterDef[];

  /**
   * Hard filter constraint applied to every query. Unlike `lookupFilters`,
   * entries here never surface in the filter bar and cannot be overridden by
   * user filter input.
   *
   * Two shapes, discriminated STRUCTURALLY (`Array.isArray`), because the two
   * callers speak two legitimate vocabularies and neither should be bent into
   * the other:
   *
   * - **`QueryParams.$filter` record form** (`{ account: 'a1' }`) — the
   *   dependent (cascading) lookup chain, where the parent field's value MUST
   *   scope the candidate set (#2215). Merged by KEY OVERWRITE, so a cascaded
   *   value REPLACES a stale `lookupFilters` entry on the same field instead of
   *   intersecting with it. That precedence is load-bearing: an `and` of both
   *   would ask for `account = 'stale' AND account = 'a1'` and return nothing.
   * - **A spec `ViewFilterRule[]`** (`[{ field, operator, value? }]`) — an
   *   author's `record:related_list.add.picker.filter`, handed over VERBATIM
   *   (#3831). Lowered by `mergeFilterNodes`, the repo's single filter sink, so
   *   all 19 `VIEW_FILTER_OPERATORS` reach the wire — including the four
   *   (`before`, `after`, `is_empty`, `is_not_empty`) the record form has no
   *   `$op` for. No second operator vocabulary is introduced here: two already
   *   exist (the spec's `AST_OPERATOR_MAP`, data-objectstack's
   *   `FILTER_OPERATOR_ALIASES`) and objectstack-ai/objectstack#3948 is what a third costs.
   *
   * The discriminator is exact rather than heuristic — every AST node is an
   * ARRAY and a rule is a plain OBJECT, the same predicate `toFilterNode` uses.
   *
   * Typed `unknown` rather than `Record< string, any >` on purpose: that type
   * ACCEPTED a rule array (TypeScript lets an array satisfy a string index of
   * `any`), the old object-spread merge then flattened it to
   * `{"0": {...}, "1": {...}}`, and the query filtered on columns literally
   * named `0`/`1` — type-check green, wrong query, no diagnostic anywhere.
   */
  baseFilter?: unknown;

  /**
   * Cell renderer resolver function.
   * When provided, columns with a `type` property will be rendered using the
   * resolved cell renderer (e.g. badges for select, formatted currency, etc.).
   * Typically pass `getCellRenderer` from @object-ui/fields.
   */
  cellRenderer?: CellRendererResolver;

  /**
   * The referenced object's schema `fields` map (field name → field
   * definition). When provided, cell renderers receive the FULL field
   * metadata — `options`, `currency`, `scale`, `precision`, `format`,
   * `reference`, … — exactly like the list view enriches its columns from
   * the object schema. Without it a `select` column falls back to
   * title-casing the raw stored value instead of resolving the option label
   * (#3333: `manufacturing` rendered as "Manufacturing" instead of the
   * authored option label).
   *
   * The filter bar reads the same map: a `select` filter column with no
   * authored `options` takes them from the schema field here, so the filter
   * panel's dropdown offers exactly the options the table cells render
   * (#3336 — it used to open empty, leaving the field unfilterable).
   */
  fieldsMeta?: Record<string, any>;

  /**
   * Filter bar column definitions.
   * When provided, shows an inline filter bar below the search input.
   * Columns can include type-specific inputs (text, number, select, date, boolean).
   */
  filterColumns?: RecordPickerFilterColumn[];

  /**
   * Custom filter bar renderer slot.
   * When provided, replaces the built-in filter bar with a custom component
   * (e.g. FilterUI from @object-ui/plugin-view).
   * Receives filter state and callbacks via RecordPickerFilterBarProps.
   *
   * @example
   * renderFilterBar={(props) => (
   *   <FilterUI
   *     schema={{ type: 'filter-ui', filters: props.filterColumns, layout: 'inline' }}
   *     onChange={(values) => Object.entries(values).forEach(([k, v]) => props.onChange(k, v))}
   *   />
   * )}
   */
  renderFilterBar?: (props: RecordPickerFilterBarProps) => React.ReactNode;

  /**
   * Custom grid renderer slot.
   * When provided, replaces the built-in table with a custom grid component
   * (e.g. ObjectGrid from @object-ui/plugin-grid).
   * Receives data, columns, and interaction callbacks via RecordPickerGridSlotProps.
   *
   * @example
   * renderGrid={(props) => (
   *   <ObjectGrid
   *     schema={{ type: 'object-grid', objectName, columns: props.columns }}
   *     dataSource={dataSource}
   *   />
   * )}
   */
  renderGrid?: (props: RecordPickerGridSlotProps) => React.ReactNode;
}

/**
 * objectui#11903 — no anchor in a picker row. A reference value (the lookup
 * cell's `ReferencedRecordLink`) draws one whenever the host answers
 * `recordHref`, so the built-in table renders its rows under the same host with
 * no record destination: "the host cannot route to that object", which the
 * context documents as render the plain value. objectui#11817's `LinkCell`
 * withholds the answer from a grid's link cell the same way. Every other member
 * of the host passes through; with no host there is nothing to withhold.
 */
function WithoutRecordLinks({ children }: { children: React.ReactNode }): React.ReactElement {
  const host = useRelatedRecordActions();
  if (!host) return <>{children}</>;
  return (
    <RelatedRecordActionsProvider value={{ ...host, recordHref: undefined, openRecord: undefined }}>
      {children}
    </RelatedRecordActionsProvider>
  );
}

/**
 * RecordPickerDialog — Enterprise-grade record selection dialog.
 *
 * Renders records in a table with multi-column display, search,
 * pagination, column sorting, keyboard navigation, loading/error/empty
 * states, and single/multi-select.  Responsive: mobile-friendly width
 * via Tailwind breakpoints.
 */
export function RecordPickerDialog({
  open,
  onOpenChange,
  title = 'Select Record',
  multiple = false,
  dataSource,
  objectName,
  columns: columnsProp,
  displayField: declaredDisplayField,
  objectSchema,
  idField = 'id',
  pageSize = DEFAULT_PAGE_SIZE,
  value,
  onSelect,
  onSelectRecords,
  lookupFilters,
  baseFilter,
  cellRenderer,
  fieldsMeta,
  filterColumns,
  renderFilterBar,
  renderGrid,
}: RecordPickerDialogProps) {
  // The column the record title stands in for. The `'name'` default only keys
  // that column; `declaredDisplayField` is what the title resolver ranks.
  const displayField = declaredDisplayField ?? 'name';
  const { t } = useFieldTranslation();
  const { translateOptions } = useSafeFieldLabel();
  // The one date/number locale resolver: tenant regional default → active UI
  // language → 'en' (objectui#4272). Read unconditionally at component level.
  const displayLocale = useDisplayLocale();

  // Query state (records/loading/error/total + page/search/sort) lives in the
  // shared useRecordQuery kernel — instantiated after mergedFilter below.

  // For multi-select, track pending selections before confirming
  const [pendingSelection, setPendingSelection] = useState<Set<any>>(new Set());

  // Cache selected record objects across page navigations (multi-select).
  // When the user toggles a row the full record is stored here so that
  // onSelectRecords can return complete objects even after paging away.
  const selectedRecordsMap = useRef<Map<any, any>>(new Map());

  // Keyboard navigation: focused row index
  const [focusedRow, setFocusedRow] = useState(-1);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);

  // Filter bar state
  const [filterBarOpen, setFilterBarOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, any>>({});

  // Column resize state: widths keyed by field name
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizeRef = useRef<{ field: string; startX: number; startWidth: number } | null>(null);

  // Page jump input state
  const [pageJumpValue, setPageJumpValue] = useState('');

  // Resolved columns
  const resolvedColumns = useMemo<LookupColumnDef[]>(() => {
    if (columnsProp && columnsProp.length > 0) {
      return columnsProp.map(normalizeColumn);
    }
    // Auto-infer: just use displayField
    return [{ field: displayField, label: fieldToLabel(displayField) }];
  }, [columnsProp, displayField]);

  // Field descriptors handed to the type-aware cell renderers — built by the
  // SHARED helper, the same call the inline dropdown makes, so both surfaces
  // enrich one `lookupColumns` declaration identically (objectui#5492).
  const columnFieldDescriptors = useMemo<Record<string, any>>(
    () => buildLookupColumnDescriptors(resolvedColumns, fieldsMeta, objectName, translateOptions),
    [resolvedColumns, fieldsMeta, objectName, translateOptions],
  );

  /**
   * `$expand` for the picker's query (objectui#10223): the reference columns
   * among the ones this table renders, by `buildExpandFields`' rule — the one
   * LookupField's inline dropdown applies to its previewed columns. Without it
   * each such cell arrived as a bare foreign key and the lookup cell renderer
   * resolved it with its own `findOne`, one request per row per column.
   *
   * The id column is left out: the row's identity (`getRecordId`) reads it
   * raw, so it must stay the key it always was.
   *
   * The table renders the rows as served. What leaves it — the records
   * `onSelectRecords` hands a host, and the display column's reading of a
   * row's title — sees the row with its relations collapsed to ids
   * (`toPredicateRecord`), as it did before any column was expanded.
   *
   * Field-level security gates the OUTPUT, in the objectui#7429 sweep's shape
   * — the same gate as LookupField's `candidateExpand`: once the policy has
   * loaded, a relation the user may not read on `objectName` is not asked for.
   *
   * No rendered column besides the id ⇒ no `$expand`: `buildExpandFields`
   * reads an EMPTY column list as "every relation the object declares".
   */
  const perms = usePermissions();
  const expand = useMemo<string[]>(() => {
    const rendered = resolvedColumns.filter((c) => c.field !== idField);
    if (rendered.length === 0) return [];
    const expandable = buildExpandFields(fieldsMeta, rendered);
    if (!perms.isLoaded) return expandable;
    return expandable.filter((f) => perms.checkField(objectName, f, 'read'));
  }, [fieldsMeta, resolvedColumns, idField, perms, objectName]);

  /**
   * The columns this table DRAWS: the resolved ones the user may read
   * (objectui#10373). Field-level security gates the displayed OUTPUT, in the
   * shape `RelatedList`'s `keepReadableColumns` applies under the
   * objectui#7215 / objectui#7230 rulings: once the policy has loaded, a column
   * the user may not read on `objectName` is neither headed nor rendered;
   * before it loads nothing is filtered, and `perms` in the deps re-derives the
   * list when the answer arrives. `objectName` is the object `expand` above
   * judges.
   *
   * Gating `$expand` alone left a denied column on screen: a denied relation
   * arrived as a bare key, and the lookup cell renderer resolved it with a read
   * of its own.
   *
   * The display column is a drawn column like any other, as in
   * `keepReadableColumns`: a denied display field is not drawn. The id column
   * is never filtered — it is the value committed — and selection reads the id
   * from the row itself, never from a drawn column, so every row stays
   * selectable. When the policy leaves no column to draw (the default picker
   * draws only the display column), the id column is drawn instead, so a row
   * still has something to click and to tell it apart by.
   *
   * `expand` keeps reading `resolvedColumns` and gating its own output, as
   * every `buildExpandFields` call site does; both ask `checkField` about the
   * same names on the same object, so the two lists cannot disagree.
   */
  const readableColumns = useMemo<LookupColumnDef[]>(() => {
    if (!perms.isLoaded) return resolvedColumns;
    const kept = resolvedColumns.filter(
      (c) => c.field === idField || perms.checkField(objectName, c.field, 'read'),
    );
    return kept.length > 0 ? kept : [{ field: idField, label: fieldToLabel(idField) }];
  }, [resolvedColumns, perms, objectName, idField]);

  // Auto-generate filter columns from lookupFilters when no explicit filterColumns given.
  // Each LookupFilterDef becomes a filterable field with inferred type.
  const baseFilterColumns = useMemo<RecordPickerFilterColumn[] | undefined>(() => {
    if (filterColumns && filterColumns.length > 0) return filterColumns;
    // Auto-derive from lookupFilters: each filter entry becomes a filterable field
    if (lookupFilters && lookupFilters.length > 0) {
      return lookupFilters.map(f => {
        // Infer filter input type from value type first, then fall back to operator
        let type: RecordPickerFilterColumn['type'] = 'text';
        if (typeof f.value === 'boolean') {
          type = 'boolean';
        } else if (Array.isArray(f.value)) {
          type = 'select';
        } else if (typeof f.value === 'number') {
          type = 'number';
        } else if (f.operator === 'gt' || f.operator === 'lt' || f.operator === 'gte' || f.operator === 'lte') {
          type = 'number';
        } else if (f.operator === 'in' || f.operator === 'notIn') {
          type = 'select';
        }
        return {
          field: f.field,
          label: fieldToLabel(f.field),
          type,
          // For array values (in/notIn), derive selectable options
          ...(Array.isArray(f.value) ? {
            options: (f.value as any[]).map(v => {
              if (v != null && typeof v === 'object') {
                const obj = v as Record<string, unknown>;
                return { label: String(obj.name || obj.label || obj.title || v), value: v };
              }
              return { label: String(v), value: v };
            }),
          } : {}),
        };
      });
    }
    return undefined;
  }, [filterColumns, lookupFilters]);

  // Filter columns as the filter bar consumes them: every `select` filter
  // carries the options its schema field declares. The filter panel's Select reads
  // `col.options` — a derived select column (LookupField turns each typed picker
  // column into a filter column) carries none, so the dropdown opened empty and
  // the field could not be filtered at all (#3336).
  //
  // The options come from `fieldsMeta` through `resolveSchemaOptions`, i.e. the
  // SAME schema source + i18n translation the table cells use (#3333) — not a
  // second derivation that could drift from the cells. An explicitly authored
  // `options` list on the filter column always wins (it is the more specific
  // statement), and a schema field with no options stays optionless: an empty
  // dropdown for THAT field is the honest rendering of missing metadata.
  const effectiveFilterColumns = useMemo<RecordPickerFilterColumn[] | undefined>(() => {
    if (!baseFilterColumns) return undefined;
    return baseFilterColumns.map(col => {
      if (col.type !== 'select') return col;
      if (col.options && col.options.length > 0) return col;
      const options = resolveSchemaOptions(fieldsMeta?.[col.field], objectName, col.field, translateOptions);
      return options ? { ...col, options } : col;
    });
  }, [baseFilterColumns, fieldsMeta, objectName, translateOptions]);

  // Merge base lookupFilters with user filter bar values, then apply the hard
  // `baseFilter` constraint BY SHAPE (see the prop's own doc for why the two
  // shapes exist):
  //
  //   record form → spread LAST, exactly as this merge has always done, so
  //                 user filter-bar input can never widen it back out and a
  //                 cascaded parent value replaces a stale same-field
  //                 `lookupFilters` entry (#2215).
  //   rule array  → its OWN `and` child via `mergeFilterNodes`, the shared
  //                 sink, so a spec `ViewFilterRule[]` lowers losslessly
  //                 (#3831) instead of being spread into `{0: rule}`.
  //
  // When BOTH are in play the record side is still built first and lowered as
  // one node, so its key-overwrite precedence survives the conjunction.
  //
  // ⚠️ Each side is lowered through `toFilterNodeSafely` before the merge —
  // objectui#10789. This is a RENDER-time `useMemo`, and the lowering refuses a
  // malformed authored rule (an `add.picker.filter` rule the converter cannot
  // carry) or record condition with a `FilterOperatorError`: uncaught, that
  // threw out of render into the error boundary. The refusal is kept as a
  // VALUE: the query does not run (never "no filter", which would list every
  // record) and the dialog's error state below reports it — the state a
  // refusal already reaches when the ADAPTER lowers the record form in `find`.
  const mergedFilter = useMemo<FilterNodeResult>(() => {
    const lookupBase = lookupFilters?.length
      ? lookupFiltersToRecord(lookupFilters)
      : {};
    const userFilter = effectiveFilterColumns?.length
      ? filterValuesToRecord(filterValues, effectiveFilterColumns)
      : {};
    const rules = Array.isArray(baseFilter) ? baseFilter : undefined;
    const recordBase = rules
      ? undefined
      : (baseFilter as Record<string, any> | undefined);
    const combined = { ...lookupBase, ...userFilter, ...(recordBase ?? {}) };
    const record = Object.keys(combined).length > 0 ? combined : undefined;
    if (!rules) return { ok: true, node: record };
    const recordNode = toFilterNodeSafely(record);
    if (!recordNode.ok) return recordNode;
    const rulesNode = toFilterNodeSafely(rules);
    if (!rulesNode.ok) return rulesNode;
    return { ok: true, node: mergeFilterNodes(recordNode.node, rulesNode.node) };
  }, [lookupFilters, effectiveFilterColumns, filterValues, baseFilter]);
  const filterRefusal = mergedFilter.ok ? undefined : mergedFilter.refusal;

  // Shared query kernel: builds params, fetches, and owns records/loading/error/
  // total plus the page/search/sort controls. Selection state stays local (above).
  const query = useRecordQuery({
    dataSource,
    objectName,
    enabled: open && mergedFilter.ok,
    pageSize,
    paginate: true,
    filter: mergedFilter.ok ? mergedFilter.node : undefined,
    expand,
  });
  // Preserve the previous local names so the handlers and render below are
  // unchanged (the migration is a pure refactor). A refused filter is this
  // dialog's error too (objectui#10789): nothing was read, so it is the only one.
  const { records, loading } = query;
  const error = filterRefusal ? filterRefusal.message : query.error;
  const totalCount = query.total;
  const totalPages = query.totalPages;
  const searchQuery = query.search;
  const currentPage = query.page;
  const sortField = query.sort?.field ?? null;
  const sortDirection: 'asc' | 'desc' = query.sort?.direction ?? 'asc';
  const setCurrentPage = query.setPage;
  const handleSort = query.toggleSort;
  const handleSearchChange = query.setSearch;
  // objectui#12966 — no type-ahead on an object whose search resolves to no
  // field: the server refuses that search with `400 INVALID_FIELD`. The table
  // still lists and pages the records. An unknown schema keeps the box.
  const searchOffered = objectResolvesSearch(objectSchema) !== false;

  // Reset non-query UI/selection state when the dialog closes. Query state
  // (search/page/sort/records) is cleared by useRecordQuery when `enabled`
  // (== open) goes false, kept separate so resets never cascade into a fetch
  // (React #185).
  useEffect(() => {
    if (!open) {
      setFocusedRow(-1);
      setFilterBarOpen(false);
      setFilterValues({});
      setColumnWidths({});
      setPageJumpValue('');
      setPendingSelection(new Set(
        multiple ? (Array.isArray(value) ? value : []) : [],
      ));
      selectedRecordsMap.current.clear();
    }
    // Intentionally depends only on `open` — `multiple` and `value` are
    // captured at close-time and don't need to trigger resets while closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Initialize pending selection when dialog opens
  useEffect(() => {
    if (open && multiple) {
      setPendingSelection(new Set(Array.isArray(value) ? value : []));
    }
  }, [open, multiple, value]);

  // Reset keyboard focus whenever the result set changes (previously done
  // inline at the end of fetchRecords).
  useEffect(() => {
    setFocusedRow(-1);
  }, [records]);

  // Get record id
  const getRecordId = useCallback(
    (record: any) => record[idField] ?? record.id ?? record._id,
    [idField],
  );

  // Check if a record is selected
  const isSelected = useCallback(
    (record: any) => {
      const rid = getRecordId(record);
      if (multiple) {
        return pendingSelection.has(rid);
      }
      return value === rid;
    },
    [multiple, value, pendingSelection, getRecordId],
  );

  // Handle row click
  const handleRowClick = useCallback(
    (record: any) => {
      const rid = getRecordId(record);
      // A host receives the row as it was before `$expand` (objectui#10223).
      const selected = toPredicateRecord(record, fieldsMeta);

      if (multiple) {
        setPendingSelection(prev => {
          const next = new Set(prev);
          if (next.has(rid)) {
            next.delete(rid);
            selectedRecordsMap.current.delete(rid);
          } else {
            next.add(rid);
            selectedRecordsMap.current.set(rid, selected);
          }
          return next;
        });
      } else {
        // Single select — immediately close
        onSelect(rid);
        onSelectRecords?.([selected]);
        onOpenChange(false);
      }
    },
    [multiple, getRecordId, fieldsMeta, onSelect, onSelectRecords, onOpenChange],
  );

  // The header's select-all for the page (objectui#11903, the table-selection
  // pattern the `Table` primitive's `:has([role=checkbox])` cell rule is built
  // for): when every row on this page is pending it clears them, otherwise it
  // adds the ones missing. Rows on other pages are never touched, and each row
  // it adds is cached for `onSelectRecords` exactly as a row click caches it.
  const handleTogglePage = useCallback(() => {
    const pageRows = records.map((record) => ({
      rid: getRecordId(record),
      // A host receives the row as it was before `$expand` (objectui#10223).
      selected: toPredicateRecord(record, fieldsMeta),
    }));
    setPendingSelection(prev => {
      const next = new Set(prev);
      const wholePage = pageRows.length > 0 && pageRows.every(({ rid }) => next.has(rid));
      for (const { rid, selected } of pageRows) {
        if (wholePage) {
          next.delete(rid);
          selectedRecordsMap.current.delete(rid);
        } else if (!next.has(rid)) {
          next.add(rid);
          selectedRecordsMap.current.set(rid, selected);
        }
      }
      return next;
    });
  }, [records, getRecordId, fieldsMeta]);

  // Confirm multi-select
  const handleConfirm = useCallback(() => {
    const ids = Array.from(pendingSelection);
    onSelect(ids);
    // Build the full record array from the cache for the caller
    const selectedRecords = ids
      .map(id => selectedRecordsMap.current.get(id))
      .filter(Boolean);
    onSelectRecords?.(selectedRecords);
    onOpenChange(false);
  }, [pendingSelection, onSelect, onSelectRecords, onOpenChange]);

  // Page navigation
  const handlePrevPage = useCallback(() => {
    setCurrentPage(Math.max(1, currentPage - 1));
  }, [setCurrentPage, currentPage]);

  const handleNextPage = useCallback(() => {
    setCurrentPage(Math.min(totalPages, currentPage + 1));
  }, [setCurrentPage, currentPage, totalPages]);

  // Page jump handler
  const handlePageJump = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return;
      const page = parseInt(pageJumpValue, 10);
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        setCurrentPage(page);
      }
      setPageJumpValue('');
    },
    [pageJumpValue, totalPages],
  );

  // Keyboard navigation for the table
  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (records.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRow(prev => Math.min(prev + 1, records.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRow(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (focusedRow >= 0 && focusedRow < records.length) {
          handleRowClick(records[focusedRow]);
        }
      }
    },
    [records, focusedRow, handleRowClick],
  );

  // Scroll focused row into view
  useEffect(() => {
    if (focusedRow >= 0 && tableBodyRef.current) {
      const row = tableBodyRef.current.querySelector(`[data-row-index="${focusedRow}"]`);
      if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedRow]);

  // Get display value for a cell. Delegated to the SHARED lookup-column
  // renderer (objectui#5492) — the inline dropdown in LookupField calls the
  // very same function, so this table and that popover cannot answer one
  // `lookupColumns` declaration two different ways.
  //
  // The display column's title (objectui#10486) is built from the row the
  // dropdown's option label is built from: relations collapsed to ids, so an
  // expanded reference a `titleFormat` names prints what it printed before
  // `$expand` rather than an object (objectui#10223).
  //
  // The title can name any field of the row, not only the column's own (a
  // `titleFormat` template, a `nameField`), so it reads the row with the fields
  // the loaded policy denies removed (objectui#10373) — the row ObjectStack's
  // `FieldMasker` already serves. A denied field falls through the resolver
  // exactly as it does for that row. The rule is `@object-ui/core`'s
  // `withoutDeniedFields`, the one every surface calls (objectui#10594). The id
  // field is never judged: it is the value committed, not a display value.
  //
  // The resolver is the host's, with one substitution (objectui#11903): a
  // self-linking type is drawn with the text face, so no cell is a link
  // (`SELF_LINKING_CELL_TYPES`). Every other type, and the value each face is
  // handed, is exactly what the shared renderer chose before — the two-surface
  // agreement pin (objectui#5492) compares the TEXT both surfaces print.
  const renderCellContent = useCallback(
    (record: any, col: LookupColumnDef): React.ReactNode =>
      renderLookupColumnValue(
        objectSchema && col.field === displayField
          ? withoutDeniedFields(toPredicateRecord(record, fieldsMeta), perms, objectName, [idField])
          : record,
        col,
        {
          descriptors: columnFieldDescriptors,
          cellRenderer: cellRenderer
            ? (fieldType: string) =>
                cellRenderer(SELF_LINKING_CELL_TYPES.has(fieldType) ? PICKER_TEXT_FACE : fieldType)
            : undefined,
          objectSchema,
          titleField: declaredDisplayField,
          displayField,
          displayLocale,
        },
      ),
    [cellRenderer, objectSchema, declaredDisplayField, displayField, fieldsMeta, columnFieldDescriptors, displayLocale, perms, objectName, idField],
  );

  // Render sort indicator for a column
  const renderSortIcon = useCallback((field: string) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-1 size-3 opacity-40" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="ml-1 size-3" />
      : <ArrowDown className="ml-1 size-3" />;
  }, [sortField, sortDirection]);

  // Column resize: mouse-down on drag handle
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, field: string, currentWidth: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { field, startX: e.clientX, startWidth: currentWidth };

      const handleMouseMove = (moveEvt: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = moveEvt.clientX - resizeRef.current.startX;
        const newWidth = Math.max(MIN_COL_WIDTH, resizeRef.current.startWidth + delta);
        setColumnWidths(prev => ({ ...prev, [resizeRef.current!.field]: newWidth }));
      };

      const handleMouseUp = () => {
        resizeRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [],
  );

  // Filter bar: update a single field value
  const handleFilterChange = useCallback(
    (field: string, val: any) => {
      setFilterValues(prev => ({ ...prev, [field]: val }));
      setCurrentPage(1);
    },
    [],
  );

  // Filter bar: clear all filter values
  const handleFilterClear = useCallback(() => {
    setFilterValues({});
    setCurrentPage(1);
  }, []);

  // Active filter count for badge
  const activeFilterCount = useMemo(
    () => Object.values(filterValues).filter(v => v !== undefined && v !== null && v !== '').length,
    [filterValues],
  );

  // Render a single filter bar input
  const renderFilterInput = useCallback(
    (col: RecordPickerFilterColumn) => {
      const val = filterValues[col.field];
      const label = col.label || fieldToLabel(col.field);

      switch (col.type) {
        case 'select':
          return (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              {/* The control speaks string; the stored filter value keeps the
                  authored option type (#3422 — see `matchOptionValue`). */}
              <Select
                value={toControlValue(val) ?? ''}
                onValueChange={v => handleFilterChange(col.field, matchOptionValue(col.options, v))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t('lookup.filterPlaceholder', { label })} />
                </SelectTrigger>
                <SelectContent>
                  {col.options?.map(opt => (
                    <SelectItem key={String(opt.value)} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        case 'number':
          return (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                value={val ?? ''}
                placeholder={t('lookup.filterPlaceholder', { label })}
                onChange={e => {
                  const raw = e.target.value;
                  handleFilterChange(col.field, raw === '' ? '' : Number(raw));
                }}
              />
            </div>
          );
        case 'date':
          return (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={val ?? ''}
                onChange={e => handleFilterChange(col.field, e.target.value)}
              />
            </div>
          );
        case 'boolean':
          return (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <div className="flex items-center gap-2 h-8">
                <Checkbox
                  checked={Boolean(val)}
                  onCheckedChange={checked => handleFilterChange(col.field, Boolean(checked))}
                />
                <span className="text-xs text-muted-foreground">{t('lookup.yes')}</span>
              </div>
            </div>
          );
        case 'text':
        default:
          return (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <Input
                className="h-8 text-xs"
                value={val ?? ''}
                placeholder={t('lookup.filterPlaceholder', { label })}
                onChange={e => handleFilterChange(col.field, e.target.value)}
              />
            </div>
          );
      }
    },
    [filterValues, handleFilterChange],
  );

  // Row background class logic: selected > odd-striped > default
  const getRowBgClass = useCallback((selected: boolean, idx: number) => {
    if (selected) return 'bg-primary/5 hover:bg-primary/10';
    if (idx % 2 === 1) return 'bg-muted/20 hover:bg-accent/30';
    return 'hover:bg-accent/30';
  }, []);

  // The select-all reads the page as the rows show it: checked only when every
  // row on this page is pending.
  const wholePageSelected =
    multiple && records.length > 0 && records.every((record) => pendingSelection.has(getRecordId(record)));

  // One footer bar (objectui#11903): the record count and page controls, and in
  // `multiple` mode the selected count, Cancel and Confirm, in one `DialogFooter`.
  // The count and page controls belong to the built-in table; the grid slot is
  // handed paging through its own props, as it always was.
  const showPagination = !renderGrid && !error && totalCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* objectui#11903 — the container keeps the primitive's `gap-4`: no
          `gap-0`, and no per-section margins standing in for it, so the
          title-to-search distance is the one `DialogHeader` gets in every other
          dialog. `flex flex-col` is what lets the table region below be the
          one bounded scroll area (`flex-1 min-h-0`); the width is
          `dialogWidthClass`'s rung for the drawn column count. From `sm` up
          the shared `DIALOG_VIEWPORT_GUTTER` (objectui#12603) keeps 1rem from
          the window edge under every rung, the `lg:` ceiling included; below
          `sm` the dialog stays `95vw`. */}
      <DialogContent
        className={cn(
          'w-[95vw] max-h-[85vh] sm:max-h-[80vh] flex flex-col',
          DIALOG_VIEWPORT_GUTTER,
          dialogWidthClass(readableColumns.length, multiple),
        )}
        data-testid="record-picker-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {title}
            {multiple && <span className="sr-only"> (multiple selection)</span>}
          </DialogTitle>
        </DialogHeader>

        {/* Search — the `Input` primitive with a leading icon, the pattern every
            other search field in this repo uses: the wrapper only positions the
            icon, the input draws its own one border and its own one focus ring
            (objectui#11903). A bordered wrapper around a borderless input
            stacked two outlines; `focus-visible:ring-0` still drew the
            primitive's ring offset as a second, 2px ring. */}
        {searchOffered && (
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            />
            <Input
              placeholder={t('table.search')}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 pr-9"
              data-testid="record-picker-search"
            />
            {loading && (
              <Loader2
                className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground"
                data-testid="record-picker-loading-indicator"
              />
            )}
          </div>
        )}

        {/* Filter bar (inline) — supports external FilterUI via renderFilterBar slot */}
        {effectiveFilterColumns && effectiveFilterColumns.length > 0 && (
          <div>
            {renderFilterBar ? (
              /* External filter bar (e.g. FilterUI from plugin-view) */
              <div data-testid="record-picker-filter-bar">
                {renderFilterBar({
                  filterColumns: effectiveFilterColumns,
                  values: filterValues,
                  onChange: handleFilterChange,
                  onClear: handleFilterClear,
                  activeCount: activeFilterCount,
                })}
              </div>
            ) : (
              /* Built-in filter bar (default) */
              <>
                <div className="flex items-center gap-2" data-testid="record-picker-filter-bar">
                  <Button
                    type="button"
                    variant={activeFilterCount > 0 ? 'secondary' : 'outline'}
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={() => setFilterBarOpen(prev => !prev)}
                  >
                    <SlidersHorizontal className="size-3.5" />
                    {t('lookup.filters')}
                    {activeFilterCount > 0 && (
                      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1 text-xs font-medium text-primary">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                  {activeFilterCount > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={handleFilterClear}
                    >
                      <X className="size-3" />
                      {t('lookup.clear')}
                    </Button>
                  )}
                </div>
                {filterBarOpen && (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 border rounded-md p-3 bg-muted/30" data-testid="record-picker-filter-panel">
                    {effectiveFilterColumns.map(col => (
                      <div key={col.field}>{renderFilterInput(col)}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center gap-2 py-4" role="alert">
            <AlertCircle className="size-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            {/* A retry re-runs a failed READ; it cannot repair an authored
                filter this dialog refused before reading (objectui#10789). */}
            {filterRefusal ? null : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => query.refetch()}
                type="button"
              >
                {t('lookup.retry')}
              </Button>
            )}
          </div>
        )}

        {/* Grid area — external ObjectGrid via renderGrid slot, or built-in table */}
        {renderGrid ? (
          /* External grid component (e.g. ObjectGrid from plugin-grid) */
          <div className="flex-1 min-h-0" data-testid="record-picker-grid-slot">
            {renderGrid({
              columns: readableColumns,
              records,
              loading,
              totalCount,
              currentPage,
              pageSize,
              sortField,
              sortDirection,
              onSort: handleSort,
              onPageChange: setCurrentPage,
              onRowClick: handleRowClick,
              isSelected,
              multiple,
              idField,
              cellRenderer,
            })}
          </div>
        ) : (
          /* Built-in table (default) */
          <>
            {/* Skeleton loading state (initial) */}
            {loading && records.length === 0 && !error && (
              <div className="flex-1 overflow-hidden min-h-0 border rounded-md" role="status" aria-live="polite" data-testid="record-picker-skeleton">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      {multiple && (
                        <TableHead className="w-10">
                          <Skeleton className="size-4 rounded" />
                        </TableHead>
                      )}
                      {readableColumns.map(col => (
                        <TableHead key={col.field}>
                          <Skeleton className="h-4 w-20" />
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
                      <TableRow key={i}>
                        {multiple && (
                          <TableCell className="w-10">
                            <Skeleton className="size-4 rounded" />
                          </TableCell>
                        )}
                        {readableColumns.map(col => (
                          <TableCell key={col.field}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Empty state */}
            {!loading && !error && records.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">{t('lookup.noRecords')}</p>
              </div>
            )}

            {/* Table */}
            {!error && records.length > 0 && (
              <div
                className="relative flex-1 overflow-auto min-h-0 border rounded-md"
                aria-busy={loading || undefined}
                data-state={loading ? 'loading' : 'idle'}
                tabIndex={0}
                onKeyDown={handleTableKeyDown}
                role="grid"
                aria-label={t('console.commandPalette.records')}
              >
                {/* Loading overlay for subsequent fetches (page/sort/filter) */}
                {loading && (
                  <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-background/60"
                    data-testid="record-picker-loading-overlay"
                  >
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                <WithoutRecordLinks>
                  <Table style={Object.keys(columnWidths).length > 0 ? { tableLayout: 'fixed' } : undefined}>
                    <TableHeader className="sticky top-0 z-[5] bg-muted/50 [&_tr]:border-b" data-testid="record-picker-sticky-header">
                      <TableRow>
                        {multiple && (
                          // The table-selection pattern (objectui#11903): a
                          // select-all for the page in the header. Its keys stay
                          // its own — the grid's arrow / Enter / Space handling
                          // below is for rows.
                          <TableHead className="w-10">
                            <Checkbox
                              checked={wholePageSelected}
                              onCheckedChange={handleTogglePage}
                              onKeyDown={e => e.stopPropagation()}
                              aria-label={t('table.selectAllRows', { defaultValue: 'Select all rows' })}
                              data-testid="record-picker-select-page"
                            />
                          </TableHead>
                        )}
                        {readableColumns.map(col => {
                          const w = columnWidths[col.field];
                          const styleWidth = w ? { width: `${w}px`, minWidth: `${w}px` } : col.width ? { width: col.width } : undefined;
                          return (
                            <TableHead
                              key={col.field}
                              style={styleWidth}
                              className="cursor-pointer select-none relative group text-xs font-semibold uppercase tracking-wider"
                              onClick={() => handleSort(col.field)}
                              aria-sort={sortField === col.field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                            >
                              <span className="inline-flex items-center">
                                {col.label || fieldToLabel(col.field)}
                                {renderSortIcon(col.field)}
                              </span>
                              {/* Column resize handle */}
                              <span
                                role="separator"
                                aria-orientation="vertical"
                                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover:opacity-100 bg-border hover:bg-primary/50 transition-opacity"
                                onMouseDown={e => {
                                  const th = e.currentTarget.parentElement;
                                  const rect = th?.getBoundingClientRect();
                                  handleResizeStart(e, col.field, rect?.width ?? 100);
                                }}
                                onClick={e => e.stopPropagation()}
                                data-testid={`resize-handle-${col.field}`}
                              />
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody ref={tableBodyRef}>
                      {records.map((record, idx) => {
                        const rid = getRecordId(record);
                        const selected = isSelected(record);
                        const focused = idx === focusedRow;

                        return (
                          <TableRow
                            key={rid ?? idx}
                            data-row-index={idx}
                            className={cn(
                              'cursor-pointer transition-colors',
                              getRowBgClass(selected, idx),
                              focused && 'ring-2 ring-primary ring-inset',
                            )}
                            onClick={() => handleRowClick(record)}
                            data-testid={`record-row-${rid}`}
                            aria-selected={selected}
                          >
                            {multiple && (
                              // The row's selection, drawn by the `Checkbox`
                              // primitive in every row, ticked or not
                              // (objectui#11903). It is not a tab stop: the
                              // grid's arrow keys and Enter / Space stay the one
                              // keyboard path. A click on it toggles the row
                              // once — it does not also reach the row's handler.
                              <TableCell className="w-10 py-2.5">
                                <Checkbox
                                  checked={selected}
                                  tabIndex={-1}
                                  onClick={e => e.stopPropagation()}
                                  onCheckedChange={() => handleRowClick(record)}
                                  aria-label={t('table.selectRow', { defaultValue: 'Select row' })}
                                  data-testid={`record-picker-row-checkbox-${rid}`}
                                />
                              </TableCell>
                            )}
                            {readableColumns.map(col => (
                              // `data-lookup-cell` names the column this cell
                              // renders, so the two-surface agreement pin can
                              // compare it against the inline dropdown's
                              // `data-lookup-preview` for the same column
                              // (objectui#5492).
                              <TableCell key={col.field} className="py-2.5" data-lookup-cell={col.field}>
                                {renderCellContent(record, col)}
                              </TableCell>
                            ))}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </WithoutRecordLinks>
              </div>
            )}
          </>
        )}

        {/* One footer bar (objectui#11903). The record count, the page
            controls and — in `multiple` mode — the selected count, Cancel and
            Confirm sit in ONE `DialogFooter`, so they share one baseline and
            the dialog's one horizontal padding; the count and controls used to
            be a second bar above it, with a padding of its own. Single-select
            keeps its one bar, without buttons. The bar wraps rather than
            overflow when a narrow rung cannot hold it on one line. */}
        {(showPagination || multiple) && (
          <DialogFooter
            className="gap-2 sm:flex-wrap sm:items-center sm:justify-between sm:space-x-0"
            data-testid="record-picker-footer"
          >
            {showPagination && (
              <div
                className="flex items-center gap-3 text-sm text-muted-foreground"
                data-testid="record-picker-pagination"
              >
                <span>
                  {t('lookup.recordCount', { count: totalCount })}
                  {totalPages > 1 && ` · ${t('lookup.pageOf', { current: currentPage, total: totalPages })}`}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      onClick={handlePrevPage}
                      disabled={currentPage <= 1}
                      type="button"
                      aria-label={t('lookup.prevPage')}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Input
                      className="h-7 w-12 text-center text-xs px-1"
                      placeholder={String(currentPage)}
                      value={pageJumpValue}
                      onChange={e => setPageJumpValue(e.target.value)}
                      onKeyDown={handlePageJump}
                      aria-label={t('lookup.jumpToPage')}
                      data-testid="record-picker-page-jump"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      onClick={handleNextPage}
                      disabled={currentPage >= totalPages}
                      type="button"
                      aria-label={t('lookup.nextPage')}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Multi-select confirmation, right-aligned on the same bar.
                Confirm is disabled while nothing is pending (objectui#11903). */}
            {multiple && (
              <div className="flex items-center gap-2 sm:ml-auto">
                <span className="text-sm text-muted-foreground" data-testid="record-picker-selected-count">
                  {t('table.selected', { count: pendingSelection.size })}
                </span>
                <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirm}
                  disabled={pendingSelection.size === 0}
                  data-testid="record-picker-confirm"
                >
                  {t('common.confirm')}
                </Button>
              </div>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
