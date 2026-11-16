/**
 * ObjectUI — the print stylesheet of a page that declares `print`
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#11958, card ② of the ruling of record on objectstack#8346 (letter
 * B′): "The template is a `page`. … The page gains an optional `print`
 * declaration … mapped to print CSS (`@page`, repeated table heads,
 * `break-inside`)."
 *
 * `PageRenderer` mounts the sheet this module builds only for a page whose
 * `print` is an object, and every rule sits inside `@media print`, so the page
 * on screen is drawn exactly as before. One rule per declared key, each as
 * the key's own `.describe()` in `@objectstack/spec` names it:
 *
 *  - `paperSize` / `orientation` → `@page { size }` (A4 and portrait when
 *    omitted, as the spec states);
 *  - `margins` → `@page { margin-top | -right | -bottom | -left }`, in
 *    millimetres, one descriptor per declared side; a side left out keeps the
 *    console's default sheet margin (`styles.css` in `@object-ui/app-shell`);
 *  - `pageNumbers` → the `@page` bottom-right margin box with `counter(page)`
 *    and `counter(pages)`;
 *  - `repeatHeader` / `repeatFooter` → the page's own `header` / `footer`
 *    region placed in the `thead` / `tfoot` of the running-region table
 *    `PageRenderer` draws for them ({@link PRINT_RUNNING_ATTRIBUTE}), which
 *    the browser repeats on every sheet the page runs onto and reserves room
 *    for. On screen that table and its rows and cells are `display: contents`,
 *    so the layout is the one the page always had; this sheet turns them back
 *    into a table on paper only. It has to be a real `thead` / `tfoot`:
 *    measured in Chromium 141, a `div` given `display: table-header-group`
 *    printed once, on the first sheet, while a real `thead` repeated on every
 *    sheet;
 *  - `repeatTableHeaders` (on when omitted) → `thead { display:
 *    table-header-group }`; set to `false` it is `table-row-group`, which does
 *    not repeat;
 *  - `avoidBreakInside` → `break-inside: avoid` on every block of a region
 *    that fits one sheet. A block taller than a sheet cannot be kept whole,
 *    and is marked at print time ({@link watchBlocksTallerThanSheet}) so it
 *    starts where it stands instead of on the next sheet.
 *
 * Besides the keys, the rules every print page needs: everything on the
 * document that is not the print page, an ancestor of it, or inside it is
 * hidden on paper (the console chrome, and the record view's own panels
 * around the page); the ancestors' viewport-height clipping is released so
 * the page runs onto as many sheets as it needs; a data table fits the
 * printable width; and the page prints on white, with links and select
 * badges as plain text (objectstack#34228).
 *
 * ⚠️ Values are WRITTEN INTO A STYLESHEET, so only the spec's own values pass:
 * an enum member for `paperSize` / `orientation`, a finite non-negative number
 * for a margin. Anything else is treated as not declared. This is the
 * stylesheet's injection boundary, not a second contract: `PageSchema` refuses
 * every such value at parse, at the authoring doors.
 */

import type { PageNodeSchema } from '@object-ui/types';

/** The page's `print` declaration, as the node type carries it from the spec by reference. */
export type PagePrintDeclaration = NonNullable<PageNodeSchema['print']>;

/** The DOM attribute `PageRenderer` stamps on the root of a print page; every rule below is scoped to it. */
export const PRINT_PAGE_ATTRIBUTE = 'data-print-page';

/** The DOM attribute on the running-region table `PageRenderer` draws for `repeatHeader` / `repeatFooter`. */
export const PRINT_RUNNING_ATTRIBUTE = 'data-print-running';

/**
 * The DOM attribute on a value drawn as a coloured badge that prints as plain
 * text: the select cell's option badge (`SelectCellRenderer` in
 * `@object-ui/fields`, which spells the same literal).
 */
export const PRINT_PLAIN_BADGE_ATTRIBUTE = 'data-select-badge';

/**
 * The DOM attribute the print-time measure ({@link markBlocksTallerThanSheet})
 * sets on a region block taller than one sheet's body room; on such a block
 * the sheet lifts `avoidBreakInside`'s `break-inside: avoid`. Internal: no
 * author writes it, and it only changes paper.
 */
export const PRINT_TALLER_THAN_SHEET_ATTRIBUTE = 'data-print-taller-than-sheet';

/** A block of a region: the element `avoidBreakInside` keeps whole. */
const REGION_BLOCK = '[data-region] > *';

const PAPER_SIZES: ReadonlySet<string> = new Set(['A4', 'A5', 'Letter', 'Legal']);
const ORIENTATIONS: ReadonlySet<string> = new Set(['portrait', 'landscape']);
const MARGIN_SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** True when `value` is a `print` declaration object — the one condition under which a page is a print page. */
export function isPagePrintDeclaration(value: unknown): value is PagePrintDeclaration {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function millimetres(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value}mm` : null;
}

/** The `@page` rule: sheet size and orientation, declared margins, and the page-number box. */
function pageRule(print: PagePrintDeclaration): string {
  const size = PAPER_SIZES.has(print.paperSize as string) ? print.paperSize : 'A4';
  const orientation = ORIENTATIONS.has(print.orientation as string) ? print.orientation : 'portrait';
  const lines = [`size: ${size} ${orientation};`];
  const margins = (print.margins ?? {}) as Partial<Record<(typeof MARGIN_SIDES)[number], unknown>>;
  for (const side of MARGIN_SIDES) {
    const mm = millimetres(margins[side]);
    if (mm) lines.push(`margin-${side}: ${mm};`);
  }
  if (print.pageNumbers === true) {
    lines.push('@bottom-right { content: counter(page) " / " counter(pages); font-size: 9pt; }');
  }
  return `@page { ${lines.join(' ')} }`;
}

/**
 * The running header and footer: the running-region table, `display: contents`
 * on screen, is a table again on paper, so its `thead` / `tfoot` repeat on each
 * sheet. Its parent (the layout's flex column) is a block, and the gap the
 * flex column drew between the regions is the cells' padding.
 */
function runningRegionRules(print: PagePrintDeclaration, page: string): string[] {
  if (print.repeatHeader !== true && print.repeatFooter !== true) return [];
  const table = `${page} table[${PRINT_RUNNING_ATTRIBUTE}]`;
  return [
    `${page} :has(> table[${PRINT_RUNNING_ATTRIBUTE}]) { display: block !important; }`,
    `${table} { display: table !important; width: 100%; border-collapse: collapse; }`,
    `${table} > thead { display: table-header-group !important; }`,
    `${table} > tbody { display: table-row-group !important; }`,
    `${table} > tfoot { display: table-footer-group !important; }`,
    `${table} > * > tr { display: table-row !important; }`,
    `${table} > * > tr > td { display: table-cell !important; padding: 0 0 4mm 0; vertical-align: top; }`,
    `${table} > tfoot > tr > td { padding: 4mm 0 0 0; }`,
  ];
}

/**
 * A data table fits the sheet's printable width (objectstack#34228). On screen
 * a table's cells keep a comfortable minimum width and one line, and the table
 * scrolls sideways inside its box when they do not fit; paper has no scroll,
 * so the table ran past its box: measured in Chromium on A4 portrait with
 * 15 mm margins, a five-column `record:line_items` grid was 647 px wide in a
 * 630 px box, its last column under the box's right border. On paper the
 * minimum widths and the single line are dropped, so the columns shrink and
 * wrap to the box. The running-region table is excluded: it lays out regions,
 * not data.
 */
function paperFitRules(page: string): string[] {
  const table = `${page} table:not([${PRINT_RUNNING_ATTRIBUTE}])`;
  return [
    `${table} { width: 100% !important; }`,
    `${table} :is(th, td) { min-width: 0 !important; white-space: normal !important; overflow-wrap: break-word; }`,
  ];
}

/**
 * A printed document is a white sheet with plain values (objectstack#34228):
 * the page and every box around it print on white, not the app's background;
 * a link (a lookup's reference) prints as plain text in the colour around
 * it; and a select value drawn as a coloured badge
 * ({@link PRINT_PLAIN_BADGE_ATTRIBUTE}) prints as its label in that colour,
 * with no pill. The `!important` beats the inline colours a hex option
 * colour sets on its badge.
 */
function paperFaceRules(page: string): string[] {
  return [
    `:has(${page}), ${page} { background: #fff !important; }`,
    `${page} a[href] { color: inherit !important; text-decoration: none !important; }`,
    `${page} [${PRINT_PLAIN_BADGE_ATTRIBUTE}] { background: none !important; border-color: transparent !important; color: inherit !important; padding: 0 !important; border-radius: 0 !important; font-size: inherit !important; font-weight: inherit !important; }`,
  ];
}

/**
 * Build the print stylesheet for a page that declares `print`. Pure: the same
 * declaration always yields the same text, so it is pinned as text.
 */
export function buildPagePrintStylesheet(print: PagePrintDeclaration): string {
  const page = `[${PRINT_PAGE_ATTRIBUTE}]`;
  const rules: string[] = [
    pageRule(print),
    // Only the print page reaches paper: an element that neither is the page,
    // holds it, nor sits inside it is hidden.
    `body :not(:has(${page})):not(${page}):not(${page} *) { display: none !important; }`,
    // Release the viewport-height chain above the page, which otherwise clips
    // it to one screen on paper.
    `:has(${page}) { display: block !important; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; position: static !important; }`,
    // The sheet margin is the page's inset on paper, so the screen padding and
    // the centred max-width are dropped.
    `${page} { padding: 0 !important; min-height: 0 !important; }`,
    `${page} > div { max-width: none !important; }`,
    ...runningRegionRules(print, page),
    `${page} thead:not(table[${PRINT_RUNNING_ATTRIBUTE}] > thead) { display: ${print.repeatTableHeaders === false ? 'table-row-group' : 'table-header-group'} !important; }`,
  ];
  if (print.avoidBreakInside === true) {
    rules.push(
      `${page} ${REGION_BLOCK} { break-inside: avoid; }`,
      // A block that cannot fit any sheet is not kept whole: it starts on the
      // current sheet and breaks where the sheet ends, as with the key off.
      `${page} [data-region] > [${PRINT_TALLER_THAN_SHEET_ATTRIBUTE}] { break-inside: auto; }`,
    );
  }
  rules.push(...paperFitRules(page), ...paperFaceRules(page));
  return `@media print {\n  ${rules.join('\n  ')}\n}\n`;
}

/**
 * Mark each region block taller than one sheet's body room, measured on the
 * PRINT layout, and return that room in CSS pixels (objectstack#34427).
 *
 * `avoidBreakInside` keeps each block whole on one sheet when it fits (the
 * key's `.describe()` in `@objectstack/spec`). `break-inside: avoid` alone
 * cannot tell a block that fits from one that fits no sheet: Chromium moves
 * both to the next sheet before breaking them, so a block taller than a sheet
 * left the rest of the current sheet blank and could cost one sheet more.
 * CSS cannot condition a break on a block's height, so this reads it:
 *
 *  - the sheet's page area is the root element's client height, which on
 *    paper is the `@page` box less its margins, whichever rule set them (the
 *    page's declared `margins`, else the console's default sheet margin);
 *  - the running-region table's `thead` / `tfoot` repeat on every sheet, so
 *    their height is taken off it;
 *  - every mark is cleared first, so each block is measured as
 *    `break-inside: avoid` lays it out: a block that fits is laid out whole
 *    and keeps its height, one that does not is broken across sheets and
 *    measures taller still.
 *
 * Only meaningful while the print layout is in force: call it from
 * {@link watchBlocksTallerThanSheet}, never on screen.
 */
export function markBlocksTallerThanSheet(page: Element): number {
  const sheet = page.ownerDocument.documentElement.clientHeight;
  const running = page.querySelector<HTMLTableElement>(`table[${PRINT_RUNNING_ATTRIBUTE}]`);
  const repeated =
    (running?.tHead?.getBoundingClientRect().height ?? 0) + (running?.tFoot?.getBoundingClientRect().height ?? 0);
  const room = sheet - repeated;
  const blocks = [...page.querySelectorAll(REGION_BLOCK)];
  for (const block of blocks) block.removeAttribute(PRINT_TALLER_THAN_SHEET_ATTRIBUTE);
  const taller = blocks.filter((block) => block.getBoundingClientRect().height > room);
  for (const block of taller) block.setAttribute(PRINT_TALLER_THAN_SHEET_ATTRIBUTE, '');
  return room;
}

/**
 * Run {@link markBlocksTallerThanSheet} on `page` each time the document
 * enters print, and clear the marks when it leaves. Returns the unsubscribe.
 *
 * The `print` media query's change is the moment: Chromium fires it with the
 * print layout already in force (sheet-wide boxes, sheet-high viewport), and a
 * mark set in the listener reaches the printed sheets. `beforeprint` is too
 * early: it fires while the screen layout is still in force. A document with
 * no `matchMedia` (a test DOM) gets no listener.
 */
export function watchBlocksTallerThanSheet(page: Element): () => void {
  const media = page.ownerDocument.defaultView?.matchMedia?.('print');
  if (!media || typeof media.addEventListener !== 'function') return () => undefined;
  const onChange = (event: MediaQueryListEvent) => {
    if (event.matches) {
      markBlocksTallerThanSheet(page);
      return;
    }
    for (const block of page.querySelectorAll(`[${PRINT_TALLER_THAN_SHEET_ATTRIBUTE}]`)) {
      block.removeAttribute(PRINT_TALLER_THAN_SHEET_ATTRIBUTE);
    }
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
