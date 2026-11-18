// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * BuilderLanding — the application builder's front door.
 *
 * The journey from login: Home → Studio app → the App Builder landing (this page, embedded
 * in the app chrome via the `studio:builder` component ref) → pick an installed app to
 * customize, or create or open an app of the author's own → the full-screen pillar
 * builder (`/studio/:packageId/:tab`). Also served standalone at bare `/studio` so the
 * builder is bookmarkable.
 *
 * The page is ordered by what the author came to do (objectstack#34715).
 * Installed apps come first, because changing one is the likeliest
 * errand: each card says what this deployment changed on it, "n customized,
 * m switched off" (ADR-0146 D3), from the server's per-package customization
 * read, and carries a Customize button that opens the app in Studio, where its
 * items are customized (objectui#11808). The author's own writable bases, with
 * the create card, follow. Last come the entries that belong to no app: the
 * environment's positions and permissions (the "All metadata" area's
 * cross-package leg, ADR-0146 D1 keeps it in Studio), and the organization's
 * package-less flows (objectui#11553), shown only when there are any.
 * Writability is the server's verdict read by packages-io (`PkgEntry.writable`,
 * ADR-0070 D2), and the server's write gate stays the authority. The page's
 * copy says what the author can do; it names no package mechanism.
 */

import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Boxes, Building2, Clock, Hammer, Library, Plus, Loader2, Copy, Store } from 'lucide-react';
import { toast } from 'sonner';
import { useRecentItems, type RecentNamedItem } from '../../context/RecentItemsProvider.js';
import { useRecentItemLabel } from '../../hooks/useRecentItemLabel.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { PackageFormDialog } from '../metadata-admin/PackageFormDialog.js';
import { isMarketplaceEnabled } from '../../runtime-config.js';
import { fetchPackages, fetchListedPackageIds, duplicatePackage, isSpecPackageId, type PkgEntry } from './packages-io.js';
import {
  customizationCountsOf,
  fetchPackageCustomizations,
  type PackageCustomizationCounts,
  type PackageCustomizations,
} from './packageCustomizations-io.js';
import { LandingCustomizationsPanel, type AppCustomizationRead } from './LandingCustomizationsPanel.js';
import {
  readActionObjects,
  switchedOffActionListPath,
  switchedOffActionPath,
  type ActionObjects,
} from './switchedOffActionTargets.js';
import { customizationPackageId, isCustomizationPackage } from '@objectstack/spec/kernel';
import { PackageIdInput } from './PackageIdInput.js';
import { studioOrgScopePath } from './studioScope.js';
import { STUDIO_ALL_PACKAGES_SEGMENT, studioMetadataAreaPath } from './metadataArea.js';
import { STUDIO_NEW_PARAM, STUDIO_NEW_PACKAGE_VALUE } from './studioNewPackage.js';
import { foldCustomizationPairs } from './StudioRailCustomizations.js';
import { loadPackageLessSurfaces } from './packageSurfaces.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';

/**
 * objectui#11808 — where a read-only package's card sends the author beyond
 * the package itself: Home's "Start with a template" (the marketplace), when
 * this runtime serves one. The card's own button opens the package in Studio,
 * where Customize and the "All metadata" area are; Studio links into no Setup
 * metadata page (objectstack ADR-0146 D1, Setup carries none).
 */
const MARKETPLACE_PATH = '/apps/setup/system/marketplace';

/** objectui#11863 — how many recent packages the landing lists: one row of cards. */
const RECENT_PACKAGES_SHOWN = 3;

/**
 * ADR-0146 D3 — one read-only base's customization line, by the state of its
 * read. No entry means the read has not answered: the line shows no number.
 */
type CustomizationLine =
  | {
      kind: 'read';
      counts: PackageCustomizationCounts;
      read: PackageCustomizations;
      /**
       * objectstack#34724 — which object holds each switched-off action, read
       * only when the base has one (`readActionObjects`); empty when that read
       * failed, so every action then links to its item page.
       */
      actionObjects?: ActionObjects;
    }
  | { kind: 'failed'; message: string };

/** A package's Studio address on one pillar, the way `open` below spells it. */
const studioPillarPath = (packageId: string, pillar: 'data' | 'automations') =>
  `/studio/${encodeURIComponent(packageId)}/${pillar}`;

/** How many switched-off actions the landing line names before its "more" link (objectstack#34724). */
const SWITCHED_OFF_ACTIONS_NAMED = 3;


export function BuilderLanding(): React.ReactElement {
  const navigate = useNavigate();
  const locale = useMetadataLocale();
  const [pkgs, setPkgs] = React.useState<PkgEntry[] | null>(null);
  // objectstack#32615 — every id the same list answer names, the kernel
  // packages `pkgs` hides included: what "Recently viewed" is filtered by.
  const [listedPackageIds, setListedPackageIds] = React.useState<ReadonlySet<string> | null>(null);
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
    // Asked beside the entries read, so both share its one request
    // (`GET /api/v1/packages`). A failure is reported once, by the entries read.
    fetchListedPackageIds().then(
      (ids) => {
        if (!cancelled) setListedPackageIds(ids);
      },
      () => {},
    );
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
  // objectstack#32615 — and only a package that list still names: a package
  // deleted since the visit is not listed (the delete in Studio also drops its
  // entry from the store, `PackageSwitcher`). Filtered here, not dropped, for
  // a package removed anywhere else: the list is the active organization's,
  // and the store is the user's.
  const { recentItems } = useRecentItems();
  const recentLabel = useRecentItemLabel({ packages: pkgs });
  const recentPackages =
    pkgs === null || listedPackageIds === null
      ? []
      : recentItems
          .filter((item): item is RecentNamedItem => item.type === 'package' && listedPackageIds.has(item.name))
          .slice(0, RECENT_PACKAGES_SHOWN);

  // ADR-0146 D3 — a base's `.custom` pair has no card of its own: it is
  // folded under its base, the way the package switcher folds it
  // (`foldCustomizationPairs`). The base's card carries the pair through its
  // customized line and link, and the pair's export and delete stay on the
  // Packages page, which lists every package. A pair whose base is not listed
  // keeps its card.
  //
  // objectstack#34715 — a kernel package (ADR-0016 §3.8: no one authors into
  // it) is not an app the author installed, so it draws no card. The list
  // leaves out a manifest-scoped one already; a flat-scoped one stays in it,
  // tagged `kernel` (`parsePackages`), and is dropped here by the same tag the
  // package switcher reads (objectstack#34593).
  const cards = pkgs === null ? [] : foldCustomizationPairs(pkgs.filter((p) => !p.kernel)).rows;
  const writable = cards.filter((p) => p.writable);
  const readonly = cards.filter((p) => !p.writable);

  // objectstack#35018 — "Recently viewed" is drawn only when it adds something
  // to the cards above it. When its entries are exactly the apps those cards
  // already show (one recent visit to the only app, say), the row repeats the
  // page and is left out; any entry the cards do not show, or any card it does
  // not repeat, keeps the whole row.
  const cardIds = new Set(cards.map((p) => p.id));
  const recentRepeatsCards =
    recentPackages.length === cardIds.size && recentPackages.every((item) => cardIds.has(item.name));

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
  const metadataClient = useMetadataClient();
  React.useEffect(() => {
    if (!customizationTargetKey) return;
    let cancelled = false;
    for (const id of customizationTargetKey.split('\n')) {
      // objectstack#34714 — the whole answer is kept: the card draws its two
      // numbers off it and the "Customizations in this environment" panel its
      // rows, so one read serves both and the panel's total is the cards' sum.
      fetchPackageCustomizations(id)
        .then(async (read) => {
          const counts = customizationCountsOf(read);
          // objectstack#34724 — a switched-off action's link needs its object,
          // which the ledger row does not name: read it before drawing the line.
          if (!counts.switchedOffActions?.length) return { counts, read };
          const actionObjects = await readActionObjects(metadataClient, id).catch((): ActionObjects => ({}));
          return { counts, read, actionObjects };
        })
        .then(
          (line) => {
            if (!cancelled) setCustomizationLines((prev) => ({ ...prev, [id]: { kind: 'read', ...line } }));
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
    // Keyed on the ids alone: the client only carries the reads, and a new
    // client identity must not read every card again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customizationTargetKey]);
  // objectstack#34714 — the panel's apps are the cards' bases, in card order;
  // its reads are the same answers the cards draw.
  const customizationApps = React.useMemo(
    () => readonly.filter((p) => !isCustomizationPackage(p.id)).map((p) => ({ id: p.id, name: p.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customizationTargetKey, pkgs],
  );
  const customizationReads = React.useMemo(() => {
    const out: Record<string, AppCustomizationRead> = {};
    for (const [id, line] of Object.entries(customizationLines)) {
      out[id] = line.kind === 'read' ? { kind: 'read', read: line.read, actionObjects: line.actionObjects } : line;
    }
    return out;
  }, [customizationLines]);

  // objectui#11553 — how many flows belong to no package: the same published
  // and draft union the package-less scope lists (`loadPackageLessSurfaces`).
  // The entry is drawn once the read says there is at least one; a failed read
  // draws it with no number, so the scope stays reachable when the count is
  // unknown. `null` = not answered yet.
  const [packageLessFlows, setPackageLessFlows] = React.useState<number | 'failed' | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    loadPackageLessSurfaces(metadataClient, 'flow', locale).then(
      (flows) => {
        if (!cancelled) setPackageLessFlows(flows.length);
      },
      () => {
        if (!cancelled) setPackageLessFlows('failed');
      },
    );
    return () => {
      cancelled = true;
    };
    // Read once per page visit: the count does not follow the display locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (line.counts.customized === 0 && line.counts.switchedOff === 0) {
      // objectstack#34715 — a base this deployment has not changed says so in
      // words; the Customize button beside it is the way in.
      return (
        <p data-testid="studio-landing-customizations" data-state="read" data-changes="none" className={lineClass}>
          {t('engine.studio.landing.customizations.none', locale)}
        </p>
      );
    }
    const pair = listedPairOf(baseId);
    const customized = tFormat('engine.studio.landing.customizations.customized', locale, {
      customized: line.counts.customized,
    });
    const linkClass = 'hover:text-foreground hover:underline';
    // objectstack#34724 — the "switched off" count leads to the items: a flow's
    // switch is in the Automations pillar, an action's where the action is
    // drawn (`switchedOffActionPath`: its object's Actions view, or its own
    // item page when no object holds it). When every switched-off item is an
    // action, the count opens it (one) or the action list (several); when
    // flows are among them, the count opens Automations. Whenever the count
    // alone does not land on the action, the line names each switched-off
    // action as a link to where it is switched (the action list marks none of
    // them), up to SWITCHED_OFF_ACTIONS_NAMED, then a "more" link to the list.
    const offActions = line.counts.switchedOffActions ?? [];
    const actionPath = (name: string) => switchedOffActionPath(baseId, name, line.actionObjects?.[name]);
    const offOnlyActions = offActions.length > 0 && offActions.length === line.counts.switchedOff;
    const nameActions = offActions.length > 1 || (offActions.length > 0 && !offOnlyActions);
    const namedActions = offActions.slice(0, SWITCHED_OFF_ACTIONS_NAMED);
    const moreActions = offActions.length - namedActions.length;
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
          to={
            !offOnlyActions
              ? studioPillarPath(baseId, 'automations')
              : offActions.length === 1
                ? actionPath(offActions[0])
                : switchedOffActionListPath(baseId)
          }
          title={t(
            offOnlyActions
              ? 'engine.studio.landing.customizations.switchedOffActionsTitle'
              : 'engine.studio.landing.customizations.switchedOffTitle',
            locale,
          )}
          data-testid="studio-landing-customizations-switched-off"
          className={linkClass}
        >
          {tFormat('engine.studio.landing.customizations.switchedOff', locale, {
            switchedOff: line.counts.switchedOff,
          })}
        </Link>
        {nameActions && (
          <span data-testid="studio-landing-customizations-switched-off-actions">
            {t('engine.studio.landing.customizations.separator', locale)}
            {t('engine.studio.landing.customizations.switchedOffActionsLead', locale)}
            {namedActions.map((name, i) => (
              <React.Fragment key={name}>
                {i > 0 && t('engine.studio.landing.customizations.separator', locale)}
                <Link
                  to={actionPath(name)}
                  title={t('engine.studio.landing.customizations.switchedOffActionsTitle', locale)}
                  data-testid="studio-landing-customizations-switched-off-action"
                  className={`${linkClass} font-mono`}
                >
                  {name}
                </Link>
              </React.Fragment>
            ))}
            {moreActions > 0 && (
              <>
                {' '}
                <Link
                  to={switchedOffActionListPath(baseId)}
                  data-testid="studio-landing-customizations-switched-off-actions-more"
                  className={linkClass}
                >
                  {tFormat('engine.studio.landing.customizations.switchedOffActionsMore', locale, { count: moreActions })}
                </Link>
              </>
            )}
          </span>
        )}
      </p>
    );
  };

  // Duplicate (ADR-0070 D4) clones a writable BASE into a new writable package,
  // the "duplicate base" gesture, and drops the user straight into the copy's
  // builder. It is offered on writable bases only. A read-only code or
  // installed package is not a duplicate source: its items are customized in
  // its paired `.custom` package through Customize or New similar (objectstack
  // ADR-0146 D2, D3), never by a package-less overlay (D11), and the read-only
  // section below says so. Home's "Start with a template" is not this gesture
  // either: it opens the marketplace.
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

  const headingClass = 'mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
  const entryCardClass = 'flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-left hover:bg-muted/40';
  const entryIconClass = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary';

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Hammer className="h-4.5 w-4.5" />
        </span>
        <h1 className="text-lg font-semibold">{t('engine.studio.landing.title', locale)}</h1>
      </div>
      <p className="mb-5 max-w-2xl text-xs leading-5 text-muted-foreground">
        {t('engine.studio.landing.lead', locale)}
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {pkgs === null && <p className="mb-6 text-[11px] text-muted-foreground">{t('engine.studio.loading', locale)}</p>}

      {/* objectui#11808 — an installed (read-only) app is not a dead end, and
        * it leads the page (objectstack#34715). ADR-0070 D2: code and
        * installed packages take no new items, and D4's Duplicate clones a
        * writable base, not them. The card's Customize button, like the card
        * itself, opens the app in Studio, where its items are customized
        * (ADR-0146 D2, D3: saved in its paired customization package); the
        * card links into no Setup page (ADR-0146 D1). The app's id is not on
        * the card's face, only in its title. The marketplace is offered only
        * when this runtime serves one (`isMarketplaceEnabled`, objectui#5504):
        * elsewhere that route does not exist. */}
      {readonly.length > 0 && (
        <section data-testid="studio-landing-installed" className="mb-6">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('engine.studio.landing.appsHeading', locale)}
            </h2>
            {isMarketplaceEnabled() && (
              <Link
                to={MARKETPLACE_PATH}
                data-testid="studio-landing-marketplace"
                className="flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Store className="h-3 w-3" /> {t('engine.studio.landing.marketplaceInstall', locale)}
              </Link>
            )}
          </div>
          <p
            data-testid="studio-landing-readonly-hint"
            className="mb-2 max-w-2xl text-[11px] leading-4 text-muted-foreground"
          >
            {t('engine.studio.landing.appsHint', locale)}
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {readonly.map((p) => (
              <div
                key={p.id}
                data-package-id={p.id}
                title={p.id}
                className="flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Boxes className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => open(p.id)}
                    className="block w-full truncate text-left text-[13px] font-medium hover:underline"
                  >
                    {p.name}
                  </button>
                  {renderCustomizationLine(p.id)}
                </div>
                <button
                  type="button"
                  data-testid="studio-landing-customize"
                  onClick={() => open(p.id)}
                  aria-label={tFormat('engine.studio.landing.customizeTitle', locale, { name: p.name })}
                  title={tFormat('engine.studio.landing.customizeTitle', locale, { name: p.name })}
                  className="shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-muted max-md:min-h-11 max-md:px-3"
                >
                  {t('engine.studio.customize.action', locale)}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* objectstack#34714 — every change this deployment made to its
        * installed apps, in one list, under the apps themselves. */}
      <LandingCustomizationsPanel
        apps={customizationApps}
        reads={customizationReads}
        locale={locale}
        headingClass={headingClass}
      />

      <h2 className={headingClass}>{t('engine.studio.landing.ownHeading', locale)}</h2>
      <div data-testid="studio-landing-own" className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {writable.map((p) => (
          <div key={p.id} data-package-id={p.id} className="rounded-lg border bg-background">
            {/* objectstack#35018 — the app's id is not on the card's face, only
              * in its hover title, as on an installed app's card. Every app in
              * this section is writable, so the card carries no badge saying so. */}
            <div title={p.id} className="flex items-center gap-2.5 px-3 py-2.5">
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
                </span>
              </button>
              {/* ADR-0070 D4 — Duplicate clones a writable base: the copy is a new
                * writable package holding the base's sys_metadata rows. It is
                * offered here, on writable bases only; a read-only package's card
                * offers the routes that exist for it (its `.custom` pair, the
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
          data-testid="studio-landing-new-app"
          onClick={() => setCreateOpen(true)}
          className="flex flex-col items-start gap-0.5 rounded-lg border border-dashed px-3 py-2.5 text-left text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <Plus className="h-4 w-4" /> {t('engine.studio.landing.newApp', locale)}
          </span>
          <span className="text-[10px] leading-4">{t('engine.studio.landing.newAppDescription', locale)}</span>
        </button>
      </div>

      <PackageFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(r) => open(r.id)}
      />

      {/* objectui#11863 — the packages last opened here. objectstack#34715
        * orders the page by the errand: installed apps first, the author's own
        * apps next, then the other entries, this one among them.
        * objectstack#35018 — left out when it only repeats those cards. */}
      {recentPackages.length > 0 && !recentRepeatsCards && (
        <>
          <h2 className={headingClass}>{t('engine.home.recent', locale)}</h2>
          <div data-testid="studio-landing-recent" className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {recentPackages.map((item) => (
              // objectstack#35018 — the app's id is only the entry's hover
              // title, as on the cards above; its face shows the name.
              <Link key={item.id} to={item.href} title={item.name} className={entryCardClass}>
                <span className={entryIconClass}>
                  <Clock className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{recentLabel(item)}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className={headingClass}>{t('engine.studio.landing.outsideHeading', locale)}</h2>
      <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {/* objectstack#28561 — the "All metadata" area's cross-package leg
          * (ADR-0146 D1): the environment's positions, permission sets and
          * sharing rules, which have one name per deployment and may belong to
          * no package (ADR-0131 D3). Named for what it holds (objectstack#34715). */}
        <button
          type="button"
          data-testid="studio-landing-env-catalog"
          onClick={() => navigate(studioMetadataAreaPath(STUDIO_ALL_PACKAGES_SEGMENT))}
          className={entryCardClass}
        >
          <span className={entryIconClass}>
            <Library className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {t('engine.studio.landing.rolesPermissions.name', locale)}
            </span>
            <span className="block text-[10px] leading-4 text-muted-foreground">
              {t('engine.studio.landing.rolesPermissions.description', locale)}
            </span>
          </span>
        </button>
        {/* objectui#11553 — the organization's own flows, which belong to no
          * package (a clone of a packaged flow is one, by ADR-0126 §7.1). They
          * match no package card above, so they get their own entry, shown
          * whether or not any writable package exists, and only when there is
          * at least one such flow (objectstack#34715). */}
        {packageLessFlows !== null && packageLessFlows !== 0 && (
          <button
            type="button"
            data-testid="studio-landing-org-scope"
            onClick={() => navigate(studioOrgScopePath())}
            className={entryCardClass}
          >
            <span className={entryIconClass}>
              <Building2 className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5 truncate text-[13px] font-medium">
                {t('engine.studio.landing.unassignedFlows.name', locale)}
                {typeof packageLessFlows === 'number' && (
                  <span data-testid="studio-landing-org-scope-count" className="font-normal text-muted-foreground">
                    {packageLessFlows}
                  </span>
                )}
              </span>
              <span className="block text-[10px] leading-4 text-muted-foreground">
                {t('engine.studio.landing.unassignedFlows.description', locale)}
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
