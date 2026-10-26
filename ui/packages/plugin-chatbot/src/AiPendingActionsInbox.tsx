/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * AiPendingActionsInbox — workspace UI for the AI HITL approval queue.
 *
 * Wires `usePendingActions` to a Card/Table layout with an in-place
 * detail drawer and approve / reject buttons. Designed to drop into both
 * Console (`system/ai/pending-actions`) and Studio (assistant builder
 * traces panel) without further glue — pass `apiBase` + `headers` and you
 * get the whole flow.
 *
 * Stays inside `@object-ui/plugin-chatbot` so the AI bundle (already
 * loaded when a chatbot mounts) holds the inbox too. No extra route-
 * level code-split needed.
 *
 * @module
 */

import * as React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Skeleton,
  Alert,
  AlertDescription,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  Label,
  Empty,
  EmptyTitle,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyValue,
} from '@object-ui/components';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Inbox,
  Eye,
  Clock,
  Bot,
} from 'lucide-react';
import { useDisplayLocale } from '@object-ui/i18n';
import {
  useAiApprovalsTranslation,
  type InboxTranslate,
} from './useAiApprovalsTranslation';
import {
  usePendingActions,
  type PendingActionRow,
  type PendingActionStatus,
  type UsePendingActionsOptions,
} from './usePendingActions';

export interface AiPendingActionsInboxProps {
  /**
   * AI service base URL, e.g. `http://localhost:3004/api/v1/ai`.
   * Defaults to same-origin `/api/v1/ai`.
   */
  apiBase?: string;
  /** Extra headers (`X-Environment-Id`, `Authorization`, ...). */
  headers?: Record<string, string>;
  /** Polling interval in ms. Default 5000; pass 0 to disable. */
  pollInterval?: number;
  /**
   * Forwarded to the AI service as `?conversationId=` — useful for
   * scoping the inbox to a single chat thread.
   */
  conversationId?: string;
  /** Visual style. `card` (default) wraps in a Card; `bare` renders without. */
  variant?: 'card' | 'bare';
  /**
   * Optional title shown in the card header. Defaults to the locale pack's
   * `aiApprovals.title` — a lookup, so it cannot be a default parameter value.
   */
  title?: string;
  /**
   * Optional description shown in the card header. Defaults to the locale
   * pack's `aiApprovals.description`; pass `''` to hide it.
   */
  description?: string;
  /** Class name applied to the outer wrapper. */
  className?: string;
}

type TabKey = 'pending' | 'decided' | 'all';


const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending:  'secondary',
  approved: 'default',
  executed: 'default',
  failed:   'destructive',
  rejected: 'outline',
};

/**
 * The badge label for a lifecycle status.
 *
 * A `switch` over LITERAL keys, not `t(STATUS_BADGE[status].labelKey)` — the
 * lesson objectui#7149 paid for: a key visible only as a map VALUE has no call
 * site the i18n scanners can resolve, so it reads as unreferenced to
 * `check:i18n-keys` and `check:i18n-dead-keys` alike. Measured on this very
 * change: with the keys held in a map, the dead-key sweep listed
 * `aiApprovals.statusPending` and `aiApprovals.statusApproved` as
 * needs-review — the two whose only appearance was that map — while the three
 * that also had a literal call site elsewhere were seen. The variant table
 * above stays a map because a Badge variant is not copy.
 *
 * `null` for an unrecognised status: that is DATA, whatever the service sent,
 * and the caller renders it verbatim rather than through `t`, which would hand
 * the same string back as a missing key.
 */
function statusLabel(status: string, t: InboxTranslate): string | null {
  switch (status) {
    case 'pending':  return t('aiApprovals.statusPending');
    case 'approved': return t('aiApprovals.statusApproved');
    case 'executed': return t('aiApprovals.statusExecuted');
    case 'failed':   return t('aiApprovals.statusFailed');
    case 'rejected': return t('aiApprovals.statusRejected');
    default:         return null;
  }
}

function StatusBadge({ status, t }: { status: string; t: InboxTranslate }) {
  const label = statusLabel(status, t);
  if (label === null) return <Badge variant="outline">{status}</Badge>;
  return <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{label}</Badge>;
}

/**
 * Relative "time since proposed" for a row.
 *
 * ⛔ The arithmetic is deliberately UNCHANGED (objectui#7173): `Math.round`
 * (not floor), thresholds 45s / 60min / 24h / 30d (not 60s / 7d), and a
 * `toLocaleDateString()` tail. Four sibling helpers in `plugin-detail` round and
 * break differently; unifying them is a behaviour change that needs its own
 * card, so this translates the OUTPUT where it stands.
 *
 * Past 30 days the value is a DATE, not a relative phrase, so there is no
 * literal there to key — but it is formatted in the DISPLAY locale the caller
 * threads, never with a bare `toLocaleDateString`: the tail used to pass no
 * tag, which is the MACHINE's locale, so the 30-day-old row read its date in
 * neither of the repo's locale channels (objectui#9909). `plugin-detail`'s
 * sibling tails were repaired the same way by objectui#9786.
 */
function formatRelative(s: string | null | undefined, t: InboxTranslate, locale: string): string {
  if (!s) return '—';
  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) return s;
  const diffMs = Date.now() - parsed;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return t('detail.justNow');
  const min = Math.round(sec / 60);
  if (min < 60) return t('detail.minutesAgo', { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('detail.hoursAgo', { count: hr });
  const day = Math.round(hr / 24);
  if (day < 30) return t('detail.daysAgo', { count: day });
  try { return new Date(s).toLocaleDateString(locale); } catch { return s; }
}

function safeParseJson(input: string | null | undefined): unknown {
  if (!input) return null;
  try { return JSON.parse(input); } catch { return input; }
}

function JsonBlock({ value, max = 320 }: { value: unknown; max?: number }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text == null || text === '') return <EmptyValue className="text-xs" />;
  return (
    <pre
      className="bg-muted/40 rounded text-xs p-2 overflow-auto whitespace-pre-wrap break-all"
      style={{ maxHeight: max }}
    >{text}</pre>
  );
}

function statusesForTab(tab: TabKey): PendingActionStatus | 'all' {
  switch (tab) {
    case 'pending': return 'pending';
    case 'all':     return 'all';
    case 'decided': return 'all'; // filtered client-side below
  }
}

/**
 * Render the AI HITL inbox. Polls the framework's pending-actions queue,
 * renders rows in a table, and exposes Approve / Reject buttons plus a
 * detail drawer with raw `tool_input` / result / error.
 */
export function AiPendingActionsInbox({
  apiBase,
  headers,
  pollInterval = 5000,
  conversationId,
  variant = 'card',
  title,
  description,
  className,
}: AiPendingActionsInboxProps) {
  const { t } = useAiApprovalsTranslation();
  const displayLocale = useDisplayLocale();
  // `??`, not `||`: an explicit `description=''` still hides the line, which is
  // what the literal default used to allow.
  const resolvedTitle = title ?? t('aiApprovals.title');
  const resolvedDescription = description ?? t('aiApprovals.description');
  const [tab, setTab] = React.useState<TabKey>('pending');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [rejectFor, setRejectFor] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = React.useState<{ id: string; kind: 'approve' | 'reject'; ok: boolean; message?: string } | null>(null);

  const hookOptions: UsePendingActionsOptions = {
    apiBase,
    headers,
    pollInterval,
    conversationId,
    status: statusesForTab(tab),
  };

  const { items, isLoading, error, refresh, approve, reject } = usePendingActions(hookOptions);

  const rows = React.useMemo(() => {
    if (tab !== 'decided') return items;
    return items.filter(r => r.status !== 'pending');
  }, [items, tab]);

  const selected = React.useMemo<PendingActionRow | null>(
    () => (openId ? items.find(r => r.id === openId) ?? null : null),
    [openId, items],
  );

  const handleApprove = React.useCallback(async (id: string) => {
    setBusyId(id);
    setMutationError(null);
    try {
      const out = await approve(id);
      const ok = out.status === 'executed';
      setLastOutcome({
        id,
        kind: 'approve',
        ok,
        // `out.error` is a server-authored string — data, passed through as-is.
        message: ok
          ? t('aiApprovals.statusExecuted')
          : (out.error ?? t('aiApprovals.outcomeExecuteFailed')),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMutationError(msg);
      setLastOutcome({ id, kind: 'approve', ok: false, message: msg });
    } finally {
      setBusyId(null);
    }
  }, [approve, t]);

  const handleReject = React.useCallback(async (id: string, reason: string) => {
    setBusyId(id);
    setMutationError(null);
    try {
      await reject(id, reason.trim() || undefined);
      setLastOutcome({ id, kind: 'reject', ok: true, message: t('aiApprovals.statusRejected') });
      setRejectFor(null);
      setRejectReason('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMutationError(msg);
      setLastOutcome({ id, kind: 'reject', ok: false, message: msg });
    } finally {
      setBusyId(null);
    }
  }, [reject, t]);

  const body = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="pending">{t('aiApprovals.tabPending')}</TabsTrigger>
            <TabsTrigger value="decided">{t('aiApprovals.tabDecided')}</TabsTrigger>
            <TabsTrigger value="all">{t('aiApprovals.tabAll')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={isLoading}
          data-testid="ai-inbox-refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      {mutationError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      ) : null}

      {lastOutcome && !mutationError ? (
        <Alert variant={lastOutcome.ok ? 'default' : 'destructive'}>
          {lastOutcome.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          <AlertDescription>
            {/*
              One key with `{{id}}` and `{{message}}` holes, not an English
              sentence assembled from fragments around a `<code>` element: word
              order differs per locale, so the fragments could not be reordered.
              The id keeps its truncation; it loses the monospace styling, which
              is the deliberate cost of making the sentence translatable.
            */}
            {t(
              lastOutcome.kind === 'approve'
                ? 'aiApprovals.outcomeApprove'
                : 'aiApprovals.outcomeReject',
              {
                id: `${lastOutcome.id.slice(0, 8)}…`,
                message:
                  lastOutcome.message ??
                  (lastOutcome.ok ? t('common.ok') : t('aiApprovals.statusFailed')),
              },
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {/*
        The empty state is an ANSWER ("nothing is waiting"), so it is shown
        only when the read answered (objectui#11736). If the read failed, the
        error alert above is the whole story. On a deployment with no AI
        service, an empty queue under the 501 alert read as a live approval
        queue that happened to be empty, which is a queue the deployment does
        not have.
      */}
      {isLoading && rows.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows.length === 0 && error ? null : rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <Inbox className="h-8 w-8 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>{t('aiApprovals.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('aiApprovals.emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">{t('aiApprovals.colTool')}</TableHead>
                <TableHead className="w-[140px]">{t('aiApprovals.colAction')}</TableHead>
                <TableHead className="w-[120px]">{t('aiApprovals.colObject')}</TableHead>
                <TableHead className="w-[110px]">{t('aiApprovals.colStatus')}</TableHead>
                <TableHead className="w-[110px]">{t('aiApprovals.colProposed')}</TableHead>
                <TableHead className="w-[260px] text-right">{t('aiApprovals.colDecision')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isPending = row.status === 'pending';
                const isBusy = busyId === row.id;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.tool_name}</TableCell>
                    <TableCell className="text-sm">{row.action_name}</TableCell>
                    <TableCell className="text-sm">{row.object_name}</TableCell>
                    <TableCell><StatusBadge status={row.status} t={t} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {formatRelative(row.proposed_at, t, displayLocale)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenId(row.id)}
                          data-testid={`ai-inbox-view-${row.id}`}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" /> {t('aiApprovals.view')}
                        </Button>
                        {isPending ? (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              disabled={isBusy}
                              onClick={() => void handleApprove(row.id)}
                              data-testid={`ai-inbox-approve-${row.id}`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              {isBusy ? t('aiApprovals.working') : t('aiApprovals.approve')}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={isBusy}
                              onClick={() => { setRejectFor(row.id); setRejectReason(''); }}
                              data-testid={`ai-inbox-reject-${row.id}`}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              {t('aiApprovals.reject')}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );

  const wrapped = variant === 'card' ? (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4" /> {resolvedTitle}
        </CardTitle>
        {resolvedDescription ? <CardDescription>{resolvedDescription}</CardDescription> : null}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  ) : (
    <div className={className}>{body}</div>
  );

  return (
    <>
      {wrapped}

      {/* Detail drawer */}
      <Sheet open={!!openId} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent className="sm:max-w-[560px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              {selected ? selected.action_name : t('aiApprovals.drawerFallbackTitle')}
            </SheetTitle>
            <SheetDescription>
              {/*
                One key with `{{tool}}` and `{{object}}` holes rather than an
                English sentence assembled around two `<code>` elements — the
                two nouns swap order in several locales, which fragments cannot
                express. The identifiers lose their monospace styling; that is
                the deliberate cost of making the sentence translatable.
              */}
              {selected
                ? t('aiApprovals.drawerSubtitle', {
                    tool: selected.tool_name,
                    object: selected.object_name,
                  })
                : t('common.loading')}
            </SheetDescription>
          </SheetHeader>

          {selected ? (
            <div className="px-4 space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">{t('aiApprovals.colStatus')}</Label>
                  <div className="mt-1"><StatusBadge status={selected.status} t={t} /></div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('aiApprovals.colProposed')}</Label>
                  <div className="mt-1 text-xs">{formatRelative(selected.proposed_at, t, displayLocale)}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('aiApprovals.fieldProposedBy')}</Label>
                  <div className="mt-1 text-xs font-mono break-all">{selected.proposed_by ?? <EmptyValue />}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('aiApprovals.fieldDecidedBy')}</Label>
                  <div className="mt-1 text-xs font-mono break-all">{selected.decided_by ?? <EmptyValue />}</div>
                </div>
                {selected.conversation_id ? (
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">{t('aiApprovals.fieldConversation')}</Label>
                    <div className="mt-1 text-xs font-mono break-all">{selected.conversation_id}</div>
                  </div>
                ) : null}
              </div>

              <Separator />

              <div>
                <Label className="text-xs">{t('aiApprovals.fieldToolInput')}</Label>
                <div className="mt-1.5"><JsonBlock value={safeParseJson(selected.tool_input)} /></div>
              </div>

              {selected.result ? (
                <div>
                  <Label className="text-xs">{t('aiApprovals.fieldResult')}</Label>
                  <div className="mt-1.5"><JsonBlock value={safeParseJson(selected.result)} /></div>
                </div>
              ) : null}

              {selected.error ? (
                <div>
                  <Label className="text-xs text-destructive">{t('aiApprovals.fieldError')}</Label>
                  <div className="mt-1.5"><JsonBlock value={selected.error} /></div>
                </div>
              ) : null}

              {selected.rejection_reason ? (
                <div>
                  <Label className="text-xs">{t('aiApprovals.fieldRejectionReason')}</Label>
                  <div className="mt-1.5 text-sm">{selected.rejection_reason}</div>
                </div>
              ) : null}

              {selected.status === 'pending' ? (
                <div className="pt-2 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleApprove(selected.id)}
                    disabled={busyId === selected.id}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    {t('aiApprovals.approveAndExecute')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => { setRejectFor(selected.id); setRejectReason(''); }}
                    disabled={busyId === selected.id}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    {t('aiApprovals.reject')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Reject reason dialog (re-uses Sheet for portability) */}
      <Sheet open={!!rejectFor} onOpenChange={(o) => { if (!o) { setRejectFor(null); setRejectReason(''); } }}>
        <SheetContent side="bottom" className="max-h-[40vh]">
          <SheetHeader>
            <SheetTitle>{t('aiApprovals.rejectTitle')}</SheetTitle>
            <SheetDescription>{t('aiApprovals.rejectBody')}</SheetDescription>
          </SheetHeader>
          <div className="px-4 mt-3 space-y-3">
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('aiApprovals.rejectPlaceholder')}
              rows={4}
              data-testid="ai-inbox-reject-reason"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setRejectFor(null); setRejectReason(''); }}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => rejectFor && void handleReject(rejectFor, rejectReason)}
                disabled={!rejectFor || busyId === rejectFor}
                data-testid="ai-inbox-reject-confirm"
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                {t('aiApprovals.reject')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
