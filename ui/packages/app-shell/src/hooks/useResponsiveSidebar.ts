/**
 * useResponsiveSidebar
 *
 * Gives the console sidebar the state a window starts in, as the page loads
 * and as the window crosses `CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH` (1280 px) or
 * the phone breakpoint, where the drawer takes over: the reader's choice for
 * that side of the threshold, else expanded on a wide window and collapsed on
 * a narrow one (ruling 7069868269 on objectstack#36112). Collapsed, the
 * console's sidebar is hidden, and its full menu floats over the content from
 * the window's left edge or ⌘B (ruling 6973617688 on objectstack#35062;
 * `consoleSidebarRail.ts`). Must be called inside a SidebarProvider context.
 *
 * It also keeps the reader's choices, each on its own side of the threshold:
 * an open or close on a wide window is the wide-window choice
 * (objectstack#28079), a close of the docked sidebar on a narrow window the
 * narrow-window choice (the page header's expand button keeps the other
 * half, `useConsoleSidebarRailPanel`). The float writes neither, and a state
 * this hook gives a window is not a choice.
 * @module
 */

import { useLayoutEffect, useRef } from 'react';
import { useSidebar } from '@object-ui/components';
import {
  startingSidebarOpen,
  useConsoleSidebarRail,
  writeWideWindowOpen,
} from '../layout/consoleSidebarRail.js';

export function useResponsiveSidebar() {
  const { open, setOpen } = useSidebar();
  const { desktop, wide, railMode, setNarrowOpen } = useConsoleSidebarRail();
  const setOpenRef = useRef(setOpen);
  const last = useRef<{ desktop: boolean; wide: boolean; railMode: boolean; open: boolean } | null>(null);

  useLayoutEffect(() => {
    setOpenRef.current = setOpen;
  });

  // A layout effect, so a window that opens narrow paints the hidden sidebar first.
  useLayoutEffect(() => {
    const previous = last.current;
    last.current = { desktop, wide, railMode, open };
    if (!desktop) return;
    // A load, or a window that crosses the threshold or leaves the phone: its starting state.
    if (!previous || !previous.desktop || previous.wide !== wide) {
      const start = startingSidebarOpen(wide);
      last.current.open = start;
      if (start !== open) setOpenRef.current(start);
      return;
    }
    if (wide) {
      if (previous.open !== open) writeWideWindowOpen(open);
      return;
    }
    // The narrow-window choice turned collapsed (in this tab or another) under an open sidebar.
    if (railMode && !previous.railMode) {
      if (open) setOpenRef.current(false);
      return;
    }
    // The reader collapsed the docked sidebar on a narrow window.
    if (!railMode && previous.open && !open) setNarrowOpen(false);
  }, [desktop, wide, railMode, open, setNarrowOpen]);
}
