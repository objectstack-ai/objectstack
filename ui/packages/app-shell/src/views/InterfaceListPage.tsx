/**
 * Interface List Page — ADR-0047 interface mode.
 *
 * Renders a page whose `interfaceConfig` binds a single source view into an
 * author-curated list surface. Where ObjectView (data mode) shows ALL of an
 * object's list views as switcher tabs and lets users create views, this
 * surface is deliberately closed:
 *
 *   • the page REFERENCES one view (`interfaceConfig.sourceView`) as a
 *     fallback — its columns (with its `hiddenFields` / `fieldOrder`) and
 *     sort are inherited unless the page defines its own `columns` /
 *     `sort`; its base filter is always inherited, with the page's
 *     `filterBy` appended (ADR-0047 revised);
 *   • end users get exactly the `userFilters` the author enabled;
 *   • the visualization comes from `appearance.allowedVisualizations`
 *     (a single entry renders no switcher);
 *   • `userActions` toggles map onto the toolbar — advanced filtering and
 *     view management are absent by default.
 *
 * Every member `ListView` reads is either relayed by the `schema` memo below
 * or answered as deliberately not relayed, with its reason, in
 * `InterfaceListPage.relayCensus-11572.test.ts`. That census re-derives the
 * members from `ListView`'s source and fails by name on a newly read member
 * that is neither.
 */

import * as React from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { ListView } from '@object-ui/plugin-list';
import { useAdapter, SchemaRenderer, useNavigationOverlay } from '@object-ui/react';
import { Empty, EmptyTitle, EmptyDescription, NavigationOverlay } from '@object-ui/components';
import { Database } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { isSystemManagedField } from '@object-ui/types';
import { leadWithNameField } from '@object-ui/core';
import type { ActionBarSchema, ListViewSchema } from '@object-ui/types';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useTenancyPosture } from '../hooks/useTenancyPosture.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { matchAppBySegment } from '../utils/index.js';
import { parseUserFilterParams, applyUserFilterParams } from './userFilterUrlState.js';
import { RecordDetailView } from './RecordDetailView.js';

interface InterfaceListPageProps {
  page: any;
  className?: string;
  /** Design-mode only: persist toolbar edits (sort, column order) back to the
   * page's interfaceConfig metadata (Airtable parity — the toolbar IS the
   * authoring surface). Receives a partial interfaceConfig patch. */
  onConfigChange?: (patch: Record<string, unknown>) => void;
  /** When the host overlays an edit-in-studio affordance at the page's
   * top-right (PageView's pencil), reserve right padding on the header so the
   * toolbar buttons don't sit under it. */
  reserveEditAffordance?: boolean;
}

/**
 * Resolve the source list view from the merged object definition.
 * Views merged from ADR-0017 ViewItems are keyed `<object>.<key>`;
 * the page author writes the bare key (`sourceView: 'default'`).
 */
/** A view "carries columns" only when its column list is actually non-empty. */
function hasColumns(v: any): boolean {
  return Array.isArray(v?.columns) && v.columns.length > 0;
}

function resolveSourceView(objectDef: any, sourceView?: string): any | undefined {
  // `listViews` is canonical (#5362; @objectstack/spec declares only camelCase). The
  // `list_views` leg is a compatibility READ for stored pre-settlement documents
  // (that stock has never been censused: objectstack#7917). Never WRITE the snake key.
  const views: Record<string, any> = objectDef?.listViews || objectDef?.list_views || {};
  // ADR-0017 expansion can serve a default-view item with an empty config
  // while the full body lives on `objectDef.list` — prefer candidates that
  // actually carry columns over hollow name matches. An empty `columns: []`
  // is truthy in JS but renders a column-less grid, so check for non-empty.
  const candidates = sourceView
    ? [
        views[`${objectDef?.name}.${sourceView}`],
        views[sourceView],
        ...(sourceView === 'default' || sourceView === 'list' ? [objectDef?.list] : []),
      ]
    : [objectDef?.list, ...Object.values(views)];
  const present = candidates.filter(Boolean);
  return present.find(hasColumns) ?? present[0];
}

/**
 * Default column set when the resolved view carries none — mirrors
 * ObjectView's data-mode fallback so an interface page never renders a
 * column-less grid. Priority: the object's name field always leads
 * (`leadWithNameField`, objectui#7245 — `highlightFields` is ADR-0085's
 * "most important fields" role, which the detail highlight strip deliberately
 * strips the title out of, so well-authored metadata often omits it and the
 * synthesized list had no column identifying the row); then the
 * `highlightFields` semantic role (ADR-0085), else the first business fields —
 * framework-managed system/audit/ownership columns (including the injected,
 * editable `owner_id`) are excluded via the shared `isSystemManagedField`
 * classifier.
 *
 * The lead is applied on BOTH branches, and before the slice on the fallback
 * walk, exactly as in `ObjectView.defaultListColumnsFromObject` — the two are
 * documented as mirrors, so they must not drift on this.
 *
 * `opts.orgAttribution` (ADR-0105 group posture): reads span every
 * organization the member belongs to, so cross-org rows need attribution —
 * append `organization_id` as a TRAILING column when the object carries the
 * field. Render-time only; never persisted into page/view metadata.
 */
export function defaultColumnsFromObject(
  objectDef: any,
  opts?: { orgAttribution?: boolean },
): string[] {
  const withOrgAttribution = (cols: string[]): string[] =>
    opts?.orgAttribution && objectDef?.fields?.organization_id && !cols.includes('organization_id')
      ? [...cols, 'organization_id']
      : cols;
  const curated = objectDef?.highlightFields;
  if (Array.isArray(curated) && curated.length > 0) {
    return withOrgAttribution(
      leadWithNameField(objectDef, curated.filter((n: string) => objectDef.fields?.[n])),
    );
  }
  const fields = objectDef?.fields;
  if (fields && typeof fields === 'object') {
    return withOrgAttribution(
      leadWithNameField(
        objectDef,
        Object.entries(fields)
          .filter(([name, f]: [string, any]) => f && !f.hidden && !isSystemManagedField(name, f))
          .map(([name]) => name),
      ).slice(0, 6),
    );
  }
  return [];
}

/**
 * Default visualization bindings derived from the object's fields.
 *
 * ADR-0047: an interface page sets `appearance.allowedVisualizations` to
 * whitelist renderers, but a viz only renders when its field binding
 * resolves (kanban needs a group field, calendar a date, gallery a cover).
 * The page config has nowhere to set those, so — like `defaultColumnsFromObject`
 * — we auto-pick a sensible binding from the object (Airtable does the same
 * when you switch to Kanban). Without this, a whitelisted kanban is silently
 * dropped from the switcher and the author gets no feedback.
 */
function firstFieldMatching(
  objectDef: any,
  pred: (name: string, f: any) => boolean,
): string | undefined {
  const fields = objectDef?.fields;
  if (!fields || typeof fields !== 'object') return undefined;
  const hit = Object.entries(fields).find(
    ([name, f]: [string, any]) => f && !f.hidden && !isSystemManagedField(name, f) && pred(name, f),
  );
  return hit?.[0];
}

const SELECT_TYPES = new Set(['select', 'multiselect', 'radio', 'enum', 'boolean']);
const DATE_TYPES = new Set(['date', 'datetime', 'time']);
const IMAGE_TYPES = new Set(['image', 'file', 'attachment', 'avatar', 'photo']);

export function defaultKanbanFromObject(objectDef: any): { groupByField: string } | undefined {
  const field =
    firstFieldMatching(objectDef, (_n, f) => SELECT_TYPES.has(f.type)) ??
    firstFieldMatching(objectDef, (n) => /status|stage|state|priority|category|kind/i.test(n));
  // `groupByField` is the spec key. This used to emit the legacy `groupField`
  // alongside it because ListView rendered off the alias only — that read-site
  // now prefers the spec key, so one key is enough.
  return field ? { groupByField: field } : undefined;
}

function defaultDateField(objectDef: any): string | undefined {
  return (
    firstFieldMatching(objectDef, (_n, f) => DATE_TYPES.has(f.type)) ??
    firstFieldMatching(objectDef, (n) => /date|due|start|end|deadline|schedule/i.test(n))
  );
}

export function defaultCalendarFromObject(objectDef: any): { startDateField: string } | undefined {
  const field = defaultDateField(objectDef);
  return field ? { startDateField: field } : undefined;
}

export function defaultGalleryFromObject(objectDef: any): { coverField: string } | undefined {
  const field = firstFieldMatching(objectDef, (_n, f) => IMAGE_TYPES.has(f.type));
  return field ? { coverField: field } : undefined;
}

const LOCATION_TYPES = new Set(['location', 'geo', 'geolocation', 'geopoint', 'point']);

// Gantt needs BOTH a start and an end date. Prefer name-disambiguated fields
// (start_date / end_date / due_date), else fall back to the first two date
// fields. Returns undefined unless two distinct dates resolve.
export function defaultGanttFromObject(objectDef: any): { startDateField: string; endDateField: string; progressField?: string } | undefined {
  const start =
    firstFieldMatching(objectDef, (n, f) => DATE_TYPES.has(f.type) && /start|begin|kickoff/i.test(n)) ??
    firstFieldMatching(objectDef, (_n, f) => DATE_TYPES.has(f.type));
  if (!start) return undefined;
  const end =
    firstFieldMatching(objectDef, (n, f) => DATE_TYPES.has(f.type) && n !== start && /end|due|finish|deadline|close/i.test(n)) ??
    firstFieldMatching(objectDef, (_n, f) => DATE_TYPES.has(f.type) && _n !== start);
  if (!end) return undefined;
  const progress = firstFieldMatching(objectDef, (n, f) => (f.type === 'number' || f.type === 'percent') && /progress|percent|complete/i.test(n));
  return { startDateField: start, endDateField: end, ...(progress ? { progressField: progress } : {}) };
}

/**
 * Map needs a location/geo field (or address). Auto-derive from a location-typed
 * field, else a field whose name looks geographic.
 *
 * Like every sibling deriver above, this binds its viz's own REQUIRED field and
 * nothing else — `kanban → groupByField`, `calendar → startDateField`,
 * `gallery → coverField`, `gantt → start/end`, `map → locationField`. A marker
 * TITLE is not this seam's to bind.
 *
 * ## Why the derived title binding was removed (objectui#6343)
 *
 * It existed (objectui#5909) to route around a forge in `ObjectMap` that no
 * longer exists: `getMapConfig` used to fill an absent `titleField` with the
 * literal `'name'`, and the marker title was then a plain `record[titleField]`
 * read — so an object whose display field was not literally `name` titled every
 * marker popup `undefined`. objectui#5953 deleted that forge. `ObjectMap` now
 * resolves marker titles through `@object-ui/core#getRecordDisplayName`, the
 * same ADR-0079 resolver `ObjectKanban`, `ObjectCalendar` and `ObjectGantt`
 * already used, which is exactly why none of them needs a derived binding
 * either.
 *
 * What the binding left behind once the forge was gone was not redundancy but
 * an INVERSION. It reaches the resolver as `options.titleField`, which is
 * precedence **step 0** — ahead of every OBJECT-level rung beneath it: the
 * declared `nameField` pointer and its `displayNameField` alias (step 1/2),
 * the legacy `titleFormat` template (step 3), and the type-aware derivation
 * from `objectDef.fields` (step 4). Measured against that ladder, a field name
 * derived HERE can only ever change the answer by out-ranking something the
 * object itself declared; in every other case it reproduces, at step 0, the
 * string the resolver already computes further down. So the binding's entire
 * live effect was to let a per-view guess outrank declared metadata — the
 * governed-authority default says the declared side wins, and it now does.
 *
 * That ladder has NO object-level `titleField` rung — the middle term this
 * passage used to name. It was never a step of its own: it was a second `??`
 * leg inside step 0, deleted in objectui#6531 because `@objectstack/spec`'s
 * object schema is a `strictObject` that REJECTS the key with
 * `unrecognized_keys` — the same issue code a nonsense key gets — so no
 * spec-compliant object metadata can ever supply it. Step 0 is
 * `options.titleField` alone, and the OBJECT-level ladder starts at the
 * declared `nameField` — see the `getRecordDisplayName` docblock in
 * `@object-ui/core`'s `record-title.ts`.
 *
 * The async window `ObjectMap` has before its `getObjectSchema` fetch lands is
 * NOT an argument for keeping a static binding here: `ObjectKanban` fetches its
 * object definition exactly the same way and carries no derived title. Closing
 * that window is a renderer-side change (hand the definition down from
 * `ListView`, which already holds it), and it would cover the paths this seam
 * never sees — a hand-declared `map` block that omits `titleField`, and every
 * non-interface-page map.
 *
 * An author's own `map.titleField` is unaffected: it is declared, it travels as
 * the view-level `map` block that `ListView` merges per key over this bag, and
 * `getRecordDisplayName` honours it at step 0 by design.
 */
export function defaultMapFromObject(objectDef: any): { locationField: string } | undefined {
  const field =
    firstFieldMatching(objectDef, (_n, f) => LOCATION_TYPES.has(f.type)) ??
    firstFieldMatching(objectDef, (n) => /location|address|geo|coords?|place|venue/i.test(n));
  if (!field) return undefined;
  return { locationField: field };
}

export function InterfaceListPage({ page, className, onConfigChange, reserveEditAffordance }: InterfaceListPageProps) {
  const { t } = useObjectTranslation();
  // objectui#12980 — the source object, read by name, not the whole registry:
  // reading `objects` would load every object to find one. Inside an app that
  // names a package it rides the app's scope, as `nav:menu`'s capability gate
  // does, so the page route's scope read (which holds the source already) is
  // reused rather than asked again; outside one it is the names-only scope. A
  // hand-rolled metadata context has no scope, and is read as it is.
  const metadata = useMetadata();
  const { appName } = useParams();
  const { currentAppName } = useNavigationContext();
  const dataSource = useAdapter();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // ADR-0105: group posture appends a trailing organization_id attribution
  // column to the object-derived default column set (reads span all orgs).
  const orgAttribution = useTenancyPosture() === 'group';

  // ADR-0047 filter persistence: restore `uf_*` URL params once at mount,
  // mirror every selection change back (replace — no history spam).
  const [initialUfSelections] = React.useState<Record<string, string[]> | undefined>(
    () => parseUserFilterParams(new URLSearchParams(window.location.search)),
  );
  const handleUserFilterSelectionsChange = React.useCallback(
    (selections: Record<string, Array<string | number | boolean>>) => {
      setSearchParams(prev => applyUserFilterParams(prev, selections), { replace: true });
    },
    [setSearchParams],
  );

  const cfg = page?.interfaceConfig || {};
  const activeApp = matchAppBySegment(
    ((metadata.apps as any[]) || []).filter((a: any) => a?.active !== false),
    appName ?? currentAppName ?? null,
  ) as Record<string, unknown> | undefined;
  const appPackageId =
    typeof activeApp?._packageId === 'string' && activeApp._packageId ? activeApp._packageId : undefined;
  const sourceObjects: any[] = !cfg.source
    ? []
    : metadata.readObjectScope
      ? metadata.readObjectScope(appPackageId ? { packageId: appPackageId, names: [cfg.source] } : { names: [cfg.source] })
          .objects
      : metadata.objects || [];
  // Not memoised: the scope's list is read afresh each render, as `objects` was.
  const objectDef = sourceObjects.find((o: any) => o?.name === cfg.source);
  const resolvedView = React.useMemo(
    () => resolveSourceView(objectDef, cfg.sourceView),
    [objectDef, cfg.sourceView],
  );

  // ── Record open behavior (ADR-0047) — how clicking a record opens its detail.
  // 'drawer' (default) = right-side peek panel rendering the record's detail
  // page; 'page' = full-page navigate to the record route; 'none' = not
  // clickable. Restores record-opening on interface pages (previously a no-op)
  // and makes it author-configurable.
  const recordAction: 'drawer' | 'page' | 'modal' | 'none' =
    cfg.recordAction === 'page' || cfg.recordAction === 'modal' || cfg.recordAction === 'none'
      ? cfg.recordAction
      : 'drawer';
  const recordUrl = React.useCallback(
    (id: string | number) => {
      const seg = window.location.pathname.split('/');
      const appSeg = seg[2] || '';
      return `/apps/${appSeg}/${cfg.source}/record/${encodeURIComponent(String(id))}`;
    },
    [cfg.source],
  );
  const navOverlay = useNavigationOverlay({
    navigation: { mode: recordAction === 'none' ? 'none' : recordAction },
    objectName: cfg.source,
    onNavigate: (id) => navigate(recordUrl(id)),
  });
  const drawerRecordId = searchParams.get('recordId');
  const handleRecordClick = React.useCallback(
    (record: any, event?: any) => {
      if (recordAction === 'none') return;
      const id = record?.id ?? record?._id;
      const isMod = !!(event && (event.metaKey || event.ctrlKey || event.button === 1));
      if (isMod && id != null) { window.open(recordUrl(id), '_blank'); return; }
      // Overlay modes are URL-driven (?recordId=…) so the drawer is shareable
      // and survives refresh — same convention as ObjectView.
      if ((recordAction === 'drawer' || recordAction === 'modal') && id != null) {
        setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('recordId', String(id)); return n; });
        return;
      }
      navOverlay.handleClick(record, event);
    },
    [recordAction, recordUrl, navOverlay, setSearchParams],
  );
  const closeRecordDrawer = React.useCallback(() => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('recordId'); return n; });
  }, [setSearchParams]);
  React.useEffect(() => {
    if (drawerRecordId && !navOverlay.isOpen) navOverlay.open({ id: drawerRecordId });
    else if (!drawerRecordId && navOverlay.isOpen) navOverlay.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerRecordId]);

  // The view list endpoint can serve hollow expansion items (no columns);
  // the full body lives behind the per-view overlay API — the same
  // hydration ObjectView performs. Only fetch when the resolution came up
  // hollow.
  //
  // IMPORTANT: the deps are SCALARS, not the objectDef/resolvedView object
  // identities. `useMetadata().objects` is rebuilt per render, so identity
  // deps re-fire this effect on every render — and the unconditional
  // `setHydratedView(null)` then ping-pongs with the async `setHydratedView
  // (full)` into an infinite render/refetch loop the moment anything (e.g.
  // a `uf_*` URL write) re-renders this component after hydration settled.
  const objectDefName: string | undefined = objectDef?.name;
  // Hollow = no *non-empty* column list. An empty `columns: []` reads as
  // truthy but renders nothing, so it must still trigger hydration.
  const resolvedViewHollow = !!resolvedView && !hasColumns(resolvedView);
  const resolvedViewKey = resolvedView?.name
    ?? (cfg.sourceView ? `${cfg.source}.${cfg.sourceView}` : undefined);
  const [hydratedView, setHydratedView] = React.useState<any>(null);
  React.useEffect(() => {
    let cancelled = false;
    setHydratedView(null);
    if (!objectDefName || !cfg.source || !resolvedViewHollow || !resolvedViewKey) return;
    (async () => {
      try {
        const ds: any = dataSource;
        let full: any = null;
        if (typeof ds?.listViewOverrides === 'function') {
          // Scoped catch: the batch enumeration REJECTS on a transport failure
          // rather than answering an authoritative-looking `{}` (objectui#3774
          // / the `DataSource.listViewOverrides` contract). That failure must
          // not skip the per-view `getView` below — it is precisely the case
          // the fallback exists for. Without this the outer catch would abort
          // the whole hydration and the view would stay hollow.
          try {
            const all = await ds.listViewOverrides(cfg.source);
            full = all?.[resolvedViewKey] ?? null;
          } catch { /* fall through to the per-view read */ }
        }
        if (!hasColumns(full) && typeof ds?.getView === 'function') {
          full = await ds.getView(cfg.source, resolvedViewKey);
        }
        if (!cancelled && full && typeof full === 'object') setHydratedView(full);
      } catch { /* hollow view stays hollow — renderer falls back to defaults */ }
    })();
    return () => { cancelled = true; };
  }, [objectDefName, cfg.source, cfg.sourceView, resolvedViewHollow, resolvedViewKey, dataSource]);

  const viewDef = React.useMemo(
    () => (hydratedView ? { ...resolvedView, ...hydratedView } : resolvedView),
    [resolvedView, hydratedView],
  );

  // Key the schema on CONTENT, not object identity — `objects` (and thus
  // objectDef/resolvedView) are rebuilt per render, and a new schema
  // identity makes ListView refetch. The serialized view config is small.
  const viewDefJson = JSON.stringify(viewDef ?? null);
  const schema = React.useMemo(() => {
    if (!objectDef) return undefined;
    const view = viewDef || {};
    const appearance = cfg.appearance ?? view.appearance;
    const allowed: string[] = appearance?.allowedVisualizations || [];
    const allowedSet = new Set(allowed);
    const userActions = cfg.userActions || {};

    // Viz field bindings: the referenced view's config wins; otherwise, when
    // the author whitelisted a viz, derive a sensible default binding from the
    // object so the switcher actually offers (and renders) it. Only derive for
    // whitelisted types — an un-whitelisted viz is never reachable.
    //
    // objectui#10380 — nor for a kind the stored row's legacy `options` bag
    // carries. That bag is declared metadata: the view write door judges it
    // key by key and stores it, and `ListView` lays the top-level block over it
    // per key. A derived default placed at the top level would therefore
    // OUTRANK the row's own declaration, and the object page, which derives
    // nothing, would render the row differently. So a derived default fills a
    // kind only when the row declares that kind nowhere. That is the rule
    // `mapCfg` below already follows (`view.options.map ?? derived`).
    const legacyOptions: Record<string, unknown> =
      view.options && typeof view.options === 'object' && !Array.isArray(view.options) ? view.options : {};
    const derives = (kind: string): boolean => allowedSet.has(kind) && legacyOptions[kind] === undefined;
    const kanban =
      view.kanban ?? (derives('kanban') ? defaultKanbanFromObject(objectDef) : undefined);
    const calendar =
      view.calendar ?? (derives('calendar') ? defaultCalendarFromObject(objectDef) : undefined);
    const timeline =
      view.timeline ?? (derives('timeline') ? defaultCalendarFromObject(objectDef) : undefined);
    const gallery =
      view.gallery ?? (derives('gallery') ? defaultGalleryFromObject(objectDef) : undefined);
    const gantt =
      view.gantt ?? (derives('gantt') ? defaultGanttFromObject(objectDef) : undefined);
    // Map binding lives under options.map (locationField); auto-derive when
    // whitelisted so a map interface page renders without hand-wiring.
    //
    // The referenced view's own spec-level `map` block is NOT folded in here —
    // it is forwarded as `map` on the schema below, so `ListView` merges it
    // per key over this bag (objectui#5042). Collapsing the two with `??`, the
    // way the sibling bindings above do, would make a partial authored block
    // REPLACE the derivation: `map: { titleField: 'title' }` alone would drop
    // the auto-derived `locationField` and the page would render no markers.
    const mapCfg =
      (view.options as any)?.map ?? (allowedSet.has('map') ? defaultMapFromObject(objectDef) : undefined);

    // Data semantics — ADR-0047 (revised): the PAGE owns its view metadata.
    // Precedence everywhere: the page's own config → legacy sourceView view
    // (back-compat) → a sensible default derived from the object.
    const filters = [
      ...(Array.isArray(view.filter) ? view.filter : []),
      ...(Array.isArray(cfg.filterBy) ? cfg.filterBy : []),
    ];

    // Columns: the page's own `columns` win; else the legacy referenced view's;
    // else a default from the object so the grid never renders just the
    // row-number column.
    //
    // The view's `hiddenFields` / `fieldOrder` travel WITH the view's columns
    // (objectui#10638): the spec composes the three per view — `columns`
    // projects, `hiddenFields` subtracts, `fieldOrder` sorts the survivors
    // (objectstack#15184 ruling B) — and `ListView`'s `effectiveFields` runs
    // that composition, so this page only delivers the two values. They apply
    // on the middle branch alone. The page config declares neither key, and
    // its own `columns` are "defined directly on the page (no view
    // inheritance)" — a view order would otherwise re-sort the very list the
    // design-mode column drag saves as `columns`. An empty view `columns`
    // "declares no projection, so neither of them applies".
    const viewComposes = !hasColumns(cfg) && hasColumns(view);
    const columns = hasColumns(cfg)
      ? (cfg.columns as any)
      : viewComposes
        ? view.columns
        : defaultColumnsFromObject(objectDef, { orgAttribution });

    // Sort: the page's own first, then the legacy view's.
    const sort = Array.isArray(cfg.sort) && cfg.sort.length ? cfg.sort : view.sort;

    return {
      type: 'list-view' as const,
      objectName: objectDef.name,
      // Narrowed to the schema's declared union rather than left as `string`:
      // `allowedVisualizations` arrives as `string[]`, so this expression is a
      // bare `string` and only type-checked against `ListViewSchema` from
      // objectui#4528 onwards — before that, `ListViewProps` carried a
      // `[key: string]: any` that erased `schema` to `any` at this call site.
      // The assertion changes no value; the runtime string is what it was.
      viewType: (allowed[0] ?? view.type ?? 'grid') as ListViewSchema['viewType'],
      columns,
      ...(viewComposes && view.hiddenFields !== undefined ? { hiddenFields: view.hiddenFields } : {}),
      ...(viewComposes && view.fieldOrder !== undefined ? { fieldOrder: view.fieldOrder } : {}),
      ...(filters.length ? { filter: filters } : {}),
      ...(sort?.length ? { sort } : {}),
      grouping: view.grouping,
      rowColor: view.rowColor,
      pagination: view.pagination,
      searchableFields: view.searchableFields,
      // objectui#12270 — the page's own `interfaceConfig.emptyState` (the spec
      // declares it on `InterfacePageConfigSchema` as the list view's own
      // `EmptyStateSchema`) wins over the source view's, whole, on every
      // visualization: the page states what belongs in its empty list. The
      // source view's stays the fallback, as its `appearance` and
      // `userFilters` are.
      emptyState: cfg.emptyState ?? view.emptyState,
      kanban,
      calendar,
      gallery,
      timeline,
      gantt,
      // The spec's view-level `map` block (`ListMapConfigSchema`), forwarded
      // verbatim so `ListView` can merge it over the `options.map` bag below.
      ...((view as any).map ? { map: (view as any).map } : {}),
      // objectui#11572 — the view's declared `tree` and `chart` blocks, carried
      // as the per-kind blocks above are. `appearance.allowedVisualizations`
      // may whitelist either kind, and without its block `ListView`'s tree
      // branch had no `parentField` and its chart branch no binding, while the
      // object page relayed both. No page-derived default exists for either
      // kind (nothing here can guess a parent pointer or a measure), so
      // `derives` has nothing to gate: the declared block alone is relayed, and
      // a whitelisted kind with no block reaches `ListView` with none. Each is
      // forwarded whole, a pointer rather than a projection of its keys, as the
      // object page forwards the chart block (objectui#7823). `ListView` reads
      // the top-level block first and the `options` bag below only without it.
      ...(view.tree !== undefined ? { tree: view.tree } : {}),
      ...(view.chart !== undefined ? { chart: view.chart } : {}),
      ...((mapCfg || (view.options as any)) ? { options: { ...((view.options as any) ?? {}), ...(mapCfg ? { map: mapCfg } : {}) } } : {}),

      // Presentation policy — the page layer (ADR-0047).
      userFilters: cfg.userFilters ?? view.userFilters,
      appearance,
      // The page author's INTENT, not the final predicate: `ListView` draws the
      // chrome only when this whitelist INTERSECTED with its capability gate
      // still has more than one entry (objectui#7547). Same note as the object
      // page's twin — the whitelist is not the offer.
      showViewSwitcher: allowed.length > 1,
      showRecordCount: cfg.showRecordCount,
      // The page config's own "Allow users to print the page"
      // (`InterfacePageConfigSchema`, Advanced). `ListView` draws its print
      // button off `schema.allowPrinting`, and nothing on this page wrote it,
      // so the declared toggle did nothing (objectui#11572). The page's value
      // only, like `showRecordCount` beside it: the page config declares the
      // key, so the source view's copy does not stand in for it.
      allowPrinting: cfg.allowPrinting,
      // Add-record entry point (ListView gates the button on addRecord.enabled,
      // independent of the active visualization). Without forwarding this, the
      // panel's "Add Record" config silently did nothing at runtime.
      addRecord: cfg.addRecord,

      // userActions passes straight through to the toolbar (#2890) — this used
      // to unpack it into bare `show*` flags, which is why the three toggles
      // with no `userActions` key (group / hideFields / rowColor) were HARDCODED
      // off here and hardcoded on in ObjectDataPage: two surfaces, two opposite
      // policies, neither author-controllable. They are author-controllable now.
      //
      // Interface mode stays closed BY DEFAULT — the advanced filter builder,
      // density and the view-management tools are present only when the author
      // opted in — but "closed by default" is expressed as a default here, not
      // as an unreachable constant.
      userActions: {
        search: userActions.search !== false,
        sort: userActions.sort !== false,
        filter: userActions.filter === true,
        rowHeight: userActions.rowHeight === true,
        group: userActions.group === true,
        hideFields: userActions.hideFields === true,
        rowColor: userActions.rowColor === true,
      },
      allowExport: false,
      // Inline record editing is a page-authored property read from
      // `userActions.editInline`, on by default (the v18 protocol default,
      // objectstack#22605): a page opts out with `editInline: false`. This page
      // wires no inline-edit toggle, so the value is the grid's edit mode
      // itself. When on, a cell edits in place with the dedicated field
      // widgets, same as the object views, and only where `ListView`'s
      // permission gate admits the principal (the object editable in place, and
      // the `update` grant).
      inlineEdit: userActions.editInline !== false,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectDefName, viewDefJson, cfg, orgAttribution]);

  if (!objectDef || !schema) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Empty>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Database className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t('empty.objectNotFound', { defaultValue: 'Object Not Found' })}</EmptyTitle>
          <EmptyDescription>
            {t('empty.interfacePageSourceMissing', {
              defaultValue: 'This interface page references "{{name}}", which is not available.',
              name: cfg.source || '?',
            })}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // Toolbar buttons ARE object actions (ADR-0047): resolve the configured
  // action names against the source object's ActionSchema and render them via
  // the shared action:bar (which handles execution).
  const buttonActions = Array.isArray(cfg.buttons) && cfg.buttons.length
    ? (cfg.buttons as string[])
        .map((name) => (objectDef.actions || []).find((a: any) => a?.name === name))
        .filter(Boolean)
        // The author explicitly chose these as page buttons, so surface them in
        // the toolbar regardless of the action's own `locations` (the action:bar
        // filters by location).
        .map((a: any) => ({ ...a, locations: ['list_toolbar'] }))
    : [];
  // Typed as the `action:bar` node it is (objectui#11355), not as the
  // `BaseSchema` the `schema` prop accepts: a key `ActionBarSchema` does not
  // declare is refused here.
  const buttonBar: ActionBarSchema = { type: 'action:bar', location: 'list_toolbar', actions: buttonActions, size: 'sm', variant: 'outline' };

  return (
    <div className={className ?? 'h-full flex flex-col'} data-testid="interface-list-page">
      <div className={`pl-4 pt-4 pb-2 shrink-0 flex items-start justify-between gap-3 ${reserveEditAffordance ? 'pr-12' : 'pr-4'}`}>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">
            {typeof page.label === 'string' ? page.label : page.name}
          </h1>
          {typeof page.description === 'string' && page.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{page.description}</p>
          )}
        </div>
        {buttonActions.length > 0 && (
          <div className="shrink-0" data-testid="interface-page-buttons">
            <SchemaRenderer schema={buttonBar} />
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <ListView
          schema={schema}
          dataSource={dataSource}
          userFilterSelections={initialUfSelections}
          onUserFilterSelectionsChange={handleUserFilterSelectionsChange}
          onSortChange={onConfigChange ? (sort: any) => onConfigChange({ sort }) : undefined}
          onColumnStateChange={onConfigChange ? (st: { order?: string[] }) => { if (st?.order?.length) onConfigChange({ columns: st.order }); } : undefined}
          onRowClick={recordAction === 'none' ? undefined : handleRecordClick}
        />
      </div>
      {navOverlay.isOverlay && (
        <NavigationOverlay
          {...navOverlay}
          setIsOpen={(o: boolean) => { if (!o) closeRecordDrawer(); }}
          title={typeof page.label === 'string' ? page.label : (cfg.source || 'Record')}
        >
          {(record: any) => (
            <RecordDetailView
              objectNameOverride={cfg.source}
              recordIdOverride={String(record?.id ?? record?._id ?? drawerRecordId ?? '')}
              embedded
              dataSource={dataSource}
              // A record overlay reads the whole registry: its related lists
              // come from every object that points at the record. Read only
              // once a record is opened (objectui#12980).
              objects={metadata.objects}
              onEdit={() => {}}
            />
          )}
        </NavigationOverlay>
      )}
    </div>
  );
}
