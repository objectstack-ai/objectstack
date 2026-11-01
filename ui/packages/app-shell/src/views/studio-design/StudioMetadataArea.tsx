// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's "All metadata" area (objectstack ADR-0146 D1, #28561): the type
 * directory, the lists, the generic item page, history and diagnostics, per
 * package beside the four pillars and across packages for the environment
 * catalog.
 *
 * The pages are the metadata-admin pages Setup mounts today, MOUNTED here, not
 * copied, under the same route shapes (`metadataArea.ts` names the two legs):
 *
 *   <root>                     the type directory
 *   <root>/_diagnostics        diagnostics
 *   <root>/:type               a type's list
 *   <root>/:type/new           create (a writable package only)
 *   <root>/:type/:name         the generic item page, or the item's pillar
 *   <root>/:type/:name/history the item's history
 *
 * Mirroring Setup's shapes keeps every relative link the pages emit pointing
 * where it points there. What the area adds, it hands the pages through
 * {@link MetadataAreaHostContext}: the package, its read-only state and the
 * root. "No new write path": a writable package's pages save exactly as Setup's
 * do with `?package=`, through the same components and doors.
 *
 * Assignments are Setup's (D7): the pages read the host and link the Setup
 * assignment pages instead of drawing them. The datasource is Setup's runtime
 * configuration: its URLs here open Setup's Datasources page.
 */

import * as React from 'react';
import { Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  MetadataAreaHostContext,
  SETUP_DATASOURCES_PATH,
  useMetadataAreaHost,
  type MetadataAreaHost,
} from '../metadata-admin/metadataAreaHost.js';
import { t, useMetadataLocale } from '../metadata-admin/i18n.js';
import { fetchListedPackageManifests } from './packages-io.js';
import {
  STUDIO_ALL_PACKAGES_SEGMENT,
  areaItemPillarPath,
  areaLocationRedirect,
  studioMetadataAreaPath,
} from './metadataArea.js';

/*
 * The pages load with the area, through the specifier `AppContent` loads them
 * by (`../metadata-admin/index.js`), so Studio and Setup share their one chunk
 * and the Studio builder's own chunk does not grow by them.
 */
const MetadataDirectoryPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataDirectoryPage })),
);
const MetadataDiagnosticsPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataDiagnosticsPage })),
);
const MetadataResourceListPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataResourceListPage })),
);
const MetadataResourceEditPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataResourceEditPage })),
);
const MetadataResourceHistoryPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataResourceHistoryPage })),
);

/**
 * Is this package writable, as `GET /api/v1/packages` says? `undefined` while
 * asking, `null` when the list could not say (the read failed, or it lists no
 * such id).
 *
 * Read from the listed manifests, which keep the kernel packages the
 * switcher's entries hide: the surface's own courtesy gate reads the switcher's
 * entries, so a kernel package reads as "unknown" there, and the generic item
 * page would then offer its overlay save on a package nobody may write. The
 * verdict rule is the one `parsePackages` applies. One request either way: the
 * readers of that endpoint share it (`packages-io.ts`).
 */
function useListedPackageWritable(packageId: string | null): boolean | null | undefined {
  const [answer, setAnswer] = React.useState<{ id: string; writable: boolean | null } | null>(null);
  React.useEffect(() => {
    if (packageId === null) return;
    let cancelled = false;
    fetchListedPackageManifests().then(
      (manifests) => {
        if (!cancelled) setAnswer({ id: packageId, writable: manifests.get(packageId)?.writable ?? null });
      },
      () => {
        // The surface reports the failure once (its package-list toast).
        if (!cancelled) setAnswer({ id: packageId, writable: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [packageId]);
  if (packageId === null) return null;
  return answer?.id === packageId ? answer.writable : undefined;
}

function AreaLoading({ locale }: { locale: string }): React.ReactElement {
  return (
    <div role="status" className="p-6 text-sm text-muted-foreground">
      {t('engine.studio.loading', locale)}
    </div>
  );
}

/**
 * `<root>/:type/:name`: a pillar type opens its pillar, every other type the
 * generic item page (`areaItemPillarPath` lists when).
 *
 * Decided once per item, when it opens: the item page itself rewrites the
 * query it opened with (it drops `?review=1` once the review sheet is open),
 * and that must not send an open review on to the pillar.
 */
function AreaItem(): React.ReactElement {
  const { type = '', name = '' } = useParams<{ type: string; name: string }>();
  const [search] = useSearchParams();
  const host = useMetadataAreaHost();
  const decided = React.useRef<{ key: string; pillarPath: string | null } | null>(null);
  // A type never holds a `/`, so this names one item.
  const key = `${type}/${name}`;
  if (decided.current?.key !== key) {
    decided.current = {
      key,
      pillarPath: areaItemPillarPath({ packageId: host?.packageId ?? null, type, name, search }),
    };
  }
  if (decided.current.pillarPath) return <Navigate to={decided.current.pillarPath} replace />;
  return <MetadataResourceEditPage />;
}

/** `<root>/:type/new`: a read-only package takes no new item, so its create URL lands on the list. */
function AreaCreate(): React.ReactElement {
  const { type = '' } = useParams<{ type: string }>();
  const { search } = useLocation();
  const host = useMetadataAreaHost();
  if (host?.readOnly) {
    return <Navigate to={`${host.basePath}/${encodeURIComponent(type)}${search}`} replace />;
  }
  return <MetadataResourceEditPage createMode />;
}

export interface StudioMetadataAreaProps {
  /** The package the area is open on, or `null` for the cross-package leg. */
  packageId: string | null;
}

export function StudioMetadataArea({ packageId }: StudioMetadataAreaProps): React.ReactElement {
  const { pathname, search } = useLocation();
  const locale = useMetadataLocale();
  const segment = packageId ?? STUDIO_ALL_PACKAGES_SEGMENT;
  const basePath = studioMetadataAreaPath(segment);
  // The courtesy gate the pillars apply, read for the area from the listed
  // manifests (see the hook). Unknown stays ungated, as on the pillars: the
  // server's write gate is the authority, and a failed probe must not lock an
  // author out of a writable package.
  const writable = useListedPackageWritable(packageId);
  const host = React.useMemo<MetadataAreaHost>(
    () => ({ packageId, readOnly: packageId !== null && writable === false, basePath }),
    [packageId, writable, basePath],
  );

  // The query names the leg (`areaLocationRedirect`). Settled before any page
  // mounts, so no page reads a scope the URL is about to change.
  const rest = pathname.startsWith(basePath) ? pathname.slice(basePath.length).replace(/^\/+/, '') : '';
  const redirect = areaLocationRedirect(segment, rest, search);
  if (redirect) return <Navigate to={redirect} replace />;
  // A page must not offer a write before the package's state is known.
  if (packageId !== null && writable === undefined) return <AreaLoading locale={locale} />;

  return (
    <MetadataAreaHostContext.Provider value={host}>
      <div className="h-full overflow-hidden" data-testid="studio-metadata-area">
        <React.Suspense fallback={<AreaLoading locale={locale} />}>
          <Routes>
            <Route index element={<MetadataDirectoryPage />} />
            <Route path="_diagnostics" element={<MetadataDiagnosticsPage />} />
            <Route path="datasource/*" element={<Navigate to={SETUP_DATASOURCES_PATH} replace />} />
            <Route path=":type" element={<MetadataResourceListPage />} />
            <Route path=":type/new" element={<AreaCreate />} />
            <Route path=":type/:name" element={<AreaItem />} />
            <Route path=":type/:name/history" element={<MetadataResourceHistoryPage />} />
          </Routes>
        </React.Suspense>
      </div>
    </MetadataAreaHostContext.Provider>
  );
}
