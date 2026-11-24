import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for an authored page's region row in a narrow record drawer at
 * a desktop viewport (objectstack#34826).
 *
 * The body row (sidebar | main | aside) and the rail widths used to switch on
 * the VIEWPORT `md`, so a record page with an `aside` rail, drawn in a record
 * drawer the reader dragged to 380 px at a 1280 px viewport, kept the row: the
 * rail kept its 256 px, `main` was squeezed to 3 px, and the tab row and the
 * field cards spilled under the rail's cards (measured in the real console
 * drawer, the showcase project page and a CRM opportunity page, before the
 * fix). Each template's root is now a named Tailwind container and the row
 * goes side by side from that container's `@3xl` (768 px, the pixel value of
 * the viewport `md` it replaces), so the narrow drawer stacks the rail below
 * `main`, and a full page at the same viewport keeps the row exactly as before.
 *
 * A Playwright spec and not a vitest test for the reason
 * `record-header-title-width.spec.ts` gives: jsdom has no layout engine, so a
 * width read there is 0 and an assertion on it is vacuous. The class-shape half
 * is pinned beside the renderer in
 * `packages/components/src/__tests__/page-template-slots-12476.test.tsx`.
 *
 * REAL, read out of `page.tsx` at run time: the template root's container
 * class, the row class, the rail's no-shrink class, the `small` rail width and
 * the main column's class, plus real Tailwind compiled from the installed
 * `tailwindcss` for exactly those candidates. FIXTURE: the element tree,
 * transcribed from `RegionLayout`, and the cards' heights.
 */

const REPO_ROOT = uiRoot();
const PAGE_FILE = 'packages/components/src/renderers/layout/page.tsx';
const pageSrc = readFileSync(path.join(REPO_ROOT, PAGE_FILE), 'utf8');

/** One string out of the source, asserting tokens so a drifted match throws. */
function grab(re: RegExp, mustContain: string[]): string {
  const m = pageSrc.match(re);
  if (!m) throw new Error(`${PAGE_FILE}: nothing matched ${re}`);
  const cls = m[1];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(
        `${PAGE_FILE}: ${re} matched "${cls}", which does not carry "${token}" — the extraction ` +
          'walked onto the wrong string, so this measurement would be meaningless.',
      );
    }
  }
  return cls;
}

const CLS = {
  layout: grab(/const PAGE_REGION_LAYOUT_CONTAINER_CLASS = '([^']+)'/, []),
  row: grab(/const PAGE_REGION_ROW_CLASS = '([^']+)'/, ['flex', 'flex-col', 'gap-6']),
  railShrink: grab(/const PAGE_RAIL_SHRINK_CLASS = '([^']+)'/, []),
  railSmall: grab(/function getSidebarWidthClass[\s\S]*?case 'small':\s*return '([^']+)'/, ['w-full']),
  main: grab(/<div className="([^"]+)">\s*\{main && <RegionContent region=\{main\} \/>\}/, ['flex-1', 'min-w-0']),
};

type Shape = { layout: string; row: string; railShrink: string; railSmall: string };
const NOW: Shape = { layout: CLS.layout, row: CLS.row, railShrink: CLS.railShrink, railSmall: CLS.railSmall };
/** The row as it stood before this card: the viewport `md`, no container. */
const BEFORE: Shape = {
  layout: '',
  row: 'flex flex-col md:flex-row flex-1 gap-6',
  railShrink: 'md:shrink-0',
  railSmall: 'w-full md:w-64',
};

/** The tree `RegionLayout` draws for header-less main + aside, inside a padded drawer body. */
const fixture = (cls: Shape, container: number) =>
  `<div id="pane" style="width:${container}px;padding:24px;box-sizing:border-box">` +
  `<div id="layout" class="${cls.layout} flex flex-col gap-6">` +
  `<div id="row" class="${cls.row}">` +
  `<div id="main" class="${CLS.main}">` +
  '<div id="tabs" role="tablist" style="display:flex;gap:16px;white-space:nowrap">' +
  '<button role="tab">Details</button><button role="tab">Related</button><button id="last-tab" role="tab">Activity</button>' +
  '</div>' +
  '<div id="card" style="height:220px;border:1px solid #ccc">Basic Information</div>' +
  '</div>' +
  `<aside id="aside" class="${cls.railShrink} ${cls.railSmall}">` +
  '<div id="rail" style="height:320px;border:1px solid #ccc">Line items</div>' +
  '</aside>' +
  '</div>' +
  '</div>' +
  '</div>';

let css = '';
test.beforeAll(async () => {
  const twEntry = fileURLToPath(import.meta.resolve('tailwindcss/index.css'));
  const compiler = await compile('@import "tailwindcss";', {
    base: path.dirname(twEntry),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? twEntry : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
  });
  css = compiler.build(
    [...Object.values(CLS), ...Object.values(BEFORE)].join(' ').split(/\s+/).filter(Boolean),
  );
  if (!css.includes('@container')) {
    throw new Error('Tailwind produced no container query — the row would never go side by side.');
  }
});

type Box = { left: number; right: number; top: number; bottom: number; width: number };
type Reading = { direction: string; layout: Box; main: Box; tabs: Box; lastTab: Box; card: Box; aside: Box; rail: Box };

async function readRow(page: Page, opts: { viewport: number; container: number; cls?: Shape }): Promise<Reading> {
  await page.setViewportSize({ width: opts.viewport, height: 900 });
  await page.setContent(
    `<style>html,body{margin:0}body{font:14px sans-serif}${css}</style>${fixture(opts.cls ?? NOW, opts.container)}`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const box = (id: string) => {
      const r = document.getElementById(id)!.getBoundingClientRect();
      return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width) };
    };
    return {
      direction: getComputedStyle(document.getElementById('row')!).flexDirection,
      layout: box('layout'),
      main: box('main'),
      tabs: box('tabs'),
      lastTab: box('last-tab'),
      card: box('card'),
      aside: box('aside'),
      rail: box('rail'),
    };
  });
}

/** Area two boxes share; 0 when they do not overlap. */
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

test.describe("an authored page's region row in a narrow drawer at a desktop viewport (objectstack#34826)", () => {
  test('the defect this pins: at 380px the viewport row squeezes main under the rail', async ({ page }) => {
    const r = await readRow(page, { viewport: 1280, container: 380, cls: BEFORE });
    expect(r.direction).toBe('row');
    expect(r.main.width, 'main kept a usable width under the old row').toBeLessThan(r.layout.width / 4);
    // The tab row cannot fit the squeezed column: its last tab is drawn under the rail.
    expect(overlap(r.lastTab, r.rail), 'the tab row did not run under the rail').toBeGreaterThan(0);
  });

  for (const container of [360, 380, 720]) {
    test(`a ${container}px drawer at a 1280px viewport stacks the rail below main, overlapping nothing`, async ({ page }) => {
      const r = await readRow(page, { viewport: 1280, container });
      expect(r.direction).toBe('column');
      expect(r.main.width, 'main does not take the drawer width').toBeCloseTo(r.layout.width, 0);
      expect(r.aside.width, 'the rail does not take the drawer width').toBeCloseTo(r.layout.width, 0);
      expect(r.aside.top, 'the rail is not below main').toBeGreaterThanOrEqual(r.main.bottom);
      expect(overlap(r.tabs, r.aside), 'the tab row overlaps the rail').toBe(0);
      expect(overlap(r.lastTab, r.aside), 'a tab overlaps the rail').toBe(0);
      expect(overlap(r.card, r.aside), 'the field card overlaps the rail').toBe(0);
      // The tab row fits main: no tab is pushed past it.
      expect(r.lastTab.right).toBeLessThanOrEqual(r.main.right + 0.5);
    });
  }

  for (const [label, viewport, container] of [
    ['a 1000px drawer at a 1920px viewport', 1920, 1000],
    ['a full page at a 1280px viewport', 1280, 1184],
  ] as const) {
    test(`${label} keeps the rail beside main at its fixed width`, async ({ page }) => {
      const r = await readRow(page, { viewport, container });
      expect(r.direction).toBe('row');
      expect(r.aside.width).toBeCloseTo(256, 0);
      expect(r.aside.left, 'the rail is not to the right of main').toBeGreaterThanOrEqual(r.main.right);
      expect(r.main.width).toBeCloseTo(r.layout.width - 256 - 24, 0);
      expect(overlap(r.lastTab, r.aside)).toBe(0);
    });
  }

  test('a full page at a 1280px viewport draws the row exactly as the viewport row did', async ({ page }) => {
    const now = await readRow(page, { viewport: 1280, container: 1184 });
    const before = await readRow(page, { viewport: 1280, container: 1184, cls: BEFORE });
    expect(now).toEqual(before);
  });

  test('a phone viewport still stacks, whatever the layout width', async ({ page }) => {
    const r = await readRow(page, { viewport: 375, container: 375 });
    expect(r.direction).toBe('column');
    expect(r.aside.top).toBeGreaterThanOrEqual(r.main.bottom);
  });
});
