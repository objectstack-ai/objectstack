/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE viewport gutter every wide centred dialog reads from `sm` up
 * (objectui#12593, promoted to a shared export by objectui#12603).
 *
 * The `DialogContent` primitive draws `w-full max-w-lg`. A consumer that raises
 * the cap with `sm:max-w-2xl` or wider makes the dialog exactly as wide as any
 * window narrower than that cap, at x = 0, edge to edge. With this class the
 * dialog is the smaller of its max width and the window less 2rem, and the
 * primitive's `left-[50%]` plus `translate-x-[-50%]` centres it with an equal
 * 1rem either side. Above the max width plus 2rem the dialog is exactly as wide
 * as before.
 *
 * `100%`, not `100vw`: the dialog is `fixed`, so `100%` is its containing
 * block, the viewport less any classic scrollbar, the same box `left-[50%]`
 * centres in. `100vw` counts the scrollbar, so each gutter would lose half of
 * the scrollbar's width.
 *
 * `sm:` only: below `sm` a dialog is the phone sheet, which this leaves alone.
 * A dialog that keeps its own viewport-relative cap (`sm:max-w-[95vw]
 * sm:w-full`, the `full` size) does not read it.
 *
 * The class string is literal here so Tailwind's source scan emits it; an app
 * that `@source`-scans this package gets the rule. A site writes its wide cap
 * and this constant together (`` `sm:max-w-5xl ${DIALOG_VIEWPORT_GUTTER}` ``,
 * or the constant as an unconditional `cn()` argument), never a gutter literal
 * of its own. The census
 * `packages/components/src/__tests__/dialogViewportGutterCensus-12603.test.ts`
 * enumerates every wide `DialogContent` and fails one that does not.
 */
export const DIALOG_VIEWPORT_GUTTER = 'sm:w-[calc(100%-2rem)]';
