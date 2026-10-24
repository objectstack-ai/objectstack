import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { build, type Plugin, type Rollup } from 'vite';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#11723: a toast's Undo and close buttons were dead while the record
 * drawer that raised them was open, and the click went through the toast to
 * whatever lay under it.
 *
 * ## The defect, two mechanisms
 *
 * 1. A Radix modal sets `pointer-events: none` on `<body>` and turns pointer
 *    events back on for its own layer only. The sonner toaster inherits the
 *    `none`, so the browser's hit test skips every toast: a click on Undo landed
 *    on the drawer's overlay (which closes the drawer), on the drawer header's
 *    expand and close buttons, or on a record action such as Approve.
 * 2. Once a toast does take the click, the drawer's outside-click handling still
 *    sees a `pointerdown` outside its own content, so the same click that runs
 *    Undo also closes the drawer.
 *
 * `ConsoleToaster` answers both, for every Radix layer at once: visible toasts
 * take pointer events, and a `pointerdown` inside the toaster stops at the
 * toaster, so no document-level outside-click handler sees it.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * Mechanism 1 is a hit-test question, and jsdom and happy-dom have no hit
 * testing: `elementFromPoint` there answers nothing about which element a real
 * click reaches. This file clicks with the real pointer in Chromium, at the
 * toast's real position, the reason `e2e/record-header-title-width.spec.ts` and
 * `e2e/sidebar-offcanvas-geometry.spec.ts` give for themselves. Mechanism 2 is
 * also pinned without layout, through dispatched events, in
 * `packages/app-shell/src/chrome/ConsoleToaster.underModal-11723.test.tsx`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL, built from source at run time and running in the page: `ConsoleToaster`
 * (with its objectui#11685 drawer clearance), `ThemeProvider`, the record
 * overlay host `NavigationOverlay` with the props `ObjectView` gives it, and
 * through it the Shadcn `Sheet` (drawer mode: both objectui#11685 paths, beside
 * the drawer and below its header) and `Dialog` (modal mode: the centred
 * dialog, toaster at its no-drawer anchor, top-centre below the top bar,
 * objectui#13340), both on `@radix-ui/react-dialog`; sonner
 * itself; React. The stylesheet is real Tailwind, compiled from the installed
 * `tailwindcss` for the class strings in those source files.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - `@object-ui/i18n` is a stub that returns each key's English default. It
 *     is on no hit-test path; only labels go through it.
 *   - `@object-ui/react` is a stub exporting a `SchemaRenderer` that renders
 *     nothing. The components' `lib/utils` imports it for its slot helpers,
 *     which the drawer does not call.
 *   - The overlay's content is a stand-in for `RecordDetailView`: the record
 *     title and two `record_header` actions in its first row, then filler.
 *     Every control in it logs its clicks, so a click that falls through a toast
 *     onto the record is caught.
 *   - Toasts are raised by calling sonner's `toast.success` with an `Undo`
 *     action, the shape `RecordDetailView` and `useConsoleActionRuntime` raise.
 *   - Theme colour tokens are not compiled (the console's theme stylesheet is
 *     not loaded), so surfaces are unpainted. Colour is on no hit-test path.
 *   - The page asks for reduced motion, which sonner honours by dropping its
 *     transitions, so every position is read at rest.
 *
 * Workspace packages are not imported by name: this lane builds no workspace
 * `dist/`, and `scripts/__tests__/e2e-type-check.test.ts` pins that no spec
 * under `e2e/` imports one.
 */

const REPO_ROOT = (() => {
  // Rooted on this file, never on `process.cwd()` (AGENTS.md: tests read the
  // filesystem relative to their own file). Bare `import.meta.url`, walked up.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    try {
      readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8');
      return dir;
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error('could not locate the repo root from ' + import.meta.url);
})();

const source = (rel: string) => path.join(REPO_ROOT, rel);

const CONSOLE_TOASTER = source('packages/app-shell/src/chrome/ConsoleToaster.tsx');
const THEME_PROVIDER = source('packages/app-shell/src/chrome/ThemeProvider.tsx');
const NAVIGATION_OVERLAY = source('packages/components/src/custom/navigation-overlay.tsx');

/** The source files whose class strings the page draws with. */
const STYLED_SOURCES = [
  CONSOLE_TOASTER,
  NAVIGATION_OVERLAY,
  source('packages/components/src/ui/sheet.tsx'),
  source('packages/components/src/ui/dialog.tsx'),
];

const STUB_I18N = '\0toast-under-modal:i18n';
const STUB_REACT = '\0toast-under-modal:react';
const ENTRY = '\0toast-under-modal:entry';

/** Classes the stand-in record content uses; compiled with the sources above. */
const HARNESS_CLASSES = 'flex items-center justify-between gap-4 gap-2 px-6 py-4 p-6 py-2 h-9 px-4 rounded-md border border-b text-xl font-semibold';

/** The stub and the entry described in the header, as one Vite plugin. */
function fixtures(): Plugin {
  const at = (file: string) => JSON.stringify(file);
  const modules: Record<string, string> = {
    [STUB_I18N]: `
const fallback = (key, options) =>
  options && typeof options.defaultValue === 'string' ? options.defaultValue : key;
export const useObjectTranslation = () => ({ t: fallback });
export const createSafeTranslation = (defaults) => () => ({
  t: (key, options) => {
    let text = defaults[key] ?? fallback(key, options);
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.split('{{' + name + '}}').join(String(value));
    }
    return text;
  },
});
`,
    [STUB_REACT]: 'export const SchemaRenderer = () => null;\n',
    [ENTRY]: `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { ConsoleToaster } from ${at(CONSOLE_TOASTER)};
import { ThemeProvider } from ${at(THEME_PROVIDER)};
import { NavigationOverlay } from ${at(NAVIGATION_OVERLAY)};

const h = React.createElement;
const log = [];
const record = (what) => () => log.push(what);
let openOverlay = () => {};

const button = (label, what) =>
  h('button', { type: 'button', className: 'h-9 px-4 rounded-md border', onClick: record(what) }, label);

/** RecordDetailView's first row (title, record_header actions), then filler. */
function RecordContent() {
  return h('div', { onClick: record('record') },
    h('div', { className: 'flex items-center justify-between gap-4 px-6 py-4 border-b' },
      h('h1', { className: 'text-xl font-semibold' }, 'Widget 42'),
      h('div', { className: 'flex items-center gap-2' }, button('Approve', 'approve'), button('Reject', 'reject')),
    ),
    h('div', { className: 'p-6' },
      ...Array.from({ length: 16 }, (_, i) => h('p', { key: i, className: 'py-2' }, 'Field ' + i)),
    ),
  );
}

function Harness() {
  const [open, setOpen] = React.useState(false);
  openOverlay = () => setOpen(true);
  return h(ThemeProvider, null,
    h('main', { className: 'p-6', onClick: record('page') }, button('New', 'new')),
    h(NavigationOverlay, {
      mode: window.__overlayMode,
      isOverlay: true,
      isOpen: open,
      selectedRecord: open ? { id: 'widget-42' } : null,
      close: () => { log.push('drawer:close'); setOpen(false); },
      setIsOpen: (next) => { if (!next) log.push('drawer:close'); setOpen(next); },
      width: window.__drawerWidth,
      title: 'Product',
      onExpand: record('expand'),
      expandLabel: 'Open as full page',
      children: () => h(RecordContent),
    }),
    h(ConsoleToaster),
  );
}

window.__harness = {
  log,
  open: () => openOverlay(),
  raise: (title) => toast.success(title, { action: { label: 'Undo', onClick: record('undo:' + title) } }),
};
createRoot(document.getElementById('root')).render(h(Harness));
`,
  };
  return {
    name: 'toast-under-modal-fixtures',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (id === '@object-ui/i18n') return STUB_I18N;
      if (id === '@object-ui/react') return STUB_REACT;
      if (id === 'toast-under-modal:entry') return ENTRY;
      // The entry's bare imports resolve exactly as `ConsoleToaster`'s own do,
      // so `toast` and the toaster share one sonner module: its queue is
      // module state, and a second copy would raise toasts nobody renders.
      if (importer === ENTRY && !path.isAbsolute(id)) {
        return this.resolve(id, CONSOLE_TOASTER, { skipSelf: true });
      }
      return null;
    },
    load: (id) => modules[id] ?? null,
  };
}

/** Bundle the entry once, from source, into one classic script. */
async function bundle(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-toast-under-modal'),
    logLevel: 'error',
    publicDir: false,
    plugins: [fixtures()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      outDir: path.join(os.tmpdir(), 'objectui-toast-under-modal-out'),
      emptyOutDir: false,
      minify: false,
      modulePreload: false,
      // Not `lib`: lib mode resolves its entry as a file path, before any
      // plugin can answer for a virtual id.
      rollupOptions: {
        input: 'toast-under-modal:entry',
        output: { format: 'iife', inlineDynamicImports: true },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunks = outputs.flatMap((o) => o.output).filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`expected one bundled chunk, got ${chunks.length}`);
  return chunks[0].code;
}

async function tailwind(): Promise<string> {
  const twEntry = fileURLToPath(import.meta.resolve('tailwindcss/index.css'));
  const compiler = await compile('@import "tailwindcss";', {
    base: path.dirname(twEntry),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? twEntry : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
  });
  // Candidates are every token in the sources, the way Tailwind's own scanner
  // reads them; tokens that are not classes compile to nothing.
  const tokens = [...STYLED_SOURCES.map((f) => readFileSync(f, 'utf8')), HARNESS_CLASSES]
    .flatMap((text) => text.split(/[\s'"`]+/))
    .filter(Boolean);
  const css = compiler.build(tokens);
  // A stylesheet missing the drawer's own layout would measure an unpositioned
  // tree, and the toaster could then pass for the wrong reason.
  for (const needle of ['.fixed', '.inset-y-0', '.right-0', '.z-50', '--ov-w']) {
    if (!css.includes(needle)) throw new Error(`Tailwind emitted no rule for ${needle}; the drawer would be unstyled.`);
  }
  return css;
}

/** Never resolved by DNS: every request to it is answered by `page.route`. */
const HARNESS_ORIGIN = 'http://toast-under-modal.test';

let script = '';
let css = '';

test.beforeAll(async () => {
  [script, css] = await Promise.all([bundle(), tailwind()]);
});

interface Configuration {
  name: string;
  viewport: { width: number; height: number };
  /** `NavigationOverlay`'s mode: the record drawer, or the centred record dialog. */
  mode: 'drawer' | 'modal';
  /** What `ObjectView` passes: `overlayWidthFor(...)`, `min(92vw, BUCKET px)`. */
  drawerWidth: string;
  /**
   * Where objectui#11685 puts the toaster for this window and overlay: beside
   * the drawer, below its header, or (no right-edge drawer) its no-drawer
   * anchor, top-centre below the top bar (objectui#13340). For a centred
   * dialog that puts the toast over the dialog's own title row, so the
   * hit-test assertions below are what show it is still the click target.
   * Read back off the toaster in every test, so a configuration that stopped
   * exercising its path fails instead of silently testing another one.
   */
  path: 'beside' | 'below header' | 'top centre';
}

const CONFIGURATIONS: Configuration[] = [
  { name: '1440 sm drawer', viewport: { width: 1440, height: 900 }, mode: 'drawer', drawerWidth: 'min(92vw, 480px)', path: 'beside' },
  { name: '1024 md drawer', viewport: { width: 1024, height: 768 }, mode: 'drawer', drawerWidth: 'min(92vw, 720px)', path: 'below header' },
  { name: '390 phone drawer', viewport: { width: 390, height: 844 }, mode: 'drawer', drawerWidth: 'min(92vw, 480px)', path: 'below header' },
  { name: '1440 centred dialog', viewport: { width: 1440, height: 900 }, mode: 'modal', drawerWidth: 'min(92vw, 720px)', path: 'top centre' },
];
const BELOW_HEADER = CONFIGURATIONS[1];

interface Point {
  x: number;
  y: number;
}

async function openOverlay(page: Page, configuration: Configuration) {
  // A harness that never comes up must say why, not run into the test timeout.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const ready = async (what: string, wait: Promise<unknown>) => {
    try {
      await wait;
    } catch (cause) {
      throw new Error(`the harness did not reach "${what}"; page errors: ${JSON.stringify(errors)}`, { cause });
    }
  };
  await page.setViewportSize(configuration.viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A real origin, answered by the route below and never by the network:
  // `ThemeProvider` reads `localStorage`, which an `about:blank` document
  // (what `setContent` gives) is denied.
  await page.route(`${HARNESS_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/harness.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    return route.fulfill({
      contentType: 'text/html',
      body:
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>` +
        `<script>window.__drawerWidth = ${JSON.stringify(configuration.drawerWidth)};` +
        `window.__overlayMode = ${JSON.stringify(configuration.mode)};</script></head>` +
        `<body><div id="root"></div><script src="/harness.js"></script></body></html>`,
    });
  });
  await page.goto(`${HARNESS_ORIGIN}/`);
  await ready('mounted', page.waitForFunction(() => '__harness' in window, null, { timeout: 10_000 }));
  await page.evaluate(() => (window as unknown as { __harness: { open(): void } }).__harness.open());
  await ready('overlay open', page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 10_000 }));
}

const log = (page: Page) => page.evaluate(() => [...(window as unknown as { __harness: { log: string[] } }).__harness.log]);

const overlayIsOpen = (page: Page) =>
  page.evaluate(() => document.querySelector('[role="dialog"][data-state="open"]') !== null);

const toastShowing = (page: Page, title: string) =>
  page.evaluate(
    (t) => [...document.querySelectorAll('[data-sonner-toast]')].some((li) => li.textContent?.includes(t)),
    title,
  );

/**
 * Which path the toaster took, read off its anchor and the offsets it was
 * given. No drawer to clear: top-centre at 56px, below the 48px top bar
 * (objectui#13340). A right-edge drawer: top-right, then beside the drawer or
 * below its header (objectui#11685). Anything else is named, not folded in.
 */
const pathOf = (page: Page) =>
  page.evaluate(() => {
    const toaster = document.querySelector<HTMLElement>('[data-sonner-toaster]');
    if (!toaster) return 'no toaster';
    const anchor = `${toaster.getAttribute('data-y-position')}-${toaster.getAttribute('data-x-position')}`;
    const top = toaster.style.getPropertyValue('--offset-top');
    const right = toaster.style.getPropertyValue('--offset-right');
    if (anchor === 'top-center') return top === '56px' ? 'top centre' : `top centre at ${top}`;
    if (anchor !== 'top-right') return `anchored ${anchor}`;
    if (right !== '24px') return 'beside';
    if (top !== '24px') return 'below header';
    return 'top-right at the default offsets';
  });

interface ToastReading {
  box: { left: number; top: number; right: number; bottom: number };
  action: Point;
  close: Point;
  /** A point on the toast's title text, clear of both buttons. */
  body: Point;
}

/** Raise a toast and read it once it is at rest. */
async function raise(page: Page, title: string): Promise<ToastReading> {
  await page.evaluate((t) => (window as unknown as { __harness: { raise(t: string): void } }).__harness.raise(t), title);
  return page.waitForFunction(
    (t) => {
      const li = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast][data-mounted="true"]')].find((el) =>
        el.textContent?.includes(t),
      );
      if (!li) return null;
      const r = li.getBoundingClientRect();
      const w = window as unknown as { __rest?: string; __restFrames?: number };
      const key = `${t}:${r.left},${r.top},${r.width},${r.height}`;
      w.__restFrames = w.__rest === key ? (w.__restFrames ?? 0) + 1 : 0;
      w.__rest = key;
      // Unmoved over three frames: the drawer clearance and the stack have settled.
      if (w.__restFrames < 3) return null;
      const centre = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      };
      const action = li.querySelector('[data-action]');
      const close = li.querySelector('[data-close-button]');
      const titleEl = li.querySelector('[data-title]');
      if (!action || !close || !titleEl) return null;
      const tb = titleEl.getBoundingClientRect();
      return {
        box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        action: centre(action),
        close: centre(close),
        body: { x: tb.left + Math.min(12, tb.width / 2), y: tb.top + tb.height / 2 },
      };
    },
    title,
    { polling: 'raf', timeout: 10_000 },
  ).then((handle) => handle.jsonValue() as Promise<ToastReading>);
}

/** What the real hit test returns at a point: the topmost element, then the stack. */
const hitAt = (page: Page, point: Point) =>
  page.evaluate(({ x, y }) => {
    const describe = (el: Element | null) => {
      if (!el) return 'nothing';
      if (el.closest('[data-action]')) return 'toast action';
      if (el.closest('[data-close-button]')) return 'toast close';
      if (el.closest('[data-sonner-toast]')) return 'toast';
      if (el.closest('[role="dialog"]')) return 'modal';
      if (el.matches('[data-state][class*="bg-black"]')) return 'overlay';
      return el.tagName.toLowerCase();
    };
    const stack = document.elementsFromPoint(x, y);
    return { top: describe(stack[0] ?? null), beneath: stack.slice(1).map(describe) };
  }, point);

/** The modal's own surfaces: what a click falling through a toast reaches. */
const isModalSurface = (what: string) => what === 'overlay' || what === 'modal';

test.describe('toast actions under an open Radix modal (objectui#11723)', () => {
  for (const configuration of CONFIGURATIONS) {
    test(`${configuration.name}: Undo is the click target, runs, and leaves the modal open`, async ({ page }) => {
      await openOverlay(page, configuration);
      const reading = await raise(page, 'Approved');
      expect(await pathOf(page), 'the objectui#11685 path this configuration exercises').toBe(configuration.path);

      const hit = await hitAt(page, reading.action);
      expect(hit.top, 'the hit test at the Undo button').toBe('toast action');
      // Non-vacuity: the toast sits over something a stray click would reach.
      expect(hit.beneath.some(isModalSurface), `beneath Undo: ${hit.beneath}`).toBe(true);

      await page.mouse.click(reading.action.x, reading.action.y);
      await expect.poll(() => log(page)).toEqual(['undo:Approved']);
      expect(await overlayIsOpen(page), 'the modal stays open').toBe(true);
      await expect.poll(() => toastShowing(page, 'Approved')).toBe(false);
    });

    test(`${configuration.name}: the close button dismisses the toast, and only the toast`, async ({ page }) => {
      await openOverlay(page, configuration);
      const reading = await raise(page, 'Saved');
      expect(await pathOf(page)).toBe(configuration.path);

      expect((await hitAt(page, reading.close)).top, 'the hit test at the close button').toBe('toast close');
      await page.mouse.click(reading.close.x, reading.close.y);
      await expect.poll(() => toastShowing(page, 'Saved')).toBe(false);
      expect(await log(page)).toEqual([]);
      expect(await overlayIsOpen(page)).toBe(true);
    });

    test(`${configuration.name}: a click on the toast reaches nothing under it`, async ({ page }) => {
      await openOverlay(page, configuration);
      const reading = await raise(page, 'Updated');
      expect(await pathOf(page)).toBe(configuration.path);

      const hit = await hitAt(page, reading.body);
      expect(hit.top, 'the hit test on the toast body').toBe('toast');
      expect(hit.beneath.some(isModalSurface), `beneath the toast: ${hit.beneath}`).toBe(true);

      await page.mouse.click(reading.body.x, reading.body.y);
      // Give a fall-through click every chance to land before reading the log.
      await page.waitForTimeout(250);
      expect(await log(page)).toEqual([]);
      expect(await overlayIsOpen(page)).toBe(true);
      expect(await toastShowing(page, 'Updated')).toBe(true);
    });
  }

  test(`${BELOW_HEADER.name}: the dismiss timer pauses only while the pointer is on the toast, not beside it (objectui#7482)`, async ({
    page,
  }) => {
    // objectui#7482: sonner pauses dismissal while the pointer is inside the
    // toaster, so a toaster over a control the pointer rests on stays up for
    // good. Only the toast takes the pointer now, not the toaster around it.
    // The below-header path is the one where a toast covers the record's own
    // first row, so it is the path where that matters.
    await openOverlay(page, BELOW_HEADER);

    // The control: on the toast, the pause is real and observable here, so the
    // second half's dismissal is not just a timer that never pauses.
    const held = await raise(page, 'Held');
    expect(await pathOf(page)).toBe(BELOW_HEADER.path);
    await page.mouse.move(held.body.x, held.body.y);
    await page.waitForTimeout(5_000);
    expect(await toastShowing(page, 'Held'), 'past its 4s while the pointer is on it').toBe(true);

    // Beside the toast, over the record's first row: the timer runs.
    const beside = { x: held.box.left - 8, y: (held.box.top + held.box.bottom) / 2 };
    expect((await hitAt(page, beside)).top, 'the point beside the toast').toBe('modal');
    await page.mouse.move(beside.x, beside.y);
    // Sonner's 4s default (objectui#7482 pins it), plus its unmount delay.
    await expect.poll(() => toastShowing(page, 'Held'), { timeout: 6_000 }).toBe(false);
    expect(await log(page)).toEqual([]);
  });
});
