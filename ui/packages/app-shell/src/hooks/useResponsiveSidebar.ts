/**
 * useResponsiveSidebar
 *
 * Folds the sidebar to its icon rail while the window is narrower than
 * `CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH` (and wider than the phone breakpoint,
 * where the drawer takes over), and unfolds it when the window widens again
 * (objectstack#27593). A reader who keeps the sidebar open is left alone.
 * Must be called inside a SidebarProvider context.
 *
 * The fold is not the reader's choice, so it does not keep one: the open
 * state the sidebar had on the wide window is stashed when the rail takes
 * over and handed back when the window widens, or on the next load that
 * opens wide, because the primitive's cookie records every open and close,
 * the fold's included.
 * @module
 */

import { useLayoutEffect, useRef } from 'react';
import { useSidebar } from '@object-ui/components';
import {
  readStashedWideOpen,
  useConsoleSidebarRail,
  writeStashedWideOpen,
} from '../layout/consoleSidebarRail.js';

export function useResponsiveSidebar() {
  const { open, setOpen } = useSidebar();
  const { narrow, keepOpen, railMode } = useConsoleSidebarRail();
  const openRef = useRef(open);
  const setOpenRef = useRef(setOpen);

  useLayoutEffect(() => {
    openRef.current = open;
    setOpenRef.current = setOpen;
  });

  // A layout effect, so a window that opens narrow paints the rail first.
  useLayoutEffect(() => {
    if (railMode) {
      // A stash left by an earlier narrow load is the wide state; keep it.
      if (readStashedWideOpen() === undefined) writeStashedWideOpen(openRef.current);
      setOpenRef.current(false);
      return;
    }
    const wideOpen = readStashedWideOpen();
    if (wideOpen === undefined) return;
    writeStashedWideOpen(undefined);
    // "Keep open" on a narrow window: the reader just chose the open sidebar.
    if (narrow && keepOpen) return;
    setOpenRef.current(wideOpen);
  }, [railMode, narrow, keepOpen]);
}
