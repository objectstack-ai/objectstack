import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { build, type Plugin, type Rollup } from 'vite';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * The account app's Mobile App page (objectstack#29314) in a real browser: the
 * QR code renders as an image the browser decodes, beside the copyable
 * `objectos://connect?server=…` link built from the server's published public
 * base URL; a loopback address gets the `OS_AUTH_URL` remedy and no code.
 *
 * ## Why a Playwright spec beside the vitest pins
 *
 * `MobileAppPage.test.tsx` pins the payload: the image's `src` equals
 * `qrcode`'s own SVG for the expected link. jsdom decodes no image, so whether
 * that `data:` SVG actually renders as a picture with a size, and the link
 * stays on screen beside it, is a question only a browser answers.
 *
 * ## What is real here and what is a fixture
 *
 * REAL, built from source at run time and running in the page: `MobileAppPage`
 * and its `mobileConnect` / `deploymentReach` helpers, `PageHeader`, the Shadcn
 * `Alert`, `Button` and `Card` primitives, `qrcode`, `lucide-react`,
 * `react-router-dom` (a `MemoryRouter`, for `PageHeader`'s Setup check) and
 * React. The copy is the real English pack (`packages/i18n/src/locales/en.ts`),
 * interpolated the way i18next does. The stylesheet is real Tailwind, compiled
 * from the installed `tailwindcss` for the class strings in those sources.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - `@object-ui/auth` is a stub whose `getAuthConfig()` answers the
 *     `features` object each test sets: the public auth config the server
 *     serves, reduced to the one key this page reads.
 *   - `@object-ui/i18n` is a stub that looks each key up in the English pack.
 *   - `@object-ui/components` is a stub re-exporting the four primitives the
 *     page and its header draw, from their source files.
 *   - `@object-ui/react` is a stub exporting a `SchemaRenderer` that renders
 *     nothing; the components' `lib/utils` imports it for helpers this page
 *     does not call.
 *   - Theme colour tokens are not compiled, so surfaces are unpainted.
 *
 * Workspace packages are not imported by name: this lane builds no workspace
 * `dist/`, and `scripts/__tests__/e2e-type-check.test.ts` pins that no spec
 * under `e2e/` imports one.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const PAGE = source('packages/app-shell/src/console/mobile-app/MobileAppPage.tsx');
const PAGE_HEADER = source('packages/app-shell/src/layout/PageHeader.tsx');
const EN_PACK = source('packages/i18n/src/locales/en.ts');
const UI = (name: string) => source(`packages/components/src/ui/${name}.tsx`);
const UTILS = source('packages/components/src/lib/utils.tsx');

/** The source files whose class strings the page draws with. */
const STYLED_SOURCES = [PAGE, PAGE_HEADER, UI('alert'), UI('button'), UI('card')];

const STUB_AUTH = '\0mobile-app-qr:auth';
const STUB_I18N = '\0mobile-app-qr:i18n';
const STUB_COMPONENTS = '\0mobile-app-qr:components';
const STUB_REACT = '\0mobile-app-qr:react';
const ENTRY = '\0mobile-app-qr:entry';

function fixtures(): Plugin {
  const at = (file: string) => JSON.stringify(file);
  const modules: Record<string, string> = {
    [STUB_AUTH]: `
const getAuthConfig = () => Promise.resolve({ features: window.__features });
export const useAuth = () => ({ getAuthConfig });
`,
    [STUB_I18N]: `
import en from ${at(EN_PACK)};
const t = (key, options) => {
  let text = key.split('.').reduce((node, part) => (node == null ? node : node[part]), en);
  if (typeof text !== 'string') return key;
  for (const [name, value] of Object.entries(options ?? {})) {
    text = text.split('{{' + name + '}}').join(String(value));
  }
  return text;
};
export const useObjectTranslation = () => ({ t, language: 'en' });
`,
    [STUB_COMPONENTS]: `
export { Alert, AlertTitle, AlertDescription } from ${at(UI('alert'))};
export { Button } from ${at(UI('button'))};
export { Card, CardContent } from ${at(UI('card'))};
export { cn } from ${at(UTILS)};
`,
    [STUB_REACT]: 'export const SchemaRenderer = () => null;\n',
    [ENTRY]: `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { MobileAppPage } from ${at(PAGE)};

createRoot(document.getElementById('root')).render(
  React.createElement(MemoryRouter, null, React.createElement(MobileAppPage)),
);
window.__mounted = true;
`,
  };
  return {
    name: 'mobile-app-qr-fixtures',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (id === '@object-ui/auth') return STUB_AUTH;
      if (id === '@object-ui/i18n') return STUB_I18N;
      if (id === '@object-ui/components') return STUB_COMPONENTS;
      if (id === '@object-ui/react') return STUB_REACT;
      if (id === 'mobile-app-qr:entry') return ENTRY;
      // The entry's and the stubs' bare imports resolve as the page's own do.
      if ((importer === ENTRY || importer === STUB_COMPONENTS) && !path.isAbsolute(id)) {
        return this.resolve(id, PAGE, { skipSelf: true });
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
    cacheDir: path.join(os.tmpdir(), 'objectui-mobile-app-qr'),
    logLevel: 'error',
    publicDir: false,
    plugins: [fixtures()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      outDir: path.join(os.tmpdir(), 'objectui-mobile-app-qr-out'),
      emptyOutDir: false,
      minify: false,
      modulePreload: false,
      rollupOptions: {
        input: 'mobile-app-qr:entry',
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
  const tokens = STYLED_SOURCES.map((f) => readFileSync(f, 'utf8'))
    .flatMap((text) => text.split(/[\s'"`]+/))
    .filter(Boolean);
  const css = compiler.build(tokens);
  // The code's frame is what gives the image its size; without it a 0×0 image could pass for a drawn one.
  for (const needle of ['.h-48', '.w-48']) {
    if (!css.includes(needle)) throw new Error(`Tailwind emitted no rule for ${needle}; the code would be unsized.`);
  }
  return css;
}

/** Never resolved by DNS: every request to it is answered by `page.route`. */
const HARNESS_ORIGIN = 'http://mobile-app-qr.test';

let script = '';
let css = '';

test.beforeAll(async () => {
  [script, css] = await Promise.all([bundle(), tailwind()]);
});

/** Open the page with the server answering `features` on its public auth config. */
async function openPage(page: Page, features: Record<string, unknown>) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(`${HARNESS_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/harness.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    return route.fulfill({
      contentType: 'text/html',
      body:
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>` +
        `<script>window.__features = ${JSON.stringify(features)};</script></head>` +
        `<body><div id="root"></div><script src="/harness.js"></script></body></html>`,
    });
  });
  await page.goto(`${HARNESS_ORIGIN}/`);
  try {
    await page.waitForFunction(() => '__mounted' in window, null, { timeout: 10_000 });
  } catch (cause) {
    throw new Error(`the harness did not mount; page errors: ${JSON.stringify(errors)}`, { cause });
  }
}

test.describe('Mobile App page: the connect code', () => {
  test('a public base URL with a sub-path renders the QR code and the copyable link', async ({ page }) => {
    await openPage(page, { publicBaseUrl: 'https://acme.example/os' });

    const link = page.getByTestId('mobile-app-link');
    await expect(link).toHaveText('objectos://connect?server=https%3A%2F%2Facme.example%2Fos');
    await expect(link).toBeVisible();

    const qr = page.getByRole('img', { name: 'QR code that connects the ObjectOS mobile app to this server' });
    await expect(qr).toBeVisible();
    // The browser decoded the SVG into a picture: a broken image has no natural size.
    await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const box = await qr.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(150);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(150);

    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(page.getByText("The code holds only this server's address, never your account.")).toBeVisible();
    await expect(page.getByTestId('mobile-app-refusal')).toHaveCount(0);
  });

  test('CONTROL: a loopback base URL renders the OS_AUTH_URL remedy and no code', async ({ page }) => {
    await openPage(page, { publicBaseUrl: 'http://localhost:3000' });

    const refusal = page.getByTestId('mobile-app-refusal');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("A phone cannot reach this server's address");
    await expect(refusal).toContainText('http://localhost:3000');
    await expect(refusal).toContainText('OS_AUTH_URL');
    await expect(page.getByTestId('mobile-app-qr')).toHaveCount(0);
    await expect(page.getByTestId('mobile-app-link')).toHaveCount(0);
  });
});
