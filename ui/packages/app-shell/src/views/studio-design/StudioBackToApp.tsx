// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio top bar's left end (objectstack#36501): 「‹ Back to app」, the
 * app's name, and the Studio mark. It is Studio's one way out to the running
 * app; it replaced the Studio-home button, the package switcher and the
 * top-right Open app.
 *
 * What it names is the CURRENT PACKAGE's app, never the app the author
 * happened to come from (objectstack#36890 decision 5): Studio is the
 * development surface of that package's app (ADR-0084, amended 2026-11-24).
 * Where it goes, first match wins ({@link studioBackTarget}):
 *
 *   1. the app page the author came from, when that page is one of the
 *      package's own published apps — an app → Studio entry is an in-app
 *      navigation, and `ConsoleLayout` records every app page
 *      (`utils/appReturnPage.ts`);
 *   2. otherwise the package's own published app, on its first screen;
 *   3. a package with no published app, the package-less scope (`~org`) and
 *      the cross-package leg (`~all`): the console's apps home
 *      (`useHomePath`), with no app name. A draft app has no running
 *      front-end yet, so it counts as none.
 *
 * With no app to name, the name slot names the open package — or the scope —
 * instead (objectstack#36748, and the maintainer's ruling on #36899: show the
 * package's name, go back to the apps home), so the bar still says what the
 * author is building.
 *
 * Leaving asks first when a pillar holds unsaved work, like every other
 * header departure (`beforeNavigate`).
 */

import * as React from 'react';
import { ChevronLeft } from 'lucide-react';
import { useHomePath } from '../../hooks/useHomePath.js';
import { readAppReturnPage, type AppReturnPage } from '../../utils/appReturnPage.js';
import { navItemLabelText } from '../metadata-admin/previews/navItemLabel.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { packageAppSegment, rememberedPackageApp, type StudioAppTarget } from './studioAppEdit.js';

export type { StudioAppTarget } from './studioAppEdit.js';

/** Where the back link goes, and the app it names (`null`: none). */
export interface StudioBackTarget {
  path: string;
  appLabel: string | null;
}

/**
 * The back link's target. The app segment of the package's own app is the
 * package id when the package ships one app (ADR-0048 option A, the canonical
 * address); with several they share that id and it opens only the first, so
 * the first is addressed by its name, the alias the console resolves
 * (`appAddressSegment`).
 */
export function studioBackTarget({
  remembered,
  packageId,
  apps,
  locale,
  landingPath,
}: {
  remembered: AppReturnPage | null;
  packageId: string | null;
  apps: readonly StudioAppTarget[];
  locale: string;
  landingPath: string;
}): StudioBackTarget {
  const [first] = apps;
  if (packageId === null || !first) return { path: landingPath, appLabel: null };
  const labelOf = (app: StudioAppTarget) => navItemLabelText(app.label, locale) || app.name;
  // The page the author came from, when it is one of this package's apps: its
  // record names the app by its route key, the app's name or the package id.
  const cameFrom = rememberedPackageApp(remembered, packageId, apps);
  if (remembered && cameFrom) return { path: remembered.path, appLabel: labelOf(cameFrom) };
  const segment = encodeURIComponent(packageAppSegment(packageId, apps, first));
  return { path: `/apps/${segment}`, appLabel: labelOf(first) };
}

export function StudioBackToApp({
  packageId,
  packageLabel,
  apps,
  locale,
  beforeNavigate,
  navigate,
}: {
  /** The open package, or `null` in the package-less scope. */
  packageId: string | null;
  /**
   * The open package's display name, or in the package-less scope and the
   * cross-package leg the scope's: the name slot shows it when there is no
   * app to name (objectstack#36748). Absent while the package list loads.
   */
  packageLabel?: string | null;
  /** The package's published apps. */
  apps: readonly StudioAppTarget[];
  locale: string;
  /** The header's unsaved-work veto: return false to stay in Studio. */
  beforeNavigate: () => boolean;
  navigate: (path: string) => void;
}): React.ReactElement {
  // Read once per visit: nothing in Studio is an app page, so the record
  // cannot change while the author is here.
  const [remembered] = React.useState(readAppReturnPage);
  const homePath = useHomePath();
  const target = studioBackTarget({ remembered, packageId, apps, locale, landingPath: homePath });
  const title = target.appLabel
    ? tFormat('engine.studio.backToAppTitle', locale, { app: target.appLabel })
    : t('engine.studio.backToAppTitleNoApp', locale);
  // objectstack#36748 — no app to name: the slot names the open package, or
  // the scope (the ruling on #36899 treats the package-less entry the same way).
  const fallbackLabel = packageLabel?.trim() || null;
  const name = target.appLabel ?? fallbackLabel;

  return (
    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[13px]" data-testid="studio-back">
      <button
        type="button"
        data-testid="studio-back-to-app"
        data-target={target.path}
        onClick={() => {
          if (!beforeNavigate()) return;
          navigate(target.path);
        }}
        title={title}
        className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md pl-1 pr-2 font-medium text-foreground hover:bg-muted"
      >
        <ChevronLeft className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t('engine.studio.backToApp', locale)}
      </button>
      {name && (
        <>
          <span aria-hidden="true" className="shrink-0 text-muted-foreground">
            ·
          </span>
          {/* The one piece that gives way on a narrow bar. `data-names` says
              whether it names the app or, with none, the package. */}
          <span
            data-testid="studio-back-app-name"
            data-names={target.appLabel ? 'app' : 'package'}
            className="min-w-0 truncate font-semibold"
            title={name}
          >
            {name}
          </span>
        </>
      )}
      <span aria-hidden="true" className="shrink-0 text-muted-foreground">
        ·
      </span>
      <span data-testid="studio-mark" className="shrink-0 text-muted-foreground">
        {t('engine.studio.mark', locale)}
      </span>
    </div>
  );
}
