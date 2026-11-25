import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { build, type Plugin, type Rollup } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * TEST PAGE for objectstack#36899: Studio's left menu, laid out in Chromium.
 *
 * jsdom has no layout engine. The unit tests (`StudioMenu.test.tsx`) pin what
 * the menu lists, its current entry, its search and its cookie; this page
 * proves where it is drawn: docked at the left of a wide window with the
 * content beside it, off the canvas once collapsed with the content taking the
 * full width, still collapsed after a reload (Studio's own cookie, on a real
 * http origin), and a drawer over the page at phone width.
 *
 * REAL: `StudioMenuProvider`, `StudioMenuTrigger`, `StudioMenu` and everything
 * they import (the sidebar primitive, the menu model, the i18n), bundled by
 * Vite from source, and the real Tailwind theme compiled for the classes on
 * the page. FIXTURES: the metadata reads (`useMetadata`) answer three served
 * types and one count; the frame is the surface's own (`StudioMenuProvider`
 * around a header and a body row), not the whole surface.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const MENU = source('packages/app-shell/src/views/studio-design/StudioMenu.tsx');
const THEME_CSS = source('packages/components/src/index.css');
const ORIGIN = 'http://studio-menu.test';
const ENTRY = '\0studio-left-menu:entry';
const METADATA_STUB = '\0studio-left-menu:useMetadata';

function workspaceSources(): Plugin {
  return {
    name: 'studio-left-menu-workspace-src',
    enforce: 'pre',
    async resolveId(id, importer) {
      // objectstack#36900 — the menu's reads live in `studioMenuData.ts`, beside the menu.
      if (id.endsWith('/useMetadata.js') && (importer?.endsWith('StudioMenu.tsx') || importer?.endsWith('studioMenuData.ts'))) {
        return METADATA_STUB;
      }
      const m = /^@object-ui\/([a-z0-9-]+)(?:\/(.+))?$/.exec(id);
      if (!m) return null;
      const [, pkg, sub] = m;
      const target =
        pkg === 'types' && sub === 'zod'
          ? source('packages/types/src/zod/index.zod.ts')
          : source(`packages/${pkg}/src${sub ? `/${sub}` : ''}`);
      const resolved = await this.resolve(target, importer, { skipSelf: true });
      if (!resolved) throw new Error(`${id} did not resolve to a source file under ${target}`);
      return resolved;
    },
    load(id) {
      if (id !== METADATA_STUB) return null;
      return `
const ENTRIES = [
  { type: 'object', domain: 'data' },
  { type: 'flow', domain: 'automation' },
  { type: 'permission', domain: 'security' },
];
export const useMetadataClient = () => ({});
export const useMetadataTypes = () => ({ loading: false, error: null, entries: ENTRIES });
export const useGlobalDiagnostics = () => ({ countsByType: { object: 12 }, packagesByType: {}, reload: () => {} });
`;
    },
  };
}

function entry(): Plugin {
  const code = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { StudioMenu, StudioMenuProvider, StudioMenuTrigger } from ${JSON.stringify(MENU)};

const h = React.createElement;
createRoot(document.getElementById('root')).render(
  h(MemoryRouter, { initialEntries: ['/studio/com.acme.app/metadata/object?package=com.acme.app'] },
    h(StudioMenuProvider, { className: 'h-screen min-h-0 overflow-hidden bg-background text-foreground' },
      h('div', { className: 'flex min-w-0 flex-1 flex-col' },
        h('header', { className: 'flex h-12 shrink-0 items-center border-b px-3' }, h(StudioMenuTrigger, { locale: 'en' })),
        h('div', { className: 'relative flex min-h-0 flex-1 overflow-hidden' },
          h(StudioMenu, { segment: 'com.acme.app', locale: 'en' }),
          h('main', { id: 'content', className: 'min-h-0 min-w-0 flex-1 p-4' }, 'List')))))
);
`;
  return {
    name: 'studio-left-menu-entry',
    resolveId: (id) => (id === 'studio-left-menu:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    cacheDir: path.join(os.tmpdir(), 'objectui-studio-left-menu'),
    logLevel: 'error',
    mode: 'production',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [workspaceSources(), entry()],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: { input: 'studio-left-menu:entry', output: { format: 'es', codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunks = outputs.flatMap((o) => o.output).filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`expected one bundled chunk, got ${chunks.length}`);
  return chunks[0].code;
}

async function tailwindFor(candidates: string[]): Promise<string> {
  const requireFromComponents = createRequire(source('packages/components/package.json'));
  const twEntry = requireFromComponents.resolve('tailwindcss/index.css');
  const compiler = await compile(readFileSync(THEME_CSS, 'utf8'), {
    base: path.dirname(THEME_CSS),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? twEntry : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
    loadModule: async (id: string) => {
      const file = requireFromComponents.resolve(id);
      const mod = await import(pathToFileURL(file).href);
      return { path: file, base: path.dirname(file), module: mod.default ?? mod };
    },
  });
  return compiler.build(candidates);
}

let bundle = '';
let css = '';

/** Serve the page on a real http origin (the cookie needs one) and wait for the menu's toggle. */
async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 720 });
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><style>html,body{margin:0}</style><style>${css}</style></head><body><div id="root"></div><script type="module">${bundle}</script></body></html>`,
    }),
  );
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector('[data-testid="studio-menu-toggle"]', { timeout: 30_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const rect = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
  });
/** The docked panel (the sidebar primitive's inner box, which fills its fixed container). */
const PANEL = '[data-side="left"][data-state] [data-sidebar="sidebar"]';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  bundle = await bundlePage();
  // The stylesheet: the classes the page draws in all three states.
  const page = await browser.newPage();
  const seen = new Set<string>();
  const collect = async () =>
    (await page.evaluate(() =>
      [...document.querySelectorAll('[class]')].flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)),
    )).forEach((c) => c && seen.add(c));
  await open(page, 1280);
  await collect();
  await page.getByTestId('studio-menu-toggle').click();
  await collect();
  await open(page, 390);
  await page.getByTestId('studio-menu-toggle').click();
  await page.waitForSelector('[role="dialog"]');
  await collect();
  await page.close();
  css = await tailwindFor([...seen]);
});

test.describe('Studio left menu (objectstack#36899)', () => {
  test('wide: docked at the left, six groups, the content beside it', async ({ page }, testInfo) => {
    await open(page, 1280);
    const panel = await rect(page, PANEL);
    const content = await rect(page, '#content');
    expect(panel.left).toBe(0);
    // 16rem, less the container's 1 px right border.
    expect(panel.width).toBeGreaterThanOrEqual(255);
    expect(panel.width).toBeLessThanOrEqual(256);
    expect(content.left).toBeGreaterThanOrEqual(panel.right - 1);
    for (const g of ['data', 'ui', 'automation', 'system', 'security', 'ai']) {
      await expect(page.getByTestId(`studio-menu-group-${g}`)).toBeVisible();
    }
    await testInfo.attach('wide', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('collapsed: off the canvas, the content takes the full width, and a reload keeps it', async ({ page }, testInfo) => {
    await open(page, 1280);
    await page.getByTestId('studio-menu-toggle').click();
    await expect(page.locator('[data-side="left"][data-state="collapsed"]')).toHaveCount(1);
    await expect.poll(async () => (await rect(page, PANEL)).right).toBeLessThanOrEqual(0);
    await expect.poll(async () => (await rect(page, '#content')).left).toBe(0);
    const cookies = await page.context().cookies(ORIGIN);
    expect(cookies.find((c) => c.name === 'studio_menu_state')?.value).toBe('false');
    expect(cookies.find((c) => c.name === 'sidebar_state')).toBeUndefined();
    await testInfo.attach('collapsed', { body: await page.screenshot(), contentType: 'image/png' });

    await page.reload();
    await page.waitForSelector('[data-testid="studio-menu-toggle"]');
    await expect(page.locator('[data-side="left"][data-state="collapsed"]')).toHaveCount(1);
    await expect(page.getByTestId('studio-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  test('phone: a drawer, closed until the toggle opens it, inside the viewport', async ({ page }, testInfo) => {
    await open(page, 390);
    await expect(page.getByTestId('studio-menu')).toHaveCount(0);
    await page.getByTestId('studio-menu-toggle').click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByTestId('studio-menu')).toBeVisible();
    // Read once the slide-in has finished.
    const box = () => drawer.evaluate((el) => el.getBoundingClientRect().toJSON() as { left: number; right: number });
    await expect.poll(async () => (await box()).left).toBeGreaterThanOrEqual(0);
    expect((await box()).right).toBeLessThanOrEqual(390);
    await testInfo.attach('narrow', { body: await page.screenshot(), contentType: 'image/png' });
    await drawer.getByTestId('studio-menu-entry-type:flow').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
