// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { useHomePath } from '../../hooks/useHomePath.js';
import { readAppReturnPage } from '../../utils/appReturnPage.js';
import { t } from '../metadata-admin/i18n.js';
import { studioBackTarget, type StudioAppTarget } from './StudioBackToApp.js';

/**
 * objectstack#36502 — the one sentence a landing from an old Interfaces URL
 * (`studioInterfacesRetired.ts`) shows: interface
 * editing moved into the app, and the way back to it — the same target as the
 * top bar's 「‹ Back to app」 (`studioBackTarget`). Dismissible; nothing is
 * stored, so it is shown again only by another old URL.
 */
export function StudioInterfacesRetiredNotice({
  packageId,
  apps,
  locale,
  beforeNavigate,
  navigate,
  onDismiss,
}: {
  /** The open package, or `null` in the package-less scope. */
  packageId: string | null;
  /** The package's published apps. */
  apps: readonly StudioAppTarget[];
  locale: string;
  /** The header's unsaved-work veto: return false to stay in Studio. */
  beforeNavigate: () => boolean;
  navigate: (path: string) => void;
  onDismiss: () => void;
}): React.ReactElement {
  const [remembered] = React.useState(readAppReturnPage);
  const homePath = useHomePath();
  const target = studioBackTarget({ remembered, packageId, apps, locale, landingPath: homePath });
  return (
    <div
      role="status"
      data-testid="studio-interfaces-retired"
      className="flex shrink-0 items-center gap-3 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1">{t('engine.studio.interfacesRetired.sentence', locale)}</span>
      <button
        type="button"
        data-testid="studio-interfaces-retired-back"
        data-target={target.path}
        onClick={() => {
          if (!beforeNavigate()) return;
          navigate(target.path);
        }}
        className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {t('engine.studio.interfacesRetired.backToApp', locale)}
      </button>
      <button
        type="button"
        data-testid="studio-interfaces-retired-dismiss"
        aria-label={t('engine.studio.interfacesRetired.dismiss', locale)}
        title={t('engine.studio.interfacesRetired.dismiss', locale)}
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
