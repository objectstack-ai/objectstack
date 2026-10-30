/**
 * useResponsiveSidebar
 *
 * Folds the sidebar to its icon rail while the window is narrower than
 * `CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH` (and wider than the phone breakpoint,
 * where the drawer takes over), and unfolds it when the window widens again
 * (objectstack#27593). A reader who keeps the sidebar open is left alone.
 * Must be called inside a SidebarProvider context.
 *
 * The fold is not the reader's choice, so it does not keep one: every open
 * and close on a wide window is kept as the wide-window choice, and only
 * those (objectstack#28079). A window that turns wide, or a load that opens
 * wide, gets that choice back, whatever the fold, the overlay or a sidebar
 * kept open on a narrow window did to the primitive's cookie meanwhile.
 * @module
 */

import { useLayoutEffect, useRef } from 'react';
import { useSidebar } from '@object-ui/components';
import {
  readWideWindowOpen,
  seedWideWindowOpen,
  useConsoleSidebarRail,
  writeWideWindowOpen,
} from '../layout/consoleSidebarRail.js';

export function useResponsiveSidebar() {
  const { open, setOpen } = useSidebar();
  const { wide, railMode } = useConsoleSidebarRail();
  const setOpenRef = useRef(setOpen);
  const last = useRef<{ wide: boolean; railMode: boolean } | null>(null);

  useLayoutEffect(() => {
    setOpenRef.current = setOpen;
  });

  // A layout effect, so a window that opens narrow paints the rail first.
  useLayoutEffect(() => {
    const previous = last.current;
    last.current = { wide, railMode };
    if (wide) {
      // A load that opens wide, or a window that turns wide: the reader's wide-window choice.
      if (!previous?.wide) {
        const wideOpen = readWideWindowOpen();
        if (wideOpen !== undefined && wideOpen !== open) {
          setOpenRef.current(wideOpen);
          return;
        }
      }
      writeWideWindowOpen(open);
      return;
    }
    // The fold takes over: a narrow load, a window that narrows, "keep open" turned off.
    if (railMode && !previous?.railMode) {
      seedWideWindowOpen(open);
      setOpenRef.current(false);
    }
  }, [wide, railMode, open]);
}
