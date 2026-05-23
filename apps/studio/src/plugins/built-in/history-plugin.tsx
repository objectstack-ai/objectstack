// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in Plugin: Metadata History Timeline
 *
 * Contributes a `history` mode viewer for ALL metadata types. The viewer
 * renders the durable change-log persisted in `sys_metadata_history`
 * (see ADR-0008 §5) as a chronologically ordered audit timeline.
 *
 * Surfaces the work landed in M1 (transactional history writes) and
 * ADR-0009 (execution-pinned types) — for pinned types (flow / workflow /
 * approval) we display a small "pinned" badge so users understand why
 * the history can't be garbage-collected.
 */

import { useEffect, useMemo, useState } from 'react';
import { defineStudioPlugin } from '@objectstack/spec/studio';
import { useClient } from '@objectstack/client-react';
import { useParams } from '@tanstack/react-router';
import { useScopedClient } from '@/hooks/useObjectStackClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Pencil,
  Plus,
  Trash2,
  ArrowRightLeft,
  HelpCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StudioPlugin, MetadataViewerProps } from '../types';

// ─── Types ───────────────────────────────────────────────────────────

interface HistoryEvent {
  seq: number;
  op: 'create' | 'update' | 'delete' | 'rename';
  ref: { org?: string; type: string; name: string };
  hash: string | null;
  parentHash: string | null;
  previousName?: string;
  actor: string;
  message?: string;
  ts: string;
  source: string;
}

/**
 * Metadata types whose runtime transactions reference a specific historical
 * version via `MetadataRepository.getByHash` (ADR-0009). For these types the
 * history table is exempt from GC and the timeline shows a Pinned badge.
 */
const EXECUTION_PINNED_TYPES = new Set(['flow', 'workflow', 'approval']);

// ─── Helpers ─────────────────────────────────────────────────────────

const OP_CONFIG: Record<HistoryEvent['op'], { icon: LucideIcon; color: string; label: string }> = {
  create: { icon: Plus, color: 'text-green-600 dark:text-green-400', label: 'Created' },
  update: { icon: Pencil, color: 'text-blue-600 dark:text-blue-400', label: 'Updated' },
  delete: { icon: Trash2, color: 'text-red-600 dark:text-red-400', label: 'Deleted' },
  rename: { icon: ArrowRightLeft, color: 'text-amber-600 dark:text-amber-400', label: 'Renamed' },
};

function shortHash(hash: string | null): string {
  if (!hash) return '—';
  const idx = hash.indexOf(':');
  const hex = idx >= 0 ? hash.slice(idx + 1) : hash;
  return hex.slice(0, 8);
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function relativeTime(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diffMs = Date.now() - t;
    const secs = Math.round(diffMs / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}

// ─── Event Row ───────────────────────────────────────────────────────

function EventRow({ event, isLast }: { event: HistoryEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = OP_CONFIG[event.op] ?? { icon: HelpCircle, color: 'text-muted-foreground', label: event.op };
  const Icon = cfg.icon;

  return (
    <div className="relative pl-10">
      {/* Timeline rail */}
      {!isLast && (
        <div className="absolute left-[18px] top-9 bottom-0 w-px bg-border" aria-hidden />
      )}
      {/* Timeline marker */}
      <div className={`absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-border bg-background ${cfg.color}`}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="pb-4">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="group flex w-full items-start justify-between rounded border border-transparent px-2 py-1 text-left hover:border-border hover:bg-accent/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{cfg.label}</span>
              <Badge variant="outline" className="text-[10px] font-mono">#{event.seq}</Badge>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{shortHash(event.hash)}</code>
              <span className="text-xs text-muted-foreground">by {event.actor}</span>
              <span className="text-xs text-muted-foreground">· via {event.source}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              <time dateTime={event.ts} title={formatTs(event.ts)}>{relativeTime(event.ts)}</time>
              <span className="ml-2">{formatTs(event.ts)}</span>
              {event.message && (
                <span className="ml-2 italic">— {event.message}</span>
              )}
              {event.previousName && (
                <span className="ml-2">(was: <code className="text-[11px]">{event.previousName}</code>)</span>
              )}
            </div>
          </div>
          {expanded
            ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          }
        </button>

        {expanded && (
          <div className="mt-2 ml-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded border bg-muted/30 px-3 py-2 text-xs">
            <div className="text-muted-foreground">hash</div>
            <code className="break-all">{event.hash ?? '—'}</code>
            <div className="text-muted-foreground">parent hash</div>
            <code className="break-all">{event.parentHash ?? '—'}</code>
            <div className="text-muted-foreground">ref</div>
            <code>{event.ref.org ? `${event.ref.org}/` : ''}{event.ref.type}/{event.ref.name}</code>
            <div className="text-muted-foreground">actor</div>
            <code>{event.actor}</code>
            <div className="text-muted-foreground">source</div>
            <code>{event.source}</code>
            <div className="text-muted-foreground">timestamp</div>
            <code>{event.ts}</code>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Viewer ─────────────────────────────────────────────────────

function HistoryViewerComponent({ metadataType, metadataName }: MetadataViewerProps) {
  const unscopedClient = useClient();
  const params = useParams({ strict: false }) as { projectId?: string };
  const scopedClient = useScopedClient(params.projectId);
  const client: any = scopedClient ?? unscopedClient;

  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const isPinned = EXECUTION_PINNED_TYPES.has(metadataType);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const result = await client.meta.getHistory(metadataType, metadataName, { limit: 200 });
        if (cancelled) return;
        const list: HistoryEvent[] = Array.isArray(result?.events) ? result.events : [];
        // Newest first.
        list.sort((a, b) => b.seq - a.seq);
        setEvents(list);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message ?? String(err));
        setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [client, metadataType, metadataName, refreshTick]);

  const summary = useMemo(() => {
    if (!events?.length) return null;
    const created = events.find(e => e.op === 'create');
    const latest = events[0];
    return {
      total: events.length,
      created,
      latest,
    };
  }, [events]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">History</h2>
        {isPinned && (
          <Badge variant="secondary" className="gap-1">
            <Lock className="h-3 w-3" /> Pinned
          </Badge>
        )}
        {summary && (
          <span className="text-xs text-muted-foreground">
            {summary.total} event{summary.total === 1 ? '' : 's'}
            {summary.latest && (
              <> · last change {relativeTime(summary.latest.ts)}</>
            )}
          </span>
        )}
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshTick(t => t + 1)}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {isPinned && (
        <div className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          This metadata type is <strong>execution-pinned</strong> (ADR-0009): in-flight transactions
          may reference any version below by its content hash, so history rows for this item are
          retained indefinitely and never garbage-collected.
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="px-4 py-4">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load history: {error}
            </div>
          )}

          {!loading && !error && events && events.length === 0 && (
            <div className="rounded border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              <p>No history events recorded for this item.</p>
              <p className="mt-1 text-xs">
                Edits to this metadata appear here. Some built-in types (e.g. objects) keep their history in source control instead.
              </p>
            </div>
          )}

          {!loading && !error && events && events.length > 0 && (
            <div className="relative">
              {events.map((event, i) => (
                <EventRow key={`${event.seq}-${event.hash ?? 'null'}`} event={event} isLast={i === events.length - 1} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Plugin Definition ───────────────────────────────────────────────

/**
 * Wildcard `history` mode viewer. Registers under a single sentinel
 * metadata type "*" — the plugin host's `useMetadataViewer` resolver
 * matches by `metadataTypes.includes('*')` as a fallback, so this
 * single registration covers every type without enumerating them.
 *
 * Priority is moderate (5) — high enough to win over the default
 * inspector's wildcard, low enough that any type-specific history
 * viewer can override.
 */
export const historyViewerPlugin: StudioPlugin = {
  manifest: defineStudioPlugin({
    id: 'objectstack.history',
    name: 'History Timeline',
    description: 'Audit timeline of sys_metadata_history events for any metadata item',
    contributes: {
      metadataViewers: [{
        id: 'history-timeline',
        metadataTypes: ['*'],
        label: 'History',
        priority: 5,
        modes: ['history'],
      }],
    },
  }),
  activate(api) {
    api.registerViewer('history-timeline', HistoryViewerComponent);
  },
};
