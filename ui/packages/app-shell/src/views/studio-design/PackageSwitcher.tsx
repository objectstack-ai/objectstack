// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's top-bar package switcher, with the package-list toast id and the
 * Studio landing path it shares with the surface: moved out of
 * `StudioDesignSurface.tsx` unchanged by objectstack#29988 (slice 2 of the
 * move-only split).
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMetadataError } from '@object-ui/data-objectstack';
import { AppMark, type AppMarkApp } from '../../layout/AppMark.js';
import { STUDIO_PKG_READONLY_WORD } from './studio-tokens.js';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import {
  AlertTriangle,
  Boxes,
  Building2,
  Loader2,
  Plus,
  ChevronDown,
  Lock,
  Settings,
  Home as HomeIcon,
} from 'lucide-react';
import { studioOrgScopePath } from './studioScope.js';
import { useHomePath } from '../../hooks/useHomePath.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { CreatePackageDialog, PackageDetailSheet, type InstalledPackageRow } from '../metadata-admin/PackagesPage.js';
import { fetchPackages, type PkgEntry } from './packages-io.js';
import { foldCustomizationPairs } from './StudioRailCustomizations.js';
import { toast } from 'sonner';

/** Top-bar package switcher: list app packages (writable base vs read-only
 * code), switch by navigation, create a new writable base via the standard
 * CreatePackageDialog, and open the standard PackageDetailSheet (info +
 * disable / duplicate / delete / publish …) for the current package. */
/**
 * One sonner id for EVERY `fetchPackages()` failure on this surface
 * (objectui#7368). Three effects call that one endpoint on mount — the
 * switcher list, the writability courtesy gate and the namespace lookup — so a
 * single 503 rejects all three. Sonner UPDATES a toast that already carries the
 * id instead of stacking a new one (the `outcomeToastId` pattern this repo
 * already uses in `packages/components/src/renderers/form/form.tsx`), so one
 * outage produces one toast, not three. Reporting the failure is the point;
 * reporting it three times is noise that would get the report muted.
 */
export const PACKAGE_LIST_TOAST_ID = 'studio-package-list';

/** objectui#12513 — the Studio landing (`BuilderLanding`), where the header's first button and the switcher's first row lead. */
export const STUDIO_LANDING_PATH = '/studio';

export function PackageSwitcher({
  packageId,
  tab,
  beforeNavigate,
  app = null,
  openEntry = null,
}: {
  /** The package's app, drawn as the chip's icon tile (objectui#12459); `null` draws the neutral tile. */
  app?: AppMarkApp | null;
  /**
   * objectstack#29567 — the surface's own entry for the open package, which
   * the trigger reads when this list does not carry it: a kernel package is
   * left out of the list (it is not offered), yet when it is open the chip
   * still names it and says it is read-only. The menu never reads it.
   */
  openEntry?: PkgEntry | null;
  /** The open package, or `null` in the package-less scope (objectui#11553). */
  packageId: string | null;
  tab: string;
  /** objectui#2600 — veto hook for package-switch navigation: return false to
   * stay put (the surface prompts about unsaved pillar edits). Not consulted
   * for the deleted-package eviction in onManageChanged — that navigation is
   * forced (the package under the editor is gone). */
  beforeNavigate?: () => boolean;
}): React.ReactElement {
  const navigate = useNavigate();
  const locale = useMetadataLocale();
  // objectui#7373 — where the deleted-package eviction below lands when no
  // other package is left to open: the DECLARED landing, the launcher only when
  // the deployment declares none.
  const homePath = useHomePath();
  const [open, setOpen] = React.useState(false);
  const [pkgs, setPkgs] = React.useState<PkgEntry[] | null>(null);
  /**
   * The last package-list failure, or `null` if the last attempt did not fail
   * (objectui#7368).
   *
   * `pkgs === null` alone cannot say WHY the list is absent, and the trigger's
   * `current?.name ?? packageId` then renders the same raw reverse-domain id
   * for THREE different situations — still loading, the fetch failed, and a
   * package that genuinely declares no name. The author reading `app.b2r4` in
   * the top bar had no way to tell whether to go fix the manifest or to go
   * retry, and nothing else on screen told them either: no toast, no console
   * line. This slot is the second bit that separates them, and the surface
   * spells the three out the same way it already does at the Interfaces rail
   * / Data rail / Automations rail empty states (`error ? loadFailed : loaded
   * ? none : loading`).
   */
  const [pkgsErr, setPkgsErr] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [manage, setManage] = React.useState<InstalledPackageRow | null>(null);
  const [manageOpen, setManageOpen] = React.useState(false);
  const [manageBusy, setManageBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchPackages()
        .then((parsed) => {
          if (cancelled) return;
          setPkgs(parsed);
          setPkgsErr(null);
        })
        .catch((e: unknown) => {
          // objectui#7368 — the switcher still works for navigation-free
          // display, so this stays a DEGRADATION and never a throw: one 503
          // must not take the whole Studio top bar down with it. What it stops
          // being is SILENT. The failure is reported once (toast, this file's
          // own posture — `formatMetadataError` is used at 19 other call
          // sites in this file; this one was the exception, not the rule)
          // and, because a toast disappears while the top bar keeps showing
          // the id forever, it is also RECORDED so the trigger can say which
          // of the three states it is in.
          if (cancelled) return;
          const message = formatMetadataError(e);
          setPkgsErr(message);
          toast.error(message, { id: PACKAGE_LIST_TOAST_ID });
        });
    };
    load();
    // Refresh the switcher list (and thus the top-bar package name) when a
    // package is created or its manifest is edited elsewhere — PackageFormDialog
    // dispatches `objectui:packages-changed` on create/edit. Without this the
    // header showed the OLD name after a rename until a full page reload.
    window.addEventListener('objectui:packages-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('objectui:packages-changed', load);
    };
  }, [packageId]);

  const listedCurrent = pkgs?.find((p) => p.id === packageId) ?? null;
  // Only once the list has answered, so the three trigger states stay its own.
  const current = listedCurrent ?? (pkgs !== null && openEntry?.id === packageId ? openEntry : null);
  // objectstack#28572 (ADR-0146 D3) — a base's paired `<base>.custom` has no
  // row of its own: it is folded under its base, which names it.
  const folded = React.useMemo(() => foldCustomizationPairs(pkgs ?? []), [pkgs]);
  /**
   * Which of the three the trigger is showing (objectui#7368). A failure wins
   * over a list already in hand: after a failed refresh the names on screen are
   * stale, and saying "loaded" about them would be the same lie in a new place.
   */
  const pkgListState: 'loading' | 'failed' | 'loaded' =
    pkgsErr !== null ? 'failed' : pkgs === null ? 'loading' : 'loaded';

  // Open the standard detail/management sheet for a package — fetch its full
  // installed record (manifest + status) first, since the switcher only holds
  // the trimmed {id,name,writable} view.
  const fetchFullPackage = React.useCallback(async (id: string): Promise<InstalledPackageRow | null> => {
    const res = await fetch('/api/v1/packages', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    /**
     * ⛔ `res.ok` is not optional here (objectui#7881). The platform answers a
     * failed read in the ADR-0112 envelope — `{ success: false, error: { code,
     * message } }` — and that envelope PARSES CLEANLY through the reader
     * below: `root` becomes the error object, which is neither an array nor
     * carries `packages`, so `list` fell to `[]` and `.find()` to `null`.
     * Nothing threw, `openManage`'s catch never ran, and the management sheet
     * was opened on a null package. An empty list is a completely legitimate
     * SUCCESS answer, so using it for a failure is representing failure with a
     * legitimate success value — the same family as objectui#7368 and
     * objectui#7821 (PR #7879), one seam over.
     *
     * Measured on this path, not assumed. `GET /api/v1/packages` is served by
     * the direct-mount registrar (`@objectstack/rest` `package-routes.ts`,
     * which mounts FIRST in the production stack), and `check:route-envelope`
     * pins that module at zero hand-written bodies: every failure leaves
     * through the shared `sendError` / `sendThrownError`. The reachable
     * failures are `401 UNAUTHENTICATED` (anonymous deny), `403 FORBIDDEN`
     * (the `studio.access` / `setup.access` capability gate), `503
     * SERVICE_UNAVAILABLE` (either half of the two-source merge refusing a
     * read it could not perform) and `500 INTERNAL_ERROR` — one shape,
     * `{ success: false, error: { code, message } }`, pinned wire-side by
     * `package-envelope.conformance.test.ts`.
     *
     * So the envelope's own `success` is NOT a second bit to read here: `sendOk`
     * writes `true` on every 2xx and the error writers write `false` on every
     * non-2xx, which makes it `!res.ok` restated. `res.ok` is the DECISION; the
     * envelope is read for the WORDS, which is the half that needs it — in the
     * 5xx band the platform withholds the producer's prose and answers the
     * generic `Internal server error`, leaving `error.code` as the only
     * discriminating word, so the code travels with the message.
     *
     * The one other shape a browser can meet is a non-JSON error body (a
     * proxy's HTML 502/504). `res.json()` rejects on it — which the caller
     * already reported, as a JSON syntax error — so the tolerant read below
     * names the status instead.
     */
    if (!res.ok) {
      const failure = (await res.json().catch(() => null)) as {
        error?: { code?: unknown; message?: unknown; userMessage?: unknown };
      } | null;
      /**
       * ⭐ `userMessage` OUTRANKS `message`, and the order is the contract's,
       * not a preference (objectui#7938).
       *
       * `error.userMessage` is the producer's channel (objectstack `79c46da90`),
       * and the envelope writer's own words are the rule this line implements:
       * "the text a producer marked, AT THROW TIME, as addressed to the END USER.
       * Presence IS the marking — a consumer that sees the field renders it
       * verbatim and keeps its generic substitution for everything unmarked"
       * (`sendError`, `@objectstack/types` `response-envelope.ts`). This
       * reader was that consumer and did not see the field: it read
       * `error.message` and `error.code` and stopped, so a marked sentence
       * arrived on the wire and had nowhere to appear.
       *
       * The 5xx band is where the loss became visible rather than merely
       * theoretical. That door withholds the producer's PROSE and substitutes
       * the generic `Internal server error` into `error.message` — but the
       * withhold rewrites a local `message` const and `looksLikeInternalErrorLeak`
       * is only ever handed `thrown.message`, so `userMessage` is never an
       * input to it and rides through untouched (`sendThrownError`,
       * `@objectstack/rest` `package-routes.ts`; pinned wire-side by
       * `package-door-user-message.test.ts`). So on a marked 500/503 this
       * reader showed the author the generic sentence and dropped the
       * specific one written for them — nothing invalid displayed, which is
       * exactly what made it quiet.
       *
       * ⛔ NOT scoped to 5xx, deliberately. The marked channel is
       * status-agnostic by the producing door's own ruling — "a marked text is
       * the producer's deliberate statement to the caller at any status" — so
       * a consumer that honoured it only in one band would re-create, on the
       * reading end, precisely the divergence that door refused to create on
       * the writing end. A 4xx `message` is already caller-facing by design;
       * when a producer ALSO marked a text there, the mark is the more
       * specific answer to "what should this person read", and the diagnostic
       * it displaces is not lost to diagnosis — `code` still travels below.
       *
       * ⛔ Not a tolerant alias ladder either: these are two DECLARED fields
       * with different meanings, not two spellings of one. An unmarked refusal
       * carries no `userMessage` at all (the producer's `declaredUserMessage`
       * already applied its non-empty-string rule), so the overwhelmingly
       * common case falls straight through to `message` with byte-identical
       * output.
       */
      const marked = typeof failure?.error?.userMessage === 'string' ? failure.error.userMessage : '';
      const diagnostic = typeof failure?.error?.message === 'string' ? failure.error.message : '';
      const message = marked || diagnostic;
      const code = typeof failure?.error?.code === 'string' ? failure.error.code : '';
      throw new Error(message ? (code ? `${message} (${code})` : message) : `HTTP ${res.status}`);
    }
    const data = (await res.json()) as unknown;
    const root = (data as { data?: unknown })?.data ?? data;
    const list = (Array.isArray(root) ? root : ((root as { packages?: unknown[] })?.packages ?? [])) as Array<
      InstalledPackageRow & { id?: string }
    >;
    return list.find((p) => (p?.manifest?.id ?? p?.id) === id) ?? null;
  }, []);

  const openManage = React.useCallback(
    async (id: string) => {
      setOpen(false);
      setManageBusy(true);
      try {
        const full = await fetchFullPackage(id);
        /**
         * ⛔ The sheet never opens on a `null` package (objectui#7881). With
         * the read above now refusing, `null` means only what it always should
         * have meant: the list came back, and this package is not in it —
         * deleted or uninstalled elsewhere since the switcher last loaded.
         * `PackageDetailSheet` renders `null` for a null `pkg`, so opening it
         * anyway produced a click that did nothing and said nothing, and left
         * `manageOpen` stuck true with no rendered sheet to close it.
         *
         * Reported, not thrown: the read SUCCEEDED, so there is no caught
         * error to format and nothing about the endpoint to report.
         */
        if (!full) {
          toast.error(tFormat('engine.studio.pkg.manageMissing', locale, { id }), {
            id: PACKAGE_LIST_TOAST_ID,
          });
          return;
        }
        setManage(full);
        setManageOpen(true);
      } catch (e) {
        /*
         * This surface's EXISTING objectui#7368 posture, now also carrying the
         * shared sonner id: `fetchFullPackage` is the FOURTH caller of
         * `/api/v1/packages` on this surface (the switcher list, the
         * writability courtesy gate and the namespace lookup are the other
         * three), so one outage that rejects all four is one toast, not four.
         *
         * ⛔ Deliberately NOT also recorded in `pkgsErr`. That slot is the
         * switcher LIST's state and is written exactly where `pkgs` is — the
         * mount effect and `onManageChanged`. This callback never writes
         * `pkgs`, so the names in the trigger are precisely as current as they
         * were a moment ago, and the two sibling `fetchPackages` call sites
         * that likewise do not write the list report the same way.
         */
        toast.error(formatMetadataError(e), { id: PACKAGE_LIST_TOAST_ID });
      } finally {
        setManageBusy(false);
      }
    },
    [fetchFullPackage, locale],
  );

  // A lifecycle action ran in the sheet — refresh the list AND the managed
  // snapshot (so an edit shows immediately). If the managed package was the one
  // we're editing and it's now gone (deleted), return to the Studio landing
  // (home, when no package is left).
  const onManageChanged = React.useCallback(async () => {
    /**
     * `null` means "the refresh did not tell us anything", which is NOT the
     * same fact as "the server listed the packages and yours is not among
     * them" (objectui#7821). Those two used to be the SAME value: `list`
     * started as `[]` and the `.catch` left it that way — the comment there
     * said "keep the stale list", true of the `pkgs` state, which simply is
     * not written, but never of this local. So after a failed
     * `GET /api/v1/packages` the `!list.some(...)` below was unconditionally
     * true, the code took the branch labelled `// Deleted`, and with `list[0]`
     * undefined a transient 503 evicted the author from the editor to
     * `/home` — no toast, no confirmation, package still there. Absence of
     * evidence is not evidence of deletion.
     */
    let list: PkgEntry[] | null = null;
    try {
      list = await fetchPackages();
      setPkgs(list);
      // A list we did receive is current, so it also clears an earlier
      // failure — otherwise the trigger would keep reading `failed` over
      // names that are now fresh.
      setPkgsErr(null);
    } catch (e) {
      // Reported through this surface's EXISTING posture (objectui#7368):
      // `formatMetadataError` on the shared sonner id (one outage, one toast)
      // and recorded, so the trigger reads `failed` rather than showing a
      // stale list as though it were current. ⛔ Still not a `throw` — one
      // 503 must not take the Studio down — and ⛔ still no retry, whose
      // count / backoff / give-up state nobody has ruled on.
      const message = formatMetadataError(e);
      setPkgsErr(message);
      toast.error(message, { id: PACKAGE_LIST_TOAST_ID });
    }
    const managedId = manage?.manifest.id;
    if (!managedId) return;
    // A list we actually received, that does not contain the managed package,
    // is the ONLY evidence of deletion. `list === null` draws no inference
    // either way: the author stays put, and the managed snapshot below is
    // still refreshed (that call reports its own outcome).
    if (list !== null && !list.some((p) => p.id === managedId)) {
      // Deleted — only navigate away if it was the package we're editing.
      // While other packages remain, that is the Studio landing
      // (objectui#11784), where the author picks the next one or creates one;
      // this used to open `list[0]`, whichever package the list started with,
      // so a delete read as "Studio moved me into another app". With nothing
      // left it is still the declared home (objectui#7373).
      if (managedId === packageId) {
        navigate(list.length > 0 ? '/studio' : homePath);
      }
      return;
    }
    /**
     * The managed snapshot behind the OPEN sheet (objectui#7907). A lifecycle
     * action has just run — disable / enable / duplicate / publish /
     * publish-drafts / manifest edit — so the record in `manage` is ALREADY
     * known to be out of date, and this read is what replaces it. Neither way
     * it can fail may be silent, and neither may leave the PRE-ACTION record on
     * screen as though it were current.
     *
     * The arm this replaces was `catch {}` under a comment reading "keep the
     * current snapshot" — true of what it did, and the reason it was wrong:
     * the author disabled the package, was told nothing, and went on reading
     * `Status: Enabled`. ⚠️ It is a PRE-EXISTING defect that objectui#7881
     * (PR #7906) made much easier to hit, NOT a regression from it: before that
     * card `fetchFullPackage` never read `res.ok`, so this catch could only
     * ever see a `res.json()` rejection; now that the helper refuses a non-2xx,
     * the same catch also swallows every 401 / 403 / 503 / 500. Fixing one
     * swallowing site made the next swallowing site swallow more.
     *
     * ⛔ Why the sheet CLOSES rather than staying open on the stale record.
     * `PackageDetailSheet` is an ACTION surface, and it derives its verb from
     * the record it was handed: `enabled = pkg.enabled !== false && pkg.status
     * !== 'disabled'` picks both the button's label and the endpoint it POSTs
     * (`.../${enabled ? 'disable' : 'enable'}`, `PackagesPage.tsx`). Left open
     * over a snapshot we KNOW is pre-action, it does not merely display a stale
     * badge — it re-arms the author with the verb they just fired. Closing it
     * is still a DEGRADATION and not a throw (objectui#7368's standing ruling
     * — one 503 must not take the Studio down): the editor, the top bar and
     * the package list all stay, and reopening the sheet re-runs this same read
     * one click away, which objectui#7881 taught to report its own outcome.
     *
     * ⛔ `manage` is deliberately NOT nulled — a null `pkg` with `manageOpen`
     * still true is precisely the stuck state objectui#7881 fixed, and the next
     * `openManage` overwrites the record anyway.
     *
     * ⛔ Not recorded in `pkgsErr` either, and this arm was MEASURED rather
     * than inherited: that slot is the switcher LIST's state and is written
     * exactly where `pkgs` is — the mount effect and the HEAD of this callback,
     * the only two sites that write either. This TAIL writes neither; it writes
     * `manage`. The head has just recorded the list's own verdict (a fresh list
     * and `null`, or its failure), so writing `pkgsErr` from here would mark
     * the trigger `failed` over names the head refreshed successfully a moment
     * ago — the same lie as objectui#7368's, pointed the other way.
     *
     * ⛔ And no navigation: a snapshot this read could not deliver is not
     * evidence of deletion (objectui#7821). Reporting is not inferring.
     */
    try {
      const fresh = await fetchFullPackage(managedId);
      if (fresh) {
        setManage(fresh);
      } else {
        // The read SUCCEEDED and the package is not in the list — the same
        // fact `openManage` reports when it refuses to open on it, said with
        // the same key. Not a caught error: there is nothing about the
        // endpoint to report.
        toast.error(tFormat('engine.studio.pkg.manageMissing', locale, { id: managedId }), {
          id: PACKAGE_LIST_TOAST_ID,
        });
        setManageOpen(false);
      }
    } catch (e) {
      // This surface's EXISTING objectui#7368 posture — `formatMetadataError`
      // on the shared sonner id, so ONE outage that rejects both halves of this
      // callback is one toast rather than a stack. ⛔ Not a second reporting
      // channel: the message names the consequence the author can see (their
      // panel closed) and carries the server's own words inside it.
      toast.error(
        tFormat('engine.studio.pkg.manageRefreshFailed', locale, {
          id: managedId,
          error: formatMetadataError(e),
        }),
        { id: PACKAGE_LIST_TOAST_ID },
      );
      setManageOpen(false);
    }
  }, [manage, packageId, navigate, fetchFullPackage, locale, homePath]);

  return (
    // Radix Popover (portaled to <body>) — the top bar is `overflow-x-auto`,
    // which forces `overflow-y: auto` too, so an `absolute` panel used to be
    // CLIPPED by the header instead of overlaying the canvas. Portaling escapes
    // that clip. Create / manage open the standard dialog + sheet (also
    // portaled), so neither is subject to the header clip either.
    <Popover open={open} onOpenChange={setOpen}>
      {/* objectui#12611 — the chip's tooltip holds what a narrow chip drops:
          the whole name, the read-only posture, and what the chip does (the
          trigger's former `title`, moved here so one tooltip shows, not two). */}
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="studio-pkg-chip"
                /* objectui#7368 — the trigger's own read of which state it is in.
                   The text beside it is `current?.name ?? packageId`, which is the
                   SAME string in all three states for a package that declares no
                   name, so the state cannot be recovered from the text. */
                data-pkg-list-state={pkgListState}
                /* objectui#12611 — the width cap is the chip's own; how much of it
                   the chip gets is the header column's (`STUDIO_HEADER_PACKAGE_COLUMN`),
                   never the viewport's. */
                className="flex h-8 min-w-0 max-w-[280px] items-center gap-2 whitespace-nowrap rounded-md py-0.5 pl-1 pr-2 text-[13px] font-semibold hover:bg-muted"
              >
                {/* objectui#11553 — the package-less scope names itself; there is
                    no package id to show as the diagnostic handle. */}
                {packageId === null ? (
                  <>
                    <Building2 className="h-4 w-4" /> {t('engine.studio.org.name', locale)}
                  </>
                ) : (
                  <>
                    <AppMark app={app} size="md" />
                    <span data-slot="pkg-name" className="truncate">{current?.name ?? packageId}</span>
                  </>
                )}
                {/* ⛔ Not a replacement for the id (objectui#7368): the id is the one
                    diagnostic handle the author has, so the states are told apart by
                    what stands NEXT to it, never by swapping it for prose. */}
                {pkgListState === 'loading' && (
                  <Loader2
                    data-testid="pkg-switcher-loading"
                    aria-hidden
                    className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
                  />
                )}
                {pkgListState === 'failed' && (
                  <span
                    data-testid="pkg-switcher-failed"
                    title={pkgsErr ?? undefined}
                    className="inline-flex items-center gap-0.5 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-normal text-destructive"
                  >
                    <AlertTriangle className="h-2.5 w-2.5" /> {t('engine.studio.loadFailed', locale)}
                  </span>
                )}
                {/* objectui#12453 — the chip's half of the read-only posture: a
                    lock and the word, muted, after the name. The reason is its
                    title; the item header's link says what to do about it.
                    objectui#12611 — on a narrow header column the word gives way
                    first and the lock stays; the name truncates after it. */}
                {current && !current.writable && (
                  <span
                    data-testid="studio-pkg-readonly"
                    title={t('engine.studio.pkg.readonlyHint', locale)}
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-normal text-muted-foreground"
                  >
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    <span data-slot="pkg-readonly-word" className={STUDIO_PKG_READONLY_WORD}>
                      {t('engine.studio.pkg.readonly', locale)}
                    </span>
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent align="start" className="max-w-xs" data-testid="studio-pkg-chip-tooltip">
            <p className="font-medium">
              {packageId === null ? t('engine.studio.org.name', locale) : (current?.name ?? packageId)}
            </p>
            {current && !current.writable && (
              <p className="mt-0.5 flex items-center gap-1">
                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t('engine.studio.pkg.readonlyHint', locale)}
              </p>
            )}
            <p className="mt-0.5 opacity-80">{t('engine.studio.pkg.switchTitle', locale)}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent align="start" sideOffset={6} className="w-80 rounded-lg p-1.5">
            {/* objectui#12513 — the Studio landing leads the list: the way
                back to every package, recent ones and the organization's
                flows. Gated like every other row here. */}
            <div className="mb-1 border-b pb-1.5">
              <button
                type="button"
                data-testid="studio-switcher-home"
                onClick={() => {
                  setOpen(false);
                  if (beforeNavigate && !beforeNavigate()) return;
                  navigate(STUDIO_LANDING_PATH);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60"
              >
                <HomeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{t('engine.studio.landingHome', locale)}</span>
              </button>
            </div>
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('engine.studio.pkg.heading', locale)}
            </p>
            <div className="max-h-64 overflow-auto">
              {/* Same three-way the Interfaces / Data / Automations rails
                  already spell out in this file — a failed list stops reading
                  "Loading…" forever, and carries WHY. */}
              {pkgListState === 'loading' && (
                <p className="px-2 py-2 text-[11px] text-muted-foreground">{t('engine.studio.loading', locale)}</p>
              )}
              {pkgListState === 'failed' && (
                <p
                  data-testid="pkg-switcher-failed-detail"
                  className="whitespace-pre-line px-2 py-2 text-[11px] text-destructive"
                >
                  {pkgsErr}
                </p>
              )}
              {pkgListState === 'loaded' && pkgs?.length === 0 && (
                <p className="px-2 py-2 text-[11px] text-muted-foreground">{t('engine.studio.pkg.none', locale)}</p>
              )}
              {pkgs !== null && folded.rows.map((p) => (
                <button
                  key={p.id}
                  data-testid="studio-switcher-row"
                  data-package={p.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    // Re-picking the open package would re-navigate to the same
                    // URL — nothing unmounts, so no veto and no history churn.
                    if (p.id === packageId) return;
                    if (beforeNavigate && !beforeNavigate()) return;
                    navigate(`/studio/${encodeURIComponent(p.id)}/${tab}`);
                  }}
                  className={
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ' +
                    (p.id === packageId ? 'bg-muted font-medium' : 'hover:bg-muted/60')
                  }
                >
                  <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">{p.id}</span>
                    {folded.pairOf.has(p.id) && (
                      <span
                        data-testid="studio-switcher-pair"
                        className="block truncate text-[10px] text-muted-foreground"
                      >
                        {tFormat('engine.studio.pkg.withPair', locale, { pair: folded.pairOf.get(p.id)!.id })}
                      </span>
                    )}
                  </span>
                  {p.writable ? (
                    <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
                      {t('engine.studio.pkg.writable', locale)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">
                      <Lock className="h-2.5 w-2.5" /> {t('engine.studio.pkg.readonly', locale)}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* objectui#11553 — the package-less scope, reachable from every
                package as it is from the Studio home. It lands on its one
                pillar whatever pillar is open here. */}
            <div className="mt-1 border-t pt-1.5">
              <button
                type="button"
                data-testid="studio-org-scope-entry"
                onClick={() => {
                  setOpen(false);
                  if (packageId === null) return;
                  if (beforeNavigate && !beforeNavigate()) return;
                  navigate(studioOrgScopePath());
                }}
                className={
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ' +
                  (packageId === null ? 'bg-muted font-medium' : 'hover:bg-muted/60')
                }
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t('engine.studio.org.name', locale)}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {t('engine.studio.org.hint', locale)}
                  </span>
                </span>
              </button>
            </div>

            <div className="mt-1 space-y-0.5 border-t pt-1.5">
              {listedCurrent && (
                <button
                  type="button"
                  onClick={() => void openManage(listedCurrent.id)}
                  disabled={manageBusy}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {manageBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings className="h-3.5 w-3.5" />}
                  {t('engine.studio.pkg.manage', locale)}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> {t('engine.studio.pkg.new', locale)}
              </button>
            </div>
      </PopoverContent>

      <CreatePackageDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          // Same veto as a switch: the jump into the new package unmounts the
          // current pillar. Declining keeps the edits; the created package
          // stays reachable from the list above.
          if (beforeNavigate && !beforeNavigate()) return;
          navigate(`/studio/${encodeURIComponent(id)}/data`);
        }}
      />
      <PackageDetailSheet
        pkg={manage}
        open={manageOpen}
        onOpenChange={setManageOpen}
        onChanged={onManageChanged}
      />
    </Popover>
  );
}
