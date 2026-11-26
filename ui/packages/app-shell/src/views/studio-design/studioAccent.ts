// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's graphite on what Studio draws outside its own root
 * (objectstack#37455, decision 4 of epic objectstack#37424): every Studio
 * surface draws graphite, never the app's theme colour.
 *
 * The surface mounts {@link STUDIO_ACCENT} on its root (`StudioDesignSurface`),
 * which reaches everything drawn inside it. A dialog, a popover, a dropdown, a
 * sheet, a tooltip, a toast and the command palette are drawn in a portal on
 * `document.body`, outside that root, where they would read the app's colour
 * the app's branding wrote on the page root (`useAppShellBranding`). The
 * portal primitives (`@object-ui/components`) take no container, so while a
 * Studio surface is mounted the same class sits on `body` too, and comes off
 * when the last one unmounts: the app's pages after Studio draw their own
 * colour again. The page root's inline branding is never touched, so the
 * app's branding needs no repair when Studio leaves.
 */

import * as React from 'react';
import { STUDIO_ACCENT } from './studio-tokens.js';

/** The accent's classes, one by one, for `classList`. */
const STUDIO_ACCENT_CLASSES = STUDIO_ACCENT.split(/\s+/).filter(Boolean);

/** How many Studio surfaces are mounted: the class comes off `body` with the last. */
let mountedSurfaces = 0;

/** Puts Studio's accent on `body` while the calling surface is mounted. */
export function useStudioAccentOnBody(): void {
  React.useLayoutEffect(() => {
    const body = document.body;
    mountedSurfaces += 1;
    if (mountedSurfaces === 1) {
      body.classList.add(...STUDIO_ACCENT_CLASSES);
      body.setAttribute('data-studio-accent', '');
    }
    return () => {
      mountedSurfaces -= 1;
      if (mountedSurfaces > 0) return;
      body.classList.remove(...STUDIO_ACCENT_CLASSES);
      body.removeAttribute('data-studio-accent');
    };
  }, []);
}
