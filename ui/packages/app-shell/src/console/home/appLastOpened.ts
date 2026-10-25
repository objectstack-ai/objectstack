/**
 * When the user last had each app open, read from the recent-items store
 * (objectui#12601): the time under a Home app tile ("Opened 2 hours ago").
 *
 * The store records no app visits of its own. It records what was opened
 * INSIDE an app (an object, a dashboard, a page, a report, a record, a Studio
 * metadata item), each with the `href` it was opened at and its `visitedAt`.
 * Every one of those addresses is `/apps/<segment>/…`, and the segment is the
 * app the user was in: the route's own app segment (`useTrackRouteAsRecent`,
 * `RecordDetailView`). So an app was last open when the newest entry under its
 * segment was visited, and the segment is resolved to its app the way the
 * router resolves it, `matchAppBySegment` (the package id, else the name alias
 * a URL may use).
 *
 * An app with no entry left in the store (it keeps a handful, newest first, and
 * a Studio package entry lives under `/studio`, outside every app) has no time:
 * it is absent from the map and its tile draws no line, rather than a guess.
 *
 * @module
 */
import { matchAppBySegment } from '../../utils/index.js';
import type { RecentItem } from '../../hooks/useRecentItems.js';

/**
 * The relative-time form a tile's line is drawn in (objectui#12601):
 * `Intl.RelativeTimeFormat`'s `short` style, `numeric: 'always'` — "3 hr. ago",
 * "1 day ago", "3小时前". The line is 11 px in a 112 px tile and is never cut
 * with an ellipsis, so the long form does not fit ("Opened 6 seconds ago"
 * was measured truncating), and `numeric: 'auto'`'s phrases ("le mois
 * dernier", "l'année dernière") are the longest any pack produces. Each pack's
 * `home.appOpened` keeps its verb only where verb and time still fit. The
 * width budget every pack's line is held to, and its derivation, are pinned in
 * `appTileOpenedLine-12601.test.ts`.
 */
export const TILE_OPENED_TIME_FORMAT = { style: 'short', numeric: 'always' } as const;

/**
 * The app segment of an `/apps/<segment>/…` address, or `undefined` for any other.
 * Also the app a Home "Recently accessed" row's trail names (objectui#12604).
 */
export function appSegmentOf(href: string): string | undefined {
  const parts = href.split(/[?#]/, 1)[0].split('/').filter(Boolean);
  if (parts[0] !== 'apps' || !parts[1]) return undefined;
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return parts[1];
  }
}

/**
 * Each app's last-opened time, by app `name`: the `visitedAt` of the newest
 * recent entry opened inside it. Apps with no such entry are not in the map.
 */
export function lastOpenedByApp(
  // The app list exactly as the router's resolver takes it — no second app shape.
  apps: Parameters<typeof matchAppBySegment>[0],
  // The two members of a store entry this reads.
  recentItems: ReadonlyArray<Pick<RecentItem, 'href' | 'visitedAt'>>,
): Map<string, string> {
  const opened = new Map<string, { iso: string; ms: number }>();
  for (const item of recentItems) {
    const segment = appSegmentOf(item.href);
    if (!segment) continue;
    const ms = Date.parse(item.visitedAt);
    if (Number.isNaN(ms)) continue;
    const app = matchAppBySegment(apps, segment);
    if (!app || typeof app.name !== 'string') continue;
    const known = opened.get(app.name);
    if (!known || ms > known.ms) opened.set(app.name, { iso: item.visitedAt, ms });
  }
  return new Map([...opened].map(([name, { iso }]) => [name, iso]));
}
