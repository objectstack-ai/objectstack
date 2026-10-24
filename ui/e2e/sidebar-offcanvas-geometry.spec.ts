import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { createServer, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * GEOMETRY pin for objectui#11464: the shadcn sidebar's `offcanvas` form drew
 * its EXPANDED panel outside the viewport.
 *
 * ## The defect
 *
 * shadcn's `Sidebar` blanks `data-collapsible` while the sidebar is expanded,
 * so its `group-data-[collapsible=offcanvas]:` rules (the gap's `w-0`, the
 * panel's negative `left` / `right`, the rail's collapsed-edge styling) can only
 * ever match a collapsed sidebar. objectui's copy keeps the attribute in every
 * state, the systematic local edit (3) recorded in
 * `packages/components/shadcn-components.json`, and qualified the `icon` rules
 * with `group-data-[state=collapsed]:` to match. The offcanvas rules were left
 * unqualified, so they matched the expanded state too: an expanded offcanvas
 * panel was pushed one sidebar-width off the edge it is anchored to. The
 * qualifiers are now a declared patch family in
 * `scripts/shadcn-local-patches.mjs`.
 *
 * Reached by the SDUI `sidebar` node with `collapsible` omitted or `true`
 * (shadcn's `offcanvas` default, kept by objectui#10859), and by
 * `@object-ui/layout`'s `SidebarNav` with `collapsible="offcanvas"`.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * jsdom and happy-dom have no layout engine, so every rect there is 0x0, and a
 * class-shape assertion cannot tell a rule that positions the panel from one
 * that is shadowed by another. This file reads positions in Chromium, the same
 * reason `e2e/record-header-title-width.spec.ts` gives for itself.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: the markup. Vite server-renders the actual components from their source
 * files: the shadcn primitive (`packages/components/src/ui/sidebar.tsx`, with its
 * real `cn()` / tailwind-merge and its real `data-*` attributes), the SDUI
 * `sidebar` node's renderer, and `SidebarNav`. The stylesheet is real Tailwind,
 * compiled from the installed `tailwindcss` for exactly the classes that markup
 * carries. Revert a qualifier in `sidebar.tsx` and the markup measured here
 * changes with it.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - `@object-ui/core` is a stub that only records each `register()` call, so
 *     the `sidebar` node's component is taken from its real registration and
 *     rendered with the props `SchemaRenderer` gives a `{ type: 'sidebar' }`
 *     node: `schema` and nothing else. That the real `SchemaRenderer` maps an
 *     omitted `collapsible` to shadcn's `offcanvas` is pinned through the real
 *     renderer by
 *     `packages/components/src/renderers/__tests__/sidebar-node-provider-10859.test.tsx`;
 *     this file pins where that form is drawn.
 *   - `@object-ui/react` and `@object-ui/i18n` are stubs. Neither is on the
 *     geometry path: `SchemaRenderer` is reached only through the node's child
 *     list, which is empty here, and the i18n runtime only through the mobile
 *     `Sheet`'s close label.
 *   - `@object-ui/components`, as `SidebarNav` imports it, re-exports the same
 *     primitive source files the package barrel re-exports (`export * from
 *     './ui'`).
 *
 * The workspace packages are stubbed rather than resolved because this lane
 * builds no workspace `dist/`, and their `exports` point there.
 *
 * Static markup carries no client effects, so `useIsMobile()` reads desktop and
 * the mobile `Sheet` branch is out of scope: this patch does not touch it, and
 * below `md` the desktop form is `hidden` anyway.
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

const SIDEBAR_PRIMITIVE = source('packages/components/src/ui/sidebar.tsx');
const SIDEBAR_NODE = source('packages/components/src/renderers/navigation/sidebar.tsx');
const SIDEBAR_NAV = source('packages/layout/src/SidebarNav.tsx');
const UI = (name: string) => source(`packages/components/src/ui/${name}.tsx`);

/** The reproducing viewport from objectui#11464. */
const VIEWPORT = { width: 1280, height: 800 };
/** `SIDEBAR_WIDTH` and `SIDEBAR_WIDTH_ICON` in the primitive, in px. */
const SIDEBAR_PX = 256;
const ICON_PX = 48;

const STUB_CORE = '\0sidebar-geometry:core';
const STUB_REACT = '\0sidebar-geometry:react';
const STUB_I18N = '\0sidebar-geometry:i18n';
const STUB_COMPONENTS = '\0sidebar-geometry:components';
const ENTRY = '\0sidebar-geometry:entry';

/** The stubs and the entry described in the header, as one Vite plugin. */
function fixtures(): Plugin {
  const ids: Record<string, string> = {
    '@object-ui/core': STUB_CORE,
    '@object-ui/react': STUB_REACT,
    '@object-ui/i18n': STUB_I18N,
    '@object-ui/components': STUB_COMPONENTS,
    // The entry reads the registry stub under its own name, so this file holds
    // no import statement naming a workspace package (the premise
    // `scripts/__tests__/e2e-type-check.test.ts` pins for `e2e/`).
    'sidebar-geometry:core': STUB_CORE,
    'sidebar-geometry:entry': ENTRY,
  };
  const at = (file: string) => JSON.stringify(file);
  const modules: Record<string, string> = {
    [STUB_CORE]:
      'export const registered = new Map();\n' +
      'export const ComponentRegistry = { register(type, component) { registered.set(type, component); } };\n',
    [STUB_REACT]: 'export const SchemaRenderer = () => null;\n',
    [STUB_I18N]: 'export const createSafeTranslation = () => () => (key) => key;\n',
    [STUB_COMPONENTS]:
      `export * from ${at(SIDEBAR_PRIMITIVE)};\n` +
      `export * from ${at(UI('badge'))};\n` +
      `export * from ${at(UI('input'))};\n` +
      `export * from ${at(UI('collapsible'))};\n`,
    [ENTRY]: `
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider, Sidebar, SidebarRail, SidebarInset } from ${at(SIDEBAR_PRIMITIVE)};
import ${at(SIDEBAR_NODE)};
import { registered } from 'sidebar-geometry:core';
import { SidebarNav } from ${at(SIDEBAR_NAV)};

const h = React.createElement;
const page = () => h(SidebarInset, null, h('div', { 'data-probe': 'page' }, 'Page'));

export function primitive({ collapsible, open, side }) {
  const sidebar = h(Sidebar, { collapsible, side }, h(SidebarRail), h('div', null, 'Navigation'));
  // shadcn's documented order: the sidebar on the side it is anchored to.
  const row = side === 'right' ? [page(), sidebar] : [sidebar, page()];
  return renderToStaticMarkup(h(SidebarProvider, { defaultOpen: open }, ...row));
}

export function node() {
  const SidebarNode = registered.get('sidebar');
  if (!SidebarNode) throw new Error('the sidebar renderer registered nothing under "sidebar"');
  return renderToStaticMarkup(h(SidebarNode, { schema: { type: 'sidebar' } }));
}

export function sidebarNav({ open }) {
  const items = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Settings', href: '/settings' },
  ];
  return renderToStaticMarkup(
    h(MemoryRouter, null,
      h(SidebarProvider, { defaultOpen: open }, h(SidebarNav, { items, collapsible: 'offcanvas' }), page())),
  );
}
`,
  };
  return {
    name: 'sidebar-geometry-fixtures',
    enforce: 'pre',
    resolveId: (id) => ids[id] ?? null,
    load: (id) => modules[id] ?? null,
  };
}

type Collapsible = 'offcanvas' | 'icon';
type Side = 'left' | 'right';

interface Markup {
  primitive: Record<`${Collapsible}-${Side}-${'expanded' | 'collapsed'}`, string>;
  node: string;
  sidebarNav: Record<'expanded' | 'collapsed', string>;
}

/** Server-render every case once, from source, then shut Vite down. */
async function renderMarkup(): Promise<Markup> {
  const server = await createServer({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-sidebar-offcanvas-geometry'),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [fixtures()],
  });
  try {
    const entry = await server.ssrLoadModule('sidebar-geometry:entry');
    const primitive = {} as Markup['primitive'];
    for (const collapsible of ['offcanvas', 'icon'] as const) {
      for (const side of ['left', 'right'] as const) {
        for (const state of ['expanded', 'collapsed'] as const) {
          primitive[`${collapsible}-${side}-${state}`] = entry.primitive({
            collapsible,
            side,
            open: state === 'expanded',
          });
        }
      }
    }
    return {
      primitive,
      node: entry.node(),
      sidebarNav: {
        expanded: entry.sidebarNav({ open: true }),
        collapsed: entry.sidebarNav({ open: false }),
      },
    };
  } finally {
    await server.close();
  }
}

/** Undo the attribute escaping `renderToStaticMarkup` applies. */
const unescapeAttr = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Every class token the markup carries: the Tailwind candidates to compile. */
const candidatesOf = (markup: string) =>
  [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => unescapeAttr(m[1]).split(/\s+/)).filter(Boolean);

async function tailwindFor(candidates: string[]): Promise<string> {
  const twEntry = fileURLToPath(import.meta.resolve('tailwindcss/index.css'));
  const compiler = await compile('@import "tailwindcss";', {
    base: path.dirname(twEntry),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? twEntry : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
  });
  const css = compiler.build(candidates);
  // A stylesheet missing the very rules under test would measure an unstyled
  // tree and could pass for the wrong reason.
  for (const needle of ['data-collapsible', 'data-state', '--sidebar-width']) {
    if (!css.includes(needle)) {
      throw new Error(`Tailwind emitted no rule mentioning ${needle}; the sidebar would be unstyled.`);
    }
  }
  return css;
}

interface Box {
  left: number;
  right: number;
  width: number;
}

interface Reading {
  state: string | null;
  collapsible: string | null;
  /** The viewport-fixed container that carries the panel. */
  panel: Box;
  /** The in-flow spacer that reserves the panel's width beside the page. */
  gapWidth: number;
  /** `SidebarInset`, the page content, when the case renders one. */
  page: Box | null;
  /** `SidebarRail`, when the case renders one. */
  rail: null | {
    box: Box;
    translate: string;
    cssLeft: string;
    cssRight: string;
    afterLeft: string;
  };
}

async function measure(page: Page, markup: string, css: string): Promise<Reading> {
  await page.setViewportSize(VIEWPORT);
  // One document, the stylesheet ahead of the markup, so the first style
  // resolution is the styled one and no `transition-*` utility animates a
  // change while the reading is taken.
  await page.setContent(`<style>${css}</style>${markup}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('[data-sidebar="sidebar"]')?.parentElement;
      if (!panel) return false;
      const left = panel.getBoundingClientRect().left;
      const w = window as unknown as { __left?: number };
      const prev = w.__left;
      w.__left = left;
      return prev !== undefined && Math.abs(prev - left) < 0.01;
    },
    null,
    { polling: 'raf', timeout: 10_000 },
  );
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: round(r.left), right: round(r.right), width: round(r.width) };
    };
    const root = document.querySelector('.group.peer');
    const panel = document.querySelector('[data-sidebar="sidebar"]')?.parentElement;
    if (!root || !panel || !root.firstElementChild) {
      throw new Error('the desktop sidebar did not render: no `.group.peer` root or no panel');
    }
    const inset = document.querySelector('[data-probe="page"]')?.closest('main') ?? null;
    const rail = document.querySelector('[data-sidebar="rail"]');
    const railStyle = rail ? getComputedStyle(rail) : null;
    return {
      state: root.getAttribute('data-state'),
      collapsible: root.getAttribute('data-collapsible'),
      panel: box(panel),
      gapWidth: round(root.firstElementChild.getBoundingClientRect().width),
      page: inset ? box(inset) : null,
      rail:
        rail && railStyle
          ? {
              box: box(rail),
              translate: railStyle.translate,
              cssLeft: railStyle.left,
              cssRight: railStyle.right,
              afterLeft: getComputedStyle(rail, '::after').left,
            }
          : null,
    };
  });
}

let markup: Markup;
let css = '';

test.beforeAll(async () => {
  // Vite's first server-render of the module graph is the slow part (seconds,
  // not milliseconds); it happens once per worker.
  test.setTimeout(120_000);
  markup = await renderMarkup();
  css = await tailwindFor([
    ...Object.values(markup.primitive).flatMap(candidatesOf),
    ...candidatesOf(markup.node),
    ...Object.values(markup.sidebarNav).flatMap(candidatesOf),
  ]);
});

const inViewport = { left: 0, right: VIEWPORT.width };

test.describe('the sidebar offcanvas form in Chromium (objectui#11464)', () => {
  test('an expanded offcanvas sidebar sits inside the viewport, on either side', async ({ page }) => {
    const left = await measure(page, markup.primitive['offcanvas-left-expanded'], css);
    const right = await measure(page, markup.primitive['offcanvas-right-expanded'], css);

    // The attribute edit (3) keeps in every state: this IS the configuration
    // the defect needed, not a sidebar that lost its offcanvas mode.
    expect([left.state, left.collapsible]).toEqual(['expanded', 'offcanvas']);
    expect([right.state, right.collapsible]).toEqual(['expanded', 'offcanvas']);

    // Both sides in one comparison, so a failure reports both readings.
    expect(
      { left: left.panel, right: right.panel },
      'an expanded panel was drawn one sidebar-width off the edge it is anchored to',
    ).toEqual({
      left: { left: inViewport.left, right: SIDEBAR_PX, width: SIDEBAR_PX },
      right: { left: inViewport.right - SIDEBAR_PX, right: inViewport.right, width: SIDEBAR_PX },
    });
  });

  test('an expanded offcanvas sidebar draws exactly as an expanded icon sidebar does', async ({ page }) => {
    // Upstream blanks `data-collapsible` while expanded, so there the two modes
    // cannot differ until the sidebar collapses. With the attribute kept, every
    // offcanvas rule has to be qualified by the collapsed state for that to
    // hold: the gap (the page's left edge), the panel, and the rail's offset,
    // translate and hover line are each read here.
    for (const side of ['left', 'right'] as const) {
      const offcanvas = await measure(page, markup.primitive[`offcanvas-${side}-expanded`], css);
      const icon = await measure(page, markup.primitive[`icon-${side}-expanded`], css);
      expect(icon.collapsible).toBe('icon');
      // Soft, so the right side is still read when the left side fails.
      expect.soft({ ...offcanvas, collapsible: 'any' }, `expanded, ${side}`).toEqual({ ...icon, collapsible: 'any' });
      expect.soft(offcanvas.gapWidth, `expanded, ${side}: the page must start beside the panel`).toBe(SIDEBAR_PX);
    }
  });

  test('a collapsed offcanvas sidebar sits wholly outside the viewport, and the page takes the full width', async ({
    page,
  }) => {
    const left = await measure(page, markup.primitive['offcanvas-left-collapsed'], css);
    const right = await measure(page, markup.primitive['offcanvas-right-collapsed'], css);

    expect([left.state, left.collapsible]).toEqual(['collapsed', 'offcanvas']);
    expect(left.panel.right, 'collapsed, left: some of the panel is still on screen').toBeLessThanOrEqual(
      inViewport.left,
    );
    expect(right.panel.left, 'collapsed, right: some of the panel is still on screen').toBeGreaterThanOrEqual(
      inViewport.right,
    );
    for (const reading of [left, right]) {
      expect(reading.gapWidth).toBe(0);
      expect(reading.page).toEqual({ left: inViewport.left, right: inViewport.right, width: VIEWPORT.width });
    }
  });

  test('the icon form is the control: 256px expanded, the 48px strip collapsed', async ({ page }) => {
    const expanded = await measure(page, markup.primitive['icon-left-expanded'], css);
    const collapsed = await measure(page, markup.primitive['icon-left-collapsed'], css);

    expect(expanded.panel).toEqual({ left: 0, right: SIDEBAR_PX, width: SIDEBAR_PX });
    expect(expanded.page?.left).toBe(SIDEBAR_PX);
    expect(collapsed.panel).toEqual({ left: 0, right: ICON_PX, width: ICON_PX });
    expect(collapsed.page?.left).toBe(ICON_PX);
  });

  test('the sidebar node with `collapsible` omitted draws on-screen in a bare host', async ({ page }) => {
    const reading = await measure(page, markup.node, css);

    // Its own provider, open by default: the user-facing default form.
    expect([reading.state, reading.collapsible]).toEqual(['expanded', 'offcanvas']);
    expect(reading.panel).toEqual({ left: 0, right: SIDEBAR_PX, width: SIDEBAR_PX });
    expect(reading.gapWidth).toBe(SIDEBAR_PX);
  });

  test("SidebarNav's offcanvas form is on-screen expanded and off-screen collapsed", async ({ page }) => {
    const expanded = await measure(page, markup.sidebarNav.expanded, css);
    const collapsed = await measure(page, markup.sidebarNav.collapsed, css);

    expect([expanded.state, expanded.collapsible]).toEqual(['expanded', 'offcanvas']);
    expect(expanded.panel).toEqual({ left: 0, right: SIDEBAR_PX, width: SIDEBAR_PX });
    expect(expanded.page?.left).toBe(SIDEBAR_PX);

    expect([collapsed.state, collapsed.collapsible]).toEqual(['collapsed', 'offcanvas']);
    expect(collapsed.panel.right).toBeLessThanOrEqual(0);
    expect(collapsed.page?.left).toBe(0);
  });
});
