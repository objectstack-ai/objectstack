/**
 * DashboardDesignPage
 *
 * Console page that wraps the DashboardEditor for editing dashboard schemas.
 *
 * Route: /design/dashboard/:dashboardName
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardEditor } from '../DashboardEditor';
import type { DashboardComponentSchema } from '@object-ui/types';
import { liftLegacyDashboardFilterDefaults } from '@object-ui/types';
import { toast } from 'sonner';
import { useAdapter } from '@object-ui/react';
import { useMetadata } from '@object-ui/react';
import { ArrowLeft } from 'lucide-react';
import { useDesignerTranslation } from '../hooks/useDesignerTranslation';

export function DashboardDesignPage() {
  const navigate = useNavigate();
  const { t } = useDesignerTranslation();
  const { dashboardName } = useParams<{ dashboardName: string }>();
  const dataSource = useAdapter();
  const { dashboards, refresh } = useMetadata();

  const dashboard = dashboards?.find((d: any) => d.name === dashboardName);

  const [schema, setSchema] = useState<DashboardComponentSchema>(
    () =>
      // REWRITE-ON-SAVE half of the ADR-0089 alias window (objectui#4165): the
      // stored document is lifted off the legacy `defaultValue: { preset }`
      // spelling as it enters the editable draft, so the next `handleChange`
      // — every widget move, every import, every Ctrl+S — persists the
      // canonical bare preset name through `saveSchema` below. Without this the
      // window could never close: nothing else in objectui writes a dashboard
      // document back, so a legacy document would stay legacy forever.
      //
      // The lift returns the SAME reference when there is nothing to lift, so a
      // canonical dashboard is untouched and this cannot manufacture an edit.
      liftLegacyDashboardFilterDefaults(dashboard as DashboardComponentSchema) || {
        type: 'dashboard',
        name: dashboardName ?? '',
        // `label`, not the retired root `title` (objectui#7509): this seed is
        // the only dashboard-document literal this repo authors, so it spells
        // the key the spec accepts. Reachable only on the `!dashboard` branch,
        // which early-returns "not found" below and never persists, so the
        // spelling change moves no behaviour — it keeps the corpus canonical.
        label: dashboardName ?? '',
        columns: 2,
        widgets: [],
      },
  );
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const saveSchema = useCallback(
    async (toSave: DashboardComponentSchema) => {
      try {
        if (dataSource) {
          await dataSource.update('sys_dashboard', dashboardName!, toSave);
          // Refresh metadata cache so other pages see saved changes
          refresh().catch(() => {});
          return true;
        }
      } catch {
        // Save errors are non-blocking; user can retry via export
      }
      return false;
    },
    [dataSource, dashboardName, refresh],
  );

  const handleChange = useCallback(
    async (updated: DashboardComponentSchema) => {
      // Lift here too, not only on load: this is the single funnel every write
      // passes through, and `handleImport` feeds it a document from OUTSIDE the
      // load path (a user-picked JSON file), which may carry the legacy
      // spelling. Lifting at the funnel is what makes "nothing legacy is ever
      // persisted" true rather than merely likely (#4165).
      const canonical = liftLegacyDashboardFilterDefaults(updated);
      setSchema(canonical);
      await saveSchema(canonical);
    },
    [saveSchema],
  );

  // Ctrl+S / Cmd+S keyboard shortcut to explicitly save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveSchema(schemaRef.current).then((ok) => {
          if (ok) toast.success('Dashboard saved');
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveSchema]);

  const handleExport = useCallback(
    (exported: DashboardComponentSchema) => {
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dashboardName || 'dashboard'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Dashboard schema exported');
    },
    [dashboardName],
  );

  const handleImport = useCallback(
    (imported: DashboardComponentSchema) => {
      toast.success('Dashboard schema imported');
      handleChange(imported);
    },
    [handleChange],
  );

  if (!dashboard) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Dashboard &quot;{dashboardName}&quot; not found
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="dashboard-design-page">
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded p-1.5 text-muted-foreground hover:text-foreground"
          aria-label={t('detail.goBack')}
          data-testid="dashboard-design-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        {/*
          `label`, then the raw `name`. The legacy root `title` arm that sat
          between them RETIRED under ADR-0049 (objectui#7509, maintainer ruling
          2026-09-04) together with the four sibling root arms in
          `DashboardView`, `DashboardRenderer`, `DashboardGridLayout` and
          `DashboardEditor` — @objectstack/spec's `DashboardSchema` refuses root
          `title` BY NAME (`unrecognized_keys(title)`) and requires `label`, so
          a stored document that carried both now shows its `label` here and in
          the console alike, instead of the two surfaces disagreeing.
        */}
        <h1 className="text-lg font-semibold tracking-tight truncate">
          Edit Dashboard: {(dashboard as any).label || dashboardName}
        </h1>
      </div>
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <DashboardEditor
          schema={schema}
          onChange={handleChange}
          onExport={handleExport}
          onImport={handleImport}
        />
      </div>
    </div>
  );
}
