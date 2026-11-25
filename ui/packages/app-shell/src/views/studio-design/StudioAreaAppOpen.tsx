// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dashboard or a report opened from a Studio list opens in the app's own
 * edit state (objectstack#36906, epic #36890), and a report's New opens the
 * app's new-report page (decision 13). This component is the one step between
 * the two places:
 *
 *  1. It reads the open package's published apps and, when the author came
 *     from an app outside the package, that app's menu.
 *  2. It picks the app (decision 6, `studioAppEditSegment`).
 *  3. It replaces the Studio address with the app's. A dashboard or a report
 *     carries its arrival in the navigation state, so the page opens the
 *     dashboard's edit state or the report's builder as its Edit does, and
 *     the address carries the Studio list (`?studio=`, decision 15), so the
 *     page's × goes back to the list, after a reload too.
 *
 * With no app to open in, it renders `fallback`: the generic item page, or
 * the area's own create (decision 3).
 *
 * The Studio address is replaced, not stacked, so the browser's Back from the
 * app page lands on the list, as × does.
 */

import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { readAppReturnPage } from '../../utils/appReturnPage.js';
import { dashboardEditArrival } from '../../layout/designModeArrival.js';
import { reportBuilderArrival } from '../reportBuilderArrival.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { ITEM_ONLY_PARAMS, detailListHref } from '../metadata-admin/ResourceDetailHeader.js';
import { useMetadataAreaHost } from '../metadata-admin/metadataAreaHost.js';
import { t, useMetadataLocale } from '../metadata-admin/i18n.js';
import { withStudioReturn } from './studioAddress.js';
import {
  appItemPath,
  appNewReportPath,
  isStudioAppEditType,
  rememberedPackageApp,
  studioAppCreateSegment,
  studioAppEditSegment,
  type StudioAppEditType,
  type StudioAppTarget,
} from './studioAppEdit.js';

/** What opens in the app: an item's page, or the new-report page. */
export type StudioAreaAppTarget = { kind: 'item'; type: StudioAppEditType; name: string } | { kind: 'new-report' };

type Answer = { to: string; state: Record<string, string> | null } | 'fallback';

export function StudioAreaAppOpen({
  packageId,
  target,
  fallback,
}: {
  /** The open package. */
  packageId: string;
  target: StudioAreaAppTarget;
  /** What renders when no app can open it. */
  fallback: React.ReactElement;
}): React.ReactElement {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const { pathname, search } = useLocation();
  // Read once per open, as the back link reads it: nothing in Studio is an app page.
  const [remembered] = React.useState(readAppReturnPage);
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  // The address it opened on: the list it returns to is read from it.
  const openedAt = React.useRef({ pathname, search });

  React.useEffect(() => {
    let cancelled = false;
    const type: StudioAppEditType = target.kind === 'item' ? target.type : 'report';
    const name = target.kind === 'item' ? target.name : '';
    void (async () => {
      let apps: StudioAppTarget[];
      try {
        const listed = (await client.list('app', { packageId })) as Array<Record<string, unknown>>;
        apps = (listed || [])
          .filter((a) => typeof a?.name === 'string' && a.name)
          .map((a) => ({ name: String(a.name), label: (a.label ?? a.name) as StudioAppTarget['label'] }));
      } catch {
        apps = [];
      }
      // The remembered app's own menu counts only for an item, and only when
      // the app is not one of the package's: the package's own apps win first.
      let rememberedMenu: unknown;
      if (target.kind === 'item' && remembered && !rememberedPackageApp(remembered, packageId, apps)) {
        try {
          const app = (await client.get('app', remembered.app)) as { navigation?: unknown } | null;
          rememberedMenu = app?.navigation;
        } catch {
          rememberedMenu = undefined;
        }
      }
      if (cancelled) return;
      const segment =
        target.kind === 'item'
          ? studioAppEditSegment({ packageId, apps, remembered, rememberedMenu, type, name })
          : studioAppCreateSegment({ packageId, apps, remembered });
      if (!segment) {
        setAnswer('fallback');
        return;
      }
      const opened = openedAt.current;
      const list = detailListHref(opened.pathname, new URLSearchParams(opened.search));
      if (target.kind === 'item') {
        setAnswer({
          to: withStudioReturn(appItemPath(segment, type, name), list),
          state: type === 'dashboard' ? dashboardEditArrival(name) : reportBuilderArrival(name),
        });
      } else {
        setAnswer({ to: withStudioReturn(appNewReportPath(segment), list), state: null });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Decided once per open: the component is keyed by the item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (answer === 'fallback') return fallback;
  if (answer) return <Navigate to={answer.to} replace state={answer.state} />;
  return (
    <div role="status" className="p-6 text-sm text-muted-foreground" data-testid="studio-area-app-open">
      {t('engine.studio.loading', locale)}
    </div>
  );
}


/**
 * `<root>/:type/:name` in the area: a dashboard or a report on a plain open
 * opens in its app (`StudioAreaAppOpen`), and its generic item page is the
 * fallback; every other item renders `children`, the area's own open.
 *
 * An address that asks the item page for one of its own tools (a tab, the
 * draft review, a selection: `ITEM_ONLY_PARAMS`) keeps the item page, so the
 * History tab and the draft door's review links still land there. So does an
 * item on the cross-package leg, which has no package to pick an app from.
 * Decided once per item, when it opens: the area keys this by the item.
 */
export function StudioAreaAppGate({
  type,
  name,
  children,
}: {
  type: string;
  name: string;
  children: React.ReactElement;
}): React.ReactElement {
  const host = useMetadataAreaHost();
  const { search } = useLocation();
  const [inApp] = React.useState(() => {
    const params = new URLSearchParams(search);
    return isStudioAppEditType(type) && !!host?.packageId && !ITEM_ONLY_PARAMS.some((key) => params.has(key));
  });
  if (!inApp || !host?.packageId || !isStudioAppEditType(type)) return children;
  return <StudioAreaAppOpen packageId={host.packageId} target={{ kind: 'item', type, name }} fallback={children} />;
}
