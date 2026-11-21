import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for objectstack#33833: on a phone the list's toolbar row keeps
 * the view name readable. Below `sm` the Console hands the list its view
 * switcher as `toolbarLeading`, and the row that draws it also carries the
 * user-filter chips, the 「In a queue」 toggle and the tool cluster, whose
 * icons are 44 px touch targets there. On one line those left the name about
 * a character and a half (「全部客户」 drawn as 「全.」 at 375 px). The row now
 * wraps below `sm` (`listToolbarRow.ts` in plugin-list says how).
 *
 * ⚠️ A Playwright spec, not a vitest test: jsdom and happy-dom have no layout
 * engine, so a width read there is 0 and a class-shape assertion would pass
 * against classes that do nothing.
 *
 * ## What is real here and what is a fixture
 *
 * REAL, read out of the sources at run time: the row's classes (the constants
 * in `packages/plugin-list/src/listToolbarRow.ts`, by name), the 「In a queue」
 * toggle's and the View settings trigger's class strings and the phone
 * touch-target classes from plugin-list, the switcher's own classes from app-shell's
 * `objectViewTitleSwitcher.tsx` (the trigger now draws the view type's icon
 * and the record count beside the name, objectstack#35548), and the phone
 * title's wrapper from
 * `ObjectView.tsx`, compiled with the installed `tailwindcss`. Change a class
 * in any of them and what this file measures changes with it.
 *
 * FIXTURE: the element tree is transcribed from those sources, icons are empty
 * boxes of their declared size, the `Button` base is reduced to its layout
 * tokens (`inline-flex items-center justify-center whitespace-nowrap`), and
 * fonts are Chromium's. The assertions are clipping, overflow and lines, not
 * pixels.
 */

const ROOT = uiRoot();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const ROW_FILE = 'packages/plugin-list/src/listToolbarRow.ts';
const LIST_FILE = 'packages/plugin-list/src/ListView.tsx';
const TOUCH_FILE = 'packages/plugin-list/src/components/ViewSettingsPopover.tsx';
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
 * (`className="…"`, or the first literal of `className={cn('…'`), read from
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
  const hit = /className=(?:"([^"]+)"|\{cn\(\s*(?:\/\/[^\n]*\n\s*)*['"]([^'"]+)['"])/.exec(tag);
  if (!hit) throw new Error(`${file}: no class string in the tag carrying ${anchor}`);
  const cls = hit[1] ?? hit[2];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(`${file}: the class string at ${anchor} is "${cls}", which lacks "${token}".`);
    }
  }
  return cls;
}

const rowSrc = read(ROW_FILE);
const listSrc = read(LIST_FILE);
const ROW_NAMES = [
  'TOOLBAR_ROW',
  'TOOLBAR_ROW_LEADING_PHONE',
  'TOOLBAR_LEFT_GROUP_LEADING',
  'TOOLBAR_LEADING',
  'TOOLBAR_USER_FILTERS',
  'TOOLBAR_USER_FILTERS_LEADING_PHONE',
  'TOOLBAR_CLUSTER',
  'TOOLBAR_CLUSTER_LEADING_PHONE',
] as const;
const ROW = Object.fromEntries(ROW_NAMES.map((n) => [n, constant(rowSrc, ROW_FILE, n)])) as Record<
  (typeof ROW_NAMES)[number],
  string
>;

const switcherSrc = read(SWITCHER_FILE);
const objectViewSrc = read(OBJECT_VIEW_FILE);
const SWITCHER = {
  phoneTitle: tagClass(objectViewSrc, OBJECT_VIEW_FILE, 'data-testid="list-phone-title"', ['min-w-0', 'max-sm:font-semibold']),
  trigger: tagClass(switcherSrc, SWITCHER_FILE, 'data-testid="list-view-switcher"', ['min-w-0', 'max-sm:min-h-11']),
};
// The switcher's outer span is the first element of its return.
const SWITCHER_OUTER = (() => {
  const hit = /return \(\s*<span className="([^"]+)">\s*<Popover/.exec(switcherSrc);
  if (!hit) throw new Error(`${SWITCHER_FILE}: the switcher's outer span was not found`);
  return hit[1];
})();

const BUTTON_BASE = 'inline-flex items-center justify-center whitespace-nowrap';
const QUEUE = `${BUTTON_BASE} ${tagClass(listSrc, LIST_FILE, 'data-testid="queue-sitting-filter"', ['shrink-0', 'h-7'])}`;
const PHONE_TOUCH_TARGET = constant(read(TOUCH_FILE), TOUCH_FILE, 'PHONE_TOUCH_TARGET');
// The bar's icon triggers draw from one constant (objectstack#35548). Since
// objectstack#35878 Filter and Sort live in the condition row, and the bar's
// trigger that reads the constant is View settings, an icon below `sm`. The
// four icon buttons below stand for the bar's tools at their touch size.
const TEXT_TRIGGER = constant(rowSrc, ROW_FILE, 'TOOLBAR_TEXT_TRIGGER');
if (!/className=\{cn\(\s*TOOLBAR_TEXT_TRIGGER,\s*PHONE_TOUCH_TARGET,[\s\S]{0,200}data-testid="toolbar-display-trigger"/.test(read(TOUCH_FILE))) {
  throw new Error(`${TOUCH_FILE}: the View settings trigger no longer draws from TOOLBAR_TEXT_TRIGGER + PHONE_TOUCH_TARGET`);
}
const ICON_BUTTON = `${BUTTON_BASE} ${TEXT_TRIGGER} ${PHONE_TOUCH_TARGET}`;
const ICON = 'h-3.5 w-3.5';
// The trigger's own children (objectstack#35548): type icon → name → count → caret.
const TYPE_ICON = 'flex shrink-0 h-4 w-4';
const COUNT = 'shrink-0 font-normal tabular-nums';
const CARET = 'h-3.5 w-3.5 shrink-0';
const CHIP = 'h-7 w-24 shrink-0';

/** The classes the row uses, with the phone additions or (`phone: false`) without them. */
function rowClasses(phone: boolean) {
  const plus = (base: string, add: string) => (phone ? `${base} ${add}` : base);
  return {
    row: plus(ROW.TOOLBAR_ROW, ROW.TOOLBAR_ROW_LEADING_PHONE),
    left: phone ? ROW.TOOLBAR_LEFT_GROUP_LEADING : ROW.TOOLBAR_LEFT_GROUP_LEADING.replace(/\s*max-sm:\S+/g, ''),
    leading: phone ? ROW.TOOLBAR_LEADING : ROW.TOOLBAR_LEADING.replace(/\s*max-sm:\S+/g, ''),
    filters: plus(ROW.TOOLBAR_USER_FILTERS, ROW.TOOLBAR_USER_FILTERS_LEADING_PHONE),
    cluster: plus(ROW.TOOLBAR_CLUSTER, ROW.TOOLBAR_CLUSTER_LEADING_PHONE),
  };
}

function fixture(label: string, { chips = 0, phone = true } = {}): string {
  const c = rowClasses(phone);
  const icon = `<span class="${ICON}"></span>`;
  return `
<div id="row" class="${c.row}">
  <div class="${c.left}">
    <div id="leading" class="${c.leading}">
      <span class="${SWITCHER.phoneTitle}"><span class="flex min-w-0"><span class="${SWITCHER_OUTER}">
        <button id="trigger" class="${SWITCHER.trigger}"><span class="${TYPE_ICON}"></span><span id="label" class="truncate">${label}</span><span class="${COUNT}">1,284</span><span class="${CARET}"></span></button>
      </span></span></span>
    </div>
    ${chips > 0 ? `<div id="chips" class="${c.filters}"><div class="flex items-center gap-1">${Array.from({ length: chips }, () => `<span class="${CHIP}"></span>`).join('')}</div></div>` : ''}
    <button id="queue" class="${QUEUE}">${icon}In a queue</button>
  </div>
  <div id="cluster" class="${c.cluster}">${Array.from({ length: 4 }, () => `<button class="${ICON_BUTTON}">${icon}</button>`).join('')}</div>
</div>`;
}

const CANDIDATES = [
  ...Object.values(ROW),
  ...Object.values(SWITCHER),
  SWITCHER_OUTER,
  QUEUE,
  ICON_BUTTON,
  ICON,
  TYPE_ICON,
  COUNT,
  CARET,
  CHIP,
  'truncate flex min-w-0 items-center gap-1',
]
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
    throw new Error('Tailwind produced no media queries, so the max-sm variants under test would be inert.');
  }
});

type Box = { left: number; top: number; right: number; bottom: number; width: number };
type Reading = {
  labelWidth: number;
  labelScrollWidth: number;
  labelClipped: boolean;
  row: Box;
  leading: Box;
  queue: Box;
  cluster: Box;
  chips: Box | null;
  overflowX: number;
};

async function measure(page: Page, html: string, width: number): Promise<Reading> {
  await page.setViewportSize({ width, height: 812 });
  await page.setContent(`<style>${css}</style>${html}`, { waitUntil: 'load' });
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
      leading: box('leading')!,
      queue: box('queue')!,
      cluster: box('cluster')!,
      chips: box('chips'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

const within = (inner: Box, outer: Box) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5;

test.describe('list toolbar keeps the view name readable on a phone (objectstack#33833)', () => {
  test('ListView draws its toolbar row from these constants', () => {
    for (const name of ROW_NAMES) {
      expect(listSrc.includes(name), `${LIST_FILE} no longer reads ${name}, so this file would measure nothing it draws`).toBe(true);
    }
  });

  for (const width of [320, 375, 390]) {
    for (const label of ['全部客户', 'All Customers']) {
      test(`${width}px: 「${label}」 is drawn whole, and nothing scrolls the page`, async ({ page }) => {
        const r = await measure(page, fixture(label), width);
        expect(r.labelClipped, `label ${r.labelWidth.toFixed(2)}px of ${r.labelScrollWidth}px`).toBe(false);
        expect(r.overflowX, 'the toolbar pushed the page sideways').toBe(0);
        for (const [name, b] of [['queue', r.queue], ['cluster', r.cluster]] as const) {
          expect(within(b, r.row), `${name} leaves the row`).toBe(true);
        }
        // The tools keep the row's right edge (its `px-2` padding) on whichever line they land.
        expect(r.row.right - r.cluster.right, 'the tool cluster left the right edge').toBeLessThanOrEqual(8.5);
      });
    }
  }

  test('375px with five filter chips, wider than the row: the name is whole, the chips scroll inside the row', async ({ page }) => {
    const r = await measure(page, fixture('全部客户', { chips: 5 }), 375);
    expect(r.labelClipped, `label ${r.labelWidth.toFixed(2)}px of ${r.labelScrollWidth}px`).toBe(false);
    expect(r.overflowX).toBe(0);
    expect(within(r.chips!, r.row), 'chips leave the row').toBe(true);
  });

  test('375px with a name longer than the row: it keeps most of the row and ends in an ellipsis', async ({ page }) => {
    const r = await measure(page, fixture('All Customers In The Northwest Sales Region Pipeline'), 375);
    expect(r.labelClipped, 'a name wider than the row is truncated').toBe(true);
    expect(r.labelWidth, `label ${r.labelWidth.toFixed(2)}px in a ${r.row.width}px row`).toBeGreaterThan(r.row.width * 0.6);
    expect(r.overflowX).toBe(0);
  });

  // CONTROL: from `sm` up the phone additions are inert, so the row lays out
  // exactly as it does without them, on one line.
  test('1280px: the row is one line and identical with or without the phone classes', async ({ page }) => {
    const withPhone = await measure(page, fixture('全部客户', { chips: 2 }), 1280);
    const without = await measure(page, fixture('全部客户', { chips: 2, phone: false }), 1280);
    expect(withPhone).toEqual(without);
    expect(withPhone.labelClipped).toBe(false);
    for (const [name, b] of [['queue', withPhone.queue], ['cluster', withPhone.cluster]] as const) {
      expect(b.top < withPhone.leading.bottom && b.bottom > withPhone.leading.top, `${name} is on the name's line`).toBe(true);
    }
  });
});
