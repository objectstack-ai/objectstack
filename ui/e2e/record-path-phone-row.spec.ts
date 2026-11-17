import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for `record:path` below `sm`: the compact path (objectstack#34595).
 *
 * The phone row used to name every stage in an equal share (objectstack#26897),
 * which at 375px cut seven opportunity stages to their first letters. Below
 * `sm` the path now draws one rail segment per stage and no names, then a
 * summary line with the step and the current stage's FULL name, which opens a
 * list of every stage. This spec measures, in Chromium, that the rail fits
 * its row at phone widths with every segment one width, and that the summary
 * shows the current stage's name whole — wrapping a long one — inside the
 * viewport, on a 44px touch target.
 *
 * A Playwright spec and not a vitest test for the reason
 * `record-header-title-width.spec.ts` gives: jsdom has no layout engine, so a
 * width read there is 0 and an assertion on it is vacuous. The class-shape
 * half is pinned beside the renderer in `record-path.compact-34595.test.tsx`.
 *
 * REAL, read out of `record-path.tsx` at run time: the compact block's class,
 * the rail's base string `railClass` composes and the named PHONE_* constants
 * — plus real Tailwind compiled from the installed `tailwindcss` for exactly
 * those candidates. FIXTURE: the stage labels, and the element tree,
 * transcribed from the compact block.
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
  compact: grab(/\{\/\* Mobile:[^\n]*\*\/\}\s*<div\s+className="([^"]+)"/, ['sm:@sm:hidden']),
  rail: grab(/const railClass = [\s\S]*?cn\(\s*'([^']+)'/, ['w-full']),
  railRow: grab(/const PHONE_RAIL_ROW_CLASS = '([^']+)'/, ['flex', 'w-full']),
  railSegment: grab(/const PHONE_RAIL_SEGMENT_CLASS = '([^']+)'/, ['flex-1', 'min-w-0']),
  summary: grab(/const PHONE_SUMMARY_CLASS =\s*'([^']+)'/, ['min-h-11', 'w-full']),
  summaryStage: grab(/const PHONE_SUMMARY_STAGE_CLASS = '([^']+)'/, ['[overflow-wrap:anywhere]']),
};

/** The opportunity path the card measured: seven stages, the last one lost. */
const OPPORTUNITY = ['Prospecting', 'Qualification', 'Needs Analysis', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];

/** A long path: twenty stages, far more than seven names could share. */
const LONG_PATH = Array.from({ length: 20 }, (_, i) => `Stage number ${i + 1}`);

const fixture = (stages: string[], current: string) =>
  `<div class="${CLS.compact}">` +
  `<div id="rails" aria-hidden="true" class="${CLS.railRow}">` +
  stages
    .map((_, i) => `<span class="${CLS.rail} bg-muted ${CLS.railSegment}${i === stages.length - 1 ? ' ml-1' : ''}"></span>`)
    .join('') +
  '</div>' +
  `<button id="summary" type="button" class="${CLS.summary}">` +
  `<span class="shrink-0">Step 5 of ${stages.length - 1}</span><span aria-hidden="true">·</span>` +
  `<span id="current" class="${CLS.summaryStage}">${current}</span>` +
  '<svg class="ml-auto h-4 w-4 shrink-0" width="16" height="16"></svg>' +
  '</button>' +
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
    [...Object.values(CLS), 'bg-muted ml-1 shrink-0 ml-auto h-4 w-4'].join(' ').split(/\s+/).filter(Boolean),
  );
  if (!css.includes('@media')) {
    throw new Error('Tailwind produced no media queries — `sm:@sm:hidden` would be inert.');
  }
});

type Reading = {
  rowClientWidth: number;
  rowScrollWidth: number;
  segments: { left: number; right: number; width: number }[];
  summary: { right: number; height: number };
  current: { right: number; clipped: boolean; lines: number };
};

async function readPath(page: Page, stages: string[], current: string, width: number): Promise<Reading> {
  await page.setViewportSize({ width, height: 844 });
  await page.setContent(
    `<style>html,body{margin:0}body{padding:0 16px;font:14px sans-serif}${css}</style>${fixture(stages, current)}`,
    { waitUntil: 'load' },
  );
  // Wait for the row's layout to settle across two frames, then for fonts.
  await page.waitForFunction(
    () => {
      const row = document.getElementById('rails');
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
    const row = document.getElementById('rails')!;
    const summary = document.getElementById('summary')!.getBoundingClientRect();
    const cur = document.getElementById('current')!;
    const curRect = cur.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(cur).lineHeight) || 16;
    return {
      rowClientWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      segments: Array.from(row.children).map((seg) => {
        const r = seg.getBoundingClientRect();
        return { left: round(r.left), right: round(r.right), width: round(r.width) };
      }),
      summary: { right: round(summary.right), height: round(summary.height) },
      current: {
        right: round(curRect.right),
        clipped: cur.scrollWidth > cur.clientWidth,
        lines: Math.round(curRect.height / lineHeight),
      },
    };
  });
}

test.describe('record:path compact phone path (objectstack#34595)', () => {
  for (const width of [320, 375, 390]) {
    test(`the opportunity's rail fits its row at ${width}px, one width per stage, and names the current stage whole`, async ({ page }) => {
      const r = await readPath(page, OPPORTUNITY, 'Negotiation', width);
      expect(
        r.rowScrollWidth,
        `rail holds ${r.rowScrollWidth}px of segments in ${r.rowClientWidth}px — a stage is cut at the edge`,
      ).toBeLessThanOrEqual(r.rowClientWidth);
      expect(r.segments).toHaveLength(OPPORTUNITY.length);
      for (const s of r.segments) {
        expect(s.right, 'a rail segment ends past the viewport').toBeLessThanOrEqual(width + 0.5);
        expect(s.width, 'a rail segment collapsed').toBeGreaterThan(8);
      }
      // Equal shares: every segment is one width.
      const widths = new Set(r.segments.map((s) => Math.round(s.width)));
      expect(widths.size, `segment widths ${[...widths].join(', ')}`).toBe(1);
      // The current stage's name is whole, inside the viewport, on a 44px target.
      expect(r.current.clipped, 'the current stage name is cut').toBe(false);
      expect(r.current.right).toBeLessThanOrEqual(width + 0.5);
      expect(r.summary.right).toBeLessThanOrEqual(width + 0.5);
      expect(r.summary.height).toBeGreaterThanOrEqual(44);
    });
  }

  test('a long current stage name wraps instead of being cut', async ({ page }) => {
    const long = 'Waiting on Customer Signature and Legal Review of the Master Agreement';
    const r = await readPath(page, OPPORTUNITY, long, 320);
    expect(r.current.clipped, 'the long stage name is cut').toBe(false);
    expect(r.current.right).toBeLessThanOrEqual(320 + 0.5);
    // Not vacuous: at 320px the name really does need more than one line.
    expect(r.current.lines, 'the long name fit one line, so wrapping went unmeasured').toBeGreaterThan(1);
  });

  test('a twenty-stage path still fits its rail at 320px', async ({ page }) => {
    const r = await readPath(page, LONG_PATH, 'Stage number 5', 320);
    expect(r.rowScrollWidth).toBeLessThanOrEqual(r.rowClientWidth);
    for (const s of r.segments) expect(s.width).toBeGreaterThan(0);
  });
});
