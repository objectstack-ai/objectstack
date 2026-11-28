/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The layout classes of `ListView`'s toolbar row: the left group (a host's
 * leading node, the user-filter chips, the 「In a queue」 toggle) and the tool
 * cluster on the right.
 *
 * Below `sm`, with a host's leading node, the row WRAPS (objectstack#33833).
 * The console passes the list's view switcher as that node on a phone, and on
 * one line the chips and the cluster (every icon a 44 px touch target there)
 * left the view name a character or two. Now the left group dissolves into the
 * row (`contents`), the leading node is sized by its own content
 * (`basis-auto`), and whatever no longer fits beside it moves to the next
 * line, with the cluster kept at the right edge (`ml-auto`). The name keeps
 * the row's whole width before anything else does. From `sm` up, and without
 * a leading node, the row is what it was.
 *
 * These are plain string constants, read by name: `ui/e2e/list-toolbar-view-name-phone.spec.ts`
 * lays them out in Chromium with real Tailwind and measures the view name.
 */

/**
 * The toolbar row: the list's view bar, 40px from `sm` up (objectstack#35548),
 * its border included. Below `sm` it keeps its padding so it can wrap.
 *
 * From `sm` up its ends are the list page's edges less the controls' own
 * padding (objectstack#35663): every item here is a padded control, so 10px
 * on the left puts the switcher's 6px-padded icon on the page's 16px line
 * with the page bar's icon, the checkboxes and the footer, and 8px on the
 * right ends the last trigger's 8px-padded label 16px in, where the page bar's
 * button ends.
 */
export const TOOLBAR_ROW =
  'border-b px-2 py-1.5 sm:h-10 sm:pl-2.5 sm:pr-2 sm:py-0 flex items-center justify-between gap-1 sm:gap-2 bg-background';
/** Added to the row below `sm` when a host passes a leading node. */
export const TOOLBAR_ROW_LEADING_PHONE = 'max-sm:flex-wrap max-sm:gap-x-2 max-sm:gap-y-1';

/** The left group without a leading node. */
export const TOOLBAR_LEFT_GROUP = 'flex items-center gap-2 overflow-x-auto min-w-0';
/**
 * The left group with a leading node: it grows so the node's `flex-1` wrapper
 * has the width the tool cluster leaves (objectui#12440), and below `sm` it
 * dissolves so its items wrap in the row.
 */
export const TOOLBAR_LEFT_GROUP_LEADING =
  'flex flex-1 items-center gap-2 overflow-x-auto min-w-0 max-sm:contents';

/**
 * The wrapper of the host's leading node. It shrinks but does not grow
 * (objectstack#35878): 视图设置 follows it directly, beside the view's name.
 */
export const TOOLBAR_LEADING = 'flex min-w-0 shrink items-center max-sm:basis-auto';

/** The user-filter chips. */
export const TOOLBAR_USER_FILTERS = 'shrink-0 min-w-0 overflow-x-auto';
/** Added below `sm` with a leading node: alone on a line, the chips scroll inside it. */
export const TOOLBAR_USER_FILTERS_LEADING_PHONE = 'max-sm:shrink';

/** The tool cluster: plain text triggers, no frame (objectstack#35548). */
export const TOOLBAR_CLUSTER = 'flex items-center gap-0.5 shrink-0';

/**
 * A text trigger of the view bar — 「Filter」「Sort」「Options」
 * (objectstack#35548): 28px tall, 13px, the name shown from `sm` up (below
 * `sm` the trigger keeps its icon and a 44px touch target).
 */
export const TOOLBAR_TEXT_TRIGGER =
  'h-7 min-w-7 gap-1 px-1.5 sm:px-2 text-sm font-normal text-muted-foreground hover:text-foreground transition-colors duration-150';
/** Added below `sm` with a leading node: on a wrapped line the cluster keeps the right edge. */
export const TOOLBAR_CLUSTER_LEADING_PHONE = 'max-sm:ml-auto';
