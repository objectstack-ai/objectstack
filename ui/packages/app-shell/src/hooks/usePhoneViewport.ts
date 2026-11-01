/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useState } from 'react';

/**
 * The phone breakpoint, `useIsMobile`'s 768 px in `@object-ui/components`.
 * Below it the console is on a phone (objectstack#27058): a record is always a
 * page, never a pane, and its business actions sit in a bottom bar.
 */
export const PHONE_BELOW_WIDTH = 768;

/** Is the window narrower than {@link PHONE_BELOW_WIDTH} right now? */
export function isPhoneViewportNow(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < PHONE_BELOW_WIDTH;
}

/**
 * `useIsMobile()`, except that the first answer is read synchronously. What
 * this decides is mounted, not styled: on a phone the list page mounts no
 * record pane, and the record page mounts no drawer host and draws its
 * actions in the bottom bar. An answer that only arrived in an effect would
 * mount the desktop tree once and then swap it, with the list read twice.
 * The same idiom as `useViewTabsFit` in `objectViewChrome.tsx`.
 */
export function usePhoneViewport(): boolean {
  const [phone, setPhone] = useState<boolean>(isPhoneViewportNow);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${PHONE_BELOW_WIDTH - 1}px)`);
    const onChange = () => setPhone(isPhoneViewportNow());
    mql.addEventListener('change', onChange);
    // A width that moved between the first render and this effect.
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return phone;
}
