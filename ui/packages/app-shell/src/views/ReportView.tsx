import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
const ReportRenderer = lazy(() =>
  import('@object-ui/plugin-report').then((m) => ({ default: m.ReportRenderer })),
);
import { Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
// objectstack#36374 — the report builder, hosted here (the catalog reads and
// the served-text boxes need the console's metadata client).
import { ReportBuilderHost } from './ReportBuilderHost.js';
import { RuntimeDraftBar } from './RuntimeDraftBar.js';
import { readReportBuilderArrival, withoutReportBuilderArrival } from './reportBuilderArrival.js';
import { Pencil, BarChart3, Loader2 } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader.js';
import { useObjectTranslation } from '@object-ui/i18n';
import { MetadataPanel, useMetadataInspector } from './MetadataInspector.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useExpressionContext } from '../providers/ExpressionProvider.js';
import { preferLocal } from '../utils/preferLocal.js';
import { useAdapter } from '../providers/AdapterProvider.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { saveAndPublishRuntimeMetadata } from './runtime-metadata-persistence.js';
import { authoredBuffer, extractDraftBody, formatMetadataError, type AuthoredLayers } from '@object-ui/data-objectstack';
import { t as tStudio, tFormat, useMetadataLocale } from './metadata-admin/i18n.js';
import { servedPackageId } from '@object-ui/core';
import { toast } from 'sonner';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import type { DataSource } from '@object-ui/types';
import type { DatasetDrillArgs } from '@object-ui/plugin-report';
import { DrillDownDrawer } from '@object-ui/plugin-dashboard';
import { DrillNavigationProvider } from '@object-ui/react';
import { useRecordListDrillNavigation } from './useOpenRecordList.js';
import { metadataText } from '../hooks/useNavTargetLabel.js';
import { servedReportTextOf, type ServedReportText } from './studio-design/servedReportText.js';

/**
 * The report keys whose text the server translates where it serves the report
 * (`translateReport`: the name, the description, a joined report's block
 * labels) plus the `title` the page header reads first.
 */
const SERVED_TEXT_KEYS = ['title', 'label', 'description', 'blocks'] as const;

/**
 * objectstack#36373 — the report the page DRAWS while the editor is open: the
 * edited buffer, except that each translated key the edit has not touched is
 * the served copy's. The buffer is the untranslated authored document
 * (objectstack#35008), so drawing it whole flipped the page heading and the
 * subtitle to the source language the moment the editor opened; a key the
 * author did change is drawn as edited.
 */
export function previewWithServedText(
  served: Record<string, any> | null | undefined,
  authoredAtOpen: Record<string, any> | null | undefined,
  edited: Record<string, any>,
): Record<string, any> {
  if (!served || !authoredAtOpen) return edited;
  const out: Record<string, any> = { ...edited };
  for (const key of SERVED_TEXT_KEYS) {
    if (JSON.stringify(edited[key]) !== JSON.stringify(authoredAtOpen[key])) continue;
    if (key in served) out[key] = served[key];
  }
  return out;
}

export function ReportView({ dataSource }: { dataSource?: DataSource }) {
  const { t, language } = useObjectTranslation();
  const { reportName } = useParams<{ reportName: string }>();
  const { showDebug } = useMetadataInspector();
  const adapter = useAdapter();
  // ADR-0034: report edits persist via the metadata draft/publish model.
  const metadataClient = useMetadataClient();
  // Editing a report mutates the SHARED definition, so it is an admin-only
  // quick-edit affordance (mirrors ObjectView's view-config gate).
  const { isAdmin } = useWorkspaceAdminStatus();
  // objectstack#36374 — the report builder replaces the page while it is open.
  const [builderOpen, setBuilderOpen] = useState(false);
  
  // Find report definition from API-driven metadata
  const { reports, objects, loading, refresh } = useMetadata();
  // ADR-0048 Phase 2 — prefer the report owned by the current app's package.
  const { app: activeApp } = useExpressionContext();
  const initialReport = preferLocal(reports as any[], reportName, (activeApp as any)?._packageId);
  const [reportData, setReportData] = useState(initialReport);

  // Local schema state for live preview — initialized from metadata
  const [editSchema, setEditSchema] = useState<any>(null);

  // State for report runtime data
  const [reportRuntimeData, setReportRuntimeData] = useState<any[]>([]);

  // Drill-through (ADR-0021 D2): clicking an aggregated row/cell opens the
  // underlying records in an in-place drawer (peek without leaving the report),
  // with an "Open in list →" escape hatch to the full object list page.
  const drillNavigation = useRecordListDrillNavigation();
  const [drill, setDrill] = useState<{ object: string; filter: Record<string, unknown>; title: string } | null>(null);

  // ADR-0021 D2 drill-down: open the dataset's object list scoped by
  // `?filter[<field>]=<value>` (the same equality-filter contract the
  // related-list "View All" buttons use).
  //
  // Preferred: the renderer hands us the base `object` + an exact field→RAW
  // `objectFilter` (built from the server's drillRawRows), so we navigate
  // straight away — correct for select/lookup dims, no metadata round-trip.
  //
  // Fallback: no `objectFilter` arrived, so only dimension NAMES + DISPLAY-label
  // bucket values are known. Not only an older server's answer: the current
  // server names the `object` on every dataset answer but sends no drill
  // metadata for a `type: 'date'` dimension with no `dateGranularity` (neither
  // an equality field nor a range), so a report grouped by one lands here too.
  // Resolve the names through the dataset definition, read as the report's
  // reader (ADR-0150 D3: `callerPackage`, the report's served package, the
  // same dataset the renderer's queries resolve; a refusal is no drill, never
  // a bare retry), and reverse-map labels to stored values before filtering:
  //   - select fields  → reverse-map label → option value
  //   - lookup fields  → the label is a record name, not the FK id; skip the
  //     dim (the drill lands on a superset rather than filtering wrongly)
  //   - granularity-bucketed dates → need a range, not equality; skip too
  const handleDatasetDrill = useCallback(
    async ({ dataset, groupKey, object, objectFilter }: DatasetDrillArgs) => {
      try {
        // Drawer header: the clicked group's display values (e.g. "West / Q3"),
        // else the report's label in the viewer's language (objectui#13470).
        const titleParts = Object.values(groupKey).filter((v) => v != null).map((v) => String(v));
        const title = titleParts.join(' / ')
          || (metadataText(reportData?.label, language) ?? String(reportData?.name ?? 'Details'));

        // Fast path (ADR-0021 D2): the renderer already resolved the dataset's
        // base object + an exact object FIELD → RAW value filter from the
        // server's drillRawRows — correct for select/lookup dims (a stored
        // value, not a display label) with NO dataset-definition round-trip.
        if (object && objectFilter) {
          setDrill({ object, filter: objectFilter, title });
          return;
        }

        // Fallback (older server with no drill metadata): resolve the dataset's
        // object and reverse-map dimension labels → stored values ourselves.
        // The served report names the package; the authored edit buffer carries no
        // read decoration (objectstack#35008).
        const callerPackage = servedPackageId(reportData);
        const def = await metadataClient.get<Record<string, any>>(
          'dataset',
          dataset,
          callerPackage ? { callerPackage } : {},
        );
        const objectName = typeof def?.object === 'string' ? def.object : undefined;
        if (!objectName) return;
        const dims: Array<Record<string, any>> = Array.isArray(def?.dimensions) ? def.dimensions : [];
        const dimByName = new Map(dims.filter((d) => d?.name).map((d) => [d.name as string, d]));

        // Field defs of the dataset's object — the option value↔label source.
        const objDef = objects?.find((o: any) => o.name === objectName);
        const rawFields = objDef?.fields;
        const fieldDef = (field: string): Record<string, any> | undefined => {
          if (Array.isArray(rawFields)) return rawFields.find((f: any) => f?.name === field);
          if (rawFields && typeof rawFields === 'object') return (rawFields as Record<string, any>)[field];
          return undefined;
        };

        const filter: Record<string, unknown> = {};
        for (const [dim, value] of Object.entries(groupKey)) {
          if (value == null) continue;
          const dimDef = dimByName.get(dim);
          if (dimDef?.dateGranularity) continue;
          const field = (dimDef?.field as string) || dim;
          const fd = fieldDef(field);
          if (fd?.type === 'lookup' || fd?.type === 'master_detail') continue;
          let stored: unknown = value;
          if (Array.isArray(fd?.options)) {
            const opt = fd.options.find(
              (o: any) => o?.label === value || o?.value === value,
            );
            if (opt && opt.value != null) stored = opt.value;
          }
          filter[field] = stored;
        }
        setDrill({ object: objectName, filter, title });
      } catch (err) {
        console.warn('ReportView: drill failed', err);
      }
    },
    [metadataClient, objects, reportData, editSchema, language],
  );

  // ---- Save helper --------------------------------------------------------
  // objectstack#36374 — Save writes the report and publishes it in the same
  // press, so every member sees it on their next read: the maintainer's ruling
  // on epic #36510 (「人改一项、点保存、立刻生效。草稿加整包发布只留给 AI 的批量改动」).
  // ADR-0034's draft/publish model is kept underneath — the body is staged as
  // the item's draft and promoted at once (`saveAndPublishRuntimeMetadata`, the
  // list view's shared-view save); `sys_report` stays retired. Over a draft
  // someone else left pending nothing is written and the builder says so: the
  // draft bar above the preview publishes or discards that draft first.
  // Resolves whether the report was saved, so the builder closes only on a
  // save that landed (objectui#11583).
  const saveSchema = useCallback(
    async (schema: any): Promise<boolean> => {
      if (!metadataClient) return false;
      try {
        const outcome = await saveAndPublishRuntimeMetadata('report', reportName!, schema, {
          metadataClient,
          dataSource: dataSource as any,
        });
        if (outcome === 'pending-draft') {
          toast.error(t('form.saveError'), { description: t('report.builder.pendingDraft') });
          return false;
        }
        refresh().catch(() => {});
        return true;
      } catch (err) {
        console.warn('[ReportView] Save failed:', err);
        // objectui#11583: a refused save is said, with the door's message.
        // It fires once per press of the builder's Save (an edit only drives
        // the live preview), so one refusal is one toast.
        toast.error(t('form.saveError'), {
          description: formatMetadataError(err),
          classNames: { description: 'whitespace-pre-line' },
        });
        return false;
      }
    },
    [metadataClient, reportName, refresh, t, dataSource],
  );

  // ---- Open / close the builder ------------------------------------------
  // objectstack#35008 — the editor edits the report as its author wrote it,
  // never the report as it is served. `reportData` comes from the served
  // `/meta/report` list, which the server translates for the console's
  // Accept-Language: in a zh-CN session its `label`, `description` and block
  // labels are the catalog's translations, and the save door stores a report
  // body verbatim (its translated-echo restore covers objects only). Seeded
  // from that copy, a quick edit of any field stored the translations as the
  // source text, and every other locale was served them after publish.
  //
  // The buffer is the layered read's authored document instead, through the
  // one reading the Studio editors share (`authoredBuffer`, objectstack#29793):
  // the stored draft when one is pending, else the published item, both
  // untranslated. Read at the package the served report came from (ADR-0048).
  // The served report stays the display copy; with nothing authored to read,
  // the editor does not open — ⛔ never fall back to the served copy, which is
  // the translated document this exists to keep out of the save.
  //
  // objectstack#35054 — the served draft read, at the same package, is handed
  // to `authoredBuffer` as the Studio editors hand theirs: it says whether a
  // draft is pending, so a pending draft whose stored copy the layers do not
  // serve is `unserved` and opens no editor, instead of an editor seeded with
  // the published report that a Save would stage over the pending draft.
  const metadataLocale = useMetadataLocale();
  // A landed save keeps the saved report as the page's picture until the
  // metadata refresh it triggers replaces it (`editSchema`). The builder's
  // buffer is the untranslated source, so a close with no landed save draws
  // the served report again, which is the display copy for this locale.
  const [openingEditor, setOpeningEditor] = useState(false);
  // The authored buffer as the builder opened on it, and the served text of
  // the report's name and description paired with the published layer — the
  // builder's name and description boxes read it, and the page draws the
  // served text for every key a saved edit left alone (`previewWithServedText`).
  const [authoredAtOpen, setAuthoredAtOpen] = useState<Record<string, any> | null>(null);
  const [servedText, setServedText] = useState<ServedReportText | null>(null);
  const handleOpenBuilder = useCallback(async () => {
    if (!metadataClient || !reportName) return;
    const packageId = servedPackageId(reportData);
    setOpeningEditor(true);
    let body: Record<string, unknown> | null = null;
    let published: Record<string, unknown> | null = null;
    let failure: string | null = null;
    try {
      const at = packageId ? { packageId } : {};
      const [layers, servedDraft] = await Promise.all([
        metadataClient.layered<Record<string, unknown>>('report', reportName, at),
        metadataClient.getDraft('report', reportName, at),
      ]);
      const authored = authoredBuffer('report', layers as AuthoredLayers, extractDraftBody(servedDraft));
      const lay = layers as { effective?: unknown; code?: unknown } | null;
      published = (lay?.effective ?? lay?.code ?? null) as Record<string, unknown> | null;
      if (authored.kind === 'unserved') failure = tStudio('engine.studio.refusal.draftUnreadable', metadataLocale);
      else if (Object.keys(authored.body).length > 0) body = authored.body;
      else failure = tStudio('engine.form.notFound', metadataLocale);
    } catch (err) {
      failure = formatMetadataError(err);
    } finally {
      setOpeningEditor(false);
    }
    if (!body) {
      toast.error(
        tFormat('engine.edit.loadFailed', metadataLocale, {
          type: 'report',
          name: reportName,
          message: failure ?? tStudio('engine.form.notFound', metadataLocale),
        }),
      );
      return;
    }
    setAuthoredAtOpen(body);
    setServedText(servedReportTextOf(published, reportData));
    setBuilderOpen(true);
  }, [metadataClient, reportName, reportData, metadataLocale]);

  const handleCloseBuilder = useCallback(() => {
    setBuilderOpen(false);
  }, []);

  const handleBuilderSave = useCallback(
    async (schema: Record<string, any>): Promise<boolean> => {
      const saved = await saveSchema(schema);
      // A refused save keeps the builder open with its edit, for a retry
      // (objectui#11583).
      if (saved) {
        setEditSchema(schema);
        setBuilderOpen(false);
      }
      return saved;
    },
    [saveSchema],
  );

  // objectstack#36374 — a page that lands here asking for the builder (a
  // report just created, objectstack#36364) opens it once, then clears the ask.
  const location = useLocation();
  const navigate = useNavigate();
  const arrivalReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isAdmin || loading || !initialReport || !reportName) return;
    if (!readReportBuilderArrival(location.state, reportName)) return;
    if (arrivalReadRef.current === location.key) return;
    arrivalReadRef.current = location.key;
    navigate(location.pathname + location.search, { replace: true, state: withoutReportBuilderArrival(location.state) });
    void handleOpenBuilder();
  }, [isAdmin, loading, initialReport, reportName, location, navigate, handleOpenBuilder]);

  // Sync reportData when metadata finishes loading or reportName changes
  useEffect(() => {
    setReportData(initialReport);
  }, [initialReport]);

  // When metadata refreshes, discard the saved picture once the builder is
  // closed: the served report now carries the save.
  useEffect(() => {
    if (!builderOpen) {
      setEditSchema(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReport]);

  // Load report runtime data when report definition changes.
  // Use the live editSchema (when available) so that config panel changes
  // to objectName, filters, or limit are immediately reflected in the preview.
  const dataFetchSource = editSchema || reportData;

  // Memoize serialized dependency keys to avoid re-fetching on every render
  const filtersKey = useMemo(() => JSON.stringify(dataFetchSource?.filters), [dataFetchSource?.filters]);
  const dataSourceKey = useMemo(() => JSON.stringify(dataFetchSource?.dataSource), [dataFetchSource?.dataSource]);
  const inlineDataKey = useMemo(() => JSON.stringify(dataFetchSource?.data), [dataFetchSource?.data]);

  useEffect(() => {
    if (!dataFetchSource || !dataSource) {
      setReportRuntimeData([]);
      return;
    }

    // objectui#10684 — only the CURRENT run commits rows. The report, its
    // binding, filters or limit can change while a read is in flight (a
    // config-panel edit, a metadata refresh, another report on the same
    // route), and an earlier answer that lands after the current one would
    // otherwise replace its rows. Set by this run's cleanup, which React runs
    // before the next run starts.
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };

    // If report has inline data, use it directly
    if (dataFetchSource.data && Array.isArray(dataFetchSource.data)) {
      setReportRuntimeData(dataFetchSource.data);
      return;
    }

    // If report has a dataSource config, fetch data using it
    if (dataFetchSource.dataSource) {
      const fetchDataFromSource = async () => {
        try {
          // Use the dataSource configuration to fetch data. `object` is the
          // ONLY spelling this binding declares (ElementDataSourceConfig /
          // the spec's strict ElementDataSourceSchema); the adapter just
          // happens to call its first parameter `resource` (objectui#5116).
          const objectName = dataFetchSource.dataSource.object;
          if (!objectName) {
            console.warn('ReportView: dataSource missing object property');
            setReportRuntimeData([]);
            return;
          }

          const result = await dataSource.find(objectName, {
            $filter: dataFetchSource.dataSource.filter,
            $orderby: dataFetchSource.dataSource.sort,
            $top: dataFetchSource.dataSource.limit,
          });

          if (!cancelled) setReportRuntimeData(result.data || []);
        } catch (error) {
          console.error('ReportView: Failed to load data from dataSource', error);
          if (!cancelled) setReportRuntimeData([]);
        }
      };

      fetchDataFromSource();
      return cancel;
    }

    // If report has an objectName, fetch data from that object
    if (dataFetchSource.objectName) {
      const fetchDataFromObject = async () => {
        try {
          const result = await dataSource.find(dataFetchSource.objectName, {
            $filter: dataFetchSource.filters,
            $orderby: dataFetchSource.sort,
            $top: dataFetchSource.limit || 100, // Default limit to avoid fetching too much data
          });

          if (!cancelled) setReportRuntimeData(result.data || []);
        } catch (error) {
          console.error('ReportView: Failed to load data from objectName', error);
          if (!cancelled) setReportRuntimeData([]);
        }
      };

      fetchDataFromObject();
      return cancel;
    }

    // No data source configured
    setReportRuntimeData([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataFetchSource?.objectName,
    dataFetchSource?.limit,
    filtersKey,
    dataSourceKey,
    inlineDataKey,
    dataSource,
  ]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!initialReport || !reportData) {
    if (!loading && !initialReport) {
      return (
        <div className="h-full flex items-center justify-center p-8">
           <Empty>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <BarChart3 className="h-6 w-6 text-muted-foreground" />
            </div>
            <EmptyTitle>{t('empty.reportNotFound')}</EmptyTitle>
            <EmptyDescription>
              {t('empty.reportNotFoundDescription', { name: reportName })}
            </EmptyDescription>
          </Empty>
        </div>
      );
    }
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Use live-edited schema for preview (persists after closing panel until
  // metadata refreshes), with the served text of every translated key the
  // edit has not touched (objectstack#36373).
  const previewReport = editSchema
    ? previewWithServedText(reportData, authoredAtOpen, editSchema)
    : reportData;
  // `label` and `description` are the spec's `string | I18nLabel`, so an
  // inline locale map (`{ en, 'zh-CN' }`) is valid metadata and is served
  // unchanged. Drawn raw, React refused the object and the page went blank
  // (objectui#13470). Each resolves to the viewer's language through
  // `metadataText`, the reader the app's report index names a report with.
  const heading = metadataText(previewReport.title, language)
    ?? metadataText(previewReport.label, language)
    ?? 'Report Viewer';
  const description = metadataText(previewReport.description, language);
  // Every report renders through the spec ReportRenderer dispatcher: it routes
  // dataset-bound reports to DatasetReportRenderer (aggregation, charts, KPIs,
  // drill protocol end-to-end), bridges stored pre-9.0 spec JSON to the
  // presentation viewer, and falls back to LegacyReportRenderer for pre-spec
  // `{ data, columns }` shapes. `reportRuntimeData` feeds the bridge/legacy
  // paths; DatasetReportRenderer fetches its own rows via `useDatasetRows`.

  // Drill-through drawer: peek the records behind a clicked group, then
  // click a row to open a record, or use "Open in list →" to escalate to
  // the full object list page. The builder's preview drills the same way.
  const drillDrawer = (
    <DrillDownDrawer
      open={!!drill}
      onClose={() => setDrill(null)}
      title={drill?.title ?? ''}
      objectName={drill?.object ?? ''}
      filter={drill?.filter}
      dataSource={dataSource as any}
    />
  );

  // objectstack#36374 — the builder replaces the page while it is open: the
  // live picture on the left, the five settings on the right.
  if (builderOpen && isAdmin && authoredAtOpen) {
    return (
      <DrillNavigationProvider value={drillNavigation}>
        <ReportBuilderHost
          initial={authoredAtOpen}
          servedText={servedText}
          onSave={handleBuilderSave}
          onClose={handleCloseBuilder}
          dataSource={dataSource}
          onDrill={handleDatasetDrill}
          banner={
            <div className="mb-3 empty:hidden">
              <RuntimeDraftBar
                type="report"
                name={reportName}
                metadataClient={metadataClient}
                dataSource={dataSource as any}
                // objectstack#35008 — no `onResume`: the builder opens on the
                // pending draft as stored (the layered read's `authoredBuffer`).
                onAfterChange={() => refresh().catch(() => {})}
              />
            </div>
          }
        />
        {drillDrawer}
      </DrillNavigationProvider>
    );
  }

  return (
    <DrillNavigationProvider value={drillNavigation}>
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* objectstack#36111 — the console page header every list and
          dashboard draws: the report's name, its description behind the
          hairline, and the report's own 「Edit」 (the inspector beside the
          report, not Studio) as its action. The shell's top-right group
          follows the action where the shell turns it on. */}
      <PageHeader
        title={heading}
        subtitle={description || undefined}
        icon={<BarChart3 className="h-4 w-4" />}
        actions={isAdmin ? (
          <button
            type="button"
            onClick={() => { void handleOpenBuilder(); }}
            disabled={openingEditor}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
            data-testid="report-edit-button"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('common.edit')}
          </button>
        ) : undefined}
      />

      <div className="flex-1 overflow-hidden flex flex-col sm:flex-row relative">
         <div className="flex-1 min-w-0 overflow-auto p-4 sm:p-6 lg:p-8 bg-muted/5">
             {/* The card is as tall as the report (objectui#11694). It carried
                 `min-h-150` (37.5rem), leaving a five-row table in a mostly
                 empty frame; nothing inside needs it: the loading and
                 not-found states return before this card is drawn, the
                 Suspense fallback and the renderer's own fetch states size to
                 their text, and the embedded chart has a fixed plot height. */}
             <div className="w-full shadow-sm border rounded-lg sm:rounded-xl bg-background overflow-hidden">
                 <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">{t('common.loading', { defaultValue: 'Loading…' })}</div>}>
                   <div className="p-4 sm:p-6">
                     <ReportRenderer schema={previewReport} dataSource={dataSource as any} rows={reportRuntimeData} onDrill={handleDatasetDrill} />
                   </div>
                 </Suspense>
             </div>
         </div>

         <MetadataPanel
            open={showDebug}
            sections={[{ title: 'Report Configuration', data: previewReport }]}
         />
      </div>
    </div>
    {drillDrawer}
    </DrillNavigationProvider>
  );
}
