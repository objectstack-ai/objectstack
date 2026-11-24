import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { build, type Plugin, type Rollup } from 'vite';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for the section navigation of a grouped record dialog
 * (objectstack#35092): a click on a section whose heading the form's scroller
 * cannot bring to its top — the last, short section — scrolls the form's
 * scroller and nothing else. The dialog box keeps `scrollTop` 0, so its title,
 * the navigation and the footer stay where they were.
 *
 * ## The defect, two causes, one symptom
 *
 * 1. The jump was an element `scrollIntoView`, which scrolls every scrollable
 *    ancestor, an `overflow: hidden` box included.
 * 2. The dialog box (`overflow: hidden`) could be scrolled at all: the
 *    absolutely positioned hidden inputs in the form — a Radix checkbox's
 *    native stand-in, a Radix select's hidden `select` — took the fixed dialog
 *    as their containing block, escaped the form's scroller and overflowed
 *    the dialog box.
 *
 * With both, the remainder of a jump the form's scroller could not absorb went
 * to the dialog box. The fix removes both (the jump scrolls the heading's own
 * scroller; the scroller is `relative`), and the matrix below holds each one
 * alone, plus the defect itself, so a green run cannot be a fixture that
 * never reproduced it.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * jsdom and happy-dom do no layout and no scrolling: a `scrollTop` there is
 * whatever the test set. The layout-free half (which element the jump asks to
 * scroll, and how far) is pinned beside the component in
 * `packages/plugin-form/src/FormSectionNav.test.tsx`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL, built from source at run time and running in the page:
 * `FormSectionNav` (its jump, its scroll spy, its click hold) and React. The
 * class strings, read out of the sources at run time: the dialog content's
 * position and height classes (`mobile-dialog-content.tsx`, `ModalForm.tsx`),
 * the form scroller's class (`ModalForm.tsx`) and the section heading's class
 * (`form.tsx`). The stylesheet is real Tailwind compiled from the installed
 * `tailwindcss` for those classes.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - `@object-ui/i18n` is a stub returning the English defaults, and
 *     `@object-ui/components` a stub exporting `cn` as a plain class join
 *     (no `tailwind-merge`); the navigation's classes do not conflict.
 *   - The dialog's tree is transcribed from `ModalForm`: header, navigation,
 *     scroller, footer. Fields are fixed-height stand-ins. The last section's
 *     two checkboxes each carry the hidden input a Radix checkbox mounts
 *     (`position: absolute; opacity: 0; transform: translateX(-100%)`), and
 *     collapsed sections mount their fields only when unfolded, as the form
 *     does.
 *   - The OLD jump (an element `scrollIntoView` on the heading, a frame after
 *     unfolding) is reproduced by the harness for the defect leg; it is the
 *     call this card removed, not code still in the tree. The harness flushes
 *     the unfold (`flushSync`), as a click on the real navigation does by
 *     unfolding inside a React event, and each leg that runs it asserts its
 *     frame found the last section's hidden inputs mounted.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const FORM_SECTION_NAV = source('packages/plugin-form/src/FormSectionNav.tsx');
const MODAL_FORM = source('packages/plugin-form/src/ModalForm.tsx');
const DIALOG_CONTENT = source('packages/components/src/custom/mobile-dialog-content.tsx');
const FORM = source('packages/components/src/renderers/form/form.tsx');

/** One string out of a source file, asserting tokens so a drifted match throws. */
function grab(file: string, re: RegExp, mustContain: string[]): string {
  const m = readFileSync(file, 'utf8').match(re);
  if (!m) throw new Error(`${path.relative(REPO_ROOT, file)}: nothing matched ${re}`);
  const cls = m[1];
  for (const token of mustContain) {
    if (!cls.split(/\s+/).includes(token)) {
      throw new Error(
        `${path.relative(REPO_ROOT, file)}: ${re} matched "${cls}", which does not carry "${token}" — the ` +
          'extraction walked onto the wrong string, so this measurement would be meaningless.',
      );
    }
  }
  return cls;
}

const CLS = {
  /** MobileDialogContent's own layout: full screen on a phone, centred from `sm`. */
  dialogBase: [
    grab(DIALOG_CONTENT, /'(fixed inset-0 [^']+)'/, ['fixed', 'inset-0']),
    grab(DIALOG_CONTENT, /'(h-\[100dvh\])'/, ['h-[100dvh]']),
    grab(DIALOG_CONTENT, /'(sm:inset-auto [^']+)'/, ['sm:top-[50%]', 'sm:translate-y-[-50%]']),
    grab(DIALOG_CONTENT, /'(sm:max-w-lg [^']+)'/, ['sm:max-h-[90vh]']),
  ].join(' '),
  /** What ModalForm adds to it: a column, clipped, unpadded, capped at 90vh. */
  dialogModal: grab(MODAL_FORM, /cn\(sizeClass, '([^']+)', heightClass/, ['flex', 'flex-col', 'overflow-hidden']),
  dialogHeight: grab(MODAL_FORM, /:\s*'(h-\[100dvh\] sm:h-auto sm:max-h-\[90vh\])'/, ['sm:max-h-[90vh]']),
  scroller: grab(MODAL_FORM, /<div className="(@container [^"]*overflow-y-auto[^"]*)">/, ['flex-1', 'overflow-y-auto']),
  heading: grab(FORM, /'(col-span-full pt-4 pb-1 border-b border-border[^']*)'/, ['scroll-mt-2']),
};

/** The scroller as it stood before this card: no containing block of its own. */
const SCROLLER_BEFORE = CLS.scroller.split(/\s+/).filter((c) => c !== 'relative').join(' ');

const STUB_I18N = '\0form-section-nav-35092:i18n';
const STUB_COMPONENTS = '\0form-section-nav-35092:components';
const ENTRY = '\0form-section-nav-35092:entry';

/** Classes the transcribed dialog uses besides the ones read from source. */
const HARNESS_CLASSES =
  'sm:max-w-2xl shrink-0 px-2 sm:px-4 px-6 pt-6 pb-2 text-lg font-semibold border-t py-3 flex justify-end gap-2 h-16 h-9 px-4 rounded-md border grid grid-cols-2 gap-4 relative ' +
  // The jump bar's own classes (objectstack#35472: pills, not underlined tabs).
  'flex items-center gap-1.5 overflow-x-auto border-b border-border py-2 inline-flex gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 ' +
  'text-xs border-primary/40 bg-primary/10 font-medium text-foreground text-muted-foreground h-3 w-3 opacity-60';

function fixtures(): Plugin {
  const at = (file: string) => JSON.stringify(file);
  const modules: Record<string, string> = {
    [STUB_I18N]: `
export const createSafeTranslation = (defaults) => () => ({
  t: (key, options) => {
    let text = defaults[key] ?? key;
    for (const [name, value] of Object.entries(options ?? {})) text = text.split('{{' + name + '}}').join(String(value));
    return text;
  },
});
`,
    [STUB_COMPONENTS]: `
export const cn = (...parts) => parts.flat(Infinity).filter((p) => typeof p === 'string' && p).join(' ');
`,
    [ENTRY]: `
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { FormSectionNav } from ${at(FORM_SECTION_NAV)};

const h = React.createElement;
const config = window.__config;
const CLS = config.cls;

/** Six sections, the last four folded, the last one short: two checkboxes. The two
    open ones overflow the form's scroller, as a real create form's do. */
const SECTIONS = [
  { key: 'contact', label: 'Contact', fields: 10, select: 2, collapsed: false },
  { key: 'classification', label: 'Classification', fields: 8, select: 2, collapsed: false },
  { key: 'company', label: 'Company', fields: 6, select: 1, collapsed: true },
  { key: 'address', label: 'Address', fields: 6, select: 0, collapsed: true },
  { key: 'additional', label: 'Additional', fields: 4, select: 0, collapsed: true },
  { key: 'privacy', label: 'Privacy', fields: 0, checkboxes: 2, collapsed: true },
];
const anchorOf = (key) => 'form-section-' + key;

/** The native stand-in a Radix checkbox / select mounts beside its control. */
const hiddenInput = (tag, key) =>
  h(tag, {
    key,
    'aria-hidden': 'true',
    tabIndex: -1,
    style: { position: 'absolute', pointerEvents: 'none', opacity: 0, margin: 0, transform: 'translateX(-100%)', width: 16, height: 16 },
  });

function Section({ section, collapsed, onToggle }) {
  const body = [];
  for (let i = 0; i < section.fields; i++) {
    body.push(h('div', { key: 'f' + i, className: 'h-16' },
      h('label', null, section.label + ' field ' + i),
      h('div', { className: 'h-9 px-4 rounded-md border' }),
      i < section.select ? hiddenInput('select', 's' + i) : null));
  }
  for (let i = 0; i < (section.checkboxes ?? 0); i++) {
    body.push(h('div', { key: 'c' + i, className: 'h-9' },
      h('button', { type: 'button', role: 'checkbox', 'aria-checked': 'false' }, 'Opt out ' + i),
      hiddenInput('input', 'i' + i)));
  }
  return h(React.Fragment, null,
    h('div', { id: anchorOf(section.key), 'data-form-section': section.key, className: CLS.heading, onClick: onToggle }, section.label),
    collapsed ? null : h('div', { className: 'grid grid-cols-2 gap-4' }, body));
}

function Harness() {
  const [collapsed, setCollapsed] = React.useState(() => Object.fromEntries(SECTIONS.map((s) => [s.key, s.collapsed])));
  const expand = (key) => setCollapsed((c) => ({ ...c, [key]: false }));
  window.__harness.expand = expand;
  const items = SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    anchorId: anchorOf(s.key),
    errorCount: 0,
    collapsed: collapsed[s.key],
    expand: () => expand(s.key),
  }));
  return h('div', { role: 'dialog', 'data-testid': 'dialog', className: CLS.dialog },
    h('div', { 'data-testid': 'title', className: 'shrink-0 px-6 pt-6 pb-2 text-lg font-semibold' }, 'New Lead'),
    h(FormSectionNav, { items, className: 'shrink-0 px-2 sm:px-4' }),
    h('div', { 'data-testid': 'scroller', className: CLS.scroller },
      h('form', null, SECTIONS.map((s) => h(Section, { key: s.key, section: s, collapsed: collapsed[s.key], onToggle: () => expand(s.key) })))),
    h('div', { 'data-testid': 'footer', className: 'shrink-0 border-t py-3 px-6 flex justify-end gap-2' },
      h('button', { type: 'button' }, 'Cancel'), h('button', { type: 'button' }, 'Create')));
}

window.__harness = {
  /**
   * The jump this card removed: an element scrollIntoView, a frame after
   * unfolding. The unfold is flushed here: called from outside a React event
   * the update is not flushed before the next frame, so the frame could run
   * before the section's fields (and their hidden inputs) mounted. A click on
   * the real navigation unfolds inside a React event, which flushes first.
   * \`jumpSaw\` records what the frame found, so a leg can assert the jump ran
   * against the unfolded section.
   */
  oldJump(key) {
    flushSync(() => window.__harness.expand(key));
    requestAnimationFrame(() => {
      window.__harness.jumpSaw = { hiddenInputs: document.querySelectorAll('input[aria-hidden="true"]').length };
      document.getElementById(anchorOf(key))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  },
};
createRoot(document.getElementById('root')).render(h(Harness));
`,
  };
  return {
    name: 'form-section-nav-35092-fixtures',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (id === '@object-ui/i18n') return STUB_I18N;
      if (id === '@object-ui/components') return STUB_COMPONENTS;
      if (id === 'form-section-nav-35092:entry') return ENTRY;
      // The entry's bare imports resolve as the component's own do, so both
      // share one React.
      if (importer === ENTRY && !path.isAbsolute(id)) {
        return this.resolve(id, FORM_SECTION_NAV, { skipSelf: true });
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
    cacheDir: path.join(os.tmpdir(), 'objectui-form-section-nav-35092'),
    logLevel: 'error',
    publicDir: false,
    plugins: [fixtures()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      outDir: path.join(os.tmpdir(), 'objectui-form-section-nav-35092-out'),
      emptyOutDir: false,
      minify: false,
      modulePreload: false,
      rollupOptions: {
        input: 'form-section-nav-35092:entry',
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
  const css = compiler.build(
    [...Object.values(CLS), HARNESS_CLASSES].join(' ').split(/\s+/).filter(Boolean),
  );
  // A stylesheet missing the dialog's own layout would measure an unclipped,
  // unpositioned tree, and the dialog box could not scroll for that reason.
  for (const needle of ['.fixed', '.overflow-hidden', '.overflow-y-auto', '.relative', '.flex-1', 'scroll-margin-top']) {
    if (!css.includes(needle)) throw new Error(`Tailwind emitted no rule for ${needle}; the dialog would be unstyled.`);
  }
  return css;
}

/** Never resolved by DNS: every request to it is answered by `page.route`. */
const HARNESS_ORIGIN = 'http://form-section-nav-35092.test';

let script = '';
let css = '';

test.beforeAll(async () => {
  [script, css] = await Promise.all([bundle(), tailwind()]);
});

interface Setup {
  /** The form scroller's class: as it stands, or before this card. */
  scroller: string;
  viewport: { width: number; height: number };
}

async function openDialog(page: Page, setup: Setup) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(setup.viewport);
  const config = {
    cls: { dialog: `${CLS.dialogBase} sm:max-w-2xl ${CLS.dialogModal} ${CLS.dialogHeight}`, scroller: setup.scroller, heading: CLS.heading },
  };
  await page.route(`${HARNESS_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/harness.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    return route.fulfill({
      contentType: 'text/html',
      body:
        `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{font:14px sans-serif}${css}</style>` +
        `<script>window.__config = ${JSON.stringify(config)};</script></head>` +
        `<body><div id="root"></div><script src="/harness.js"></script></body></html>`,
    });
  });
  await page.goto(`${HARNESS_ORIGIN}/`);
  try {
    await page.waitForSelector('[data-testid="form-section-nav"]', { timeout: 10_000 });
  } catch (cause) {
    throw new Error(`the harness did not mount; page errors: ${JSON.stringify(errors)}`, { cause });
  }
}

interface Reading {
  dialogScrollTop: number;
  dialogScrollHeight: number;
  dialogClientHeight: number;
  scrollerScrollTop: number;
  titleTop: number;
  navTop: number;
  footerBottom: number;
  current: string | null;
}

const read = (page: Page): Promise<Reading> =>
  page.evaluate(() => {
    const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    const dialog = el('dialog');
    const top = dialog.getBoundingClientRect().top;
    return {
      dialogScrollTop: dialog.scrollTop,
      dialogScrollHeight: dialog.scrollHeight,
      dialogClientHeight: dialog.clientHeight,
      scrollerScrollTop: el('scroller').scrollTop,
      titleTop: Math.round(el('title').getBoundingClientRect().top - top),
      navTop: Math.round(el('form-section-nav').getBoundingClientRect().top - top),
      footerBottom: Math.round(dialog.getBoundingClientRect().bottom - el('footer').getBoundingClientRect().bottom),
      current: document.querySelector('[data-testid="form-section-nav"] [aria-current="true"]')?.textContent ?? null,
    };
  });

type OldJumpHarness = { __harness: { oldJump(k: string): void; jumpSaw?: { hiddenInputs: number } } };

/** Run the old jump to the last section, and assert its frame found that section's two hidden inputs mounted. */
async function oldJumpToPrivacy(page: Page) {
  await page.evaluate(() => (window as unknown as OldJumpHarness).__harness.oldJump('privacy'));
  await page.waitForFunction(() => (window as unknown as OldJumpHarness).__harness.jumpSaw !== undefined);
  const saw = await page.evaluate(() => (window as unknown as OldJumpHarness).__harness.jumpSaw);
  expect(saw, 'the old jump ran before the last section unfolded').toEqual({ hiddenInputs: 2 });
}

/** Wait for every smooth scroll in the dialog to come to rest, and the click hold to end. */
async function settle(page: Page) {
  await page.waitForTimeout(900);
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
        const at = () => `${el('dialog').scrollTop}/${el('scroller').scrollTop}`;
        const before = at();
        setTimeout(() => resolve(at() === before), 150);
      }),
    null,
    { timeout: 5_000 },
  );
}

const SECTION_LABELS = ['Contact', 'Classification', 'Company', 'Address', 'Additional', 'Privacy'];
const DESKTOP = { width: 1280, height: 844 };
/** The CSS viewport of the same window zoomed in. */
const ZOOMED = { width: 1024, height: 620 };

test.describe('grouped record dialog: a section jump scrolls only the form (objectstack#35092)', () => {
  test('the defect this pins: the old jump without a positioned scroller scrolls the dialog box off its title', async ({ page }) => {
    await openDialog(page, { scroller: SCROLLER_BEFORE, viewport: DESKTOP });
    const before = await read(page);
    expect(before.dialogScrollTop).toBe(0);

    await oldJumpToPrivacy(page);
    await settle(page);
    const after = await read(page);

    expect(after.dialogScrollHeight, 'the hidden inputs did not overflow the dialog box').toBeGreaterThan(after.dialogClientHeight);
    expect(after.dialogScrollTop, 'the dialog box was not scrolled').toBeGreaterThan(0);
    expect(after.titleTop, 'the title stayed in place').toBeLessThan(before.titleTop);
  });

  for (const [label, viewport] of [
    ['at a desktop viewport', DESKTOP],
    ['zoomed in', ZOOMED],
  ] as const) {
    test(`${label}, every entry in turn: title, navigation and footer stay put, the dialog box never scrolls`, async ({ page }) => {
      await openDialog(page, { scroller: CLS.scroller, viewport });
      const before = await read(page);
      expect(before.dialogScrollTop).toBe(0);
      for (const name of SECTION_LABELS) {
        await page.getByTestId('form-section-nav').getByRole('button', { name, exact: true }).click();
        await settle(page);
        const r = await read(page);
        expect(r.dialogScrollTop, `${name}: the dialog box scrolled`).toBe(0);
        expect(r.dialogScrollHeight, `${name}: something overflows the dialog box`).toBe(r.dialogClientHeight);
        expect(r.titleTop, `${name}: the title moved`).toBe(before.titleTop);
        expect(r.navTop, `${name}: the navigation moved`).toBe(before.navTop);
        expect(r.footerBottom, `${name}: the footer moved`).toBe(before.footerBottom);
        expect(r.current, `${name}: the highlight is elsewhere`).toBe(name);
      }
    });
  }

  test('the last, short section alone: the form scroller ends at its bottom, the highlight on that section', async ({ page }) => {
    await openDialog(page, { scroller: CLS.scroller, viewport: DESKTOP });
    const before = await read(page);
    await page.getByTestId('form-section-nav').getByRole('button', { name: 'Privacy', exact: true }).click();
    await settle(page);
    const r = await read(page);
    expect(r.scrollerScrollTop, 'the form scroller did not move').toBeGreaterThan(0);
    expect(r.dialogScrollTop).toBe(0);
    expect(r.titleTop).toBe(before.titleTop);
    expect(r.footerBottom).toBe(before.footerBottom);
    expect(r.current).toBe('Privacy');
  });

  test('either half alone is enough: the new jump without the positioned scroller leaves the dialog box at 0', async ({ page }) => {
    await openDialog(page, { scroller: SCROLLER_BEFORE, viewport: DESKTOP });
    const before = await read(page);
    await page.getByTestId('form-section-nav').getByRole('button', { name: 'Privacy', exact: true }).click();
    await settle(page);
    const r = await read(page);
    // The hidden inputs still overflow the dialog box here; nothing scrolls it.
    expect(r.dialogScrollHeight).toBeGreaterThan(r.dialogClientHeight);
    expect(r.dialogScrollTop).toBe(0);
    expect(r.titleTop).toBe(before.titleTop);
  });

  test('either half alone is enough: the positioned scroller leaves the old jump nothing to scroll in the dialog box', async ({ page }) => {
    await openDialog(page, { scroller: CLS.scroller, viewport: DESKTOP });
    const before = await read(page);
    await oldJumpToPrivacy(page);
    await settle(page);
    const r = await read(page);
    expect(r.dialogScrollHeight).toBe(r.dialogClientHeight);
    expect(r.dialogScrollTop).toBe(0);
    expect(r.titleTop).toBe(before.titleTop);
  });
});
