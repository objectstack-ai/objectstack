// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PackagesPage — the package management entry point for Studio.
 *
 * Studio previously exposed packages only through the sidebar `active_package`
 * *filter* dropdown; there was no surface to see all packages, create one, or
 * act on one (publish / revert / enable / disable). This page fills that gap.
 *
 * It is the authoring home for the Studio → package → publish workflow:
 *   1. Create a package (POST /api/v1/packages with a minimal manifest).
 *   2. Author metadata bound to it (via the sidebar scope + ResourceEditPage).
 *   3. Publish it (POST /api/v1/packages/:id/publish).
 *
 * Backed entirely by the existing `/api/v1/packages` REST surface
 * (see framework `http-dispatcher.handlePackages`).
 */

import * as React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  Package as PackageIcon,
  Plus,
  Search,
  Upload,
  Download,
  FileUp,
  Undo2,
  Power,
  PowerOff,
  ExternalLink,
  AlertTriangle,
  Trash2,
  Copy,
  Inbox,
  Pencil,
  Eye,
  MoreHorizontal,
} from 'lucide-react';
import {
  Button,
  Input,
  Badge,
  Switch,
  Label,
  Separator,
  Skeleton,
  Empty,
  EmptyTitle,
  EmptyDescription,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  RadioGroup,
  RadioGroupItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { useMetadataLocale, t, tFormat } from './i18n.js';
import { useMetadataClient } from './useMetadata.js';
import { PackageFormDialog } from './PackageFormDialog.js';
import { PageHeader } from '../../layout/PageHeader.js';
import { errorCodeIs } from '@object-ui/types';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';
import { refusedItemsText } from '../../preview/publishRefusal.js';
import { RefusalMessage } from '../../components/RefusalMessage.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { duplicatePackage, isSpecPackageId } from '../studio-design/packages-io.js';
import { PackageIdInput } from '../studio-design/PackageIdInput.js';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { getRuntimeConfig } from '../../runtime-config.js';
import { readMarketplaceInstalls, type LocalInstallEntry } from '../../console/marketplace/marketplaceApi.js';
import { MarketplaceNotLoaded, MarketplaceRowActions } from '../../console/marketplace/MarketplaceRowActions.js';
import type { InstalledPackageAtEitherStage } from '@objectstack/spec/api-assembled';
import type { PackagePublishResult } from '@objectstack/spec/system';
import type { ReassignOrphanedMetadataResponse } from '@objectstack/spec/api';
import {
  PACKAGES_SOURCE_PARAM,
  PackageSourceRefusal,
  readServedSource,
  readSourceFilter,
  type PackageSource,
} from './packageSource.js';

/* -------------------------------------------------------------------------- */
/* Types + API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The subset of a package manifest this admin LIST renders, kept open.
 *
 * Named `PackageManifestRow`, not `PackageManifest`, and deliberately NOT
 * derived (objectstack#4115). `@objectstack/spec/cloud` owns `PackageManifest`
 * — the full authored manifest, with `defaultDatasource`, `type`, `scope`,
 * `dependencies`, `contributes`, `capabilities`, `sandboxing` and ~30 more keys
 * required or modelled. This page reads whatever `/api/v1/packages` happens to
 * return, from runtimes of different vintages, and renders six columns from it;
 * every key is optional here because an older control plane really does omit
 * them, and the index signature is load-bearing — it lets a row flow into the
 * spec-driven `PackageFormDialog` (which types the manifest as a loose record)
 * without a cast, and preserves keys this page does not render.
 *
 * So this is a lenient READ PROJECTION over the spec's manifest, not a second
 * definition of it: it must stay assignable-from anything the wire sends, which
 * is the opposite of what the spec type is for. `__tests__/spec-symbol-parity.test.ts`
 * pins that the spec does not own the `…Row` name and that the projection's keys
 * are a subset of the spec manifest's, so a key invented here fails loudly.
 */
export interface PackageManifestRow {
  id: string;
  name?: string;
  version?: string;
  type?: string;
  scope?: 'cloud' | 'system' | 'project';
  description?: string;
  [key: string]: unknown;
}

/**
 * One installed-package row, as `/api/v1/packages` returns it.
 *
 * Named `InstalledPackageRow` for the same reason: the spec's
 * `InstalledPackage` (`@objectstack/spec/kernel`) requires `manifest`,
 * `status` and `enabled`, types `manifest` as the full spec `PackageManifest`,
 * and adds `installedAt`, `updatedAt`, `installedVersion`, `previousVersion`,
 * `settings`, `upgradeHistory` and `registeredNamespaces`. This row is the
 * lenient projection of it that the list actually consumes — except for the
 * two statements the list draws a column from, which are taken from the
 * served row's own declaration rather than spelled again here.
 *
 * `source` and `writable` come from `InstalledPackageAtEitherStage`
 * (`@objectstack/spec/api-assembled`, the element both read doors serve), both
 * required there (objectstack#24010) and both separate statements:
 *  - `source` — where the package came from: the Source column and the
 *    `?source=` filter read it (`packageSource.ts`, objectui#12790);
 *  - `writable` — what the server lets an org do to the package
 *    (objectstack#14375): the Scope badge's writable / read-only half reads it
 *    (objectui#12723). ⛔ Never a Source signal.
 *
 * The list reads both at load (`UncheckedPackageRow` below is the wire before
 * that read) and refuses a row by name when either is missing.
 */
export interface InstalledPackageRow extends Pick<InstalledPackageAtEitherStage, 'source' | 'writable'> {
  manifest: PackageManifestRow;
  status?: string;
  enabled?: boolean;
  statusChangedAt?: string;
  errorMessage?: string;
}

/**
 * A `/api/v1/packages` row as the wire hands it, before the list has read its
 * two declared statements: `source` and `writable` are whatever arrived, and
 * only the list's load turns one into an {@link InstalledPackageRow}.
 */
type UncheckedPackageRow = Omit<InstalledPackageRow, 'source' | 'writable'> & {
  source?: unknown;
  writable?: unknown;
};

const API = '/api/v1/packages';

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok || payload?.success === false) {
    // The ADR-0112 envelope first, by the ONE shared rule — a producer-marked
    // `error.userMessage` outranks the diagnostic `error.message`, and
    // `error.code` rides along behind whichever won. This helper used to read
    // `error.message` and stop, so a marked sentence arrived on the wire (both
    // doors serving these package routes emit the channel) and had nowhere to
    // appear. See {@link readEnvelopeFailureText}.
    //
    // The two rungs BELOW it stay, and stay here rather than moving into the
    // shared reader: they are not the ADR-0112 envelope. A bare-string `error`
    // and a top-level `message` are older runtimes' shapes, live for this page
    // and not for the Studio readers, and folding them in would have handed
    // every other consumer of the rule a tolerant dialect it never asked for.
    const msg =
      readEnvelopeFailureText(payload) ||
      payload?.error ||
      payload?.message ||
      `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : `Request failed (${res.status})`);
  }
  // Runtime wraps successful payloads in { data, ... } or returns the object directly.
  return (payload?.data ?? payload) as T;
}

/* -------------------------------------------------------------------------- */
/* Scope badge                                                                 */
/* -------------------------------------------------------------------------- */

function ScopeBadge({ pkg }: { pkg: InstalledPackageRow }) {
  const locale = useMetadataLocale();
  // objectui#12723 — the writable / read-only half is the server's verdict,
  // the row's top-level `writable` (objectstack#14375, `isWritablePackage`),
  // never a guess from `scope`. A scope-less row is NOT necessarily a writable
  // base: a marketplace install and a scope-less booted code package are both
  // scope-less and served `writable: false`. `scope` only names WHICH kind of
  // read-only package it is (system / cloud / project).
  //
  // A list row with no boolean verdict never reaches this badge: the list
  // refuses it at load (`PACKAGE_WRITABLE_UNKNOWN`, below). The detail sheet
  // can also be opened on a row fetched elsewhere (Studio's package switcher);
  // should one without a verdict get here, it is drawn as an unknown dash —
  // never as writable.
  const { writable } = pkg;
  if (typeof writable !== 'boolean') {
    return <span data-testid="pkg-scope-unknown">—</span>;
  }
  if (writable) {
    return (
      <Badge
        data-testid="pkg-scope"
        className="bg-emerald-400/15 text-emerald-600 hover:bg-emerald-400/15 dark:text-emerald-300"
      >
        {t('engine.packages.scope.writable', locale)}
      </Badge>
    );
  }
  const scope = pkg.manifest.scope;
  const variant =
    scope === 'system' ? 'secondary' : scope === 'cloud' ? 'outline' : 'default';
  const labelKey =
    scope === 'project'
      ? 'engine.packages.scope.project'
      : scope === 'system'
        ? 'engine.packages.scope.system'
        : scope === 'cloud'
          ? 'engine.packages.scope.cloud'
          : 'engine.packages.scope.readOnly';
  return (
    <Badge data-testid="pkg-scope" variant={variant}>
      {t(labelKey, locale)}
    </Badge>
  );
}

function StatusBadge({ pkg }: { pkg: InstalledPackageRow }) {
  const locale = useMetadataLocale();
  const enabled = pkg.enabled !== false && pkg.status !== 'disabled';
  return (
    <Badge variant={enabled ? ('default' as any) : ('outline' as any)}>
      {enabled ? t('engine.packages.status.enabled', locale) : t('engine.packages.status.disabled', locale)}
    </Badge>
  );
}

const SOURCE_BADGE_CLASS: Record<PackageSource, string> = {
  code: '',
  marketplace: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  authored: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
};

/** One of the closed Source values (objectui#12675); never anything else. */
function SourceBadge({ source }: { source: PackageSource }) {
  const locale = useMetadataLocale();
  return (
    <Badge variant="outline" className={SOURCE_BADGE_CLASS[source]} data-testid="pkg-source" data-source={source}>
      {t(`engine.packages.source.${source}`, locale)}
    </Badge>
  );
}

/** A Source refusal, in the page's words (see `packageSource.ts`). */
function sourceRefusalText(e: PackageSourceRefusal, locale: string): string {
  switch (e.code) {
    case 'PACKAGE_SOURCE_UNKNOWN':
      return tFormat('engine.packages.source.unknown', locale, { id: e.subject });
    case 'PACKAGE_SOURCE_FILTER_UNKNOWN':
      return tFormat('engine.packages.source.filterUnknown', locale, { value: e.subject });
    case 'PACKAGE_SOURCE_FILTER_REPEATED':
      return tFormat('engine.packages.source.filterRepeated', locale, { value: e.subject });
  }
}

/**
 * A served row whose `writable` verdict is absent or not a boolean
 * (`PACKAGE_WRITABLE_UNKNOWN`). The Scope badge draws its writable / read-only
 * half from that verdict (objectui#12723) and the served row declares it
 * required, so the list refuses the row by its id instead of drawing a badge
 * it cannot decide. Its own refusal, separate from the Source one: `writable`
 * never names a row's Source, and its absence is never read as one.
 */
class PackageWritableRefusal extends Error {
  readonly code = 'PACKAGE_WRITABLE_UNKNOWN';
  /** The package id. */
  readonly subject: string;

  constructor(subject: string) {
    super(`PACKAGE_WRITABLE_UNKNOWN: ${subject}`);
    this.name = 'PackageWritableRefusal';
    this.subject = subject;
  }
}

/** One `validationErrors` element of the package publish door's answer (the spec's shape). */
type PackagePublishValidationError = NonNullable<PackagePublishResult['validationErrors']>[number];

/**
 * A package publish the server refused, carrying the server's own reasons
 * (objectui#13160).
 *
 * `POST /packages/:id/publish` answers a refusal on a 200: its
 * `PackagePublishResult` says `success: false`, nothing was published, and
 * `validationErrors` holds one `message` per reason, each against the item
 * (`type`, `name`) it judged. The sheet used to throw the count sentence alone,
 * so the author read "Publish blocked by 1 validation error(s)." and never the
 * reason. `message` stays that count sentence, the heading the sheet shows;
 * `reasons` are the lines under it, in the server's words.
 */
class PackagePublishRefusal extends Error {
  readonly reasons: readonly string[];

  constructor(heading: string, reasons: readonly string[]) {
    super(heading);
    this.name = 'PackagePublishRefusal';
    this.reasons = reasons;
  }
}

/**
 * A `validationErrors` element as one line: the item it names, then the
 * server's message. Where a reason belongs to no one item the producer leaves
 * `name` empty (a namespace the whole package lacks: `api: …`), or `type` and
 * `name` both (a package with no items), and the line then names only what it
 * was given, or is the message alone.
 */
function publishRefusalLine(error: PackagePublishValidationError): string {
  const subject = [error.type, error.name].filter(Boolean).join('/');
  return subject ? `${subject}: ${error.message}` : error.message;
}

/**
 * One line of the list: a registry package with its served Source, or a
 * marketplace install the runtime did not load (it has no registry row, but it
 * is installed, and Uninstall acts on it — objectui#11645).
 *
 * `install` is the marketplace slice's entry for the package, and only a row
 * whose Source is `marketplace` carries one: it is what the row actions act on,
 * never a signal that names the Source.
 */
interface PackageListRow {
  id: string;
  pkg: InstalledPackageRow | null;
  source: PackageSource;
  install: LocalInstallEntry | null;
}

/**
 * The marketplace entry a row's Actions cell acts on, or `null` when the cell
 * has nothing to draw: only a marketplace row with an install entry carries
 * row actions. The Actions header reads this same answer over the rows in view
 * (objectui#13166), so a header never stands over a column of empty cells.
 */
function rowActionEntry(row: PackageListRow): LocalInstallEntry | null {
  return row.source === 'marketplace' ? row.install : null;
}

/* -------------------------------------------------------------------------- */
/* Create-package dialog                                                       */
/* -------------------------------------------------------------------------- */

/**
 * CreatePackageDialog — thin wrapper over the spec-driven {@link PackageFormDialog}.
 * Kept as a named export so existing call sites (ResourceListPage, the Studio
 * package switcher) don't change. The form fields + validation now come from
 * the manifest spec (`package-schema`), not a hand-written field list.
 */
export function CreatePackageDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  return (
    <PackageFormDialog
      mode="create"
      open={open}
      onOpenChange={onOpenChange}
      onSaved={(r) => onCreated(r.id)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Detail sheet — manifest + lifecycle actions                                 */
/* -------------------------------------------------------------------------- */

// The value wraps at word boundaries first (objectui#13166): `break-all` let the
// browser break between any two letters, so a Description read "marketplac / e"
// and "Con / tracts". `break-words` still breaks inside a token, but only one
// that alone is wider than the line (a long version or URL); `min-w-0` lets
// this flex item shrink below such a token, so it wraps instead of overflowing.
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm font-medium text-right break-words">{children}</span>
    </div>
  );
}

/**
 * EditPackageDialog — thin wrapper over the spec-driven {@link PackageFormDialog}
 * in `edit` mode. The manifest form locks `id` / `type` / `namespace` / scope
 * as immutable and submits only name / description / version — all the REST
 * `PATCH /api/v1/packages/:id` persists. Kept as a named export so existing
 * call sites don't change.
 */
export function EditPackageDialog({
  pkg,
  open,
  onOpenChange,
  onSaved,
}: {
  pkg: InstalledPackageRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (updated: InstalledPackageRow) => void;
}) {
  return (
    <PackageFormDialog
      mode="edit"
      open={open}
      onOpenChange={onOpenChange}
      manifest={pkg?.manifest ?? null}
      onSaved={(r) => onSaved((r.package as unknown as InstalledPackageRow) ?? (pkg as InstalledPackageRow))}
    />
  );
}

/**
 * What *Delete app* removes (ADR-0070 D4, Q3). `structure` removes the
 * package's metadata and keeps the object tables with their records
 * (`?keepData=true`); `all` also drops those tables. `''` = not chosen yet:
 * the dialog has no default, so the author always picks one.
 */
type DeleteMode = '' | 'structure' | 'all';

export function PackageDetailSheet({
  pkg,
  appBase,
  open,
  onOpenChange,
  onChanged,
}: {
  pkg: InstalledPackageRow | null;
  /** Base for metadata-browse / draft-review links. Omit (e.g. in Studio, which
   *  has no console app context) to hide those links; every lifecycle action
   *  still works without it. */
  appBase?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const locale = useMetadataLocale();
  // `ce986aafc` — the console's metadata client, for the ONE action on this
  // sheet that must report: "publish drafts" promotes metadata, and the runtime
  // authoring gate's findings for those promotions ride the response. This hook
  // is where the advisory sink is wired (`useMetadataClient` → the toast
  // renderer), so a call made through it reports and a call made through the
  // page-private `apiJson` cannot. The other lifecycle actions on this sheet
  // write no metadata and stay on `apiJson`.
  const client = useMetadataClient();
  const [busy, setBusy] = React.useState<string | null>(null);
  // `details`: the lines a refusal carries under its sentence, in the server's
  // own words (objectui#13160).
  const [msg, setMsg] = React.useState<{
    kind: 'ok' | 'err';
    text: string;
    details?: readonly string[];
  } | null>(null);
  // ADR-0033 — pending DRAFT items bound to this package. AI-authored metadata
  // lands as drafts that the active-only browsers hide, so without this the
  // package looks empty right after a build. We list them here with a link to
  // the existing per-item review/diff (?review=1) so the user can publish them.
  const [drafts, setDrafts] = React.useState<Array<{ type: string; name: string }> | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [viewOpen, setViewOpen] = React.useState(false);
  // objectui#11784 — the confirmations this sheet asks are in-app, never
  // `window.confirm` / `window.prompt`: those are blocked or auto-answered in
  // an embedded frame, and the old delete chained two confirms where the
  // second one's Cancel still deleted. objectui#13339 — Adopt loose items is
  // the fourth.
  const [adoptOpen, setAdoptOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteMode, setDeleteMode] = React.useState<DeleteMode>('');
  const [deleteTyped, setDeleteTyped] = React.useState('');
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [dupOpen, setDupOpen] = React.useState(false);
  const [dupName, setDupName] = React.useState('');
  const [dupId, setDupId] = React.useState('');
  const fieldId = React.useId();

  React.useEffect(() => {
    setMsg(null);
    setBusy(null);
    setAdoptOpen(false);
    setDeleteOpen(false);
    setDiscardOpen(false);
    setDupOpen(false);
  }, [pkg?.manifest.id]);

  React.useEffect(() => {
    const pid = pkg?.manifest.id;
    if (!open || !pid) {
      setDrafts(null);
      return;
    }
    let cancelled = false;
    apiJson<{ drafts?: Array<{ type: string; name: string }> }>(
      `/api/v1/meta/_drafts?packageId=${encodeURIComponent(pid)}`,
    )
      .then((r) => {
        if (!cancelled) setDrafts(r?.drafts ?? []);
      })
      .catch(() => {
        if (!cancelled) setDrafts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pkg?.manifest.id]);

  if (!pkg) return null;
  const id = pkg.manifest.id;
  const enabled = pkg.enabled !== false && pkg.status !== 'disabled';
  const isKernel = pkg.manifest.scope === 'system' || pkg.manifest.scope === 'cloud';
  // objectui#13157 — the sheet offers a write action only on a package the
  // Scope badge above draws Writable: the same served verdict, the row's
  // top-level `writable` (objectstack#14375), read the same way (anything but
  // `true` is never writable). On a read-only package the server refuses
  // Edit, Publish, Revert, Disable and Delete (`WRITABLE_PACKAGE_REQUIRED`)
  // and Duplicate (`DUPLICATE_SOURCE_NOT_A_BASE`: its source must be a
  // writable base); Adopt orphans would bind loose items into a package the
  // org cannot author. So none of them is offered there. The reads stay.
  const writable = pkg.writable === true;
  // The name the delete dialog asks the author to type: the one the sheet's
  // title shows.
  const displayName = pkg.manifest.name || id;
  const deleteArmed = deleteMode !== '' && deleteTyped.trim() === displayName.trim();
  // The spec's id rule (`isSpecPackageId`), the one the landing's duplicate form
  // and the duplicate route judge by, not a second one (objectui#11855).
  const dupArmed = dupName.trim().length > 0 && isSpecPackageId(dupId.trim());

  // objectui#13339 — the sheet's one message line answers the action the
  // author started LAST. An action that runs straight away clears it as it
  // starts (`run`, and the delete / duplicate / adopt calls); one that first
  // opens a dialog or a form clears it here, at the press that opens it, so
  // a previous action's answer (a Revert refusal, say) never stands under
  // the next action's form as if it were that action's.
  const startAction = (open: () => void) => {
    setMsg(null);
    open();
  };

  async function run(action: string, fn: () => Promise<any>, okText: string) {
    setBusy(action);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: okText });
      onChanged();
    } catch (e: any) {
      setMsg({
        kind: 'err',
        text: e?.message ?? t('engine.packages.detail.actionFailed', locale),
        ...(e instanceof PackagePublishRefusal ? { details: e.reasons } : {}),
      });
    } finally {
      setBusy(null);
    }
  }

  const publish = () =>
    run(
      'publish',
      () =>
        apiJson<PackagePublishResult>(`${API}/${encodeURIComponent(id)}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).then((r) => {
          if (r && r.success === false) {
            // objectui#13160 — the count is the heading, and each reason the
            // server returned is a line under it; the count alone told the
            // author that something was wrong, never what.
            const errors = r.validationErrors ?? [];
            if (errors.length > 0) {
              throw new PackagePublishRefusal(
                tFormat('engine.packages.detail.publishBlocked', locale, { count: errors.length }),
                errors.map(publishRefusalLine),
              );
            }
            throw new Error(t('engine.packages.detail.nothingToPublish', locale));
          }
          return r;
        }),
      t('engine.packages.detail.published', locale),
    );

  // ADR-0033 — publish every pending draft of this app in one shot, then
  // refresh the pending list (it should now be empty). Distinct from the
  // registry-based `publish` above; this hits `/publish-drafts`.
  //
  // `ce986aafc` — through `MetadataClient`, not `apiJson`. This promotes
  // metadata, so the runtime authoring gate grades it and answers its findings
  // on each `published[]` element (objectstack#9343); the client is the seam
  // that reports them to the author. `apiJson` could not — and the response
  // type declared here could not even hold them: it listed the two counts and
  // `failed[]`, with no `published[]` at all. The declared shape now comes from
  // the spec, through the client's return type.
  const publishDrafts = () =>
    run(
      'publish-drafts',
      async () => {
        const r = await client.publishPackageDrafts(id).catch((e: unknown) => {
          // The ADR-0112 rule `36fc74629` landed on this page: a
          // producer-marked `error.userMessage` outranks the diagnostic
          // `error.message`. `MetadataClient` raises with the diagnostic and
          // keeps the body, so the marked sentence is re-read here rather
          // than lost on the way through the seam.
          const marked = readEnvelopeFailureText((e as { body?: unknown } | null)?.body);
          throw marked ? new Error(marked) : e;
        });
        // objectui#11922 — `failed[]` is read BEFORE the batch's own `success`.
        // A refusal carries both: `success` is false on it, and `failed[]` is
        // where its items and reasons are. Asked in the other order, every
        // refusal reached the author as "Action failed".
        const failedList = Array.isArray(r.failed) ? r.failed : [];
        if (failedList.length === 0 && (r as { success?: boolean }).success === false) {
          // Preserves what `apiJson` did for this call: a batch that did not
          // publish is an error on this surface, read through the same
          // envelope ladder. The status is no longer in hand — a non-2xx
          // threw above — so the last rung is a sentence, not "(200)".
          throw new Error(
            readEnvelopeFailureText(r) ||
              (typeof r.error === 'string' ? r.error : '') ||
              (typeof r.message === 'string' ? r.message : '') ||
              t('engine.packages.detail.actionFailed', locale),
          );
        }
        // objectui#13057 — announce the publish, as every other publish path
        // does (Studio's publish-all, Home's and the chat bar's): each mounted
        // `MetadataProvider` drops the adapter's caches and re-reads its loaded
        // types, so the views, forms and nav this tree already read show what
        // just went live, and the pending-drafts surfaces converge. Sent before
        // the `failed[]` verdict below, as Studio sends it: a pre-15.1 server's
        // partial publish still made some drafts live.
        emitMetadataRefresh();
        try {
          const fresh = await apiJson<{ drafts?: Array<{ type: string; name: string }> }>(
            `/api/v1/meta/_drafts?packageId=${encodeURIComponent(id)}`,
          );
          setDrafts(fresh?.drafts ?? []);
        } catch {
          setDrafts([]);
        }
        if (failedList.length > 0) {
          // framework 15.1+ (ADR-0067 D2): the batch is all-or-nothing — a
          // failure means NOTHING landed and `failed[]` marks the rolled-back
          // drafts `BATCH_ABORTED`, with the causal item carrying the real
          // error. Say "rolled back because X", not "{n} failed" (which reads
          // as a partial publish that no longer exists).
          const cause = refusedItemsText(failedList);
          if (failedList.some((f) => errorCodeIs(f, 'BATCH_ABORTED'))) {
            throw new Error(tFormat('engine.packages.detail.publishDraftsRolledBack', locale, { cause }));
          }
          // No aborted sibling: a pre-flight refusal, or a pre-15.1 server's
          // genuine partial publish. Either way every element is an item that
          // did not publish, so each is named with its reason.
          throw new Error(
            `${tFormat('engine.packages.detail.publishDraftsPartial', locale, {
              published: r.publishedCount ?? 0,
              failed: failedList.length,
            })} ${cause}`,
          );
        }
        return r;
      },
      t('engine.packages.detail.publishDraftsOk', locale),
    );

  const revert = () =>
    run(
      'revert',
      () => apiJson(`${API}/${encodeURIComponent(id)}/revert`, { method: 'POST' }),
      t('engine.packages.detail.reverted', locale),
    );

  // ADR-0033 — discard every pending draft of this app in one shot, reverting
  // it to the last published baseline. Published metadata and data are
  // untouched, but the drafts are gone for good, so the *Discard changes*
  // button opens a confirmation that names the count (objectui#11784) and only
  // its confirm runs this. Distinct from the metadata-service `/revert` above —
  // this hits the robust `/discard-drafts` (sys_metadata) path.
  const discardDrafts = () =>
    run(
      'discard-drafts',
      () =>
        apiJson<{ discardedCount?: number; failedCount?: number }>(
          `${API}/${encodeURIComponent(id)}/discard-drafts`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
        ).then(async (r) => {
          try {
            const fresh = await apiJson<{ drafts?: Array<{ type: string; name: string }> }>(
              `/api/v1/meta/_drafts?packageId=${encodeURIComponent(id)}`,
            );
            setDrafts(fresh?.drafts ?? []);
          } catch {
            setDrafts([]);
          }
          if (r?.failedCount) {
            throw new Error(tFormat('engine.packages.detail.discardDraftsPartial', locale, {
              discarded: r.discardedCount ?? 0,
              failed: r.failedCount,
            }));
          }
          return r;
        }),
      t('engine.packages.detail.discardDraftsOk', locale),
    );

  // ADR-0033 — delete the WHOLE package: every metadata row (active + draft),
  // and — unless the author keeps the data — each object's physical table
  // (DESTRUCTIVE). One in-app dialog (objectui#11784): the author picks
  // *structure only* or *structure and data* explicitly (no default), types the
  // package's name, and only then is the delete armed. Its Cancel deletes
  // nothing. Closes the sheet on success; a failure is shown on the sheet.
  const openDelete = () =>
    startAction(() => {
      setDeleteMode('');
      setDeleteTyped('');
      setDeleteOpen(true);
    });

  const deleteApp = async () => {
    if (!deleteArmed) return;
    // ADR-0070 D4 (Q3) — `?keepData=true` removes the metadata and keeps the
    // object tables with their records; without it the tables are dropped.
    const qs = deleteMode === 'structure' ? '?keepData=true' : '';
    setBusy('delete');
    setMsg(null);
    try {
      await apiJson(`${API}/${encodeURIComponent(id)}${qs}`, { method: 'DELETE' });
      setDeleteOpen(false);
      onChanged();
      onOpenChange(false);
    } catch (e: any) {
      setDeleteOpen(false);
      setMsg({ kind: 'err', text: e?.message ?? t('engine.packages.detail.deleteFailed', locale) });
    } finally {
      setBusy(null);
    }
  };

  // ADR-0070 D4 — duplicate this base into a NEW writable package
  // (re-namespaced). The Studio landing's inline duplicate form, on this sheet
  // (objectui#11784): the same id input (`PackageIdInput`), the same id rule
  // (`isSpecPackageId`) and the same call (`duplicatePackage`, which also refuses
  // a 200 whose verdict is `success: false`), instead of a `window.prompt`.
  const toggleDuplicate = () => {
    if (dupOpen) {
      setDupOpen(false);
      return;
    }
    startAction(() => {
      setDupName(tFormat('engine.studio.landing.dupDefaultName', locale, { name: displayName }));
      setDupId(`${id}-copy`);
      setDupOpen(true);
    });
  };

  const duplicateApp = async () => {
    const target = dupId.trim();
    const name = dupName.trim();
    if (!name || !isSpecPackageId(target)) return;
    setBusy('duplicate');
    setMsg(null);
    try {
      await duplicatePackage(id, target, name);
      setDupOpen(false);
      setMsg({ kind: 'ok', text: t('engine.packages.detail.duplicated', locale) });
      onChanged();
    } catch (e: unknown) {
      setMsg({
        kind: 'err',
        text: e instanceof Error && e.message ? e.message : t('engine.packages.detail.actionFailed', locale),
      });
    } finally {
      setBusy(null);
    }
  };

  // ADR-0070 D5 — adopt every package-less (loose) item in this env INTO this
  // base. The *Adopt loose items* button opens an in-app confirmation
  // (objectui#13339); only its confirm runs this, and its Cancel sends nothing.
  //
  // The answer reports the server's own count, `reassignedCount`
  // (`ReassignOrphanedMetadataResponse`), 0 included: the sheet used to say
  // "Loose items adopted" whatever moved, so an adoption that found nothing
  // read as one that did. The answer's own `success` is false exactly when
  // nothing moved (`reassigned.length > 0`); on this door that is a count of
  // 0, not a failure, so the count is what the author is told.
  const adoptOrphans = async () => {
    setAdoptOpen(false);
    setBusy('adopt');
    setMsg(null);
    try {
      const r = await apiJson<ReassignOrphanedMetadataResponse>(
        `${API}/${encodeURIComponent(id)}/adopt-orphans`,
        { method: 'POST' },
      );
      const count = r.reassignedCount;
      setMsg({
        kind: 'ok',
        text: tFormat(
          count === 1 ? 'engine.packages.detail.adoptedOne' : 'engine.packages.detail.adoptedOther',
          locale,
          { count },
        ),
      });
      onChanged();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message ?? 'Adopt failed' });
    } finally {
      setBusy(null);
    }
  };

  const toggleEnable = () =>
    run(
      'toggle',
      () =>
        apiJson(`${API}/${encodeURIComponent(id)}/${enabled ? 'disable' : 'enable'}`, {
          method: 'PATCH',
        }),
      enabled ? t('engine.packages.detail.disabled', locale) : t('engine.packages.detail.enabled', locale),
    );

  const exportPkg = () =>
    run(
      'export',
      async () => {
        const manifest = await apiJson<any>(`${API}/${encodeURIComponent(id)}/export`);
        const blob = new Blob([JSON.stringify(manifest, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${id}.package.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
      t('engine.packages.detail.exported', locale),
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <PackageIcon className="h-4 w-4" />
            {pkg.manifest.name || id}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">{id}</SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          <DetailRow label={t('engine.packages.col.version', locale)}>{pkg.manifest.version || '—'}</DetailRow>
          <DetailRow label={t('engine.packages.detail.type', locale)}>{pkg.manifest.type || '—'}</DetailRow>
          <DetailRow label={t('engine.packages.col.scope', locale)}>
            <ScopeBadge pkg={pkg} />
          </DetailRow>
          <DetailRow label={t('engine.packages.col.status', locale)}>
            <StatusBadge pkg={pkg} />
          </DetailRow>
          {pkg.manifest.description && (
            <DetailRow label={t('engine.packages.detail.description', locale)}>{pkg.manifest.description}</DetailRow>
          )}
        </div>

        {appBase && (
          <>
            <Separator className="my-4" />
            <Link
              to={`${appBase}/metadata/object?package=${encodeURIComponent(id)}`}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              onClick={() => onOpenChange(false)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('engine.packages.detail.browseMetadata', locale)}
            </Link>
          </>
        )}

        {drafts && drafts.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="space-y-2">
              {/* A `div`, not a `p` (objectui#11804): the draft-count `Badge`
                  renders a `<div>`, and a `<div>` inside a `<p>` is invalid
                  HTML — React logged "In HTML, <div> cannot be a descendant of
                  <p>" every time a package with pending drafts opened this
                  sheet. Same classes; Tailwind's preflight zeroes a `p`'s
                  margins, so the swap changes no spacing. */}
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('engine.packages.detail.pendingChanges', locale)}
                <Badge variant="secondary">{drafts.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('engine.packages.detail.pendingHint', locale)}
              </p>
              {!isKernel && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={publishDrafts} disabled={!!busy}>
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {busy === 'publish-drafts'
                      ? t('engine.packages.detail.publishing', locale)
                      : tFormat('engine.packages.detail.publishApp', locale, { count: drafts.length })}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startAction(() => setDiscardOpen(true))}
                    disabled={!!busy}
                  >
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    {busy === 'discard-drafts'
                      ? t('engine.packages.detail.discarding', locale)
                      : tFormat('engine.packages.detail.discardChanges', locale, { count: drafts.length })}
                  </Button>
                </div>
              )}
              <ul className="space-y-1">
                {drafts.map((d) =>
                  appBase ? (
                    <li key={`${d.type}/${d.name}`}>
                      <Link
                        to={`${appBase}/metadata/${encodeURIComponent(d.type)}/${encodeURIComponent(d.name)}?review=1`}
                        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                        onClick={() => onOpenChange(false)}
                      >
                        <FileUp className="h-3.5 w-3.5" />
                        <span className="font-mono text-xs">{d.type}</span>
                        <span className="text-muted-foreground">·</span>
                        {d.name}
                      </Link>
                    </li>
                  ) : (
                    <li key={`${d.type}/${d.name}`} className="inline-flex items-center gap-1.5 text-sm">
                      <FileUp className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono text-xs">{d.type}</span>
                      <span className="text-muted-foreground">·</span>
                      {d.name}
                    </li>
                  ),
                )}
              </ul>
            </div>
          </>
        )}

        <Separator className="my-4" />

        <div className="space-y-2">
          {isKernel && (
            <p className="text-sm text-muted-foreground">
              {t('engine.packages.detail.kernelReadOnly', locale)}
            </p>
          )}
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('engine.packages.detail.actions', locale)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => startAction(() => setViewOpen(true))} disabled={!!busy}>
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              {t('engine.packages.detail.viewInfo', locale)}
            </Button>
            {writable && (
              <Button size="sm" variant="outline" onClick={() => startAction(() => setEditOpen(true))} disabled={!!busy}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {t('engine.packages.detail.edit', locale)}
              </Button>
            )}
            {writable && (
              <Button size="sm" onClick={publish} disabled={!!busy}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                {busy === 'publish' ? t('engine.packages.detail.publishing', locale) : t('engine.packages.detail.publish', locale)}
              </Button>
            )}
            {writable && (
              <Button size="sm" variant="outline" onClick={revert} disabled={!!busy}>
                <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                {t('engine.packages.detail.revert', locale)}
              </Button>
            )}
            {/* Disable is refused on a read-only package; Enable is not (the
                server's enable door has no writability gate), so a disabled
                read-only package can still be switched back on. */}
            {(writable || !enabled) && (
              <Button size="sm" variant="outline" onClick={toggleEnable} disabled={!!busy}>
                {enabled ? (
                  <PowerOff className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Power className="mr-1.5 h-3.5 w-3.5" />
                )}
                {enabled ? t('engine.packages.detail.disable', locale) : t('engine.packages.detail.enable', locale)}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={exportPkg} disabled={!!busy}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {busy === 'export' ? t('engine.packages.detail.exporting', locale) : t('engine.packages.detail.export', locale)}
            </Button>
            {writable && (
              <Button
                size="sm"
                variant="outline"
                onClick={toggleDuplicate}
                disabled={!!busy}
                aria-expanded={dupOpen}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {busy === 'duplicate' ? t('engine.packages.detail.duplicating', locale) : t('engine.packages.detail.duplicate', locale)}
              </Button>
            )}
            {writable && (
              <Button size="sm" variant="outline" onClick={() => startAction(() => setAdoptOpen(true))} disabled={!!busy}>
                <Inbox className="mr-1.5 h-3.5 w-3.5" />
                {busy === 'adopt' ? t('engine.packages.detail.adopting', locale) : t('engine.packages.detail.adoptOrphans', locale)}
              </Button>
            )}
            {writable && (
              <Button
                size="sm"
                variant="outline"
                onClick={openDelete}
                disabled={!!busy}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {busy === 'delete' ? t('engine.packages.detail.deleting', locale) : t('engine.packages.detail.deleteApp', locale)}
              </Button>
            )}
          </div>
          {writable && dupOpen && (
            <div className="flex flex-col gap-1.5 rounded-md border p-2.5" data-testid="pkg-detail-dup-form">
              <input
                autoFocus
                value={dupName}
                onChange={(e) => setDupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && dupArmed && !busy) void duplicateApp();
                  if (e.key === 'Escape') setDupOpen(false);
                }}
                placeholder={t('engine.studio.landing.dupNamePlaceholder', locale)}
                aria-label={t('engine.studio.landing.dupNamePlaceholder', locale)}
                data-testid="pkg-detail-dup-name-input"
                className="h-7 w-full rounded-md border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-primary"
              />
              <PackageIdInput
                value={dupId}
                onChange={setDupId}
                onEnter={() => {
                  if (dupArmed && !busy) void duplicateApp();
                }}
                onEscape={() => setDupOpen(false)}
                placeholder={t('engine.studio.landing.dupIdPlaceholder', locale)}
                locale={locale}
                testId="pkg-detail-dup-id-input"
              />
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={() => void duplicateApp()} disabled={!!busy || !dupArmed}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {busy === 'duplicate'
                    ? t('engine.packages.detail.duplicating', locale)
                    : t('engine.packages.detail.duplicateGo', locale)}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDupOpen(false)} disabled={!!busy}>
                  {t('engine.cancel', locale)}
                </Button>
              </div>
            </div>
          )}
        </div>

        {msg && (
          <div
            className={`mt-4 rounded-md border p-2 text-sm ${
              msg.kind === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            }`}
          >
            {/* A refusal leads with its first sentence; the rest of the
                server's text is behind "More" (objectui#13332). */}
            {msg.kind === 'err' ? <RefusalMessage text={msg.text} /> : msg.text}
            {msg.details && msg.details.length > 0 && (
              // Not capped: the sheet scrolls (`overflow-y-auto`), as it does
              // for the pending-drafts list above. `break-words` keeps a long
              // item id inside the sheet's width.
              <ul className="mt-1 list-disc space-y-0.5 pl-4 break-words">
                {msg.details.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <EditPackageDialog
          pkg={pkg}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => {
            setMsg({ kind: 'ok', text: t('engine.packages.edit.saved', locale) });
            onChanged();
          }}
        />
        <PackageFormDialog
          mode="view"
          open={viewOpen}
          onOpenChange={setViewOpen}
          manifest={pkg?.manifest ?? null}
        />

        <AlertDialog
          open={deleteOpen}
          onOpenChange={(next) => {
            // Not dismissable while the DELETE is in flight.
            if (busy === 'delete') return;
            setDeleteOpen(next);
          }}
        >
          <AlertDialogContent data-testid="pkg-detail-delete-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {tFormat('engine.packages.detail.deleteTitle', locale, { name: displayName })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('engine.packages.detail.deleteDescription', locale)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <RadioGroup
              value={deleteMode}
              onValueChange={(v) => setDeleteMode(v === 'structure' || v === 'all' ? v : '')}
              aria-label={t('engine.packages.detail.deleteApp', locale)}
              className="gap-3"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem
                  value="structure"
                  id={`${fieldId}-delete-structure`}
                  data-testid="pkg-detail-delete-mode-structure"
                  className="mt-0.5"
                />
                <Label htmlFor={`${fieldId}-delete-structure`} className="grid gap-0.5 font-normal">
                  <span className="font-medium">{t('engine.packages.detail.deleteModeStructure', locale)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('engine.packages.detail.deleteModeStructureHint', locale)}
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem
                  value="all"
                  id={`${fieldId}-delete-all`}
                  data-testid="pkg-detail-delete-mode-all"
                  className="mt-0.5"
                />
                <Label htmlFor={`${fieldId}-delete-all`} className="grid gap-0.5 font-normal">
                  <span className="font-medium">{t('engine.packages.detail.deleteModeAll', locale)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('engine.packages.detail.deleteModeAllHint', locale)}
                  </span>
                </Label>
              </div>
            </RadioGroup>
            <div className="grid gap-1.5">
              <Label htmlFor={`${fieldId}-delete-name`} className="text-sm font-medium">
                {tFormat('engine.packages.detail.deleteTypeName', locale, { name: displayName })}
              </Label>
              <Input
                id={`${fieldId}-delete-name`}
                value={deleteTyped}
                onChange={(e) => setDeleteTyped(e.target.value)}
                placeholder={displayName}
                autoComplete="off"
                data-testid="pkg-detail-delete-name-input"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy === 'delete'} data-testid="pkg-detail-delete-cancel">
                {t('engine.cancel', locale)}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={!deleteArmed || busy === 'delete'}
                data-testid="pkg-detail-delete-confirm"
                onClick={(e) => {
                  // Stay open while the DELETE runs; `deleteApp` closes it.
                  e.preventDefault();
                  void deleteApp();
                }}
              >
                {busy === 'delete'
                  ? t('engine.packages.detail.deleting', locale)
                  : t('engine.packages.detail.deleteApp', locale)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={adoptOpen} onOpenChange={setAdoptOpen}>
          <AlertDialogContent data-testid="pkg-detail-adopt-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {tFormat('engine.packages.detail.adoptTitle', locale, { name: displayName })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('engine.packages.detail.adoptDescription', locale)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="pkg-detail-adopt-cancel">
                {t('engine.cancel', locale)}
              </AlertDialogCancel>
              <AlertDialogAction data-testid="pkg-detail-adopt-confirm" onClick={() => void adoptOrphans()}>
                {t('engine.packages.detail.adoptOrphans', locale)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent data-testid="pkg-detail-discard-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {tFormat('engine.packages.detail.discardTitle', locale, { count: drafts?.length ?? 0 })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('engine.packages.detail.discardDescription', locale)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="pkg-detail-discard-cancel">
                {t('engine.cancel', locale)}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="pkg-detail-discard-confirm"
                onClick={() => void discardDrafts()}
              >
                {tFormat('engine.packages.detail.discardChanges', locale, { count: drafts?.length ?? 0 })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Main page                                                                   */
/* -------------------------------------------------------------------------- */

export function PackagesPage() {
  const locale = useMetadataLocale();
  const { pathname } = useLocation();
  // App base = path up to (and excluding) `/component/...`, so links to
  // `/apps/:app/metadata/...` work regardless of nesting.
  const appBase = React.useMemo(() => {
    const idx = pathname.indexOf('/component');
    return idx >= 0 ? pathname.slice(0, idx) : pathname;
  }, [pathname]);

  const [packages, setPackages] = React.useState<InstalledPackageRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [showKernel, setShowKernel] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<InstalledPackageRow | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [importing, setImporting] = React.useState(false);
  const [importMsg, setImportMsg] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );
  // objectui#12675 — every row with its Source; objectui#12790 — that Source is
  // the row's served `source`, and the marketplace slice's list only supplies
  // the row actions and the installs the runtime did not load.
  const [rows, setRows] = React.useState<PackageListRow[]>([]);
  const [marketplaceList, setMarketplaceList] = React.useState<'cloud' | 'local'>('local');
  const [marketplaceMsg, setMarketplaceMsg] = React.useState<{ ok: boolean; message: string } | null>(null);
  // The marketplace capability is the install-local plugin, which the runtime
  // reports as `features.installLocal` — the signal the marketplace package
  // page reads. Off ⇒ no marketplace read, no marketplace rows, no actions.
  const marketplaceOn = getRuntimeConfig().features.installLocal;
  const { isAdmin } = useWorkspaceAdminStatus();
  const showMarketplaceActions = marketplaceOn && isAdmin;
  // The Source filter is URL state (`?source=`), one closed spelling; an
  // unknown or repeated value is refused below, not ignored.
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceFilter: { value: PackageSource | null; refusal: string | null } = (() => {
    try {
      return { value: readSourceFilter(searchParams.getAll(PACKAGES_SOURCE_PARAM)), refusal: null };
    } catch (e) {
      if (e instanceof PackageSourceRefusal) return { value: null, refusal: sourceRefusalText(e, locale) };
      throw e;
    }
  })();

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, marketplace] = await Promise.all([
        apiJson<{ packages: UncheckedPackageRow[] }>(API),
        marketplaceOn ? readMarketplaceInstalls() : Promise.resolve(null),
      ]);
      const served = Array.isArray(data?.packages) ? data.packages : [];
      // objectui#12790 — each row's Source is its served `source`, read as is
      // and refused by name when absent or outside the closed set; ⛔ never
      // derived from `writable` or from the marketplace list, and no fallback
      // when it is missing. `writable` is read for the Scope badge and refused
      // under its own name. One unreadable row refuses the list: no row is
      // drawn beside a refusal.
      const list: InstalledPackageRow[] = served.map((p) => {
        const source = readServedSource(p);
        const { writable } = p;
        if (typeof writable !== 'boolean') throw new PackageWritableRefusal(p.manifest.id);
        return { ...p, source, writable };
      });
      list.sort((a, b) => {
        // User (project) packages first, then by name.
        const sa = a.manifest.scope === 'project' ? 0 : 1;
        const sb = b.manifest.scope === 'project' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return (a.manifest.name || a.manifest.id).localeCompare(b.manifest.name || b.manifest.id);
      });
      const installs = new Map((marketplace?.items ?? []).map((i) => [i.manifestId, i]));
      // The marketplace entry rides a row the SERVER calls `marketplace`, for
      // the row actions to act on; it never names a row's Source.
      const next: PackageListRow[] = list.map((p) => ({
        id: p.manifest.id,
        pkg: p,
        source: p.source,
        install: p.source === 'marketplace' ? (installs.get(p.manifest.id) ?? null) : null,
      }));
      // An install the marketplace lists and the runtime did not load has no
      // registry row, so nothing serves it a `source`. It is listed because it
      // is installed (objectui#11645), and its Source is the statement of the
      // marketplace's own installed list, the one door that holds it.
      const loaded = new Set(list.map((p) => p.manifest.id));
      for (const install of installs.values()) {
        if (!loaded.has(install.manifestId)) {
          next.push({ id: install.manifestId, pkg: null, source: 'marketplace', install });
        }
      }
      setPackages(list);
      setRows(next);
      setMarketplaceList(marketplace?.source ?? 'local');
    } catch (e: any) {
      setError(
        e instanceof PackageSourceRefusal
          ? sourceRefusalText(e, locale)
          : e instanceof PackageWritableRefusal
            ? tFormat('engine.packages.scope.unknown', locale, { id: e.subject })
            : (e?.message ?? t('engine.packages.loadFailed', locale)),
      );
    } finally {
      setLoading(false);
    }
  }, [locale, marketplaceOn]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Keep the open detail sheet in sync with refreshed data.
  React.useEffect(() => {
    if (!selected) return;
    const fresh = packages.find((p) => p.manifest.id === selected.manifest.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [packages, selected]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceFilter.value && r.source !== sourceFilter.value) return false;
      const kernel = r.pkg?.manifest.scope === 'system' || r.pkg?.manifest.scope === 'cloud';
      if (kernel && !showKernel) return false;
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        (r.pkg?.manifest.name || '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, showKernel, sourceFilter.value]);

  // objectui#13166 — the Actions column follows the cells it sits over: it is
  // drawn only when a row IN VIEW carries an action. Gating it on the page-level
  // capability alone drew an Actions header over an empty cell in every row of
  // an install with no marketplace rows. "In view" is the filtered rows, so a
  // filter that hides every marketplace row hides the column with them; the
  // column moves only when the last such row leaves or the first returns, the
  // same moment its cells do.
  const showActionsColumn = showMarketplaceActions && filtered.some((r) => rowActionEntry(r) !== null);

  // objectui#13356 — Setup's "Installed Apps" entry opens this page with
  // `?source=marketplace` (its nav item's `params`, sent as the query string).
  // That view is titled for the entry that opened it, and when no row is a
  // marketplace install its empty state says so, instead of blaming a filter
  // the administrator never set. "No packages match your filters." stays for
  // the case where marketplace installs exist and the search hides them.
  const installedAppsView = sourceFilter.value === 'marketplace';
  const noMarketplaceInstalls = installedAppsView && !rows.some((r) => r.source === 'marketplace');

  const clearSourceFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(PACKAGES_SOURCE_PARAM);
    setSearchParams(next, { replace: true });
  };

  const openDetail = (pkg: InstalledPackageRow) => {
    setSelected(pkg);
    setDetailOpen(true);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const text = await file.text();
      let manifest: any;
      try {
        manifest = JSON.parse(text);
      } catch {
        throw new Error(t('engine.packages.import.invalidJson', locale));
      }
      if (!manifest || typeof manifest !== 'object' || (!manifest.id && !manifest.name)) {
        throw new Error(t('engine.packages.import.invalidPackage', locale));
      }
      const res = await apiJson<any>('/api/v1/marketplace/install-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest }),
      });
      setImportMsg({
        kind: 'ok',
        text: tFormat('engine.packages.import.success', locale, { id: res?.manifestId ?? manifest.id }),
      });
      await load();
    } catch (err: any) {
      setImportMsg({ kind: 'err', text: err?.message ?? t('engine.packages.import.failed', locale) });
    } finally {
      setImporting(false);
    }
  };

  const kernelCount = packages.filter(
    (p) => p.manifest.scope === 'system' || p.manifest.scope === 'cloud',
  ).length;

  // The header's actions, drawn in both of its faces (objectui#12705).
  const importInput = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={onImportFile}
    />
  );
  const importLabel = importing ? t('engine.packages.importing', locale) : t('engine.packages.import', locale);
  const newPackageButton = (
    <Button size="sm" onClick={() => setCreateOpen(true)}>
      <Plus className="mr-1.5 h-3.5 w-3.5" />
      {t('engine.packages.new', locale)}
    </Button>
  );

  return (
    <div>
      {/* The console's one page header (objectui#12606): the posture —
          description under the title inside Setup, beside it elsewhere — is
          the header's own. Refresh is its icon button; New stays rightmost. */}
      <PageHeader
        title={
          installedAppsView
            ? t('engine.packages.installedApps.title', locale)
            : t('engine.packages.title', locale)
        }
        subtitle={t('engine.packages.description', locale)}
        icon={<PackageIcon className="h-4 w-4" />}
        refresh={{ onRefresh: () => void load(), label: t('engine.packages.refresh', locale), busy: loading }}
        actions={
        <>
          {importInput}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            <FileUp className="mr-1.5 h-3.5 w-3.5" />
            {importLabel}
          </Button>
          {newPackageButton}
        </>
        }
        // objectui#12705 — too narrow for both actions and the description:
        // New Package stays labelled and Import goes into a `⋯`.
        foldedActions={
        <>
          {importInput}
          {newPackageButton}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('engine.packages.moreActions', locale)}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => fileRef.current?.click()} disabled={importing}>
                <FileUp className="h-4 w-4" />
                <span>{importLabel}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
        }
      />
    <div className="mx-auto w-full max-w-5xl px-6 py-6">

      {importMsg && (
        <div
          className={`mt-4 rounded-md border p-2 text-sm ${
            importMsg.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          }`}
        >
          {importMsg.text}
        </div>
      )}

      {/* Toolbar — first in the body when no import message precedes it. */}
      <div className={`${importMsg ? 'mt-5 ' : ''}flex flex-wrap items-center justify-between gap-3`}>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t('engine.packages.search', locale)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {sourceFilter.value && (
          <div className="flex items-center gap-2" data-testid="pkg-source-filter">
            <span className="text-sm text-muted-foreground">
              {t('engine.packages.col.source', locale)}:
            </span>
            <SourceBadge source={sourceFilter.value} />
            <Button variant="ghost" size="sm" onClick={clearSourceFilter}>
              {t('engine.packages.source.showAll', locale)}
            </Button>
          </div>
        )}
        {kernelCount > 0 && (
          <div className="flex items-center gap-2">
            <Switch id="show-kernel" checked={showKernel} onCheckedChange={setShowKernel} />
            <Label htmlFor="show-kernel" className="text-sm text-muted-foreground">
              {tFormat('engine.packages.showPlatform', locale, { count: kernelCount })}
            </Label>
          </div>
        )}
      </div>

      {marketplaceMsg && (
        <div
          className={`mt-4 rounded-md border p-2 text-sm ${
            marketplaceMsg.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          }`}
          data-testid="pkg-marketplace-result"
        >
          {marketplaceMsg.message}
        </div>
      )}

      {/* Body */}
      <div className="mt-4 rounded-lg border">
        {sourceFilter.refusal ? (
          <div className="flex items-start gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span data-testid="packages-source-filter-error">{sourceFilter.refusal}</span>
          </div>
        ) : loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {/* A stable handle for the load-failure pins (`36fc74629`): the
                words in here are the server's, so a test that located this
                banner BY those words could not assert what is absent from it. */}
            <span data-testid="packages-load-error">{error}</span>
          </div>
        ) : filtered.length === 0 && noMarketplaceInstalls ? (
          <div className="p-8">
            <Empty data-testid="packages-installed-apps-empty">
              <EmptyTitle>{t('engine.packages.installedApps.empty', locale)}</EmptyTitle>
              <EmptyDescription>{t('engine.packages.installedApps.emptyHint', locale)}</EmptyDescription>
            </Empty>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8">
            <Empty>
              <EmptyTitle>{t('engine.packages.empty', locale)}</EmptyTitle>
              <EmptyDescription>
                {rows.length === 0
                  ? t('engine.packages.emptyCreate', locale)
                  : t('engine.packages.emptyFiltered', locale)}
              </EmptyDescription>
            </Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('engine.packages.col.name', locale)}</TableHead>
                <TableHead>ID</TableHead>
                <TableHead className="w-24">{t('engine.packages.col.version', locale)}</TableHead>
                <TableHead className="w-24">{t('engine.packages.col.scope', locale)}</TableHead>
                <TableHead className="w-24">{t('engine.packages.col.status', locale)}</TableHead>
                <TableHead className="w-28">{t('engine.packages.col.source', locale)}</TableHead>
                {showActionsColumn && (
                  <TableHead className="text-right">{t('engine.packages.col.actions', locale)}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const { id: rowId, pkg: p, source, install } = row;
                const actionEntry = rowActionEntry(row);
                return (
                  <TableRow
                    key={rowId}
                    className={p ? 'cursor-pointer' : undefined}
                    onClick={p ? () => openDetail(p) : undefined}
                    data-testid={`pkg-row-${rowId}`}
                  >
                    <TableCell className="font-medium">{p?.manifest.name || rowId}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {rowId}
                    </TableCell>
                    <TableCell>{p?.manifest.version || install?.version || '—'}</TableCell>
                    <TableCell>
                      {p ? <ScopeBadge pkg={p} /> : '—'}
                    </TableCell>
                    <TableCell>
                      {install?.notLoaded ? (
                        <MarketplaceNotLoaded marker={install.notLoaded} />
                      ) : p ? (
                        <StatusBadge pkg={p} />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={source} />
                    </TableCell>
                    {showActionsColumn && (
                      <TableCell className="text-right">
                        {actionEntry && (
                          <MarketplaceRowActions
                            entry={actionEntry}
                            listSource={marketplaceList}
                            basePath={appBase}
                            onResult={setMarketplaceMsg}
                            onChanged={() => void load()}
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <CreatePackageDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async () => {
          await load();
        }}
      />
      <PackageDetailSheet
        pkg={selected}
        appBase={appBase}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onChanged={() => void load()}
      />
    </div>
    </div>
  );
}

export default PackagesPage;
