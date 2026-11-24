// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Setup app's first page: what a host draws above it (objectstack#36732).
 *
 * From 768 px up the platform home page retired, so an administrator who has
 * an app no longer passes through `/home`, where the host's first-run
 * checklist used to sit. The maintainer's pick (item 5 of #36732, option A)
 * moves it to the top of the Setup app's first page: the page Setup's root
 * lands on for this member (`AppContent`'s `resolveLandingRoute`, the same
 * answer the sidebar's first entry gives), not a page spelled here, so a
 * re-ordered Setup navigation moves the checklist with it.
 *
 * The host hands the element in through this slot (the console's is its
 * `FirstRunChecklist`, which decides itself who sees it and hides once the
 * list is done). The slot is drawn from 768 px up only, so a phone is as it
 * was: its Setup root is the app's menu (`PhoneAppHome`), and its `/home` is
 * the app list alone (objectstack#35881). The no-apps empty state still draws
 * the checklist through Home's own `checklist` slot.
 *
 * @module
 */

import * as React from 'react';

/** Draws what the host puts above the Setup app's first page, or nothing. */
export type SetupFirstPageSlot = () => React.ReactNode;

const SetupFirstPageSlotContext = React.createContext<SetupFirstPageSlot | null>(null);

/** Provides the host's element for the top of the Setup app's first page. */
export function SetupFirstPageSlotProvider({
  value,
  children,
}: {
  value: SetupFirstPageSlot | null;
  children: React.ReactNode;
}) {
  return <SetupFirstPageSlotContext.Provider value={value}>{children}</SetupFirstPageSlotContext.Provider>;
}

/** The host's element for the top of the Setup app's first page, if any. */
export function useSetupFirstPageSlot(): SetupFirstPageSlot | null {
  return React.useContext(SetupFirstPageSlotContext);
}

/**
 * Is this in-app path the landing route? `landing` is `resolveLandingRoute`'s
 * answer, relative to the app (`dashboard/system_overview`, possibly with a
 * query of its own); `inAppPath` is the location's path after `/apps/SEGMENT/`.
 * The query is not compared: an overlay in the URL (`?palette=1`) is still the
 * first page.
 */
export function isLandingPath(inAppPath: string, landing: string): boolean {
  const trim = (path: string) => path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
  const target = trim(landing);
  return target !== '' && trim(inAppPath) === target;
}
