// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ExternalDatasourcePanel — the Studio home for an External Datasource
 * Federation datasource (ADR-0015 §6.4).
 *
 * Rendered inside `DatasourcePreview` whenever a datasource is federated
 * (`schemaMode !== 'managed'`). It groups the buildable P5 surfaces:
 *
 *   • Tables      — browse remote tables + import them as Objects.
 *   • Validation  — check declared objects against the live remote schema
 *                   (doubles as on-demand drift detection).
 *
 * A header strip offers "Refresh catalog" (re-introspect + persist the
 * `external_catalog` snapshot) and shows when the snapshot was last taken.
 *
 * The connection wizard (drivers / credentials / secrets) intentionally lives
 * in System Settings, not here — this surface is metadata-design work.
 */

import * as React from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import { DatabaseZap, RefreshCw, Loader2, Clock } from 'lucide-react';
import {
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@object-ui/components';
import { SchemaBrowser } from './SchemaBrowser.js';
import { ValidationPanel } from './ValidationPanel.js';
import {
  refreshCatalog,
  ExternalServiceUnavailableError,
  type ExternalCatalog,
} from './api.js';
import { t as tr, tFormat } from '../i18n.js';

export interface ExternalDatasourcePanelProps {
  /** The datasource's saved name. Empty while the datasource is unsaved. */
  datasource: string;
  /** The datasource's `schemaMode` (only `external` / `validate-only` here). */
  schemaMode?: string;
  /** Whether the datasource permits writes (`external.allowWrites`). */
  allowWrites?: boolean;
  /**
   * The designer locale the panel's own words read in — `DatasourcePreview`
   * passes the one its host gives it (objectui#10862).
   */
  locale?: string;
}

export function ExternalDatasourcePanel({
  datasource,
  schemaMode,
  allowWrites,
  locale,
}: ExternalDatasourcePanelProps) {
  // Dates and numbers on this surface read the display locale; a bare
  // `toLocale*()` call used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  const [catalog, setCatalog] = React.useState<ExternalCatalog | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleRefresh = React.useCallback(async () => {
    if (!datasource) return;
    setRefreshing(true);
    setError(null);
    try {
      const c = await refreshCatalog(datasource);
      setCatalog(c);
    } catch (err) {
      setError(
        err instanceof ExternalServiceUnavailableError
          ? tr('engine.externalDatasource.unavailable', locale)
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setRefreshing(false);
    }
  }, [datasource, locale]);

  // Unsaved datasource: the REST routes key off a saved `:name`, so nothing
  // can be introspected yet. Guide the user to save first.
  if (!datasource) {
    return (
      <div className="rounded border bg-muted/20 p-3 text-xs text-muted-foreground">
        {tr('engine.externalDatasource.saveFirst', locale)}
      </div>
    );
  }

  return (
    <div className="rounded border bg-background">
      {/* Header strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-muted/30 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
          <DatabaseZap className="h-4 w-4 text-sky-500" />
          {tr('engine.externalDatasource.title', locale)}
        </span>
        <span className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {schemaMode ?? 'external'}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
            allowWrites
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {tr(allowWrites ? 'engine.externalDatasource.writesAllowed' : 'engine.externalDatasource.readOnly', locale)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {catalog?.snapshotAt && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {tFormat('engine.externalDatasource.snapshot', locale, {
                time: formatSnapshot(catalog.snapshotAt, displayLocale),
              })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">{tr('engine.externalDatasource.refresh', locale)}</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <Tabs defaultValue="tables" className="p-3">
        <TabsList>
          <TabsTrigger value="tables">{tr('engine.externalDatasource.tables', locale)}</TabsTrigger>
          <TabsTrigger value="validation">{tr('engine.externalDatasource.validation', locale)}</TabsTrigger>
        </TabsList>
        <TabsContent value="tables" className="mt-3">
          <SchemaBrowser datasource={datasource} />
        </TabsContent>
        <TabsContent value="validation" className="mt-3">
          <ValidationPanel datasource={datasource} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function formatSnapshot(iso: string, locale: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  try {
    return new Date(t).toLocaleString(locale);
  } catch {
    return iso;
  }
}
