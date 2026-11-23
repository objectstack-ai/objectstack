// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a host draws at the bottom of an app's sidebar (objectstack#36739).
 *
 * The console's is the administrator's 「Get started n/m」 pill: the first-run
 * checklist's progress, in every app, opening the list in place. The host
 * decides who sees it and when it stands aside; the sidebar only gives it the
 * place, so the shell names no product feature here (ADR-0060).
 *
 * Two places, named by `where`:
 *
 * - `sidebar`: from 768 px up, in the sidebar's footer above the account
 *   button. The sidebar may be folded to its icon rail; the element sees the
 *   rail's `group-data-[collapsible=icon]` variant like every footer row.
 * - `phoneAppHome`: on a phone, which has no resident sidebar, after the app's
 *   menu on the app's home page (`PhoneAppHome`), the page that lists what the
 *   sidebar lists.
 *
 * @module
 */

import * as React from 'react';

/** Where the sidebar draws the host's element. */
export type SidebarFooterSlotPlace = 'sidebar' | 'phoneAppHome';

/** Draws what the host puts at the bottom of an app's sidebar, or nothing. */
export type SidebarFooterSlot = (where: SidebarFooterSlotPlace) => React.ReactNode;

const SidebarFooterSlotContext = React.createContext<SidebarFooterSlot | null>(null);

/** Provides the host's element for the bottom of an app's sidebar. */
export function SidebarFooterSlotProvider({
  value,
  children,
}: {
  value: SidebarFooterSlot | null;
  children: React.ReactNode;
}) {
  return <SidebarFooterSlotContext.Provider value={value}>{children}</SidebarFooterSlotContext.Provider>;
}

/** The host's element for the bottom of an app's sidebar, if any. */
export function useSidebarFooterSlot(): SidebarFooterSlot | null {
  return React.useContext(SidebarFooterSlotContext);
}
