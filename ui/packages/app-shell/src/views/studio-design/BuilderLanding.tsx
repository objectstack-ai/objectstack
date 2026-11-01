// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * BuilderLanding — the application builder's front door.
 *
 * The journey from login: Home → Studio app → the App Builder landing (this page, embedded
 * in the app chrome via the `studio:builder` component ref) → pick or create a
 * writable base package → the full-screen pillar builder
 * (`/studio/:packageId/:tab`). Also served standalone at bare `/studio` so the
 * builder is bookmarkable.
 *
 * The packages the author was last in lead, when there are any (objectui#11863).
 * Writable bases (where authoring happens) follow; the organization's own
 * package-less flows have one entry of their own (objectui#11553); read-only
 * code and installed packages are listed last: they open for browsing, and each
 * card points at the routes that customize one (objectui#11808). Writability is
 * the server's verdict read by packages-io (`PkgEntry.writable`, ADR-0070 D2),
 * and the server's write gate stays the authority. Each read-only base's card
 * says what this deployment changed on it, "n customized, m switched off"
 * (ADR-0146 D3), from the server's per-package customization read.
 */

import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Boxes, Building2, Clock, Hammer, Library, Lock, Plus, Loader2, Copy, Store } from 'lucide-react';
import { toast } from 'sonner';
import { useRecentItems, type RecentNamedItem } from '../../context/RecentItemsProvider.js';
import { useRecentItemLabel } from '../../hooks/useRecentItemLabel.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { PackageFormDialog } from '../metadata-admin/PackageFormDialog.js';
import { isMarketplaceEnabled } from '../../runtime-config.js';
import { fetchPackages, duplicatePackage, isSpecPackageId, type PkgEntry } from './packages-io.js';
import { fetchPackageCustomizationCounts, type PackageCustomizationCounts } from './packageCustomizations-io.js';
import { customizationPackageId, isCustomizationPackage } from '@objectstack/spec/kernel';
import { PackageIdInput } from './PackageIdInput.js';
import { studioOrgScopePath } from './studioScope.js';
import { STUDIO_ALL_PACKAGES_SEGMENT, studioMetadataAreaPath } from './metadataArea.js';
import { STUDIO_NEW_PARAM, STUDIO_NEW_PACKAGE_VALUE } from './studioNewPackage.js';

/**
 * objectui#11808 — the two places a read-only package's card sends the author.
 * Both are routes the console already serves, spelled the way its own entries
 * spell them under the `setup` app: the Setup sidebar's metadata entries
 * (`/apps/setup/metadata/:type`) and Home's "Start with a template".
 *
 * The overlay route is the package's metadata directory, scoped by its
 * `package` query parameter. It marks, per metadata type, whether the type
 * accepts an environment overlay — the answer this page cannot give, because
 * `allowEnvironmentOverlay` belongs to the TYPE (ADR-0005), not to the package or the
 * item, and `PkgEntry` does not say which types a package ships. The Studio's
 * read-only link (objectui#12453) lands on the same route through `overlayPath`.
 */
const MARKETPLACE_PATH = '/apps/setup/system/marketplace';
export const overlayPath = (packageId: string) =>
  `/apps/setup/metadata?package=${encodeURIComponent(packageId)}`;

/** objectui#11863 — how many recent packages the landing lists: one row of cards. */
const RECENT_PACKAGES_SHOWN = 3;

/**
 * ADR-0146 D3 — one read-only base's customization line, by the state of its
 * read. No entry means the read has not answered: the line shows no number.
 */
type CustomizationLine =
  | { kind: 'read'; counts: PackageCustomizationCounts }
  | { kind: 'failed'; message: string };

/** A package's Studio address on one pillar, the way `open` below spells it. */
const studioPillarPath = (packageId: string, pillar: 'data' | 'automations') =>
  `/studio/${encodeURIComponent(packageId)}/${pillar}`;

export function BuilderLanding(): React.ReactElement {
  const navigate = useNavigate();
  const locale = useMetadataLocale();
  const [pkgs, setPkgs] = React.useState<PkgEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // The new-package deep link (`studioNewPackage.ts`): Home's and the `/ai`
  // screen's "New in Studio" land here with the create dialog open. Read once,
  // on arrival, and dropped from the address with a replace, so a refresh or
  // Back does not open the dialog a second time. The effect is keyed on the
  // param's value, the primitive it reads (ui/AGENTS.md #10).
  const [searchParams, setSearchParams] = useSearchParams();
  const newParam = searchParams.get(STUDIO_NEW_PARAM);
  const [createOpen, setCreateOpen] = React.useState(() => newParam === STUDIO_NEW_PACKAGE_VALUE);
  React.useEffect(() => {
    if (newParam !== STUDIO_NEW_PACKAGE_VALUE) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(STUDIO_NEW_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [newParam, setSearchParams]);

  React.useEffect(() => {
    let cancelled = false;
    fetchPackages()
      .then((list) => {
        if (!cancelled) setPkgs(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = (id: string) => navigate(`/studio/${encodeURIComponent(id)}/data`);

  // objectui#11863 — the packages the author was last in, newest first, as the
  // console's route owner records them (`StudioRoute`). An entry stores the
  // package's identity only, and is labelled here from the list this page just
  // loaded, so a renamed package shows its new name (objectui#11678's shape).
  // Listed only once that list has answered, so no entry is drawn as its id
  // while it loads; nothing is listed when there are none.
  const { recentItems } = useRecentItems();
  const recentLabel = useRecentItemLabel({ packages: pkgs });
  const recentPackages =
    pkgs === null
      ? []
      : recentItems
          .filter((item): item is RecentNamedItem => item.type === 'package')
          .slice(0, RECENT_PACKAGES_SHOWN);

  const writable = pkgs?.filter((p) => p.writable) ?? [];
  const readonly = pkgs?.filter((p) => !p.writable) ?? [];

  // ADR-0146 D3 — each read-only BASE's card carries "n customized, m switched
  // off", the server's counts (`GET /packages/:id/customizations`), one read
  // per card drawn. A pair (`<base>.custom`) draws no line and is never sent:
  // the route refuses its id. The page does not wait for these reads. The
  // effect is keyed on the joined ids, the primitive it reads (ui/AGENTS.md #10).
  const customizationTargetKey = readonly
    .filter((p) => !isCustomizationPackage(p.id))
    .map((p) => p.id)
    .join('\n');
  const [customizationLines, setCustomizationLines] = React.useState<Record<string, CustomizationLine>>({});
  React.useEffect(() => {
    if (!customizationTargetKey) return;
    let cancelled = false;
    for (const id of customizationTargetKey.split('\n')) {
      fetchPackageCustomizationCounts(id).then(
        (counts) => {
          if (!cancelled) setCustomizationLines((prev) => ({ ...prev, [id]: { kind: 'read', counts } }));
        },
        (e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          if (!cancelled) setCustomizationLines((prev) => ({ ...prev, [id]: { kind: 'failed', message } }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [customizationTargetKey]);
  // The pair is linked only when the package list holds it: a base with no
  // pair has nothing to open, and the read never creates one.
  const listedIds = new Set(pkgs?.map((p) => p.id) ?? []);
  const listedPairOf = (baseId: string): string | null => {
    const pair = customizationPackageId(baseId);
    return pair.ok && listedIds.has(pair.value) ? pair.value : null;
  };

  const renderCustomizationLine = (baseId: string): React.ReactNode => {
    if (isCustomizationPackage(baseId)) return null;
    const line = customizationLines[baseId];
    const lineClass = 'text-[10px] leading-4 text-muted-foreground';
    if (!line) {
      return (
        <p data-testid="studio-landing-customizations" data-state="loading" className={lineClass}>
          {t('engine.studio.landing.customizations.loading', locale)}
        </p>
      );
    }
    if (line.kind === 'failed') {
      // Never a "0": the read did not answer. The server's sentence is the title.
      return (
        <p
          data-testid="studio-landing-customizations"
          data-state="failed"
          title={line.message}
          className={`${lineClass} italic opacity-80`}
        >
          {t('engine.studio.landing.customizations.failed', locale)}
        </p>
      );
    }
    const pair = listedPairOf(baseId);
    const customized = tFormat('engine.studio.landing.customizations.customized', locale, {
      customized: line.counts.customized,
    });
    const linkClass = 'hover:text-foreground hover:underline';
    return (
      <p data-testid="studio-landing-customizations" data-state="read" className={lineClass}>
        {pair ? (
          <Link
            to={studioPillarPath(pair, 'data')}
            title={tFormat('engine.studio.landing.customizations.pairTitle', locale, { pair })}
            data-testid="studio-landing-customizations-pair"
            className={linkClass}
          >
            {customized}
          </Link>
        ) : (
          <span>{customized}</span>
        )}
        {t('engine.studio.landing.customizations.separator', locale)}
        <Link
          to={studioPillarPath(baseId, 'automations')}
          title={t('engine.studio.landing.customizations.switchedOffTitle', locale)}
          data-testid="studio-landing-customizations-switched-off"
          className={linkClass}
        >
          {tFormat('engine.studio.landing.customizations.switchedOff', locale, {
            switchedOff: line.counts.switchedOff,
          })}
        </Link>
      </p>
    );
  };

  // Duplicate (ADR-0070 D4) clones a writable BASE into a new writable package,
  // the "duplicate base" gesture, and drops the user straight into the copy's
  // builder. It is offered on writable bases only. A read-only code or
  // installed package is not a duplicate source: ADR-0070 D2 customizes it by
  // environment overlay, where the item's metadata type declares `allowEnvironmentOverlay`
  // (ADR-0005), so its card points there instead (the read-only section
  // below). Home's "Start with a template" is not this gesture either: it
  // opens the marketplace.
  const [dupFor, setDupFor] = React.useState<string | null>(null);
  const [dupName, setDupName] = React.useState('');
  const [dupId, setDupId] = React.useState('');
  const [dupBusy, setDupBusy] = React.useState(false);
  const [dupErr, setDupErr] = React.useState<string | null>(null);

  const startDup = (p: PkgEntry) => {
    setDupFor(p.id);
    setDupName(tFormat('engine.studio.landing.dupDefaultName', locale, { name: p.name }));
    setDupId(`${p.id}-copy`);
    setDupErr(null);
  };
  // objectui#11855 — the target id is judged by the spec's id rule, the one the
  // duplicate route refuses by and the id input below shows its hint for.
  const doDup = async () => {
    if (!dupFor) return;
    const id = dupId.trim();
    const name = dupName.trim();
    if (!isSpecPackageId(id) || !name) return;
    setDupBusy(true);
    setDupErr(null);
    try {
      await duplicatePackage(dupFor, id, name);
      toast.success(tFormat('engine.studio.landing.dupCreated', locale, { name }));
      open(id);
    } catch (e) {
      setDupErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDupBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Hammer className="h-4.5 w-4.5" />
        </span>
        <h1 className="text-lg font-semibold">{t('engine.studio.landing.title', locale)}</h1>
      </div>
      <p className="mb-5 max-w-2xl text-xs leading-5 text-muted-foreground">
        {t('engine.studio.landing.description', locale)}
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {recentPackages.length > 0 && (
        <>
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('engine.home.recent', locale)}
          </h2>
          <div data-testid="studio-landing-recent" className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {recentPackages.map((item) => (
              <Link
                key={item.id}
                to={item.href}
                className="flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-left hover:bg-muted/40"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Clock className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{recentLabel(item)}</span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">{item.name}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('engine.studio.landing.mineHeading', locale)}
      </h2>
      <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {pkgs === null && <p className="text-[11px] text-muted-foreground">{t('engine.studio.loading', locale)}</p>}
        {pkgs !== null && writable.length === 0 && (
          <p className="text-[11px] text-muted-foreground">{t('engine.studio.landing.noneWritable', locale)}</p>
        )}
        {writable.map((p) => (
          <div key={p.id} className="rounded-lg border bg-background">
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <button
                type="button"
                onClick={() => open(p.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Boxes className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.name}</span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">{p.id}</span>
                </span>
              </button>
              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
                {t('engine.studio.pkg.writable', locale)}
              </span>
              {/* ADR-0070 D4 — Duplicate clones a writable base: the copy is a new
                * writable package holding the base's sys_metadata rows. It is
                * offered here, on writable bases only; a read-only package's card
                * offers the routes that exist for it (environment overlay, the
                * marketplace). */}
              <button
                type="button"
                onClick={() => (dupFor === p.id ? setDupFor(null) : startDup(p))}
                title={t('engine.studio.landing.dupTitle', locale)}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Copy className="h-3 w-3" /> {t('engine.studio.landing.dup', locale)}
              </button>
            </div>
            {dupFor === p.id && (
              <div className="flex flex-col gap-1.5 border-t px-3 py-2.5">
                <input
                  autoFocus
                  value={dupName}
                  onChange={(e) => setDupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void doDup();
                    if (e.key === 'Escape') setDupFor(null);
                  }}
                  placeholder={t('engine.studio.landing.dupNamePlaceholder', locale)}
                  className="h-7 w-full rounded-md border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-primary"
                />
                <PackageIdInput
                  value={dupId}
                  onChange={setDupId}
                  onEnter={() => void doDup()}
                  onEscape={() => setDupFor(null)}
                  placeholder={t('engine.studio.landing.dupIdPlaceholder', locale)}
                  locale={locale}
                  testId="pkg-dup-id-input"
                />
                {dupErr && <p className="text-[10px] text-destructive">{dupErr}</p>}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void doDup()}
                    disabled={dupBusy || !dupName.trim() || !isSpecPackageId(dupId.trim())}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {dupBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
                    {t('engine.studio.landing.dupGo', locale)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDupFor(null)}
                    className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    {t('engine.studio.cancel', locale)}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* new-package card — opens the spec-driven create dialog (PackageFormDialog) */}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          <Plus className="h-4 w-4" /> {t('engine.studio.pkg.new', locale)}
        </button>
      </div>

      <PackageFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(r) => open(r.id)}
      />

      {/* objectui#11553 — the organization's own flows, which belong to no
        * package (a clone of a packaged flow is one, by ADR-0126 §7.1). They
        * match no package card above, so they get their own entry, shown
        * whether or not any writable package exists. */}
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('engine.studio.landing.orgHeading', locale)}
      </h2>
      <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          data-testid="studio-landing-org-scope"
          onClick={() => navigate(studioOrgScopePath())}
          className="flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-left hover:bg-muted/40"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{t('engine.studio.org.name', locale)}</span>
            <span className="block text-[10px] leading-4 text-muted-foreground">
              {t('engine.studio.org.description', locale)}
            </span>
          </span>
        </button>
        {/* objectstack#28561 — the "All metadata" area's cross-package leg
          * (ADR-0146 D1): the environment catalog, whose items have one name
          * per deployment and may belong to no package (ADR-0131 D3). */}
        <button
          type="button"
          data-testid="studio-landing-env-catalog"
          onClick={() => navigate(studioMetadataAreaPath(STUDIO_ALL_PACKAGES_SEGMENT))}
          className="flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-left hover:bg-muted/40"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Library className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{t('engine.studio.landing.envCatalog.name', locale)}</span>
            <span className="block text-[10px] leading-4 text-muted-foreground">
              {t('engine.studio.landing.envCatalog.description', locale)}
            </span>
          </span>
        </button>
      </div>

      {/* objectui#11808 — a read-only package is not a dead end. ADR-0070 D2:
        * code and installed packages take no new items, and D4's Duplicate
        * clones a writable base, not them. They are customized by environment overlay
        * where the item's metadata type declares `allowEnvironmentOverlay` (ADR-0005),
        * so each card links to the package's metadata directory, which says
        * per type whether an overlay is accepted (see `overlayPath`). The
        * marketplace, which Home's "Start with a template" opens, is offered
        * only when this runtime serves one (`isMarketplaceEnabled`,
        * objectui#5504): elsewhere that route does not exist. */}
      {readonly.length > 0 && (
        <>
          <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('engine.studio.landing.installedHeading', locale)}
          </h2>
          <p
            data-testid="studio-landing-readonly-hint"
            className="mb-2 max-w-2xl text-[11px] leading-4 text-muted-foreground"
          >
            {t('engine.studio.landing.readonlyHint', locale)}
          </p>
          {isMarketplaceEnabled() && (
            <Link
              to={MARKETPLACE_PATH}
              data-testid="studio-landing-marketplace"
              className="mb-2 flex w-fit items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <Store className="h-3 w-3" /> {t('engine.studio.landing.marketplace', locale)}
            </Link>
          )}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {readonly.map((p) => (
              <div key={p.id} className="rounded-lg border bg-muted/20">
                <button
                  type="button"
                  onClick={() => open(p.id)}
                  className="flex w-full items-center gap-2.5 rounded-t-lg px-3 py-2.5 text-left hover:bg-muted/40"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Boxes className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{p.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">{p.id}</span>
                  </span>
                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">
                    <Lock className="h-2.5 w-2.5" /> {t('engine.studio.pkg.readonly', locale)}
                  </span>
                </button>
                <div className="flex flex-col gap-1 border-t px-3 py-1.5">
                  {renderCustomizationLine(p.id)}
                  <Link
                    to={overlayPath(p.id)}
                    title={t('engine.studio.landing.overlayTitle', locale)}
                    data-testid="studio-landing-overlay"
                    className="inline-flex self-start items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {/* objectui#12513 — the link leaves Studio for Setup: its
                        name says where it goes, the arrow that it goes out. */}
                    {t('engine.studio.landing.overlay', locale)}
                    <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
