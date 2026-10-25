// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AuditPanel — ADR-0010 §3.6 / Phase 4.1 protection-audit trail.
 *
 * Renders the rows in `sys_metadata_audit` for a single metadata
 * item (type + name): every save/publish/rollback/delete/reset
 * attempt, with the lock state at the moment of the call and the
 * decision (`allowed` / `denied` / `forced`). This is the compliance
 * surface promised by the metadata-protection ADR — denied attempts
 * never reach the regular history log, so this is the only place
 * where blocked writes are visible.
 *
 * Data source: `client.audit(type, name)` →
 *   `GET /api/v1/meta/:type/:name/audit`.
 *
 * Empty state is friendly: a fresh install has no rows because the
 * audit writer only fires on actual write attempts, so "no events"
 * just means nobody has tried to change this item.
 */

import * as React from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import { RefreshCw, Loader2, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { Button } from '@object-ui/components';
import { Badge } from '@object-ui/components';
import { Empty, EmptyTitle, EmptyDescription, EmptyValue } from '@object-ui/components';
import type {
  MetadataClient,
  MetadataAuditEntry,
} from '@object-ui/data-objectstack';
import { t, translateConsoleValue, type SupportedLocale } from './i18n.js';
import { type LoadState, loadErrorMessage } from './loadState.js';

export interface AuditPanelProps {
  type: string;
  name: string;
  client: MetadataClient;
  locale?: SupportedLocale | string;
}

/**
 * `displayLocale` is the session's DISPLAY locale (`useDisplayLocale()`), not
 * this panel's `locale` prop: that prop picks the metadata-admin UI strings
 * and defaults to `'en-US'`, a hard-coded tag. The bare `toLocaleString()`
 * this replaced used the MACHINE's locale (objectui#9909).
 */
function fmtTime(iso: string, displayLocale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(displayLocale);
}

function outcomeBadge(outcome: MetadataAuditEntry['outcome'], locale?: SupportedLocale | string) {
  const map: Record<MetadataAuditEntry['outcome'], {
    label: string;
    cls: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = {
    allowed: {
      label: 'allowed',
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      Icon: ShieldCheck,
    },
    denied: {
      label: 'denied',
      cls: 'bg-rose-50 text-rose-700 border-rose-200',
      Icon: ShieldX,
    },
    forced: {
      label: 'forced',
      cls: 'bg-amber-50 text-amber-700 border-amber-200',
      Icon: ShieldAlert,
    },
  };
  const v = map[outcome] ?? map.allowed;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${v.cls}`}
    >
      <v.Icon className="h-3 w-3" />
      {translateConsoleValue('outcome', v.label, locale)}
    </span>
  );
}

export function AuditPanel({
  type,
  name,
  client,
  locale = 'en-US',
}: AuditPanelProps) {
  const displayLocale = useDisplayLocale();
  /**
   * The audit read, as one four-arm `LoadState` (objectui#5169).
   *
   * It used to be `events: MetadataAuditEntry[] | null` + `error: string | null`
   * + `loading: boolean`, and the catch set the error **and** wrote
   * `setEvents([])`. Because the error did not gate the count or the empty
   * branch, a failed read rendered all three of these at once, contradicting
   * each other:
   *
   *   • the rose failure banner              — "the read failed"
   *   • the header count, `0 events`         — a measurement
   *   • "No audit events yet — no save, publish, rollback, delete or reset
   *     attempts have been recorded for this item."
   *
   * The last one is a positive claim about the record, and this is the surface
   * people read for compliance-shaped questions ("did anyone touch this?"), so
   * the false `0` is the part that matters. The union makes the count and the
   * empty state reachable **only** from `loaded`; the empty copy is deliberately
   * kept unchanged, because it is exactly right for a read that completed and
   * found nothing.
   */
  const [state, setState] = React.useState<LoadState<MetadataAuditEntry[]>>({
    status: 'idle',
  });
  /**
   * A request is in flight. NOT a fourth data state — it drives only the
   * Refresh button's spinner and disabled state, and it is deliberately
   * separate from `state` so a refresh over an already-loaded trail can keep
   * the rows on screen (the pre-existing behaviour, which spelled the same
   * intent as `loading && (!events || events.length === 0)`).
   */
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async () => {
    setRefreshing(true);
    // A refresh over loaded rows keeps them; a first read shows the spinner.
    setState((prev) => (prev.status === 'loaded' ? prev : { status: 'loading' }));
    try {
      const res = await client.audit(type, name, { limit: 100 });
      setState({ status: 'loaded', data: res.events ?? [] });
    } catch (err) {
      // NOT `{ status: 'loaded', data: [] }`. A read that did not complete is
      // not a measurement of zero events — that substitution is the defect.
      setState({ status: 'error', message: loadErrorMessage(err) });
    } finally {
      setRefreshing(false);
    }
  }, [client, type, name]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-1 pb-2">
        {/* A count is a measurement, so only a COMPLETED read may show one — a
            `0` over a failed read is the false zero this card is about. */}
        {state.status === 'loaded' ? (
          <div className="text-xs text-muted-foreground" data-testid="audit-count">
            {state.data.length} {t('engine.edit.auditCount', locale)}
          </div>
        ) : (
          <div />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={refreshing}
          className="h-7 gap-1 text-xs"
          title={t('engine.edit.refresh', locale)}
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {t('engine.edit.refresh', locale)}
        </Button>
      </div>

      {state.status === 'error' && (
        <div
          data-testid="audit-error"
          className="m-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
        >
          {state.message}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {state.status === 'idle' || state.status === 'loading' ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            {t('engine.edit.loading', locale)}
          </div>
        ) : state.status === 'error' ? (
          // The read did not complete. This says so and asserts NOTHING about
          // whether attempts were recorded — the honest answer when the question
          // was not answered. The banner above carries the cause; Refresh in the
          // header re-runs the same loader.
          <Empty className="py-10" data-testid="audit-error-state">
            <EmptyTitle>{t('engine.edit.auditErrorTitle', locale)}</EmptyTitle>
            <EmptyDescription>
              {t('engine.edit.auditErrorDescription', locale)}
            </EmptyDescription>
          </Empty>
        ) : state.data.length === 0 ? (
          // Reachable only from a COMPLETED read, which is the one case where
          // "no attempts have been recorded for this item" is true. Copy
          // deliberately unchanged.
          <Empty className="py-10" data-testid="audit-empty">
            <EmptyTitle>{t('engine.edit.auditEmptyTitle', locale)}</EmptyTitle>
            <EmptyDescription>
              {t('engine.edit.auditEmptyDescription', locale)}
            </EmptyDescription>
          </Empty>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">
                  {t('engine.edit.auditColTime', locale)}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t('engine.edit.auditColActor', locale)}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t('engine.edit.auditColOperation', locale)}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t('engine.edit.auditColOutcome', locale)}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t('engine.edit.auditColLock', locale)}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t('engine.edit.auditColNote', locale)}
                </th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((ev) => (
                <tr
                  key={String(ev.id)}
                  className="border-t border-border/50 align-top hover:bg-muted/20"
                >
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px]">
                    {fmtTime(ev.occurredAt, displayLocale)}
                  </td>
                  <td className="px-2 py-1.5">{ev.actor}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {translateConsoleValue('op', ev.operation, locale)}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5">{outcomeBadge(ev.outcome, locale)}</td>
                  <td className="px-2 py-1.5">
                    {ev.lockState && ev.lockState !== 'none' ? (
                      <span className="font-mono text-[11px]">
                        {translateConsoleValue('lock', ev.lockState, locale)}
                        {ev.lockOverridden ? ' *' : ''}
                      </span>
                    ) : (
                      <EmptyValue />
                    )}
                  </td>
                  <td
                    className="max-w-[28ch] truncate px-2 py-1.5 text-muted-foreground"
                    title={ev.note ?? ev.code}
                  >
                    {ev.note ?? ev.code}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
