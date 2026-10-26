/**
 * useResponsiveSidebar
 *
 * Auto-collapses the sidebar on tablet-width viewports (768px–1023px).
 * Must be called inside a SidebarProvider context.
 * @module
 */

import { useEffect, useRef } from 'react';
import { useSidebar } from '@object-ui/components';

/** Tablet breakpoint range: 768px <= width < 1024px */
const TABLET_MIN = 768;
const TABLET_MAX = 1024;

export function useResponsiveSidebar() {
  const { setOpen, isMobile } = useSidebar();
  const setOpenRef = useRef(setOpen);

  useEffect(() => {
    setOpenRef.current = setOpen;
  }, [setOpen]);

  useEffect(() => {
    if (isMobile) return undefined;

    let wasTablet = false;

    function handleResize() {
      const width = window.innerWidth;
      const isTablet = width >= TABLET_MIN && width < TABLET_MAX;
      if (isTablet && !wasTablet) {
        // Auto-collapse once when entering tablet width, then preserve manual toggles.
        setOpenRef.current(false);
      }
      wasTablet = isTablet;
    }

    // Run on mount to set initial state
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobile]);
}
