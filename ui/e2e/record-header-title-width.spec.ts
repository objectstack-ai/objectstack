import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for the record-header title/action width arbitration on the two
 * headers objectui#7281 covers — `packages/plugin-detail/src/DetailView.tsx`
 * and `packages/layout/src/PageHeader.tsx`. Sibling of
 * `packages/components/src/__tests__/page-header-title-width.test.tsx`, which
 * pins objectui#7244's fix on `page:header`.
 *
 * ⚠️ WHY THIS FILE IS A PLAYWRIGHT SPEC AND NOT A VITEST TEST. jsdom and
 * happy-dom have no layout engine — every `getBoundingClientRect()` there is
 * 0x0 and `clientWidth` is 0 — so the sibling pin had to settle for
 * CLASS-SHAPE assertions, and a class-shape assertion passes against a floor
 * that does nothing. This file asserts the widths themselves, in Chromium,
 * which is the only place the arbitration actually happens.
 *
 * ## What is real here and what is a fixture
 *
 * REAL, read out of the source files at run time: the header row's class
 * string, the title column's class string, the action tail's class string and
 * the h1's class string, for both headers — plus real Tailwind, compiled from
 * the installed `tailwindcss` for exactly those candidates. Delete
 * `sm:min-w-64` from DetailView or `min-w-48` from PageHeader and the string
 * this file measures changes with it.
 *
 * FIXTURE: the action tail's CONTENT is three or four fixed-width boxes rather
 * than real `<Button>`s, so the tail's width is a constant instead of a
 * font-metric. The element tree around them is transcribed from the two
 * sources.
 *
 * ## Calibration against the running app (Chromium, console dev server,
 * `type: 'detail'` and `<PageHeader actions={…}>`, three labelled
 * `record_header` actions, viewport 799px, objectui#7281):
 *
 *   DetailView  before: h1  6.17px of a 218px scrollWidth, tail 724.83px
 *               after:  h1 218.39px, tail wrapped to its own line
 *   PageHeader  before: h1 170.59px of a 265px scrollWidth, tail 564.41px
 *               after:  h1 751.00px, tail wrapped to its own line
 *
 * The fixture tails below (722px / 592px) are sized to that measured
 * neighbourhood, so the geometry this file reproduces is the geometry the app
 * produces, not a worst case invented to make a floor look necessary.
 */

// The objectui tree, resolved from `scripts/ui-root.mjs`'s own location -- the
// one fact true standalone and under the objectstack monorepo's `ui/`. Walking up
// to `pnpm-workspace.yaml` found the OBJECTSTACK root there (objectstack#25723),
// and the sources this spec reads live under this tree's `packages/`.
const REPO_ROOT = uiRoot();

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * Pull a literal `className="…"` out of a source file, anchored on a nearby
 * landmark so the walk cannot silently drift onto a neighbouring element.
 * `mustContain` is a token the extracted string has to carry that is NOT the
 * floor under test, so a drifted walk throws instead of measuring the wrong
 * element and passing.
 */
function classAt(
  source: string,
  file: string,
  anchor: string,
  nth: number,
  mustContain: string[],
): string {
  const at = source.indexOf(anchor);
  if (at < 0) throw new Error(`${file}: anchor not found: ${anchor}`);
  const re = /className="([^"]+)"/g;
  re.lastIndex = at;
  let hit: RegExpExecArray | null = null;
  for (let i = 0; i < nth; i++) {
    hit = re.exec(source);
    if (!hit) throw new Error(`${file}: only ${i} className literals after ${anchor}`);
  }
  const cls = hit![1];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(
        `${file}: className #${nth} after "${anchor}" is "${cls}", which does not carry "${token}" — ` +
          'the extraction walked onto the wrong element, so this measurement would be meaningless.',
      );
    }
  }
  return cls;
}

/** Same, but the last literal BEFORE the anchor. */
function classBefore(source: string, file: string, anchor: string, mustContain: string[]): string {
  const at = source.indexOf(anchor);
  if (at < 0) throw new Error(`${file}: anchor not found: ${anchor}`);
  const head = source.slice(0, at);
  const all = [...head.matchAll(/className="([^"]+)"/g)];
  if (all.length === 0) throw new Error(`${file}: no className literal before ${anchor}`);
  const cls = all[all.length - 1][1];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(
        `${file}: last className before "${anchor}" is "${cls}", which does not carry "${token}".`,
      );
    }
  }
  return cls;
}

const DETAIL_FILE = 'packages/plugin-detail/src/DetailView.tsx';
const PAGE_FILE = 'packages/layout/src/PageHeader.tsx';

const detailSrc = read(DETAIL_FILE);
const pageSrc = read(PAGE_FILE);

const DETAIL = {
  // `{schema.showHeader !== false && (` opens the header this card is about —
  // the one that renders when the host does NOT supply a `page:header`.
  row: classAt(detailSrc, DETAIL_FILE, '{schema.showHeader !== false && (', 1, ['border-b', 'justify-between']),
  titleColumn: classAt(detailSrc, DETAIL_FILE, '{schema.showHeader !== false && (', 2, ['flex-1', 'min-w-0']),
  backButton: classAt(detailSrc, DETAIL_FILE, '{schema.showHeader !== false && (', 3, ['shrink-0']),
  // #4 is the back button's own `<ArrowLeft className="h-4 w-4" />`.
  innerColumn: classAt(detailSrc, DETAIL_FILE, '{schema.showHeader !== false && (', 5, ['flex-1', 'min-w-0']),
  titleRow: classAt(detailSrc, DETAIL_FILE, '{schema.showHeader !== false && (', 6, ['flex-wrap']),
  h1: classAt(detailSrc, DETAIL_FILE, '{schema.showHeader !== false && (', 7, ['truncate']),
  // The action tail opens immediately before this comment.
  tail: classBefore(detailSrc, DETAIL_FILE, '{/* Prev/Next Record Navigation */}', ['shrink-0']),
};

const PAGE = {
  row: classBefore(pageSrc, PAGE_FILE, 'aria-label="Back to list"', ['flex-wrap', 'items-center']),
  backButton: classAt(pageSrc, PAGE_FILE, 'aria-label="Back to list"', 1, ['flex-shrink-0']),
  titleColumn: classBefore(pageSrc, PAGE_FILE, '{resolvedTitle ? (', ['flex-1', 'flex-col']),
  h1: classAt(pageSrc, PAGE_FILE, '{resolvedTitle ? (', 1, ['truncate']),
  slot: classAt(pageSrc, PAGE_FILE, '{slot && <div className=', 1, ['ml-auto']),
};

/** The measured render size of `<Button size="icon">` in both headers. */
const ICON_BUTTON = 'h-10 w-10 shrink-0';
/**
 * Tail boxes sized so each fixture tail lands in the band where the hazard
 * lives — and the band is narrow in BOTH directions, which is the part worth
 * writing down.
 *
 * A tail has to FIT on the row to starve the title: `tail + gap <= viewport`.
 * Push it wider than that and the row's own wrap drops it to a second line all
 * by itself, the title gets the whole row back, and the floor looks
 * unnecessary — measured: a 786px DetailView tail at 799px passes this spec
 * with the floor deleted. Make it much narrower and there is no deficit to
 * arbitrate at all.
 *
 * So these two match what the running app actually produced with three
 * labelled `record_header` actions at 799px (DetailView 724.83px,
 * PageHeader 564.41px), not a width chosen to make a floor look needed:
 *   DetailView  4 x 176px + 3 x 6px (`gap-1.5`) = 722px
 *   PageHeader  3 x 192px + 2 x 8px (`gap-2`)   = 592px
 */
const DETAIL_TAIL_BOX = 'h-9 w-44 shrink-0';
const PAGE_TAIL_BOX = 'h-9 w-48 shrink-0';

/**
 * Long enough that the h1's own text is never the binding constraint at the
 * crowded viewport — what is being measured is the width the arbitration
 * LEAVES the title, not how long this particular string happens to be — and
 * still short enough to fit unclipped at the roomy viewport, which is what the
 * regression guard reads.
 */
const TITLE = 'Specimen — Full Assembly Record';

async function tailwindFor(candidates: string[]): Promise<string> {
  const twEntry = fileURLToPath(import.meta.resolve('tailwindcss/index.css'));
  const twBase = path.dirname(twEntry);
  const compiler = await compile('@import "tailwindcss";', {
    base: twBase,
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? twEntry : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
  });
  const css = compiler.build(candidates);
  if (!css.includes('@media')) {
    throw new Error('Tailwind produced no media queries — the responsive variants under test would be inert.');
  }
  return css;
}

/** `<div class="…">` nested left-to-right, innermost last. */
const box = (cls: string, inner = '') => `<div class="${cls}">${inner}</div>`;

const DETAIL_FIXTURE = box(
  DETAIL.row,
  box(
    DETAIL.titleColumn,
    `<button class="${DETAIL.backButton} ${ICON_BUTTON}"></button>` +
      box(DETAIL.innerColumn, box(DETAIL.titleRow, `<h1 class="${DETAIL.h1}">${TITLE}</h1>`)),
  ) +
    box(DETAIL.tail, Array.from({ length: 4 }, () => box(DETAIL_TAIL_BOX)).join('')),
);

const PAGE_FIXTURE = box(
  PAGE.row,
  `<button class="${PAGE.backButton} ${ICON_BUTTON}"></button>` +
    box(PAGE.titleColumn, `<h1 class="${PAGE.h1}">${TITLE}</h1>`) +
    box(PAGE.slot, Array.from({ length: 3 }, () => box(PAGE_TAIL_BOX)).join('')),
);

const ALL_CANDIDATES = [
  ...Object.values(DETAIL),
  ...Object.values(PAGE),
  ICON_BUTTON,
  DETAIL_TAIL_BOX,
  PAGE_TAIL_BOX,
]
  .join(' ')
  .split(/\s+/)
  .filter(Boolean);

type Reading = {
  h1Width: number;
  h1ScrollWidth: number;
  h1Clipped: boolean;
  rowWidth: number;
  rowRight: number;
  titleColumnWidth: number;
  tailWidth: number;
  tailWithinRow: boolean;
  tailOnOwnLine: boolean;
  documentOverflowX: number;
};

async function readGeometry(page: Page, fixture: string, css: string, width: number): Promise<Reading> {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(`<style>${css}</style><div id="host">${fixture}</div>`, {
    waitUntil: 'load',
  });
  // ⛔ Not asserted immediately: a rect read in the same task as `setContent`
  // can precede the first layout+paint. Wait for the h1 rect to be identical
  // across two animation frames, then for fonts, then read.
  await page.waitForFunction(
    () => {
      const h1 = document.querySelector('h1');
      const row = document.querySelector('#host > div');
      // The ROW is what proves layout has run — it always fills the viewport.
      // ⛔ Deliberately NOT `h1 width > 0`: an ablated floor can drive the h1
      // to exactly 0, and that reading is the finding, not a reason to hang
      // until the wait times out and hides it behind a TimeoutError.
      if (!h1 || !row || row.getBoundingClientRect().width <= 0) return false;
      const w = h1.getBoundingClientRect().width;
      const prev = (window as unknown as { __w?: number }).__w;
      (window as unknown as { __w?: number }).__w = w;
      return prev !== undefined && Math.abs(prev - w) < 0.01;
    },
    null,
    { polling: 'raf', timeout: 10_000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const h1 = document.querySelector('h1')!;
    const row = document.querySelector('#host > div')!;
    const kids = Array.from(row.children);
    const titleIdx = kids.findIndex((k) => k.contains(h1));
    const titleColumn = kids[titleIdx] as HTMLElement;
    const tail = kids.slice(titleIdx + 1) as HTMLElement[];
    const rowRect = row.getBoundingClientRect();
    const h1Rect = h1.getBoundingClientRect();
    return {
      h1Width: round(h1Rect.width),
      h1ScrollWidth: h1.scrollWidth,
      h1Clipped: h1.scrollWidth > Math.ceil(h1Rect.width),
      rowWidth: round(rowRect.width),
      rowRight: round(rowRect.right),
      titleColumnWidth: round(titleColumn.getBoundingClientRect().width),
      tailWidth: round(tail.reduce((sum, t) => sum + t.getBoundingClientRect().width, 0)),
      tailWithinRow: tail.every((t) => {
        const r = t.getBoundingClientRect();
        return r.left >= rowRect.left - 0.5 && r.right <= rowRect.right + 0.5;
      }),
      tailOnOwnLine:
        tail.length > 0 &&
        Math.round(tail[0].getBoundingClientRect().top) >
          Math.round(titleColumn.getBoundingClientRect().top),
      documentOverflowX: round(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    };
  });
}

/**
 * The readable floor objectui#7244 established for the h1 itself. DetailView's
 * column floor is larger than this because the back button and its gap live
 * INSIDE that column; PageHeader's is this value exactly.
 */
const READABLE_H1_FLOOR = 192;
/** The reproducing viewport from objectui#7244 and from this card's readings. */
const CROWDED = 799;
/** Wide enough that the tail was never in contention — the regression guard. */
const ROOMY = 1440;

let css = '';
test.beforeAll(async () => {
  // `CONSOLE_MAIN` is declared further down (it needs `classByPattern`), but
  // this callback runs long after module evaluation, so its utilities are
  // resolvable here — and they MUST be compiled, or the console pane below
  // would be an unstyled block and its reading meaningless.
  css = await tailwindFor([...ALL_CANDIDATES, ...CONSOLE_MAIN.split(' ')]);
});

/* ════════════════════════════════════════════════════════════════════════════
 * objectui#9119 — the SAME header BELOW the `sm` breakpoint.
 *
 * Everything above this line is about the arbitration between the title column
 * and the action tail at and ABOVE `sm`, where the row is a ROW. Below `sm`
 * that row is `flex-col`, and a different thing goes wrong in it:
 *
 *   a child's WIDTH is its CROSS size in a column container, and
 *   `items-start` sizes a cross axis to fit-content
 *
 * so the title column took the h1's max-content width — measured 1201.22px
 * inside a 320px row — and the page gained that much horizontal overflow. The
 * three utilities that look like they should have stopped it cannot: `min-w-0`
 * is a floor rather than a ceiling, `flex-1` acts on the main axis (height
 * here), and the h1's `truncate` never fires because its containing block had
 * been sized to the text.
 *
 * ⚠️ WHY THIS IS HERE AND NOT IN A VITEST FILE — the same reason the header
 * above is: this is a LAYOUT fact. jsdom and happy-dom have no layout engine,
 * so an assertion on these widths there would be vacuous and green. And a
 * CLASS-SHAPE pin would be worse than useless on this particular defect: the
 * broken element already carries two plausible-looking utilities that do
 * nothing here, so "the class is present" is exactly the evidence that misled
 * everyone. Only the geometry can tell a floor that works from one that does
 * not.
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The 98-character record title objectui#9119 measured with. Long enough to
 * overflow the widest sub-`sm` viewport under test (639px), which is what
 * makes `h1Clipped` a real reading at all three rather than a tautology at the
 * narrow two.
 */
const LONG_TITLE =
  'Specimen — Full · Northwind Traders Consolidated Quarterly Revenue Reconciliation Worksheet (EMEA)';

/** The three sub-`sm` viewports objectui#9119 measured. */
const BELOW_SM = [320, 375, 639];

const LONG_TITLE_FIXTURE = box(
  DETAIL.row,
  box(
    DETAIL.titleColumn,
    `<button class="${DETAIL.backButton} ${ICON_BUTTON}"></button>` +
      box(DETAIL.innerColumn, box(DETAIL.titleRow, `<h1 class="${DETAIL.h1}">${LONG_TITLE}</h1>`)),
  ) +
    box(DETAIL.tail, Array.from({ length: 4 }, () => box(DETAIL_TAIL_BOX)).join('')),
);

test.describe('record header below the sm breakpoint (objectui#9119)', () => {
  for (const width of BELOW_SM) {
    test(`DetailView: the title column cannot outgrow its row at ${width}px`, async ({ page }) => {
      const r = await readGeometry(page, LONG_TITLE_FIXTURE, css, width);

      // THE assertion — the cross-axis fact itself. Unmodified, this column
      // measures 1045.59px here whatever the viewport is (1201.22px in the
      // console's font metrics), because it is sized to the TEXT and not to
      // the row.
      expect(
        r.titleColumnWidth,
        `title column ${r.titleColumnWidth}px inside a ${r.rowWidth}px row — it was sized to the ` +
          'title, not to the row, so no `min-w-0` and no `truncate` below it can bind',
      ).toBeLessThanOrEqual(r.rowWidth + 0.5);

      // The user-visible half of the same fact.
      expect(r.documentOverflowX, 'the record header pushed the page sideways').toBe(0);

      // …and the repair has to make `truncate` actually FIRE, not merely stop
      // the overflow: a title cut off with no ellipsis is the other half of
      // this defect, not a fix for it.
      expect(
        r.h1Clipped,
        `h1 is ${r.h1Width}px wide for a ${r.h1ScrollWidth}px title but reports no clipping`,
      ).toBe(true);
    });
  }
});

/* ── The open half objectui#9119 left unmeasured: clip, or page scroll? ──────
 *
 * The card's readings were taken with the header in an UNCONSTRAINED
 * container, which isolates the header's own behaviour but does not say what a
 * user sees. In the real console the header renders inside `AppShell`'s
 * content element (the `<div>` inside `SidebarInset`, the shell's one `main`
 * landmark since objectui#13334), and `ConsoleLayout` styles that element with
 * `overflow-x-hidden` — so the page does NOT scroll sideways; the overflow is
 * CLIPPED, and because the h1's own `truncate` never fires, it is clipped with
 * no ellipsis.
 *
 * This reproduces that ancestor from the two real sources and measures the
 * header inside it.
 */
const SHELL_FILE = 'packages/layout/src/AppShell.tsx';
const CONSOLE_LAYOUT_FILE = 'packages/app-shell/src/layout/ConsoleLayout.tsx';

/** Pull a class string out of a source with a regex, asserting a token so a drift throws. */
function classByPattern(source: string, file: string, re: RegExp, mustContain: string[]): string {
  const m = source.match(re);
  if (!m) throw new Error(`${file}: no class string matched ${re}`);
  const cls = m[1].replace(/\s+/g, ' ').trim();
  for (const token of mustContain) {
    if (!cls.split(' ').includes(token)) {
      throw new Error(
        `${file}: matched "${cls}", which does not carry "${token}" — the extraction walked onto ` +
          'the wrong element, so this measurement would be meaningless.',
      );
    }
  }
  return cls;
}

const shellSrc = read(SHELL_FILE);
const consoleLayoutSrc = read(CONSOLE_LAYOUT_FILE);

/**
 * `AppShell`'s content element (the `<div>` inside `SidebarInset`) as the
 * console actually renders it: the base
 * string the component writes, then the override `ConsoleLayout` passes in —
 * in the order the real `cn()` receives them.
 *
 * ⚠️ The real `cn()` is `twMerge(clsx(...))`, and it COLLAPSES the pair: the
 * base `overflow-auto` loses its x axis to the later `overflow-x-hidden`. That
 * collapse is not re-run here (`tailwind-merge` is a `@object-ui/components`
 * dependency and is not resolvable from the repo root, where this spec runs);
 * instead the two strings are handed to the browser in that same order and the
 * resulting boundary is READ back below. Measured identical either way:
 * `overflow-x: hidden`, `overflow-y: auto`, padding 0.
 */
const CONSOLE_MAIN = [
  classByPattern(shellSrc, SHELL_FILE, /<SidebarInset[\s\S]*?<div className=\{cn\("([^"]+)"/, [
    'flex-1',
    'min-w-0',
    'overflow-auto',
  ]),
  classByPattern(consoleLayoutSrc, CONSOLE_LAYOUT_FILE, /<AppShell[\s\S]*?className="([^"]+)"/, [
    'overflow-x-hidden',
  ]),
].join(' ');

test.describe("the console's own content pane (objectui#9119, the open half)", () => {
  test('the header does not overflow the pane that clips it, at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setContent(
      `<style>html,body{margin:0}${css}</style>` +
        `<main><div id="pane" class="${CONSOLE_MAIN}">${LONG_TITLE_FIXTURE}</div></main>`,
      { waitUntil: 'load' },
    );
    await page.waitForFunction(
      () => {
        const h1 = document.querySelector('h1');
        const pane = document.getElementById('pane');
        if (!h1 || !pane || pane.getBoundingClientRect().width <= 0) return false;
        const w = h1.getBoundingClientRect().width;
        const prev = (window as unknown as { __w?: number }).__w;
        (window as unknown as { __w?: number }).__w = w;
        return prev !== undefined && Math.abs(prev - w) < 0.01;
      },
      null,
      { polling: 'raf', timeout: 10_000 },
    );
    await page.evaluate(() => document.fonts?.ready);
    const r = await page.evaluate(() => {
      const pane = document.getElementById('pane')!;
      const h1 = document.querySelector('h1')!;
      return {
        paneClientWidth: pane.clientWidth,
        paneScrollWidth: pane.scrollWidth,
        paneOverflowX: getComputedStyle(pane).overflowX,
        h1Width: Math.round(h1.getBoundingClientRect().width * 100) / 100,
        h1ScrollWidth: h1.scrollWidth,
      };
    });

    // Premise guard, read from the browser rather than assumed: this test is
    // only ABOUT a clip while the pane actually clips. If the shell ever
    // switches to `overflow-x: auto`, the user-visible symptom changes from
    // "cut off with no ellipsis" into "the content pane scrolls sideways" and
    // the open half of objectui#9119 needs re-reading — so say so loudly
    // instead of measuring on.
    expect(
      r.paneOverflowX,
      'the console content pane no longer clips — re-read objectui#9119, the symptom has changed',
    ).toBe('hidden');

    // Unmodified, this pane reports scrollWidth 1046 against clientWidth 375 —
    // 671px of header the reader can never reach, because `overflow-x: hidden`
    // clips it and offers no scrollbar.
    expect(
      r.paneScrollWidth,
      `content pane (overflow-x: ${r.paneOverflowX}) is ${r.paneClientWidth}px wide but holds ` +
        `${r.paneScrollWidth}px of header — ${r.paneScrollWidth - r.paneClientWidth}px of it is ` +
        'clipped away with no scrollbar and no ellipsis',
    ).toBeLessThanOrEqual(r.paneClientWidth);

    // And what the reader gets instead of the cut-off text is the ellipsis.
    expect(r.h1ScrollWidth).toBeGreaterThan(Math.ceil(r.h1Width));
  });
});


test.describe('record header title width arbitration (objectui#7281)', () => {
  for (const [name, fixture] of [
    ['DetailView (plugin-detail)', () => DETAIL_FIXTURE],
    ['PageHeader (layout)', () => PAGE_FIXTURE],
  ] as const) {
    test(`${name}: the title keeps a readable width at ${CROWDED}px`, async ({ page }) => {
      const r = await readGeometry(page, fixture(), css, CROWDED);
      // THE assertion. Not `toHaveClass('sm:min-w-48')` — a floor that does
      // nothing would pass that and fail this.
      expect(
        r.h1Width,
        `h1 is ${r.h1Width}px of a ${r.h1ScrollWidth}px title; title column ${r.titleColumnWidth}px, tail ${r.tailWidth}px`,
      ).toBeGreaterThanOrEqual(READABLE_H1_FLOOR);
      // …and the floor must not have bought that width by pushing a button
      // out of reach: a squeezed title truncates visibly, an action tail
      // hanging off the header edge does not.
      expect(r.tailWithinRow, `tail escaped the header box (row right ${r.rowRight})`).toBe(true);
      expect(r.documentOverflowX, 'the header overflowed the document horizontally').toBe(0);
    });

    test(`${name}: the roomy viewport is unchanged at ${ROOMY}px`, async ({ page }) => {
      const r = await readGeometry(page, fixture(), css, ROOMY);
      // Regression guard: a header whose tail already fits must keep the tail
      // on the title's line and the title unclipped, exactly as before the
      // floor existed.
      expect(r.tailOnOwnLine, 'the tail wrapped at a viewport where it used to fit').toBe(false);
      expect(r.h1Clipped, `h1 ${r.h1Width}px vs scrollWidth ${r.h1ScrollWidth}px`).toBe(false);
      expect(r.tailWithinRow).toBe(true);
      expect(r.documentOverflowX).toBe(0);
    });
  }

  test('the tail stays unshrinkable — squeezing the buttons is not the fix', async () => {
    // Kept as a class-shape check on purpose: it states WHY the title needed a
    // floor, and it is not what the geometry assertions above rest on.
    expect(DETAIL.tail.split(/\s+/)).toContain('shrink-0');
  });
});
