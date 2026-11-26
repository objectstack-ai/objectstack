// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's way back to the running app (objectstack#36501). It was the top
 * bar's left end, 「‹ Back to app」 with the app's name; objectstack#37456 took
 * the bar away, and the way back is now one control, the first of the left
 * column's package row ({@link StudioBackButton}), the open package named by
 * the switcher beside it (ADR-0084, amended 2026-11-26).
 *
 * What it leads to is the CURRENT PACKAGE's app, never the app the author
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
 * Leaving asks first when a pillar holds unsaved work (`beforeNavigate`).
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

/**
 * The way back as one control (objectstack#37456; ADR-0084, amended
 * 2026-11-26, `#amendment-2026-11-26-frame`): the first control of the top
 * left's package row, and of the collapsed rail. It leads where
 * {@link studioBackTarget} says, where the retired top bar's 「‹ Back to app」 went;
 * the name beside it is the package switcher's, so the button carries the
 * name only in its accessible name and tooltip.
 */
export function StudioBackButton({
  packageId,
  apps,
  locale,
  beforeNavigate,
  navigate,
  className,
}: {
  packageId: string | null;
  apps: readonly StudioAppTarget[];
  locale: string;
  beforeNavigate: () => boolean;
  navigate: (path: string) => void;
  className?: string;
}): React.ReactElement {
  const [remembered] = React.useState(readAppReturnPage);
  const homePath = useHomePath();
  const target = studioBackTarget({ remembered, packageId, apps, locale, landingPath: homePath });
  const title = target.appLabel
    ? tFormat('engine.studio.backToAppTitle', locale, { app: target.appLabel })
    : t('engine.studio.backToAppTitleNoApp', locale);
  return (
    <button
      type="button"
      data-testid="studio-package-back"
      data-target={target.path}
      onClick={() => {
        if (!beforeNavigate()) return;
        navigate(target.path);
      }}
      aria-label={title}
      title={title}
      className={
        className ??
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring'
      }
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
