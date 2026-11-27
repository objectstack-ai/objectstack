// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package switcher of Studio's top left (objectstack#37456; ADR-0084,
 * amended 2026-11-26, `#amendment-2026-11-26-frame`). It is the package row's
 * second control, after the way back: it names the open package and opens the
 * list of the packages the person may open. It restores the switcher the top
 * bar lost (reversing objectstack#36501), now in the left column.
 *
 *  - **What it names.** A package is named by its app where it publishes one,
 *    by its own name where it does not (the amendment's item 2), with the
 *    app's logo, or a neutral tile, before the name. The rows are named the
 *    same way. The package-less scope (`~org`) and the cross-package leg
 *    (`~all`) name the scope; they are not rows of the list (item 3).
 *  - **Read-only** (decision 8). A package the person cannot write to shows a
 *    lock beside its name, and its row says so; the lock's tooltip is the
 *    reason. No list carries a banner for it.
 *  - **The list.** The packages Studio can open (`fetchPackages`), kernel ones
 *    left out (ADR-0016 §3.8), a `<base>.custom` pair folded under its base
 *    (ADR-0146 D3). A search field filters it. Picking a package opens that
 *    package (item 3: its 概览 Overview); re-picking the open one does nothing.
 *  - **新建软件包 New package** is the last row, for a person who may author
 *    metadata. It opens the dialog Setup's package list uses
 *    (`CreatePackageDialog` over `PackageFormDialog`, with its app step,
 *    objectstack#37134) and opens the new package once it is made.
 *
 * Every departure asks first when the open page holds unsaved work
 * (`beforeNavigate`). A failed list read is reported once, on the surface's
 * shared toast id, and the trigger keeps naming the open package.
 */

import * as React from 'react';
import { formatMetadataError } from '@object-ui/data-objectstack';
import {
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@object-ui/components';
import { useMetadata } from '@object-ui/react';
import { Boxes, Building2, Check, ChevronsUpDown, KeyRound, Lock, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { I18nLabel } from '@objectstack/spec/ui';
import { AppMark, type AppMarkApp } from '../../layout/AppMark.js';
import { navItemLabelText } from '../metadata-admin/previews/navItemLabel.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { CreatePackageDialog } from '../metadata-admin/PackagesPage.js';
import { fetchPackages, type PkgEntry } from './packages-io.js';
import { foldCustomizationPairs } from './StudioRailCustomizations.js';
import { PACKAGE_LIST_TOAST_ID } from './PackageSwitcher.js';

/** A served app's fields the switcher reads: the spec's, plus the package the server says it ships in. */
export type ServedApp = AppMarkApp & { name?: string; label?: I18nLabel; active?: boolean; _packageId?: unknown };

/** One package as the switcher draws it. */
export interface StudioSwitcherRow {
  id: string;
  /** The app's name where the package publishes one, else the package's own. */
  label: string;
  /** The package's app, for its logo; `null` draws the neutral tile. */
  app: ServedApp | null;
  writable: boolean;
  /** The folded `<base>.custom`, when the package has one. */
  pair: string | null;
}

/**
 * The rows the switcher lists: every package but a kernel one, pairs folded
 * under their base, each named by its first served app where it has one.
 */
export function studioSwitcherRows(
  pkgs: readonly PkgEntry[],
  apps: readonly ServedApp[],
  locale: string,
): StudioSwitcherRow[] {
  const folded = foldCustomizationPairs(pkgs.filter((p) => !p.kernel));
  return folded.rows.map((p) => {
    const app = studioPackageApp(p.id, apps);
    const appLabel = app ? navItemLabelText(app.label, locale) || app.name || '' : '';
    return {
      id: p.id,
      label: appLabel || p.name || p.id,
      app,
      writable: p.writable,
      pair: folded.pairOf.get(p.id)?.id ?? null,
    };
  });
}

/** The first active app the server says `packageId` ships, or `null`. */
export function studioPackageApp(packageId: string, apps: readonly ServedApp[]): ServedApp | null {
  return apps.find((a) => a && a.active !== false && a._packageId === packageId) ?? null;
}

/** Does `row` match the search `query` (its name or its id, any case)? */
export function studioSwitcherRowMatches(row: StudioSwitcherRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.label.toLowerCase().includes(q) || row.id.toLowerCase().includes(q);
}

export interface StudioPackageSwitcherProps {
  /** The open package, or `null` in the package-less scope and on the cross-package leg. */
  packageId: string | null;
  /** The scope the row names when there is no package: `~org` or `~all`. */
  scope?: 'org' | 'all';
  /** The surface's own entry for the open package: names it while the list loads, or when the list leaves it out. */
  openEntry?: PkgEntry | null;
  /** The open package cannot be written to: the lock is drawn beside its name. */
  readOnly?: boolean;
  /** May the person make a package? Draws 新建软件包 New package. */
  canCreate?: boolean;
  locale: string;
  /** The surface's unsaved-work veto: return false to stay. */
  beforeNavigate: () => boolean;
  navigate: (path: string) => void;
  /** Where picking a package lands. */
  packagePath: (packageId: string) => string;
  /** Draws only the app's logo, as the collapsed rail does. */
  compact?: boolean;
}

export function StudioPackageSwitcher({
  packageId,
  scope,
  openEntry = null,
  readOnly = false,
  canCreate = false,
  locale,
  beforeNavigate,
  navigate,
  packagePath,
  compact = false,
}: StudioPackageSwitcherProps): React.ReactElement {
  const { apps: servedApps } = useMetadata();
  const apps = (servedApps ?? []) as readonly ServedApp[];
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [pkgs, setPkgs] = React.useState<PkgEntry[] | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const searchId = React.useId();

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchPackages()
        .then((list) => {
          if (!cancelled) setPkgs(list);
        })
        .catch((e: unknown) => {
          if (!cancelled) toast.error(formatMetadataError(e), { id: PACKAGE_LIST_TOAST_ID });
        });
    };
    load();
    // A package made or renamed elsewhere (`PackageFormDialog` announces it).
    window.addEventListener('objectui:packages-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('objectui:packages-changed', load);
    };
  }, [packageId]);

  const rows = React.useMemo(() => studioSwitcherRows(pkgs ?? [], apps, locale), [pkgs, apps, locale]);
  const shown = rows.filter((row) => studioSwitcherRowMatches(row, query));

  // The trigger names the open package from the list, else from the surface's entry.
  const listed = packageId === null ? null : (rows.find((r) => r.id === packageId) ?? null);
  const openApp = packageId === null ? null : (listed?.app ?? studioPackageApp(packageId, apps));
  const openLabel =
    packageId === null
      ? t(scope === 'all' ? 'engine.studio.menu.environment' : 'engine.studio.pkg.orgScope', locale)
      : (listed?.label ??
        (openApp ? navItemLabelText(openApp.label, locale) || openApp.name : null) ??
        (openEntry?.id === packageId ? openEntry.name : null) ??
        packageId);
  const ScopeIcon = scope === 'all' ? KeyRound : Building2;
  const readOnlyHint = t('engine.studio.pkg.readonlyHint', locale);

  const pick = (id: string) => {
    setOpen(false);
    if (id === packageId) return;
    if (!beforeNavigate()) return;
    navigate(packagePath(id));
  };

  const mark =
    packageId === null ? (
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground" aria-hidden="true">
        <ScopeIcon className="size-3.5" />
      </span>
    ) : openApp ? (
      <AppMark app={openApp} size="sm" />
    ) : (
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground" aria-hidden="true">
        <Boxes className="size-3.5" />
      </span>
    );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="studio-pkg-switcher"
          data-package={packageId ?? undefined}
          aria-label={`${t('engine.studio.pkg.switcher', locale)}: ${openLabel}`}
          title={openLabel}
          className={cn(
            'flex h-8 min-w-0 items-center gap-2 rounded-md text-left text-sm font-medium text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent',
            compact ? 'size-8 shrink-0 justify-center' : 'flex-1 px-1.5',
          )}
        >
          {mark}
          {!compact && (
            <>
              <span data-testid="studio-pkg-switcher-name" className="min-w-0 truncate">
                {openLabel}
              </span>
              {packageId !== null && readOnly && (
                <span
                  data-testid="studio-pkg-readonly"
                  role="img"
                  aria-label={t('engine.studio.pkg.readonly', locale)}
                  title={readOnlyHint}
                  className="inline-flex shrink-0 text-muted-foreground"
                >
                  <Lock className="size-3" aria-hidden="true" />
                </span>
              )}
              <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-72 p-1" data-testid="studio-pkg-switcher-menu">
        <div className="flex items-center gap-2 border-b px-2 pb-1.5 pt-0.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <label htmlFor={searchId} className="sr-only">
            {t('engine.studio.pkg.search', locale)}
          </label>
          <input
            id={searchId}
            type="search"
            data-testid="studio-pkg-switcher-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('engine.studio.pkg.search', locale)}
            className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-auto py-1" role="list">
          {pkgs === null && (
            <p className="px-2 py-2 text-xs text-muted-foreground">{t('engine.studio.loading', locale)}</p>
          )}
          {pkgs !== null && shown.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground" data-testid="studio-pkg-switcher-empty">
              {rows.length === 0 ? t('engine.studio.pkg.none', locale) : t('engine.studio.pkg.noMatches', locale)}
            </p>
          )}
          {shown.map((row) => {
            const current = row.id === packageId;
            return (
              <div role="listitem" key={row.id}>
                <button
                  type="button"
                  data-testid="studio-switcher-row"
                  data-package={row.id}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => pick(row.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent',
                    current && 'bg-accent',
                  )}
                >
                  {row.app ? (
                    <AppMark app={row.app} size="md" />
                  ) : (
                    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
                      <Boxes className="size-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.label}</span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {!row.writable && <Lock className="size-3 shrink-0" aria-hidden="true" />}
                      <span className="truncate">
                        {t(row.writable ? 'engine.studio.pkg.writable' : 'engine.studio.pkg.readonly', locale)}
                        {row.pair && ` · ${tFormat('engine.studio.pkg.withPair', locale, { pair: row.pair })}`}
                      </span>
                    </span>
                  </span>
                  {current && <Check className="size-4 shrink-0" aria-hidden="true" />}
                </button>
              </div>
            );
          })}
        </div>
        {canCreate && (
          <div className="border-t pt-1">
            <button
              type="button"
              data-testid="studio-pkg-switcher-new"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <span className="flex size-[26px] shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground" aria-hidden="true">
                <Plus className="size-4" />
              </span>
              {t('engine.studio.pkg.newPackage', locale)}
            </button>
          </div>
        )}
      </PopoverContent>
      {canCreate && (
        <CreatePackageDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(id) => {
            // The same veto as a pick: opening the new package leaves the page.
            if (!beforeNavigate()) return;
            navigate(packagePath(id));
          }}
        />
      )}
    </Popover>
  );
}
