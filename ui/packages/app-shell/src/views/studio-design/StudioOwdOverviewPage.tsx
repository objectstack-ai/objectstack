// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package's organization-wide default sharing overview, on its own route
 * (objectstack#36905, Studio redesign epic #36890 decision 11):
 * `/studio/<package>/owd`, the Access group's entry in the left menu. Before,
 * it was the Access pillar's pinned rail row (`?surface=owd:overview`), which
 * now redirects here (`accessPillarRedirect.ts`).
 *
 * Not a metadata item: one table of every object the package owns, each row
 * its record visibility (`PackageOwdOverviewPanel`, unchanged). A permission
 * set's per-object visibility badge opens it on that object (`?object=`).
 *
 * Save is the Studio top bar's (objectstack#36511); the panel's unsaved rows
 * are reported to the surface (`onDirtyChange`), whose leave guard asks before
 * the menu, a reload or a tab close drops them (decision 12).
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, ShieldQuestion } from 'lucide-react';
import { AccessExplainPanel } from '../metadata-admin/AccessExplainPanel.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { t, useMetadataLocale } from '../metadata-admin/i18n.js';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel.js';
import { StudioItemHeader } from './StudioItemHeader.js';
import { StudioReadOnlyLink } from './StudioPillarKit.js';
import { STUDIO_OWD_OBJECT_PARAM } from './studioAddress.js';

export interface StudioOwdOverviewPageProps {
  packageId: string;
  publishNonce?: number;
  /** The package is read-only: the table shows its badges only. */
  readOnly?: boolean;
  /** Mirrors the table's unsaved rows up to the surface's leave guard; `false` on unmount. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function StudioOwdOverviewPage({
  packageId,
  publishNonce,
  readOnly = false,
  onDirtyChange,
}: StudioOwdOverviewPageProps): React.ReactElement {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get(STUDIO_OWD_OBJECT_PARAM);
  const [explainOpen, setExplainOpen] = React.useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="studio-owd-page">
      <StudioItemHeader
        testId="owd-item-header"
        icon={ShieldCheck}
        title={t('engine.studio.owd.title', locale)}
        meta={t('engine.studio.owd.subtitle', locale)}
        actions={
          <>
            {readOnly && (
              <StudioReadOnlyLink item={null} title={t('engine.studio.access.bannerTitleReadOnly', locale)} locale={locale} />
            )}
            <button
              type="button"
              data-testid="access-explain"
              onClick={() => setExplainOpen(true)}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ShieldQuestion className="h-3.5 w-3.5" />
              {t('engine.studio.access.explain.open', locale)}
            </button>
          </>
        }
      />
      <main className="min-h-0 flex-1 overflow-auto">
        <PackageOwdOverviewPanel
          client={client}
          packageId={packageId}
          publishNonce={publishNonce}
          readOnly={readOnly}
          locale={locale}
          highlightObject={highlight}
          onDirtyChange={onDirtyChange}
        />
      </main>
      <AccessExplainPanel open={explainOpen} onOpenChange={setExplainOpen} packageId={packageId} />
    </div>
  );
}
