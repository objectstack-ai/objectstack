/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"

function isViewportBelowNow(breakpoint: number): boolean {
  return typeof window !== "undefined" && window.innerWidth < breakpoint
}

/**
 * Is the window narrower than `breakpoint` CSS pixels?
 *
 * `useIsMobile`'s matchMedia idiom at a breakpoint the caller names, with one
 * difference: the first answer is read synchronously, so a layout that folds
 * on it draws its first frame at the window's real width instead of drawing
 * the wide layout once and then jumping. It follows the window live through
 * the `(max-width: breakpoint − 1px)` query; without `matchMedia` (no browser)
 * it keeps the width it read.
 */
export function useIsViewportBelow(breakpoint: number): boolean {
  const [below, setBelow] = React.useState(() => isViewportBelowNow(breakpoint))

  React.useEffect(() => {
    setBelow(isViewportBelowNow(breakpoint))
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = () => setBelow(isViewportBelowNow(breakpoint))
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [breakpoint])

  return below
}
