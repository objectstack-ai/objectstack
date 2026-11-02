import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for the form field controls' phone touch floor (objectstack#29072).
 *
 * At 375×812 and 390×844 the create / edit form drew 40 px inputs, select and
 * lookup triggers, 32 px calendar days and 28 px date-picker buttons. The fix
 * gives each control `PHONE_TOUCH_HEIGHT` / `PHONE_TOUCH_SQUARE`, and the
 * calendar a 44 px cell below `sm`.
 *
 * ⚠️ A Playwright spec and not a vitest test for the reason
 * `record-path-phone-row.spec.ts` gives: jsdom has no layout engine. The
 * class-shape half sits beside the widgets in
 * `touchTarget.formControls-29072.test.tsx`.
 *
 * REAL, read out of the source at run time: the two tokens, the `Input` and
 * icon-`Button` base heights, and the calendar's cell-size classes (the
 * primitive's default and the date picker's override) — plus real Tailwind
 * compiled from the installed `tailwindcss` for exactly those candidates.
 * FIXTURE: the element tree.
 */

const REPO_ROOT = uiRoot();
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

function grab(file: string, re: RegExp, mustContain: string[]): string {
  const m = read(file).match(re);
  if (!m) throw new Error(`${file}: nothing matched ${re}`);
  for (const token of mustContain) {
    if (!m[1].split(/\s+/).includes(token)) {
      throw new Error(`${file}: ${re} matched "${m[1]}", which does not carry "${token}".`);
    }
  }
  return m[1];
}

const TOUCH = 'packages/fields/src/widgets/touchTarget.ts';
const CLS = {
  height: grab(TOUCH, /PHONE_TOUCH_HEIGHT = '([^']+)'/, ['min-h-[44px]', 'sm:min-h-0']),
  square: grab(TOUCH, /PHONE_TOUCH_SQUARE = '([^']+)'/, ['min-w-[44px]', 'sm:min-w-0']),
  input: grab('packages/components/src/ui/input.tsx', /"(flex h-10 w-full[^"]+)"/, ['h-10']),
  iconButton: grab('packages/components/src/ui/button.tsx', /icon: "([^"]+)"/, ['h-10']),
  calendarRoot: grab('packages/components/src/ui/calendar.tsx', /"(bg-background group\/calendar p-3 [^"]+)"/, ['[--cell-size:2rem]']),
  pickerCell: grab(
    'packages/fields/src/widgets/date-picker/DatePickerField.tsx',
    /className="(\[--cell-size:[^"]+)"/,
    ['[--cell-size:2.75rem]', 'sm:[--cell-size:2rem]'],
  ),
};

const mergedCalendarRoot = CLS.calendarRoot
  .split(/\s+/)
  .filter((t) => !t.startsWith('[--cell-size:'))
  .join(' ');

/** A form column at phone width (the dialog body's 16 px gutters) holding the controls. */
const fixture = () =>
  '<div style="padding:0 16px">' +
  `<input id="input" class="${CLS.input} ${CLS.height}" />` +
  `<div style="position:relative;margin-top:8px"><input class="${CLS.input} ${CLS.height}" />` +
  `<button id="dateTrigger" class="h-7 w-7 ${CLS.square}" style="position:absolute;right:4px;top:0"></button></div>` +
  `<button id="browse" class="${CLS.iconButton} ${CLS.square}"></button>` +
  // The calendar: the primitive's root class merged with the date picker's
  // override the way `cn` merges them (tailwind-merge keeps the LATER
  // `[--cell-size:…]`); seven day cells in one row.
  `<div id="calendar" class="${mergedCalendarRoot} ${CLS.pickerCell}" style="display:inline-block">` +
  '<div id="week" style="display:flex">' +
  Array.from({ length: 7 }, (_, i) => `<button class="size-(--cell-size)">${i + 1}</button>`).join('') +
  '</div></div>' +
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
    [...Object.values(CLS), 'h-7 w-7 size-(--cell-size)'].join(' ').split(/\s+/).filter(Boolean),
  );
  if (!css.includes('@media')) throw new Error('Tailwind produced no media queries — `sm:` would be inert.');
});

type Box = { w: number; h: number; right: number };
async function measure(page: Page, width: number) {
  await page.setViewportSize({ width, height: 812 });
  await page.setContent(`<style>html,body{margin:0}${css}</style>${fixture()}`, { waitUntil: 'load' });
  return page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, right: Math.round(r.right) };
    };
    const days = Array.from(document.querySelectorAll('#week button')).map((b) => {
      const r = b.getBoundingClientRect();
      return { w: r.width, h: r.height, right: r.right };
    });
    return {
      input: box('#input'),
      dateTrigger: box('#dateTrigger'),
      browse: box('#browse'),
      calendar: box('#calendar'),
      days,
      docScroll: document.documentElement.scrollWidth,
    };
  }) as Promise<{ input: Box; dateTrigger: Box; browse: Box; calendar: Box; days: Box[]; docScroll: number }>;
}

test.describe('form field controls at phone width (objectstack#29072)', () => {
  for (const width of [375, 390]) {
    test(`every control is at least 44 px at ${width}px, and the calendar fits the form`, async ({ page }) => {
      const r = await measure(page, width);
      expect(r.input.h, 'text input height').toBeGreaterThanOrEqual(44);
      expect(r.dateTrigger.h, 'date-picker button height').toBeGreaterThanOrEqual(44);
      expect(r.dateTrigger.w, 'date-picker button width').toBeGreaterThanOrEqual(44);
      expect(r.browse.h, 'browse-all button height').toBeGreaterThanOrEqual(44);
      expect(r.browse.w, 'browse-all button width').toBeGreaterThanOrEqual(44);
      for (const d of r.days) {
        expect(d.w, 'calendar day width').toBeGreaterThanOrEqual(44);
        expect(d.h, 'calendar day height').toBeGreaterThanOrEqual(44);
      }
      // A week of 44 px days plus the calendar's padding stays inside the form
      // column: no horizontal page scroll.
      expect(r.calendar.right, 'calendar ends past the form column').toBeLessThanOrEqual(width - 16);
      expect(r.docScroll, 'the page scrolls sideways').toBeLessThanOrEqual(width);
    });
  }

  test('from sm up the primitives keep their own heights', async ({ page }) => {
    const r = await measure(page, 1024);
    expect(r.input.h).toBe(40);
    expect(r.dateTrigger.h).toBe(28);
    expect(r.browse.h).toBe(40);
    for (const d of r.days) expect(d.h).toBe(32);
  });
});
