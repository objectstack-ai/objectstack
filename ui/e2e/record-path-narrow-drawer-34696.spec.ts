import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for `record:path` in a narrow record drawer at a desktop
 * viewport (objectstack#34696).
 *
 * The desktop row and the compact path used to switch on the VIEWPORT alone,
 * so a 380 px record drawer at a 1280 px viewport drew the desktop row: seven
 * equal shares of about 33 px each, which read as 'P…', 'Pro…', 'Ne…'. The
 * path's root is now a Tailwind container and each row stacks `sm` on the
 * container's `@sm`, so that drawer draws the compact path, while a wide page
 * draws the desktop row exactly as before, and a viewport below `sm` keeps the
 * compact path whatever the path's width.
 *
 * A Playwright spec and not a vitest test for the reason
 * `record-header-title-width.spec.ts` gives: jsdom has no layout engine, so a
 * width read there is 0 and an assertion on it is vacuous. The class-shape
 * half is pinned beside the renderer in `record-path.compact-34595.test.tsx`.
 *
 * REAL, read out of `record-path.tsx` at run time: the root's class, both
 * rows' switch classes, the desktop row's group and stage classes, the label
 * and rail base strings and the named PHONE_* constants, plus real Tailwind
 * compiled from the installed `tailwindcss` for exactly those candidates.
 * FIXTURE: the stage labels, and the element trees, transcribed from the two
 * rows.
 */

const REPO_ROOT = uiRoot();
const PATH_FILE = 'packages/plugin-detail/src/renderers/record-path.tsx';
const pathSrc = readFileSync(path.join(REPO_ROOT, PATH_FILE), 'utf8');

/** One string out of the source, asserting tokens so a drifted match throws. */
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
  root: grab(/<div className=\{cn\('([^']+)', className\)\} \{\.\.\.designer\}>/, ['@container', 'w-full']),
  desktop: grab(/\{\/\* Desktop[^\n]*\*\/\}\s*<div\s+className="([^"]+)"/, ['hidden', 'sm:@sm:flex']),
  forwardGroup: grab(/<div className="([^"]+)" style=\{shareOf\(forwardStages\.length\)\}>/, ['flex', 'min-w-0']),
  lostGroup: grab(/<div\s+className="([^"]+)"\s+style=\{shareOf\(lostStages\.length\)\}/, ['flex', 'border-l']),
  stageItem: grab(/className=\{cn\('(flex flex-col gap-1\.5)', listLine/, ['flex-col']),
  stageShare: grab(/forwardStages\.map[\s\S]*?className: '([^']+)'/, ['flex-1', 'min-w-0']),
  ordinaryLabel: grab(/labelClassName: stageTerminals\[idx\] \? TERMINAL_LABEL_CLASS : '([^']+)'/, ['truncate']),
  terminalLabel: grab(/const TERMINAL_LABEL_CLASS = '([^']+)'/, ['[overflow-wrap:anywhere]']),
  label: grab(/const labelClass = [\s\S]*?cn\(\s*'([^']+)'/, ['block', 'min-w-0', 'text-xs']),
  rail: grab(/const railClass = [\s\S]*?cn\(\s*'([^']+)'/, ['w-full']),
  compact: grab(/\{\/\* Mobile:[^\n]*\*\/\}\s*<div\s+className="([^"]+)"/, ['sm:@sm:hidden']),
  railRow: grab(/const PHONE_RAIL_ROW_CLASS = '([^']+)'/, ['flex', 'w-full']),
  railSegment: grab(/const PHONE_RAIL_SEGMENT_CLASS = '([^']+)'/, ['flex-1', 'min-w-0']),
  summary: grab(/const PHONE_SUMMARY_CLASS =\s*'([^']+)'/, ['min-h-11', 'w-full']),
  summaryStage: grab(/const PHONE_SUMMARY_STAGE_CLASS = '([^']+)'/, ['[overflow-wrap:anywhere]']),
};

/** The opportunity path the card measured: five open stages, won, then lost. */
const FORWARD = ['Prospecting', 'Qualification', 'Needs Analysis', 'Proposal', 'Negotiation', 'Closed Won'];
const LOST = ['Closed Lost'];
const CURRENT = 'Negotiation';

/** The tree both rows draw, with the switch classes the source gives them (or the old ones). */
const fixture = (cls: { root: string; desktop: string; compact: string }) => {
  const stage = (label: string, terminal: boolean) =>
    `<div role="listitem" class="${CLS.stageItem} ${CLS.stageShare}">` +
    `<span class="${CLS.rail} bg-muted"></span>` +
    `<span data-label="${label}" data-ordinary="${terminal ? '' : 'yes'}" class="${CLS.label} font-normal ${
      terminal ? CLS.terminalLabel : CLS.ordinaryLabel
    }">${label}</span></div>`;
  const forward = FORWARD.map((l, i) => stage(l, i === FORWARD.length - 1)).join('');
  const lost = LOST.map((l) => stage(l, true)).join('');
  const total = FORWARD.length + LOST.length;
  return (
    `<div id="root" class="${cls.root}">` +
    `<div id="desktop" role="list" class="${cls.desktop}">` +
    `<div class="${CLS.forwardGroup}" style="flex:${FORWARD.length} 1 0%">${forward}</div>` +
    `<div class="${CLS.lostGroup}" style="flex:${LOST.length} 1 0%">${lost}</div>` +
    '</div>' +
    `<div id="compact" class="${cls.compact}">` +
    `<div id="rails" aria-hidden="true" class="${CLS.railRow}">` +
    Array.from({ length: total }, (_, i) =>
      `<span class="${CLS.rail} bg-muted ${CLS.railSegment}${i === FORWARD.length ? ' ml-1' : ''}"></span>`,
    ).join('') +
    '</div>' +
    `<button id="summary" type="button" class="${CLS.summary}">` +
    `<span class="shrink-0">Step 5 of ${FORWARD.length}</span><span aria-hidden="true">·</span>` +
    `<span id="current" class="${CLS.summaryStage}">${CURRENT}</span>` +
    '<svg class="ml-auto h-4 w-4 shrink-0" width="16" height="16"></svg>' +
    '</button>' +
    '</div>' +
    '</div>'
  );
};

const NOW = { root: CLS.root, desktop: CLS.desktop, compact: CLS.compact };
/** The switch as it stood before this card: viewport only, no container. */
const BEFORE = {
  root: CLS.root.replace('@container', '').trim(),
  desktop: CLS.desktop.replace('sm:@sm:flex', 'sm:flex'),
  compact: CLS.compact.replace('sm:@sm:hidden', 'sm:hidden'),
};

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
    [...Object.values(CLS), ...Object.values(BEFORE), 'bg-muted font-normal ml-1 shrink-0 ml-auto h-4 w-4']
      .join(' ')
      .split(/\s+/)
      .filter(Boolean),
  );
  if (!css.includes('@container')) {
    throw new Error('Tailwind produced no container query — `sm:@sm:flex` would be inert.');
  }
});

type Reading = {
  desktopShown: boolean;
  compactShown: boolean;
  labels: { label: string; ordinary: boolean; width: number; clipped: boolean; top: number; left: number }[];
  current: { clipped: boolean; right: number };
  railsFit: boolean;
  drawerRight: number;
};

async function readPath(
  page: Page,
  opts: { viewport: number; container: number; cls?: typeof NOW; forceDesktop?: boolean },
): Promise<Reading> {
  await page.setViewportSize({ width: opts.viewport, height: 900 });
  const force = opts.forceDesktop ? '#desktop{display:flex!important}' : '';
  await page.setContent(
    `<style>html,body{margin:0}body{font:14px sans-serif}${css}${force}</style>` +
      `<div id="drawer" style="width:${opts.container}px">${fixture(opts.cls ?? NOW)}</div>`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const shown = (id: string) => getComputedStyle(document.getElementById(id)!).display !== 'none';
    const cur = document.getElementById('current')!;
    const rails = document.getElementById('rails')!;
    return {
      desktopShown: shown('desktop'),
      compactShown: shown('compact'),
      labels: Array.from(document.querySelectorAll<HTMLElement>('#desktop [data-label]')).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: el.dataset.label!,
          ordinary: el.dataset.ordinary === 'yes',
          width: round(r.width),
          clipped: el.scrollWidth > el.clientWidth,
          top: round(r.top),
          left: round(r.left),
        };
      }),
      current: { clipped: cur.scrollWidth > cur.clientWidth, right: round(cur.getBoundingClientRect().right) },
      railsFit: rails.scrollWidth <= rails.clientWidth,
      drawerRight: round(document.getElementById('drawer')!.getBoundingClientRect().right),
    };
  });
}

test.describe('record:path in a narrow drawer at a desktop viewport (objectstack#34696)', () => {
  test('the defect this pins: at 380px the desktop row gives each stage under 50px and cuts the long names', async ({ page }) => {
    // Forced on, the desktop row shows what the drawer drew before: not vacuous.
    const r = await readPath(page, { viewport: 1280, container: 380, forceDesktop: true });
    const ordinary = r.labels.filter((l) => l.ordinary);
    expect(ordinary).toHaveLength(FORWARD.length - 1);
    for (const l of ordinary) expect(l.width, `${l.label} got ${l.width}px`).toBeLessThan(50);
    for (const name of ['Prospecting', 'Qualification', 'Needs Analysis', 'Negotiation']) {
      expect(ordinary.find((l) => l.label === name)?.clipped, `${name} fit whole in the desktop row at 380px`).toBe(true);
    }
  });

  for (const container of [360, 380]) {
    test(`a ${container}px drawer at a 1280px viewport draws the compact path, the current stage whole`, async ({ page }) => {
      const r = await readPath(page, { viewport: 1280, container });
      expect(r.desktopShown, 'the desktop row still draws in the narrow drawer').toBe(false);
      expect(r.compactShown, 'the compact path is hidden in the narrow drawer').toBe(true);
      expect(r.current.clipped, `${CURRENT} is cut`).toBe(false);
      expect(r.current.right).toBeLessThanOrEqual(r.drawerRight + 0.5);
      expect(r.railsFit, 'the rail spills out of its row').toBe(true);
    });
  }

  test('a viewport below `sm` keeps the compact path even in a path wider than `@sm`', async ({ page }) => {
    const r = await readPath(page, { viewport: 600, container: 560 });
    expect(r.desktopShown).toBe(false);
    expect(r.compactShown).toBe(true);
  });

  test('CONTROL — a 900px path at a 1280px viewport draws the desktop row, every label readable', async ({ page }) => {
    const r = await readPath(page, { viewport: 1280, container: 900 });
    expect(r.desktopShown, 'the wide page lost its desktop row').toBe(true);
    expect(r.compactShown, 'the wide page drew the compact path').toBe(false);
    for (const l of r.labels) {
      expect(l.clipped, `${l.label} is cut on the wide page`).toBe(false);
      expect(l.width).toBeGreaterThan(80);
    }
  });

  test('CONTROL — the wide desktop row is pixel-identical to the viewport-only switch it replaces', async ({ page }) => {
    for (const container of [900, 1200]) {
      const now = await readPath(page, { viewport: 1280, container, cls: NOW });
      const before = await readPath(page, { viewport: 1280, container, cls: BEFORE });
      expect(before.desktopShown).toBe(true);
      expect(now.labels, `the desktop row moved at ${container}px`).toEqual(before.labels);
    }
  });
});
