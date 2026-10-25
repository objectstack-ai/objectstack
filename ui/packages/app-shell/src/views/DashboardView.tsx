/**
 * Dashboard View Component
 * Renders a dashboard based on the dashboardName parameter.
 *
 * This is a pure VIEWER. Authoring a dashboard (adding/removing widgets,
 * editing config) lives in Studio's Interfaces pillar — reached via the top
 * bar's "Design in Studio" icon, which deep-links to this dashboard's design
 * surface. The former in-page inline edit button + config panel were retired
 * so there is a single, consistent authoring surface.
 */

import { useState, useEffect, useMemo, type ComponentProps } from 'react';
import { useParams } from 'react-router-dom';
import { DashboardRenderer } from '@object-ui/plugin-dashboard';
import { DrillNavigationProvider, notifyDataChanged } from '@object-ui/react';
import { useOpenRecordList } from './useOpenRecordList.js';
import { toast } from 'sonner';
import type { ActionDef, ActionContext, ActionResult } from '@object-ui/core';
import {
  Button,
  cn,
  Empty,
  EmptyTitle,
  EmptyDescription,
} from '@object-ui/components';
import { LayoutDashboard, Lock, RefreshCw } from 'lucide-react';
import { MetadataPanel, useMetadataInspector } from './MetadataInspector.js';
import { useActionModal } from '../hooks/useActionModal.js';
import { useMetaItemRefusal } from '../hooks/useMetaItemRefusal.js';
import { usePreviewDrafts } from '../preview/PreviewModeContext.js';
import { SkeletonDashboard } from '../skeletons/index.js';
import { PageHeader } from '../layout/PageHeader.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useExpressionContext } from '../providers/ExpressionProvider.js';
import { resolveKeyedI18nLabel, preferLocal } from '../utils/index.js';
import { useAdapter } from '../providers/AdapterProvider.js';
import { useObjectTranslation, useSafeTranslate } from '@object-ui/i18n';

/**
 * One refresh of this dashboard's data: the `onRefresh` handed to
 * `DashboardRenderer` (objectui#11062).
 *
 * Without a handler, the renderer's `useDashboardAutoRefresh` arms no timer, so
 * a period an author set in Studio (`refreshIntervalSeconds`) did nothing in
 * the console. This handler owns no timer: the hook runs it once per authored
 * period, and the "Refresh All" button this view draws in its page header
 * runs it on demand, through the renderer's own refresh (objectui#12554).
 *
 * It declares a change on the data-invalidation bus and rebuilds nothing
 * (AGENTS.md #8's corollary: refresh data, don't rebuild UI). The widgets that
 * read data (`DatasetWidget`, `ObjectChart`, `ObjectMetricWidget`,
 * `ObjectDataTable`, `ObjectPivotTable`) and the filter bar's options re-read
 * in place when the bus reports a change they match, so they stay mounted.
 * Nothing here re-keys, remounts or re-derives the schema.
 * `DashboardView.autoRefresh-11062.test.tsx` counts the re-reads and checks the
 * widget's node survives them.
 *
 * A `DatasetWidget` subscribes on the base object its query's answer names.
 * Every dataset answer names it (`AnalyticsResult.object`,
 * objectstack-ai/objectstack#20644), with or without dimensions and rows, so a
 * dataset-bound KPI tile (no dimensions) re-reads on this handler and on a
 * declared write to that object. `DatasetWidget.kpiInvalidation-11095.test.tsx`
 * in `plugin-dashboard` pins the widget's half (objectui#11095); the
 * producer's half is pinned upstream by `service-analytics`'s
 * `dataset-answer-object.test.ts`.
 *
 * The scope is the bus's unknown-scope value, `'*'`, the same one `PageView`
 * uses after a page action. A timed re-read does not know what changed, and
 * this view cannot name the objects its widgets read without re-deriving the
 * renderer's widget dispatch: a dataset widget learns its base object only from
 * its query's answer. The cost is that any other mounted bus reader re-reads
 * once per period too.
 *
 * Module-level, so its identity is stable. The hook reads the handler through
 * a ref, so a new identity would not re-arm the interval anyway
 * (objectui#11004).
 */
function refreshDashboardData(): void {
  notifyDataChanged({ objectName: '*' });
}

/**
 * What `DashboardRenderer` hands a host that draws its refresh control
 * (`onRefreshStateChange`, objectui#12554): the indicator and the run its own
 * button would call, or `null` when there is nothing to draw. Read off the
 * prop, so this view and the renderer cannot drift apart.
 */
type DashboardRefreshState = Parameters<
  NonNullable<ComponentProps<typeof DashboardRenderer>['onRefreshStateChange']>
>[0];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardView({ dataSource }: { dataSource?: any }) {
  // Drill "escape hatch": lets the drill drawers open an object's full list page.
  const openRecordList = useOpenRecordList();
  const { dashboardName } = useParams<{ dashboardName: string }>();
  const { showDebug } = useMetadataInspector();
  const adapter = useAdapter();
  const { t } = useObjectTranslation();
  // The refresh button's copy: the three pack keys the renderer's own button
  // reads, with the same English fallbacks, through the same `tt`.
  const tt = useSafeTranslate();
  const [isLoading, setIsLoading] = useState(true);
  // The renderer's refresh state, reported by the renderer itself: this view
  // draws the button, the renderer keeps the one timer (objectui#12554).
  const [refreshState, setRefreshState] = useState<DashboardRefreshState>(null);

  /**
   * Client-side modal transport for header `modal` actions — the SHARED
   * `useActionModal`, the same handler `RecordDetailView` and the console
   * runtimes install (objectui#4766).
   *
   * This view used to carry its own private handler, and with it a second
   * live copy of the `create_`/`new_`/`add_`/`edit_`/`update_` prefix
   * convention: `create_opportunity` was split into the object `opportunity`
   * in `create` mode, and any other string became `{ objectName: <target> }`.
   * Both limbs retire under the maintainer ruling on objectstack#6739
   * (2026-08-09) — a `type: 'modal'` action's string `target` names a PAGE,
   * and only a page. PR #4764 retired them in `useActionModal`; this copy was
   * off that path, so the ruling could not reach it.
   *
   * The convention's stated producer — "server-driven dashboard schemas" —
   * was enumerated before deleting it and does not exist: no dashboard in
   * either repo's corpus (objectstack `examples/app-{crm,showcase,todo}`,
   * `packages/apps/*`, objectui `apps/*` + `examples/*` including the 11
   * dashboards in `examples/schema-catalog`) authors a `header.actions[]`
   * entry at all, let alone a `<verb>_<object>` one.
   *
   * Delegating rather than re-implementing is the point: the contract now has
   * one implementation, so a dashboard header button, a record-header action
   * and a console list action resolve, refuse, and REPORT identically. The
   * refusal names the target and points at `type: 'form'` — which reaches a
   * dashboard header too (`actionType` is the full `ActionType` enum), and is
   * the validated way to open an object's form.
   */
  const { modalHandler, modalElement } = useActionModal(adapter);

  const scriptHandlers = useMemo<Record<string, (a: ActionDef, c: ActionContext) => Promise<ActionResult> | ActionResult>>(
    () => ({
      // objectui#4462 — this handler has always been a bare `window.print()`,
      // and the toast used to announce it as "Preparing PDF export…". No PDF
      // was ever produced: a dashboard prints as shown, and a printable
      // document is a page that declares `print` (objectstack#8346). That copy
      // was the single most literal instance of the "export to PDF"
      // misreading the issue reports, so it now names what actually happens. The action ID stays `export_dashboard_pdf` because
      // it is the identifier server-driven dashboard metadata declares —
      // renaming it is a spec-side change, not a copy fix.
      //
      // The page the dialog then prints is made usable by the shared
      // `@media print` sheet in `../styles.css`.
      export_dashboard_pdf: async () => {
        toast.info(t('dashboardActions.printDialogOpening'));
        try {
          window.print();
          return { success: true };
        } catch (err: any) {
          toast.error(t('dashboardActions.exportFailed', { message: err?.message || String(err) }));
          return { success: false, error: err?.message || String(err) };
        }
      },
      forecast_dashboard: async () => {
        toast.info(t('dashboardActions.forecastSoon'));
        return { success: true };
      },
    }),
    [t],
  );

  useEffect(() => {
    setIsLoading(true);
    queueMicrotask(() => setIsLoading(false));
  }, [dashboardName]);

  // `dashboards` is read first: its getter starts the list's fetch, and the
  // status read after it is that fetch's.
  const { dashboards, objects: metadataObjects, getTypeStatus } = useMetadata();
  // ADR-0048 Phase 2 — prefer the dashboard owned by the current app's package.
  const { app: activeApp } = useExpressionContext();
  const dashboard = preferLocal(dashboards as any[], dashboardName, (activeApp as any)?._packageId);

  // ---- A miss: refused, or not there? (objectui#12112) ---------------------
  // The server lists only the dashboards this caller may open
  // (objectstack#22731), so a dashboard withheld by its `requiredPermissions`
  // is absent from `dashboards` exactly like a name that does not exist. Only
  // the by-name read tells them apart, so a miss is asked there, once the list
  // has answered (before that, absence is not yet a miss). Not in draft
  // preview: the probe reads the published world, and this page reads the
  // draft one — `AppContent` skips its app probe there for the same reason.
  const previewDrafts = usePreviewDrafts();
  const dashboardsStatus = getTypeStatus?.('dashboard') ?? 'ready';
  const dashboardsSettled = dashboardsStatus === 'ready' || dashboardsStatus === 'error';
  const missedName = !dashboard && dashboardsSettled && !previewDrafts && dashboardName ? dashboardName : null;
  const access = useMetaItemRefusal('dashboard', missedName);

  // ---- Runtime capability gate --------------------------------------------
  // Hide widgets whose `requiresObject` is not registered (mirrors
  // NavigationItem.requiresObject for nav entries). Defaults to widget.object
  // when not set, so any object-bound widget disappears gracefully when its
  // backing object isn't in this runtime (e.g. cloud-only
  // `sys_package_installation` on system_overview).
  const registeredObjectNamesForFilter = useMemo(
    () => new Set<string>((metadataObjects || []).map((o: any) => o?.name).filter(Boolean)),
    [metadataObjects],
  );
  const previewSchema = useMemo(() => {
    if (!dashboard) return dashboard;
    // Defer pruning until metadata has actually loaded — otherwise the
    // empty Set would hide every object-bound widget on first render.
    if (registeredObjectNamesForFilter.size === 0) return dashboard;
    const widgets = (dashboard as any).widgets;
    if (!Array.isArray(widgets) || widgets.length === 0) return dashboard;
    const filtered = widgets.filter((w: any) => {
      const required = w?.requiresObject ?? w?.object;
      if (!required) return true;
      return registeredObjectNamesForFilter.has(required);
    });
    if (filtered.length === widgets.length) return dashboard;
    return { ...dashboard, widgets: filtered };
  }, [dashboard, registeredObjectNamesForFilter]);

  // ---- Loading / not-found guards -----------------------------------------
  if (isLoading) {
    return <SkeletonDashboard />;
  }

  if (!dashboard) {
    if (!dashboardsSettled || access.checking) {
      return <SkeletonDashboard />;
    }
    // Refused: said as a permission refusal, and in the server's own sentence,
    // which names the dashboard. ⛔ Not "not found": the dashboard exists.
    if (access.refusal) {
      return (
        <div className="h-full flex items-center justify-center p-8">
          <Empty data-testid="dashboard-access-denied">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <EmptyTitle>{t('dashboard.widgetForbiddenTitle')}</EmptyTitle>
            {access.refusal.message && <EmptyDescription>{access.refusal.message}</EmptyDescription>}
          </Empty>
        </div>
      );
    }
    return (
      <div className="h-full flex items-center justify-center p-8">
         <Empty>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <LayoutDashboard className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t('empty.dashboardNotFound')}</EmptyTitle>
          <EmptyDescription>
            {t('empty.dashboardNotFoundDescription', { name: dashboardName })}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }


  // Header source: `label`, then the raw `name`. There is no `title` arm — the
  // legacy root `title` read RETIRED here under ADR-0049 (objectui#7509,
  // maintainer ruling 2026-09-04), together with the four sibling arms in
  // `DashboardRenderer`, `DashboardGridLayout`, `DashboardEditor` and
  // `DashboardDesignPage`, so one spelling answers on every surface instead of
  // two disagreeing.
  //
  // Measured on @objectstack/spec 17.2.0: `DashboardSchema` refuses `title` BY
  // NAME (`unrecognized_keys(title)` at the document root) and spells the
  // display name `label`, which is REQUIRED; `header` declares `showTitle` /
  // `showDescription` / `actions` only, so it TOGGLES a title and never carries
  // one. Writing `title` earns a `422 INVALID_METADATA` from the save route
  // before persistence (see `MetadataService`), not a header — so no authored
  // document can acquire the key, and what retired is legacy-document
  // compatibility only. A spec-valid stored document always carries `label`,
  // so a legacy document holding BOTH now shows its `label`; one holding
  // `title` and no `label` was already invalid and falls through to `name`.
  //
  // ⛔ Widget-level `widget.title` is a DIFFERENT, DECLARED key
  // (`DashboardWidget.title`, the spec's `I18nLabel`) and is untouched. Root
  // and widget arms are told apart by RECEIVER.
  //
  // `previewSchema` was never a host-supplied preview channel — it is this
  // view's own widget-pruned copy of `dashboard` (above) — so the retired arm
  // read the same stored document either way, which is why it is gone rather
  // than re-pointed.
  //
  // Drawn as served, with no client bundle pass (objectui#11295): `dashboard`
  // is the `/meta` read's document, already translated for this language by
  // the server, which keeps a published edit over the packaged catalog. A
  // `dashboards.<name>.label` lookup here answered the catalog a second time
  // and won it back.
  const display = resolveKeyedI18nLabel(dashboard.label, t) || dashboard.name;
  const headerSrc = (previewSchema as any) || dashboard;
  const rawDesc = headerSrc.description ?? dashboard.description;
  // Served, like the label above: drawn as given (objectui#11295).
  const desc = resolveKeyedI18nLabel(rawDesc, t);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* ── Header ───────────────────────────────────────────────────
          The console's one page header, the one an object list draws
          (objectui#12526): icon chip, title, the description beside the
          title from `sm` up, in one row. The app bar draws no crumb on a
          dashboard route, so this row is the one place the dashboard is
          named from `sm` up; below `sm` the phone bar names it too, and this
          row draws the icon and title only (the console `PageHeader` hides
          its secondary line there, objectui#12423).

          The icon is the dashboard kind's — `LayoutDashboard`, the glyph the
          console writes on a dashboard's navigation entry
          (`newDashboardNavigationItem`). A dashboard document has no icon of
          its own: `DashboardSchema` declares none.

          The one action is "Refresh All", at the right of this row
          (objectui#12554). The renderer keeps `onRefresh`, which arms the
          authored `refreshIntervalSeconds` timer (objectui#11062), so the timer
          stays the renderer's one timer; `onRefreshStateChange` below takes
          the button out of the renderer and hands this view its state. The
          button here is the renderer's button: the same three pack keys, icon,
          spin and disabled-while-refreshing, and a click runs the renderer's
          own refresh, so the indicator shows on manual and timed runs alike.
          `hideHeaderText` below keeps the renderer from drawing the title and
          description a second time.

          `header.showTitle` / `header.showDescription` are not read here, as
          they were not before: they toggle the renderer's own header, which
          `hideHeaderText` already suppresses. */}
      <PageHeader
        title={display}
        subtitle={desc || undefined}
        icon={<LayoutDashboard className="h-4 w-4" />}
        actions={refreshState && (
          <Button
            variant="outline"
            size="sm"
            onClick={refreshState.handleRefresh}
            disabled={refreshState.refreshing}
            aria-label={tt('dashboard.refreshDashboard', 'Refresh dashboard')}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', refreshState.refreshing && 'animate-spin')} />
            {refreshState.refreshing ? tt('dashboard.refreshing', 'Refreshing…') : tt('dashboard.refreshAll', 'Refresh All')}
          </Button>
        )}
      />

      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col sm:flex-row relative">
         <div className="flex-1 min-w-0 overflow-auto p-2 sm:p-4 md:p-6">
            <DrillNavigationProvider value={{ openRecordList }}>
              {/* `localized`: this document is the `/meta` read's, already
                  translated for this language, so the renderer draws its
                  title, description and sub-caption as served (objectui#11295). */}
              <DashboardRenderer
                schema={previewSchema}
                localized
                dataSource={dataSource}
                modalHandler={modalHandler}
                scriptHandlers={scriptHandlers}
                onRefresh={refreshDashboardData}
                onRefreshStateChange={setRefreshState}
                hideHeaderText
              />
            </DrillNavigationProvider>
         </div>

         <MetadataPanel
            open={showDebug}
            sections={[{ title: 'Dashboard Configuration', data: previewSchema }]}
         />
      </div>

      {/* Modal opened by a header action whose `target` names a page. */}
      {modalElement}
    </div>
  );
}
