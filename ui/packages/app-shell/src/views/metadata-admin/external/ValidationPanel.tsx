// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ValidationPanel — the "validation panel" surface of the external-datasource
 * Studio panel (ADR-0015 §6.4).
 *
 * Runs `POST …/validate` on demand and renders, per federated Object bound to
 * this datasource, whether it still matches the live remote table — plus the
 * structured schema diffs (missing column, type mismatch, …) when it doesn't.
 *
 * This doubles as the on-demand "drift" view: a previously-green object that
 * now reports `missing_column` / `type_mismatch` is exactly remote drift.
 */

import * as React from 'react';
import { ShieldCheck, ShieldAlert, Loader2, PlayCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@object-ui/components';
import {
  validateDatasource,
  ExternalServiceUnavailableError,
  type SchemaValidationResult,
  type SchemaDiffEntry,
} from './api.js';
import { t as tr, tFormat, useMetadataLocale } from '../i18n.js';
import { withNodes } from '../previews/row-nodes.js';

export interface ValidationPanelProps {
  datasource: string;
}

type RunState = 'idle' | 'running' | 'done' | 'error' | 'unavailable';

/**
 * Every diff kind the server can report, labelled — the catalogue row each
 * kind's badge reads in the designer locale (objectui#10862).
 *
 * Total over `SchemaDiffEntry['kind']` on purpose — now that the kind union is
 * imported from `@objectstack/spec/shared` rather than transcribed locally, a
 * kind added upstream fails THIS map to compile instead of rendering a blank
 * cell. `index_mismatch` and `unmapped_index` (framework#3728) were exactly
 * that: already emitted by the validate route, absent from the local copy of
 * the union, and therefore silently unlabelled here (objectstack#4115).
 * `default_mismatch` (spec 17.0.0-rc.2) is the mechanism working as intended —
 * it arrived with the pin bump and failed this build until labelled.
 * `unreachable` (spec 17.3.0) arrived the same way. It is the one kind that
 * asserts NOTHING about the remote schema — introspection never completed, so
 * the comparison never ran — and the spec's own ruling is that consumers must
 * surface it as "cannot check", never as "schema changed": labelling it like a
 * mismatch tells an operator to repair a schema nobody has read.
 */
const DIFF_LABEL_KEY: Record<SchemaDiffEntry['kind'], string> = {
  missing_table: 'engine.externalDatasource.diff.missingTable',
  missing_column: 'engine.externalDatasource.diff.missingColumn',
  type_mismatch: 'engine.externalDatasource.diff.typeMismatch',
  nullability_mismatch: 'engine.externalDatasource.diff.nullabilityMismatch',
  unmapped_column: 'engine.externalDatasource.diff.unmappedColumn',
  pk_mismatch: 'engine.externalDatasource.diff.pkMismatch',
  index_mismatch: 'engine.externalDatasource.diff.indexMismatch',
  unmapped_index: 'engine.externalDatasource.diff.unmappedIndex',
  default_mismatch: 'engine.externalDatasource.diff.defaultMismatch',
  unreachable: 'engine.externalDatasource.diff.unreachable',
};

export function ValidationPanel({ datasource }: ValidationPanelProps) {
  // The designer locale this tab's own words read in (objectui#10862): the
  // one the console's language resolves to, the same value its host panel's
  // `locale` carries (`DatasourcePreview`'s hosts pass `useMetadataLocale()`).
  const locale = useMetadataLocale();
  const [state, setState] = React.useState<RunState>('idle');
  const [results, setResults] = React.useState<SchemaValidationResult[]>([]);
  const [ok, setOk] = React.useState<boolean | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(async () => {
    setState('running');
    setError(null);
    try {
      const report = await validateDatasource(datasource);
      setResults(report.results);
      setOk(report.ok);
      setState('done');
    } catch (err) {
      if (err instanceof ExternalServiceUnavailableError) {
        setState('unavailable');
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    }
  }, [datasource]);

  if (state === 'unavailable') {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200">
        {tr('engine.externalDatasource.check.unavailable', locale)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {withNodes(tr('engine.externalDatasource.check.intro', locale), {
            datasource: <span className="font-mono">{datasource}</span>,
          })}
        </p>
        <Button variant="outline" size="sm" onClick={() => void run()} disabled={state === 'running'}>
          {state === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlayCircle className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">{tr('engine.externalDatasource.check.run', locale)}</span>
        </Button>
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {state === 'done' && ok !== null && (
        <div
          className={`flex items-center gap-2 rounded border p-2.5 text-sm ${
            ok
              ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300'
              : 'border-destructive/40 bg-destructive/5 text-destructive'
          }`}
        >
          {ok ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          {ok
            ? tFormat(
                results.length === 1
                  ? 'engine.externalDatasource.check.allMatchOne'
                  : 'engine.externalDatasource.check.allMatchOther',
                locale,
                { count: results.length },
              )
            : tFormat(
                results.length === 1
                  ? 'engine.externalDatasource.check.divergeOne'
                  : 'engine.externalDatasource.check.divergeOther',
                locale,
                { diverged: results.filter((r) => !r.ok).length, count: results.length },
              )}
        </div>
      )}

      {state === 'done' && results.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {tr('engine.externalDatasource.check.noObjects', locale)}
        </div>
      )}

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((r) => (
            <ResultRow key={r.object} result={r} locale={locale} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultRow({ result, locale }: { result: SchemaValidationResult; locale: string }) {
  return (
    <li className="rounded border bg-background">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {result.ok ? (
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
        )}
        <span className="font-mono text-xs font-medium">{result.object}</span>
        {!result.ok && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {tFormat(
              result.diffs.length === 1
                ? 'engine.externalDatasource.check.diffsOne'
                : 'engine.externalDatasource.check.diffsOther',
              locale,
              { count: result.diffs.length },
            )}
          </span>
        )}
      </div>
      {result.diffs.length > 0 && (
        <ul className="border-t divide-y">
          {result.diffs.map((d, i) => (
            <DiffRow key={`${d.kind}:${d.column ?? ''}:${i}`} diff={d} locale={locale} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DiffRow({ diff, locale }: { diff: SchemaDiffEntry; locale: string }) {
  const labelKey = DIFF_LABEL_KEY[diff.kind] as string | undefined;
  const where = [diff.remoteSchema, diff.remoteName].filter(Boolean).join('.');
  const isError = diff.severity === 'error';
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2.5 py-1.5 text-[11px]">
      <span
        className={`rounded px-1 py-0.5 font-medium uppercase tracking-wide text-[9px] ${
          isError
            ? 'bg-destructive/10 text-destructive'
            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        }`}
      >
        {labelKey ? tr(labelKey, locale) : diff.kind}
      </span>
      {where && <span className="font-mono text-muted-foreground">{where}</span>}
      {diff.column && <span className="font-mono">.{diff.column}</span>}
      {(diff.expected !== undefined || diff.actual !== undefined) && (
        <span className="text-muted-foreground">
          {withNodes(tr('engine.externalDatasource.check.expectedActual', locale), {
            expected: <span className="font-mono">{diff.expected ?? '—'}</span>,
            actual: <span className="font-mono">{diff.actual ?? '—'}</span>,
          })}
        </span>
      )}
    </li>
  );
}
