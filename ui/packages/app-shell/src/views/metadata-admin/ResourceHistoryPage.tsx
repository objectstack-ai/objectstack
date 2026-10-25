// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataResourceHistoryPage — durable change log for one item
 * (Phase 3c).
 *
 * Calls `client.history(type, name)`. The framework returns
 * `{ events: MetadataEvent[] }` where each event records who saved
 * what, with a monotonic `seq`. We render a vertical timeline; clicking
 * an event expands its payload diff.
 *
 * Rollback is intentionally not exposed in MVP — restoring a previous
 * version is just `client.save(type, name, oldPayload)` which already
 * works, but a one-click revert needs a confirmation flow we'll add
 * once admins ask for it.
 */

import * as React from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@object-ui/components';
import { Badge } from '@object-ui/components';
import { Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@object-ui/components';
import { t, tFormat, translateConsoleValue, useMetadataLocale } from './i18n.js';
import { PageShell } from './PageShell.js';
import {
  useMetadataClient,
  useMetadataTypes,
  type RichMetadataTypeEntry,
} from './useMetadata.js';

export interface MetadataResourceHistoryPageProps {
  type?: string;
  name?: string;
}

type HistoryEvent = {
  seq?: number;
  /** Newer framework field — `create | update | delete | publish | revert`. */
  op?: string;
  /** Legacy field — kept for backward compat with older servers. */
  kind?: string;
  /** Per-(type,name) monotonic version used by rollback. */
  version?: number;
  actor?: string | null;
  at?: string | number;
  /** ISO timestamp on newer servers. */
  ts?: string | number;
  payload?: unknown;
  hash?: string;
  [k: string]: unknown;
};

export function MetadataResourceHistoryPage({
  type: typeProp,
  name: nameProp,
}: MetadataResourceHistoryPageProps) {
  const params = useParams<{ type?: string; name?: string }>();
  const type = typeProp ?? params.type ?? '';
  const name = nameProp ?? params.name ?? '';
  const navigate = useNavigate();
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const { entries } = useMetadataTypes(client);
  const entry: RichMetadataTypeEntry | undefined = entries.find((t) => t.type === type);

  const [refreshKey, setRefreshKey] = React.useState(0);
  const [eventCount, setEventCount] = React.useState(0);

  return (
    <PageShell
      entry={entry ?? { type, label: type }}
      itemName={name}
      subtitle={t('engine.edit.historySubtitle', locale)}
      stats={[{ label: t('engine.edit.historyEvents', locale), value: eventCount }]}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`../${encodeURIComponent(name)}`)}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to item
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            aria-label={t('engine.edit.refresh', locale)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </>
      }
    >
      <div className="p-6 max-w-4xl">
        <HistoryPanel
          type={type}
          name={name}
          refreshKey={refreshKey}
          onCount={setEventCount}
          client={client}
          locale={locale}
          onRollback={() => setRefreshKey((k) => k + 1)}
        />
      </div>
    </PageShell>
  );
}

/**
 * Embeddable version of the history timeline. Re-used by both the
 * routed full page and the right-side sheet on the edit page so we
 * keep a single visual + fetching implementation.
 *
 * Pass `onRollback` to enable the per-event Rollback action — the
 * embedded version inside ResourceEditPage uses it to refresh the
 * editor's layered view after restoring a previous version.
 */
export function HistoryPanel({
  type,
  name,
  refreshKey = 0,
  onCount,
  client,
  onRollback,
  rollbackConfirm,
  rollbackLabel,
  locale,
}: {
  type: string;
  name: string;
  refreshKey?: number;
  onCount?: (n: number) => void;
  client: ReturnType<typeof useMetadataClient>;
  /** UI locale for the operation badges. */
  locale?: string;
  /** Called after a successful rollback so the parent can refresh. */
  onRollback?: (version: number) => void;
  /** Confirmation message — defaults to a literal English string. */
  rollbackConfirm?: (version: number) => string;
  /** Tooltip / button label — defaults to "Rollback". */
  rollbackLabel?: string;
}) {
  // The event time reads the DISPLAY locale — not `locale` above, which picks
  // the badge strings (objectui#9909).
  const displayLocale = useDisplayLocale();
  const [events, setEvents] = React.useState<HistoryEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const [rollingBack, setRollingBack] = React.useState<number | null>(null);
  // objectui#13333 — the version a rollback is being confirmed for, asked in
  // the in-app AlertDialog below rather than the browser's native `confirm()`.
  const [confirmVersion, setConfirmVersion] = React.useState<number | null>(null);
  const [localRefresh, setLocalRefresh] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const result = await client.history<any>(type, name, { limit: 100 });
        if (cancelled) return;
        const list = Array.isArray(result)
          ? result
          : Array.isArray(result?.events)
            ? result.events
            : [];
        // Reverse chronological — most recent first.
        const sorted = [...list].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
        setEvents(sorted);
        onCount?.(sorted.length);
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, type, name, refreshKey, localRefresh]);

  function rollbackMessage(version: number): string {
    return rollbackConfirm
      ? rollbackConfirm(version)
      : `Restore version ${version}? This writes the historical body back as the current overlay.`;
  }

  async function doRollback(version: number) {
    setRollingBack(version);
    setError(null);
    try {
      await (client as any).rollback(type, name, version);
      onRollback?.(version);
      // Refetch so the new revert event shows up at the top.
      setLocalRefresh((k) => k + 1);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setRollingBack(null);
    }
  }

  return (
    <>
      {loading && (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      )}
      {error && (
        <div className="text-sm text-destructive border border-destructive/30 rounded p-3 bg-destructive/5">
          {error}
        </div>
      )}
      {!loading && !error && events.length === 0 && (
        <Empty>
          <EmptyTitle>{t('engine.edit.historyEmptyTitle', locale)}</EmptyTitle>
          <EmptyDescription>
            {t('engine.edit.historyEmptyDesc', locale)}
          </EmptyDescription>
        </Empty>
      )}
      {!loading && events.length > 0 && (
        <ol className="space-y-2 relative pl-6 border-l">
          {events.map((ev, i) => {
            const isOpen = expanded === i;
            const op = ev.op ?? ev.kind;
            const ts = ev.ts ?? ev.at;
            const canRollback = !!onRollback
              && typeof ev.version === 'number'
              && op !== 'delete'
              && op !== 'tombstone';
            return (
              <li key={`${ev.seq ?? i}-${i}`} className="relative">
                <span className="absolute -left-[27px] top-2 w-3 h-3 rounded-full bg-primary ring-4 ring-background" />
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpanded(isOpen ? null : i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setExpanded(isOpen ? null : i);
                    }
                  }}
                  className="border rounded-lg p-3 hover:border-primary/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] font-mono">
                      seq {ev.seq ?? '–'}
                    </Badge>
                    {typeof ev.version === 'number' && (
                      <Badge variant="outline" className="text-[10px] font-mono">
                        v{ev.version}
                      </Badge>
                    )}
                    {op && (
                      <Badge
                        className={
                          'text-[10px] ' +
                          (op === 'delete' || op === 'tombstone'
                            ? 'bg-red-100 text-red-800 hover:bg-red-100'
                            : op === 'create'
                              ? 'bg-blue-100 text-blue-800 hover:bg-blue-100'
                              : op === 'publish'
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                                : op === 'revert'
                                  ? 'bg-amber-100 text-amber-900 hover:bg-amber-100'
                                  : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100')
                        }
                      >
                        {translateConsoleValue('op', String(op), locale)}
                      </Badge>
                    )}
                    {ev.actor && (
                      <span className="text-xs text-muted-foreground">
                        by{' '}
                        <span className="font-mono">{String(ev.actor)}</span>
                      </span>
                    )}
                    {ts && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {formatWhen(ts, displayLocale)}
                      </span>
                    )}
                    {canRollback && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        title={rollbackLabel ?? 'Rollback to this version'}
                        disabled={rollingBack !== null}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmVersion(ev.version!);
                        }}
                      >
                        {rollingBack === ev.version ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                  {isOpen && (
                    <pre className="mt-2 text-xs font-mono bg-muted/30 rounded p-2 overflow-auto max-h-[280px]">
                      {safeStringify(ev)}
                    </pre>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <AlertDialog
        open={confirmVersion !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmVersion(null);
        }}
      >
        <AlertDialogContent data-testid="history-rollback-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmVersion !== null &&
                tFormat('engine.edit.rollbackConfirmTitle', locale, {
                  item: `${type}/${name}`,
                  version: confirmVersion,
                })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmVersion !== null && rollbackMessage(confirmVersion)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="history-rollback-confirm-cancel">
              {t('engine.cancel', locale)}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="history-rollback-confirm-action"
              onClick={() => {
                const version = confirmVersion;
                setConfirmVersion(null);
                if (version !== null) void doRollback(version);
              }}
            >
              {rollbackLabel ?? 'Rollback to this version'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function formatWhen(at: string | number, locale: string): string {
  try {
    const d = typeof at === 'number' ? new Date(at) : new Date(at);
    if (Number.isNaN(d.getTime())) return String(at);
    return d.toLocaleString(locale);
  } catch {
    return String(at);
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
