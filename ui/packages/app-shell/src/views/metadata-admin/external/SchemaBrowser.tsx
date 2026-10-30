// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SchemaBrowser — the "schema browser" surface of the external-datasource
 * Studio panel (ADR-0015 §6.4).
 *
 * Lists the remote tables a federated datasource exposes (filtered server-side
 * by `external.allowedSchemas`) — an OData datasource's entity sets — with an
 * optional client-side text filter, a per-table "Import" action that opens
 * {@link ImportObjectDialog}, and "Import selected" for several at once
 * ({@link importRemoteTables}, which saves lookup targets first).
 *
 * Data is fetched on demand (mount + explicit "Refresh"), never on a timer —
 * introspecting a warehouse is expensive, so the user stays in control.
 */

import * as React from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import { RefreshCw, Loader2, Search, Table2, Download, Columns3 } from 'lucide-react';
import { Button, Checkbox } from '@object-ui/components';
import {
  listRemoteTables,
  importRemoteTables,
  ExternalServiceUnavailableError,
  type RemoteTable,
  type RemoteTableImport,
} from './api.js';
import { ImportObjectDialog } from './ImportObjectDialog.js';
import { t as tr, tFormat, useMetadataLocale } from '../i18n.js';
import { withNodes } from '../previews/row-nodes.js';

export interface SchemaBrowserProps {
  datasource: string;
  /** Whether the datasource permits writes (`external.allowWrites`): only then is the write opt-in offered. */
  allowWrites?: boolean;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error' | 'unavailable';

/** A remote table's key in the list: its qualified name. */
const tableKey = (t: RemoteTable) => [t.schema, t.name].filter(Boolean).join('.');

type BatchState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; count: number }
  | { phase: 'done'; results: RemoteTableImport[] };

export function SchemaBrowser({ datasource, allowWrites }: SchemaBrowserProps) {
  // Dates and numbers on this surface read the display locale; a bare
  // `toLocale*()` call used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  // The designer locale this tab's own words read in (objectui#10862): the
  // one the console's language resolves to, the same value its host panel's
  // `locale` carries (`DatasourcePreview`'s hosts pass `useMetadataLocale()`).
  const locale = useMetadataLocale();
  const [state, setState] = React.useState<LoadState>('idle');
  const [tables, setTables] = React.useState<RemoteTable[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [importing, setImporting] = React.useState<RemoteTable | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [batchWritable, setBatchWritable] = React.useState(false);
  const [batch, setBatch] = React.useState<BatchState>({ phase: 'idle' });

  const load = React.useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const rows = await listRemoteTables(datasource);
      setTables(rows);
      setSelected(new Set());
      setState('loaded');
    } catch (err) {
      if (err instanceof ExternalServiceUnavailableError) {
        setState('unavailable');
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    }
  }, [datasource]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => {
      const label = [t.schema, t.name].filter(Boolean).join('.').toLowerCase();
      return label.includes(q);
    });
  }, [tables, query]);

  const openImport = (t: RemoteTable) => {
    setImporting(t);
    setDialogOpen(true);
  };

  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selected.has(tableKey(t)));
  const toggleAll = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of filtered) {
        if (on) next.add(tableKey(t));
        else next.delete(tableKey(t));
      }
      return next;
    });

  const importSelected = async () => {
    const chosen = tables.filter((t) => selected.has(tableKey(t)));
    if (chosen.length === 0) return;
    setBatch({ phase: 'running', done: 0, count: chosen.length });
    const results = await importRemoteTables(datasource, chosen, {
      writable: allowWrites === true && batchWritable,
      onProgress: (done) => setBatch({ phase: 'running', done, count: chosen.length }),
    });
    setSelected(new Set());
    setBatch({ phase: 'done', results });
  };
  const running = batch.phase === 'running';

  if (state === 'unavailable') {
    return <UnavailableHint locale={locale} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('engine.externalDatasource.browser.filter', locale)}
            className="w-full rounded border bg-background pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={state === 'loading'}>
          {state === 'loading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">{tr('engine.externalDatasource.browser.refresh', locale)}</span>
        </Button>
      </div>

      {(selected.size > 0 || running) && (
        <div className="flex flex-wrap items-center gap-3">
          {allowWrites && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={batchWritable}
                disabled={running}
                onCheckedChange={(v) => setBatchWritable(v === true)}
              />
              {tr('engine.externalDatasource.import.writable', locale)}
            </label>
          )}
          <Button size="sm" className="ml-auto" onClick={() => void importSelected()} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span className="ml-1.5">
              {batch.phase === 'running'
                ? tFormat('engine.externalDatasource.browser.importingSelected', locale, {
                    done: batch.done,
                    count: batch.count,
                  })
                : tFormat('engine.externalDatasource.browser.importSelected', locale, { count: selected.size })}
            </span>
          </Button>
        </div>
      )}

      {batch.phase === 'done' && <BatchResults results={batch.results} locale={locale} />}

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {state === 'loading' && tables.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {tr('engine.externalDatasource.browser.introspecting', locale)}
        </div>
      )}

      {state === 'loaded' && filtered.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {tables.length === 0
            ? tr('engine.externalDatasource.browser.noRemoteTables', locale)
            : tr('engine.externalDatasource.browser.noMatch', locale)}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded border bg-background overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 w-px">
                  <Checkbox
                    checked={allFilteredSelected}
                    disabled={running}
                    onCheckedChange={(v) => toggleAll(v === true)}
                    aria-label={tr('engine.externalDatasource.browser.selectAll', locale)}
                  />
                </th>
                <th className="px-2.5 py-1.5 text-left font-medium">
                  {tr('engine.externalDatasource.browser.colTable', locale)}
                </th>
                <th className="px-2.5 py-1.5 text-right font-medium">
                  {tr('engine.externalDatasource.browser.colColumns', locale)}
                </th>
                <th className="px-2.5 py-1.5 text-right font-medium">
                  {tr('engine.externalDatasource.browser.colRows', locale)}
                </th>
                <th className="px-2.5 py-1.5 w-px" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((t) => {
                const key = tableKey(t);
                return (
                  <tr key={key} className="hover:bg-muted/30">
                    <td className="px-2.5 py-1.5">
                      <Checkbox
                        checked={selected.has(key)}
                        disabled={running}
                        onCheckedChange={(v) => toggle(key, v === true)}
                        aria-label={tFormat('engine.externalDatasource.browser.selectRow', locale, { table: key })}
                      />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {t.schema && <span className="text-muted-foreground">{t.schema}.</span>}
                        <span className="font-medium">{t.name}</span>
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Columns3 className="h-3 w-3" />
                        {t.columnCount}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">
                      {typeof t.rowCountEstimate === 'number'
                        ? t.rowCountEstimate.toLocaleString(displayLocale)
                        : '—'}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Button variant="ghost" size="sm" onClick={() => openImport(t)}>
                        <Download className="h-3.5 w-3.5" />
                        <span className="ml-1.5">{tr('engine.externalDatasource.browser.import', locale)}</span>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ImportObjectDialog
        datasource={datasource}
        table={importing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        allowWrites={allowWrites}
      />
    </div>
  );
}

/**
 * What "Import selected" did, table by table, in the order the tables were
 * saved: the object each landed as and how many review notes its draft
 * carries (the notes themselves are in the single-table dialog), or the
 * refusal, as the server worded it.
 */
function BatchResults({ results, locale }: { results: RemoteTableImport[]; locale: string }) {
  const imported = results.filter((r) => r.name && !r.error).length;
  return (
    <div className="rounded border bg-muted/20 p-2.5 text-xs" data-testid="schema-browser-batch-results">
      <div className="font-medium">
        {tFormat(
          imported === 1
            ? 'engine.externalDatasource.browser.batchDoneOne'
            : 'engine.externalDatasource.browser.batchDoneOther',
          locale,
          { count: imported, total: results.length },
        )}
      </div>
      <ul className="mt-1.5 space-y-1">
        {results.map((r) => (
          <li key={tableKey(r.table)} className="flex flex-wrap gap-x-1.5">
            <span className="font-mono">{tableKey(r.table)}</span>
            {r.error ? (
              <span className="text-destructive">— {r.error}</span>
            ) : (
              <>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono font-medium">{r.name}</span>
                {r.review.length > 0 && (
                  <span className="text-amber-700 dark:text-amber-400">
                    (
                    {tFormat(
                      r.review.length === 1
                        ? 'engine.externalDatasource.import.reviewOne'
                        : 'engine.externalDatasource.import.reviewOther',
                      locale,
                      { count: r.review.length },
                    )}
                    )
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnavailableHint({ locale }: { locale: string }) {
  return (
    <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200">
      {withNodes(tr('engine.externalDatasource.browser.unavailable', locale), {
        service: <span className="font-mono">external-datasource</span>,
      })}
    </div>
  );
}
