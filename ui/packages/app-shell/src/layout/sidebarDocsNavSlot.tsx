// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shell sidebar's place for an app's documentation navigation
 * (objectstack#37150, ruling 7142354097 on objectstack#36107: docs render in
 * one appearance, inside the app shell).
 *
 * From 768 px up an app's docs pages (`/apps/APP/docs…`) draw in the app shell
 * like every other app page: the resident sidebar, with its head (the app-name
 * menu, the collapse button, search and the bell) and its foot (the account),
 * and no top bar. What the sidebar's body carries there is the docs' own
 * navigation, not the app's menu (objectstack#35424: a reader has one
 * navigation, the docs'). The docs pages build that navigation from the books
 * they read, so the sidebar only holds the place: `UnifiedSidebar` draws
 * {@link SidebarDocsNavTarget} where the app's menu would be, and the page
 * draws its column into it through {@link SidebarDocsNav}, a portal, so the
 * column keeps the page's router and data context.
 *
 * Outside that place (a phone, which keeps its bar and its in-page column; the
 * `/docs` portal; a test that mounts a page bare) {@link useSidebarDocsNavSlot}
 * answers `null` and the page draws its column itself, as before.
 *
 * @module
 */

import * as React from 'react';
import { createPortal } from 'react-dom';

interface SlotContextValue {
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
}

const SidebarDocsNavSlotContext = React.createContext<SlotContextValue | null>(null);

/** Holds the sidebar's docs-navigation element for the docs pages to draw into. `ConsoleLayout` mounts it. */
export function SidebarDocsNavSlotProvider({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  const value = React.useMemo(() => ({ slot, setSlot }), [slot]);
  return <SidebarDocsNavSlotContext.Provider value={value}>{children}</SidebarDocsNavSlotContext.Provider>;
}

/** The element the sidebar holds open for the docs navigation, or `null` where there is none. */
export function useSidebarDocsNavSlot(): HTMLElement | null {
  return React.useContext(SidebarDocsNavSlotContext)?.slot ?? null;
}

/** The sidebar's side: the element the docs navigation is drawn into, in place of the app's menu. */
export function SidebarDocsNavTarget() {
  const setSlot = React.useContext(SidebarDocsNavSlotContext)?.setSlot;
  const ref = React.useCallback((el: HTMLDivElement | null) => setSlot?.(el), [setSlot]);
  return <div ref={ref} data-testid="sidebar-docs-nav" className="px-2 pb-4" />;
}

/** The page's side: draws `children` in the sidebar's docs place, or nothing where there is none. */
export function SidebarDocsNav({ children }: { children: React.ReactNode }) {
  const slot = useSidebarDocsNavSlot();
  return slot ? createPortal(children, slot) : null;
}
