import { test, expect, type Browser, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for the record flow at phone width (objectstack#29071, a child
 * of the phone audit objectstack#29040): on a 375×812 or 390×844 touch screen
 * the record page's own controls are 44 px touch targets, nothing pushes the
 * page sideways, and the create / edit dialog the page opens fills the
 * viewport and no more.
 *
 * The run in the real Console (CRM lead, account and opportunity; showcase
 * account and project) measured the record tabs at 36 px, the related card's
 * header controls at 24 px and its rows at 32 px, the inline save bar at
 * 36 px, the bottom action bar at 40 px, the phone's back link at 28 px and
 * the comment toolbar at 28 px, and found the inline-edit pencil drawn at
 * opacity 0 on a touch screen, which has no hover to reveal it. The fix gives
 * each of them a 44 px face below `sm` (the existing `h-11 sm:h-N` and
 * `min-h-[44px] sm:min-h-0` spellings) and shows the pencil on a coarse
 * pointer. Above `sm` every control keeps its desktop size.
 *
 * ⚠️ A Playwright spec and not a vitest test for the reason
 * `record-path-phone-row.spec.ts` gives: jsdom has no layout engine, so a
 * size read there is 0 and an assertion on it is vacuous.
 *
 * REAL, read out of the sources at run time: every control's class string
 * below, the Button primitive's base classes, and the full-screen dialog's
 * class strings, plus real Tailwind compiled for exactly those candidates.
 * FIXTURE: the element trees, transcribed from the components, and their
 * text. A Button's `size` height is left out of the fixture because the
 * `className` this spec reads overrides it through `cn()`'s merge.
 *
 * NOT here, and measured in the PR's run record instead: the keyboard
 * covering a focused field and the 4× CPU throttle (behaviour of a running
 * app, not of geometry), and menus, whose placement is Radix's at run time.
 */

const UI = uiRoot();
const read = (rel: string) => readFileSync(path.join(UI, rel), 'utf8');

/** One capture out of a source file, asserting tokens so a drifted match throws. */
function grab(rel: string, src: string, re: RegExp, mustContain: string[]): string {
  const m = src.match(re);
  if (!m) throw new Error(`${rel}: nothing matched ${re}`);
  const cls = m[1];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(
        `${rel}: ${re} matched "${cls}", which does not carry "${token}" — the extraction walked ` +
          'onto the wrong string, so this measurement would be meaningless.',
      );
    }
  }
  return cls;
}

const F = {
  button: 'packages/components/src/ui/button.tsx',
  tabs: 'packages/plugin-detail/src/RecordTabRow.tsx',
  related: 'packages/plugin-detail/src/RelatedList.tsx',
  cardMenu: 'packages/plugin-detail/src/RelatedCardMenu.tsx',
  section: 'packages/plugin-detail/src/DetailSection.tsx',
  strip: 'packages/plugin-detail/src/HeaderHighlight.tsx',
  saveBar: 'packages/plugin-detail/src/InlineEditSaveBar.tsx',
  composer: 'packages/plugin-detail/src/RichTextCommentInput.tsx',
  header: 'packages/components/src/renderers/layout/containers.tsx',
  page: 'packages/app-shell/src/views/RecordDetailView.tsx',
  topBar: 'packages/components/src/custom/record-top-bar.tsx',
  dialog: 'packages/components/src/custom/mobile-dialog-content.tsx',
};
const S = Object.fromEntries(Object.entries(F).map(([k, rel]) => [k, read(rel)])) as Record<keyof typeof F, string>;
const g = (k: keyof typeof F, re: RegExp, must: string[]) => grab(F[k], S[k], re, must);

const CLS = {
  buttonBase: g('button', /cva\(\s*"([^"]+)"/, ['inline-flex', 'items-center']),
  tab: g('tabs', /const TAB_CLASS =\s*'([^']+)'/, ['h-11', 'sm:h-9']),
  tabMore: g('tabs', /'(min-w-11 justify-center gap-0\.5 rounded-t-sm[^']*)'/, ['min-w-11', 'sm:min-w-0']),
  cardHead: g('related', /className="([^"]+)"\s*data-related-panel-head=""/, ['h-11', 'sm:h-9']),
  cardOpen: g('related', /className="([^"]+)"\s*style=\{\{ transform: 'none' \}\}\s*title=\{viewAll\}/, ['self-stretch', 'after:absolute']),
  cardControls: g('related', /className="([^"]+)"\s*data-related-panel-controls=""/, ['[@media(hover:none)]:opacity-100']),
  cardNew: g('related', /className="([^"]+)"\s*disabled=\{newDisabled\}\s*aria-label=\{t\('detail\.new'\)\}/, ['h-11', 'w-11', 'sm:h-6']),
  cardRow: g('related', /className="([^"]+)"\s*data-related-card-row=""/, ['min-h-11', 'sm:h-8']),
  cardRowName: g('related', /className="(min-h-11 [^"]*text-primary hover:underline[^"]*)"/, ['min-h-11', 'sm:min-h-0']),
  cardMenu: g('cardMenu', /className="([^"]+)"\s*aria-label=\{t\('detail\.relatedCardMenu'/, ['h-11', 'w-11', 'sm:h-6']),
  cardHandle: g('cardMenu', /'(inline-flex h-11 w-11 [^']*)'/, ['h-11', 'w-11', 'sm:h-6']),
  pencil: g('section', /className="([^"]+)"\s*aria-label=\{t\('detail\.editInlineHint'\)\}/, ['min-h-[44px]', 'pointer-coarse:opacity-100', 'opacity-0']),
  stripPencil: g('strip', /className="([^"]+)"\s*aria-label=\{t\('detail\.editInlineHint'\)\}/, ['min-h-[44px]', 'pointer-coarse:opacity-100', 'opacity-0']),
  saveCancel: g('saveBar', /disabled=\{inline\.saving\}\s*className="([^"]+)"/, ['h-11', 'sm:h-9']),
  saveSave: g('saveBar', /disabled=\{inline\.saving \|\| locked\}\s*className="([^"]+)"/, ['h-11', 'sm:h-9']),
  composerRow: g('composer', /<div className="(flex flex-wrap items-center gap-0\.5[^"]*)">/, ['flex-wrap']),
  composerButton: g('composer', /className="(h-11 w-11 sm:h-7 sm:w-7)"/, ['h-11', 'sm:h-7']),
  barButton: g('header', /barFace && '(h-11 min-w-0 flex-1)'/, ['h-11', 'flex-1']),
  barMore: g('header', /barFace \? '(h-11 w-11 shrink-0 px-0)'/, ['h-11', 'w-11']),
  back: g('page', /const phoneBackClass =\s*'([^']+)'/, ['min-h-[44px]']),
  topBar: g('topBar', /'(flex min-h-11 sm:h-10 [^']*)'/, ['min-h-11', 'sm:h-10']),
  topBarButton: g('topBar', /const RECORD_TOP_BAR_BUTTON_CLASS =\s*'([^']+)'/, ['h-11', 'w-11', 'sm:h-7']),
  dialog: (() => {
    const block = S.dialog.slice(S.dialog.indexOf('// Mobile-first: full-screen'), S.dialog.indexOf('// Animations'));
    const parts = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).join(' ');
    if (!parts.includes('inset-0') || !parts.includes('h-[100dvh]')) {
      throw new Error(`${F.dialog}: the full-screen block no longer reads inset-0 and h-[100dvh]: "${parts}"`);
    }
    return parts;
  })(),
  dialogClose: (() => {
    const block = S.dialog.slice(S.dialog.indexOf('<DialogPrimitive.Close'), S.dialog.indexOf('<X '));
    const parts = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).join(' ');
    if (!parts.includes('min-h-[44px]')) throw new Error(`${F.dialog}: the close button lost its 44 px floor: "${parts}"`);
    return parts;
  })(),
};

/** The record page, transcribed: the back link, the tabs, a section field with its pencil, a related card, the inline save bar and the bottom action bar. */
const fixture = () => {
  const b = (cls: string, label: string, extra = '') =>
    `<button type="button" class="${CLS.buttonBase} px-3 ${cls}" data-t="${label}" ${extra}>${label.length > 2 ? label : '<svg width="16" height="16"></svg>'}</button>`;
  return `
<div id="page" class="flex flex-col bg-background">
  <div class="${CLS.topBar}" id="top-bar">
    <div class="flex min-w-0 flex-1 items-center gap-1"><a href="#" class="${CLS.back}" data-t="back">‹ Accounts</a></div>
    <div class="flex shrink-0 items-center gap-0.5"><span class="mr-1">3 / 21</span>
      <button type="button" class="${CLS.topBarButton}" data-t="next record"><svg width="14" height="14"></svg></button>
      <button type="button" class="${CLS.topBarButton}" data-t="previous record"><svg width="14" height="14"></svg></button>
    </div>
  </div>
  <div class="px-4">
    <div role="tablist" class="flex min-w-0 items-center gap-4 border-b">
      <button role="tab" class="${CLS.tab} border-primary" data-t="tab Overview">Overview</button>
      <button role="tab" class="${CLS.tab} border-transparent" data-t="tab Activity">Activity <span>0</span></button>
      <button class="${CLS.tab} ${CLS.tabMore}" data-t="tab more">+3</button>
    </div>
    <div class="group flex items-start justify-between gap-2 min-h-[44px] sm:min-h-0">
      <div class="text-sm flex-1 min-w-0 py-1">Acme Corp</div>
      <button type="button" class="${CLS.buttonBase} ${CLS.pencil}" data-t="pencil" id="pencil"><svg width="12" height="12"></svg></button>
    </div>
    <div class="group flex items-center gap-1"><span class="min-w-0 truncate text-sm">Atlas Construction</span><button type="button" class="${CLS.buttonBase} ${CLS.stripPencil}" data-t="strip pencil"><svg width="12" height="12"></svg></button></div>
    <section class="relative mt-4 rounded-[10px] border bg-card" id="card">
      <div class="${CLS.cardHead}">
        <button type="button" class="${CLS.cardOpen}" data-t="card open"><span class="min-w-0 truncate">Opportunities with an unusually long related list title</span><span>151</span></button>
        <span class="${CLS.cardControls}" id="controls">
          <button type="button" class="${CLS.cardHandle}" data-t="card reorder"><svg width="14" height="14"></svg></button>
          ${b(CLS.cardNew, 'N')}
          ${b(CLS.cardMenu, 'M')}
        </span>
      </div>
      ${[1, 2, 3]
        .map(
          (i) =>
            `<div class="${CLS.cardRow}"><button type="button" class="${CLS.cardRowName}" data-t="card row ${i}">Discovery Call — Acme Platform Renewal ${i}</button><span class="rounded-full px-2 text-xs">Completed</span></div>`,
        )
        .join('')}
    </section>
    <div class="mt-4 rounded-md border" id="composer">
      <div class="${CLS.composerRow}">
        ${['B', 'I', 'L', 'C', '@'].map((x) => b(CLS.composerButton, x)).join('')}
        <div class="flex-1"></div>
        ${['P', 'S'].map((x) => b(CLS.composerButton, x)).join('')}
      </div>
    </div>
    <div class="sticky bottom-0 mt-4 flex flex-wrap items-center justify-end gap-2 rounded-md border px-3 py-2">
      ${b(`gap-2 ${CLS.saveCancel}`, 'Cancel')}${b(`gap-2 ${CLS.saveSave}`, 'Save')}
    </div>
  </div>
  <div class="shrink-0 border-t px-4 pt-3 pb-3"><div class="flex items-center gap-2">
    ${b(`gap-2 ${CLS.barButton}`, 'Edit')}${b(`gap-2 ${CLS.barButton}`, 'Convert Lead')}${b(CLS.barMore, 'MA')}
  </div></div>
</div>`;
};

const dialogFixture = () => `
<div class="${CLS.dialog} flex flex-col" id="dialog">
  <h2 class="text-lg font-semibold">Create Activity</h2>
  <div class="flex-1 overflow-y-auto">${'<div class="h-10 my-4 border"></div>'.repeat(30)}</div>
  <button type="button" class="${CLS.dialogClose}" id="close"><svg width="20" height="20"></svg></button>
</div>`;

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
  const extra = 'flex flex-col flex-1 h-12 gap-0.5 gap-1 mr-1 px-2 px-3 px-4 pt-3 pb-3 mt-4 gap-2 gap-4 border border-b border-t border-primary border-transparent rounded-md rounded-full rounded-[10px] text-xs text-sm text-lg font-semibold relative sticky bottom-0 shrink-0 min-w-0 truncate group items-start items-center justify-between justify-end flex-wrap py-1 py-2 overflow-y-auto h-10 my-4 bg-card bg-background';
  css = compiler.build([...Object.values(CLS), extra].join(' ').split(/\s+/).filter(Boolean));
  if (!css.includes('@media') || !css.includes('pointer: coarse')) {
    throw new Error('Tailwind produced no `sm:` or `pointer-coarse:` media query — the phone faces would be inert.');
  }
});

type Box = { t: string; w: number; h: number; right: number; opacity: number };

async function open(browser: Browser, width: number, height: number, touch: boolean): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  return page;
}

async function measure(page: Page, html: string) {
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}${css}</style>${html}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);
  return page.evaluate(() => {
    const opacity = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const boxes: Box[] = [...document.querySelectorAll('[data-t]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { t: el.getAttribute('data-t')!, w: r.width, h: r.height, right: r.right, opacity: opacity(el) };
    });
    return { boxes, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
  });
}

test.describe('the record flow at phone width (objectstack#29071)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'touch emulation (isMobile) is Chromium-only');

  for (const [width, height] of [[375, 812], [390, 844]]) {
    test(`every record-page control is a 44 px target and nothing scrolls sideways at ${width}×${height}`, async ({ browser }) => {
      const page = await open(browser, width, height, true);
      const r = await measure(page, fixture());
      expect(r.scrollWidth, `the page is ${r.scrollWidth}px wide in a ${r.innerWidth}px viewport`).toBeLessThanOrEqual(width);
      expect(r.boxes.length).toBeGreaterThan(15);
      // The top bar holds its 44 px controls: they do not spill out of it.
      const bar = await page.evaluate(() => document.getElementById('top-bar')!.getBoundingClientRect().height);
      expect(bar, 'the record top bar is shorter than its controls and its border').toBeGreaterThanOrEqual(45);
      for (const box of r.boxes) {
        expect(box.h, `"${box.t}" is ${box.h}px tall`).toBeGreaterThanOrEqual(44);
        expect(box.w, `"${box.t}" is ${box.w}px wide`).toBeGreaterThanOrEqual(44);
        expect(box.right, `"${box.t}" ends past the viewport`).toBeLessThanOrEqual(width + 0.5);
        // A touch screen has no hover: what is a target there is drawn.
        expect(box.opacity, `"${box.t}" is drawn at opacity ${box.opacity} on a touch screen`).toBe(1);
      }
      await page.context().close();
    });

    test(`the create / edit dialog fills the viewport and no more at ${width}×${height}`, async ({ browser }) => {
      const page = await open(browser, width, height, true);
      await measure(page, dialogFixture());
      const d = await page.evaluate(() => {
        const r = document.getElementById('dialog')!.getBoundingClientRect();
        const c = document.getElementById('close')!.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, closeW: c.width, closeH: c.height };
      });
      expect(d.left).toBeGreaterThanOrEqual(0);
      expect(d.top).toBeGreaterThanOrEqual(0);
      expect(d.right).toBeLessThanOrEqual(width);
      expect(d.bottom).toBeLessThanOrEqual(height);
      expect(d.bottom - d.top, 'the dialog does not reach the bottom edge').toBeGreaterThanOrEqual(height - 0.5);
      expect(d.closeW).toBeGreaterThanOrEqual(44);
      expect(d.closeH).toBeGreaterThanOrEqual(44);
      await page.context().close();
    });
  }

  test('above `sm`, with a mouse, the controls keep their desktop size and the pencil waits for hover', async ({ browser }) => {
    const page = await open(browser, 1280, 800, false);
    const r = await measure(page, fixture());
    const box = (t: string) => r.boxes.find((b) => b.t === t)!;
    // Not vacuous: the phone floor is a `sm:`-reset face, so on a desktop the
    // tab is back to 36 px and the related card's ⋯ to 24 px.
    expect(box('tab Overview').h).toBe(36);
    expect(box('M').h).toBe(24);
    expect(box('Save').h).toBe(36);
    expect(box('pencil').opacity).toBe(0);
    expect(box('strip pencil').opacity).toBe(0);
    expect(box('strip pencil').h).toBe(20);
    expect(box('next record').h).toBe(28);
    await page.context().close();
  });
});
