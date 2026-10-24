/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * HistoryTimeline — read-only renderer for record audit history.
 *
 * Design notes:
 * - Mirrors the patterns used by mainstream products (Salesforce / HubSpot /
 *   Jira / Linear / GitHub): avatar + display name + relative time, with
 *   per-field old → new diff when available. We never render a raw user UUID
 *   as the actor label.
 * - Three actor faces (objectui#12527): a resolved `user_name` names the
 *   person; an entry that carries NEITHER a name NOR a `user_id` is a system
 *   write (seed backfills, hooks with no user in context) and reads "System"
 *   (`detail.systemActor`, the label `record:activity` already uses) with a
 *   cog glyph; an entry whose `user_id` could not be resolved to a name (a
 *   deleted or unreadable user) is the only unknown, and reads "Unknown user"
 *   (or `unknownUserText`) with a "?" avatar.
 * - Never re-fetches data on its own; relies on the caller to resolve
 *   `user_name` / `user_avatar` from `user_id` and to provide a pre-computed
 *   `changes` diff so this component stays presentation-only and SSR-safe.
 */
import * as React from 'react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@object-ui/components';
import { useDisplayLocale, useSafeTranslate } from '@object-ui/i18n';
import { Cog } from 'lucide-react';
import { hasCellValue } from './emptiness';

export interface HistoryChange {
  /** Raw field name from the schema (e.g. "industry"). */
  field: string;
  /** Optional human-readable field label (e.g. "Industry"). */
  label?: string;
  from?: unknown;
  to?: unknown;
}

export interface HistoryEntry {
  id?: string | number;
  created_at?: string | number | Date;
  action?: string;
  user_id?: string | number | null;
  user_name?: string | null;
  user_avatar?: string | null;
  summary?: string | null;
  /** Optional pre-computed field-level diff. */
  changes?: HistoryChange[];
  [extra: string]: unknown;
}

export interface HistoryTimelineProps {
  entries: HistoryEntry[];
  loading?: boolean;
  emptyText?: string;
  /**
   * Localized label for an entry whose `user_id` resolved to no name.
   * Defaults to "Unknown user". An entry with no `user_id` at all is a system
   * write and reads `detail.systemActor` instead (objectui#12527).
   */
  unknownUserText?: string;
  className?: string;
  /**
   * BCP-47 tag used for both the relative and the absolute time face.
   *
   * ⚠️ Defaults to `useDisplayLocale()` — the tenant's regional default, then
   * the active UI language, then `'en'` — and ⛔ NOT to the browser's own
   * locale, which is the machine's and neither of those two channels
   * (objectui#9786). Pass this only to OVERRIDE that composition.
   */
  locale?: string;
}

// Kept keys mirror the server-declared `sys_audit_log.action` enum
// (packages/plugins/plugin-audit/src/objects/sys-audit-log.object.ts in
// objectstack): 'permission_change', 'export', and 'restore' were retired
// because no writer anywhere in the platform ever produces them (audit
// surface principle: narrow-but-honest over broad-but-lying — objectui#4476).
// 'import' stays: it has a real writer (plugin-auth's admin-import-users.ts)
// and the server enum + the config_changes list view both still use it.
const ACTION_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  create: 'default',
  update: 'secondary',
  delete: 'destructive',
  login: 'outline',
  logout: 'outline',
  config_change: 'secondary',
  import: 'outline',
};

function formatAbsolute(value: HistoryEntry['created_at'], locale: string): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  // The tag is DECLARED (objectui#9786) — a bare call reads the machine's locale.
  return d.toLocaleString(locale);
}

const RELATIVE_THRESHOLDS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [4.34524, 'week'],
  [12, 'month'],
  [Number.POSITIVE_INFINITY, 'year'],
];

function formatRelative(value: HistoryEntry['created_at'], locale: string): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  // Negative: in the past. Recharts/Intl convention: -5 minutes = "5 minutes ago".
  let delta = (d.getTime() - Date.now()) / 1000;
  for (const [divisor, unit] of RELATIVE_THRESHOLDS) {
    if (Math.abs(delta) < divisor) {
      try {
        return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
          Math.round(delta),
          unit,
        );
      } catch {
        return formatAbsolute(value, locale);
      }
    }
    delta /= divisor;
  }
  return formatAbsolute(value, locale);
}

function initialsFromName(name?: string | null): string {
  if (!name) return '?';
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return '?';
  return parts
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

/**
 * An audit value as the timeline shows it, or the `'—'` that means "nothing".
 *
 * Emptiness is the record page's ONE definition (`./emptiness`,
 * objectui#8376/#8394), not a raw test: a whitespace-only stored value used to
 * fall through to the `typeof value === 'string'` branch below and print its
 * spaces, so the cell the timeline means to read as "nothing" rendered blank
 * instead of the em-dash. Objects are still values here for the same reason
 * they are in a cell — the `JSON.stringify` branch below draws them.
 */
function formatDiffValue(value: unknown): string {
  if (!hasCellValue(value)) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function HistoryTimeline({
  entries,
  loading,
  emptyText,
  unknownUserText,
  className,
  locale,
}: HistoryTimelineProps) {
  // The composed tag this timeline formats with when the caller states none.
  // Read before the early returns below so the hook order never varies.
  const displayLocale = useDisplayLocale();
  const resolvedLocale = locale ?? displayLocale;
  const tt = useSafeTranslate();
  const systemActorText = tt('detail.systemActor', 'System');
  if (loading) {
    return (
      <div className={cn('space-y-3', className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md border border-dashed py-10 text-sm text-muted-foreground',
          className,
        )}
      >
        {emptyText ?? 'No history yet'}
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <ol className={cn('space-y-4', className)}>
        {entries.map((entry, idx) => {
          const action = (entry.action ?? '').toLowerCase();
          const variant = ACTION_VARIANT[action] ?? 'outline';
          const resolvedName =
            (typeof entry.user_name === 'string' && entry.user_name.trim()) || '';
          // No name AND no id: nobody acted, so this is a system write, not
          // an unknown person (objectui#12527).
          const isSystemActor =
            !resolvedName && (entry.user_id == null || entry.user_id === '');
          const displayName =
            resolvedName ||
            (isSystemActor ? systemActorText : unknownUserText || 'Unknown user');
          const absoluteWhen = formatAbsolute(entry.created_at, resolvedLocale);
          const relativeWhen = formatRelative(entry.created_at, resolvedLocale);
          const avatarUrl = typeof entry.user_avatar === 'string' ? entry.user_avatar : undefined;
          return (
            <li key={(entry.id as React.Key) ?? idx} className="flex items-start gap-3">
              <Avatar className="h-8 w-8 mt-0.5 shrink-0">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
                <AvatarFallback className="text-[10px] font-medium">
                  {isSystemActor ? (
                    <Cog
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                      data-testid="history-system-actor-glyph"
                    />
                  ) : (
                    initialsFromName(entry.user_name)
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-foreground">{displayName}</span>
                  {entry.action && (
                    <Badge variant={variant} className="text-[10px] uppercase tracking-wide">
                      {entry.action}
                    </Badge>
                  )}
                  {absoluteWhen && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="text-xs text-muted-foreground cursor-help"
                          aria-label={absoluteWhen}
                        >
                          {relativeWhen || absoluteWhen}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{absoluteWhen}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                {entry.summary && (
                  <p className="mt-1 text-sm text-muted-foreground">{entry.summary}</p>
                )}
                {entry.changes && entry.changes.length > 0 && (
                  action === 'create' ? (
                    <details className="mt-1 group">
                      <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 select-none">
                        <span className="transition-transform group-open:rotate-90">▸</span>
                        <span>
                          {entry.changes.length === 1
                            ? '1 field populated'
                            : `${entry.changes.length} fields populated`}
                        </span>
                      </summary>
                      <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground pl-4">
                        {entry.changes.map((c) => (
                          <li key={c.field} className="leading-relaxed">
                            <span className="font-medium text-foreground">{c.label || c.field}</span>
                            {': '}
                            <span className="text-foreground">{formatDiffValue(c.to)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      {entry.changes.map((c) => (
                        <li key={c.field} className="leading-relaxed">
                          <span className="font-medium text-foreground">{c.label || c.field}</span>
                          {': '}
                          <span className="line-through opacity-70">{formatDiffValue(c.from)}</span>
                          {' → '}
                          <span className="text-foreground">{formatDiffValue(c.to)}</span>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </TooltipProvider>
  );
}
