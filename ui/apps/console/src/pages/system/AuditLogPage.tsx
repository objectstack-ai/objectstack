/**
 * Audit Log Page (system route)
 *
 * Read-only browser for `sys_audit_log` records, served at the standalone
 * route `/system/audit-log` and registered as the `audit:log` component ref
 * that framework navigation can name (`registerSystemComponents.tsx`,
 * objectui#10520). Talks to the framework REST endpoint
 * `/api/v1/data/sys_audit_log` with standard ObjectQL filter params.
 *
 * Field shape mirrors `sys_audit_log` as objectstack declares it
 * (packages/plugins/plugin-audit/src/objects/sys-audit-log.object.ts,
 * snake_case columns).
 *
 * Scope (MVP):
 *  - Filter by action (the declared options of `sys_audit_log.action`,
 *    objectui#13175; see `actionFilterOptionsOf` in `auditLogActions.ts`) /
 *    object (picked from the served objects, objectui#13165; see
 *    `objectFilterOptionsOf` below) / actor (a `sys_user` lookup) / date range
 *  - Presets: the list views `sys_audit_log` SERVES (Writes, Auth, …), read
 *    from the console's object metadata, never copied here (objectui#12667).
 *    See `auditPresetsOf` below
 *  - "Open as list": the `sys_audit_log` object list, on the active preset's
 *    own view when one is chosen (objectui#12667)
 *  - The actor is named, not shown as a raw id (objectui#11701): see
 *    `actorOf` below
 *  - Paginated table (50/page)
 *  - Row click opens a side drawer with full event details + JSON
 *    diff of old_value → new_value when present
 *
 * Out of scope (future):
 *  - Cross-tenant filter (single-tenant view assumed)
 *  - CSV export / saved filter
 *  - Field-level redaction of old/new value payloads (handled server-side
 *    once FLS lands)
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { mergeFilterNodes, toFilterNodeSafely } from '@object-ui/core';
import { useDisplayLocale } from '@object-ui/i18n';
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
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
  Empty,
  EmptyTitle,
  EmptyDescription,
  Alert,
  AlertDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Combobox,
  type ComboboxOption,
} from '@object-ui/components';
import { LookupField, objectRefOptionLabel } from '@object-ui/fields';
import { ConsolePageHeader, useAdapter, useMetadata } from '@object-ui/app-shell';
import { Search, X, AlertCircle, ScrollText, ExternalLink } from 'lucide-react';
import { actionBadgeVariant, actionFilterOptionsOf } from './auditLogActions';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
const API_BASE = `${SERVER_URL}/api/v1`;

interface AuditRow {
  id: string;
  created_at?: string;
  action?: string;
  /**
   * `sys_audit_log.user_id` is a lookup to `sys_user`. The list fetch asks for
   * `$expand=user_id`, so a resolved actor arrives as the user's record and an
   * unresolved one (the user is gone, or the viewer may not read them) as the
   * bare id. `null` means no user made the change.
   */
  user_id?: string | Record<string, unknown> | null;
  /** The principal that acted: a user id, `svc:NAME` for a service, or null for the system. */
  actor?: string | null;
  object_name?: string | null;
  record_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  tenant_id?: string | null;
  metadata?: string | null;
  [extra: string]: unknown;
}

const PAGE_SIZE = 50;

/** The object this page browses. */
const AUDIT_OBJECT = 'sys_audit_log';

/** The served `sys_audit_log` document among the console's served objects, if any. */
function auditObjectOf(objects: readonly unknown[]): unknown {
  return objects.find((o) => (o as { name?: unknown } | null)?.name === AUDIT_OBJECT);
}

/**
 * One served list view of `sys_audit_log`, as this browser offers it
 * (objectui#12667).
 *
 * `applies: true` carries the view's own `filter`, lowered to the query AST by
 * `@object-ui/core`'s `toFilterNodeSafely` — the same lowering the object
 * list's grid runs on the same view, so a preset and its list ask the server
 * one question. `node` is `undefined` for a view that declares no filter (the
 * unfiltered `Recent` / `All`).
 *
 * `applies: false` is a view this browser cannot express. It is offered
 * disabled with its reason and a link to the view in the list, ⛔ never
 * dropped and never approximated: a preset that silently widened its filter
 * would show an auditor rows the view's name says are not there.
 *
 * Only the view's filter is taken. Columns, sort and page size stay the
 * browser's own.
 */
/** A lowered filter, as `@object-ui/core`'s filter lowering hands it back. */
type WhereNode = Exclude<ReturnType<typeof mergeFilterNodes>, undefined>;

type AuditPreset =
  | { key: string; label: string; applies: true; node: WhereNode | undefined }
  | { key: string; label: string; applies: false; reason: string };

/**
 * The presets for `sys_audit_log`'s object document as the console's metadata
 * serves it: one per `listViews` entry, in served order, keyed by the entry's
 * key — the same id the object list's view switcher and its
 * `…/view/:viewId` route use.
 *
 * Nothing here names a view: whatever the platform declares on the object is
 * what the browser offers. `listViews` is the only spelling read (#5362;
 * `@objectstack/spec` declares only camelCase).
 */
function auditPresetsOf(objectDef: unknown): AuditPreset[] {
  const listViews = (objectDef as { listViews?: unknown } | null | undefined)?.listViews;
  if (!listViews || typeof listViews !== 'object') return [];
  const presets: AuditPreset[] = [];
  for (const [key, raw] of Object.entries(listViews as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const view = raw as { label?: unknown; filter?: unknown; data?: unknown };
    const label = typeof view.label === 'string' && view.label.trim() ? view.label : key;
    // A view bound to another source answers a different question than this
    // page's fetch of `sys_audit_log`.
    const data = view.data as { provider?: unknown; object?: unknown } | undefined;
    if (data && typeof data === 'object' && (data.provider !== 'object' || data.object !== AUDIT_OBJECT)) {
      presets.push({ key, label, applies: false, reason: 'This view reads another data source.' });
      continue;
    }
    const lowered = toFilterNodeSafely(view.filter);
    if (!lowered.ok) {
      presets.push({ key, label, applies: false, reason: `This view's filter cannot be applied here: ${lowered.refusal.message}` });
      continue;
    }
    presets.push({ key, label, applies: true, node: lowered.node });
  }
  return presets;
}

/**
 * The Object filter's choices (objectui#13165): one per object the console's
 * metadata serves, valued by its API name and labelled `Label (name)`, the
 * spelling the `object-ref` picker gives an object (`objectRefOptionLabel`),
 * sorted by that label in the display locale.
 *
 * The filter commits the chosen value, the API name, which is what
 * `sys_audit_log.object_name` stores and what the list fetch matches exactly.
 * It used to be a free-text box matched the same way under the placeholder
 * "e.g. account": in an app whose objects carry a prefix that example matched
 * no row (`crm_account` held them), and finding any object meant knowing its
 * API name. Picking it, as the actor filter picks a user (objectui#11701),
 * leaves nothing to guess.
 *
 * Nothing here names an object. The list is the served registry, the same
 * `useMetadata().objects` read the presets come from.
 */
function objectFilterOptionsOf(objects: readonly unknown[], locale: string): ComboboxOption[] {
  const options: ComboboxOption[] = [];
  for (const raw of objects) {
    const object = raw as { name?: unknown; label?: unknown } | null | undefined;
    if (!object || typeof object.name !== 'string' || !object.name) continue;
    const label = typeof object.label === 'string' && object.label.trim() ? object.label.trim() : undefined;
    options.push({ value: object.name, label: objectRefOptionLabel(object.name, label) });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, locale));
}

/**
 * `locale` is REQUIRED: the log's timestamp column used to format with no
 * tag, i.e. in the MACHINE's locale (objectui#9909). The page passes
 * `useDisplayLocale()`; the `catch` is for an unparseable value.
 */
function formatDate(s: string | null | undefined, locale: string): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(locale); } catch { return s; }
}

function truncate(s: string | null | undefined, n = 24): string {
  if (!s) return '—';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function tryPrettyJson(s: string | null | undefined): string {
  if (!s) return '';
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

/** Who acted on one audit row, as the column and the drawer show it. */
type ActorFace =
  | {
      kind: 'user';
      /** The user's display name, when the expanded record carries one. */
      name: string | null;
      /** The user id, resolved or not. Shown on hover and in the drawer. */
      id: string | null;
    }
  | {
      kind: 'system';
      /** The recorded principal (`svc:NAME`), if any. */
      principal: string | null;
    };

/**
 * The actor of an audit row (objectui#11701).
 *
 * The fetch expands `user_id`, and the engine replaces the id in place with
 * the `sys_user` record. It keeps the bare id when that record cannot be read
 * (the user is gone, or the viewer may not see them). Such a row shows the id,
 * never a blank. `name` is `sys_user`'s declared name field. A record whose
 * `name` the viewer may not read is shown by its id.
 *
 * A `null` `user_id` is a change no user made. The writer records the system
 * as `null` and a service as `svc:NAME` on `actor`. Both read "System", and
 * the principal stays on hover and in the drawer.
 */
function actorOf(row: AuditRow): ActorFace {
  const ref = row.user_id;
  if (ref && typeof ref === 'object') {
    const id = typeof ref.id === 'string' && ref.id ? ref.id : null;
    const name = typeof ref.name === 'string' && ref.name.trim() ? ref.name.trim() : null;
    return { kind: 'user', name, id };
  }
  if (typeof ref === 'string' && ref) return { kind: 'user', name: null, id: ref };
  const principal = typeof row.actor === 'string' && row.actor.trim() ? row.actor.trim() : null;
  return { kind: 'system', principal };
}

/** The actor column's face: the name with the id on hover, else the id, else "System". */
function ActorCell({ face }: { face: ActorFace }) {
  if (face.kind === 'system') {
    return <span className="text-muted-foreground" title={face.principal ?? undefined}>System</span>;
  }
  if (face.name) return <span title={face.id ?? undefined}>{face.name}</span>;
  return <span className="font-mono text-xs" title={face.id ?? undefined}>{truncate(face.id, 18)}</span>;
}

/** The drawer's actor row: the name, then the full id (or the principal) to copy. */
function ActorDetail({ face }: { face: ActorFace }) {
  if (face.kind === 'system') {
    return (
      <>
        <div>System</div>
        {face.principal && <div className="font-mono text-xs break-all">{face.principal}</div>}
      </>
    );
  }
  return (
    <>
      {face.name && <div>{face.name}</div>}
      <div className="font-mono text-xs break-all">{face.id || '—'}</div>
    </>
  );
}

export function AuditLogPage() {
  const displayLocale = useDisplayLocale();
  // The actor filter's user lookup queries `sys_user` through the console's adapter.
  const adapter = useAdapter();
  const { appName } = useParams<{ appName?: string }>();
  // The served `sys_audit_log` document, read through the console's metadata
  // cache — the same read the object list's view switcher draws from.
  const { objects, getTypeStatus } = useMetadata();
  const presets = useMemo(() => auditPresetsOf(auditObjectOf(objects)), [objects]);
  // The Action filter offers what the same document declares for
  // `sys_audit_log.action` (objectui#13175), never a list kept here.
  const actionOptions = useMemo(() => actionFilterOptionsOf(auditObjectOf(objects)), [objects]);
  // The Object filter picks from the same served objects (objectui#13165).
  const objectOptions = useMemo(() => objectFilterOptionsOf(objects, displayLocale), [objects, displayLocale]);
  const objectsLoading = getTypeStatus?.('object') === 'loading';
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters. Each filter control is named by its visible label: the label's
  // `htmlFor` names the control's own `id` (objectui#13224).
  const [actionFilter, setActionFilter] = useState<string>('all');
  const actionFilterId = useId();
  /** The chosen object's API name, or '' for any object. */
  const [objectFilter, setObjectFilter] = useState<string>('');
  const objectFilterId = useId();
  /** The chosen user's id, or '' for any actor. */
  const [actorFilter, setActorFilter] = useState<string>('');
  const actorFilterId = useId();
  const [fromDate, setFromDate] = useState<string>('');  // YYYY-MM-DD
  const fromDateId = useId();
  const [toDate, setToDate] = useState<string>('');
  const toDateId = useId();
  /** The presets row is named by its visible caption. */
  const presetsCaptionId = useId();
  /** The chosen preset's view key, or null for none. */
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const activePreset = presets.find((p) => p.key === presetKey && p.applies);
  // The effect below keys on the preset's filter as a STRING, never on the
  // memoised preset object (AGENTS.md #10).
  const presetWhere = JSON.stringify(activePreset && activePreset.applies ? activePreset.node ?? null : null);

  // Pagination
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Selection
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filter: Record<string, unknown> = {};
      if (actionFilter && actionFilter !== 'all') filter.action = actionFilter;
      if (objectFilter) filter.object_name = objectFilter;
      if (actorFilter.trim()) filter.user_id = actorFilter.trim();
      if (fromDate) filter.created_at = { ...(filter.created_at as object || {}), $gte: fromDate };
      if (toDate) filter.created_at = { ...(filter.created_at as object || {}), $lte: `${toDate}T23:59:59` };

      const params = new URLSearchParams();
      // A preset's filter is sent as the view declares it, beside the bar's
      // filters under one `and` — each source its own child.
      const presetNode = JSON.parse(presetWhere) as WhereNode | null;
      const where = presetNode !== null ? mergeFilterNodes(filter, presetNode) : filter;
      if (where !== undefined && (Array.isArray(where) || Object.keys(where).length > 0)) {
        params.set('$filter', JSON.stringify(where));
      }
      // Name the actor on this one read: the engine batch-loads the referenced
      // users and puts each record in place of its id (objectui#11701).
      params.set('$expand', 'user_id');
      params.set('$orderby', 'created_at desc');
      params.set('$top', String(PAGE_SIZE + 1));  // +1 to detect hasMore
      params.set('$skip', String(page * PAGE_SIZE));

      const res = await fetch(`${API_BASE}/data/sys_audit_log?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}`);
      }
      const json = await res.json();
      // REST envelope: { object, records, total, hasMore }
      const items: AuditRow[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.records)
          ? json.records
          : Array.isArray(json?.data)
            ? json.data
            : [];
      setHasMore(items.length > PAGE_SIZE);
      setRows(items.slice(0, PAGE_SIZE));
    } catch (err: any) {
      console.warn('[AuditLogPage] load failed:', err);
      setError(err?.message || 'Failed to load audit log');
      setRows([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, objectFilter, actorFilter, fromDate, toDate, presetWhere, page]);

  useEffect(() => { load(); }, [load]);

  const resetFilters = useCallback(() => {
    setActionFilter('all');
    setObjectFilter('');
    setActorFilter('');
    setFromDate('');
    setToDate('');
    setPresetKey(null);
    setPage(0);
  }, []);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (actionFilter !== 'all') n += 1;
    if (objectFilter) n += 1;
    if (actorFilter.trim()) n += 1;
    if (fromDate) n += 1;
    if (toDate) n += 1;
    if (activePreset) n += 1;
    return n;
  }, [actionFilter, objectFilter, actorFilter, fromDate, toDate, activePreset]);

  // The object list, on the active preset's own view when one is chosen.
  const listBase = `/apps/${encodeURIComponent(appName || 'setup')}/${AUDIT_OBJECT}`;
  const viewHref = (key: string) => `${listBase}/view/${encodeURIComponent(key)}`;
  const listHref = activePreset ? viewHref(activePreset.key) : listBase;

  return (
    <div>
    {/* The console's one page header (objectui#12553), the one an object list,
        a dashboard and the Approvals Inbox draw: icon chip, title, the
        subtitle beside the title from `sm` up, and Refresh at the right, in
        one row across the page above the padded body. Below `sm` the header
        hides the subtitle and keeps the icon, title and Refresh. */}
    <ConsolePageHeader
      title="Audit Log"
      subtitle="Read-only system activity and record changes. Newest first."
      icon={<ScrollText className="h-4 w-4" />}
      // The header's own Refresh icon button (objectui#12606).
      refresh={{ onRefresh: load, label: 'Refresh', busy: loading }}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to={listHref}>
            <ExternalLink className="h-4 w-4 mr-1" />
            Open as list
          </Link>
        </Button>
      }
    />
    <div className="p-6 space-y-4 max-w-screen-2xl mx-auto">
      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          {presets.length > 0 && (
            <div className="md:col-span-5 flex flex-wrap items-center gap-2" role="group" aria-labelledby={presetsCaptionId}>
              <span id={presetsCaptionId} className="text-xs text-muted-foreground mr-1">Presets</span>
              {presets.map((p) => p.applies ? (
                <Button
                  key={p.key}
                  size="sm"
                  variant={p.key === activePreset?.key ? 'default' : 'outline'}
                  aria-pressed={p.key === activePreset?.key}
                  onClick={() => { setPresetKey(p.key === activePreset?.key ? null : p.key); setPage(0); }}
                >
                  {p.label}
                </Button>
              ) : (
                <span key={p.key} className="inline-flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled aria-pressed={false} title={p.reason}>
                    {p.label}
                  </Button>
                  <Link
                    to={viewHref(p.key)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Open ${p.label} as list`}
                    title={p.reason}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </span>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={actionFilterId} className="text-xs">Action</Label>
            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(0); }}>
              <SelectTrigger id={actionFilterId} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actionOptions.map((a) => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={objectFilterId} className="text-xs">Object</Label>
            {/* Picked from the served objects, never typed (objectui#13165):
                it commits the object's API name, and choosing the chosen
                object again commits '' for any object. A combobox takes no
                name from its content, so the label names it. */}
            <Combobox
              id={objectFilterId}
              options={objectOptions}
              value={objectFilter}
              onValueChange={(v) => { setObjectFilter(v); setPage(0); }}
              placeholder="Any object"
              searchPlaceholder="Search objects…"
              emptyText={objectsLoading ? 'Loading objects…' : 'No objects found.'}
              className="h-9 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={actorFilterId} className="text-xs">Actor</Label>
            {/* The same lookup a `sys_user` reference field gets. It commits the
                chosen user's id, and removing the chip commits null. Its `id`
                reaches the lookup's trigger button, the control the label
                names. */}
            <LookupField
              id={actorFilterId}
              value={actorFilter || null}
              onChange={(v: unknown) => { setActorFilter(v == null ? '' : String(v)); setPage(0); }}
              dataSource={adapter}
              field={{
                type: 'lookup',
                name: 'user_id',
                label: 'Actor',
                reference: 'sys_user',
                placeholder: 'Any user',
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fromDateId} className="text-xs">From</Label>
            <Input id={fromDateId} type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0); }} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={toDateId} className="text-xs">To</Label>
            <Input id={toDateId} type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0); }} className="h-9" />
          </div>
          {activeFilterCount > 0 && (
            <div className="md:col-span-5 flex justify-end">
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <X className="h-4 w-4 mr-1" />
                Clear filters ({activeFilterCount})
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading && rows.length === 0 ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12">
              <Empty>
                <Search className="h-8 w-8 text-muted-foreground mb-3" />
                <EmptyTitle>No audit entries</EmptyTitle>
                <EmptyDescription>
                  {activeFilterCount > 0
                    ? 'Try clearing filters or widening the date range.'
                    : 'Events will appear here once tracked objects are modified.'}
                </EmptyDescription>
              </Empty>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Timestamp</TableHead>
                  <TableHead className="w-[130px]">Action</TableHead>
                  <TableHead>Object</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="w-[130px]">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const variant = actionBadgeVariant(r.action);
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(r)}
                    >
                      <TableCell className="font-mono text-xs">{formatDate(r.created_at, displayLocale)}</TableCell>
                      <TableCell><Badge variant={variant}>{r.action || '—'}</Badge></TableCell>
                      <TableCell>{r.object_name || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{truncate(r.record_id, 18)}</TableCell>
                      <TableCell><ActorCell face={actorOf(r)} /></TableCell>
                      <TableCell className="font-mono text-xs">{r.ip_address || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {(rows.length > 0 || page > 0) && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page + 1}{hasMore ? '' : ' · end'}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="sm:max-w-2xl w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Badge variant={actionBadgeVariant(selected?.action)}>
                {selected?.action || '—'}
              </Badge>
              {selected?.object_name || 'Audit Event'}
            </SheetTitle>
            <SheetDescription>
              {selected?.id ? <span className="font-mono text-xs">{selected.id}</span> : null}
            </SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="mt-6 space-y-5">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Timestamp</div>
                  <div className="font-mono">{formatDate(selected.created_at, displayLocale)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">IP Address</div>
                  <div className="font-mono">{selected.ip_address || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Actor</div>
                  <ActorDetail face={actorOf(selected)} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Tenant</div>
                  <div className="font-mono break-all">{selected.tenant_id || '—'}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Target record</div>
                  <div className="font-mono text-sm break-all">
                    {selected.object_name || '—'} / {selected.record_id || '—'}
                  </div>
                </div>
                {selected.user_agent && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">User Agent</div>
                    <div className="font-mono text-xs break-all">{selected.user_agent}</div>
                  </div>
                )}
              </div>

              {(selected.old_value || selected.new_value) && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Change payload</div>
                    {selected.old_value && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Before</div>
                        <pre className="rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto">
                          {tryPrettyJson(selected.old_value)}
                        </pre>
                      </div>
                    )}
                    {selected.new_value && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">After</div>
                        <pre className="rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto">
                          {tryPrettyJson(selected.new_value)}
                        </pre>
                      </div>
                    )}
                  </div>
                </>
              )}

              {selected.metadata && (
                <>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium mb-2">Metadata</div>
                    <pre className="rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-auto">
                      {tryPrettyJson(selected.metadata)}
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
    </div>
  );
}
