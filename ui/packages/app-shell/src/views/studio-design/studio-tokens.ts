// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * studio-tokens — the Studio design surface's shared measurements, spelled
 * once as Tailwind class strings (objectui#12459, epic objectui#12446).
 *
 * The four pillars (Data, Automations, Interfaces, Access) share one skeleton:
 * a 48 px shell header, a 240 px rail, a content column whose item header,
 * tab row and body sit at the same offsets everywhere, and a 300 px inspector
 * aside. Every pillar composes these constants instead of restating the
 * numbers, so a later pillar card changes a measurement in one place and the
 * reference artboards under `docs/design/studio-redesign/` stay the contract.
 */

/**
 * Shell header (objectui#12509). From `sm` up: one 48 px row, a three-column
 * grid so the pillar switcher centers. The right column never drops below its
 * content (Create app, Changes, Publish), so on a tight row the switcher moves
 * left and the package chip truncates instead of anything sliding under the
 * switcher. Below `sm`: two rows, the package and its actions on the first,
 * the switcher at full width on the second (`STUDIO_HEADER_PILLAR_NAV`).
 */
export const STUDIO_HEADER =
  'grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b px-3 py-2 sm:h-12 sm:grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] sm:py-0';
/** The pillar switcher: its own full-width row below `sm`, the middle column from `sm` up. */
export const STUDIO_HEADER_PILLAR_NAV =
  'order-last col-span-2 flex items-center gap-0.5 rounded-lg bg-muted p-[3px] sm:order-none sm:col-span-1';
/** One switcher segment: an equal share of the row below `sm`, its own width from `sm` up. */
export const STUDIO_HEADER_PILLAR =
  'inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors sm:flex-none sm:shrink-0 xl:px-3';

/**
 * objectui#12611 — the package chip at a narrow width. The header's package
 * column is the container: its width is the grid track's, so the chip's
 * fold answers the room the column really has (the pillar switcher and the
 * actions beside it), never the viewport. Below 300 px the chip's
 * "Read-only" word gives way and its lock stays; the package name truncates
 * only after that. At 300 px the 280 px chip still leaves the name 120 px
 * with the word shown. The full name and the posture are in the chip's
 * tooltip. Literal class strings: Tailwind finds a class by scanning source.
 */
export const STUDIO_HEADER_PACKAGE_COLUMN = '@container';
export const STUDIO_PKG_READONLY_WORD = 'hidden @min-[300px]:inline';

/** Rail: 240 px, the sidebar surface, a right border. */
export const STUDIO_RAIL_WIDTH = 'w-60';
export const STUDIO_RAIL_HEADER = 'flex h-11 shrink-0 items-center gap-2 pl-4 pr-3';
export const STUDIO_RAIL_HEADING = 'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground';
export const STUDIO_RAIL_COUNT = 'inline-flex h-[18px] min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground';
export const STUDIO_RAIL_SEARCH = 'h-8 w-full rounded-md border bg-background pl-8 pr-2.5 text-[13px] outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-primary';
export const STUDIO_RAIL_ROW = 'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px]';
export const STUDIO_RAIL_ROW_ACTIVE = 'bg-primary/10 font-medium text-primary';
export const STUDIO_RAIL_ROW_IDLE = 'text-foreground/90 hover:bg-muted/60 hover:text-foreground';
export const STUDIO_RAIL_ROW_INDENT = 'pl-[22px]';
export const STUDIO_RAIL_GROUP = 'mt-1.5 flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground';

/** Content column: the item header row, its tab row and the body under them. */
export const STUDIO_ITEM_HEADER = 'shrink-0 border-b px-6 pt-[18px]';
/**
 * objectui#12611 — the item header's title row, and the order in which it
 * gives way on a narrow content column. The row itself is the container (not
 * the header: the tab row under it holds the Data pillar's own fold, which
 * measures the content column, and an unnamed container query answers the
 * nearest container). The meta slot goes first, below 640 px of row (at the
 * 1280 px design width with an aside open the row is about 690 px); then the
 * status chip's text, below 480 px, its icon and tooltip staying; the title
 * truncates last. While it shows, the meta takes only the room the row has
 * left (`basis-0 grow`): it never puts the row short, so the title never
 * gives a pixel to it. (A heavy `shrink` weight is not enough: the title's
 * fraction-of-a-pixel share still draws its ellipsis.)
 */
export const STUDIO_ITEM_ROW = 'flex min-w-0 items-center gap-3 @container';
export const STUDIO_ITEM_META_FOLD = 'hidden basis-0 grow @min-[640px]:block';
export const STUDIO_STATUS_TEXT_FOLD = 'sr-only @min-[480px]:not-sr-only';
/**
 * objectui#12791 — the title and the api-name chip share the room the row has
 * in four steps, so the title keeps 200 px and the chip gives way before it:
 * the title gets 200 px (or its whole text, if shorter); the chip gets 14
 * characters (or its whole name); the title grows to its whole text; the
 * chip grows to its whole name; the meta slot gets what is left. Each gets
 * the first step as its basis (`basis-*`, capped at its own text by
 * `max-w-max`), and the rest as growth: the weights put the title ahead of
 * the chip and the chip ahead of the meta (`basis-0 grow`). On a row too
 * narrow for both bases the chip shrinks first, down to a few characters
 * (`min-w-[5ch]`), and only then does the title go below 200 px, so the row
 * never overflows. A cut chip shows its full name in its tooltip
 * (`StudioItemHeader`). The weights are large so the other item's share is
 * far below a pixel.
 */
export const STUDIO_ITEM_TITLE =
  'min-w-0 max-w-max basis-[200px] grow-[1000000] truncate text-[18px] font-semibold leading-tight tracking-[-0.01em] text-foreground';
export const STUDIO_ICON_TILE = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary';
export const STUDIO_API_CHIP =
  'block h-[22px] min-w-[5ch] max-w-max basis-[14ch] grow-[1000] shrink-[100000] truncate rounded-[5px] bg-muted px-2 font-mono text-[11px] leading-[22px] text-muted-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const STUDIO_KIND_CHIP = 'inline-flex h-[22px] shrink-0 items-center rounded-[5px] bg-muted px-2 text-[11px] font-medium text-muted-foreground';
export const STUDIO_META = 'min-w-0 truncate text-xs text-muted-foreground';
/**
 * objectui#12611 — the tab row never wraps: each tab keeps its label on one
 * line, and when the tabs are wider than the row it scrolls sideways with no
 * scrollbar. `data-fade` (set by `StudioItemHeader` from the scroll position)
 * fades the edge that has more tabs past it.
 */
export const STUDIO_TAB_ROW =
  '-mb-px mt-3 flex gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ' +
  'data-[fade=end]:[mask-image:linear-gradient(to_right,#000_calc(100%_-_24px),transparent)] ' +
  'data-[fade=start]:[mask-image:linear-gradient(to_left,#000_calc(100%_-_24px),transparent)] ' +
  'data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,#000_24px,#000_calc(100%_-_24px),transparent)]';
export const STUDIO_TAB = 'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[13px] transition-colors';
export const STUDIO_TAB_ACTIVE = 'border-primary font-medium text-foreground';
export const STUDIO_TAB_IDLE = 'border-transparent text-muted-foreground hover:text-foreground';
export const STUDIO_HEADER_ICON_BUTTON = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground';

/** Inspector aside: 300 px, a left border. */
export const STUDIO_ASIDE_WIDTH = 'w-[300px]';
export const STUDIO_ASIDE_HEADER = 'flex shrink-0 items-start gap-2 border-b px-4 pb-3 pt-3.5';
export const STUDIO_ASIDE_EYEBROW = 'block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground';
export const STUDIO_ASIDE_TITLE = 'mt-0.5 block truncate text-[15px] font-semibold';
export const STUDIO_ASIDE_ID = 'mt-1 inline-block font-mono text-[11px] text-muted-foreground';
export const STUDIO_ASIDE_FOOTER = 'shrink-0 border-t px-4 py-3 text-xs text-muted-foreground';
