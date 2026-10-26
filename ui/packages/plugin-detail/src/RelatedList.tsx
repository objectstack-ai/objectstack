/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Input,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  cn,
  EmptyValue,
  hasDeclaredVisibilityGate,
  resolveIcon,
  useIsMobile,
} from '@object-ui/components';
import { SchemaRenderer, useCapabilityGate, useCondition, toPredicateInput, useSettledSchema, useFilterScope, useResolvedFilter, usePredicateScope, type RelatedRowActionDef } from '@object-ui/react';
import {
  Plus,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ChevronDown,
  Inbox,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DataSource, FieldMetadata } from '@object-ui/types';
import type { ViewFilterRule } from '@objectstack/spec/ui';
import { getCellRenderer, resolveCellRendererType, RecordPickerDialog, deriveLookupColumns, MaskedCellRenderer } from '@object-ui/fields';
import {
  buildExpandFields,
  collectPredicateFieldRefs,
  columnIdentity,
  columnHeader,
  compareSortValues,
  getRecordDisplayName,
  getSortValue,
  isEmptyValue,
  isExpandableFieldType,
  isPlatformSortableField,
  isUnmaterializedFieldType,
  listViewPredicates,
  parentRelationshipFieldDef,
  PLATFORM_RECORD_COLUMNS,
  composeParentScopeFilter,
  isMultiValueRelationship,
  mergeFilterNodes,
  readObjectSortability,
  filterRefusalSubject,
  toFilterNodeSafely,
  userActionPredicates,
  resolveAffordance,
  isDeadlineSettled,
  type FilterNode,
} from '@object-ui/core';
import { useSafeFieldLabel } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { useDetailTranslation } from './useDetailTranslation';
import { isMaskedDetailFieldType } from './fieldEnrichment';

export interface RelatedListProps {
  title: string;
  type: 'list' | 'grid' | 'table';
  api?: string;
  data?: any[];
  schema?: any;
  columns?: any[];
  className?: string;
  dataSource?: DataSource;
  /** Object name for i18n field label resolution */
  objectName?: string;
  /** Callback when "New" button is clicked */
  onNew?: () => void;
  /**
   * [#4646] Render "New" GREYED rather than clickable. Supplied by the host
   * alongside `onNew` when the create affordance exists for this list but its
   * `userActions.create.disabledWhen` predicate answers true for the record in
   * scope (the parent record, on a record page's related list).
   *
   * Deliberately distinct from omitting `onNew` — which HIDES the button. Same
   * hidden-vs-disabled split the row Edit/Delete predicates have had since
   * objectui#2614.
   */
  newDisabled?: boolean;
  /** Callback when "View All" button is clicked */
  onViewAll?: () => void;
  /** Callback when a row Edit action is clicked */
  onRowEdit?: (row: any) => void;
  /** Callback when a row Delete action is clicked */
  onRowDelete?: (row: any) => void;
  /**
   * Add-existing-via-picker config (generic m2m/junction assignment). When set,
   * the toolbar shows an "Add" button that opens a record picker on
   * `picker.object`; selecting records creates link rows in this list's `api`
   * object as `{[referenceField]: parentId, [linkField]: <pickedId>}` (junction
   * case), or — when `linkField` is omitted — re-parents the picked child by
   * setting its `referenceField` to `parentId` (1:m case). Server-side rules on
   * insert (e.g. the AI-seat cap) surface as an inline error.
   *
   * `picker.filter` restricts which records the dialog offers, and is typed as
   * the spec's own `ViewFilterRule[]` rather than `any` (#3831): it goes to
   * `RecordPickerDialog`'s `baseFilter` VERBATIM, so the authored vocabulary is
   * the one enforced — a looser type here is where a wrong shape would hide.
   */
  add?: {
    picker: {
      object: string;
      valueField?: string;
      labelField?: string;
      filter?: ViewFilterRule[];
    };
    linkField?: string;
    label?: string;
  };
  /**
   * Callback when a row is clicked (opens record detail).
   *
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
  onRowClick?: (row: any, event?: any) => void;
  /**
   * Child-object row actions (`locations` `list_item`, or `record_related`
   * inside a parent record — objectui#11270), already localized by the host.
   * Rendered in each row's overflow menu alongside Edit/Delete.
   */
  rowActions?: RelatedRowActionDef[];
  /** Execute one of {@link rowActions} against the clicked row. */
  onRowAction?: (action: RelatedRowActionDef, row: any) => void | Promise<void>;
  /**
   * Child-object list actions (`locations: ['list_toolbar']`), already
   * localized by the host. Rendered as header buttons next to Add/New —
   * e.g. `invite_user` on an organization's Invitations list.
   */
  toolbarActions?: RelatedRowActionDef[];
  /** Execute one of {@link toolbarActions} (no row context). */
  onToolbarAction?: (action: RelatedRowActionDef) => void | Promise<void>;
  /**
   * Field names this list must never show, whatever decided its columns
   * (objectui#9053).
   *
   * The block-level authoring preference `record:related_list` reads as
   * `redactFields`, pushed down to the component that actually decides
   * columns. It used to be applied only where the block could apply it — over
   * the AUTHORED `columns` array — and this component has two more paths that
   * decide columns on their own (`highlightFields` prominence and the
   * heuristic field walk), which that list never reached. Redacting EVERY
   * authored column therefore emptied the array, the empty array read as "no
   * columns were authored", and the derived set brought the redacted field
   * straight back: applying the control maximally switched it off.
   *
   * ⚠️ This is an AUTHORING preference, not the permission boundary. Field
   * security is enforced independently and unconditionally through
   * `perms.checkField(..., 'read')` on every path below; a field that must be
   * unreachable belongs in FLS, not here.
   */
  redactFields?: string[];
  /** Maximum number of columns to auto-generate. Default 6. */
  maxColumns?: number;
  /** Page size for pagination (enables pagination when set) */
  pageSize?: number;
  /**
   * Initial sort applied while the user hasn't clicked a column sort — the
   * spec `RecordRelatedListProps.sort` shape (`'field'` / `'-field'` string or
   * `[{field, order}]`). On the auto-fetch path this becomes the server
   * `$orderby`, keeping page windows deterministic.
   */
  defaultSort?: string | Array<{ field: string; order: 'asc' | 'desc' }>;
  /**
   * Render the standalone row of sort buttons above the list.
   *
   * Only meaningful for a `list` (`data-list`) related list, which has no
   * column headers to click. A `grid`/`table` one sorts through its table
   * headers, which are live regardless of this flag — they always were, and
   * since objectui#3106 they sort the collection rather than the page, so the
   * button row above them would be a second control over the same order.
   *
   * A masked column (a `password` / `secret` field, or any column while the
   * object's field types are still unknown) gets no button (objectui#10728).
   *
   * @default false
   */
  sortable?: boolean;
  /**
   * The list's OWN scope filter — spec `RecordRelatedListProps.filter`
   * ("Additional filter criteria for related records"), which had no read site
   * on this component at all until objectstack#7118: the query was built from
   * `{ [referenceField]: parentId }` alone, so an authored `filter` (and the
   * FILTER half of a `dataSource` binding's saved view) was accepted by every
   * gate and silently dropped — the list answered wider than the metadata asked.
   *
   * ANDed with the parent-relationship condition, never substituted for it:
   * "additional" means it may only narrow this parent's children. That is also
   * why it is not routed through `data-table`'s `lookupFilters` — those render
   * as filter-bar rows the user can edit, which demotes the author's constraint
   * to a suggestion (#3831 argued this for `add.picker.filter`; it holds harder
   * for the list's own scope).
   *
   * Two shapes arrive, both produced by our own layers: the spec vocabulary
   * (`ViewFilterRule[]`) as authored, and an ObjectQL AST node as composed by
   * `ElementDataSourceGate` (which ANDs component/view/binding filters through
   * `mergeFilterNodes` before this component ever sees them). Both are lowered
   * here through that same single sink — the repo's one filter→wire exit — so no
   * second conversion dialect appears.
   */
  filter?: ViewFilterRule[] | FilterNode;
  /**
   * Enable text filtering. The box keeps a row when a column the list shows
   * contains the term; a masked column (a `password` / `secret` field, or any
   * column while the object's field types are still unknown) and a field no
   * column shows are not searched (objectui#10728).
   */
  filterable?: boolean;
  /** Whether the card is collapsible */
  collapsible?: boolean;
  /** Whether the card starts collapsed (requires collapsible=true) */
  defaultCollapsed?: boolean;
  /**
   * Foreign-key field name on child records pointing back to the parent.
   * The renderer hides this column from the table and from the schema-derived
   * column list, since the parent record is already implicit context.
   * Used in combination with `parentId` to scope the auto-fetch query — its
   * ARITY on the child object decides how that condition is compiled, see
   * `parentId` below.
   */
  referenceField?: string;
  /**
   * Primary-key value of the parent record. When both `parentId` and
   * `referenceField` are set, the auto-fetch query is scoped to this parent's
   * children so only true children are returned. Without this scope the list
   * would dump the entire target object table.
   *
   * The condition is compiled to match the relationship field's ARITY on the
   * child object (objectui#7299), because the two arities are two different
   * questions about the stored value:
   *
   *   - single-valued → `$filter: { [referenceField]: parentId }` — equality,
   *     byte for byte what this component has always sent;
   *   - `multiple: true` → `$filter: { [referenceField]: { $contains: parentId } }`
   *     — MEMBERSHIP, because the stored value is an ARRAY of ids and equality
   *     asks whether the whole array IS one id.
   *
   * The verdict is `@objectstack/spec/data`'s own `isMultiValueField`, not a
   * local rule, and it is reached through `@object-ui/core`'s
   * {@link composeParentScopeFilter} — the ONE compiler of this condition,
   * shared with the tab-badge count probe that used to carry a second one
   * (objectui#8882).
   */
  parentId?: string | number;
  /** Lucide icon name (kebab-case) to render next to the section title. */
  icon?: string;
}

/**
 * Resolve an authored Lucide icon name to the React component, falling back to
 * `Inbox` when the name is missing or unknown.
 *
 * objectui#5935: the NORMALISATION moved to the one seam (`resolveIcon` from
 * `@object-ui/components`). This file used to carry its own tokeniser and NO
 * rename map, so `home` missed here and resolved on four other surfaces; it now
 * resolves everywhere. Widening only — no record key contains `_`, whitespace
 * or `-`, so the old resolving set is a strict subset of the new one.
 *
 * ⛔ The `Inbox` fallback stays HERE, at the call site, and is not a parameter
 * of the seam (maintainer ruling 2026-09-03, objectui#5935, option C): the seam
 * answers `name -> component | null`, and what a surface draws for `null` is
 * that surface's own business. Both readers of this function render a glyph
 * unconditionally, so it keeps returning a component rather than `null`.
 */
function resolveIconComponent(name: string | undefined): LucideIcon {
  return resolveIcon(name) ?? Inbox;
}

/**
 * Resolve one referenced record to the label its cell should show.
 *
 * Goes through the unified ADR-0079 resolver when the target object's schema
 * is available, so an object that declares its display name (e.g.
 * `nameField: 'label'`, whose `name` is the API name) resolves to the same
 * string the cell's own `useLookupName` fetch
 * shows — the two used to disagree, making the column flash from the display
 * name to the API name once this batch map landed (objectui#3330). Falls back
 * to the legacy hard-coded chain when no schema reached us or the resolver
 * bottoms out at its `Record #<id>` / `Untitled` floor.
 */
function resolveRelatedLookupLabel(record: any, refSchema: any): string | undefined {
  const id = record?.id ?? record?._id;
  if (refSchema) {
    const resolved = getRecordDisplayName(refSchema, record);
    const isFloor =
      resolved === 'Untitled' || (id != null && resolved === `Record #${id}`);
    if (resolved && !isFloor) return resolved;
  }
  return (
    record?.full_name ||
    record?.fullname ||
    record?.display_name ||
    record?.name ||
    record?.subject ||
    record?.title ||
    record?.label ||
    record?.code ||
    record?.email ||
    (id != null ? String(id) : undefined)
  );
}

/**
 * Normalize the spec `sort` union (`'field'` / `'-field'` string or
 * `[{field, order}]`) into the object-array form fed to `$orderby`.
 */
function normalizeSortSpec(
  sort: RelatedListProps['defaultSort'],
): Array<{ field: string; order: 'asc' | 'desc' }> {
  if (!sort) return [];
  if (typeof sort === 'string') {
    const trimmed = sort.trim();
    if (!trimmed) return [];
    return trimmed.startsWith('-')
      ? [{ field: trimmed.slice(1), order: 'desc' }]
      : [{ field: trimmed, order: 'asc' }];
  }
  return sort.filter((s) => !!s?.field);
}

/** The permission context this component reads field-level security from. */
type FieldReadPolicy = ReturnType<typeof usePermissions>;

/**
 * The field the mobile card gallery draws as each card's cover. It is handed
 * to the `object-gallery` node explicitly as `gallery.coverField`, and the
 * `$select` projection asks for it from this same constant (objectui#10186),
 * so the field the card reads and the field the request carries cannot drift
 * apart. The value is `ObjectGallery`'s own default, so the cover is unchanged.
 */
const MOBILE_GALLERY_COVER_FIELD = 'image';

/**
 * The cell a WITHHELD column draws (objectui#10657): the mask, never the
 * value. See `tableColumns` for when a column is withheld. Module-level, so
 * the column keeps one `cell` identity across renders.
 */
function withheldCell(value: unknown): React.ReactElement {
  return React.createElement(MaskedCellRenderer, { value });
}

/**
 * The key this component DRAWS a column through: the table library's
 * `accessorKey` first, then the shared metadata reader. Every column gate below
 * resolves identity this way, because a column refused under one reading and
 * drawn under another is the defect objectui#9053 recorded.
 */
function drawnColumnKey(c: unknown): string | undefined {
  const key = (c as { accessorKey?: unknown } | null | undefined)?.accessorKey || columnIdentity(c);
  return key ? String(key) : undefined;
}

/** The column keys a content key from `unmaskedColumnKeysKey` lists (objectui#10728). */
function readColumnKeys(contentKey: string): string[] {
  return JSON.parse(contentKey) as string[];
}

/**
 * The three column gates of the AUTHORED path, as plain functions so that the
 * columns `effectiveColumns` draws and the `$select` the auto-fetch sends
 * (objectui#10186) are judged by ONE spelling of each gate, not two that can
 * drift apart. Each fails OPEN on a column it cannot name, as it always has.
 *
 * FLS: drop the columns the principal cannot read on the related object. An
 * unanswered policy (`isLoaded` false) filters nothing.
 */
function keepReadableColumns<T>(cols: T[], perms: FieldReadPolicy, objectName: string): T[] {
  if (!perms?.isLoaded || !objectName) return cols;
  return cols.filter((c) => {
    const key = drawnColumnKey(c);
    if (!key) return true;
    return perms.checkField(objectName, key, 'read');
  });
}

/** Drop the parent foreign key: the parent record is already the context. */
function dropParentKeyColumn<T>(cols: T[], referenceField: string | undefined): T[] {
  return referenceField ? cols.filter((c) => drawnColumnKey(c) !== referenceField) : cols;
}

/** Drop the columns the block redacts (objectui#9053) — an authoring preference. */
function dropRedactedColumns<T>(cols: T[], redacted: ReadonlySet<string>): T[] {
  if (redacted.size === 0) return cols;
  return cols.filter((c) => {
    const key = drawnColumnKey(c);
    return !(key && redacted.has(key));
  });
}

/**
 * One `list_toolbar` action button on a related-list header (e.g. "Invite
 * User" on an organization's Invitations list). Extracted into its own
 * component so the action's `visible` CEL predicate can be evaluated with a
 * hook (`useCondition`) without violating the rules-of-hooks inside a `.map()`.
 *
 * The SAME bridge (`RelatedRecordActionsBridge.deriveActions`) feeds both a
 * child object's row actions (`list_item`) and these header toolbar actions
 * (`list_toolbar`), spreading each action's `visible` predicate through
 * untouched. The row path already honors `visible` (via the data-table's
 * `DataTableRowActionItem`); this brings the toolbar path to parity so e.g.
 * `invite_user` (`visible: "features.organization != false"`) hides when its
 * predicate is false. `features`/`user` resolve from the ambient
 * ExpressionProvider scope.
 *
 * The verdict fails CLOSED on a predicate that FAULTS (`throwOnError`), as
 * every action `visible` leg does (objectui#11212, Rider 1 of objectui#4421):
 * a precondition that cannot be evaluated — `current_user.can(…)` before the
 * permissions payload has loaded, an unbound root — hides the button and is
 * reported once, instead of showing an action whose guard is broken. This leg
 * used to fail SOFT to `true`.
 *
 * Whether a gate is DECLARED at all is asked with `hasDeclaredVisibilityGate`,
 * as every other member of the action family asks it (objectui#3812,
 * objectui#11244), never by truthiness: `visible: false` is a declared gate and
 * hides the button, while a blank predicate (`''`, whitespace) is no gate.
 */
export const RelatedToolbarButton: React.FC<{
  action: RelatedRowActionDef;
  onToolbarAction: (action: RelatedRowActionDef) => void | Promise<void>;
}> = ({ action, onToolbarAction }) => {
  const visiblePred = action.visible;
  // A toolbar action is list-level: there is no row to bind, so the context is
  // the ambient predicate scope alone.
  const isVisible = useCondition(toPredicateInput(visiblePred), undefined, {
    throwOnError: true,
    label: `related-list toolbar action "${action.name}" (visible)`,
  });
  if (hasDeclaredVisibilityGate(visiblePred) && !isVisible) return null;
  const ActionIcon = action.icon ? resolveIconComponent(action.icon) : null;
  return (
    <Button
      variant={action.variant === 'primary' ? 'default' : 'outline'}
      size="sm"
      onClick={(e) => { e.stopPropagation(); void onToolbarAction(action); }}
      className="gap-1 h-9 sm:h-7 text-xs shadow-none"
      data-testid={`related-toolbar-action-${action.name}`}
    >
      {/* Dynamic icon resolution from Lucide, not component creation during render */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      {ActionIcon && <ActionIcon className="h-3.5 w-3.5" />}
      {action.label || action.name}
    </Button>
  );
};

/*
 * The two-shape field lookup and the ARITY VERDICT that used to live here are
 * now `@object-ui/core`'s `parent-scope` seam (`composeParentScopeFilter` /
 * `isMultiValueRelationship`), imported above.
 *
 * They moved because this component was never the only reader of the question.
 * The related-list tab BADGE compiles the same parent-relationship condition,
 * it kept sending bare equality after objectui#7299 taught this file to compile
 * by arity, and objectui#8882 is the result: a multi-value related list that
 * renders its rows above a tab with no count at all.
 *
 * ⛔ Do not reintroduce a local arity rule here, however small — the warning
 * that stood at this spot still stands, and now names one more reader. This
 * component decides `$contains` vs `=` and the badge decides too; readers of
 * one question disagreeing is the whole defect class. Moving the decision to a
 * shared seam is NOT "putting a local rule one layer up" — the rule is still
 * the spec's, and there is now exactly one caller of it.
 *
 * ⚠️ What the seam does NOT buy is agreement with STORAGE. This spot used to
 * add that the driver refusing the query decides on that same
 * `isMultiValueField`. It does not (objectui#8937): `driver-sql` gates the
 * equality family on its own storage question, which reads `multiple` as truthy
 * on ANY type, so the two rules diverge for `master_detail` / `tree` / `text`
 * carrying `multiple: true`. The measured rule, the divergence and the upstream
 * card that owns which of them is right (objectstack#17469) are recorded on the
 * seam itself — `@object-ui/core`'s `parent-scope` — so one place answers it.
 */

export const RelatedList: React.FC<RelatedListProps> = ({
  title,
  type,
  api,
  data,
  schema,
  columns,
  className,
  dataSource,
  objectName,
  onNew,
  newDisabled,
  onViewAll,
  onRowEdit,
  onRowDelete,
  onRowClick,
  rowActions,
  onRowAction,
  toolbarActions,
  onToolbarAction,
  add,
  redactFields,
  maxColumns = 6,
  pageSize,
  defaultSort,
  sortable = false,
  filter,
  filterable = false,
  collapsible = false,
  defaultCollapsed = false,
  referenceField,
  parentId,
  icon,
}) => {
  // Distinguish "caller did not provide data" (auto-fetch) from
  // "caller passed an empty array" (no related records — do not fetch).
  const dataProvided = data !== undefined;
  const initialData = data ?? [];
  const [relatedData, setRelatedData] = React.useState(initialData);
  // Start in loading state when we'll auto-fetch (api provided and caller
  // didn't pass data), so the empty state doesn't flash before the fetch
  // effect runs.
  const [loading, setLoading] = React.useState<boolean>(() => !!api && !dataProvided);
  const [currentPage, setCurrentPage] = React.useState(0);
  const [sortField, setSortField] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');
  const [filterText, setFilterText] = React.useState('');
  // Server-reported collection size / next-page hint (windowed fetch only —
  // see `windowed` below). `total` drives the count badge and page indicator;
  // `hasMore` keeps "Next" usable when a non-conforming backend omits `total`.
  const [total, setTotal] = React.useState<number | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  /**
   * The child object's definition, and whether the read for THIS `api` has
   * SETTLED: one piece of state, through the shared hook (objectui#10690).
   *
   * Read whenever it can be, not only on the auto-fetch path: it derives the
   * columns when none are authored, attaches type-aware cell renderers to the
   * ones that are (a `status` column draws a "Planned" badge, not `planned`),
   * and gives the arity, `$expand` and `$select` the row fetch sends.
   *
   * It sat in a local `useState` fed by its own effect, and the row fetch went
   * out before it landed, then again after it, whenever it moved the arity,
   * `expandKey` or `selectKey`. For a multi-valued relationship the first
   * query was the equality `driver-sql` refuses with `400 INVALID_FILTER`. The
   * fetch now waits on `ready`, the gate `ObjectMap` and `ObjectDataTable` use.
   *
   * ⚠️ The gate is only safe because the hook SETTLES ON EVERY EXIT: no
   * `dataSource`, no `getObjectSchema`, no `api`, and a read that threw all
   * settle with `def: null`, so rows are never held back by a definition that
   * is never coming. Pinned by the `SETTLES` cases in
   * `RelatedList.multiValueParentScope-7299.test.tsx`.
   */
  const { ready: objectSchemaReady, def: objectSchema } = useSettledSchema<any>(api ?? '', dataSource);
  // The host predicate scope a child row's declared deadline is judged in
  // (objectui#11815) — the scope the grid's cells read.
  const predicateScope = usePredicateScope();
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  // Add-by-picker (generic m2m/junction assignment). `refreshNonce` re-runs the
  // auto-fetch after an add/remove so the list reflects the new link rows.
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [addBusy, setAddBusy] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  // Per-lookup-field cache of resolved labels: fieldName -> Map<id, label>
  const [lookupLabels, setLookupLabels] = React.useState<Record<string, Record<string, string>>>({});
  const { t } = useDetailTranslation();
  const { fieldLabel: resolveFieldLabel } = useSafeFieldLabel();
  /**
   * Field-level security, read by every projection site: the `$expand` roots
   * the auto-fetch below asks the server to resolve, the `$select` it sends
   * (objectui#10186), and the column gate in `effectiveColumns` further down
   * (which is where this call used to sit — it was hoisted here,
   * unconditionally, so the fetch effect can name it).
   */
  const perms = usePermissions();

  /**
   * [ADR-0066 D4 / objectui#9782] The `list_toolbar` set this header may draw,
   * with `requiredPermissions` mirrored as a UI hide.
   *
   * `@objectstack/spec` declares the key as "enforced with 403 on the platform
   * action route (script/flow/modal + MCP) and **mirrored as a UI hide**". The
   * same bridge (`RelatedRecordActionsBridge.deriveActions`) feeds the child
   * object's `list_item` actions and these header buttons, and it filters on
   * `locations` alone — so before this the toolbar honoured `visible` and
   * nothing else, and an action declaring a capability the caller lacks
   * rendered one surface over from `EnvironmentListToolbar`, which hides it.
   * Third and last carrier of one declaration, after the data-table row menu
   * (objectui#9623) and `DeclaredActionsBar` (objectui#9572).
   *
   * ⛔ A UI MIRROR of a decision the SERVER still enforces, and nothing more:
   * the route still answers 403, the dispatch below is byte-identical either
   * way, and ⛔ no enforcement moves into the renderer. Unknown capabilities
   * fail OPEN (see `useCapabilityGate`) — an absent `systemPermissions` is not
   * a denial — while an EMPTY held set means "holds nothing" and gates
   * normally.
   *
   * ⭐ PLACEMENT is load-bearing, and it is why the filter sits in this body.
   * `useCapabilityGate` resolves the held set from the nearest
   * `ActionProvider` ABOVE its caller, and objectui#9572 measured what a gate
   * on the wrong side of that provider does: it reads a different provider, or
   * none, and fails open on every action forever with a green suite. Unlike
   * `DeclaredActionsBar`, this component mounts NO provider of its own — its
   * host chain is `RecordDetailView`'s `ActionProvider` →
   * `RelatedRecordActionsBridge` → `SchemaRenderer` → here — so this body and
   * the buttons it draws read one and the same provider, the one seeded with
   * the `user.systemPermissions` the engine reads.
   * `RelatedList.toolbarCapabilityGate-9782.test.tsx` supplies the held set
   * through that provider ALONE, so moving this filter out of the component
   * fails it.
   *
   * Applied ONCE over the set rather than inside `RelatedToolbarButton`, so
   * whatever the header derives from these actions and the buttons themselves
   * read one filtered source (the objectui#3562 invariant). ⚠️ Nothing in this
   * header currently counts them — the action row draws Add/New too, so a
   * wholly denied set leaves no orphan chrome today — and gating once is what
   * keeps that true if something starts counting.
   *
   * Composes with, and never replaces, the fail-CLOSED `visible` CEL each
   * button still evaluates: the two are ANDed, so the composition is MONOTONE
   * and can only ever hide more than before.
   */
  const mayInvoke = useCapabilityGate();
  const permittedToolbarActions = React.useMemo(
    () => (toolbarActions ?? []).filter((a) => mayInvoke(a?.requiredPermissions)),
    [toolbarActions, mayInvoke],
  );

  const effectivePageSize = pageSize && pageSize > 0 ? pageSize : 0;
  // The built-in contains-filter is a CLIENT-side sweep over the list's
  // unmasked columns (objectui#10728, `unmaskedColumnKeysKey`) — inexpressible
  // as a generic server filter. While the user is typing in it
  // (opt-in `filterable` consumers only) we drop back to the legacy
  // fetch-everything mode so the filter keeps seeing the whole collection.
  const filterActive = filterable && filterText !== '';
  // Windowed (server-paged) mode — issue #2711: on the auto-fetch path with
  // pagination enabled, ask the server for ONE page ($top/$skip) plus the
  // running total instead of dumping every child row into the browser.
  // Caller-provided `data` and the raw-URL fallback keep the historical
  // client-side slicing.
  const windowed =
    !dataProvided &&
    !!api &&
    effectivePageSize > 0 &&
    !!dataSource &&
    typeof dataSource.find === 'function' &&
    !filterActive;
  // Freeze paging/sort fetch inputs while not windowed so the fetch effect
  // doesn't re-run (and re-download the full collection) on page clicks or
  // column sorts that the client pipeline already handles in memory.
  const fetchPage = windowed ? currentPage : 0;
  const fetchSortField = windowed ? sortField : null;
  const fetchSortDirection = windowed ? sortDirection : 'asc';
  // Key the memo on content, not identity — inline `sort` arrays from schema
  // nodes would otherwise re-trigger the fetch effect every render.
  const defaultSortKey = JSON.stringify(defaultSort ?? null);
  const defaultSortSpec = React.useMemo(
    () => normalizeSortSpec(defaultSort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultSortKey],
  );
  // The list's own scope filter, lowered to an ObjectQL node once. Keyed on
  // CONTENT for the reason `defaultSortSpec` is: an inline `filter` array on a
  // schema node is a new identity every render, and this value is a dependency
  // of the fetch effect — keying on identity would refetch the collection on
  // every render. `undefined` means "nothing authored", so the query below stays
  // byte-identical to what it sent before this key had a read site.
  //
  // ⚠️ `toFilterNodeSafely`, not `toFilterNode` — objectui#9050. The lowering
  // refuses eleven authored shapes with a `FilterOperatorError`, and this is a
  // RENDER-time `useMemo`: a throw here is a render error, not a load error, so
  // no `classifyLoadError` ever sees it. The refusal is kept as a VALUE and
  // rendered below; it is deliberately NOT collapsed to `undefined`, which
  // would mean "no filter" and run this list unconstrained — the silent
  // widening objectui#9001 closed.
  //
  // objectui#10666 — the list's own `filter` is lowered AFTER every context
  // token in it (`{current_user_id}`, `{current_org_id}`, the date macros) is
  // resolved ONCE through `@object-ui/core`'s shared
  // `resolveFilterPlaceholders`, against the session scope the host provides,
  // and HELD by structure (`useResolvedFilter` in `@object-ui/react`). The list
  // merged the literal token into the parent scope before. The content key
  // below is taken over the held value, so a new signed-in user moves it and
  // re-queries, and a date macro such as `{now}` does not move it every render.
  const filterScope = useFilterScope();
  const scopeFilter = useResolvedFilter(filter, filterScope);
  const filterKey = JSON.stringify(scopeFilter ?? null);
  const listFilterResult = React.useMemo(
    () => toFilterNodeSafely(scopeFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey],
  );
  const filterRefusal = listFilterResult.ok ? undefined : listFilterResult.refusal;
  const listFilterNode = listFilterResult.ok ? listFilterResult.node : undefined;

  /**
   * The `$expand` roots for the auto-fetch below (objectui#10112).
   *
   * An ordinary list resolves a reference column by asking the SERVER to
   * expand it — `buildExpandFields` over the canonical reference-bearing
   * family in `@object-ui/core` — so the cell is handed the related record and
   * draws its display name. This list asked for no expansion at all, so every
   * reference column arrived as its bare foreign key. `lookup` and
   * `master_detail` survived that on the batch fallback further down;
   * `user` did not, because its cell has no resolver of its own, and the
   * stored `sys_user` id reached the DOM as if it were a name.
   *
   * The family is READ here, never restated: `user` is a member of it, and
   * that membership — not a type name written in this file — is why a `user`
   * column resolves once the expansion is requested.
   *
   * ⛔ The column restriction is resolved through THIS component's identity
   * spelling (`accessorKey` first, then `columnIdentity`), not through
   * `columnIdentity` alone. `buildExpandFields` decides that the caller
   * restricted the columns from the raw array's LENGTH, then keeps only the
   * names `columnIdentity` resolves — and `accessorKey` is not one of them. So
   * an authored `[{ accessorKey: 'owner_id' }]`, a shape this component
   * supports on every other path, would restrict the expansion to the empty
   * set and expand NOTHING, with no signal.
   *
   * With nothing authored the columns come from the child object's
   * `highlightFields` or the heuristic walk, neither of which is known before
   * the rows arrive — so no restriction is passed and every declared relation
   * is expanded, minus the parent FK, which `filterFK` removes from every
   * column list this component draws (expanding it could only pay for a
   * sub-read nothing renders).
   *
   * FLS gates the OUTPUT — the shape objectui#7215 / objectui#7230 ruled and
   * `DetailView` already uses. `$expand` asks the server to RESOLVE a
   * reference and return the related record, a strictly larger disclosure than
   * the bare key this fetch already receives. Gating the INPUT would WIDEN
   * rather than narrow, because an emptied column list reads as "no column
   * restriction"; gating the output also makes every name judged here one the
   * object DECLARES, so the "checkField answers false for an undeclared key"
   * trap is unreachable by construction.
   */
  const expandFields = React.useMemo(() => {
    const authored = Array.isArray(columns)
      ? columns
          .map((c: any) =>
            typeof c === 'string' ? c : c?.accessorKey || columnIdentity(c),
          )
          .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0)
      : [];
    const expandable = buildExpandFields(
      objectSchema?.fields,
      authored.length > 0 ? authored : undefined,
    ).filter((f) => f !== referenceField);
    const relatedObjectName = objectName || api || '';
    if (!perms?.isLoaded || !relatedObjectName) return expandable;
    return expandable.filter((f) => perms.checkField(relatedObjectName, f, 'read'));
  }, [columns, objectSchema, referenceField, objectName, api, perms]);
  /**
   * Content key for the fetch effect, for the same reason `defaultSortKey` and
   * `filterKey` above are one: the memo hands back a fresh array whenever
   * React discards its cache, and naming the array itself would refetch the
   * whole collection on a discard alone (commandment #10).
   *
   * The fetch effect waits for the child object's schema to settle
   * (objectui#10690), so the first query already asks for the roots it
   * yields. This key still changes, and the effect re-runs once, when an
   * input lands after that: the permission answer narrows the roots. A child
   * object with no expandable column keeps an empty key — `'' -> ''` is not a
   * change.
   */
  const expandKey = expandFields.join(',');

  /**
   * [objectui#9053] The redaction list as a lookup, memoised on the PROP's
   * identity so `effectiveColumns` keeps the reference-stable dependency the
   * rest of this file is built around: a caller that passes no list passes
   * `undefined`, which never changes, and one that passes its authored array
   * passes it by reference. Declared up here because the `$select` projection
   * below reads it too.
   */
  const redactedFields = React.useMemo(
    () =>
      new Set(
        (Array.isArray(redactFields) ? redactFields : []).filter(
          (f): f is string => typeof f === 'string' && f.length > 0,
        ),
      ),
    [redactFields],
  );

  /**
   * The `$select` projection for the auto-fetch below (objectui#10186) — the
   * SELECT half of the pair objectui#10112 opened with `$expand`, ruled "per
   * that precedent": objectui#6898's field-level security on the projection,
   * which `ListView` and `ObjectGrid` already send.
   *
   * Without it this list asked for every field of every child row and dropped
   * a denied one only at the column layer, so the value still crossed the wire
   * into `relatedData`. Graded as objectui#6898 graded it: against ObjectStack
   * nothing leaks today, because `plugin-security`'s `FieldMasker.maskRecord`
   * deletes an unreadable key from every returned row; the projection is
   * defence in depth there, and load-bearing for a backend that does not strip.
   *
   * WHAT IT ASKS FOR, each member mirroring the precedent:
   *
   *  - the authored columns that survive the SAME three gates `effectiveColumns`
   *    applies before it draws them (redaction, the parent key, FLS) — the
   *    shared functions above, so what is requested and what is drawn cannot
   *    disagree about a column;
   *  - `id`, unconditionally, as both precedents send it: row click, Edit,
   *    Delete and every row action resolve the record through it;
   *  - the `$expand` roots, already FLS-gated at their own site — a root the
   *    projection omitted would have no key to resolve;
   *  - the fields the row PREDICATES read (objectui#3501): the child object's
   *    `userActions` Edit/Delete overrides, its actions and the host's row
   *    actions, harvested by core's one reader. A predicate operand no column
   *    shows would otherwise be absent from the row, and CEL faults on an
   *    absent key, which fails the row menu CLOSED for everyone. Each operand
   *    must be a field the object declares or a platform column (an unknown
   *    `$select` key zeroes the list on backends that reject it), and a
   *    DECLARED one must pass FLS — `ObjectGrid`'s `passesProjectionGate`
   *    order. Nothing is harvested without the child schema, because
   *    nothing can be validated; the fetch waits for it to settle
   *    (objectui#10690), so the first query carries the operands;
   *  - the mobile card gallery's cover (`MOBILE_GALLERY_COVER_FIELD`), which
   *    no column shows and the gallery reads off every row — through the same
   *    declared-and-readable gate, once the child schema has landed.
   *
   * ⛔ `pruneEmpty` is NOT applied: it judges emptiness from the rows this
   * request fetches, so the projection is taken before it — it only ever
   * removes a column, never adds one.
   *
   * ⭐ `undefined` — no projection, the request byte-identical to before — on
   * every path that DERIVES its columns: no authored `columns`, or redaction
   * emptied them, so `highlightFields` or the field walk decides. Those
   * columns are not known before the fetch: both choose among their
   * candidates by the emptiness of the rows fetched (the walk prunes and then
   * caps at `maxColumns`; `highlightFields` falls through to the walk when
   * every highlight is empty). That path is the design question objectui#10186
   * left open, and it is not answered here. An authored list whose every
   * column FLS denies is NOT that path: it still projects, to `id` and what
   * its row predicates need, rather than reading an emptied column list as
   * "no restriction" — the widening objectui#7215 measured on `$expand`.
   */
  const selectFields = React.useMemo((): string[] | undefined => {
    const authored = dropRedactedColumns(Array.isArray(columns) ? columns : [], redactedFields);
    if (authored.length === 0) return undefined;
    const relatedObjectName = objectName || api || '';
    const projection = new Set<string>(['id']);
    const drawnKeys: string[] = [];
    for (const col of keepReadableColumns(dropParentKeyColumn(authored, referenceField), perms, relatedObjectName)) {
      const key = drawnColumnKey(col);
      if (key) {
        projection.add(key);
        drawnKeys.push(key);
      }
    }
    for (const root of expandFields) projection.add(root);
    const fields = objectSchema?.fields;
    if (fields && typeof fields === 'object') {
      const readable = (field: string): boolean =>
        !perms?.isLoaded || !relatedObjectName || perms.checkField(relatedObjectName, field, 'read');
      // A drawn declared deadline's `settledWhen` (objectui#11815) reads the
      // row like a row predicate does, so its operands ride the same gates.
      const settledWhens = drawnKeys
        .map((key) => parentRelationshipFieldDef(fields, key) as { dueLike?: unknown; settledWhen?: unknown } | undefined)
        .filter((def) => def?.dueLike === true && def.settledWhen != null)
        .map((def) => def!.settledWhen);
      const operands = collectPredicateFieldRefs([
        ...listViewPredicates({
          rowActionDefs: rowActions,
          objectActions: objectSchema?.actions,
          userActions: objectSchema?.userActions,
        }),
        ...settledWhens,
      ]);
      for (const field of operands) {
        // Declared — looked up in EITHER container shape the metadata API
        // serves (the Record, or the array of named defs), because a reader
        // that knows only the Record would call every operand of an
        // array-shaped schema undeclared and drop it — or one of the platform
        // columns every object carries and none declares. That is core's
        // `isProjectableField` rule, read across both shapes.
        const declared = parentRelationshipFieldDef(fields, field) !== undefined;
        if (!declared && !PLATFORM_RECORD_COLUMNS.has(field)) continue;
        if (declared && !readable(field)) continue;
        projection.add(field);
      }
      // The mobile card gallery's cover: no column shows it, but the gallery
      // reads it off every row. Asked for when the child DECLARES it (either
      // container shape) and FLS allows it — on every viewport, not only on
      // mobile, so crossing the breakpoint never changes the key below and
      // never refetches the list.
      if (parentRelationshipFieldDef(fields, MOBILE_GALLERY_COVER_FIELD) !== undefined
          && readable(MOBILE_GALLERY_COVER_FIELD)) {
        projection.add(MOBILE_GALLERY_COVER_FIELD);
      }
    }
    return Array.from(projection);
  }, [columns, redactedFields, referenceField, objectName, api, perms, expandFields, objectSchema, rowActions]);
  /**
   * Content key for the fetch effect, for the reason `expandKey` is one
   * (commandment #10). It also carries the projection onto the wire when an
   * input lands late: the permission answer (`/me/permissions` resolves
   * asynchronously, so the first request can go out before a denied column is
   * known — the same deferral as `ObjectGrid`). The child schema is not such
   * an input: the fetch waits for it to settle (objectui#10690). A
   * derived-columns list keeps `''` and re-runs exactly as often as it did
   * before.
   */
  const selectKey = selectFields ? selectFields.join(',') : '';

  // Sync internal state when data prop changes (e.g., parent fetches async data)
  React.useEffect(() => {
    if (dataProvided) {
      setRelatedData(data ?? []);
    }
  }, [data, dataProvided]);

  // ARITY of the parent-relationship field, read off the child object's own
  // schema above (objectui#7299). `false` unless that schema PROVES otherwise.
  // The fetch below waits for the schema to settle (objectui#10690), so a
  // multi-valued list sends the membership spelling on its first query. With no
  // schema to read — no `getObjectSchema`, or a read that threw — the schema
  // settles as `null` and this stays `false`: the list still fetches, with the
  // equality form, rather than holding its rows back.
  //
  // ⛔ The gate is on "settled", never on "a schema loaded". Waiting for a
  // schema would strand the rows of every related list whose `DataSource` has
  // no `getObjectSchema` or whose read rejects.
  // The seam's verdict, not a second reading of the metadata: the query below
  // and this flag must never be able to disagree about the arity, which is the
  // defect objectui#8882 records when two call sites each decide for themselves.
  const referenceFieldIsMultiValue = React.useMemo(
    () => isMultiValueRelationship(objectSchema?.fields, referenceField),
    [objectSchema, referenceField],
  );

  // Add-picker target schema, fetched lazily on first open. It drives the
  // picker's display column (`add.picker.labelField` → displayField), the
  // auto-derived multi-column layout, and type-aware cell rendering — without
  // it the dialog fell back to a single title-cased NAME column showing
  // machine names even though the page metadata declared `labelField: 'label'`
  // (#3365).
  const pickerObject = add?.picker?.object;
  const [pickerSchema, setPickerSchema] = React.useState<any>(null);
  React.useEffect(() => {
    if (!pickerOpen || !pickerObject || pickerSchema || !dataSource?.getObjectSchema) return;
    let cancelled = false;
    dataSource.getObjectSchema(pickerObject).then((s: any) => {
      if (!cancelled) setPickerSchema(s);
    }).catch((err: unknown) => {
      console.warn(`[RelatedList] Failed to fetch schema for ${pickerObject}:`, err);
    });
    return () => { cancelled = true; };
  }, [pickerOpen, pickerObject, pickerSchema, dataSource]);
  const pickerDisplayField = add?.picker?.labelField || 'name';
  const pickerColumns = React.useMemo(() => {
    const derived = deriveLookupColumns(pickerSchema, { displayField: pickerDisplayField });
    return derived.length > 0 ? derived : undefined;
  }, [pickerSchema, pickerDisplayField]);

  // Developer hint for an `add` that cannot be honoured (#3838). `picker` is
  // REQUIRED on `add` by the spec (`RecordRelatedListProps.add`), so getting
  // here means the page metadata is off-spec — but nothing on the render path
  // parses it (the sdui-parser manifest gate compares top-level key names and
  // coarse types only), so the renderer is the first place able to say so. It
  // says WHICH key is missing, because the failure it replaces — a bare
  // `add.picker.object` read that threw and made SchemaRenderer swap the whole
  // list for a "failed to render" card — never mentioned `picker` at all.
  // Console-only, matching the in-file hint for the other partial
  // misconfiguration (`no referenceField/parentId` below): the block-level
  // dashed placeholder precedent in `renderers/record-related-list.tsx` is for
  // blocks that can render NOTHING (missing objectName), whereas here only the
  // Add affordance is unconfigured and the list body is perfectly fine.
  React.useEffect(() => {
    if (!add || pickerObject) return;
    console.warn(
      `[RelatedList] "${api || objectName || 'related list'}" declares add without add.picker.object — the Add affordance is not rendered. add.picker is required by the spec (RecordRelatedListProps.add): set add.picker.object to the object the picker should list.`,
    );
  }, [add, pickerObject, api, objectName]);

  React.useEffect(() => {
    // Stale-response guard: page flips re-run this effect while an earlier
    // window may still be in flight — a slow page-2 response must not
    // overwrite page 3 after the fact.
    let cancelled = false;
    // A refused filter never reaches the wire (objectui#9050). The render
    // below shows the malformed-filter state instead, and this early return is
    // what keeps "no filter node" from being read as "no filter" by the query
    // builder further down.
    if (filterRefusal) {
      setLoading(false);
      return;
    }
    // Only auto-fetch when the caller didn't pass `data` at all. If the parent
    // explicitly passed an empty array, that means "no related records" — we
    // must NOT fall back to fetching all rows of the API (which would surface
    // unrelated data and confuse users).
    if (api && !dataProvided) {
      // Bug guard: if we don't know how to scope the query to the current
      // parent, the unfiltered fetch would dump the entire target object.
      // Render an explicit empty state instead — better than wrong data.
      const canScope = !!referenceField && parentId !== undefined && parentId !== null && parentId !== '';
      if (!canScope) {
        if (api && (parentId === undefined || parentId === null || parentId === '') && !referenceField) {
          // Developer hint: only surface in console once per mount.
          console.warn(
            `[RelatedList] "${api}" has no referenceField/parentId — refusing to fetch all rows. Pass relationshipField + parentId to scope the query.`,
          );
        }
        setRelatedData([]);
        setTotal(null);
        setHasMore(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      // ⭐ objectui#10690: the child definition GATES this query; it does not
      // refine it afterwards. The arity, `$expand` and `$select` below all read
      // it, so a query sent before it settles is one this effect would send
      // again. `objectSchemaReady` in the dependency list re-runs the effect
      // when it settles, and this return stops the run before that from
      // spending a query. Removing either half restores the double read, or
      // strands the rows. The loading placeholder is held while it waits.
      if (!objectSchemaReady) return;
      // The parent-relationship condition, compiled to match the field's ARITY
      // (objectui#7299). A multi-valued relationship asks a MEMBERSHIP question
      // — "is this parent among the stored values" — and `$contains` is the
      // spelling the drivers execute for it, the one `driver-sql` names in the
      // `400 INVALID_FILTER` it answers the equality form with. Single-valued
      // keeps `=`, unchanged. The author never writes either: they named a
      // relationship, and its storage form is this component's business.
      const parentScope = composeParentScopeFilter(
        referenceField!,
        parentId!,
        objectSchema?.fields,
      ) as Record<string, any>;
      // Parent relationship AND the list's own scope (objectstack#7118). The
      // parent condition is never negotiable — an "additional" criterion may only
      // narrow this parent's children — and with nothing authored the query is
      // the untouched MongoDB-style object it has always been, rather than a
      // freshly lowered AST that means the same thing (the difference is
      // invisible on screen and visible to every caller pinning the wire).
      const queryFilter =
        listFilterNode === undefined
          ? parentScope
          : mergeFilterNodes(parentScope, listFilterNode);
      if (dataSource && typeof dataSource.find === 'function') {
        const params: Record<string, any> = { $filter: queryFilter };
        // Resolve reference columns server-side, the way every other list in
        // the tree does (objectui#10112). Omitted entirely when there is
        // nothing to expand, so a child object with no reference column sends
        // the byte-identical query it always sent.
        if (expandFields.length > 0) params.$expand = expandFields;
        // Ask only for what the principal may read and the list draws or its
        // row predicates read (objectui#10186). Omitted on a derived-columns
        // list — see `selectFields` for why that path sends no projection.
        if (selectFields) params.$select = selectFields;
        if (windowed) {
          params.$top = effectivePageSize;
          params.$skip = fetchPage * effectivePageSize;
          // A user column sort becomes a server $orderby so ordering stays
          // global across pages; otherwise the schema's declared `sort` wins.
          const orderby = fetchSortField
            ? [{ field: fetchSortField, order: fetchSortDirection }]
            : defaultSortSpec;
          if (orderby.length > 0) params.$orderby = orderby;
        }
        dataSource.find(api, params).then((result) => {
          if (cancelled) return;
          const isArrayResult = Array.isArray(result);
          const items = isArrayResult
            ? (result as any[])
            : Array.isArray((result as any)?.data)
              ? (result as any).data
              : [];
          setRelatedData(items);
          if (windowed) {
            const reportedTotal = !isArrayResult && typeof (result as any)?.total === 'number'
              ? (result as any).total as number
              : null;
            setTotal(reportedTotal);
            // Prefer the server's own hint; a full page implies "maybe more"
            // when the backend reports neither total nor hasMore.
            setHasMore(
              !isArrayResult && typeof (result as any)?.hasMore === 'boolean'
                ? (result as any).hasMore as boolean
                : items.length === effectivePageSize,
            );
          } else {
            setTotal(null);
            setHasMore(false);
          }
          setLoading(false);
        }).catch((err) => {
          console.error('Failed to fetch related data:', err);
          if (!cancelled) setLoading(false);
        });
      } else if (listFilterNode !== undefined) {
        // No adapter — the legacy raw-URL path, whose query language is
        // `filter[<field>]=<value>` and cannot carry an operator, let alone a
        // rule array. Dropping the authored filter here would answer with MORE
        // rows than the metadata asked for, silently: the exact class this key's
        // wiring exists to remove (objectstack#7118), so it refuses and says so
        // instead. Empty-and-loud beats wider-and-quiet; the guard above refuses
        // an unscoped fetch on the same reasoning.
        console.warn(
          `[RelatedList] "${api}" declares a filter but has no dataSource adapter — the raw-URL fallback cannot express it, so no rows are fetched. Pass a dataSource (RecordContext) to use a filtered related list.`,
        );
        setRelatedData([]);
        setTotal(null);
        setHasMore(false);
        setLoading(false);
      } else if (referenceFieldIsMultiValue) {
        // The same refusal as the arm above, one cause earlier: this path's
        // `filter[<field>]=<value>` grammar has no MEMBERSHIP operator, so the
        // condition a multi-value relationship needs cannot be written here at
        // all (objectui#7299).
        //
        // Measured, not assumed. The repo's one operator contract for this
        // spelling is `drillUrlFilters`' `URL_FILTER_OPS` (objectstack-ai/objectstack#1752) — `gte`,
        // `lte`, `gt`, `lt` and nothing else — and its parser DROPS an
        // unrecognised suffix rather than downgrading it, so a hopeful
        // `filter[<field>][contains]=` would arrive as no condition whatsoever:
        // an unscoped fetch of the entire child table, exactly what the guard
        // above exists to prevent. The platform's own REST surface does not
        // take this bracket form at all — it reads one `filter=<JSON AST>`
        // param — so there is no third spelling to reach for either.
        //
        // That leaves bare `=`, which is this card's defect. Empty-and-loud
        // beats both a predicate known to be wrong and a silent full-table
        // scan.
        console.warn(
          `[RelatedList] "${api}" relates through the multi-value field "${referenceField}" but has no dataSource adapter — the raw-URL fallback's \`filter[<field>]=<value>\` grammar has no membership operator, so no rows are fetched. Pass a dataSource (RecordContext) to use a related list on a multi-value relationship field.`,
        );
        setRelatedData([]);
        setTotal(null);
        setHasMore(false);
        setLoading(false);
      } else {
        const qs = new URLSearchParams({
          [`filter[${referenceField}]`]: String(parentId),
        }).toString();
        fetch(`${api}?${qs}`)
          .then(res => res.json())
          .then(result => {
            if (cancelled) return;
            const items = Array.isArray(result) ? result : (result?.data || []);
            setRelatedData(items);
            setTotal(null);
            setHasMore(false);
          })
          .catch(err => {
            console.error('Failed to fetch related data:', err);
          })
          .finally(() => { if (!cancelled) setLoading(false); });
      }
    }
    return () => {
      cancelled = true;
    };
    // objectui#6697 — keyed on the two CONTENT strings, not on the memoised
    // objects they produce. `useMemo` is a pure optimisation, not a
    // correctness dependency: React may discard a cache and recompute even
    // when the deps compare equal, and `normalizeSortSpec`/`toFilterNode`
    // both hand back a FRESH value on every call (a new array; a freshly
    // lowered AST). Naming `defaultSortSpec`/`listFilterNode` here therefore
    // re-ran this effect — and re-fetched the whole collection — on a discard
    // alone, with nothing an author or a caller controls having changed. The
    // body still reads the memoised values; only the re-run condition moves,
    // onto the very keys the memos are already keyed on, so a content change
    // still refetches exactly as before.
    //
    // `referenceFieldIsMultiValue` belongs here for the same reason the two
    // relationship keys beside it do: it decides WHICH predicate this effect
    // sends (objectui#7299). It is a boolean, so a single-valued list re-runs
    // exactly as often as it did before — false → false is not a change.
    //
    // `expandKey` is the CONTENT of `expandFields` for the reason
    // `defaultSortKey` / `filterKey` are the content of their memos; see the
    // key's own comment above. `selectKey` is the same thing for the `$select`
    // projection (objectui#10186).
    //
    // `objectSchemaReady` is the gate's other half (objectui#10690): a boolean,
    // compared by value, that re-runs the effect when the child definition
    // settles. The definition itself reaches the query through `expandKey`,
    // `selectKey` and the arity flag, never named here by identity
    // (commandment #10).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, dataProvided, dataSource, referenceField, referenceFieldIsMultiValue, parentId, refreshNonce, windowed, effectivePageSize, fetchPage, fetchSortField, fetchSortDirection, defaultSortKey, filterKey, expandKey, selectKey, objectSchemaReady]);

  // Windowed mode: a page beyond the (shrunken) collection — e.g. the last
  // row of the last page was just deleted — comes back empty. Step back one
  // page instead of stranding the user on an empty window.
  React.useEffect(() => {
    if (!windowed || loading) return;
    if (currentPage > 0 && relatedData.length === 0) {
      setCurrentPage((p) => Math.max(0, p - 1));
    }
  }, [windowed, loading, relatedData, currentPage]);

  // A different parent (or relationship, or list scope) is a different
  // collection — restart from the first page. `filterKey` belongs here for the
  // same reason the other three do: page 3 of the unfiltered children is not
  // page 3 of the filtered ones.
  React.useEffect(() => {
    setCurrentPage(0);
  }, [api, referenceField, parentId, filterKey]);

  // Refetch when a mutation elsewhere signals this related object changed —
  // e.g. a child row action executed through the host retargets `api` and
  // dispatches `objectui:related-changed`. Only meaningful on the auto-fetch
  // path (parent-provided data is refreshed by the parent).
  //
  // `'*'` is the invalidation bus's "unknown scope — everything is stale"
  // wildcard (undo of an unknown operation, the record header's manual ⟳ in
  // objectui#3460): it must match EVERY list, exactly as `dataChangeMatches` in
  // `@object-ui/react` already does for the bus's own readers. A concrete
  // object name still has to be this list's own — a write to some other object
  // is not a reason to refetch here.
  React.useEffect(() => {
    if (!api || dataProvided) return;
    const onChanged = (ev: Event) => {
      const detail = (ev as CustomEvent).detail || {};
      if (detail.objectName && detail.objectName !== '*' && detail.objectName !== api) return;
      setRefreshNonce((n) => n + 1);
    };
    window.addEventListener('objectui:related-changed', onChanged as EventListener);
    return () => window.removeEventListener('objectui:related-changed', onChanged as EventListener);
  }, [api, dataProvided]);

  // Resolve reference-field display labels by batch-fetching referenced
  // records. For each reference-bearing column whose data is a primitive ID,
  // gather unique IDs and fetch them in one round trip per target object. The
  // resulting id → name map is exposed via `options` on the field meta so
  // the existing LookupCellRenderer renders a friendly label instead of the
  // raw ID; a `user` column has no `options` reader, so `makeCell` folds the
  // resolved name into the VALUE it hands that cell instead.
  //
  // [objectui#10112] The membership test is the canonical reference-bearing
  // family, not a private `lookup`/`master_detail` disjunction. That
  // disjunction named two of the family's four members, so a `user` column
  // holding a primitive id was never gathered here and never resolved
  // anywhere else either — the raw `sys_user` id was what the cell drew. This
  // is the FALLBACK half: the auto-fetch above now asks the server to expand
  // the same family, so this path runs for data a CALLER supplied, and for a
  // backend that does not honour `$expand`.
  React.useEffect(() => {
    if (!dataSource?.find || !objectSchema?.fields || !relatedData.length) return;
    const fields = objectSchema.fields as Record<string, any>;
    const tasks: Array<{ fieldName: string; target: string; ids: string[] }> = [];
    for (const [fieldName, def] of Object.entries(fields)) {
      if (!isExpandableFieldType(def)) continue;
      // objectui#6837 half 2 — maintainer 2026-08-31: protocol normalization
      // belongs on the SERVER, the front end just executes the protocol.
      // `reference` is the only target spelling `@objectstack/spec`'s
      // `FieldSchema` declares; it refuses `reference_to` by name with its own
      // "did you mean -> `reference`?" rename. objectstack#13847 rewrites
      // stored `reference_to` on the serve path and in `os migrate meta`. A
      // legacy-only def is canonicalised ONCE at the ingestion choke point
      // (`normalizeSchemaReferenceKeys`, which warns in dev) — never here.
      const target = def.reference;
      if (!target) continue;
      const ids = new Set<string>();
      for (const row of relatedData) {
        const v = row?.[fieldName];
        if (v == null) continue;
        if (typeof v === 'string' && v) ids.add(v);
        else if (typeof v === 'number') ids.add(String(v));
      }
      // Skip ids already cached
      const cached = lookupLabels[fieldName] || {};
      const missing = Array.from(ids).filter((id) => !(id in cached));
      if (missing.length > 0) tasks.push({ fieldName, target, ids: missing });
    }
    if (tasks.length === 0) return;
    let cancelled = false;
    Promise.all(
      tasks.map(({ fieldName, target, ids }) =>
        Promise.all([
          dataSource.find(target, { $filter: { id: { $in: ids } }, $top: ids.length }),
          // Target object's schema (nameField / titleFormat) so the batch map
          // resolves display names through the same ADR-0079 resolver as the
          // cell's own fetch — see resolveRelatedLookupLabel (objectui#3330).
          typeof dataSource.getObjectSchema === 'function'
            ? dataSource.getObjectSchema(target).catch(() => undefined)
            : Promise.resolve(undefined),
        ])
          .then(([res, refSchema]: [any, any]) => {
            const records: any[] = Array.isArray(res) ? res : res?.data || [];
            const map: Record<string, string> = {};
            for (const r of records) {
              const id = r?.id || r?._id;
              if (!id) continue;
              map[String(id)] = resolveRelatedLookupLabel(r, refSchema) ?? String(id);
            }
            return { fieldName, map };
          })
          .catch((err: unknown) => {
            console.warn(`[RelatedList] Failed to resolve lookups for ${fieldName}:`, err);
            return { fieldName, map: {} as Record<string, string> };
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setLookupLabels((prev) => {
        const next = { ...prev };
        for (const { fieldName, map } of results) {
          next[fieldName] = { ...(next[fieldName] || {}), ...map };
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // Intentionally exclude `lookupLabels` from deps: we add to the cache and
    // would otherwise loop. We dedupe via the `missing` check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, objectSchema, relatedData]);

  // Confirm-delete dialog state. Replaces window.confirm() so the related
  // list matches the rest of the app's Shadcn AlertDialog UX.
  const [deleteTarget, setDeleteTarget] = React.useState<any | null>(null);

  const handleDeleteRow = React.useCallback((row: any) => {
    setDeleteTarget(row);
  }, []);

  const handleConfirmDelete = React.useCallback(async () => {
    if (deleteTarget) {
      try {
        await onRowDelete?.(deleteTarget);
        setRefreshNonce((n) => n + 1); // reflect the removal
      } catch (err) {
        console.error('[RelatedList] remove failed', err);
      }
    }
    setDeleteTarget(null);
  }, [deleteTarget, onRowDelete]);

  /**
   * May the caller Add existing here? The write's row of the affordance-to-grant
   * map (`resolveAffordance` in `@object-ui/core`, objectui#12082), asked of the
   * object the write goes to:
   *
   *  - with a `linkField` the picked records become link rows of THIS list's
   *    object (`api`, the junction) — a create of the child, `relatedNew`, the
   *    row the list's "+ New" reads;
   *  - without one the picked record itself is re-parented — an update of the
   *    picked object (`picker.object`), `relatedRowEdit`, the row a related
   *    list row's Edit reads.
   *
   * The button and its dialog are withheld when the row is closed: the server
   * refuses that write for this caller. With no permission provider every
   * grant reads open, as before.
   */
  const addGranted = !add
    ? false
    : add.linkField
      ? resolveAffordance('relatedNew', { objectSchema, objectName: api, perms }).allowed
      : resolveAffordance('relatedRowEdit', {
          objectSchema: add.picker?.object === api ? objectSchema : null,
          objectName: add.picker?.object,
          perms,
        }).allowed;

  // Add existing records via picker → create link rows (junction) or re-parent
  // (1:m). Server-side insert rules (e.g. the AI-seat cap) surface inline.
  const handleAddRecords = React.useCallback(async (records: any[]) => {
    if (!add || !dataSource || !api || referenceField == null || parentId === undefined || parentId === null) return;
    const vf = add.picker.valueField || 'id';
    setAddBusy(true);
    setAddError(null);
    try {
      for (const rec of records || []) {
        const pickedId = rec?.[vf] ?? rec?.id;
        if (pickedId == null) continue;
        if (add.linkField) {
          await (dataSource as any).create?.(api, { [referenceField]: parentId, [add.linkField]: pickedId });
        } else {
          await (dataSource as any).update?.(add.picker.object, String(pickedId), { [referenceField]: parentId });
        }
      }
      setRefreshNonce((n) => n + 1);
    } catch (err: any) {
      const raw = err?.body?.error ?? err?.error ?? err?.message ?? String(err);
      setAddError(typeof raw === 'string' ? raw : 'Failed to add');
    } finally {
      setAddBusy(false);
      setPickerOpen(false);
    }
  }, [add, dataSource, api, referenceField, parentId]);

  // Generate effective columns from explicit prop or object schema fields.
  // Behavior:
  //  - Hide the parent FK column (already implicit context).
  //  - Skip image and large-blob fields that bloat row height.
  //  - Skip fields with no visible value across the current rows.
  //  - Prefer name-like fields (name, title, subject, ...) first.
  //  - Cap at `maxColumns` to keep the related card readable; users can
  //    click "View All" to see the full list.
  const effectiveColumns = React.useMemo(() => {
    const relatedObjectName = objectName || api || '';
    // FLS: drop columns the current user cannot read on the related object.
    // The gate is shared with the `$select` projection (objectui#10186).
    const filterFLS = (cols: any[]): any[] => keepReadableColumns(cols, perms, relatedObjectName);
    const filterFK = (cols: any[]): any[] => dropParentKeyColumn(cols, referenceField);

    /**
     * [objectui#9053] Redaction — the block-level authoring preference, asked
     * on EVERY path below rather than only over the authored array.
     *
     * Identity is resolved the way this component resolves it everywhere else
     * (`accessorKey || columnIdentity`), because that is the key it RENDERS
     * through: filtering on any other reading would leave a column refused by
     * name and drawn by accessor.
     *
     * ⛔ Fail-OPEN on a column it cannot name, exactly like `filterFLS` beside
     * it. Whether an entry whose identity does not resolve should be kept or
     * dropped is objectui#8793's question, not this one, and answering it here
     * would fold two policies into one diff.
     */
    const isRedacted = (key: unknown): boolean =>
      redactedFields.size > 0 && !!key && redactedFields.has(String(key));
    const filterRedacted = (cols: any[]): any[] => dropRedactedColumns(cols, redactedFields);

    /**
     * Does this cell have nothing to show? **THE** definition of emptiness on
     * this surface (objectui#8459), read by BOTH places that decide what the
     * reader sees:
     *
     *  - `pruneEmpty`, which drops a COLUMN whose every cell is empty;
     *  - the placeholder branch of `makeCell`, which draws the muted em-dash
     *    for an individual CELL.
     *
     * The two MUST agree, because one is defined in terms of the other:
     * `pruneEmpty` keeps a column when `.some()` cell is not empty, and that
     * promise ("a column you can see has something in it") is only true when
     * "empty" means the same thing as "this cell draws the placeholder".
     * They did not agree. The cell branch tested `null | undefined` alone, so
     * the two clauses below that it lacked — whitespace-only strings and empty
     * arrays — were pruned at the column level and rendered as *visually blank
     * cells* in any column that survived because some other row had a value.
     * Measured in real DOM: a `note` column holding `['   ', 'real']` kept its
     * header and painted the first cell with three spaces, where the very same
     * function draws `—` for `null`.
     *
     * ## Why this does NOT delegate to `DetailSection`'s `hasCellValue`
     *
     * ⚠️ objectui#8496 put the four members BOTH functions share into
     * `@object-ui/core`'s `isEmptyValue` and had each call it. That is a shared
     * FLOOR, not a merge: this predicate and `hasCellValue` stay two functions
     * on purpose, because a grid COLUMN and a record ROW ask the question at two
     * granularities, and objectui#8459 measured this one as the better-shaped
     * answer here. ⛔ Do not "finish the job" by deleting one of them.
     *
     * Measured, not assumed. `hasCellValue` answers `true` for every non-null
     * `object`, and `typeof [] === 'object'` — so it calls an EMPTY ARRAY a
     * VALUE. This surface calls it empty, and that is the answer a grid needs:
     * `SelectCellRenderer` maps `[]` over zero options and paints nothing, so
     * an all-`[]` column pruned here would instead survive and render a column
     * of blank cells. Delegating would therefore *introduce* the defect this
     * function exists to remove. The two surfaces agree on every scalar (both
     * trim) and on non-empty objects (both VALUE, so type-aware renderers keep
     * drawing coordinates, addresses and badges); they differ only on `[]`,
     * and here the finer line is the right one.
     *
     * `0` and `false` are VALUES on both — no clause below matches them.
     *
     * Pinned end-to-end (DOM, not predicate) in
     * `__tests__/RelatedList.emptinessAgreement-8459.test.tsx`.
     */
    const isValueEmpty = (v: any) =>
      // THE FLOOR, asked by name (objectui#8496): `null`, `undefined`, `''`,
      // `[]`. Those four are no longer spelled here.
      isEmptyValue(v) ||
      // THE EXTENSION, and the only one: a WHITESPACE-ONLY string is empty in a
      // grid cell. It is not a floor member because the gallery, the kanban and
      // the shared cell renderers all keep `'   '` a value; only this surface
      // and `record:details` trim, each for the reason objectui#8350 measured.
      (typeof v === 'string' && v.trim() === '');

    const pruneEmpty = (cols: any[]): any[] => {
      if (!relatedData.length) return cols;
      return cols.filter((c) => {
        const key = c?.accessorKey || columnIdentity(c);
        if (!key) return true;
        return relatedData.some((r) => !isValueEmpty(r?.[key]));
      });
    };

    // Build a type-aware cell renderer for a field — so select options resolve
    // to friendly labels/badges, lookups to names, currency/date to formatted
    // values, etc. Shared by BOTH the explicit-columns path and the
    // auto-derived path so a `status` column reads "Planned" (badge), never the
    // raw `planned`, regardless of how the columns were supplied.
    const makeCell = (key: string, def: any): ((value: any, row?: Record<string, unknown>) => any) | undefined => {
      // ⛔ A column whose field carries no `type` gets NO cell — and therefore
      // none of the objectui#8459 placeholder below. That boundary is
      // DELIBERATE, and objectui#8477 is the card that measured it and chose to
      // write it down here rather than close it.
      //
      // THE GAP, stated honestly: `pruneEmpty` above judges this very column
      // with the full `isValueEmpty`, so a column survives because *some other
      // row* has a value — and this row's whitespace-only cell then paints
      // visually blank, the exact UI the em-dash below exists to prevent,
      // reached through the one door that never gets a cell. Measured: an
      // undeclared `memo` column holding `'   '` renders a blank `div.truncate`
      // while its sibling row renders `real memo`.
      //
      // ⚠️ WHY "just attach a minimal cell here" IS NOT A SHORTCUT — IT SHIPS A
      // CRASH. The data-table's no-cell branch is not a pass-through: with no
      // `cell` it applies TWO transforms — `String(value)` for a non-null
      // object, and `formatCellValue(value)`, the locale ISO date/datetime face
      // objectui#7443 and the card behind `c15d7eca6` spent two cards folding into ONE home —
      // whereas a `cell`'s return value is handed STRAIGHT to React, with no
      // way to defer any single value back to that default. Measured on one
      // untyped column, same row, `tbody` innerHTML byte for byte, no-cell
      // versus a cell returning its argument unchanged:
      //
      //   `real memo` / `0` / `false`   identical
      //   ISO date `2026-07-04`         `Jul 4`                 becomes `2026-07-04`
      //   ISO datetime                  `Mar 5, 2024, 02:30 PM` becomes the raw ISO string
      //   array `['a','b']`             `a,b`                   becomes `ab`
      //   object `{latitude,longitude}` `[object Object]`       THROWS
      //                                 "Objects are not valid as a React child"
      //
      // The object row is not a rendering difference, it is a crash — and
      // untyped columns rendering `[object Object]` are precisely the
      // population such a cell reaches first.
      //
      // ⛔ Choosing whether to attach a cell by INSPECTING THE VALUE is the same
      // idea in a disguise: that is inferring a type from a value, fenced off
      // by objectui#8477 explicitly.
      //
      // ⇒ SUCCESSOR — objectui#8817. The layer that owns "how a value renders
      // when there is no cell" is the data-table itself, so it also owns "what
      // an empty one draws"; fixing it from out here would force a SECOND
      // spelling of `formatCellValue` (a `useCallback` inside that component,
      // exported nowhere, closing over its own language state). That is a
      // product-wide behaviour change with its own ruling to make — is the
      // table's "empty" this file's `isValueEmpty`, or does the disagreement
      // merely move up one layer? Until it lands, this boundary stands.
      //
      // REACHABILITY, so the next reader need not re-derive it: this line is
      // reached only for a field that IS declared and carries no `type`. The
      // card's own case — a column key the schema never declares — never
      // arrives here at all: both explicit-column call sites guard with
      // `def ? makeCell(...) : undefined`, and the auto-derived walk guards with
      // `if (def.type)`. The `if (!CellRenderer)` line just below is, by
      // contrast, DEAD: `getCellRenderer` is typed to return a component and
      // ends in `standardMap[fieldType] || TextCellRenderer`, so it never
      // returns a falsy renderer — measured over seven spellings, including
      // ones no producer can emit, all of which resolved to `TextCellRenderer`.
      if (!def?.type) return undefined;
      const rendererType = resolveCellRendererType({ type: def.type, format: def.format }) || def.type;
      const CellRenderer = getCellRenderer(rendererType);
      if (!CellRenderer) return undefined;
      const isLookup = def.type === 'lookup' || def.type === 'master_detail';
      const resolvedMap = isExpandableFieldType(def) ? lookupLabels[key] : undefined;
      // `options` is how `LookupCellRenderer` takes a resolved label, and only
      // it — so the injection stays on the two types that read it. A `user`
      // cell is served one line down instead (objectui#10112).
      const lookupOptions =
        isLookup && resolvedMap && Object.keys(resolvedMap).length > 0
          ? Object.entries(resolvedMap).map(([id, label]) => ({ value: id, label }))
          : undefined;
      /**
       * A resolved `user` reference, handed to the cell as the RECORD SHAPE
       * that cell already documents (objectui#10112).
       *
       * `UserCellRenderer` reads `value` and nothing else: an object is a
       * person (`name || username`, with initials for the avatar), a primitive
       * is an unresolved reference and draws as one. It has no `field.options`
       * reader and no fetch of its own, so the batch map above cannot reach it
       * the way it reaches a lookup — the only seam is the value.
       *
       * ⛔ This is not a second resolver. The name comes from the one batch
       * map in this file, which resolves through `resolveRelatedLookupLabel`
       * (ADR-0079: the target object's declared `nameField` / `titleFormat`) —
       * the same resolver the lookup column and the cell's own fetch use. All
       * that happens here is a re-shape from the map's `id -> name` into the
       * `{ name }` the user cell reads.
       */
      const resolveUserValue = (value: any): any => {
        if (def.type !== 'user' || !resolvedMap) return value;
        if (typeof value !== 'string' && typeof value !== 'number') return value;
        const name = resolvedMap[String(value)];
        return name ? { name } : value;
      };
      const fieldMeta: FieldMetadata = {
        name: key,
        label: def.label || key,
        type: def.type,
        ...((lookupOptions || def.options) && { options: lookupOptions || def.options }),
        ...(def.currency && { currency: def.currency }),
        // The spec's one declaration of a fixed currency: `FieldSchema`
        // refuses a field-level `currency`, so without this a fixed-EUR amount
        // read in the tenant's currency in this list (objectui#12242).
        ...(def.currencyConfig && { currencyConfig: def.currencyConfig }),
        ...(def.precision !== undefined && { precision: def.precision }),
        ...((def as any).scale !== undefined && { scale: (def as any).scale }),
        // Beside `scale`, whose scale-0 grouping heuristic it overrides in the
        // number cell (objectui#11026).
        ...(def.useGrouping !== undefined && { useGrouping: def.useGrouping }),
        // A percent field's declared `max` is its STORAGE statement: the cell
        // reads it through the spec's `percentScaleOf` (a fraction unless `max`
        // is above 1). Dropped here, a whole-stored `50` (`max: 100`) would
        // read `5000%` in this list (objectui#11475).
        ...((def as any).max !== undefined && { max: (def as any).max }),
        ...(def.format && { format: def.format }),
        // The FIELD's deadline declaration (objectui#11815): without it a
        // child row's declared deadline never reads overdue in this list.
        ...(def.dueLike !== undefined && { dueLike: def.dueLike }),
        // objectui#6837 half 2 narrowed the READ to `reference` (the only
        // spelling the protocol declares — `FieldSchema` refuses `reference_to`
        // by name), and objectui#11070 round 4 moved the EMITTED key with it:
        // the target contract here, `FieldMetadata`
        // (`LookupFieldMetadata.reference` in `@object-ui/types`), handed
        // straight to `CellRenderer` as `field`, declares `reference`.
        ...(def.reference && { reference: def.reference }),
        ...(def.reference_field && { reference_field: def.reference_field }),
      };
      return (value: any, row?: Record<string, unknown>) => {
        // ONE definition of emptiness with `pruneEmpty` — see `isValueEmpty`.
        // This used to test `null | undefined` alone, which let a
        // whitespace-only string or an empty array through to a renderer that
        // paints nothing, in a column `pruneEmpty` had already judged empty.
        if (isValueEmpty(value)) {
          return React.createElement(EmptyValue);
        }
        return React.createElement(CellRenderer, {
          value: resolveUserValue(value),
          field: fieldMeta,
          // The CHILD row's own `settledWhen` verdict (objectui#11815), judged
          // against the row the table hands this cell — never the parent record.
          deadlineSettled: isDeadlineSettled(def, row, { scope: predicateScope, fields: objectSchema?.fields }),
        });
      };
    };

    // Normalize bare-string column entries (e.g. `'user_agent'`) into the
     // `{accessorKey, header}` shape the data-table renderer expects, and attach
     // a type-aware cell renderer resolved from the object schema.
     // Without this, page authors passing `columns: ['status', 'amount']`
     // would see raw values (e.g. `planned`, unformatted numbers).
     const normalizeColumn = (c: any): any => {
       if (typeof c !== 'string') {
         // Object column: resolve the identity ONCE, then hand the table an
         // entry that already speaks the table's own vocabulary.
         //
         // Every read in this file resolves identity canonical-first through
         // the shared `columnIdentity` reader (objectui#3104), so
         // `{ field: 'status' }` passes
         // the FLS filter, the FK filter, `pruneEmpty` and the sort row. The
         // data-table it feeds does NOT: it normalizes its accessor as
         // `accessorKey: col.accessorKey || col.name` and never looks at
         // `field`. An entry authored in the spec-canonical spelling therefore
         // used to survive every metadata-aware filter and then render a header
         // over `row[undefined]` — blank cells, no warning (objectui#5022; the
         // objectui#3951 shape, one spelling over).
         //
         // The stamp goes HERE rather than in the table's normalization
         // because `accessorKey` is the table LIBRARY's key, not metadata:
         // `column-identity.ts` names it `TABLE_ADAPTER_COLUMN_KEY` and keeps
         // the canonicalizing fold away from it on purpose. Resolving the
         // metadata vocabulary inside the adapter would merge the two
         // vocabularies in the one place that module says must stay separate;
         // translating at the boundary keeps the adapter monolingual.
         //
         // Mirror, don't move: the authored spelling is left in place (a host
         // reading `field`/`name` off these columns keeps working), and an
         // author-supplied `accessorKey` is never overwritten — a deliberate
         // divergence between the table slot and the metadata key belongs to
         // the author. An entry with no resolvable identity is returned
         // untouched, so nothing is invented for it.
         const key = c?.accessorKey || columnIdentity(c);
         if (!c || !key) return c;
         const patch: Record<string, unknown> = {};
         if (!c.accessorKey) patch.accessorKey = key;
         // The display half of the SAME boundary (objectui#5351). The spec
         // spells a column's text `ListColumnSchema.label`; the adapter spells
         // it `TableColumn.header` and, since objectui#5120, reads only that.
         // The alias it used to carry (`header: col.header || col.label`) is
         // gone, so this producer translates instead — otherwise every
         // `record_related_list` block whose columns are authored the spec way
         // arrives headerless. An author-supplied `header` is never overwritten,
         // for the same reason `accessorKey` isn't: it addresses the table
         // directly.
         if (!c.header) {
           const text = columnHeader(c);
           if (text) patch.header = text;
         }
         // Attach a cell renderer when it lacks one and we can resolve the
         // field def — preserves any author-supplied cell/render.
         if (!c.cell && !c.render) {
           const def = (objectSchema?.fields as any)?.[key];
           const cell = def ? makeCell(String(key), def) : undefined;
           if (cell) patch.cell = cell;
         }
         // Nothing to add: return the INPUT entry by reference, so the
         // downstream `useMemo`s keep a stable dependency on the common path.
         return Object.keys(patch).length > 0 ? { ...c, ...patch } : c;
       }
       const fieldDef = objectSchema?.fields?.[c] as any;
       const header = fieldDef?.label || resolveFieldLabel(relatedObjectName, c, fieldDef) || c;
       const col: any = { accessorKey: c, header, fieldDef, fieldType: fieldDef?.type };
       const cell = fieldDef ? makeCell(c, fieldDef) : undefined;
       if (cell) col.cell = cell;
       return col;
     };
     if (columns && columns.length > 0) {
       const normalized = columns.map(normalizeColumn);
       // [objectui#9053] Redaction is applied to the authored candidates FIRST
       // and their emptiness judged HERE, so an array emptied by redaction
       // behaves exactly as it already does when the BLOCK empties it upstream
       // — it falls through to the derivation below, which is redaction-filtered
       // too. That keeps one outcome for one input: the same authoring must not
       // render a derived list when the block happened to name the column and an
       // empty one when only this component could. ⛔ What an emptied-by-security
       // column set should LOOK like is objectui#9053's deferred question; this
       // deliberately answers it the way the shipping path already answers it
       // rather than inventing a second answer. Emptiness produced by FLS or by
       // `pruneEmpty` keeps its existing meaning untouched: still an empty list.
       const candidates = filterRedacted(normalized);
       if (candidates.length > 0) {
         return pruneEmpty(filterFLS(filterFK(candidates)));
       }
     }
    if (!objectSchema?.fields) return [];

    // ADR-0085 prominence: when the child object declares `highlightFields` —
    // the canonical "how to list this object" set, the SAME source the lookup
    // picker (`deriveLookupColumns`) leads with — auto-derive from those before
    // the heuristic field walk below, so a related list and a picker of the
    // same object agree on columns with zero per-surface config. Run through the
    // identical normalize / FK / FLS / empty pruning as explicit columns; fall
    // through to the walk if nothing survives (e.g. all FLS-blocked).
    const declaredHighlights = Array.isArray((objectSchema as any).highlightFields)
      ? ((objectSchema as any).highlightFields as any[]).filter(
          (n): n is string => typeof n === 'string' && n.length > 0,
        )
      : [];
    if (declaredHighlights.length > 0) {
      const hf = pruneEmpty(
        filterFLS(filterFK(filterRedacted(declaredHighlights.map(normalizeColumn)))),
      );
      if (hf.length > 0) return hf.slice(0, Math.max(1, maxColumns));
    }

    const resolvedObjectName = relatedObjectName;
    // file/image are NOT skipped: they have dedicated cell renderers (name
    // chip / thumbnail), and dropping them hid business columns like a line's
    // receipt attachment (objectui#2360). Only types with no useful tabular
    // rendering stay excluded. (`attachment` is intentionally absent — it is not
    // a `@objectstack/spec` field type, so the renderer does not model it, #2655.)
    //
    // SPELLING: matched against the RAW `def.type`, so every member must be a
    // `@objectstack/spec` `FieldType` name. `rich_text` was not one. The spec
    // spells the type `richtext` and REJECTS `rich_text` / `rich-text`
    // outright — they survive only as typo keys in the spec's own
    // `suggestFieldType` table, i.e. spellings no producer can emit. So the
    // member excluded nothing while a real `richtext` field fell straight
    // through into a derived column (#4250).
    //
    // `markdown` joins its siblings on MEASURED behaviour, not on the
    // raw-markup story: markdown, richtext and html all render FORMATTED here
    // (the first two via `MarkdownCellRenderer`, html via `HtmlCellRenderer`).
    // What makes all three unusable in a table is that the formatted output is
    // BLOCK-level (`<h1>` / `<p>` / `<ul>`) inside a `truncate` single-line
    // cell, so a document renders as one clipped heading with the rest
    // invisible. `textarea` stays OUT by the same measurement read the other
    // way — it renders as plain truncated text, which is a useful cell.
    // Author-declared columns are unaffected: this set only filters the
    // zero-config auto-derive walk.
    const SKIP_TYPES = new Set(['richtext', 'markdown', 'html', 'json']);
    const PRIORITY_NAMES = [
      'name',
      'full_name',
      'fullname',
      'title',
      'subject',
      'label',
      'code',
      'number',
    ];
    const entries = Object.entries(objectSchema.fields)
      .filter(([key, def]: [string, any]) => {
        if (key.startsWith('_')) return false;
        if (key === 'id' || key === referenceField) return false;
        if (def?.hidden) return false;
        if (def?.type && SKIP_TYPES.has(def.type)) return false;
        // [objectui#9053] Redaction: drop redacted fields from the walk too —
        // asked here rather than over `generated` so the priority sort and the
        // `maxColumns` slice below both see the set the reader will get.
        if (isRedacted(key)) return false;
        // FLS: drop unreadable fields from auto-derived columns too.
        if (perms?.isLoaded && resolvedObjectName
            && !perms.checkField(resolvedObjectName, key, 'read')) {
          return false;
        }
        return true;
      });

    // System audit fields are technically real columns, but they should never
    // *lead* an auto-derived related list — a child object with no name/title
    // (e.g. invoice lines) would otherwise show "Created At / Last Modified At"
    // before its business fields (qty, price, amount). Push them last so the
    // maxColumns slice keeps the meaningful columns.
    const SYSTEM_LAST = new Set([
      'created_at', 'updated_at', 'created_by', 'updated_by',
      'owner_id', 'organization_id',
    ]);
    // Sort by priority: name-like → status/select → others → system audit last.
    entries.sort(([aKey, aDef]: any, [bKey, bDef]: any) => {
      const aSys = SYSTEM_LAST.has(aKey);
      const bSys = SYSTEM_LAST.has(bKey);
      if (aSys !== bSys) return aSys ? 1 : -1;
      const aPri = PRIORITY_NAMES.indexOf(aKey);
      const bPri = PRIORITY_NAMES.indexOf(bKey);
      const aScore = aPri >= 0 ? aPri : 100;
      const bScore = bPri >= 0 ? bPri : 100;
      if (aScore !== bScore) return aScore - bScore;
      const aIsStatus = aDef?.type === 'select' || aKey.includes('status');
      const bIsStatus = bDef?.type === 'select' || bKey.includes('status');
      if (aIsStatus !== bIsStatus) return aIsStatus ? -1 : 1;
      return 0;
    });

    const generated = entries.map(([key, def]: [string, any]) => {
      const col: any = {
        accessorKey: key,
        header: resolveFieldLabel(resolvedObjectName, key, def.label || key),
      };
      if (def.type) {
        const cell = makeCell(key, def);
        if (cell) col.cell = cell;
      }
      return col;
    });

    const pruned = pruneEmpty(generated);
    return pruned.slice(0, Math.max(1, maxColumns));
  }, [columns, objectSchema, objectName, api, resolveFieldLabel, referenceField, relatedData, maxColumns, lookupLabels, perms, redactedFields, predicateScope]);

  /**
   * [#6108] The SERVED per-column sortability projection for this object —
   * objectstack#10235's ruling A, consumed rather than re-derived, through
   * #5729's landed spelling in `@object-ui/core`.
   *
   * `undefined` means the metadata response carried no `sortability` key at
   * all: a backend older than the upstream change, an inline/mock data source,
   * or the schema fetch not yet landed. That is NOT "nothing is sortable" —
   * see the branch in `withheldFromServerSort` below.
   */
  const platformSortability = readObjectSortability(objectSchema);

  /**
   * [#6108] Does a server `$orderby` on this flat field name have to be
   * withheld? THE one predicate behind both of this list's sort entry points —
   * the embedded table's column headers and the `data-list` sort-button row.
   * They never shared a derivation before, which is how the same refused sort
   * stayed reachable through whichever control the other one did not cover.
   *
   * TWO reasons, kept separate on purpose — the same split the grid header
   * makes (`ObjectGrid.withSortability`, #5729):
   *
   *  - RELATIONAL, and deliberately NOT delegated to the platform signal. The
   *    projection answers `sortable: true` for a `lookup`: the platform's
   *    question is whether it can order by the STORED foreign key, which it
   *    can. Ours is whether that order means anything next to a column of
   *    related-record names, and it does not (objectstack#4256 settled that no
   *    relation join is coming). Two different questions; folding this one into
   *    the signal would hand every relational column its sort back.
   *  - PLATFORM. `isPlatformSortableField` is the contract: an entry must EXIST
   *    in the served projection and say `sortable: true`. Absence is a refusal
   *    — an unknown name, a dotted path (a caller may hand `columns` either),
   *    an unprovisioned audit column — never a default of `true`.
   *
   * Both entry points used to read `isUnmaterializedFieldType` off the field's
   * TYPE instead. That agrees with the projection about `formula` — the
   * platform computes its own from the same `@objectstack/spec` storage fact —
   * which is exactly why the drift went unnoticed. It parts company on
   * everything the projection encodes as ABSENCE, and on any verdict the
   * runtime doors add later; and it cannot follow the platform when it moves.
   *
   * NO SIGNAL SERVED keeps the type read as a compatibility floor: behaviour
   * identical to before this card, unreachable the moment a backend serves the
   * signal, and meant to be deleted when the supported floor passes that
   * release.
   */
  const withheldFromServerSort = React.useCallback(
    (field: string | undefined, fieldDef: unknown) => {
      if (isExpandableFieldType(fieldDef)) return true;
      if (platformSortability) return !isPlatformSortableField(platformSortability, field);
      return isUnmaterializedFieldType(fieldDef);
    },
    [platformSortability],
  );

  /**
   * The same columns, with the sort affordance withheld from the ones a server
   * `$orderby` cannot honestly order by.
   *
   * A windowed sort goes out as `$orderby` on the flat field name, and two kinds
   * of column cannot survive that trip (objectui#3096, #3950):
   *
   *  - a relational column stores a foreign-key id, so "sort by Owner" would
   *    order the collection by `rec_7f3…` while the cells show names
   *    (objectstack#4256 settled that no relation join is coming);
   *  - a column the PLATFORM will not order by — a `formula` with no
   *    materialised column behind it (silently unordered rows under a `200`
   *    before objectstack#6994, a `400 INVALID_SORT` after it), and every
   *    other name the served projection refuses. `withheldFromServerSort`
   *    above is the whole judgement; this memo only applies it.
   *
   * This is the rule the sort-button row already applied; the headers inherit it
   * rather than re-opening the same door.
   *
   * In client mode the sort keys off the value the cell shows — the resolved
   * label, the hydrated formula result — so those headers stay live: the same
   * split `sortedData` makes.
   */
  const sortableColumns = React.useMemo(() => {
    if (!windowed) return effectiveColumns;
    return effectiveColumns.map((col: any) => {
      const field = col.accessorKey || columnIdentity(col);
      const fieldDef = field ? (objectSchema?.fields as any)?.[field] : undefined;
      return withheldFromServerSort(field, fieldDef) ? { ...col, sortable: false } : col;
    });
  }, [effectiveColumns, windowed, objectSchema, withheldFromServerSort]);

  /**
   * Are this list's OBJECT field types still unknown (objectui#10657)? True
   * while an object definition is expected (there is an object to ask about,
   * and a data source that can answer) but none is in hand: the read is in
   * flight, or it settled with nothing, which is how a failed read settles.
   * With no `getObjectSchema` there is nothing to wait for, and the authored
   * column types are all this list will ever know.
   */
  const objectTypesPending =
    !!api && typeof dataSource?.getObjectSchema === 'function' && !objectSchema?.fields;

  /**
   * The columns handed to the table, each stamped `masked` when its cell is
   * drawn as a mask (objectui#10657). This list draws a `password` / `secret`
   * cell as the mask through `getCellRenderer`, but the table it feeds cannot
   * import `@object-ui/fields`, so without the flag its Ctrl+C / Cmd+C copy,
   * the cell tooltip, the header sort (the embedded table's headers drive this
   * list's own sort) and the auto width all read the raw value.
   *
   * The rule is not restated here: {@link isMaskedDetailFieldType} asks
   * `isMaskedFieldType()`, the one authority, over the authored column `type`
   * and the object-declared type as a narrow-only UNION — the same shape
   * `ObjectGrid` stamps with. Stamped at this one seam rather than in each of
   * the three builders above (authored object columns, bare-string columns,
   * the auto-derived walk), so no path to the table can miss it.
   *
   * Fail closed: while the object's types are unknown
   * ({@link objectTypesPending}), no column can be told apart from a masked
   * one, so every column is stamped. A column the loaded definition does not
   * declare is judged on its authored `type` alone.
   *
   * WITHHELD, not only stamped (objectui#10657, the objectui#10706 class at
   * this producer): in that same window the columns' cells cannot draw a mask
   * either. This list draws a cell from the OBJECT's field type
   * (`makeCell`), never from the column's authored `type`, so with no
   * definition in hand a column has no cell and the table would draw its value
   * as text — a `password` / `secret` field in the clear, and for good when
   * the read failed. So every column without a `cell` of its own draws the
   * mask ({@link withheldCell}) until the definition lands, and keeps drawing
   * it when the read failed: fail closed, never falling back to text. A
   * `cell` the AUTHOR supplied draws what the author chose (none is attached
   * here while the definition is missing, so any `cell` in that window is
   * theirs).
   *
   * With nothing to stamp, the list is handed on BY REFERENCE, as
   * `sortableColumns` hands it on (the data-table re-seed, objectui#4618).
   *
   * This list's own filter box and sort read the same stamp
   * (`unmaskedColumnKeysKey` below, objectui#10728).
   */
  const tableColumns = React.useMemo(() => {
    const stamped = sortableColumns.map((col) => {
      if (!col || typeof col !== 'object') return col;
      const field = col.accessorKey || columnIdentity(col);
      const fieldDef = field ? objectSchema?.fields?.[field] : undefined;
      const masked = objectTypesPending || isMaskedDetailFieldType(col.type, fieldDef?.type);
      const withheld = objectTypesPending && typeof col.cell !== 'function';
      if (!withheld) return masked && col.masked !== true ? { ...col, masked: true } : col;
      return { ...col, masked: true, cell: withheldCell };
    });
    return stamped.every((col, i) => col === sortableColumns[i]) ? sortableColumns : stamped;
  }, [sortableColumns, objectSchema, objectTypesPending]);

  /**
   * The columns this list's OWN filter and sort may read (objectui#10728): the
   * keys of the columns handed to the table that do not carry the `masked`
   * stamp {@link tableColumns} puts on them. The stamp is the one reading. It
   * covers a `password` / `secret` column and, while the object's types are
   * unknown ({@link objectTypesPending}), every withheld one, so the rule
   * behind it is not restated at the filter or the sort.
   *
   * It is the answer the embedded `data-table` gives for its own search and
   * sort (its `isMaskedColumnKey`, objectui#10657), so one related list has
   * one answer:
   *
   *  - the filter box sweeps these columns only. A masked column is left out,
   *    and so is every field the row carries that no column shows: a term that
   *    matches only such a field keeps no row;
   *  - the sort orders by one of these columns only. A key naming a masked
   *    column, or no column at all, orders nothing: fail closed, as the
   *    table's reader does.
   *
   * Held as a content STRING, as `expandKey` and `selectKey` are, so the
   * memos and callbacks below re-run when the set changes and never on a
   * recomputed column list alone (commandment #10).
   */
  const unmaskedColumnKeysKey = React.useMemo(
    () =>
      JSON.stringify(
        tableColumns.flatMap((col) => {
          if (!col || typeof col !== 'object' || col.masked === true) return [];
          const key = drawnColumnKey(col);
          return key ? [key] : [];
        }),
      ),
    [tableColumns],
  );
  const unmaskedColumnKeys = readColumnKeys(unmaskedColumnKeysKey);

  // Filter data (client mode only — windowed mode filters/sorts server-side).
  //
  // Over the unmasked columns only (objectui#10728), see
  // `unmaskedColumnKeysKey`. It swept `Object.values(row)`, so a term matched
  // a `password` / `secret` value its cell draws as the mask: typing a
  // substring answered "does the credential contain this?".
  const filteredData = React.useMemo(() => {
    if (windowed || !filterText) return relatedData;
    const lower = filterText.toLowerCase();
    const searched = readColumnKeys(unmaskedColumnKeysKey);
    return relatedData.filter((row) =>
      searched.some((key) => {
        const val = row?.[key];
        return val !== null && val !== undefined && String(val).toLowerCase().includes(lower);
      })
    );
  }, [relatedData, filterText, windowed, unmaskedColumnKeysKey]);

  // Sort data (client mode only — a windowed sort is a server $orderby)
  //
  // A relational column holds a raw foreign-key id (this list resolves labels
  // itself, see `lookupLabels`) or — when the parent handed us `$expand`-ed
  // rows — the related record object. `String(aVal)` ordered the first by an
  // opaque id and reduced the second to "[object Object]", i.e. every row equal.
  // Feeding the resolved label map to `getSortValue` sorts by the string the
  // cell actually renders (objectui#3096).
  const sortedData = React.useMemo(() => {
    if (windowed || !sortField) return filteredData;
    // A masked column orders nothing (objectui#10728), including a sort set
    // before its column was stamped: rows ordered by a credential tell the
    // reader how it compares with every other row's.
    if (!readColumnKeys(unmaskedColumnKeysKey).includes(sortField)) return filteredData;
    const labels = lookupLabels[sortField];
    const keyed = filteredData.map((row) => ({ row, key: getSortValue(row[sortField], { labels }) }));
    keyed.sort((a, b) => {
      const cmp = compareSortValues(a.key, b.key);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return keyed.map((entry) => entry.row);
  }, [filteredData, sortField, sortDirection, windowed, lookupLabels, unmaskedColumnKeysKey]);

  // Paginate data. Windowed mode already holds exactly one page; client mode
  // slices the in-memory collection as before.
  const paginatedData = effectivePageSize && !windowed
    ? sortedData.slice(currentPage * effectivePageSize, (currentPage + 1) * effectivePageSize)
    : sortedData;
  const totalPages = !effectivePageSize
    ? 1
    : windowed
      ? total != null
        ? Math.max(1, Math.ceil(total / effectivePageSize))
        : currentPage + (hasMore ? 2 : 1)
      : Math.max(1, Math.ceil(sortedData.length / effectivePageSize));
  const canGoNext = windowed
    ? (total != null ? (currentPage + 1) * effectivePageSize < total : hasMore)
    : currentPage < totalPages - 1;
  const showPagination = effectivePageSize > 0 && (windowed
    ? currentPage > 0 || canGoNext
    : sortedData.length > effectivePageSize);

  // Reset to first page when filter/sort changes
  React.useEffect(() => {
    setCurrentPage(0);
  }, [filterText, sortField, sortDirection]);

  const handleSort = React.useCallback((field: string) => {
    // A masked column is never sorted by (objectui#10728). The button row
    // offers it no button; this is the one door that row passes through.
    if (!readColumnKeys(unmaskedColumnKeysKey).includes(field)) return;
    // Same-batch page reset: in windowed mode sort + page feed one fetch, so
    // resetting here avoids an extra request against the stale page index.
    setCurrentPage(0);
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField, unmaskedColumnKeysKey]);

  /**
   * The order the embedded table's headers display — this list's own sort, so
   * the arrow on a column header and the rows underneath it come from the same
   * place (objectui#3106).
   *
   * Before any click that is the declared `defaultSort`, which is what the
   * windowed fetch above sends. A header showing nothing while the server was
   * asked for `created_at desc` would make the first click on that column
   * request `asc` on a list that is already `desc`.
   */
  const activeSort = React.useMemo(
    () => (sortField ? [{ field: sortField, order: sortDirection }] : defaultSortSpec),
    [sortField, sortDirection, defaultSortSpec],
  );

  /**
   * A header click from the embedded table. It arrives with the direction
   * already resolved against {@link activeSort}, so this assigns rather than
   * toggling — running it back through `handleSort`'s own toggle would undo it
   * whenever the two disagreed about the current state.
   *
   * The table offers no sort on a masked header (objectui#10657). This list
   * refuses the key as well (objectui#10728), because in windowed mode it is
   * sent to the server as `$orderby`, which orders by the stored value.
   */
  const handleTableSort = React.useCallback(
    (next: Array<{ field: string; order: 'asc' | 'desc' }>) => {
      const first = next[0];
      if (!first) return;
      if (!readColumnKeys(unmaskedColumnKeysKey).includes(first.field)) return;
      setCurrentPage(0);
      setSortField(first.field);
      setSortDirection(first.order);
    },
    [unmaskedColumnKeysKey],
  );

  // A `grid`/`table` list renders a real table, whose column headers carry the
  // sort. `list` renders `data-list`, which has none — so it keeps the button
  // row as its only sort control. A caller-supplied `schema` renders whatever
  // it says, so we cannot claim headers for it either.
  const hasSortableHeaders = !schema && (type === 'grid' || type === 'table');

  const hasCustomRowActions = Array.isArray(rowActions) && rowActions.length > 0;
  const hasRowActions = !!onRowEdit || !!onRowDelete || hasCustomRowActions;
  const isMobile = useIsMobile();

  const viewSchema = React.useMemo(() => {
    if (schema) return schema;

    // Mobile: render grid/table data as a card gallery — single-column,
    // tap-friendly, visually consistent with the standalone gallery view.
    // Reuses the registered `object-gallery` schema so we don't ship a
    // duplicate renderer. Falls back to the data-table on desktop and
    // when explicit `type='list'` is requested (legacy path).
    if (isMobile && (type === 'grid' || type === 'table')) {
      const titleField = effectiveColumns[0]?.accessorKey || columnIdentity(effectiveColumns[0]);
      const visibleFields = effectiveColumns
        .slice(1, 4)
        .map((c: any) => c.accessorKey || columnIdentity(c))
        .filter(Boolean);
      return {
        type: 'object-gallery',
        data: paginatedData,
        objectName: api,
        gallery: {
          titleField: titleField || 'name',
          visibleFields,
          // Explicit, so the cover the card reads is the one the `$select`
          // projection asks for — see `MOBILE_GALLERY_COVER_FIELD`.
          coverField: MOBILE_GALLERY_COVER_FIELD,
          cardSize: 'medium',
        },
        onRowClick,
      };
    }

    // Per-record CEL predicates for the built-in row Edit/Delete, from the
    // CHILD object's `userActions.edit` / `delete` object form (#2614) — the
    // master-detail case where a child row freezes on a parent state change
    // renders through this path. Boolean forms yield no predicates. Parsed by
    // the shared `@object-ui/core` normalizer so there is one parser platform-wide.
    const rowEditPredicates = userActionPredicates(objectSchema?.userActions?.edit);
    const rowDeletePredicates = userActionPredicates(objectSchema?.userActions?.delete);

    // Auto-generate schema based on type. We disable the data-table's own
    // search/toolbar — RelatedList provides its own filter input above.
    switch (type) {
      case 'grid':
      case 'table':
        return {
          type: 'data-table',
          data: paginatedData,
          columns: tableColumns,
          pagination: false, // We handle pagination ourselves
          pageSize: effectivePageSize || 10,
          searchable: false,
          exportable: false,
          // Sorting is THIS list's, in both modes (objectui#3106).
          //
          // Windowed: `data` is one page, so a table-local sort would order
          // that page and call it the list — the defect. Client mode: this
          // list's own sort resolves a relational column through the label map
          // it built (`lookupLabels`), which the table cannot see, so its sort
          // is the better one even when both are possible.
          //
          // Either way there is now ONE sort behind the headers instead of a
          // table-local order sitting on top of a server order.
          manualSorting: true,
          sort: activeSort,
          onSortChange: handleTableSort,
          rowActions: hasRowActions,
          onRowEdit,
          onRowDelete: onRowDelete ? handleDeleteRow : undefined,
          rowEditPredicates,
          rowDeletePredicates,
          onRowClick,
          // Child-object row actions (`list_item`, or `record_related` inside a
          // parent record) rendered in the same overflow menu, dispatched with
          // the clicked row as target.
          rowActionDefs: hasCustomRowActions ? rowActions : undefined,
          onRowActionDef: hasCustomRowActions ? onRowAction : undefined,
        };
      case 'list':
        return {
          type: 'data-list',
          data: paginatedData,
        };
      default:
        return { type: 'div', children: 'No view configured' };
    }
  }, [type, paginatedData, tableColumns, effectiveColumns, schema, effectivePageSize, hasRowActions, hasCustomRowActions, rowActions, onRowAction, onRowEdit, onRowDelete, handleDeleteRow, onRowClick, isMobile, api, objectSchema, activeSort, handleTableSort]);

  const headerClassName = collapsible ? 'cursor-pointer select-none' : undefined;
  const handleHeaderClick = collapsible ? () => setCollapsed((c) => !c) : undefined;

  const SectionIcon = resolveIconComponent(icon);
  // Badge shows the COLLECTION size: the server total in windowed mode (only
  // one page is in memory), the loaded row count otherwise.
  const recordCount = windowed && total != null ? total : relatedData.length;
  // In windowed mode an empty page beyond page 0 is a transient overflow (the
  // step-back effect above corrects it), not an empty collection.
  const isEmpty = !loading && relatedData.length === 0 && (!windowed || currentPage === 0);
  // When the consumer explicitly enables `filterable`, always render the
  // filter input — they're opting in. (data-table's own auto-search is
  // suppressed via the viewSchema below to avoid a duplicate input.)
  const showFilterInput = filterable;

  // objectui#9050 step 2 — the authored filter did not lower, so this list has
  // no query it is allowed to send. The card keeps its chrome (the surrounding
  // detail page renders exactly as before; only this section's body changes),
  // and the body NAMES the operator the author has to fix. Placed after every
  // hook above, so the early return cannot change the hook order.
  if (filterRefusal) {
    return (
      <Card className={cn('shadow-none border-border/60 bg-transparent', className)}>
        <CardHeader className="py-3 px-4 sm:py-3 min-h-12 sm:min-h-0">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            {/* eslint-disable-next-line react-hooks/static-components -- resolveIconComponent returns a stable icon component from a static registry, not a component created during render */}
            <SectionIcon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            <span className="truncate">{title}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4 px-4">
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" data-testid="related-list-malformed-filter">
            {/* The headline is separately addressable because it is the half that
                has to NAME the operator. The technical line below repeats the
                token incidentally, so a pin that read the whole banner would
                stay green with the name removed from the headline. */}
            <p className="font-medium" data-testid="related-list-malformed-filter-subject">
              {t('view.malformedFilter', { subject: filterRefusalSubject(filterRefusal) ?? '' })}
            </p>
            <p className="mt-1 text-xs opacity-80">{filterRefusal.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('shadow-none border-border/60 bg-transparent', isEmpty && 'bg-muted/10', className)}>
      <CardHeader
        className={cn('py-3 px-4 sm:py-3 min-h-12 sm:min-h-0', headerClassName)}
        onClick={handleHeaderClick}
      >
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold">
          <div className="flex items-center gap-2 min-w-0">
            {collapsible && (
              collapsed
                ? (<ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />)
                : (<ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />)
            )}
            {/* eslint-disable-next-line react-hooks/static-components -- resolveIconComponent returns a stable icon component from a static registry, not a component created during render */}
            <SectionIcon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            <span className={cn('truncate', isEmpty && 'text-muted-foreground font-medium')}>
              {title}
            </span>
            <Badge
              variant="secondary"
              className={cn(
                'text-xs font-normal h-5 px-1.5',
                recordCount === 0 && 'bg-muted text-muted-foreground'
              )}
              aria-label={`${recordCount} records`}
            >
              {recordCount}
            </Badge>
            {isEmpty && (
              <span className="text-xs text-muted-foreground/70 italic ml-1 truncate">
                {t('detail.noRelatedRecords')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Child-object list_toolbar actions (e.g. Invite User) — the
                related-list equivalent of the object list's toolbar buttons.
                Rendered before Add/New so the domain action leads. */}
            {onToolbarAction && permittedToolbarActions.map((a) => (
              <RelatedToolbarButton
                key={a.name}
                action={a}
                onToolbarAction={onToolbarAction}
              />
            ))}
            {/* Gated on the RESOLVED picker target, not merely on `add` being
                truthy: an `add` without `picker` is metadata the spec rejects,
                and offering a button that could never open a picker is worse
                than withholding it (#3838 — the console hint above names the
                missing key).

                `dataSource` is part of the SAME gate, because the dialog this
                button opens (below, `add && pickerObject && dataSource`) and the
                callback it ends in (`handleAddRecords`: `if (!add ||
                !dataSource || …) return`) both require it. Without it the button
                rendered, `setPickerOpen(true)` ran, and no dialog existed to
                observe the flag: a click with NO visible reaction and no
                message. Hosts where that is real are the ones passing
                `dataSource={ctx?.dataSource}` with no `RecordContext` bound —
                the Studio designer preview and context-free embeds
                (`renderers/record-related-list.tsx`). Same principle as #3838
                one condition further: an affordance is offered only where the
                capability behind it exists (objectui#3895) — and, since
                objectui#12082, only where the caller's grant allows the write
                it ends in (`addGranted`, above). */}
            {add && pickerObject && dataSource && addGranted && (
              <Button
                variant={isEmpty ? 'ghost' : 'outline'}
                size="sm"
                disabled={addBusy}
                onClick={(e) => { e.stopPropagation(); setAddError(null); setPickerOpen(true); }}
                className="gap-1 h-9 sm:h-7 text-xs shadow-none"
              >
                <Plus className="h-3.5 w-3.5" />
                {add.label || t('detail.add', { defaultValue: 'Add' })}
              </Button>
            )}
            {onNew && (
              <Button
                variant={isEmpty ? 'ghost' : 'outline'}
                size="sm"
                /* [#4646] `userActions.create.disabledWhen` for the record this
                   list hangs off. `visibleWhen` never reaches here — a false
                   one makes the host omit `onNew`, so the button is absent
                   rather than greyed. */
                disabled={newDisabled}
                data-testid="related-list-new"
                onClick={(e) => { e.stopPropagation(); onNew(); }}
                className="gap-1 h-9 sm:h-7 text-xs shadow-none"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('detail.new')}
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      {!collapsed && !isEmpty && <CardContent className={cn('pt-0 pb-4 px-4')}>
        {/* Filter bar — only when records justify it */}
        {showFilterInput && (
          <div className="mb-3">
            <Input
              placeholder={t('detail.filterPlaceholder')}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        )}

        {/* Sort buttons — only where there are no column headers to click.
            A `grid`/`table` related list renders a real table whose headers now
            drive this same sort (objectui#3106), so a second row of buttons
            above it would be two controls over one order — and, before the
            headers were wired up, two DIFFERENT orders: the buttons sorted the
            collection through the server while the headers sorted the page in
            the browser, in one card, with nothing saying so. `data-list` has no
            headers, so there the buttons stay the only way to sort. */}
        {sortable && !hasSortableHeaders && effectiveColumns && effectiveColumns.length > 0 && relatedData.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {effectiveColumns.map((col: any) => {
              const field = col.accessorKey || columnIdentity(col);
              if (!field) return null;
              // A windowed sort goes out as a server `$orderby` on the flat
              // field name, so a relational column would order the collection by
              // its stored foreign-key id while the cells show related-record
              // names — sorting looks broken (objectui#3096) — and a name the
              // PLATFORM refuses to order by has nothing behind it at all
              // (objectstack#6994, objectui#3950, and #6108 for reading that
              // verdict off the served projection instead of the field's type).
              // No button rather than a button that sorts by something invisible
              // or that cannot be answered. The client-mode branch keeps its
              // button: there the sort key is the value the cell shows (see
              // `sortedData`).
              const fieldDef = (objectSchema?.fields as any)?.[field];
              if (windowed && withheldFromServerSort(field, fieldDef)) {
                return null;
              }
              // No button on a masked or withheld column (objectui#10728): a
              // sort by it orders the rows by the value its cell hides. The
              // same reading `handleSort` refuses the key with.
              if (!unmaskedColumnKeys.includes(field)) return null;
              const label = col.header || col.label || field;
              const isActive = sortField === field;
              return (
                <Button
                  key={field}
                  variant={isActive ? 'secondary' : 'ghost'}
                  size="sm"
                  className="gap-1 h-7 text-xs"
                  onClick={() => handleSort(field)}
                >
                  <ArrowUpDown className="h-3 w-3" />
                  {label}
                  {isActive && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                </Button>
              );
            })}
          </div>
        )}

        {loading && relatedData.length === 0 ? (
          // Placeholder only while there's nothing to show (first load). Page
          // flips keep the previous rows in place (slightly dimmed) until the
          // next window arrives — swapping to a placeholder collapses the
          // card and makes the whole related section visibly jump.
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
            {t('detail.loading')}
          </div>
        ) : (
          <div className={cn(loading && 'opacity-60 pointer-events-none transition-opacity')}>
            <SchemaRenderer schema={viewSchema} />
          </div>
        )}

        {/* Pagination controls */}
        {showPagination && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={currentPage === 0}
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-3 w-3" />
              {t('detail.previousPage')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('detail.pageOf', { current: currentPage + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={!canGoNext}
              onClick={() => setCurrentPage((p) => (canGoNext ? p + 1 : p))}
            >
              {t('detail.nextPage')}
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Footer "View all" link — whenever the host hands a destination and
            there are records (objectui#12741). The spec's `showViewAll` is
            "Show 'View All' link to see all related records", with no
            truncation condition: the full list page is worth opening even when
            every row fits here (sort, filter, export, a shareable URL). An
            empty list has nothing to see in full. */}
        {onViewAll && !isEmpty && (
          <div className="mt-3 pt-3 border-t flex justify-center">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onViewAll(); }}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              {t('detail.viewAll')}
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        )}
      </CardContent>}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('detail.deleteRowTitle', { defaultValue: 'Delete record' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* objectui#13333 — the sentence names the row by its title, the
                  ONE ADR-0079 resolver over this list's object schema (a
                  grant's `nameField` formula names the grant and its user). */}
              {deleteTarget !== null &&
                t('detail.deleteRowConfirmation', {
                  name: getRecordDisplayName(objectSchema, deleteTarget),
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('detail.cancel', { defaultValue: 'Cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('detail.delete', { defaultValue: 'Delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {addError && (
        <div
          className="mx-4 mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {addError}
        </div>
      )}
      {/* Same gate as the Add button above — `pickerObject` (i.e.
          `add?.picker?.object`, computed once near the picker-schema fetch) is
          what the dialog needs, so requiring it here removes the last
          render-path bare read of `add.picker` rather than optional-chaining
          it: off-spec `add` still does nothing at all, so no second dialect
          appears (AGENTS.md #0.1). #3838. */}
      {add && pickerObject && dataSource && addGranted && (
        <RecordPickerDialog
          open={pickerOpen}
          onOpenChange={(o) => setPickerOpen(o)}
          multiple
          dataSource={dataSource as any}
          objectName={pickerObject}
          title={add.label || t('detail.add', { defaultValue: 'Add' })}
          displayField={pickerDisplayField}
          columns={pickerColumns}
          cellRenderer={getCellRenderer}
          fieldsMeta={pickerSchema?.fields}
          // The author's candidate restriction, handed over VERBATIM (#3831).
          // `baseFilter` — never `lookupFilters`, which renders its entries as
          // filter-bar rows the user can edit, i.e. demotes the restriction to a
          // suggestion. The picker lowers the rule array through the repo's
          // single filter sink, so no conversion belongs on this side.
          baseFilter={add.picker.filter}
          onSelect={() => {}}
          onSelectRecords={(records: any[]) => { void handleAddRecords(records); }}
        />
      )}
    </Card>
  );
};
