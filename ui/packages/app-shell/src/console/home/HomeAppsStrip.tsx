/**
 * HomeAppsStrip
 *
 * iOS-springboard-style app launcher for Home: vibrant gradient squircle
 * icons with the name beneath. Business users live in a handful of apps and
 * switch via the top-bar AppSwitcher / ⌘K — so Home shows apps as recognizable
 * icons, not a wall of marketing cards.
 *
 * Scales from a few apps to hundreds: a capped grid with a "+N more / Show all"
 * toggle keeps the fold stable no matter how many apps exist. Favorites sort
 * first.
 *
 * Each app tile is a router `Link` to the app's route, not a button that
 * navigates on click (objectui#12305). An app is an addressable place, so its
 * tile carries the address: middle-click, ⌘/Ctrl-click, "Open link in new tab",
 * "Copy link address" and the hover destination all work, and `Link` writes the
 * router's basename into `href`, so the address the browser shows is the real
 * one. A plain left-click still navigates in place. The strip owns the address
 * rule, so its two mounts (Home and the `app:launcher` page block) cannot build
 * two different addresses for one app. "More", "Show less" and the marketplace
 * shortcut stay buttons: they open nothing addressable.
 *
 * The strip's look is the Home artboard's apps section (objectui#12601): a
 * 15 px heading with a count pill, 112 px tiles with a 56 px icon on the app's
 * colour and a 13 px name on one line. Three optional parts ride along, all
 * off unless the host asks: an 11 px "2 hr. ago" line under a tile's
 * name (`lastOpened`, which Home reads from the recent-items store), a muted
 * "System Settings" link at the heading's right (`settingsHref` — Home moves
 * Setup off the tile row and onto it), and an admin's trailing dashed "Add app"
 * tile, which opens the marketplace shortcut's route and is gated exactly as
 * the shortcut is.
 *
 * @module
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, Plus, Settings, Star } from 'lucide-react';
import { cn } from '@object-ui/components';
import { useDisplayLocale, useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { appRouteSegment, resolveKeyedI18nLabel } from '../../utils/index.js';
import { getIcon } from '../../utils/getIcon.js';
import { timeAgo } from '../../utils/relativeTime.js';
import { TILE_OPENED_TIME_FORMAT } from './appLastOpened.js';
import type { FavoriteItem } from '../../hooks/useFavorites.js';
import { ICON_BOX_CLASSES, TILE_CLASSES, launcherIconGradient } from './launcherTile.js';

const COMPACT_LIMIT = 19;

/** The 12 px links at the heading's right. */
const HEADER_LINK_CLASSES =
  'inline-flex items-center gap-1.5 rounded-sm text-xs transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function HomeAppsStrip({
  apps,
  favorites,
  onBrowseMarketplace,
  isAdmin,
  canAuthorMetadata = true,
  marketplaceEnabled = true,
  settingsHref,
  lastOpened,
}: {
  apps: any[];
  favorites: FavoriteItem[];
  onBrowseMarketplace: () => void;
  isAdmin: boolean;
  /**
   * [objectstack#8270] Whether the session holds the ADR-0066
   * `manage_metadata` capability. Installing a marketplace template is metadata
   * authoring, so on a deployment that withholds the capability (the EE hosted
   * posture) this entry point is withheld with the rest of them — Home renders
   * the reason once, above. Defaults to `true` so the only behaviour change is
   * for hosts that pass the gate explicitly.
   */
  canAuthorMetadata?: boolean;
  /**
   * [objectui#5504] Whether this runtime mounts a marketplace at all
   * (`features.marketplace` from the server's runtime config). A runtime
   * deployed with `OS_CLOUD_URL=off` has none, and this shortcut used to lead
   * straight to a red "Failed to load marketplace" card. Defaults to `true`,
   * so the only behaviour change is on hosts that report the capability
   * absent.
   */
  marketplaceEnabled?: boolean;
  /**
   * [objectui#12601] The Setup app's route, drawn as a muted "System Settings"
   * link at the heading's right. Home passes it when Setup is among the apps
   * the user can open, and leaves Setup off the tiles: it administers the
   * workspace rather than running a business process. Omitted, no link is
   * drawn and the tiles are whatever `apps` holds — the `app:launcher` block's
   * case.
   */
  settingsHref?: string;
  /**
   * [objectui#12601] When the user last had each app open, by app `name` (an
   * ISO timestamp), drawn under the tile's name as "2 hr. ago" (zh "2小时前打开";
   * the form is `TILE_OPENED_TIME_FORMAT`'s). Home
   * reads it from the recent-items store (`lastOpenedByApp`). An app absent
   * from the map draws no line; omitted, no tile does — the `app:launcher`
   * block's case.
   */
  lastOpened?: ReadonlyMap<string, string>;
}) {
  const { t } = useObjectTranslation();
  const { appLabel } = useObjectLabel();
  const displayLocale = useDisplayLocale();
  const [showAll, setShowAll] = useState(false);

  const favNames = useMemo(
    () => new Set(favorites.filter((f) => f.id.startsWith('app:')).map((f) => f.id.slice(4))),
    [favorites],
  );
  const ordered = useMemo(
    () => [...apps].sort((a, b) => (favNames.has(b.name) ? 1 : 0) - (favNames.has(a.name) ? 1 : 0)),
    [apps, favNames],
  );

  const overflow = ordered.length - COMPACT_LIMIT;
  const visible = showAll ? ordered : ordered.slice(0, COMPACT_LIMIT);
  // The marketplace shortcut and the "Add app" tile open one route, so one
  // gate decides both: an admin, on a session that may author metadata, on a
  // runtime that mounts a marketplace.
  const canInstallApps = isAdmin && canAuthorMetadata && marketplaceEnabled;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">
          {t('home.yourApps', { defaultValue: 'Your apps' })}
        </h2>
        <span
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
          data-testid="home-apps-count"
        >
          {ordered.length}
        </span>
        <div className="ml-auto flex items-center gap-4">
          {canInstallApps && (
            <button
              type="button"
              className={cn(HEADER_LINK_CLASSES, 'text-primary')}
              onClick={onBrowseMarketplace}
              data-testid="browse-marketplace-btn"
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
              {t('home.browseMarketplace', { defaultValue: 'Browse App Marketplace' })}
            </button>
          )}
          {settingsHref && (
            <Link
              to={settingsHref}
              className={cn(HEADER_LINK_CLASSES, 'text-muted-foreground hover:text-foreground')}
              data-testid="home-system-settings-link"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden />
              {t('home.systemSettings', { defaultValue: 'System Settings' })}
            </Link>
          )}
        </div>
      </div>

      {/* `-ml-2` puts the first icon under the heading: a tile pads its icon 8 px. */}
      <div className="-ml-2 flex flex-wrap gap-1">
        {visible.map((app) => {
          const Icon = getIcon(app.icon);
          const label = appLabel({ name: app.name, label: resolveKeyedI18nLabel(app.label, t) });
          const fav = favNames.has(app.name);
          const grad = launcherIconGradient(app.name);
          const openedAgo = timeAgo(lastOpened?.get(app.name), displayLocale, TILE_OPENED_TIME_FORMAT);
          return (
            <Link
              key={app.name}
              // ADR-0048: the route segment is the package id, falling back to
              // the app name for apps with none.
              to={`/apps/${appRouteSegment(app)}`}
              className={TILE_CLASSES}
              data-testid={`app-tile-${app.name}`}
            >
              <span
                className={cn(
                  ICON_BOX_CLASSES,
                  'bg-gradient-to-br text-white shadow-sm transition-transform group-hover:scale-105',
                  grad,
                )}
              >
                <Icon className="size-[26px]" />
                {fav && (
                  <span className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 ring-2 ring-background">
                    <Star className="h-2.5 w-2.5 fill-white text-white" />
                  </span>
                )}
              </span>
              <span className="w-full truncate text-[13px] font-medium">{label}</span>
              {openedAgo && (
                <span
                  className="-mt-1 w-full truncate text-[11px] text-muted-foreground"
                  data-testid={`app-tile-opened-${app.name}`}
                >
                  {t('home.appOpened', { time: openedAgo, defaultValue: '{{time}}' })}
                </span>
              )}
            </Link>
          );
        })}

        {!showAll && overflow > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className={TILE_CLASSES}
            data-testid="apps-show-all"
          >
            <span
              className={cn(
                ICON_BOX_CLASSES,
                'border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors group-hover:border-foreground/30 group-hover:text-foreground',
              )}
            >
              +{overflow}
            </span>
            <span className="w-full truncate text-[13px] text-muted-foreground">
              {t('home.showMoreApps', { defaultValue: 'More' })}
            </span>
          </button>
        )}

        {/* An admin's way to add an app: the marketplace shortcut's own route,
            behind its own gate (objectui#12601). A button for the reason the
            shortcut is one: the strip is handed a callback, not an address. */}
        {canInstallApps && (
          <button
            type="button"
            onClick={onBrowseMarketplace}
            className={cn(TILE_CLASSES, 'text-muted-foreground')}
            data-testid="home-add-app"
          >
            <span
              className={cn(
                ICON_BOX_CLASSES,
                'border-[1.5px] border-dashed border-border transition-colors group-hover:border-foreground/30 group-hover:text-foreground',
              )}
            >
              <Plus className="size-[22px]" aria-hidden />
            </span>
            <span className="w-full truncate text-[13px] font-medium">
              {t('home.addApp', { defaultValue: 'Add app' })}
            </span>
          </button>
        )}
      </div>

      {showAll && overflow > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-2.5 text-xs text-primary hover:underline"
        >
          {t('home.showLess', { defaultValue: 'Show less' })}
        </button>
      )}
    </section>
  );
}
