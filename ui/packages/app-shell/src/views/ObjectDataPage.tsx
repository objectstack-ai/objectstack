/**
 * Object Data Page — the parameterized bare data surface (ADR-0055, #2251).
 *
 * Route: `/apps/:appName/:objectName/data` (± `filter[<field>]=<value>` and
 * `uf_<field>` search params).
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
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
} from '@object-ui/components';
import { Database, Lock, MoreHorizontal, Plus, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatMetadataError } from '@object-ui/data-objectstack';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { usePermissions, useFieldPermissions } from '@object-ui/permissions';
import { useAuth, useWorkspaceAdminStatus } from '@object-ui/auth';
import { resolveAffordance, resolveFilterPlaceholders, type SchemaLike } from '@object-ui/core';
import { normalizeFilterOperator, ViewFilterRuleSchema } from '@objectstack/spec/ui';
import type { ViewFilterRule } from '@objectstack/spec/ui';
import { parseUserFilterParams, applyUserFilterParams } from './userFilterUrlState.js';
import {
  parseUrlFilterTriples,
  groupFilterChips,
  deleteFieldFilterParams,
  URL_FILTER_OPS,
  type FilterTriple,
} from './drillUrlFilters.js';
import {
  defaultColumnsFromObject,
  defaultKanbanFromObject,
  defaultCalendarFromObject,
  defaultGalleryFromObject,
} from './InterfaceListPage.js';
import { RecordDetailView } from './RecordDetailView.js';
import { PageHeader } from '../layout/PageHeader.js';
import { getIcon } from '../utils/getIcon.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { createRuntimeMetadata, viewEnvelope } from './runtime-metadata-persistence.js';
import { buildNewViewSpec } from './newViewSpec.js';
import { CreateViewDialog } from './CreateViewDialog.js';
import {
  usePreviewDrafts,
  PREVIEW_QUERY_FLAG,
  PREVIEW_QUERY_VALUE,
} from '../preview/PreviewModeContext.js';
import { useTenancyPosture } from '../hooks/useTenancyPosture.js';
import type { RowCrudPredicates } from '../utils/crudAffordances.js';

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
 * (`parseUrlFilterTriples` only ever emits the five operators bridged above, so
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

export function ObjectDataPage({ dataSource, objects }: any) {
  const { appName, objectName } = useParams();
  const { t } = useObjectTranslation();
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

  // Record open behavior — URL-driven drawer, same convention as ObjectView
  // and InterfaceListPage (`?recordId=…` is shareable and refresh-safe).
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
  const drawerRecordId = searchParams.get('recordId');
  const handleRecordClick = React.useCallback(
    (record: any, event?: any) => {
      const id = record?.id ?? record?._id;
      const isMod = !!(event && (event.metaKey || event.ctrlKey || event.button === 1));
      if (isMod && id != null) { window.open(recordUrl(id), '_blank'); return; }
      if (id != null) {
        setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('recordId', String(id)); return n; });
      }
    },
    [recordUrl, setSearchParams],
  );
  const closeRecordDrawer = React.useCallback(() => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('recordId'); return n; });
  }, [setSearchParams]);
  React.useEffect(() => {
    if (drawerRecordId && !navOverlay.isOpen) navOverlay.open({ id: drawerRecordId });
    else if (!drawerRecordId && navOverlay.isOpen) navOverlay.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerRecordId]);

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
      // Deliberately NO onSortChange/onFilterChange persistence hooks: this
      // surface never writes back to any saved view (#2251).
    };
  }, [objectDef, columns, urlFilters, kanban, calendar, gallery, userFilters, allowedVisualizations]);

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
    [columns, urlFilters, metadataClient, dataSource, navigate, objectName, previewDrafts, t],
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
      <div className="h-full flex items-center justify-center p-8">
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
      onClick={() => navigate('../new', { relative: 'path' })}
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

  return (
    <div className="h-full flex flex-col bg-background min-w-0 overflow-hidden" data-testid="object-data-page">
      <div className="hidden sm:block">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              {/* The page lists the object's records, so it is titled with the
                  plural, as the object crumb above it is (objectui#11696). The
                  record drawer below keeps the singular. */}
              <span className="truncate">{objectPluralLabel(objectDef)}</span>
              <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('console.objectData.badge', { defaultValue: 'Data' })}
              </span>
            </span>
          }
          subtitle={t('console.objectData.description', {
            defaultValue: 'URL-defined data slice — not bound to any saved view.',
          })}
          icon={React.createElement(getIcon((objectDef as any)?.icon), { className: 'h-4 w-4' })}
          actions={
            <>
              {newButton}
              {saveAsViewButton}
            </>
          }
          // objectui#12705 — too narrow for both actions and the description:
          // New stays labelled and Save as view goes into a `⋯`.
          foldedActions={
            <>
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
      {urlFilters.length > 0 && (
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
              <span className="text-muted-foreground">{textKey ? t(textKey) : text}</span>
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
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {schema && (
          <ListView
            schema={schema as any}
            dataSource={dataSource}
            userFilterSelections={initialUfSelections}
            onUserFilterSelectionsChange={handleUserFilterSelectionsChange}
            onRowClick={handleRecordClick}
          />
        )}
      </div>

      {navOverlay.isOverlay && (
        <NavigationOverlay
          {...navOverlay}
          setIsOpen={(open: boolean) => { if (!open) closeRecordDrawer(); }}
          title={objectLabel(objectDef)}
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
