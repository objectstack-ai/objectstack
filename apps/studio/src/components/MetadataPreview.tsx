// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataPreview — single entry point for rendering "what will this
 * metadata look like at runtime?" inside Studio.
 *
 * The renderer is chosen from `(type, spec)`:
 *
 *   object        → ObjectGrid (table preview of live data)
 *   view + form   → ObjectForm (create-mode form)
 *   view + kanban → ObjectKanban
 *   view + grid   → ObjectGrid
 *   view + detail → DetailView (single-record)
 *   view + calendar → ObjectCalendar (if available)
 *   dashboard     → grid of widgets — falls back to JSON
 *
 * Anything we don't recognise renders a small "no preview available"
 * note with the metadata payload printed as JSON so authors can still
 * sanity-check the spec. All renderers receive the shared Studio
 * DataSource (see useObjectUiDataSource) so they hit the same backend
 * Studio is already inspecting.
 */

import { Suspense, lazy, useMemo, useState } from 'react';
import * as React from 'react';
import { ObjectGrid } from '@object-ui/plugin-grid';
import { ObjectKanban } from '@object-ui/plugin-kanban';
import { DetailView } from '@object-ui/plugin-detail';
import { useObjectUiDataSource } from '@/hooks/useObjectUiDataSource';
import { useMetadataHmr } from '@/hooks/useMetadataHmr';
import { LiveFormPreview } from './LiveFormPreview';
import { LivePreviewStatusBar } from './LivePreviewStatusBar';
import { AlertCircle, Eye, LayoutGrid, KanbanSquare, Calendar as CalendarIcon, FileText, ListChecks } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Keys a multi-view document can carry, in priority order. */
const SUBVIEW_KEYS = ['list', 'grid', 'table', 'kanban', 'board', 'calendar', 'form', 'detail'] as const;
type SubViewKey = (typeof SUBVIEW_KEYS)[number];

const SUBVIEW_LABEL: Record<SubViewKey, string> = {
  list: 'List',
  grid: 'Grid',
  table: 'Table',
  kanban: 'Kanban',
  board: 'Board',
  calendar: 'Calendar',
  form: 'Form',
  detail: 'Detail',
};

const SUBVIEW_ICON: Record<SubViewKey, React.ComponentType<{ className?: string }>> = {
  list: ListChecks,
  grid: LayoutGrid,
  table: LayoutGrid,
  kanban: KanbanSquare,
  board: KanbanSquare,
  calendar: CalendarIcon,
  form: FileText,
  detail: FileText,
};

// Calendar is lazy-loaded — the package pulls in dnd/react-big-calendar
// which is ~150 KB gz; only readers hit it.
const ObjectCalendar = lazy(async () => {
  const mod = (await import('@object-ui/plugin-calendar')) as any;
  return { default: mod.ObjectCalendar as React.ComponentType<any> };
});

export interface MetadataPreviewProps {
  /** Metadata type ('object', 'view', 'dashboard', …). */
  type: string;
  /** Object/view machine name. Required for object previews. */
  name?: string;
  /** The metadata document. For views this is the view spec. */
  spec?: any;
  /** Object machine name backing the view (when not on `spec.objectName`). */
  objectName?: string;
  /** Optional className passed through to the renderer. */
  className?: string;
}

export function MetadataPreview({
  type,
  name,
  spec,
  objectName,
  className,
}: MetadataPreviewProps) {
  const dataSource = useObjectUiDataSource();
  const { version: hmrVersion } = useMetadataHmr();

  // Detect a multi-view document (e.g. { list, kanban, calendar, form }).
  const subViews = useMemo(() => {
    if (type !== 'view' || !spec || typeof spec !== 'object') return [] as SubViewKey[];
    return SUBVIEW_KEYS.filter((k) => spec[k] && typeof spec[k] === 'object');
  }, [type, spec]);

  const [activeSub, setActiveSub] = useState<SubViewKey | null>(null);
  const effectiveSub: SubViewKey | null =
    subViews.length === 0 ? null : (activeSub && subViews.includes(activeSub) ? activeSub : subViews[0]);

  // Compute the renderer + schema lazily so we don't import any heavy
  // component for the wrong type.
  const rendered = useMemo(() => {
    // Plain Object preview → grid of records.
    if (type === 'object' && name) {
      return (
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: name, mode: 'read' as const }}
          dataSource={dataSource}
          className={className}
        />
      );
    }

    if (type !== 'view' || !spec) {
      return (
        <UnsupportedPreview type={type} spec={spec} />
      );
    }

    // Multi-view document: pick the active sub-view.
    const subSpec: any = effectiveSub ? spec[effectiveSub] : spec;
    const viewType: string =
      effectiveSub ||
      subSpec?.viewType ||
      subSpec?.type?.replace(/^object-/, '') ||
      'form';
    const resolvedObject: string =
      subSpec?.data?.object ||
      subSpec?.objectName ||
      spec?.data?.object ||
      spec?.objectName ||
      objectName ||
      name ||
      '';

    switch (viewType) {
      case 'form':
        return (
          <LiveFormPreview spec={subSpec} objectName={resolvedObject} className={className} />
        );
      case 'kanban':
      case 'board':
        return (
          <ObjectKanban
            schema={{
              type: 'object-kanban',
              objectName: resolvedObject,
              ...subSpec,
            }}
            dataSource={dataSource}
            className={className}
          />
        );
      case 'grid':
      case 'list':
      case 'table':
        return (
          <ObjectGrid
            schema={{
              type: 'object-grid',
              objectName: resolvedObject,
              mode: 'read',
              ...subSpec,
            }}
            dataSource={dataSource}
            className={className}
          />
        );
      case 'detail':
        return (
          <DetailView
            schema={{
              type: 'object-detail',
              objectName: resolvedObject,
              ...subSpec,
            }}
            dataSource={dataSource}
            className={className}
          />
        );
      case 'calendar':
        return (
          <Suspense fallback={<PreviewLoading />}>
            <ObjectCalendar
              schema={{
                type: 'object-calendar',
                objectName: resolvedObject,
                ...subSpec,
              }}
              dataSource={dataSource}
              className={className}
            />
          </Suspense>
        );
      default:
        return <UnsupportedPreview type={`view/${viewType}`} spec={subSpec} />;
    }
  }, [type, name, spec, objectName, className, dataSource, effectiveSub]);

  // Whether the current sub-view renders its own status bar (LiveFormPreview does).
  const isFormSub = (effectiveSub === 'form') ||
    (type === 'view' && !effectiveSub && (spec?.viewType === 'form' || (!spec?.viewType && (spec?.sections || spec?.groups))));

  const resolvedObjectName = useMemo(() => {
    if (type === 'object') return name ?? '';
    const subSpec: any = effectiveSub ? spec?.[effectiveSub] : spec;
    return subSpec?.data?.object || subSpec?.objectName || spec?.data?.object || spec?.objectName || objectName || name || '';
  }, [type, name, spec, objectName, effectiveSub]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-dashed px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Eye className="h-3.5 w-3.5" />
          <span>Live preview · rendered with @object-ui</span>
        </div>
        {subViews.length > 1 && (
          <div className="flex items-center gap-1">
            {subViews.map((k) => {
              const Icon = SUBVIEW_ICON[k];
              const active = k === effectiveSub;
              return (
                <Button
                  key={k}
                  size="sm"
                  variant={active ? 'default' : 'ghost'}
                  className="h-6 gap-1 px-2 text-[11px]"
                  onClick={() => setActiveSub(k)}
                >
                  <Icon className="h-3 w-3" />
                  {SUBVIEW_LABEL[k]}
                </Button>
              );
            })}
          </div>
        )}
      </div>
      <div className={isFormSub ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-auto p-4'}>
        <div key={`hmr-${hmrVersion}`} className="h-full">{rendered}</div>
      </div>
      {!isFormSub && <LivePreviewStatusBar objectName={resolvedObjectName} />}
    </div>
  );
}

function PreviewLoading() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
      Loading preview…
    </div>
  );
}

function UnsupportedPreview({ type, spec }: { type: string; spec: any }) {
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>No live preview for {type}</AlertTitle>
      <AlertDescription className="mt-2 text-xs">
        Studio doesn't render this metadata type yet. The raw spec is shown below for
        reference.
        <pre className="mt-3 max-h-64 overflow-auto rounded bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(spec ?? null, null, 2)}
        </pre>
      </AlertDescription>
    </Alert>
  );
}
