// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ImportObjectDialog — the mapping/import step of the external-datasource
 * Studio surface (ADR-0015 §6.4 "Mapping editor").
 *
 * Flow:
 *   1. On open, POST `…/tables/:remote/draft` → an `ObjectDraft`
 *      (structured definition + reviewable `*.object.ts` source).
 *   2. Show the suggested object name, any `// REVIEW:` columns the
 *      type-compat matrix flagged as lossy/unknown, and the generated
 *      source.
 *   3. "Import as Object" PUTs the draft's definition to the metadata
 *      store (`/meta/object/:name`) and reports success.
 *
 * The dialog never mutates the remote schema — it only reads the draft and
 * writes a local Object definition.
 */

import * as React from 'react';
import { AlertTriangle, Database, FileCode2, Loader2, CheckCircle2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@object-ui/components';
import {
  generateObjectDraft,
  importObjectDraft,
  ExternalServiceUnavailableError,
  type ObjectDraft,
  type RemoteTable,
} from './api.js';
import { t as tr, tFormat, useMetadataLocale } from '../i18n.js';
import { withNodes } from '../previews/row-nodes.js';

export interface ImportObjectDialogProps {
  datasource: string;
  table: RemoteTable | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Notified after a successful import (so the parent can refresh). */
  onImported?: (objectName: string) => void;
}

type Phase = 'loading' | 'ready' | 'importing' | 'done' | 'error';

/**
 * The draft request met a server without federation. Held as this marker
 * rather than as a sentence, so the words are read in the designer locale at
 * render and follow a language switch (objectui#10862); every other failure
 * is the server's own message and is shown as it came.
 */
const UNAVAILABLE = Symbol('external-service-unavailable');

export function ImportObjectDialog({
  datasource,
  table,
  open,
  onOpenChange,
  onImported,
}: ImportObjectDialogProps) {
  // The designer locale the dialog's own words read in (objectui#10862), the
  // one the console's language resolves to — as its host tab reads it.
  const locale = useMetadataLocale();
  const [phase, setPhase] = React.useState<Phase>('loading');
  const [draft, setDraft] = React.useState<ObjectDraft | null>(null);
  const [error, setError] = React.useState<string | typeof UNAVAILABLE | null>(null);

  // Load the draft whenever the dialog opens for a (new) table.
  React.useEffect(() => {
    if (!open || !table) return;
    let cancelled = false;
    setPhase('loading');
    setDraft(null);
    setError(null);
    (async () => {
      try {
        const d = await generateObjectDraft(datasource, table.name, {
          remoteSchema: table.schema,
        });
        if (cancelled) return;
        setDraft(d);
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ExternalServiceUnavailableError
            ? UNAVAILABLE
            : err instanceof Error
              ? err.message
              : String(err),
        );
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, table, datasource]);

  const handleImport = React.useCallback(async () => {
    if (!draft) return;
    setPhase('importing');
    setError(null);
    try {
      await importObjectDraft(draft);
      setPhase('done');
      onImported?.(draft.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('ready');
    }
  }, [draft, onImported]);

  const remoteLabel = table ? [table.schema, table.name].filter(Boolean).join('.') : '';
  const errorText = error === UNAVAILABLE ? tr('engine.externalDatasource.unavailable', locale) : error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            {tr('engine.externalDatasource.import.title', locale)}
          </DialogTitle>
          <DialogDescription>
            {withNodes(tr('engine.externalDatasource.import.intro', locale), {
              table: <span className="font-mono">{remoteLabel}</span>,
              datasource: <span className="font-mono">{datasource}</span>,
            })}
          </DialogDescription>
        </DialogHeader>

        {phase === 'loading' && (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {tr('engine.externalDatasource.import.generating', locale)}
          </div>
        )}

        {phase === 'error' && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {errorText}
          </div>
        )}

        {phase === 'done' && draft && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <div className="text-sm">
              {withNodes(tr('engine.externalDatasource.import.done', locale), {
                name: <span className="font-mono font-medium">{draft.name}</span>,
              })}
            </div>
            <div className="text-xs text-muted-foreground">
              {tr('engine.externalDatasource.import.doneNext', locale)}
            </div>
          </div>
        )}

        {(phase === 'ready' || phase === 'importing') && draft && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="text-muted-foreground">{tr('engine.externalDatasource.import.objectName', locale)}</span>
              <span className="font-mono font-medium">{draft.name}</span>
            </div>

            {errorText && (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                {errorText}
              </div>
            )}

            {draft.review.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {tFormat(
                    draft.review.length === 1
                      ? 'engine.externalDatasource.import.reviewOne'
                      : 'engine.externalDatasource.import.reviewOther',
                    locale,
                    { count: draft.review.length },
                  )}
                </div>
                <ul className="mt-1.5 space-y-1 text-[11px] text-amber-900/90 dark:text-amber-200/80">
                  {draft.review.map((r) => (
                    <li key={r.column} className="flex flex-wrap gap-x-1.5">
                      <span className="font-mono">{r.column}</span>
                      <span className="text-amber-700/70 dark:text-amber-400/70">({r.remoteType})</span>
                      <span>— {r.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                <FileCode2 className="h-3 w-3" /> {tr('engine.externalDatasource.import.source', locale)}
              </div>
              <pre className="max-h-64 overflow-auto rounded border bg-muted/30 p-2.5 text-[11px] leading-relaxed font-mono">
                {draft.source}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter>
          {phase === 'done' ? (
            <Button onClick={() => onOpenChange(false)}>{tr('engine.close', locale)}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={phase === 'importing'}>
                {tr('engine.cancel', locale)}
              </Button>
              <Button onClick={handleImport} disabled={phase !== 'ready' || !draft}>
                {phase === 'importing' ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {tr('engine.externalDatasource.import.importing', locale)}
                  </span>
                ) : (
                  tr('engine.externalDatasource.import.title', locale)
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
