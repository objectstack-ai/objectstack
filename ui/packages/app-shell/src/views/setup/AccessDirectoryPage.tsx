// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Access control → Positions and permissions: the environment
 * directory and each of its types' lists in the environment scope, moved out
 * of Studio's menu (ADR-0084, amendment of 2026-11-26; see `accessDirectory.ts`
 * for what the page serves and where everything else opens).
 *
 * It mounts the metadata-admin pages Studio's cross-package leg mounted, under
 * the same host shape (`packageId: null`, the leg's), rooted at this page, so
 * the reads, the activation switches and every server refusal are theirs.
 *
 * Gated by {@link ACCESS_DIRECTORY_CAPABILITY}, read exactly as Studio's entry
 * gate reads it (`holdsAccessDirectoryCapability`): opening the directory from
 * Setup must not widen who sees it (objectstack#37565). Without it the page
 * reads nothing.
 */

import * as React from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Alert, AlertDescription } from '@object-ui/components';
import { usePermissions } from '@object-ui/permissions';
import { MetadataAreaHostContext, type MetadataAreaHost } from '../metadata-admin/metadataAreaHost.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import {
  ACCESS_DIRECTORY_CAPABILITY,
  ACCESS_DIRECTORY_PATH,
  accessDirectoryLocation,
  holdsAccessDirectoryCapability,
} from './accessDirectory.js';

const MetadataDirectoryPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataDirectoryPage })),
);
const MetadataResourceListPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataResourceListPage })),
);

/** The host the pages read: the cross-package leg's shape, rooted here. */
const HOST: MetadataAreaHost = { packageId: null, readOnly: false, basePath: ACCESS_DIRECTORY_PATH };

function Loading({ locale }: { locale: string }): React.ReactElement {
  return (
    <div role="status" className="p-6 text-sm text-muted-foreground">
      {t('engine.studio.loading', locale)}
    </div>
  );
}

export function AccessDirectoryPage(): React.ReactElement {
  const { pathname, search } = useLocation();
  const { '*': splat } = useParams();
  const locale = useMetadataLocale();
  const { systemPermissions } = usePermissions();
  const allowed = holdsAccessDirectoryCapability(systemPermissions);

  if (!allowed) {
    return (
      <div className="p-4 sm:p-6" data-testid="access-directory-page">
        <Alert data-testid="access-directory-not-allowed">
          <AlertDescription>
            {tFormat('engine.setup.accessDirectory.notAllowed', locale, { capability: ACCESS_DIRECTORY_CAPABILITY })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // The sub-path below this page is the route's own splat, so it is read on
  // every address the shell serves the page at: the shell serves Setup at its
  // package id (`/apps/com.objectstack.setup/...`), not at the `setup` alias
  // `ACCESS_DIRECTORY_PATH` spells (objectstack#38206). The prefix read stays
  // only for a mount without a splat.
  const rest = (
    splat ??
    (pathname.startsWith(ACCESS_DIRECTORY_PATH) ? pathname.slice(ACCESS_DIRECTORY_PATH.length) : '')
  ).replace(/^\/+/, '');
  const redirect = accessDirectoryLocation(rest, search);
  if (redirect) return <Navigate to={redirect} replace />;

  return (
    <MetadataAreaHostContext.Provider value={HOST}>
      <div className="h-full overflow-hidden" data-testid="access-directory-page">
        <React.Suspense fallback={<Loading locale={locale} />}>
          <Routes>
            <Route index element={<MetadataDirectoryPage />} />
            <Route path=":type" element={<MetadataResourceListPage />} />
          </Routes>
        </React.Suspense>
      </div>
    </MetadataAreaHostContext.Provider>
  );
}
