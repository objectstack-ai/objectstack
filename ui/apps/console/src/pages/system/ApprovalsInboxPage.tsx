/**
 * Approvals Inbox
 *
 * Front-end for `@objectstack/plugin-approvals` (M11.C15 / ADR-0019).
 *
 * Tabs:
 *   • My Pending      — requests where the signed-in user is in
 *                       `pending_approvers` (matched by id, email,
 *                       `position:<name>` for each assigned position, or
 *                       `role:<name>` for the better-auth role scalar —
 *                       see `buildApproverIdentities`).
 *   • Submitted by me — requests where `submitter_id` is the user.
 *   • All             — every request (any status).
 *
 * Business-first information architecture: rows lead with the flow's display
 * label and the target record's title (server-enriched `process_label` /
 * `record_title` / `submitter_name`), not machine names and opaque ids.
 *
 * Opening a request (a row, a mobile card, Enter, or the notification deep
 * link `?request=<id>`) navigates to the page objectstack serves for it,
 * `sys_approval_request_detail`, on the console's standard record route
 * (`RecordDetailView`, reading through `ApprovalRecordReads`). The inbox
 * draws no request view of its own: its side sheet was deleted when that
 * page carried every face the sheet's tests pinned (objectui#12484, ruling C
 * on objectui#12438).
 *
 * Keyboard: j/k move row focus · Enter opens · x toggles selection ·
 * a approves · r rejects (with confirm). Disabled while a dialog is open or
 * an input is focused.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConsolePageHeader } from '@object-ui/app-shell';
import {
  Button,
  Badge,
  Card,
  CardContent,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Skeleton,
  Empty,
  EmptyTitle,
  EmptyDescription,
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Input,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  HorizontalOverflowBox,
  PINNED_RIGHT_SEAM_SHADOW_CLASSES,
} from '@object-ui/components';
import { toast } from 'sonner';
import { useAuth } from '@object-ui/auth';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { isSystemManagedField } from '@object-ui/types';
import { APPROVAL_STATUS_LABELS } from '@objectstack/spec/contracts';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  CheckSquare,
  Search,
  ArrowUpDown,
  X,
  ExternalLink,
  User as UserIcon,
  Workflow,
  Trash2,
  Link2Off,
} from 'lucide-react';
import {
  approvalsApi,
  buildApproverIdentities,
  type ApprovalRequestRow,
} from '../../services/approvalsApi';
import { APPROVAL_REQUEST_OBJECT } from '../../services/approvalRequestsDataSource';
import { useRecordReadability } from './recordReadability';
import { isDeletedRecordReference, useDeadRecordReferenceLabel } from './deadRecordReference';
import {
  isUnresolvableRecordReference,
  useUnresolvableRecordReferenceLabel,
} from './unresolvableRecordReference';
import { useHiddenFieldsByObject } from './hiddenFields';

type TabKey = 'pending' | 'submitted' | 'all';

/** Server page size for the paginated tabs (submitted / all). */
const PAGE_SIZE = 50;

/**
 * Semantic status colors (green = approved, amber = waiting, red = rejected,
 * slate = recalled, violet = returned for revision) — variant-based Badge
 * colors read as monochrome chrome, not as state.
 */
const STATUS_CLASSES: Record<string, string> = {
  pending:  'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400',
  rejected: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400',
  recalled: 'border-border bg-muted text-muted-foreground',
  returned: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400',
  // objectstack#13568's terminal state: the platform voided the request, nobody
  // decided it. Muted like `recalled` — the other exit that records no decision.
  cancelled: 'border-border bg-muted text-muted-foreground',
};

/**
 * Status chip. Module scope on purpose: declared inside `ApprovalsInboxPage`
 * it was a brand-new component type on every render, so React unmounted and
 * remounted every badge in the table each time the page re-rendered
 * (`react-hooks/static-components`). The translated label is passed in
 * because `statusLabel` closes over the page's `t`.
 */
function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium', STATUS_CLASSES[status] ?? '')}>
      {label}
    </Badge>
  );
}

/**
 * The tombstone that replaces a dead record reference (objectui#7108).
 *
 * Module scope for the same reason `StatusBadge` is, and the label is a prop
 * for the same reason its label is: the copy is resolved once by the page from
 * the platform's own `cancel_reason` option label (see `deadRecordReference`),
 * never authored here.
 *
 * It renders the tombstone TEXT, not merely the absence of a link: a row that
 * silently drops its record reference is worse than the bare id it replaces,
 * because the approver loses the fact that an approval exists at all.
 */
function DeadRecordReference({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 text-muted-foreground min-w-0', className)} title={label}>
      <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate italic">{label}</span>
    </div>
  );
}

/**
 * The cause-free affordance for a reference that neither resolves nor carries a
 * snapshot title (objectui#8631) — never the opaque record id it replaces.
 *
 * ⛔ Visually distinct from the tombstone above ON PURPOSE, in the direction
 * that claims LESS: a broken-link glyph rather than a wastebasket, because this
 * row carries no server assertion that anything was deleted. The same reason
 * governs the copy, which is resolved once by the page — see
 * `unresolvableRecordReference` for why this one string is console-authored
 * while the tombstone's deliberately is not.
 *
 * Like the tombstone it renders TEXT rather than an absence: a row that drops
 * its reference silently costs the approver the fact that an approval exists.
 */
function UnresolvableRecordReference({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 text-muted-foreground min-w-0', className)} title={label}>
      <Link2Off className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate italic">{label}</span>
    </div>
  );
}

/**
 * The page's date helpers take the session's DISPLAY locale as a REQUIRED
 * argument (`useDisplayLocale()` in the components below). Every one of them
 * used to format with no tag, i.e. in the MACHINE's locale (objectui#9909);
 * their `catch` arms are for an unparseable value, not for a tag `Intl`
 * rejected, so the bare call was the primary leg rather than a fallback.
 */
function formatDate(s: string | null | undefined, locale: string): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(locale); } catch { return s; }
}

/** The approver prefix whose value is a position's machine NAME (ADR-0090 D3). */
const POSITION_REF_PREFIX = 'position:';

/**
 * Render an actor identifier in a friendly form.
 *  - emails → shown as-is
 *  - `role:<name>` → shown as "Role: name"
 *  - `position:<name>` → the prettified position name
 *  - opaque 16+ char IDs → truncated middle (e.g. `5aF9BX3J…wTk`)
 *
 * The position arm is finding C-18 of the HotCRM browser pass: a position
 * reference carries a machine NAME, not an opaque id, yet the truncation arm
 * below cut `position:sales_manager` to `positi…ager`. A name has prose to
 * recover, so it is never truncated.
 */
function formatIdentity(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.includes('@')) return id;
  if (id.startsWith('role:')) return `Role: ${id.slice(5)}`;
  if (id.startsWith(POSITION_REF_PREFIX) && id.length > POSITION_REF_PREFIX.length) {
    return prettifyMachineName(id.slice(POSITION_REF_PREFIX.length));
  }
  if (id.length > 14) return `${id.slice(0, 6)}…${id.slice(-4)}`;
  return id;
}

/** `manager_review` → "Manager Review" (display fallback for legacy rows). */
function prettifyMachineName(raw: string | null | undefined): string {
  if (!raw) return '—';
  const base = String(raw).replace(/^flow:/, '').trim();
  return base.split(/[_\-\s]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || '—';
}

function processLabel(r: ApprovalRequestRow): string {
  return r.process_label || prettifyMachineName(r.process_name);
}
function stepLabel(r: ApprovalRequestRow): string | null {
  if (r.step_label) return r.step_label;
  return r.current_step ? prettifyMachineName(r.current_step) : null;
}
function submitterDisplay(r: ApprovalRequestRow): string {
  return r.submitter_name || formatIdentity(r.submitter_id);
}
/**
 * A request with no human submitter — flow- or system-initiated (#2762 P1-4).
 * These rows have an empty `submitter_id` or a synthetic `flow:` / `system:`
 * actor, and rendering a bare person icon + "—" reads as missing data.
 */
function isSystemSubmitter(r: ApprovalRequestRow): boolean {
  if (r.submitter_name) return false;
  const id = (r.submitter_id || '').trim();
  return !id || id.startsWith('flow:') || id.startsWith('system:');
}
/** Object subtitle: schema label when resolved, else the machine name. */
function objectDisplay(r: ApprovalRequestRow): string {
  return r.object_label || r.object_name;
}
function submittedAt(r: ApprovalRequestRow): string | undefined {
  return r.submitted_at || r.created_at || undefined;
}

/**
 * Hours a pending request has been waiting at instant `now`; null when no
 * timestamp. `now` is a parameter rather than a `Date.now()` read so callers
 * on the render path stay pure (`react-hooks/purity`) — see the `now` state in
 * {@link ApprovalsInboxPage}.
 */
function waitingHours(r: ApprovalRequestRow, now: number): number | null {
  const s = submittedAt(r);
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return (now - t) / 36e5;
}

/** Aging tint: quiet under a day, amber 1–3 days, red beyond 3 days. */
function agingClass(r: ApprovalRequestRow, now: number): string {
  if (r.status !== 'pending') return 'text-muted-foreground';
  const h = waitingHours(r, now);
  if (h == null) return 'text-muted-foreground';
  if (h > 72) return 'text-red-600 dark:text-red-400 font-medium';
  if (h > 24) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

/** Compact duration for SLA chips: "36h" under 2 days, else "3d". */
function compactDuration(ms: number): string {
  const h = Math.max(1, Math.round(Math.abs(ms) / 36e5));
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/**
 * SLA position at instant `now`, or null when there is nothing to show — no
 * due date, or one the backend sent in a shape `Date.parse` can't read (which
 * previously rendered as "SLA NaNh left"). Takes `now` for the same purity
 * reason as {@link waitingHours}.
 */
function slaState(dueAt: string | null | undefined, now: number): { overdue: boolean; ms: number } | null {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return null;
  return { overdue: due < now, ms: Math.abs(now - due) };
}

/**
 * Whether a snapshot key is a framework-managed column rather than a business
 * field of the record — `@object-ui/types`' `isSystemManagedField`, the one
 * classifier the default list columns, record pickers and related lists use
 * to keep bookkeeping out of business surfaces. The queue reads the snapshot
 * without the object's field declarations, so it judges by name: the
 * classifier's name list, which includes `owner_id`, the injected ownership
 * column (objectui#11677).
 */
function isBookkeepingKey(key: string): boolean {
  return isSystemManagedField(key);
}

function prettifyKey(k: string): string {
  const tokens = k.split('_').filter(Boolean);
  // Drop a trailing `id` token so a resolved lookup key reads as its subject —
  // `owner_id` → "Owner", not the awkward "Owner Id" (#2762 P2). Keep at least
  // one token (a bare `id` is already dropped as a system key upstream).
  if (tokens.length > 1 && tokens[tokens.length - 1].toLowerCase() === 'id') tokens.pop();
  return tokens.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Amount-like keys worth surfacing in the queue so a reviewer can triage
 * without opening each request (#2762 P1-3). Deliberately narrow — a decision
 * turns on the amount/total/budget, not on every numeric field.
 */
const AMOUNT_KEY_RE = /(amount|total|price|value|cost|sum|budget|salary|fee|revenue|balance|金额|总额|价格|费用|预算|金额)/i;

/**
 * The one decision-relevant numeric field (amount/total/…) of the snapshot,
 * for the inline list display and amount sort. Prefers the server-formatted
 * `payload_display` value (currency, etc.) but always keeps the raw number for
 * ordering. Null when the snapshot has no such field.
 *
 * `hiddenKeys` is the fields THIS request's object declares `hidden: true`, and
 * it is **required** on purpose (objectui#6020). It was optional when
 * objectui#5565 added it, and four of the five call sites simply did not pass
 * it — a filter that lives in the function body but is unpassed at the call
 * site reads exactly like a fixed defect. Required, the compiler asks the one
 * question that matters at every present and future call site: *whose* hidden
 * keys?
 *
 * An empty set means "nothing known to be hidden" — including the case where
 * the metadata read has not answered — and yields today's amount. See
 * `hiddenFields.ts` on why this presentation filter fails open.
 *
 * The first key whose NAME matches {@link AMOUNT_KEY_RE} and whose value is not
 * zero leads (objectui#12110 item 6). A name match is a guess about what the
 * key means, and a zero from a guessed key (HotCRM's `child_account_revenue`
 * roll-up, finding C-18 of the HotCRM browser pass) is not the request's
 * amount, so it never leads.
 */
function decisionAmountEntry(
  r: ApprovalRequestRow,
  hiddenKeys: ReadonlySet<string>,
  locale: string,
): { key: string; label: string; value: number; display: string } | null {
  const payload = r.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (isBookkeepingKey(k)) continue;
    if (hiddenKeys.has(k)) continue; // author declared `hidden: true` (#5565)
    if (!AMOUNT_KEY_RE.test(k)) continue;
    const num = typeof v === 'number'
      ? v
      : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    if (num == null || !Number.isFinite(num) || num === 0) continue;
    return {
      key: k,
      label: r.payload_labels?.[k] ?? prettifyKey(k),
      value: num,
      display: r.payload_display?.[k] ?? num.toLocaleString(locale),
    };
  }
  return null;
}

/** The page's scoped translator, as the row cells receive it. */
type Translate = (key: string, defaultValue: string, opts?: Record<string, unknown>) => string;

/*
 * ── Shared row fragments ──────────────────────────────────────────────────
 *
 * Module scope on purpose, for the same reason `StatusBadge` above sits here
 * (objectui#5348). Declared inside `ApprovalsInboxPage` these were a brand-new
 * component *type* on every render, so React unmounted and remounted every
 * row's cells instead of updating them — on a page that re-renders on a 60s
 * clock whether or not anyone is touching it. Two consequences were measured:
 * transient subtree state (focus, hover) was discarded on each tick, and a
 * click whose pointer sequence spanned a re-render was delivered to a
 * detached node and silently swallowed (objectui#5211 hit this and worked
 * around it at the call site).
 *
 * Everything they used to close over is passed in. Do not move them back, and
 * do not add a fourth cell inside the page body:
 * `ApprovalsInboxPage.cellIdentity.test.tsx` pins the DOM-node identity of all
 * three across a clock tick, so a reintroduction fails there. It will NOT fail
 * lint — `react-hooks/static-components` is `error` in this repo but its
 * analysis bails out on this component (measured: an arrow-form inner
 * component injected here and used in JSX produces zero reports).
 */

function RequestCell({ r, tr }: { r: ApprovalRequestRow; tr: Translate }) {
  return (
    <div className="min-w-0">
      <div className="font-medium truncate">{processLabel(r)}</div>
      <div className="text-xs text-muted-foreground truncate">
        {stepLabel(r) || '—'}
        {(r.round ?? 1) > 1 && (
          <span className="ml-1.5 text-violet-600 dark:text-violet-400">
            {tr('roundChip', 'Round {{n}}', { n: r.round })}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * `href` is `null` for a record this viewer cannot open (objectui#5211) — the
 * readable/unreadable decision and the URL are ONE prop so the two cannot be
 * handed in disagreeing with each other.
 *
 * `hiddenKeys` belongs to THIS row's object (objectui#6020). The queue spans
 * many objects, so it is a per-row prop and not something this cell could
 * resolve for itself — see the page body, which drives it off one lookup.
 */
function RecordCell({ r, href, hiddenKeys, deadLabel, unresolvableLabel }: {
  r: ApprovalRequestRow;
  href: string | null;
  hiddenKeys: ReadonlySet<string>;
  deadLabel: string | null;
  unresolvableLabel: string | null;
}) {
  const displayLocale = useDisplayLocale();
  // Surface the decision-relevant amount inline so a reviewer can triage the
  // queue without opening each request (#2762 P1-3) — minus anything the
  // author declared `hidden: true` (objectui#6020).
  const amount = decisionAmountEntry(r, hiddenKeys, displayLocale);
  // objectui#5211: no link into a record this viewer cannot open. The title
  // still shows — it comes from the request's own payload snapshot, which the
  // approver was already given — it just stops being an anchor.
  const title = r.record_title || formatIdentity(r.record_id);
  return (
    <div className="min-w-0">
      {/* objectui#7108: the record is GONE (the platform said so), so the
          reference slot becomes the tombstone rather than degrading to the
          bare record id. The snapshot's business identifier is not lost —
          it moves to the meta line below, where it stays readable as history
          without pretending to address anything. */}
      {/* objectui#8631: no server assertion, no resolvable reference and no
          snapshot title — so the slot says the one true thing left (it cannot
          be opened) instead of degrading to the opaque id. ⛔ Ordered AFTER the
          tombstone: a row the platform DID flag keeps the platform's stronger
          sentence. */}
      {deadLabel !== null ? (
        <DeadRecordReference label={deadLabel} className="text-sm max-w-full" />
      ) : unresolvableLabel !== null ? (
        <UnresolvableRecordReference label={unresolvableLabel} className="text-sm max-w-full" />
      ) : href === null ? (
        <div className="text-sm truncate max-w-full" title={title}>{title}</div>
      ) : (
      <Link
        to={href}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-sm hover:underline truncate max-w-full"
        title={title}
      >
        <span className="truncate">{title}</span>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
      </Link>
      )}
      <div className="text-xs text-muted-foreground truncate">
        {objectDisplay(r)}
        {deadLabel !== null && r.record_title && (
          <span className="ml-1.5">· {r.record_title}</span>
        )}
        {amount && (
          <span className="ml-1.5 font-medium text-foreground" title={`${amount.label}: ${amount.display}`}>
            · {amount.display}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * objectui#12816 — the inline Approve / Reject column is pinned to the table's
 * right edge, the way the console's lists pin their Actions column: inside the
 * `seam="pinned"` overflow box the pinned cells draw the shared seam shadow on
 * their own left edge while columns scroll under them. The cell's fill is the
 * card's, so a table that does not scroll looks as before; the row's hover and
 * keyboard-focus tints are layered back over that fill by an `::after` behind
 * the cell's content (the sticky cell is its own stacking context, so `-z-10`
 * stays inside it).
 */
const PINNED_ACTIONS_CLASSES = `sticky right-0 z-10 bg-card after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:opacity-0 in-[tr:hover]:after:opacity-100 ${PINNED_RIGHT_SEAM_SHADOW_CLASSES}`;

function InlineActions({
  r,
  actionable,
  busy,
  needsInputs,
  tr,
  onApprove,
  onReject,
}: {
  r: ApprovalRequestRow;
  actionable: boolean;
  busy: boolean;
  needsInputs: boolean;
  tr: Translate;
  onApprove: (r: ApprovalRequestRow) => void;
  onReject: (r: ApprovalRequestRow) => void;
}) {
  if (!actionable) return null;
  // #2829: a request whose node declares decision outputs must go through
  // its page's decision dialog (the only place those fields are collected) —
  // render the quick buttons disabled with an explanation instead of hiding them.
  const needsInputsHint = tr(
    'needsDecisionInputs',
    'This approval collects decision outputs — open it to decide.',
  );
  return (
    <div
      className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
      onClick={(e) => e.stopPropagation()}
      title={needsInputs ? needsInputsHint : undefined}
    >
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400"
        disabled={busy || needsInputs}
        onClick={() => onApprove(r)}
        aria-label={needsInputs ? needsInputsHint : tr('approve', 'Approve')}
      >
        <CheckCircle2 className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400"
        disabled={busy || needsInputs}
        onClick={() => onReject(r)}
        aria-label={needsInputs ? needsInputsHint : tr('reject', 'Reject')}
      >
        <XCircle className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * The router path of a request's page: the console's standard record route for
 * `sys_approval_request`, where `RecordDetailView` mounts the page objectstack
 * serves for it (`sys_approval_request_detail`). The app segment falls back to
 * `setup` as the row's record link does.
 */
function requestPagePath(appName: string | undefined, requestId: string): string {
  return `/apps/${appName || 'setup'}/${APPROVAL_REQUEST_OBJECT}/record/${encodeURIComponent(requestId)}`;
}

/**
 * The inbox route. A notification deep link (#2678 P1.5) carries
 * `/system/approvals?request=<id>`; it opens that request on its page, in place
 * of the deep link in history, so Back leaves the way the reader came. Without
 * one, the route draws the queue.
 */
export function ApprovalsInboxPage() {
  const { appName } = useParams<{ appName?: string }>();
  const [searchParams] = useSearchParams();
  const request = searchParams.get('request');
  if (request) return <Navigate to={requestPagePath(appName, request)} replace />;
  return <ApprovalsQueue />;
}

function ApprovalsQueue() {
  const { t } = useObjectTranslation();
  // Every date and number face on this page is formatted in the display
  // locale; the module helpers above take it as a required argument.
  const displayLocale = useDisplayLocale();
  const { user } = useAuth();
  const { appName } = useParams<{ appName?: string }>();
  const navigate = useNavigate();
  const identities = useMemo(() => buildApproverIdentities(user as any), [user]);

  const tr = useCallback(
    (key: string, defaultValue: string, opts?: Record<string, unknown>) =>
      String(t(`approvalsInbox.${key}`, { defaultValue, ...opts })),
    [t],
  );

  /**
   * The one clock this page renders against.
   *
   * Every age/SLA figure below used to call `Date.now()` mid-render, which is
   * impure (`react-hooks/purity`): the output depended on when React happened
   * to render, so it disagreed with itself under StrictMode's double render and
   * froze between renders — an inbox left open showed "just now" indefinitely.
   * Holding the instant in state and advancing it on a timer makes render a
   * pure function of props+state *and* makes the countdowns actually tick.
   *
   * A minute is the finest granularity anything here displays ("5m ago",
   * "36h", "3d"), so that is the tick rate.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  /** Localized relative time, e.g. "5m ago" / "5 分钟前". */
  const formatRelative = useCallback((s: string | null | undefined): string => {
    if (!s) return '—';
    const ts = Date.parse(s);
    if (Number.isNaN(ts)) return s;
    const sec = Math.round((now - ts) / 1000);
    if (sec < 45) return tr('justNow', 'just now');
    const min = Math.round(sec / 60);
    if (min < 60) return tr('minutesAgo', '{{count}}m ago', { count: min });
    const hr = Math.round(min / 60);
    if (hr < 24) return tr('hoursAgo', '{{count}}h ago', { count: hr });
    const day = Math.round(hr / 24);
    if (day < 30) return tr('daysAgo', '{{count}}d ago', { count: day });
    // Past 30 days the face is a DATE, not words, so it takes the display
    // locale, never the UI language `tr` speaks: a regional locale (`de-CH`
    // under an English UI) must reach it (objectui#10375).
    try { return new Date(s).toLocaleDateString(displayLocale); } catch { return s; }
  }, [tr, displayLocale, now]);

  const statusLabel = useCallback((status: string): string => {
    switch (status) {
      case 'pending': return tr('statusPending', 'Pending');
      case 'approved': return tr('statusApproved', 'Approved');
      case 'rejected': return tr('statusRejected', 'Rejected');
      case 'recalled': return tr('statusRecalled', 'Recalled');
      case 'returned': return tr('statusReturned', 'Returned for revision');
      // objectstack#13568 added this terminal state; without a case the badge
      // rendered the raw wire token `cancelled`. The default is the CONTRACT's
      // own authored label rather than a fresh English string here — same
      // discipline as the tombstone's copy (see `deadRecordReference`).
      case 'cancelled': return tr('statusCancelled', APPROVAL_STATUS_LABELS.cancelled);
      default: return status;
    }
  }, [tr]);

  /** Map raw API errors to business-readable toasts (no `HTTP_404: Not found`). */
  const humanizeError = useCallback((err: any, fallback: string): string => {
    const code = err?.code ?? '';
    const status = err?.status ?? 0;
    if (code === 'NOT_IMPLEMENTED' || status === 501) {
      return tr('recallUnavailable', 'Recall is not available on this deployment.');
    }
    if (code === 'THROTTLED' || status === 429) {
      return tr('remindThrottled', 'A reminder was sent recently — try again later.');
    }
    if (status === 404) return tr('requestGone', 'This request no longer exists. Refresh the list.');
    if (code === 'FORBIDDEN' || status === 403) return tr('notAllowed', 'You are not allowed to perform this action.');
    if (code === 'INVALID_STATE' || status === 409) return tr('alreadyDecided', 'This request was already decided. Refresh the list.');
    return err?.message || fallback;
  }, [tr]);

  /** SLA chip copy for a {@link slaState} result. */
  const slaLabel = useCallback(
    (sla: { overdue: boolean; ms: number }): string =>
      sla.overdue
        ? tr('slaOverdue', 'SLA overdue {{dur}}', { dur: compactDuration(sla.ms) })
        : tr('slaRemaining', 'SLA {{dur}} left', { dur: compactDuration(sla.ms) }),
    [tr],
  );

  const recordHref = useCallback((r: ApprovalRequestRow): string => {
    const app = appName || 'setup';
    return `/apps/${app}/${encodeURIComponent(r.object_name)}/record/${encodeURIComponent(r.record_id)}`;
  }, [appName]);

  /**
   * [objectui#7108] The tombstone copy, resolved once for the whole page from
   * the platform's own `cancel_reason` option label.
   *
   * `deadLabelFor` answers non-null ONLY for a row the platform itself marked
   * `cancelled` + `record_deleted`. ⛔ It must never be widened to a failed
   * lookup: `readability.isUnreadable` (objectui#5211) reports that this viewer
   * cannot read the target and deliberately says nothing about why — the read
   * path fuses "deleted" and "hidden by permissions" on purpose (existence
   * non-disclosure). Rendering a deletion off that answer would tell a viewer
   * their permissions problem is a deletion (objectstack#7345's case), which is
   * a worse claim than the bare id it replaces. The two causes stay separate
   * here exactly as the ruling requires.
   */
  const deadReferenceLabel = useDeadRecordReferenceLabel();
  const deadLabelFor = useCallback(
    (r: ApprovalRequestRow | null | undefined): string | null =>
      (isDeletedRecordReference(r) ? deadReferenceLabel : null),
    [deadReferenceLabel],
  );

  /**
   * [objectui#8631] The cause-free affordance's copy, resolved once for the
   * page, and the predicate that decides which rows get it.
   *
   * It answers non-null only for a reference this viewer's own probe could not
   * resolve AND that carries no snapshot title — the rows that used to degrade
   * to the opaque record id. ⛔ It asserts nothing about WHY: the probe fuses
   * "deleted" and "hidden by permissions" by design, which is exactly what
   * makes it safe to drive cause-free copy off and exactly why it may never
   * drive `deadLabelFor`, whose sentence is the platform's own assertion.
   *
   * `unresolvableLabelFor` is defined below the probe it reads — see
   * `readability`, whose answer it takes verbatim and never widens.
   */
  const unresolvableReferenceLabel = useUnresolvableRecordReferenceLabel();

  const [tab, setTab] = useState<TabKey>('pending');
  const [rows, setRows] = useState<ApprovalRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Unwindowed total on the paginated tabs (null = unpaginated tab). */
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** "My pending" count, independent of the active tab (badge + bell parity). */
  const [myPendingCount, setMyPendingCount] = useState(0);
  /**
   * objectui#12608 — the pending requests this caller can see in the
   * environment, read only while the "pending" tab is empty: the empty state
   * then says how many are waiting on other approvers. `null` = not read, or
   * the read failed or answered no total; the line is then not drawn.
   */
  const [environmentPendingCount, setEnvironmentPendingCount] = useState<number | null>(null);

  /**
   * Open a request on its page (objectui#12484): the page objectstack serves
   * for it, on the standard record route. A navigation, so Back returns to the
   * queue with its tab, filters and scroll as they were.
   */
  const openRequest = useCallback(
    (id: string) => navigate(requestPagePath(appName, id)),
    [navigate, appName],
  );

  /**
   * objectui#5211 — an approver can be routed a request about a record they
   * cannot read (approver routing goes by position; record visibility is a
   * separate gate). The link below then dead-ends on the record page's
   * "may have been deleted", so it is suppressed for exactly those rows.
   * objectui#11878 adds the approver with no read of the object at all, whose
   * probe the server refuses (403): same link, same suppression.
   *
   * One batched list read per distinct object covers the whole page — see
   * `recordReadability.ts` for the cost model, the fail-open rule, and why
   * nothing here says anything about WHY a target is unreadable.
   */
  const readability = useRecordReadability(rows);

  /**
   * objectui#8631 — the cause-free branch, wired to that same probe.
   *
   * ⛔ The probe's answer is taken exactly as it is reported: `isOutsideRowSet`
   * is true only once the probe has ANSWERED "not in this viewer's row set",
   * and an unknown (unprobed, failed, no data source) target keeps today's
   * rendering because the probe fails open. Nothing here re-asks, re-derives,
   * or narrows what that answer means.
   *
   * objectui#11878: a REFUSED read (403) withholds the link through
   * `isUnreadable` and deliberately not this label — the ruling moves the
   * link alone, so a refused row keeps the reference text it always had.
   */
  const unresolvableLabelFor = useCallback(
    (r: ApprovalRequestRow | null | undefined): string | null =>
      (isUnresolvableRecordReference(r, !!r && readability.isOutsideRowSet(r))
        ? unresolvableReferenceLabel
        : null),
    [readability, unresolvableReferenceLabel],
  );

  /**
   * objectui#5565 + objectui#6020 — the fields each object on screen declares
   * `hidden: true`. `hidden` is a UI contract (objectstack#10749: "`hidden:
   * true` stays UI-only; `internal: true` is the serialization primitive"), and
   * every surface below is default UI, so all of them must honour it: the
   * queue rows, the mobile cards, and the amount sort (#6020).
   *
   * ⛔ It is keyed BY OBJECT and not a single set. The queue is N rows spanning
   * K objects; threading one object's set into the rows would apply one
   * object's declarations to every row — hiding fields on rows whose object
   * never declared them, missing fields on rows whose object did, and looking
   * fixed while doing it. Every consumer asks with its OWN `object_name`.
   *
   * One cached metadata read per distinct object per mount, empty until it
   * answers — see `hiddenFields.ts` for the cost model and why this fails open.
   */
  const hiddenFieldObjects = useMemo(
    () => rows.map((t) => t.object_name),
    [rows],
  );
  const hiddenFields = useHiddenFieldsByObject(hiddenFieldObjects);

  // Search + filters. On the paginated tabs (submitted/all) the free-text
  // query is debounced and pushed to the server; the pending tab keeps
  // instant client-side matching over its (bounded) personal queue.
  const [query, setQuery] = useState('');
  const [serverQuery, setServerQuery] = useState('');
  const [processFilter, setProcessFilter] = useState<string>('all');
  const [objectFilter, setObjectFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // Client-side ordering of the visible rows (#2762 P1-3). Default keeps the
  // server's newest-first; the others let a reviewer triage by wait time or by
  // the decision-relevant amount.
  const [sortKey, setSortKey] = useState<'recent' | 'oldest' | 'amount'>('recent');

  // Bulk selection (only meaningful on "pending" tab where the user can act)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  // Inline decision confirmation targets (row-level quick action / mobile
  // card / keyboard). BOTH decisions confirm before executing (#2762 P0-2):
  // the right-edge icons are small, easy to misclick, and a decision is
  // irreversible — one stray click must never finalize a request.
  const [approveTarget, setApproveTarget] = useState<ApprovalRequestRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ApprovalRequestRow | null>(null);
  const [inlineActing, setInlineActing] = useState<string | null>(null);

  // Keyboard row focus
  const [focusIndex, setFocusIndex] = useState<number>(-1);

  useEffect(() => {
    if (tab === 'pending') return;
    const t = window.setTimeout(() => setServerQuery(query), 350);
    return () => window.clearTimeout(t);
  }, [query, tab]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let requests: ApprovalRequestRow[] = [];
      if (tab === 'pending') {
        // ONE request with every identity — the server matches ANY of them.
        requests = identities.length
          ? (await approvalsApi.listRequests({ status: 'pending', approverId: identities })).data
          : [];
        setMyPendingCount(requests.length);
        setTotal(null);
        // objectui#12608 — the caller's pending list is empty, so ONE count
        // query asks how many pending requests the environment holds. Paged
        // (`limit`), so the server answers `total`; it counts under the same
        // visibility as the "all" tab's own read, so the number never names a
        // request the caller cannot open from there, and every request it
        // counts waits on someone else. A failed read draws no line.
        setEnvironmentPendingCount(null);
        if (requests.length === 0) {
          approvalsApi.listRequests({ status: 'pending', limit: 1, offset: 0 })
            .then(res => setEnvironmentPendingCount(typeof res.total === 'number' ? res.total : null))
            .catch(() => { /* the line is best-effort: no count, no line */ });
        }
      } else {
        const pageParams = {
          q: serverQuery || undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          limit: PAGE_SIZE,
          offset: 0,
        };
        if (tab === 'submitted') {
          const submitterId = user?.id;
          if (submitterId) {
            const res = await approvalsApi.listRequests({ submitterId, ...pageParams });
            requests = res.data;
            setTotal(res.total ?? res.data.length);
          } else {
            requests = [];
            setTotal(0);
          }
        } else {
          const res = await approvalsApi.listRequests(pageParams);
          requests = res.data;
          setTotal(res.total ?? res.data.length);
        }
        // Keep the badge honest while browsing other tabs.
        if (identities.length) {
          approvalsApi.listRequests({ status: 'pending', approverId: identities })
            .then(res => setMyPendingCount(res.data.length))
            .catch(() => { /* badge refresh is best-effort */ });
        }
      }
      // Newest first — submitted_at falls back to created_at for legacy rows.
      requests.sort((a, b) => (submittedAt(b) || '').localeCompare(submittedAt(a) || ''));
      setRows(requests);
    } catch (err: any) {
      setError(err?.message || String(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab, identities, user?.id, serverQuery, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  /** Append the next server page (paginated tabs only). */
  const loadMore = useCallback(async () => {
    if (tab === 'pending' || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await approvalsApi.listRequests({
        submitterId: tab === 'submitted' ? user?.id ?? undefined : undefined,
        q: serverQuery || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit: PAGE_SIZE,
        offset: rows.length,
      });
      setRows(prev => {
        const seen = new Set(prev.map(r => r.id));
        return [...prev, ...res.data.filter(r => !seen.has(r.id))];
      });
      if (res.total != null) setTotal(res.total);
    } catch (err: any) {
      toast.error(humanizeError(err, tr('loadFailed', 'Failed to load request')));
    } finally {
      setLoadingMore(false);
    }
  }, [tab, loadingMore, user?.id, serverQuery, statusFilter, rows.length, humanizeError, tr]);

  /**
   * Pick the actor id to send with approve/reject.
   *   1. Manual override (admin-only textbox), useful when acting as a
   *      position like `position:sales_manager`.
   *   2. First identity that intersects `pending_approvers`.
   *   3. User id fallback.
   */
  const refreshBadge = useCallback(() => {
    if (!identities.length) return;
    approvalsApi.listRequests({ status: 'pending', approverId: identities })
      .then(res => setMyPendingCount(res.data.length))
      .catch(() => { /* best-effort */ });
  }, [identities]);

  /** Unique process labels present in current rows (for filter dropdown). */
  const processOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(processLabel(r));
    return Array.from(set).sort();
  }, [rows]);

  /** Unique object names present in current rows (for filter dropdown). */
  const objectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.object_name) set.add(r.object_name);
    return Array.from(set).sort();
  }, [rows]);

  /** Client-side filtered + sorted rows shown in table. */
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = rows.filter(r => {
      if (processFilter !== 'all' && processLabel(r) !== processFilter) return false;
      if (objectFilter !== 'all' && r.object_name !== objectFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      // Paginated tabs: the server already applied the free-text query
      // (incl. record titles via the payload snapshot) — re-filtering here
      // against a narrower client haystack would drop valid matches.
      if (tab !== 'pending') return true;
      if (!q) return true;
      const hay = [
        r.process_name, r.process_label, r.step_label, r.object_name,
        r.record_id, r.record_title, r.submitter_id, r.submitter_name,
        ...(r.pending_approvers || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (sortKey === 'recent') return matched; // server order is already newest-first
    const sorted = [...matched];
    if (sortKey === 'amount') {
      // Highest amount first; rows without a detectable amount sink to the
      // bottom (keeping their relative newest-first order).
      //
      // objectui#6020: a row whose amount field its object declares
      // `hidden: true` has no amount HERE either, so it sinks with them. An
      // ordering IS a disclosure — it leaks the relative magnitude of a hidden
      // figure to a viewer who never sees the figure — so the queue must not
      // order on a value it declines to render. Each row is asked about its
      // own object; a page spanning several objects gets several answers.
      sorted.sort((a, b) => {
        const av = decisionAmountEntry(a, hiddenFields.forObject(a.object_name), displayLocale)?.value;
        const bv = decisionAmountEntry(b, hiddenFields.forObject(b.object_name), displayLocale)?.value;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
    } else {
      // Oldest first — flip the newest-first submitted timestamp.
      sorted.sort((a, b) => (submittedAt(a) || '').localeCompare(submittedAt(b) || ''));
    }
    return sorted;
  }, [rows, query, processFilter, objectFilter, statusFilter, tab, sortKey, hiddenFields, displayLocale]);

  // Reset selection when underlying filtered list changes (avoid acting on hidden rows).
  useEffect(() => {
    if (selectedRowIds.size === 0) return;
    const visible = new Set(filteredRows.map(r => r.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedRowIds) {
      if (visible.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedRowIds(next);
  }, [filteredRows, selectedRowIds]);

  // Clamp keyboard focus to the visible list.
  useEffect(() => {
    if (focusIndex >= filteredRows.length) setFocusIndex(filteredRows.length - 1);
  }, [filteredRows.length, focusIndex]);

  const isActionable = useCallback((r: ApprovalRequestRow): boolean => {
    if (r.status !== 'pending') return false;
    const idSet = new Set(identities);
    return (r.pending_approvers || []).some(a => idSet.has(a));
  }, [identities]);

  /**
   * #2829 / framework#3447: a node that declares decision outputs expects the
   * approver to fill them — only the declared-action dialog on the request's
   * page (its decision panel's `DeclaredActionsBar`) collects them, so the
   * quick paths (inline a/r, hover buttons, bulk) must not decide
   * such a request: a quick approve would silently hand the flow nothing and
   * the next stage's expression approver would resolve an empty slate.
   */
  const needsDecisionInputs = useCallback((r: ApprovalRequestRow): boolean =>
    Array.isArray(r.decision_outputs) && r.decision_outputs.length > 0, []);

  /** Quick-decidable = actionable AND no declared decision outputs (#2829). */
  const quickDecidable = useCallback((r: ApprovalRequestRow): boolean =>
    isActionable(r) && !needsDecisionInputs(r), [isActionable, needsDecisionInputs]);

  /**
   * Rows the user is actually allowed to bulk-act on:
   * status=pending AND one of the user's identities is in pending_approvers
   * AND the node declares no decision outputs (#2829 — those need the request
   * page's dialog; they surface in the bulk bar as skipped).
   */
  const actionableSelectedRows = useMemo(
    () => filteredRows.filter(r => selectedRowIds.has(r.id) && quickDecidable(r)),
    [filteredRows, selectedRowIds, quickDecidable],
  );

  const allFilteredSelectable = filteredRows.filter(r => r.status === 'pending');
  const allSelected =
    allFilteredSelectable.length > 0 &&
    allFilteredSelectable.every(r => selectedRowIds.has(r.id));

  const toggleAll = useCallback(() => {
    setSelectedRowIds(prev => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      for (const r of allFilteredSelectable) next.add(r.id);
      return next;
    });
  }, [allSelected, allFilteredSelectable]);

  const toggleRow = useCallback((id: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /**
   * Bulk approve / reject the actionable selection. Runs sequentially for
   * clear progress; failures are reported per record, not just as a count.
   */
  const runBulk = useCallback(async (kind: 'approve' | 'reject') => {
    const targets = actionableSelectedRows;
    if (targets.length === 0) return;
    setBulkRunning(true);
    let ok = 0;
    const failures: string[] = [];
    for (const r of targets) {
      const pending = new Set(r.pending_approvers || []);
      const actor = identities.find(i => pending.has(i)) || user?.id || '';
      try {
        const fn = kind === 'approve' ? approvalsApi.approve : approvalsApi.reject;
        await fn(r.id, { actor_id: actor });
        ok++;
      } catch {
        failures.push(r.record_title || formatIdentity(r.record_id));
      }
    }
    setBulkRunning(false);
    setSelectedRowIds(new Set());
    if (failures.length === 0) {
      toast.success(kind === 'approve'
        ? tr('bulkApproved', 'Approved {{count}} requests', { count: ok })
        : tr('bulkRejected', 'Rejected {{count}} requests', { count: ok }));
    } else {
      const shown = failures.slice(0, 3).join(', ');
      toast.error(tr('bulkPartial', '{{ok}} succeeded, {{fail}} failed: {{which}}', {
        ok, fail: failures.length, which: shown + (failures.length > 3 ? '…' : ''),
      }));
    }
    void load();
    refreshBadge();
  }, [actionableSelectedRows, identities, user?.id, load, refreshBadge, tr]);

  /** Confirmed row-level approve (from the shared dialog). */
  const inlineApprove = useCallback(async () => {
    const r = approveTarget;
    if (!r) return;
    const pending = new Set(r.pending_approvers || []);
    const actor = identities.find(i => pending.has(i)) || user?.id || '';
    setInlineActing(r.id);
    setApproveTarget(null);
    try {
      const res = await approvalsApi.approve(r.id, { actor_id: actor });
      toast.success(res.finalized
        ? tr('inlineApproved', 'Approved "{{title}}"', { title: r.record_title || formatIdentity(r.record_id) })
        : tr('approvedWaiting', 'Approved — waiting on the remaining approvers'));
      void load();
      refreshBadge();
    } catch (err: any) {
      toast.error(humanizeError(err, tr('actionFailed', 'Action failed')));
    } finally {
      setInlineActing(null);
    }
  }, [approveTarget, identities, user?.id, load, refreshBadge, humanizeError, tr]);

  /** Confirmed row-level reject (from the shared dialog). */
  const inlineReject = useCallback(async () => {
    const r = rejectTarget;
    if (!r) return;
    const pending = new Set(r.pending_approvers || []);
    const actor = identities.find(i => pending.has(i)) || user?.id || '';
    setInlineActing(r.id);
    setRejectTarget(null);
    try {
      await approvalsApi.reject(r.id, { actor_id: actor });
      toast.success(tr('inlineRejected', 'Rejected "{{title}}"', { title: r.record_title || formatIdentity(r.record_id) }));
      void load();
      refreshBadge();
    } catch (err: any) {
      toast.error(humanizeError(err, tr('actionFailed', 'Action failed')));
    } finally {
      setInlineActing(null);
    }
  }, [rejectTarget, identities, user?.id, load, refreshBadge, humanizeError, tr]);

  // ── Keyboard flow: j/k move · Enter open · x select · a approve · r reject ──
  const filteredRef = useRef(filteredRows);
  filteredRef.current = filteredRows;
  const focusRef = useRef(focusIndex);
  focusRef.current = focusIndex;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (approveTarget || rejectTarget) return; // a dialog owns the keyboard
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      const list = filteredRef.current;
      if (!list.length) return;
      const idx = focusRef.current;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex(Math.min(idx + 1, list.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex(Math.max(idx - 1, 0));
      } else if (e.key === 'Enter' && idx >= 0 && list[idx]) {
        e.preventDefault();
        openRequest(list[idx].id);
      } else if ((e.key === 'x' || e.key === ' ') && idx >= 0 && list[idx] && tab === 'pending') {
        e.preventDefault();
        toggleRow(list[idx].id);
      } else if (e.key === 'a' && idx >= 0 && list[idx] && quickDecidable(list[idx])) {
        e.preventDefault();
        setApproveTarget(list[idx]);
      } else if (e.key === 'r' && idx >= 0 && list[idx] && quickDecidable(list[idx])) {
        e.preventDefault();
        setRejectTarget(list[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [approveTarget, rejectTarget, tab, openRequest, toggleRow, quickDecidable]);

  const hasFilters = !!query || processFilter !== 'all' || objectFilter !== 'all' || statusFilter !== 'all';

  const onTabChange = (v: string) => {
    setTab(v as TabKey);
    setStatusFilter('all');
    setProcessFilter('all');
    setObjectFilter('all');
    setQuery('');
    setSortKey('recent');
    setFocusIndex(-1);
  };

  return (
    <div>
    {/* The console's one page header, the one an object list and a dashboard
        draw (objectui#12526): icon chip, title, the subtitle beside the title
        from `sm` up, and Refresh at the right, in one row across the page's
        full width, above the padded body. It stays below `sm`, as this
        page's header always has: on the component route the phone bar names
        the app, not this page. There it draws the icon, title and Refresh;
        the header itself hides the subtitle below `sm`. */}
    <ConsolePageHeader
      title={tr('title', 'Approvals Inbox')}
      subtitle={tr('subtitle', 'Review and act on approval requests.')}
      icon={<CheckSquare className="h-4 w-4" />}
      // The header's own Refresh icon button (objectui#12606).
      refresh={{ onRefresh: load, label: tr('refresh', 'Refresh'), busy: loading }}
    />
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 max-w-6xl">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="pending">
            {tr('tabMyPending', 'My Pending')}
            {myPendingCount > 0 && (
              <Badge variant="secondary" className="ml-2">{myPendingCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="submitted">{tr('tabSubmitted', 'Submitted by me')}</TabsTrigger>
          <TabsTrigger value="all">{tr('tabAll', 'All')}</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4 space-y-3">
          {/* Toolbar: search + filters */}
          {!loading && (rows.length > 0 || (tab !== 'pending' && (serverQuery || statusFilter !== 'all'))) && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr('searchPlaceholder', 'Search record, process, requester…')}
                  className="pl-8 h-8 text-sm"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={tr('clearSearch', 'Clear search')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {tab !== 'pending' && (
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-auto min-w-[130px] text-sm">
                    <SelectValue placeholder={tr('statusFilter', 'Status')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tr('allStatuses', 'All statuses')}</SelectItem>
                    <SelectItem value="pending">{statusLabel('pending')}</SelectItem>
                    <SelectItem value="approved">{statusLabel('approved')}</SelectItem>
                    <SelectItem value="rejected">{statusLabel('rejected')}</SelectItem>
                    <SelectItem value="recalled">{statusLabel('recalled')}</SelectItem>
                    <SelectItem value="returned">{statusLabel('returned')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {processOptions.length > 1 && (
                <Select value={processFilter} onValueChange={setProcessFilter}>
                  <SelectTrigger className="h-8 w-auto min-w-[140px] text-sm">
                    <SelectValue placeholder={tr('processFilter', 'Process')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tr('allProcesses', 'All processes')}</SelectItem>
                    {processOptions.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {objectOptions.length > 1 && (
                <Select value={objectFilter} onValueChange={setObjectFilter}>
                  <SelectTrigger className="h-8 w-auto min-w-[140px] text-sm">
                    <SelectValue placeholder={tr('objectFilter', 'Object')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tr('allObjects', 'All objects')}</SelectItem>
                    {objectOptions.map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {/* Triage ordering (#2762 P1-3): newest by default, or by wait
                  time / decision amount. */}
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
                <SelectTrigger className="h-8 w-auto min-w-[120px] text-sm">
                  <ArrowUpDown className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                  <SelectValue placeholder={tr('sortBy', 'Sort')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">{tr('sortRecent', 'Newest first')}</SelectItem>
                  <SelectItem value="oldest">{tr('sortOldest', 'Oldest first')}</SelectItem>
                  <SelectItem value="amount">{tr('sortAmount', 'Amount (high→low)')}</SelectItem>
                </SelectContent>
              </Select>
              {hasFilters && (
                <span className="text-xs text-muted-foreground">
                  {tr('filterCount', '{{shown}} of {{total}}', { shown: filteredRows.length, total: rows.length })}
                </span>
              )}
            </div>
          )}

          {/* Bulk action bar (visible when ≥1 row selected on pending tab) */}
          {tab === 'pending' && selectedRowIds.size > 0 && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-accent/30 text-sm">
              <span>
                <strong>{selectedRowIds.size}</strong> {tr('selected', 'selected')}
                {actionableSelectedRows.length !== selectedRowIds.size && (
                  <span className="text-muted-foreground ml-1">
                    {tr('actionableCount', '({{count}} actionable)', { count: actionableSelectedRows.length })}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" disabled={bulkRunning || actionableSelectedRows.length === 0}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      {tr('approveN', 'Approve {{count}}', { count: actionableSelectedRows.length || '' })}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {tr('bulkApproveTitle', 'Approve {{count}} requests?', { count: actionableSelectedRows.length })}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {tr('bulkApproveBody', 'Each request is approved with your identity and its flow continues down the approve branch.')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{tr('cancel', 'Cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => runBulk('approve')}>
                        {tr('approveN', 'Approve {{count}}', { count: actionableSelectedRows.length })}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkRunning || actionableSelectedRows.length === 0}
                      className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" />
                      {tr('rejectN', 'Reject {{count}}', { count: actionableSelectedRows.length || '' })}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {tr('bulkRejectTitle', 'Reject {{count}} requests?', { count: actionableSelectedRows.length })}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {tr('bulkRejectBody', 'This rejects the selected requests and notifies their submitters.')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{tr('cancel', 'Cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => runBulk('reject')}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {tr('rejectN', 'Reject {{count}}', { count: actionableSelectedRows.length })}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedRowIds(new Set())}
                  disabled={bulkRunning}
                >
                  {tr('clear', 'Clear')}
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center min-h-[240px] rounded-md border border-dashed">
              <Empty>
                <EmptyTitle>{tr('emptyTitle', 'No requests')}</EmptyTitle>
                <EmptyDescription>
                  {tab === 'pending'
                    ? tr('emptyPending', "You're all caught up — nothing is waiting on you.")
                    : tr('emptyOther', 'Nothing here yet.')}
                </EmptyDescription>
                {tab === 'pending' && (environmentPendingCount ?? 0) > 0 ? (
                  <p
                    className="mt-1 text-sm text-muted-foreground"
                    data-testid="approvals-inbox-waiting-on-others"
                  >
                    {tr('waitingOnOthers', '{{count}} requests are waiting on other approvers', {
                      count: environmentPendingCount,
                    })}
                    {' · '}
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onTabChange('all')}>
                      {tr('emptyViewAll', 'Browse all requests')}
                    </Button>
                  </p>
                ) : tab === 'pending' && (
                  <Button variant="link" size="sm" className="mt-1" onClick={() => onTabChange('all')}>
                    {tr('emptyViewAll', 'Browse all requests')}
                  </Button>
                )}
              </Empty>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex items-center justify-center min-h-[160px] rounded-md border border-dashed text-sm text-muted-foreground">
              {tr('noMatches', 'No matches for current filters.')}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <Card className="hidden md:block">
                <CardContent className="p-0">
                  {/* objectui#12708 — wider than the panel, the table scrolls
                      in the shared overflow box: a right-edge shadow while
                      columns remain to the right, its scrollbar on hover. */}
                  {/* objectui#12816 — `seam="pinned"`: the shadow moves from
                      the box's edge to the pinned Approve / Reject cells. */}
                  <HorizontalOverflowBox seam="pinned" outerClassName="rounded-lg overflow-hidden" data-testid="approvals-inbox-table-scroller">
                  <Table containerClassName="overflow-visible">
                    <TableHeader>
                      <TableRow>
                        {tab === 'pending' && (
                          <TableHead className="w-10">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={toggleAll}
                              aria-label={tr('selectAll', 'Select all')}
                              disabled={allFilteredSelectable.length === 0}
                            />
                          </TableHead>
                        )}
                        {/* Column widths rebalanced (#2762 P2): the Record is the
                            primary content so it gets the widest share, the
                            Request a moderate one, and Status/Submitted fixed
                            widths so they never crowd — instead of the browser
                            spreading five auto columns evenly and leaving 审批事项
                            over-wide next to a cramped 状态. */}
                        <TableHead className="w-[22%]">{tr('colRequest', 'Request')}</TableHead>
                        {/* objectui#12816 — the Record cells are `max-w-0` (below),
                            so this floor is the column's only minimum: enough to
                            tell one record from the next at 1024 px, however long
                            the titles are. */}
                        <TableHead className="w-[30%] min-w-40">{tr('colRecord', 'Record')}</TableHead>
                        <TableHead className="w-[16%]">{tr('colRequester', 'Requester')}</TableHead>
                        <TableHead className="w-[110px] min-w-[96px] whitespace-nowrap">{tr('colStatus', 'Status')}</TableHead>
                        <TableHead className="w-[132px]">{tr('colWaiting', 'Submitted')}</TableHead>
                        <TableHead className={cn('w-20', PINNED_ACTIONS_CLASSES, 'after:bg-muted/50')} aria-label={tr('colActions', 'Actions')} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.map((r, i) => (
                        <TableRow
                          key={r.id}
                          className={cn(
                            'group cursor-pointer hover:bg-accent/50',
                            focusIndex === i && 'ring-2 ring-inset ring-ring bg-accent/30',
                          )}
                          onClick={() => { setFocusIndex(i); openRequest(r.id); }}
                        >
                          {tab === 'pending' && (
                            <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedRowIds.has(r.id)}
                                onCheckedChange={() => toggleRow(r.id)}
                                disabled={r.status !== 'pending'}
                                aria-label={tr('selectRow', 'Select request')}
                              />
                            </TableCell>
                          )}
                          <TableCell><RequestCell r={r} tr={tr} /></TableCell>
                          {/* objectui#12816 — `max-w-0` takes the record title's
                              unbreakable width out of the auto-layout table's
                              column sizing, so a long title truncates (full text
                              in its `title`) instead of widening the table. */}
                          <TableCell className="max-w-0">
                            <RecordCell
                              r={r}
                              // A known-dead reference needs no probe: there is
                              // nothing to link to, and the probe is async and
                              // fails open, so leaving it to answer would render
                              // a live-looking link for the first paint.
                              href={deadLabelFor(r) !== null || readability.isUnreadable(r) ? null : recordHref(r)}
                              hiddenKeys={hiddenFields.forObject(r.object_name)}
                              deadLabel={deadLabelFor(r)}
                              unresolvableLabel={unresolvableLabelFor(r)}
                            />
                          </TableCell>
                          <TableCell>
                            {isSystemSubmitter(r) ? (
                              // Flow-/system-initiated: name the origin instead of a
                              // bare person icon + "—" (#2762 P1-4).
                              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Workflow className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate italic">{tr('flowOrigin', 'Flow-initiated')}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-sm">
                                <UserIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="truncate" title={r.submitter_id || ''}>{submitterDisplay(r)}</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell><StatusBadge status={r.status} label={statusLabel(r.status)} /></TableCell>
                          <TableCell
                            className={cn('text-xs whitespace-nowrap', agingClass(r, now))}
                            title={formatDate(submittedAt(r), displayLocale)}
                          >
                            <Clock className="h-3 w-3 inline mr-1" />
                            {formatRelative(submittedAt(r))}
                            {r.status === 'pending' && (() => {
                              const sla = slaState(r.sla_due_at, now);
                              return sla ? (
                                <div className={cn(
                                  'mt-0.5 text-[10px] font-medium',
                                  sla.overdue ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                                )}>
                                  {slaLabel(sla)}
                                </div>
                              ) : null;
                            })()}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'w-20',
                              PINNED_ACTIONS_CLASSES,
                              // The focused row's inset ring is drawn by the row,
                              // under this opaque cell: the cell redraws the ring's
                              // top, right and bottom edges itself.
                              focusIndex === i
                                ? 'after:bg-accent/30 after:opacity-100 in-[tr:hover]:after:bg-accent/50 shadow-[inset_0_2px_0_var(--color-ring),inset_-2px_0_0_var(--color-ring),inset_0_-2px_0_var(--color-ring)]'
                                : 'after:bg-accent/50',
                            )}
                          >
                            <InlineActions
                              r={r}
                              actionable={isActionable(r)}
                              busy={inlineActing === r.id}
                              needsInputs={needsDecisionInputs(r)}
                              tr={tr}
                              onApprove={setApproveTarget}
                              onReject={setRejectTarget}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </HorizontalOverflowBox>
                </CardContent>
              </Card>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {filteredRows.map((r) => (
                  <Card key={r.id} className="cursor-pointer active:bg-accent/50" onClick={() => openRequest(r.id)}>
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm truncate">{processLabel(r)}</div>
                        <StatusBadge status={r.status} label={statusLabel(r.status)} />
                      </div>
                      {/* objectui#7108: same tombstone as the desktop row —
                          the mobile card renders the SAME reference for the
                          same request, so fixing only the table would leave
                          the bare id on every phone. */}
                      {/* objectui#8631: and the same cause-free affordance as
                          the desktop row. This card used to consult NO probe at
                          all, so a phone kept the opaque id after the table had
                          stopped showing it — the dead end moved viewport, not
                          away. */}
                      {(() => {
                        const deadLabel = deadLabelFor(r);
                        const unresolvableLabel = unresolvableLabelFor(r);
                        return (
                          <div className="text-sm truncate">
                            {deadLabel !== null ? (
                              <span className="italic text-muted-foreground">{deadLabel}</span>
                            ) : unresolvableLabel !== null ? (
                              <span className="italic text-muted-foreground">{unresolvableLabel}</span>
                            ) : (
                              r.record_title || formatIdentity(r.record_id)
                            )}
                            <span className="text-muted-foreground text-xs ml-1.5">{objectDisplay(r)}</span>
                            {deadLabel !== null && r.record_title && (
                              <span className="text-muted-foreground text-xs ml-1.5">· {r.record_title}</span>
                            )}
                            {(() => {
                              // objectui#6020: this row's OWN object decides.
                              const amount = decisionAmountEntry(r, hiddenFields.forObject(r.object_name), displayLocale);
                              return amount ? (
                                <span className="text-xs ml-1.5 font-medium" title={amount.label}>· {amount.display}</span>
                              ) : null;
                            })()}
                          </div>
                        );
                      })()}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        {isSystemSubmitter(r) ? (
                          <span className="inline-flex items-center gap-1 truncate italic">
                            <Workflow className="h-3 w-3" />{tr('flowOrigin', 'Flow-initiated')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 truncate">
                            <UserIcon className="h-3 w-3" />{submitterDisplay(r)}
                          </span>
                        )}
                        <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', agingClass(r, now))}>
                          <Clock className="h-3 w-3" />{formatRelative(submittedAt(r))}
                        </span>
                      </div>
                      {isActionable(r) && (
                        // #2829: outputs-declaring requests decide only via the
                        // request page's dialog — quick buttons disable with the hint.
                        <div
                          className="flex gap-2 pt-1"
                          onClick={(e) => e.stopPropagation()}
                          title={needsDecisionInputs(r)
                            ? tr('needsDecisionInputs', 'This approval collects decision outputs — open it to decide.')
                            : undefined}
                        >
                          <Button size="sm" className="h-7 flex-1" disabled={inlineActing === r.id || needsDecisionInputs(r)} onClick={() => setApproveTarget(r)}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />{tr('approve', 'Approve')}
                          </Button>
                          <Button
                            size="sm" variant="outline" className="h-7 flex-1 border-destructive text-destructive"
                            disabled={inlineActing === r.id || needsDecisionInputs(r)} onClick={() => setRejectTarget(r)}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />{tr('reject', 'Reject')}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {tab !== 'pending' && total != null && (
                <div className="flex items-center justify-center gap-3 py-1">
                  <span className="text-xs text-muted-foreground">
                    {tr('loadedOf', 'Loaded {{loaded}} of {{total}}', { loaded: rows.length, total })}
                  </span>
                  {rows.length < total && (
                    <Button size="sm" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                      {loadingMore ? tr('loadingMore', 'Loading…') : tr('loadMore', 'Load more')}
                    </Button>
                  )}
                </div>
              )}

              <div className="hidden md:block text-[11px] text-muted-foreground">
                {tr('keyboardHint', 'Keyboard: j/k move · Enter open · x select · a approve · r reject')}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Shared inline-approve confirmation (#2762 P0-2) */}
      <AlertDialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr('approveOneTitle', 'Approve "{{title}}"?', {
                title: approveTarget ? (approveTarget.record_title || formatIdentity(approveTarget.record_id)) : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr('approveOneBody', 'This approves the request with your identity. To add a comment or attachment, open the request instead.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void inlineApprove()}>
              {tr('approve', 'Approve')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Shared inline-reject confirmation */}
      <AlertDialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr('rejectOneTitle', 'Reject "{{title}}"?', {
                title: rejectTarget ? (rejectTarget.record_title || formatIdentity(rejectTarget.record_id)) : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr('rejectOneBody', 'This rejects the request and notifies the submitter.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void inlineReject()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tr('reject', 'Reject')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
  );
}
