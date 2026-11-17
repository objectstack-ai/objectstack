// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio header's way back to the running app: "Open app"
 * (objectstack#34593), the mirror of the app bar's Edit app (ADR-0080's
 * app → Studio bridge, `appStudioRoutePath`).
 *
 * The round trip is symmetric: Edit app carries the page the author is on
 * into Studio as `?surface=<type>:<name>`, and Open app reads the same
 * `?surface=` back out, landing on that object's list (or that dashboard,
 * page or report) in the app. Any other surface — a flow, a permission set,
 * none at all — lands on the app's home.
 *
 * Only a PUBLISHED app is offered: a draft app has no running front-end yet.
 * A package with several apps offers a choice. Leaving Studio asks first when
 * a pillar holds unsaved work, like every other header departure.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppWindow, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@object-ui/components';
import type { I18nLabel } from '@objectstack/spec/ui';
import { DESIGNER_SURFACE_PARAM, parseSurfaceParam } from '../metadata-admin/nav-selection.js';
import { navItemLabelText } from '../metadata-admin/previews/navItemLabel.js';
import { t, tFormat } from '../metadata-admin/i18n.js';

/** A published app of the open package, as the header offers it. */
export interface StudioOpenAppTarget {
  name: string;
  label: I18nLabel;
}

/** Route types whose `/apps/<app>/<type>/<name>` page shows one interface (`appStudioRoutePath`'s set). */
const INTERFACE_SURFACE_TYPES = new Set(['dashboard', 'page', 'report']);

/**
 * Where Open app lands for `app` of `packageId`, given the surface Studio has
 * in focus.
 *
 * The app segment is the package id when the package ships one app (ADR-0048
 * option A, the canonical address). With several, they share that id and it
 * opens only the first, so each is addressed by its name — the alias the
 * console resolves and rewrites to the canonical address where it is one
 * (`appAddressSegment`, `canonicalAppPathname`).
 */
export function studioOpenAppPath(
  packageId: string,
  apps: readonly StudioOpenAppTarget[],
  appName: string,
  surface: { type: string; name: string } | null,
): string {
  const segment = encodeURIComponent(apps.length > 1 ? appName : packageId);
  const base = `/apps/${segment}`;
  if (!surface) return base;
  if (surface.type === 'object') return `${base}/${encodeURIComponent(surface.name)}`;
  if (INTERFACE_SURFACE_TYPES.has(surface.type)) {
    return `${base}/${surface.type}/${encodeURIComponent(surface.name)}`;
  }
  return base;
}

const BUTTON_CLASS =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] text-foreground hover:bg-muted';

export function StudioOpenApp({
  packageId,
  apps,
  locale,
  beforeNavigate,
  navigate,
}: {
  packageId: string;
  /** The package's published apps; nothing is drawn for none. */
  apps: readonly StudioOpenAppTarget[];
  locale: string;
  /** The header's unsaved-work veto: return false to stay in Studio. */
  beforeNavigate: () => boolean;
  navigate: (path: string) => void;
}): React.ReactElement | null {
  const [searchParams] = useSearchParams();
  const surface = parseSurfaceParam(searchParams.get(DESIGNER_SURFACE_PARAM));
  const [open, setOpen] = React.useState(false);
  if (apps.length === 0) return null;

  const labelOf = (app: StudioOpenAppTarget) => navItemLabelText(app.label, locale) || app.name;
  const go = (app: StudioOpenAppTarget) => {
    setOpen(false);
    if (!beforeNavigate()) return;
    navigate(studioOpenAppPath(packageId, apps, app.name, surface));
  };
  const text = t('engine.studio.openApp', locale);
  const inner = (
    <>
      <AppWindow className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {/* Named from 1024 px up; below that the icon, its name kept in the
          accessible name and the tooltip (the pillar links' rule). */}
      <span className="sr-only lg:not-sr-only">{text}</span>
    </>
  );

  if (apps.length === 1) {
    const [only] = apps as [StudioOpenAppTarget];
    return (
      <button
        type="button"
        data-testid="studio-open-app"
        data-app={only.name}
        onClick={() => go(only)}
        title={tFormat('engine.studio.openAppTitle', locale, { app: labelOf(only) })}
        className={BUTTON_CLASS}
      >
        {inner}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="studio-open-app"
          title={t('engine.studio.openAppPick', locale)}
          className={BUTTON_CLASS}
        >
          {inner}
          <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 rounded-lg p-1.5" data-testid="studio-open-app-menu">
        <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('engine.studio.openAppPick', locale)}
        </p>
        {apps.map((app) => (
          <button
            key={app.name}
            type="button"
            data-testid="studio-open-app-row"
            data-app={app.name}
            onClick={() => go(app)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60"
          >
            <AppWindow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{labelOf(app)}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
