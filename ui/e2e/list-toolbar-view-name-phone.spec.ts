import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for objectstack#33833, re-pointed at the phone toolbar of
 * objectstack#35883: on a phone the list's view name stays readable. Below
 * `sm` the list draws ONE row of pills (`PhoneListToolbar`, plugin-list's
 * `phone/PhoneListPanels.tsx`): the view switcher's pill (the view's name,
 * its count, the caret), then Sort, Filter and Search, each a 44 px pill.
 * The name takes what the three pills leave and ends in an ellipsis only
 * when it is wider than that.
 *
 * ⚠️ A Playwright spec, not a vitest test: jsdom and happy-dom have no layout
 * engine, so a width read there is 0 and a class-shape assertion would pass
 * against classes that do nothing.
 *
 * ## What is real here and what is a fixture
 *
 * REAL, read out of the sources at run time: the row's and its view slot's
 * classes and `PHONE_CHIP` (plugin-list `phone/PhoneListPanels.tsx`), the
 * phone search pill's own classes (`ListView.tsx`), the switcher pill's
 * classes (app-shell `objectViewTitleSwitcher.tsx`) and the phone title's
 * wrapper (`ObjectView.tsx`), compiled with the installed `tailwindcss`.
 * Change a class in any of them and what this file measures changes with it.
 *
 * FIXTURE: the element tree is transcribed from those sources, icons are empty
 * boxes of their declared size, and fonts are Chromium's. The assertions are
 * clipping, overflow and lines, not pixels.
 */

const ROOT = uiRoot();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const PANELS_FILE = 'packages/plugin-list/src/phone/PhoneListPanels.tsx';
const LIST_FILE = 'packages/plugin-list/src/ListView.tsx';
const SWITCHER_FILE = 'packages/app-shell/src/views/objectViewTitleSwitcher.tsx';
const OBJECT_VIEW_FILE = 'packages/app-shell/src/views/ObjectView.tsx';

/** `export const NAME = '…';` in `source`, or a throw naming what is missing. */
function constant(source: string, file: string, name: string): string {
  const hit = new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`).exec(source);
  if (!hit) throw new Error(`${file}: no string constant ${name}`);
  return hit[1];
}

/**
 * The first quoted class string of the JSX tag that carries `anchor`
 * (`className="…"`, or the first literal of `className={cn('…'` or
 * `className={cn(CONSTANT, '…'`), read from
 * the tag's opening `<` up to the next element's. `mustContain` holds tokens
 * that string has to carry, so a walk onto the wrong element throws instead of
 * measuring it.
 */
function tagClass(source: string, file: string, anchor: string, mustContain: string[]): string {
  const at = source.indexOf(anchor);
  if (at < 0) throw new Error(`${file}: anchor not found: ${anchor}`);
  const open = source.lastIndexOf('<', at);
  const next = /<[A-Za-z]/g;
  next.lastIndex = at;
  const end = next.exec(source)?.index ?? source.length;
  const tag = source.slice(open, end);
  const hit = /className=(?:"([^"]+)"|\{cn\(\s*(?:\/\/[^\n]*\n\s*)*(?:[A-Z_]+,\s*)?['"]([^'"]+)['"])/.exec(tag);
  if (!hit) throw new Error(`${file}: no class string in the tag carrying ${anchor}`);
  const cls = hit[1] ?? hit[2];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(`${file}: the class string at ${anchor} is "${cls}", which lacks "${token}".`);
    }
  }
  return cls;
}

const panelsSrc = read(PANELS_FILE);
const listSrc = read(LIST_FILE);
const switcherSrc = read(SWITCHER_FILE);
const objectViewSrc = read(OBJECT_VIEW_FILE);

const PHONE_CHIP = constant(panelsSrc, PANELS_FILE, 'PHONE_CHIP');
const BAR = {
  row: tagClass(panelsSrc, PANELS_FILE, 'data-testid="phone-list-toolbar"', ['flex-nowrap', 'overflow-x-auto']),
  view: tagClass(panelsSrc, PANELS_FILE, 'data-testid="phone-list-toolbar-view"', ['min-w-0', 'shrink']),
  phoneTitle: tagClass(objectViewSrc, OBJECT_VIEW_FILE, 'data-testid="list-phone-title"', ['min-w-0']),
  // `cn(PHONE_CHIP, '…')`: the literal after the constant.
  trigger: `${PHONE_CHIP} ${tagClass(switcherSrc, SWITCHER_FILE, 'data-testid="list-view-switcher"', ['max-w-full'])}`,
  label: tagClass(switcherSrc, SWITCHER_FILE, 'data-testid="list-view-switcher-label"', ['min-w-0', 'truncate']),
  count: tagClass(switcherSrc, SWITCHER_FILE, 'data-testid="list-view-switcher-count"', ['shrink-0']),
  search: `${PHONE_CHIP} ${tagClass(listSrc, LIST_FILE, 'data-testid="phone-search-trigger"', ['sm:hidden'])}`,
};
if (!/className=\{cn\(PHONE_CHIP,/.test(switcherSrc)) {
  throw new Error(`${SWITCHER_FILE}: the phone switcher pill no longer draws from PHONE_CHIP`);
}
if (!/className=\{cn\(\s*PHONE_CHIP,\s*'sm:hidden'/.test(listSrc)) {
  throw new Error(`${LIST_FILE}: the phone search pill no longer draws from PHONE_CHIP`);
}
const ICON = 'h-4 w-4';
const CARET = 'h-3.5 w-3.5 shrink-0';

function fixture(label: string): string {
  const pill = (id: string, cls: string) => `<button id="${id}" class="${cls}"><span class="${ICON}"></span></button>`;
  return `
<div id="row" class="${BAR.row}">
  <div id="leading" class="${BAR.view}">
    <span class="${BAR.phoneTitle}"><span class="flex min-w-0">
      <button id="trigger" class="${BAR.trigger}"><span id="label" class="${BAR.label}">${label}</span><span class="${BAR.count}">1,284</span><span class="${CARET}"></span></button>
    </span></span>
  </div>
  ${pill('sort', PHONE_CHIP)}
  ${pill('filter', PHONE_CHIP)}
  ${pill('search', BAR.search)}
</div>`;
}

const CANDIDATES = [...Object.values(BAR), PHONE_CHIP, ICON, CARET, 'flex min-w-0']
  .join(' ')
  .split(/\s+/)
  .filter(Boolean);

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
  css = compiler.build(CANDIDATES);
  if (!css.includes('@media')) {
    throw new Error('Tailwind produced no media queries, so the sm variants under test would be inert.');
  }
});

type Box = { left: number; top: number; right: number; bottom: number; width: number };
type Reading = {
  labelWidth: number;
  labelScrollWidth: number;
  labelClipped: boolean;
  row: Box;
  rowScrolls: boolean;
  leading: Box;
  pills: Box[];
  overflowX: number;
};

async function measure(page: Page, html: string, width: number): Promise<Reading> {
  await page.setViewportSize({ width, height: 812 });
  // The meta makes a mobile project lay the page out at the viewport's width,
  // not 980 px, so the `sm:` variants answer the width under test.
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>${html}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const box = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width };
    };
    const label = document.getElementById('label')!;
    const w = label.getBoundingClientRect().width;
    return {
      labelWidth: w,
      labelScrollWidth: label.scrollWidth,
      labelClipped: label.scrollWidth > Math.ceil(w),
      row: box('row')!,
      rowScrolls: (() => {
        const row = document.getElementById('row')!;
        return row.scrollWidth > row.clientWidth;
      })(),
      leading: box('leading')!,
      pills: ['sort', 'filter', 'search'].map((id) => box(id)!),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

const within = (inner: Box, outer: Box) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5;

const NAMES = ['全部客户', 'All Customers'];

test.describe('the phone toolbar keeps the view name readable (objectstack#33833, #35883)', () => {
  for (const width of [375, 390]) {
    for (const label of NAMES) {
      test(`${width}px: 「${label}」 is drawn whole on one row with Sort, Filter and Search`, async ({ page }) => {
        const r = await measure(page, fixture(label), width);
        expect(r.labelClipped, `label ${r.labelWidth.toFixed(2)}px of ${r.labelScrollWidth}px`).toBe(false);
        expect(r.overflowX, 'the toolbar pushed the page sideways').toBe(0);
        expect(r.rowScrolls, 'the row scrolls sideways').toBe(false);
        for (const pill of r.pills) {
          expect(within(pill, r.row), 'a pill leaves the row').toBe(true);
          expect(pill.top < r.leading.bottom && pill.bottom > r.leading.top, 'a pill left the name\'s line').toBe(true);
          expect(Math.round(pill.bottom - pill.top), 'a 44 px touch target').toBe(44);
        }
      });
    }
  }

  test('320px: 「全部客户」 is whole; a wider name gives way with an ellipsis, and the pills stay on screen', async ({ page }) => {
    const short = await measure(page, fixture('全部客户'), 320);
    expect(short.labelClipped).toBe(false);
    expect(short.rowScrolls).toBe(false);
    const wide = await measure(page, fixture('All Customers In The Northwest Sales Region Pipeline'), 320);
    expect(wide.labelClipped, 'a name wider than the room is truncated').toBe(true);
    expect(wide.overflowX).toBe(0);
    expect(wide.rowScrolls, 'the name, not the row, gives way').toBe(false);
    for (const pill of wide.pills) expect(within(pill, wide.row), 'a pill leaves the row').toBe(true);
  });

  // CONTROL: from `sm` up the phone search pill is not drawn (`sm:hidden`);
  // the row itself is the phone's only (the list draws it below `sm` alone).
  test('640px: the search pill is not drawn', async ({ page }) => {
    const r = await measure(page, fixture('全部客户'), 640);
    expect(r.pills[2].width).toBe(0);
  });
});
