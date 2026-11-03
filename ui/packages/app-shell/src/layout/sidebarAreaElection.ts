/**
 * Which navigation area the Console sidebar shows for the current route.
 *
 * "The entry the current route addresses" is the entry
 * `resolveActiveNavItem` elects, the same match `NavigationRenderer` uses to
 * highlight a row, so the elected area and the highlighted entry always agree.
 * No second route matcher lives here.
 *
 * @module
 */

import { resolveActiveNavItem } from '@object-ui/layout';
import type { NavigationArea, NavigationItem } from '@object-ui/types';

type NavTemplateContext = Parameters<typeof resolveActiveNavItem>[4];

/** The route an area is judged against. */
export interface SidebarAreaRoute {
  pathname: string;
  search: string;
  basePath: string;
  templateContext?: NavTemplateContext;
}

/** Whether an entry of `area` addresses the route. */
export function areaAddressesRoute(area: NavigationArea, route: SidebarAreaRoute): boolean {
  return (
    resolveActiveNavItem(
      area.navigation ?? [],
      route.pathname,
      route.search,
      route.basePath,
      route.templateContext,
    ) !== null
  );
}

/**
 * The id of the area whose navigation holds the entry the route addresses, or
 * `null` when no area's entry does. The match runs once over every area's
 * entries together, so the most specific entry wins across areas, and a tie
 * goes to the earlier area, as it does to the earlier row within one menu.
 */
export function areaForRoute(areas: NavigationArea[], route: SidebarAreaRoute): string | null {
  const active = resolveActiveNavItem(
    areas.flatMap((area) => area.navigation ?? []),
    route.pathname,
    route.search,
    route.basePath,
    route.templateContext,
  );
  if (!active) return null;
  const holds = (items: NavigationItem[] | undefined): boolean =>
    !!items?.some((item) => item === active || holds(item.children));
  return areas.find((area) => holds(area.navigation))?.id ?? null;
}

/**
 * The area the sidebar shows, given the one it shows now.
 *
 * The current area stays while one of its entries addresses the route, so a
 * reader's own area pick is not overridden on a page that area holds.
 * Otherwise the area holding the entry the route addresses is elected. With
 * none, the current area stays, else the first visible one.
 */
export function electSidebarArea(
  visibleAreas: NavigationArea[],
  currentId: string | null,
  route: SidebarAreaRoute | null,
): string | null {
  if (visibleAreas.length === 0) return null;
  const current = visibleAreas.find((area) => area.id === currentId);
  if (route) {
    if (current && areaAddressesRoute(current, route)) return current.id;
    const routed = areaForRoute(visibleAreas, route);
    if (routed) return routed;
  }
  return current ? current.id : visibleAreas[0].id;
}
