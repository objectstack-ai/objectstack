/**
 * PhoneAppHome
 *
 * A phone's app home (objectstack#35881): the app's root, `/apps/SEGMENT`,
 * shows the app's whole menu, its groups and its order, one row per entry with
 * its icon. A tap opens the entry's page (an object's list, a dashboard, a
 * report, a page), and 「‹」 there comes back here, where the page is scrolled
 * as it was left. From 768 px up the app root still opens the app's landing
 * entry, as before.
 *
 * The menu is the sidebar's own: `UnifiedSidebar` draws its navigation tree
 * (the same `NavigationRenderer`, pruned by the same member gates, with the
 * same area switcher, labels and icons) into the slot this page holds, through
 * a portal. So the page cannot list an entry the sidebar hides, or order
 * them differently: there is one menu, shown in a second place.
 *
 * @module
 */

import * as React from 'react';
import { useLayoutEffect, useRef } from 'react';

interface SlotContextValue {
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
}

const PhoneAppHomeSlotContext = React.createContext<SlotContextValue | null>(null);

/** Holds the page's slot element for the sidebar to draw into. `ConsoleLayout` mounts it. */
export function PhoneAppHomeSlotProvider({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  const value = React.useMemo(() => ({ slot, setSlot }), [slot]);
  return <PhoneAppHomeSlotContext.Provider value={value}>{children}</PhoneAppHomeSlotContext.Provider>;
}

/** The element the phone app home holds open for the menu, or `null` when none is mounted. */
export function usePhoneAppHomeSlot(): HTMLElement | null {
  return React.useContext(PhoneAppHomeSlotContext)?.slot ?? null;
}

/** Where each app's home was scrolled to when it was left, by app address. */
const scrollByApp = new Map<string, number>();

/** The nearest ancestor that scrolls vertically (the console's inset), else the document's scroller. */
function scrollParentOf(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export interface PhoneAppHomeProps {
  /** The app's address, `/apps/SEGMENT`: the key its scroll position is kept under. */
  basePath: string;
}

export function PhoneAppHome({ basePath }: PhoneAppHomeProps) {
  const setSlot = React.useContext(PhoneAppHomeSlotContext)?.setSlot;
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Come back where the page was left: the menu renders into the slot in the
  // same commit, so the restore waits a frame for the rows (a long menu draws
  // its rest right after the first frame) and asks again once more after it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const saved = scrollByApp.get(basePath);
    const target = scrollParentOf(root);
    const frames: number[] = [];
    if (saved) {
      const restore = () => {
        target.scrollTop = saved;
      };
      frames.push(requestAnimationFrame(() => {
        restore();
        frames.push(requestAnimationFrame(restore));
      }));
    }
    let last = saved ?? 0;
    const onScroll = () => {
      last = target.scrollTop;
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      frames.forEach((id) => cancelAnimationFrame(id));
      target.removeEventListener('scroll', onScroll);
      scrollByApp.set(basePath, last);
    };
  }, [basePath]);

  return (
    <div ref={rootRef} data-testid="phone-app-home" className="px-2 pb-6 pt-2">
      <div ref={setSlot} data-testid="phone-app-home-menu" />
    </div>
  );
}
