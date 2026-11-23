/**
 * Object Data Page — the parameterized bare data surface (ADR-0055, #2251).
 *
 * Route: `/apps/:appName/:objectName/data` (± `filter[<field>]=<value>`,
 * `uf_<field>` and the list-state `uf__search` / `uf__sort` / `uf__group` /
 * `uf__filter` search params).
 *
 * Where ObjectView anchors to a saved list view (default or `/view/:viewId`),
 * this surface is deliberately UNANCHORED — "the URL is the view":
 *
 *   • no saved-view filter is baked in: URL `filter[...]` conditions apply on
 *     top of everything the user is allowed to see (row-level security is the
 *     server-enforced baseline, never a view);
 *   • URL conditions render as visible, removable chips (unlike Odoo's
 *     invisible action domain);
 *   • no saved-view tab bar — switching to a saved view is an explicit
 *     navigation to `/view/:viewId` ("Save as view" is the exit);
 *   • nothing here writes back to any saved view;
 *   • the list's own state — its search, sort, grouping and Filter panel —
 *     lives in the address too (objectstack#36408), under the keys ObjectView
 *     uses, so opening a record and closing it, or a reload, returns the list
 *     as the reader left it (see `listSeedRef`);
 *   • the visualization switcher (grid/kanban/...) is ListView-internal, so
 *     switching presentation never touches the URL — filter state survives;
 *   • the common filter bar (ADR-0047 `userFilters` + `uf_*` persistence) is
 *     auto-derived from the object's enum-ish fields and its single-value
 *     relation fields (objectui#13310), since there is no view to author it
 *     on (ADR-0053 puts userFilters on views/pages).
 *
 * Field-level security: auto-derived columns, the filter bar, and URL filter
 * predicates are all trimmed to readable fields client-side; the server is
 * the enforcement point (it must drop predicates on unreadable fields).
 */

import * as React from 'react';
import { Link, useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ListView } from '@object-ui/plugin-list';
import { useNavigationOverlay, useRowPredicate } from '@object-ui/react';
import {
  Button,
  Empty,
  EmptyTitle,
  EmptyDescription,
  NavigationOverlay,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ObjectIconTile,
} from '@object-ui/components';
import { Database, Lock, MoreHorizontal, Plus, RotateCcw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatMetadataError } from '@object-ui/data-objectstack';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { usePermissions, useFieldPermissions } from '@object-ui/permissions';
import { useAuth, useWorkspaceAdminStatus } from '@object-ui/auth';
import { resolveAffordance, resolveFilterPlaceholders, type SchemaLike } from '@object-ui/core';
import { normalizeFilterOperator, ViewFilterRuleSchema } from '@objectstack/spec/ui';
import type { ViewFilterRule } from '@objectstack/spec/ui';
import {
  parseUserFilterParams,
  applyUserFilterParams,
  parseListStateParams,
  applyListStateParams,
  LIST_FILTER_PARAM,
  type ListStatePatch,
  type ListUrlFieldGate,
  type ListUrlState,
} from './userFilterUrlState.js';
import {
  parseUrlFilterTriples,
  groupFilterChips,
  deleteFieldFilterParams,
  URL_FILTER_OPS,
  URL_TRIPLE_OP_WORD,
  type FilterTriple,
} from './drillUrlFilters.js';
import {
  defaultColumnsFromObject,
  defaultKanbanFromObject,
  defaultCalendarFromObject,
  defaultGalleryFromObject,
} from './InterfaceListPage.js';
import { RecordDetailView } from './RecordDetailView.js';
import { OpenInSidePanelButton } from './objectViewOpenAsPage.js';
import { listOriginOf, listShownRowsOf, type ListShownRows } from './objectViewRecordNavigation.js';
import { usePhoneViewport } from '../hooks/usePhoneViewport.js';
import { RECORD_PAGE_PUSHED_STATE } from './recordPagePush.js';
import { PageHeader } from '../layout/PageHeader.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { createRuntimeMetadata, viewEnvelope } from './runtime-metadata-persistence.js';
import { useRuntimeCreateApp } from './objectViewViewCrud.js';
import { buildNewViewSpec } from './newViewSpec.js';
import { CreateViewDialog } from './CreateViewDialog.js';
import {
  usePreviewDrafts,
  PREVIEW_QUERY_FLAG,
  PREVIEW_QUERY_VALUE,
} from '../preview/PreviewModeContext.js';
import { usePreviewListDataSource } from '../preview/unpublishedObjectReads.js';
import { useTenancyPosture } from '../hooks/useTenancyPosture.js';
import { servedObjectLabel, servedObjectPluralLabel } from '../hooks/servedObjectLabel.js';
import type { RowCrudPredicates } from '../utils/crudAffordances.js';
import { servesRecordRead } from '../utils/recordReadServed.js';
import {
  RECORD_FORM_LINK_PARAM,
  RECORD_FORM_OBJECT_PARAM,
  RECORD_FORM_PARAM,
  RECORD_DRAWER_PARAM,
  RECORD_TRAIL_PARAM,
  buildRecordTrailHref,
  decodeRecordTrail,
  type RecordTrailEntry,
} from '../urlParams.js';

/**
 * The relationship field of `objectDef` that points at the source record of a
 * list opened from that record's related list (objectstack#35601): its one
 * single-valued `lookup` / `master_detail` whose `reference` is the source's
 * object. `undefined` when there is none, or more than one (the source alone
 * does not say which).
 */
export function sourceRelationshipField(objectDef: any, source: RecordTrailEntry | undefined): string | undefined {
  if (!source || !objectDef?.fields || typeof objectDef.fields !== 'object') return undefined;
  const entries: Array<[string, any]> = Array.isArray(objectDef.fields)
    ? objectDef.fields.map((f: any) => [f?.name, f])
    : Object.entries(objectDef.fields);
  const hits = entries.filter(([name, def]) =>
    typeof name === 'string'
    && (def?.type === 'lookup' || def?.type === 'master_detail')
    && def?.reference === source.o
    && def?.multiple !== true);
  return hits.length === 1 ? hits[0][0] : undefined;
}

/** Field types the auto-derived user-filter bar offers as dropdowns. */
const USER_FILTER_TYPES = new Set(['select', 'multiselect', 'radio', 'enum', 'boolean']);
/**
 * Relation field types the auto-derived bar also offers (objectui#13310): a
 * single-value relation renders as `UserFilters`' remote-search picker
 * (`LookupValuePicker`) and filters the rows by the related record's id.
 * A multi-value relation (`multiple: true`) stays out of the generated bar.
 */
const USER_FILTER_RELATION_TYPES = new Set(['lookup', 'master_detail', 'user']);
const MAX_USER_FILTERS = 4;

/**
 * The fields the `/data` page's auto-derived filter bar offers, in bar order.
 *
 * Picklist-like fields (`USER_FILTER_TYPES`) come first, in declaration
 * order, exactly as before relation fields joined the bar; single-value
 * relation fields (`USER_FILTER_RELATION_TYPES`) follow, in declaration order,
 * and take the slots the picklists leave under `MAX_USER_FILTERS`. So an
 * object without a single-value relation field gets the bar it always got, and
 * an object whose picklists already fill the cap keeps exactly that bar.
 * Hidden fields and fields the caller cannot read are never offered.
 *
 * Exported for `ObjectDataPage.relationUserFilters-13310.test.tsx`. @internal
 */
export function deriveDataPageUserFilterFields(
  fields: unknown,
  canRead: (field: string) => boolean,
): Array<{ field: string }> {
  if (!fields || typeof fields !== 'object') return [];
  type FieldDef = { type?: string; hidden?: boolean; multiple?: boolean } | null | undefined;
  const offered = Object.entries(fields as Record<string, FieldDef>).filter(
    ([name, f]) => f && !f.hidden && canRead(name),
  );
  const picklists = offered.filter(([, f]) => USER_FILTER_TYPES.has(f?.type ?? ''));
  const relations = offered.filter(
    ([, f]) => USER_FILTER_RELATION_TYPES.has(f?.type ?? '') && f?.multiple !== true,
  );
  return [...picklists, ...relations]
    .slice(0, MAX_USER_FILTERS)
    .map(([name]) => ({ field: name }));
}

/**
 * URL drill triple operator → the spec's OWN alias spelling.
 *
 * `parseUrlFilterTriples` speaks ObjectQL **symbols** (`=`, `>=`, `<=`, `>`,
 * `<`) because a triple is what the runtime filter AST consumes.
 * `ViewFilterRuleSchema.operator` enumerates a different vocabulary — the
 * canonical words (`equals`, `greater_than_or_equal`, …). `normalizeFilterOperator`,
 * the single canonicaliser this repo is allowed to use (it is also
 * `viewFilterFold`'s exit), knows the spec's *word* aliases (`eq`, `gte`, `lt`,
 * …) but not the symbols: hand it `'='` and it returns `'='` verbatim, which the
 * enum then rejects.
 *
 * So this table is a **symbol → alias bridge, not a second canonical map**.
 * The range half is derived by inverting `URL_FILTER_OPS`, whose suffixes
 * (`gte`/`lte`/`gt`/`lt`) are already spec alias keys — a range operator added
 * to the URL contract is therefore bridged here automatically. `'='` is the one
 * hand-written entry, because equality has no `[op]` suffix form to invert.
 * Canonicalisation itself stays in `normalizeFilterOperator`, exactly once.
 */
const TRIPLE_OP_TO_SPEC_ALIAS: Record<string, string> = {
  '=': 'eq',
  ...Object.fromEntries(
    Object.entries(URL_FILTER_OPS).map(([suffix, symbol]) => [symbol, suffix]),
  ),
  // objectstack#30743 — negation, text and membership triples carry their
  // canonical word already, which `normalizeFilterOperator` returns unchanged.
  ...URL_TRIPLE_OP_WORD,
};

/**
 * Fold URL drill triples into the spec's `ViewFilterRule[]` (objectui#3419).
 *
 * "Save as view" persists a **ViewItem**, and `ListViewSchema.filter` declares
 * `z.array(ViewFilterRuleSchema)` — a flat list of `{ field, operator, value }`
 * over the canonical operator vocabulary. The drill triples this page renders
 * from the URL are the *runtime AST* shape; writing them into the view body
 * verbatim produced an off-spec ViewItem (`config.filter.0` → "expected object,
 * received array").
 *
 * Contract-first (AGENTS.md #0.1): the fold happens **here, at the producer**.
 * The alternative — teaching `ViewItemSchema`'s consumers to also accept
 * triples — would put two filter dialects at rest, the exact debt this repo
 * keeps paying down. Same reasoning, and the same `normalizeFilterOperator`
 * exit, as `viewFilterFold.foldFilterGroupToSpecRules` (the FilterBuilder's
 * half of this problem, objectstack#5159).
 *
 * `field` and `value` are carried verbatim. A triple whose operator has no
 * canonical spelling — or whose value the rule schema refuses — is **dropped**
 * from the persisted view with a debug-level note, never written off-spec:
 * declared = enforced, and a view body that fails the record gate is rejected
 * whole at publish time, which would lose the user's other conditions too.
 * (`parseUrlFilterTriples` only ever emits operators bridged above, so
 * the drop path is defence in depth against the URL contract growing an
 * operator the spec has no word for.)
 */
function foldUrlFilterTriplesToSpecRules(triples: FilterTriple[]): ViewFilterRule[] {
  const rules: ViewFilterRule[] = [];
  for (const [field, op, value] of triples) {
    const rule: Record<string, unknown> = {
      field,
      operator: normalizeFilterOperator(TRIPLE_OP_TO_SPEC_ALIAS[op] ?? op),
    };
    // `viewFilterFold` carries `''` through as a real value; only a genuinely
    // absent one is omitted (unary operators take none).
    if (value !== undefined) rule.value = value;
    const parsed = ViewFilterRuleSchema.safeParse(rule);
    if (!parsed.success) {
      // objectui#4029 — this is a real diagnostic (data silently dropped),
      // not debug noise, so it goes through the allowed warn channel.
      console.warn(
        `[ObjectDataPage] Dropped URL filter on "${field}" from the saved view:` +
          ` operator "${op}" has no canonical ViewFilterRule form.`,
      );
      continue;
    }
    rules.push(parsed.data);
  }
  return rules;
}

/**
 * Assemble the list-view `spec` that "Save as view" hands to `viewEnvelope`.
 *
 * The whole producer step lives here rather than inline in the callback so it
 * can be pinned against the real record gate (`ViewItemSchema`) without
 * mounting the page and its provider stack — the fold above is only worth
 * having if the code that PERSISTS actually goes through it, and a test on the
 * fold alone would stay green if the call site went back to raw triples.
 *
 * `config` is the CreateViewDialog payload (`{ type, label, name, [type]:
 * subConfig }`); `fallbackColumns` is this page's auto-derived, field-security
 * trimmed column list, used only when the dialog carried none.
 *
 * This door resolves only its own inputs (those columns, and the URL
 * conditions folded to spec rules); the spec itself, with every type-specific
 * rule, is built by `buildNewViewSpec`, the one builder this door shares with
 * the add-view door (objectui#11581). An all-dropped fold writes no `filter`
 * key at all, byte-identical to a save with no drill conditions active.
 *
 * Exported for `ObjectDataPage.saveAsViewFilterFold.test.ts` and
 * `CreateViewDialog.viewTypeParse-11581.test.tsx`. @internal
 */
export function buildSaveAsViewSpec(
  config: Record<string, any>,
  fallbackColumns: string[],
  urlFilters: FilterTriple[],
): Record<string, any> {
  return buildNewViewSpec(config, {
    fallbackColumns,
    filter: foldUrlFilterTriplesToSpecRules(urlFilters),
  });
}

/**
 * objectstack#36408 — this page's own list defaults, for `ListView`'s
 * `viewDefaults`: no sort and no grouping (the page has no view to declare
 * either), the hidden fields and row height its `schema` never sets. The
 * sort and grouping `schema` carries are the address's, never a default the
 * list should offer to return to.
 */
const DATA_PAGE_LIST_DEFAULTS = { hiddenFields: undefined, rowHeight: undefined, sort: undefined, grouping: undefined };

/**
 * How many conditions the address's `uf__filter` carries, read from the
 * envelope itself before any check: `0` for no param, or for a value that is
 * not the `{ logic, conditions }` envelope at all (the address then carries no
 * panel filter to refuse). The same count `ObjectView` judges a link's filter
 * by (objectstack#31869), so a filter is refused whole on both lists.
 */
function addressPanelFilterConditionCount(searchParams: URLSearchParams): number {
  const raw = searchParams.get(LIST_FILTER_PARAM);
  if (!raw) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0;
  const { logic, conditions } = parsed as { logic?: unknown; conditions?: unknown };
  if (logic !== 'and' && logic !== 'or') return 0;
  return Array.isArray(conditions) ? conditions.length : 0;
}

export function ObjectDataPage({ dataSource, objects }: any) {
  const { appName, objectName } = useParams();
  const { t, language } = useObjectTranslation();
  // objectstack#35624 — the app Save as view saves the new view into.
  const createApp = useRuntimeCreateApp(t);
  const { objectLabel, objectPluralLabel, fieldLabel } = useObjectLabel();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const perms = usePermissions();
  const { can } = perms;
  const { canRead } = useFieldPermissions(objectName ?? '');
  const { user, activeOrganization } = useAuth();
  const { isAdmin } = useWorkspaceAdminStatus();
  const metadataClient = useMetadataClient();
  // ADR-0105: group posture appends a trailing organization_id attribution
  // column to the auto-derived columns (reads span all the user's orgs).
  const orgAttribution = useTenancyPosture() === 'group';
  // ADR-0037: enter draft-preview after "Save as view" so the fresh draft is
  // visible; if already previewing, keep the flag off the suffix (it's sticky).
  const previewDrafts = usePreviewDrafts();
  const [showCreateViewDialog, setShowCreateViewDialog] = React.useState(false);

  const objectDef = React.useMemo(
    () => (objects || []).find((o: any) => o.name === objectName),
    [objects, objectName],
  );
  // objectstack#34807 — in the draft preview the list reads its object
  // definition with the draft-only fields marked, so a column on one is drawn
  // empty instead of refusing the whole list query; outside it, the adapter.
  const listDataSource = usePreviewListDataSource(dataSource, objectDef);

  // ADR-0047 filter persistence — same wiring as InterfaceListPage: restore
  // `uf_*` once at mount, mirror selection changes back (replace, no history
  // spam).
  const [initialUfSelections] = React.useState<Record<string, string[]> | undefined>(
    () => parseUserFilterParams(new URLSearchParams(window.location.search)),
  );
  const handleUserFilterSelectionsChange = React.useCallback(
    (selections: Record<string, Array<string | number | boolean>>) => {
      setSearchParams((prev) => applyUserFilterParams(prev, selections), { replace: true });
    },
    [setSearchParams],
  );

  /**
   * objectstack#36408 — the list's own state in the address: the search term,
   * the sort, the grouping and the Filter panel's conditions, under the keys
   * `ObjectView` keeps them in (`uf__search`, `uf__sort`, `uf__group`,
   * `uf__filter`; `userFilterUrlState` owns their names and shapes). Opening a
   * record carries this address as the record page's origin, so its close —
   * and a reload, and a copied link — open the list as the reader left it.
   *
   * Two layers, never one rewriting the other: `filter[...]` stays this page's
   * own address conditions (the 「Filtered by」 tags, what 「Reset」 puts back
   * to the source, what "Save as view" saves), and `uf__filter` is the Filter
   * panel on top of them, exactly as `ObjectView` keeps the panel on top of its
   * view's filter. The list applies both (the conditions AND the panel).
   *
   * The SEED — what the list opens with — is read from the address once per
   * object and list generation (`ListView` takes its search and panel once, at
   * mount). Unlike `ObjectView`, a reload is not a reset here: this page has
   * no view to return to, and its address is the list ("the URL is the view").
   * Each piece passes `ObjectView`'s field gate: a field the object does not
   * declare, or one this user cannot read once permissions are loaded, is
   * dropped; a panel filter that loses any condition to the checks is refused
   * whole, with `ObjectView`'s notice (objectstack#31869). The seed is then
   * written back (replace), so the address shows what the list shows.
   *
   * 「Reset」 to the source (`resetToSource`) clears every `uf_` param, these
   * included, and moves the generation: the list remounts on an empty seed, so
   * it no longer searches, sorts, groups or filters by what the address lost.
   */
  const [listGeneration, setListGeneration] = React.useState(0);
  const listResetPendingRef = React.useRef(false);
  const listSeedRef = React.useRef<{
    key: string;
    state: ListUrlState;
    /** Taken by a 「Reset」, which wrote the address itself. */
    reset?: boolean;
    refusedPanelFilter?: boolean;
  } | undefined>(undefined);
  const listSeedKey = objectDef ? `${objectDef.name}~${listGeneration}` : undefined;
  if (objectDef && listSeedKey && listSeedRef.current?.key !== listSeedKey) {
    const reset = listResetPendingRef.current;
    listResetPendingRef.current = false;
    if (reset) {
      listSeedRef.current = { key: listSeedKey, state: {}, reset: true };
    } else {
      const acceptField: ListUrlFieldGate = (field: string) =>
        !!objectDef.fields?.[field]
        && (!perms.isLoaded || perms.checkField(objectDef.name, field, 'read'));
      const state = parseListStateParams(searchParams, acceptField);
      const carried = addressPanelFilterConditionCount(searchParams);
      const refusedPanelFilter = carried > 0 && (state.filters?.conditions.length ?? 0) < carried;
      if (refusedPanelFilter) delete state.filters;
      listSeedRef.current = { key: listSeedKey, state, refusedPanelFilter };
    }
  }
  const listSeed = listSeedRef.current?.key === listSeedKey ? listSeedRef.current?.state : undefined;
  React.useEffect(() => {
    const seed = listSeedRef.current;
    // A 「Reset」's seed writes nothing: the reset already cleared the
    // address, and the location this render read may still be the one before
    // it (the router commits a navigation in a transition), so a write from
    // it would put the cleared conditions back.
    if (!seed || seed.key !== listSeedKey || seed.reset) return;
    const next = applyListStateParams(searchParams, {
      filters: seed.state.filters ?? null,
      search: seed.state.search ?? null,
      sort: seed.state.sort ?? null,
      grouping: seed.state.grouping ?? null,
    });
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    if (seed.refusedPanelFilter) {
      seed.refusedPanelFilter = false;
      toast.warning(t('console.objectView.linkFilterRefused'));
    }
    // Once per seed, by design: later writes are the list's own changes,
    // already on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [listSeedKey]);
  /** Write the list's own change into the address — replace, never a history entry per keystroke. */
  const writeListUrlState = React.useCallback(
    (patch: ListStatePatch) => {
      setSearchParams((prev) => applyListStateParams(prev, patch), { replace: true });
    },
    [setSearchParams],
  );
  // The chips' selections the list remounts with: the address's at mount; none
  // after a 「Reset」, which cleared their params.
  const listUserFilterSelections = listGeneration === 0 ? initialUfSelections : undefined;

  // URL filter triples, trimmed to readable fields. Predicates on unreadable
  // fields are dropped here for UX honesty; the SERVER is the actual
  // enforcement point against filter-oracle probing.
  const filterParamsKey = Array.from(searchParams.entries())
    .filter(([k]) => k.startsWith('filter['))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const urlFilters = React.useMemo(() => {
    const all = parseUrlFilterTriples(new URLSearchParams(filterParamsKey));
    const readable = all.filter(([field]) => canRead(field));
    if (readable.length < all.length) {
      const dropped = all.filter(([field]) => !canRead(field)).map(([field]) => field);
      console.warn(
        `[ObjectDataPage] Dropped URL filter(s) on unreadable field(s): ${dropped.join(', ')}`,
      );
    }
    // Template variables mirror nav `recordId` substitution so shared links
    // can carry `{current_user_id}`. Routed through the shared resolver so a
    // link also gets `{current_org_id}` and date macros, instead of the single
    // hard-coded token this used to compare against (objectstack-ai/objectstack#3574).
    return resolveFilterPlaceholders(readable, {
      currentUserId: user?.id ?? null,
      currentOrgId: activeOrganization?.id ?? null,
    }) as FilterTriple[];
  }, [filterParamsKey, canRead, user?.id, activeOrganization?.id]);

  // One display chip per field — a date-bucket drill's two range triples
  // (>= start, < end) collapse into a single "start → end" chip (objectstack-ai/objectstack#1752).
  const filterChips = React.useMemo(() => groupFilterChips(urlFilters), [urlFilters]);

  /**
   * objectstack#35601 — a list opened by a record's related list (「↗」)
   * carries that record as its SOURCE, in the record trail (`?from=`, the last
   * entry): the breadcrumb names it, the source condition's chip names the
   * record instead of its id, 「Reset」 puts that condition back, and New
   * creates a record linked to it. The condition itself stays an ordinary URL
   * filter, removable like any other: the source only names it.
   */
  const sourceTrail = React.useMemo(
    () => decodeRecordTrail(searchParams.get(RECORD_TRAIL_PARAM)),
    [searchParams],
  );
  const source = sourceTrail.length > 0 ? sourceTrail[sourceTrail.length - 1] : undefined;
  const sourceField = React.useMemo(() => sourceRelationshipField(objectDef, source), [objectDef, source]);
  const sourceDef = sourceField ? (objects || []).find((o: any) => o?.name === source?.o) : undefined;
  const sourceConditionOn = !!source && !!sourceField
    && urlFilters.some(([field, op, value]) => field === sourceField && op === '=' && String(value) === source.i);
  const sourceFilterKey = sourceField ? `filter[${sourceField}]` : undefined;
  const conditionsAreSourced = sourceConditionOn
    && Array.from(searchParams.keys()).every((k) => k === sourceFilterKey || !(k.startsWith('filter[') || k.startsWith('uf_')));
  const resetToSource = React.useCallback(() => {
    if (!source || !sourceFilterKey) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      for (const [k, v] of prev.entries()) {
        if (k.startsWith('filter[') || k.startsWith('uf_')) continue;
        next.append(k, v);
      }
      next.set(sourceFilterKey, source.i);
      return next;
    });
    // objectstack#36408 — the list's own state left with its `uf_` params:
    // the list remounts on an empty seed (see `listSeedRef`).
    listResetPendingRef.current = true;
    setListGeneration((g) => g + 1);
  }, [source, sourceFilterKey, setSearchParams]);

  const removeUrlFilter = React.useCallback(
    (field: string) => {
      // Clears the equality param AND both range-bound operator params for the field.
      setSearchParams((prev) => deleteFieldFilterParams(new URLSearchParams(prev), field));
    },
    [setSearchParams],
  );

  // Auto-derived columns + filter bar, both trimmed by field-level security.
  const columns = React.useMemo(
    () => defaultColumnsFromObject(objectDef, { orgAttribution }).filter((f: string) => canRead(f)),
    [objectDef, canRead, orgAttribution],
  );
  const userFilters = React.useMemo(() => {
    const picks = deriveDataPageUserFilterFields(objectDef?.fields, canRead);
    return picks.length > 0 ? { element: 'dropdown' as const, fields: picks } : undefined;
  }, [objectDef, canRead]);

  // Record open behavior — the console's one rule for a list
  // (objectstack#35854), the same as `ObjectView`'s: the record's name (and a
  // card, and a touch tap on a row) opens the record's full page, carrying
  // this page as its origin (`from`: this URL with its conditions, the page's
  // name, the rows it shows and the count it matched), so the page's ✕ comes
  // back here and its ↑ ↓ step through these rows. The name cell's hover icon
  // 「在侧边打开」 opens the side drawer over the list instead, URL-driven
  // (`?recordId=…` is shareable and refresh-safe), and that drawer's ⤢ opens
  // the same full page with the same origin. A click on any other cell
  // selects it and opens nothing (the grid's select-first model). An object
  // the server does not read one record of (`servesRecordRead`, a list-only
  // object) has no record surface: its rows open nothing.
  const recordServed = servesRecordRead(objectName, perms);
  const phone = usePhoneViewport();
  const recordUrl = React.useCallback(
    (id: string | number) =>
      `/apps/${appName}/${objectName}/record/${encodeURIComponent(String(id))}`,
    [appName, objectName],
  );
  const navOverlay = useNavigationOverlay({
    navigation: { mode: 'drawer' },
    objectName: objectName ?? '',
    onNavigate: (id) => navigate(recordUrl(id)),
  });
  const drawerRecordId = searchParams.get(RECORD_DRAWER_PARAM);
  // Read when a record opens, never a render input of the list: the list's
  // URL, its name, the rows it shows and the count it matched.
  const location = useLocation();
  const locationRef = React.useRef(location);
  locationRef.current = location;
  const listLabel = objectDef ? servedObjectPluralLabel(objectDef, language, objectPluralLabel) : '';
  const listLabelRef = React.useRef(listLabel);
  listLabelRef.current = listLabel;
  const listRowsRef = React.useRef<ListShownRows>(listShownRowsOf([]));
  const listTotalRef = React.useRef<number | undefined>(undefined);
  const handleListRowsChange = React.useCallback(
    (rows: ReadonlyArray<Record<string, unknown>>, groups?: ReadonlyArray<{ label: string; rows: ReadonlyArray<Record<string, unknown>> }>) => {
      listRowsRef.current = listShownRowsOf(rows, groups);
    },
    [],
  );
  const handleListTotalChange = React.useCallback((total: number) => {
    listTotalRef.current = total;
  }, []);
  // The record's full page, with this page as its origin: the one way to it,
  // from the name and from the side drawer's ⤢ alike (objectstack#36300).
  const openRecordPage = React.useCallback(
    (id: string | number) => {
      const { pathname, search } = locationRef.current;
      navigate(recordUrl(id), {
        state: {
          from: listOriginOf({
            pathname,
            search,
            label: listLabelRef.current,
            rows: listRowsRef.current,
            total: listTotalRef.current,
            recordId: String(id),
          }),
          // A phone pushes the page over this list, so the page's 「‹」 goes
          // back in the history to this list's entry, as the object list's
          // page does (`useObjectViewRecordNavigation`).
          ...(phone ? { [RECORD_PAGE_PUSHED_STATE]: true } : {}),
        },
      });
    },
    [recordUrl, navigate, phone],
  );
  const handleRecordClick = React.useCallback(
    (record: any, event?: any) => {
      if (!recordServed) return;
      const id = record?.id ?? record?._id;
      if (id == null || id === '') return;
      const isMod = !!(event && (event.metaKey || event.ctrlKey || event.button === 1));
      if (isMod) { window.open(recordUrl(id), '_blank'); return; }
      openRecordPage(id);
    },
    [recordServed, recordUrl, openRecordPage],
  );
  // The name cell's 「在侧边打开」: the record in the side drawer over the list,
  // for a row with a record surface on a desktop. A phone opens every record
  // as its page, so it draws no icon.
  const openRowInPanel = React.useCallback(
    (id: string | number) => {
      setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set(RECORD_DRAWER_PARAM, String(id)); return n; });
    },
    [setSearchParams],
  );
  const openInPanelLabel = t('console.objectView.openInSidePanel', { defaultValue: 'Open in side panel' });
  const recordLinkAdornment = React.useMemo(
    () => (recordServed && !phone
      ? (row: Record<string, unknown>) => {
        const id = row?.id ?? row?._id;
        return (typeof id === 'string' && id !== '') || typeof id === 'number'
          ? <OpenInSidePanelButton recordId={id} label={openInPanelLabel} onOpen={openRowInPanel} />
          : null;
      }
      : undefined),
    [recordServed, phone, openInPanelLabel, openRowInPanel],
  );
  const closeRecordDrawer = React.useCallback(() => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete(RECORD_DRAWER_PARAM); return n; });
  }, [setSearchParams]);
  const openedRecordId = recordServed ? drawerRecordId : null;
  // The drawer bar's ⤢ 「Open as full page」, as the object list's drawer
  // draws it (objectstack#36300): the drawer closes and the record's full page
  // opens with the same origin a name click carries, so its ✕ comes back here.
  const openDrawerRecordAsPage = React.useCallback(() => {
    if (!openedRecordId) return;
    closeRecordDrawer();
    openRecordPage(openedRecordId);
  }, [openedRecordId, closeRecordDrawer, openRecordPage]);
  React.useEffect(() => {
    if (openedRecordId && !navOverlay.isOpen) navOverlay.open({ id: openedRecordId });
    else if (!openedRecordId && navOverlay.isOpen) navOverlay.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedRecordId]);

  // Visualization whitelist: grid always; others only when a field binding
  // resolves from the object. The switcher is ListView-internal, so switching
  // presentation never rewrites the URL — filter params survive by
  // construction (#2251 acceptance).
  const kanban = React.useMemo(() => defaultKanbanFromObject(objectDef), [objectDef]);
  const calendar = React.useMemo(() => defaultCalendarFromObject(objectDef), [objectDef]);
  const gallery = React.useMemo(() => defaultGalleryFromObject(objectDef), [objectDef]);
  const allowedVisualizations = React.useMemo(() => {
    const allowed = ['grid'];
    if (kanban) allowed.push('kanban');
    if (calendar) allowed.push('calendar');
    if (gallery) allowed.push('gallery');
    return allowed;
  }, [kanban, calendar, gallery]);

  const schema = React.useMemo(() => {
    if (!objectDef) return undefined;
    return {
      type: 'list-view' as const,
      objectName: objectDef.name,
      viewType: 'grid' as const,
      columns,
      ...(urlFilters.length ? { filter: urlFilters } : {}),
      // objectstack#36408 — the sort and the grouping the address carries
      // (`uf__sort`, `uf__group`), read once per seed (see `listSeedRef`).
      ...(listSeed?.sort ? { sort: listSeed.sort } : {}),
      ...(listSeed?.grouping ? { grouping: listSeed.grouping } : {}),
      kanban,
      calendar,
      gallery,
      userFilters,
      appearance: { allowedVisualizations },
      // This surface's INTENT to offer a switcher, not the final predicate:
      // `ListView` draws the chrome only when this whitelist INTERSECTED with
      // its capability gate still has more than one entry (objectui#7547). The
      // third face carrying this length count — the card named only the object
      // page and the interface page; this one is found by enumerating the
      // `ListView` render sites rather than grepping for the spelling.
      showViewSwitcher: allowedVisualizations.length > 1,
      // Full list capability — this surface trades the saved-view anchor for
      // the complete toolbar, NOT for a reduced one. (#2890: expressed as
      // `userActions`, the one vocabulary, instead of bare `show*` flags.)
      userActions: {
        search: true,
        sort: true,
        filter: true,
        rowHeight: true,
        group: true,
        hideFields: true,
      },
      showRecordCount: true,
      // Deliberately NO `onSortChange` / `onFilterChange` persistence hooks in
      // the schema: this surface never writes back to any saved view (#2251).
      // The list's own changes go to the ADDRESS only, through `ListView`'s
      // host callbacks below (objectstack#36408).
    };
  }, [objectDef, columns, urlFilters, listSeed, kanban, calendar, gallery, userFilters, allowedVisualizations]);

  // "Save as view" — the one exit into the workspace: materialize the current
  // URL conditions as a new saved view, then navigate to it. Resolves whether
  // the view was saved: `CreateViewDialog` closes only on `true` (objectui#11578).
  const handleSaveAsView = React.useCallback(
    async (config: Record<string, any> & { type: string; label: string }): Promise<boolean> => {
      try {
        // The URL conditions are folded into spec `ViewFilterRule`s on the way
        // out (#3419). What renders this page is a runtime filter AST (triples);
        // what gets PERSISTED must satisfy `ListViewSchema.filter`.
        const spec: Record<string, any> = buildSaveAsViewSpec(config, columns, urlFilters);
        // #2767 P1: unified identity — the qualified `<object>.<key>` name is the
        // URL segment AND the body identity. #2767 P4: land on the new draft in
        // preview mode so it's visible and one click from Publish.
        const env = viewEnvelope(objectName ?? '', spec, {
          name: config.name,
          label: config.label,
        });
        // #4373: the third writer into the `/meta/view` rows the adapter caches
        // — same seam, same key set, decided by the adapter.
        const createdId = await createRuntimeMetadata('view', env.name, env, {
          metadataClient,
          dataSource,
          objectName,
          // objectstack#35624 — saved into the app it was made in.
          app: createApp,
        });
        if (createdId) {
          const previewSuffix = previewDrafts
            ? ''
            : `?${PREVIEW_QUERY_FLAG}=${PREVIEW_QUERY_VALUE}`;
          navigate(`../view/${createdId}${previewSuffix}`, { relative: 'path' });
        }
        return true;
      } catch (err) {
        console.error('[ObjectDataPage] Failed to save view:', err);
        // objectui#11578: a refused save is SAID, with the door's own message
        // (the field-anchored issues of a 422, or the refusal's text), and
        // reported to the dialog as unsaved so it stays open.
        toast.error(t('form.saveError'), {
          description: formatMetadataError(err),
          classNames: { description: 'whitespace-pre-line' },
        });
        return false;
      }
    },
    [columns, urlFilters, metadataClient, dataSource, navigate, objectName, previewDrafts, t, createApp],
  );

  // ─── The CRUD affordance matrix for this surface (#5164) ──────────────
  //
  // Until #5164 this page gated its "New" on `can(objectDef.name, 'create')`
  // and nothing else — `resolveEffectiveCrudAffordances` was not called here at
  // all. The bare data surface therefore contradicted every other console
  // surface for the same object: `append-only` / `engine-owned` /
  // `better-auth` objects (whose bucket resolves `create: false`) were still
  // offered a "New" that navigates to `../new`, an object-level
  // `userActions: { create: false }` opt-out did not close the button, and the
  // objectstack#3391 effective-API-operation intersection was absent, so the toolbar could
  // offer a create the server would 405.
  //
  // Resolved exactly as `ObjectView` does, through the SAME `listNew` row of
  // the affordance-to-grant map (`resolveAffordance` in `@object-ui/core`,
  // objectui#12082): the spec's bucket/`userActions` matrix (ADR-0103,
  // delegated to `resolveCrudAffordances`), INTERSECTED with the
  // server-resolved effective API operations for this object, AND the caller's
  // create grant. `undefined` operations (unrestricted object / old backend)
  // leave the bucket affordances as-is.
  const newVerdict = React.useMemo(
    () =>
      objectDef
        ? resolveAffordance('listNew', { objectSchema: objectDef as SchemaLike, objectName: objectDef.name, perms })
        : { allowed: false },
    [objectDef, perms],
  );

  /**
   * [#5164] The create affordance's PREDICATE layer, the fourth of the four
   * this surface was missing. Binding, layering and the fail-CLOSED /
   * fail-SOFT split are `ObjectView`'s (#5153 / PR #5165) verbatim — the spec
   * types the toolbar keys once and binds them in one breath, so a
   * `userActions.create` declaration must not get a different verdict because
   * a different surface drew the button.
   *
   * BINDING: a toolbar predicate evaluates ONCE per toolbar against the record
   * of the scope the toolbar sits in — and this surface, like the standalone
   * object list, has NO record in scope. `null` is therefore passed
   * deliberately: a predicate reading `record.*` has nothing to bind, faults,
   * and — per the fail-closed rule — hides the button, exactly as the spec
   * spells out. Predicates over the host scope (`os.user.*` / `features.*`)
   * bind normally and are the meaningful shape here.
   *
   * LAYERING: surfaced only when the object-level verdict already passed. A
   * predicate may not RE-OPEN what the bucket, the effective API operations
   * (objectstack#3391) or the principal's grant have closed; it only narrows further. The
   * pre-existing `can(...)` gate is not removed, it is one conjunct of this.
   *
   * ONE RENDER POINT here, unlike `ObjectView`: this page has no phone FAB —
   * the whole PageHeader lives under `hidden sm:block`.
   */
  const objectCanCreate = newVerdict.allowed;
  const createPredicates: RowCrudPredicates | undefined = newVerdict.predicates;
  /** `visibleWhen` — fails CLOSED, declared-ness by `?? true` rather than by
   *  truthiness, so `visibleWhen: false` (the objectui#3492 shape) hides "New"
   *  instead of reading as "ungated". The `true` default is a boolean, which
   *  the evaluator short-circuits without touching the engine. */
  const createVisible = useRowPredicate(createPredicates?.visibleWhen ?? true, null, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:create:visibleWhen',
  });
  /** `disabledWhen` — fails SOFT (an unevaluable predicate must not grey a
   *  button forever), with the `!= null` declared-ness gate OUTSIDE the
   *  evaluation so `disabledWhen: ''` reads as "no condition", not "disable". */
  const createDisabledPred = useRowPredicate(createPredicates?.disabledWhen, null, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:create:disabledWhen',
  });
  const createDisabled = createPredicates?.disabledWhen != null && createDisabledPred;

  if (!objectDef) {
    return (
      <div className="h-full flex items-center justify-center p-8" data-testid="object-not-found">
        <Empty>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Database className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t('console.objectView.objectNotFound')}</EmptyTitle>
          <EmptyDescription>
            {t('console.objectView.objectNotFoundDescription', { objectName })}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // Route gate — no read permission renders an explicit denial, never an
  // empty list (#2251 security model). The server-enforced row filter is the
  // real boundary; this is the honest UI for "you can't be here".
  if (!can(objectDef.name, 'read')) {
    return (
      <div className="h-full flex items-center justify-center p-8" data-testid="object-data-403">
        <Empty>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t('console.objectData.noAccessTitle', { defaultValue: 'Access denied' })}</EmptyTitle>
          <EmptyDescription>
            {t('console.objectData.noAccess', {
              defaultValue: 'You do not have permission to view this data.',
            })}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // The header's actions, drawn in both of its faces (objectui#12705).
  // [#5164] `objectCanCreate && createVisible` — the bucket + object-level
  // `userActions` + objectstack#3391 effective-operations verdict AND the
  // principal's grant (the map's `listNew` row, objectui#12082), then the
  // toolbar-scope `visibleWhen` layer on top of it. Greyed, not gone, is the
  // `disabledWhen` case.
  const newButton = objectCanCreate && createVisible ? (
    <Button
      size="sm"
      onClick={() => {
        // objectstack#35601 — under a source, New is that record's child:
        // the record form overlay, linked to it (as the related list's New).
        if (source && sourceField) {
          const sp = new URLSearchParams(searchParams);
          sp.set(RECORD_FORM_PARAM, 'new');
          sp.set(RECORD_FORM_OBJECT_PARAM, objectDef.name);
          sp.set(RECORD_FORM_LINK_PARAM, `${sourceField}:${source.i}`);
          setSearchParams(sp);
          return;
        }
        navigate('../new', { relative: 'path' });
      }}
      disabled={createDisabled}
      className="shadow-none gap-1.5 h-8 sm:h-9"
      data-testid="object-data-new-button"
    >
      <Plus className="h-4 w-4" />
      <span className="hidden sm:inline">{t('console.objectView.new')}</span>
    </Button>
  ) : null;
  const saveAsViewButton = isAdmin ? (
    <Button
      size="sm"
      variant="outline"
      onClick={() => setShowCreateViewDialog(true)}
      className="shadow-none gap-1.5 h-8 sm:h-9"
      data-testid="object-data-save-as-view"
    >
      <Save className="h-4 w-4" />
      <span className="hidden sm:inline">
        {t('console.objectData.saveAsView', { defaultValue: 'Save as view' })}
      </span>
    </Button>
  ) : null;

  // objectstack#35601 — 「Object / Record / this list」: the way back to the
  // record whose related list opened this one.
  const sourceCrumbs = source && sourceField && appName ? (
    <nav
      className="flex min-w-0 items-center gap-1 px-3 pt-2 text-xs text-muted-foreground sm:px-4"
      data-testid="object-data-source-crumbs"
    >
      <Link className="truncate hover:text-foreground hover:underline" to={`/apps/${appName}/${source.o}`}>
        {sourceDef ? servedObjectPluralLabel(sourceDef, language, objectPluralLabel) : source.o}
      </Link>
      <span aria-hidden="true">/</span>
      <Link
        className="truncate hover:text-foreground hover:underline"
        to={buildRecordTrailHref(`/apps/${appName}`, source, sourceTrail.slice(0, -1))}
        data-testid="object-data-source-record"
      >
        {source.t || source.i}
      </Link>
      <span aria-hidden="true">/</span>
      <span className="truncate text-foreground">{servedObjectPluralLabel(objectDef, language, objectPluralLabel)}</span>
    </nav>
  ) : null;

  return (
    <div className="h-full flex flex-col bg-background min-w-0 overflow-hidden" data-testid="object-data-page">
      {sourceCrumbs}
      <div className="hidden sm:block">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              {/* The page lists the object's records, so it is titled with the
                  plural, as the object crumb above it is (objectui#11696). The
                  record drawer below keeps the singular. */}
              {/* A served object's label is already translated (objectstack#30311): drawn as given. */}
              <span className="truncate">{servedObjectPluralLabel(objectDef, language, objectPluralLabel)}</span>
              <span className="rounded border px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('console.objectData.badge', { defaultValue: 'Data' })}
              </span>
            </span>
          }
          subtitle={t('console.objectData.description', {
            defaultValue: 'URL-defined data slice — not bound to any saved view.',
          })}
          // The object's tile, in the colour the menu draws it in (objectstack#35985).
          iconTile={<ObjectIconTile size="lg" icon={(objectDef as any)?.icon} color={(objectDef as any)?.color} />}
          actions={
            <>
              {newButton}
              {saveAsViewButton}
            </>
          }
          // objectui#12705 — too narrow for both actions and the description:
          // New stays labelled and Save as view goes into a `⋯`. With no New
          // to keep labelled there is no folded face (objectstack#33988): it
          // would send the page's one action into the `⋯` for the description.
          foldedActions={
            newButton && <>
              {newButton}
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shadow-none h-8 sm:h-9 px-2"
                      aria-label={t('detail.moreActions', { defaultValue: 'More actions' })}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setShowCreateViewDialog(true)} data-testid="object-data-save-as-view-menu-item">
                      <Save className="h-4 w-4" />
                      <span>{t('console.objectData.saveAsView', { defaultValue: 'Save as view' })}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          }
        />
      </div>

      {/* URL filter chips — visible + individually removable (unlike Odoo's
          invisible action domain). Removal rewrites the URL, which is the
          single source of truth for this surface. */}
      {(urlFilters.length > 0 || (source && sourceField)) && (
        <div
          className="flex flex-wrap items-center gap-1.5 border-b px-3 sm:px-4 py-2 shrink-0"
          data-testid="object-data-filter-chips"
        >
          <span className="text-xs text-muted-foreground">
            {t('console.objectData.filteredBy', { defaultValue: 'Filtered by' })}
          </span>
          {filterChips.map(({ field, text, textKey }) => (
            <span
              key={field}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
            >
              <span className="font-medium">{fieldLabel(objectDef.name, field, field)}</span>
              {/*
                A chip carrying `textKey` is one whose text is PROSE rather than
                the user's own comparand, so it is translated HERE — the same
                half-chip seam that already draws the field name through
                `fieldLabel` (objectui#9159). Passed bare, with no inline
                `defaultValue`: all ten packs define this operator family and its
                locale-parity pin holds them to it, so a default would only be an
                unwatched second English spelling that hides a pack miss
                (objectui#3469 deleted exactly that pattern from this console).
              */}
              <span className="text-muted-foreground">
                {field === sourceField && sourceConditionOn
                  ? source?.t || text
                  : textKey && text !== undefined ? `${t(textKey)} ${text}` : textKey ? t(textKey) : text}
              </span>
              <button
                type="button"
                onClick={() => removeUrlFilter(field)}
                className="ml-0.5 rounded-full hover:bg-muted p-0.5"
                aria-label={t('console.objectData.removeFilter', {
                  defaultValue: 'Remove filter {{field}}',
                  field,
                })}
                data-testid={`object-data-remove-filter-${field}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {source && sourceField && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-6 gap-1 px-1.5 text-xs text-muted-foreground"
              onClick={resetToSource}
              disabled={conditionsAreSourced}
              data-testid="object-data-reset-source"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {t('common.reset')}
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {schema && (
          <ListView
            key={listGeneration}
            schema={schema as any}
            dataSource={listDataSource}
            userFilterSelections={listUserFilterSelections}
            onUserFilterSelectionsChange={handleUserFilterSelectionsChange}
            // objectstack#36408 — the list's search, Filter panel, sort and
            // grouping: opened from the address, and every change written
            // back to it (replace). `schema` carries the address's sort and
            // grouping, so this page's own defaults — no sort, no grouping —
            // are handed apart: the address's sort is no default this page
            // declares (the list draws no 「Reset to default」 for it).
            initialSearchTerm={listSeed?.search}
            initialFilters={listSeed?.filters}
            viewDefaults={DATA_PAGE_LIST_DEFAULTS}
            onSearchChange={(search: string) => writeListUrlState({ search })}
            onFilterChange={(filters) => writeListUrlState({ filters })}
            // No sort is this page's own default, so a cleared sort leaves the address.
            onSortChange={(sort) => writeListUrlState({ sort: sort.length > 0 ? sort : null })}
            onGroupingChange={(grouping) => writeListUrlState({ grouping: grouping ?? null })}
            onRowClick={handleRecordClick}
            // objectstack#35854 — the name opens the full page; the icon
            // beside it, on hover, opens the record in the side drawer.
            recordLinkAdornment={recordLinkAdornment}
            onRowsChange={handleListRowsChange}
            onTotalChange={handleListTotalChange}
            // objectstack#33317 — a list-only object's rows open nothing, so
            // the grid draws them no record link and no Open.
            rowOpensRecord={recordServed}
            // objectstack#35727 — the address conditions are this page's own
            // 「Filtered by」 tags; the list filters on them and draws no
            // second, locked chip for them.
            hostDrawnConditionFields={urlFilters.map(([field]) => field)}
          />
        )}
      </div>

      {navOverlay.isOverlay && (
        <NavigationOverlay
          {...navOverlay}
          setIsOpen={(open: boolean) => { if (!open) closeRecordDrawer(); }}
          onExpand={openedRecordId ? openDrawerRecordAsPage : undefined}
          title={servedObjectLabel(objectDef, language, objectLabel)}
        >
          {(record: any) => (
            <RecordDetailView
              objectNameOverride={objectDef.name}
              recordIdOverride={String(record?.id ?? record?._id ?? drawerRecordId ?? '')}
              embedded
              dataSource={dataSource}
              objects={objects}
              onEdit={() => {}}
            />
          )}
        </NavigationOverlay>
      )}

      {isAdmin && (
        <CreateViewDialog
          open={showCreateViewDialog}
          onOpenChange={setShowCreateViewDialog}
          onCreate={handleSaveAsView}
          objectDef={objectDef}
        />
      )}
    </div>
  );
}
