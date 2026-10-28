import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for `record:path`'s phone row (objectstack#26897).
 *
 * At 390×844 on the HotCRM seed the path's row below `sm` cut the stage at its
 * right edge mid-word ("Resolu"): the stages were content-width and
 * `whitespace-nowrap` inside a sideways scroller whose scrollbar is hidden, so
 * nothing said the row scrolled. The fix gives every stage an equal share with
 * a 2.5rem floor, truncates an ordinary label with an ellipsis and wraps a
 * terminal one, as the desktop rail does.
 *
 * ⚠️ A Playwright spec and not a vitest test for the reason
 * `record-header-title-width.spec.ts` gives: jsdom has no layout engine, so a
 * width read there is 0 and an assertion on it is vacuous. The class-shape
 * half (and the `title` that keeps a cut label readable) is pinned beside the
 * renderer in `record-path.phoneRow-26897.test.tsx`.
 *
 * REAL, read out of `record-path.tsx` at run time: the phone row's class
 * string, the stage, rail and label base strings `renderStage` composes, and
 * the three named label/stage constants — plus real Tailwind compiled from the
 * installed `tailwindcss` for exactly those candidates. FIXTURE: the stage
 * labels, and the element tree, transcribed from `renderStage`.
 */

const REPO_ROOT = uiRoot();
const PATH_FILE = 'packages/plugin-detail/src/renderers/record-path.tsx';
const pathSrc = readFileSync(path.join(REPO_ROOT, PATH_FILE), 'utf8');

/** One string out of the source, asserting a token so a drifted match throws. */
function grab(re: RegExp, mustContain: string[]): string {
  const m = pathSrc.match(re);
  if (!m) throw new Error(`${PATH_FILE}: nothing matched ${re}`);
  const cls = m[1];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(
        `${PATH_FILE}: ${re} matched "${cls}", which does not carry "${token}" — the extraction ` +
          'walked onto the wrong string, so this measurement would be meaningless.',
      );
    }
  }
  return cls;
}

const CLS = {
  row: grab(/\{\/\* Mobile:[^\n]*\*\/\}\s*<div\s+className="([^"]+)"/, ['sm:hidden', 'overflow-x-auto']),
  stage: grab(/className=\{cn\('([^']+)', o\.className\)\}/, ['flex-col']),
  rail: grab(/const railClass = [\s\S]*?cn\(\s*'([^']+)'/, ['w-full']),
  label: grab(/const labelClass = [\s\S]*?cn\(\s*'([^']+)'/, ['min-w-0']),
  phoneStage: grab(/const PHONE_STAGE_CLASS = '([^']+)'/, ['min-w-10']),
  phoneLabel: grab(/const PHONE_LABEL_CLASS = '([^']+)'/, ['truncate']),
  terminalLabel: grab(/const TERMINAL_LABEL_CLASS = '([^']+)'/, ['[overflow-wrap:anywhere]']),
};

type Stage = { label: string; terminal?: boolean };

/** The card's case path, as the HotCRM seed draws it. */
const CASE_STAGES: Stage[] = [
  { label: 'New' },
  { label: 'In Progress' },
  { label: 'Waiting on Customer' },
  { label: 'Resolution Proposed' },
  { label: 'Resolved' },
  { label: 'Closed', terminal: true },
];

/** A long path: ten stages, so 2.5rem floors cannot all fit a 320px row. */
const LONG_STAGES: Stage[] = Array.from({ length: 10 }, (_, i) => ({ label: `Stage number ${i + 1}` }));

const fixture = (stages: Stage[]) =>
  `<div id="row" role="list" class="${CLS.row}">` +
  stages
    .map(
      (s) =>
        `<div role="listitem" class="${CLS.stage} ${CLS.phoneStage}">` +
        `<span class="${CLS.rail} bg-muted"></span>` +
        `<span class="${CLS.label} ${s.terminal ? CLS.terminalLabel : CLS.phoneLabel}">${s.label}</span>` +
        '</div>',
    )
    .join('') +
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
  css = compiler.build([...Object.values(CLS), 'bg-muted'].join(' ').split(/\s+/).filter(Boolean));
  if (!css.includes('@media')) {
    throw new Error('Tailwind produced no media queries — `sm:hidden` would be inert.');
  }
});

type Reading = {
  rowClientWidth: number;
  rowScrollWidth: number;
  stages: { label: string; left: number; right: number; width: number; clipped: boolean; ellipsis: boolean }[];
};

async function readRow(page: Page, stages: Stage[], width: number): Promise<Reading> {
  await page.setViewportSize({ width, height: 844 });
  await page.setContent(`<style>html,body{margin:0}${css}</style>${fixture(stages)}`, { waitUntil: 'load' });
  // Wait for the row's layout to settle across two frames, then for fonts.
  await page.waitForFunction(
    () => {
      const row = document.getElementById('row');
      if (!row || row.getBoundingClientRect().width <= 0) return false;
      const w = row.scrollWidth;
      const prev = (window as unknown as { __w?: number }).__w;
      (window as unknown as { __w?: number }).__w = w;
      return prev !== undefined && prev === w;
    },
    null,
    { polling: 'raf', timeout: 10_000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const row = document.getElementById('row')!;
    return {
      rowClientWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      stages: Array.from(row.children).map((item) => {
        const label = item.querySelector('span:not(.bg-muted)') as HTMLElement;
        const r = item.getBoundingClientRect();
        return {
          label: label.textContent ?? '',
          left: round(r.left),
          right: round(r.right),
          width: round(r.width),
          clipped: label.scrollWidth > label.clientWidth,
          ellipsis: getComputedStyle(label).textOverflow === 'ellipsis',
        };
      }),
    };
  });
}

test.describe('record:path phone row (objectstack#26897)', () => {
  for (const width of [320, 375, 390]) {
    test(`the case path fits its row at ${width}px and every cut label ellipsises`, async ({ page }) => {
      const r = await readRow(page, CASE_STAGES, width);
      // THE assertion: nothing hides past the row's edge, where the hidden
      // scrollbar gave no sign that it was there.
      expect(
        r.rowScrollWidth,
        `row holds ${r.rowScrollWidth}px of stages in ${r.rowClientWidth}px — the last stage is cut at the edge`,
      ).toBeLessThanOrEqual(r.rowClientWidth);
      for (const s of r.stages) {
        expect(s.right, `stage "${s.label}" ends past the row`).toBeLessThanOrEqual(width + 0.5);
        // A label that does not fit is cut WITH an ellipsis, never bare.
        if (s.clipped) expect(s.ellipsis, `stage "${s.label}" is cut with no ellipsis`).toBe(true);
      }
      // Not vacuous: at these widths the long labels really are cut.
      expect(r.stages.some((s) => s.clipped), 'no label was cut, so the ellipsis went unmeasured').toBe(true);
      // Equal shares: every stage is one width.
      const widths = new Set(r.stages.map((s) => Math.round(s.width)));
      expect(widths.size, `stage widths ${[...widths].join(', ')}`).toBe(1);
    });
  }

  test('a terminal label wraps instead of being cut, as on the desktop rail', async ({ page }) => {
    const r = await readRow(page, [...CASE_STAGES.slice(0, 5), { label: 'Closed — Duplicate', terminal: true }], 320);
    const terminal = r.stages[r.stages.length - 1];
    expect(terminal.clipped, 'the terminal stage label is cut').toBe(false);
  });

  test('past the floor the stages keep 2.5rem and the row scrolls instead', async ({ page }) => {
    const r = await readRow(page, LONG_STAGES, 320);
    for (const s of r.stages) expect(s.width).toBeGreaterThanOrEqual(40);
    expect(r.rowScrollWidth).toBeGreaterThan(r.rowClientWidth);
  });
});
