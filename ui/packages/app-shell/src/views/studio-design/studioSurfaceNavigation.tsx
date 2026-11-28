// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's navigation, moved out of `StudioDesignSurface.tsx`
 * unchanged by objectstack#37553 (a move-only split): the notice a landing from
 * a retired Interfaces URL shows once, the host side of the `?surface=`
 * channel, the re-entry of the page already shown, and the command palette's
 * Studio scope.
 */

import * as React from 'react';
import { useLocation, type NavigateFunction } from 'react-router-dom';
import type { StudioPaletteSurface } from '../../chrome/CommandPalette.js';
import { useCommandPaletteProviderMounted } from '../../context/CommandPaletteProvider.js';
import { StudioPaletteGroups } from './StudioPaletteGroups.js';
import { openStudioPaletteAddress } from './studioPaletteModel.js';
import { isRetiredInterfacesLanding } from './studioInterfacesRetired.js';
import { studioOrgScopePath } from './studioScope.js';
import { studioItemPath } from './studioAddress.js';
import type { SurfaceTarget } from './useSurfaceDeepLink.js';
import type { PkgEntry } from './packages-io.js';

/** The notice a landing from a retired Interfaces URL shows, latched on the page it landed on. */
export function useRetiredInterfacesLanding() {
  // objectstack#36502 — a landing from an old Interfaces URL says once where
  // interface editing went. The landing's history state is read once and
  // latched here, keyed on the page it landed on: the Changes drawer drops
  // `?changes=` right after the landing, and the area writes its `?package=`,
  // and those navigations carry no state. objectstack#36904 — keyed on the
  // path, not the pillar: the home is the area's object list now, and the
  // area's other pages share its segment. It goes when dismissed or when the
  // author leaves for another page; another old URL is a new history state,
  // so it shows again.
  const { state: landingState, pathname: landingPath }: { state: unknown; pathname: string } = useLocation();
  const [retiredOn, setRetiredOn] = React.useState<string | null>(() =>
    isRetiredInterfacesLanding(landingState) ? landingPath : null,
  );
  React.useEffect(() => {
    if (isRetiredInterfacesLanding(landingState)) setRetiredOn(landingPath);
    // Keyed on the state object alone: a new landing is a new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingState]);
  React.useEffect(() => {
    if (retiredOn !== null && retiredOn !== landingPath) setRetiredOn(null);
  }, [retiredOn, landingPath]);
  const retiredLanding = retiredOn !== null && retiredOn === landingPath;
  return { retiredLanding, setRetiredOn };
}

/** Where a surface request, a menu re-entry and a palette pick take the author. */
export function useStudioSurfaceNavigation({
  scopeSegment,
  allScope,
  packageId,
  draftScope,
  pkgMissing,
  pkgEntry,
  confirmLeavePillar,
  shellNavigate,
  setChangesOpen,
}: {
  scopeSegment: string;
  allScope: boolean;
  packageId: string | null;
  draftScope: string | null;
  pkgMissing: boolean;
  pkgEntry: PkgEntry | null;
  confirmLeavePillar: () => boolean;
  shellNavigate: NavigateFunction;
  setChangesOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  /**
   * Host side of the live `?surface=` channel. Producers below the provider —
   * today the pending-changes sheet's security block, which names a draft the
   * publish door would refuse — hand us a surface identity and we put the
   * author in front of it: the item's own address, vetoed (`false`) when the
   * author declines to abandon unsaved edits, so a request never outlives the
   * navigation it needed. A type with no designer page of its own moves
   * nothing.
   *
   * Either way the sheet closes: a selection nobody can see is not navigation.
   */
  const currentPathname = useLocation().pathname;
  const requestSurface = React.useCallback(
    (target: SurfaceTarget): boolean | void => {
      // objectstack#36904 — an object is its designer's own address, in the
      // package that holds the draft the sheet names (`draftScope`): on a
      // read-only base, the `.custom` pair, where an object the pair adds
      // resolves and the base's address does not. objectstack#36909 — a
      // permission set the same way: its matrix's address, in that package
      // (it used to go through the retired Access pillar's address).
      if ((target.type === 'object' || target.type === 'permission') && draftScope !== null) {
        const to = studioItemPath(draftScope, target.type, target.name);
        if (to !== currentPathname) {
          if (!confirmLeavePillar()) return false;
          shellNavigate(to);
        }
        setChangesOpen(false);
        return;
      }
      // objectstack#36903 — a flow is its designer's own address, in a
      // package's area or the package-less scope's.
      if (target.type === 'flow' && !allScope) {
        const to = packageId === null ? studioOrgScopePath(target) : studioItemPath(packageId, 'flow', target.name);
        if (to.split('?')[0] !== currentPathname) {
          if (!confirmLeavePillar()) return false;
          shellNavigate(to);
        }
        setChangesOpen(false);
        return;
      }
      setChangesOpen(false);
    },
    [allScope, packageId, draftScope, confirmLeavePillar, shellNavigate, currentPathname, setChangesOpen],
  );
  // objectstack#36899 — a menu entry or a palette pick that is the page
  // already shown, on another query, asks about unsaved work first: the
  // shell's link guard lets a link to the page already shown through.
  // objectstack#36909 — it used to remount the open pillar too, so the pillar
  // read the new deep link at mount; no pillar draws a page any more, and the
  // area's pages read their own query.
  const currentSearch = useLocation().search;
  const reenterPillar = React.useCallback((_search: string): boolean => confirmLeavePillar(), [confirmLeavePillar]);
  // objectstack#26708 — a package that is not there has no menu.
  const showMenu = !pkgMissing;

  // objectstack#36900 — ⌘K on every design page (decision 7 of #36890: an
  // author switches items by ×, by ‹ › and by ⌘K). The palette lists this
  // scope's menu, and on a package its items (`StudioPaletteGroups`); a pick
  // leaves the way a menu entry does: it asks about unsaved work, and an
  // address that is the page already open on another query re-enters the
  // page, which reads its deep link once, at mount. The palette's own
  // `?palette=` is not part of the page's query. A package that is not there
  // has no menu, so its palette is the landing's. (`currentPathname` is read
  // above, for `requestSurface`.)
  const openFromPalette = React.useCallback(
    (to: string) =>
      openStudioPaletteAddress(
        to,
        { pathname: currentPathname, search: currentSearch },
        { navigate: shellNavigate, reenter: reenterPillar },
      ),
    [currentPathname, currentSearch, reenterPillar, shellNavigate],
  );
  const paletteLabel = packageId !== null && pkgEntry?.id === packageId ? pkgEntry.name : undefined;
  const paletteSurface = React.useMemo<StudioPaletteSurface | undefined>(
    () =>
      showMenu
        ? {
            packageScope: packageId !== null,
            renderGroups: (groupsProps) => (
              <StudioPaletteGroups segment={scopeSegment} packageLabel={paletteLabel} {...groupsProps} />
            ),
            open: openFromPalette,
          }
        : undefined,
    [showMenu, packageId, scopeSegment, paletteLabel, openFromPalette],
  );
  // A host that already mounts a command palette above this surface keeps
  // its own: a second provider would toggle the one `?palette=` twice per
  // ⌘K, and a second palette would draw a second dialog.
  const paletteHosted = useCommandPaletteProviderMounted();
  return { requestSurface, reenterPillar, showMenu, paletteSurface, paletteHosted };
}
