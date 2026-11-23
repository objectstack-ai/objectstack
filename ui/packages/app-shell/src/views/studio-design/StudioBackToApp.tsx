// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio top bar's left end (objectstack#36501): 「‹ Back to app」, the
 * app's name, and the Studio mark. It is Studio's one way out to the running
 * app; it replaced the Studio-home button, the package switcher and the
 * top-right Open app.
 *
 * Where it goes, first match wins ({@link studioBackTarget}):
 *
 *   1. the app page the author came from — an app → Studio entry is an in-app
 *      navigation, and `ConsoleLayout` records every app page
 *      (`utils/appReturnPage.ts`); the name is that app's;
 *   2. opened directly (a Studio URL in a new tab, a reload), the package's
 *      own published app, on its first screen;
 *   3. a package with no published app, and the package-less scope: the
 *      console's default landing (`useHomePath`), with no app name. A draft
 *      app has no running front-end yet, so it counts as none.
 *
 * Leaving asks first when a pillar holds unsaved work, like every other
 * header departure (`beforeNavigate`).
 */

import * as React from 'react';
import { ChevronLeft } from 'lucide-react';
import type { I18nLabel } from '@objectstack/spec/ui';
import { useHomePath } from '../../hooks/useHomePath.js';
import { readAppReturnPage, type AppReturnPage } from '../../utils/appReturnPage.js';
import { navItemLabelText } from '../metadata-admin/previews/navItemLabel.js';
import { t, tFormat } from '../metadata-admin/i18n.js';

/** A published app of the open package. */
export interface StudioAppTarget {
  name: string;
  label: I18nLabel;
}

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
  if (remembered) return { path: remembered.path, appLabel: remembered.label || remembered.app };
  const [first] = apps;
  if (packageId !== null && first) {
    const segment = encodeURIComponent(apps.length > 1 ? first.name : packageId);
    return { path: `/apps/${segment}`, appLabel: navItemLabelText(first.label, locale) || first.name };
  }
  return { path: landingPath, appLabel: null };
}

export function StudioBackToApp({
  packageId,
  apps,
  locale,
  beforeNavigate,
  navigate,
}: {
  /** The open package, or `null` in the package-less scope. */
  packageId: string | null;
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
      {target.appLabel && (
        <>
          <span aria-hidden="true" className="shrink-0 text-muted-foreground">
            ·
          </span>
          {/* The one piece that gives way on a narrow bar. */}
          <span data-testid="studio-back-app-name" className="min-w-0 truncate font-semibold" title={target.appLabel}>
            {target.appLabel}
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
